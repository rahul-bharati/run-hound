/**
 * Form-detection helpers for sign-in (auth.ts): the regexes and functions that pick the sign-in form, the two-step
 * first step, the identifier field, and the page-state helpers that say the page is a code step, a captcha, or a
 * sign-up. Pure helpers over DiscoveredForm and a Playwright Page; no browser guards or session state.
 *
 * The `page.evaluate` scripts are serialized and sent to the browser; they MUST NOT reference any module variable
 * other than the inlined regex/function constants below (ENTRY_FIELDS, SIGN_IN_CODE_WORDS, …). Anything that needs
 * runtime values is passed as a function argument or computed inside the script.
 */
import type { Page } from "playwright";
import type { DiscoveredForm, FormControl, FormField } from "../../core/types.js";
import { originOf } from "../../core/saves.js";
import { cleanErrorMessage } from "../errors.js";
import { redactSecrets } from "../redact.js";
import { SignInError, continuedElsewhere } from "../../errors/sign-in-error.js";
import type { FirstStep, StepEnv } from "../../interfaces/auth.js";
import type { StepOutcome } from "../../types/auth.js";
import {
  ACTION_TIMEOUT_MS,
  ALERT_GRACE_MS,
  NETWORK_IDLE_MS,
  NO_STEP_SETTLED_MS,
  POLL_MS,
  SETTLED_MS,
  SUBMIT_WAIT_MS,
} from "../../constants/auth-constants.js";

/** A field's type is a password. */
const isPassword = (f: FormField) => f.type === "password";

/** One-line, plain text of an unknown error's message (without a Call log block), as signIn's throw site uses it. */
function firstLine(err: unknown): string {
  return cleanErrorMessage(err instanceof Error ? err.message : String(err)).split("\n")[0] ?? "";
}

/** Field types a username or an email is typed into. */
const TEXT_LIKE = new Set(["text", "email", "tel", "search", "url"]);
const isTextLike = (f: FormField) => TEXT_LIKE.has(f.type) && !f.widget;

/** Where the identifier goes (spec step 3), or null when the form has no field for it. */
export function identifierField(form: DiscoveredForm): FormField | null {
  const passwordAt = form.fields.findIndex(isPassword);
  const candidates = form.fields.filter(isTextLike);
  const words = (f: FormField) => [f.key, f.label, f.placeholder, f.accessibleName].filter(Boolean).join(" ");
  return (
    candidates.find((f) => f.autocomplete === "username" || f.autocomplete === "email") ??
    candidates.find((f) => f.type === "email") ??
    candidates.find((f) => /e-?mail|user|login|account/i.test(words(f))) ??
    form.fields.slice(0, Math.max(0, passwordAt)).find(isTextLike) ??
    null
  );
}

/** Words that name a sign-in form, and words that name a sign-up form. */
const SIGN_IN_WORDS = /\b(sign|log)[\s-]?(in|on)\b|\blogin\b/i;
/**
 * Trial wording (0.6.0 review, round 2) says sign up too: "Start your 14-day free trial", "Start trial", "Try it free".
 */
const SIGN_UP_WORDS =
  /\b(sign[\s-]?up|register|registration|create\s+(an?\s+|your\s+|my\s+|new\s+)?account|new\s+account|join|get\s+started|free\s+trial|start\s+(your\s+|a\s+)?(\d+[\s-]?day\s+)?(free\s+)?trial|try\s+(it\s+|us\s+)?(for\s+)?free)\b/i;

/**
 * The words of a field that asks for the person's own name ("Name", "Full name", "First name", name="first_name"): a
 * sign-up form asks for one, a sign-in form doesn't (0.6.0 review, round 2). "Username", "User name" and "Company name"
 * don't count.
 */
const PERSON_NAME = /^(your\s+)?((full|first|last|given|family|middle)[\s_-]?)?name$|^(surname|fullname|firstname|lastname|givenname|familyname)$/i;

/** Whether `f` asks for the person's own name. */
const isNameField = (f: FormField) =>
  isTextLike(f) &&
  (/^(name|given-name|family-name|additional-name)$/i.test((f.autocomplete ?? "").trim()) ||
    [f.key, f.label, f.placeholder, f.accessibleName].some((w) => !!w && PERSON_NAME.test(w.replace(/[*:]/g, "").trim())));

/** Whether `form` asks for the person's own name beside an identifier. */
function asksForName(form: DiscoveredForm): boolean {
  if (!form.fields.some(isNameField)) return false;
  return identifierField({ ...form, fields: form.fields.filter((f) => !isNameField(f)) }) !== null;
}

/** Whether a password form has autocomplete=current-password on one of its password fields. */
export const hasCurrentPassword = (form: DiscoveredForm) => form.fields.some((f) => isPassword(f) && /current-password/i.test(f.autocomplete ?? ""));

/** The form's name and its submit control's name: what the form says it does. */
function formWords(form: DiscoveredForm): string {
  const submit = form.controls.find((c) => c.isSubmit);
  return `${form.name ?? ""} ${submit?.accessibleName ?? ""} ${submit?.text ?? ""}`;
}

/**
 * The sign-in form (spec step 2): of the forms with a password field, never one that creates an account, then the best
 * by: a password with autocomplete=current-password, sign-in words in its name or submit control, exactly one password
 * field. The first wins a tie. A sign-up form placed before the sign-in form must never receive the account's credentials.
 */
export function signInForm(forms: DiscoveredForm[]): DiscoveredForm | null {
  let best: DiscoveredForm | null = null;
  let bestScore = -1;
  for (const form of forms) {
    const passwords = form.fields.filter(isPassword);
    if (passwords.length === 0) continue;
    if (signUpReason(form)) continue;
    const saysSignIn = SIGN_IN_WORDS.test(formWords(form));
    const current = hasCurrentPassword(form);
    const score = (current ? 4 : 0) + (saysSignIn ? 2 : 0) + (passwords.length === 1 ? 1 : 0);
    if (score > bestScore) {
      best = form;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Why signInForm never takes the password form `form` (it creates an account), for the message when the page has no
 * other: its sign-up words, "its password fields are for a new password", or "it asks for a name"; null when it may be
 * a sign-in form.
 */
export function signUpReason(form: DiscoveredForm): string | null {
  const passwords = form.fields.filter(isPassword);
  if (passwords.length > 0 && passwords.every((f) => /new-password/i.test(f.autocomplete ?? ""))) return "its password fields are for a new password";
  const words = formWords(form);
  if (SIGN_IN_WORDS.test(words)) return null;
  const signUp = SIGN_UP_WORDS.exec(words);
  if (signUp) return `it says "${signUp[0].replace(/\s+/g, " ")}"`;
  return asksForName(form) && !hasCurrentPassword(form) ? "it asks for a name beside the email or username" : null;
}

// FirstStep, StepEnv live in interfaces/auth.ts; StepOutcome in types/auth.ts.

/** Words of a password field that asks to choose one (a sign-up), not for the account's password. */
const CHOOSE_PASSWORD = /\b(create|choose|new|confirm|repeat)\b/i;

/** A control that moves a first step on without saying what it does: "Continue", "Next". */
const NEXT_CONTROL = /^(continue|next|proceed)(\s*[→›>»])?$/i;
/** A control that signs in through another provider ("Continue with Google"). */
const PROVIDER_CONTROL =
  /\b(with|via|using)\s+(google|github|microsoft|apple|facebook|gitlab|bitbucket|twitter|x|linkedin|slack|discord|okta|azure|sso|saml|passkey|a\s+passkey)\b|\bsso\b|\bpasskeys?\b/i;
/** A form's own words that say it does something other than sign in (even on a page whose address says login). */
const OTHER_PURPOSE = /\b(subscribe|unsubscribe|newsletter|search|reset|forgot|recover|waitlist|wait\s+list|notify|contact|feedback|coupon|promo|invite)\b/i;

/**
 * A passwordless sign-in (0.6.0 review, round 1): a form that sends the account something instead of asking for its
 * password, by its control's words ("Send magic link", "Email me a sign-in link", "Send code", "Get a one-time
 * password") or by its name ("Sign in with a one-time code"). Submitting one would have the app e-mail (or text) the
 * test account on every sign-in, so it is never a first step, even when it says sign in. The name is read for whole
 * phrases only: it may come from the page's heading ("Sign in to Code.org").
 */
const SENDS_CONTROL = /\b(send|e-?mail\s+me|text\s+me|magic|link|codes?|otp|one[\s-]?time|passcode|passwordless)\b/i;
const SENDS_NAME =
  /\b(magic\s+link|(sign|log)[\s-]?in\s+(link|code)|login\s+(link|code)|one[\s-]?time\s+(code|password|passcode|link)|e-?mail\s+(me|you)\s+a|passwordless|otp)\b/i;

/** A control's words: its accessible name and its text, each only once ("Continue", not "Continue Continue"). */
function controlWords(c: FormControl): string {
  const name = (c.accessibleName ?? "").replace(/\s+/g, " ").trim();
  const text = (c.text ?? "").replace(/\s+/g, " ").trim();
  if (!name || text.toLowerCase().includes(name.toLowerCase())) return text || name;
  if (!text || name.toLowerCase().includes(text.toLowerCase())) return name;
  return `${name} ${text}`;
}

/** What makes `form` (moved on by `control`) a passwordless sign-in. */
function sendsInstead(form: DiscoveredForm, control: FormControl): string | null {
  const words = controlWords(control);
  if (SENDS_CONTROL.test(words)) return words;
  return form.name && SENDS_NAME.test(form.name) ? form.name.replace(/\s+/g, " ").trim() : null;
}

/** The words of a passwordless sign-in form among `forms`. */
export function passwordlessWords(forms: DiscoveredForm[]): string | null {
  for (const form of forms) {
    if (form.search || form.fields.some(isPassword) || !identifierField(form)) continue;
    const control = nextControl(form);
    const words = control ? sendsInstead(form, control) : null;
    if (words) return words;
  }
  return null;
}

/** The control that moves a first step on: the form's submit control, else a "Continue"/"Next" button. */
function nextControl(form: DiscoveredForm): FormControl | null {
  const submit = form.controls.find((c) => c.isSubmit && !PROVIDER_CONTROL.test(controlWords(c)));
  if (submit) return submit;
  return form.controls.find((c) => c.role === "button" && [c.accessibleName, c.text].some((w) => NEXT_CONTROL.test((w ?? "").trim()))) ?? null;
}

/** The words of a page address: "/u/login/identifier" gives "u login identifier", "/users/sign_in" "users sign in". */
function pathWords(url: string): string {
  try {
    return new URL(url).pathname.replace(/[/_.\-+]+/g, " ").trim();
  } catch {
    return "";
  }
}

/** The page's visible text just before `selector`. */
async function textBefore(page: Page, selector: string): Promise<string> {
  const script = `(selector) => {
    let el = null;
    try { el = document.querySelector(selector); } catch { el = null; }
    const out = [];
    for (let node = el, hops = 0; node && node !== document.body && hops < 3 && out.length === 0; node = node.parentElement, hops++) {
      let prev = node.previousElementSibling;
      for (let n = 0; prev && n < 3; prev = prev.previousElementSibling, n++) {
        if (prev.matches("form, input, select, textarea, script, style") || prev.querySelector("input, select, textarea")) continue;
        const text = (prev.innerText || "").replace(/\\s+/g, " ").trim();
        if (text) out.push(text);
      }
    }
    return out.join(" ").slice(0, 400);
  }`;
  return String(await page.evaluate(`(${script})(${JSON.stringify(selector)})`).catch(() => ""));
}

/**
 * The first step of a two-step sign-in (0.6.0) among `forms`, when none of them is a sign-in form with a password
 * field: a form without a password field whose only field besides checkboxes is an identifier field (identifierField),
 * with a submit control or a "Continue"/"Next" button, that is not a search, sign-up, newsletter, password-reset or
 * similar form by its own words (its name and that control), and that says sign in.
 */
export async function firstStepForm(page: Page, forms: DiscoveredForm[], loginUrl: string): Promise<FirstStep | null> {
  let best: FirstStep | null = null;
  let bestScore = -1;
  let around: string | null = null;
  for (const form of forms) {
    if (form.search || form.fields.some(isPassword)) continue;
    const field = identifierField(form);
    if (!field || form.fields.some((f) => f !== field && f.type !== "checkbox")) continue;
    const control = nextControl(form);
    if (!control) continue;
    const own = `${form.name ?? ""} ${controlWords(control)}`;
    if (PROVIDER_CONTROL.test(own)) continue;
    if (sendsInstead(form, control)) continue;
    const saysSignIn = SIGN_IN_WORDS.test(own);
    if (!saysSignIn) {
      if (SIGN_UP_WORDS.test(own) || OTHER_PURPOSE.test(own)) continue;
      around ??= `${await page.title().catch(() => "")} ${pathWords(loginUrl)} ${pathWords(page.url())}`;
      if (!SIGN_IN_WORDS.test(around) && !SIGN_IN_WORDS.test(await textBefore(page, form.selector))) continue;
    }
    const score = (saysSignIn ? 2 : 0) + (field.autocomplete === "username" || field.autocomplete === "email" ? 1 : 0);
    if (score > bestScore) {
      best = { form, field, control };
      bestScore = score;
    }
  }
  return best;
}

/**
 * Whether a password form says by itself that it signs in (0.6.0 review, round 2): autocomplete=current-password,
 * sign-in words in its submit control, or in its name when that name isn't the first step's too.
 */
export function signsInItself(form: DiscoveredForm, first: FirstStep): boolean {
  if (hasCurrentPassword(form)) return true;
  const submit = form.controls.find((c) => c.isSubmit);
  if (submit && SIGN_IN_WORDS.test(controlWords(submit))) return true;
  const name = (form.name ?? "").replace(/\s+/g, " ").trim();
  return name !== "" && name !== (first.form.name ?? "").replace(/\s+/g, " ").trim() && SIGN_IN_WORDS.test(name);
}

/** Texts of visible error messages: role=alert, assertive live regions, error toasts, and error text around the form. */
export async function errorTexts(page: Page, formSelector: string): Promise<string[]> {
  const script = `(formSelector) => {
    const norm = (s) => (s || "").replace(/\\s+/g, " ").trim();
    const shown = (el) => {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const out = [];
    const add = (el) => { const t = norm(el.innerText || el.textContent); if (t && t.length <= 300 && shown(el) && !out.includes(t)) out.push(t); };
    document.querySelectorAll("[role=alert], [aria-live=assertive], [data-sonner-toast][data-type=error], .Toastify__toast--error").forEach(add);
    let form = null;
    try { form = document.querySelector(formSelector); } catch { form = null; }
    const scope = form ? (form.parentElement || form) : null;
    if (scope) scope.querySelectorAll("[class*=error i], [id*=error i], [class*=invalid i]").forEach((el) => {
      if (el.matches("input, select, textarea, button, label, form")) return;
      add(el);
    });
    return out.slice(0, 5);
  }`;
  const texts = await page.evaluate(`(${script})(${JSON.stringify(formSelector)})`).catch(() => []);
  return Array.isArray(texts) ? (texts as string[]) : [];
}

/** A visible field asking for a one-time code (multi-factor sign-in). */
export async function showsCodeField(page: Page, onSignInPage: boolean): Promise<boolean> {
  if ((await page.locator("input[autocomplete=one-time-code]:visible").count().catch(() => 0)) > 0) return true;
  if (!onSignInPage) return false;
  const script = `() => {
    const words = /\\b(code|otp|one.?time|verification|verify|2fa|mfa|totp|two.?factor|authenticator)\\b/i;
    for (const el of document.querySelectorAll("input:not([type=hidden]):not([type=password])")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const label = el.labels && el.labels[0] ? el.labels[0].innerText : "";
      const text = [el.name, el.id, el.placeholder, el.getAttribute("aria-label"), label].join(" ");
      if (words.test(text)) return true;
    }
    return false;
  }`;
  return Boolean(await page.evaluate(`(${script})()`).catch(() => false));
}

/** A captcha on the page: a field or label that says so, or a reCAPTCHA / hCaptcha / Turnstile widget. */
export async function showsCaptcha(page: Page): Promise<boolean> {
  const script = `() => {
    if (document.querySelector(".g-recaptcha, .h-captcha, .cf-turnstile, [data-sitekey], iframe[src*=captcha i], iframe[src*=turnstile i]")) return true;
    for (const el of document.querySelectorAll("input, label, img")) {
      const text = [el.name, el.id, el.getAttribute("placeholder"), el.getAttribute("aria-label"), el.getAttribute("alt"), el.tagName === "LABEL" ? el.innerText : ""].join(" ");
      if (/captcha/i.test(text)) return true;
    }
    return false;
  }`;
  return Boolean(await page.evaluate(`(${script})()`).catch(() => false));
}

/**
 * Runs in the page: its fields to fill in, shown (a box, not visibility:hidden), enabled, not a search box, not a
 * checkbox, radio, file or button input. Declares no named function (see typePassword).
 */
const ENTRY_FIELDS = String.raw`(() => {
  const shown = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  return Array.from(document.querySelectorAll("input, textarea, select")).filter((el) =>
    !el.matches("input[type=hidden], input[type=submit], input[type=button], input[type=reset], input[type=image], input[type=checkbox], input[type=radio], input[type=file], input[type=search], input[type=range], input[type=color]") &&
    !el.closest("[role=search]") && !el.disabled && shown(el));
})`;

/**
 * Words that name a sign-in's code (0.6.0 review, round 3), for showsCodeStep.
 */
const SIGN_IN_CODE_WORDS = String.raw`/\b(otp|one ?time|passcode|verification|verify|2fa|mfa|totp|(two|2) ?(factor|step)|multi ?factor|authenticator|(security|sign ?in|log ?in|login|confirmation) code|\d ?digit code)\b/i`;

/** Headings or titles that name a code step outright (close-out review, round 2). */
const CODE_STEP_HEADING = String.raw`/\b(otp|one ?time|passcode|2fa|mfa|totp|(two|2) ?(factor|step)|multi ?factor|authenticator|(verification|security|sign ?in|log ?in|login|confirmation) code|\d ?digit code)\b/i`;

/** A field's `pattern` that allows digits only. */
const DIGITS_ONLY_PATTERN = String.raw`/^\^?(\[0-9\]|\\d)([*+]|\{\d+(,\d*)?\})\$?$/`;

/** A field's `pattern` that allows 4 to 8 digits and nothing else. */
const CODE_SIZED_PATTERN = String.raw`/^\^?(\[0-9\]|\\d)\{[4-8](,[4-8])?\}\$?$/`;

/**
 * Whether the page after the password is a code step without autocomplete=one-time-code.
 */
export async function showsCodeStep(page: Page): Promise<boolean> {
  const script = `() => {
    const entry = ${ENTRY_FIELDS}();
    if (entry.length === 0 || entry.some((el) => el.tagName !== "INPUT")) return false;
    const split = entry.length >= 4 && entry.length <= 8 && entry.every((el) => el.maxLength === 1);
    if (entry.length !== 1 && !split) return false;
    const labelledBy = (el) => (el.getAttribute("aria-labelledby") || "").split(/\\s+/).filter(Boolean).map((id) => {
      const target = document.getElementById(id);
      return target ? target.innerText || target.textContent : "";
    });
    const written = (el) => [el.name, el.id, el.getAttribute("placeholder"), el.getAttribute("aria-label"), el.getAttribute("autocomplete"), ...Array.from(el.labels || []).map((l) => l.innerText), ...labelledBy(el)]
      .filter(Boolean).join(" ");
    const spaced = (text) => text.replace(/[_\\[\\]\\-.:*]+/g, " ");
    const words = (el) => spaced(written(el).replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2"));
    const own = entry.map(words).join(" ");
    const headings = Array.from(document.querySelectorAll("h1, h2, h3, legend")).map((h) => h.innerText).join(" ") + " " + document.title;
    const code = ${SIGN_IN_CODE_WORDS};
    const other = /\\b(promo|promotion(al)?|coupon|discount|voucher|gift|referral|refer|invite|invitation|redeem|zip|postal|post|area|country|source|qr|product|tracking|order|affiliate|campaign|api)\\b/i;
    if (other.test(own)) return false;
    const numeric = (el) => el.type === "number" || /^(numeric|decimal)$/i.test(el.getAttribute("inputmode") || "") || ${DIGITS_ONLY_PATTERN}.test(el.getAttribute("pattern") || "");
    const codeWord = /\\b(codes?|otp|pin|passcode|token|digits?|one ?time|2fa|mfa|totp|authenticator)\\b/i;
    const cannotHoldCode = (el) => {
      if (el.type === "email") return true;
      const text = words(el);
      if (!/\\b(e ?mail|phone|mobile|name)\\b/i.test(text) || codeWord.test(text)) return false;
      if (/\\b(name|send|resend|address|number)\\b/i.test(text)) return true;
      return !/\\b(verification|verify)\\b/i.test(text) && !numeric(el);
    };
    if (entry.some(cannotHoldCode)) return false;
    const saysCode = (el) => /\\b(codes?|otp|pin|token|passcode|digits?)\\b/i.test(words(el));
    const codeSized = (el) => (el.maxLength >= 4 && el.maxLength <= 8) || ${CODE_SIZED_PATTERN}.test(el.getAttribute("pattern") || "");
    if (code.test(entry.map((el) => spaced(written(el))).join(" "))) return true;
    if (code.test(own) && entry.every((el) => saysCode(el) || codeSized(el) || numeric(el))) return true;
    const heads = headings.replace(/[_\\-]+/g, " ");
    if (!code.test(heads)) return false;
    if (split || entry.every((el) => saysCode(el) || codeSized(el))) return true;
    return entry.every(numeric) && ${CODE_STEP_HEADING}.test(heads);
  }`;
  return Boolean(await page.evaluate(`(${script})()`).catch(() => false));
}

/**
 * Whether the page the password led to is a captcha challenge and nothing else.
 */
export async function showsCaptchaChallenge(page: Page): Promise<boolean> {
  const script = `() => {
    const shown = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
    const norm = (t) => (t || "").replace(/\\s+/g, " ").trim();
    const widgets = Array.from(document.querySelectorAll(".g-recaptcha, .h-captcha, .cf-turnstile, [data-sitekey], iframe[src*=captcha i], iframe[src*=turnstile i], iframe[src*='challenges.cloudflare' i]"))
      .filter((el) => !el.closest(".grecaptcha-badge") && !el.matches("button, input, a") && !/size=invisible/i.test(el.getAttribute("src") || "") && shown(el));
    const says = (el) => /captcha/i.test([el.name, el.id, el.getAttribute("placeholder"), el.getAttribute("aria-label"), ...Array.from(el.labels || []).map((l) => l.innerText)].join(" "));
    const entry = ${ENTRY_FIELDS}();
    const captchaFields = entry.filter(says);
    if (widgets.length === 0 && captchaFields.length === 0) return false;
    if (!entry.every((el) => captchaFields.includes(el) || widgets.some((w) => w.contains(el)))) return false;
    if (captchaFields.length > 0) return true;
    const movesOn = /^(continue|next|verify|submit|proceed|confirm|done|ok|go|sign ?in|log ?in|i('|’)?m (human|not a robot))\\b/i;
    const submits = (form) => Array.from(form.querySelectorAll("button, input[type=submit], input[type=image]")).some((c) =>
      shown(c) && c.matches("button:not([type]), button[type=submit], input[type=submit], input[type=image]") &&
      movesOn.test(norm(c.innerText || c.value || c.getAttribute("aria-label") || c.getAttribute("alt"))));
    if (widgets.some((w) => { const form = w.closest("form"); return !!form && submits(form); })) return true;
    const headings = Array.from(document.querySelectorAll("h1, h2, h3, legend")).map((h) => h.innerText).join(" ") + " " + document.title;
    return /\\b((verify|confirm|prove) (that )?you('|’)?(re| are) (a )?human|are you (a )?(human|robot)|not a robot|security (check|verification)|human verification|captcha|checking your browser|checking if the site|just a moment)\\b/i.test(norm(headings));
  }`;
  return Boolean(await page.evaluate(`(${script})()`).catch(() => false));
}

/** True when the page offers sign-in through another provider ("Continue with Google"). */
export async function offersProviders(page: Page): Promise<boolean> {
  const text = String(await page.evaluate("document.body ? document.body.innerText.slice(0, 4000) : ''").catch(() => ""));
  return /(continue|sign\s?-?in|log\s?-?in)\s+with\s+(google|github|microsoft|apple|facebook|gitlab|twitter|linkedin|slack|discord|sso)\b/i.test(text);
}

/**
 * Whether a two-step sign-in's password step asks to choose a password instead (the first step turned into a sign-up
 * under a form still named "Sign in"): of the form's password fields that showed after the first step (MARK_PASSWORDS;
 * an autofill field hidden beside the first step doesn't count), more than one is shown (a password and its
 * confirmation), or one says create, choose, new, confirm or repeat.
 */
export async function choosesPassword(page: Page, form: DiscoveredForm): Promise<boolean> {
  const passwords = form.fields.filter(isPassword);
  const fresh = (await page.evaluate(`(${NEW_ELEMENTS})(${JSON.stringify(passwords.map((p) => p.selector))})`).catch(() => [])) as boolean[];
  const shown: FormField[] = [];
  for (const [i, field] of passwords.entries()) {
    if (fresh[i] === false) continue;
    if (await page.locator(field.selector).first().isVisible().catch(() => false)) shown.push(field);
  }
  return shown.length > 1 || shown.some((f) => CHOOSE_PASSWORD.test([f.label, f.placeholder, f.accessibleName].filter(Boolean).join(" ")));
}

/**
 * Whether a password step's identifier field still needs the identifier: shown (a 0x0 autofill field isn't; the
 * identifier was the first step), editable, and not already holding it.
 */
export async function identifierNeeded(page: Page, field: FormField, username: string): Promise<boolean> {
  const box = page.locator(field.selector).first();
  if (!(await box.isVisible().catch(() => false))) return false;
  if (!(await box.isEditable({ timeout: ACTION_TIMEOUT_MS }).catch(() => false))) return false;
  return (await box.inputValue({ timeout: ACTION_TIMEOUT_MS }).catch(() => "")) !== username;
}

/** The address of a frame (not the page itself) from another origin that shows a password field. */
export async function passwordFrameElsewhere(page: Page, loginOrigin: string): Promise<string | null> {
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    const url = frame.url();
    if (!/^https?:\/\//i.test(url) || originOf(url) === loginOrigin) continue;
    if ((await frame.locator("input[type=password]:visible").count().catch(() => 0)) > 0) return url;
  }
  return null;
}

/**
 * Runs in the page before a first step: remembers the password fields showing now (a sign-up form's, beside the first
 * step), so only a password field that shows after the first step counts as its password step. Shown as Playwright's
 * :visible has it: a box, and not visibility:hidden.
 */
export const MARK_PASSWORDS = String.raw`(() => {
  const shown = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden"; };
  window.__rhPasswordsBefore = new WeakSet(Array.from(document.querySelectorAll("input[type=password]")).filter(shown));
  return true;
})()`;

/** Runs in the page: whether a password field shows that MARK_PASSWORDS didn't see. */
export const NEW_PASSWORD_SHOWN = String.raw`(() => {
  const shown = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden"; };
  const before = window.__rhPasswordsBefore;
  return Array.from(document.querySelectorAll("input[type=password]")).some((el) => shown(el) && !(before && before.has(el)));
})()`;

/** Runs in the page: for each selector, whether its element is one MARK_PASSWORDS didn't see. */
export const NEW_ELEMENTS = String.raw`(selectors) => {
  const before = window.__rhPasswordsBefore;
  return selectors.map((s) => { let el = null; try { el = document.querySelector(s); } catch { el = null; } return !!el && !(before && before.has(el)); });
}`;

/**
 * A two-step sign-in's first step (0.6.0): types the identifier into `step`'s field on the sign-in origin, activates its
 * control (else presses Enter in the field), then waits up to SUBMIT_WAIT_MS for a password field on the sign-in origin.
 * Resolves once one shows for SETTLED_MS; throws when the page went on to another origin, asks for a code or a captcha,
 * says something went wrong, or shows no password field. The password is never typed here.
 */
export async function passFirstStep(page: Page, step: FirstStep, env: StepEnv): Promise<void> {
  const { label, shownUrl, loginOrigin, guard } = env;
  const navigations: string[] = [];
  const pending = new Set<import("playwright").Request>();
  const onRequest = (request: import("playwright").Request) => {
    pending.add(request);
    const from = request.redirectedFrom();
    if (from) pending.delete(from);
    try {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigations.push(request.url());
    } catch {
      // Not a page's request.
    }
  };
  const onDone = (request: import("playwright").Request) => void pending.delete(request);
  page.on("request", onRequest);
  page.on("requestfinished", onDone);
  page.on("requestfailed", onDone);
  const elsewhere = (): string | null => {
    const left = navigations.find((url) => /^https?:\/\//i.test(url) && originOf(url) !== loginOrigin);
    if (left) return left;
    if (guard.escaped.length > 0) return guard.escaped[0]!;
    const now = page.isClosed() ? "" : page.url();
    return /^https?:\/\//i.test(now) && originOf(now) !== loginOrigin ? now : null;
  };

  try {
    const alertsBefore = new Set(await errorTexts(page, step.form.selector));
    await page.evaluate(MARK_PASSWORDS).catch(() => undefined);
    const codeBefore = await showsCodeField(page, true);
    const captchaBefore = await showsCaptcha(page);
    const field = page.locator(step.field.selector).first();
    try {
      await field.fill(env.username, { timeout: ACTION_TIMEOUT_MS });
    } catch (err) {
      throw new SignInError(`${label} could not fill in the sign-in form on ${shownUrl}: ${firstLine(err)}`);
    }
    const clicked = await page
      .locator(step.control.selector)
      .first()
      .click({ timeout: ACTION_TIMEOUT_MS })
      .then(() => true)
      .catch(() => false);
    if (!clicked) await field.press("Enter", { timeout: ACTION_TIMEOUT_MS }).catch(() => undefined);

    const outcome = await awaitPasswordStep({ alerts: alertsBefore, code: codeBefore, captcha: captchaBefore });
    switch (outcome.kind) {
      case "password":
        break;
      case "elsewhere":
        throw continuedElsewhere(outcome.url, redactSecrets);
      case "closed":
        if (guard.escaped.length > 0) throw continuedElsewhere(guard.escaped[0]!, redactSecrets);
        throw new SignInError(`${label} could not sign in: the sign-in page closed after the email was entered.`);
      case "code":
        throw new SignInError(
          `${label}'s sign-in asks for a verification code after the email. Codes (sign-in by emailed code, multi-factor sign-in) aren't supported: use a test account that signs in with a password.`,
        );
      case "captcha":
        throw new SignInError(
          `${label} could not sign in: after the email, the sign-in page asks for a captcha, and captchas aren't supported. Turn it off for test accounts in your development setup.`,
        );
      case "alert":
      case "none": {
        const quote = outcome.kind === "alert" ? outcome.texts.slice(0, 2).join(" ").slice(0, 300) : "";
        if (await showsCaptcha(page)) {
          throw new SignInError(
            `${label} could not sign in: the sign-in page asks for a captcha, and captchas aren't supported. Turn it off for test accounts in your development setup.${quote ? ` The page said: "${quote}"` : ""}`,
          );
        }
        if (quote) throw new SignInError(`${label} could not sign in: the sign-in page said "${quote}".`);
        const control = controlWords(step.control) || "Continue";
        throw new SignInError(
          `${label} could not sign in: no password field appeared on ${shownUrl} after the email was entered and "${control}" was used. Sign-in links sent by email, codes and "Sign in with …" providers aren't supported: use a test account that signs in with a password.`,
        );
      }
    }
    await page.waitForLoadState("load", { timeout: SUBMIT_WAIT_MS }).catch(() => undefined);
    await page.waitForLoadState("networkidle", { timeout: NETWORK_IDLE_MS }).catch(() => undefined);
    const after = elsewhere();
    if (after) throw continuedElsewhere(after, redactSecrets);
  } finally {
    page.off("request", onRequest);
    page.off("requestfinished", onDone);
    page.off("requestfailed", onDone);
  }

  async function awaitPasswordStep(before: { alerts: Set<string>; code: boolean; captcha: boolean }): Promise<StepOutcome> {
    const deadline = Date.now() + SUBMIT_WAIT_MS;
    let passwordSince: number | null = null;
    let alertSince: number | null = null;
    let quietSince: number | null = null;
    while (Date.now() < deadline) {
      const away = elsewhere();
      if (away) return { kind: "elsewhere", url: away };
      if (page.isClosed()) return { kind: "closed" };
      if (await page.evaluate(NEW_PASSWORD_SHOWN).then(Boolean, () => false)) {
        alertSince = null;
        quietSince = null;
        passwordSince ??= Date.now();
        if (Date.now() - passwordSince >= SETTLED_MS) return { kind: "password" };
      } else {
        passwordSince = null;
        const framed = await passwordFrameElsewhere(page, loginOrigin);
        if (framed) return { kind: "elsewhere", url: framed };
        if (!before.code && (await showsCodeField(page, true))) return { kind: "code" };
        if (!before.captcha && (await showsCaptcha(page))) return { kind: "captcha" };
        const fresh = (await errorTexts(page, step.form.selector)).filter((t) => !before.alerts.has(t));
        if (fresh.length === 0) alertSince = null;
        else if (alertSince === null) alertSince = Date.now();
        else if (Date.now() - alertSince >= ALERT_GRACE_MS) return { kind: "alert", texts: fresh };
        const fields = await page.locator("input:not([type=hidden]):visible, textarea:visible, select:visible").count().catch(() => 1);
        if (fields === 0 && pending.size === 0) {
          quietSince ??= Date.now();
          if (Date.now() - quietSince >= NO_STEP_SETTLED_MS) break;
        } else quietSince = null;
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
    const away = elsewhere();
    if (away) return { kind: "elsewhere", url: away };
    if (page.isClosed()) return { kind: "closed" };
    if (!before.code && (await showsCodeField(page, true))) return { kind: "code" };
    if (!before.captcha && (await showsCaptcha(page))) return { kind: "captcha" };
    return { kind: "none" };
  }
}

/**
 * The sign-in form of a two-step sign-in's password step, read once the page has settled.
 */
export async function passwordStepForm(page: Page, label: string, shownUrl: string): Promise<DiscoveredForm> {
  let forms: DiscoveredForm[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      forms = (await import("../discover.js").then((m) => m.discoverPage(page))).forms;
      break;
    } catch {
      await page.waitForLoadState("load", { timeout: SUBMIT_WAIT_MS }).catch(() => undefined);
    }
  }
  const createsAccount = () =>
    new SignInError(
      `${label} could not sign in: after the email, the page offered to create a new account instead of asking for the password, and Run Hound never types the password into a sign-up form. Check the account's email (Settings → Test accounts).`,
    );
  const form = signInForm(forms);
  if (form) {
    if (await choosesPassword(page, form)) throw createsAccount();
    return form;
  }
  const creates = forms.filter((f) => {
    const passwords = f.fields.filter(isPassword);
    const words = formWords(f);
    return (
      passwords.length > 0 &&
      (passwords.every((p) => /new-password/i.test(p.autocomplete ?? "")) ||
        ((SIGN_UP_WORDS.test(words) || asksForName(f)) && !SIGN_IN_WORDS.test(words)))
    );
  });
  const selectors = creates.map((f) => f.fields.filter(isPassword).map((p) => p.selector));
  const fresh = (await page.evaluate(`(${NEW_ELEMENTS})(${JSON.stringify(selectors.flat())})`).catch(() => [])) as boolean[];
  let at = 0;
  const offered = selectors.some((list) => {
    const any = list.some((_, i) => fresh[at + i] === true);
    at += list.length;
    return any;
  });
  if (offered) throw createsAccount();
  throw new SignInError(`${label} could not sign in: after the email, ${shownUrl} showed a password field, but not in a sign-in form.`);
}