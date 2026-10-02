// write-access on apps shaped the way real frameworks shape them (0.6.0 round 1), driven through createCheckContext against small task apps built in this file (sid=a-session is Account A, sid=b-session Account B).
import { mkdtemp, rm } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeBrowser, getBrowser } from "../../../../test-support/harness.js";
import { startFixtureServer, type FixtureServer, type RecordedRequest } from "../../../../test-support/server.js";
import type { AccountRef, CheckResult, DiscoveredPage, Scenario } from "../../../../src/core/types.js";
import type { SessionState } from "../../../../src/engine/auth.js";
import { createCheckContext, type RunningCheckContext } from "../../../../src/engine/context.js";
import { discoverPage } from "../../../../src/engine/discover.js";
import { check } from "../../../../src/checks/write-access.js";

const A: AccountRef = { id: "a", label: "Account A" };
const B: AccountRef = { id: "b", label: "Account B" };
const RUN_TOKEN = "wk7s2p9q";

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

type Who = "a" | "b";

// A session: sid, plus any `extra` cookies (a csrftoken).
function session(who: Who, extra: Record<string, string> = {}): SessionState {
  const cookie = (name: string, value: string) => ({ name, value, domain: "127.0.0.1", path: "/", expires: -1, httpOnly: name === "sid", secure: false, sameSite: "Lax" as const });
  return { cookies: [cookie("sid", `${who}-session`), ...Object.entries(extra).map(([n, v]) => cookie(n, v))], origins: [] };
}

function cookieOf(req: RecordedRequest, name: string): string | null {
  const m = new RegExp(`(?:^|;\\s*)${name}=([^;]*)`).exec(String(req.headers.cookie ?? ""));
  return m ? m[1]! : null;
}

function callerOf(req: RecordedRequest): Who | null {
  const sid = cookieOf(req, "sid");
  return sid === "a-session" ? "a" : sid === "b-session" ? "b" : null;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function parse(body: string): Record<string, unknown> {
  try {
    const v = JSON.parse(body) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return Object.fromEntries(new URLSearchParams(body));
  }
}

const pathOf = (url: string) => new URL(url, "http://x").pathname;
const page = (script: string, field = "title") => `<!doctype html><html lang="en"><head><title>Tasks</title></head><body><main><h1>Tasks</h1>
<form id="new" aria-label="New task"><label for="title">Title</label><input id="title" name="${field}" required><button type="submit">Add task</button></form>
<p role="status" id="status"></p><ul id="list"></ul></main>
<script>
function csrf() { var m = /(?:^|;\\s*)csrftoken=([^;]*)/.exec(document.cookie); return m ? m[1] : ''; }
${script}
</script></body></html>`;

async function discover(server: FixtureServer, self: SessionState): Promise<DiscoveredPage> {
  const context = await browser.newContext({ storageState: self });
  try {
    const p = await context.newPage();
    await p.goto(`${server.url}/app`);
    await p.getByRole("heading", { level: 1, name: "Tasks" }).waitFor();
    await p.waitForLoadState("networkidle");
    return await discoverPage(p);
  } finally {
    await context.close();
  }
}

async function run(server: FixtureServer, which: "other-account" | "signed-out", o: { self?: SessionState; other?: SessionState } = {}): Promise<CheckResult> {
  const self = o.self ?? session("a");
  const other = o.other ?? session("b");
  const discovered = await discover(server, self);
  const planned = check.plan(discovered.forms[0]!, discovered, { signedIn: true, otherAccount: true }).find((s) => s.id === `write-access:${which}`);
  if (!planned) throw new Error(`no write-access:${which} scenario`);
  const dir = await mkdtemp(join(tmpdir(), "rh-wa-shapes-"));
  dirs.push(dir);
  const ctx = createCheckContext({
    browser,
    form: discovered.forms[0]!,
    discoveredPage: discovered,
    targetUrl: `${server.url}/app`,
    artifactsDir: dir,
    runToken: RUN_TOKEN,
    checkId: "write-access",
    sessions: { self, other },
    accounts: { self: A, other: B },
    markers: [],
  });
  contexts.push(ctx);
  server.requests.length = 0;
  return check.run(ctx, { ...planned, scope: "form", formIndex: 0 } as Scenario);
}

const writesBy = (server: FixtureServer, who: Who | null) => server.requests.filter((r) => !["GET", "HEAD", "OPTIONS"].includes(r.method) && callerOf(r) === who);

describe("write-access: records keyed taskId", () => {
  // Tasks keyed taskId. "create": the form creates a task (POST /api/tasks), then the page saves it again (POST /api/tasks/<taskId>), which has no ownership check. "edit": the form renames Account A's own task k1 (POST /api/tasks/k1).
  async function keyedApp(form: "create" | "edit") {
    const tasks = [
      { taskId: "k1", owner: "a" as Who, title: "Groceries" },
      { taskId: "k2", owner: "b" as Who, title: "Reading list" },
    ];
    let next = 3;
    const script =
      form === "create"
        ? `function load() { return fetch('/api/tasks').then(function (r) { return r.json(); }).then(function (d) { document.getElementById('list').innerHTML = d.tasks.map(function (t) { return '<li>' + t.title + '</li>'; }).join(''); }); }
document.getElementById('new').addEventListener('submit', function (e) { e.preventDefault(); var title = document.getElementById('title').value;
  fetch('/api/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: title }) }).then(function (r) { return r.json(); })
    .then(function (t) { return fetch('/api/tasks/' + t.taskId, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: title }) }); }).then(load); });
load();`
        : `var current = null;
function load() { return fetch('/api/tasks').then(function (r) { return r.json(); }).then(function (d) { current = d.tasks[0] ? d.tasks[0].taskId : null; document.getElementById('list').innerHTML = d.tasks.map(function (t) { return '<li>' + t.title + '</li>'; }).join(''); }); }
document.getElementById('new').addEventListener('submit', function (e) { e.preventDefault();
  fetch('/api/tasks/' + current, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: document.getElementById('title').value }) }).then(load); });
load();`;
    const view = (t: (typeof tasks)[number]) => ({ taskId: t.taskId, title: t.title });
    const server = await startFixtureServer({
      pages: { "/app": page(script) },
      routes: {
        "GET /api/tasks": (req, res) => {
          const caller = callerOf(req);
          if (!caller) return send(res, 401, { error: "Sign in" });
          send(res, 200, { tasks: tasks.filter((t) => t.owner === caller).map(view) });
        },
        "POST /api/tasks": (req, res) => {
          const caller = callerOf(req);
          if (!caller) return send(res, 401, { error: "Sign in" });
          const t = { taskId: `k${next++}`, owner: caller, title: String(parse(req.body).title ?? "") };
          tasks.push(t);
          send(res, 201, view(t));
        },
      },
      fallback: (req, res) => {
        const m = /^\/api\/tasks\/([^/]+)$/.exec(pathOf(req.url));
        const t = m ? tasks.find((x) => x.taskId === m[1]) : undefined;
        if (!t || req.method !== "POST") return send(res, 404, { error: "Not found" });
        // BUG (planted): any signed-in caller may rename any task.
        if (!callerOf(req)) return send(res, 401, { error: "Sign in" });
        const title = parse(req.body).title;
        if (typeof title === "string") t.title = title;
        send(res, 200, view(t));
      },
    });
    servers.push(server);
    return Object.assign(server, { tasks });
  }

  it("finds the test record's id under taskId and confirms that Account B can change it", async () => {
    const server = await keyedApp("create");
    const result = await run(server, "other-account");
    expect(result.notes).not.toMatch(/has no id/);
    expect(result.status, result.notes).toBe("fail");
    expect(result.findings[0]!.title).toBe("Account B can change Account A's records");
    // Account A's own k1 was never written, by anyone.
    expect(server.tasks[0]).toEqual({ taskId: "k1", owner: "a", title: "Groceries" });
  });

  it("stops a form that edits Account A's own task k1 before its save reaches the app", async () => {
    const server = await keyedApp("edit");
    for (const which of ["other-account", "signed-out"] as const) {
      const result = await run(server, which);
      expect(result.status, `${which}: ${result.notes}`).toBe("skipped");
      expect(result.notes).toMatch(/changes a record Account A already had/);
      expect(result.notes).toMatch(/stopped the form's save \(POST \/api\/tasks\/k1\) before it reached the app/);
      expect(server.tasks[0]).toEqual({ taskId: "k1", owner: "a", title: "Groceries" });
      expect(writesBy(server, "b")).toEqual([]);
      expect(writesBy(server, null)).toEqual([]);
    }
  });
});

describe("write-access: a Rails-style form (task[title]=…)", () => {
  // The page creates a task (POST /tasks task[title]=…), then saves it again with PATCH /tasks/<id> ("both": task[title]=…&task[done]=0; "done": task[done]=0 only). The server reads only task[...] keys (strong params) and has no ownership check on PATCH.
  async function railsApp(update: "both" | "done") {
    const tasks: { id: number; owner: Who; title: string; done: boolean }[] = [{ id: 1, owner: "a", title: "Groceries", done: false }];
    let next = 2;
    const body = update === "both" ? `{ 'task[title]': title, 'task[done]': '0' }` : `{ 'task[done]': '0' }`;
    const script = `function load() { return fetch('/tasks.json').then(function (r) { return r.ok ? r.json() : []; }).then(function (d) { document.getElementById('list').innerHTML = d.map(function (t) { return '<li>' + t.title + '</li>'; }).join(''); }); }
document.getElementById('new').addEventListener('submit', function (e) { e.preventDefault(); var title = document.getElementById('title').value; var form = 'application/x-www-form-urlencoded';
  fetch('/tasks', { method: 'POST', headers: { 'content-type': form }, body: new URLSearchParams({ 'task[title]': title }).toString() }).then(function (r) { return r.json(); })
    .then(function (t) { return fetch('/tasks/' + t.id, { method: 'PATCH', headers: { 'content-type': form }, body: new URLSearchParams(${body}).toString() }); }).then(load); });
load();`;
    const view = (t: (typeof tasks)[number]) => ({ id: t.id, title: t.title, done: t.done });
    const server = await startFixtureServer({
      pages: { "/app": page(script, "task[title]") },
      routes: {
        "GET /tasks.json": (req, res) => {
          const caller = callerOf(req);
          if (!caller) return send(res, 401, { error: "Sign in" });
          send(res, 200, tasks.filter((t) => t.owner === caller).map(view));
        },
        "POST /tasks": (req, res) => {
          const caller = callerOf(req);
          if (!caller) return send(res, 401, { error: "Sign in" });
          const t = { id: next++, owner: caller, title: new URLSearchParams(req.body).get("task[title]") ?? "", done: false };
          tasks.push(t);
          send(res, 201, view(t));
        },
      },
      fallback: (req, res) => {
        const m = /^\/tasks\/(\d+)$/.exec(pathOf(req.url));
        const t = m ? tasks.find((x) => x.id === Number(m[1])) : undefined;
        if (!t || req.method !== "PATCH") return send(res, 404, { error: "Not found" });
        // BUG (planted): no ownership check, not even a session. Only task[...] keys are read.
        const p = new URLSearchParams(req.body);
        if (p.has("task[title]")) t.title = p.get("task[title]")!;
        if (p.has("task[done]")) t.done = p.get("task[done]") === "1";
        send(res, 200, view(t));
      },
    });
    servers.push(server);
    return server;
  }

  it("puts the marker in task[title], where the server reads it: the unguarded update is a finding", async () => {
    const server = await railsApp("both");
    for (const which of ["other-account", "signed-out"] as const) {
      const result = await run(server, which);
      expect(result.status, `${which}: ${result.notes}`).toBe("fail");
      const probe = [...writesBy(server, "b"), ...writesBy(server, null)].find((r) => r.method === "PATCH")!;
      const params = new URLSearchParams(probe.body);
      expect(params.get("task[title]")).toMatch(/wk7s2p9qwx/);
      expect(params.has("title")).toBe(false);
    }
  });

  it("doesn't add a top-level field the app never sent: an update without a run-token field is not tried", async () => {
    const server = await railsApp("done");
    const result = await run(server, "signed-out");
    expect(result.findings).toEqual([]);
    expect(result.status, result.notes).toBe("skipped");
    expect(writesBy(server, null).filter((r) => r.method === "PATCH").map((r) => r.body)).toEqual([]);
  });
});

describe("write-access: a body CSRF token (Django's csrfmiddlewaretoken)", () => {
  // Every write carries csrfmiddlewaretoken, which must equal the caller's own csrftoken cookie. The update (POST /api/tasks/<id>) has no ownership check.
  async function djangoApp() {
    const tasks: { id: number; owner: Who; title: string }[] = [{ id: 1, owner: "a", title: "Groceries" }];
    let next = 2;
    const script = `function load() { return fetch('/api/tasks').then(function (r) { return r.ok ? r.json() : []; }).then(function (d) { document.getElementById('list').innerHTML = d.map(function (t) { return '<li>' + t.title + '</li>'; }).join(''); }); }
document.getElementById('new').addEventListener('submit', function (e) { e.preventDefault(); var title = document.getElementById('title').value; var form = 'application/x-www-form-urlencoded';
  fetch('/api/tasks', { method: 'POST', headers: { 'content-type': form }, body: new URLSearchParams({ csrfmiddlewaretoken: csrf(), title: title }).toString() }).then(function (r) { return r.json(); })
    .then(function (t) { return fetch('/api/tasks/' + t.id, { method: 'POST', headers: { 'content-type': form }, body: new URLSearchParams({ csrfmiddlewaretoken: csrf(), title: title }).toString() }); }).then(load); });
load();`;
    const tokenOk = (req: RecordedRequest) => {
      const cookie = cookieOf(req, "csrftoken");
      return Boolean(cookie) && new URLSearchParams(req.body).get("csrfmiddlewaretoken") === cookie;
    };
    const view = (t: (typeof tasks)[number]) => ({ id: t.id, title: t.title });
    const server = await startFixtureServer({
      pages: { "/app": page(script) },
      routes: {
        "GET /api/tasks": (req, res) => {
          const caller = callerOf(req);
          if (!caller) return send(res, 401, { error: "Sign in" });
          send(res, 200, tasks.filter((t) => t.owner === caller).map(view));
        },
        "POST /api/tasks": (req, res) => {
          const caller = callerOf(req);
          if (!caller) return send(res, 401, { error: "Sign in" });
          if (!tokenOk(req)) return send(res, 403, { error: "CSRF verification failed" });
          const t = { id: next++, owner: caller, title: new URLSearchParams(req.body).get("title") ?? "" };
          tasks.push(t);
          send(res, 201, view(t));
        },
      },
      fallback: (req, res) => {
        const m = /^\/api\/tasks\/(\d+)$/.exec(pathOf(req.url));
        const t = m ? tasks.find((x) => x.id === Number(m[1])) : undefined;
        if (!t || req.method !== "POST") return send(res, 404, { error: "Not found" });
        if (!callerOf(req)) return send(res, 401, { error: "Sign in" });
        if (!tokenOk(req)) return send(res, 403, { error: "CSRF verification failed" });
        // BUG (planted): no ownership check.
        const title = new URLSearchParams(req.body).get("title");
        if (title) t.title = title;
        send(res, 200, view(t));
      },
    });
    servers.push(server);
    return server;
  }

  it("sends Account B's own token as Account B, so the missing ownership check is found", async () => {
    const server = await djangoApp();
    const result = await run(server, "other-account", { self: session("a", { csrftoken: "tokenAAAA1111" }), other: session("b", { csrftoken: "tokenBBBB2222" }) });
    expect(result.status, result.notes).toBe("fail");
    const probe = writesBy(server, "b").find((r) => r.method === "POST")!;
    expect(new URLSearchParams(probe.body).get("csrfmiddlewaretoken")).toBe("tokenBBBB2222");
  });

  it("is inconclusive, never a pass, when a replay that carried Account A's token is refused and B has no token of its own", async () => {
    const server = await djangoApp();
    const result = await run(server, "other-account", { self: session("a", { csrftoken: "tokenAAAA1111" }), other: session("b") });
    expect(result.status, result.notes).toBe("skipped");
    expect(result.notes).toMatch(/Inconclusive/);
    expect(result.notes).toMatch(/csrfmiddlewaretoken/);
  });
});

describe("write-access: a thin list read and Account A's note that shares the test record's id", () => {
  // The list read shows only {id, title}. After the create the page saves the task (PATCH /api/tasks/<id>, owner-only) and copies its title into Account A's note 3 (PATCH /api/notes/3, which has no ownership check). The run's first task gets id 3 too.
  async function siblingApp(o: { createdAt?: boolean } = {}) {
    // createdAt: every task and note also carries when it was created, so the list read is {id, title, createdAt} and the note has each of those keys too (only its createdAt, from before the run, differs from the new task's).
    const stamp = (at: string) => (o.createdAt ? { createdAt: at } : {});
    const tasks: { id: number; owner: Who; title: string; createdAt?: string }[] = [
      { id: 1, owner: "a", title: "Groceries", ...stamp("2026-01-05T09:00:00.000Z") },
      { id: 2, owner: "b", title: "Reading list", ...stamp("2026-01-06T09:00:00.000Z") },
    ];
    const notes: { id: number; title: string; createdAt?: string }[] = [{ id: 3, title: "Plumber note", ...stamp("2026-01-07T09:00:00.000Z") }];
    let next = 3;
    const script = `function load() { return fetch('/api/tasks').then(function (r) { return r.json(); }).then(function (d) { document.getElementById('list').innerHTML = d.tasks.map(function (t) { return '<li>' + t.title + '</li>'; }).join(''); }); }
document.getElementById('new').addEventListener('submit', function (e) { e.preventDefault(); var title = document.getElementById('title').value; var json = { 'content-type': 'application/json' };
  fetch('/api/tasks', { method: 'POST', headers: json, body: JSON.stringify({ title: title }) }).then(function (r) { return r.json(); })
    .then(function (d) { return fetch('/api/tasks/' + d.task.id, { method: 'PATCH', headers: json, body: JSON.stringify({ title: title }) })
      .then(function () { return fetch('/api/notes/3', { method: 'PATCH', headers: json, body: JSON.stringify({ title: title }) }); }); }).then(load); });
load();`;
    const view = (t: { id: number; title: string; createdAt?: string }) => ({ id: t.id, title: t.title, ...(t.createdAt ? { createdAt: t.createdAt } : {}) });
    const server = await startFixtureServer({
      pages: { "/app": page(script) },
      routes: {
        "GET /api/tasks": (req, res) => {
          const caller = callerOf(req);
          if (!caller) return send(res, 401, { error: "Sign in" });
          send(res, 200, { tasks: tasks.filter((t) => t.owner === caller).map(view) });
        },
        "POST /api/tasks": (req, res) => {
          const caller = callerOf(req);
          if (!caller) return send(res, 401, { error: "Sign in" });
          const t = { id: next++, owner: caller, title: String(parse(req.body).title ?? ""), ...stamp(new Date().toISOString()) };
          tasks.push(t);
          send(res, 201, { task: view(t) });
        },
      },
      fallback: (req, res) => {
        const note = /^\/api\/notes\/(\d+)$/.exec(pathOf(req.url));
        if (note) {
          const n = notes.find((x) => x.id === Number(note[1]));
          if (!n) return send(res, 404, { error: "Not found" });
          // No ownership check on the note, read or write.
          if (req.method === "PATCH" && typeof parse(req.body).title === "string") n.title = String(parse(req.body).title);
          return send(res, 200, view(n));
        }
        const m = /^\/api\/tasks\/(\d+)$/.exec(pathOf(req.url));
        const t = m ? tasks.find((x) => x.id === Number(m[1])) : undefined;
        const caller = callerOf(req);
        if (!t || t.owner !== caller) return send(res, caller ? 404 : 401, { error: "Not found" });
        if (req.method === "PATCH" && typeof parse(req.body).title === "string") t.title = String(parse(req.body).title);
        send(res, 200, { task: view(t) });
      },
    });
    servers.push(server);
    return Object.assign(server, { notes });
  }

  it("never sends a marker into the note, as Account B or signed out", async () => {
    for (const which of ["other-account", "signed-out"] as const) {
      const server = await siblingApp();
      const result = await run(server, which);
      const noteWrites = server.requests.filter((r) => r.method === "PATCH" && pathOf(r.url) === "/api/notes/3" && callerOf(r) !== "a");
      expect(noteWrites.map((r) => r.body), `${which}: ${result.notes}`).toEqual([]);
      expect(server.notes[0]!.title).not.toMatch(/wk7s2p9qwx/);
      expect(result.notes).not.toMatch(/PATCH \/api\/notes\/3 \((\d{3}|no answer)\)/);
    }
  });

  it("never sends a marker into the note when the list read and the note both carry createdAt, as Account B or signed out", async () => {
    for (const which of ["other-account", "signed-out"] as const) {
      const server = await siblingApp({ createdAt: true });
      const result = await run(server, which);
      const noteWrites = server.requests.filter((r) => r.method === "PATCH" && pathOf(r.url) === "/api/notes/3" && callerOf(r) !== "a");
      expect(noteWrites.map((r) => r.body), `${which}: ${result.notes}`).toEqual([]);
      expect(server.notes[0]!.title).not.toMatch(/wk7s2p9qwx/);
      expect(result.notes).not.toMatch(/PATCH \/api\/notes\/3 \((\d{3}|no answer)\)/);
    }
  });
});

describe("write-access: an API that takes its credential in the URL (?access_token=)", () => {
  const TOKENS: Record<Who, string> = { a: "tokA7Hq2Lm9Xc4", b: "tokB3Zr8Wn1Pk6" };
  // The page gets its API token from GET /api/session (cookie session), then calls the API with ?access_token=<token>: the create (POST /api/tasks?access_token=…), then an update of the new task (PATCH /api/tasks/<id>?access_token=…). The API knows its caller only by that token. "owner-only": the update checks the task belongs to the token's account (a clean app); "unchecked": any valid token may change any task.
  async function tokenApp(update: "owner-only" | "unchecked") {
    const tasks: { id: number; owner: Who; title: string }[] = [{ id: 1, owner: "a", title: "Groceries" }];
    let next = 2;
    const byToken = (req: RecordedRequest): Who | null => {
      const t = new URL(req.url, "http://x").searchParams.get("access_token");
      return t === TOKENS.a ? "a" : t === TOKENS.b ? "b" : null;
    };
    const script = `var tok = null;
function api(path) { return path + (path.indexOf('?') < 0 ? '?' : '&') + 'access_token=' + encodeURIComponent(tok); }
function load() { return fetch(api('/api/tasks')).then(function (r) { return r.ok ? r.json() : []; }).then(function (d) { document.getElementById('list').innerHTML = d.map(function (t) { return '<li>' + t.title + '</li>'; }).join(''); }); }
document.getElementById('new').addEventListener('submit', function (e) { e.preventDefault(); var title = document.getElementById('title').value; var json = { 'content-type': 'application/json' };
  fetch(api('/api/tasks'), { method: 'POST', headers: json, body: JSON.stringify({ title: title }) }).then(function (r) { return r.json(); })
    .then(function (t) { return fetch(api('/api/tasks/' + t.id), { method: 'PATCH', headers: json, body: JSON.stringify({ title: title }) }); }).then(load); });
fetch('/api/session').then(function (r) { return r.json(); }).then(function (s) { tok = s.token; return load(); });`;
    const view = (t: (typeof tasks)[number]) => ({ id: t.id, title: t.title });
    const server = await startFixtureServer({
      pages: { "/app": page(script) },
      routes: {
        "GET /api/session": (req, res) => {
          const caller = callerOf(req);
          if (!caller) return send(res, 401, { error: "Sign in" });
          send(res, 200, { token: TOKENS[caller] });
        },
        "GET /api/tasks": (req, res) => {
          const caller = byToken(req);
          if (!caller) return send(res, 401, { error: "Bad token" });
          send(res, 200, tasks.filter((t) => t.owner === caller).map(view));
        },
        "POST /api/tasks": (req, res) => {
          const caller = byToken(req);
          if (!caller) return send(res, 401, { error: "Bad token" });
          const t = { id: next++, owner: caller, title: String(parse(req.body).title ?? "") };
          tasks.push(t);
          send(res, 201, view(t));
        },
      },
      fallback: (req, res) => {
        const m = /^\/api\/tasks\/(\d+)$/.exec(pathOf(req.url));
        const t = m ? tasks.find((x) => x.id === Number(m[1])) : undefined;
        const caller = byToken(req);
        if (!caller) return send(res, 401, { error: "Bad token" });
        if (!t || (update === "owner-only" && t.owner !== caller)) return send(res, 404, { error: "Not found" });
        if (req.method === "PATCH") {
          const title = parse(req.body).title;
          if (typeof title === "string") t.title = title;
          return send(res, 200, view(t));
        }
        if (req.method === "GET") return send(res, 200, view(t));
        send(res, 405, { error: "Method not allowed" });
      },
    });
    servers.push(server);
    return server;
  }

  // Requests that carried Account A's token without Account A's session: Run Hound replaying A's credential.
  const withAsToken = (server: FixtureServer) => server.requests.filter((r) => r.url.includes(TOKENS.a) && callerOf(r) !== "a");

  it("sends Account B's own token as Account B, never Account A's: a clean app passes", async () => {
    const server = await tokenApp("owner-only");
    const result = await run(server, "other-account");
    expect(withAsToken(server).map((r) => `${r.method} ${r.url}`)).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(result.status, result.notes).toBe("pass");
    const probe = writesBy(server, "b").find((r) => r.method === "PATCH")!;
    expect(new URL(probe.url, "http://x").searchParams.get("access_token")).toBe(TOKENS.b);
    // Neither token is ever printed.
    expect(JSON.stringify(result)).not.toContain(TOKENS.a);
    expect(JSON.stringify(result)).not.toContain(TOKENS.b);
  });

  it("sends no credential signed out: a clean app passes, and Account A's token is never printed", async () => {
    const server = await tokenApp("owner-only");
    const result = await run(server, "signed-out");
    expect(withAsToken(server).map((r) => `${r.method} ${r.url}`)).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(result.status, result.notes).toBe("pass");
    const probe = writesBy(server, null).find((r) => r.method === "PATCH")!;
    expect(new URL(probe.url, "http://x").searchParams.has("access_token")).toBe(false);
    expect(JSON.stringify(result)).not.toContain(TOKENS.a);
  });

  it("confirms the missing ownership check with Account B's own token, and redacts both tokens in notes and spec", async () => {
    const server = await tokenApp("unchecked");
    const result = await run(server, "other-account");
    expect(withAsToken(server).map((r) => `${r.method} ${r.url}`)).toEqual([]);
    expect(result.status, result.notes).toBe("fail");
    expect(result.findings[0]!.title).toBe("Account B can change Account A's records");
    expect(result.findings[0]!.confidence).toBe("confirmed");
    expect(JSON.stringify(result)).not.toContain(TOKENS.a);
    expect(JSON.stringify(result)).not.toContain(TOKENS.b);
    expect(result.findings[0]!.spec?.source ?? "").not.toMatch(/tok[AB]7?/);
  });
});

describe("write-access: optimistic locking (Rails lock_version)", () => {
  // Each update sends the lock_version it last read; a stale one is a conflict (409). The update (PATCH /api/tasks/<id>) has no ownership check. "shown": the list read shows lock_version; "hidden": it doesn't, so Run Hound can't know the current one.
  async function lockApp(read: "shown" | "hidden") {
    const tasks: { id: number; owner: Who; title: string; version: number }[] = [{ id: 1, owner: "a", title: "Groceries", version: 0 }];
    let next = 2;
    const view = (t: (typeof tasks)[number]) => ({ id: t.id, title: t.title, ...(read === "shown" ? { lock_version: t.version } : {}) });
    const script = `function load() { return fetch('/api/tasks').then(function (r) { return r.ok ? r.json() : []; }).then(function (d) { document.getElementById('list').innerHTML = d.map(function (t) { return '<li>' + t.title + '</li>'; }).join(''); }); }
document.getElementById('new').addEventListener('submit', function (e) { e.preventDefault(); var title = document.getElementById('title').value; var json = { 'content-type': 'application/json' };
  fetch('/api/tasks', { method: 'POST', headers: json, body: JSON.stringify({ title: title }) }).then(function (r) { return r.json(); })
    .then(function (t) { return fetch('/api/tasks/' + t.id, { method: 'PATCH', headers: json, body: JSON.stringify({ title: title, lock_version: 0 }) }); }).then(load); });
load();`;
    const server = await startFixtureServer({
      pages: { "/app": page(script) },
      routes: {
        "GET /api/tasks": (req, res) => {
          const caller = callerOf(req);
          if (!caller) return send(res, 401, { error: "Sign in" });
          send(res, 200, tasks.filter((t) => t.owner === caller).map(view));
        },
        "POST /api/tasks": (req, res) => {
          const caller = callerOf(req);
          if (!caller) return send(res, 401, { error: "Sign in" });
          const t = { id: next++, owner: caller, title: String(parse(req.body).title ?? ""), version: 0 };
          tasks.push(t);
          send(res, 201, view(t));
        },
      },
      fallback: (req, res) => {
        const m = /^\/api\/tasks\/(\d+)$/.exec(pathOf(req.url));
        const t = m ? tasks.find((x) => x.id === Number(m[1])) : undefined;
        if (!t || req.method !== "PATCH") return send(res, 404, { error: "Not found" });
        if (!callerOf(req)) return send(res, 401, { error: "Sign in" });
        // BUG (planted): no ownership check. A stale lock_version is a conflict (Rails' StaleObjectError).
        const body = parse(req.body);
        if (Number(body.lock_version) !== t.version) return send(res, 409, { error: "Stale object: the task was changed by someone else" });
        if (typeof body.title === "string") t.title = body.title;
        t.version += 1;
        send(res, 200, view(t));
      },
    });
    servers.push(server);
    return Object.assign(server, { tasks });
  }

  it("sends the lock_version the record has now, so the missing ownership check is found", async () => {
    const server = await lockApp("shown");
    const result = await run(server, "other-account");
    expect(result.status, result.notes).toBe("fail");
    expect(result.findings[0]!.title).toBe("Account B can change Account A's records");
    const probe = writesBy(server, "b").find((r) => r.method === "PATCH")!;
    // Account A's own update had made it 1: the replay carries 1, not the 0 the app's update sent.
    expect(parse(probe.body).lock_version).toBe(1);
    // Put back afterwards.
    expect(server.tasks.find((t) => t.id !== 1)!.title).not.toMatch(/wk7s2p9qwx/);
  });

  it("is inconclusive, never a pass, when the replay is refused as a conflict (409) and the record is unchanged", async () => {
    const server = await lockApp("hidden");
    const result = await run(server, "other-account");
    expect(result.findings).toEqual([]);
    expect(result.status, result.notes).toBe("skipped");
    expect(result.notes).toMatch(/Inconclusive/);
    expect(result.notes).toMatch(/409/);
  });
});

describe("write-access: a create form with a search-as-you-type hint that echoes the typed value", () => {
  // As the title is typed, the page GETs /api/tasks/similar?q=<title>, which answers {query, matches} (the query echoed back). The form creates a task (POST /api/tasks), then the page saves it again (PATCH /api/tasks/<id>), which has no ownership check.
  async function similarApp() {
    const tasks: { id: number; owner: Who; title: string }[] = [{ id: 1, owner: "a", title: "Groceries" }];
    let next = 2;
    const view = (t: (typeof tasks)[number]) => ({ id: t.id, title: t.title });
    const script = `var t = document.getElementById('title');
function load() { return fetch('/api/tasks').then(function (r) { return r.ok ? r.json() : []; }).then(function (d) { document.getElementById('list').innerHTML = d.map(function (x) { return '<li>' + x.title + '</li>'; }).join(''); }); }
t.addEventListener('input', function () { fetch('/api/tasks/similar?q=' + encodeURIComponent(t.value)).then(function (r) { return r.json(); }).then(function (s) { document.getElementById('status').textContent = s.matches.length ? 'Similar tasks exist' : ''; }); });
document.getElementById('new').addEventListener('submit', function (e) { e.preventDefault(); var title = t.value; var json = { 'content-type': 'application/json' };
  fetch('/api/tasks', { method: 'POST', headers: json, body: JSON.stringify({ title: title }) }).then(function (r) { return r.json(); })
    .then(function (x) { return fetch('/api/tasks/' + x.id, { method: 'PATCH', headers: json, body: JSON.stringify({ title: title }) }); }).then(load); });
load();`;
    const server = await startFixtureServer({
      pages: { "/app": page(script) },
      routes: {
        "GET /api/tasks/similar": (req, res) => {
          const caller = callerOf(req);
          if (!caller) return send(res, 401, { error: "Sign in" });
          const q = new URL(req.url, "http://x").searchParams.get("q") ?? "";
          send(res, 200, { query: q, matches: q.length < 3 ? [] : tasks.filter((x) => x.owner === caller && x.title.toLowerCase().includes(q.toLowerCase().slice(0, 5))).map(view) });
        },
        "GET /api/tasks": (req, res) => {
          const caller = callerOf(req);
          if (!caller) return send(res, 401, { error: "Sign in" });
          send(res, 200, tasks.filter((x) => x.owner === caller).map(view));
        },
        "POST /api/tasks": (req, res) => {
          const caller = callerOf(req);
          if (!caller) return send(res, 401, { error: "Sign in" });
          const x = { id: next++, owner: caller, title: String(parse(req.body).title ?? "") };
          tasks.push(x);
          send(res, 201, view(x));
        },
      },
      fallback: (req, res) => {
        const m = /^\/api\/tasks\/(\d+)$/.exec(pathOf(req.url));
        const x = m ? tasks.find((y) => y.id === Number(m[1])) : undefined;
        if (!x || req.method !== "PATCH") return send(res, 404, { error: "Not found" });
        if (!callerOf(req)) return send(res, 401, { error: "Sign in" });
        // BUG (planted): no ownership check.
        const title = parse(req.body).title;
        if (typeof title === "string") x.title = title;
        send(res, 200, view(x));
      },
    });
    servers.push(server);
    return Object.assign(server, { tasks });
  }

  it("reads the record from the list after the save, not the echoed search, and finds the missing ownership check", async () => {
    const server = await similarApp();
    const result = await run(server, "other-account");
    expect(result.notes).not.toMatch(/already had|Could not be undone/);
    expect(result.status, result.notes).toBe("fail");
    expect(result.findings[0]!.title).toBe("Account B can change Account A's records");
    expect(server.tasks[0]).toEqual({ id: 1, owner: "a", title: "Groceries" });
  });
});
