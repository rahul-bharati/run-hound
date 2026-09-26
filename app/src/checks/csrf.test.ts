/**
 * csrf (0.5.0, docs/v2-spec.md "`csrf`"): a real page on a different site (localhost vs 127.0.0.1) submits the form's
 * save in Account A's browser, and the verdict comes from re-reading the record as A. Driven through
 * createCheckContext against small fixture servers built in this file, each a task app with a different CSRF posture:
 *   - SameSite=Lax cookie: the browser keeps it home, so the forged post is unauthenticated (pass);
 *   - SameSite=None; Secure and no token/Origin check: the forged form post is stored (finding);
 *   - a CSRF token in a custom header: the cross-site post can't add it (pass);
 *   - an Origin check: the attacker origin is rejected (pass);
 *   - a JSON-only save: the cross-site post can't send JSON without a preflight (pass, "needs a preflight");
 *   - a CSRF token in a hidden body field: the forged body leaves it out (pass);
 *   - a JSON save parsed whatever its content-type, or a CORS config reflecting the other site: finding;
 *   - an array-shaped list read (Fernway's) and a localhost target: finding;
 *   - a failed re-read, or a 2xx forge a single-record read can't show: inconclusive, never pass;
 *   - an upsert that changes the test record: put back through the app's own PATCH only;
 *   - a target with no cross-site twin: inconclusive, never confirmed or pass.
 */
import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeBrowser, getBrowser } from "../../test-support/harness.js";
import { startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import type { AccountRef, CheckResult, DiscoveredPage, Scenario } from "../core/types.js";
import type { SessionState } from "../engine/auth.js";
import { createCheckContext, type RunningCheckContext } from "../engine/context.js";
import { discoverPage } from "../engine/discover.js";
import { crossSitePage } from "./lib/cross-site.js";
import { check } from "./csrf.js";

const A: AccountRef = { id: "a", label: "Account A" };
/** Lowercase letters and digits, so canary values keep it verbatim; must not contain "csrf" (the forged marker suffix). */
const RUN_TOKEN = "cf7e57a1";

let browser: Browser;
const servers: FixtureServer[] = [];
const rawServers: Server[] = [];
const contexts: RunningCheckContext[] = [];
const dirs: string[] = [];

beforeAll(async () => {
  browser = await getBrowser();
});
afterEach(async () => {
  await Promise.all(contexts.splice(0).map((c) => c.dispose()));
  await Promise.all(servers.splice(0).map((s) => s.close()));
  await Promise.all(rawServers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
afterAll(closeBrowser);

/** A session cookie for `host` with the given SameSite (Secure for None, which Chromium accepts on http://localhost). */
function session(host: string, sameSite: "Lax" | "Strict" | "None"): SessionState {
  return {
    cookies: [{ name: "sid", value: "a-session", domain: host, path: "/", expires: -1, httpOnly: true, secure: sameSite === "None", sameSite }],
    origins: [],
  };
}

const CSRF_TOKEN = "tok-server-rendered-per-session";

interface TaskAppOptions {
  /**
   * How the save is defended, beyond needing the session cookie: a CSRF token in a custom header ("token") or in a
   * hidden `_csrf` body field ("body-token"), an Origin check, a JSON-only body, or a JSON save the server parses
   * whatever its content-type ("json-any-type", as `await req.json()` does).
   */
  defense?: "none" | "token" | "body-token" | "origin" | "json-only" | "json-any-type";
  /** What the page reads the tasks with: `{ tasks: [...] }` (default), a bare array (Fernway's shape), or one task by id. */
  list?: "object" | "array" | "one";
  /** The JSON app's CORS reflects any Origin with credentials allowed (the preflight and the answer). */
  cors?: boolean;
  /** POST /api/tasks overwrites the one task there is (an upsert) instead of adding one. */
  upsert?: boolean;
  /** After creating a task, the page saves it again with PATCH /api/tasks/:id (as Fernway's Quick add does). */
  patch?: boolean;
  /** Once a write arrives from another origin, every read of the tasks answers 500 (the re-read fails). */
  failReadAfterForge?: boolean;
}

type Task = { id: string; title: string };

/**
 * A task app: GET /app shows a "New task" form; the page loads the tasks and POSTs the form to /api/tasks. Every API
 * call needs the session cookie; `o` picks the defense and the shapes (see TaskAppOptions).
 */
async function taskApp(o: TaskAppOptions = {}): Promise<FixtureServer & { tasks: Task[] }> {
  const tasks: Task[] = [];
  const defense = o.defense ?? "none";
  const list = o.list ?? "object";
  const json = defense === "json-only" || defense === "json-any-type";
  let forged = false;
  const signedIn = (cookie: string | undefined) => /(?:^|;\s*)sid=a-session\b/.test(cookie ?? "");
  const script = json
    ? `fetch('/api/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: t.value }) })`
    : defense === "token"
      ? `fetch('/api/tasks', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-csrf-token': ${JSON.stringify(CSRF_TOKEN)} }, body: new URLSearchParams({ title: t.value }).toString() })`
      : `fetch('/api/tasks', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(new FormData(document.getElementById('new'))).toString() })`;
  const then = o.patch
    ? `.then(function (r) { return r.json(); }).then(function (d) { localStorage.setItem('last', d.task.id); return fetch('/api/tasks/' + d.task.id, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: d.task.title }) }); })`
    : `.then(function (r) { return r.json(); }).then(function (d) { if (d.task) localStorage.setItem('last', d.task.id); })`;
  const read =
    list === "one"
      ? `(localStorage.getItem('last') ? fetch('/api/tasks/' + localStorage.getItem('last')).then(function (r) { return r.ok ? r.json() : null; }).then(function (x) { return x ? [x] : []; }) : Promise.resolve([]))`
      : `fetch('/api/tasks').then(function (r) { return r.ok ? r.json() : []; }).then(function (d) { return Array.isArray(d) ? d : d.tasks || []; })`;
  const server = await startFixtureServer({
    pages: {
      "/app": `<!doctype html><html lang="en"><head><title>Tasks</title><meta name="csrf-token" content="${CSRF_TOKEN}"></head><body><main><h1>Tasks</h1>
<form id="new" aria-label="New task">${defense === "body-token" ? `<input type="hidden" name="_csrf" value="${CSRF_TOKEN}">` : ""}<label for="t">Title</label><input id="t" name="title" required><button type="submit">Add task</button></form>
<p role="status" id="status"></p><ul id="list"></ul></main>
<script>
var t = document.getElementById('t');
function load() { ${read}.then(function (items) {
  document.getElementById('list').innerHTML = items.map(function (x) { return '<li>' + String(x.title).replace(/</g, '&lt;') + '</li>'; }).join(''); }); }
document.getElementById('new').addEventListener('submit', function (e) {
  e.preventDefault();
  ${script}${then}.then(function () { document.getElementById('status').textContent = 'Task added'; load(); });
});
load();
</script></body></html>`,
    },
    routes: {
      "GET /api/tasks": (req, res) => {
        if (!signedIn(req.headers.cookie)) return end(res, 401, { error: "Sign in first" });
        if (o.failReadAfterForge && forged) return end(res, 500, { error: "Down" });
        return end(res, 200, list === "array" ? tasks : { tasks });
      },
      "POST /api/tasks": (req, res) => {
        const cors: Record<string, string> =
          o.cors && req.headers.origin ? { "access-control-allow-origin": String(req.headers.origin), "access-control-allow-credentials": "true" } : {};
        const origin = String(req.headers.origin ?? "");
        if (origin && origin !== `http://${req.headers.host}`) forged = true;
        if (!signedIn(req.headers.cookie)) return end(res, 401, { error: "Sign in first" }, cors);
        const ct = String(req.headers["content-type"] ?? "");
        if (defense === "origin" && origin && origin !== `http://${req.headers.host}`) return end(res, 403, { error: "Bad origin" });
        if (defense === "token" && req.headers["x-csrf-token"] !== CSRF_TOKEN) return end(res, 403, { error: "Bad CSRF token" });
        let title: string | undefined;
        if (json) {
          if (defense === "json-only" && !ct.includes("application/json")) return end(res, 415, { error: "JSON only" }, cors);
          try {
            title = (JSON.parse(req.body) as { title?: string }).title;
          } catch {
            return end(res, 400, { error: "Bad JSON" }, cors);
          }
        } else {
          if (!ct.includes("application/x-www-form-urlencoded")) return end(res, 415, { error: "Form only" });
          const params = new URLSearchParams(req.body);
          if (defense === "body-token" && params.get("_csrf") !== CSRF_TOKEN) return end(res, 403, { error: "Bad CSRF token" });
          title = params.get("title") ?? undefined;
        }
        if (!title) return end(res, 400, { error: "Title required" }, cors);
        const existing = o.upsert ? tasks[0] : undefined;
        const task = existing ?? { id: `t${tasks.length + 1}`, title };
        task.title = title;
        if (!existing) tasks.push(task);
        return end(res, 201, { task }, cors);
      },
      "OPTIONS /api/tasks": (req, res) => {
        // Without `cors`, no CORS headers: a cross-site JSON request's preflight is never allowed.
        res.writeHead(
          204,
          o.cors && req.headers.origin
            ? {
                "access-control-allow-origin": String(req.headers.origin),
                "access-control-allow-credentials": "true",
                "access-control-allow-methods": "POST",
                "access-control-allow-headers": "content-type",
              }
            : {},
        );
        res.end();
      },
      "GET /favicon.ico": (_req, res) => {
        res.writeHead(204);
        res.end();
      },
    },
    // GET and PATCH /api/tasks/:id.
    fallback: (req, res) => {
      const m = /^\/api\/tasks\/([^/?]+)/.exec(req.url);
      if (!m) return end(res, 404, { error: "Not found" });
      if (!signedIn(req.headers.cookie)) return end(res, 401, { error: "Sign in first" });
      const task = tasks.find((x) => x.id === m[1]);
      if (!task) return end(res, 404, { error: "Not found" });
      if (req.method === "GET") return o.failReadAfterForge && forged ? end(res, 500, { error: "Down" }) : end(res, 200, task);
      if (req.method === "PATCH") {
        const body = JSON.parse(req.body || "{}") as { title?: string };
        if (body.title) task.title = body.title;
        return end(res, 200, task);
      }
      return end(res, 405, { error: "No" });
    },
  });
  servers.push(server);
  return Object.assign(server, { tasks });
}

function end(res: import("node:http").ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

async function discover(url: string, state: SessionState): Promise<DiscoveredPage> {
  const context = await browser.newContext({ storageState: state });
  try {
    const page = await context.newPage();
    await page.goto(url);
    await page.getByRole("heading", { level: 1, name: "Tasks" }).waitFor();
    await page.waitForLoadState("networkidle");
    return await discoverPage(page);
  } finally {
    await context.close();
  }
}

/** The scenario as the check plans it for the page's form, signed in, with the scope the planner adds. */
function scenarioFor(page: DiscoveredPage): Scenario {
  const form = page.forms[0]!;
  const planned = check.plan(form, page, { signedIn: true, otherAccount: false })[0];
  if (!planned) throw new Error("csrf planned no scenario for this form");
  return { ...planned, scope: "form", formIndex: 0 };
}

async function run(o: { targetUrl: string; page: DiscoveredPage; self: SessionState; allowedHosts?: string[] }): Promise<CheckResult> {
  const form = o.page.forms[0]!;
  const dir = await mkdtemp(join(tmpdir(), "rh-csrf-"));
  dirs.push(dir);
  const ctx = createCheckContext({
    browser,
    form,
    discoveredPage: o.page,
    targetUrl: o.targetUrl,
    artifactsDir: dir,
    runToken: RUN_TOKEN,
    checkId: "csrf",
    sessions: { self: o.self },
    accounts: { self: A, other: null },
    markers: [],
    ...(o.allowedHosts ? { allowedHosts: o.allowedHosts } : {}),
  });
  contexts.push(ctx);
  return check.run(ctx, scenarioFor(o.page));
}

/**
 * Runs the check against a task app, reached on 127.0.0.1 (so the cross-site twin is localhost) or, with `host:
 * "localhost"`, on localhost (the twin is 127.0.0.1, Fernway's direction).
 */
async function runApp(server: FixtureServer, sameSite: "Lax" | "Strict" | "None", host: "127.0.0.1" | "localhost" = "127.0.0.1"): Promise<CheckResult> {
  const base = server.url.replace("127.0.0.1", host);
  const self = session(host, sameSite);
  const page = await discover(`${base}/app`, self);
  server.requests.length = 0;
  return run({ targetUrl: `${base}/app`, page, self });
}

/** The forged POSTs the server got: those whose body carries the forged marker (the run token followed by "csrf"). */
function forgedPosts(server: FixtureServer) {
  return server.requests.filter((r) => r.method === "POST" && r.url === "/api/tasks" && /cf7e57a1csrf/i.test(decodeURIComponent(r.body.replace(/\+/g, " "))));
}

const hasSession = (r: { headers: Record<string, unknown> }) => /(?:^|;\s*)sid=/.test(String(r.headers.cookie ?? ""));

describe("csrf: the cross-site page and its verdict", () => {
  it("passes when the session cookie is SameSite=Lax: the browser doesn't send it cross-site", async () => {
    const server = await taskApp();
    const result = await runApp(server, "Lax");
    expect(result.findings).toEqual([]);
    expect(result.status).toBe("pass");
    expect(result.notes).toMatch(/could not change Account A's data/);
    // The forge really ran, and reached the server without the session cookie (so a broken forge can't pass).
    const forged = forgedPosts(server);
    expect(forged.length).toBeGreaterThan(0);
    expect(forged.some(hasSession)).toBe(false);
    expect(result.notes).not.toMatch(/check Account A/);
  }, 60_000);

  it("finds it when the cookie is SameSite=None and the save takes a cross-site form post with no token or Origin check", async () => {
    const server = await taskApp({ defense: "none" });
    const result = await runApp(server, "None");
    expect(result.status).toBe("fail");
    expect(result.findings).toHaveLength(1);
    const f = result.findings[0]!;
    expect(f.checkId).toBe("csrf");
    expect(f.severity).toBe("high");
    expect(f.confidence).toBe("confirmed");
    expect(f.title).toMatch(/another site can change Account A's data/);
    // The reason comes from the cookies the forged request really carried.
    expect(f.meaning).toMatch(/sid \(SameSite=None\)/);
    const forged = forgedPosts(server);
    expect(forged.length).toBeGreaterThan(0);
    expect(forged.every(hasSession)).toBe(true);
    // The forged create made a new test record: named, with "check Account A".
    expect(result.notes).toMatch(/created a new test record[\s\S]*check Account A/);
    // No cookie value or session secret leaks into the result.
    expect(JSON.stringify(result)).not.toContain("a-session");
    // The exported spec signs in from env vars, serves a real page on the other site, and holds no run value.
    const spec = f.spec!.source;
    expect(spec).toMatch(/RUNHOUND_ACCOUNT_A_PASSWORD/);
    expect(spec).toMatch(/createServer/);
    expect(spec).not.toMatch(/route\.fulfill|storageState: "|cf7e57a1|new-value/);
    expect(spec).toContain('const RECORD = "/api/tasks"');
  }, 60_000);

  it("finds it on a localhost target (the attacker page on 127.0.0.1), Fernway's direction", async () => {
    const server = await taskApp({ defense: "none" });
    const result = await runApp(server, "None", "localhost");
    expect(result.status).toBe("fail");
    expect(result.findings[0]?.confidence).toBe("confirmed");
    expect(result.notes).toMatch(/http:\/\/127\.0\.0\.1:\d+/);
  }, 60_000);

  it("finds it when the record endpoint answers a bare array (Fernway's GET /api/tasks)", async () => {
    const server = await taskApp({ defense: "none", list: "array" });
    const result = await runApp(server, "None");
    expect(result.status).toBe("fail");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.confidence).toBe("confirmed");
  }, 60_000);

  it("passes when a CSRF token in a custom header is required: a cross-site form post can't add it", async () => {
    const server = await taskApp({ defense: "token" });
    const result = await runApp(server, "None");
    expect(result.findings).toEqual([]);
    expect(result.status).toBe("pass");
  }, 60_000);

  it("passes when a CSRF token in a hidden body field is required: the forged body never carries Account A's token", async () => {
    const server = await taskApp({ defense: "body-token" });
    const result = await runApp(server, "None");
    expect(result.findings).toEqual([]);
    expect(result.status).toBe("pass");
    expect(result.notes).toMatch(/left out _csrf/);
    const forged = forgedPosts(server);
    expect(forged.length).toBeGreaterThan(0);
    for (const r of forged) {
      expect(new URLSearchParams(r.body).has("_csrf")).toBe(false);
      expect(r.body).not.toContain(CSRF_TOKEN);
    }
  }, 60_000);

  it("passes when the server checks the Origin header: the attacker origin is rejected", async () => {
    const server = await taskApp({ defense: "origin" });
    const result = await runApp(server, "None");
    expect(result.findings).toEqual([]);
    expect(result.status).toBe("pass");
  }, 60_000);

  it("passes with 'needs a preflight' when the save is JSON only (and CORS doesn't allow the other site)", async () => {
    const server = await taskApp({ defense: "json-only" });
    const result = await runApp(server, "None");
    expect(result.findings).toEqual([]);
    expect(result.status).toBe("pass");
    expect(result.notes).toMatch(/preflight/i);
    // The text/plain attempt sent the JSON payload, not a form body.
    const text = server.requests.filter((r) => r.method === "POST" && String(r.headers["content-type"]).startsWith("text/plain"));
    expect(text.length).toBeGreaterThan(0);
    for (const r of text) expect(JSON.parse(r.body)).toMatchObject({ title: expect.stringMatching(/cf7e57a1csrf/) });
  }, 60_000);

  it("finds it when a JSON save is taken whatever its content-type: the JSON payload sent as text/plain", async () => {
    const server = await taskApp({ defense: "json-any-type" });
    const result = await runApp(server, "None");
    expect(result.status).toBe("fail");
    expect(result.findings).toHaveLength(1);
    expect(result.notes).toMatch(/JSON sent as text\/plain/);
  }, 60_000);

  it("finds it, noted as a CORS issue, when the JSON save's CORS reflects the other site with credentials", async () => {
    const server = await taskApp({ defense: "json-only", cors: true });
    const result = await runApp(server, "None");
    expect(result.status).toBe("fail");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.meaning).toMatch(/\bcors\b/i);
    // The preflight was a real one, answered by the app's own server.
    expect(server.requests.some((r) => r.method === "OPTIONS" && r.headers.origin)).toBe(true);
  }, 60_000);

  it("is inconclusive, never a pass, when the re-read as Account A fails after the forge", async () => {
    const server = await taskApp({ defense: "origin", failReadAfterForge: true });
    const result = await runApp(server, "None");
    expect(result.status).toBe("skipped");
    expect(result.findings).toEqual([]);
    expect(result.notes).toMatch(/^Inconclusive: the re-read as Account A failed[\s\S]*check Account A/);
  }, 60_000);

  it("is inconclusive when the app takes the forge (2xx) but the record endpoint reads only the test record", async () => {
    const server = await taskApp({ defense: "none", list: "one" });
    const result = await runApp(server, "None");
    expect(server.tasks.some((t) => /cf7e57a1csrf/.test(t.title))).toBe(true);
    expect(result.status).toBe("skipped");
    expect(result.findings).toEqual([]);
    expect(result.notes).toMatch(/Inconclusive[\s\S]*created a new one: check Account A/);
  }, 60_000);

  it("puts a changed test record back only through the app's own update for its id, never by replaying the create", async () => {
    const server = await taskApp({ defense: "none", upsert: true, patch: true });
    const result = await runApp(server, "None", "localhost");
    expect(result.status).toBe("fail");
    expect(result.notes).toMatch(/Restored title/);
    expect(server.tasks).toHaveLength(1);
    expect(server.tasks[0]!.title).not.toMatch(/cf7e57a1csrf/);
    // After the forge, only the app's PATCH was sent to put it back; no second create.
    const afterForge = server.requests.slice(server.requests.findIndex((r) => forgedPosts(server).includes(r)) + 1);
    expect(afterForge.filter((r) => r.method === "POST" && !forgedPosts(server).includes(r))).toEqual([]);
    expect(afterForge.some((r) => r.method === "PATCH")).toBe(true);
  }, 60_000);

  it("says a changed test record could not be undone when the app sent no update for it", async () => {
    const server = await taskApp({ defense: "none", upsert: true });
    const result = await runApp(server, "None", "localhost");
    expect(result.status).toBe("fail");
    expect(result.notes).toMatch(/Could not be undone[\s\S]*check Account A/);
    // Nothing but forged requests was sent after the first forge: no create replayed as a "restore".
    const afterForge = server.requests.slice(server.requests.findIndex((r) => forgedPosts(server).includes(r)) + 1);
    expect(afterForge.filter((r) => r.method !== "GET" && r.method !== "OPTIONS" && !forgedPosts(server).includes(r))).toEqual([]);
  }, 60_000);
});

describe("csrf: the cross-site origin", () => {
  it("is always plain http, also for an https target, so the attacker page loads", async () => {
    const context = await browser.newContext();
    const stub = {
      targetUrl: "https://localhost:9/app",
      openPage: async () => ({ context, page: await context.newPage() }),
      step: () => undefined,
    } as unknown as import("../core/types.js").CheckContext;
    try {
      const out = await crossSitePage(stub, "https://localhost:9/app");
      if ("inconclusive" in out) throw new Error(out.inconclusive);
      expect(out.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      await out.dispose();
    } finally {
      await context.close();
    }
  }, 30_000);
});

describe("csrf: no cross-site origin can be set up", () => {
  it("crossSitePage maps localhost <-> 127.0.0.1 and refuses hosts with no twin", async () => {
    // Host logic only: openPage is never reached for the inconclusive branch (it returns before opening a page).
    const stub = { targetUrl: "http://10.1.2.3:8080/app" } as unknown as import("../core/types.js").CheckContext;
    const out = await crossSitePage(stub, "http://10.1.2.3:8080/app");
    expect("inconclusive" in out).toBe(true);
    if ("inconclusive" in out) expect(out.inconclusive).toMatch(/no cross-site twin|can't be tested/);
  });

  it("reports inconclusive (never confirmed or pass) when the target host has no cross-site twin", async () => {
    // A non-loopback address (bound on 0.0.0.0) reaches the app but has no localhost/127.0.0.1 twin, so no cross-site
    // origin can be set up. The whole check runs (it creates the record) and then reports inconclusive, not a finding.
    const lan = Object.values(networkInterfaces())
      .flat()
      .find((n) => n && n.family === "IPv4" && !n.internal)?.address;
    if (!lan) return; // no non-loopback interface in this environment; the unit test above still covers the branch.
    const server = await rawTaskServer("0.0.0.0");
    const target = `http://${lan}:${server.port}/app`;
    // A non-Secure cookie: an http address that isn't loopback is not a secure context, so the browser won't send a
    // Secure (SameSite=None) cookie there. SameSite doesn't matter here: the check reports inconclusive before forging.
    const self = session(lan, "Lax");
    let page: DiscoveredPage;
    try {
      page = await discover(target, self);
    } catch {
      return; // the browser can't route to the address here; the unit test above still covers the branch.
    }
    const result = await run({ targetUrl: target, page, self, allowedHosts: [lan] });
    expect(result.status).not.toBe("fail");
    expect(result.status).not.toBe("pass");
    expect(result.findings).toEqual([]);
    expect(result.notes).toMatch(/[Ii]nconclusive/);
  }, 60_000);
});

/** A task app on a raw HTTP server bound to `host` (so it can be reached at a non-loopback address for the twin test). */
async function rawTaskServer(host: string): Promise<{ port: number }> {
  const tasks: { id: string; title: string }[] = [];
  const signedIn = (c?: string) => /(?:^|;\s*)sid=a-session\b/.test(c ?? "");
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const path = new URL(req.url ?? "/", "http://x").pathname;
      if (req.method === "GET" && path === "/app") {
        res.writeHead(200, { "content-type": "text/html" });
        return res.end(`<!doctype html><html lang="en"><head><title>Tasks</title></head><body><main><h1>Tasks</h1>
<form id="new" aria-label="New task"><label for="t">Title</label><input id="t" name="title" required><button type="submit">Add task</button></form>
<ul id="list"></ul></main><script>
var t=document.getElementById('t');
function load(){fetch('/api/tasks').then(function(r){return r.ok?r.json():{tasks:[]};}).then(function(d){document.getElementById('list').innerHTML=(d.tasks||[]).map(function(x){return '<li>'+String(x.title)+'</li>';}).join('');});}
document.getElementById('new').addEventListener('submit',function(e){e.preventDefault();fetch('/api/tasks',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({title:t.value}).toString()}).then(function(){load();});});
load();
</script></body></html>`);
      }
      if (path === "/api/tasks") {
        if (!signedIn(req.headers.cookie)) return end(res, 401, { error: "Sign in first" });
        if (req.method === "GET") return end(res, 200, { tasks });
        if (req.method === "POST") {
          const title = new URLSearchParams(body).get("title") ?? "";
          if (title) tasks.push({ id: `t${tasks.length + 1}`, title });
          return end(res, 201, { ok: true });
        }
      }
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, host, resolve));
  rawServers.push(server);
  return { port: (server.address() as AddressInfo).port };
}
