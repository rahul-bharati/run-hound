/**
 * record-state (0.5.0, docs/v2-spec.md "Types and shared helpers"): finding, snapshotting, re-reading and restoring the
 * run's own test record. Driven with a fake CheckContext whose request() answers from an in-memory store, and which
 * records every request it was sent, so the tests can check what was (and was never) written.
 */
import { describe, expect, it } from "vitest";
import type { Capture, CheckContext, IdentityRequest, IdentityResponse } from "../../core/types.js";
import {
  changedFields,
  findOwnRecord,
  jsonObjectBody,
  locateRecord,
  nearest,
  neverWritten,
  readsList,
  recordChains,
  recordId,
  recordWrites,
  rereadRecord,
  restoreRecord,
  snapshotFrom,
  snapshotRecord,
  urlNamesId,
  type CapturedRequest,
  type JsonObject,
} from "./record-state.js";

const TARGET = "http://localhost:4100/app";
const RUN_TOKEN = "Rs7e57a1";
/** A test value as canaryValues makes it: the run token, lower case, inside. */
const TEST_VALUE = "Task rs7e57a1ws";

type Handler = (req: IdentityRequest & { as: string }) => IdentityResponse | Promise<IdentityResponse>;

function fakeContext(handler: Handler): { ctx: CheckContext; sent: (IdentityRequest & { as: string })[] } {
  const sent: (IdentityRequest & { as: string })[] = [];
  const ctx = {
    targetUrl: TARGET,
    runToken: RUN_TOKEN,
    request: async (as: string, req: IdentityRequest) => {
      sent.push({ as, ...req });
      return handler({ as, ...req });
    },
  } as unknown as CheckContext;
  return { ctx, sent };
}

const ok = (body: unknown): IdentityResponse => ({ status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const status = (code: number): IdentityResponse => ({ status: code, headers: {}, body: "" });

function captured(r: Partial<CapturedRequest> & { url: string }): CapturedRequest {
  return { method: "GET", resourceType: "fetch", postData: null, status: 200, failure: null, responseBody: null, ...r };
}

/**
 * A tiny tasks API: GET /api/tasks lists Account A's tasks (one of them the test record), PATCH /api/tasks/:id updates
 * one (JSON or form-encoded), POST /api/tasks creates one. `keep` names fields the server refuses to change.
 */
function tasksApi(options: { keep?: string[] } = {}) {
  const tasks: JsonObject[] = [
    { id: 1, title: "Account A's own task", done: false },
    { id: 7, title: TEST_VALUE, done: false, notes: "" },
  ];
  let next = 8;
  const handler: Handler = (req) => {
    const url = new URL(req.url);
    const method = (req.method ?? "GET").toUpperCase();
    if (method === "GET" && url.pathname === "/api/tasks") return ok({ user: { name: "alex" }, tasks });
    if (method === "POST" && url.pathname === "/api/tasks") {
      const task = { id: next++, done: false, notes: "", ...(JSON.parse(req.body ?? "{}") as JsonObject) };
      tasks.push(task);
      return ok(task);
    }
    const m = /^\/api\/tasks\/(\d+)$/.exec(url.pathname);
    const task = m ? tasks.find((t) => t.id === Number(m[1])) : undefined;
    if (!task) return status(404);
    if (method === "PATCH") {
      const body: JsonObject = req.headers?.["content-type"]?.includes("json")
        ? (JSON.parse(req.body ?? "{}") as JsonObject)
        : Object.fromEntries(new URLSearchParams(req.body ?? ""));
      if (typeof body.done === "string") body.done = body.done === "true";
      for (const [k, v] of Object.entries(body)) if (!options.keep?.includes(k)) task[k] = v;
      return ok(task);
    }
    return status(405);
  };
  return { tasks, handler };
}

describe("recordChains and nearest (moved from mass-assignment)", () => {
  it("returns the chain from the record holding a test value up to the root, never a list of other records", () => {
    const json = { user: { role: "user" }, tasks: [{ id: 1, title: "other" }, { id: 7, title: TEST_VALUE }] };
    const chains = recordChains(json, [TEST_VALUE]);
    expect(chains).toHaveLength(1);
    expect(chains[0]![0]).toEqual({ id: 7, title: TEST_VALUE });
    expect(chains[0]![1]).toBe(json);
    expect(nearest(chains[0]!, "id")).toEqual({ found: true, value: 7 });
    expect(nearest(chains[0]!, "user")).toEqual({ found: true, value: { role: "user" } });
    expect(nearest(chains[0]!, "role")).toEqual({ found: false });
  });

  it("gives one chain per record even when it holds several test values", () => {
    expect(recordChains({ a: TEST_VALUE, b: `${TEST_VALUE} notes` }, [TEST_VALUE])).toHaveLength(1);
    expect(recordChains([TEST_VALUE], [TEST_VALUE])).toEqual([]);
  });
});

describe("jsonObjectBody, recordId and changedFields", () => {
  it("accepts only JSON objects", () => {
    expect(jsonObjectBody('{"a":1}')).toEqual({ a: 1 });
    expect(jsonObjectBody("[1]")).toBeNull();
    expect(jsonObjectBody("a=1")).toBeNull();
    expect(jsonObjectBody(null)).toBeNull();
  });

  it("finds a record's own id", () => {
    expect(recordId({ id: 7 })).toEqual({ key: "id", value: 7 });
    expect(recordId({ _id: "abc" })).toEqual({ key: "_id", value: "abc" });
    expect(recordId({ id: "", uuid: "u-1" })).toEqual({ key: "uuid", value: "u-1" });
    expect(recordId({ title: "x" })).toBeNull();
  });

  it("names changed, added and removed fields", () => {
    expect(changedFields({ a: 1, b: { c: 2 }, d: 3 }, { a: 1, b: { c: 3 }, e: 4 })).toEqual(["b", "d", "e"]);
    expect(changedFields({ a: [1] }, { a: [1] })).toEqual([]);
  });
});

describe("findOwnRecord (moved from mass-assignment)", () => {
  it("takes a bare JSON array (Fernway's GET /api/tasks) only with { arrays: true }, as the write-side checks ask", async () => {
    const { ctx } = fakeContext(() => status(500));
    const body = JSON.stringify([{ id: "t0", title: "Account A's own task" }, { id: "t1", title: TEST_VALUE }]);
    const capture: Capture = { requests: [captured({ url: "http://localhost:4100/api/tasks", responseBody: body })], console: [], pageErrors: [] };
    // mass-assignment's rule is unchanged: objects only.
    expect(await findOwnRecord(ctx, capture, [TEST_VALUE])).toBeNull();
    expect(await findOwnRecord(ctx, capture, [TEST_VALUE], { arrays: true })).toEqual({ url: "http://localhost:4100/api/tasks", body });
    // An array whose only match is a bare string is no record.
    const strings: Capture = { requests: [captured({ url: "http://localhost:4100/api/tags", responseBody: JSON.stringify([TEST_VALUE]) })], console: [], pageErrors: [] };
    expect(await findOwnRecord(ctx, strings, [TEST_VALUE], { arrays: true })).toBeNull();
  });

  it("takes a captured GET whose JSON holds a test value", async () => {
    const { ctx, sent } = fakeContext(() => status(500));
    const capture: Capture = {
      requests: [
        captured({ url: "http://localhost:4100/api/me", responseBody: '{"name":"alex"}' }),
        captured({ url: "http://localhost:4100/api/tasks", responseBody: JSON.stringify({ tasks: [{ title: TEST_VALUE }] }) }),
      ],
      console: [],
      pageErrors: [],
    };
    expect(await findOwnRecord(ctx, capture, [TEST_VALUE])).toEqual({ url: "http://localhost:4100/api/tasks", body: capture.requests[1]!.responseBody });
    expect(sent).toEqual([]);
  });

  it("reads the app's API on another local origin again as Account A, never a same-origin read without a body", async () => {
    const { ctx, sent } = fakeContext((req) => (req.url.includes(":4200") ? ok({ title: TEST_VALUE }) : status(500)));
    const capture: Capture = {
      requests: [
        captured({ url: "http://localhost:4100/api/nobody" }),
        captured({ url: "http://localhost:4200/api/tasks" }),
      ],
      console: [],
      pageErrors: [],
    };
    expect((await findOwnRecord(ctx, capture, [TEST_VALUE]))?.url).toBe("http://localhost:4200/api/tasks");
    expect(sent.map((r) => [r.as, r.method, r.url])).toEqual([["self", "GET", "http://localhost:4200/api/tasks"]]);
  });
});

describe("snapshotRecord and rereadRecord", () => {
  it("snapshots only the record that carries the run token, as Account A", async () => {
    const api = tasksApi();
    const { ctx, sent } = fakeContext(api.handler);
    const snap = await snapshotRecord(ctx, "http://localhost:4100/api/tasks", [TEST_VALUE, "Account A's own task"]);
    expect(snap?.record).toEqual({ id: 7, title: TEST_VALUE, done: false, notes: "" });
    expect(snap?.id).toEqual({ key: "id", value: 7 });
    expect(snap?.testValues).toEqual([TEST_VALUE]);
    expect(sent.every((r) => r.as === "self" && r.method === "GET")).toBe(true);
  });

  it("returns null without a run-token value, a failed read or a record", async () => {
    const api = tasksApi();
    const { ctx } = fakeContext(api.handler);
    expect(await snapshotRecord(ctx, "http://localhost:4100/api/tasks", ["Account A's own task"])).toBeNull();
    expect(await snapshotRecord(ctx, "http://localhost:4100/api/nothing", [TEST_VALUE])).toBeNull();
    expect(await snapshotRecord(fakeContext(() => ok({ tasks: [] })).ctx, "http://localhost:4100/api/tasks", [TEST_VALUE])).toBeNull();
    expect(await snapshotRecord(fakeContext(() => ({ status: 200, headers: {}, body: "<html>" })).ctx, "http://localhost:4100/api/tasks", [TEST_VALUE])).toBeNull();
  });

  it("finds the record again by its id after its values changed, and says when it is gone", async () => {
    const api = tasksApi();
    const { ctx } = fakeContext(api.handler);
    const snap = (await snapshotRecord(ctx, "http://localhost:4100/api/tasks", [TEST_VALUE]))!;
    api.tasks[1]!.title = "changed rs7e57a1zz";
    expect((await rereadRecord(ctx, snap))?.[0]).toMatchObject({ id: 7, title: "changed rs7e57a1zz" });
    api.tasks.splice(1, 1);
    expect(await rereadRecord(ctx, snap)).toBe("gone");
  });

  it("without an id, finds it by its test values, else by the one run-token record with the same fields", async () => {
    let body: unknown = { tasks: [{ title: TEST_VALUE, done: false }] };
    const { ctx } = fakeContext(() => ok(body));
    const snap = (await snapshotRecord(ctx, "http://localhost:4100/api/tasks", [TEST_VALUE]))!;
    expect(snap.id).toBeNull();
    body = { tasks: [{ title: "new rs7e57a1zz", done: false }] };
    expect((await rereadRecord(ctx, snap))?.[0]).toEqual({ title: "new rs7e57a1zz", done: false });
    body = { tasks: [{ title: "a rs7e57a1zz", done: false }, { title: "b rs7e57a1zz", done: true }] };
    expect(await rereadRecord(ctx, snap)).toBeNull();
    body = { tasks: [{ title: "Account A's own task", done: false }] };
    expect(await rereadRecord(ctx, snap)).toBe("gone");
  });

  it("is null when the re-read fails, and gone on a 404", async () => {
    const api = tasksApi();
    let fail: IdentityResponse | null = null;
    const { ctx } = fakeContext((req) => fail ?? api.handler(req));
    const snap = (await snapshotRecord(ctx, "http://localhost:4100/api/tasks", [TEST_VALUE]))!;
    fail = status(500);
    expect(await rereadRecord(ctx, snap)).toBeNull();
    fail = status(404);
    expect(await rereadRecord(ctx, snap)).toBe("gone");
  });
});

describe("restoreRecord", () => {
  const LIST = "http://localhost:4100/api/tasks";
  const patch = (body: string): CapturedRequest => captured({ method: "PATCH", url: "http://localhost:4100/api/tasks/7", postData: body, resourceType: "fetch" });

  it("sends the changed fields back through the app's own save and confirms with a re-read", async () => {
    const api = tasksApi();
    const { ctx, sent } = fakeContext(api.handler);
    const snap = (await snapshotRecord(ctx, LIST, [TEST_VALUE]))!;
    Object.assign(api.tasks[1]!, { title: "forged rs7e57a1zz", done: true });
    const out = await restoreRecord(ctx, snap, { save: patch(JSON.stringify({ title: TEST_VALUE })) });
    expect(out).toEqual({ restored: ["title", "done"], notRestored: [] });
    expect(api.tasks[1]).toEqual({ id: 7, title: TEST_VALUE, done: false, notes: "" });
    const writes = sent.filter((r) => r.method !== "GET");
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ as: "self", method: "PATCH", url: "http://localhost:4100/api/tasks/7" });
    expect(JSON.parse(writes[0]!.body!)).toEqual({ title: TEST_VALUE, done: false });
    // Account A's own task was never written to.
    expect(api.tasks[0]).toEqual({ id: 1, title: "Account A's own task", done: false });
  });

  it("restores through a form-encoded save", async () => {
    const api = tasksApi();
    const { ctx, sent } = fakeContext(api.handler);
    const snap = (await snapshotRecord(ctx, LIST, [TEST_VALUE]))!;
    api.tasks[1]!.title = "forged rs7e57a1zz";
    expect(await restoreRecord(ctx, snap, { save: patch(`title=${encodeURIComponent(TEST_VALUE)}`) })).toEqual({ restored: ["title"], notRestored: [] });
    const write = sent.find((r) => r.method === "PATCH")!;
    expect(write.headers?.["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(new URLSearchParams(write.body!).get("title")).toBe(TEST_VALUE);
  });

  it("sends nothing when nothing changed", async () => {
    const api = tasksApi();
    const { ctx, sent } = fakeContext(api.handler);
    const snap = (await snapshotRecord(ctx, LIST, [TEST_VALUE]))!;
    expect(await restoreRecord(ctx, snap, { save: patch("{}") })).toEqual({ restored: [], notRestored: [] });
    expect(sent.filter((r) => r.method !== "GET")).toEqual([]);
  });

  it("names what the server kept and a field it can't remove", async () => {
    const api = tasksApi({ keep: ["done"] });
    const { ctx } = fakeContext(api.handler);
    const snap = (await snapshotRecord(ctx, LIST, [TEST_VALUE]))!;
    Object.assign(api.tasks[1]!, { title: "forged rs7e57a1zz", done: true, role: "admin" });
    expect(await restoreRecord(ctx, snap, { save: patch("{}") })).toEqual({ restored: ["title"], notRestored: ["done", "role"] });
  });

  it("creates the record again when it is gone, by replaying the save as captured", async () => {
    const api = tasksApi();
    const { ctx, sent } = fakeContext(api.handler);
    const snap = (await snapshotRecord(ctx, LIST, [TEST_VALUE]))!;
    api.tasks.splice(1, 1);
    const create = captured({ method: "POST", url: LIST, postData: JSON.stringify({ title: TEST_VALUE }) });
    expect(await restoreRecord(ctx, snap, { save: create })).toEqual({ restored: ["the record"], notRestored: [] });
    expect(sent.filter((r) => r.method === "POST")).toHaveLength(1);
    expect(api.tasks.map((t) => t.title)).toEqual(["Account A's own task", TEST_VALUE]);
  });

  it("never sends a DELETE, a GET or a request that acts, and says the record could not be put back", async () => {
    const api = tasksApi();
    const { ctx, sent } = fakeContext(api.handler);
    const snap = (await snapshotRecord(ctx, LIST, [TEST_VALUE]))!;
    api.tasks[1]!.title = "forged rs7e57a1zz";
    for (const save of [
      captured({ method: "DELETE", url: "http://localhost:4100/api/tasks/7", postData: "{}" }),
      captured({ method: "POST", url: "http://localhost:4100/logout", postData: "{}" }),
    ]) {
      expect(await restoreRecord(ctx, snap, { save })).toEqual({ restored: [], notRestored: ["title"] });
    }
    api.tasks.splice(1, 1);
    expect(await restoreRecord(ctx, snap, { save: captured({ method: "DELETE", url: LIST, postData: "{}" }) })).toEqual({ restored: [], notRestored: ["the record"] });
    expect(sent.filter((r) => r.method !== "GET")).toEqual([]);
  });

  it("sends nothing when the re-read fails, or the save's body can't be rebuilt", async () => {
    const api = tasksApi();
    let fail = false;
    const { ctx, sent } = fakeContext((req) => (fail ? status(500) : api.handler(req)));
    const snap = (await snapshotRecord(ctx, LIST, [TEST_VALUE]))!;
    api.tasks[1]!.title = "forged rs7e57a1zz";
    expect(await restoreRecord(ctx, snap, { save: patch("------boundary\r\nContent-Disposition: form-data") })).toEqual({ restored: [], notRestored: ["title"] });
    fail = true;
    expect((await restoreRecord(ctx, snap, { save: patch("{}") })).restored).toEqual([]);
    expect(sent.filter((r) => r.method !== "GET")).toEqual([]);
  });
});

describe("restoreRecord never replays a create to put a changed record back", () => {
  const LIST = "http://localhost:4100/api/tasks";
  const create = captured({ method: "POST", url: LIST, postData: JSON.stringify({ title: TEST_VALUE }) });

  it("sends nothing for a changed record when the only request it has is the create, and names the fields", async () => {
    const api = tasksApi();
    const { ctx, sent } = fakeContext(api.handler);
    const snap = (await snapshotRecord(ctx, LIST, [TEST_VALUE]))!;
    api.tasks[1]!.title = "forged rs7e57a1zz";
    expect(await restoreRecord(ctx, snap, { save: create })).toEqual({ restored: [], notRestored: ["title"] });
    expect(sent.filter((r) => r.method !== "GET")).toEqual([]);
    expect(api.tasks).toHaveLength(2);
  });

  it("uses `create` to make a gone record again, and the update otherwise", async () => {
    const api = tasksApi();
    const { ctx, sent } = fakeContext(api.handler);
    const snap = (await snapshotRecord(ctx, LIST, [TEST_VALUE]))!;
    const update = captured({ method: "PATCH", url: `${LIST}/7`, postData: "{}" });
    api.tasks.splice(1, 1);
    expect(await restoreRecord(ctx, snap, { save: update, create })).toEqual({ restored: ["the record"], notRestored: [] });
    expect(sent.filter((r) => r.method !== "GET").map((r) => `${r.method} ${r.url}`)).toEqual([`POST ${LIST}`]);
  });

  it("never writes to an endpoint in neverWritten, even the app's own update", async () => {
    expect(neverWritten("http://localhost:4100/api/users/7/password")).toBe(true);
    expect(neverWritten("http://localhost:4100/api/billing/checkout")).toBe(true);
    expect(neverWritten("http://localhost:4100/api/projects/7/invitations")).toBe(true);
    expect(neverWritten("http://localhost:4100/api/logout")).toBe(true);
    expect(neverWritten("http://localhost:4100/api/tasks/7")).toBe(false);
  });
});

describe("recordWrites, readsList, snapshotFrom and locateRecord", () => {
  const LIST = "http://localhost:4100/api/tasks";

  it("keeps only the app's accepted writes to a URL naming the record's id, DELETE last, never guessed", () => {
    const snap = snapshotFrom(LIST, { tasks: [{ id: 7, title: TEST_VALUE }] }, [TEST_VALUE], RUN_TOKEN)!;
    const capture: Capture = {
      requests: [
        captured({ method: "DELETE", url: `${LIST}/7`, status: 204 }),
        captured({ method: "POST", url: LIST, postData: "{}", status: 201 }),
        captured({ method: "PATCH", url: `${LIST}/7`, postData: "{}", status: 200 }),
        captured({ method: "PATCH", url: `${LIST}/77`, postData: "{}", status: 200 }),
        captured({ method: "PUT", url: `${LIST}/7`, postData: "{}", status: 403 }),
        captured({ method: "POST", url: "https://evil.example/api/tasks/7", postData: "{}", status: 200 }),
      ],
      console: [],
      pageErrors: [],
    };
    expect(recordWrites(capture, snap, TARGET).map((r) => `${r.method} ${r.url}`)).toEqual([`PATCH ${LIST}/7`, `DELETE ${LIST}/7`]);
    expect(recordWrites(capture, { ...snap, id: null }, TARGET)).toEqual([]);
    expect(urlNamesId(`${LIST}?id=7`, 7)).toBe(true);
    expect(urlNamesId(`${LIST}/77`, 7)).toBe(false);
  });

  it("says whether the record endpoint reads a list, and finds the record in a read already made", () => {
    const list = [{ id: 1, title: "own" }, { id: 7, title: TEST_VALUE }];
    const snap = snapshotFrom(LIST, list, [TEST_VALUE], RUN_TOKEN)!;
    expect(snap.id).toEqual({ key: "id", value: 7 });
    expect(readsList(list, snap.record)).toBe(true);
    const one = { id: 7, title: TEST_VALUE };
    expect(readsList(one, snapshotFrom(`${LIST}/7`, one, [TEST_VALUE], RUN_TOKEN)!.record)).toBe(false);
    expect(locateRecord([{ id: 7, title: "changed rs7e57a1x" }], snap, RUN_TOKEN)).toEqual([{ id: 7, title: "changed rs7e57a1x" }]);
    expect(locateRecord([{ id: 1, title: "own" }], snap, RUN_TOKEN)).toBe("gone");
    // Never a record without the run token.
    expect(snapshotFrom(LIST, list, ["own"], RUN_TOKEN)).toBeNull();
  });
});
