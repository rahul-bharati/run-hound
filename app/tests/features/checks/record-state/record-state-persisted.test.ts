/**
 * The existing-record hold on a GraphQL app that sends persisted operations (docs/v2-spec.md "Records Account A already
 * had"): the page reads Account A's tasks with a POST that carries no query text, only a hash or a document id (Apollo's
 * automatic persisted queries: {operationName, variables, extensions: {persistedQuery}}; Relay's {doc_id, variables}).
 *
 * - The hold learns the ids those reads' answers hold, as it does for a POST query, so the form's persisted mutation
 *   that names one of them (in its variables, at any depth on the way to the typed values) is stopped before it reaches
 *   the app, as a change to a record Account A already had.
 * - A persisted mutation it can't judge (no id it read, and no operation name that says it creates a record) is stopped
 *   too, with the note that names the GraphQL save; a persisted create goes through.
 * - Such a read is never sent again: with no query text, Run Hound can't tell it from a mutation.
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

let browser: Browser;
const servers: FixtureServer[] = [];
beforeAll(async () => {
  browser = await getBrowser();
});
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});
afterAll(closeBrowser);

/** Apollo's hash-only read of Account A's tasks. */
const APQ_READ = { operationName: "Tasks", variables: {}, extensions: { persistedQuery: { version: 1, sha256Hash: "h-tasks" } } };
/** Relay's read of the same, by document id. */
const RELAY_READ = { doc_id: "h-tasks", variables: {} };

/** Hot Chocolate's read of the same, by persisted document id under `id`. */
const HOTCHOC_READ = { id: "h-tasks", variables: {} };

/** A persisted operation's hash or document id (Hot Chocolate's `id` too). */
const hashOf = (b: Record<string, unknown>) =>
  String(b.doc_id ?? b.documentId ?? b.id ?? ((b.extensions as { persistedQuery?: { sha256Hash?: string } } | undefined)?.persistedQuery?.sha256Hash ?? ""));

/**
 * A GraphQL page that sends persisted operations only. On load it sends `read` (Account A's tasks: t1 is Account A's
 * own). Its form sends `saves` in turn, each a JS expression over T (the typed value), ID (the first task the read gave)
 * and LAST (the id the previous save's answer held). The server knows h-tasks (a read), h-update (renames the task its
 * variables name) and h-create (adds a task, t9, and answers with every task). `applied` holds each mutation that
 * reached the app, by hash; `reads` counts the h-tasks reads.
 */
async function persistedApp(read: unknown, saves: string[]): Promise<FixtureServer & { applied: string[]; reads: () => number; tasks: { id: string; title: string }[] }> {
  const applied: string[] = [];
  const tasks = [{ id: "t1", title: "Groceries" }];
  let reads = 0;
  const server = await startFixtureServer({
    pages: {
      "/app": `<!doctype html><html lang="en"><head><title>GraphQL</title></head><body><main><h1>GraphQL</h1>
<form id="f"><label for="title">Title</label><input id="title" name="title"><button type="submit">Save</button></form><p id="done"></p></main>
<script>
var ID = null;
function send(b) { return fetch('/graphql', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then(function (r) { return r.json(); }); }
send(${JSON.stringify(read)}).then(function (d) { ID = d.data.tasks[0].id; document.body.dataset.ready = '1'; });
var SAVES = [${saves.map((s) => `function (T, ID, LAST) { return (${s}); }`).join(", ")}];
document.getElementById('f').addEventListener('submit', function (e) {
  e.preventDefault();
  var T = document.getElementById('title').value;
  var LAST = null;
  SAVES.reduce(function (p, s) {
    return p.then(function () {
      return send(s(T, ID, LAST)).then(function (d) { var r = d && d.data && d.data.result; if (r && r.id) LAST = r.id; }).catch(function () {});
    });
  }, Promise.resolve()).then(function () { document.getElementById('done').textContent = 'done'; });
});
</script></body></html>`,
    },
    routes: {
      "POST /graphql": (req, res) => {
        const body = JSON.parse(req.body) as Record<string, unknown>;
        const hash = hashOf(body);
        const vars = (body.variables ?? {}) as { id?: string; title?: string; input?: { id?: string; title?: string } };
        const input = vars.input ?? vars;
        let data: unknown;
        if (hash === "h-tasks") {
          reads += 1;
          data = { tasks };
        } else if (hash === "h-update") {
          applied.push(hash);
          const t = tasks.find((x) => x.id === input.id);
          if (t && typeof input.title === "string") t.title = input.title;
          data = { result: t ?? null };
        } else if (hash === "h-create") {
          applied.push(hash);
          tasks.push({ id: "t9", title: String(input.title ?? "") });
          data = { result: { id: "t9", tasks } };
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(data === undefined ? { errors: [{ message: "PersistedQueryNotFound" }] } : { data }));
      },
    },
  });
  servers.push(server);
  return Object.assign(server, { applied, reads: () => reads, tasks });
}

/** Submits the page's form with TEST_VALUE under a hold; the hold, once released. */
async function submitHeld(server: FixtureServer) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const capture = attachCapture(page);
    await page.goto(`${server.url}/app`);
    await page.waitForSelector("body[data-ready='1']");
    await page.waitForLoadState("networkidle");
    const ctx = { targetUrl: `${server.url}/app`, runToken: RUN_TOKEN, request: async () => ({ status: 500, headers: {}, body: "" }) } as unknown as CheckContext;
    const hold = await holdExistingEdits(ctx, page, capture);
    try {
      await page.fill("#title", TEST_VALUE);
      await page.click("button[type=submit]");
      await page.waitForSelector("#done:text('done')");
    } finally {
      await hold.release();
    }
    return hold;
  } finally {
    await context.close();
  }
}

const apq = (operationName: string, hash: string, variables: string) =>
  `{ operationName: ${JSON.stringify(operationName)}, variables: ${variables}, extensions: { persistedQuery: { version: 1, sha256Hash: ${JSON.stringify(hash)} } } }`;

describe("holdExistingEdits on a GraphQL app that sends persisted operations (hash or document id, no query text)", () => {
  it("Apollo APQ: stops the hash-only update naming the task the page read by hash, as a change to that record", async () => {
    const server = await persistedApp(APQ_READ, [apq("UpdateTask", "h-update", "{ id: ID, title: T }")]);
    const hold = await submitHeld(server);
    expect(server.applied).toEqual([]);
    expect(server.tasks.find((t) => t.id === "t1")?.title).toBe("Groceries");
    const verdict = hold.verdict();
    // Judged by the id it learned from the hash-only read, not only by the mutation's name.
    expect(verdict).toMatch(/changes a record Account A already had/);
    expect(verdict).toMatch(/stopped the form's save \(POST \/graphql\) before it reached the app, so nothing was changed/);
  });

  it("Relay doc_id: stops a mutation whose input names the task the page read by document id", async () => {
    const server = await persistedApp(RELAY_READ, ["{ doc_id: 'h-update', variables: { input: { id: ID, title: T } } }"]);
    const hold = await submitHeld(server);
    expect(server.applied).toEqual([]);
    expect(server.tasks.find((t) => t.id === "t1")?.title).toBe("Groceries");
    expect(hold.verdict()).toMatch(/changes a record Account A already had/);
    expect(hold.verdict()).toMatch(/so nothing was changed/);
  });

  it("Relay doc_id with no operation name and no id it read: held as a GraphQL save it can't judge, never written", async () => {
    const server = await persistedApp(RELAY_READ, ["{ doc_id: 'h-create', variables: { input: { title: T } } }"]);
    const hold = await submitHeld(server);
    expect(server.applied).toEqual([]);
    const verdict = hold.verdict();
    expect(verdict).toMatch(/GraphQL mutation \(a persisted query\)/);
    expect(verdict).toMatch(/stopped the form's save \(POST \/graphql\) before it reached the app, so nothing was changed/);
  });

  it("Hot Chocolate {id, variables}: stops an edit whose input names the task the page read by persisted id", async () => {
    const server = await persistedApp(HOTCHOC_READ, ["{ id: 'h-update', variables: { input: { id: ID, title: T } } }"]);
    const hold = await submitHeld(server);
    expect(server.applied).toEqual([]);
    expect(server.tasks.find((t) => t.id === "t1")?.title).toBe("Groceries");
    expect(hold.verdict()).toMatch(/changes a record Account A already had/);
    expect(hold.verdict()).toMatch(/so nothing was changed/);
  });

  it("lets a persisted create through: Apollo APQ CreateTask, and Relay doc_id with operationName CreateTask", async () => {
    const a = await persistedApp(APQ_READ, [apq("CreateTask", "h-create", "{ title: T }")]);
    const heldA = await submitHeld(a);
    expect(a.applied).toEqual(["h-create"]);
    expect(heldA.stopped).toEqual([]);
    expect(heldA.verdict()).toBeNull();

    const b = await persistedApp(RELAY_READ, ["{ doc_id: 'h-create', operationName: 'CreateTask', variables: { input: { title: T } } }"]);
    const heldB = await submitHeld(b);
    expect(b.applied).toEqual(["h-create"]);
    expect(heldB.stopped).toEqual([]);
  });

  it("after the create went through, stops a later hash-only update of the task the page read, and never sends the hash-only read again", async () => {
    // The create's answer lists every task (t1 too), so only the id learned from the read tells t1 from the new task.
    const server = await persistedApp(APQ_READ, [apq("CreateTask", "h-create", "{ title: T }"), apq("UpdateTask", "h-update", "{ id: ID, title: T }")]);
    const hold = await submitHeld(server);
    expect(server.applied).toEqual(["h-create"]);
    expect(server.tasks.find((t) => t.id === "t1")?.title).toBe("Groceries");
    expect(hold.stopped.map((w) => `${w.method} ${new URL(w.url).pathname}`)).toEqual(["POST /graphql"]);
    // The page's own read on load only: a persisted operation may be a mutation, so Run Hound never replays one.
    expect(server.reads()).toBe(1);
    expect(hold.verdict() ?? "").not.toMatch(/nothing was changed/);
  });
});

/**
 * A REST app whose record read carries a `doc_id` or `documentId` query parameter (GET /api/note?doc_id=n1, answering
 * one record with no id), and whose form POSTs to that same URL: that GET is not a persisted GraphQL read, so its path
 * is a record the page read, and the save to it is stopped before it writes to Account A's note.
 */
async function restNoteApp(path: string): Promise<FixtureServer & { note: { title: string; body: string }; writes: () => number }> {
  const note = { title: "Groceries", body: "milk" };
  let writes = 0;
  const pathname = new URL(path, "http://x").pathname;
  const server = await startFixtureServer({
    pages: {
      "/app": `<!doctype html><html lang="en"><head><title>Note</title></head><body><main><h1>Note</h1>
<form id="f"><label for="title">Title</label><input id="title" name="title"><button type="submit">Save</button></form><p id="done"></p></main>
<script>
fetch(${JSON.stringify(path)}).then(function (r) { return r.json(); }).then(function () { document.body.dataset.ready = '1'; });
document.getElementById('f').addEventListener('submit', function (e) {
  e.preventDefault();
  fetch(${JSON.stringify(path)}, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: document.getElementById('title').value }) })
    .catch(function () {}).then(function () { document.getElementById('done').textContent = 'done'; });
});
</script></body></html>`,
    },
    routes: {
      [`GET ${pathname}`]: (_req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(note));
      },
      [`POST ${pathname}`]: (req, res) => {
        writes += 1;
        const body = JSON.parse(req.body) as { title?: string };
        if (typeof body.title === "string") note.title = body.title;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(note));
      },
    },
  });
  servers.push(server);
  return Object.assign(server, { note, writes: () => writes });
}

describe("a GET with doc_id or documentId is a persisted GraphQL read only when it looks like GraphQL over HTTP", () => {
  const API = "http://localhost:4100";
  const saveTo = (url: string) => ({ method: "POST", url, postData: JSON.stringify({ title: TEST_VALUE }) });

  it("changesReadRecord: a REST record read at ?doc_id= or ?documentId= keeps its path, so a save to it is stopped", () => {
    const note = JSON.stringify({ title: "Groceries", body: "milk" });
    for (const url of [`${API}/api/note?doc_id=n1`, `${API}/api/doc/view?documentId=n1`]) {
      expect(changesReadRecord(saveTo(url), [{ url, body: note }], RUN_TOKEN)).toBe(true);
    }
    // doc_id beside variables and another key that isn't a GraphQL request key is still REST.
    const mixed = `${API}/api/note?doc_id=n1&variables=%7B%7D&lang=en`;
    expect(changesReadRecord(saveTo(mixed), [{ url: mixed, body: note }], RUN_TOKEN)).toBe(true);
  });

  it("changesReadRecord: Relay's GET by document id with variables still gives its ids, never its path", () => {
    const tasks = JSON.stringify({ data: { tasks: [{ id: "t1", title: "Groceries" }] } });
    for (const url of [`${API}/graphql?doc_id=h-tasks&variables=%7B%7D`, `${API}/graphql?documentId=h-tasks&operationName=Tasks&variables=%7B%7D`]) {
      const read = [{ url, body: tasks }];
      const create = { doc_id: "h-create", operationName: "CreateTask", variables: { input: { title: TEST_VALUE } } };
      expect(changesReadRecord({ method: "POST", url: `${API}/graphql`, postData: JSON.stringify(create) }, read, RUN_TOKEN)).toBe(false);
      const update = { doc_id: "h-update", variables: { input: { id: "t1", title: TEST_VALUE } } };
      expect(changesReadRecord({ method: "POST", url: `${API}/graphql`, postData: JSON.stringify(update) }, read, RUN_TOKEN)).toBe(true);
    }
  });

  for (const path of ["/api/note?doc_id=n1", "/api/doc/view?documentId=n1"]) {
    it(`holdExistingEdits: stops the form's POST ${path} after the page read that record, and nothing is written`, async () => {
      const server = await restNoteApp(path);
      const hold = await submitHeld(server);
      expect(server.writes()).toBe(0);
      expect(server.note.title).toBe("Groceries");
      expect(hold.stopped.map((w) => w.method)).toEqual(["POST"]);
      expect(hold.verdict()).toMatch(/changes a record Account A already had/);
      expect(hold.verdict()).toMatch(/so nothing was changed/);
    });
  }
});
