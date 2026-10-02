// signIn fails only for a reason (0.6.0, round 1; docs/v2-spec.md "Signing in", "Sign-in: two-step and sessionStorage"): a common-word password in an ordinary address counts only in the query / hash / user info (and equal to the username only under a password-named key); a "magic link" form (its own words say send, code, link, one-time) is never a first step; a captcha after the submit on the same address fails only when no new session was started.
import type { ServerResponse } from "node:http";
import type { Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeBrowser, getBrowser } from "../../../../test-support/harness.js";
import { json, startFixtureServer, type FixtureServer, type RecordedRequest } from "../../../../test-support/server.js";
import type { TestAccount } from "../../../../src/interfaces/accounts.js";
import { signIn, SignInError, type SignedIn } from "../../../../src/engine/auth.js";

const EMAIL = "alice@example.test";
const ALICE_PASSWORD = "alice-pass-7Q2x";
// Account pairs the form-post app accepts: a common-word password, and a username equal to its password.
const COMMON = { username: EMAIL, password: "password" };
const SAME = { username: "testuser1", password: "testuser1" };
const SID = "s3ss10nT0kenValue1234567890";

let browser: Browser;
let site: FixtureServer;

const shell = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body><main>${body}</main></body></html>`;

function sendHtml(res: ServerResponse, body: string): void {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(body);
}

const signedInUser = (req: RecordedRequest) => /(?:^|;\s*)who=([^;]+)/.exec(String(req.headers.cookie ?? ""))?.[1];

// A plain sign-in form (POST /pw/login) that goes on to `next` once signed in.
const formLogin = (next: string) =>
  shell(
    "Sign in",
    `<h1>Sign in</h1><form method="post" action="/pw/login" aria-label="Sign in"><input type="hidden" name="next" value="${next}">
<label for="user">Username</label><input id="user" name="user" type="text" autocomplete="username">
<label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password">
<button type="submit">Sign in</button></form>`,
  );

// A landing page that loads `urls` (script requests, `U` the signed-in username) and then says it is ready.
const landing = (user: string, urls: string) =>
  shell(
    "App",
    `<h1>Welcome</h1><p id="state">…</p>
<script>
var U = ${JSON.stringify(user)};
Promise.all(${urls}.map(function (u) { return fetch(u).then(function (r) { return r.status; }, function () { return 0; }); }))
  .then(function (s) { document.getElementById("state").textContent = "ready " + s.join(","); });
</script>`,
  );

// A one-step SPA at /spa (or /spa-challenge): its sign-in form in place while signed out, the app in place once signed in.
const spa = (api: string) =>
  shell(
    "Notes",
    `<div id="root"></div>
<script>
var root = document.getElementById("root");
function signedOut() {
  root.innerHTML = '<h1>Sign in</h1><form id="f" aria-label="Sign in"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password"><button type="submit">Sign in</button></form>';
  document.getElementById("f").addEventListener("submit", function (e) {
    e.preventDefault();
    fetch(${JSON.stringify(api)}, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: document.getElementById("email").value, password: document.getElementById("password").value }) })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (x) {
        if (!x.ok) { root.insertAdjacentHTML("afterbegin", '<p role="alert">Wrong email or password</p>'); return; }
        if (x.d.challenge) { root.innerHTML = '<h1>One more step</h1><p>Confirm you are not a robot.</p><div class="cf-turnstile" data-sitekey="0x4AAAAAAAexample" style="width:300px;height:65px"></div>'; return; }
        signedIn();
      });
  });
}
function signedIn() {
  root.innerHTML = '<h1>Your notes</h1><form aria-label="Send feedback"><label for="fb">Feedback</label><textarea id="fb" name="fb"></textarea><div class="cf-turnstile" data-sitekey="0x4AAAAAAAexample" style="width:300px;height:65px"></div><button type="submit">Send</button></form>';
}
fetch("/api/me").then(function (r) { if (r.ok) signedIn(); else signedOut(); });
</script>`,
  );

// A passwordless sign-in page: an email field and `control`, in a form named `name`; its submit asks the app to send.
const sendsPage = (name: string, control: string) =>
  shell(
    "Sign in · Notes",
    `<h1>Sign in</h1><p>Welcome back.</p>
<form id="f" aria-label="${name}"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" required>
<button type="submit">${control}</button></form><p id="msg" role="status"></p>
<script>document.getElementById("f").addEventListener("submit", function (e) { e.preventDefault();
  fetch("/api/send-link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: document.getElementById("email").value }) });
  document.getElementById("f").remove(); document.getElementById("msg").textContent = "Check your email."; });</script>`,
  );

beforeAll(async () => {
  browser = await getBrowser();
  site = await startFixtureServer({
    pages: {
      "/pw/login": formLogin("/pw/app"),
      "/pw/login-leaky": formLogin("/pw/app-leaky"),
      "/magic": sendsPage("Sign in", "Send magic link"),
      "/email-me": sendsPage("Sign in", "Email me a sign-in link"),
      "/send-code": sendsPage("Log in", "Send code"),
      "/one-time": sendsPage("Sign in with a one-time code", "Continue"),
      // A two-step first step whose "Continue" leads nowhere: no password field, nothing else to fill in.
      "/continue-nowhere": shell(
        "Sign in",
        `<h1>Sign in</h1><form id="f" aria-label="Sign in"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username">
<button type="submit">Continue</button></form>
<script>document.getElementById("f").addEventListener("submit", function (e) { e.preventDefault(); document.getElementById("f").remove(); });</script>`,
      ),
      "/spa": spa("/api/login"),
      "/spa-challenge": spa("/api/login-challenge"),
    },
    routes: {
      "POST /pw/login": (req, res) => {
        const form = new URLSearchParams(req.body);
        const pair = [COMMON, SAME].find((p) => p.username === form.get("user") && p.password === form.get("password"));
        if (!pair) return sendHtml(res, shell("Sign in", `<p role="alert">Wrong username or password</p>`));
        res.writeHead(303, { location: form.get("next") ?? "/pw/app", "set-cookie": [`sid=${SID}; Path=/; HttpOnly`, `who=${encodeURIComponent(pair.username)}; Path=/`] });
        res.end();
      },
      // Ordinary reads of a signed-in page: a "password last changed" widget, the user's own record by name.
      "GET /pw/app": (req, res) =>
        sendHtml(res, landing(decodeURIComponent(signedInUser(req) ?? ""), `["/api/account/password-status", "/api/users/" + encodeURIComponent(U), "/api/users?name=" + encodeURIComponent(U)]`)),
      // A page that sends the username (the password too, when they are equal) under a key that names a password.
      "GET /pw/app-leaky": (req, res) => sendHtml(res, landing(decodeURIComponent(signedInUser(req) ?? ""), `["/api/state?password=" + encodeURIComponent(U)]`)),
      "GET /api/account/password-status": (_req, res) => json(res, 200, { changed: "3 days ago" }),
      "GET /api/users": (_req, res) => json(res, 200, { users: [] }),
      "GET /api/state": (_req, res) => json(res, 200, {}),
      "POST /api/send-link": (_req, res) => json(res, 200, {}),
      "GET /api/me": (req, res) => json(res, String(req.headers.cookie ?? "").includes(`sid=${SID}`) ? 200 : 401, {}),
      "POST /api/login": (req, res) => {
        const body = JSON.parse(req.body || "{}") as { email?: string; password?: string };
        if (body.email !== EMAIL || body.password !== ALICE_PASSWORD) return json(res, 401, {});
        res.setHeader("set-cookie", `sid=${SID}; Path=/; HttpOnly; SameSite=Lax`);
        json(res, 200, {});
      },
      // The right password, answered with a captcha challenge instead of a session.
      "POST /api/login-challenge": (req, res) => {
        const body = JSON.parse(req.body || "{}") as { email?: string; password?: string };
        if (body.email !== EMAIL || body.password !== ALICE_PASSWORD) return json(res, 401, {});
        json(res, 200, { challenge: true });
      },
      "GET /favicon.ico": (_req, res) => {
        res.writeHead(204);
        res.end();
      },
    },
    fallback: (req, res) => {
      if (req.url.startsWith("/api/users/")) return json(res, 200, { name: "Test User" });
      res.writeHead(404);
      res.end();
    },
  });
});

afterAll(async () => {
  await closeBrowser();
  await site?.close();
});

const account = (path: string, pair: { username: string; password: string } = { username: EMAIL, password: ALICE_PASSWORD }): TestAccount => ({
  id: "a",
  label: "Account A",
  loginUrl: `${site.url}${path}`,
  username: pair.username,
  password: pair.password,
});

async function outcomeOf(promise: Promise<SignedIn>): Promise<SignedIn | SignInError> {
  return promise.then(
    (result) => result,
    (err: unknown) => {
      if (err instanceof SignInError) return err;
      throw err;
    },
  );
}

async function signedIn(promise: Promise<SignedIn>): Promise<SignedIn> {
  const outcome = await outcomeOf(promise);
  if (outcome instanceof SignInError) expect.fail(`signIn failed: ${outcome.message}`);
  return outcome;
}

async function failed(promise: Promise<SignedIn>): Promise<SignInError> {
  const outcome = await outcomeOf(promise);
  expect(outcome, "signIn should have failed").toBeInstanceOf(SignInError);
  return outcome as SignInError;
}

const paths = () => site.requests.map((r) => `${r.method} ${r.url}`);

describe("signIn: a common-word password, or one equal to the username, in the landing page's ordinary addresses", () => {
  it(`"${COMMON.password}" in /api/account/password-status: signs in, and the page's reads reach the app`, async () => {
    site.requests.length = 0;
    const result = await signedIn(signIn(browser, account("/pw/login", COMMON)));
    expect(new URL(result.landedOn).pathname).toBe("/pw/app");
    expect(paths()).toContain("GET /api/account/password-status");
  });

  it(`a username equal to its password ("${SAME.password}") in a path segment and a query value: signs in`, async () => {
    site.requests.length = 0;
    const result = await signedIn(signIn(browser, account("/pw/login", SAME)));
    expect(new URL(result.landedOn).pathname).toBe("/pw/app");
    expect(paths()).toEqual(expect.arrayContaining([`GET /api/users/${SAME.username}`, `GET /api/users?name=${SAME.username}`]));
  });

  it("a username equal to its password, sent under ?password=: still stopped, and signing in fails", async () => {
    site.requests.length = 0;
    const err = await failed(signIn(browser, account("/pw/login-leaky", SAME)));
    expect(err.message).toMatch(/sends the password in the page address/);
    expect(paths().filter((p) => p.includes("/api/state"))).toEqual([]);
  });
});

describe("signIn never submits a form that sends a sign-in link or a code (a passwordless sign-in)", () => {
  for (const [path, words] of [
    ["/magic", "Send magic link"],
    ["/email-me", "Email me a sign-in link"],
    ["/send-code", "Send code"],
    ["/one-time", "a form named for a one-time code, with Continue"],
  ] as const) {
    it(`${path} (${words}): fails before anything is sent, and says the page signs in with what it sends`, async () => {
      site.requests.length = 0;
      const err = await failed(signIn(browser, account(path)));
      expect(paths().filter((p) => p.startsWith("POST"))).toEqual([]);
      expect(err.message).toMatch(/No sign-in form/);
      expect(err.message).toMatch(/link or a code/);
      expect(err.message).not.toContain(`${words} ${words}`);
    });
  }

  it('a first step whose control is named and labelled "Continue": the message names it once', async () => {
    const err = await failed(signIn(browser, account("/continue-nowhere")));
    expect(err.message).toMatch(/no password field appeared/);
    expect(err.message).toContain('and "Continue" was used');
  });
});

describe("signIn: a captcha that shows after the submit, at the sign-in page's own address", () => {
  it("in the signed-in view's own form (the submit started a session): signs in", async () => {
    const result = await signedIn(signIn(browser, account("/spa")));
    expect(new URL(result.landedOn).pathname).toBe("/spa");
    expect(result.state.cookies.map((c) => c.name)).toEqual(["sid"]);
  });

  it("in the sign-in form's place, with no session started: fails with the captcha message", async () => {
    const err = await failed(signIn(browser, account("/spa-challenge")));
    expect(err.message).toMatch(/captcha/);
  });
});
