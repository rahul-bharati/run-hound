/**
 * The existing-record hold (0.6.0 round 3, docs/v2-spec.md "Records Account A already had"): a write the form's submit
 * sends is judged before it reaches the app.
 *
 * - changesReadRecord reads a JSON body to any depth: an id the page read, on the object that holds the run's typed
 *   values or on any object on the way down to it, is an edit of that record, however deep the app's client wraps it
 *   (tRPC's batch {"0": {"json": {id, title}}}, Relay's {variables: {input: {id, title}}}, a bulk array). A reference
 *   to another record beside the typed values ({project: {id}}, projectId) still isn't.
 * - holdExistingEdits keeps judging every write that carries the typed values until it is released, not only the first
 *   one: a pre-save check (POST /api/profile/check) that goes through no longer lets the real save (POST /api/profile)
 *   through unjudged. After a save has gone through, a write that carries the values is judged by the ids and paths the
 *   page read before that save, not by its method, so the app's own update for the record it just created
 *   (PATCH /api/tasks/t3) still goes.
 */
import type { Browser } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeBrowser, getBrowser } from "../../../../test-support/harness.js";
import { startFixtureServer, type FixtureServer } from "../../../../test-support/server.js";
import type { CheckContext } from "../../../../src/core/types.js";
import { attachCapture } from "../../../../src/engine/capture.js";
import { changesReadRecord, holdExistingEdits } from "../../../../src/checks/lib/record-state.js";

const RUN_TOKEN = "Rs7e57a1";
/** A test value as canaryValues makes it: the run token, lower case, inside. */
const TEST_VALUE = "Task rs7e57a1ws";
const API = "http://localhost:4100";

describe("changesReadRecord: an id the page read, at any depth of the body", () => {
  const tasks = { url: `${API}/api/tasks`, body: JSON.stringify({ tasks: [{ id: "t1", title: "Groceries" }] }) };
  const projects = { url: `${API}/api/projects`, body: JSON.stringify([{ id: "p1", name: "Home" }]) };
  const trpcList = {
    url: `${API}/api/trpc/task.list?batch=1&input=${encodeURIComponent(JSON.stringify({ 0: { json: null } }))}`,
    body: JSON.stringify([{ result: { data: { json: [{ id: "t1", title: "Groceries" }] } } }]),
  };
  const post = (url: string, body: unknown) => ({ method: "POST", url: `${API}${url}`, postData: JSON.stringify(body) });
  const judge = (req: ReturnType<typeof post>, answers = [tasks, projects, trpcList]) => changesReadRecord(req, answers, RUN_TOKEN);

  it("stops tRPC's batch {\"0\": {\"json\": {id, title}}} naming a task the page read", () => {
    expect(judge(post("/api/trpc/task.update?batch=1", { 0: { json: { id: "t1", title: TEST_VALUE } } }), [trpcList])).toBe(true);
  });

  it("stops Relay's {variables: {input: {id, title}}} naming a task the page read", () => {
    const mutation = "mutation UpdateTask($input: UpdateTaskInput!) { updateTask(input: $input) { task { id title } } }";
    expect(judge(post("/graphql", { query: mutation, variables: { input: { id: "t1", title: TEST_VALUE } } }))).toBe(true);
    // Further down, with the typed values one more level below the id.
    expect(judge(post("/graphql", { operations: { variables: { input: { id: "t1", patch: { title: TEST_VALUE } } } } }))).toBe(true);
  });

  it("stops an id on the way down to the typed values, and a bulk array body", () => {
    // JSON:API's update: the id sits beside the attributes that hold the typed values.
    expect(judge(post("/api/tasks/update", { data: { id: "t1", type: "tasks", attributes: { title: TEST_VALUE } } }))).toBe(true);
    // A nested update of a project the page read: writes to that project.
    expect(judge(post("/api/save", { project: { id: "p1", task: { title: TEST_VALUE } } }))).toBe(true);
    expect(judge(post("/api/tasks/bulk", [{ id: "t1", title: TEST_VALUE }]))).toBe(true);
  });

  it("lets a create through at any depth: no id, or a reference to another record beside the typed values", () => {
    expect(judge(post("/api/trpc/task.create?batch=1", { 0: { json: { title: TEST_VALUE } } }), [trpcList])).toBe(false);
    expect(judge(post("/api/trpc/task.create?batch=1", { 0: { json: { title: TEST_VALUE, projectId: "p1" } } }))).toBe(false);
    expect(judge(post("/graphql", { query: "mutation", variables: { input: { title: TEST_VALUE, project: { id: "p1", name: "Home" } } } }))).toBe(false);
    expect(
      judge(post("/api/tasks/create", { data: { type: "tasks", attributes: { title: TEST_VALUE }, relationships: { project: { data: { id: "p1", type: "projects" } } } } })),
    ).toBe(false);
    expect(judge(post("/api/tasks/bulk", [{ title: TEST_VALUE, projectId: "p1" }]))).toBe(false);
    // An id nobody read is a new one, however deep.
    expect(judge(post("/api/trpc/task.update?batch=1", { 0: { json: { id: "t77", title: TEST_VALUE } } }))).toBe(false);
  });
});

let browser: Browser;
const servers: FixtureServer[] = [];
beforeAll(async () => {
  browser = await getBrowser();
});
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});
afterAll(closeBrowser);

/**
 * A page whose submit sends `writes` in turn (each a fetch with a JSON body built from the typed title, `$T`), after the
 * page read GET /api/tasks (Account A's task t1) and GET /api/profile (Account A's profile, one record).
 */
async function holdApp(writes: { method: string; path: string; body: string }[]): Promise<FixtureServer> {
  const chain = writes
    .map((w) => `.then(function () { return fetch(${JSON.stringify(w.path)}, { method: ${JSON.stringify(w.method)}, headers: { 'content-type': 'application/json' }, body: ${w.body} }).catch(function () {}); })`)
    .join("");
  const json = (res: import("node:http").ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const t1 = { id: "t1", title: "Groceries" };
  const server = await startFixtureServer({
    pages: {
      "/app": `<!doctype html><html lang="en"><head><title>Hold</title></head><body><main><h1>Hold</h1>
<form id="f"><label for="title">Title</label><input id="title" name="title"><button type="submit">Save</button></form><p id="done"></p></main>
<script>
Promise.all([fetch('/api/tasks').then(function (r) { return r.json(); }), fetch('/api/profile').then(function (r) { return r.json(); })]).then(function () { document.body.dataset.ready = '1'; });
document.getElementById('f').addEventListener('submit', function (e) {
  e.preventDefault();
  var T = document.getElementById('title').value;
  Promise.resolve()${chain.replace(/\$T/g, "T")}.then(function () { document.getElementById('done').textContent = 'done'; });
});
</script></body></html>`,
    },
    routes: {
      "GET /api/tasks": (_req, res) => json(res, 200, { tasks: [t1] }),
      // Renames task t1 server-side: the page can't tell from the request.
      "POST /api/today": (req, res) => {
        t1.title = String((JSON.parse(req.body) as { title?: string }).title ?? t1.title);
        json(res, 200, { ok: true });
      },
      "GET /api/profile": (_req, res) => json(res, 200, { displayName: "Alex", bio: "Hello" }),
      "POST /api/profile/check": (_req, res) => json(res, 200, { ok: true }),
      "POST /api/profile": (_req, res) => json(res, 200, { ok: true }),
      "POST /api/tasks": (_req, res) => json(res, 201, { task: { id: "t3" } }),
    },
    fallback: (_req, res) => json(res, 200, { ok: true }),
  });
  servers.push(server);
  return server;
}

/** Submits the hold app's form with TEST_VALUE under a hold; the writes that reached the server, and the hold. */
async function submitHeld(server: FixtureServer) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const capture = attachCapture(page);
    await page.goto(`${server.url}/app`);
    await page.waitForSelector("body[data-ready='1']");
    await page.waitForLoadState("networkidle");
    const ctx = { targetUrl: `${server.url}/app`, runToken: RUN_TOKEN, request: async () => ({ status: 500, headers: {}, body: "" }) } as unknown as CheckContext;
    server.requests.length = 0;
    const hold = await holdExistingEdits(ctx, page, capture);
    try {
      await page.fill("#title", TEST_VALUE);
      await page.click("button[type=submit]");
      await page.waitForSelector("#done:text('done')");
    } finally {
      await hold.release();
    }
    const reached = server.requests.filter((r) => r.method !== "GET").map((r) => `${r.method} ${new URL(r.url, "http://x").pathname}`);
    return { hold, reached };
  } finally {
    await context.close();
  }
}

describe("holdExistingEdits: every write that carries the typed values is judged until release", () => {
  it("stops the real save after a pre-save check went through: POST /api/profile/check, then POST /api/profile", async () => {
    const server = await holdApp([
      { method: "POST", path: "/api/profile/check", body: "JSON.stringify({ displayName: $T, bio: $T })" },
      { method: "POST", path: "/api/profile", body: "JSON.stringify({ displayName: $T, bio: $T })" },
    ]);
    const { hold, reached } = await submitHeld(server);
    expect(reached).toEqual(["POST /api/profile/check"]);
    expect(hold.stopped.map((w) => `${w.method} ${new URL(w.url).pathname}`)).toEqual(["POST /api/profile"]);
    const verdict = hold.verdict();
    expect(verdict).toMatch(/stopped the form's save \(POST \/api\/profile\)/);
    // The check did reach the app with the typed values: the note never says nothing at all was written.
    expect(verdict).toMatch(/POST \/api\/profile\/check/);
    expect(verdict).not.toMatch(/nothing was changed/);
  });

  it("stops an edit of a task the page read after a create went through: POST /api/tasks, then PATCH /api/tasks/t1", async () => {
    const server = await holdApp([
      { method: "POST", path: "/api/tasks", body: "JSON.stringify({ title: $T })" },
      { method: "PATCH", path: "/api/tasks/t1", body: "JSON.stringify({ title: $T })" },
    ]);
    const { hold, reached } = await submitHeld(server);
    expect(reached).toEqual(["POST /api/tasks"]);
    expect(hold.stopped.map((w) => `${w.method} ${new URL(w.url).pathname}`)).toEqual(["PATCH /api/tasks/t1"]);
    expect(hold.verdict()).toMatch(/stopped the form's save \(PATCH \/api\/tasks\/t1\)/);
  });

  it("gives no verdict when a write that went through before the stopped one changed a record the page read (POST /api/today renamed t1)", async () => {
    const server = await holdApp([
      { method: "POST", path: "/api/today", body: "JSON.stringify({ title: $T })" },
      { method: "PATCH", path: "/api/tasks/t1", body: "JSON.stringify({ title: $T, done: false })" },
    ]);
    const { hold, reached } = await submitHeld(server);
    expect(reached).toEqual(["POST /api/today"]);
    expect(hold.stopped.map((w) => `${w.method} ${new URL(w.url).pathname}`)).toEqual(["PATCH /api/tasks/t1"]);
    // Never "that record wasn't changed": the caller reads the record back and puts it back.
    expect(hold.verdict()).toBeNull();
  });

  it("lets the app's own update for the record it just created go: POST /api/tasks, then PATCH /api/tasks/t3, then a write without the values", async () => {
    const server = await holdApp([
      { method: "POST", path: "/api/tasks", body: "JSON.stringify({ title: $T })" },
      { method: "PATCH", path: "/api/tasks/t3", body: "JSON.stringify({ title: $T, done: false })" },
      { method: "DELETE", path: "/api/tasks/t3", body: "null" },
    ]);
    const { hold, reached } = await submitHeld(server);
    expect(reached).toEqual(["POST /api/tasks", "PATCH /api/tasks/t3", "DELETE /api/tasks/t3"]);
    expect(hold.stopped).toEqual([]);
    expect(hold.verdict()).toBeNull();
  });
});

describe("holdExistingEdits: readSoFar snapshots capture.requests before the first await (regression)", () => {
  /**
   * Regression: holdExistingEdits's readSoFar iterates capture.requests and, for a fetch/xhr GET to another local origin
   * whose body the capture did not keep, awaits ctx.request to re-read it as Account A. capture.requests is a live
   * array: a request the page emits during the await must not be observed by the in-progress read, or the hold would
   * judge a later write against ids the page had not actually read when the save was first seen.
   */
  it("does not learn a record the page read after readSoFar's first await", async () => {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const capture = attachCapture(page);
      const server = await startFixtureServer({
        pages: {
          "/app": `<!doctype html><html><body>
<form id="f"><input id="title" name="title"><button type="submit">Save</button></form>
<p id="done"></p>
<script>
document.getElementById('f').addEventListener('submit', function (e) {
  e.preventDefault();
  fetch('/api/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: document.getElementById('title').value }) })
    .then(function () { document.getElementById('done').textContent = 'done'; });
});
setTimeout(function () { document.body.dataset.ready = '1'; }, 50);
</script></body></html>`,
        },
        routes: {
          "POST /api/save": (_req, res) => {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
          },
        },
      });
      servers.push(server);
      await page.goto(`${server.url}/app`);
      await page.waitForSelector("body[data-ready='1']");
      // A fetch/xhr GET the page made to another local origin (different host:port); the capture drops the body because
      // it is cross-origin (other local), so readSoFar will call ctx.request to re-read it as Account A.
      const crossOriginUrl = `http://127.0.0.1:9999/api/page-read`;
      capture.requests.push({
        url: crossOriginUrl,
        method: "GET",
        resourceType: "fetch",
        postData: null,
        status: 200,
        failure: null,
        responseBody: null,
      });
      // A late-arriving request the page emits during readSoFar's await: it carries a record id but must not enter the
      // current read's snapshot (the bug: iterating the live array lets the push land in the loop).
      const lateUrl = `${crossOriginUrl}/late-record`;
      const lateBody = JSON.stringify({ task: { id: "tlate", title: "Late capture" } });
      const crossBody = JSON.stringify({ ok: true });
      const ctx: CheckContext = {
        targetUrl: `${server.url}/app`,
        runToken: RUN_TOKEN,
        request: async (_actor: string, _r: { method: string; url: string }) => {
          // Append a new entry to capture.requests after readSoFar has started iterating but during its await.
          capture.requests.push({
            url: lateUrl,
            method: "GET",
            resourceType: "fetch",
            postData: null,
            status: 200,
            failure: null,
            responseBody: lateBody,
          });
          return { status: 200, headers: {}, body: crossBody };
        },
      } as unknown as CheckContext;
      const hold = await holdExistingEdits(ctx, page, capture);
      await page.fill("#title", TEST_VALUE);
      await page.click("button[type=submit]");
      await page.waitForSelector("#done");
      await hold.release();
      // The cross-origin URL the page had read before the save: it was re-read via ctx.request, so it is present.
      const urls = hold.reads().map((a) => a.url);
      expect(urls).toContain(crossOriginUrl);
      // The late-appended URL arrived during the await and must not have been observed by this read.
      expect(urls).not.toContain(lateUrl);
    } finally {
      await context.close();
    }
  }, 60_000);
});
