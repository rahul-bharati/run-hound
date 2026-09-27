/**
 * write-access safety guarantees on the edges (docs/v2-spec.md "Safety contract" and "`write-access` amendments"). Tests
 * for an authorization check, driven through createCheckContext against a small task app built in this file (the same
 * shape as write-access.test.ts: sid=a-session is Account A, sid=b-session Account B).
 *
 * - Observed requests only: with no update or delete from the app the scenario is skipped with the contract's reason;
 *   only the methods and paths the app itself sent are ever sent; the DELETE goes last, and only when the app showed one.
 * - Never these endpoints: a sharing endpoint the app used is never replayed; a write the page sent to another site is
 *   never replayed, and every request Run Hound sends goes to the app.
 * - Distinct markers: a clean server that ignores writes and echoes the created value passes, and each scenario's marker
 *   differs from every created value and from the other scenario's marker.
 * - Restore after every attempt, a record deleted is created again, and what can't be restored is named; while such a
 *   note stands the scenario is never a pass, even with no finding.
 * - No re-read, no verdict: with no way to read the record back as Account A the scenario is skipped, sending nothing.
 * - Each request carries the scenario identity's session and nothing else; only the scenario's own record is written,
 *   and a form that edits a record Account A already had (not a new one) is skipped without a write as anyone else.
 * - The exported spec reads credentials from environment variables and holds no password or session value.
 *
 * The page's DELETE is a dry run (header x-dry-run: 1, answered without deleting), so the app has shown a DELETE for
 * the test record while the record is still there to be read back; the capture keeps no request headers, so a DELETE
 * Run Hound sends is a real one. Every run test takes its scenario from check.plan() and throws when it is missing.
 */
import { mkdtemp, rm } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeBrowser, getBrowser } from "../../test-support/harness.js";
import { startFixtureServer, type FixtureServer, type RecordedRequest } from "../../test-support/server.js";
import type { AccountRef, CheckContext, CheckResult, DiscoveredPage, Identity, Scenario } from "../core/types.js";
import type { SessionState } from "../engine/auth.js";
import { createCheckContext, type RunningCheckContext } from "../engine/context.js";
import { discoverPage } from "../engine/discover.js";
import { check } from "./write-access.js";

const A: AccountRef = { id: "a", label: "Account A" };
const B: AccountRef = { id: "b", label: "Account B" };
/** Lowercase letters and digits, so the test values Run Hound types keep it verbatim. Not the other file's token. */
const RUN_TOKEN = "wr3b8c62";
const SESSION_VALUES = { a: "a-session", b: "b-session" } as const;
/** A host that isn't the app's: the page sends its own copy of the task there, and the browser answers it (see run). */
const OTHER_SITE = "https://sync.tasks-cloud.example";
/**
 * The contract's reason when the app showed no update or delete ("The app showed no update or delete for its test
 * record, so there is nothing to try as <identity>."), also after a "Skipped: " that lowercases its first word.
 */
const NOTHING_TO_TRY = /\bthe app showed no update or delete for its test record, so there is nothing to try as /i;

type Which = "other-account" | "signed-out";

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

function session(who: "a" | "b"): SessionState {
  return {
    cookies: [{ name: "sid", value: SESSION_VALUES[who], domain: "127.0.0.1", path: "/", expires: -1, httpOnly: true, secure: false, sameSite: "Lax" }],
    origins: [],
  };
}

/** Who sent a request, by its sid cookie: Account A, Account B, or nobody. */
function callerOf(req: RecordedRequest): "a" | "b" | null {
  const cookie = String(req.headers.cookie ?? "");
  if (/(?:^|;\s*)sid=a-session\b/.test(cookie)) return "a";
  if (/(?:^|;\s*)sid=b-session\b/.test(cookie)) return "b";
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
    const value = JSON.parse(body) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const pathOf = (url: string) => new URL(url, "http://x").pathname;
const isWrite = (r: RecordedRequest) => !["GET", "HEAD", "OPTIONS"].includes(r.method);

interface Task {
  id: string;
  owner: "a" | "b";
  title: string;
  done: boolean;
  /** Set by a write the "stamps" rule refuses; the owner's writes never clear it. Shown only when set. */
  flagged?: boolean;
}

/**
 * How PATCH and DELETE /api/tasks/<id> treat a caller who doesn't own the task (the owner is always let through):
 * "stamps" refuses the write (403) and leaves the title alone, but marks the task `flagged`, a field the owner's
 * writes can't clear, so the record can't be put back as it was.
 */
type WriteRule = "owner-only" | "unguarded" | "ignored" | "stamps";

/**
 * What the page sends for the new task once its create has answered, in order: its update (PATCH), a dry-run DELETE,
 * a share with the team (POST /api/tasks/<id>/share, an endpoint no write-side check may write to), or a copy to
 * another site (a POST to OTHER_SITE naming the id).
 */
type PageSend = "patch" | "delete" | "share" | "other-site";

interface TasksAppOptions {
  writes?: WriteRule;
  /** Default ["patch"]. */
  sends?: PageSend[];
  /** Once a task has been deleted, POST /api/tasks answers 500: the record can't be created again. */
  refuseCreateAfterDelete?: boolean;
  /** The page at /app instead of tasksPage(sends). */
  page?: string;
  /** No way to read a task back: GET /api/tasks and GET /api/tasks/<id> answer 404 to everyone. */
  noReads?: boolean;
}

interface TasksApp extends FixtureServer {
  tasks: Task[];
  /** Every task created through POST /api/tasks, as it was created, in order. */
  created: Task[];
}

const PAGE_SENDS: Record<PageSend, string> = {
  patch: `.then(function () { return fetch(url, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: title, done: false }) }); })`,
  delete: `.then(function () { return fetch(url, { method: 'DELETE', headers: { 'x-dry-run': '1' } }); })`,
  share: `.then(function () { return fetch(url + '/share', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ with: 'team' }) }); })`,
  "other-site": `.then(function () { return fetch('${OTHER_SITE}/api/tasks/' + encodeURIComponent(id), { method: 'POST', mode: 'no-cors', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ title: title }) }).catch(function () {}); })`,
};

function tasksPage(sends: PageSend[]): string {
  return `<!doctype html><html lang="en"><head><title>Tasks</title></head><body><main><h1>Tasks</h1>
<form id="new" aria-label="New task"><label for="title">Title</label><input id="title" name="title" required><button type="submit">Add task</button></form>
<p role="status" id="status"></p><ul id="list"></ul></main>
<script>
var list = document.getElementById('list');
function load() {
  return fetch('/api/tasks').then(function (r) { return r.ok ? r.json() : { tasks: [] }; }).then(function (d) {
    list.innerHTML = d.tasks.map(function (t) { return '<li>' + String(t.title).replace(/</g, '&lt;') + '</li>'; }).join('');
  });
}
document.getElementById('new').addEventListener('submit', function (e) {
  e.preventDefault();
  var title = document.getElementById('title').value;
  fetch('/api/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: title }) })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      var id = d.task.id;
      var url = '/api/tasks/' + encodeURIComponent(id);
      return Promise.resolve()${sends.map((s) => PAGE_SENDS[s]).join("")};
    })
    .then(function () { document.getElementById('status').textContent = 'Saved'; return load(); });
});
load();
</script></body></html>`;
}

/** The task app. t1 is Account A's own "Groceries", t2 Account B's "Reading list"; created tasks follow in order. */
async function tasksApp(o: TasksAppOptions = {}): Promise<TasksApp> {
  const rule = o.writes ?? "owner-only";
  const tasks: Task[] = [
    { id: "t1", owner: "a", title: "Groceries", done: false },
    { id: "t2", owner: "b", title: "Reading list", done: false },
  ];
  const created: Task[] = [];
  let next = 3;
  let deletedOne = false;
  const view = (t: Task) => ({ id: t.id, title: t.title, done: t.done, ...(t.flagged ? { flagged: true } : {}) });

  const server = await startFixtureServer({
    pages: { "/app": o.page ?? tasksPage(o.sends ?? ["patch"]) },
    routes: {
      "GET /api/tasks": (req, res) => {
        if (o.noReads) return send(res, 404, { error: "Not found" });
        const caller = callerOf(req);
        if (!caller) return send(res, 401, { error: "Sign in first" });
        return send(res, 200, { tasks: tasks.filter((t) => t.owner === caller).map(view) });
      },
      "POST /api/tasks": (req, res) => {
        const caller = callerOf(req);
        if (!caller) return send(res, 401, { error: "Sign in first" });
        if (o.refuseCreateAfterDelete && deletedOne) return send(res, 500, { error: "Something went wrong" });
        const body = parse(req.body);
        const title = typeof body.title === "string" ? body.title.trim() : "";
        if (!title) return send(res, 400, { error: "Title required" });
        const task: Task = { id: `t${next++}`, owner: caller, title, done: false };
        tasks.push(task);
        created.push({ ...task });
        return send(res, 201, { task: view(task) });
      },
      "GET /favicon.ico": (_req, res) => send(res, 204),
    },
    // GET, PATCH and DELETE /api/tasks/<id>, and POST /api/tasks/<id>/share (the owner only, whatever the rule).
    fallback: (req, res) => {
      const m = /^\/api\/tasks\/([^/]+)(\/share)?$/.exec(pathOf(req.url));
      if (!m) return send(res, 404, { error: "Not found" });
      const caller = callerOf(req);
      const task = tasks.find((t) => t.id === decodeURIComponent(m[1]!));
      const owner = !!task && caller === task.owner;
      if (m[2]) {
        if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
        return owner ? send(res, 200, { shared: true }) : send(res, 404, { error: "Not found" });
      }
      if (req.method === "GET") {
        if (o.noReads) return send(res, 404, { error: "Not found" });
        if (!caller) return send(res, 401, { error: "Sign in first" });
        return owner ? send(res, 200, { task: view(task!) }) : send(res, 404, { error: "Not found" });
      }
      if (req.method !== "PATCH" && req.method !== "DELETE") return send(res, 405, { error: "Method not allowed" });
      if (!task) return send(res, 404, { error: "Not found" });
      if (rule === "owner-only" && !owner) return caller ? send(res, 404, { error: "Not found" }) : send(res, 401, { error: "Sign in first" });
      if (rule === "ignored") return send(res, 200, { ok: true, task: view(task) });
      if (rule === "stamps" && !owner) {
        task.flagged = true;
        return send(res, 403, { error: "Forbidden" });
      }
      if (req.method === "DELETE") {
        if (req.headers["x-dry-run"] === "1") return send(res, 200, { ok: true, deleted: false });
        tasks.splice(tasks.indexOf(task), 1);
        deletedOne = true;
        return send(res, 204);
      }
      const body = parse(req.body);
      if (typeof body.title === "string") task.title = body.title;
      if (typeof body.done === "boolean") task.done = body.done;
      return send(res, 200, { task: view(task) });
    },
  });
  servers.push(server);
  return Object.assign(server, { tasks, created });
}

/** Account A's tasks, read as Account A the way the app does (GET /api/tasks with A's cookie). */
async function tasksOfA(app: TasksApp): Promise<{ id: string; title: string; done: boolean }[]> {
  const answer = await fetch(`${app.url}/api/tasks`, { headers: { cookie: `sid=${SESSION_VALUES.a}` } });
  return ((await answer.json()) as { tasks: { id: string; title: string; done: boolean }[] }).tasks;
}

async function discover(app: TasksApp): Promise<DiscoveredPage> {
  const context = await browser.newContext({ storageState: session("a") });
  try {
    const page = await context.newPage();
    await page.goto(`${app.url}/app`);
    await page.getByRole("heading", { level: 1, name: "Tasks" }).waitFor();
    await page.waitForLoadState("networkidle");
    return await discoverPage(page);
  } finally {
    await context.close();
  }
}

function scenarioFor(page: DiscoveredPage, which: Which, withB: boolean): Scenario {
  const planned = check.plan(page.forms[0]!, page, { signedIn: true, otherAccount: withB }).find((s) => s.id === `write-access:${which}`);
  if (!planned) throw new Error(`write-access planned no "write-access:${which}" scenario for the New task form`);
  return { ...planned, scope: "form", formIndex: 0 };
}

interface Ran {
  result: CheckResult;
  /** The requests the app's server got during the run, in order. */
  requests: RecordedRequest[];
  /** The tasks created during the run; the first is the scenario's own test record. */
  created: Task[];
  /** Every CheckContext.request the check made, in order. */
  calls: { as: Identity; method: string; url: string }[];
  /** Every request a page of the run sent to OTHER_SITE (the browser answers them 200). */
  otherSite: string[];
}

/**
 * Runs one scenario on the task app in a fresh CheckContext. The context is watched, not changed: request() records
 * each call before sending it as usual, and every page openPage() opens answers OTHER_SITE itself (200), so a write
 * the page sends there is a 2xx write in the capture without reaching the network.
 */
async function runScenario(app: TasksApp, page: DiscoveredPage, which: Which, o: { withB?: boolean } = {}): Promise<Ran> {
  const withB = o.withB ?? true;
  const scenario = scenarioFor(page, which, withB);
  const dir = await mkdtemp(join(tmpdir(), "rh-write-access-robust-"));
  dirs.push(dir);
  const ctx = createCheckContext({
    browser,
    form: page.forms[0]!,
    discoveredPage: page,
    targetUrl: `${app.url}/app`,
    artifactsDir: dir,
    runToken: RUN_TOKEN,
    checkId: "write-access",
    sessions: withB ? { self: session("a"), other: session("b") } : { self: session("a") },
    accounts: { self: A, other: withB ? B : null },
    markers: [],
  });
  contexts.push(ctx);

  const calls: Ran["calls"] = [];
  const otherSite: string[] = [];
  const request: CheckContext["request"] = ctx.request.bind(ctx);
  ctx.request = (as, req) => {
    calls.push({ as, method: (req.method ?? "GET").toUpperCase(), url: req.url });
    return request(as, req);
  };
  const openPage: CheckContext["openPage"] = ctx.openPage.bind(ctx);
  ctx.openPage = async (options) => {
    const opened = await openPage(options);
    await opened.context.route(`${OTHER_SITE}/**`, async (route) => {
      otherSite.push(`${route.request().method()} ${route.request().url()}`);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });
    return opened;
  };

  const from = app.requests.length;
  const createdFrom = app.created.length;
  const result = await check.run(ctx, scenario);
  return { result, requests: app.requests.slice(from), created: app.created.slice(createdFrom), calls, otherSite };
}

async function startTasks(o: TasksAppOptions = {}): Promise<{ app: TasksApp; page: DiscoveredPage }> {
  const app = await tasksApp(o);
  const page = await discover(app);
  app.requests.length = 0;
  return { app, page };
}

/** The scenario's own test record: the first task created during the run (throws when the run created none). */
function ownRecord(ran: Ran): Task {
  const record = ran.created[0];
  if (!record) throw new Error(`the run created no test record: ${ran.result.status} ${ran.result.notes ?? ""}`);
  return record;
}

/** The writes the server got that Account A didn't send: the scenario identity's. */
const writesByOthers = (requests: RecordedRequest[]) => requests.filter((r) => isWrite(r) && callerOf(r) !== "a");

/** The title a PATCH set, or null. */
const titleOf = (r: RecordedRequest) => {
  const title = parse(r.body).title;
  return typeof title === "string" ? title : null;
};

/**
 * The probes of a run, told apart by what they carry rather than by their session: a PATCH that sets a title no task
 * was created with (a marker; the page's own update and a restore carry the created title), and a real DELETE (not
 * the page's dry run).
 */
function probesOf(ran: Ran, createdTitles: string[]): RecordedRequest[] {
  return ran.requests.filter((r) => {
    if (!/^\/api\/tasks\/[^/]+$/.test(pathOf(r.url))) return false;
    if (r.method === "DELETE") return r.headers["x-dry-run"] !== "1";
    if (r.method === "PATCH") {
      const title = titleOf(r);
      return title !== null && !createdTitles.includes(title);
    }
    return false;
  });
}

describe("write-access: only the requests the app itself sent", () => {
  it("skips with the contract's reason when the app showed no update or delete, and sends nothing as Account B or signed out", async () => {
    const { app, page } = await startTasks({ writes: "unguarded", sends: [] });
    for (const which of ["other-account", "signed-out"] as const) {
      const ran = await runScenario(app, page, which);
      // The test record was created first: the skip is about the writes, not about a record it couldn't save.
      expect(ran.created, `${which}: ${ran.result.notes}`).toHaveLength(1);
      expect(ran.result.status, which).toBe("skipped");
      expect(ran.result.findings).toEqual([]);
      expect(ran.result.notes, which).toMatch(NOTHING_TO_TRY);
      expect(ran.result.notes, which).toMatch(which === "other-account" ? /nothing to try as Account B\./ : /nothing to try as [^.]*signed[- ]out[^.]*\./i);
      expect(writesByOthers(ran.requests).map((r) => `${r.method} ${r.url}`), which).toEqual([]);
      expect(ran.requests.filter((r) => ["PATCH", "PUT", "DELETE"].includes(r.method))).toEqual([]);
    }
  });

  it("with only an update observed, no DELETE is ever sent, and every write sent is a method and path the app used", async () => {
    const { app, page } = await startTasks({ writes: "owner-only", sends: ["patch"] });
    for (const which of ["other-account", "signed-out"] as const) {
      const ran = await runScenario(app, page, which);
      const record = ownRecord(ran);
      expect(ran.requests.filter((r) => r.method === "DELETE"), which).toEqual([]);
      const appSent = new Set(ran.requests.filter((r) => isWrite(r) && callerOf(r) === "a").map((r) => `${r.method} ${pathOf(r.url)}`));
      const sent = writesByOthers(ran.requests).map((r) => `${r.method} ${pathOf(r.url)}`);
      expect(sent, which).toEqual([`PATCH /api/tasks/${record.id}`]);
      for (const s of sent) expect(appSent.has(s), `${which}: ${s} was never sent by the app`).toBe(true);
      expect(ran.result.status, `${which}: ${ran.result.notes}`).toBe("pass");
    }
  });

  it("with an update and a delete observed, the DELETE goes once and last, after every update", async () => {
    const { app, page } = await startTasks({ writes: "owner-only", sends: ["patch", "delete"] });
    for (const which of ["other-account", "signed-out"] as const) {
      const ran = await runScenario(app, page, which);
      const record = ownRecord(ran);
      const sent = writesByOthers(ran.requests).map((r) => `${r.method} ${pathOf(r.url)}`);
      expect(sent.filter((s) => s.startsWith("DELETE ")), which).toEqual([`DELETE /api/tasks/${record.id}`]);
      expect(sent.at(-1), which).toBe(`DELETE /api/tasks/${record.id}`);
      expect(sent.filter((s) => s.startsWith("PATCH ")).length, which).toBeGreaterThan(0);
      expect(ran.result.status, `${which}: ${ran.result.notes}`).toBe("pass");
    }
  });

  it("never replays a write to a sharing endpoint: with only that write observed, the scenario is skipped", async () => {
    const { app, page } = await startTasks({ writes: "unguarded", sends: ["share"] });
    for (const which of ["other-account", "signed-out"] as const) {
      const ran = await runScenario(app, page, which);
      const record = ownRecord(ran);
      // The app itself shared the record (so the write was there to be taken), as Account A only.
      expect(ran.requests.filter((r) => pathOf(r.url) === `/api/tasks/${record.id}/share`).map(callerOf), which).toEqual(["a"]);
      expect(writesByOthers(ran.requests).map((r) => `${r.method} ${r.url}`), which).toEqual([]);
      expect(ran.calls.filter((c) => /\/share\b/.test(c.url)), which).toEqual([]);
      expect(ran.result.status, which).toBe("skipped");
      expect(ran.result.notes, which).toMatch(/nothing to try as|never writes? to/i);
    }
  });
});

describe("write-access: allowed targets only", () => {
  it("never replays a write the page sent to another site; every request Run Hound sends goes to the app", async () => {
    const { app, page } = await startTasks({ writes: "owner-only", sends: ["patch", "other-site"] });
    for (const which of ["other-account", "signed-out"] as const) {
      const ran = await runScenario(app, page, which);
      const record = ownRecord(ran);
      // The page's own copy to the other site went out once (a 2xx write naming the id, in the capture) and never again.
      expect(ran.otherSite, which).toEqual([`POST ${OTHER_SITE}/api/tasks/${record.id}`]);
      expect(ran.calls.filter((c) => c.url.startsWith(OTHER_SITE)), which).toEqual([]);
      expect(ran.calls.length, which).toBeGreaterThan(0);
      for (const c of ran.calls) expect(new URL(c.url).origin, `${which}: ${c.method} ${c.url}`).toBe(app.url);
      expect(ran.result.status, `${which}: ${ran.result.notes}`).toBe("pass");
    }
  });
});

describe("write-access: distinct markers", () => {
  it("a clean server that ignores writes and echoes the created value passes; each marker is new, and not the other scenario's", async () => {
    const { app, page } = await startTasks({ writes: "ignored", sends: ["patch"] });
    const markers: Record<Which, string[]> = { "other-account": [], "signed-out": [] };
    for (const which of ["other-account", "signed-out"] as const) {
      const ran = await runScenario(app, page, which);
      ownRecord(ran);
      expect(ran.result.findings, `${which}: ${ran.result.notes}`).toEqual([]);
      expect(ran.result.status, `${which}: ${ran.result.notes}`).toBe("pass");
      markers[which] = writesByOthers(ran.requests)
        .filter((r) => r.method === "PATCH")
        .map(titleOf)
        .filter((t): t is string => t !== null);
      expect(markers[which].length, which).toBeGreaterThan(0);
    }
    const createdTitles = app.created.map((t) => t.title);
    for (const which of ["other-account", "signed-out"] as const) {
      for (const marker of markers[which]) {
        // A fresh run-token value...
        expect(marker.toLowerCase(), which).toContain(RUN_TOKEN);
        // ...that no record was created with, and that no created value contains.
        for (const title of createdTitles) {
          expect(marker, `${which}: marker vs created ${title}`).not.toBe(title);
          expect(title.includes(marker), `${which}: created value "${title}" contains the marker "${marker}"`).toBe(false);
          // Nor may the marker contain a created value (this scenario's or the other's): a record is found by the value
          // it holds, so a marker holding the created value would be taken for it.
          expect(marker.toLowerCase().includes(title.toLowerCase()), `${which}: marker "${marker}" contains the created value "${title}"`).toBe(false);
        }
      }
    }
    // The two scenarios' markers can't be taken for each other.
    for (const mine of markers["other-account"]) {
      for (const theirs of markers["signed-out"]) {
        expect(mine).not.toBe(theirs);
        expect(mine.includes(theirs) || theirs.includes(mine), `"${mine}" vs "${theirs}"`).toBe(false);
      }
    }
  });
});

describe("write-access: restore after every attempt", () => {
  it("puts a changed record back before the next attempt, and creates a deleted one again", async () => {
    const { app, page } = await startTasks({ writes: "unguarded", sends: ["patch", "delete"] });
    const ran = await runScenario(app, page, "signed-out");
    const record = ownRecord(ran);
    expect(ran.result.status, ran.result.notes).toBe("fail");
    expect(ran.result.notes).not.toMatch(/could not be undone/i);
    const probes = probesOf(ran, [record.title]);
    const patchAt = ran.requests.indexOf(probes.find((r) => r.method === "PATCH")!);
    const deleteAt = ran.requests.indexOf(probes.find((r) => r.method === "DELETE")!);
    expect(patchAt).toBeGreaterThanOrEqual(0);
    expect(deleteAt).toBeGreaterThan(patchAt);
    // Between the two attempts, Account A put the created title back on the record.
    const putBack = ran.requests
      .slice(patchAt + 1, deleteAt)
      .filter((r) => callerOf(r) === "a" && r.method !== "GET" && pathOf(r.url) === `/api/tasks/${record.id}` && titleOf(r) === record.title);
    expect(putBack.length).toBeGreaterThan(0);
    // After the delete, Account A has the record again (a new id is fine), with the values it was created with.
    const mine = await tasksOfA(app);
    expect(mine.filter((t) => t.title === record.title).map((t) => ({ title: t.title, done: t.done }))).toEqual([{ title: record.title, done: false }]);
  });

  it("names what couldn't be restored when the app refuses to create the deleted record again, and doesn't pass", async () => {
    const { app, page } = await startTasks({ writes: "unguarded", sends: ["patch", "delete"], refuseCreateAfterDelete: true });
    const ran = await runScenario(app, page, "signed-out");
    const record = ownRecord(ran);
    const deleteAt = ran.requests.indexOf(probesOf(ran, [record.title]).find((r) => r.method === "DELETE")!);
    expect(deleteAt).toBeGreaterThanOrEqual(0);
    // It tried: Account A sent the create again after the delete, and the app refused it.
    expect(ran.requests.slice(deleteAt + 1).some((r) => callerOf(r) === "a" && r.method === "POST" && pathOf(r.url) === "/api/tasks")).toBe(true);
    expect((await tasksOfA(app)).some((t) => t.title === record.title)).toBe(false);
    expect(ran.result.status).not.toBe("pass");
    expect(ran.result.notes).toMatch(/could not be undone/i);
    expect(ran.result.notes).toMatch(/check Account A/);
  });

  it("is never a pass while a change it couldn't undo stands, even with no finding", async () => {
    // Account B's update is refused (403) and the title stays, but the record gains a field Account A can't clear.
    const { app, page } = await startTasks({ writes: "stamps", sends: ["patch"] });
    const ran = await runScenario(app, page, "other-account");
    ownRecord(ran);
    expect(writesByOthers(ran.requests).length).toBeGreaterThan(0);
    // Whether the added field counts as a finding (then "fail") or not (then skipped or inconclusive), never a pass.
    expect(ran.result.status, ran.result.notes).not.toBe("pass");
    expect(ran.result.notes).toMatch(/could not be undone/i);
    expect(ran.result.notes).toMatch(/check Account A/);
    // The record did change, so the notes don't say it was unchanged.
    expect(ran.result.notes).not.toMatch(/\bunchanged\b/i);
  });
});

describe("write-access: no re-read, no verdict", () => {
  it("skips when the app has no way to read the record back: no verdict, nothing sent as the other identity", async () => {
    const { app, page } = await startTasks({ writes: "unguarded", sends: ["patch", "delete"], noReads: true });
    for (const which of ["other-account", "signed-out"] as const) {
      const ran = await runScenario(app, page, which);
      // The test record was saved, so the skip is about reading it back, not about a form that saved nothing.
      ownRecord(ran);
      expect(ran.result.status, `${which}: ${ran.result.notes}`).toBe("skipped");
      expect(ran.result.findings, which).toEqual([]);
      expect(writesByOthers(ran.requests).map((r) => `${r.method} ${pathOf(r.url)}`), which).toEqual([]);
    }
  });
});

describe("write-access: sessions", () => {
  it("each attempt carries the scenario identity's session and nothing else", async () => {
    const { app, page } = await startTasks({ writes: "owner-only", sends: ["patch", "delete"] });
    for (const which of ["other-account", "signed-out"] as const) {
      const ran = await runScenario(app, page, which);
      const probes = probesOf(ran, app.created.map((t) => t.title));
      expect(probes.map((r) => r.method).sort(), which).toEqual(["DELETE", "PATCH"]);
      for (const r of probes) {
        expect(r.headers.authorization, which).toBeUndefined();
        if (which === "other-account") expect(String(r.headers.cookie ?? ""), which).toMatch(/^sid=b-session$/);
        else expect(r.headers.cookie, which).toBeUndefined();
      }
    }
  });

  it("only the scenario's own test record is ever written: never Account A's or B's own tasks, never the other scenario's record", async () => {
    const { app, page } = await startTasks({ writes: "unguarded", sends: ["patch", "delete"] });
    for (const which of ["other-account", "signed-out"] as const) {
      const ran = await runScenario(app, page, which);
      const record = ownRecord(ran);
      // Each scenario really tried (and got through), so the checks below aren't passed by writing nothing.
      expect(ran.result.status, `${which}: ${ran.result.notes}`).toBe("fail");
      expect(writesByOthers(ran.requests).length, which).toBeGreaterThan(0);
      // Attempts go to this scenario's record only; Account A's writes to it, or to the list to create it again.
      for (const r of writesByOthers(ran.requests)) expect(pathOf(r.url), `${which}: ${r.method}`).toBe(`/api/tasks/${record.id}`);
      const ownIds = new Set(ran.created.map((t) => t.id));
      for (const r of ran.requests.filter(isWrite)) {
        const path = pathOf(r.url);
        const id = /^\/api\/tasks\/([^/]+)/.exec(path)?.[1];
        expect(path === "/api/tasks" || (id !== undefined && ownIds.has(id)), `${which}: ${r.method} ${path}`).toBe(true);
      }
    }
    expect(app.requests.filter((r) => isWrite(r) && /^\/api\/tasks\/t[12](\/|$)/.test(pathOf(r.url)))).toEqual([]);
    expect(app.tasks.find((t) => t.id === "t1")).toEqual({ id: "t1", owner: "a", title: "Groceries", done: false });
    expect(app.tasks.find((t) => t.id === "t2")).toEqual({ id: "t2", owner: "b", title: "Reading list", done: false });
  });
});

/** A form that renames Account A's own existing task t1 (PATCH /api/tasks/t1), then reloads the list: it creates nothing. */
const EDIT_PAGE = `<!doctype html><html lang="en"><head><title>Tasks</title></head><body><main><h1>Tasks</h1>
<form id="rename" aria-label="Rename task"><label for="title">Title</label><input id="title" name="title" required><button type="submit">Save</button></form>
<ul id="list"></ul></main><script>
function load() { return fetch('/api/tasks').then(function (r) { return r.json(); }).then(function (d) { document.getElementById('list').innerHTML = d.tasks.map(function (t) { return '<li>' + String(t.title).replace(/</g, '&lt;') + '</li>'; }).join(''); }); }
document.getElementById('rename').addEventListener('submit', function (e) { e.preventDefault(); fetch('/api/tasks/t1', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: document.getElementById('title').value }) }).then(load); });
load();
</script></body></html>`;

describe("write-access: a record Account A already had", () => {
  it("never writes to a record Account A already had: a form that edits one is skipped, nothing is sent as the other identity", async () => {
    const { app, page } = await startTasks({ writes: "unguarded", page: EDIT_PAGE });
    for (const which of ["other-account", "signed-out"] as const) {
      const ran = await runScenario(app, page, which);
      expect(writesByOthers(ran.requests).map((r) => `${r.method} ${pathOf(r.url)}`), which).toEqual([]);
      expect(ran.calls.filter((c) => c.as !== "self" && c.method !== "GET"), which).toEqual([]);
      expect(ran.result.findings, which).toEqual([]);
      expect(ran.result.status, `${which}: ${ran.result.notes}`).toBe("skipped");
    }
  });
});

/** Test passwords set in the environment while the check runs, so a spec that copied them in would be caught. */
const PASSWORDS = { A: "Alpha-pass-7141!", B: "Bravo-pass-2718!" } as const;

/**
 * True when `source` reads an account password from the environment: a literal name, a name built from the slot, or a
 * constant holding the literal name (`const PASSWORD_VAR = "RUNHOUND_ACCOUNT_B_PASSWORD"` ... `process.env[PASSWORD_VAR]`).
 */
function readsPasswordFromEnv(source: string): boolean {
  return [
    /process\.env\.RUNHOUND_ACCOUNT_[AB]_PASSWORD\b/,
    /process\.env\[\s*(["'`])RUNHOUND_ACCOUNT_[AB]_PASSWORD\1\s*\]/,
    /process\.env\[\s*(["'`])RUNHOUND_ACCOUNT_\1\s*\+\s*[\w.]+\s*\+\s*(["'`])_PASSWORD\2\s*\]/,
    /process\.env\[\s*`RUNHOUND_ACCOUNT_\$\{\s*[\w.]+\s*\}_PASSWORD`\s*\]/,
    /\b(\w+)\s*=\s*(["'`])RUNHOUND_ACCOUNT_[AB]_PASSWORD\2[\s\S]*process\.env\[\s*\1\s*\]/,
  ].some((re) => re.test(source));
}

/**
 * A string literal assigned to a password (`password: "..."`, `const PASSWORD = '...'`), unless the literal is an
 * environment variable's name (`"RUNHOUND_..."`) or reads one (`` `${process.env....}` ``).
 */
const TYPED_PASSWORD = /password\w*["']?\s*[:=]\s*(["'`])(?!RUNHOUND_|\$\{\s*process\.env)/i;

/** `source` without its block and line comments (a "//" inside a URL such as "http://" is kept). */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

describe("write-access: the exported spec", () => {
  it("reads credentials from environment variables and holds no password or session value", async () => {
    const saved = { ...process.env };
    process.env.RUNHOUND_ACCOUNT_A_PASSWORD = PASSWORDS.A;
    process.env.RUNHOUND_ACCOUNT_B_PASSWORD = PASSWORDS.B;
    try {
      const { app, page } = await startTasks({ writes: "unguarded", sends: ["patch", "delete"] });
      for (const which of ["other-account", "signed-out"] as const) {
        const ran = await runScenario(app, page, which);
        expect(ran.result.status, `${which}: ${ran.result.notes}`).toBe("fail");
        expect(ran.result.findings.length, which).toBeGreaterThan(0);
        const whole = JSON.stringify(ran.result);
        for (const secret of [SESSION_VALUES.a, SESSION_VALUES.b, PASSWORDS.A, PASSWORDS.B]) expect(whole, which).not.toContain(secret);
        for (const f of ran.result.findings) {
          const spec = f.spec;
          expect(spec, `${which}: ${f.title}`).toBeDefined();
          expect(spec!.filename).toMatch(/\.spec\.ts$/);
          expect(spec!.source).toContain("@playwright/test");
          // No typed credential and no session: no string literal assigned to a password (comments aside, where a usage
          // line may name the variable), no saved storage-state file, no session value.
          expect(withoutComments(spec!.source)).not.toMatch(TYPED_PASSWORD);
          expect(spec!.source).not.toMatch(/storageState\s*:\s*["'`]/);
          expect(spec!.source).not.toMatch(/sid=|a-session|b-session/);
          // Account B signs in in its own spec, with the password from the environment.
          if (which === "other-account") expect(readsPasswordFromEnv(spec!.source), spec!.source).toBe(true);
        }
      }
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
      Object.assign(process.env, saved);
    }
  });
});
