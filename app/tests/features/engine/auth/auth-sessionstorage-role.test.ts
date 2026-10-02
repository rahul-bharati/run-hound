// signIn returns an app's sessionStorage, and registers its values as session secrets, only when the session lives there (0.6.0, round 1 of the release review; docs/v2-spec.md "Sign-in: two-step and sessionStorage"). Session in sessionStorage when the app sent one of its values as a credential after the password was typed (Authorization, x-api-key, a session-named header — never a CSRF header), or when the storage state holds no session at all (no session cookie, no localStorage / IndexedDB token); then SignedIn.sessionStorage holds every item, and a random-looking value counts whatever its key, except one the app's own requests carried as a path segment or query value (an id, not a secret) and never in a credential header. Otherwise (cookie or localStorage session) SignedIn.sessionStorage is absent, so nothing is seeded, and its values are registered by localStorage's rules only. Three small apps, each on its own server: `cookieApp` (sid session, landing page caches GET /api/session and GET /api/users/<id> in sessionStorage cache-first, keeps the workspace UUID there, lists GET /api/workspaces/<uuid>/tasks; /api/users/<id> answers any signed-in user — the IDOR the access checks find), `bearerApp` (opaque token in sessionStorage["app-state"] = { v, ws }, sends as Authorization: Bearer; sets a csrf_token cookie it never reads), `quietApp` (opaque token in sessionStorage["app-state"] = { v }, no cookie, landing page sends nothing until a button click).
import { mkdtemp, rm } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeBrowser, getBrowser } from "../../../../test-support/harness.js";
import { json, startFixtureServer, type FixtureServer, type RecordedRequest } from "../../../../test-support/server.js";
import type { TestAccount } from "../../../../src/interfaces/accounts.js";
import { sessionSecrets, signIn, type SessionState, type SignedIn } from "../../../../src/engine/auth.js";
import { createCheckContext } from "../../../../src/engine/context.js";
import { emptyForm } from "../../../../src/engine/discover.js";

const ALICE = { email: "alice@example.test", password: "alice-pass-7Q2x", id: "u1", name: "Alice Example", ws: "3f2b8c1e-4d5a-4b6c-8e9f-0a1b2c3d4e5f" };
const BOB = { email: "bob@example.test", password: "bob-pass-9W4z", id: "u2", name: "Bob Example", ws: "7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d" };
const USERS = [ALICE, BOB];

let browser: Browser;
let cookieApp: FixtureServer;
let bearerApp: FixtureServer;
let quietApp: FixtureServer;
// Sessions of each app: the cookie app's sid values, the token apps' tokens, per email.
const sids = new Map<string, string>();
const tokens = new Map<string, string>();

const shell = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body><main>${body}</main></body></html>`;

function sendHtml(res: ServerResponse, body: string): void {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(body);
}

function redirect(res: ServerResponse, location: string, headers: Record<string, string> = {}): void {
  res.writeHead(303, { location, ...headers });
  res.end();
}

const cookieOf = (req: RecordedRequest, name: string) => new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(String(req.headers.cookie ?? ""))?.[1];
const bearerOf = (req: RecordedRequest) => /^Bearer\s+(\S+)$/.exec(String(req.headers.authorization ?? ""))?.[1];
const userBySid = (req: RecordedRequest) => USERS.find((u) => sids.get(u.email) === cookieOf(req, "sid") && cookieOf(req, "sid") !== undefined);
const userByToken = (req: RecordedRequest) => USERS.find((u) => tokens.get(u.email) === bearerOf(req) && bearerOf(req) !== undefined);

// A plain sign-in form that posts to /login (the cookie app).
const FORM_LOGIN = shell(
  "Sign in",
  `<h1>Sign in</h1><form method="post" action="/login" aria-label="Sign in">
<label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email">
<label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password">
<button type="submit">Sign in</button></form>`,
);

// A sign-in form that posts JSON to /api/login and, on a 200, keeps `d` (the answer) as `keep` says, then goes to /app.
const scriptLogin = (keep: string) =>
  shell(
    "Sign in",
    `<h1>Sign in</h1><form id="f" aria-label="Sign in"><label for="email">Email</label><input id="email" type="email" autocomplete="username">
<label for="password">Password</label><input id="password" type="password" autocomplete="current-password"><button type="submit">Sign in</button>
<p role="alert" id="err" hidden></p></form>
<script>
document.getElementById("f").addEventListener("submit", function (e) {
  e.preventDefault();
  fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: document.getElementById("email").value, password: document.getElementById("password").value }) })
    .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
    .then(function (x) {
      if (!x.ok) { var a = document.getElementById("err"); a.textContent = "Wrong email or password"; a.hidden = false; return; }
      var d = x.d; ${keep} location.assign("/app");
    });
});
</script>`,
  );

function jsonLogin(body: string): (typeof USERS)[number] | undefined {
  const parsed = JSON.parse(body || "{}") as { email?: string; password?: string };
  return USERS.find((u) => u.email === parsed.email && u.password === parsed.password);
}

const newToken = () => `tk${randomBytes(20).toString("hex")}`;

beforeAll(async () => {
  browser = await getBrowser();

  cookieApp = await startFixtureServer({
    routes: {
      "GET /login": (_req, res) => sendHtml(res, FORM_LOGIN),
      "POST /login": (req, res) => {
        const form = new URLSearchParams(req.body);
        const user = USERS.find((u) => u.email === form.get("email") && u.password === form.get("password"));
        if (!user) return sendHtml(res, shell("Sign in", `<p role="alert">Wrong email or password</p>`));
        const sid = randomBytes(24).toString("hex");
        sids.set(user.email, sid);
        redirect(res, `/app?workspace=${user.ws}`, { "set-cookie": `sid=${sid}; Path=/; HttpOnly; SameSite=Lax` });
      },
      "GET /app": (req, res) => {
        if (!userBySid(req)) return redirect(res, "/login");
        sendHtml(
          res,
          shell(
            "Profile",
            `<h1>Your profile</h1><p id="name">…</p><p id="tasks">…</p><p id="done" hidden>ready</p>
<script>
async function cached(key, url) {
  var hit = sessionStorage.getItem(key);
  if (hit) return JSON.parse(hit);
  var data = await (await fetch(url)).json();
  sessionStorage.setItem(key, JSON.stringify(data));
  return data;
}
(async function () {
  var session = await cached("session", "/api/session");
  var me = await cached("user:" + session.userId, "/api/users/" + session.userId);
  document.getElementById("name").textContent = me.name;
  var ws = sessionStorage.getItem("currentWorkspace") || new URLSearchParams(location.search).get("workspace") || session.workspaceId;
  sessionStorage.setItem("currentWorkspace", ws);
  var list = await (await fetch("/api/workspaces/" + ws + "/tasks")).json();
  document.getElementById("tasks").textContent = list.tasks.length + " tasks";
  document.getElementById("done").hidden = false;
})();
</script>`,
          ),
        );
      },
      "GET /api/session": (req, res) => {
        const user = userBySid(req);
        if (!user) return json(res, 401, { error: "Sign in" });
        json(res, 200, { userId: user.id, workspaceId: user.ws });
      },
      "GET /favicon.ico": (_req, res) => {
        res.writeHead(204);
        res.end();
      },
    },
    fallback: (req, res) => {
      const path = new URL(req.url, "http://x").pathname;
      if (!userBySid(req)) return json(res, 401, { error: "Sign in" });
      const profile = /^\/api\/users\/([^/]+)$/.exec(path);
      // The planted IDOR: any signed-in user reads any profile.
      const target = profile ? USERS.find((u) => u.id === profile[1]) : undefined;
      if (target) return json(res, 200, { id: target.id, email: target.email, name: target.name });
      if (/^\/api\/workspaces\/[^/]+\/tasks$/.test(path)) return json(res, 200, { tasks: [] });
      json(res, 404, { error: "Not found" });
    },
  });

  bearerApp = await startFixtureServer({
    routes: {
      "GET /login": (_req, res) => sendHtml(res, scriptLogin(`sessionStorage.setItem("app-state", JSON.stringify({ v: d.token, ws: d.workspaceId }));`)),
      "POST /api/login": (req, res) => {
        const user = jsonLogin(req.body);
        if (!user) return json(res, 401, { error: "Wrong email or password" });
        const token = newToken();
        tokens.set(user.email, token);
        // A cookie with a session-like name that isn't the session: the app never reads it.
        res.setHeader("set-cookie", `csrf_token=${randomBytes(16).toString("hex")}; Path=/; SameSite=Lax`);
        json(res, 200, { token, workspaceId: user.ws });
      },
      "GET /app": (_req, res) =>
        sendHtml(
          res,
          shell(
            "Tasks",
            `<h1 id="who">Loading</h1><p id="tasks">…</p>
<script>
var state = JSON.parse(sessionStorage.getItem("app-state") || "null");
if (!state) location.replace("/login");
else {
  var auth = { headers: { authorization: "Bearer " + state.v } };
  fetch("/api/me", auth).then(function (r) { return r.json(); }).then(function (d) { document.getElementById("who").textContent = "Signed in as " + d.email; });
  fetch("/api/workspaces/" + state.ws + "/tasks", auth).then(function (r) { return r.json(); }).then(function (d) { document.getElementById("tasks").textContent = d.tasks.length + " tasks"; });
}
</script>`,
          ),
        ),
      "GET /api/me": (req, res) => {
        const user = userByToken(req);
        if (!user) return json(res, 401, { error: "Sign in" });
        json(res, 200, { id: user.id, email: user.email });
      },
      "GET /favicon.ico": (_req, res) => {
        res.writeHead(204);
        res.end();
      },
    },
    fallback: (req, res) => {
      if (!userByToken(req)) return json(res, 401, { error: "Sign in" });
      if (/^\/api\/workspaces\/[^/]+\/tasks$/.test(new URL(req.url, "http://x").pathname)) return json(res, 200, { tasks: [] });
      json(res, 404, { error: "Not found" });
    },
  });

  quietApp = await startFixtureServer({
    routes: {
      "GET /login": (_req, res) => sendHtml(res, scriptLogin(`sessionStorage.setItem("app-state", JSON.stringify({ v: d.token }));`)),
      "POST /api/login": (req, res) => {
        const user = jsonLogin(req.body);
        if (!user) return json(res, 401, { error: "Wrong email or password" });
        const token = newToken();
        tokens.set(user.email, token);
        json(res, 200, { token });
      },
      "GET /app": (_req, res) =>
        sendHtml(
          res,
          shell(
            "Home",
            `<h1 id="who">Home</h1><button type="button" id="load">Load my account</button>
<script>
var state = JSON.parse(sessionStorage.getItem("app-state") || "null");
if (!state) location.replace("/login");
document.getElementById("load").addEventListener("click", function () {
  fetch("/api/me", { headers: { authorization: "Bearer " + state.v } }).then(function (r) { return r.json(); }).then(function (d) { document.getElementById("who").textContent = "Signed in as " + d.email; });
});
</script>`,
          ),
        ),
      "GET /api/me": (req, res) => {
        const user = userByToken(req);
        if (!user) return json(res, 401, { error: "Sign in" });
        json(res, 200, { id: user.id, email: user.email });
      },
      "GET /favicon.ico": (_req, res) => {
        res.writeHead(204);
        res.end();
      },
    },
  });
});

afterAll(async () => {
  await Promise.all([cookieApp?.close(), bearerApp?.close(), quietApp?.close()]);
  await closeBrowser();
});

const account = (app: FixtureServer, user = ALICE): TestAccount => ({ id: "a", label: "Account A", loginUrl: `${app.url}/login`, username: user.email, password: user.password });

// Every string a SignedIn's sessionStorage holds: its whole values, and the strings of the JSON they hold.
function storedStrings(items: { value: string }[]): string[] {
  const out: string[] = [];
  for (const { value } of items) {
    out.push(value);
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

const dataReads = (app: FixtureServer) => app.requests.filter((r) => r.method === "GET" && r.url.startsWith("/api/")).map((r) => r.url.split("?")[0]);

describe("signIn: a cookie session whose pages keep cached reads and ids in sessionStorage", () => {
  it("by hand: the cookie alone signs a new context in; the landing page fills sessionStorage, and a copy of it stops the page's data reads", async () => {
    const context = await browser.newContext();
    let kept: { name: string; value: string }[];
    let state: SessionState;
    try {
      const page = await context.newPage();
      await page.goto(`${cookieApp.url}/login`);
      await page.locator("#email").fill(ALICE.email);
      await page.locator("#password").fill(ALICE.password);
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.locator("#done").waitFor();
      kept = await page.sessionStorage.items();
      expect(kept.map((i) => i.name).sort()).toEqual(["currentWorkspace", "session", `user:${ALICE.id}`]);
      expect(kept.find((i) => i.name === "currentWorkspace")?.value).toBe(ALICE.ws);
      state = await context.storageState();
    } finally {
      await context.close();
    }

    // The storage state alone (the sid cookie) signs a new context in, and its page reads the data itself.
    cookieApp.requests.length = 0;
    const fresh = await browser.newContext({ storageState: state });
    try {
      const page = await fresh.newPage();
      await page.goto(`${cookieApp.url}/app?workspace=${ALICE.ws}`);
      await page.locator("#done").waitFor();
      expect(await page.locator("#name").textContent()).toBe(ALICE.name);
      expect(dataReads(cookieApp)).toEqual(expect.arrayContaining(["/api/session", `/api/users/${ALICE.id}`]));
    } finally {
      await fresh.close();
    }

    // Seeded with a copy of that sessionStorage, the same page reads its profile from the copy: no data GET to replay.
    cookieApp.requests.length = 0;
    const seeded = await browser.newContext({ storageState: state });
    try {
      await seeded.addInitScript((items) => {
        for (const item of items) sessionStorage.setItem(item.name, item.value);
      }, kept);
      const page = await seeded.newPage();
      await page.goto(`${cookieApp.url}/app?workspace=${ALICE.ws}`);
      await page.locator("#done").waitFor();
      expect(dataReads(cookieApp)).not.toContain(`/api/users/${ALICE.id}`);
      expect(dataReads(cookieApp)).not.toContain("/api/session");
    } finally {
      await seeded.close();
    }
  });

  it("returns no sessionStorage (nothing is seeded), and registers the sid, not the workspace id or the cached reads", async () => {
    const result = await signIn(browser, account(cookieApp));
    expect(new URL(result.landedOn).pathname).toBe("/app");
    expect(result.state.cookies.map((c) => c.name)).toEqual(["sid"]);
    expect(result.sessionStorage, "SignedIn.sessionStorage of a cookie-session app").toBeUndefined();
    expect(result.secrets).toContain(sids.get(ALICE.email));
    expect(result.secrets).not.toContain(ALICE.ws);
    for (const value of [ALICE.id, ALICE.name, ALICE.email, JSON.stringify({ userId: ALICE.id, workspaceId: ALICE.ws })]) expect(result.secrets).not.toContain(value);
  });

  it("a page opened with that session sends its own data reads (GET /api/users/<id>), so the access checks have them to replay", async () => {
    const result = await signIn(browser, account(cookieApp));
    const artifactsDir = await mkdtemp(join(tmpdir(), "rh-sessionstorage-role-"));
    const target = `${cookieApp.url}/app?workspace=${ALICE.ws}`;
    const ctx = createCheckContext({
      browser,
      form: emptyForm(target),
      targetUrl: target,
      artifactsDir,
      runToken: "t3st",
      sessions: { self: result.state },
      ...(result.sessionStorage ? { sessionStorage: { self: result.sessionStorage } } : {}),
      accounts: { self: { id: "a", label: "Account A" }, other: null },
    });
    try {
      cookieApp.requests.length = 0;
      const { page } = await ctx.openPage();
      await page.locator("#done").waitFor();
      expect(await page.locator("#name").textContent()).toBe(ALICE.name);
      expect(dataReads(cookieApp)).toContain(`/api/users/${ALICE.id}`);
    } finally {
      await ctx.dispose();
      await rm(artifactsDir, { recursive: true, force: true });
    }
  });
});

// Round 2 of the release review: the cookie session was found only by its cookie's name (SESSION_NAME: sess, sid, auth, token …). ASP.NET Core's ".AspNetCore.Cookies", an "app_user" cookie or a custom iron-session name says nothing of a session, so the same cache-first app was taken for a sessionStorage session: its read cache was seeded into every context and the IDOR went unseen again. The submit that signs in sets (or changes) the session cookie, whatever its name: that is what says the session lives in a cookie. A session cookie set before the password (a PHPSESSID the app doesn't renew) is still found by its name.
describe("signIn: a cookie session whose cookie's name says nothing of a session", () => {
  // Per cookie name: that app's session values, per email.
  const jars = new Map<string, Map<string, string>>();
  const apps = new Map<string, FixtureServer>();

  // The cookie app of the describe above with its session in `cookie`. `early`: the cookie is set when the sign-in page loads (not yet signed in) and the submit signs that same session in without renewing it (a PHPSESSID).
  async function cachingApp(cookie: string, early = false): Promise<FixtureServer> {
    const jar = new Map<string, string>();
    // Session value → the signed-in email, or "" while signed out.
    const sessions = new Map<string, string>();
    jars.set(cookie, jar);
    const escaped = cookie.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const valueOf = (req: RecordedRequest) => new RegExp(`(?:^|;\\s*)${escaped}=([^;]+)`).exec(String(req.headers.cookie ?? ""))?.[1];
    const who = (req: RecordedRequest) => {
      const value = valueOf(req);
      const email = value ? sessions.get(value) : undefined;
      return email ? USERS.find((u) => u.email === email) : undefined;
    };
    return startFixtureServer({
      routes: {
        "GET /login": (req, res) => {
          if (early && !valueOf(req)) {
            const value = randomBytes(16).toString("hex");
            sessions.set(value, "");
            res.setHeader("set-cookie", `${cookie}=${value}; Path=/; HttpOnly; SameSite=Lax`);
          }
          sendHtml(res, FORM_LOGIN);
        },
        "POST /login": (req, res) => {
          const form = new URLSearchParams(req.body);
          const user = USERS.find((u) => u.email === form.get("email") && u.password === form.get("password"));
          if (!user) return sendHtml(res, shell("Sign in", `<p role="alert">Wrong email or password</p>`));
          const existing = valueOf(req);
          if (early && existing && sessions.has(existing)) {
            sessions.set(existing, user.email);
            jar.set(user.email, existing);
            return redirect(res, `/app?workspace=${user.ws}`);
          }
          const value = randomBytes(24).toString("base64url");
          sessions.set(value, user.email);
          jar.set(user.email, value);
          redirect(res, `/app?workspace=${user.ws}`, { "set-cookie": `${cookie}=${value}; Path=/; HttpOnly; SameSite=Lax` });
        },
        "GET /app": (req, res) => {
          if (!who(req)) return redirect(res, "/login");
          sendHtml(
            res,
            shell(
              "Profile",
              `<h1>Your profile</h1><p id="name">…</p><p id="done" hidden>ready</p>
<script>
async function cached(key, url) {
  var hit = sessionStorage.getItem(key);
  if (hit) return JSON.parse(hit);
  var data = await (await fetch(url)).json();
  sessionStorage.setItem(key, JSON.stringify(data));
  return data;
}
(async function () {
  var session = await cached("session", "/api/session");
  var me = await cached("user:" + session.userId, "/api/users/" + session.userId);
  document.getElementById("name").textContent = me.name;
  sessionStorage.setItem("currentWorkspace", new URLSearchParams(location.search).get("workspace") || session.workspaceId);
  document.getElementById("done").hidden = false;
})();
</script>`,
            ),
          );
        },
        "GET /api/session": (req, res) => {
          const user = who(req);
          if (!user) return json(res, 401, { error: "Sign in" });
          json(res, 200, { userId: user.id, workspaceId: user.ws });
        },
        "GET /favicon.ico": (_req, res) => {
          res.writeHead(204);
          res.end();
        },
      },
      fallback: (req, res) => {
        if (!who(req)) return json(res, 401, { error: "Sign in" });
        const profile = /^\/api\/users\/([^/]+)$/.exec(new URL(req.url, "http://x").pathname);
        const target = profile ? USERS.find((u) => u.id === profile[1]) : undefined;
        if (target) return json(res, 200, { id: target.id, email: target.email, name: target.name });
        json(res, 404, { error: "Not found" });
      },
    });
  }

  const NAMES = [".AspNetCore.Cookies", "app_user", "acme-app"];

  beforeAll(async () => {
    for (const name of NAMES) apps.set(name, await cachingApp(name));
    apps.set("PHPSESSID", await cachingApp("PHPSESSID", true));
  });

  afterAll(async () => {
    await Promise.all([...apps.values()].map((app) => app.close()));
  });

  for (const name of [...NAMES, "PHPSESSID"]) {
    const how = name === "PHPSESSID" ? "set before the password and kept by the submit" : "set by the submit";
    it(`${name} (${how}): returns no sessionStorage, and registers the cookie, not the workspace id or the cached reads`, async () => {
      const app = apps.get(name)!;
      const result = await signIn(browser, account(app));
      expect(new URL(result.landedOn).pathname).toBe("/app");
      expect(result.state.cookies.map((c) => c.name)).toEqual([name]);
      expect(result.sessionStorage, `SignedIn.sessionStorage of a cookie-session app (${name})`).toBeUndefined();
      expect(result.secrets).toContain(jars.get(name)!.get(ALICE.email));
      expect(result.secrets).not.toContain(ALICE.ws);
    });
  }

  it(".AspNetCore.Cookies: a page opened with that session sends its own data reads (GET /api/users/<id>) for the access checks to replay", async () => {
    const app = apps.get(".AspNetCore.Cookies")!;
    const result = await signIn(browser, account(app));
    const artifactsDir = await mkdtemp(join(tmpdir(), "rh-sessionstorage-role-"));
    const target = `${app.url}/app?workspace=${ALICE.ws}`;
    const ctx = createCheckContext({
      browser,
      form: emptyForm(target),
      targetUrl: target,
      artifactsDir,
      runToken: "t3st",
      sessions: { self: result.state },
      ...(result.sessionStorage ? { sessionStorage: { self: result.sessionStorage } } : {}),
      accounts: { self: { id: "a", label: "Account A" }, other: null },
    });
    try {
      app.requests.length = 0;
      const { page } = await ctx.openPage();
      await page.locator("#done").waitFor();
      expect(await page.locator("#name").textContent()).toBe(ALICE.name);
      expect(dataReads(app)).toContain(`/api/users/${ALICE.id}`);
    } finally {
      await ctx.dispose();
      await rm(artifactsDir, { recursive: true, force: true });
    }
  });
});

// Round 2 of the release review: an app whose session lives in sessionStorage and sends nothing with it while signing in, but whose sign-in answer also sets an XSRF-TOKEN cookie (Laravel, Angular) and an analytics cookie. "No session anywhere else" read that cookie as a session (its name says token), so nothing was seeded and the run was signed out. A CSRF cookie and an analytics cookie never hold the session.
describe("signIn: a sessionStorage session next to an XSRF-TOKEN cookie, with nothing sent with it while signing in", () => {
  let xsrfApp: FixtureServer;

  beforeAll(async () => {
    xsrfApp = await startFixtureServer({
      routes: {
        "GET /login": (_req, res) => sendHtml(res, scriptLogin(`sessionStorage.setItem("app-state", JSON.stringify({ v: d.token }));`)),
        "POST /api/login": (req, res) => {
          const user = jsonLogin(req.body);
          if (!user) return json(res, 401, { error: "Wrong email or password" });
          const token = newToken();
          tokens.set(user.email, token);
          res.setHeader("set-cookie", [
            `XSRF-TOKEN=${randomBytes(30).toString("base64url")}; Path=/; SameSite=Lax`,
            `_ga=GA1.1.${Date.now()}.${Date.now()}; Path=/; SameSite=Lax`,
          ]);
          json(res, 200, { token });
        },
        "GET /app": (_req, res) =>
          sendHtml(
            res,
            shell(
              "Home",
              `<h1 id="who">Home</h1><button type="button" id="load">Load my account</button>
<script>
var state = JSON.parse(sessionStorage.getItem("app-state") || "null");
if (!state) location.replace("/login");
document.getElementById("load").addEventListener("click", function () {
  fetch("/api/me", { headers: { authorization: "Bearer " + state.v } }).then(function (r) { return r.json(); }).then(function (d) { document.getElementById("who").textContent = "Signed in as " + d.email; });
});
</script>`,
            ),
          ),
        "GET /api/me": (req, res) => {
          const user = userByToken(req);
          if (!user) return json(res, 401, { error: "Sign in" });
          json(res, 200, { id: user.id, email: user.email });
        },
        "GET /favicon.ico": (_req, res) => {
          res.writeHead(204);
          res.end();
        },
      },
    });
  });

  afterAll(async () => {
    await xsrfApp?.close();
  });

  it("returns the items and registers the token, so a new context is signed in", async () => {
    const result = await signIn(browser, account(xsrfApp));
    expect(result.state.cookies.map((c) => c.name).sort()).toEqual(["XSRF-TOKEN", "_ga"]);
    expect(result.sessionStorage, "SignedIn.sessionStorage of a sessionStorage session").toBeDefined();
    const token = tokens.get(ALICE.email)!;
    expect(storedStrings(result.sessionStorage!.flatMap((e) => e.items))).toContain(token);
    expect(result.secrets).toContain(token);
  });
});

describe("signIn: a session kept in sessionStorage, next to an id the app keeps there too", () => {
  it("by hand: the bearer app sends its token as Authorization and the workspace id in its addresses; a new tab is signed out", async () => {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto(`${bearerApp.url}/login`);
      await page.locator("#email").fill(ALICE.email);
      await page.locator("#password").fill(ALICE.password);
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect.poll(() => page.locator("#who").textContent()).toBe(`Signed in as ${ALICE.email}`);
      const state = JSON.parse((await page.sessionStorage.getItem("app-state")) ?? "{}") as { v?: string; ws?: string };
      expect(state).toEqual({ v: tokens.get(ALICE.email), ws: ALICE.ws });
      expect(bearerApp.requests.some((r) => r.url === `/api/workspaces/${ALICE.ws}/tasks` && bearerOf(r) === state.v)).toBe(true);
      expect((await context.cookies()).map((c) => c.name)).toEqual(["csrf_token"]);
      const tab = await context.newPage();
      await tab.goto(`${bearerApp.url}/app`);
      await tab.waitForURL((url) => url.pathname === "/login");
    } finally {
      await context.close();
    }
  });

  it("returns the items, registers the token (sent as a credential) and not the workspace id (sent in its addresses)", async () => {
    const result = await signIn(browser, account(bearerApp));
    expect(result.sessionStorage, "SignedIn.sessionStorage of a sessionStorage session").toBeDefined();
    const items = result.sessionStorage!.filter((e) => e.origin === bearerApp.url).flatMap((e) => e.items);
    expect(items.map((i) => i.name)).toEqual(["app-state"]);
    const token = tokens.get(ALICE.email)!;
    expect(storedStrings(items)).toContain(token);
    expect(result.secrets).toContain(token);
    expect(result.secrets).not.toContain(ALICE.ws);
  });

  it("returns the items of an app that sends nothing with its token while signing in, when the session is nowhere else", async () => {
    const result = await signIn(browser, account(quietApp));
    expect(result.state.cookies).toEqual([]);
    expect(result.sessionStorage, "SignedIn.sessionStorage of a sessionStorage session").toBeDefined();
    const items = result.sessionStorage!.flatMap((e) => e.items);
    const token = tokens.get(ALICE.email)!;
    expect(storedStrings(items)).toContain(token);
    expect(result.secrets).toContain(token);
  });
});

describe("sessionSecrets: sessionStorage read by localStorage's rules unless the session lives there", () => {
  const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const JWT = `${b64url({ alg: "HS256" })}.${b64url({ sub: "u1" })}.FAKEsignatureFAKEsignature_-012`;
  const OPAQUE = "Qm9vbXNoYWthbGFrYTEyMzQ1Njc4OTBhYmNkZWZnaGk";
  const NAMED = "a1b2c3d4e5f6a1b2c3d4e5f6";
  const EMPTY: SessionState = { cookies: [], origins: [] };
  const items = (list: { name: string; value: string }[]): NonNullable<SignedIn["sessionStorage"]> => [{ origin: "http://localhost:1", items: list }];
  const stored = items([
    { name: "currentWorkspace", value: ALICE.ws },
    { name: "cache", value: JSON.stringify({ id: OPAQUE }) },
    { name: "token", value: NAMED },
    { name: "claims", value: JWT },
  ]);

  it("when the session doesn't live in sessionStorage: a value under a session-like key and a JWT, not an opaque value under a neutral key", () => {
    const secrets = sessionSecrets(EMPTY, stored, { sessionStorageSession: false });
    expect(secrets).toContain(NAMED);
    expect(secrets).toContain(JWT);
    expect(secrets).not.toContain(ALICE.ws);
    expect(secrets).not.toContain(OPAQUE);
  });

  it("when it does: every random-looking value, except one the app's addresses carried (an id)", () => {
    expect(sessionSecrets(EMPTY, stored)).toEqual(expect.arrayContaining([NAMED, JWT, ALICE.ws, OPAQUE]));
    const secrets = sessionSecrets(EMPTY, stored, { addressValues: new Set([ALICE.ws, NAMED]) });
    expect(secrets).toEqual(expect.arrayContaining([NAMED, JWT, OPAQUE]));
    expect(secrets).not.toContain(ALICE.ws);
  });
});
