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
 * - Another of Account A's records that shares the test record's id (numeric ids, another table) is never written as
 *   anyone else: not the page's PATCH of it, not its DELETE, not a write naming the id in its query string, not one
 *   that carries the new record's title in its body (a note's text, a list's items) or gets it back in its answer
 *   (its title, or the whole new record beside the note), not one that copies the new record's title into it verbatim
 *   under the same key (JSON or form-encoded, at /api/notes/3 or /api/notes?id=3, answered {ok: true} or with the
 *   note), and not a create into it named by a foreign-key query (?listId=3). Nor when the page reads the new record in
 *   a list that names Account A's list by the same id (GET /api/tasks?listId=3, GET /api/lists/3): the list's own
 *   reorder (PUT /api/tasks?listId=3, PATCH /api/lists/3) and a copy into it (POST /api/tasks?listId=3) stay Account
 *   A's.
 * - An update whose body holds the record one level down ({"task": {...}}) gets its marker there, where the app reads
 *   it: an unguarded one is a finding, and the exported spec sends the same shape.
 * - The app's update at another path than its save and its read (POST /api/tasks/create, PATCH /api/task/<id>) is still
 *   found, by the record in its body or its answer and a read of its URL as Account A that is the whole record
 *   (GET /api/task/<id>), and sent.
 * - A refused write that changes another field of the record, which the put-back undoes, is inconclusive: never a pass.
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
 * writes can't clear, so the record can't be put back as it was. "flags" does the same, but every task shows
 * `flagged` (false until then) and the owner's own update sets it, so the put-back can undo it.
 */
type WriteRule = "owner-only" | "unguarded" | "ignored" | "stamps" | "flags";

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
  /** The page at /app instead of tasksPage(sends, nested). */
  page?: string;
  /** No way to read a task back: GET /api/tasks and GET /api/tasks/<id> answer 404 to everyone. */
  noReads?: boolean;
  /**
   * The app's bodies hold the task one level down: the page creates with {"task": {title}} and updates with
   * {"task": {title, done}}, and the server reads the task's fields from body.task only (a top-level title is ignored).
   */
  nested?: boolean;
  /**
   * A field the app sets itself on every save and shows on every task: "rowVersion" (1, 2, 3 …, optimistic locking) or
   * "updateTime" (a new timestamp). A create and every PATCH the app takes move it, the put-back's included.
   */
  stamp?: "rowVersion" | "updateTime";
  /** POST /api/tasks/<id> updates the task as PATCH does (an app whose update is a POST to the record's own URL). */
  postUpdates?: boolean;
}

interface TasksApp extends FixtureServer {
  tasks: Task[];
  /** Every task created through POST /api/tasks, as it was created, in order. */
  created: Task[];
}

/** The JSON body the page sends for `fields` (a JS object literal): as is, or one level down under "task" when nested. */
const bodyOf = (fields: string, nested: boolean) => (nested ? `JSON.stringify({ task: ${fields} })` : `JSON.stringify(${fields})`);

/** What the page sends for each PageSend, its update's body nested under "task" when `nested`. */
const pageSends = (nested: boolean): Record<PageSend, string> => ({
  patch: `.then(function () { return fetch(url, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: ${bodyOf("{ title: title, done: false }", nested)} }); })`,
  delete: `.then(function () { return fetch(url, { method: 'DELETE', headers: { 'x-dry-run': '1' } }); })`,
  share: `.then(function () { return fetch(url + '/share', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ with: 'team' }) }); })`,
  "other-site": `.then(function () { return fetch('${OTHER_SITE}/api/tasks/' + encodeURIComponent(id), { method: 'POST', mode: 'no-cors', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ title: title }) }).catch(function () {}); })`,
});

function tasksPage(sends: PageSend[], nested = false): string {
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
  fetch('/api/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: ${bodyOf("{ title: title }", nested)} })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      var id = d.task.id;
      var url = '/api/tasks/' + encodeURIComponent(id);
      return Promise.resolve()${sends.map((s) => pageSends(nested)[s]).join("")};
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
  /** The task's fields in a request body: the body itself, or its "task" object when the app nests it. */
  const fieldsOf = (raw: string): Record<string, unknown> => {
    const body = parse(raw);
    if (!o.nested) return body;
    const task = body.task;
    return task && typeof task === "object" && !Array.isArray(task) ? (task as Record<string, unknown>) : {};
  };
  /** How many times each task was saved, by id (the `stamp` option shows it; kept off the Task, which tests compare). */
  const saves = new Map<string, number>();
  const savesOf = (t: Task) => saves.get(t.id) ?? 1;
  const stampOf = (t: Task) =>
    o.stamp === "rowVersion" ? { rowVersion: savesOf(t) } : o.stamp === "updateTime" ? { updateTime: new Date(Date.UTC(2026, 8, 27, 12, 0, savesOf(t))).toISOString() } : {};
  const view = (t: Task) => ({
    id: t.id,
    title: t.title,
    done: t.done,
    ...(rule === "flags" ? { flagged: t.flagged === true } : t.flagged ? { flagged: true } : {}),
    ...stampOf(t),
  });

  const server = await startFixtureServer({
    pages: { "/app": o.page ?? tasksPage(o.sends ?? ["patch"], o.nested) },
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
        const body = fieldsOf(req.body);
        const title = typeof body.title === "string" ? body.title.trim() : "";
        if (!title) return send(res, 400, { error: "Title required" });
        const task: Task = { id: `t${next++}`, owner: caller, title, done: false };
        saves.set(task.id, 1);
        tasks.push(task);
        created.push({ ...task });
        return send(res, 201, { task: view(task) });
      },
      // "Today's focus" (todayPage): renames the caller's first task, a record the caller already had; the URL and the
      // body name no record.
      "POST /api/today": (req, res) => {
        const caller = callerOf(req);
        if (!caller) return send(res, 401, { error: "Sign in first" });
        const task = tasks.find((t) => t.owner === caller);
        const title = parse(req.body).title;
        if (!task || typeof title !== "string" || !title.trim()) return send(res, 400, { error: "Title required" });
        task.title = title;
        return send(res, 200, { ok: true });
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
      if (req.method !== "PATCH" && req.method !== "DELETE" && !(o.postUpdates && req.method === "POST")) return send(res, 405, { error: "Method not allowed" });
      if (!task) return send(res, 404, { error: "Not found" });
      if (rule === "owner-only" && !owner) return caller ? send(res, 404, { error: "Not found" }) : send(res, 401, { error: "Sign in first" });
      if (rule === "ignored") return send(res, 200, { ok: true, task: view(task) });
      if ((rule === "stamps" || rule === "flags") && !owner) {
        task.flagged = true;
        return send(res, 403, { error: "Forbidden" });
      }
      if (req.method === "DELETE") {
        if (req.headers["x-dry-run"] === "1") return send(res, 200, { ok: true, deleted: false });
        tasks.splice(tasks.indexOf(task), 1);
        deletedOne = true;
        return send(res, 204);
      }
      const body = fieldsOf(req.body);
      if (typeof body.title === "string") task.title = body.title;
      if (typeof body.done === "boolean") task.done = body.done;
      if (rule === "flags" && typeof body.flagged === "boolean") task.flagged = body.flagged;
      saves.set(task.id, savesOf(task) + 1);
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

async function discover(app: Pick<TasksApp, "url">): Promise<DiscoveredPage> {
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
async function runScenario(app: Pick<TasksApp, "url" | "requests" | "created">, page: DiscoveredPage, which: Which, o: { withB?: boolean } = {}): Promise<Ran> {
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

  it("a refused write that changes another field, which the put-back undoes, is inconclusive: never a pass, never 'unchanged'", async () => {
    // Account B's update is refused (403) and the title stays, but the record's `flagged` turns true; Account A's own
    // update can set it back, so the put-back leaves the record as it was.
    const { app, page } = await startTasks({ writes: "flags", sends: ["patch"] });
    const ran = await runScenario(app, page, "other-account");
    const record = ownRecord(ran);
    expect(writesByOthers(ran.requests).map(callerOf)).toEqual(["b"]);
    expect(ran.result.status, ran.result.notes).toBe("skipped");
    expect(ran.result.findings).toEqual([]);
    expect(ran.result.notes).toMatch(/^Inconclusive\b/);
    expect(ran.result.notes).toMatch(/\bflagged\b/);
    expect(ran.result.notes).toMatch(/check Account A/);
    expect(ran.result.notes).not.toMatch(/\bunchanged\b/i);
    expect(ran.result.notes).not.toMatch(/could not be undone/i);
    // Put back: the record reads as it was created, not flagged.
    expect(app.tasks.find((t) => t.id === record.id)).toEqual({ id: record.id, owner: "a", title: record.title, done: false, flagged: false });
  });
});

describe("write-access: a field the app sets itself on every save", () => {
  for (const stamp of ["rowVersion", "updateTime"] as const) {
    it(`an unguarded PATCH and DELETE are both findings when ${stamp} moves with every save: the put-back names ${stamp} as the app's own, never "could not be undone"`, async () => {
      const { app, page } = await startTasks({ writes: "unguarded", sends: ["patch", "delete"], stamp });
      const ran = await runScenario(app, page, "other-account");
      const notes = ran.result.notes ?? "";
      expect(ran.result.status, notes).toBe("fail");
      const titles = ran.result.findings.map((f) => f.title).join("\n");
      expect(ran.result.findings, notes).toHaveLength(2);
      expect(titles).toMatch(/Account B can change Account A's records/);
      expect(titles).toMatch(/Account B can delete Account A's records/);
      // The put-back is a save too: the stamp moves again, and that's the app's doing, not a change left behind.
      expect(notes).not.toMatch(/Could not be undone/);
      expect(notes).not.toMatch(/Not tried after a change that couldn't be undone/);
      expect(notes).toContain(`back to its values except ${stamp}, which the app sets itself`);
      // The DELETE went too, after the PATCH.
      const created = [...app.created.map((t) => t.title)];
      const probes = probesOf(ran, created);
      expect(probes.map((r) => r.method)).toEqual(["PATCH", "DELETE"]);
    }, 90_000);
  }
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

/** EDIT_PAGE, with the rename sent as a POST to the task's own URL (POST /api/tasks/t1): an app whose update is a POST. */
const EDIT_PAGE_POST = EDIT_PAGE.replace("method: 'PATCH'", "method: 'POST'");

/**
 * A "Today's focus" form that renames Account A's first task, t1, through POST /api/today {title}: its URL and its body
 * name no record, so only the re-read after the save shows that it changed a record Account A already had. With
 * `resave`, the page then saves t1 again through the app's own update (PATCH /api/tasks/t1 {title, done}), as Fernway's
 * Quick add does after its create.
 */
function todayPage(resave: boolean): string {
  const then = resave
    ? `.then(function () { return fetch('/api/tasks/t1', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: title, done: false }) }); })`
    : "";
  return `<!doctype html><html lang="en"><head><title>Tasks</title></head><body><main><h1>Tasks</h1>
<form id="today" aria-label="Today's focus"><label for="title">Title</label><input id="title" name="title" required><button type="submit">Set focus</button></form>
<ul id="list"></ul></main><script>
function load() { return fetch('/api/tasks').then(function (r) { return r.json(); }).then(function (d) { document.getElementById('list').innerHTML = d.tasks.map(function (t) { return '<li>' + String(t.title).replace(/</g, '&lt;') + '</li>'; }).join(''); }); }
document.getElementById('today').addEventListener('submit', function (e) { e.preventDefault(); var title = document.getElementById('title').value; fetch('/api/today', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: title }) })${then}.then(load); });
load();
</script></body></html>`;
}

const T1 = { id: "t1", owner: "a", title: "Groceries", done: false };
/** Every write the app's server got for Account A's own t1, whoever sent it. */
const writesToT1 = (requests: RecordedRequest[]) => requests.filter((r) => isWrite(r) && /^\/api\/tasks\/t1(\/|$)/.test(pathOf(r.url)));

describe("write-access: a record Account A already had", () => {
  it("never writes to a record Account A already had: a form that edits one is skipped, nothing is sent as the other identity", async () => {
    const { app, page } = await startTasks({ writes: "unguarded", page: EDIT_PAGE });
    for (const which of ["other-account", "signed-out"] as const) {
      const ran = await runScenario(app, page, which);
      expect(writesByOthers(ran.requests).map((r) => `${r.method} ${pathOf(r.url)}`), which).toEqual([]);
      expect(ran.calls.filter((c) => c.as !== "self" && c.method !== "GET"), which).toEqual([]);
      expect(ran.result.findings, which).toEqual([]);
      expect(ran.result.status, `${which}: ${ran.result.notes}`).toBe("skipped");
      // Not even Account A's own form save reaches t1: Run Hound stops it before it leaves the page, so t1 still reads
      // as it did, and the note that says so is true.
      expect(writesToT1(ran.requests).map((r) => `${r.method} ${pathOf(r.url)} as ${callerOf(r) ?? "nobody"}`), which).toEqual([]);
      expect(app.tasks.find((t) => t.id === "t1"), which).toEqual(T1);
      expect(ran.result.notes, which).toMatch(/changes a record Account A already had/);
      expect(ran.result.notes, which).toMatch(/stopped the form's save \(PATCH \/api\/tasks\/t1\) before it reached the app/);
    }
  });

  it("stops the form's own save when it is a POST to the URL of a record Account A already had (POST /api/tasks/t1)", async () => {
    const { app, page } = await startTasks({ writes: "unguarded", page: EDIT_PAGE_POST, postUpdates: true });
    for (const which of ["other-account", "signed-out"] as const) {
      const ran = await runScenario(app, page, which);
      expect(ran.result.status, `${which}: ${ran.result.notes}`).toBe("skipped");
      expect(ran.result.findings, which).toEqual([]);
      expect(writesToT1(ran.requests).map((r) => `${r.method} ${pathOf(r.url)} as ${callerOf(r) ?? "nobody"}`), which).toEqual([]);
      expect(app.tasks.find((t) => t.id === "t1"), which).toEqual(T1);
      expect(ran.result.notes, which).toMatch(/changes a record Account A already had/);
      expect(ran.result.notes, which).toMatch(/stopped the form's save \(POST \/api\/tasks\/t1\) before it reached the app/);
    }
  });

  it("puts back a record Account A already had that the form's own save changed, through the app's own update for it", async () => {
    const { app, page } = await startTasks({ writes: "unguarded", page: todayPage(true) });
    for (const which of ["other-account", "signed-out"] as const) {
      const ran = await runScenario(app, page, which);
      expect(ran.result.status, `${which}: ${ran.result.notes}`).toBe("skipped");
      expect(ran.result.findings, which).toEqual([]);
      expect(writesByOthers(ran.requests).map((r) => `${r.method} ${pathOf(r.url)}`), which).toEqual([]);
      expect(ran.calls.filter((c) => c.as !== "self" && c.method !== "GET"), which).toEqual([]);
      // Put back as the page read it before the save.
      expect(app.tasks.find((t) => t.id === "t1"), `${which}: ${ran.result.notes}`).toEqual(T1);
      expect(ran.result.notes, which).toMatch(/changes a record Account A already had/);
      expect(ran.result.notes, which).toMatch(/POST \/api\/today/);
      expect(ran.result.notes, which).toMatch(/put back title/i);
      // The form's own save did write: no note may claim nothing was.
      expect(ran.result.notes, which).not.toMatch(/nothing was (changed|written|sent)|stopped the form's save/i);
    }
  });

  it("says a record Account A already had was changed by the form's own save, and to check Account A, when it can't be put back", async () => {
    const { app, page } = await startTasks({ writes: "unguarded", page: todayPage(false) });
    const ran = await runScenario(app, page, "signed-out");
    expect(ran.result.status, ran.result.notes).toBe("skipped");
    expect(ran.result.findings).toEqual([]);
    expect(writesByOthers(ran.requests)).toEqual([]);
    expect(ran.result.notes).toMatch(/changes a record Account A already had/);
    expect(ran.result.notes).toMatch(/Could not be undone: the form's own save \(POST \/api\/today\) changed title of that record[\s\S]*check Account A/);
    expect(ran.result.notes).not.toMatch(/nothing was (changed|written|sent)|stopped the form's save/i);
  });
});

/**
 * What the shared-id page sends for Account A's note 3 (or list 3), which has the same id as the first task the run
 * creates: "patch" marks the note seen on every load (PATCH /api/notes/3), "patch+delete" then dismisses it with a
 * dry-run DELETE, and "query" instead, after each create, logs POST /api/activity?count=<the new task's id>. The others
 * write to another of Account A's records after each create, carrying the new task's title or answered with it:
 * "titled-note" sets the note's text to "Latest task: <title>" (PATCH /api/notes/3), "list-items" adds the task to
 * Account A's list 3 (PATCH /api/lists/3 {name, items: [{title}]}), "answer-title" marks the note seen and the answer
 * names the latest task's title ({note: {id: 3, ..., latest}}), and "copy-to-list" copies the task into list 3
 * (POST /api/tasks?listId=3 {title}). The same-title modes copy the new task's title into the note verbatim, under the
 * task's own key (the note then has {id: 3, ..., title}, the test record's id and its run-token field with its value):
 * "same-title-note" sends PATCH /api/notes/3 {title} and is answered {ok: true}, "same-title-answer" the same answered
 * with the note ({note: {id: 3, ..., title}}), "same-title-form" sends the title form-encoded (title=...) and is
 * answered {ok: true}, and "same-title-query" sends PATCH /api/notes?id=3 {title} and is answered with the note. Account
 * A can read the note back (GET /api/notes/3, GET /api/notes?id=3: {note: {...}}). "answer-task" marks the note seen
 * and the note's answers (the PATCH's and a GET's) hold, beside the note, Account A's latest task in full ({note: {id:
 * 3, ...}, latest: {id: 3, title, done}}): the whole test record one level down, but beside another record with an id
 * of its own. "answer-task-only" marks the note seen and is answered with the latest task alone ({task: {id: 3, title,
 * done}}), while a GET of the note answers the note.
 *
 * The list-read modes read the new task in Account A's list 3 (its id only in a data- attribute) and create it there
 * (POST /api/tasks {title, listId: 3}), so the record read's URL names list 3 by the new task's id: "by-list-reorder"
 * reads GET /api/tasks?listId=3 and then reorders the list (PUT /api/tasks?listId=3 {order: [id]}), "by-list-copy"
 * reads the same and copies the task into the list again (POST /api/tasks?listId=3 {title}), and "list-path-reorder"
 * reads GET /api/lists/3 (answered {name, tasks}, no list id) and then reorders it (PATCH /api/lists/3 {name, order}).
 */
type SharedIdMode =
  | "patch"
  | "patch+delete"
  | "query"
  | "titled-note"
  | "list-items"
  | "answer-title"
  | "copy-to-list"
  | "same-title-note"
  | "same-title-answer"
  | "same-title-form"
  | "same-title-query"
  | "answer-task"
  | "answer-task-only"
  | "by-list-reorder"
  | "by-list-copy"
  | "list-path-reorder";

/** The modes whose page copies the new task's title verbatim into Account A's note 3, under the task's own key. */
const SAME_TITLE_MODES: readonly SharedIdMode[] = ["same-title-note", "same-title-answer", "same-title-form", "same-title-query"];
const copiesTitle = (mode: SharedIdMode) => SAME_TITLE_MODES.includes(mode);

/** The list-read modes: the page reads and creates its tasks in Account A's list 3. */
const LIST_READ_MODES: readonly SharedIdMode[] = ["by-list-reorder", "by-list-copy", "list-path-reorder"];
const readsByList = (mode: SharedIdMode) => LIST_READ_MODES.includes(mode);

/** The page's write after each create, per mode (none for "patch" and "patch+delete": theirs go on load). */
const SHARED_ID_AFTER_CREATE: Record<SharedIdMode, string> = {
  patch: "",
  "patch+delete": "",
  query: `fetch('/api/activity?count=' + d.task.id, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'task-added' }) })`,
  "titled-note": `fetch('/api/notes/3', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Latest task: ' + title }) })`,
  "list-items": `fetch('/api/lists/3', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Home', items: [{ title: title }] }) })`,
  "answer-title": `fetch('/api/notes/3', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ seen: true }) })`,
  "copy-to-list": `fetch('/api/tasks?listId=3', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: title }) })`,
  "same-title-note": `fetch('/api/notes/3', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: title }) })`,
  "same-title-answer": `fetch('/api/notes/3', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: title }) })`,
  "same-title-form": `fetch('/api/notes/3', { method: 'PATCH', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ title: title }).toString() })`,
  "same-title-query": `fetch('/api/notes?id=3', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: title }) })`,
  "answer-task": `fetch('/api/notes/3', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ seen: true }) })`,
  "answer-task-only": `fetch('/api/notes/3', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ seen: true }) })`,
  "by-list-reorder": `fetch('/api/tasks?listId=' + listId, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ order: [d.task.id] }) })`,
  "by-list-copy": `fetch('/api/tasks?listId=' + listId, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: title }) })`,
  "list-path-reorder": `fetch('/api/lists/' + listId, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Home', order: [d.task.id] }) })`,
};

/**
 * The shared-id page: Account A's note 3 is server-rendered (its id only in a data- attribute, never in a JSON read);
 * the "New task" form creates a task (numeric ids) and PATCHes it; the note's writes follow `mode` (SharedIdMode).
 */
function sharedIdPage(mode: SharedIdMode): string {
  const onLoad =
    mode === "patch" || mode === "patch+delete"
      ? `fetch('/api/notes/3', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ seen: true }) })${
          mode === "patch+delete" ? `.then(function () { return fetch('/api/notes/3', { method: 'DELETE', headers: { 'x-dry-run': '1' } }); })` : ""
        };`
      : "";
  const afterCreate = SHARED_ID_AFTER_CREATE[mode] ? `.then(function () { return ${SHARED_ID_AFTER_CREATE[mode]}; })` : "";
  const byList = readsByList(mode);
  // The list-read modes read the tasks in Account A's list 3, by a query (?listId=3) or at the list's own path.
  const read = !byList ? "'/api/tasks'" : mode === "list-path-reorder" ? "'/api/lists/' + listId" : "'/api/tasks?listId=' + listId";
  return `<!doctype html><html lang="en"><head><title>Tasks</title></head><body><main><h1>Tasks</h1>
<ul id="notes"><li data-note="3">Call the plumber</li></ul>${byList ? `\n<section id="list-meta" data-list="3"></section>` : ""}
<form id="new" aria-label="New task"><label for="title">Title</label><input id="title" name="title" required><button type="submit">Add task</button></form><ul id="list"></ul></main>
<script>
var listMeta = document.getElementById('list-meta');
var listId = listMeta ? Number(listMeta.getAttribute('data-list')) : null;
function load() { return fetch(${read}).then(function (r) { return r.ok ? r.json() : { tasks: [] }; }).then(function (d) { document.getElementById('list').innerHTML = d.tasks.map(function (t) { return '<li>' + String(t.title).replace(/</g, '&lt;') + '</li>'; }).join(''); }); }
document.getElementById('new').addEventListener('submit', function (e) {
  e.preventDefault();
  var title = document.getElementById('title').value;
  fetch('/api/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(${byList ? "{ title: title, listId: listId }" : "{ title: title }"}) })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      return fetch('/api/tasks/' + d.task.id, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: title, done: false }) })${afterCreate};
    })
    .then(load);
});
${onLoad}
load();
</script></body></html>`;
}

interface Note {
  id: number;
  owner: "a";
  text: string;
  seen: boolean;
  /** Set only by the same-title modes: the new task's title, copied in verbatim. */
  title?: string;
}

interface TaskList {
  id: number;
  owner: "a";
  name: string;
  items: { title: string }[];
  /** The list's task order, set by a reorder (PUT /api/tasks?listId=3, PATCH /api/lists/3). */
  order?: number[];
}

interface SharedIdApp extends FixtureServer {
  /** Every task created through POST /api/tasks, as it was created (its numeric id as text). */
  created: Task[];
  /** Account A's notes: note 3 shares its id with the first task the run creates. */
  notes: Note[];
  /** Account A's lists: list 3 shares its id with the first task the run creates. */
  lists: TaskList[];
  /** Every POST /api/activity: "<caller> <url> <body>", the caller "a", "b" or "nobody". */
  activity: string[];
  /** Every POST /api/tasks?listId=<n> (a create into a list): "<caller> <url> <body>". */
  intoList: string[];
  /** Every PUT /api/tasks?listId=<n> (a list's reorder): "<caller> <url> <body>". */
  reorders: string[];
}

/**
 * The shared-id app. Tasks have numeric ids and check their owner (Account A's 1, Account B's 2; the run's first is 3).
 * Notes and lists (other tables, Account A's note 3 and list 3) check nothing: a write to one lands, whoever sends it,
 * and every field it sends (JSON or form-encoded) is stored, so a write sent there as anyone but Account A would change
 * Account A's data. A note is at /api/notes/<id> and at /api/notes?id=<id>; its owner can read it (GET). A
 * create into a list (POST /api/tasks?listId=3) and a list's reorder (PUT /api/tasks?listId=3) don't check that the
 * list is the caller's either. A list's read (GET /api/lists/3) is its owner's only, and names its tasks, not its id.
 * In the list-read modes Account A's task 1 is in list 3, and a task's answer names its list.
 */
async function sharedIdApp(mode: SharedIdMode): Promise<SharedIdApp> {
  const tasks: { id: number; owner: "a" | "b"; title: string; done: boolean; listId?: number }[] = [
    { id: 1, owner: "a", title: "Groceries", done: false, ...(readsByList(mode) ? { listId: 3 } : {}) },
    { id: 2, owner: "b", title: "Reading list", done: false },
  ];
  const created: Task[] = [];
  const notes: Note[] = [{ id: 3, owner: "a", text: "Call the plumber", seen: false }];
  const lists: TaskList[] = [{ id: 3, owner: "a", name: "Home", items: [] }];
  const activity: string[] = [];
  const intoList: string[] = [];
  const reorders: string[] = [];
  /** The title of the last task Account A created: "answer-title" names it in the note's answer. */
  let latest = "";
  /** The last task Account A created: "answer-task" holds it in full in the note's answer. */
  let latestTask: (typeof tasks)[number] | undefined;
  let next = 3;
  const view = (t: (typeof tasks)[number]) => ({ id: t.id, title: t.title, done: t.done, ...(t.listId !== undefined ? { listId: t.listId } : {}) });
  const listOf = (url: string) => new URL(url, "http://x").searchParams.get("listId");
  const server = await startFixtureServer({
    pages: { "/app": sharedIdPage(mode) },
    routes: {
      "GET /api/tasks": (req, res) => {
        const caller = callerOf(req);
        if (!caller) return send(res, 401, { error: "Sign in first" });
        const inList = listOf(req.url);
        return send(res, 200, { tasks: tasks.filter((t) => t.owner === caller && (inList === null || t.listId === Number(inList))).map(view) });
      },
      "POST /api/tasks": (req, res) => {
        const caller = callerOf(req);
        if (!caller) return send(res, 401, { error: "Sign in first" });
        const title = typeof parse(req.body).title === "string" ? String(parse(req.body).title).trim() : "";
        if (!title) return send(res, 400, { error: "Title required" });
        const intoListId = listOf(req.url);
        if (intoListId !== null) intoList.push(`${caller} ${req.url} ${req.body}`);
        const bodyList = parse(req.body).listId;
        const listId = intoListId !== null ? Number(intoListId) : typeof bodyList === "number" ? bodyList : undefined;
        const task = { id: next++, owner: caller, title, done: false, ...(listId !== undefined ? { listId } : {}) };
        tasks.push(task);
        created.push({ id: String(task.id), owner: caller, title, done: false });
        if (caller === "a") {
          latest = title;
          latestTask = task;
        }
        return send(res, 201, { task: view(task) });
      },
      "PUT /api/tasks": (req, res) => {
        // A list's reorder: no owner check on the list (a bug of its own).
        reorders.push(`${callerOf(req) ?? "nobody"} ${req.url} ${req.body}`);
        const l = lists.find((x) => x.id === Number(listOf(req.url)));
        if (!l) return send(res, 404, { error: "Not found" });
        Object.assign(l, parse(req.body));
        return send(res, 200, { list: l });
      },
      "POST /api/activity": (req, res) => {
        activity.push(`${callerOf(req) ?? "nobody"} ${req.url} ${req.body}`);
        return send(res, 200, { ok: true });
      },
      "GET /favicon.ico": (_req, res) => send(res, 204),
    },
    fallback: (req, res) => {
      // A note at its own path (/api/notes/3) or by a query (/api/notes?id=3).
      const noteId = /^\/api\/notes\/(\d+)$/.exec(pathOf(req.url))?.[1] ?? (pathOf(req.url) === "/api/notes" ? new URL(req.url, "http://x").searchParams.get("id") : null);
      if (noteId !== null) {
        const n = notes.find((x) => x.id === Number(noteId));
        if (!n) return send(res, 404, { error: "Not found" });
        /** The note as its answers show it: with the latest task beside it in "answer-task". */
        const withLatest = () => ({ note: n, ...(mode === "answer-task" && latestTask ? { latest: view(latestTask) } : {}) });
        if (req.method === "GET") return callerOf(req) === n.owner ? send(res, 200, withLatest()) : send(res, 404, { error: "Not found" });
        if (req.method === "DELETE") {
          if (req.headers["x-dry-run"] === "1") return send(res, 200, { ok: true });
          notes.splice(notes.indexOf(n), 1);
          return send(res, 204);
        }
        if (req.method !== "PATCH") return send(res, 405, { error: "Method not allowed" });
        const form = String(req.headers["content-type"] ?? "").startsWith("application/x-www-form-urlencoded");
        Object.assign(n, form ? Object.fromEntries(new URLSearchParams(req.body)) : parse(req.body));
        if (mode === "same-title-note" || mode === "same-title-form") return send(res, 200, { ok: true });
        if (mode === "answer-task") return send(res, 200, withLatest());
        if (mode === "answer-task-only") return send(res, 200, latestTask ? { task: view(latestTask) } : { ok: true });
        return send(res, 200, { note: mode === "answer-title" ? { ...n, latest } : n });
      }
      const listAt = /^\/api\/lists\/(\d+)$/.exec(pathOf(req.url));
      if (listAt) {
        const l = lists.find((x) => x.id === Number(listAt[1]));
        if (!l) return send(res, 404, { error: "Not found" });
        if (req.method === "GET") {
          // The owner's read: its name and its tasks, not its own id.
          const caller = callerOf(req);
          if (caller !== l.owner) return send(res, 404, { error: "Not found" });
          return send(res, 200, { name: l.name, tasks: tasks.filter((t) => t.owner === caller && t.listId === l.id).map(view) });
        }
        if (req.method !== "PATCH") return send(res, 405, { error: "Method not allowed" });
        Object.assign(l, parse(req.body));
        return send(res, 200, { list: l });
      }
      const m = /^\/api\/tasks\/(\d+)$/.exec(pathOf(req.url));
      if (!m) return send(res, 404, { error: "Not found" });
      const caller = callerOf(req);
      const task = tasks.find((t) => t.id === Number(m[1]));
      if (!task || task.owner !== caller) return caller ? send(res, 404, { error: "Not found" }) : send(res, 401, { error: "Sign in first" });
      if (req.method === "GET") return send(res, 200, { task: view(task) });
      if (req.method === "DELETE") {
        if (req.headers["x-dry-run"] === "1") return send(res, 200, { ok: true });
        tasks.splice(tasks.indexOf(task), 1);
        return send(res, 204);
      }
      if (req.method !== "PATCH") return send(res, 405, { error: "Method not allowed" });
      const body = parse(req.body);
      if (typeof body.title === "string") task.title = body.title;
      if (typeof body.done === "boolean") task.done = body.done;
      return send(res, 200, { task: view(task) });
    },
  });
  servers.push(server);
  return Object.assign(server, { created, notes, lists, activity, intoList, reorders });
}

/** The page's own writes (as Account A) to another of Account A's records, or naming 3 in a query string, per mode. */
const SHARED_ID_OWN_WRITES: Record<SharedIdMode, string[]> = {
  patch: ["PATCH /api/notes/3"],
  "patch+delete": ["PATCH /api/notes/3", "DELETE /api/notes/3"],
  query: ["POST /api/activity?count=3"],
  "titled-note": ["PATCH /api/notes/3"],
  "list-items": ["PATCH /api/lists/3"],
  "answer-title": ["PATCH /api/notes/3"],
  "copy-to-list": ["POST /api/tasks?listId=3"],
  "same-title-note": ["PATCH /api/notes/3"],
  "same-title-answer": ["PATCH /api/notes/3"],
  "same-title-form": ["PATCH /api/notes/3"],
  "same-title-query": ["PATCH /api/notes?id=3"],
  "answer-task": ["PATCH /api/notes/3"],
  "answer-task-only": ["PATCH /api/notes/3"],
  "by-list-reorder": ["PUT /api/tasks?listId=3"],
  "by-list-copy": ["POST /api/tasks?listId=3"],
  "list-path-reorder": ["PATCH /api/lists/3"],
};

/** Account A's note 3 as Account A's own page leaves it after creating the task titled `title`. */
function noteAfter(mode: SharedIdMode, title: string): Note {
  const seen = mode === "patch" || mode === "patch+delete" || mode === "answer-title" || mode === "answer-task" || mode === "answer-task-only";
  return { id: 3, owner: "a", text: mode === "titled-note" ? `Latest task: ${title}` : "Call the plumber", seen, ...(copiesTitle(mode) ? { title } : {}) };
}

/** Account A's list 3 as Account A's own page leaves it after creating the task titled `title`. */
function listAfter(mode: SharedIdMode, title: string): TaskList {
  const reordered = mode === "by-list-reorder" || mode === "list-path-reorder";
  return { id: 3, owner: "a", name: "Home", items: mode === "list-items" ? [{ title }] : [], ...(reordered ? { order: [3] } : {}) };
}

describe("write-access: another of Account A's records with the test record's id", () => {
  for (const mode of [
    "patch",
    "patch+delete",
    "query",
    "titled-note",
    "list-items",
    "answer-title",
    "copy-to-list",
    "same-title-note",
    "same-title-answer",
    "same-title-form",
    "same-title-query",
    "answer-task",
    "answer-task-only",
    "by-list-reorder",
    "by-list-copy",
    "list-path-reorder",
  ] as const) {
    for (const which of ["other-account", "signed-out"] as const) {
      it(`${mode}, ${which}: nothing is sent as the scenario's identity but the writes for the test record`, async () => {
        // A fresh app per run, so the run's test record is task 3, the id Account A's note 3 and list 3 have.
        const app = await sharedIdApp(mode);
        const page = await discover(app);
        app.requests.length = 0;
        app.activity.length = 0;
        const ran = await runScenario(app, page, which);
        const record = ownRecord(ran);
        expect(record.id).toBe("3");
        // The page's own writes for note 3 or list 3 (or naming 3 in a query string) were in the capture, after the
        // save; the titled ones carry the new task's title in their body, or get it back in their answer.
        const own = ran.requests.filter((r) => isWrite(r) && callerOf(r) === "a").map((r) => `${r.method} ${r.url}`);
        for (const write of SHARED_ID_OWN_WRITES[mode]) expect(own, which).toContain(write);
        // It really tried, and only the test record's own PATCH went as the scenario's identity.
        const sent = writesByOthers(ran.requests).map((r) => `${r.method} ${r.url}`);
        expect(sent, `${which}: ${ran.result.notes}`).toEqual(["PATCH /api/tasks/3"]);
        for (const r of writesByOthers(ran.requests)) expect(callerOf(r), which).toBe(which === "other-account" ? "b" : null);
        expect(ran.calls.filter((c) => c.as !== "self" && /\/api\/(notes|activity|lists)\b|[?&]listId=/.test(c.url)), which).toEqual([]);
        // Account A's note and list are still there, as Account A's own page left them (no marker field added, and a
        // title the page copied in is still the new task's own); the activity log, the creates into list 3 and its
        // reorders are Account A's alone.
        expect(app.notes, which).toEqual([noteAfter(mode, record.title)]);
        expect(app.lists, which).toEqual([listAfter(mode, record.title)]);
        for (const line of app.activity) expect(line.startsWith("a "), `${which}: ${line}`).toBe(true);
        for (const line of app.intoList) expect(line.startsWith("a "), `${which}: ${line}`).toBe(true);
        for (const line of app.reorders) expect(line.startsWith("a "), `${which}: ${line}`).toBe(true);
        if (mode === "copy-to-list" || mode === "by-list-copy") expect(app.intoList.length, which).toBeGreaterThan(0);
        if (mode === "by-list-reorder") expect(app.reorders.length, which).toBeGreaterThan(0);
        expect(ran.result.status, `${which}: ${ran.result.notes}`).toBe("pass");
      });
    }
  }
});

/**
 * Where the singular-path app's update holds the record: "body+answer" sends {title, done: false} and is answered with
 * the task ({task: {id, title, done}}); "body" sends the same and is answered {ok: true} only; "answer" sends
 * {done: false} only (no test value) and is answered with the task. In every mode Account A reads the task at the
 * update's own URL too (GET /api/task/<id>: {task: {id, title, done}}).
 */
type SingularMode = "body+answer" | "body" | "answer";

/**
 * A page whose app saves at one path, reads at another and updates at a third: POST /api/tasks/create, then
 * PATCH /api/task/<id> for the new task (its body per SingularMode), then GET /api/tasks (the list).
 */
const singularPage = (mode: SingularMode) => `<!doctype html><html lang="en"><head><title>Tasks</title></head><body><main><h1>Tasks</h1>
<form id="new" aria-label="New task"><label for="title">Title</label><input id="title" name="title" required><button type="submit">Add task</button></form><ul id="list"></ul></main>
<script>
function load() { return fetch('/api/tasks').then(function (r) { return r.ok ? r.json() : { tasks: [] }; }).then(function (d) { document.getElementById('list').innerHTML = d.tasks.map(function (t) { return '<li>' + String(t.title).replace(/</g, '&lt;') + '</li>'; }).join(''); }); }
document.getElementById('new').addEventListener('submit', function (e) {
  e.preventDefault();
  var title = document.getElementById('title').value;
  fetch('/api/tasks/create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: title }) })
    .then(function (r) { return r.json(); })
    .then(function (d) { return fetch('/api/task/' + d.task.id, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(${mode === "answer" ? "{ done: false }" : "{ title: title, done: false }"}) }); })
    .then(load);
});
load();
</script></body></html>`;

interface SingularApp extends FixtureServer {
  tasks: { id: number; owner: "a" | "b"; title: string; done: boolean }[];
  /** Every task created through POST /api/tasks/create, as it was created (its numeric id as text). */
  created: Task[];
}

/**
 * The singular-path app. Tasks have numeric ids (Account A's 1, Account B's 2; the run's first is 3); reads check the
 * owner, but PATCH /api/task/<id> checks nothing (the bug): anyone's update lands.
 */
async function singularApp(mode: SingularMode): Promise<SingularApp> {
  const tasks: SingularApp["tasks"] = [
    { id: 1, owner: "a", title: "Groceries", done: false },
    { id: 2, owner: "b", title: "Reading list", done: false },
  ];
  const created: Task[] = [];
  let next = 3;
  const view = (t: (typeof tasks)[number]) => ({ id: t.id, title: t.title, done: t.done });
  const server = await startFixtureServer({
    pages: { "/app": singularPage(mode) },
    routes: {
      "GET /api/tasks": (req, res) => {
        const caller = callerOf(req);
        if (!caller) return send(res, 401, { error: "Sign in first" });
        return send(res, 200, { tasks: tasks.filter((t) => t.owner === caller).map(view) });
      },
      "POST /api/tasks/create": (req, res) => {
        const caller = callerOf(req);
        if (!caller) return send(res, 401, { error: "Sign in first" });
        const title = typeof parse(req.body).title === "string" ? String(parse(req.body).title).trim() : "";
        if (!title) return send(res, 400, { error: "Title required" });
        const task = { id: next++, owner: caller, title, done: false };
        tasks.push(task);
        created.push({ id: String(task.id), owner: caller, title, done: false });
        return send(res, 201, { task: view(task) });
      },
      "GET /favicon.ico": (_req, res) => send(res, 204),
    },
    fallback: (req, res) => {
      const m = /^\/api\/tasks?\/(\d+)$/.exec(pathOf(req.url));
      if (!m) return send(res, 404, { error: "Not found" });
      const caller = callerOf(req);
      const task = tasks.find((t) => t.id === Number(m[1]));
      if (req.method === "GET") return task && task.owner === caller ? send(res, 200, { task: view(task) }) : send(res, 404, { error: "Not found" });
      if (req.method !== "PATCH" || !pathOf(req.url).startsWith("/api/task/")) return send(res, 405, { error: "Method not allowed" });
      if (!task) return send(res, 404, { error: "Not found" });
      const body = parse(req.body);
      if (typeof body.title === "string") task.title = body.title;
      if (typeof body.done === "boolean") task.done = body.done;
      return send(res, 200, mode === "body" ? { ok: true } : { task: view(task) });
    },
  });
  servers.push(server);
  return Object.assign(server, { tasks, created });
}

describe("write-access: the app's update at another path than its save and its read", () => {
  for (const mode of ["body+answer", "body", "answer"] as const) {
    it(`finds PATCH /api/task/<id> by the record in its ${mode === "body+answer" ? "body and answer" : `${mode} alone`}, sends it as Account B, and restores the record`, async () => {
      const app = await singularApp(mode);
      const page = await discover(app);
      app.requests.length = 0;
      const ran = await runScenario(app, page, "other-account");
      const record = ownRecord(ran);
      expect(record.id).toBe("3");
      const sent = writesByOthers(ran.requests);
      expect(
        sent.map((r) => `${r.method} ${r.url}`),
        ran.result.notes,
      ).toEqual(["PATCH /api/task/3"]);
      for (const r of sent) expect(callerOf(r)).toBe("b");
      expect(ran.result.status, ran.result.notes).toBe("fail");
      expect(ran.result.findings.map((f) => f.title)).toEqual(["Account B can change Account A's records"]);
      expect(ran.result.notes).not.toMatch(/could not be undone/i);
      // Put back: the record reads as it was created; Account A's and B's own tasks were never written.
      expect(app.tasks.find((t) => t.id === 3)).toEqual({ id: 3, owner: "a", title: record.title, done: false });
      expect(app.tasks.find((t) => t.id === 1)).toEqual({ id: 1, owner: "a", title: "Groceries", done: false });
      expect(app.tasks.find((t) => t.id === 2)).toEqual({ id: 2, owner: "b", title: "Reading list", done: false });
    });
  }
});

describe("write-access: an update that holds the record one level down", () => {
  it("sets its marker inside {\"task\": {...}} where the app reads it: an unguarded update is a finding, the record is put back, and the spec sends the same shape", async () => {
    const { app, page } = await startTasks({ writes: "unguarded", sends: ["patch"], nested: true });
    for (const which of ["other-account", "signed-out"] as const) {
      const ran = await runScenario(app, page, which);
      const record = ownRecord(ran);
      // The app's own update nests the task, as Account A.
      const own = ran.requests.filter((r) => isWrite(r) && callerOf(r) === "a" && r.method === "PATCH" && pathOf(r.url) === `/api/tasks/${record.id}`);
      expect(own.length, which).toBeGreaterThan(0);
      expect(Object.keys(parse(own[0]!.body)), which).toEqual(["task"]);
      // Sent as the scenario's identity: the same shape, with the marker in the task, not beside it.
      const sent = writesByOthers(ran.requests);
      expect(sent.map((r) => `${r.method} ${pathOf(r.url)}`), `${which}: ${ran.result.notes}`).toEqual([`PATCH /api/tasks/${record.id}`]);
      for (const r of sent) expect(callerOf(r), which).toBe(which === "other-account" ? "b" : null);
      const body = parse(sent[0]!.body);
      expect(Object.keys(body), which).toEqual(["task"]);
      const marker = (body.task as Record<string, unknown>).title;
      expect(typeof marker, which).toBe("string");
      expect(marker, which).not.toBe(record.title);
      expect(String(marker).toLowerCase(), which).toContain(RUN_TOKEN);
      // The server applied it: a critical finding, put back, not "could not be undone".
      expect(ran.result.status, `${which}: ${ran.result.notes}`).toBe("fail");
      expect(ran.result.findings.map((f) => f.title), which).toEqual([
        which === "other-account" ? "Account B can change Account A's records" : "Signed-out visitors can change Account A's records",
      ]);
      expect(ran.result.notes, which).not.toMatch(/could not be undone/i);
      expect(app.tasks.find((t) => t.id === record.id), which).toEqual({ id: record.id, owner: "a", title: record.title, done: false });
      // The exported spec sends its value where the app reads it, one level down.
      const spec = ran.result.findings[0]!.spec;
      expect(spec, which).toBeDefined();
      expect(spec!.source, which).toMatch(/data: \{ "task": \{ \[FIELD\]: /);
    }
    // Account A's and B's own tasks were never written.
    expect(app.tasks.find((t) => t.id === "t1")).toEqual({ id: "t1", owner: "a", title: "Groceries", done: false });
    expect(app.tasks.find((t) => t.id === "t2")).toEqual({ id: "t2", owner: "b", title: "Reading list", done: false });
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
