/**
 * Signing in as a test account (0.4.0, docs/v2-spec.md "Signing in"). Deterministic: find the sign-in form, fill the
 * identifier and the password, submit, and decide from the page whether it worked. No evidence is captured and the
 * session never touches the disk.
 */
import type { Browser, BrowserContext, Page } from "playwright";
import { DEFAULT_LABELS } from "../accounts/config.js";
import type { TestAccount } from "../accounts/types.js";
import type { DiscoveredForm, FormField } from "../core/types.js";
import { BROWSER_LOCALE } from "./context.js";
import { discoverPage } from "./discover.js";
import { cleanErrorMessage, explainNavigationError, TargetNotAllowedError } from "./errors.js";
import { guardContext, guardSummary } from "./guard.js";
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
const SIGN_UP_WORDS = /\b(sign[\s-]?up|register|registration|create\s+(an?\s+|your\s+|my\s+|new\s+)?account|new\s+account|join|get\s+started)\b/i;

/** The form's name and its submit control's name: what the form says it does. */
function formWords(form: DiscoveredForm): string {
  const submit = form.controls.find((c) => c.isSubmit);
  return `${form.name ?? ""} ${submit?.accessibleName ?? ""} ${submit?.text ?? ""}`;
}

/**
 * The sign-in form (spec step 2): of the forms with a password field, never one that creates an account (it says
 * sign up / create account / register, or every password field is a new-password), then the best by: a password with
 * autocomplete=current-password, sign-in words in its name or submit control, exactly one password field. The first
 * wins a tie. A sign-up form placed before the sign-in form must never receive the account's credentials.
 */
export function signInForm(forms: DiscoveredForm[]): DiscoveredForm | null {
  let best: DiscoveredForm | null = null;
  let bestScore = -1;
  for (const form of forms) {
    const passwords = form.fields.filter(isPassword);
    if (passwords.length === 0) continue;
    if (passwords.every((f) => /new-password/i.test(f.autocomplete ?? ""))) continue;
    const words = formWords(form);
    const saysSignIn = SIGN_IN_WORDS.test(words);
    if (SIGN_UP_WORDS.test(words) && !saysSignIn) continue;
    const score =
      (passwords.some((f) => /current-password/i.test(f.autocomplete ?? "")) ? 4 : 0) + (saysSignIn ? 2 : 0) + (passwords.length === 1 ? 1 : 0);
    if (score > bestScore) {
      best = form;
      bestScore = score;
    }
  }
  return best;
}

/** Names of cookies and storage keys that usually hold a session. */
const SESSION_NAME = /sess|sid|auth|token|jwt|remember|login|identity|credential|secret|key|bearer/i;
const JWT = /^eyJ[\w-]+\.eyJ[\w-]+\.[\w-]*$/;

/** A value random enough to be a session id or token, not a setting such as "dark" or "en-US". */
function looksLikeToken(value: string): boolean {
  if (value.length < 8 || /\s/.test(value)) return false;
  return value.length >= 24 || (/\d/.test(value) && /[A-Za-z]/.test(value));
}

/** One IndexedDB database as storageState({ indexedDB: true }) returns it (only what sessionSecrets reads). */
interface IndexedDbState {
  stores?: { name?: string; records?: { key?: unknown; value?: unknown }[] }[];
}

/**
 * The values of `state` that identify the session, for redaction: cookie values that look like session ids or tokens,
 * and the tokens an app keeps in localStorage or IndexedDB (a plain value under a token-like key, a JWT, or the token
 * fields of a JSON value such as Supabase's "sb-…-auth-token" or Firebase's auth user).
 */
export function sessionSecrets(state: SessionState): string[] {
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
    for (const { name, value } of origin.localStorage) {
      let parsed: unknown = undefined;
      if (/^\s*[[{"]/.test(value)) {
        try {
          parsed = JSON.parse(value);
        } catch {
          parsed = undefined;
        }
      }
      walk(parsed === undefined ? value : parsed, name, 0);
    }
  }
  return [...out];
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

/** True when the page offers sign-in through another provider ("Continue with Google"). */
async function offersProviders(page: Page): Promise<boolean> {
  const text = String(await page.evaluate("document.body ? document.body.innerText.slice(0, 4000) : ''").catch(() => ""));
  return /(continue|sign\s?-?in|log\s?-?in)\s+with\s+(google|github|microsoft|apple|facebook|gitlab|twitter|linkedin|slack|discord|sso)\b/i.test(text);
}

/** True when a value of the URL's query (or its hash) is exactly `secret`: a password sent in the page address. */
function carriesInQuery(url: URL, secret: string): boolean {
  if (!secret) return false;
  for (const value of url.searchParams.values()) if (value === secret) return true;
  if (url.hash.length > 1) {
    for (const value of new URLSearchParams(url.hash.slice(1)).values()) if (value === secret) return true;
  }
  return false;
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

/**
 * Signs `account` in with a fresh, guarded browser context (docs/v2-spec.md "Signing in", steps 1-7) and returns its
 * session. Throws SignInError when the slot isn't ready, the login URL fails the safety gate, no sign-in form is found,
 * the form is still shown after submitting (with the page's own error text, redacted), or the page asks for a code or
 * a captcha (not supported).
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
  try {
    context = await browser.newContext({ locale: BROWSER_LOCALE });
    const guard = await guardContext(context, safety);
    // A form that sends the password in the address (a GET form) would put it in the app's access log and the
    // browser history: such a request is stopped before it leaves the browser, and signing in fails with the reason.
    let passwordInAddress = false;
    await context.route(
      (url) => carriesInQuery(url, account.password!),
      async (route) => {
        passwordInAddress = true;
        await route.abort("blockedbyclient").catch(() => undefined);
      },
    );
    const inAddress = () => {
      if (!passwordInAddress) return;
      throw new SignInError(
        `${label} could not sign in: the sign-in form on ${shownUrl} sends the password in the page address (a GET form), where it ends up in server logs and the browser history. Run Hound stopped it before it was sent. Make the form send the password in a POST request.`,
      );
    };
    const page = await context.newPage();
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

    // 2. The sign-in form.
    const form = signInForm((await discoverPage(page)).forms);
    if (!form) {
      const providers = (await offersProviders(page)) ? " Sign-in through another provider (Google, GitHub, …) isn't supported." : "";
      throw new SignInError(`No sign-in form (a form with a password field) was found on ${shownUrl}.${providers}`);
    }
    const passwordField = form.fields.find(isPassword)!;
    // 3. The identifier field.
    const idField = identifierField(form);
    if (!idField) throw new SignInError(`The sign-in form on ${shownUrl} has a password field but no field for the username or email.`);

    // 4. Fill in and submit.
    const passwordBox = page.locator(passwordField.selector).first();
    try {
      await page.locator(idField.selector).first().fill(account.username, { timeout: ACTION_TIMEOUT_MS });
      await passwordBox.fill(account.password!, { timeout: ACTION_TIMEOUT_MS });
    } catch (err) {
      throw new SignInError(`${label} could not fill in the sign-in form on ${shownUrl}: ${firstLine(err)}`);
    }
    const before = page.url();
    const alertsBefore = new Set(await errorTexts(page, form.selector));
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
    const deadline = Date.now() + SUBMIT_WAIT_MS;
    let alertSince: number | null = null;
    let doneSince: number | null = null;
    while (Date.now() < deadline) {
      if (passwordInAddress || page.isClosed()) break;
      const left = !samePage(page.url(), before);
      const gone = left || !(await passwordBox.isVisible().catch(() => false));
      if (gone) {
        doneSince ??= Date.now();
        if (Date.now() - doneSince >= SETTLED_MS) break;
      } else {
        doneSince = null;
        if (alertSince === null) {
          const fresh = (await errorTexts(page, form.selector)).filter((t) => !alertsBefore.has(t));
          if (fresh.length > 0) alertSince = Date.now();
        } else if (Date.now() - alertSince >= ALERT_GRACE_MS) break;
      }
      await sleep(POLL_MS);
    }
    inAddress();
    leftTarget();
    await page.waitForLoadState("load", { timeout: SUBMIT_WAIT_MS }).catch(() => undefined);
    await page.waitForLoadState("networkidle", { timeout: NETWORK_IDLE_MS }).catch(() => undefined);
    inAddress();
    leftTarget();

    // 6. Decide from the page.
    const onSignInPage = samePage(page.url(), before);
    if (await showsCodeField(page, onSignInPage)) {
      throw new SignInError(
        `${label}'s sign-in asks for a verification code after the password. Codes (multi-factor sign-in) aren't supported: use a test account that signs in with a password alone.`,
      );
    }
    const stillShown =
      (await passwordBox.isVisible().catch(() => false)) || (onSignInPage && (await page.locator("input[type=password]:visible").count().catch(() => 0)) > 0);
    if (stillShown) {
      const said = (await errorTexts(page, form.selector)).filter((t) => !alertsBefore.has(t));
      const quote = said.slice(0, 2).join(" ").slice(0, 300);
      if (await showsCaptcha(page)) {
        throw new SignInError(
          `${label} could not sign in: the sign-in form has a captcha, and captchas aren't supported. Turn it off for test accounts in your development setup.${quote ? ` The page said: "${quote}"` : ""}`,
        );
      }
      if (quote) throw new SignInError(`${label} could not sign in: the sign-in page said "${quote}".`);
      throw new SignInError(`${label} could not sign in: the sign-in form was still shown after submitting, and the page showed no error. ${await whatWasSent(sent)}`);
    }

    // 7. The session, in memory only. IndexedDB too: some apps (Firebase Auth) keep their session there.
    const state = await context.storageState({ indexedDB: true }).catch(() => context!.storageState());
    const secrets = sessionSecrets(state);
    registrations.push(registerSecretLiterals(secrets));
    return { state, landedOn: redactSecrets(page.url()), secrets };
  } finally {
    await context?.close().catch(() => undefined);
  }
}
