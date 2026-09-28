/**
 * write-access, 0.6.0 round 3, driven through createCheckContext against small apps built in this file (sid=a-session
 * is Account A, sid=b-session Account B):
 *
 * - A tRPC edit form (httpBatchLink: POST /api/trpc/task.update?batch=1 with {"0": {"json": {id, title}}}) that
 *   renames Account A's own task t1: the save is stopped before it reaches the app, however deep the id sits.
 * - A profile form that checks the values first (POST /api/profile/check) and then saves Account A's own profile
 *   (POST /api/profile): the check going through no longer opens the gate, so the save is stopped.
 * - A queued update (202 Accepted, applied by a background job a moment later) with no ownership check: Account B's
 *   write is a finding, found by a later look, and the record is put back; never a pass with B's marker left in it.
 * - An update the app sends without a run-token field ({position: 0}) to an endpoint with no ownership check that stores
 *   only position: Account B's accepted write proves nothing, so the scenario is inconclusive, never a pass. A refusal
 *   (404) still passes.
 */
import { mkdtemp, rm } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeBrowser, getBrowser } from "../../test-support/harness.js";
import { startFixtureServer, type FixtureServer, type RecordedRequest } from "../../test-support/server.js";
import type { AccountRef, CheckResult, DiscoveredPage, Scenario } from "../core/types.js";
import type { SessionState } from "../engine/auth.js";
import { createCheckContext, type RunningCheckContext } from "../engine/context.js";
import { discoverPage } from "../engine/discover.js";
import { check } from "./write-access.js";

const A: AccountRef = { id: "a", label: "Account A" };
const B: AccountRef = { id: "b", label: "Account B" };
const RUN_TOKEN = "c3d4e5f6";

let browser: Browser;
const servers: FixtureServer[] = [];
const contexts: RunningCheckContext[] = [];
const dirs: string[] = [];
const pending: Promise<void>[] = [];

beforeAll(async () => {
  browser = await getBrowser();
});
afterEach(async () => {
  await Promise.all(pending.splice(0));
  await Promise.all(contexts.splice(0).map((c) => c.dispose()));
  await Promise.all(servers.splice(0).map((s) => s.close()));
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
afterAll(closeBrowser);

type Who = "a" | "b";

function session(who: Who): SessionState {
  return { cookies: [{ name: "sid", value: `${who}-session`, domain: "127.0.0.1", path: "/", expires: -1, httpOnly: true, secure: false, sameSite: "Lax" }], origins: [] };
}

function callerOf(req: RecordedRequest): Who | null {
  const c = String(req.headers.cookie ?? "");
  if (/(?:^|;\s*)sid=a-session\b/.test(c)) return "a";
  if (/(?:^|;\s*)sid=b-session\b/.test(c)) return "b";
  return null;
}

function send(res: ServerResponse, status: number, body?: unknown): void {
  if (body === undefined) {
    res.writeHead(status);
    res.end();
    return;
  }
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function parse(body: string): Record<string, unknown> {
  try {
    const v = JSON.parse(body) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const pathOf = (url: string) => new URL(url, "http://x").pathname;

async function run(server: FixtureServer, which: "other-account" | "signed-out" = "other-account"): Promise<CheckResult> {
  const self = session("a");
  const context = await browser.newContext({ storageState: self });
  let discovered: DiscoveredPage;
  try {
    const p = await context.newPage();
    await p.goto(`${server.url}/app`);
    await p.waitForLoadState("networkidle");
    discovered = await discoverPage(p);
  } finally {
    await context.close();
  }
  const planned = check.plan(discovered.forms[0]!, discovered, { signedIn: true, otherAccount: true }).find((s) => s.id === `write-access:${which}`);
  if (!planned) throw new Error(`no write-access:${which} scenario`);
  const dir = await mkdtemp(join(tmpdir(), "rh-wa-late-"));
  dirs.push(dir);
  const ctx = createCheckContext({
    browser,
    form: discovered.forms[0]!,
    discoveredPage: discovered,
    targetUrl: `${server.url}/app`,
    artifactsDir: dir,
    runToken: RUN_TOKEN,
    checkId: "write-access",
    sessions: { self, other: session("b") },
    accounts: { self: A, other: B },
    markers: [],
  });
  contexts.push(ctx);
  server.requests.length = 0;
  return check.run(ctx, { ...planned, scope: "form", formIndex: 0 } as Scenario);
}

const writesBy = (server: FixtureServer, who: Who | null) => server.requests.filter((r) => !["GET", "HEAD", "OPTIONS"].includes(r.method) && callerOf(r) === who);

type Task = { id: string | number; owner: Who; title: string; done: boolean; position: number };

const EDIT_FORM = `<form id="rename" aria-label="Rename task"><label for="title">Title</label><input id="title" name="title" required><button type="submit">Save</button></form>`;

describe("write-access: a tRPC edit form that renames Account A's own task", () => {
  async function trpcApp() {
    const tasks: Task[] = [
      { id: "t1", owner: "a", title: "Groceries", done: false, position: 0 },
      { id: "t2", owner: "b", title: "Reading list", done: false, position: 0 },
    ];
    const mine = (who: Who) => tasks.filter((t) => t.owner === who).map((t) => ({ id: t.id, title: t.title }));
    const server = await startFixtureServer({
      pages: {
        "/app": `<!doctype html><html lang="en"><head><title>Task</title></head><body><main><h1>Task</h1><p id="current"></p>${EDIT_FORM}</main>
<script>
var TASK_ID = null;
function load() { return fetch('/api/trpc/task.list?batch=1&input=' + encodeURIComponent(JSON.stringify({ "0": { json: null } }))).then(function (r) { return r.json(); }).then(function (d) { var t = d[0].result.data.json[0]; TASK_ID = t.id; document.getElementById('current').textContent = t.title; }); }
document.getElementById('rename').addEventListener('submit', function (e) {
  e.preventDefault();
  fetch('/api/trpc/task.update?batch=1', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ "0": { json: { id: TASK_ID, title: document.getElementById('title').value } } }) }).then(load);
});
load();
</script></body></html>`,
      },
      routes: {
        "GET /favicon.ico": (_r, res) => send(res, 204),
        "GET /api/trpc/task.list": (req, res) => {
          const who = callerOf(req);
          if (!who) return send(res, 401, [{ error: { json: { message: "UNAUTHORIZED" } } }]);
          return send(res, 200, [{ result: { data: { json: mine(who) } } }]);
        },
        "POST /api/trpc/task.update": (req, res) => {
          const who = callerOf(req);
          if (!who) return send(res, 401, [{ error: { json: { message: "UNAUTHORIZED" } } }]);
          const input = ((parse(req.body)["0"] as Record<string, unknown> | undefined)?.json ?? {}) as Record<string, unknown>;
          const t = tasks.find((x) => String(x.id) === String(input.id) && x.owner === who);
          if (!t) return send(res, 404, [{ error: { json: { message: "NOT_FOUND" } } }]);
          if (typeof input.title === "string") t.title = input.title;
          return send(res, 200, [{ result: { data: { json: { id: t.id, title: t.title } } } }]);
        },
      },
    });
    servers.push(server);
    return Object.assign(server, { tasks });
  }

  it("stops the save before it reaches the app: Account A's task t1 keeps its title, and the scenario is skipped", async () => {
    const server = await trpcApp();
    const result = await run(server);
    expect(result.status).toBe("skipped");
    expect(result.notes).toMatch(/changes a record Account A already had/);
    expect(result.notes).toMatch(/stopped the form's save \(POST \/api\/trpc\/task\.update\?batch=1\)/);
    expect(server.tasks.find((t) => t.id === "t1")!.title).toBe("Groceries");
    expect(writesBy(server, "a")).toEqual([]);
    expect(writesBy(server, "b")).toEqual([]);
  });
});

describe("write-access: a profile form that checks the values before it saves Account A's own profile", () => {
  async function profileApp() {
    const profile = { id: "u1", displayName: "Alice", bio: "Hello from Alice" };
    const server = await startFixtureServer({
      pages: {
        "/app": `<!doctype html><html lang="en"><head><title>Profile</title></head><body><main><h1>Profile</h1>
<form id="p" aria-label="Your profile"><label for="dn">Display name</label><input id="dn" name="displayName">
<label for="bio">Bio</label><textarea id="bio" name="bio"></textarea><button type="submit">Save profile</button></form><p role="status" id="status"></p></main>
<script>
fetch('/api/profile').then(function (r) { return r.json(); }).then(function (p) { document.getElementById('dn').value = p.displayName; document.getElementById('bio').value = p.bio; });
document.getElementById('p').addEventListener('submit', function (e) {
  e.preventDefault();
  var body = JSON.stringify({ displayName: document.getElementById('dn').value, bio: document.getElementById('bio').value });
  fetch('/api/profile/check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: body }).then(function (r) { return r.json(); }).then(function (v) {
    if (!v.ok) return;
    return fetch('/api/profile', { method: 'POST', headers: { 'content-type': 'application/json' }, body: body }).then(function () { document.getElementById('status').textContent = 'Profile saved'; });
  });
});
</script></body></html>`,
      },
      routes: {
        "GET /favicon.ico": (_r, res) => send(res, 204),
        "GET /api/profile": (req, res) => (callerOf(req) === "a" ? send(res, 200, profile) : send(res, 401, { error: "Sign in first" })),
        "POST /api/profile/check": (req, res) => (callerOf(req) === "a" ? send(res, 200, { ok: true }) : send(res, 401, { error: "Sign in first" })),
        "POST /api/profile": (req, res) => {
          if (callerOf(req) !== "a") return send(res, 401, { error: "Sign in first" });
          const b = parse(req.body);
          for (const k of ["displayName", "bio"] as const) if (typeof b[k] === "string") profile[k] = b[k] as string;
          return send(res, 200, profile);
        },
      },
    });
    servers.push(server);
    return Object.assign(server, { profile });
  }

  it("stops the profile save after the check went through: the profile keeps its values, and the notes say what reached the app", async () => {
    const server = await profileApp();
    const result = await run(server);
    expect(result.status).toBe("skipped");
    expect(server.profile).toEqual({ id: "u1", displayName: "Alice", bio: "Hello from Alice" });
    expect(writesBy(server, "a").map((r) => `${r.method} ${pathOf(r.url)}`)).toEqual(["POST /api/profile/check"]);
    expect(result.notes).toMatch(/stopped the form's save \(POST \/api\/profile\)/);
    expect(result.notes).toMatch(/POST \/api\/profile\/check/);
    expect(result.notes).not.toMatch(/nothing was changed/);
    expect(writesBy(server, "b")).toEqual([]);
  });
});

/**
 * A task app whose page creates a task (POST /api/tasks) and then sends its own update for it, PATCH /api/tasks/<id>
 * with `update` (built from `t`, the created task). The PATCH has no ownership check. `queued`: it answers 202 and a
 * background job applies it `delayMs` later. `ignoresTitle`: it answers 200 and stores only position (a strict schema).
 * `refuseOthers`: a caller who doesn't own the task gets 404 (a clean app).
 */
async function createThenUpdateApp(o: { update: string; queued?: boolean; ignoresTitle?: boolean; refuseOthers?: boolean; delayMs?: number }) {
  const tasks: Task[] = [
    { id: 1, owner: "a", title: "Groceries", done: false, position: 0 },
    { id: 2, owner: "b", title: "Reading list", done: false, position: 0 },
  ];
  let next = 3;
  const mine = (who: Who) => tasks.filter((t) => t.owner === who).map((t) => ({ id: t.id, title: t.title, done: t.done }));
  const server = await startFixtureServer({
    pages: {
      "/app": `<!doctype html><html lang="en"><head><title>Tasks</title></head><body><main><h1>Tasks</h1>
<form id="new" aria-label="New task"><label for="title">Title</label><input id="title" name="title" required><button type="submit">Add task</button></form><ul id="list"></ul></main>
<script>
function load() { return fetch('/api/tasks').then(function (r) { return r.ok ? r.json() : { tasks: [] }; }).then(function (d) { document.getElementById('list').innerHTML = d.tasks.map(function (t) { return '<li>' + String(t.title) + '</li>'; }).join(''); }); }
document.getElementById('new').addEventListener('submit', function (e) {
  e.preventDefault();
  fetch('/api/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: document.getElementById('title').value }) })
    .then(function (r) { return r.json(); })
    .then(function (d) { var t = d.task; return fetch('/api/tasks/' + t.id, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(${o.update}) }); })
    .then(load);
});
load();
</script></body></html>`,
    },
    routes: {
      "GET /favicon.ico": (_r, res) => send(res, 204),
      "GET /api/tasks": (req, res) => {
        const who = callerOf(req);
        return who ? send(res, 200, { tasks: mine(who) }) : send(res, 401, { error: "Sign in first" });
      },
      "POST /api/tasks": (req, res) => {
        const who = callerOf(req);
        if (!who) return send(res, 401, { error: "Sign in first" });
        const title = typeof parse(req.body).title === "string" ? String(parse(req.body).title).trim() : "";
        if (!title) return send(res, 400, { error: "Title required" });
        const t: Task = { id: next++, owner: who, title, done: false, position: 5 };
        tasks.push(t);
        return send(res, 201, { task: { id: t.id, title: t.title, done: t.done } });
      },
    },
    fallback: (req, res) => {
      const m = /^\/api\/tasks\/(\d+)$/.exec(pathOf(req.url));
      if (!m) return send(res, 404, { error: "Not found" });
      const who = callerOf(req);
      const task = tasks.find((t) => String(t.id) === m[1]);
      if (req.method === "GET") return task && task.owner === who ? send(res, 200, { task: { id: task.id, title: task.title, done: task.done } }) : send(res, 404, { error: "Not found" });
      if (req.method !== "PATCH") return send(res, 405, { error: "Method not allowed" });
      if (!task || (o.refuseOthers && task.owner !== who)) return send(res, 404, { error: "Not found" });
      const b = parse(req.body);
      const apply = () => {
        if (typeof b.position === "number") task.position = b.position;
        if (o.ignoresTitle) return;
        if (typeof b.title === "string") task.title = b.title;
        if (typeof b.done === "boolean") task.done = b.done;
      };
      if (o.queued) {
        pending.push(new Promise((resolve) => setTimeout(() => (apply(), resolve()), o.delayMs ?? 1_500)));
        return send(res, 202, { queued: true });
      }
      apply();
      return send(res, 200, { task: { id: task.id, title: task.title, done: task.done } });
    },
  });
  servers.push(server);
  return Object.assign(server, { tasks });
}

describe("write-access: an update the app applies a moment later (202 Accepted, a queued job)", () => {
  it("finds Account B's write that lands late, and puts the record back: never a pass with B's marker left in it", async () => {
    const server = await createThenUpdateApp({ update: "{ title: t.title, done: t.done }", queued: true });
    const result = await run(server);
    await Promise.all(pending.splice(0));
    const record = server.tasks.find((t) => t.id === 3)!;
    expect(writesBy(server, "b").map((r) => `${r.method} ${pathOf(r.url)}`)).toEqual(["PATCH /api/tasks/3"]);
    expect(result.status).toBe("fail");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ severity: "critical", confidence: "confirmed", title: "Account B can change Account A's records" });
    expect(result.notes).not.toMatch(/was unchanged/);
    expect(result.notes).toMatch(/a moment later/);
    // Put back: the record holds the value it was created with, not Account B's marker.
    expect(record.title).toBe(`Title ${RUN_TOKEN}wab`);
    expect(result.notes).not.toMatch(/Could not be undone/);
  }, 90_000);
});

describe("write-access: the app's own update sends no run-token field", () => {
  it("is inconclusive, never a pass, when Account B's write is accepted (200) and the record is unchanged", async () => {
    const server = await createThenUpdateApp({ update: "{ position: 0 }", ignoresTitle: true });
    const result = await run(server);
    expect(writesBy(server, "b").map((r) => `${r.method} ${pathOf(r.url)}`)).toEqual(["PATCH /api/tasks/3"]);
    expect(result.status).toBe("skipped");
    expect(result.findings).toEqual([]);
    expect(result.notes).toMatch(/^Inconclusive: /);
    expect(result.notes).toMatch(/accepted PATCH \/api\/tasks\/3 \(200\) from Account B/);
    expect(result.notes).toMatch(/isn't one the app's own update sends/);
    expect(result.notes).not.toMatch(/was unchanged after/);
  });

  it("still passes when the app refuses Account B's write (404)", async () => {
    const server = await createThenUpdateApp({ update: "{ position: 0 }", ignoresTitle: true, refuseOthers: true });
    const result = await run(server);
    expect(writesBy(server, "b").map((r) => `${r.method} ${pathOf(r.url)}`)).toEqual(["PATCH /api/tasks/3"]);
    expect(result.status).toBe("pass");
    expect(result.notes).toMatch(/unchanged after Account B sent PATCH \/api\/tasks\/3 \(404\)/);
  });
});
