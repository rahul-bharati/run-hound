/**
 * Signing in as a test account (0.4.0, docs/v2-spec.md "Signing in"). Deterministic: find the sign-in form, fill the
 * identifier and the password, submit, and decide from the page whether it worked. No evidence is captured and the
 * session never touches the disk.
 *
 * 0.6.0 ("Sign-in: two-step and sessionStorage"): a sign-in page without a password form but with a sign-in form that
 * asks for the identifier first gets the identifier, its "Continue", and then, once a password field shows on the
 * sign-in origin, the one-step sign-in. After signing in, the sessionStorage of the sign-in origin and of the landing
 * origin is returned with the session (SignedIn.sessionStorage), its token-like values in `secrets`, when the session
 * lives there (round 1 of the release review: the app sent one of its values as a credential, or the session is
 * nowhere else; round 2: a cookie the submit set or changed is a cookie session whatever its name, and a CSRF or
 * analytics cookie never is: sessionInStorage).
 *
 * Round 2 of the release review also: a password form beside a first step that says sign in is used only when it says
 * so itself (signsInItself), and trial or name-asking forms are sign-up forms; a code step or a captcha challenge on the
 * page the password led to fails (showsCodeStep, showsCaptchaChallenge); and a session that holds the password is never
 * returned (passwordKeptIn).
 *
 * Round 3: any first step beside a password form that doesn't sign in by itself takes the sign-in (not only one whose
 * own words say sign in); a name field is a sign-up signal only beside another identifier field; a code step needs a
 * sign-in code word (SIGN_IN_CODE_WORDS) and is also read at the sign-in address once the password field is gone; a
 * captcha widget alone is a challenge only in a form that moves on or under a heading that says so.
 *
 * Close-out: a code step named only by the page's heading or title needs a field that looks like a code's itself
 * (showsCodeStep); an HttpOnly cookie of the app's own site is a cookie session whatever its name, also when it was
 * set before the password and the submit kept it, and a load balancer's or bot manager's cookie never is
 * (sessionInStorage, NOT_SESSION_COOKIE).
 *
 * Close-out review, round 1: Cloudflare's __cflb and ASP.NET's antiforgery cookies are never the session
 * (NOT_SESSION_COOKIE); a code step's field is read through camel case and aria-labelledby, type=number or a digits-only
 * pattern looks like a code's, and a field that can't hold a code (type=email, or own words that say email, phone,
 * mobile, name or API) is never one (showsCodeStep).
 *
 * Close-out review, round 2: own words that say email, phone or mobile beside verify or verification, or on a numeric
 * field, can hold a code unless they say name, send, resend, address or number; a numeric field with no code word and
 * no code size needs a heading or title that names a code step outright, and a code word only a camel-case split finds
 * needs a field that looks like a code's (showsCodeStep). Heroku's session-affinity cookie and AWS WAF's token are never
 * the session (NOT_SESSION_COOKIE).
 */
import { domainToUnicode } from "node:url";
import type { Browser, BrowserContext, ElementHandle, Page, Request, Route } from "playwright";
import { DEFAULT_LABELS } from "../config/accounts.js";
import type { TestAccount } from "../interfaces/accounts.js";
import { originOf } from "../core/saves.js";
import type { DiscoveredForm, FormControl, FormField } from "../core/types.js";
import { BROWSER_LOCALE, isCredentialHeader } from "./context.js";
import { discoverPage } from "./discover.js";
import { cleanErrorMessage, explainNavigationError, TargetNotAllowedError } from "./errors.js";
import { guardContext, guardSummary, type NavigationGuard } from "./guard.js";
import { ISOLATED_CONTEXT } from "./isolation.js";
import { redactSecrets, registerSecretLiterals } from "./redact.js";
import { checkTarget, type SafetyOptions } from "./safety.js";

/** A browser session as Playwright's storageState(): cookies plus localStorage per origin. In memory only. */
export type SessionState = Awaited<ReturnType<import("playwright").BrowserContext["storageState"]>>;

export interface SignedIn {
  state: SessionState;
  /** Where the browser landed after submitting (redacted). */
  landedOn: string;
  /**
   * Values that identify this session (cookie values, bearer tokens found in localStorage) for redaction: the
   * runner registers them as literal secrets together with the password.
   */
  secrets: string[];
  /**
   * sessionStorage items the app kept after signing in (0.6.0, docs/v2-spec.md "Sign-in: two-step and
   * sessionStorage"), per origin: the sign-in origin and the landing origin. Every new browser context for this identity
   * seeds them before any page script runs. Absent when the app keeps nothing there, and (0.6.0 review, round 1) when
   * the session doesn't live there (sessionInStorage: a cookie or localStorage session whose app keeps a query cache or
   * an id in sessionStorage, which must not be copied into every context). Token-like values are also in `secrets`.
   */
  sessionStorage?: { origin: string; items: { name: string; value: string }[] }[];
}

/** Sign-in failed; the message is one or two plain sentences for the CLI, the API and the UI. Never holds the password. */
export class SignInError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignInError";
  }
}

/** How long the sign-in page gets to load, and to go quiet on the network afterwards (spec step 1). */
const LOAD_TIMEOUT_MS = 30_000;
const NETWORK_IDLE_MS = 5_000;
/** How long the page gets to react to the submit: a new URL, or the password field going away (spec step 5). */
const SUBMIT_WAIT_MS = 15_000;
/** Once an error message appears, how long the page still gets to move on (some show "Signing in…" as an alert). */
const ALERT_GRACE_MS = 1_000;
/**
 * How long an outcome must hold before the wait ends: the page off the sign-in page, or the password field gone. A
 * form that hides for a moment while the app checks the session, or comes back, is not an outcome yet.
 */
const SETTLED_MS = 750;
const POLL_MS = 150;
/** Filling a field or clicking the submit control. */
const ACTION_TIMEOUT_MS = 10_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The account's name in messages: its label, else "Account A" / "Account B". */
export function accountLabel(account: Pick<TestAccount, "id" | "label">): string {
  return account.label?.trim() || DEFAULT_LABELS[account.id] || "The test account";
}

/** "a", "a and b", "a, b and c". */
function listWords(words: string[]): string {
  return words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** Why the slot can't be used yet, or null when it has a sign-in page, a username and a password. */
function notSetUp(account: TestAccount, label: string): string | null {
  const missing: string[] = [];
  if (!account.loginUrl?.trim()) missing.push("sign-in page URL");
  if (!account.username?.trim()) missing.push("username");
  if (!account.password) missing.push("password");
  if (missing.length === 0) return null;
  const where = `Settings → Test accounts, or run-hound accounts set ${account.id}`;
  if (missing.length === 3) return `${label} isn't set up yet. Add its sign-in page URL, username and password (${where}).`;
  return `${label} isn't set up completely: it has no ${listWords(missing)}. Add ${missing.length === 1 ? "it" : "them"} (${where}).`;
}

const isPassword = (f: FormField) => f.type === "password";

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

/** Whether `f` asks for the person's own name (PERSON_NAME, or autocomplete=name/given-name/family-name). */
const isNameField = (f: FormField) =>
  isTextLike(f) &&
  (/^(name|given-name|family-name|additional-name)$/i.test((f.autocomplete ?? "").trim()) ||
    [f.key, f.label, f.placeholder, f.accessibleName].some((w) => !!w && PERSON_NAME.test(w.replace(/[*:]/g, "").trim())));

/**
 * Whether `form` asks for the person's own name beside an identifier (0.6.0 review, round 2; round 3): a field for the
 * name (isNameField) and another field the identifier would go in (identifierField of the form without its name
 * fields). A sign-in form whose only text field is labelled "Name" (an admin panel's Name, Password, "Submit") asks
 * for the username there: it isn't a sign-up form.
 */
function asksForName(form: DiscoveredForm): boolean {
  if (!form.fields.some(isNameField)) return false;
  return identifierField({ ...form, fields: form.fields.filter((f) => !isNameField(f)) }) !== null;
}

/** Whether a password form has autocomplete=current-password on one of its password fields. */
const hasCurrentPassword = (form: DiscoveredForm) => form.fields.some((f) => isPassword(f) && /current-password/i.test(f.autocomplete ?? ""));

/** The form's name and its submit control's name: what the form says it does. */
function formWords(form: DiscoveredForm): string {
  const submit = form.controls.find((c) => c.isSubmit);
  return `${form.name ?? ""} ${submit?.accessibleName ?? ""} ${submit?.text ?? ""}`;
}

/**
 * The sign-in form (spec step 2): of the forms with a password field, never one that creates an account (it says
 * sign up / create account / register / start a free trial, every password field is a new-password, or (0.6.0 review,
 * round 2) it asks for the person's name without autocomplete=current-password), then the best by: a password with
 * autocomplete=current-password, sign-in words in its name or submit control, exactly one password field. The first
 * wins a tie. A sign-up form placed before the sign-in form must never receive the account's credentials.
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
function signUpReason(form: DiscoveredForm): string | null {
  const passwords = form.fields.filter(isPassword);
  if (passwords.length > 0 && passwords.every((f) => /new-password/i.test(f.autocomplete ?? ""))) return "its password fields are for a new password";
  const words = formWords(form);
  if (SIGN_IN_WORDS.test(words)) return null;
  const signUp = SIGN_UP_WORDS.exec(words);
  if (signUp) return `it says "${signUp[0].replace(/\s+/g, " ")}"`;
  return asksForName(form) && !hasCurrentPassword(form) ? "it asks for a name beside the email or username" : null;
}

/** A two-step sign-in's first step (0.6.0): the form, the field the identifier goes in, and the control that moves on. */
export interface FirstStep {
  form: DiscoveredForm;
  field: FormField;
  control: FormControl;
}

/** Words of a password field that asks to choose one (a sign-up), not for the account's password. */
const CHOOSE_PASSWORD = /\b(create|choose|new|confirm|repeat)\b/i;

/** A control that moves a first step on without saying what it does: "Continue", "Next". */
const NEXT_CONTROL = /^(continue|next|proceed)(\s*[→›>»])?$/i;
/** A control that signs in through another provider ("Continue with Google", "Use a passkey", "Sign in with SSO"). */
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

/** What makes `form` (moved on by `control`) a passwordless sign-in (SENDS_CONTROL, SENDS_NAME): its words, or null. */
function sendsInstead(form: DiscoveredForm, control: FormControl): string | null {
  const words = controlWords(control);
  if (SENDS_CONTROL.test(words)) return words;
  return form.name && SENDS_NAME.test(form.name) ? form.name.replace(/\s+/g, " ").trim() : null;
}

/**
 * The words of a passwordless sign-in form among `forms` (an identifier field, and a control or a name that says it
 * sends a link or a code: sendsInstead), for the message when the page has no sign-in form; null when there is none.
 */
function passwordlessWords(forms: DiscoveredForm[]): string | null {
  for (const form of forms) {
    if (form.search || form.fields.some(isPassword) || !identifierField(form)) continue;
    const control = nextControl(form);
    const words = control ? sendsInstead(form, control) : null;
    if (words) return words;
  }
  return null;
}

/** The control that moves a first step on: the form's submit control, else a "Continue"/"Next" button; never a provider's. */
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

/** The page's visible text just before `selector` (its previous siblings, up to 3 levels up), without other forms. */
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
 * similar form by its own words (its name and that control), and that says sign in: in its own words, else in the
 * page's title, the text just before it, or the sign-in page's address. Best by sign-in words of its own, then an
 * identifier field with autocomplete=username or email; the first wins a tie. Never a form whose own words name another
 * provider ("Sign in with SSO", "Use a passkey"), nor one that sends a link or a code instead ("Send magic link",
 * "Sign in with a one-time code": sendsInstead), even when they say sign in.
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
    // "Sign in with SSO" says sign in too, but the identifier would go to another provider's discovery.
    if (PROVIDER_CONTROL.test(own)) continue;
    // "Send magic link" says sign in too (a form named "Sign in"), but its submit has the app e-mail the account.
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
 * sign-in words in its submit control, or in its name when that name isn't the first step's too (a heading both forms
 * sit under names them both).
 */
function signsInItself(form: DiscoveredForm, first: FirstStep): boolean {
  if (hasCurrentPassword(form)) return true;
  const submit = form.controls.find((c) => c.isSubmit);
  if (submit && SIGN_IN_WORDS.test(controlWords(submit))) return true;
  const name = (form.name ?? "").replace(/\s+/g, " ").trim();
  return name !== "" && name !== (first.form.name ?? "").replace(/\s+/g, " ").trim() && SIGN_IN_WORDS.test(name);
}

/** Names of cookies and storage keys that usually hold a session. */
const SESSION_NAME = /sess|sid|auth|token|jwt|remember|login|identity|credential|secret|key|bearer/i;
const JWT = /^eyJ[\w-]+\.eyJ[\w-]+\.[\w-]*$/;
/** A value made only of token characters, 24 or more (no spaces, no ":" of an address); sessionSecrets adds a digit and a letter. */
const OPAQUE_TOKEN = /^[A-Za-z0-9._~+/=-]{24,}$/;

/** A value random enough to be a session id or token, not a setting such as "dark" or "en-US". */
function looksLikeToken(value: string): boolean {
  if (value.length < 8 || /\s/.test(value)) return false;
  return value.length >= 24 || (/\d/.test(value) && /[A-Za-z]/.test(value));
}

/** One IndexedDB database as storageState({ indexedDB: true }) returns it (only what sessionSecrets reads). */
interface IndexedDbState {
  stores?: { name?: string; records?: { key?: unknown; value?: unknown }[] }[];
}

/** How sessionSecrets reads sessionStorage (0.6.0 review, round 1). */
export interface SessionStorageReading {
  /**
   * Whether the session lives in sessionStorage (default true): then a random-looking value counts whatever its key.
   * false (a cookie or localStorage session whose app keeps other things there: a query cache, the current
   * workspace's id) reads it by localStorage's rules only.
   */
  sessionStorageSession?: boolean;
  /**
   * Values the app's own requests carried as a path segment or a query value, and never in a credential header: ids
   * (a workspace's UUID), not secrets. A random-looking value among them doesn't count for being random-looking alone;
   * under a session-like key, or as a JWT, it still does.
   */
  addressValues?: ReadonlySet<string>;
}

/**
 * The values of `state` that identify the session, for redaction: cookie values that look like session ids or tokens,
 * and the tokens an app keeps in localStorage, IndexedDB or (0.6.0) sessionStorage: a plain value under a token-like
 * key, a JWT, or the token fields of a JSON value such as Supabase's "sb-…-auth-token", Firebase's auth user or
 * oidc-client-ts's "oidc.user:…" entry. sessionStorage is read as `reading` says.
 */
export function sessionSecrets(state: SessionState, sessionStorage: SignedIn["sessionStorage"] = [], reading: SessionStorageReading = {}): string[] {
  const addressValues = reading.addressValues ?? new Set<string>();
  const out = new Set<string>();
  const add = (value: string) => {
    out.add(value);
    try {
      const decoded = decodeURIComponent(value);
      if (decoded !== value && looksLikeToken(decoded)) out.add(decoded);
    } catch {
      // Not URL-encoded.
    }
  };
  for (const cookie of state.cookies) {
    if (looksLikeToken(cookie.value) && (SESSION_NAME.test(cookie.name) || cookie.value.length >= 16)) add(cookie.value);
  }
  const walk = (value: unknown, key: string, depth: number) => {
    if (depth > 6) return;
    if (typeof value === "string") {
      if (JWT.test(value) || (SESSION_NAME.test(key) && looksLikeToken(value))) add(value);
      return;
    }
    if (Array.isArray(value)) value.forEach((v) => walk(v, key, depth + 1));
    else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walk(v, k, depth + 1);
  };
  /** A random-looking token: long, of token characters only, with a digit and a letter (never a word or a date). */
  const opaqueToken = (v: string) => OPAQUE_TOKEN.test(v) && /\d/.test(v) && /[A-Za-z]/.test(v);
  /** Every string of a parsed JSON value that looks like a random token (opaqueToken), whatever its key. */
  const walkOpaque = (value: unknown, depth: number) => {
    if (depth > 6) return;
    if (typeof value === "string") {
      if (opaqueToken(value) && !addressValues.has(value)) add(value);
    } else if (Array.isArray(value)) value.forEach((v) => walkOpaque(v, depth + 1));
    else if (value && typeof value === "object") for (const v of Object.values(value)) walkOpaque(v, depth + 1);
  };
  /**
   * A Web Storage item (localStorage, sessionStorage): its value, or the fields of the JSON it holds. For sessionStorage
   * (`opaque`), a value that looks like a random token counts whatever its key: the whole value ("fw" = "3f9a…"), and
   * every string in the JSON it holds, under a key that says nothing about it too ({id: "3f9a…"}, a storage wrapper's
   * {value: "3f9a…", expires}). The contract registers sessionStorage's token-like values, and they are seeded into every
   * context of the identity.
   */
  const walkItem = (opaque: boolean) => ({ name, value }: { name: string; value: string }) => {
    let parsed: unknown = undefined;
    if (/^\s*[[{"]/.test(value)) {
      try {
        parsed = JSON.parse(value);
      } catch {
        parsed = undefined;
      }
    }
    const whole = parsed === undefined ? value : parsed;
    if (opaque) walkOpaque(whole, 0);
    walk(whole, name, 0);
  };
  for (const origin of state.origins) {
    // IndexedDB (storageState({ indexedDB: true })): Firebase Auth keeps its tokens there.
    for (const db of (origin as { indexedDB?: IndexedDbState[] }).indexedDB ?? []) {
      for (const store of db.stores ?? []) {
        for (const record of store.records ?? []) {
          walk(record.value, store.name ?? "", 0);
          walk(record.key, store.name ?? "", 0);
        }
      }
    }
    origin.localStorage.forEach(walkItem(false));
  }
  for (const entry of sessionStorage) entry.items.forEach(walkItem(reading.sessionStorageSession !== false));
  return [...out];
}

/** A Web Storage value's strings: the whole value, and every string of the JSON it holds. */
function storedStrings(value: string): string[] {
  const out = [value];
  if (/^\s*[[{"]/.test(value)) {
    try {
      JSON.parse(value, (_key, v: unknown) => {
        if (typeof v === "string") out.push(v);
        return v;
      });
    } catch {
      // Not JSON.
    }
  }
  return out;
}

/**
 * Whether a request header names a credential (0.6.0 review, round 1): Authorization, an API key, an x-…-token or a
 * header whose name says session, auth, token or key. Never a cookie (the storage state has those), and never a CSRF
 * header: a cookie-session app may keep its CSRF token in sessionStorage without its session living there.
 */
function isCredentialName(name: string): boolean {
  if (/^(cookie|referer)$/i.test(name) || /csrf|xsrf/i.test(name) || BROWSER_HEADERS.test(name)) return false;
  return isCredentialHeader(name) || SESSION_NAME.test(name);
}

/**
 * Cookies that never hold the session (0.6.0 review, round 2): a CSRF token (XSRF-TOKEN, csrftoken, _csrf), and the
 * analytics, advertising and bot-check cookies a sign-in may set too (_ga, _gid, _fbp, ajs_*, _hj*, __stripe_*,
 * __cf_bm, cf_clearance …). The close-out adds the HttpOnly cookies a load balancer or a bot manager in front of the app
 * sets (Azure's ARRAffinity, AWS's AWSALB, Google's GCLB, Akamai's ak_bmsc and _abck, Imperva's visid_incap_ and
 * incap_ses_, F5's BIGipServer and TS01…, Citrix's NSC_, DataDome, PerimeterX's _px…, ingress-nginx's INGRESSCOOKIE).
 * The close-out review (round 1) adds Cloudflare's load balancer and waiting room cookies (__cflb, __cfwaitingroom) and
 * ASP.NET's antiforgery cookies (ASP.NET Core's ".AspNetCore.Antiforgery.<id>", HttpOnly by default, and ASP.NET MVC's
 * "__RequestVerificationToken[_<app path>]", whose name says token). Round 2 of that review adds Heroku's router cookie
 * (heroku-session-affinity, HttpOnly, a name that says session) and AWS WAF's challenge token (aws-waf-token, not
 * HttpOnly, a name that says token).
 */
const NOT_SESSION_COOKIE =
  /csrf|xsrf|antiforgery|^__RequestVerificationToken|^__cflb$|^__cfwaitingroom$|^heroku-session-affinity$|^aws-waf-token$|^_ga($|_)|^_gid$|^_gat|^_gcl_|^_fb[pc]$|^ajs_|^_hj|^__stripe_|^__cf_bm$|^cf_clearance$|^_cfuvid$|^__cfruid$|^mp_|^amp_|^_clck$|^_clsk$|^intercom-|^__hs|^hubspotutk$|^_uet[sv]id$|^_pk_|^_dd_s$|^ARRAffinity|^AWSALB|^AWSELB$|^GCI?LB$|^ak_bmsc$|^bm_(sv|sz|mi|so|s)$|^_abck$|^visid_incap_|^incap_ses_|^nlbi_|^BIGipServer|^TS01[0-9a-f]*$|^NSC_|^datadome$|^_px|^INGRESSCOOKIE$|^ROUTEID$/i;

/** A browser context's cookies, as context.cookies() returns them. */
type CookieJar = SessionState["cookies"];

const cookieKey = (c: { name: string; domain: string; path: string }) => `${c.domain} ${c.path} ${c.name}`;

/**
 * Whether the submit set or changed a cookie that can hold a session (0.6.0 review, round 2): a cookie of `after` whose
 * value is token-like (looksLikeToken) and differs from the one `before` had (or that `before` didn't have), whatever
 * its name (".AspNetCore.Cookies", "app_user", an iron-session name), except a CSRF, analytics or bot-check cookie
 * (NOT_SESSION_COOKIE).
 */
function sessionCookieSet(before: CookieJar, after: CookieJar): boolean {
  const was = new Map(before.map((c) => [cookieKey(c), c.value]));
  return after.some((c) => !NOT_SESSION_COOKIE.test(c.name) && looksLikeToken(c.value) && was.get(cookieKey(c)) !== c.value);
}

/**
 * A host name's site, near enough to tell the app's own cookies from another site's without a public-suffix list: its
 * last two labels ("app.example.com" and "api.example.com" give "example.com"); an IP address, or a name of one label
 * (localhost), as it is. A leading dot (a cookie's Domain) and IPv6 brackets are dropped.
 */
function siteOf(host: string): string {
  const h = host.toLowerCase().replace(/^\./, "").replace(/^\[|\]$/g, "");
  if (/^[\d.]+$/.test(h) || h.includes(":") || !h.includes(".")) return h;
  return h.split(".").slice(-2).join(".");
}

/**
 * Whether the session lives in the sessionStorage signIn read (0.6.0 review, rounds 1 and 2; the close-out): the app
 * sent one of its values (a token-like whole value, or a token-like string of the JSON it holds) in a credential header
 * after the password was typed (`credentials`: those headers' values). Else, not when the session is in a cookie: the
 * submit set or changed one, whatever its name (sessionCookieSet: `cookiesBefore` is the jar before the password was
 * typed); a session-named cookie (SESSION_NAME) holds a token-like value (a PHPSESSID set with the sign-in page and
 * kept by the submit); or (the close-out) an HttpOnly cookie of the app's own site (siteOf one of `hosts`: the sign-in
 * page's and the landing page's host names) holds one, whatever its name (express-session under a custom name, set with
 * the sign-in page and kept by the submit): no page script can set or read an HttpOnly cookie, so it is the server's
 * state. A CSRF, analytics, bot-check, load balancer or bot manager cookie (NOT_SESSION_COOKIE) is never the session,
 * and neither is another site's HttpOnly cookie (a reCAPTCHA frame's _GRECAPTCHA). Not when localStorage or IndexedDB
 * holds a token either. Otherwise it can live nowhere else: yes.
 *
 * Otherwise (a cookie or localStorage session) what the app keeps in sessionStorage is its own business: a query
 * cache, the signed-in user, the current workspace's id. Seeding it into every context would load pages from that copy
 * instead of the app's data reads, which the access checks replay.
 */
export function sessionInStorage(
  state: SessionState,
  kept: NonNullable<SignedIn["sessionStorage"]>,
  credentials: ReadonlySet<string>,
  cookiesBefore: CookieJar,
  hosts: readonly string[],
): boolean {
  if (kept.length === 0) return false;
  const sent = [...credentials];
  for (const entry of kept) {
    for (const item of entry.items) {
      if (storedStrings(item.value).some((v) => looksLikeToken(v) && sent.some((header) => header.includes(v)))) return true;
    }
  }
  if (sessionCookieSet(cookiesBefore, state.cookies)) return false;
  const sites = new Set(hosts.map(siteOf));
  const cookieSession = state.cookies.some(
    (c) => !NOT_SESSION_COOKIE.test(c.name) && looksLikeToken(c.value) && (SESSION_NAME.test(c.name) || (c.httpOnly && sites.has(siteOf(c.domain)))),
  );
  if (cookieSession) return false;
  return sessionSecrets({ ...state, cookies: [] }).length === 0;
}

/**
 * The token-like values the app's own requests (`urls`, to the origins in `origins`) carried as a path segment or as a
 * query value under a key that doesn't say session, token or key, except those also sent in a credential header: ids
 * such as a workspace's UUID, which sessionSecrets leaves out (SessionStorageReading.addressValues).
 */
function idsInAddresses(urls: readonly string[], origins: ReadonlySet<string>, credentials: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const raw of urls) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    if (!origins.has(url.origin)) continue;
    for (const segment of url.pathname.split("/")) {
      const value = safeDecode(segment);
      if (looksLikeToken(value)) out.add(value);
    }
    for (const [key, value] of url.searchParams) if (!SESSION_NAME.test(key) && looksLikeToken(value)) out.add(value);
  }
  const sent = [...credentials];
  for (const value of [...out]) if (sent.some((header) => header.includes(value))) out.delete(value);
  return out;
}

/** Texts of visible error messages: role=alert, assertive live regions, error toasts, and error text around the form. */
async function errorTexts(page: Page, formSelector: string): Promise<string[]> {
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

/** A visible field asking for a one-time code (multi-factor sign-in). `onSignInPage` also allows name-based matches. */
async function showsCodeField(page: Page, onSignInPage: boolean): Promise<boolean> {
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
async function showsCaptcha(page: Page): Promise<boolean> {
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
 * Runs in the page: its fields to fill in, shown (a box, not visibility:hidden), enabled, not a search box (type=search,
 * or inside role=search), not a checkbox, radio, file or button input. Declares no named function (see typePassword).
 */
const ENTRY_FIELDS = String.raw`(() => {
  const shown = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  return Array.from(document.querySelectorAll("input, textarea, select")).filter((el) =>
    !el.matches("input[type=hidden], input[type=submit], input[type=button], input[type=reset], input[type=image], input[type=checkbox], input[type=radio], input[type=file], input[type=search], input[type=range], input[type=color]") &&
    !el.closest("[role=search]") && !el.disabled && shown(el));
})`;

/**
 * Words that name a sign-in's code (0.6.0 review, round 3), for showsCodeStep: one-time, OTP, passcode, verification
 * or verify, two-factor, two-step (or 2-step, 2-factor), multi-factor, 2FA, MFA, TOTP, authenticator, a security,
 * sign-in, login or confirmation code, or an "n-digit code". A bare "code" doesn't say which code it is ("Code", "Room
 * code", a code explainer's textarea).
 */
const SIGN_IN_CODE_WORDS = String.raw`/\b(otp|one ?time|passcode|verification|verify|2fa|mfa|totp|(two|2) ?(factor|step)|multi ?factor|authenticator|(security|sign ?in|log ?in|login|confirmation) code|\d ?digit code)\b/i`;

/**
 * Headings or titles that name a code step outright (close-out review, round 2), for showsCodeStep: the sign-in code
 * words (SIGN_IN_CODE_WORDS) without a bare verify or verification, which also asks to confirm an email address ("Please
 * verify your email address"), but with a verification code.
 */
const CODE_STEP_HEADING = String.raw`/\b(otp|one ?time|passcode|2fa|mfa|totp|(two|2) ?(factor|step)|multi ?factor|authenticator|(verification|security|sign ?in|log ?in|login|confirmation) code|\d ?digit code)\b/i`;

/**
 * A field's `pattern` that allows digits only (close-out review, round 1), for showsCodeStep: "[0-9]*", "\d+",
 * "[0-9]{6}", "\d{4,8}" (anchored or not): the numeric keyboard a code field asks for, as inputmode=numeric does.
 */
const DIGITS_ONLY_PATTERN = String.raw`/^\^?(\[0-9\]|\\d)([*+]|\{\d+(,\d*)?\})\$?$/`;

/**
 * A field's `pattern` that allows 4 to 8 digits and nothing else (close-out review, round 2), for showsCodeStep:
 * "[0-9]{6}", "\d{6}", "\d{4,8}" (anchored or not): a code's size, as a maxlength of 4 to 8 is.
 */
const CODE_SIZED_PATTERN = String.raw`/^\^?(\[0-9\]|\\d)\{[4-8](,[4-8])?\}\$?$/`;

/**
 * Whether the page after the password (0.6.0 review, round 2; round 3; the close-out) is a code step without
 * autocomplete=one-time-code: its only field to fill in (ENTRY_FIELDS), an input and never a textarea or a list, or a
 * code split over 4 to 8 one-character input boxes, and a sign-in code word (SIGN_IN_CODE_WORDS) in the fields' name,
 * id, placeholder, aria-label, autocomplete or label, or in the page's headings or title ("Code" under "Two-step
 * verification"); never with promo, coupon, gift, referral, invite, zip, postal or another code that isn't a sign-in's
 * in the fields' own words (a landing page's promo-code field, a "Code" textarea or a "Room code" field is still a
 * success). When only the headings or the title say it (the close-out), the field must look like a code's itself: its
 * own words say code, OTP, PIN, token or digit, or it is code-sized (a maxlength of 4 to 8, a pattern of 4 to 8 digits:
 * CODE_SIZED_PATTERN; split boxes always are). A heading that asks to verify the email over a "New task" field, a page
 * titled "Identity verification" whose field finds a customer, or a two-factor set-up page's phone number field is
 * still a success. Asked off the sign-in page's address, and at that address once the password field is gone (a
 * single-page app that swaps in its code step).
 *
 * Close-out review, round 1: a field's own words are read word by word through camel case ("verificationCode",
 * "otpCode"), and the text of the elements its aria-labelledby names is its label too. A field that can't hold a
 * sign-in code is never one, whatever the page or its own words say: type=email, API in its own words (with the other
 * codes above), or own words that say email, phone, mobile or name and no code word (code, OTP, PIN, passcode, token,
 * digit, one-time, 2FA, MFA, TOTP, authenticator): an unconfirmed account's "Send the verification email to" field, a
 * "Paste your API token" field or a maxlength=8 "Team short name" under "Please verify your email address" is a
 * success, and "Enter the verification code we sent to your email" is still a code step.
 *
 * Close-out review, round 2: own words that say email, phone or mobile hold a code when they also say verify or
 * verification ("Mobile verification", "Phone verification", "Email verification"), or when the field is numeric
 * (type=number, inputmode=numeric or decimal, a digits-only pattern: DIGITS_ONLY_PATTERN), unless they say name, send,
 * resend, address or number: an address field ("Send the verification email to", "Verify your mobile number"). A
 * numeric field with no code word and no code size is a code's only under a heading or title that names a code step
 * outright (CODE_STEP_HEADING): an unconfirmed account's type=number "Hours worked today" field under "Please verify
 * your email address" is a success. A sign-in code word that only the camel-case reading finds in a name or id
 * ("verificationSearch") counts only in a field that looks like a code's (its own words say code, OTP, PIN, token or
 * digit, it is code-sized, or numeric).
 */
async function showsCodeStep(page: Page): Promise<boolean> {
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
 * Whether the page the password led to (0.6.0 review, round 2; round 3) is a captcha challenge and nothing else: a
 * captcha widget shows (reCAPTCHA, hCaptcha, Turnstile: a box, never the reCAPTCHA v3 badge, an invisible one, or a
 * control one is bound to) or a field says captcha, and the page has no other field to fill in (ENTRY_FIELDS). A
 * widget alone (no captcha field) counts only when it sits in a form whose submit control moves on (Continue, Verify,
 * Submit, Next, Sign in …), or when the page's headings or title say it is a check (verify you are human, security
 * check, "Just a moment…"): a signed-in page with a widget outside any form and nothing to fill in is a success, and so
 * is a landing page with a captcha in a form next to other fields (a feedback form).
 */
async function showsCaptchaChallenge(page: Page): Promise<boolean> {
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
async function offersProviders(page: Page): Promise<boolean> {
  const text = String(await page.evaluate("document.body ? document.body.innerText.slice(0, 4000) : ''").catch(() => ""));
  return /(continue|sign\s?-?in|log\s?-?in)\s+with\s+(google|github|microsoft|apple|facebook|gitlab|twitter|linkedin|slack|discord|sso)\b/i.test(text);
}

/**
 * True when a value of the URL's query (or its hash), or its user name or password (`http://user:<password>@host`), is
 * exactly `secret`: a password sent in the page address.
 */
function carriesInQuery(url: URL, secret: string): boolean {
  if (!secret) return false;
  for (const value of url.searchParams.values()) if (value === secret) return true;
  if (url.hash.length > 1) {
    for (const value of new URLSearchParams(url.hash.slice(1)).values()) if (value === secret) return true;
  }
  return [url.username, url.password].some((part) => part !== "" && safeDecode(part) === secret);
}

/** A query key that names a password (compared lower-case, letters and digits only): password, user[password], pwd, pin … */
const PASSWORD_KEY = /(password|passwd|passcode|passphrase|pwd|secret)$|^(pass|pw|pin)$/;

/**
 * True when a value of the URL's query (or its hash) under a key that names a password (PASSWORD_KEY) is exactly
 * `secret`: how a script's request (not a navigation) carries a weak password in its address. A weak password under any
 * other key ("?user=demo") is one of the app's own words, not a leak.
 */
function carriesUnderPasswordKey(url: URL, secret: string): boolean {
  if (!secret) return false;
  const params = [url.searchParams, ...(url.hash.length > 1 ? [new URLSearchParams(url.hash.slice(1))] : [])];
  return params.some((p) => [...p.entries()].some(([key, value]) => value === secret && PASSWORD_KEY.test(key.toLowerCase().replace(/[^a-z0-9]/g, ""))));
}

/** decodeURIComponent, or `text` as it is when it isn't well-formed. */
function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * The forms a password takes in a request besides the raw text: percent-encoded (encodeURIComponent, and a form's "+"
 * for a space), JSON-escaped, and base64 (standard and URL-safe) at each of the three byte alignments, only the
 * characters that come from the password alone and only when that is at least 8 characters.
 */
function encodedForms(password: string): string[] {
  const forms = new Set([
    encodeURIComponent(password),
    new URLSearchParams({ p: password }).toString().slice(2),
    JSON.stringify(password).slice(1, -1),
  ]);
  const bytes = Buffer.from(password, "utf8");
  for (const skip of [0, 1, 2]) {
    const encoded = Buffer.concat([Buffer.alloc(skip), bytes]).toString("base64");
    const needle = encoded.slice([0, 2, 3][skip], Math.floor((skip + bytes.length) / 3) * 4);
    if (needle.length >= 8) forms.add(needle).add(needle.replace(/\+/g, "-").replace(/\//g, "_"));
  }
  forms.delete(password);
  forms.delete("");
  return [...forms];
}

/** `text` with its runs of percent escapes decoded and "+" read as a space (a form body); a malformed run stays as it is. */
function percentDecoded(text: string): string {
  return text.replace(/\+/g, " ").replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run;
    }
  });
}

/**
 * Headers the browser sets itself: none of them carries what a page typed. The Referer is not among them: a page can put
 * the password in its own address without a request (history.replaceState), and the Referer then carries it.
 */
const BROWSER_HEADERS = /^(?:user-agent|accept(?:-.*)?|sec-.*|origin|host|connection|content-(?:type|length)|upgrade-insecure-requests|cache-control|pragma)$/i;

/**
 * A weak password: shorter than 8 characters and only word characters ("demo", "test"). It can be part of an app's own
 * words and addresses, so it is only matched where it stands on its own (includesNeedle), and a same-origin script's
 * request whose address holds it under a key that doesn't name a password ("?user=demo") is not taken for a leak
 * (signInReady, carriesUnderPasswordKey). Any other password is distinctive enough.
 */
function isWeak(password: string): boolean {
  return password.length < 8 && !/\W/.test(password);
}

/**
 * Whether `text` holds `needle`. A weak password (isWeak: "test", "demo") is only a match when it stands on its own — a
 * non-word character or the text's edge on each side — so it is not found inside a larger token ("latest", "testing")
 * on another origin and a weak password doesn't fail a legitimate sign-in (0.6.0 review). A form body, a query and a
 * JSON body all delimit a value they carry (`"test"`, `=test&`, `test`), so a real leak of even a weak password is still
 * caught. Any other password is distinctive enough to match as a plain substring.
 */
function includesNeedle(text: string, needle: string): boolean {
  if (!isWeak(needle)) return text.includes(needle);
  for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + 1)) {
    const before = i === 0 ? "" : text[i - 1]!;
    const after = i + needle.length >= text.length ? "" : text[i + needle.length]!;
    if (!/\w/.test(before) && !/\w/.test(after)) return true;
  }
  return false;
}

/**
 * Whether a text holds `password`: raw or in one of its encoded forms (encodedForms), in the text as it is or with its
 * percent escapes decoded (JSON inside a form field: `data=` + encodeURIComponent(JSON.stringify(…))).
 */
function passwordIn(password: string): (text: string) => boolean {
  const forms = encodedForms(password);
  return (text: string) => {
    if (!text) return false;
    const decoded = percentDecoded(text);
    return [text, decoded].some((t) => includesNeedle(t, password) || forms.some((f) => t.includes(f)));
  };
}

/**
 * Whether `url` carries the password: in its query or hash, in its path, or in its user name or password. A weak
 * password ("demo") counts in the path only as a whole segment: it is part of many an app's own paths
 * (/assets/demo-theme.css). Any other password counts anywhere in the path, raw or encoded (holds), so one with other
 * characters around it (/steal/<password>x, /log-<password>-end.gif) is found too (0.6.0 review, round 3).
 */
function urlCarries(url: URL, password: string, holds: (text: string) => boolean): boolean {
  if (queryCarries(url, holds)) return true;
  for (const segment of url.pathname.split("/")) if (segment && (safeDecode(segment) === password || percentDecoded(segment) === password)) return true;
  return !isWeak(password) && holds(url.pathname);
}

/**
 * Whether `url`'s query, hash, or user name and password carry the password (raw or encoded: holds), never its path:
 * what a request to the sign-in page's own origin is read for (0.6.0 review, round 1). A GET form puts the password in
 * the query; the path of an ordinary address holds the app's own words ("password" in /api/account/password-status).
 */
function queryCarries(url: URL, holds: (text: string) => boolean): boolean {
  if (holds(url.search) || holds(url.hash)) return true;
  return [url.username, url.password].some((part) => part !== "" && holds(part));
}

/**
 * Whether `url`'s host name carries a password that isn't weak (0.6.0 review, round 1): a page that puts it in a
 * subdomain (http://<password>.evil.example/) sends it to that site's DNS and server. A host name is lower-case (and an
 * international one punycode), so the password is looked for lower-cased, in the host name as the address has it and
 * as Unicode. A weak password ("demo") is part of many a host name (demo.example.com), so it isn't looked for there.
 */
function hostCarries(url: URL, password: string): boolean {
  if (isWeak(password) || !url.hostname) return false;
  const needle = password.toLowerCase();
  const host = url.hostname.toLowerCase();
  return [host, domainToUnicode(host).toLowerCase(), percentDecoded(host).toLowerCase()].some((h) => h.includes(needle));
}

/** Whether a message's text carries `password` (a JSON body's strings included). */
function textCarries(text: string, password: string, holds: (text: string) => boolean): boolean {
  if (holds(text)) return true;
  if (/^\s*[[{"]/.test(text)) {
    try {
      const strings: string[] = [];
      JSON.parse(text, (_key, value: unknown) => {
        if (typeof value === "string") strings.push(value);
        return value;
      });
      if (strings.some((s) => includesNeedle(s, password))) return true;
    } catch {
      // Not JSON.
    }
  }
  return false;
}

/** What a request sends, as a route or the DevTools protocol sees it (a WebSocket message as its body). */
export interface Sent {
  url: string;
  body: string;
  headers: Record<string, string>;
  /**
   * Whether this is a navigation (a page load, a form submit): only a navigation puts the password in the address the
   * way a GET form does (the URL bar, the history, the server's access log). A same-origin fetch or image whose query
   * happens to equal a weak password ("demo") is not a GET-form leak and must not fail the sign-in.
   */
  navigation: boolean;
}

function sentOf(request: Request): Sent {
  return {
    url: request.url(),
    body: request.postDataBuffer()?.toString("utf8") ?? "",
    headers: request.headers(),
    navigation: request.isNavigationRequest(),
  };
}

/** A paused request (Fetch.requestPaused) as `stops` reads it. */
function pausedSent(event: { request: { url: string; headers: Record<string, string>; postData?: string; postDataEntries?: { bytes?: string }[] }; resourceType: string }): Sent {
  const { request } = event;
  const body = request.postData ?? Buffer.concat((request.postDataEntries ?? []).map((entry) => Buffer.from(entry.bytes ?? "", "base64"))).toString("utf8");
  return { url: request.url, body, headers: request.headers, navigation: event.resourceType === "Document" };
}

/**
 * Checks every request `page`'s tab sends once more, after the context's routes, through a DevTools session of its
 * own, and fails the ones `stops` names. Playwright's routes never see a request that follows a redirect (a 307 re-sends
 * the POST body to wherever the answer points), nor one a document sends while it is being left (a beacon, a keepalive
 * fetch, fetchLater or an image from a pagehide handler): Playwright lets those go on its own. A second session's
 * interception still sees them. guardSignInBrowser checks them once more at the browser, for every tab.
 *
 * A dedicated worker the page starts (0.6.0 review, round 2: SIGN_IN_HARDENING's Worker override undone) is attached
 * to this session paused, and never let run: Chromium runs a new worker only once every session holding it lets it
 * go, and nothing else would see its WebSockets. It is reported with `refuse` ("a worker"). Only workers are attached:
 * a frame from another site would wait for this session too, and never load.
 */
export async function stopUnrouted(page: Page, stops: (sent: Sent) => boolean, refuse: (what: string) => void = () => undefined): Promise<void> {
  const session = await page.context().newCDPSession(page);
  session.on("Fetch.requestPaused", (event) => {
    let stop: boolean;
    try {
      stop = stops(pausedSent(event));
    } catch {
      stop = false;
    }
    const { requestId } = event;
    const answer = stop
      ? session.send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" })
      : session.send("Fetch.continueRequest", { requestId });
    answer.catch(() => undefined);
  });
  session.on("Target.attachedToTarget", ({ targetInfo }) => {
    if (targetInfo.type === "worker") refuse("a worker");
  });
  await session.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  await session.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true, filter: [{ type: "worker" }, { exclude: true }] });
}

/** What guardSignInBrowser needs from the sign-in. */
export interface BrowserGuardOptions {
  /** Whether a request (any tab's, frame's or worker's) must be stopped for the password's sake. */
  stops: (sent: Sent) => boolean;
  /** Told what was stopped from running: "a shared worker". */
  refuse: (what: string) => void;
  /**
   * Asked about each new tab of the sign-in context, before it runs: true lets it run, else it is closed. `opener`: the
   * tab was opened by a page (window.open, a link or form with a target), not by Playwright (storageState's own page).
   */
  admitTab?: (tab: { opener: boolean }) => boolean;
  /** Told when a new tab of the sign-in context is refused: every request of it fails, and it is being closed. */
  tabClosed?: () => void;
}

/** The response header whose rule sets could prefetch a link the page adds (see guardSignInBrowser). */
const SPECULATION_RULES_HEADER = /^speculation-rules$/i;

/**
 * A browser-level DevTools session for the time of a sign-in (0.6.0 review, round 2): the layer below the context's
 * routes and each tab's own interception (stopUnrouted), for what neither of them sees.
 *
 * - **Every request the browser sends** (every tab, frame and worker: Fetch at the browser target) is checked with
 *   `stops`, and the ones it names fail. That covers a new tab's redirect hops (Playwright reports a tab only once its
 *   first navigation has committed, after its redirects, so its own interception comes too late), a frame from another
 *   site, a worker's HTTP requests, and a request sent while a document is being left.
 * - **A Speculation-Rules response header is dropped** from every document: its document rules could prefetch a link
 *   the page adds with the password, and no interception sees a prefetch (SIGN_IN_HARDENING strips inline rules).
 * - **A new tab of the sign-in context is held before it runs** (auto-attached with waitForDebuggerOnStart) and closed,
 *   unless `admitTab` lets it run (Run Hound's own sessionStorage probe, and the page Playwright's storageState opens
 *   to read an origin no tab is on); every request of a tab being closed fails. A password sign-in never opens a tab.
 *   The tab is closed one round trip of this session after it is attached, not at once (0.6.0, the whole suite's
 *   load): Playwright holds a new tab too (waitForDebuggerOnStart), and lets it go with Runtime.runIfWaitingForDebugger
 *   in the setup it sends as soon as its Browser.getWindowForTarget returns (Playwright 1.63). A same-site popup shares
 *   the renderer of the page that opened it, and one closed before Playwright's release reached it could leave that
 *   renderer paused for good: the sign-in page stopped running, and signing in never returned. Playwright asks for the
 *   window as soon as it hears of the tab, before this session does, and the browser answers in order: this session's
 *   command comes back after Playwright's answer, so the close goes out after Playwright's release.
 * - **A shared worker of the sign-in context is closed** as soon as it is created, and reported with `refuse`. Nothing
 *   else sees its requests or WebSockets, and waitForDebuggerOnStart doesn't hold one (Playwright's own browser session
 *   detaches from it, and that lets it run).
 *
 * Other contexts' tabs and shared workers are let go at once. `stops` and the header drop apply to the whole browser:
 * Run Hound signs in before any other context of its browser does anything. Resolves to the function that ends it.
 */
export async function guardSignInBrowser(browser: Browser, page: Page, options: BrowserGuardOptions): Promise<() => Promise<void>> {
  const own = await page.context().newCDPSession(page);
  const { targetInfo: sign } = await own.send("Target.getTargetInfo");
  await own.detach().catch(() => undefined);
  const session = await browser.newBrowserCDPSession();
  /** Tabs and workers being closed: every request from one of them fails. */
  const refused = new Set<string>();
  /** Tabs whose close is on its way (see the attach handler): ending the guard waits for them. */
  const closing = new Set<Promise<unknown>>();
  session.on("Fetch.requestPaused", (event) => {
    const { requestId } = event;
    let answer: Promise<unknown>;
    if (event.responseStatusCode !== undefined || event.responseErrorReason !== undefined) {
      // A document's response: its Speculation-Rules header is dropped (Fetch.continueResponse needs the status then).
      const headers = event.responseHeaders ?? [];
      const kept = headers.filter((h) => !SPECULATION_RULES_HEADER.test(h.name));
      answer =
        event.responseStatusCode === undefined || kept.length === headers.length
          ? session.send("Fetch.continueRequest", { requestId })
          : session.send("Fetch.continueResponse", {
              requestId,
              responseCode: event.responseStatusCode,
              ...(event.responseStatusText ? { responsePhrase: event.responseStatusText } : {}),
              responseHeaders: kept,
            });
    } else {
      let stop = refused.has(event.frameId);
      if (!stop) {
        try {
          stop = options.stops(pausedSent(event));
        } catch {
          stop = false;
        }
      }
      answer = stop ? session.send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }) : session.send("Fetch.continueRequest", { requestId });
    }
    answer.catch(() => undefined);
  });
  session.on("Target.attachedToTarget", ({ sessionId, targetInfo }) => {
    const { targetId } = targetInfo;
    const letGo = () => void session.send("Target.detachFromTarget", { sessionId }).catch(() => undefined);
    const close = () => session.send("Target.closeTarget", { targetId }).catch(() => undefined);
    if (targetInfo.browserContextId !== sign.browserContextId || targetId === sign.targetId) return letGo();
    if (targetInfo.type === "shared_worker") {
      // Playwright doesn't hold a shared worker (it detaches from one), so it is closed at once.
      refused.add(targetId);
      void close();
      options.refuse("a shared worker");
      return;
    }
    if (targetInfo.type !== "page" || options.admitTab?.({ opener: Boolean(targetInfo.openerId) })) return letGo();
    // Its requests fail from now on; it is closed once Playwright has let it go (one round trip: see above).
    refused.add(targetId);
    const closed = session.send("Target.getTargetInfo", { targetId }).catch(() => undefined).then(close);
    closing.add(closed);
    void closed.finally(() => closing.delete(closed));
    options.tabClosed?.();
  });
  try {
    await session.send("Fetch.enable", { patterns: [{ urlPattern: "*" }, { urlPattern: "*", resourceType: "Document", requestStage: "Response" }] });
    await session.send("Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
      filter: [{ type: "page" }, { type: "shared_worker" }, { exclude: true }],
    });
  } catch (err) {
    await session.detach().catch(() => undefined);
    throw err;
  }
  return async () => {
    // A tab still waiting for its close would be let go by the detach, with no request of it failing any more.
    await Promise.all(closing);
    await session.detach().catch(() => undefined);
  };
}

/**
 * Whether `request` carries `password` (0.6.0 review): in its body (raw, form- or percent-encoded, JSON-escaped or in
 * any JSON string, base64, and JSON inside a form field), in its query, hash, path (urlCarries) or user name and
 * password, in a header the page set (an Authorization "Basic" header decoded too), or in the Referer's address. A
 * form's POST body is URL-encoded and a JSON body escapes " and \, so a test of the raw text alone lets a password with
 * a space or ( ) ! ~ " \ @ through.
 */
function carriesPassword(request: Sent, password: string): boolean {
  if (!password) return false;
  const holds = passwordIn(password);

  if (textCarries(request.body, password, holds)) return true;

  let url: URL | null = null;
  try {
    url = new URL(request.url);
  } catch {
    url = null;
  }
  if (url && urlCarries(url, password, holds)) return true;

  for (const [name, value] of Object.entries(request.headers)) {
    if (BROWSER_HEADERS.test(name)) continue;
    if (/^referer$/i.test(name)) {
      // The page's own address, which never holds the password legitimately: only its query, hash, path and user info
      // are read (urlCarries), so a weak password that is part of the host name isn't taken for one.
      try {
        if (urlCarries(new URL(value), password, holds)) return true;
      } catch {
        // Not an address.
      }
      continue;
    }
    if (holds(value)) return true;
    const basic = /^basic\s+([A-Za-z0-9+/=_-]+)\s*$/i.exec(value);
    if (basic && includesNeedle(Buffer.from(basic[1]!, "base64").toString("utf8"), password)) return true;
  }
  return false;
}

/** Every string of a JSON text with the key it is under (an array's items under the array's key), or none. */
function jsonStringsByKey(text: string, key: string): [string, string][] {
  const out: [string, string][] = [];
  const walk = (value: unknown, under: string, depth: number) => {
    if (depth > 8) return;
    if (typeof value === "string") out.push([under, value]);
    else if (Array.isArray(value)) value.forEach((v) => walk(v, under, depth + 1));
    else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walk(v, k, depth + 1);
  };
  if (/^\s*[[{"]/.test(text)) {
    try {
      walk(JSON.parse(text), key, 0);
    } catch {
      // Not JSON.
    }
  }
  return out;
}

/**
 * Where the session signIn would return keeps the password (0.6.0 review, round 2): "a cookie (<name>)",
 * "localStorage (<key>)", "IndexedDB (<database>)" or "sessionStorage (<key>)", or null. Each value is read as a
 * request is (passwordIn: raw, percent-, JSON- or base64-encoded, and the strings of the JSON it holds). A weak
 * password (isWeak: "demo") or one equal to the username is one of the app's own values too, so it counts only as a
 * whole value, or a string of the JSON a value holds, under a key that names a password (pw_hint, password, pwd …).
 */
export function passwordKeptIn(
  state: SessionState,
  sessionStorage: NonNullable<SignedIn["sessionStorage"]>,
  password: string,
  username: string,
): string | null {
  if (!password) return null;
  const holds = passwordIn(password);
  const strict = isWeak(password) || password === username;
  const namesPassword = (key: string) => {
    const k = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    return PASSWORD_KEY.test(k) || /pass|pwd|^pw|secret|credential/.test(k);
  };
  const keeps = (value: string, key: string): boolean => {
    if (!value) return false;
    const decoded = safeDecode(value);
    if (strict) {
      if (namesPassword(key) && (value === password || decoded === password)) return true;
      return [value, decoded].some((v) => jsonStringsByKey(v, key).some(([k, s]) => s === password && namesPassword(k)));
    }
    return textCarries(value, password, holds) || (decoded !== value && textCarries(decoded, password, holds));
  };
  for (const cookie of state.cookies) if (keeps(cookie.value, cookie.name)) return `a cookie (${cookie.name})`;
  for (const origin of state.origins) {
    for (const item of origin.localStorage) if (keeps(item.value, item.name)) return `localStorage (${item.name})`;
    for (const db of (origin as { indexedDB?: (IndexedDbState & { name?: string })[] }).indexedDB ?? []) {
      for (const store of db.stores ?? []) {
        for (const record of store.records ?? []) {
          const texts = [record.value, record.key].map((v) => (typeof v === "string" ? v : JSON.stringify(v ?? null)));
          if (texts.some((t) => keeps(t, store.name ?? ""))) return `IndexedDB (${db.name ?? store.name ?? "a database"})`;
        }
      }
    }
  }
  for (const entry of sessionStorage) for (const item of entry.items) if (keeps(item.value, item.name)) return `sessionStorage (${item.name})`;
  return null;
}

/** Same origin and path (query and hash ignored). */
export function samePage(a: string, b: string): boolean {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.origin === y.origin && x.pathname === y.pathname;
  } catch {
    return a === b;
  }
}

/** What the page sent after the submit, in one sentence for a failed sign-in (methods, paths and statuses only). */
async function whatWasSent(sent: { method: string; path: string; status: Promise<number | null> }[]): Promise<string> {
  if (sent.length === 0) return "No request left the page after submitting: the form may have refused the values without saying why.";
  const answers = await Promise.all(
    sent.slice(0, 3).map(async (r) => {
      const status = await Promise.race([r.status, sleep(2_000).then(() => null)]);
      return `${r.method} ${redactSecrets(r.path)} ${status === null ? "got no answer" : `answered ${status}`}`;
    }),
  );
  return `The page sent ${answers.join(", ")}, but kept showing the sign-in form.`;
}

function firstLine(err: unknown): string {
  return cleanErrorMessage(err instanceof Error ? err.message : String(err)).split("\n")[0] ?? "";
}

const isWebUrl = (url: string) => /^https?:\/\//i.test(url);

/**
 * The contract's message for a two-step sign-in whose password step is on another origin (0.6.0): the host with its
 * port, never the whole address (a second step's address often carries the email). `url` may be a guard entry
 * ("<url> (answered from …)", or a refused navigation's "<METHOD> <url>").
 */
function continuedElsewhere(url: string): SignInError {
  const words = url.trim().split(/\s+/);
  const raw = words.find(isWebUrl) ?? words[0] ?? "";
  let host: string;
  try {
    host = new URL(raw).host;
  } catch {
    host = raw.replace(/^[a-z]+:\/\//i, "").split(/[/?#]/)[0] ?? "";
  }
  return new SignInError(`The sign-in continued on another site (${redactSecrets(host)}), so Run Hound won't type the password there.`);
}

/** How long the page gets, after the first step, with no field left to fill and nothing loading, before it is done. */
const NO_STEP_SETTLED_MS = 3_000;

/** What the page did after a two-step sign-in's first step. */
type StepOutcome =
  | { kind: "password" }
  | { kind: "elsewhere"; url: string }
  | { kind: "closed" }
  | { kind: "code" }
  | { kind: "captcha" }
  | { kind: "alert"; texts: string[] }
  | { kind: "none" };

interface StepEnv {
  label: string;
  shownUrl: string;
  loginOrigin: string;
  username: string;
  guard: NavigationGuard;
}

/**
 * Runs in the page before a first step: remembers the password fields showing now (a sign-up form's, beside the first
 * step), so only a password field that shows after the first step counts as its password step. Shown as Playwright's
 * :visible has it: a box, and not visibility:hidden.
 */
const MARK_PASSWORDS = String.raw`(() => {
  const shown = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden"; };
  window.__rhPasswordsBefore = new WeakSet(Array.from(document.querySelectorAll("input[type=password]")).filter(shown));
  return true;
})()`;

/** Runs in the page: whether a password field shows that MARK_PASSWORDS didn't see (every one, on a new page). */
const NEW_PASSWORD_SHOWN = String.raw`(() => {
  const shown = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden"; };
  const before = window.__rhPasswordsBefore;
  return Array.from(document.querySelectorAll("input[type=password]")).some((el) => shown(el) && !(before && before.has(el)));
})()`;

/** Runs in the page: for each selector, whether its element is one MARK_PASSWORDS didn't see. */
const NEW_ELEMENTS = String.raw`(selectors) => {
  const before = window.__rhPasswordsBefore;
  return selectors.map((s) => { let el = null; try { el = document.querySelector(s); } catch { el = null; } return !!el && !(before && before.has(el)); });
}`;

/** The address of a frame (not the page itself) from another origin that shows a password field, or null. */
async function passwordFrameElsewhere(page: Page, loginOrigin: string): Promise<string | null> {
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    const url = frame.url();
    if (!isWebUrl(url) || originOf(url) === loginOrigin) continue;
    if ((await frame.locator("input[type=password]:visible").count().catch(() => 0)) > 0) return url;
  }
  return null;
}

/**
 * A two-step sign-in's first step (0.6.0): types the identifier into `step`'s field on the sign-in origin, activates its
 * control (else presses Enter in the field), then waits up to SUBMIT_WAIT_MS for a password field on the sign-in origin,
 * one that wasn't showing before (MARK_PASSWORDS): on the same page or on the next one. Resolves once one shows for
 * SETTLED_MS; throws a SignInError when the page went on to another
 * origin (allowed or refused by the safety gate: nothing is typed there), asks for a code or a captcha, says something
 * went wrong, or shows no password field. The password is never typed here.
 */
async function passFirstStep(page: Page, step: FirstStep, env: StepEnv): Promise<void> {
  const { label, shownUrl, loginOrigin, guard } = env;
  // The page's own navigations from now on (a refused one never commits: the guard aborts it), and what is in flight.
  const navigations: string[] = [];
  const pending = new Set<Request>();
  const onRequest = (request: Request) => {
    pending.add(request);
    const from = request.redirectedFrom();
    if (from) pending.delete(from);
    try {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigations.push(request.url());
    } catch {
      // Not a page's request.
    }
  };
  const onDone = (request: Request) => void pending.delete(request);
  page.on("request", onRequest);
  page.on("requestfinished", onDone);
  page.on("requestfailed", onDone);
  const elsewhere = (): string | null => {
    const left = navigations.find((url) => isWebUrl(url) && originOf(url) !== loginOrigin);
    if (left) return left;
    if (guard.escaped.length > 0) return guard.escaped[0]!;
    const now = page.isClosed() ? "" : page.url();
    return isWebUrl(now) && originOf(now) !== loginOrigin ? now : null;
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
        throw continuedElsewhere(outcome.url);
      case "closed":
        if (guard.escaped.length > 0) throw continuedElsewhere(guard.escaped[0]!);
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
        // A captcha widget the page showed from the start (the wait only ends early on one that shows up after the
        // email) may be what refused the first step: the one-step path says so too, with the page's own text.
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
    // The next page may still be loading: let it settle before it is read.
    await page.waitForLoadState("load", { timeout: SUBMIT_WAIT_MS }).catch(() => undefined);
    await page.waitForLoadState("networkidle", { timeout: NETWORK_IDLE_MS }).catch(() => undefined);
    const after = elsewhere();
    if (after) throw continuedElsewhere(after);
  } finally {
    page.off("request", onRequest);
    page.off("requestfinished", onDone);
    page.off("requestfailed", onDone);
  }

  /** Polls the page until a password field holds for SETTLED_MS, or another outcome; `before` is what showed before. */
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
        // Nothing left to fill in and nothing loading: the page is done (it emailed a sign-in link instead).
        const fields = await page.locator("input:not([type=hidden]):visible, textarea:visible, select:visible").count().catch(() => 1);
        if (fields === 0 && pending.size === 0) {
          quietSince ??= Date.now();
          if (Date.now() - quietSince >= NO_STEP_SETTLED_MS) break;
        } else quietSince = null;
      }
      await sleep(POLL_MS);
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
 * The sign-in form of a two-step sign-in's password step, read once the page has settled. Throws when the password
 * field isn't in a sign-in form: the page offered to create an account for the identifier instead (a new-password
 * field, sign-up words, or a sign-in form that asks to choose a password: choosesPassword), or showed a password field
 * outside any form Run Hound can use.
 */
async function passwordStepForm(page: Page, label: string, shownUrl: string): Promise<DiscoveredForm> {
  let forms: DiscoveredForm[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      forms = (await discoverPage(page)).forms;
      break;
    } catch {
      // The page navigated while it was read: read it again once it has loaded.
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
  // A form whose password field showed after the first step, and that creates an account (a sign-up form already on
  // the page beside the first step doesn't count).
  const creates = forms.filter((f) => {
    const passwords = f.fields.filter(isPassword);
    const words = formWords(f);
    return (
      passwords.length > 0 &&
      (passwords.every((p) => /new-password/i.test(p.autocomplete ?? "")) || ((SIGN_UP_WORDS.test(words) || asksForName(f)) && !SIGN_IN_WORDS.test(words)))
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

/**
 * Whether a two-step sign-in's password step asks to choose a password instead (the first step turned into a sign-up
 * under a form still named "Sign in"): of the form's password fields that showed after the first step (MARK_PASSWORDS;
 * an autofill field hidden beside the first step doesn't count), more than one is shown (a password and its
 * confirmation), or one says create, choose, new, confirm or repeat.
 */
async function choosesPassword(page: Page, form: DiscoveredForm): Promise<boolean> {
  const passwords = form.fields.filter(isPassword);
  const fresh = (await page.evaluate(`(${NEW_ELEMENTS})(${JSON.stringify(passwords.map((p) => p.selector))})`).catch(() => [])) as boolean[];
  const shown: FormField[] = [];
  for (const [i, field] of passwords.entries()) {
    // Unknown (the page couldn't be read) counts as new: the safe side is not typing the password.
    if (fresh[i] === false) continue;
    if (await page.locator(field.selector).first().isVisible().catch(() => false)) shown.push(field);
  }
  return shown.length > 1 || shown.some((f) => CHOOSE_PASSWORD.test([f.label, f.placeholder, f.accessibleName].filter(Boolean).join(" ")));
}

/**
 * Whether a password step's identifier field still needs the identifier: shown (a 0x0 autofill field isn't; the
 * identifier was the first step), editable, and not already holding it.
 */
async function identifierNeeded(page: Page, field: FormField, username: string): Promise<boolean> {
  const box = page.locator(field.selector).first();
  if (!(await box.isVisible().catch(() => false))) return false;
  if (!(await box.isEditable({ timeout: ACTION_TIMEOUT_MS }).catch(() => false))) return false;
  return (await box.inputValue({ timeout: ACTION_TIMEOUT_MS }).catch(() => "")) !== username;
}

/**
 * Types `password` into the field `handle` points at, inside that field's own document and never through the page
 * keyboard (0.6.0 review). Playwright's fill focuses the field and then types with the page keyboard, which goes
 * wherever the focus is by then: a focus handler (or a timer) that moves the focus into another origin's frame would
 * get the password typed there. Here the field is focused, checked to hold the focus, and filled in one synchronous
 * step in its document: document.execCommand("insertText") (the input events a typed value makes) or, where that
 * leaves another value, the value set as a password manager sets it, with "input" and "change" events.
 *
 * Throws when the field is gone (retried by the caller: "not attached") or the page moved the focus away from it.
 *
 * The callback declares no named function: tsx/esbuild's keepNames would wrap one in a `__name` helper that doesn't
 * exist in the browser (vitest doesn't, so only `run-hound` itself would fail).
 */
async function typePassword(handle: ElementHandle<Node>, password: string): Promise<void> {
  await handle.waitForElementState("visible", { timeout: ACTION_TIMEOUT_MS });
  await handle.waitForElementState("editable", { timeout: ACTION_TIMEOUT_MS });
  const outcome = await handle.evaluate((node, value) => {
    const field = node as HTMLInputElement | HTMLTextAreaElement;
    if (!field.isConnected) return "detached";
    const doc = field.ownerDocument;
    field.focus();
    // The element that has the focus, inside open shadow roots too; an iframe when the focus went into a frame.
    let active = doc.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    if (active !== field) return "focus";
    field.select();
    let typed = false;
    try {
      typed = doc.execCommand("insertText", false, value);
    } catch {
      typed = false;
    }
    if (!typed || field.value !== value) {
      const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(field, value);
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return "typed";
  }, password);
  if (outcome === "detached") throw new Error("the password field is not attached to the page any more");
  if (outcome === "focus") throw new Error("the page moved the focus away from the password field");
}

/**
 * Runs before any script in every page and frame of the guarded sign-in context (0.6.0 review). It closes channels that
 * the context's routes and the per-tab CDP Fetch session never see, and that a page could use to carry the password to
 * another origin after Run Hound types it (the page can read its own password field). It is the first layer: a page
 * shares its world, so each channel has a second one outside the page where Chromium offers one.
 *
 * - **Web Workers and shared workers.** A shared worker's `fetch` and a `WebSocket` opened inside a dedicated worker
 *   are not seen by `context.route`, `context.routeWebSocket` or the page's `Fetch` session, so a page that
 *   `postMessage`s the password into a worker could send it out from there. A password sign-in never needs a worker to
 *   fill a form, so blocking the constructors fails safe: a page that hashes the password in a worker fails sign-in
 *   with a plain error instead of leaking. Second layers: a dedicated worker is held paused (stopUnrouted), a shared
 *   worker closed (guardSignInBrowser), and either fails the sign-in.
 * - **Speculation-rules prefetch.** A `<script type="speculationrules">` prefetch to another origin is seen by no
 *   interception layer (not the routes, not Fetch at the tab or at the browser), and no launch flag or DevTools command
 *   of Chromium 153 turns it off (0.6.0 review, round 2: `--disable-features=Prefetch,PrefetchUseContentRefactor`, the
 *   blink feature SpeculationRules, a PreloadingConfig holdback, Network.setCacheDisabled and
 *   Page.setPrerenderingAllowed were tried). So a rules script is removed as soon as it is in the document, before the
 *   browser reads its rules (a MutationObserver's callback runs before the rules are acted on): anywhere in the
 *   document or in a shadow root the page attaches, and again when a script's children change (a text/plain script
 *   made a rules script: its type alone changes nothing). Every built-in it uses is taken before any page script runs,
 *   so a page can't disarm it by replacing one. The rules of a Speculation-Rules header are dropped by
 *   guardSignInBrowser. It remains an in-page layer: a declarative shadow root's rules are not watched.
 * - **WebRTC and WebTransport** (0.6.0 review, round 1). A peer connection sends its ICE servers' user names over UDP
 *   (a TURN server given the password as its username gets it), and a WebTransport session is an HTTP/3 connection:
 *   neither is seen by any interception layer, and a password sign-in needs neither. RTCPeerConnection, its
 *   webkitRTCPeerConnection alias and WebTransport are replaced with constructors that throw, in every frame (an
 *   about:blank frame the page makes gets this script too), before any page script can keep the built-ins.
 * - **window.close.** The sign-in tab is never closed by its page: what a document sends while it is being left would
 *   go out as the tab closes. (Chromium already ignores window.close() in a tab opened the way Run Hound opens it, with
 *   two history entries: this holds if that changes.)
 *
 * Declares no named function, like typePassword: tsx/esbuild's keepNames would wrap one in a `__name` helper the
 * browser doesn't have.
 */
const SIGN_IN_HARDENING = String.raw`(() => {
  for (const k of ["Worker", "SharedWorker"]) {
    try { Object.defineProperty(window, k, { configurable: true, value: function () { throw new Error("Run Hound blocks workers during sign-in"); } }); } catch (e) {}
  }
  for (const k of ["RTCPeerConnection", "webkitRTCPeerConnection", "WebTransport"]) {
    if (!(k in window)) continue;
    try { Object.defineProperty(window, k, { configurable: true, writable: true, value: function () { throw new Error("Run Hound blocks " + k + " during sign-in"); } }); } catch (e) {}
  }
  try { Object.defineProperty(window, "close", { configurable: true, value: function () {} }); } catch (e) {}
  try {
    var apply = Reflect.apply;
    var getter = function (proto, name) { return Object.getOwnPropertyDescriptor(proto, name).get; };
    var nodeType = getter(Node.prototype, "nodeType"), localName = getter(Element.prototype, "localName");
    var getAttribute = Element.prototype.getAttribute, remove = Element.prototype.remove, test = RegExp.prototype.test;
    var elementAll = Element.prototype.querySelectorAll, fragmentAll = DocumentFragment.prototype.querySelectorAll, documentAll = Document.prototype.querySelectorAll;
    var listLength = getter(NodeList.prototype, "length"), listItem = NodeList.prototype.item;
    var recordTarget = getter(MutationRecord.prototype, "target"), recordAdded = getter(MutationRecord.prototype, "addedNodes");
    var Observer = MutationObserver, observe = MutationObserver.prototype.observe, attachShadow = Element.prototype.attachShadow;
    var SPEC = /speculationrules/i;
    var isSpec = function (n) {
      try { return !!n && apply(nodeType, n, []) === 1 && apply(localName, n, []) === "script" && apply(test, SPEC, [String(apply(getAttribute, n, ["type"]) || "")]); } catch (e) { return false; }
    };
    var drop = function (n) { try { apply(remove, n, []); } catch (e) {} };
    var each = function (list, fn) { var count = apply(listLength, list, []); for (var i = 0; i < count; i++) fn(apply(listItem, list, [i])); };
    var strip = function (n) {
      try {
        if (isSpec(n)) return drop(n);
        var type = apply(nodeType, n, []);
        var all = type === 1 ? elementAll : type === 11 ? fragmentAll : type === 9 ? documentAll : null;
        if (all) each(apply(all, n, ["script"]), function (s) { if (isSpec(s)) drop(s); });
      } catch (e) {}
    };
    var observer = new Observer(function (records) {
      for (var r = 0; r < records.length; r++) {
        try {
          var target = apply(recordTarget, records[r], []);
          if (isSpec(target)) drop(target);
          each(apply(recordAdded, records[r], []), strip);
        } catch (e) {}
      }
    });
    var watch = function (root) { try { apply(observe, observer, [root, { childList: true, subtree: true }]); strip(root); } catch (e) {} };
    if (typeof attachShadow === "function") {
      Object.defineProperty(Element.prototype, "attachShadow", {
        configurable: true,
        writable: true,
        value: function () { var root = apply(attachShadow, this, arguments); watch(root); return root; },
      });
    }
    watch(document);
  } catch (e) {}
})()`

/**
 * A page Run Hound serves itself (a route: nothing reaches the app's server and no app script runs) on the sign-in
 * origin, only to read that origin's sessionStorage once the tab has moved on to another origin.
 */
const STORAGE_PROBE_PATH = "/__run-hound__/session-storage";

async function storageItems(page: Page): Promise<{ name: string; value: string }[]> {
  return (await page.sessionStorage.items().catch(() => [])).map(({ name, value }) => ({ name, value }));
}

/**
 * The sessionStorage items of the landing origin (the tab's origin now) and of the sign-in origin (0.6.0), each only
 * when it holds something, the sign-in origin first.
 *
 * sessionStorage belongs to the tab, and the tab has left the sign-in origin. The landing page opens STORAGE_PROBE_PATH
 * on the sign-in origin as a popup: Chromium gives a popup a copy of its opener's whole sessionStorage, so the probe
 * reads the sign-in origin's items while the landing page stays where it is. Moving the tab itself would run the
 * landing page's pagehide handlers, and an app that signs out there (a beacon to its own sign-out endpoint) would end
 * the session just taken. When the popup can't be opened, the sign-in origin's items are left out.
 *
 * `armPopup(true)` lets exactly one tab open (signInReady admits the first new tab, and keeps it only when it is at the
 * probe's address): the probe is opened with the landing page's own window.open, which the page may have replaced. A
 * tab that isn't at the probe's address is closed and nothing is read from it.
 */
async function readSessionStorage(
  page: Page,
  loginOrigin: string,
  armPopup: (on: boolean) => void = () => undefined,
): Promise<NonNullable<SignedIn["sessionStorage"]>> {
  const out: NonNullable<SignedIn["sessionStorage"]> = [];
  if (page.isClosed()) return out;
  const landing = originOf(page.url());
  if (landing !== null && isWebUrl(page.url())) {
    const items = await storageItems(page);
    if (items.length > 0) out.push({ origin: landing, items });
  }
  if (landing === loginOrigin) return out;

  const context = page.context();
  const probe = `${loginOrigin}${STORAGE_PROBE_PATH}`;
  const isProbe = (url: URL) => url.href === probe;
  const serve = (route: Route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: "<!doctype html><title>Run Hound</title>" });
  await context.route(isProbe, serve);
  // Popups are closed during sign-in (a tab could carry the password out); this is Run Hound's own probe popup, so
  // let it stay open (and get the tab interception) while it is read.
  armPopup(true);
  try {
    const popped = context.waitForEvent("page", { predicate: (opened) => opened.url() === probe, timeout: NETWORK_IDLE_MS });
    popped.catch(() => undefined);
    const opened = await page.evaluate(`(() => { try { return window.open(${JSON.stringify(probe)}) !== null; } catch (e) { return false; } })()`).catch(() => false);
    if (!opened) return out;
    const popup = await popped;
    try {
      await popup.waitForLoadState("domcontentloaded", { timeout: NETWORK_IDLE_MS });
      if (popup.url() === probe) {
        const items = await storageItems(popup);
        if (items.length > 0) out.unshift({ origin: loginOrigin, items });
      }
    } finally {
      await popup.close().catch(() => undefined);
    }
  } catch {
    // No popup: the sign-in origin's items are left out.
  } finally {
    armPopup(false);
    await context.unroute(isProbe, serve).catch(() => undefined);
  }
  return out;
}

/** The most request addresses signIn keeps after the submit (for idsInAddresses). */
const MAX_ADDRESSES = 2_000;

/**
 * What says who is signed in, now (0.6.0 review, round 1): each cookie with a session-like name (SESSION_NAME) as its
 * name and value, and each session value the page's origin keeps in localStorage or sessionStorage (sessionSecrets,
 * localStorage's rules). A submit that signed in adds or changes one; a captcha challenge in the form's place doesn't.
 */
async function sessionMarks(context: BrowserContext, page: Page): Promise<Set<string>> {
  const out = new Set<string>();
  for (const c of await context.cookies().catch(() => [])) if (c.value && SESSION_NAME.test(c.name)) out.add(`cookie ${c.domain} ${c.path} ${c.name}=${c.value}`);
  if (page.isClosed()) return out;
  const items = [...(await page.localStorage.items().catch(() => [])), ...(await page.sessionStorage.items().catch(() => []))];
  const stored: SessionState = { cookies: [], origins: [{ origin: "", localStorage: items.map(({ name, value }) => ({ name, value })) }] };
  for (const value of sessionSecrets(stored, [], { sessionStorageSession: false })) out.add(`storage ${value}`);
  return out;
}

/**
 * Signs `account` in with a fresh, guarded browser context (docs/v2-spec.md "Signing in", steps 1-7) and returns its
 * session. Throws SignInError when the slot isn't ready, the login URL fails the safety gate, no sign-in form is found,
 * the form is still shown after submitting (with the page's own error text, redacted), or the page asks for a code or
 * a captcha (not supported).
 *
 * 0.6.0: a two-step sign-in page (the identifier first, then the password) is signed in through both steps, the
 * password only on the sign-in origin (passFirstStep); the session's sessionStorage comes back in
 * SignedIn.sessionStorage (readSessionStorage).
 */
export async function signIn(browser: Browser, account: TestAccount, safety: SafetyOptions = {}): Promise<SignedIn> {
  const label = accountLabel(account);
  const problem = notSetUp(account, label);
  if (problem) throw new SignInError(problem);
  // Every message below is redacted with the password registered, whatever the caller registered.
  const registrations = [registerSecretLiterals([account.password!])];
  try {
    return await signInReady(browser, account, label, safety, registrations);
  } catch (err) {
    if (err instanceof SignInError) throw new SignInError(redactSecrets(err.message));
    throw new SignInError(redactSecrets(`${label} could not sign in: ${firstLine(err)}`));
  } finally {
    for (const unregister of registrations) unregister();
  }
}

async function signInReady(browser: Browser, account: TestAccount, label: string, safety: SafetyOptions, registrations: (() => void)[]): Promise<SignedIn> {
  const loginUrl = account.loginUrl.trim();
  const shownUrl = redactSecrets(loginUrl);
  try {
    await checkTarget(loginUrl, safety);
  } catch (err) {
    const reason = err instanceof TargetNotAllowedError ? err.reason : firstLine(err);
    throw new SignInError(`${label}'s sign-in page ${shownUrl} can't be used: ${reason}.`);
  }

  let context: BrowserContext | undefined;
  let releaseBrowser: (() => Promise<void>) | undefined;
  try {
    // serviceWorkers: a service worker's own requests bypass context.route (the guard and the password blocks).
    context = await browser.newContext({ locale: BROWSER_LOCALE, serviceWorkers: "block", ...ISOLATED_CONTEXT });
    // Close the worker, speculation-rules and window.close channels the routes never see, before any page script runs.
    await context.addInitScript(SIGN_IN_HARDENING);
    const guard = await guardContext(context, safety);
    const password = account.password!;
    const loginOrigin = new URL(loginUrl).origin;
    const weak = isWeak(password);
    const holds = passwordIn(password);
    // No request can carry the password before it is typed: until then nothing is read (a weak password such as "demo"
    // is in many an address), and nothing is stopped for the password's sake.
    let passwordTyped = false;
    // A request that sends the password in its address (a GET form, or a script's request on the sign-in origin) would
    // put it in the app's access log (and a page's in the browser history): it is stopped before it leaves the browser,
    // and signing in fails with the reason. On the sign-in origin only the address's query, hash and user info are read
    // (queryCarries), never its path: a GET form puts the password in the query, and an ordinary address holds the
    // app's own words ("password" in /api/account/password-status: 0.6.0 review, round 1). A weak password ("demo")
    // counts in any query value of a navigation, and in a script's request only under a key that names a password
    // ("?password=demo", "&pwd=demo"): a same-origin fetch or image whose query merely equals it under another key
    // ("?user=demo") is not a leak (0.6.0 review). A password equal to the username counts on the sign-in origin only
    // under a key that names a password (or as an address's own password), in a navigation and a script's request
    // alike: the username is in many of the app's own addresses (/api/users/<username>, ?name=<username>). Another
    // origin is read as for any password: the password must not reach it, whatever else it equals.
    let passwordInAddress: "navigation" | "request" | null = null;
    const passwordIsUsername = password === account.username;
    // The password is only ever sent to the sign-in page's own origin: a request to any other origin (a form action
    // pointing elsewhere, a script that copies the form) that carries it, in whatever encoding (carriesPassword), or in
    // its host name (hostCarries: http://<password>.evil.example/), is stopped before it leaves the browser.
    let passwordElsewhere: string | null = null;
    /** The password was in the host name of a request to another origin: the message never shows that address. */
    let passwordInHostName = false;
    const loginHost = new URL(loginUrl).hostname;
    // A worker the page started although SIGN_IN_HARDENING blocks the constructors: held or closed before it ran
    // (stopUnrouted, guardSignInBrowser), and the sign-in fails.
    let refusedWorker: string | null = null;
    const refuse = (what: string) => {
      refusedWorker ??= what;
    };
    /** Whether a request (or a WebSocket, or one of its messages) must be stopped for the password's sake; records why. */
    const stops = (sent: Sent): boolean => {
      if (!passwordTyped) return false;
      let url: URL;
      try {
        url = new URL(sent.url);
      } catch {
        return false;
      }
      if (!/^https?:$/.test(url.protocol)) return false;
      if (url.origin !== loginOrigin) {
        // The sign-in host on another port is never read for it: the password is not what named that host.
        if (url.hostname !== loginHost && hostCarries(url, password)) {
          passwordInHostName = true;
          return true;
        }
        if (carriesPassword(sent, password)) {
          passwordElsewhere = url.origin;
          return true;
        }
      }
      const inAddress = passwordIsUsername
        ? carriesUnderPasswordKey(url, password) || (url.password !== "" && safeDecode(url.password) === password)
        : weak
          ? sent.navigation
            ? carriesInQuery(url, password)
            : carriesUnderPasswordKey(url, password)
          : queryCarries(url, holds);
      if (inAddress) {
        passwordInAddress ??= sent.navigation ? "navigation" : "request";
        return true;
      }
      return false;
    };
    // Every request once the password is typed, on any origin (the safety guard's route runs after this one).
    await context.route(
      () => passwordTyped,
      async (route) => {
        if (stops(sentOf(route.request()))) {
          await route.abort("blockedbyclient").catch(() => undefined);
          return;
        }
        await route.fallback();
      },
    );
    // context.route doesn't see WebSockets: each one is checked at its handshake and at every message the page sends.
    // The handshake's subprotocols (new WebSocket(url, [password]): connectToServer sends them in the
    // Sec-WebSocket-Protocol header) are read as its body, since a sec-* header is one the browser sets and isn't read.
    await context.routeWebSocket(
      () => true,
      (ws) => {
        const url = ws.url().replace(/^ws(s?):/i, "http$1:");
        if (stops({ url, body: ws.protocols().join("\n"), headers: {}, navigation: false })) {
          void ws.close().catch(() => undefined);
          return;
        }
        const server = ws.connectToServer();
        ws.onMessage((message) => {
          if (stops({ url, body: typeof message === "string" ? message : message.toString("utf8"), headers: {}, navigation: false })) {
            void ws.close().catch(() => undefined);
            void server.close().catch(() => undefined);
            return;
          }
          server.send(message);
        });
      },
    );
    const elsewhere = () => {
      if (passwordInHostName) {
        // Not the address: its host name holds the password, lower-cased, which the redaction wouldn't find.
        throw new SignInError(
          `${label} could not sign in: the sign-in page on ${shownUrl} sends the password to another site, inside that site's host name. Run Hound stopped it before it was sent.`,
        );
      }
      if (passwordElsewhere === null) return;
      throw new SignInError(
        `${label} could not sign in: the sign-in form on ${shownUrl} sends the password to ${redactSecrets(passwordElsewhere)}, not to ${redactSecrets(loginOrigin)} where it was saved for. Run Hound stopped it before it was sent.`,
      );
    };
    const inAddress = () => {
      if (passwordInAddress === "navigation") {
        throw new SignInError(
          `${label} could not sign in: the sign-in form on ${shownUrl} sends the password in the page address (a GET form), where it ends up in server logs and the browser history. Run Hound stopped it before it was sent. Make the form send the password in a POST request.`,
        );
      }
      if (passwordInAddress === "request") {
        throw new SignInError(
          `${label} could not sign in: the sign-in page on ${shownUrl} sends the password in the page address of a request to ${redactSecrets(loginOrigin)}, where it ends up in server logs. Run Hound stopped it before it was sent. Send the password in the request's body instead.`,
        );
      }
    };
    const workerStarted = () => {
      if (refusedWorker === null) return;
      throw new SignInError(
        `${label} could not sign in: the sign-in page on ${shownUrl} started ${refusedWorker}, and Run Hound doesn't let one run during sign-in, where it could carry the password to another site. Run Hound stopped it before it ran.`,
      );
    };
    const page = await context.newPage();
    // What the routes never see (a redirect, a beacon or an image of a page being left) is checked in every tab of the
    // context, the sign-in page's tab before it opens anything; a dedicated worker it starts is held there.
    await stopUnrouted(page, stops, refuse);
    // A password sign-in never opens a tab: a new tab of the context is held before it runs and closed
    // (guardSignInBrowser), since a tab can carry the password to another origin on a redirect hop before Playwright
    // even reports it. The one tab Run Hound wants is its own sessionStorage probe: readSessionStorage lets exactly one
    // tab run (admitTab), and the "page" handler below keeps it only when it is at the probe's address.
    const probeUrl = `${loginOrigin}${STORAGE_PROBE_PATH}`;
    let probeWanted = false;
    let admitNext = false;
    // Playwright's storageState() opens a page of its own (no opener) to read an origin no tab is on any more.
    let readingState = false;
    let tabsClosed = 0;
    releaseBrowser = await guardSignInBrowser(browser, page, {
      stops,
      refuse,
      admitTab: ({ opener }) => {
        if (admitNext) {
          admitNext = false;
          return true;
        }
        return readingState && !opener;
      },
      tabClosed: () => {
        if (passwordTyped) tabsClosed += 1;
      },
    });
    context.on("page", (opened) => {
      if (opened === page) return;
      if (probeWanted && opened.url() === probeUrl) {
        probeWanted = false;
        void stopUnrouted(opened, stops, refuse).catch(() => undefined);
        return;
      }
      void opened.close().catch(() => undefined);
    });
    const leftTarget = () => {
      if (guard.escaped.length === 0) return;
      throw new SignInError(`${label} could not sign in: ${guardSummary(guard)} Sign-in through another site (Google, GitHub, …) isn't supported.`);
    };

    // 1. Open the sign-in page.
    try {
      await page.goto(loginUrl, { waitUntil: "load", timeout: LOAD_TIMEOUT_MS });
    } catch (err) {
      leftTarget();
      const explained = explainNavigationError(err, loginUrl);
      throw new SignInError(`${label}'s sign-in page could not be opened: ${firstLine(explained)}`);
    }
    await page.waitForLoadState("networkidle", { timeout: NETWORK_IDLE_MS }).catch(() => undefined);
    leftTarget();

    /**
     * Where the tab is, for a message: its origin; on a page that isn't a web page (a navigation the guard refused
     * shows Chromium's error page), the refused address's origin; null when neither is known.
     */
    const whereNow = (): string | null => {
      const now = page.isClosed() ? "" : page.url();
      if (isWebUrl(now)) return originOf(now);
      const refused = guard.blocked.at(-1)?.split(/\s+/).find(isWebUrl);
      return refused ? originOf(refused) : null;
    };
    /** Nothing is typed, not even the identifier, on a page that isn't on the sign-in page's own origin. */
    const ledElsewhere = (where: string | null = null) => {
      if (where === null && !page.isClosed() && originOf(page.url()) === loginOrigin) return;
      const to = where ?? whereNow();
      throw new SignInError(
        to
          ? `${label} could not sign in: ${shownUrl} led to ${redactSecrets(to)}, and the password is only typed on ${redactSecrets(loginOrigin)}, the sign-in page it was saved for.`
          : `${label} could not sign in: ${shownUrl} didn't stay on ${redactSecrets(loginOrigin)}, and the password is only typed on ${redactSecrets(loginOrigin)}, the sign-in page it was saved for.`,
      );
    };

    // 2. The sign-in form; else (0.6.0) the first step of a two-step sign-in, then the password step's sign-in form.
    const found = await discoverPage(page);
    let form = signInForm(found.forms);
    // A first step beside a password form that doesn't say by itself that it signs in (0.6.0 review, round 2: a trial
    // sign-up form next to an email-first sign-in; round 3: whatever the password form's words, "Start for free" or
    // "Create workspace", and whether the first step's sign-in words are its own or the page's): the sign-in goes
    // through the first step, and the password form is never filled. firstStepForm already needs sign-in words, from
    // the form, the text before it, the page's title or its address.
    let first: FirstStep | null = null;
    if (form && !hasCurrentPassword(form)) {
      const step = await firstStepForm(page, found.forms, loginUrl);
      if (step && !signsInItself(form, step)) {
        first = step;
        form = null;
      }
    }
    const twoStep = form === null;
    /** A two-step sign-in's first step (0.6.0): its page, its identifier field and its form, to see the page go back to it. */
    let firstStep: { url: string; field: string; form: string } | null = null;
    if (!form) {
      first ??= await firstStepForm(page, found.forms, loginUrl);
      if (!first) {
        // A passwordless form ("Send magic link") is never submitted (0.6.0 review, round 1): the message says why.
        const sends = passwordlessWords(found.forms);
        const passwordless = sends
          ? ` The page signs in with a link or a code it sends ("${sends}"), and that isn't supported: use a test account that signs in with a password.`
          : "";
        const providers = (await offersProviders(page)) ? " Sign-in through another provider (Google, GitHub, …) isn't supported." : "";
        // Password forms the page has, every one of them a sign-up form (round 3): the message says so.
        const signUp = found.forms.filter((f) => f.fields.some(isPassword)).map(signUpReason);
        if (signUp.length > 0 && signUp.every((why) => why !== null)) {
          throw new SignInError(
            `No sign-in form was found on ${shownUrl}: its form with a password field looks like a sign-up form (${signUp[0]}), and the account's password is never typed into one.${passwordless}${providers}`,
          );
        }
        throw new SignInError(`No sign-in form (a form with a password field) was found on ${shownUrl}.${passwordless}${providers}`);
      }
      ledElsewhere();
      firstStep = { url: page.url(), field: first.field.selector, form: first.form.selector };
      await passFirstStep(page, first, { label, shownUrl, loginOrigin, username: account.username, guard });
      leftTarget();
      form = await passwordStepForm(page, label, shownUrl);
    }
    const signInScope = form.selector;
    const passwordField = form.fields.find(isPassword)!;
    // 3. The identifier field. A two-step sign-in's password step may have none: the identifier was the first step.
    const idField = identifierField(form);
    if (!idField && !twoStep) throw new SignInError(`The sign-in form on ${shownUrl} has a password field but no field for the username or email.`);

    // 4. Fill in and submit, only on the sign-in page's own origin (the password is bound to it).
    /** Throws when the tab isn't on the sign-in origin: a two-step sign-in with the contract's message. */
    const stillOnLoginOrigin = (where: string | null = null) => {
      if (!twoStep) return ledElsewhere(where);
      if (where === null && !page.isClosed() && originOf(page.url()) === loginOrigin) return;
      const to = where ?? whereNow();
      if (to) throw continuedElsewhere(to);
      ledElsewhere(null);
    };
    const couldNotFill = (err: unknown) => new SignInError(`${label} could not fill in the sign-in form on ${shownUrl}: ${firstLine(err)}`);
    stillOnLoginOrigin();
    const passwordBox = page.locator(passwordField.selector).first();
    try {
      // A password step that repeats the identifier (read-only, or already filled in) is left as it is.
      if (idField && (!twoStep || (await identifierNeeded(page, idField, account.username)))) {
        await page.locator(idField.selector).first().fill(account.username, { timeout: ACTION_TIMEOUT_MS });
      }
    } catch (err) {
      throw couldNotFill(err);
    }
    // The cookies before the password is typed (0.6.0 review, round 2): a session cookie the submit sets or changes says
    // the session lives in a cookie, whatever its name (sessionInStorage).
    const cookiesBefore: CookieJar = await context.cookies().catch(() => []);
    // The password goes into the field of a document on the sign-in origin, checked on that very element, and is typed
    // in that element's own document (typePassword), never with the page keyboard: a navigation that commits in between
    // makes the handle fail, and a page that moves the focus elsewhere (into another origin's frame) fails the sign-in,
    // instead of the password being typed where the focus went.
    for (let attempt = 1; ; attempt++) {
      stillOnLoginOrigin();
      let handle: Awaited<ReturnType<typeof passwordBox.elementHandle>>;
      try {
        handle = await passwordBox.elementHandle({ timeout: ACTION_TIMEOUT_MS });
      } catch (err) {
        throw couldNotFill(err);
      }
      try {
        const origin = await handle.evaluate((el) => el.ownerDocument.location.origin).catch(() => null);
        if (origin !== null && origin !== "null" && origin !== loginOrigin) stillOnLoginOrigin(origin);
        if (origin === loginOrigin) {
          // Nothing is typed on a page that started a worker Run Hound had to stop.
          workerStarted();
          try {
            passwordTyped = true;
            await typePassword(handle, password);
            break;
          } catch (err) {
            // The field was replaced (a re-render) or its page moved on: once more, with the field as it is now.
            if (attempt >= 2 || !/not attached|detached|context was destroyed|navigat|moved the focus/i.test(String((err as Error)?.message ?? err))) throw couldNotFill(err);
          }
        } else if (attempt >= 2) {
          throw couldNotFill(new Error("the page moved on while the password was being typed"));
        }
      } finally {
        await handle.dispose().catch(() => undefined);
      }
    }
    const before = page.url();
    // What the app sends from now on (0.6.0 review, round 1), in memory for the time of the sign-in only: the values of
    // its credential headers, and the addresses of its requests. They say whether the session lives in sessionStorage,
    // and which of its values are ids rather than secrets (step 7).
    const credentials = new Set<string>();
    const addresses: string[] = [];
    context.on("request", (request) => {
      try {
        for (const [name, value] of Object.entries(request.headers())) if (value && isCredentialName(name)) credentials.add(value);
        if (addresses.length < MAX_ADDRESSES) addresses.push(request.url());
      } catch {
        // A request of a page that is gone.
      }
    });
    /**
     * Error texts on the page: around the password step's form and, in a two-step sign-in, around the first step's form
     * too (a page that goes back to the email step after a wrong password shows its message there).
     */
    const errorScopes = [...new Set([signInScope, ...(firstStep ? [firstStep.form] : [])])];
    const pageErrors = async () => [...new Set((await Promise.all(errorScopes.map((s) => errorTexts(page, s)))).flat())];
    const alertsBefore = new Set(await pageErrors());
    const freshErrors = async () => (await pageErrors()).filter((t) => !alertsBefore.has(t));
    /** Whether a captcha showed before the submit: one that shows only after it, in the password step's place, fails (step 6). */
    const captchaBefore = await showsCaptcha(page);
    /** What said who is signed in before the submit (sessionMarks): a submit that adds or changes one started a session. */
    const marksBefore = await sessionMarks(page.context(), page);
    const sessionStarted = async () => [...(await sessionMarks(page.context(), page))].some((mark) => !marksBefore.has(mark));
    /** Two-step (0.6.0): the tab is on the first step's page, or on the password step's. */
    const onFirstStepPage = () => firstStep !== null && !page.isClosed() && (samePage(page.url(), before) || samePage(page.url(), firstStep.url));
    /** Two-step: the first step's identifier field shown and editable again, and no password field shown that is new since the first step. */
    const firstFieldBack = async (): Promise<boolean> => {
      if (firstStep === null) return false;
      if (await page.evaluate(NEW_PASSWORD_SHOWN).then(Boolean, () => true)) return false;
      const box = page.locator(firstStep.field).first();
      if (!(await box.isVisible().catch(() => false))) return false;
      return box.isEditable({ timeout: POLL_MS }).catch(() => false);
    };
    /** Two-step: the page's forms show a first step again (firstStepForm), read afresh. */
    const firstStepShown = async (): Promise<boolean> => {
      const forms = await discoverPage(page).then(
        (p) => p.forms,
        () => [] as DiscoveredForm[],
      );
      return (await firstStepForm(page, forms, loginUrl).catch(() => null)) !== null;
    };
    // What the page sends after the submit, for the message when the form is still shown (methods and paths only).
    const sent: { method: string; path: string; status: Promise<number | null> }[] = [];
    page.on("request", (request) => {
      if (request.method() === "GET" || !["fetch", "xhr", "document"].includes(request.resourceType())) return;
      let path = "";
      try {
        path = new URL(request.url()).pathname;
      } catch {
        path = request.url();
      }
      const status = request.response().then((r) => r?.status() ?? null, () => null);
      sent.push({ method: request.method(), path, status });
    });
    const submit = form.controls.find((c) => c.isSubmit);
    const clicked = submit
      ? await page
          .locator(submit.selector)
          .first()
          .click({ timeout: ACTION_TIMEOUT_MS })
          .then(() => true)
          .catch(() => false)
      : false;
    if (!clicked) await passwordBox.press("Enter", { timeout: ACTION_TIMEOUT_MS }).catch(() => undefined);

    // 5. Wait for a settled outcome: the page left the sign-in page (not just a new hash or query), or the password
    // field went away, and it stays that way for SETTLED_MS. An error message ends the wait after ALERT_GRACE_MS.
    // Two-step (0.6.0): on the first step's page, the password field going away may be the page going back to the
    // email step after a wrong password, so an error message still counts there; with the email field back and no
    // message yet, the page gets ALERT_GRACE_MS more for its message (or its next page).
    const deadline = Date.now() + SUBMIT_WAIT_MS;
    let alertSince: number | null = null;
    let doneSince: number | null = null;
    while (Date.now() < deadline) {
      if (passwordInAddress !== null || passwordElsewhere !== null || passwordInHostName || refusedWorker !== null || page.isClosed()) break;
      const left = !samePage(page.url(), before);
      const gone = left || !(await passwordBox.isVisible().catch(() => false));
      const watchAlerts = !gone || onFirstStepPage();
      if (watchAlerts) {
        if (alertSince === null) {
          if ((await freshErrors()).length > 0) alertSince = Date.now();
        } else if (Date.now() - alertSince >= ALERT_GRACE_MS) break;
      }
      if (gone) {
        doneSince ??= Date.now();
        if (!watchAlerts) {
          if (Date.now() - doneSince >= SETTLED_MS) break;
        } else if (alertSince === null) {
          const settle = (await firstFieldBack()) ? SETTLED_MS + ALERT_GRACE_MS : SETTLED_MS;
          if (Date.now() - doneSince >= settle) break;
        }
      } else doneSince = null;
      await sleep(POLL_MS);
    }
    inAddress();
    elsewhere();
    workerStarted();
    leftTarget();
    await page.waitForLoadState("load", { timeout: SUBMIT_WAIT_MS }).catch(() => undefined);
    await page.waitForLoadState("networkidle", { timeout: NETWORK_IDLE_MS }).catch(() => undefined);
    inAddress();
    elsewhere();
    workerStarted();
    leftTarget();

    // 6. Decide from the page. A navigation the guard refused left the tab on Chromium's error page: the sign-in went
    // on to a site Run Hound may not open (a provider's), so nothing is signed in here.
    if (!page.isClosed() && !isWebUrl(page.url()) && guard.blocked.length > 0) {
      const to = whereNow();
      throw new SignInError(
        `${label} could not sign in: after submitting, the sign-in page went to ${to ? redactSecrets(to) : "another site"}, which Run Hound is not allowed to open. Sign-in through another site (Google, GitHub, …) isn't supported.`,
      );
    }
    const onSignInPage = samePage(page.url(), before);
    const stillShown =
      (await passwordBox.isVisible().catch(() => false)) || (onSignInPage && (await page.locator("input[type=password]:visible").count().catch(() => 0)) > 0);
    // Off the sign-in page's address (0.6.0 review, round 2), and at that address once the password field is gone
    // (round 3: a single-page app that swaps in a code split over six boxes), a code step without
    // autocomplete=one-time-code counts too: its only field, or its split boxes, say a sign-in code (showsCodeStep).
    if ((await showsCodeField(page, onSignInPage)) || ((!onSignInPage || !stillShown) && (await showsCodeStep(page)))) {
      throw new SignInError(
        `${label}'s sign-in asks for a verification code after the password. Codes (multi-factor sign-in) aren't supported: use a test account that signs in with a password alone.`,
      );
    }
    const captchaMessage = (quote: string) =>
      `${label} could not sign in: the sign-in form has a captcha, and captchas aren't supported. Turn it off for test accounts in your development setup.${quote ? ` The page said: "${quote}"` : ""}`;
    // A captcha challenge that took the password step's place at the same address (0.6.0 review): the password field is
    // gone, but nobody signed in. Only a captcha that showed after the submit, and only on that page: a landing page
    // with an invisible captcha badge elsewhere in the app is still a success. And only when the submit started no
    // session (0.6.0 review, round 1): an app that renders its signed-in view at the sign-in page's own address may have
    // a captcha in a form of its own (a feedback form's Turnstile widget).
    if (!stillShown && onSignInPage && !captchaBefore && (await showsCaptcha(page)) && !(await sessionStarted())) {
      throw new SignInError(captchaMessage((await freshErrors()).slice(0, 2).join(" ").slice(0, 300)));
    }
    // A captcha challenge on the page the password led to (0.6.0 review, round 2): the challenge is all it asks for. The
    // submit may have set a pre-session cookie, so whether it started a session says nothing here.
    if (!stillShown && !onSignInPage && (await showsCaptchaChallenge(page))) throw new SignInError(captchaMessage(""));
    if (stillShown) {
      const quote = (await freshErrors()).slice(0, 2).join(" ").slice(0, 300);
      if (await showsCaptcha(page)) throw new SignInError(captchaMessage(quote));
      if (quote) throw new SignInError(`${label} could not sign in: the sign-in page said "${quote}".`);
      // A form that signs in in a new tab (target=_blank): the tab was closed before it ran (guardSignInBrowser).
      if (tabsClosed > 0) {
        throw new SignInError(
          `${label} could not sign in: the sign-in form on ${shownUrl} opens a new tab or window, and Run Hound closes any tab a sign-in opens (one could carry the password to another site).`,
        );
      }
      throw new SignInError(`${label} could not sign in: the sign-in form was still shown after submitting, and the page showed no error. ${await whatWasSent(sent)}`);
    }
    // Two-step (0.6.0): a page that answers a wrong password by going back to the email step, on the first step's page
    // (or the password step's): its email field back with an error message, or a first step its forms show again with
    // the email field back or an error message. The password field is gone, but nobody signed in.
    if (onFirstStepPage()) {
      const said = await freshErrors();
      const fieldBack = await firstFieldBack();
      if ((fieldBack && said.length > 0) || ((fieldBack || said.length > 0) && (await firstStepShown()))) {
        const quote = said.slice(0, 2).join(" ").slice(0, 300);
        if (await showsCaptcha(page)) throw new SignInError(captchaMessage(quote));
        if (quote) throw new SignInError(`${label} could not sign in: the sign-in page said "${quote}".`);
        throw new SignInError(`${label} could not sign in: after the password, the sign-in page went back to asking for the email.`);
      }
    }

    // 7. The session, in memory only. IndexedDB too: some apps (Firebase Auth) keep their session there. sessionStorage
    // (0.6.0) of the landing origin, and of the sign-in origin through a popup (readSessionStorage), read last.
    readingState = true;
    const state = await context
      .storageState({ indexedDB: true })
      .catch(() => context!.storageState())
      .finally(() => {
        readingState = false;
      });
    const landedUrl = page.url();
    const kept = await readSessionStorage(page, loginOrigin, (on) => {
      probeWanted = on;
      admitNext = on;
    });
    // The landing page may have tried something while the probe was opened (a tab of its own, from a replaced
    // window.open): what was stopped then fails the sign-in too.
    inAddress();
    elsewhere();
    workerStarted();
    // Returned (and so seeded into every context of the identity) only when the session lives there (0.6.0 review,
    // round 1: sessionInStorage); else read by localStorage's rules. The ids the app's own addresses carried are left
    // out of the secrets either way.
    const hosts = [loginHost, ...(isWebUrl(landedUrl) ? [new URL(landedUrl).hostname] : [])];
    const inStorage = sessionInStorage(state, kept, credentials, cookiesBefore, hosts);
    // A session that holds the password (0.6.0 review, round 2: a "remember me" hint cookie, a login draft in
    // localStorage) is never handed to the run: every check context would be seeded with it, and the app's pages could
    // carry it to another origin, where no sign-in layer watches any more.
    const keptIn = passwordKeptIn(state, inStorage ? kept : [], password, account.username);
    if (keptIn) {
      throw new SignInError(
        `${label} could not sign in: the sign-in page on ${shownUrl} keeps the password in ${keptIn}, and Run Hound won't carry it into the run, where the app's pages could send it to another site. Make the app stop keeping the password there.`,
      );
    }
    const addressValues = inStorage ? idsInAddresses(addresses, new Set(kept.map((e) => e.origin)), credentials) : new Set<string>();
    // Registered before the landing address is redacted: an implicit flow leaves its token in the address's hash.
    const secrets = sessionSecrets(state, kept, { sessionStorageSession: inStorage, addressValues });
    registrations.push(registerSecretLiterals(secrets));
    return { state, landedOn: redactSecrets(landedUrl), secrets, ...(inStorage ? { sessionStorage: kept } : {}) };
  } finally {
    // Closing the context runs no pagehide handler in its pages: nothing is sent on the way out. The browser-level
    // session ends after it, so no tab of the context is ever left without it.
    await context?.close().catch(() => undefined);
    await releaseBrowser?.();
  }
}
