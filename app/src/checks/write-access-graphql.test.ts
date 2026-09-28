/**
 * write-access on a GraphQL app (0.6.0 close-out round 1; docs/v2-spec.md "Safety contract": "A's pre-existing records
 * are never written to"). Reads and writes are POST /graphql (Apollo Client's default), so no GET reads a record back.
 *   - An edit form whose mutation renames a task Account A already had (t1): the hold learns t1 from the page's POST
 *     query and stops the mutation before it reaches the app; t1 is never written to, and the note says the save was
 *     stopped.
 *   - A create form (createTask): the save reaches the app, and no GET reads the record back, so the scenario is
 *     skipped; the note names the save, says it reached the app and asks to check Account A, never letting it pass for
 *     "nothing was changed".
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

function session(who: Who): SessionState {
  return { cookies: [{ name: "sid", value: `${who}-session`, domain: "127.0.0.1", path: "/", expires: -1, httpOnly: true, secure: false, sameSite: "Lax" }], origins: [] };
}

function callerOf(req: RecordedRequest): Who | null {
  const c = String(req.headers.cookie ?? "");
  if (/(?:^|;\s*)sid=a-session\b/.test(c)) return "a";
  if (/(?:^|;\s*)sid=b-session\b/.test(c)) return "b";
  return null;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

type Task = { id: string; owner: Who; title: string };

/**
 * A GraphQL task app. The page reads Account A's tasks with a POST query on load; its form sends `mutation` with the
 * typed title as $title, and the first task's id as $id when the mutation declares one. updateTask renames a task its
 * caller owns; createTask adds one.
 */
async function gqlApp(mutation: string): Promise<FixtureServer & { tasks: Task[] }> {
  const tasks: Task[] = [
    { id: "t1", owner: "a", title: "Groceries" },
    { id: "t2", owner: "b", title: "Reading list" },
  ];
  let next = 3;
  const server = await startFixtureServer({
    pages: {
      "/app": `<!doctype html><html lang="en"><head><title>Task</title></head><body><main><h1>Task</h1><p id="current"></p>
<form id="edit" aria-label="Task"><label for="title">Title</label><input id="title" name="title" required><button type="submit">Save</button></form></main>
<script>
var TASK_ID = null;
var MUTATION = ${JSON.stringify(mutation)};
function gql(q, v) { return fetch('/graphql', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: q, variables: v || {} }) }).then(function (r) { return r.json(); }); }
function load() { return gql('query Tasks { tasks { id title } }').then(function (d) { var t = d.data.tasks[0]; TASK_ID = t ? t.id : null; document.getElementById('current').textContent = t ? t.title : ''; }); }
document.getElementById('edit').addEventListener('submit', function (e) {
  e.preventDefault();
  var v = { title: document.getElementById('title').value };
  if (/\\$id\\b/.test(MUTATION)) v.id = TASK_ID;
  gql(MUTATION, v).then(load);
});
load();
</script></body></html>`,
    },
    routes: {
      "GET /favicon.ico": (_req, res) => {
        res.writeHead(204);
        res.end();
      },
      "POST /graphql": (req, res) => {
        const caller = callerOf(req);
        if (!caller) return send(res, 401, { errors: [{ message: "Sign in first" }] });
        const b = JSON.parse(req.body) as { query?: string; variables?: Record<string, unknown> };
        const q = String(b.query ?? "");
        const vars = b.variables ?? {};
        if (/^\s*mutation/.test(q)) {
          if (/createTask/.test(q)) {
            const t: Task = { id: `t${next++}`, owner: caller, title: String(vars.title ?? "") };
            tasks.push(t);
            return send(res, 200, { data: { createTask: { id: t.id, title: t.title } } });
          }
          const t = tasks.find((x) => x.id === vars.id && x.owner === caller);
          if (!t) return send(res, 200, { errors: [{ message: "Not found" }] });
          if (typeof vars.title === "string") t.title = vars.title;
          return send(res, 200, { data: { updateTask: { id: t.id, title: t.title } } });
        }
        return send(res, 200, { data: { tasks: tasks.filter((t) => t.owner === caller).map((t) => ({ id: t.id, title: t.title })) } });
      },
    },
  });
  servers.push(server);
  return Object.assign(server, { tasks });
}

async function discover(server: FixtureServer): Promise<DiscoveredPage> {
  const context = await browser.newContext({ storageState: session("a") });
  try {
    const p = await context.newPage();
    await p.goto(`${server.url}/app`);
    await p.getByRole("heading", { level: 1, name: "Task" }).waitFor();
    await p.waitForLoadState("networkidle");
    return await discoverPage(p);
  } finally {
    await context.close();
  }
}

async function run(server: FixtureServer, which: "other-account" | "signed-out"): Promise<CheckResult> {
  const discovered = await discover(server);
  const planned = check.plan(discovered.forms[0]!, discovered, { signedIn: true, otherAccount: true }).find((s) => s.id === `write-access:${which}`);
  if (!planned) throw new Error(`no write-access:${which} scenario`);
  const dir = await mkdtemp(join(tmpdir(), "rh-wa-graphql-"));
  dirs.push(dir);
  const ctx = createCheckContext({
    browser,
    form: discovered.forms[0]!,
    discoveredPage: discovered,
    targetUrl: `${server.url}/app`,
    artifactsDir: dir,
    runToken: RUN_TOKEN,
    checkId: "write-access",
    sessions: { self: session("a"), other: session("b") },
    accounts: { self: A, other: B },
    markers: [],
  });
  contexts.push(ctx);
  server.requests.length = 0;
  return check.run(ctx, { ...planned, scope: "form", formIndex: 0 } as Scenario);
}

const mutationsSent = (server: FixtureServer) => server.requests.filter((r) => r.method === "POST" && /"query":"\s*mutation/.test(r.body));

describe("write-access: a GraphQL edit form that renames a task Account A already had", () => {
  it.each(["other-account", "signed-out"] as const)("%s: stops the mutation before it reaches the app; the task is never written to", async (which) => {
    const server = await gqlApp("mutation UpdateTask($id: ID!, $title: String!) { updateTask(id: $id, title: $title) { id title } }");
    const result = await run(server, which);
    expect(server.tasks.find((t) => t.id === "t1")!.title).toBe("Groceries");
    expect(mutationsSent(server)).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(result.status, result.notes).toBe("skipped");
    expect(result.notes).toMatch(/changes a record Account A already had/);
    expect(result.notes).toMatch(/stopped the form's save \(POST \/graphql\) before it reached the app, so nothing was changed/);
  }, 60_000);
});

describe("write-access: a GraphQL create form whose record no GET reads back", () => {
  it("is skipped, and the note names the save, says it reached the app and asks to check Account A", async () => {
    const server = await gqlApp("mutation CreateTask($title: String!) { createTask(title: $title) { id title } }");
    const result = await run(server, "other-account");
    expect(mutationsSent(server)).toHaveLength(1);
    expect(server.tasks.find((t) => t.id === "t1")!.title).toBe("Groceries");
    expect(result.findings).toEqual([]);
    expect(result.status, result.notes).toBe("skipped");
    expect(result.notes).toMatch(/couldn't read the saved record back as Account A/);
    expect(result.notes).toMatch(/The form's own save \(POST \/graphql\) reached the app/);
    expect(result.notes).toMatch(/check Account A/);
    expect(result.notes).not.toMatch(/nothing was changed/);
  }, 60_000);
});
