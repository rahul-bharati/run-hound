// write-access (0.6.0, docs/v2-spec.md "`write-access`" and "`write-access` amendments"): can Account B, or a visitor who isn't signed in, change or delete the run's own test record in Account A? Tests for an authorization check, driven through createCheckContext against a small task app built in this file (sessions are fixed cookies: sid=a-session for Account A, sid=b-session for Account B).
import { mkdtemp, rm } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeBrowser, getBrowser } from "../../../../test-support/harness.js";
import { startFixtureServer, type FixtureServer, type RecordedRequest } from "../../../../test-support/server.js";
import { expectPlanShape, expectWellFormedFinding } from "../../../../test/fixtures/checks/assert-finding.js";
import type { AccountRef, CheckResult, DiscoveredForm, DiscoveredPage, Finding, Scenario } from "../../../../src/core/types.js";
import type { SessionState } from "../../../../src/engine/auth.js";
import { createCheckContext, type RunningCheckContext } from "../../../../src/engine/context.js";
import { discoverPage } from "../../../../src/engine/discover.js";
import { buildPlan } from "../../../../src/engine/plan.js";
import { needsOtherAccount } from "../../../../src/engine/runner.js";
import { check, identityOf } from "../../../../src/checks/write-access.js";

const A: AccountRef = { id: "a", label: "Account A" };
const B: AccountRef = { id: "b", label: "Account B" };
// Lowercase letters and digits, so the test values Run Hound types keep it verbatim.
const RUN_TOKEN = "wa5e7a91";
const SESSION_VALUES = { a: "a-session", b: "b-session" } as const;

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

// Account A's or Account B's session: the sid cookie the task app knows them by.
function session(who: "a" | "b"): SessionState {
  return {
    cookies: [{ name: "sid", value: SESSION_VALUES[who], domain: "127.0.0.1", path: "/", expires: -1, httpOnly: true, secure: false, sameSite: "Lax" }],
    origins: [],
  };
}

// Who sent a request, by its sid cookie: Account A, Account B, or nobody.
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

interface Task {
  id: string;
  owner: "a" | "b";
  title: string;
  done: boolean;
  // The list the create body named: "errands" from the "New errand" form, none from "New task". Never read back.
  list?: string;
}

// How PATCH and DELETE /api/tasks/<id> treat a caller who doesn't own the task (the owner is always let through).
type WriteRule = "owner-only" | "unguarded" | "ignored" | "refused-but-applied" | "unguarded-edited";

// What the page sends for the new task once its create has answered, in order.
type PageSend = "patch" | "delete";

interface TasksAppOptions {
  writes?: WriteRule;
  // Default ["patch"].
  sends?: PageSend[];
  // Once a caller who doesn't own a task has sent it a PATCH or DELETE, every task read answers 500.
  failReadsAfterOthersWrite?: boolean;
  // A second form after "New task", "New errand", that saves a task the same way (the page's second form).
  secondForm?: boolean;
}

interface TasksApp extends FixtureServer {
  // Every task there is now, Account A's and Account B's.
  tasks: Task[];
  // Every task created through POST /api/tasks, as it was created, in order.
  created: Task[];
  // Writes a caller who doesn't own the task got applied: "PATCH t3 by b", "DELETE t3 by nobody".
  appliedForOthers: string[];
}

// The page's own writes for the new task (`id` and `title` are in scope in the page script).
const PAGE_SENDS: Record<PageSend, string> = {
  patch: `.then(function () { return fetch(url, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: title, done: false }) }); })`,
  delete: `.then(function () { return fetch(url, { method: 'DELETE', headers: { 'x-dry-run': '1' } }); })`,
};

function tasksPage(sends: PageSend[], secondForm = false): string {
  const errand = secondForm
    ? `\n<form id="errand" aria-label="New errand"><label for="errand-title">Errand</label><input id="errand-title" name="title" required><button type="submit">Add errand</button></form>`
    : "";
  return `<!doctype html><html lang="en"><head><title>Tasks</title></head><body><main><h1>Tasks</h1>
<form id="new" aria-label="New task"><label for="title">Title</label><input id="title" name="title" required><button type="submit">Add task</button></form>${errand}
<p role="status" id="status"></p><ul id="list"></ul></main>
<script>
var list = document.getElementById('list');
function load() {
  return fetch('/api/tasks').then(function (r) { return r.ok ? r.json() : { tasks: [] }; }).then(function (d) {
    list.innerHTML = d.tasks.map(function (t) { return '<li>' + String(t.title).replace(/</g, '&lt;') + '</li>'; }).join('');
  });
}
function wire(formId, inputId, list) {
  var form = document.getElementById(formId);
  if (!form) return;
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var title = document.getElementById(inputId).value;
    fetch('/api/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(list ? { title: title, list: list } : { title: title }) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var url = '/api/tasks/' + encodeURIComponent(d.task.id);
        return Promise.resolve()${sends.map((s) => PAGE_SENDS[s]).join("")};
      })
      .then(function () { document.getElementById('status').textContent = 'Saved'; return load(); });
  });
}
wire('new', 'title');
wire('errand', 'errand-title', 'errands');
load();
</script></body></html>`;
}

// The task app (see the file header). Ids are t1, t2, ... per server: t1 is Account A's own "Groceries", t2 Account B's "Reading list", and the tasks the test creates follow in order.
async function tasksApp(o: TasksAppOptions = {}): Promise<TasksApp> {
  const rule = o.writes ?? "owner-only";
  const tasks: Task[] = [
    { id: "t1", owner: "a", title: "Groceries", done: false },
    { id: "t2", owner: "b", title: "Reading list", done: false },
  ];
  const created: Task[] = [];
  const appliedForOthers: string[] = [];
  let next = 3;
  let readsFail = false;
  const view = (t: Task) => ({ id: t.id, title: t.title, done: t.done });

  const server = await startFixtureServer({
    pages: { "/app": tasksPage(o.sends ?? ["patch"], o.secondForm === true) },
    routes: {
      "GET /api/tasks": (req, res) => {
        if (readsFail) return send(res, 500, { error: "Something went wrong" });
        const caller = callerOf(req);
        if (!caller) return send(res, 401, { error: "Sign in first" });
        return send(res, 200, { tasks: tasks.filter((t) => t.owner === caller).map(view) });
      },
      "POST /api/tasks": (req, res) => {
        const caller = callerOf(req);
        if (!caller) return send(res, 401, { error: "Sign in first" });
        const body = parse(req.body);
        const title = typeof body.title === "string" ? body.title.trim() : "";
        if (!title) return send(res, 400, { error: "Title required" });
        const list = typeof body.list === "string" ? body.list : undefined;
        const task: Task = { id: `t${next++}`, owner: caller, title, done: false, ...(list ? { list } : {}) };
        tasks.push(task);
        created.push({ ...task });
        return send(res, 201, { task: view(task) });
      },
      "GET /favicon.ico": (_req, res) => send(res, 204),
    },
    fallback: (req, res) => {
      const m = /^\/api\/tasks\/([^/]+)$/.exec(pathOf(req.url));
      if (!m) return send(res, 404, { error: "Not found" });
      const caller = callerOf(req);
      const task = tasks.find((t) => t.id === decodeURIComponent(m[1]!));
      if (req.method === "GET") {
        if (readsFail) return send(res, 500, { error: "Something went wrong" });
        if (!caller) return send(res, 401, { error: "Sign in first" });
        return task && task.owner === caller ? send(res, 200, { task: view(task) }) : send(res, 404, { error: "Not found" });
      }
      if (req.method !== "PATCH" && req.method !== "DELETE") return send(res, 405, { error: "Method not allowed" });
      if (!task) return send(res, 404, { error: "Not found" });
      const owner = caller === task.owner;
      if (o.failReadsAfterOthersWrite && !owner) readsFail = true;
      if (rule === "owner-only" && !owner) return caller ? send(res, 404, { error: "Not found" }) : send(res, 401, { error: "Sign in first" });
      if (rule === "ignored") return send(res, 200, { ok: true, task: view(task) });
      if (req.method === "DELETE") {
        if (req.headers["x-dry-run"] === "1") return send(res, 200, { ok: true, deleted: false });
        tasks.splice(tasks.indexOf(task), 1);
      } else {
        const body = parse(req.body);
        if (typeof body.title === "string") task.title = rule === "unguarded-edited" && !owner ? `${body.title} (edited)` : body.title;
        if (typeof body.done === "boolean") task.done = body.done;
      }
      if (!owner) appliedForOthers.push(`${req.method} ${task.id} by ${caller ?? "nobody"}`);
      if (rule === "refused-but-applied" && !owner) return send(res, 403, { error: "Forbidden" });
      return req.method === "DELETE" ? send(res, 204) : send(res, 200, { task: view(task) });
    },
  });
  servers.push(server);
  return Object.assign(server, { tasks, created, appliedForOthers });
}

// Discovers `path` signed in as Account A, once its heading shows and the network is idle.
async function discover(server: FixtureServer, path: string, heading: string): Promise<DiscoveredPage> {
  const context = await browser.newContext({ storageState: session("a") });
  try {
    const page = await context.newPage();
    await page.goto(`${server.url}${path}`);
    await page.getByRole("heading", { level: 1, name: heading }).waitFor();
    await page.waitForLoadState("networkidle");
    return await discoverPage(page);
  } finally {
    await context.close();
  }
}

// The scenario as the check plans it for the task form, signed in (with Account B when `withB`), scoped as the planner does.
function scenarioFor(page: DiscoveredPage, which: Which, withB: boolean): Scenario {
  const planned = check.plan(page.forms[0]!, page, { signedIn: true, otherAccount: withB }).find((s) => s.id === `write-access:${which}`);
  if (!planned) throw new Error(`write-access planned no "write-access:${which}" scenario for the New task form`);
  return { ...planned, scope: "form", formIndex: 0 };
}

interface Ran {
  result: CheckResult;
  // The requests the server got during the run.
  requests: RecordedRequest[];
  // The tasks created during the run; the first is the scenario's own test record.
  created: Task[];
}

// Runs one scenario on the task app's /app page (already discovered as `page`), in a fresh CheckContext.
async function runScenario(app: TasksApp, page: DiscoveredPage, which: Which, o: { withB?: boolean } = {}): Promise<Ran> {
  const withB = o.withB ?? true;
  return runPlanned(app, page, scenarioFor(page, which, withB), { withB });
}

// Runs `scenario` as the runner would: on its own form of the page (formIndex), in a fresh CheckContext signed in as Account A, with Account B too when `withB`.
async function runPlanned(app: TasksApp, page: DiscoveredPage, scenario: Scenario, o: { withB: boolean }): Promise<Ran> {
  const withB = o.withB;
  const form = page.forms[scenario.formIndex ?? 0];
  if (!form) throw new Error(`the page has no form ${scenario.formIndex ?? 0} for ${scenario.id}`);
  const targetUrl = `${app.url}/app`;
  const dir = await mkdtemp(join(tmpdir(), "rh-write-access-"));
  dirs.push(dir);
  const ctx = createCheckContext({
    browser,
    form,
    discoveredPage: page,
    targetUrl,
    artifactsDir: dir,
    runToken: RUN_TOKEN,
    checkId: "write-access",
    sessions: withB ? { self: session("a"), other: session("b") } : { self: session("a") },
    accounts: { self: A, other: withB ? B : null },
    markers: [],
  });
  contexts.push(ctx);
  const from = app.requests.length;
  const createdFrom = app.created.length;
  const result = await check.run(ctx, scenario);
  return { result, requests: app.requests.slice(from), created: app.created.slice(createdFrom) };
}

// Starts a task app and discovers its /app page as Account A; the server's request log starts empty.
async function startTasks(o: TasksAppOptions = {}): Promise<{ app: TasksApp; page: DiscoveredPage }> {
  const app = await tasksApp(o);
  const page = await discover(app, "/app", "Tasks");
  app.requests.length = 0;
  return { app, page };
}

// The writes a request log holds that Account A didn't send (so: the scenario's identity).
const writesByOthers = (requests: RecordedRequest[]) => requests.filter((r) => !["GET", "HEAD", "OPTIONS"].includes(r.method) && callerOf(r) !== "a");

const noSessionValues = (result: CheckResult) => {
  const text = JSON.stringify(result);
  expect(text).not.toContain(SESSION_VALUES.a);
  expect(text).not.toContain(SESSION_VALUES.b);
};

// Account A's tasks, read as Account A the way the app does (GET /api/tasks with A's cookie).
async function tasksOfA(app: TasksApp): Promise<{ id: string; title: string; done: boolean }[]> {
  const answer = await fetch(`${app.url}/api/tasks`, { headers: { cookie: `sid=${SESSION_VALUES.a}` } });
  return ((await answer.json()) as { tasks: { id: string; title: string; done: boolean }[] }).tasks;
}

// A page with a form that saves a record and three that don't: a search, a sign-in form and a change-password form.
const FORMS_PAGE = `<!doctype html><html lang="en"><head><title>Workspace</title></head><body><main><h1>Workspace</h1>
<form id="new" aria-label="New task"><label for="title">Title</label><input id="title" name="title" required><button type="submit">Add task</button></form>
<form role="search" action="/search" method="get" aria-label="Search tasks"><label for="q">Search</label><input id="q" type="search" name="q"><button type="submit">Search</button></form>
<form id="signin" aria-label="Sign in"><label for="em">Email</label><input id="em" type="email" name="email" autocomplete="username"><label for="pw">Password</label><input id="pw" type="password" name="password" autocomplete="current-password"><button type="submit">Sign in</button></form>
<form id="pwd" aria-label="Change password"><label for="cur">Current password</label><input id="cur" type="password" name="current" autocomplete="current-password"><label for="np">New password</label><input id="np" type="password" name="next" autocomplete="new-password"><button type="submit">Change password</button></form>
</main></body></html>`;

let formsPage: DiscoveredPage | undefined;

// FORMS_PAGE as discovered signed in (discovered once; the result is plain data).
async function discoverForms(): Promise<{ page: DiscoveredPage; form: (fieldKey: string) => DiscoveredForm }> {
  if (!formsPage) {
    const server = await startFixtureServer({ pages: { "/workspace": FORMS_PAGE } });
    servers.push(server);
    formsPage = await discover(server, "/workspace", "Workspace");
  }
  const page = formsPage;
  const form = (fieldKey: string) => {
    const found = page.forms.find((f) => f.fields.some((x) => x.key === fieldKey));
    if (!found) throw new Error(`no discovered form has a field "${fieldKey}"`);
    return found;
  };
  return { page, form };
}

describe("write-access: planning", () => {
  it("plans other-account and signed-out for a form that saves a record, signed in with an isolated Account B: unticked, not destructive", async () => {
    const { page, form } = await discoverForms();
    const scenarios = check.plan(form("title"), page, { signedIn: true, otherAccount: true });
    expect(scenarios.map((s) => s.id).sort()).toEqual(["write-access:other-account", "write-access:signed-out"]);
    expectPlanShape(scenarios, "write-access");
    for (const s of scenarios) {
      expect(s.checkId).toBe("write-access");
      expect(s.destructive, s.id).toBe(false);
      expect(s.defaultSelected, s.id).toBe(false);
      // Unticked, the plan says what it would do: it changes Account A's data and puts it back.
      expect(s.description, s.id).toMatch(/Account A/);
      expect(s.description, s.id).toMatch(/restor|put[^.]*back/i);
    }
    // Registered as the contract says: security, one scenario set per form, and a stop mid-run asks to check Account A.
    expect(check.id).toBe("write-access");
    expect(check.category).toBe("security");
    expect(check.scope).toBe("form");
    expect(check.interruptedNote).toMatch(/check Account A/);
  });

  it("plans only the signed-out scenario when there is no isolated Account B", async () => {
    const { page, form } = await discoverForms();
    const scenarios = check.plan(form("title"), page, { signedIn: true, otherAccount: false });
    expect(scenarios.map((s) => s.id)).toEqual(["write-access:signed-out"]);
    expectPlanShape(scenarios, "write-access");
    expect(scenarios[0]!.defaultSelected).toBe(false);
  });

  it("plans nothing on a signed-out run, even for a form that saves a record", async () => {
    const { page, form } = await discoverForms();
    // The same form plans when signed in, so an empty plan below is the signed-out rule, not a form the check skips.
    expect(check.plan(form("title"), page, { signedIn: true, otherAccount: true }).length).toBeGreaterThan(0);
    expect(check.plan(form("title"), page)).toEqual([]);
    expect(check.plan(form("title"), page, { signedIn: false, otherAccount: false })).toEqual([]);
    expect(check.plan(form("title"), page, { signedIn: false, otherAccount: true })).toEqual([]);
  });

  it("plans nothing for a form that doesn't save a record: a search, a sign-in form, a change-password form", async () => {
    const { page, form } = await discoverForms();
    const env = { signedIn: true, otherAccount: true };
    expect(check.plan(form("title"), page, env).length).toBeGreaterThan(0);
    expect(check.plan(form("q"), page, env)).toEqual([]);
    expect(check.plan(form("password"), page, env)).toEqual([]);
    expect(check.plan(form("next"), page, env)).toEqual([]);
  });
});

const CRITICAL = { checkId: "write-access", category: "security", severity: "critical", confidence: "confirmed" } as const;

// The scenario's own test record: the first task created during the run (throws when the run created none).
function ownRecord(ran: Ran): Task {
  const record = ran.created[0];
  if (!record) throw new Error(`the run created no test record: ${ran.result.status} ${ran.result.notes ?? ""}`);
  return record;
}

describe("write-access: findings, decided by re-reading as Account A", () => {
  it("Account B can update Account A's test record: exactly one critical, confirmed finding", async () => {
    const { app, page } = await startTasks({ writes: "unguarded", sends: ["patch"] });
    const ran = await runScenario(app, page, "other-account");
    const record = ownRecord(ran);
    expect(ran.result.status, ran.result.notes).toBe("fail");
    expect(ran.result.findings).toHaveLength(1);
    const f: Finding = ran.result.findings[0]!;
    expect(f.title).toBe("Account B can change Account A's records");
    expectWellFormedFinding(f, CRITICAL);
    // Account B's update really reached the test record (and only it).
    expect(app.appliedForOthers).toContain(`PATCH ${record.id} by b`);
    noSessionValues(ran.result);
  });

  it("a signed-out visitor can update and delete it: critical, confirmed 'Signed-out visitors can … change / … delete …' findings", async () => {
    const { app, page } = await startTasks({ writes: "unguarded", sends: ["patch", "delete"] });
    const ran = await runScenario(app, page, "signed-out");
    const record = ownRecord(ran);
    expect(ran.result.status, ran.result.notes).toBe("fail");
    const titles = ran.result.findings.map((f) => f.title);
    expect(titles.some((t) => /^Signed-out visitors can .*delete/i.test(t)), titles.join(" | ")).toBe(true);
    expect(titles.some((t) => /^Signed-out visitors can .*change/i.test(t)), titles.join(" | ")).toBe(true);
    for (const f of ran.result.findings) expectWellFormedFinding(f, CRITICAL);
    expect(app.appliedForOthers).toContain(`DELETE ${record.id} by nobody`);
    noSessionValues(ran.result);
  });

  it("Account B can delete it: a critical, confirmed 'Account B can … delete …' finding", async () => {
    const { app, page } = await startTasks({ writes: "unguarded", sends: ["patch", "delete"] });
    const ran = await runScenario(app, page, "other-account");
    const record = ownRecord(ran);
    expect(ran.result.status, ran.result.notes).toBe("fail");
    const titles = ran.result.findings.map((f) => f.title);
    expect(titles.some((t) => /^Account B can .*delete/i.test(t)), titles.join(" | ")).toBe(true);
    for (const f of ran.result.findings) expectWellFormedFinding(f, CRITICAL);
    expect(app.appliedForOthers).toContain(`DELETE ${record.id} by b`);
  });

  it("a write the server answers 403 but applies anyway is a finding: the re-read decides, not the status", async () => {
    const { app, page } = await startTasks({ writes: "refused-but-applied", sends: ["patch"] });
    const ran = await runScenario(app, page, "other-account");
    const record = ownRecord(ran);
    expect(app.appliedForOthers).toContain(`PATCH ${record.id} by b`);
    expect(ran.result.status, ran.result.notes).toBe("fail");
    expect(ran.result.findings.map((f) => f.title)).toEqual(["Account B can change Account A's records"]);
    expectWellFormedFinding(ran.result.findings[0]!, CRITICAL);
  });

  it("a write the server stores changed (not exactly the value sent) is still a change: the re-read differs from the snapshot", async () => {
    const { app, page } = await startTasks({ writes: "unguarded-edited", sends: ["patch"] });
    const ran = await runScenario(app, page, "other-account");
    const record = ownRecord(ran);
    expect(app.appliedForOthers).toContain(`PATCH ${record.id} by b`);
    expect(ran.result.status, ran.result.notes).toBe("fail");
    expect(ran.result.findings.map((f) => f.title)).toEqual(["Account B can change Account A's records"]);
    expectWellFormedFinding(ran.result.findings[0]!, CRITICAL);
    // And it was put back.
    expect(ran.result.notes).not.toMatch(/could not be undone/i);
    expect((await tasksOfA(app)).find((t) => t.id === record.id)).toEqual({ id: record.id, title: record.title, done: record.done });
  });

  it("a re-read that fails after the attempt is never a pass, and no finding: without it there is no verdict", async () => {
    for (const which of ["other-account", "signed-out"] as const) {
      // The write lands and is answered 200, but every read of the record fails from then on.
      const { app, page } = await startTasks({ writes: "unguarded", sends: ["patch"], failReadsAfterOthersWrite: true });
      const ran = await runScenario(app, page, which);
      const record = ownRecord(ran);
      expect(app.appliedForOthers, which).toContain(`PATCH ${record.id} by ${which === "other-account" ? "b" : "nobody"}`);
      expect(ran.result.findings, `${which}: ${ran.result.notes}`).toEqual([]);
      expect(ran.result.status, `${which}: ${ran.result.notes}`).not.toBe("pass");
      expect(ran.result.notes, which).toMatch(/check Account A/);
    }
  });

  it("a write the server answers 200 { ok: true } but ignores is a pass: the re-read decides, not the status", async () => {
    const { app, page } = await startTasks({ writes: "ignored", sends: ["patch", "delete"] });
    for (const which of ["other-account", "signed-out"] as const) {
      const ran = await runScenario(app, page, which);
      ownRecord(ran);
      // The writes were really sent as the scenario's identity, so the pass isn't for want of trying.
      expect(writesByOthers(ran.requests).length, which).toBeGreaterThan(0);
      expect(ran.result.findings, `${which}: ${ran.result.notes}`).toEqual([]);
      expect(ran.result.status, `${which}: ${ran.result.notes}`).toBe("pass");
    }
  });
});

describe("write-access: a server that checks who owns the record", () => {
  it("passes both scenarios, naming each request tried and saying Account A's record was unchanged", async () => {
    const { app, page } = await startTasks({ writes: "owner-only", sends: ["patch", "delete"] });
    for (const which of ["other-account", "signed-out"] as const) {
      const ran = await runScenario(app, page, which);
      const record = ownRecord(ran);
      expect(writesByOthers(ran.requests).length, which).toBeGreaterThan(0);
      expect(ran.result.findings, `${which}: ${ran.result.notes}`).toEqual([]);
      expect(ran.result.status, `${which}: ${ran.result.notes}`).toBe("pass");
      expect(ran.result.notes, which).toContain(`PATCH /api/tasks/${record.id}`);
      expect(ran.result.notes, which).toContain(`DELETE /api/tasks/${record.id}`);
      expect(ran.result.notes, which).toMatch(/Account A/);
      expect(ran.result.notes, which).toMatch(/unchanged/i);
      expect(ran.result.notes, which).not.toMatch(/could not be undone/i);
    }
    expect(app.appliedForOthers).toEqual([]);
  });
});

describe("write-access: restoring Account A's test record", () => {
  it("after Account B changed it, the record reads back as it was: every field equals the snapshot", async () => {
    const { app, page } = await startTasks({ writes: "unguarded", sends: ["patch"] });
    const ran = await runScenario(app, page, "other-account");
    const record = ownRecord(ran);
    expect(ran.result.status, ran.result.notes).toBe("fail");
    expect(ran.result.notes).not.toMatch(/could not be undone/i);
    const mine = await tasksOfA(app);
    expect(mine.find((t) => t.id === record.id)).toEqual({ id: record.id, title: record.title, done: record.done });
    // Account A's own task is untouched, and never written.
    expect(mine.find((t) => t.id === "t1")).toEqual({ id: "t1", title: "Groceries", done: false });
    expect(ran.requests.filter((r) => r.method !== "GET" && /^\/api\/tasks\/t[12](\/|$)/.test(pathOf(r.url)))).toEqual([]);
  });

  it("after a signed-out visitor changed it, the same: the record reads back as it was", async () => {
    const { app, page } = await startTasks({ writes: "unguarded", sends: ["patch"] });
    const ran = await runScenario(app, page, "signed-out", { withB: false });
    const record = ownRecord(ran);
    expect(ran.result.status, ran.result.notes).toBe("fail");
    expect(ran.result.notes).not.toMatch(/could not be undone/i);
    const mine = await tasksOfA(app);
    expect(mine.find((t) => t.id === record.id)).toEqual({ id: record.id, title: record.title, done: record.done });
  });
});

// The run's own account and Account B, as planned by buildPlan (the ids the runner sees), for the write-access check.
const SIGNED_IN_WITH_B = { signedIn: true, otherAccount: true } as const;

// The write-access scenarios buildPlan makes for `page`, signed in with Account B. With `copies` > 1 the check is planned that many times, so later copies get the planner's collision ids ("write-access:write-access:…", "#<n>").
function plannedScenarios(app: TasksApp, page: DiscoveredPage, copies = 1): Scenario[] {
  const checks = Array.from({ length: copies }, () => check);
  return buildPlan(`${app.url}/app`, page, checks, SIGNED_IN_WITH_B).scenarios.filter((s) => s.checkId === "write-access");
}

// Asserts that `record` (a run's own test record) was saved by the planned scenario's own form: the "New errand" form (its create names list "errands") for a second form's id ("@form-2"), the "New task" form (no list) otherwise.
function expectSavedByItsForm(id: string, record: Task): void {
  expect(record.list, `${id}: the test record was saved by the scenario's own form`).toBe(/@form-2(?:#\d+)?$/.test(id) ? "errands" : undefined);
}

// The planned scenario with id `id` (throws when the planner made none).
function planned(scenarios: Scenario[], id: string): Scenario {
  const found = scenarios.find((s) => s.id === id);
  if (!found) throw new Error(`the planner made no "${id}" scenario; it made ${scenarios.map((s) => s.id).join(", ")}`);
  return found;
}

describe("write-access: who a scenario runs as comes from the scenario, on every form and under a collided id", () => {
  it("decides it the way the runner decides whether Account B signs in, for every id the planner makes", async () => {
    const { app, page } = await startTasks({ secondForm: true });
    expect(page.forms.length).toBe(2);
    const scenarios = plannedScenarios(app, page, 3);
    expect(scenarios.map((s) => s.id)).toEqual(
      expect.arrayContaining([
        "write-access:other-account",
        "write-access:signed-out",
        "write-access:other-account@form-2",
        "write-access:signed-out@form-2",
        "write-access:write-access:other-account",
        "write-access:write-access:other-account@form-2",
        "write-access:write-access:other-account#2",
        "write-access:write-access:other-account@form-2#2",
        "write-access:write-access:signed-out#2",
        "write-access:write-access:signed-out@form-2#2",
      ]),
    );
    for (const s of scenarios) expect(identityOf(s), s.id).toBe(needsOtherAccount(s) ? "other" : "signed-out");
    // An id that names neither identity is never given one by guessing.
    for (const id of ["write-access:someone", "write-access:other-accounts", "write-access:other-account-copy", "write-access:signed-out-too"]) {
      expect(identityOf({ ...scenarios[0]!, id }), id).toBeNull();
    }
  });

  it("on the page's second form, other-account sends every write as Account B and signed-out with no session", async () => {
    const { app, page } = await startTasks({ writes: "owner-only", sends: ["patch", "delete"], secondForm: true });
    const scenarios = plannedScenarios(app, page);
    for (const [id, caller] of [
      ["write-access:other-account@form-2", "b"],
      ["write-access:signed-out@form-2", null],
    ] as const) {
      const scenario = planned(scenarios, id);
      expect(scenario.formIndex, id).toBe(1);
      const ran = await runPlanned(app, page, scenario, { withB: true });
      const record = ownRecord(ran);
      expectSavedByItsForm(id, record);
      const sent = writesByOthers(ran.requests);
      // It really tried, on the second form's own test record, and only as the scenario's identity.
      expect(sent.map((r) => r.method).sort(), `${id}: ${ran.result.notes}`).toEqual(["DELETE", "PATCH"]);
      for (const r of sent) {
        expect(callerOf(r), `${id}: ${r.method} ${r.url}`).toBe(caller);
        expect(pathOf(r.url), id).toBe(`/api/tasks/${record.id}`);
      }
      expect(ran.result.status, `${id}: ${ran.result.notes}`).toBe("pass");
      expect(ran.result.notes, id).toContain(caller === "b" ? "after Account B sent" : "after a signed-out visitor sent");
    }
    expect(app.appliedForOthers).toEqual([]);
  });

  it("under a collided id, on either form, the other-account scenario's writes go as Account B: its findings are Account B's", async () => {
    const { app, page } = await startTasks({ writes: "unguarded", sends: ["patch"], secondForm: true });
    const scenarios = plannedScenarios(app, page, 3);
    for (const id of ["write-access:write-access:other-account#2", "write-access:write-access:other-account@form-2#2"]) {
      const ran = await runPlanned(app, page, planned(scenarios, id), { withB: true });
      const record = ownRecord(ran);
      expectSavedByItsForm(id, record);
      expect(writesByOthers(ran.requests).map(callerOf), `${id}: ${ran.result.notes}`).toEqual(["b"]);
      expect(app.appliedForOthers, id).toContain(`PATCH ${record.id} by b`);
      expect(ran.result.status, `${id}: ${ran.result.notes}`).toBe("fail");
      expect(ran.result.findings.map((f) => f.title), id).toEqual(["Account B can change Account A's records"]);
      expectWellFormedFinding(ran.result.findings[0]!, CRITICAL);
      noSessionValues(ran.result);
    }
  });

  it("without Account B, an other-account scenario on a later form or under a collided id is skipped (never run signed out); a signed-out one still runs", async () => {
    const { app, page } = await startTasks({ writes: "unguarded", sends: ["patch", "delete"], secondForm: true });
    const scenarios = plannedScenarios(app, page, 3);
    for (const id of ["write-access:other-account@form-2", "write-access:write-access:other-account#2", "write-access:write-access:other-account@form-2#2"]) {
      const ran = await runPlanned(app, page, planned(scenarios, id), { withB: false });
      expect(ran.result.status, `${id}: ${ran.result.notes}`).toBe("skipped");
      expect(ran.result.findings, id).toEqual([]);
      expect(ran.result.notes, id).toMatch(/Account B/);
      // Nothing was saved and nothing was sent as anyone but Account A.
      expect(ran.created, id).toEqual([]);
      expect(writesByOthers(ran.requests).map((r) => `${r.method} ${r.url}`), id).toEqual([]);
    }
    expect(app.appliedForOthers).toEqual([]);

    // The signed-out scenario on a later form and under a collided id still runs, signed out, when Account B is missing. A fresh app per id: both are on the second form with the same salt, so they type the same values, and a record the first left behind would be found in the second's reads before its save (then skipped as Account A's own).
    for (const id of ["write-access:signed-out@form-2", "write-access:write-access:signed-out@form-2#2"]) {
      const clean = await startTasks({ writes: "owner-only", sends: ["patch", "delete"], secondForm: true });
      const ran = await runPlanned(clean.app, clean.page, planned(plannedScenarios(clean.app, clean.page, 3), id), { withB: false });
      const record = ownRecord(ran);
      expectSavedByItsForm(id, record);
      const sent = writesByOthers(ran.requests);
      expect(sent.map((r) => r.method).sort(), `${id}: ${ran.result.notes}`).toEqual(["DELETE", "PATCH"]);
      for (const r of sent) {
        expect(callerOf(r), `${id}: ${r.method} ${r.url}`).toBeNull();
        expect(pathOf(r.url), id).toBe(`/api/tasks/${record.id}`);
      }
      expect(ran.result.status, `${id}: ${ran.result.notes}`).toBe("pass");
      expect(ran.result.notes, id).toContain("after a signed-out visitor sent");
      expect(clean.app.appliedForOthers, id).toEqual([]);
    }
  });

  it("a scenario whose id names neither identity is skipped: nothing is saved, nothing is sent as anyone", async () => {
    const { app, page } = await startTasks({ writes: "unguarded", sends: ["patch", "delete"] });
    const base = planned(plannedScenarios(app, page), "write-access:signed-out");
    const ran = await runPlanned(app, page, { ...base, id: "write-access:someone" }, { withB: true });
    expect(ran.result.status, ran.result.notes).toBe("skipped");
    expect(ran.result.findings).toEqual([]);
    expect(ran.created).toEqual([]);
    expect(ran.requests.filter((r) => !["GET", "HEAD", "OPTIONS"].includes(r.method))).toEqual([]);
  });
});
