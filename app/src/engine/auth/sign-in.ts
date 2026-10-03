/**
 * Sign-in orchestration: `signIn` opens a guarded browser context, walks the sign-in form (one-step or two-step),
 * types the password in its own document (never through the page keyboard), watches the page for a settled
 * outcome, and returns the session (state, secrets, optional sessionStorage). Hardening, storage probe and password
 * type-in live here too. Browser guards (stopUnrouted, guardSignInBrowser) come from `./browser-guards`; the
 * password-leak stop predicate (stops) is composed here from `carriesPassword` (./password-detection) and the
 * `passwordIn`-derived helpers in `./password-primitives`.
 */
import type { Browser, BrowserContext, ElementHandle, Page, Route } from "playwright";
import { BROWSER_LOCALE } from "../context.js";
import { discoverPage } from "../discover.js";
import { cleanErrorMessage, explainNavigationError, TargetNotAllowedError } from "../errors.js";
import { guardContext, guardSummary } from "../guard.js";
import { ISOLATED_CONTEXT } from "../isolation.js";
import { redactSecrets, registerSecretLiterals } from "../redact.js";
import { checkTarget, type SafetyOptions } from "../safety.js";
import type { DiscoveredForm, FormField } from "../../core/types.js";
import { originOf } from "../../core/saves.js";
import { DEFAULT_LABELS } from "../../config/accounts.js";
import type { TestAccount } from "../../interfaces/accounts.js";
import type { FirstStep, Sent, SignedIn } from "../../interfaces/auth.js";
import type { CookieJar, SessionState } from "../../types/auth.js";
import {
  ACTION_TIMEOUT_MS,
  ALERT_GRACE_MS,
  LOAD_TIMEOUT_MS,
  NETWORK_IDLE_MS,
  POLL_MS,
  SETTLED_MS,
  SUBMIT_WAIT_MS,
} from "../../constants/auth-constants.js";
import { guardSignInBrowser, stopUnrouted } from "./browser-guards.js";
import {
  errorTexts,
  firstStepForm,
  hasCurrentPassword,
  identifierField,
  identifierNeeded,
  NEW_PASSWORD_SHOWN,
  offersProviders,
  passFirstStep,
  passwordlessWords,
  passwordStepForm,
  showsCaptcha,
  showsCaptchaChallenge,
  showsCodeField,
  showsCodeStep,
  signInForm,
  signUpReason,
  signsInItself,
} from "./form-detection.js";
import { SignInError, continuedElsewhere as buildContinuedElsewhere } from "../../errors/sign-in-error.js";
import {
  carriesInQuery,
  carriesUnderPasswordKey,
  hostCarries,
  isWeak,
  passwordIn,
  queryCarries,
  safeDecode,
} from "./password-primitives.js";
import {
  carriesPassword,
  isCredentialName,
  sentOf,
} from "./password-detection.js";
import {
  idsInAddresses,
  MAX_ADDRESSES,
  passwordKeptIn,
  sessionInStorage,
  sessionSecrets,
  SESSION_NAME,
} from "./session-detection.js";

export { SignInError };

/** The account's name in messages: its label, else "Account A" / "Account B". */
export function accountLabel(account: Pick<TestAccount, "id" | "label">): string {
  return account.label?.trim() || DEFAULT_LABELS[account.id] || "The test account";
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** "a", "a and b", "a, b and c". */
function listWords(words: string[]): string {
  return words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** Why the slot can't be used yet, or null when it has a sign-in page, a username and a password. */
export function notSetUp(account: TestAccount, label: string): string | null {
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

function firstLine(err: unknown): string {
  return cleanErrorMessage(err instanceof Error ? err.message : String(err)).split("\n")[0] ?? "";
}

const isWebUrl = (url: string) => /^https?:\/\//i.test(url);

/**
 * Same origin and path (query and hash ignored).
 */
export function samePage(a: string, b: string): boolean {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.origin === y.origin && x.pathname === y.pathname;
  } catch {
    return a === b;
  }
}

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

/**
 * The contract's message for a two-step sign-in whose password step is on another origin (0.6.0).
 */
const continuedElsewhere = (url: string): SignInError => buildContinuedElsewhere(url, redactSecrets);

/**
 * Runs before any script in every page and frame of the guarded sign-in context (0.6.0 review). The script body is
 * serialized and sent to the browser; it MUST NOT reference any module-level value (the worker / WebRTC / WebTransport
 * constructors it replaces, the MutationObserver, the WeakSet, the spec regex, etc. are inlined as `function () { … }`
 * values that hide their name from `tsx`/`esbuild`'s `keepNames` `__name` helper). Exported for the syntax-check
 * regression in tests/features/engine/auth/auth-hardening-script.test.ts so a typo here fails vitest at parse time.
 */
export const SIGN_IN_HARDENING = String.raw`(() => {
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
})()`;

/** A page Run Hound serves itself (a route) on the sign-in origin, to read its sessionStorage once the tab has moved on. */
const STORAGE_PROBE_PATH = "/__run-hound__/session-storage";

async function storageItems(page: Page): Promise<{ name: string; value: string }[]> {
  return (await page.sessionStorage.items().catch(() => [])).map(({ name, value }) => ({ name, value }));
}

/** Reads sessionStorage for both the sign-in origin (via popup probe) and the landing origin. */
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

/** What says who is signed in, now (0.6.0 review, round 1): each cookie with a session-like name as its name and value. */
async function sessionMarksImpl(context: BrowserContext, page: Page): Promise<Set<string>> {
  const out = new Set<string>();
  for (const c of await context.cookies().catch(() => [])) if (c.value && SESSION_NAME.test(c.name)) out.add(`cookie ${c.domain} ${c.path} ${c.name}=${c.value}`);
  if (page.isClosed()) return out;
  const items = [...(await page.localStorage.items().catch(() => [])), ...(await page.sessionStorage.items().catch(() => []))];
  const stored: SessionState = { cookies: [], origins: [{ origin: "", localStorage: items.map(({ name, value }) => ({ name, value })) }] };
  for (const value of sessionSecrets(stored, [], { sessionStorageSession: false })) out.add(`storage ${value}`);
  return out;
}

/**
 * Types `password` into the field `handle` points at, inside that field's own document and never through the page
 * keyboard (0.6.0 review). The page.evaluate callback declares no named function: tsx/esbuild's keepNames would wrap
 * one in a `__name` helper the browser doesn't have.
 */
async function typePassword(handle: ElementHandle<Node>, password: string): Promise<void> {
  await handle.waitForElementState("visible", { timeout: ACTION_TIMEOUT_MS });
  await handle.waitForElementState("editable", { timeout: ACTION_TIMEOUT_MS });
  const outcome = await handle.evaluate((node, value) => {
    const field = node as HTMLInputElement | HTMLTextAreaElement;
    if (!field.isConnected) return "detached";
    const doc = field.ownerDocument;
    field.focus();
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

/** Re-exported here so signInReady's storage-probe wiring still has a name to import. */
export { STORAGE_PROBE_PATH };

/**
 * Signs `account` in with a fresh, guarded browser context and returns its session.
 */
export async function signIn(browser: Browser, account: TestAccount, safety: SafetyOptions = {}): Promise<SignedIn> {
  const label = accountLabel(account);
  const problem = notSetUp(account, label);
  if (problem) throw new SignInError(problem);
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
    context = await browser.newContext({ locale: BROWSER_LOCALE, serviceWorkers: "block", ...ISOLATED_CONTEXT });
    await context.addInitScript(SIGN_IN_HARDENING);
    const guard = await guardContext(context, safety);
    const password = account.password!;
    const loginOrigin = new URL(loginUrl).origin;
    const weak = isWeak(password);
    const holds = passwordIn(password);
    let passwordTyped = false;
    let passwordInAddress: "navigation" | "request" | null = null;
    const passwordIsUsername = password === account.username;
    let passwordElsewhere: string | null = null;
    let passwordInHostName = false;
    const loginHost = new URL(loginUrl).hostname;
    let refusedWorker: string | null = null;
    const refuse = (what: string) => {
      refusedWorker ??= what;
    };
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
    await stopUnrouted(page, stops, refuse);
    const probeUrl = `${loginOrigin}${STORAGE_PROBE_PATH}`;
    let probeWanted = false;
    let admitNext = false;
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

    try {
      await page.goto(loginUrl, { waitUntil: "load", timeout: LOAD_TIMEOUT_MS });
    } catch (err) {
      leftTarget();
      const explained = explainNavigationError(err, loginUrl);
      throw new SignInError(`${label}'s sign-in page could not be opened: ${firstLine(explained)}`);
    }
    await page.waitForLoadState("networkidle", { timeout: NETWORK_IDLE_MS }).catch(() => undefined);
    leftTarget();

    const whereNow = (): string | null => {
      const now = page.isClosed() ? "" : page.url();
      if (isWebUrl(now)) return originOf(now);
      const refused = guard.blocked.at(-1)?.split(/\s+/).find(isWebUrl);
      return refused ? originOf(refused) : null;
    };
    const ledElsewhere = (where: string | null = null) => {
      if (where === null && !page.isClosed() && originOf(page.url()) === loginOrigin) return;
      const to = where ?? whereNow();
      throw new SignInError(
        to
          ? `${label} could not sign in: ${shownUrl} led to ${redactSecrets(to)}, and the password is only typed on ${redactSecrets(loginOrigin)}, the sign-in page it was saved for.`
          : `${label} could not sign in: ${shownUrl} didn't stay on ${redactSecrets(loginOrigin)}, and the password is only typed on ${redactSecrets(loginOrigin)}, the sign-in page it was saved for.`,
      );
    };

    const found = await discoverPage(page);
    let form = signInForm(found.forms);
    let first: FirstStep | null = null;
    if (form && !hasCurrentPassword(form)) {
      const step = await firstStepForm(page, found.forms, loginUrl);
      if (step && !signsInItself(form, step)) {
        first = step;
        form = null;
      }
    }
    const twoStep = form === null;
    let firstStep: { url: string; field: string; form: string } | null = null;
    if (!form) {
      first ??= await firstStepForm(page, found.forms, loginUrl);
      if (!first) {
        const sends = passwordlessWords(found.forms);
        const passwordless = sends
          ? ` The page signs in with a link or a code it sends ("${sends}"), and that isn't supported: use a test account that signs in with a password.`
          : "";
        const providers = (await offersProviders(page)) ? " Sign-in through another provider (Google, GitHub, …) isn't supported." : "";
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
    const idField = identifierField(form);
    if (!idField && !twoStep) throw new SignInError(`The sign-in form on ${shownUrl} has a password field but no field for the username or email.`);

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
      if (idField && (!twoStep || (await identifierNeeded(page, idField, account.username)))) {
        await page.locator(idField.selector).first().fill(account.username, { timeout: ACTION_TIMEOUT_MS });
      }
    } catch (err) {
      throw couldNotFill(err);
    }
    const cookiesBefore: CookieJar = await context.cookies().catch(() => []);
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
          workerStarted();
          try {
            passwordTyped = true;
            await typePassword(handle, password);
            break;
          } catch (err) {
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
    const errorScopes = [...new Set([signInScope, ...(firstStep ? [firstStep.form] : [])])];
    const pageErrors = async () => [...new Set((await Promise.all(errorScopes.map((s) => errorTexts(page, s)))).flat())];
    const alertsBefore = new Set(await pageErrors());
    const freshErrors = async () => (await pageErrors()).filter((t) => !alertsBefore.has(t));
    const captchaBefore = await showsCaptcha(page);
    const marksBefore = await sessionMarksImpl(page.context(), page);
    const sessionStarted = async () => [...(await sessionMarksImpl(page.context(), page))].some((mark) => !marksBefore.has(mark));
    const onFirstStepPage = () => firstStep !== null && !page.isClosed() && (samePage(page.url(), before) || samePage(page.url(), firstStep.url));
    const firstFieldBack = async (): Promise<boolean> => {
      if (firstStep === null) return false;
      if (await page.evaluate(NEW_PASSWORD_SHOWN).then(Boolean, () => true)) return false;
      const box = page.locator(firstStep.field).first();
      if (!(await box.isVisible().catch(() => false))) return false;
      return box.isEditable({ timeout: POLL_MS }).catch(() => false);
    };
    const firstStepShown = async (): Promise<boolean> => {
      const forms = await discoverPage(page).then(
        (p) => p.forms,
        () => [] as DiscoveredForm[],
      );
      return (await firstStepForm(page, forms, loginUrl).catch(() => null)) !== null;
    };
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

    if (!page.isClosed() && !isWebUrl(page.url()) && guard.blocked.length > 0) {
      const to = whereNow();
      throw new SignInError(
        `${label} could not sign in: after submitting, the sign-in page went to ${to ? redactSecrets(to) : "another site"}, which Run Hound is not allowed to open. Sign-in through another site (Google, GitHub, …) isn't supported.`,
      );
    }
    const onSignInPage = samePage(page.url(), before);
    const stillShown =
      (await passwordBox.isVisible().catch(() => false)) || (onSignInPage && (await page.locator("input[type=password]:visible").count().catch(() => 0)) > 0);
    if ((await showsCodeField(page, onSignInPage)) || ((!onSignInPage || !stillShown) && (await showsCodeStep(page)))) {
      throw new SignInError(
        `${label}'s sign-in asks for a verification code after the password. Codes (multi-factor sign-in) aren't supported: use a test account that signs in with a password alone.`,
      );
    }
    const captchaMessage = (quote: string) =>
      `${label} could not sign in: the sign-in form has a captcha, and captchas aren't supported. Turn it off for test accounts in your development setup.${quote ? ` The page said: "${quote}"` : ""}`;
    if (!stillShown && onSignInPage && !captchaBefore && (await showsCaptcha(page)) && !(await sessionStarted())) {
      throw new SignInError(captchaMessage((await freshErrors()).slice(0, 2).join(" ").slice(0, 300)));
    }
    if (!stillShown && !onSignInPage && (await showsCaptchaChallenge(page))) throw new SignInError(captchaMessage(""));
    if (stillShown) {
      const quote = (await freshErrors()).slice(0, 2).join(" ").slice(0, 300);
      if (await showsCaptcha(page)) throw new SignInError(captchaMessage(quote));
      if (quote) throw new SignInError(`${label} could not sign in: the sign-in page said "${quote}".`);
      if (tabsClosed > 0) {
        throw new SignInError(
          `${label} could not sign in: the sign-in form on ${shownUrl} opens a new tab or window, and Run Hound closes any tab a sign-in opens (one could carry the password to another site).`,
        );
      }
      throw new SignInError(`${label} could not sign in: the sign-in form was still shown after submitting, and the page showed no error. ${await whatWasSent(sent)}`);
    }
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
    inAddress();
    elsewhere();
    workerStarted();
    const hosts = [loginHost, ...(isWebUrl(landedUrl) ? [new URL(landedUrl).hostname] : [])];
    const inStorage = sessionInStorage(state, kept, credentials, cookiesBefore, hosts);
    const keptIn = passwordKeptIn(state, inStorage ? kept : [], password, account.username);
    if (keptIn) {
      throw new SignInError(
        `${label} could not sign in: the sign-in page on ${shownUrl} keeps the password in ${keptIn}, and Run Hound won't carry it into the run, where the app's pages could send it to another site. Make the app stop keeping the password there.`,
      );
    }
    const addressValues = inStorage ? idsInAddresses(addresses, new Set(kept.map((e) => e.origin)), credentials) : new Set<string>();
    const secrets = sessionSecrets(state, kept, { sessionStorageSession: inStorage, addressValues });
    registrations.push(registerSecretLiterals(secrets));
    return { state, landedOn: redactSecrets(landedUrl), secrets, ...(inStorage ? { sessionStorage: kept } : {}) };
  } finally {
    await context?.close().catch(() => undefined);
    await releaseBrowser?.();
  }
}
