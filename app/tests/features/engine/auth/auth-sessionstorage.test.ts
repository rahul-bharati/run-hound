// signIn with a session kept in sessionStorage (0.6.0, docs/v2-spec.md "Sign-in: two-step and sessionStorage"): after a successful sign-in, signIn reads sessionStorage for the sign-in origin and the landing origin and returns it as SignedIn.sessionStorage ([{ origin, items: [{ name, value }] }], absent when the app keeps nothing there). Token-like values are in `secrets`, so they are redacted. A storageState can't carry sessionStorage, so a new browser context is signed in only when those items are seeded before the app's scripts run (context-sessionstorage.test.ts covers Run Hound's own contexts; here the test seeds them itself). Runs against the accounts app in tokenMode "session-storage" (the SPA keeps its token in sessionStorage["token"] and sends it as Authorization: Bearer; no cookie, no localStorage), and a one-off app whose sign-in page lands on another origin that keeps the token — that app also covers: an item the sign-in page keeps on its own origin just before it moves on to the landing origin (the contract reads both origins); a JSON value holding the tokens (oidc-client-ts's "oidc.user:<authority>:<client>" entry; MSAL.js): its token fields are secrets, its plain fields are not; an implicit-flow landing address that carries the token in its hash (#access_token=…, left in place by the app) — `landedOn` must not show it, so sessionStorage values are registered before the address is redacted.
import type { ServerResponse } from "node:http";
import type { Browser, BrowserContext } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startAccountsApp, type AccountsApp, type AccountsAppOptions } from "../../../../test-support/accounts-app.js";
import { closeBrowser, getBrowser } from "../../../../test-support/harness.js";
import { json, startFixtureServer, type FixtureServer } from "../../../../test-support/server.js";
import type { TestAccount } from "../../../../src/interfaces/accounts.js";
import { signIn, type SessionState, type SignedIn } from "../../../../src/engine/auth.js";

type SessionStorageItems = NonNullable<SignedIn["sessionStorage"]>;

const EMAIL = "someone@example.test";
const PASSWORD = "ss-landing(pass)~4821";

let browser: Browser;
const apps = new Map<string, AccountsApp>();
// Signs in on http://127.0.0.1:<port>/login and lands on http://localhost:<port>/app, which keeps the token (or on /login-implicit, landing on /app-implicit#access_token=…).
let crossApp: FixtureServer;
let landingOrigin: string;
const codes = new Set<string>();
// Access tokens the app issued (both flows); refresh tokens; the values the sign-in page keeps as "login_session".
const tokens = new Set<string>();
const refreshes = new Set<string>();
const loginSessions = new Set<string>();

// One accounts app per option set, started once for the file.
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

// A new browser context with `state` that seeds `items` into sessionStorage, for their own origin only and before any page script runs (an init script), the way the contract says Run Hound's contexts do.
async function seededContext(state: SessionState, items: SessionStorageItems): Promise<BrowserContext> {
  const context = await browser.newContext({ storageState: state });
  await context.addInitScript((entries) => {
    for (const entry of entries) {
      if (entry.origin !== location.origin) continue;
      for (const item of entry.items) if (sessionStorage.getItem(item.name) === null) sessionStorage.setItem(item.name, item.value);
    }
  }, items);
  return context;
}

// Who the accounts app's /settings says is signed in for a new context (seeded with `items`), or null when it shows the sign-in page.
async function signedInEmail(target: AccountsApp, state: SessionState, items: SessionStorageItems = []): Promise<string | null> {
  const context = await seededContext(state, items);
  try {
    const page = await context.newPage();
    await page.goto(`${target.url}/settings`);
    await page.locator("#me-email, #signin-form").first().waitFor({ timeout: 10_000 });
    return (await page.locator("#me-email").count()) > 0 ? await page.locator("#me-email").textContent() : null;
  } finally {
    await context.close();
  }
}

// GET /api/me with a raw credential header, outside any browser.
async function me(target: AccountsApp, headers: Record<string, string>): Promise<{ status: number; email?: string }> {
  const res = await fetch(`${target.url}/api/me`, { headers });
  const body = (await res.json().catch(() => ({}))) as { email?: string };
  return { status: res.status, email: body.email };
}

// The items signIn returned for `origin` (every entry for it, merged).
function itemsFor(result: SignedIn, origin: string): { name: string; value: string }[] {
  return (result.sessionStorage ?? []).filter((e) => e.origin === origin).flatMap((e) => e.items);
}

const shell = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body><main>${body}</main></body></html>`;

const randomValue = () => `${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;

// A sign-in page (reached as 127.0.0.1): posts the email and password as JSON to `api` on its own origin; on a 200 it runs `onSuccess` (plain JS, with the answer as `d`), else shows the error in an alert.
const loginPage = (api: string, onSuccess: string) =>
  shell(
    "Sign in",
    `<h1>Sign in</h1><form id="f" aria-label="Sign in"><label for="e">Email</label><input id="e" type="email" autocomplete="username">
<label for="pw">Password</label><input id="pw" type="password" autocomplete="current-password"><button type="submit">Sign in</button>
<p role="alert" id="err" hidden></p></form>
<script>
document.getElementById("f").addEventListener("submit", function (e) {
  e.preventDefault();
  fetch(${JSON.stringify(api)}, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: document.getElementById("e").value, password: document.getElementById("pw").value }) })
    .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
    .then(function (x) {
      if (x.ok) { var d = x.d; ${onSuccess} return; }
      var a = document.getElementById("err"); a.textContent = x.d.error; a.hidden = false;
    });
});
</script>`,
  );

// In-page: show(token) asks /api/whoami with the token and puts "Signed in as <email>" or "Signed out" in #who.
const WHO = `var who = document.getElementById("who");
function show(token) {
  fetch("/api/whoami", { headers: { authorization: "Bearer " + token } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) { who.textContent = d ? "Signed in as " + d.email : "Signed out"; });
}`;

function sendHtml(res: ServerResponse, body: string): void {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(body);
}

// The body is { email, password } for the one-off account.
function rightPassword(body: string): boolean {
  const parsed = JSON.parse(body || "{}") as { email?: string; password?: string };
  return parsed.email === EMAIL && parsed.password === PASSWORD;
}

beforeAll(async () => {
  browser = await getBrowser();
  crossApp = await startFixtureServer({
    routes: {
      // The sign-in page: keeps its own "login_session" item on its origin, then goes to the app on localhost with a
      // one-time code.
      "GET /login": (_req, res) =>
        sendHtml(
          res,
          loginPage(
            "/api/login",
            `sessionStorage.setItem("login_session", d.session); location.assign(${JSON.stringify(`${landingOrigin}/app`)} + "?code=" + encodeURIComponent(d.code));`,
          ),
        ),
      // The app (reached as localhost): trades the code for tokens, keeps the access token in sessionStorage both as a
      // plain "access_token" item and inside oidc-client-ts's JSON user entry (with the refresh token and the profile),
      // and shows who is signed in; without a token it says "Signed out".
      "GET /app": (_req, res) =>
        sendHtml(
          res,
          shell(
            "App",
            `<h1 id="who">Loading</h1>
<script>
${WHO}
var code = new URLSearchParams(location.search).get("code");
var stored = sessionStorage.getItem("access_token");
if (code) {
  fetch("/api/token", { method: "POST", headers: { "content-type": "text/plain" }, body: code })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      sessionStorage.setItem("access_token", d.token);
      sessionStorage.setItem("oidc.user:" + location.origin + ":web", JSON.stringify({ access_token: d.token, refresh_token: d.refresh, token_type: "Bearer", profile: { email: d.email } }));
      history.replaceState(null, "", "/app");
      show(d.token);
    });
} else if (stored) show(stored);
else who.textContent = "Signed out";
</script>`,
          ),
        ),
      // The implicit flow: the sign-in page gets the token itself and lands on /app-implicit#access_token=<token>.
      "GET /login-implicit": (_req, res) =>
        sendHtml(
          res,
          loginPage(
            "/api/login-implicit",
            `location.assign(${JSON.stringify(`${landingOrigin}/app-implicit`)} + "#access_token=" + encodeURIComponent(d.token) + "&token_type=Bearer");`,
          ),
        ),
      // Keeps the hash's token in sessionStorage and leaves the address as it is (no replaceState).
      "GET /app-implicit": (_req, res) =>
        sendHtml(
          res,
          shell(
            "App",
            `<h1 id="who">Loading</h1>
<script>
${WHO}
var token = new URLSearchParams(location.hash.slice(1)).get("access_token") || sessionStorage.getItem("access_token");
if (token) { sessionStorage.setItem("access_token", token); show(token); }
else who.textContent = "Signed out";
</script>`,
          ),
        ),
      "POST /api/login": (req, res) => {
        if (!rightPassword(req.body)) return json(res, 401, { error: "Email or password is incorrect" });
        const code = randomValue();
        codes.add(code);
        const session = `ls_${randomValue()}`;
        loginSessions.add(session);
        return json(res, 200, { code, session });
      },
      "POST /api/login-implicit": (req, res) => {
        if (!rightPassword(req.body)) return json(res, 401, { error: "Email or password is incorrect" });
        // An opaque token (not a JWT): only its registration as a session secret redacts it.
        const token = `at_${randomValue()}`;
        tokens.add(token);
        return json(res, 200, { token });
      },
      "POST /api/token": (req, res) => {
        if (!codes.delete(req.body)) return json(res, 400, { error: "Unknown code" });
        const token = `at_${randomValue()}`;
        const refresh = `rt_${randomValue()}`;
        tokens.add(token);
        refreshes.add(refresh);
        return json(res, 200, { token, refresh, email: EMAIL });
      },
      "GET /api/whoami": (req, res) => {
        const match = /^Bearer\s+(\S+)$/.exec(String(req.headers.authorization ?? ""));
        if (!match || !tokens.has(match[1]!)) return json(res, 401, { error: "Sign in first" });
        return json(res, 200, { email: EMAIL });
      },
      "GET /favicon.ico": (_req, res) => {
        res.writeHead(204);
        res.end();
      },
    },
  });
  landingOrigin = `http://localhost:${new URL(crossApp.url).port}`;
});

afterAll(async () => {
  await Promise.all([...apps.values()].map((a) => a.stop()));
  await crossApp?.close();
  await closeBrowser();
});

describe("signIn: a session kept in sessionStorage", () => {
  it("the accounts app's session-storage mode works by hand (so the tests below fail only for signIn's reasons)", async () => {
    const target = await app({ tokenMode: "session-storage" });
    const { email, password } = target.users.alice;
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto(target.loginUrl);
      await page.locator("#email").fill(email);
      await page.locator("#password").fill(password);
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.waitForURL((url) => url.pathname === "/notes");
      await page.getByRole("heading", { name: "Your notes", level: 1 }).waitFor();
      const kept = await page.evaluate(() => ({ token: sessionStorage.getItem("token"), user: sessionStorage.getItem("user"), local: localStorage.length }));
      expect(kept.token).toBeTruthy();
      expect(JSON.parse(kept.user ?? "{}")).toMatchObject({ email });
      expect(await me(target, { authorization: `Bearer ${kept.token}` })).toEqual({ status: 200, email });
      // Nowhere else: no cookie, no localStorage.
      expect(kept.local).toBe(0);
      expect(await context.cookies()).toEqual([]);
      // A new tab of the same browser context starts with an empty sessionStorage, so the app asks to sign in.
      const tab = await context.newPage();
      await tab.goto(`${target.url}/settings`);
      await tab.locator("#signin-form").waitFor();
      expect(new URL(tab.url()).pathname).toBe("/login");
    } finally {
      await context.close();
    }
  });

  it("returns every sessionStorage item the app kept, under the app's origin, with the live token", async () => {
    const target = await app({ tokenMode: "session-storage" });
    const result = await signIn(browser, target.account("a"));

    expect(result.sessionStorage, "SignedIn.sessionStorage").toBeDefined();
    // Signed in and landed on the same origin: one entry for it, and nothing for any other origin.
    expect(result.sessionStorage!.map((e) => e.origin)).toEqual([target.url]);
    const items = itemsFor(result, target.url);
    expect(items.map((i) => i.name).sort()).toEqual(["token", "user"]);
    const token = items.find((i) => i.name === "token")!.value;
    expect(await me(target, { authorization: `Bearer ${token}` })).toEqual({ status: 200, email: target.users.alice.email });
    expect(JSON.parse(items.find((i) => i.name === "user")!.value)).toMatchObject({ email: target.users.alice.email });
    // The app keeps its session nowhere else.
    expect(result.state.cookies).toEqual([]);
    expect(result.state.origins.flatMap((o) => o.localStorage)).toEqual([]);
    expect(result.landedOn).toContain("/notes");
    expect(target.activeSessions("alice")).toBe(1);
  });

  it("puts the token in secrets (so it is redacted), and not a plain value such as the user summary", async () => {
    const target = await app({ tokenMode: "session-storage" });
    const result = await signIn(browser, target.account("a"));
    const items = itemsFor(result, target.url);
    const token = items.find((i) => i.name === "token")?.value;
    expect(token).toBeTruthy();
    expect(result.secrets).toContain(token);
    expect(result.secrets).not.toContain(items.find((i) => i.name === "user")?.value);
  });

  it("the items sign a new browser context in when seeded before the app's scripts run; the storage state alone does not", async () => {
    const target = await app({ tokenMode: "session-storage" });
    const result = await signIn(browser, target.account("a"));
    expect(itemsFor(result, target.url).length).toBeGreaterThan(0);
    // Without the items the app shows its sign-in page: the storage state holds no session.
    expect(await signedInEmail(target, result.state)).toBeNull();
    expect(await signedInEmail(target, result.state, result.sessionStorage ?? [])).toBe(target.users.alice.email);
  });

  it("signs Account B in with its own token", async () => {
    const target = await app({ tokenMode: "session-storage" });
    const a = await signIn(browser, target.account("a"));
    const b = await signIn(browser, target.account("b"));
    const tokenA = itemsFor(a, target.url).find((i) => i.name === "token")?.value;
    const tokenB = itemsFor(b, target.url).find((i) => i.name === "token")?.value;
    expect(tokenB).toBeTruthy();
    expect(tokenB).not.toBe(tokenA);
    expect(await me(target, { authorization: `Bearer ${tokenB}` })).toEqual({ status: 200, email: target.users.bob.email });
    expect(b.secrets).toContain(tokenB);
    expect(b.secrets).not.toContain(tokenA);
  });

  it("works after a two-step sign-in too", async () => {
    const target = await app({ tokenMode: "session-storage", loginVariant: "two-step" });
    const result = await signIn(browser, target.account("a"));
    const token = itemsFor(result, target.url).find((i) => i.name === "token")?.value;
    expect(token).toBeTruthy();
    expect(result.secrets).toContain(token);
    expect(await signedInEmail(target, result.state, result.sessionStorage ?? [])).toBe(target.users.alice.email);
  });

  it.each(["cookie", "bearer"] as const)("a %s session keeps nothing in sessionStorage: SignedIn.sessionStorage is absent", async (tokenMode) => {
    const target = await app({ tokenMode });
    const result = await signIn(browser, target.account("a"));
    // Absent, not an empty list: callers add init scripts only when the field is there.
    expect(result.sessionStorage).toBeUndefined();
  });
});

describe("signIn: a sessionStorage session on the landing origin", () => {
  function account(path = "/login"): TestAccount {
    return { id: "a", label: "Account A", loginUrl: `${crossApp.url}${path}`, username: EMAIL, password: PASSWORD };
  }

  // Signs in by hand on `path` (the one-off app's sign-in page) and waits until the landing page says who is signed in.
  async function byHand(context: BrowserContext, path: string) {
    const page = await context.newPage();
    await page.goto(`${crossApp.url}${path}`);
    await page.locator("#e").fill(EMAIL);
    await page.locator("#pw").fill(PASSWORD);
    await page.locator("#f button[type=submit]").click();
    await page.waitForURL((url) => url.origin === landingOrigin);
    await expect.poll(() => page.locator("#who").textContent()).toBe(`Signed in as ${EMAIL}`);
    return page;
  }

  it("the one-off app works by hand: it lands on the other origin, keeps the token there, and a new tab is signed out", async () => {
    const context = await browser.newContext();
    let items: SessionStorageItems;
    try {
      const page = await byHand(context, "/login");
      const token = await page.evaluate(() => sessionStorage.getItem("access_token"));
      expect(token).toBeTruthy();
      // oidc-client-ts's JSON user entry holds the same token, a refresh token and the profile.
      const user = JSON.parse((await page.evaluate((key) => sessionStorage.getItem(key), `oidc.user:${landingOrigin}:web`)) ?? "{}") as Record<string, unknown>;
      expect(user).toEqual({ access_token: token, refresh_token: expect.stringMatching(/^rt_/), token_type: "Bearer", profile: { email: EMAIL } });
      expect(refreshes.has(user.refresh_token as string)).toBe(true);
      items = [{ origin: landingOrigin, items: [{ name: "access_token", value: token! }] }];
      // Back on the sign-in origin in the same tab: the sign-in page kept its own item there before it moved on.
      await page.goBack();
      await page.waitForURL((url) => url.origin === new URL(crossApp.url).origin);
      const kept = await page.evaluate(() => sessionStorage.getItem("login_session"));
      expect(kept && loginSessions.has(kept)).toBe(true);
      // A new tab of the same browser context starts with an empty sessionStorage.
      const tab = await context.newPage();
      await tab.goto(`${landingOrigin}/app`);
      await expect.poll(() => tab.locator("#who").textContent()).toBe("Signed out");
    } finally {
      await context.close();
    }
    const seeded = await seededContext({ cookies: [], origins: [] }, items);
    try {
      const page = await seeded.newPage();
      await page.goto(`${landingOrigin}/app`);
      await expect.poll(() => page.locator("#who").textContent()).toBe(`Signed in as ${EMAIL}`);
    } finally {
      await seeded.close();
    }
  });

  it("the implicit flow works by hand: the landing address keeps #access_token=<token>, and the token is kept in sessionStorage", async () => {
    const context = await browser.newContext();
    try {
      const page = await byHand(context, "/login-implicit");
      const token = await page.evaluate(() => sessionStorage.getItem("access_token"));
      expect(token && tokens.has(token)).toBe(true);
      expect(new URL(page.url()).pathname).toBe("/app-implicit");
      expect(page.url()).toContain(`#access_token=${token}`);
    } finally {
      await context.close();
    }
  });

  it("returns the landing origin's items under that origin, not the sign-in page's", async () => {
    crossApp.requests.length = 0;
    const result = await signIn(browser, account());
    expect(new URL(result.landedOn).origin).toBe(landingOrigin);

    const landing = itemsFor(result, landingOrigin);
    const token = landing.find((i) => i.name === "access_token")?.value;
    expect(token, `an access_token item for ${landingOrigin}`).toBeTruthy();
    expect(tokens.has(token!)).toBe(true);
    expect(result.secrets).toContain(token);
    // The token never lived on the sign-in page's origin.
    const elsewhere = (result.sessionStorage ?? []).filter((e) => e.origin !== landingOrigin).flatMap((e) => e.items);
    expect(elsewhere.map((i) => i.value)).not.toContain(token);
    // The password only ever went to the sign-in page's origin.
    const withPassword = crossApp.requests.filter((r) => r.body.includes(PASSWORD)).map((r) => `${r.method} ${r.url} ${String(r.headers.host)}`);
    expect(withPassword).toEqual([`POST /api/login ${new URL(crossApp.url).host}`]);

    // Seeded into a new context, the items sign the app in there.
    const context = await seededContext(result.state, result.sessionStorage ?? []);
    try {
      const page = await context.newPage();
      await page.goto(`${landingOrigin}/app`);
      await expect.poll(() => page.locator("#who").textContent()).toBe(`Signed in as ${EMAIL}`);
    } finally {
      await context.close();
    }
  });

  it("also returns the item the sign-in page kept on its own origin before the tab moved on to the landing origin", async () => {
    const result = await signIn(browser, account());
    expect(new URL(result.landedOn).origin).toBe(landingOrigin);
    const kept = itemsFor(result, crossApp.url).find((i) => i.name === "login_session");
    expect(kept, `a login_session item for ${crossApp.url} (the sign-in origin)`).toBeDefined();
    expect(loginSessions.has(kept!.value)).toBe(true);
    expect(result.secrets).toContain(kept!.value);
    // Under the sign-in origin only.
    expect(itemsFor(result, landingOrigin).map((i) => i.name)).not.toContain("login_session");
  });

  it("walks a JSON value (oidc-client-ts's user entry): its access and refresh tokens are secrets, the profile's email is not", async () => {
    const result = await signIn(browser, account());
    const entry = itemsFor(result, landingOrigin).find((i) => i.name === `oidc.user:${landingOrigin}:web`);
    expect(entry, "the oidc.user entry, as the app stored it").toBeDefined();
    const user = JSON.parse(entry!.value) as { access_token: string; refresh_token: string; profile: { email: string } };
    expect(tokens.has(user.access_token)).toBe(true);
    expect(refreshes.has(user.refresh_token)).toBe(true);
    expect(result.secrets).toContain(user.access_token);
    expect(result.secrets).toContain(user.refresh_token);
    expect(user.profile.email).toBe(EMAIL);
    expect(result.secrets).not.toContain(EMAIL);
    expect(result.secrets).not.toContain("Bearer");
  });

  it("redacts a token the landing address carries (an implicit-flow #access_token= the app leaves in place)", async () => {
    crossApp.requests.length = 0;
    const result = await signIn(browser, account("/login-implicit"));
    const token = itemsFor(result, landingOrigin).find((i) => i.name === "access_token")?.value;
    expect(token, `an access_token item for ${landingOrigin}`).toBeTruthy();
    expect(tokens.has(token!)).toBe(true);
    expect(result.secrets).toContain(token);
    // It landed there, and the address it reports doesn't show the token.
    expect(new URL(result.landedOn).origin).toBe(landingOrigin);
    expect(new URL(result.landedOn).pathname).toBe("/app-implicit");
    expect(result.landedOn).not.toContain(token);
    expect(decodeURIComponent(result.landedOn)).not.toContain(token);
  });
});
