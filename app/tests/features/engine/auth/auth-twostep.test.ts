/**
 * signIn on two-step sign-in pages (0.6.0, docs/v2-spec.md "Sign-in: two-step and sessionStorage"): the sign-in page
 * has no form with a password field, but a sign-in form with an identifier field and a "Continue"/"Next" control.
 * signIn fills the identifier, continues, waits for the password field (on the same page, or on the next page when
 * that page is on the sign-in origin), then finishes as a one-step sign-in. Every guarantee of "Signing in" holds:
 * - the password is typed only on the sign-in page's origin: a second step on another origin fails with "The sign-in
 *   continued on another site (<host>), so Run Hound won't type the password there." (<host> is URL.host, with the
 *   port), whether that origin is one the safety gate allows (the page lands there) or refuses (the page's own
 *   navigation there is blocked, or the first step's POST is answered with a redirect there and the guard stops it);
 *   a two-step sign-in page reached by a redirect to another origin gets nothing typed, not even the email;
 * - a code or a captcha after the first step fails with the existing messages, whether it replaces the password step
 *   or comes with it or after it (a code after the password, a reCAPTCHA widget beside the password);
 * - a sign-up form is never filled, even when it sits before the sign-in form and also says "Continue", or when the
 *   first step turns into one;
 * - no password field after the first step (a sign-in link was emailed instead) fails and says so;
 * - a password step that would send the password in the address (a GET form) or to another origin is stopped with the
 *   existing messages, and one in a frame from another origin is never typed into;
 * - the first step's control may be a plain "Next"/"Continue" button (not a submit control) or sit outside any <form>;
 *   a "Continue with Google" button beside it is never clicked; a password-reset form before it is never filled;
 * - the password field may appear seconds after Continue, with the network idle meanwhile.
 *
 * Where the first step's sign-in words may come from (a decision, see the lead's log): the form's name or submit
 * control, document.title, the text just before the form, or the sign-in URL's path. A page with none of them (the
 * newsletter) is still refused, and so is a form whose own words say it does something else (Subscribe, a newsletter,
 * search, a password reset), even on a page whose address says login.
 *
 * Regression guards that pass before two-step exists (they don't show that two-step works): the page whose only form
 * creates an account, the newsletter page, the newsletter form at a /login-… address, and the first step with a
 * visually hidden autofill password field (the one-step path fills that field and signs in).
 *
 * Runs against the accounts app's two-step variants (test-support/accounts-app.ts: "two-step" reveals the password in
 * the same form, "two-step-page" asks for it on /login/password) and one-off pages served below: the password row
 * pre-rendered but hidden, or added to the form only after Continue; a single-page app that replaces the form and moves
 * the address with history.pushState (Clerk's shape, with and without the email repeated read-only); a first step with
 * a visually hidden autofill password field; and a classic server-rendered POST-and-redirect pair of pages whose
 * sign-in words are only in the title, the text and the address (Auth0 Universal Login's shape).
 */
import { randomBytes } from "node:crypto";
import type { ServerResponse } from "node:http";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startAccountsApp, type AccountsApp, type AccountsAppOptions } from "../../test-support/accounts-app.js";
import { closeBrowser, getBrowser } from "../../test-support/harness.js";
import { json, startFixtureServer, type FixtureServer, type RecordedRequest } from "../../test-support/server.js";
import type { TestAccount } from "../interfaces/accounts.js";
import { signIn, signInForm, SignInError, type SessionState, type SignedIn } from "./auth.js";
import { discoverPage } from "./discover.js";

const EMAIL = "someone@example.test";
const PASSWORD = "tw0-step(pass)~9753";

let browser: Browser;
/** The one-off two-step pages (127.0.0.1). */
let pages: FixtureServer;
/** Another site: a password page reached as http://localhost:<its port>, where the password must never be typed. */
let away: FixtureServer;
let awayOrigin: string;
/**
 * A host the safety gate refuses (it stands in for an identity provider on the internet): the gate's injected DNS
 * (REFUSED_SSO) says it is public. A browser launched with --host-resolver-rules maps it to 127.0.0.1, so a request
 * that got through would reach `away` and be recorded there; the shared browser has no such rule, and its tests stop
 * the navigation before it leaves the browser.
 */
const SSO_HOST = "sso.example.test";
const REFUSED_SSO = { lookup: async (host: string) => (host === SSO_HOST ? ["93.184.216.34"] : ["127.0.0.1"]) };
const apps = new Map<string, AccountsApp>();

/** One accounts app per option set, started once for the file. */
async function app(options: AccountsAppOptions): Promise<AccountsApp> {
  const key = JSON.stringify({ tokenMode: options.tokenMode ?? "cookie", loginVariant: options.loginVariant ?? "email" });
  let found = apps.get(key);
  if (!found) {
    found = await startAccountsApp(options);
    apps.set(key, found);
  }
  found.reset();
  found.signOutEveryone();
  return found;
}

/** A test account for a one-off page. */
function account(path: string): TestAccount {
  return { id: "a", label: "Account A", loginUrl: `${pages.url}${path}`, username: EMAIL, password: PASSWORD };
}

/** The error signIn rejected with; fails the test when it resolved or threw anything but a SignInError. */
async function failure(promise: Promise<SignedIn>): Promise<SignInError> {
  const outcome = await promise.then(
    () => "resolved" as const,
    (err: unknown) => err,
  );
  expect(outcome, "signIn should have rejected with a SignInError").toBeInstanceOf(SignInError);
  return outcome as SignInError;
}

/** Who the accounts app says is signed in when a new browser context opens /settings with `state`. */
async function signedInEmail(target: AccountsApp, state: SessionState): Promise<string | null> {
  const context = await browser.newContext({ storageState: state });
  try {
    const page = await context.newPage();
    await page.goto(`${target.url}/settings`);
    await page.locator("#me-email, #signin-form").first().waitFor({ timeout: 10_000 });
    return (await page.locator("#me-email").count()) > 0 ? await page.locator("#me-email").textContent() : null;
  } finally {
    await context.close();
  }
}

/** GET /api/me with a raw credential header, outside any browser. */
async function me(target: AccountsApp, headers: Record<string, string>): Promise<{ status: number; email?: string }> {
  const res = await fetch(`${target.url}/api/me`, { headers });
  const body = (await res.json().catch(() => ({}))) as { email?: string };
  return { status: res.status, email: body.email };
}

function decoded(text: string): string {
  try {
    return decodeURIComponent(text.replace(/\+/g, " "));
  } catch {
    return text;
  }
}

/** True when the request carries `secret` anywhere: its address or its body, as sent or URL-decoded. */
function carries(r: RecordedRequest, secret: string): boolean {
  return [r.url, r.body].some((part) => part.includes(secret) || decoded(part).includes(secret));
}

/** The typing the one-off pages reported (see reportTyping), as "<form>/<field id>", in order. */
function typed(): string[] {
  return pages.requests
    .filter((r) => r.method === "GET" && r.url.startsWith("/api/typed?"))
    .map((r) => {
      const query = new URL(r.url, "http://x").searchParams;
      return `${query.get("form")}/${query.get("field")}`;
    });
}

const shell = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body><main>${body}</main></body></html>`;

function sendHtml(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  res.end(body);
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * In-page helpers for the one-off pages: report typing into a form's fields (the field's length only, never its value),
 * and run a two-step sign-in form: the first submit calls `onFirst(email)`, the next one posts the email and the
 * password to /api/login and goes to /home.
 */
const HELPERS = `<script>
function reportTyping(form, name) {
  form.querySelectorAll("input").forEach(function (input) {
    input.addEventListener("input", function () { fetch("/api/typed?form=" + name + "&field=" + input.id + "&len=" + input.value.length); });
  });
}
function twoStep(form, onFirst) {
  var first = true;
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var email = form.querySelector("input[type=email]").value;
    if (first) { first = false; onFirst(email); return; }
    fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: email, password: form.querySelector("input[type=password]").value }) })
      .then(function (r) { if (r.ok) location.assign("/home"); else r.json().then(function (d) { var a = form.querySelector("[role=alert]"); a.textContent = d.error; a.hidden = false; }); });
  });
}
function reveal(id) { return function () { var row = document.getElementById(id); row.hidden = false; row.querySelector("input").focus(); }; }
</script>`;

/**
 * A two-step sign-in form: email, a hidden password row (unless `passwordRow` is false: then the page adds the field
 * after Continue) and a submit control named `control`.
 */
const signInStep = (control: string, passwordRow = true) => `<form id="signin" aria-label="Sign in">
<label for="li-email">Email</label><input id="li-email" type="email" name="email" autocomplete="username">
${passwordRow ? `<p id="li-pass-row" hidden><label for="li-pass">Password</label><input id="li-pass" type="password" name="password" autocomplete="current-password"></p>` : ""}
<button type="submit">${control}</button><p role="alert" id="li-error" hidden></p></form>`;

/**
 * A single-page sign-in (Clerk's shape) at `base`: step one is an unnamed form (named by the page's heading) with the
 * email and "Continue". Its submit removes that form, moves the address to <base>/factor-one with history.pushState and
 * inserts a new form: the email shown as text with an "Edit" link (or, with `keepEmail`, repeated in a read-only email
 * field before the password), the password (#pw) and "Continue", which posts both to /api/login and goes to /home.
 */
const spaSignIn = (base: string, keepEmail: boolean) =>
  shell(
    "Sign in",
    `<h1>Sign in to Acme</h1><div id="root"></div>
<script>
var BASE = ${JSON.stringify(base)}, KEEP = ${keepEmail ? "true" : "false"};
var root = document.getElementById("root");
function stepOne() {
  var form = document.createElement("form");
  form.innerHTML = '<label for="identifier">Email address</label><input id="identifier" type="email" name="identifier" autocomplete="username"><button type="submit">Continue</button>';
  root.appendChild(form);
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var email = document.getElementById("identifier").value;
    form.remove();
    history.pushState(null, "", BASE + "/factor-one");
    stepTwo(email);
  });
}
function stepTwo(email) {
  var form = document.createElement("form");
  form.innerHTML = (KEEP
      ? '<label for="kept">Email address</label><input id="kept" type="email" name="email" autocomplete="username" readonly>'
      : '<p><span id="shown-email"></span> <a href="' + BASE + '">Edit</a></p>') +
    '<label for="pw">Password</label><input id="pw" type="password" name="password" autocomplete="current-password">' +
    '<button type="submit">Continue</button><p role="alert" id="pw-error" hidden></p>';
  root.appendChild(form);
  if (KEEP) document.getElementById("kept").value = email; else document.getElementById("shown-email").textContent = email;
  document.getElementById("pw").focus();
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: email, password: document.getElementById("pw").value }) })
      .then(function (r) { if (r.ok) location.assign("/home"); else r.json().then(function (d) { var a = document.getElementById("pw-error"); a.textContent = d.error; a.hidden = false; }); });
  });
}
stepOne();
</script>`,
  );

/**
 * The classic two-step pages (Auth0 Universal Login's shape): server-rendered forms, a POST and a redirect per step.
 * The first form is unnamed and says only "Continue"; the sign-in words are in the title, the text before the form and
 * the address. `classicStates` maps each first step's state to its email.
 */
const classicStates = new Map<string, string>();
/** The session id the classic password page set last. */
let classicSid = "";
const classicIdentifier = () =>
  shell(
    "Log in | Acme",
    `<h1>Welcome</h1><p>Log in to Acme to continue.</p>
<form method="post" action="/u/login/identifier">
<label for="username">Email address</label><input id="username" name="username" type="text" inputmode="email" autocomplete="username">
<button type="submit" name="action" value="default">Continue</button></form>`,
  );
const classicPassword = (state: string, email: string, error = "") =>
  shell(
    "Enter your password | Acme",
    `<h1>Enter your password</h1><p>${escapeHtml(email)} <a href="/u/login/identifier">Edit</a></p>
${error ? `<p role="alert" id="error-element-password">${escapeHtml(error)}</p>` : ""}
<form method="post" action="/u/login/password"><input type="hidden" name="state" value="${escapeHtml(state)}">
<label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password">
<button type="submit" name="action" value="default">Continue</button></form>`,
  );

beforeAll(async () => {
  browser = await getBrowser();
  away = await startFixtureServer({
    pages: {
      "/password": shell(
        "Enter your password",
        `<h1>Enter your password</h1><form id="f" aria-label="Sign in"><label for="pw">Password</label>
<input id="pw" type="password" name="password" autocomplete="current-password"><button type="submit">Sign in</button></form>
${HELPERS}<script>
var f = document.getElementById("f");
reportTyping(f, "away");
f.addEventListener("submit", function (e) { e.preventDefault(); fetch("/api/login", { method: "POST", headers: { "content-type": "text/plain" }, body: document.getElementById("pw").value }); });
</script>`,
      ),
      // A two-step sign-in page on this other origin, reached by a redirect from the sign-in URL (pages' /moved).
      "/two-step": shell(
        "Sign in",
        `<h1>Sign in</h1>${signInStep("Continue")}${HELPERS}<script>
var form = document.getElementById("signin");
reportTyping(form, "away");
twoStep(form, reveal("li-pass-row"));
</script>`,
      ),
      "/home": shell("Home", "<h1>Home</h1><p>Signed in.</p>"),
    },
    routes: {
      "GET /api/typed": (_req, res) => {
        res.writeHead(204);
        res.end();
      },
      "POST /api/login": (_req, res) => json(res, 200, { ok: true }),
    },
  });
  awayOrigin = `http://localhost:${new URL(away.url).port}`;

  pages = await startFixtureServer({
    pages: {
      // An email-only sign-up form that also says "Continue", BEFORE the two-step sign-in form.
      "/signup-first": shell(
        "Welcome",
        `<h1>Welcome</h1>
<section><h2>New here?</h2><form id="signup" aria-label="Create an account"><label for="su-email">Email</label>
<input id="su-email" type="email" name="email"><button type="submit">Continue</button></form></section>
<section><h2>Welcome back</h2>${signInStep("Continue")}</section>
${HELPERS}<script>
var su = document.getElementById("signup");
reportTyping(su, "signup");
su.addEventListener("submit", function (e) { e.preventDefault(); fetch("/api/signup", { method: "POST", body: document.getElementById("su-email").value }); });
twoStep(document.getElementById("signin"), reveal("li-pass-row"));
</script>`,
      ),
      // A sign-up form WITH password fields (new-password) before a two-step sign-in form whose control says "Next".
      "/signup-password-first": shell(
        "Welcome",
        `<h1>Welcome</h1>
<section><h2>New here?</h2><form id="signup" aria-label="Create an account"><label for="su-email">Email</label>
<input id="su-email" type="email" name="email"><label for="su-pass">Choose a password</label>
<input id="su-pass" type="password" name="password" autocomplete="new-password"><button type="submit">Create account</button></form></section>
<section><h2>Welcome back</h2>${signInStep("Next")}</section>
${HELPERS}<script>
var su = document.getElementById("signup");
reportTyping(su, "signup");
su.addEventListener("submit", function (e) { e.preventDefault(); fetch("/api/signup", { method: "POST", body: document.getElementById("su-email").value }); });
twoStep(document.getElementById("signin"), reveal("li-pass-row"));
</script>`,
      ),
      // The password field isn't in the page until Continue: the page then adds it to the same form (React's
      // `{step === "password" && …}`), instead of showing a hidden row.
      "/login-then-insert": shell(
        "Sign in",
        `<h1>Sign in</h1>${signInStep("Continue", false)}
${HELPERS}<script>
var form = document.getElementById("signin");
twoStep(form, function () {
  var row = document.createElement("p");
  row.innerHTML = '<label for="li-pass">Password</label><input id="li-pass" type="password" name="password" autocomplete="current-password">';
  form.insertBefore(row, form.querySelector("button"));
  form.querySelector("button").textContent = "Sign in";
  document.getElementById("li-pass").focus();
});
</script>`,
      ),
      // Continue replaces the form with a new one and moves the address with pushState (Clerk's shape).
      "/sign-in": spaSignIn("/sign-in", false),
      "/sign-in/factor-one": spaSignIn("/sign-in", false),
      // The same, with the email repeated in a read-only field of the password step.
      "/sign-in-kept": spaSignIn("/sign-in-kept", true),
      "/sign-in-kept/factor-one": spaSignIn("/sign-in-kept", true),
      // The first step also holds a password field, visually hidden for password managers (not aria-hidden). When it
      // is filled the first submit signs in at once; else Continue drops it and adds the real password field. Either
      // way the password goes to /api/login only.
      "/sign-in-autofill": shell(
        "Sign in",
        `<h1>Sign in to Acme</h1><form id="signin" aria-label="Sign in">
<label for="li-email">Email address</label><input id="li-email" type="email" name="identifier" autocomplete="username">
<div id="autofill" style="position:absolute;opacity:0;height:0;pointer-events:none"><input id="li-auto" type="password" name="password" tabindex="-1" autocomplete="current-password"></div>
<button type="submit">Continue</button><p role="alert" id="li-error" hidden></p></form>
<script>
var form = document.getElementById("signin");
var revealed = false;
function login(email, password) {
  fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: email, password: password }) })
    .then(function (r) { if (r.ok) location.assign("/home"); else r.json().then(function (d) { var a = document.getElementById("li-error"); a.textContent = d.error; a.hidden = false; }); });
}
form.addEventListener("submit", function (e) {
  e.preventDefault();
  var email = document.getElementById("li-email").value;
  if (revealed) return login(email, document.getElementById("li-pass").value);
  var filled = document.getElementById("li-auto").value;
  if (filled) return login(email, filled);
  revealed = true;
  document.getElementById("autofill").remove();
  var row = document.createElement("p");
  row.innerHTML = '<label for="li-pass">Password</label><input id="li-pass" type="password" name="password" autocomplete="current-password">';
  form.insertBefore(row, form.querySelector("button"));
  form.querySelector("button").textContent = "Sign in";
  document.getElementById("li-pass").focus();
});
</script>`,
      ),
      // After Continue the page asks for a code emailed to the address: no password field ever appears.
      "/login-then-mail": shell(
        "Sign in",
        `<h1>Sign in</h1>${signInStep("Continue")}
${HELPERS}<script>
var form = document.getElementById("signin");
reportTyping(form, "signin");
twoStep(form, function () {
  form.hidden = true;
  var code = document.createElement("form");
  code.setAttribute("aria-label", "Check your email");
  code.innerHTML = '<p>We emailed you a 6-digit code.</p><label for="code">Code</label><input id="code" name="code" inputmode="numeric" autocomplete="one-time-code"><button type="submit">Verify</button>';
  form.after(code);
  reportTyping(code, "code");
  code.addEventListener("submit", function (e) { e.preventDefault(); fetch("/api/verify", { method: "POST", body: document.getElementById("code").value }); });
  document.getElementById("code").focus();
});
</script>`,
      ),
      // After Continue the page asks for a captcha instead of the password (nothing in the page says captcha before).
      // The captcha form is named "Sign in" and says "Continue", like a first step.
      "/login-then-check": shell(
        "Sign in",
        `<h1>Sign in</h1>${signInStep("Continue")}
${HELPERS}<script>
var form = document.getElementById("signin");
reportTyping(form, "signin");
twoStep(form, function () {
  form.hidden = true;
  var check = document.createElement("form");
  check.setAttribute("aria-label", "Sign in");
  check.innerHTML = '<label for="captcha">Captcha: type the letters in the picture</label><input id="captcha" name="captcha" type="text"><button type="submit">Continue</button>';
  form.after(check);
  reportTyping(check, "captcha");
  check.addEventListener("submit", function (e) { e.preventDefault(); fetch("/api/captcha", { method: "POST", body: "x" }); });
});
</script>`,
      ),
      // After Continue the page emails a sign-in link: no password field, no code, no captcha, no alert.
      "/login-then-link": shell(
        "Sign in",
        `<h1>Sign in</h1>${signInStep("Continue")}
${HELPERS}<script>
var form = document.getElementById("signin");
reportTyping(form, "signin");
twoStep(form, function (email) {
  form.hidden = true;
  var p = document.createElement("p");
  p.textContent = "Check your email: we sent a sign-in link to " + email + ".";
  form.after(p);
  fetch("/api/magic", { method: "POST", body: email });
});
</script>`,
      ),
      // A "Continue with email" form that, for this email, turns into a sign-up form: a new-password field and
      // "Create account" (how many apps treat an email with no account). The password must never be typed there.
      "/login-then-create": shell(
        "Sign in",
        `<h1>Sign in</h1><form id="signin" aria-label="Sign in">
<label for="li-email">Email</label><input id="li-email" type="email" name="email" autocomplete="username">
<p id="new-row" hidden><label for="li-new">Create a password</label><input id="li-new" type="password" name="password" autocomplete="new-password"></p>
<button type="submit">Continue</button><p role="alert" id="li-error" hidden></p></form>
${HELPERS}<script>
var form = document.getElementById("signin");
reportTyping(form, "signin");
var first = true;
form.addEventListener("submit", function (e) {
  e.preventDefault();
  if (first) {
    first = false;
    form.setAttribute("aria-label", "Create your account");
    document.getElementById("new-row").hidden = false;
    form.querySelector("button").textContent = "Create account";
    document.getElementById("li-new").focus();
    return;
  }
  fetch("/api/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: document.getElementById("li-email").value, password: document.getElementById("li-new").value }) });
});
</script>`,
      ),
      // After Continue the page says it knows no such account, and shows no password field.
      "/unknown-email": shell(
        "Sign in",
        `<h1>Sign in</h1>${signInStep("Continue")}
${HELPERS}<script>
twoStep(document.getElementById("signin"), function () { var a = document.getElementById("li-error"); a.textContent = "No account uses that email address."; a.hidden = false; });
</script>`,
      ),
      // The password step is a GET form: sending it would put the password in the page address. The GET form only
      // appears in the second step (in the first, discover would take a GET form with one short field for a search).
      "/login-then-get": shell(
        "Sign in",
        `<h1>Sign in</h1>${signInStep("Continue", false)}
${HELPERS}<script>
var form = document.getElementById("signin");
twoStep(form, function (email) {
  form.hidden = true;
  var g = document.createElement("form");
  g.method = "get";
  g.action = "/session";
  g.setAttribute("aria-label", "Sign in");
  g.innerHTML = '<input type="hidden" name="email"><label for="g-pass">Password</label><input id="g-pass" type="password" name="password" autocomplete="current-password"><button type="submit">Sign in</button>';
  g.querySelector("[name=email]").value = email;
  form.after(g);
  document.getElementById("g-pass").focus();
});
</script>`,
      ),
      // The password step is on the sign-in origin, but its submit sends the password to another origin.
      "/login-then-away-post": shell(
        "Sign in",
        `<h1>Sign in</h1>${signInStep("Continue")}
${HELPERS}<script>
var form = document.getElementById("signin");
var first = true;
form.addEventListener("submit", function (e) {
  e.preventDefault();
  if (first) { first = false; reveal("li-pass-row")(); return; }
  fetch(${JSON.stringify(`${awayOrigin}/api/login`)}, { method: "POST", headers: { "content-type": "text/plain" }, body: document.getElementById("li-pass").value });
});
</script>`,
      ),
      // After Continue the password step is a frame from another origin (an embedded sign-in widget).
      "/login-then-frame": shell(
        "Sign in",
        `<h1>Sign in</h1>${signInStep("Continue", false)}
${HELPERS}<script>
var form = document.getElementById("signin");
reportTyping(form, "signin");
twoStep(form, function () {
  form.hidden = true;
  var frame = document.createElement("iframe");
  frame.title = "Sign in";
  frame.src = ${JSON.stringify(`${awayOrigin}/password`)};
  form.after(frame);
});
</script>`,
      ),
      // The first step's control is a plain button (type="button", "Next"), not a submit control: Enter does nothing,
      // only a click on Next moves on. It then reveals the password and puts a real "Sign in" submit button in its place.
      "/login-button": shell(
        "Sign in",
        `<h1>Sign in</h1><form id="signin" aria-label="Sign in">
<label for="li-email">Email</label><input id="li-email" type="email" name="email" autocomplete="username">
<p id="li-pass-row" hidden><label for="li-pass">Password</label><input id="li-pass" type="password" name="password" autocomplete="current-password"></p>
<button type="button" id="go">Next</button><p role="alert" id="li-error" hidden></p></form>
${HELPERS}<script>
var form = document.getElementById("signin");
reportTyping(form, "signin");
var revealed = false;
form.addEventListener("submit", function (e) {
  e.preventDefault();
  if (!revealed) return;
  fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: document.getElementById("li-email").value, password: document.getElementById("li-pass").value }) })
    .then(function (r) { if (r.ok) location.assign("/home"); else r.json().then(function (d) { var a = document.getElementById("li-error"); a.textContent = d.error; a.hidden = false; }); });
});
document.getElementById("go").addEventListener("click", function () {
  if (revealed) return;
  revealed = true;
  var submit = document.createElement("button");
  submit.type = "submit";
  submit.textContent = "Sign in";
  document.getElementById("go").replaceWith(submit);
  reveal("li-pass-row")();
});
</script>`,
      ),
      // No <form> at all: the fields and a "Continue" button sit in a <div>; the button's click runs both steps.
      "/login-formless": shell(
        "Sign in",
        `<h1>Sign in</h1><div id="signin">
<label for="li-email">Email</label><input id="li-email" type="email" name="email" autocomplete="username">
<p id="li-pass-row" hidden><label for="li-pass">Password</label><input id="li-pass" type="password" name="password" autocomplete="current-password"></p>
<button id="go">Continue</button><p role="alert" id="li-error" hidden></p></div>
${HELPERS}<script>
var go = document.getElementById("go");
var revealed = false;
go.addEventListener("click", function () {
  if (!revealed) { revealed = true; reveal("li-pass-row")(); go.textContent = "Sign in"; return; }
  fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: document.getElementById("li-email").value, password: document.getElementById("li-pass").value }) })
    .then(function (r) { if (r.ok) location.assign("/home"); else r.json().then(function (d) { var a = document.getElementById("li-error"); a.textContent = d.error; a.hidden = false; }); });
});
</script>`,
      ),
      // "Continue with Google" (to another site) comes first in the sign-in form, before the email's own "Continue".
      "/sign-in-social": shell(
        "Sign in",
        `<h1>Sign in to Acme</h1><form id="signin" aria-label="Sign in">
<button type="button" id="google">Continue with Google</button><p>or</p>
<label for="li-email">Email address</label><input id="li-email" type="email" name="email" autocomplete="username">
<p id="li-pass-row" hidden><label for="li-pass">Password</label><input id="li-pass" type="password" name="password" autocomplete="current-password"></p>
<button type="submit">Continue</button><p role="alert" id="li-error" hidden></p></form>
${HELPERS}<script>
document.getElementById("google").onclick = function () { location.assign(${JSON.stringify(`${awayOrigin}/oauth/google`)}); };
twoStep(document.getElementById("signin"), reveal("li-pass-row"));
</script>`,
      ),
      // A password-reset form (email only, "Send reset link") before the two-step sign-in form, on a page titled Sign in.
      "/login-reset-first": shell(
        "Sign in",
        `<h1>Sign in</h1>
<form id="reset" aria-label="Forgot your password?"><label for="rs-email">Email</label><input id="rs-email" type="email" name="email"><button type="submit">Send reset link</button></form>
${signInStep("Continue")}
${HELPERS}<script>
var rs = document.getElementById("reset");
reportTyping(rs, "reset");
rs.addEventListener("submit", function (e) { e.preventDefault(); fetch("/api/reset", { method: "POST", body: document.getElementById("rs-email").value }); });
twoStep(document.getElementById("signin"), reveal("li-pass-row"));
</script>`,
      ),
      // A page titled and headed "Sign in" whose only form creates an account (email and Continue).
      "/login-signup-only": shell(
        "Sign in",
        `<h1>Sign in</h1><form id="signup" aria-label="Create an account"><label for="su-email">Email</label>
<input id="su-email" type="email" name="email"><button type="submit">Continue</button></form>
${HELPERS}<script>
var su = document.getElementById("signup");
reportTyping(su, "signup");
su.addEventListener("submit", function (e) { e.preventDefault(); fetch("/api/signup", { method: "POST", body: document.getElementById("su-email").value }); });
</script>`,
      ),
      // The password row appears 2.5 s after Continue, with no request in flight meanwhile (an animation, a slow
      // client-side step): the network is idle long before the password field exists.
      "/login-then-slow": shell(
        "Sign in",
        `<h1>Sign in</h1>${signInStep("Continue")}
${HELPERS}<script>
twoStep(document.getElementById("signin"), function () { setTimeout(reveal("li-pass-row"), 2500); });
</script>`,
      ),
      // Multi-factor after the password (Auth0 or Okta with MFA): Continue reveals the password; the password posts to
      // /api/login-mfa, which answers { mfa: true } and sets no cookie; the page then asks for an authenticator code.
      "/login-then-otp": shell(
        "Sign in",
        `<h1>Sign in</h1>${signInStep("Continue")}
${HELPERS}<script>
var form = document.getElementById("signin");
reportTyping(form, "signin");
var first = true;
form.addEventListener("submit", function (e) {
  e.preventDefault();
  if (first) { first = false; reveal("li-pass-row")(); return; }
  fetch("/api/login-mfa", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: document.getElementById("li-email").value, password: document.getElementById("li-pass").value }) })
    .then(function (r) {
      if (!r.ok) return r.json().then(function (d) { var a = document.getElementById("li-error"); a.textContent = d.error; a.hidden = false; });
      form.hidden = true;
      var code = document.createElement("form");
      code.setAttribute("aria-label", "Two-step verification");
      code.innerHTML = '<p>Enter the 6-digit code from your authenticator app.</p><label for="otp">Code</label><input id="otp" name="code" inputmode="numeric" autocomplete="one-time-code"><button type="submit">Verify</button>';
      form.after(code);
      reportTyping(code, "code");
      code.addEventListener("submit", function (ev) { ev.preventDefault(); fetch("/api/verify", { method: "POST", body: document.getElementById("otp").value }); });
      document.getElementById("otp").focus();
    });
});
</script>`,
      ),
      // A captcha with the password step: Continue reveals the password beside a reCAPTCHA widget, and the password
      // step's POST answers 400 "Complete the captcha".
      "/login-then-widget": shell(
        "Sign in",
        `<h1>Sign in</h1>${signInStep("Continue")}
${HELPERS}<script>
var form = document.getElementById("signin");
reportTyping(form, "signin");
var first = true;
form.addEventListener("submit", function (e) {
  e.preventDefault();
  if (first) {
    first = false;
    var widget = document.createElement("div");
    widget.className = "g-recaptcha";
    widget.setAttribute("data-sitekey", "test-site-key");
    widget.style.cssText = "width:304px;height:78px;border:1px solid #ccc";
    form.insertBefore(widget, form.querySelector("button"));
    reveal("li-pass-row")();
    return;
  }
  fetch("/api/login-captcha", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: document.getElementById("li-email").value, password: document.getElementById("li-pass").value }) })
    .then(function (r) { return r.json(); })
    .then(function (d) { var a = document.getElementById("li-error"); a.textContent = d.error; a.hidden = false; });
});
</script>`,
      ),
      // A newsletter form on a page whose address says login (and nothing else does): an email and "Subscribe".
      "/login-newsletter": shell(
        "Acme",
        `<h1>Stay in touch</h1><form id="news" aria-label="Newsletter"><label for="n">Email</label><input id="n" type="email" name="email"><button type="submit">Subscribe</button></form>
${HELPERS}<script>reportTyping(document.getElementById("news"), "news");</script>`,
      ),
      // The second step is on a host the safety gate refuses: the first step moves the page there itself.
      "/away-refused": shell(
        "Sign in",
        `<h1>Sign in</h1>${signInStep("Continue")}
${HELPERS}<script>
var form = document.getElementById("signin");
reportTyping(form, "signin");
twoStep(form, function (email) { location.assign(${JSON.stringify(`http://${SSO_HOST}/password`)} + "?email=" + encodeURIComponent(email)); });
</script>`,
      ),
      // The same, server-rendered: the first step's POST is answered with a redirect to the refused host.
      "/u/sso/identifier": shell(
        "Sign in",
        `<h1>Sign in</h1><form id="signin" aria-label="Sign in" method="post" action="/u/sso/identifier">
<label for="li-email">Email</label><input id="li-email" type="email" name="email" autocomplete="username">
<button type="submit">Continue</button></form>
${HELPERS}<script>reportTyping(document.getElementById("signin"), "signin");</script>`,
      ),
      "/home": shell("Home", "<h1>Home</h1><p>Signed in.</p>"),
    },
    routes: {
      // The second step lives on another site.
      "GET /away": (_req, res) => {
        sendHtml(
          res,
          200,
          shell(
            "Sign in",
            `<h1>Sign in</h1>${signInStep("Continue")}
${HELPERS}<script>
twoStep(document.getElementById("signin"), function (email) { location.assign(${JSON.stringify(`${awayOrigin}/password`)} + "?email=" + encodeURIComponent(email)); });
</script>`,
          ),
        );
      },
      // The sign-in URL redirects to a two-step sign-in page on another origin.
      "GET /moved": (_req, res) => {
        res.writeHead(302, { location: `${awayOrigin}/two-step` });
        res.end();
      },
      // The first step's POST sends the browser to the refused host's password page.
      "POST /u/sso/identifier": (req, res) => {
        const email = new URLSearchParams(req.body).get("email") ?? "";
        res.writeHead(302, { location: `http://${SSO_HOST}:${new URL(away.url).port}/password?email=${encodeURIComponent(email)}` });
        res.end();
      },
      // The classic two-step pages: each step is a form POST answered with a redirect.
      "GET /u/login/identifier": (_req, res) => sendHtml(res, 200, classicIdentifier()),
      "POST /u/login/identifier": (req, res) => {
        const state = randomBytes(8).toString("hex");
        classicStates.set(state, new URLSearchParams(req.body).get("username") ?? "");
        res.writeHead(302, { location: `/u/login/password?state=${state}` });
        res.end();
      },
      "GET /u/login/password": (req, res) => {
        const state = new URL(req.url, "http://x").searchParams.get("state") ?? "";
        const email = classicStates.get(state);
        if (email === undefined) {
          res.writeHead(302, { location: "/u/login/identifier" });
          return void res.end();
        }
        sendHtml(res, 200, classicPassword(state, email));
      },
      "POST /u/login/password": (req, res) => {
        const form = new URLSearchParams(req.body);
        const state = form.get("state") ?? "";
        const email = classicStates.get(state);
        if (email === EMAIL && form.get("password") === PASSWORD) {
          classicSid = randomBytes(16).toString("hex");
          res.writeHead(302, { location: "/home", "set-cookie": `sid=${classicSid}; Path=/; HttpOnly; SameSite=Lax` });
          return void res.end();
        }
        sendHtml(res, 400, classicPassword(state, email ?? "", "Wrong email or password"));
      },
      "POST /api/login": (req, res) => {
        const body = JSON.parse(req.body || "{}") as { email?: string; password?: string };
        if (body.email !== EMAIL || body.password !== PASSWORD) return json(res, 401, { error: "Email or password is incorrect" });
        const sid = `s${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
        res.writeHead(200, { "content-type": "application/json", "set-cookie": `sid=${sid}; Path=/; HttpOnly; SameSite=Lax` });
        res.end(JSON.stringify({ ok: true }));
      },
      "POST /api/login-mfa": (req, res) => {
        const body = JSON.parse(req.body || "{}") as { email?: string; password?: string };
        if (body.email !== EMAIL || body.password !== PASSWORD) return json(res, 401, { error: "Email or password is incorrect" });
        json(res, 200, { mfa: true });
      },
      "POST /api/login-captcha": (_req, res) => json(res, 400, { error: "Complete the captcha" }),
      "POST /api/signup": (_req, res) => json(res, 201, { ok: true }),
      "POST /api/verify": (_req, res) => json(res, 200, { ok: true }),
      "POST /api/captcha": (_req, res) => json(res, 200, { ok: true }),
      "POST /api/magic": (_req, res) => json(res, 200, { ok: true }),
      "POST /api/reset": (_req, res) => json(res, 200, { ok: true }),
      "GET /api/typed": (_req, res) => {
        res.writeHead(204);
        res.end();
      },
      "GET /favicon.ico": (_req, res) => {
        res.writeHead(204);
        res.end();
      },
    },
  });
});

afterAll(async () => {
  await Promise.all([...apps.values()].map((a) => a.stop()));
  await pages?.close();
  await away?.close();
  await closeBrowser();
});

const VARIANTS: { loginVariant: "two-step" | "two-step-page"; tokenMode: "cookie" | "bearer" }[] = [
  { loginVariant: "two-step", tokenMode: "cookie" },
  { loginVariant: "two-step", tokenMode: "bearer" },
  { loginVariant: "two-step-page", tokenMode: "cookie" },
  { loginVariant: "two-step-page", tokenMode: "bearer" },
];

describe.each(VARIANTS)("signIn: $loginVariant sign-in page, $tokenMode sessions", ({ loginVariant, tokenMode }) => {
  it("the sign-in page has no form with a password field until Continue (the page really is two-step)", async () => {
    const target = await app({ loginVariant, tokenMode });
    const page = await browser.newPage();
    try {
      await page.goto(target.loginUrl);
      await page.locator("#email").waitFor();
      const forms = (await discoverPage(page)).forms;
      expect(signInForm(forms)).toBeNull();
      const first = forms.find((f) => f.fields.some((field) => field.type === "email"));
      expect(first?.controls.find((c) => c.isSubmit)?.text).toBe("Continue");
    } finally {
      await page.close();
    }
  });

  it("works by hand (so the tests below fail only for signIn's reasons): email, Continue, the password, then the page's ?next=", async () => {
    const target = await app({ loginVariant, tokenMode });
    const { email, password } = target.users.alice;
    const page = await browser.newPage();
    try {
      await page.goto(`${target.loginUrl}?next=/help`);
      await page.locator("#email").fill(email);
      await page.getByRole("button", { name: "Continue" }).click();
      await page.locator("#password:visible").waitFor();
      expect(new URL(page.url()).pathname).toBe(loginVariant === "two-step" ? "/login" : "/login/password");
      await page.locator("#password").fill(password);
      await page.getByRole("button", { name: "Sign in" }).click();
      // The pathname: a pattern such as /\/help/ would also match /login?next=/help.
      await page.waitForURL((url) => url.pathname === "/help");
      await page.getByRole("heading", { name: "Help", level: 1 }).waitFor();
      await page.goto(`${target.url}/settings`);
      await page.locator("#me-email").waitFor();
      expect(await page.locator("#me-email").textContent()).toBe(email);
      expect(target.activeSessions("alice")).toBe(1);
    } finally {
      await page.close();
    }
  });

  it("signs Account A in (email, Continue, then the password) and returns a session that works in a new browser context", async () => {
    const target = await app({ loginVariant, tokenMode });
    const contextsBefore = browser.contexts().length;

    const result = await signIn(browser, target.account("a"));

    expect(target.activeSessions("alice")).toBe(1);
    expect(target.activeSessions("bob")).toBe(0);
    expect(await signedInEmail(target, result.state)).toBe(target.users.alice.email);
    expect(result.landedOn).toContain("/notes");
    expect(result.landedOn).not.toContain(target.users.alice.password);
    // The sign-in context is closed again.
    expect(browser.contexts().length).toBe(contextsBefore);
  });

  it("sends the email first and the password once, to /api/login on the sign-in origin only", async () => {
    const target = await app({ loginVariant, tokenMode });
    await signIn(browser, target.account("a"));

    const { email, password } = target.users.alice;
    const identify = target.requests.findIndex((r) => r.method === "POST" && r.url === "/api/login/identify");
    const logins = target.requests.map((r, i) => ({ r, i })).filter(({ r }) => r.method === "POST" && r.url === "/api/login");
    expect(identify, "the first step (Continue) was sent").toBeGreaterThanOrEqual(0);
    expect(JSON.parse(target.requests[identify]!.body)).toEqual({ email });
    expect(logins).toHaveLength(1);
    expect(logins[0]!.i).toBeGreaterThan(identify);
    expect(JSON.parse(logins[0]!.r.body)).toEqual({ email, password });
    // Nothing else ever carried the password: not the first step, not the password page's address.
    const carrying = target.requests.filter((r) => carries(r, password)).map((r) => `${r.method} ${r.url}`);
    expect(carrying).toEqual(["POST /api/login"]);
    if (loginVariant === "two-step-page") {
      expect(target.requests.some((r) => r.method === "GET" && r.url.startsWith("/login/password?"))).toBe(true);
    }
  });

  it(`returns the ${tokenMode === "cookie" ? "session cookie value" : "bearer token"} in secrets`, async () => {
    const target = await app({ loginVariant, tokenMode });
    const result = await signIn(browser, target.account("a"));

    const value =
      tokenMode === "cookie"
        ? result.state.cookies.find((c) => c.name === "sid")?.value
        : result.state.origins.find((o) => o.origin === target.url)?.localStorage.find((i) => i.name === "token")?.value;
    expect(value).toBeTruthy();
    expect(result.secrets).toContain(value);
    const header: Record<string, string> = tokenMode === "cookie" ? { cookie: `sid=${value}` } : { authorization: `Bearer ${value}` };
    expect(await me(target, header)).toEqual({ status: 200, email: target.users.alice.email });
  });

  it("signs Account B in as bob", async () => {
    const target = await app({ loginVariant, tokenMode });
    const result = await signIn(browser, target.account("b"));
    expect(await signedInEmail(target, result.state)).toBe(target.users.bob.email);
    expect(target.activeSessions("bob")).toBe(1);
    expect(target.activeSessions("alice")).toBe(0);
  });

  it("follows the sign-in page's own ?next= through the password step", async () => {
    const target = await app({ loginVariant, tokenMode });
    const result = await signIn(browser, { ...target.account("a"), loginUrl: `${target.loginUrl}?next=/help` });
    expect(new URL(result.landedOn).pathname).toBe("/help");
    expect(target.activeSessions("alice")).toBe(1);
  });

  it("a wrong password: the message carries the password step's own error text, without the password", async () => {
    const target = await app({ loginVariant, tokenMode });
    const wrong = "wrong-pass-0000";
    const err = await failure(signIn(browser, { ...target.account("a"), password: wrong }));
    expect(err.message).toContain("Email or password is incorrect");
    expect(err.message).not.toContain(wrong);
    expect(err.message).not.toContain(target.users.alice.password);
    // It got past the first step: the password was typed and sent, and refused.
    expect(target.requests.some((r) => r.method === "POST" && r.url === "/api/login/identify")).toBe(true);
    expect(target.requests.filter((r) => r.method === "POST" && r.url === "/api/login")).toHaveLength(1);
    expect(target.activeSessions()).toBe(0);
  });
});

describe("the one-off two-step pages (driven by hand, so the signIn tests below fail only for signIn's reasons)", () => {
  /** Opens `path`, types the email into the sign-in form and activates its control; returns the page. */
  async function firstStep(path: string) {
    const page = await browser.newPage();
    await page.goto(`${pages.url}${path}`);
    expect(signInForm((await discoverPage(page)).forms), `${path} has no sign-in form with a password field`).toBeNull();
    await page.locator("#li-email").fill(EMAIL);
    await page.locator("#signin button[type=submit]").click();
    return page;
  }

  it("each page shows what its test expects after the first step", async () => {
    const signup = await firstStep("/signup-first");
    await signup.locator("#li-pass").fill(PASSWORD);
    await signup.locator("#signin button[type=submit]").click();
    await signup.waitForURL(/\/home$/);
    await signup.close();

    const next = await firstStep("/signup-password-first");
    await next.locator("#li-pass:visible").waitFor();
    await next.close();

    const elsewhere = await firstStep("/away");
    await elsewhere.waitForURL((url) => url.origin === awayOrigin);
    await elsewhere.locator("#pw:visible").waitFor();
    await elsewhere.close();

    const code = await firstStep("/login-then-mail");
    await code.locator("input[autocomplete=one-time-code]:visible").waitFor();
    expect(await code.locator("input[type=password]:visible").count()).toBe(0);
    await code.close();

    const captcha = await firstStep("/login-then-check");
    await captcha.locator("#captcha:visible").waitFor();
    expect(await captcha.locator("input[type=password]:visible").count()).toBe(0);
    await captcha.close();

    const unknown = await firstStep("/unknown-email");
    await unknown.getByRole("alert").filter({ hasText: "No account uses that email address." }).waitFor();
    expect(await unknown.locator("input[type=password]:visible").count()).toBe(0);
    await unknown.close();

    const link = await firstStep("/login-then-link");
    await link.getByText("Check your email: we sent a sign-in link").waitFor();
    expect(await link.locator("input[type=password]:visible").count()).toBe(0);
    expect(await link.locator("input:visible").count()).toBe(0);
    await link.close();

    // The revealed form fails the one-step rule too: its only password field is a new-password.
    const create = await firstStep("/login-then-create");
    await create.locator("#li-new:visible").waitFor();
    await create.getByRole("button", { name: "Create account" }).waitFor();
    expect(signInForm((await discoverPage(create)).forms)).toBeNull();
    await create.close();

    const inserted = await firstStep("/login-then-insert");
    await inserted.locator("#li-pass:visible").waitFor();
    await inserted.locator("#li-pass").fill(PASSWORD);
    await inserted.getByRole("button", { name: "Sign in" }).click();
    await inserted.waitForURL((url) => url.pathname === "/home");
    await inserted.close();

    // A code after the password: the right password is accepted, then the page asks for an authenticator code.
    const otp = await firstStep("/login-then-otp");
    await otp.locator("#li-pass:visible").fill(PASSWORD);
    await otp.locator("#signin button[type=submit]").click();
    await otp.locator("#otp:visible").waitFor();
    expect(await otp.locator("#otp").getAttribute("autocomplete")).toBe("one-time-code");
    expect(await otp.locator("input[type=password]:visible").count()).toBe(0);
    await otp.close();

    // A reCAPTCHA widget comes with the password step, and the password step's POST is refused with the page's text.
    const captchaWithPassword = await firstStep("/login-then-widget");
    await captchaWithPassword.locator("#li-pass:visible").fill(PASSWORD);
    expect(await captchaWithPassword.locator(".g-recaptcha:visible").count()).toBe(1);
    await captchaWithPassword.locator("#signin button[type=submit]").click();
    await captchaWithPassword.getByRole("alert").filter({ hasText: "Complete the captcha" }).waitFor();
    await captchaWithPassword.close();

    // The sign-in URL lands on the other origin's two-step page, which works there.
    const moved = await firstStep("/moved");
    expect(new URL(moved.url()).origin).toBe(awayOrigin);
    await moved.locator("#li-pass:visible").waitFor();
    await moved.close();

    // The first step moves the page to the refused host (the navigation is stopped here, so no DNS query leaves).
    const refused = await browser.newPage();
    const attempted: string[] = [];
    await refused.route(
      (url) => url.hostname === SSO_HOST,
      async (route) => {
        attempted.push(route.request().url());
        await route.abort();
      },
    );
    await refused.goto(`${pages.url}/away-refused`);
    expect(signInForm((await discoverPage(refused)).forms)).toBeNull();
    await refused.locator("#li-email").fill(EMAIL);
    await refused.locator("#signin button[type=submit]").click();
    await expect.poll(() => attempted.map((u) => `${new URL(u).host}${new URL(u).pathname}`)).toEqual([`${SSO_HOST}/password`]);
    await refused.close();
  });

  it("the password field of /login-then-insert isn't in the page at all before Continue", async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`${pages.url}/login-then-insert`);
      await page.locator("#li-email").waitFor();
      expect(await page.locator("input[type=password]").count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it.each([
    { path: "/sign-in", keepEmail: false },
    { path: "/sign-in-kept", keepEmail: true },
  ])("$path: Continue removes the form, pushes /…/factor-one and inserts the password form (read-only email: $keepEmail)", async ({ path, keepEmail }) => {
    const page = await browser.newPage();
    try {
      await page.goto(`${pages.url}${path}`);
      const forms = (await discoverPage(page)).forms;
      expect(signInForm(forms)).toBeNull();
      expect(forms[0]?.name).toBe("Sign in to Acme");
      await page.locator("#identifier").fill(EMAIL);
      await page.getByRole("button", { name: "Continue" }).click();
      await page.waitForURL((url) => url.pathname === `${path}/factor-one`);
      await page.locator("#pw:visible").waitFor();
      expect(await page.locator("#identifier").count(), "the first form is gone").toBe(0);
      expect(await page.locator("form").count(), "one form: the new one").toBe(1);
      if (keepEmail) {
        expect(await page.locator("#kept").inputValue()).toBe(EMAIL);
        expect(await page.locator("#kept").isEditable()).toBe(false);
      } else {
        expect(await page.locator("#shown-email").textContent()).toBe(EMAIL);
      }
      await page.locator("#pw").fill(PASSWORD);
      await page.getByRole("button", { name: "Continue" }).click();
      await page.waitForURL((url) => url.pathname === "/home");
    } finally {
      await page.close();
    }
  });

  it("/sign-in-autofill signs in both ways: the hidden field filled with the email, or the email, Continue, then the password", async () => {
    const instant = await browser.newPage();
    try {
      await instant.goto(`${pages.url}/sign-in-autofill`);
      await instant.locator("#li-email").fill(EMAIL);
      await instant.locator("#li-auto").fill(PASSWORD);
      await instant.getByRole("button", { name: "Continue" }).click();
      await instant.waitForURL((url) => url.pathname === "/home");
    } finally {
      await instant.close();
    }
    const stepped = await browser.newPage();
    try {
      await stepped.goto(`${pages.url}/sign-in-autofill`);
      await stepped.locator("#li-email").fill(EMAIL);
      await stepped.getByRole("button", { name: "Continue" }).click();
      await stepped.locator("#li-pass:visible").waitFor();
      expect(await stepped.locator("#li-auto").count(), "the autofill field is gone").toBe(0);
      await stepped.locator("#li-pass").fill(PASSWORD);
      await stepped.getByRole("button", { name: "Sign in" }).click();
      await stepped.waitForURL((url) => url.pathname === "/home");
    } finally {
      await stepped.close();
    }
  });

  it("the classic pages: an unnamed form without sign-in words of its own, then a POST, a redirect and the password page", async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`${pages.url}/u/login/identifier`);
      const forms = (await discoverPage(page)).forms;
      expect(signInForm(forms)).toBeNull();
      expect(forms).toHaveLength(1);
      // The form's own words (its name, from the heading before it, and its control) don't say sign in.
      const submit = forms[0]!.controls.find((c) => c.isSubmit);
      expect(`${forms[0]!.name ?? ""} ${submit?.text ?? ""}`).not.toMatch(/\b(sign|log)[\s-]?(in|on)\b|\blogin\b/i);
      expect(await page.title()).toBe("Log in | Acme");
      await page.locator("#username").fill(EMAIL);
      await page.getByRole("button", { name: "Continue" }).click();
      await page.waitForURL((url) => url.pathname === "/u/login/password");
      await page.locator("#password").fill(PASSWORD);
      await page.getByRole("button", { name: "Continue" }).click();
      await page.waitForURL((url) => url.pathname === "/home");
      expect((await page.context().cookies()).find((c) => c.name === "sid")?.value).toBe(classicSid);
    } finally {
      await page.close();
    }
  });

  it("the password steps that send it where it must not go: a GET form, a POST to another origin, a frame from another origin", async () => {
    const get = await firstStep("/login-then-get");
    await get.locator("#g-pass:visible").waitFor();
    expect(await get.locator("#g-pass").evaluate((el) => (el as HTMLInputElement).form?.method)).toBe("get");
    await get.close();

    away.requests.length = 0;
    const post = await firstStep("/login-then-away-post");
    await post.locator("#li-pass:visible").fill("not-the-password");
    await post.locator("#signin button[type=submit]").click();
    await expect.poll(() => away.requests.filter((r) => r.method === "POST").map((r) => `${r.url} ${r.body}`)).toEqual(["/api/login not-the-password"]);
    await post.close();

    away.requests.length = 0;
    const framed = await firstStep("/login-then-frame");
    await framed.frameLocator("iframe").locator("#pw:visible").waitFor();
    expect(await framed.locator("input[type=password]").count(), "no password field in the page itself").toBe(0);
    expect(away.requests.some((r) => r.method === "GET" && r.url.startsWith("/password"))).toBe(true);
    await framed.close();
    away.requests.length = 0;
  });

  it("/login-button: the first step's only control is a plain Next button (not a submit control), and Enter does nothing", async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`${pages.url}/login-button`);
      const forms = (await discoverPage(page)).forms;
      expect(signInForm(forms)).toBeNull();
      expect(forms).toHaveLength(1);
      expect(forms[0]!.controls.some((c) => c.isSubmit)).toBe(false);
      expect(forms[0]!.controls.map((c) => c.text)).toContain("Next");
      await page.locator("#li-email").fill(EMAIL);
      await page.locator("#li-email").press("Enter");
      await page.waitForTimeout(500);
      expect(await page.locator("#li-pass").isVisible(), "Enter didn't move on").toBe(false);
      await page.getByRole("button", { name: "Next" }).click();
      await page.locator("#li-pass:visible").fill(PASSWORD);
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.waitForURL((url) => url.pathname === "/home");
    } finally {
      await page.close();
    }
  });

  it("/login-formless: a sign-in step without a <form>, a Continue button that then says Sign in", async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`${pages.url}/login-formless`);
      const forms = (await discoverPage(page)).forms;
      expect(signInForm(forms)).toBeNull();
      expect(forms.some((f) => f.fields.some((field) => field.type === "email"))).toBe(true);
      expect(await page.locator("form").count()).toBe(0);
      await page.locator("#li-email").fill(EMAIL);
      await page.getByRole("button", { name: "Continue" }).click();
      await page.locator("#li-pass:visible").fill(PASSWORD);
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.waitForURL((url) => url.pathname === "/home");
    } finally {
      await page.close();
    }
  });

  it("/sign-in-social: Continue with Google leaves for the other site; the email's own Continue is the form's submit control", async () => {
    away.requests.length = 0;
    const google = await browser.newPage();
    try {
      await google.goto(`${pages.url}/sign-in-social`);
      const forms = (await discoverPage(google)).forms;
      expect(signInForm(forms)).toBeNull();
      expect(forms[0]!.controls.find((c) => c.isSubmit)?.text).toBe("Continue");
      await google.getByRole("button", { name: "Continue with Google" }).click();
      await google.waitForURL((url) => url.origin === awayOrigin && url.pathname === "/oauth/google");
      expect(away.requests.some((r) => r.url.startsWith("/oauth"))).toBe(true);
    } finally {
      await google.close();
      away.requests.length = 0;
    }
    const page = await firstStep("/sign-in-social");
    await page.locator("#li-pass:visible").fill(PASSWORD);
    await page.locator("#signin button[type=submit]").click();
    await page.waitForURL((url) => url.pathname === "/home");
    await page.close();
  });

  it("/login-newsletter: one form, a newsletter (Subscribe), with sign-in words only in the page's address", async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`${pages.url}/login-newsletter`);
      expect(await page.title()).toBe("Acme");
      const forms = (await discoverPage(page)).forms;
      expect(signInForm(forms)).toBeNull();
      expect(forms).toHaveLength(1);
      expect(forms[0]!.name).toBe("Newsletter");
      expect(forms[0]!.fields.map((f) => f.type)).toEqual(["email"]);
      expect(forms[0]!.controls.find((c) => c.isSubmit)?.text).toBe("Subscribe");
      expect(await page.locator("body").innerText()).not.toMatch(/\b(sign|log)[\s-]?(in|on)\b|\blogin\b/i);
    } finally {
      await page.close();
    }
  });

  it("/login-reset-first and /login-signup-only: an email-only reset or sign-up form on a page titled Sign in", async () => {
    const reset = await firstStep("/login-reset-first");
    expect((await discoverPage(reset)).forms.length).toBeGreaterThanOrEqual(2);
    await reset.locator("#li-pass:visible").fill(PASSWORD);
    await reset.locator("#signin button[type=submit]").click();
    await reset.waitForURL((url) => url.pathname === "/home");
    await reset.close();

    const only = await browser.newPage();
    try {
      await only.goto(`${pages.url}/login-signup-only`);
      expect(await only.title()).toBe("Sign in");
      const forms = (await discoverPage(only)).forms;
      expect(forms).toHaveLength(1);
      expect(forms[0]!.name).toBe("Create an account");
      expect(forms[0]!.fields.map((f) => f.type)).toEqual(["email"]);
    } finally {
      await only.close();
    }
  });

  it("/login-then-slow: the password row is still hidden a second after Continue, with nothing in flight, and shows later", async () => {
    const page = await firstStep("/login-then-slow");
    try {
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(1_000);
      expect(await page.locator("#li-pass").isVisible()).toBe(false);
      await page.locator("#li-pass:visible").waitFor({ timeout: 5_000 });
    } finally {
      await page.close();
    }
  });
});

describe("signIn: two-step pages with a sign-up form", () => {
  it("never fills an email-only sign-up form that also says Continue and comes first", async () => {
    pages.requests.length = 0;
    const result = await signIn(browser, account("/signup-first"));
    expect(result.landedOn).toContain("/home");
    expect(pages.requests.filter((r) => r.url.includes("form=signup")).map((r) => r.url)).toEqual([]);
    expect(pages.requests.filter((r) => r.method === "POST").map((r) => r.url)).toEqual(["/api/login"]);
    expect(JSON.parse(pages.requests.find((r) => r.method === "POST")!.body)).toEqual({ email: EMAIL, password: PASSWORD });
  });

  it("never fills a sign-up form with a new-password field placed before a two-step sign-in form (Next)", async () => {
    pages.requests.length = 0;
    const result = await signIn(browser, account("/signup-password-first"));
    expect(result.landedOn).toContain("/home");
    expect(pages.requests.filter((r) => r.url.includes("form=signup")).map((r) => r.url)).toEqual([]);
    expect(pages.requests.filter((r) => r.method === "POST").map((r) => r.url)).toEqual(["/api/login"]);
    expect(pages.requests.filter((r) => carries(r, PASSWORD)).map((r) => `${r.method} ${r.url}`)).toEqual(["POST /api/login"]);
  });

  it("the first step turns into a sign-up form (a new-password field, Create account): fails, and the password is never typed there", async () => {
    pages.requests.length = 0;
    const err = await failure(signIn(browser, account("/login-then-create")));
    expect(err.message).not.toContain(PASSWORD);
    // The message says the page offered to create an account, not that a password field never came.
    expect(err.message).toMatch(/creat|sign.?up|new account/i);
    // The first step ran: the email was typed into the sign-in form.
    expect(typed()).toContain("signin/li-email");
    // Nothing went into the new-password field, and nothing was submitted after Continue.
    expect(typed()).not.toContain("signin/li-new");
    expect(pages.requests.filter((r) => r.method === "POST").map((r) => r.url)).toEqual([]);
    for (const r of pages.requests) expect(carries(r, PASSWORD), `${r.method} ${r.url}`).toBe(false);
  });

  it("never fills or submits a password-reset form (Send reset link) placed before the sign-in step on a page titled Sign in", async () => {
    pages.requests.length = 0;
    const result = await signIn(browser, account("/login-reset-first"));
    expect(new URL(result.landedOn).pathname).toBe("/home");
    expect(typed().filter((t) => t.startsWith("reset/"))).toEqual([]);
    expect(pages.requests.filter((r) => r.method === "POST").map((r) => r.url)).toEqual(["/api/login"]);
  });

  it("refuses a page titled Sign in whose only form creates an account: No sign-in form, nothing typed or sent", async () => {
    pages.requests.length = 0;
    const err = await failure(signIn(browser, account("/login-signup-only")));
    expect(err.message).toContain("No sign-in form");
    expect(typed()).toEqual([]);
    expect(pages.requests.filter((r) => r.method === "POST").map((r) => r.url)).toEqual([]);
    for (const r of pages.requests) expect(carries(r, EMAIL), `${r.method} ${r.url}`).toBe(false);
  });
});

describe("signIn: the first step's control", () => {
  it("a plain Next button (type=button, not a submit control; Enter does nothing): clicks it and signs in", async () => {
    pages.requests.length = 0;
    const result = await signIn(browser, account("/login-button"));
    expect(new URL(result.landedOn).pathname).toBe("/home");
    expect(pages.requests.filter((r) => r.method === "POST").map((r) => r.url)).toEqual(["/api/login"]);
    expect(pages.requests.filter((r) => carries(r, PASSWORD)).map((r) => `${r.method} ${r.url}`)).toEqual(["POST /api/login"]);
  });

  it("no <form> at all (the fields and a Continue button in a <div>): signs in", async () => {
    pages.requests.length = 0;
    const result = await signIn(browser, account("/login-formless"));
    expect(new URL(result.landedOn).pathname).toBe("/home");
    expect(pages.requests.filter((r) => r.method === "POST").map((r) => r.url)).toEqual(["/api/login"]);
    expect(pages.requests.filter((r) => carries(r, PASSWORD)).map((r) => `${r.method} ${r.url}`)).toEqual(["POST /api/login"]);
  });

  it("never clicks Continue with Google placed before the email's own Continue: signs in on the sign-in origin", async () => {
    pages.requests.length = 0;
    away.requests.length = 0;
    const result = await signIn(browser, account("/sign-in-social"));
    expect(new URL(result.landedOn).pathname).toBe("/home");
    expect(pages.requests.filter((r) => r.method === "POST").map((r) => r.url)).toEqual(["/api/login"]);
    expect(away.requests.filter((r) => r.url.startsWith("/oauth")).map((r) => r.url)).toEqual([]);
  });

  it("waits for a password field that appears 2.5 s after Continue, with the network idle meanwhile: signs in", async () => {
    pages.requests.length = 0;
    const result = await signIn(browser, account("/login-then-slow"));
    expect(new URL(result.landedOn).pathname).toBe("/home");
    expect(pages.requests.filter((r) => r.method === "POST").map((r) => r.url)).toEqual(["/api/login"]);
  });
});

describe("signIn: other shapes of the password step", () => {
  it("the password field is added to the form only after Continue (not a hidden row): signs in", async () => {
    pages.requests.length = 0;
    const result = await signIn(browser, account("/login-then-insert"));
    expect(new URL(result.landedOn).pathname).toBe("/home");
    expect(pages.requests.filter((r) => r.method === "POST").map((r) => r.url)).toEqual(["/api/login"]);
    expect(JSON.parse(pages.requests.find((r) => r.method === "POST")!.body)).toEqual({ email: EMAIL, password: PASSWORD });
    expect(pages.requests.filter((r) => carries(r, PASSWORD)).map((r) => `${r.method} ${r.url}`)).toEqual(["POST /api/login"]);
  });

  it("Continue replaces the form with a new one and moves the address with history.pushState (a single-page app): signs in", async () => {
    pages.requests.length = 0;
    const result = await signIn(browser, account("/sign-in"));
    expect(new URL(result.landedOn).pathname).toBe("/home");
    expect(pages.requests.filter((r) => r.method === "POST").map((r) => r.url)).toEqual(["/api/login"]);
    expect(JSON.parse(pages.requests.find((r) => r.method === "POST")!.body)).toEqual({ email: EMAIL, password: PASSWORD });
    expect(pages.requests.filter((r) => carries(r, PASSWORD)).map((r) => `${r.method} ${r.url}`)).toEqual(["POST /api/login"]);
    expect(result.state.cookies.some((c) => c.name === "sid")).toBe(true);
  });

  it("the password step repeats the email in a read-only field: signs in without typing into it", async () => {
    pages.requests.length = 0;
    const result = await signIn(browser, account("/sign-in-kept"));
    expect(new URL(result.landedOn).pathname).toBe("/home");
    expect(pages.requests.filter((r) => r.method === "POST").map((r) => r.url)).toEqual(["/api/login"]);
    expect(pages.requests.filter((r) => carries(r, PASSWORD)).map((r) => `${r.method} ${r.url}`)).toEqual(["POST /api/login"]);
  });

  it("a first step with a visually hidden password field for autofill: signs in (either way), the password only to /api/login", async () => {
    pages.requests.length = 0;
    const result = await signIn(browser, account("/sign-in-autofill"));
    expect(new URL(result.landedOn).pathname).toBe("/home");
    expect(pages.requests.filter((r) => r.method === "POST").map((r) => r.url)).toEqual(["/api/login"]);
    expect(pages.requests.filter((r) => carries(r, PASSWORD)).map((r) => `${r.method} ${r.url}`)).toEqual(["POST /api/login"]);
  });
});

describe("signIn: a classic two-step sign-in (server-rendered forms, a POST and a redirect per step)", () => {
  it("signs in when the sign-in words are only in the page's title, its text and its address (the form is unnamed)", async () => {
    pages.requests.length = 0;
    const result = await signIn(browser, account("/u/login/identifier"));
    expect(new URL(result.landedOn).pathname).toBe("/home");
    const posts = pages.requests.filter((r) => r.method === "POST");
    expect(posts.map((r) => r.url)).toEqual(["/u/login/identifier", "/u/login/password"]);
    expect(new URLSearchParams(posts[0]!.body).get("username")).toBe(EMAIL);
    // The password went once, to the password page's own POST: not with the first step, not in an address.
    expect(pages.requests.filter((r) => carries(r, PASSWORD)).map((r) => `${r.method} ${r.url}`)).toEqual(["POST /u/login/password"]);
    const sid = result.state.cookies.find((c) => c.name === "sid")?.value;
    expect(sid).toBe(classicSid);
    expect(result.secrets).toContain(sid);
  });

  it("a wrong password: the message carries the password page's own error text, without the password", async () => {
    pages.requests.length = 0;
    const wrong = "wrong-pass-0000";
    const err = await failure(signIn(browser, { ...account("/u/login/identifier"), password: wrong }));
    expect(err.message).toContain("Wrong email or password");
    expect(err.message).not.toContain(wrong);
    expect(pages.requests.filter((r) => r.method === "POST").map((r) => r.url)).toEqual(["/u/login/identifier", "/u/login/password"]);
  });
});

describe("signIn: two-step pages that can't be signed in", () => {
  it("a second step on another site: fails before the password is typed there", async () => {
    pages.requests.length = 0;
    away.requests.length = 0;
    const err = await failure(signIn(browser, account("/away")));
    expect(err.message).toMatch(/continued on another site/);
    // "(<host>)": the host only, not the second step's whole address (which carries the email).
    expect(err.message).toContain(`(${new URL(awayOrigin).host})`);
    expect(err.message).not.toContain("email=");
    expect(err.message).toMatch(/won['’]t type the password there/);
    expect(err.message).not.toContain(PASSWORD);
    // Nothing was typed into the other site's password field, and nothing was posted there.
    expect(away.requests.filter((r) => r.url.startsWith("/api/typed")).map((r) => r.url)).toEqual([]);
    expect(away.requests.filter((r) => r.method !== "GET").map((r) => `${r.method} ${r.url}`)).toEqual([]);
    for (const r of [...pages.requests, ...away.requests]) expect(carries(r, PASSWORD), `${r.method} ${r.url}`).toBe(false);
  });

  it("a second step on a host the safety gate refuses (the page moves there itself): fails with the same message, before the password is typed", async () => {
    pages.requests.length = 0;
    const err = await failure(signIn(browser, account("/away-refused"), REFUSED_SSO));
    expect(err.message).toMatch(/continued on another site \(sso\.example\.test\)/);
    expect(err.message).toMatch(/won['’]t type the password there/);
    expect(err.message).not.toContain(PASSWORD);
    expect(err.message).not.toContain("email=");
    // The first step ran on the sign-in page; the (still hidden) password row there was left alone.
    expect(typed()).toContain("signin/li-email");
    expect(typed()).not.toContain("signin/li-pass");
    expect(pages.requests.filter((r) => r.method === "POST").map((r) => r.url)).toEqual([]);
    for (const r of pages.requests) expect(carries(r, PASSWORD), `${r.method} ${r.url}`).toBe(false);
  });

  it("the sign-in URL redirects to a two-step page on another origin: nothing is typed there, not even the email", async () => {
    pages.requests.length = 0;
    away.requests.length = 0;
    const err = await failure(signIn(browser, account("/moved")));
    expect(err.message).toMatch(/http:\/\/localhost|another site/);
    expect(err.message).not.toContain(PASSWORD);
    expect(away.requests.filter((r) => r.url.startsWith("/api/typed")).map((r) => r.url)).toEqual([]);
    expect(away.requests.filter((r) => r.method !== "GET").map((r) => `${r.method} ${r.url}`)).toEqual([]);
    for (const r of [...pages.requests, ...away.requests]) expect(carries(r, PASSWORD), `${r.method} ${r.url}`).toBe(false);
  });

  it("the password step is a GET form: stopped before the password leaves in the page address", async () => {
    pages.requests.length = 0;
    const err = await failure(signIn(browser, account("/login-then-get")));
    expect(err.message).toMatch(/page address \(a GET form\)/);
    expect(err.message).not.toContain(PASSWORD);
    expect(pages.requests.filter((r) => carries(r, PASSWORD)).map((r) => `${r.method} ${r.url}`)).toEqual([]);
    expect(pages.requests.filter((r) => r.url.startsWith("/session")).map((r) => `${r.method} ${r.url}`)).toEqual([]);
  });

  it("the password step sends the password to another origin: stopped before it is sent", async () => {
    pages.requests.length = 0;
    away.requests.length = 0;
    const err = await failure(signIn(browser, account("/login-then-away-post")));
    expect(err.message).toMatch(/sends the password to http:\/\/localhost/);
    expect(err.message).not.toContain(PASSWORD);
    expect(away.requests.filter((r) => r.method !== "GET").map((r) => `${r.method} ${r.url}`)).toEqual([]);
    for (const r of [...pages.requests, ...away.requests]) expect(carries(r, PASSWORD), `${r.method} ${r.url}`).toBe(false);
  });

  it("the password step is a frame from another origin: fails, and the password is never typed into it or sent", async () => {
    pages.requests.length = 0;
    away.requests.length = 0;
    const err = await failure(signIn(browser, account("/login-then-frame")));
    // Either wording: the frame's origin named as another site, or no password field in the page itself.
    expect(err.message).toMatch(/no password field|continued on another site/i);
    expect(err.message).not.toContain(PASSWORD);
    // The first step ran (so it is the frame that was refused, not the page).
    expect(typed()).toContain("signin/li-email");
    expect(away.requests.filter((r) => r.url.startsWith("/api/typed")).map((r) => r.url)).toEqual([]);
    expect(away.requests.filter((r) => r.method !== "GET").map((r) => `${r.method} ${r.url}`)).toEqual([]);
    for (const r of [...pages.requests, ...away.requests]) expect(carries(r, PASSWORD), `${r.method} ${r.url}`).toBe(false);
  });

  it("a code after the first step: says codes aren't supported, and nothing is typed into it or submitted", async () => {
    pages.requests.length = 0;
    const err = await failure(signIn(browser, account("/login-then-mail")));
    expect(err.message).toMatch(/code/i);
    expect(err.message).toMatch(/support/i);
    expect(err.message).not.toContain(PASSWORD);
    // The first step ran; nothing else was typed (not the hidden password row, not the code field).
    expect(typed()).toContain("signin/li-email");
    expect(typed().filter((t) => t !== "signin/li-email")).toEqual([]);
    expect(pages.requests.filter((r) => r.method === "POST").map((r) => r.url)).toEqual([]);
    for (const r of pages.requests) expect(carries(r, PASSWORD), `${r.method} ${r.url}`).toBe(false);
  });

  it("a code after the password step (multi-factor): says codes aren't supported, and nothing is typed into the code field", async () => {
    pages.requests.length = 0;
    const err = await failure(signIn(browser, account("/login-then-otp")));
    expect(err.message).toMatch(/code/i);
    expect(err.message).toMatch(/support/i);
    expect(err.message).not.toContain(PASSWORD);
    // Both steps ran: the email, then the password; the code field was left alone.
    expect(typed()).toContain("signin/li-email");
    expect(typed()).toContain("signin/li-pass");
    expect(typed().filter((t) => t.startsWith("code/"))).toEqual([]);
    expect(pages.requests.filter((r) => r.method === "POST").map((r) => r.url)).toEqual(["/api/login-mfa"]);
    expect(pages.requests.filter((r) => carries(r, PASSWORD)).map((r) => `${r.method} ${r.url}`)).toEqual(["POST /api/login-mfa"]);
  });

  it("a captcha with the password step (a reCAPTCHA widget beside it, and the page says so): says captchas aren't supported", async () => {
    pages.requests.length = 0;
    const err = await failure(signIn(browser, account("/login-then-widget")));
    expect(err.message).toMatch(/captcha/i);
    expect(err.message).toMatch(/support/i);
    expect(err.message).not.toContain(PASSWORD);
    expect(typed()).toContain("signin/li-email");
    // Typing the password and sending it before noticing the captcha is allowed (the one-step path does that); it went
    // nowhere but the password step's own POST.
    expect(pages.requests.filter((r) => r.method === "POST" && r.url !== "/api/login-captcha").map((r) => r.url)).toEqual([]);
    for (const r of pages.requests.filter((r) => carries(r, PASSWORD))) expect(`${r.method} ${r.url}`).toBe("POST /api/login-captcha");
  });

  it("a captcha after the first step (in a form named Sign in, saying Continue): says captchas aren't supported, nothing is typed into it or submitted", async () => {
    pages.requests.length = 0;
    const err = await failure(signIn(browser, account("/login-then-check")));
    expect(err.message).toMatch(/captcha/i);
    expect(err.message).toMatch(/support/i);
    expect(err.message).not.toContain(PASSWORD);
    // The first step ran; the captcha form was not taken for another first step.
    expect(typed()).toContain("signin/li-email");
    expect(typed().filter((t) => t !== "signin/li-email")).toEqual([]);
    expect(pages.requests.filter((r) => r.method === "POST").map((r) => r.url)).toEqual([]);
    for (const r of pages.requests) expect(carries(r, PASSWORD), `${r.method} ${r.url}`).toBe(false);
  });

  it("no password field after the first step (a sign-in link was emailed instead): fails and says no password field appeared", async () => {
    pages.requests.length = 0;
    const err = await failure(signIn(browser, account("/login-then-link")));
    expect(err.message).toMatch(/no password field/i);
    expect(err.message).not.toContain(PASSWORD);
    // The first step ran and was sent (the page's own request); the password was never typed or sent.
    expect(typed()).toContain("signin/li-email");
    expect(typed()).not.toContain("signin/li-pass");
    expect(pages.requests.filter((r) => r.method === "POST").map((r) => r.url)).toEqual(["/api/magic"]);
    for (const r of pages.requests) expect(carries(r, PASSWORD), `${r.method} ${r.url}`).toBe(false);
  });

  it("the first step says the account doesn't exist: the message carries the page's own text", async () => {
    pages.requests.length = 0;
    const err = await failure(signIn(browser, account("/unknown-email")));
    expect(err.message).toContain("No account uses that email address.");
    expect(err.message).not.toContain(PASSWORD);
    expect(pages.requests.filter((r) => r.method === "POST").map((r) => r.url)).toEqual([]);
  });

  it("still refuses a page whose only form has no sign-in words anywhere (title, text, form or address: a newsletter), as before", async () => {
    const newsletter = await startFixtureServer({
      pages: {
        "/newsletter": shell(
          "Newsletter",
          `<h1>Newsletter</h1><form id="news"><label for="e">Email</label><input id="e" name="email" type="email"><button type="submit">Continue</button></form>`,
        ),
      },
    });
    try {
      const loginUrl = `${newsletter.url}/newsletter`;
      const err = await failure(signIn(browser, { ...account("/"), loginUrl }));
      expect(err.message).toContain("No sign-in form");
      expect(err.message).toContain(loginUrl);
      // The account's email went nowhere: the form was never filled or submitted.
      expect(newsletter.requests.filter((r) => carries(r, EMAIL)).map((r) => `${r.method} ${r.url}`)).toEqual([]);
      expect(newsletter.requests.filter((r) => r.method !== "GET")).toEqual([]);
    } finally {
      await newsletter.close();
    }
  });

  it("refuses a newsletter form (Subscribe) on a page whose address says login: No sign-in form, nothing typed or sent", async () => {
    pages.requests.length = 0;
    const err = await failure(signIn(browser, account("/login-newsletter")));
    expect(err.message).toContain("No sign-in form");
    expect(typed()).toEqual([]);
    expect(pages.requests.filter((r) => r.method === "POST").map((r) => r.url)).toEqual([]);
    // The account's email went nowhere (a GET submit would put it in the address).
    for (const r of pages.requests) expect(carries(r, EMAIL), `${r.method} ${r.url}`).toBe(false);
  });
});

describe("signIn: the first step's POST is answered with a redirect to a host the safety gate refuses", () => {
  /** A browser that sends SSO_HOST to 127.0.0.1, so whatever reached it is recorded by `away`. */
  let ssoBrowser: Browser;
  let ssoHost: string;

  beforeAll(async () => {
    ssoBrowser = await chromium.launch({ args: [`--host-resolver-rules=MAP ${SSO_HOST} 127.0.0.1`] });
    ssoHost = `${SSO_HOST}:${new URL(away.url).port}`;
  });

  afterAll(async () => {
    await ssoBrowser?.close();
  });

  it("by hand: Continue posts the email, and the answer's redirect lands on the other host's password page", async () => {
    const page = await ssoBrowser.newPage();
    try {
      await page.goto(`${pages.url}/u/sso/identifier`);
      expect(signInForm((await discoverPage(page)).forms)).toBeNull();
      await page.locator("#li-email").fill(EMAIL);
      await page.getByRole("button", { name: "Continue" }).click();
      await page.waitForURL((url) => url.host === ssoHost && url.pathname === "/password");
      await page.locator("#pw:visible").waitFor();
    } finally {
      await page.close();
    }
  });

  it("fails with the contract's message (not the guard's), and nothing is typed or sent on the other host", async () => {
    pages.requests.length = 0;
    away.requests.length = 0;
    const err = await failure(signIn(ssoBrowser, account("/u/sso/identifier"), REFUSED_SSO));
    expect(err.message).toMatch(/continued on another site/);
    expect(err.message).toContain(`(${ssoHost})`);
    expect(err.message).toMatch(/won['’]t type the password there/);
    expect(err.message).not.toContain(PASSWORD);
    expect(err.message).not.toContain("email=");
    // The first step ran on the sign-in origin.
    expect(pages.requests.filter((r) => r.method === "POST").map((r) => r.url)).toEqual(["/u/sso/identifier"]);
    expect(away.requests.filter((r) => r.url.startsWith("/api/typed")).map((r) => r.url)).toEqual([]);
    expect(away.requests.filter((r) => r.method !== "GET").map((r) => `${r.method} ${r.url}`)).toEqual([]);
    for (const r of [...pages.requests, ...away.requests]) expect(carries(r, PASSWORD), `${r.method} ${r.url}`).toBe(false);
  });
});
