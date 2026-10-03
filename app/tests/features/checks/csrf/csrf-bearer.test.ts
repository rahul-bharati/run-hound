// csrf on a bearer-token session (no cookie): same passing and finding hold, and no token or password reaches the result or any run-folder file.
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeBrowser, getBrowser } from "../../../support/harness.js";
import { startFixtureServer, type FixtureServer, type RecordedRequest } from "../../../support/server.js";
import type { AccountsConfig } from "../../../../src/interfaces/accounts.js";
import type { AccountRef, CheckResult, DiscoveredPage, Scenario } from "../../../../src/core/types.js";
import type { SessionState } from "../../../../src/engine/auth.js";
import { createCheckContext, seedSessionStorage, type RunningCheckContext, type SessionStorageItems } from "../../../../src/engine/context.js";
import { discoverPage } from "../../../../src/engine/discover.js";
import { discoverAndPlan, runPlan } from "../../../../src/engine/runner.js";
import { check } from "../../../../src/checks/csrf.js";

const A: AccountRef = { id: "a", label: "Account A" };
/** Lowercase letters and digits, so canary values keep it verbatim; must not contain "csrf" (the forged marker suffix). */
const RUN_TOKEN = "b3a7e41d";
/** Account A's bearer token, kept by the app in sessionStorage. Must never show in a result. */
const TOKEN = "bearer-tok-4f1c9a7e2d";
const TOKEN_KEY = "app_session";

let browser: Browser;
const servers: FixtureServer[] = [];
const contexts: RunningCheckContext[] = [];
const dirs: string[] = [];

beforeAll(async () => {
  browser = await getBrowser();
});
afterEach(async () => {
  await Promise.all(contexts.splice(0).map((c) => c.dispose()));
  await Promise.all(servers.splice(0).map((s) => s.close()));
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
afterAll(closeBrowser);

/** A sessionStorage session: no cookie and no localStorage, the token only in the tab's sessionStorage. */
const NO_COOKIES: SessionState = { cookies: [], origins: [] };
const storageFor = (base: string): SessionStorageItems => [{ origin: base, items: [{ name: TOKEN_KEY, value: TOKEN }] }];

interface BearerAppOptions {
  /** The save needs no session at all (as Fernway's V03): anyone can add a task to Account A's list. */
  openSave?: boolean;
  /** Once a write arrives from another origin, every read of the tasks answers 500 (the re-read fails). */
  failReadAfterForge?: boolean;
}

type Task = { id: string; title: string };

/** Account A's password on the bearer app's sign-in page. Must never show in the run folder. */
const PASSWORD = "bearer-pass-8e2d61";

// A task app whose session is a bearer token in sessionStorage (Authorization: Bearer on every call), save is JSON but also takes form-encoded/text/plain, no Origin check, GET /api/tasks is a bare array (Fernway's shape).
async function bearerApp(o: BearerAppOptions = {}): Promise<FixtureServer & { tasks: Task[] }> {
  const tasks: Task[] = [];
  let forged = false;
  const signedIn = (req: RecordedRequest) => req.headers.authorization === `Bearer ${TOKEN}`;
  const server = await startFixtureServer({
    pages: {
      "/login": `<!doctype html><html lang="en"><head><title>Sign in</title></head><body><main><h1>Sign in</h1>
<form id="f" aria-label="Sign in">
  <label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username">
  <label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password">
  <button type="submit">Sign in</button>
</form><p role="alert" id="err"></p>
<script>document.getElementById("f").addEventListener("submit", function (e) {
  e.preventDefault();
  if (document.getElementById("password").value !== ${JSON.stringify(PASSWORD)}) { document.getElementById("err").textContent = "Wrong password"; return; }
  sessionStorage.setItem(${JSON.stringify(TOKEN_KEY)}, ${JSON.stringify(TOKEN)});
  location.assign("/app");
});</script>
</main></body></html>`,
      "/app": `<!doctype html><html lang="en"><head><title>Tasks</title></head><body><main><h1>Tasks</h1>
<form id="new" aria-label="New task"><label for="t">Title</label><input id="t" name="title" required><button type="submit">Add task</button></form>
<p role="status" id="status"></p><ul id="list"></ul></main>
<script>
var t = document.getElementById('t');
function auth() { var k = null; try { k = sessionStorage.getItem(${JSON.stringify(TOKEN_KEY)}); } catch (e) {} return k ? { authorization: 'Bearer ' + k } : {}; }
function load() { fetch('/api/tasks', { headers: auth() }).then(function (r) { return r.ok ? r.json() : []; }).then(function (items) {
  document.getElementById('list').innerHTML = items.map(function (x) { return '<li>' + String(x.title).replace(/</g, '&lt;') + '</li>'; }).join(''); }); }
document.getElementById('new').addEventListener('submit', function (e) {
  e.preventDefault();
  fetch('/api/tasks', { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, auth()), body: JSON.stringify({ title: t.value }) })
    .then(function () { document.getElementById('status').textContent = 'Task added'; load(); });
});
load();
</script></body></html>`,
    },
    routes: {
      "GET /api/tasks": (req, res) => {
        if (!signedIn(req)) return end(res, 401, { error: "Sign in first" });
        if (o.failReadAfterForge && forged) return end(res, 500, { error: "Down" });
        return end(res, 200, tasks);
      },
      "POST /api/tasks": (req, res) => {
        const origin = String(req.headers.origin ?? "");
        if (origin && origin !== `http://${req.headers.host}`) forged = true;
        if (!o.openSave && !signedIn(req)) return end(res, 401, { error: "Sign in first" });
        // No CSRF defence (V08): no Origin check, and a form-encoded or text/plain body is taken as well as JSON.
        const ct = String(req.headers["content-type"] ?? "");
        let title: string | undefined;
        if (ct.includes("application/x-www-form-urlencoded")) {
          title = new URLSearchParams(req.body).get("title") ?? undefined;
        } else {
          try {
            title = (JSON.parse(req.body) as { title?: string }).title;
          } catch {
            return end(res, 400, { error: "Bad JSON" });
          }
        }
        if (!title) return end(res, 400, { error: "Title required" });
        const task = { id: `t${tasks.length + 1}`, title };
        tasks.push(task);
        return end(res, 201, { task });
      },
      "GET /favicon.ico": (_req, res) => {
        res.writeHead(204);
        res.end();
      },
    },
  });
  servers.push(server);
  return Object.assign(server, { tasks });
}

function end(res: import("node:http").ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function discover(url: string, base: string): Promise<DiscoveredPage> {
  const context = await browser.newContext();
  try {
    await seedSessionStorage(context, storageFor(base));
    const page = await context.newPage();
    await page.goto(url);
    await page.getByRole("heading", { level: 1, name: "Tasks" }).waitFor();
    await page.waitForLoadState("networkidle");
    return await discoverPage(page);
  } finally {
    await context.close();
  }
}

function scenarioFor(page: DiscoveredPage): Scenario {
  const form = page.forms[0]!;
  const planned = check.plan(form, page, { signedIn: true, otherAccount: false })[0];
  if (!planned) throw new Error("csrf planned no scenario for this form");
  return { ...planned, scope: "form", formIndex: 0 };
}

/** What a run gives back: the result, and the artifacts folder the check wrote its evidence and step captures into. */
interface Run {
  result: CheckResult;
  dir: string;
}

/** Every regular file under `dir`, at any depth. */
async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries.filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name));
}

/** The files under `dir` (read as bytes, so a secret in any text or binary file shows) that contain `needle`. */
async function filesContaining(dir: string, needle: string): Promise<string[]> {
  const hits: string[] = [];
  for (const f of await filesUnder(dir)) if ((await readFile(f, "latin1")).includes(needle)) hits.push(f);
  return hits;
}

/** Runs the check on `server` reached at localhost (the attacker page is then on 127.0.0.1, Fernway's direction). */
async function runBearer(server: FixtureServer): Promise<Run> {
  const base = server.url.replace("127.0.0.1", "localhost");
  const page = await discover(`${base}/app`, base);
  server.requests.length = 0;
  const dir = await mkdtemp(join(tmpdir(), "rh-csrf-bearer-"));
  dirs.push(dir);
  const ctx = createCheckContext({
    browser,
    form: page.forms[0]!,
    discoveredPage: page,
    targetUrl: `${base}/app`,
    artifactsDir: dir,
    runToken: RUN_TOKEN,
    checkId: "csrf",
    sessions: { self: NO_COOKIES },
    sessionStorage: { self: storageFor(base) },
    accounts: { self: A, other: null },
    markers: [],
  });
  contexts.push(ctx);
  return { result: await check.run(ctx, scenarioFor(page)), dir };
}

// The forged POSTs the server got: bodies carry the forged marker (the run token followed by "csrf").
function forgedPosts(server: FixtureServer, marker: RegExp = /b3a7e41dcsrf/i) {
  return server.requests.filter((r) => r.method === "POST" && r.url === "/api/tasks" && marker.test(decodeURIComponent(r.body.replace(/\+/g, " "))));
}
/** The forged marker of a runPlan run, whatever its run token. */
const ANY_RUN_MARKER = /[0-9a-f]{8}csrf/i;

describe("csrf with a bearer-token session kept in sessionStorage (no cookie)", () => {
  it("passes on a save with no CSRF defence: a page on another site has no cookie to ride on", async () => {
    const server = await bearerApp();
    const { result, dir } = await runBearer(server);
    expect(result.notes).not.toMatch(/couldn't read the test record back/);
    expect(result.status).toBe("pass");
    expect(result.findings).toEqual([]);
    expect(result.notes).toMatch(/could not change Account A's data/);
    // The reason is the missing cookie, not a preflight: the app takes the form-encoded body when it carries the token.
    expect(result.notes).toMatch(/no cookie/i);
    // The forge really ran, and reached the server with neither a cookie nor the bearer token.
    const forged = forgedPosts(server);
    expect(forged.length).toBeGreaterThan(0);
    for (const r of forged) {
      expect(r.headers.authorization).toBeUndefined();
      expect(r.headers.cookie).toBeUndefined();
    }
    // The verdict came from a real re-read as Account A (with its bearer token) after the forge.
    const afterForge = server.requests.slice(server.requests.indexOf(forged[0]!) + 1);
    expect(afterForge.some((r) => r.method === "GET" && r.url === "/api/tasks" && r.headers.authorization === `Bearer ${TOKEN}`)).toBe(true);
    // Nothing forged was stored, and nothing needs putting back.
    expect(server.tasks.some((t) => /b3a7e41dcsrf/.test(t.title))).toBe(false);
    expect(result.notes).not.toMatch(/check Account A/);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(await filesContaining(dir, TOKEN), "a file in the artifacts folder holds the bearer token").toEqual([]);
  }, 60_000);

  it("finds it when the save needs no session at all: the bearer re-read shows the forged value", async () => {
    const server = await bearerApp({ openSave: true });
    const { result, dir } = await runBearer(server);
    expect(result.status).toBe("fail");
    expect(result.findings).toHaveLength(1);
    const f = result.findings[0]!;
    expect(f.confidence).toBe("confirmed");
    expect(f.severity).toBe("high");
    expect(f.meaning).toMatch(/attached no cookie/);
    // No cookie rode along, so a CSRF defence alone (a SameSite cookie, a token) wouldn't fix it: the diagnosis is the
    // missing session, and the fix says to require it first.
    expect(f.title).toMatch(/the save needs no session/);
    expect(f.title).not.toMatch(/no CSRF protection/);
    expect(f.fix).toMatch(/Require Account A's session on POST \/api\/tasks/);
    expect(f.fix.indexOf("Require Account A's session")).toBeLessThan(f.fix.indexOf("CSRF"));
    expect(f.impact).toMatch(/without Account A's session/);
    expect(server.tasks.some((t) => /b3a7e41dcsrf/.test(t.title))).toBe(true);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    // The exported spec holds no token either. Its own re-read has no bearer token unless the user adds one, so it must
    // fail when that re-read isn't let in, not pass because the forged value isn't in a 401 answer, and say so.
    const spec = f.spec?.source ?? "";
    expect(spec).not.toContain(TOKEN);
    expect(spec).toMatch(/expect\(reread\.ok, "the re-read as Account A failed/);
    // The user is signed in; what the re-read lacks is the token the comment above names.
    expect(spec).toMatch(/re-read as Account A failed: add what the comment above says/);
    expect(spec).not.toMatch(/failed: sign in as Account A/);
    expect(spec).toMatch(/not a cookie/);
    // Nor any evidence or step capture the check wrote.
    expect(await filesContaining(dir, TOKEN), "a file in the artifacts folder holds the bearer token").toEqual([]);
  }, 60_000);

  it("is inconclusive, never a pass, when the re-read as Account A fails after the forge", async () => {
    const server = await bearerApp({ failReadAfterForge: true });
    const { result, dir } = await runBearer(server);
    expect(result.status).toBe("skipped");
    expect(result.findings).toEqual([]);
    expect(result.notes).toMatch(/^Inconclusive: the re-read as Account A failed[\s\S]*check Account A/);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(await filesContaining(dir, TOKEN), "a file in the artifacts folder holds the bearer token").toEqual([]);
  }, 60_000);
});

/** The anti-CSRF header value a cookie app's page adds to every call. Must never show in a result or a spec. */
const HEADER_TOKEN = "hdr-tok-9a8b7c6d5e";

/** Account A's cookie session: `sid`, with the given SameSite (None is Secure, as browsers require). */
function cookieSession(host: string, sameSite: "Lax" | "None"): SessionState {
  return {
    cookies: [{ name: "sid", value: "a-session", domain: host, path: "/", expires: -1, httpOnly: true, secure: sameSite === "None", sameSite }],
    origins: [],
  };
}

// A cookie-session task app whose page adds `x-csrf-token` (from a <meta>) to every API call (GET /api/tasks 403s without it); the save needs only the cookie and, like V08, takes a form-encoded or text/plain body and checks no Origin.
async function headerReadApp(): Promise<FixtureServer & { tasks: Task[] }> {
  const tasks: Task[] = [];
  const hasCookie = (req: RecordedRequest) => /(?:^|;\s*)sid=a-session(?:;|$)/.test(String(req.headers.cookie ?? ""));
  const server = await startFixtureServer({
    pages: {
      "/app": `<!doctype html><html lang="en"><head><title>Tasks</title><meta name="csrf-token" content="${HEADER_TOKEN}"></head><body><main><h1>Tasks</h1>
<form id="new" aria-label="New task"><label for="t">Title</label><input id="t" name="title" required><button type="submit">Add task</button></form>
<p role="status" id="status"></p><ul id="list"></ul></main>
<script>
var t = document.getElementById('t');
function h() { return { 'x-csrf-token': document.querySelector('meta[name=csrf-token]').content }; }
function load() { fetch('/api/tasks', { headers: h() }).then(function (r) { return r.ok ? r.json() : []; }).then(function (items) {
  document.getElementById('list').innerHTML = items.map(function (x) { return '<li>' + String(x.title).replace(/</g, '&lt;') + '</li>'; }).join(''); }); }
document.getElementById('new').addEventListener('submit', function (e) {
  e.preventDefault();
  fetch('/api/tasks', { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, h()), body: JSON.stringify({ title: t.value }) })
    .then(function () { document.getElementById('status').textContent = 'Task added'; load(); });
});
load();
</script></body></html>`,
    },
    routes: {
      "GET /api/tasks": (req, res) => {
        if (!hasCookie(req)) return end(res, 401, { error: "Sign in first" });
        if (req.headers["x-csrf-token"] !== HEADER_TOKEN) return end(res, 403, { error: "Missing header" });
        return end(res, 200, tasks);
      },
      "POST /api/tasks": (req, res) => {
        // The cookie is required; the header is not checked on the save (V08-shaped).
        if (!hasCookie(req)) return end(res, 401, { error: "Sign in first" });
        const ct = String(req.headers["content-type"] ?? "");
        let title: string | undefined;
        if (ct.includes("application/x-www-form-urlencoded")) {
          title = new URLSearchParams(req.body).get("title") ?? undefined;
        } else {
          try {
            title = (JSON.parse(req.body) as { title?: string }).title;
          } catch {
            return end(res, 400, { error: "Bad JSON" });
          }
        }
        if (!title) return end(res, 400, { error: "Title required" });
        const task = { id: `t${tasks.length + 1}`, title };
        tasks.push(task);
        return end(res, 201, { task });
      },
      "GET /favicon.ico": (_req, res) => {
        res.writeHead(204);
        res.end();
      },
    },
  });
  servers.push(server);
  return Object.assign(server, { tasks });
}

/** Runs the check on `server` at localhost as Account A with a `sid` cookie of the given SameSite. */
async function runCookie(server: FixtureServer, sameSite: "Lax" | "None"): Promise<Run> {
  const base = server.url.replace("127.0.0.1", "localhost");
  const self = cookieSession("localhost", sameSite);
  const context = await browser.newContext({ storageState: self });
  let page: DiscoveredPage;
  try {
    const p = await context.newPage();
    await p.goto(`${base}/app`);
    await p.getByRole("heading", { level: 1, name: "Tasks" }).waitFor();
    await p.waitForLoadState("networkidle");
    page = await discoverPage(p);
  } finally {
    await context.close();
  }
  server.requests.length = 0;
  const dir = await mkdtemp(join(tmpdir(), "rh-csrf-header-"));
  dirs.push(dir);
  const ctx = createCheckContext({
    browser,
    form: page.forms[0]!,
    discoveredPage: page,
    targetUrl: `${base}/app`,
    artifactsDir: dir,
    runToken: RUN_TOKEN,
    checkId: "csrf",
    sessions: { self },
    accounts: { self: A, other: null },
    markers: [],
  });
  contexts.push(ctx);
  return { result: await check.run(ctx, scenarioFor(page)), dir };
}

describe("csrf with a cookie session whose reads also need a header the page adds", () => {
  it("passes with a SameSite=Lax cookie, and doesn't say Account A's session is not a cookie", async () => {
    const server = await headerReadApp();
    const { result, dir } = await runCookie(server, "Lax");
    expect(result.status).toBe("pass");
    expect(result.findings).toEqual([]);
    expect(result.notes).toMatch(/could not change Account A's data/);
    // A's session is the sid cookie (SameSite=Lax is what stopped the forge): no "token, not a cookie" reason.
    expect(result.notes).not.toMatch(/not a cookie/);
    expect(result.notes).not.toMatch(/no cookie for the browser to attach/);
    // The forge really ran, without the cookie (Lax stays home) or the header.
    const forged = forgedPosts(server);
    expect(forged.length).toBeGreaterThan(0);
    for (const r of forged) {
      expect(String(r.headers.cookie ?? "")).not.toMatch(/sid=/);
      expect(r.headers["x-csrf-token"]).toBeUndefined();
    }
    expect(server.tasks.some((t) => /b3a7e41dcsrf/.test(t.title))).toBe(false);
    expect(JSON.stringify(result)).not.toContain(HEADER_TOKEN);
    expect(JSON.stringify(result)).not.toContain("a-session");
    expect(await filesContaining(dir, HEADER_TOKEN), "a file in the artifacts folder holds the page's header token").toEqual([]);
    expect(await filesContaining(dir, "a-session"), "a file in the artifacts folder holds the session cookie").toEqual([]);
  }, 60_000);

  it("finds it with a SameSite=None cookie, and the spec says to add the app's headers, not that the session isn't a cookie", async () => {
    const server = await headerReadApp();
    const { result, dir } = await runCookie(server, "None");
    expect(result.status).toBe("fail");
    expect(result.findings).toHaveLength(1);
    const f = result.findings[0]!;
    expect(f.confidence).toBe("confirmed");
    expect(f.meaning).toMatch(/sid \(SameSite=None\)/);
    const spec = f.spec?.source ?? "";
    expect(spec).not.toMatch(/not a cookie/);
    expect(spec).toMatch(/headers the app's own scripts add/);
    expect(spec).toMatch(/expect\(reread\.ok, "the re-read as Account A failed/);
    expect(spec).toMatch(/re-read as Account A failed: add what the comment above says/);
    expect(spec).not.toMatch(/failed: sign in as Account A/);
    expect(spec).not.toContain(HEADER_TOKEN);
    expect(JSON.stringify(result)).not.toContain(HEADER_TOKEN);
    expect(JSON.stringify(result)).not.toContain("a-session");
    expect(await filesContaining(dir, HEADER_TOKEN), "a file in the artifacts folder holds the page's header token").toEqual([]);
    expect(await filesContaining(dir, "a-session"), "a file in the artifacts folder holds the session cookie").toEqual([]);
  }, 60_000);
});

/** Account A signs in at the bearer app's /login (on `base`); no Account B. */
function bearerAccounts(base: string): AccountsConfig {
  return {
    isolated: true,
    accounts: {
      a: { id: "a", label: "Account A", loginUrl: `${base}/login`, username: "alex@example.test", password: PASSWORD },
      b: { id: "b", label: "Account B", loginUrl: "", username: "", password: null },
    },
  };
}

/** Plans /app on `server` at localhost signed in as A (through the app's sign-in page) and runs every csrf scenario. */
async function runThroughRunner(server: FixtureServer) {
  const base = server.url.replace("127.0.0.1", "localhost");
  const accounts = bearerAccounts(base);
  const runsDir = await mkdtemp(join(tmpdir(), "rh-csrf-bearer-runs-"));
  dirs.push(runsDir);
  const plan = await discoverAndPlan(`${base}/app`, { checks: [check], signInAs: "a", accounts });
  expect(plan.account).toEqual(A);
  const approved = plan.scenarios.filter((s) => s.checkId === "csrf").map((s) => s.id);
  expect(approved.length).toBeGreaterThan(0);
  const run = await runPlan(plan, { checks: [check], runsDir, accounts, approved });
  return { ...run, approved };
}

describe("csrf with a sessionStorage bearer session, through discoverAndPlan and runPlan", () => {
  it("passes on a save with no CSRF defence, and the run folder holds no bearer token or password", async () => {
    const server = await bearerApp();
    const { report, dir, approved } = await runThroughRunner(server);
    const results = report.results.filter((r) => approved.includes(r.scenarioId));
    expect(results.map((r) => r.status)).toEqual(approved.map(() => "pass"));
    for (const r of results) expect(r.notes).toMatch(/not a cookie/);
    // The forge really reached the app, and nothing forged was stored.
    const forged = forgedPosts(server, ANY_RUN_MARKER);
    expect(forged.length).toBeGreaterThan(0);
    for (const r of forged) expect(r.headers.authorization).toBeUndefined();
    expect(server.tasks.some((t) => ANY_RUN_MARKER.test(t.title))).toBe(false);
    expect((await filesUnder(dir)).length).toBeGreaterThan(0);
    expect(await filesContaining(dir, TOKEN), "a file in the run folder holds the bearer token").toEqual([]);
    expect(await filesContaining(dir, PASSWORD), "a file in the run folder holds the password").toEqual([]);
  }, 120_000);

  it("finds it when the save needs no session, and neither the report, the evidence nor the spec holds the token", async () => {
    const server = await bearerApp({ openSave: true });
    const { report, dir } = await runThroughRunner(server);
    const csrfFindings = report.findings.filter((f) => f.checkId === "csrf");
    expect(csrfFindings.length).toBeGreaterThan(0);
    expect(csrfFindings.every((f) => f.confidence === "confirmed")).toBe(true);
    expect(server.tasks.some((t) => ANY_RUN_MARKER.test(t.title))).toBe(true);
    const files = await filesUnder(dir);
    // The finding's exported spec and its evidence are in the folder being searched.
    expect(files.some((f) => f.endsWith(".spec.ts"))).toBe(true);
    expect(files.some((f) => f.endsWith(".png"))).toBe(true);
    expect(await filesContaining(dir, TOKEN), "a file in the run folder holds the bearer token").toEqual([]);
    expect(await filesContaining(dir, PASSWORD), "a file in the run folder holds the password").toEqual([]);
  }, 120_000);
});
