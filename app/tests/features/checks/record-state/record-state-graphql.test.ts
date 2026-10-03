/**
 * The existing-record hold on a GraphQL app (0.6.0 close-out round 1, docs/v2-spec.md "Records Account A already had"):
 * a GraphQL app reads with POST /graphql (Apollo Client's default), so the hold learns ids from those reads too.
 *
 * - changesReadRecord takes a GraphQL read sent as a POST (`post`: its query body) or as a GET (?query=) for the ids its
 *   answer holds, never for its path: /graphql serves every operation, so a mutation to it is not a write to a record
 *   the page read at that path. A mutation that names an id the page read (in its variables, at any depth on the way to
 *   the typed values, or as a literal argument in its query text) is an edit of that record.
 * - unclearGraphQlSave: a GraphQL mutation whose root fields don't all read as a create (createTask, taskCreate,
 *   insert_tasks_one, addComment) is one Run Hound can't tell from an edit of a record Account A already had
 *   (updateProfile has no id to go by). It gives the fields' names for the note, or null.
 * - holdExistingEdits stops the form's own GraphQL save in either case, before it reaches the app, and says so; a
 *   create mutation goes through.
 */
import type { Browser } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeBrowser, getBrowser } from "../../../support/harness.js";
import { startFixtureServer, type FixtureServer } from "../../../support/server.js";
import type { CheckContext } from "../../../../src/core/types.js";
import { attachCapture } from "../../../../src/engine/capture.js";
import { changesReadRecord, holdExistingEdits, unclearGraphQlSave } from "../../../../src/checks/lib/record-state.js";

const RUN_TOKEN = "Rs7e57a1";
/** A test value as canaryValues makes it: the run token, lower case, inside. */
const TEST_VALUE = "Task rs7e57a1ws";
const API = "http://localhost:4100";

const TASKS_QUERY = "query Tasks { tasks { id title } }";
/** Apollo's POST read of Account A's tasks: t1 is Account A's own. */
const gqlRead = {
  url: `${API}/graphql`,
  post: JSON.stringify({ query: TASKS_QUERY, variables: {} }),
  body: JSON.stringify({ data: { tasks: [{ id: "t1", title: "Groceries" }] } }),
};
/** The same read as Relay sends it, a GET with the query in the URL. */
const relayRead = {
  url: `${API}/graphql?query=${encodeURIComponent(TASKS_QUERY)}`,
  body: JSON.stringify({ data: { tasks: [{ id: "t1", title: "Groceries" }] } }),
};
const post = (body: unknown) => ({ method: "POST", url: `${API}/graphql`, postData: JSON.stringify(body) });

describe("changesReadRecord on a GraphQL app: ids from its reads, never its path", () => {
  it("stops a mutation naming a task the page read with a POST query (Apollo)", () => {
    const update = { query: "mutation UpdateTask($id: ID!, $title: String!) { updateTask(id: $id, title: $title) { id title } }", variables: { id: "t1", title: TEST_VALUE } };
    expect(changesReadRecord(post(update), [gqlRead], RUN_TOKEN)).toBe(true);
    // Without the read, nothing says t1 is Account A's.
    expect(changesReadRecord(post(update), [], RUN_TOKEN)).toBe(false);
  });

  it("stops a mutation naming the id as a literal argument in its query text", () => {
    const inline = { query: `mutation { updateTask(id: "t1", title: "${TEST_VALUE}") { id } }` };
    expect(changesReadRecord(post(inline), [gqlRead], RUN_TOKEN)).toBe(true);
    const numeric = {
      query: `mutation { updateTask(id: 7, title: "${TEST_VALUE}") { id } }`,
    };
    const numericRead = { ...gqlRead, body: JSON.stringify({ data: { tasks: [{ id: 7, title: "Groceries" }] } }) };
    expect(changesReadRecord(post(numeric), [numericRead], RUN_TOKEN)).toBe(true);
    // A literal id nobody read is a new one.
    expect(changesReadRecord(post({ query: `mutation { updateTask(id: "t77", title: "${TEST_VALUE}") { id } }` }), [gqlRead], RUN_TOKEN)).toBe(false);
  });

  it("lets a create mutation through: a GraphQL read's path is not a record the page read", () => {
    const create = { query: "mutation CreateTask($title: String!) { createTask(title: $title) { id } }", variables: { title: TEST_VALUE } };
    expect(changesReadRecord(post(create), [gqlRead], RUN_TOKEN)).toBe(false);
    expect(changesReadRecord(post(create), [relayRead], RUN_TOKEN)).toBe(false);
  });

  it("stops Relay's update naming a task the page read with a GET query", () => {
    const update = { query: "mutation UpdateTask($input: UpdateTaskInput!) { updateTask(input: $input) { task { id } } }", variables: { input: { id: "t1", title: TEST_VALUE } } };
    expect(changesReadRecord(post(update), [relayRead], RUN_TOKEN)).toBe(true);
  });

  it("still reads a REST path the page read as one record (GET /api/profile, then POST /api/profile)", () => {
    const profile = { url: `${API}/api/profile`, body: JSON.stringify({ displayName: "Alex" }) };
    expect(changesReadRecord({ method: "POST", url: `${API}/api/profile`, postData: JSON.stringify({ displayName: TEST_VALUE }) }, [profile], RUN_TOKEN)).toBe(true);
  });
});

describe("unclearGraphQlSave: a GraphQL mutation that doesn't read as a create", () => {
  const q = (query: string, variables: unknown = {}) => JSON.stringify({ query, variables });

  it.each([
    ["mutation UpdateMe($name: String!) { updateProfile(name: $name) { id } }", "updateProfile"],
    ["mutation { upsertTask(title: \"x\") { id } }", "upsertTask"],
    ["mutation Save($t: String!) { saveSettings(theme: $t) { ok } }", "saveSettings"],
    ["mutation { renameTask(title: \"x\") { id } createTask(title: \"y\") { id } }", "renameTask"],
    ["mutation { me: viewerUpdate(input: {name: \"x\"}) { viewer { id } } }", "viewerUpdate"],
    // "post" and "log" are nouns too: only a create verb that leads the name (or create, add, insert ending it) counts.
    ["mutation { likePost(id: 1) { id } }", "likePost"],
    ["mutation { pinLog(id: 1) { id } }", "pinLog"],
    // A create verb before the one record of its kind the account has (0.6.0 close-out round 2): it saves that record.
    ["mutation S($t: String!) { submitProfile(name: $t) { id } }", "submitProfile"],
    ["mutation { sendSettings(theme: \"x\") { ok } }", "sendSettings"],
    ["mutation { postMyPreferences(theme: \"x\") { ok } }", "postMyPreferences"],
    ["mutation { accountCreate(input: {name: \"x\"}) { id } }", "accountCreate"],
    ["mutation { logViewer(name: \"x\") { id } }", "logViewer"],
    ["mutation { makeMe(name: \"x\") { id } }", "makeMe"],
  ])("%s gives %s", (query, name) => {
    expect(unclearGraphQlSave(q(query))).toBe(name);
  });

  it.each([
    "mutation CreateTask($title: String!) { createTask(title: $title) { id } }",
    "mutation { t: taskCreate(input: {title: \"x\"}) { task { id } } }",
    "mutation { insert_tasks_one(object: {title: \"x\"}) { id } }",
    "mutation AddComment($b: String!) { addComment(body: $b) { id } }",
    "mutation { postComment(body: \"x\") { id } }",
    "mutation { productAdd(input: {title: \"x\"}) { id } }",
    "# a comment with mutation { updateTask }\nmutation { newTask(title: \"x\") { id } }",
    // Only the thing it makes counts: a note on a profile is a new record.
    "mutation { createProfileNote(body: \"x\") { id } }",
  ])("lets a create through: %s", (query) => {
    expect(unclearGraphQlSave(q(query))).toBeNull();
  });

  it("is null for what isn't a GraphQL mutation: a query, a REST body, no body", () => {
    expect(unclearGraphQlSave(q("query Tasks { tasks { id } }"))).toBeNull();
    expect(unclearGraphQlSave(q("{ tasks { id } }"))).toBeNull();
    expect(unclearGraphQlSave(JSON.stringify({ title: TEST_VALUE }))).toBeNull();
    expect(unclearGraphQlSave("title=x")).toBeNull();
    expect(unclearGraphQlSave(null)).toBeNull();
  });

  it("judges a persisted query (no query text) by its operation name, and a batch by every operation", () => {
    const persisted = (operationName: string) => JSON.stringify({ operationName, variables: { name: TEST_VALUE }, extensions: { persistedQuery: { version: 1, sha256Hash: "ab12" } } });
    expect(unclearGraphQlSave(persisted("SaveProfile"))).toBe("SaveProfile");
    expect(unclearGraphQlSave(persisted("CreateTask"))).toBeNull();
    const batch = JSON.stringify([
      { query: "mutation { createTask(title: \"x\") { id } }" },
      { query: "mutation { updateProfile(name: \"y\") { id } }" },
    ]);
    expect(unclearGraphQlSave(batch)).toBe("updateProfile");
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
 * A GraphQL page: it reads with `read` (a POST query) on load, and its form sends `mutation` with the typed value as
 * $title (and TASK_ID, the first task it read, as $id when the mutation takes one).
 */
async function gqlApp(read: string, mutation: string): Promise<FixtureServer & { applied: string[] }> {
  const applied: string[] = [];
  const server = await startFixtureServer({
    pages: {
      "/app": `<!doctype html><html lang="en"><head><title>GraphQL</title></head><body><main><h1>GraphQL</h1>
<form id="f"><label for="title">Title</label><input id="title" name="title"><button type="submit">Save</button></form><p id="done"></p></main>
<script>
var TASK_ID = null;
function gql(q, v) { return fetch('/graphql', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: q, variables: v || {} }) }).then(function (r) { return r.json(); }); }
gql(${JSON.stringify(read)}).then(function (d) { var t = (d.data.tasks || [])[0]; TASK_ID = t ? t.id : null; document.body.dataset.ready = '1'; });
// The form's mutation takes $id only when it declares one.
var NEEDS_ID = /\\$id\\b/.test(${JSON.stringify(mutation)});
document.getElementById('f').addEventListener('submit', function (e) {
  e.preventDefault();
  var v = { title: document.getElementById('title').value };
  if (NEEDS_ID) v.id = TASK_ID;
  gql(${JSON.stringify(mutation)}, v).catch(function () {}).then(function () { document.getElementById('done').textContent = 'done'; });
});
</script></body></html>`,
    },
    routes: {
      "POST /graphql": (req, res) => {
        const body = JSON.parse(req.body) as { query: string };
        const mutation = /^\s*mutation/.test(body.query);
        if (mutation) applied.push(body.query);
        res.writeHead(200, { "content-type": "application/json" });
        const data = mutation ? { ok: true } : /\btasks\b/.test(body.query) ? { tasks: [{ id: "t1", title: "Groceries" }] } : { me: { name: "Alex" } };
        res.end(JSON.stringify({ data }));
      },
    },
  });
  servers.push(server);
  return Object.assign(server, { applied });
}

/** Submits the GraphQL page's form with TEST_VALUE under a hold; the mutations that reached the app, and the hold. */
async function submitHeld(server: FixtureServer & { applied: string[] }) {
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
    return { hold, applied: [...server.applied] };
  } finally {
    await context.close();
  }
}

describe("holdExistingEdits on a GraphQL app (reads and writes are POST /graphql)", () => {
  it("stops a mutation that renames a task the page read with a POST query: nothing reaches the app", async () => {
    const server = await gqlApp(TASKS_QUERY, "mutation UpdateTask($id: ID!, $title: String!) { updateTask(id: $id, title: $title) { id title } }");
    const { hold, applied } = await submitHeld(server);
    expect(applied).toEqual([]);
    expect(hold.stopped.map((w) => `${w.method} ${new URL(w.url).pathname}`)).toEqual(["POST /graphql"]);
    const verdict = hold.verdict();
    expect(verdict).toMatch(/changes a record Account A already had/);
    expect(verdict).toMatch(/stopped the form's save \(POST \/graphql\) before it reached the app, so nothing was changed/);
  });

  it("stops a mutation with no id whose name doesn't say it creates a record (updateProfile), and says why", async () => {
    const server = await gqlApp("query Me { me { name } }", "mutation UpdateMe($title: String!) { updateProfile(name: $title) { name } }");
    const { hold, applied } = await submitHeld(server);
    expect(applied).toEqual([]);
    const verdict = hold.verdict();
    expect(verdict).toMatch(/GraphQL mutation \(updateProfile\)/);
    expect(verdict).toMatch(/stopped the form's save \(POST \/graphql\) before it reached the app, so nothing was changed/);
    expect(verdict).not.toMatch(/changes a record Account A already had/);
  });

  it("lets a create mutation through", async () => {
    const server = await gqlApp(TASKS_QUERY, "mutation CreateTask($title: String!) { createTask(title: $title) { id } }");
    const { hold, applied } = await submitHeld(server);
    expect(applied).toHaveLength(1);
    expect(hold.stopped).toEqual([]);
    expect(hold.verdict()).toBeNull();
  });
});

/**
 * A GraphQL page whose form sends `steps` in turn (0.6.0 close-out round 2): each a mutation with variables built by a
 * JS expression over T (the typed value) and LAST (the id the previous mutation's answer held). It reads Account A's
 * profile (u1) and task t1 with POST queries on load. Every mutation answers with a new task id, t9.
 */
async function gqlSteps(steps: { query: string; variables: string }[]): Promise<FixtureServer & { applied: string[] }> {
  const applied: string[] = [];
  const server = await startFixtureServer({
    pages: {
      "/app": `<!doctype html><html lang="en"><head><title>GraphQL</title></head><body><main><h1>GraphQL</h1>
<form id="f"><label for="title">Title</label><input id="title" name="title"><button type="submit">Save</button></form><p id="done"></p></main>
<script>
function gql(q, v) { return fetch('/graphql', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: q, variables: v || {} }) }).then(function (r) { return r.json(); }); }
Promise.all([gql('query Me { me { id name } }'), gql(${JSON.stringify(TASKS_QUERY)})]).then(function () { document.body.dataset.ready = '1'; });
var STEPS = [${steps.map((st) => `{ q: ${JSON.stringify(st.query)}, v: function (T, LAST) { return (${st.variables}); } }`).join(", ")}];
document.getElementById('f').addEventListener('submit', function (e) {
  e.preventDefault();
  var T = document.getElementById('title').value;
  var LAST = null;
  STEPS.reduce(function (p, st) {
    return p.then(function () {
      return gql(st.q, st.v(T, LAST)).then(function (d) { var r = d && d.data && d.data.result; if (r && r.id) LAST = r.id; }).catch(function () {});
    });
  }, Promise.resolve()).then(function () { document.getElementById('done').textContent = 'done'; });
});
</script></body></html>`,
    },
    routes: {
      "POST /graphql": (req, res) => {
        const body = JSON.parse(req.body) as { query: string };
        const mutation = /^\s*mutation/.test(body.query);
        if (mutation) applied.push(body.query);
        res.writeHead(200, { "content-type": "application/json" });
        const data = mutation ? { result: { id: "t9" } } : /\btasks\b/.test(body.query) ? { tasks: [{ id: "t1", title: "Groceries" }] } : { me: { id: "u1", name: "Alex" } };
        res.end(JSON.stringify({ data }));
      },
    },
  });
  servers.push(server);
  return Object.assign(server, { applied });
}

const CREATE = { query: "mutation C($title: String!) { createTask(title: $title) { id } }", variables: "{ title: T }" };
const fieldOf = (query: string) => /\{\s*(\w+)/.exec(query)?.[1];

describe("holdExistingEdits on a GraphQL app, after the form's create went through (0.6.0 close-out round 2)", () => {
  it("stops a later mutation carrying the typed value that doesn't read as a create and names no new record (updateProfile)", async () => {
    const server = await gqlSteps([CREATE, { query: "mutation U($title: String!) { updateProfile(name: $title) { id name } }", variables: "{ title: T }" }]);
    const { hold, applied } = await submitHeld(server);
    expect(applied.map(fieldOf)).toEqual(["createTask"]);
    expect(hold.stopped.map((w) => w.graphql)).toEqual(["updateProfile"]);
    const verdict = hold.verdict();
    expect(verdict).toMatch(/GraphQL mutation \(updateProfile\)/);
    // The create did reach the app; the note never says nothing was written.
    expect(verdict).toMatch(/did reach the app/);
    expect(verdict).not.toMatch(/nothing was changed/);
  });

  it("stops one that names an id no save answered with (another of Account A's records, by an id the page never read)", async () => {
    const server = await gqlSteps([CREATE, { query: "mutation U($userId: ID!, $title: String!) { updateProfile(userId: $userId, name: $title) { id } }", variables: "{ userId: 'u7', title: T }" }]);
    const { hold, applied } = await submitHeld(server);
    expect(applied.map(fieldOf)).toEqual(["createTask"]);
    expect(hold.stopped.map((w) => w.graphql)).toEqual(["updateProfile"]);
  });

  it("lets the app's own update of the record the create made through: it names the id the create's answer held", async () => {
    const server = await gqlSteps([CREATE, { query: "mutation U($id: ID!, $title: String!) { updateTask(id: $id, title: $title) { id } }", variables: "{ id: LAST, title: T }" }]);
    const { hold, applied } = await submitHeld(server);
    expect(applied.map(fieldOf)).toEqual(["createTask", "updateTask"]);
    expect(hold.stopped).toEqual([]);
    expect(hold.verdict()).toBeNull();
  });

  it("stops submitProfile before any save: a create verb before a singleton noun is no create", async () => {
    const server = await gqlSteps([{ query: "mutation S($title: String!) { submitProfile(name: $title) { id name } }", variables: "{ title: T }" }]);
    const { hold, applied } = await submitHeld(server);
    expect(applied).toEqual([]);
    expect(hold.verdict()).toMatch(/GraphQL mutation \(submitProfile\)/);
    expect(hold.verdict()).toMatch(/so nothing was changed/);
  });
});
