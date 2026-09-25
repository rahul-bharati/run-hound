import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Browser, BrowserContext, Page } from "playwright";
import { startAccountsApp, type AccountsApp, type AccountsAppOptions } from "../test-support/accounts-app.js";
import { closeBrowser, getBrowser } from "../test-support/harness.js";
import { discoverForm, discoverPage } from "../src/engine/discover.js";

/**
 * The shared V2 test app (test-support/accounts-app.ts) behaves as its header comment documents, in every mode. These
 * tests are infrastructure checks: they must pass before any 0.4.0 feature exists.
 */

interface Reply {
  status: number;
  headers: Headers;
  text: string;
  data: any;
}

async function call(
  app: AccountsApp,
  method: string,
  path: string,
  options: { body?: unknown; raw?: string; headers?: Record<string, string> } = {},
): Promise<Reply> {
  const headers: Record<string, string> = { ...(options.body !== undefined || options.raw !== undefined ? { "content-type": "application/json" } : {}), ...options.headers };
  const res = await fetch(app.url + path, {
    method,
    headers,
    body: options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
    redirect: "manual",
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  return { status: res.status, headers: res.headers, text, data };
}

/** Signs in over HTTP like the client does and returns the header the session needs. */
async function login(app: AccountsApp, who: "alice" | "bob"): Promise<Record<string, string>> {
  const user = app.users[who];
  const body = app.options.loginVariant === "username" ? { username: user.username, password: user.password } : { email: user.email, password: user.password };
  const r = await call(app, "POST", "/api/login", { body });
  expect(r.status).toBe(200);
  if (app.options.tokenMode === "bearer") return { authorization: `Bearer ${r.data.token}` };
  const sid = r.headers.getSetCookie().find((c) => c.startsWith("sid="));
  expect(sid).toBeDefined();
  return { cookie: sid!.split(";")[0]! };
}

const started: AccountsApp[] = [];
async function start(options: AccountsAppOptions = {}): Promise<AccountsApp> {
  const app = await startAccountsApp(options);
  started.push(app);
  return app;
}

afterAll(async () => {
  await Promise.all(started.map((a) => a.stop()));
  await closeBrowser();
});

describe("accounts app over HTTP: clean mode (cookie sessions, email sign-in)", () => {
  let app: AccountsApp;
  beforeAll(async () => {
    app = await start();
  });
  beforeEach(() => {
    app.reset();
    app.signOutEveryone();
  });

  it("listens on a free 127.0.0.1 port and resolves every option to its default", () => {
    expect(app.url).toBe(`http://127.0.0.1:${app.port}`);
    expect(app.port).toBeGreaterThan(0);
    expect(app.loginUrl).toBe(`${app.url}/login`);
    expect(app.options).toEqual({
      tokenMode: "cookie",
      loginVariant: "email",
      idor: false,
      listLeak: false,
      noAuth: false,
      massAssign: false,
      deepLink404: false,
    });
  });

  it("has the two documented users", () => {
    expect(app.users.alice).toMatchObject({
      id: "u1",
      email: "alice@example.test",
      username: "alice",
      password: "alice-pass-1234",
      role: "member",
      plan: "free",
    });
    expect(app.users.bob).toMatchObject({ id: "u2", email: "bob@example.test", username: "bob", password: "bob-pass-5678" });
  });

  it("serves the shell for its pages without a session, redirects / and answers 404 elsewhere", async () => {
    for (const path of ["/login", "/notes", "/settings", "/help", "/profile", "/login?next=/notes"]) {
      const r = await call(app, "GET", path);
      expect(r.status, path).toBe(200);
      expect(r.headers.get("content-type"), path).toContain("text/html");
      expect(r.text, path).toContain('<div id="app">');
    }
    const root = await call(app, "GET", "/");
    expect(root.status).toBe(302);
    expect(root.headers.get("location")).toBe("/notes");
    const missing = await call(app, "GET", "/nope");
    expect(missing.status).toBe(404);
    expect(missing.text).toContain("Not Found");
    expect((await call(app, "GET", "/favicon.ico")).status).toBe(204);
    expect((await call(app, "GET", "/api/nope")).status).toBe(404);
  });

  it("signs in with the right password: 200, the user, and an HttpOnly SameSite=Lax sid cookie", async () => {
    const r = await call(app, "POST", "/api/login", { body: { email: "alice@example.test", password: "alice-pass-1234" } });
    expect(r.status).toBe(200);
    expect(r.data).toEqual({ user: { id: "u1", name: "Alice Archer", email: "alice@example.test" } });
    const cookies = r.headers.getSetCookie();
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatch(/^sid=[0-9a-f]+;/);
    expect(cookies[0]).toContain("HttpOnly");
    expect(cookies[0]).toContain("SameSite=Lax");
    expect(cookies[0]).toContain("Path=/");
  });

  it("refuses a wrong password or an unknown email with 401 and the documented error, and non-JSON with 400", async () => {
    const wrong = await call(app, "POST", "/api/login", { body: { email: "alice@example.test", password: "bob-pass-5678" } });
    expect(wrong.status).toBe(401);
    expect(wrong.data).toEqual({ error: "Email or password is incorrect" });
    expect(wrong.headers.getSetCookie()).toEqual([]);
    const unknown = await call(app, "POST", "/api/login", { body: { email: "carol@example.test", password: "x" } });
    expect(unknown.status).toBe(401);
    const bad = await call(app, "POST", "/api/login", { raw: "email=alice" });
    expect(bad.status).toBe(400);
    expect(bad.data.error).toEqual(expect.any(String));
    expect(app.activeSessions()).toBe(0);
  });

  it("GET /api/me names the session user and answers 401 without a session", async () => {
    const alice = await login(app, "alice");
    const me = await call(app, "GET", "/api/me", { headers: alice });
    expect(me.status).toBe(200);
    expect(me.data).toEqual({ id: "u1", name: "Alice Archer", email: "alice@example.test", username: "alice" });
    const anon = await call(app, "GET", "/api/me");
    expect(anon.status).toBe(401);
    expect(anon.data).toEqual({ error: "Sign in first" });
    // Cookie mode ignores bearer tokens.
    const bearer = await call(app, "GET", "/api/me", { headers: { authorization: `Bearer ${alice.cookie!.slice(4)}` } });
    expect(bearer.status).toBe(401);
  });

  it("every data endpoint answers 401 without a session", async () => {
    expect((await call(app, "GET", "/api/notes")).status).toBe(401);
    expect((await call(app, "POST", "/api/notes", { body: { title: "x", body: "y" } })).status).toBe(401);
    expect((await call(app, "GET", "/api/users/u1/profile")).status).toBe(401);
    expect((await call(app, "PUT", "/api/users/u1/profile", { body: { bio: "x" } })).status).toBe(401);
    expect((await call(app, "GET", "/api/notes", { headers: { cookie: "sid=not-a-session" } })).status).toBe(401);
    expect(app.notes()).toHaveLength(3);
  });

  it("GET /api/notes returns only the session user's notes", async () => {
    const alice = await call(app, "GET", "/api/notes", { headers: await login(app, "alice") });
    expect(alice.status).toBe(200);
    expect(alice.data).toEqual({
      notes: [
        { id: "n1", ownerId: "u1", title: "Groceries", body: "Eggs, flour, oat milk" },
        { id: "n2", ownerId: "u1", title: "Trip ideas", body: "Lisbon in spring" },
      ],
    });
    const bob = await call(app, "GET", "/api/notes", { headers: await login(app, "bob") });
    expect(bob.data).toEqual({ notes: [{ id: "n3", ownerId: "u2", title: "Reading list", body: "Piranesi, then Dune" }] });
    expect(bob.text.toLowerCase()).not.toContain("alice");
  });

  it("POST /api/notes saves title and body for the session user only, and refuses an empty title", async () => {
    const alice = await login(app, "alice");
    const created = await call(app, "POST", "/api/notes", { headers: alice, body: { title: "Run token t3st", body: "hello", ownerId: "u2", pinned: true } });
    expect(created.status).toBe(201);
    expect(created.data).toEqual({ note: { id: "n4", ownerId: "u1", title: "Run token t3st", body: "hello" } });
    const mine = await call(app, "GET", "/api/notes", { headers: alice });
    expect(mine.text).toContain("Run token t3st");
    const bobs = await call(app, "GET", "/api/notes", { headers: await login(app, "bob") });
    expect(bobs.text).not.toContain("Run token t3st");
    const empty = await call(app, "POST", "/api/notes", { headers: alice, body: { title: "  ", body: "x" } });
    expect(empty.status).toBe(400);
    expect(empty.data).toEqual({ error: "Title is required" });
    expect(app.notes().map((n) => n.id)).toEqual(["n1", "n2", "n3", "n4"]);
  });

  it("GET /api/users/:id/profile returns the own profile and 404 for another or unknown id", async () => {
    const alice = await login(app, "alice");
    const own = await call(app, "GET", "/api/users/u1/profile", { headers: alice });
    expect(own.status).toBe(200);
    expect(own.data).toEqual({
      id: "u1",
      email: "alice@example.test",
      username: "alice",
      displayName: "Alice",
      bio: "Keeps careful lists.",
      role: "member",
      plan: "free",
    });
    const other = await call(app, "GET", "/api/users/u2/profile", { headers: alice });
    expect(other.status).toBe(404);
    expect(other.data).toEqual({ error: "Not found" });
    expect((await call(app, "GET", "/api/users/u9/profile", { headers: alice })).status).toBe(404);
  });

  it("PUT /api/users/:id/profile keeps only displayName and bio, and 404s for another user's id", async () => {
    const alice = await login(app, "alice");
    const put = await call(app, "PUT", "/api/users/u1/profile", {
      headers: alice,
      body: { displayName: "Al", bio: "New bio", role: "admin", isAdmin: true, plan: "pro", credits: 999999, id: "u2" },
    });
    expect(put.status).toBe(200);
    expect(put.data).toEqual({ id: "u1", email: "alice@example.test", username: "alice", displayName: "Al", bio: "New bio", role: "member", plan: "free" });
    const get = await call(app, "GET", "/api/users/u1/profile", { headers: alice });
    expect(get.data).toEqual(put.data);
    expect(app.profile("alice")).toEqual(put.data);
    const other = await call(app, "PUT", "/api/users/u2/profile", { headers: alice, body: { bio: "hacked" } });
    expect(other.status).toBe(404);
    expect(app.profile("bob").bio).toBe("Reads on the train.");
    expect((await call(app, "PUT", "/api/users/u1/profile", { headers: alice, raw: "[1]" })).status).toBe(400);
  });

  it("POST /api/logout ends the session and clears the cookie", async () => {
    const alice = await login(app, "alice");
    expect(app.activeSessions("alice")).toBe(1);
    const out = await call(app, "POST", "/api/logout", { headers: alice });
    expect(out.status).toBe(204);
    expect(out.headers.getSetCookie()[0]).toMatch(/^sid=;.*Max-Age=0/);
    expect((await call(app, "GET", "/api/me", { headers: alice })).status).toBe(401);
    expect(app.activeSessions("alice")).toBe(0);
    expect((await call(app, "POST", "/api/logout")).status).toBe(204);
  });

  it("POST /api/signup is always closed", async () => {
    const r = await call(app, "POST", "/api/signup", { body: { email: "carol@example.test", password: "x" } });
    expect(r.status).toBe(403);
    expect(r.data.error).toContain("closed");
  });

  it("OTP verification does not exist outside the otp variant", async () => {
    const r = await call(app, "POST", "/api/login/verify", { body: { challenge: "x", code: "123456" } });
    expect(r.status).toBe(401);
    expect(r.data).toEqual({ error: "That code is not right" });
  });

  it("records every request with method, path + query, headers and body", async () => {
    await call(app, "GET", "/notes?x=1");
    await call(app, "POST", "/api/login", { body: { email: "bob@example.test", password: "bob-pass-5678" } });
    expect(app.requests.map((r) => `${r.method} ${r.url}`)).toEqual(["GET /notes?x=1", "POST /api/login"]);
    expect(app.requests[1]!.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(app.requests[1]!.body)).toEqual({ email: "bob@example.test", password: "bob-pass-5678" });
  });

  it("reset() restores the seed data and empties requests in place, but sessions survive", async () => {
    const alice = await login(app, "alice");
    const requests = app.requests;
    await call(app, "POST", "/api/notes", { headers: alice, body: { title: "Temp" } });
    await call(app, "PUT", "/api/users/u1/profile", { headers: alice, body: { bio: "changed" } });
    app.reset();
    expect(app.requests).toBe(requests);
    expect(app.requests).toHaveLength(0);
    expect(app.notes()).toHaveLength(3);
    expect(app.profile("alice").bio).toBe("Keeps careful lists.");
    expect((await call(app, "GET", "/api/me", { headers: alice })).status).toBe(200);
    const again = await call(app, "POST", "/api/notes", { headers: alice, body: { title: "After reset" } });
    expect(again.data.note.id).toBe("n4");
  });

  it("authHeaders() opens a real session per call; signOutEveryone() ends them all", async () => {
    const headers = app.authHeaders("bob");
    expect(Object.keys(headers)).toEqual(["cookie"]);
    expect(headers.cookie).toMatch(/^sid=[0-9a-f]+$/);
    const me = await call(app, "GET", "/api/me", { headers });
    expect(me.data.id).toBe("u2");
    const before = app.activeSessions();
    app.authHeaders("alice");
    expect(app.activeSessions()).toBe(before + 1);
    app.signOutEveryone();
    expect(app.activeSessions()).toBe(0);
    expect((await call(app, "GET", "/api/me", { headers })).status).toBe(401);
  });

  it("storageState() is a Playwright storage state holding a live sid cookie", async () => {
    const state = app.storageState("alice");
    expect(state.origins).toEqual([]);
    expect(state.cookies).toHaveLength(1);
    expect(state.cookies[0]).toMatchObject({ name: "sid", domain: "127.0.0.1", path: "/", httpOnly: true, secure: false, sameSite: "Lax", expires: -1 });
    const me = await call(app, "GET", "/api/me", { headers: { cookie: `sid=${state.cookies[0]!.value}` } });
    expect(me.data.id).toBe("u1");
  });

  it("account() and accountsConfig() describe the users as test accounts", () => {
    expect(app.account("a")).toEqual({
      id: "a",
      label: "Account A",
      loginUrl: `${app.url}/login`,
      username: "alice@example.test",
      password: "alice-pass-1234",
    });
    expect(app.account("b")).toEqual({ id: "b", label: "Account B", loginUrl: `${app.url}/login`, username: "bob@example.test", password: "bob-pass-5678" });
    expect(app.account("a", "bob").username).toBe("bob@example.test");
    expect(app.accountsConfig()).toEqual({ isolated: true, accounts: { a: app.account("a"), b: app.account("b") } });
    expect(app.accountsConfig({ isolated: false }).isolated).toBe(false);
  });

  it("the page shell holds no account data", async () => {
    const r = await call(app, "GET", "/notes");
    expect(r.text.toLowerCase()).not.toContain("alice");
    expect(r.text.toLowerCase()).not.toContain("bob");
  });
});

describe("accounts app over HTTP: two apps are independent", () => {
  it("does not share ports, sessions or data", async () => {
    const one = await start();
    const two = await start();
    expect(one.port).not.toBe(two.port);
    const alice = await login(one, "alice");
    await call(one, "POST", "/api/notes", { headers: alice, body: { title: "Only in one" } });
    expect((await call(two, "GET", "/api/notes", { headers: alice })).status).toBe(401);
    expect(two.notes()).toHaveLength(3);
    expect(two.requests.some((r) => r.url === "/api/notes")).toBe(true);
    expect(one.notes()).toHaveLength(4);
  });
});

describe("accounts app over HTTP: bug toggles", () => {
  it("idor: any signed-in user reads any profile, but PUT stays owner-only", async () => {
    const app = await start({ idor: true });
    const bob = await login(app, "bob");
    const r = await call(app, "GET", "/api/users/u1/profile", { headers: bob });
    expect(r.status).toBe(200);
    expect(r.data.email).toBe("alice@example.test");
    expect((await call(app, "GET", "/api/users/u9/profile", { headers: bob })).status).toBe(404);
    expect((await call(app, "PUT", "/api/users/u1/profile", { headers: bob, body: { bio: "x" } })).status).toBe(404);
    expect((await call(app, "GET", "/api/users/u1/profile")).status).toBe(401);
    // Everything else stays clean.
    expect((await call(app, "GET", "/api/notes", { headers: bob })).data.notes).toHaveLength(1);
  });

  it("listLeak: GET /api/notes returns every user's notes", async () => {
    const app = await start({ listLeak: true });
    const alice = await login(app, "alice");
    await call(app, "POST", "/api/notes", { headers: alice, body: { title: "Alice test t3st" } });
    const r = await call(app, "GET", "/api/notes", { headers: await login(app, "bob") });
    expect(r.status).toBe(200);
    expect(r.data.notes.map((n: { id: string }) => n.id)).toEqual(["n1", "n2", "n3", "n4"]);
    expect(r.text).toContain("Alice test t3st");
    expect((await call(app, "GET", "/api/notes")).status).toBe(401);
    expect((await call(app, "GET", "/api/users/u1/profile", { headers: await login(app, "bob") })).status).toBe(404);
  });

  it("noAuth: data endpoints answer without a session as alice; /api/me stays honest", async () => {
    const app = await start({ noAuth: true });
    const notes = await call(app, "GET", "/api/notes");
    expect(notes.status).toBe(200);
    expect(notes.data.notes.map((n: { ownerId: string }) => n.ownerId)).toEqual(["u1", "u1"]);
    const profile = await call(app, "GET", "/api/users/u1/profile");
    expect(profile.status).toBe(200);
    expect(profile.data.email).toBe("alice@example.test");
    expect((await call(app, "GET", "/api/users/u2/profile")).status).toBe(404);
    const created = await call(app, "POST", "/api/notes", { body: { title: "Anonymous" } });
    expect(created.status).toBe(201);
    expect(created.data.note.ownerId).toBe("u1");
    expect((await call(app, "GET", "/api/me")).status).toBe(401);
    // A real session still wins.
    const bob = await call(app, "GET", "/api/notes", { headers: await login(app, "bob") });
    expect(bob.data.notes.map((n: { ownerId: string }) => n.ownerId)).toEqual(["u2"]);
  });

  it("massAssign: PUT profile stores every key but id, and GET returns them", async () => {
    const app = await start({ massAssign: true });
    const alice = await login(app, "alice");
    const extra = { role: "admin", isAdmin: true, is_admin: true, admin: true, plan: "pro", tier: "pro", credits: 999999, verified: true, emailVerified: true };
    const put = await call(app, "PUT", "/api/users/u1/profile", { headers: alice, body: { displayName: "Al", bio: "b", id: "u2", ...extra } });
    expect(put.status).toBe(200);
    expect(put.data).toMatchObject({ id: "u1", displayName: "Al", ...extra });
    const get = await call(app, "GET", "/api/users/u1/profile", { headers: alice });
    expect(get.data).toMatchObject({ id: "u1", ...extra });
    expect(app.profile("alice")).toMatchObject(extra);
    // Restoring the original values works for fields that existed; reset() removes the rest.
    await call(app, "PUT", "/api/users/u1/profile", { headers: alice, body: { role: "member", plan: "free" } });
    expect(app.profile("alice")).toMatchObject({ role: "member", plan: "free", isAdmin: true });
    app.reset();
    expect(app.profile("alice")).not.toHaveProperty("isAdmin");
    // Still owner-only.
    expect((await call(app, "PUT", "/api/users/u2/profile", { headers: alice, body: { role: "admin" } })).status).toBe(404);
  });

  it("deepLink404: a direct GET of /settings answers 404 Not Found; other pages don't", async () => {
    const app = await start({ deepLink404: true });
    const settings = await call(app, "GET", "/settings");
    expect(settings.status).toBe(404);
    expect(settings.text).toContain("<title>404 Not Found</title>");
    expect(settings.text).toContain("<h1>Not Found</h1>");
    for (const path of ["/notes", "/help", "/login", "/profile"]) expect((await call(app, "GET", path)).status, path).toBe(200);
  });
});

describe("accounts app over HTTP: bearer tokens", () => {
  let app: AccountsApp;
  beforeAll(async () => {
    app = await start({ tokenMode: "bearer" });
  });

  it("login returns a token and sets no cookie", async () => {
    const r = await call(app, "POST", "/api/login", { body: { email: "alice@example.test", password: "alice-pass-1234" } });
    expect(r.status).toBe(200);
    expect(r.data).toEqual({ token: expect.stringMatching(/^[0-9a-f]+$/), user: { id: "u1", name: "Alice Archer", email: "alice@example.test" } });
    expect(r.headers.getSetCookie()).toEqual([]);
  });

  it("the API reads only the Authorization header", async () => {
    const auth = await login(app, "alice");
    expect((await call(app, "GET", "/api/notes", { headers: auth })).status).toBe(200);
    expect((await call(app, "GET", "/api/notes")).status).toBe(401);
    const token = auth.authorization!.slice("Bearer ".length);
    expect((await call(app, "GET", "/api/notes", { headers: { cookie: `sid=${token}` } })).status).toBe(401);
    expect((await call(app, "GET", "/api/me", { headers: { authorization: "Bearer nope" } })).status).toBe(401);
    expect((await call(app, "POST", "/api/logout", { headers: auth })).headers.getSetCookie()).toEqual([]);
    expect((await call(app, "GET", "/api/me", { headers: auth })).status).toBe(401);
  });

  it("authHeaders() and storageState() carry a bearer token", async () => {
    const headers = app.authHeaders("bob");
    expect(headers).toEqual({ authorization: expect.stringMatching(/^Bearer [0-9a-f]+$/) });
    expect((await call(app, "GET", "/api/me", { headers })).data.id).toBe("u2");
    const state = app.storageState("alice");
    expect(state.cookies).toEqual([]);
    expect(state.origins).toEqual([{ origin: app.url, localStorage: [{ name: "token", value: expect.any(String) }] }]);
    const token = state.origins[0]!.localStorage[0]!.value;
    expect((await call(app, "GET", "/api/me", { headers: { authorization: `Bearer ${token}` } })).data.id).toBe("u1");
  });
});

describe("accounts app over HTTP: sign-in variants", () => {
  it("username: the identifier is the account name, not the email", async () => {
    const app = await start({ loginVariant: "username" });
    const ok = await call(app, "POST", "/api/login", { body: { username: "alice", password: "alice-pass-1234" } });
    expect(ok.status).toBe(200);
    const byEmail = await call(app, "POST", "/api/login", { body: { username: "alice@example.test", password: "alice-pass-1234" } });
    expect(byEmail.status).toBe(401);
    expect(byEmail.data).toEqual({ error: "Username or password is incorrect" });
    expect(app.account("a").username).toBe("alice");
    expect(app.account("b").username).toBe("bob");
  });

  it("two-password: signing in works as in the email variant", async () => {
    const app = await start({ loginVariant: "two-password" });
    expect((await call(app, "POST", "/api/login", { body: { email: "bob@example.test", password: "bob-pass-5678" } })).status).toBe(200);
    expect(app.account("b").username).toBe("bob@example.test");
  });

  it("otp: the right password only returns a challenge; code 123456 completes it", async () => {
    const app = await start({ loginVariant: "otp" });
    const step1 = await call(app, "POST", "/api/login", { body: { email: "alice@example.test", password: "alice-pass-1234" } });
    expect(step1.status).toBe(200);
    expect(step1.data).toEqual({ verify: true, challenge: expect.any(String) });
    expect(step1.headers.getSetCookie()).toEqual([]);
    expect(app.activeSessions()).toBe(0);
    const wrong = await call(app, "POST", "/api/login/verify", { body: { challenge: step1.data.challenge, code: "000000" } });
    expect(wrong.status).toBe(401);
    expect(wrong.data).toEqual({ error: "That code is not right" });
    const right = await call(app, "POST", "/api/login/verify", { body: { challenge: step1.data.challenge, code: "123456" } });
    expect(right.status).toBe(200);
    expect(right.data.user.id).toBe("u1");
    expect(right.headers.getSetCookie()[0]).toMatch(/^sid=/);
    // A challenge is single-use; a wrong password never gets one.
    expect((await call(app, "POST", "/api/login/verify", { body: { challenge: step1.data.challenge, code: "123456" } })).status).toBe(401);
    expect((await call(app, "POST", "/api/login", { body: { email: "alice@example.test", password: "nope" } })).status).toBe(401);
  });
});

describe("accounts app in the browser", () => {
  let browser: Browser;
  let context: BrowserContext | undefined;
  beforeAll(async () => {
    browser = await getBrowser();
  });
  afterEach(async () => {
    await context?.close();
    context = undefined;
  });

  async function open(app: AccountsApp, path: string, storageState?: ReturnType<AccountsApp["storageState"]>): Promise<Page> {
    context = await browser.newContext(storageState ? { storageState } : {});
    const page = await context.newPage();
    await page.goto(app.url + path);
    return page;
  }

  it("signs in through the UI and uses the signed-in pages (cookie, email)", async () => {
    const app = await start();
    const page = await open(app, "/notes");
    await page.waitForURL(`${app.url}/login?next=/notes`);
    expect(await page.title()).toBe("Sign in · Notes");
    const email = page.getByLabel("Email");
    expect(await email.getAttribute("type")).toBe("email");
    expect(await email.getAttribute("autocomplete")).toBe("username");
    await email.fill("alice@example.test");
    await page.getByLabel("Password").fill("alice-pass-1234");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(`${app.url}/notes`);
    await page.getByRole("heading", { level: 1, name: "Your notes" }).waitFor();

    const cookies = await context!.cookies();
    expect(cookies).toEqual([expect.objectContaining({ name: "sid", httpOnly: true, sameSite: "Lax" })]);

    const list = page.locator("#notes-list");
    await expect.poll(() => list.innerText()).toContain("Groceries");
    expect(await list.innerText()).toContain("Trip ideas");
    expect(await list.innerText()).not.toContain("Reading list");
    await expect.poll(() => page.getByLabel("Display name").inputValue()).toBe("Alice");
    expect(await page.getByLabel("Bio").inputValue()).toBe("Keeps careful lists.");
    const nav = page.getByRole("navigation", { name: "Main" });
    expect(await nav.getByRole("link").evaluateAll((links) => links.map((a) => a.getAttribute("href")))).toEqual(["/notes", "/settings", "/help"]);
    await page.getByRole("button", { name: "Log out" }).waitFor();

    // New note → POST /api/notes, status, list reload.
    await page.getByLabel("Title").fill("From the UI");
    await page.getByLabel("Body").fill("typed");
    await page.getByRole("button", { name: "Save note" }).click();
    await expect.poll(() => page.locator("#note-status").innerText()).toBe("Note saved");
    await expect.poll(() => list.innerText()).toContain("From the UI");
    expect(app.notes().at(-1)).toMatchObject({ ownerId: "u1", title: "From the UI", body: "typed" });

    // Profile → PUT with only displayName and bio.
    await page.getByLabel("Display name").fill("Ally");
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect.poll(() => page.locator("#profile-status").innerText()).toBe("Profile saved");
    const put = app.requests.find((r) => r.method === "PUT");
    expect(put?.url).toBe("/api/users/u1/profile");
    expect(JSON.parse(put!.body)).toEqual({ displayName: "Ally", bio: "Keeps careful lists." });

    // Discovery sees the two forms in the documented order.
    const discovered = await discoverPage(page);
    expect(discovered.forms.map((f) => f.name)).toEqual(["New note", "Profile"]);

    // Log out ends the server session.
    await page.getByRole("button", { name: "Log out" }).click();
    await page.waitForURL(`${app.url}/login`);
    expect(app.activeSessions("alice")).toBe(0);
  });

  it("shows the API's error in a role=alert and stays on /login after a wrong password", async () => {
    const app = await start();
    const page = await open(app, "/login");
    await page.getByLabel("Email").fill("alice@example.test");
    await page.getByLabel("Password").fill("wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    const alert = page.getByRole("alert");
    await alert.waitFor();
    expect(await alert.innerText()).toBe("Email or password is incorrect");
    expect(page.url()).toBe(`${app.url}/login`);
    expect(await page.getByLabel("Password").isVisible()).toBe(true);
  });

  it("follows ?next= after signing in", async () => {
    const app = await start();
    const page = await open(app, "/help");
    await page.waitForURL(`${app.url}/login?next=/help`);
    await page.getByLabel("Email").fill("bob@example.test");
    await page.getByLabel("Password").fill("bob-pass-5678");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(`${app.url}/help`);
    await page.getByRole("heading", { level: 1, name: "Help" }).waitFor();
  });

  it("bearer: stores the token in localStorage, sends Authorization on API calls and sets no cookie", async () => {
    const app = await start({ tokenMode: "bearer" });
    const page = await open(app, "/login");
    await page.getByLabel("Email").fill("bob@example.test");
    await page.getByLabel("Password").fill("bob-pass-5678");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(`${app.url}/notes`);
    await expect.poll(() => page.locator("#notes-list").innerText()).toContain("Reading list");
    const state = await context!.storageState();
    expect(state.cookies).toEqual([]);
    const stored = state.origins.find((o) => o.origin === app.url)?.localStorage.find((e) => e.name === "token")?.value;
    expect(stored).toMatch(/^[0-9a-f]+$/);
    const notesCall = app.requests.find((r) => r.method === "GET" && r.url === "/api/notes");
    expect(notesCall?.headers.authorization).toBe(`Bearer ${stored}`);
    expect(notesCall?.headers.cookie).toBeUndefined();
  });

  it("storageState() opens signed-in pages in both token modes", async () => {
    for (const tokenMode of ["cookie", "bearer"] as const) {
      const app = await start({ tokenMode });
      const page = await open(app, "/settings", app.storageState("bob"));
      await page.getByRole("heading", { level: 1, name: "Settings" }).waitFor();
      expect(await page.locator("main").innerText()).toContain("Signed in as bob@example.test");
      expect(page.url()).toBe(`${app.url}/settings`);
      await context!.close();
      context = undefined;
    }
  });

  it("noAuth: the client still sends signed-out visitors to /login", async () => {
    const app = await start({ noAuth: true });
    const page = await open(app, "/notes");
    await page.waitForURL(`${app.url}/login?next=/notes`);
    await page.getByLabel("Password").waitFor();
  });

  it("deepLink404: in-app navigation renders Settings; opening it directly is a 404", async () => {
    const app = await start({ deepLink404: true });
    const page = await open(app, "/notes", app.storageState("alice"));
    await page.getByRole("heading", { level: 1, name: "Your notes" }).waitFor();
    await page.getByRole("link", { name: "Settings" }).click();
    await page.getByRole("heading", { level: 1, name: "Settings" }).waitFor();
    expect(page.url()).toBe(`${app.url}/settings`);
    await page.goBack();
    await page.getByRole("heading", { level: 1, name: "Your notes" }).waitFor();

    const direct = await page.goto(`${app.url}/settings`);
    expect(direct?.status()).toBe(404);
    expect(await page.title()).toBe("404 Not Found");
    expect(await page.getByRole("heading", { level: 1 }).innerText()).toBe("Not Found");
  });

  it("clean: /settings opens directly as well", async () => {
    const app = await start();
    const page = await open(app, "/notes", app.storageState("alice"));
    const direct = await page.goto(`${app.url}/settings`);
    expect(direct?.status()).toBe(200);
    await page.getByRole("heading", { level: 1, name: "Settings" }).waitFor();
    expect(await page.title()).toBe("Settings · Notes");
  });

  it("/profile holds only the Profile form, so it is the main form", async () => {
    const app = await start();
    const page = await open(app, "/profile", app.storageState("alice"));
    await page.getByRole("heading", { level: 1, name: "Your profile" }).waitFor();
    await expect.poll(() => page.getByLabel("Display name").inputValue()).toBe("Alice");
    const form = await discoverForm(page);
    expect(form.name).toBe("Profile");
    expect(form.fields.map((f) => f.accessibleName)).toEqual(["Display name", "Bio"]);
  });

  it("username: the identifier field is labelled Username", async () => {
    const app = await start({ loginVariant: "username" });
    const page = await open(app, "/login");
    const field = page.getByLabel("Username");
    expect(await field.getAttribute("autocomplete")).toBe("username");
    expect(await field.getAttribute("type")).toBe("text");
    expect(await page.getByLabel("Email").count()).toBe(0);
    await field.fill("alice");
    await page.getByLabel("Password").fill("alice-pass-1234");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(`${app.url}/notes`);
  });

  it("two-password: a sign-up form with two password fields comes before the sign-in form", async () => {
    const app = await start({ loginVariant: "two-password" });
    const page = await open(app, "/login");
    const forms = page.locator("form");
    expect(await forms.count()).toBe(2);
    expect(await forms.nth(0).locator('input[type="password"]').count()).toBe(2);
    expect(await forms.nth(1).locator('input[type="password"]').count()).toBe(1);
    expect(await forms.nth(1).getAttribute("aria-label")).toBe("Sign in");
    const discovered = await discoverPage(page);
    expect(discovered.forms.map((f) => f.name)).toEqual(["New here? Create an account", "Sign in"]);

    await page.getByRole("button", { name: "Create account" }).click();
    await expect.poll(() => forms.nth(0).getByRole("alert").innerText()).toContain("closed");

    await page.getByLabel("Email", { exact: true }).fill("alice@example.test");
    await page.getByLabel("Password", { exact: true }).fill("alice-pass-1234");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(`${app.url}/notes`);
  });

  it("otp: after the password step the password field is hidden and a Verification code field appears", async () => {
    const app = await start({ loginVariant: "otp" });
    const page = await open(app, "/login");
    await page.getByLabel("Email").fill("alice@example.test");
    await page.getByLabel("Password").fill("alice-pass-1234");
    await page.getByRole("button", { name: "Sign in" }).click();
    const code = page.getByLabel("Verification code");
    await code.waitFor();
    expect(await code.getAttribute("autocomplete")).toBe("one-time-code");
    expect(await page.locator("#password").isHidden()).toBe(true);
    expect(await page.locator('input[type="password"]').count()).toBe(1);
    expect(page.url()).toBe(`${app.url}/login`);
    expect(app.activeSessions()).toBe(0);

    await code.fill("111111");
    await page.getByRole("button", { name: "Verify" }).click();
    await expect.poll(() => page.locator("#verify-error").innerText()).toBe("That code is not right");
    await code.fill("123456");
    await page.getByRole("button", { name: "Verify" }).click();
    await page.waitForURL(`${app.url}/notes`);
    expect(app.activeSessions("alice")).toBe(1);
  });
});
