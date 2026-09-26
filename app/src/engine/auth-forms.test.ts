/**
 * signIn on sign-in pages that are harder than the accounts app (round-2 review):
 * - a sign-up form placed before the sign-in form is never used: the account's email and password only go to the
 *   sign-in form (signInForm ranks forms: sign-in words and autocomplete=current-password win; a form that says
 *   sign up / create / register, or whose password is a new-password, is never picked);
 * - a form that would put the password in the page address (a GET form) is refused before the request leaves the
 *   browser, with a plain message: the password never reaches the app's access log;
 * - a session kept in IndexedDB (Firebase Auth does) is part of the session: the storage state carries it, and the
 *   token is one of the values to redact.
 * - the password is only typed on, and only sent to, the sign-in page's own origin: a sign-in page that redirects to
 *   another origin, or a form that posts the password to one, fails with a plain message and nothing is sent there.
 */
import type { Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeBrowser, getBrowser } from "../../test-support/harness.js";
import { json, startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import type { TestAccount } from "../accounts/types.js";
import type { DiscoveredForm } from "../core/types.js";
import { sessionSecrets, signIn, signInForm, SignInError, type SessionState } from "./auth.js";
import { discoverPage } from "./discover.js";

const EMAIL = "someone@example.test";
const PASSWORD = "horse(battery)!~staple";
const TOKEN = "idb-token-7f3a9c21e4b84d0f";

let browser: Browser;
let server: FixtureServer;
/** Another origin (another port on the same machine): where the password must never go. */
let elsewhere: FixtureServer;

const shell = (title: string, body: string) => `<!doctype html><html lang="en"><head><title>${title}</title></head><body><main>${body}</main></body></html>`;

beforeAll(async () => {
  browser = await getBrowser();
  const sessions = new Set<string>();
  elsewhere = await startFixtureServer({
    pages: {
      "/login": shell(
        "Sign in",
        `<h1>Sign in</h1><form id="f" aria-label="Sign in"><label for="e">Email</label><input id="e" type="email" autocomplete="username">
<label for="pw">Password</label><input id="pw" type="password" autocomplete="current-password"><button type="submit">Sign in</button></form>`,
      ),
    },
    routes: { "POST /api/login": (_req, res) => json(res, 200, { ok: true }) },
  });
  server = await startFixtureServer({
    pages: {
      // A sign-up form with one password field, then the sign-in form (as on many landing pages).
      "/welcome": shell(
        "Welcome",
        `<section><h2>New here?</h2>
<form id="signup" aria-label="Create an account"><label for="su-email">Email</label><input id="su-email" type="email" name="email">
<label for="su-pass">Choose a password</label><input id="su-pass" type="password" name="password"><button type="submit">Create account</button>
<p role="alert" id="su-error"></p></form></section>
<section><h2>Welcome back</h2>
<form id="signin" aria-label="Sign in"><label for="li-email">Email</label><input id="li-email" type="email" name="email">
<label for="li-pass">Password</label><input id="li-pass" type="password" name="password"><button type="submit">Sign in</button>
<p role="alert" id="li-error"></p></form></section>
<script>
function post(path, form, errorId) {
  return function (e) {
    e.preventDefault();
    fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: form.email.value, password: form.password.value }) })
      .then(function (r) { if (r.ok) location.assign("/home"); else r.json().then(function (d) { document.getElementById(errorId).textContent = d.error; }); });
  };
}
var su = document.getElementById("signup"), si = document.getElementById("signin");
su.addEventListener("submit", post("/api/signup", su, "su-error"));
si.addEventListener("submit", post("/api/login", si, "li-error"));
</script>`,
      ),
      "/home": shell("Home", `<h1>Home</h1><p>Signed in.</p>`),
      // A plain GET form: submitting it would put the password in the address (and the server's access log).
      "/get-login": shell(
        "Sign in",
        `<h1>Sign in</h1><form action="/session" aria-label="Sign in"><label for="u">Email</label><input id="u" name="username" type="email" autocomplete="username">
<label for="p">Password</label><input id="p" name="password" type="password" autocomplete="current-password"><button type="submit">Sign in</button></form>`,
      ),
      // Signs in by keeping the token in IndexedDB only (no cookie, no localStorage), as Firebase Auth does.
      "/idb-login": shell(
        "Sign in",
        `<h1>Sign in</h1><form id="f" aria-label="Sign in"><label for="e">Email</label><input id="e" type="email" autocomplete="username">
<label for="pw">Password</label><input id="pw" type="password" autocomplete="current-password"><button type="submit">Sign in</button></form>
<script>
document.getElementById("f").addEventListener("submit", function (e) {
  e.preventDefault();
  var open = indexedDB.open("authDb", 1);
  open.onupgradeneeded = function () { open.result.createObjectStore("users"); };
  open.onsuccess = function () {
    var tx = open.result.transaction("users", "readwrite");
    tx.objectStore("users").put({ stsTokenManager: { accessToken: "${TOKEN}" } }, "authUser");
    tx.oncomplete = function () { location.assign("/idb-home"); };
  };
});
</script>`,
      ),
      "/idb-home": shell(
        "Home",
        `<h1 id="h">Loading</h1>
<script>
var open = indexedDB.open("authDb", 1);
open.onupgradeneeded = function () { open.result.createObjectStore("users"); };
open.onsuccess = function () {
  var req = open.result.transaction("users").objectStore("users").get("authUser");
  req.onsuccess = function () { document.getElementById("h").textContent = req.result ? "Signed in" : "Signed out"; };
};
</script>`,
      ),
    },
    routes: {
      "POST /api/signup": (_req, res) => json(res, 201, { ok: true }),
      "POST /api/login": (req, res) => {
        const body = JSON.parse(req.body) as { email?: string; password?: string };
        if (body.email !== EMAIL || body.password !== PASSWORD) return json(res, 401, { error: "Email or password is incorrect" });
        const sid = `s${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
        sessions.add(sid);
        res.writeHead(200, { "content-type": "application/json", "set-cookie": `sid=${sid}; Path=/; HttpOnly; SameSite=Lax` });
        res.end(JSON.stringify({ ok: true }));
      },
      // The sign-in page moved to another origin.
      "GET /moved-login": (_req, res) => {
        res.writeHead(302, { location: `${elsewhere.url}/login` });
        res.end();
      },
      // A sign-in page whose form posts the password to another origin (text/plain: a simple request, no preflight).
      "GET /cross-login": (_req, res) => {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(
          shell(
            "Sign in",
            `<h1>Sign in</h1><form id="f" aria-label="Sign in"><label for="e">Email</label><input id="e" type="email" autocomplete="username">
<label for="pw">Password</label><input id="pw" type="password" autocomplete="current-password"><button type="submit">Sign in</button></form>
<script>
document.getElementById("f").addEventListener("submit", function (e) {
  e.preventDefault();
  fetch("${elsewhere.url}/api/login", { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ email: document.getElementById("e").value, password: document.getElementById("pw").value }) });
});
</script>`,
          ),
        );
      },
      "GET /session": (_req, res) => {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(shell("Home", "<h1>Home</h1>"));
      },
      "GET /favicon.ico": (_req, res) => {
        res.writeHead(204);
        res.end();
      },
    },
  });
});

afterAll(async () => {
  await closeBrowser();
  await server?.close();
  await elsewhere?.close();
});

function account(path: string): TestAccount {
  return { id: "a", label: "Account A", loginUrl: `${server.url}${path}`, username: EMAIL, password: PASSWORD };
}

async function formsOf(html: string): Promise<DiscoveredForm[]> {
  const page = await browser.newPage();
  try {
    await page.setContent(html);
    return (await discoverPage(page)).forms;
  } finally {
    await page.close();
  }
}

describe("signInForm", () => {
  it("picks the sign-in form after a sign-up form with one password field", async () => {
    const forms = await formsOf(
      `<form aria-label="Create an account"><label for="a">Email</label><input id="a" type="email"><label for="b">Choose a password</label><input id="b" type="password"><button type="submit">Create account</button></form>
<form aria-label="Welcome back"><label for="c">Email</label><input id="c" type="email"><label for="d">Password</label><input id="d" type="password"><button type="submit">Log in</button></form>`,
    );
    expect(signInForm(forms)?.name).toBe("Welcome back");
  });

  it("prefers autocomplete=current-password, and never picks a form whose password is a new-password", async () => {
    const forms = await formsOf(
      `<form aria-label="Join"><label for="a">Email</label><input id="a" type="email"><label for="b">Password</label><input id="b" type="password" autocomplete="new-password"><button type="submit">Continue</button></form>
<form aria-label="Account"><label for="c">Email</label><input id="c" type="email"><label for="d">Password</label><input id="d" type="password" autocomplete="current-password"><button type="submit">Continue</button></form>`,
    );
    expect(signInForm(forms)?.name).toBe("Account");
    expect(signInForm(forms.slice(0, 1))).toBeNull();
  });

  it("still takes a plain password form that says nothing about itself", async () => {
    const forms = await formsOf(
      `<form><label for="c">Email</label><input id="c" type="email"><label for="d">Password</label><input id="d" type="password"><button type="submit">Continue</button></form>`,
    );
    expect(signInForm(forms)).not.toBeNull();
  });
});

describe("signIn", () => {
  it("signs in through the sign-in form, never the sign-up form placed before it", async () => {
    server.requests.length = 0;
    const result = await signIn(browser, account("/welcome"));
    expect(result.landedOn).toContain("/home");
    const posts = server.requests.filter((r) => r.method === "POST").map((r) => r.url);
    expect(posts).toEqual(["/api/login"]);
  });

  it("refuses a form that would send the password in the page address, before it is sent", async () => {
    server.requests.length = 0;
    const err = await signIn(browser, account("/get-login")).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(SignInError);
    const message = (err as Error).message;
    expect(message).toMatch(/password in the page address/);
    expect(message).not.toContain(PASSWORD);
    expect(message).not.toContain(new URLSearchParams({ p: PASSWORD }).toString().slice(2));
    // The app never received it: no request carried the password.
    for (const r of server.requests) {
      expect(decodeURIComponent(r.url.replace(/\+/g, " ")), r.url).not.toContain(PASSWORD);
    }
  });

  it("never types the password on a sign-in page that moved to another origin", async () => {
    elsewhere.requests.length = 0;
    const err = await signIn(browser, account("/moved-login")).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(SignInError);
    expect((err as Error).message).toMatch(/only typed on/);
    expect((err as Error).message).not.toContain(PASSWORD);
    expect(elsewhere.requests.filter((r) => r.method === "POST")).toEqual([]);
  });

  it("stops a form that posts the password to another origin, before it is sent", async () => {
    elsewhere.requests.length = 0;
    const err = await signIn(browser, account("/cross-login")).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(SignInError);
    expect((err as Error).message).toMatch(/sends the password to/);
    expect((err as Error).message).not.toContain(PASSWORD);
    expect(elsewhere.requests.filter((r) => r.method === "POST")).toEqual([]);
  });

  it("keeps a session held in IndexedDB, and names its token for redaction", async () => {
    const result = await signIn(browser, account("/idb-login"));
    expect(result.secrets).toContain(TOKEN);
    const context = await browser.newContext({ storageState: result.state });
    try {
      const page = await context.newPage();
      await page.goto(`${server.url}/idb-home`);
      await expect.poll(() => page.locator("#h").textContent()).toBe("Signed in");
    } finally {
      await context.close();
    }
  });
});

describe("sessionSecrets", () => {
  it("finds tokens in IndexedDB records (a Firebase-style auth user)", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJlLXZhbHVl";
    const state = {
      cookies: [],
      origins: [
        {
          origin: "http://127.0.0.1:5000",
          localStorage: [],
          indexedDB: [
            {
              name: "firebaseLocalStorageDb",
              version: 1,
              stores: [
                {
                  name: "firebaseLocalStorage",
                  autoIncrement: false,
                  keyPath: "fbase_key",
                  records: [{ value: { fbase_key: "firebase:authUser:x", value: { stsTokenManager: { accessToken: jwt, refreshToken: "AMf-vBx8Q2l9ZkR4y7Tn3Lp0" } } } }],
                  indexes: [],
                },
              ],
            },
          ],
        },
      ],
    } as unknown as SessionState;
    const found = sessionSecrets(state);
    expect(found).toContain(jwt);
    expect(found).toContain("AMf-vBx8Q2l9ZkR4y7Tn3Lp0");
  });
});
