/**
 * restoreRecord against apps whose records carry fields the server sets itself (0.6.0, F6): the record's id, when it
 * was created and last changed, and its version. The put-back sends the fields that differ from the snapshot plus
 * what the app's own save sends, never a field the server sets itself at its snapshot value or at the value the captured
 * save sent (a version or update stamp from before the attempt): an app with optimistic locking answers such a stale
 * version with a 409, and an app with a strict schema refuses it. A Rails-style save (task[title], {task: {...}}) is
 * read inside the model's name.
 *
 * Each fixture is an in-memory tasks API driven through a fake CheckContext whose request() answers from it and
 * records every request it was sent, so a test can check exactly what the put-back wrote.
 */
import { describe, expect, it } from "vitest";
import type { CheckContext, IdentityRequest, IdentityResponse } from "../../core/types.js";
import { changesOnSave, restoreRecord, serverManaged, serverSetField, snapshotRecord, type CapturedRequest, type JsonObject } from "./record-state.js";

const TARGET = "http://localhost:4100/app";
const RUN_TOKEN = "Rs7e57a1";
/** A test value as canaryValues makes it: the run token, lower case, inside. */
const TEST_VALUE = "Task rs7e57a1ws";
const LIST = "http://localhost:4100/api/tasks";
const ITEM = `${LIST}/7`;

type Sent = IdentityRequest & { as: string };

function fakeContext(handler: (req: Sent) => IdentityResponse): { ctx: CheckContext; sent: Sent[] } {
  const sent: Sent[] = [];
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

const json = (code: number, body: unknown): IdentityResponse => ({ status: code, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

function captured(r: Partial<CapturedRequest> & { url: string }): CapturedRequest {
  return { method: "GET", resourceType: "fetch", postData: null, status: 200, failure: null, responseBody: null, ...r };
}

/** The fields this fixture's server sets itself: a body never sets them. */
const SERVER_SET = ["id", "createdAt", "updatedAt", "version", "lock_version"];

/**
 * A tasks API whose records carry id, createdAt, updatedAt (stamped on every accepted save) and a version (`lockKey`,
 * bumped on every accepted save). GET /api/tasks lists Account A's tasks; PATCH or PUT /api/tasks/:id updates one
 * (JSON or form-encoded).
 * - lock "strict": a save must carry the record's current version, else 409 (the app's own save always sends it).
 * - lock "lenient": a save that carries a version must carry the current one, else 409; one without is accepted (Rails'
 *   lock_version works this way; railsApi below also posts the keys the way a Rails app does, task[title]).
 * - lock "none": no optimistic locking; a version, id or timestamp in a body is ignored (the server sets them itself).
 * - readOnly: a body that carries a field the server sets itself, at any value other than the current one, is refused
 *   with a 422 (a strict schema). The current value is what the app itself would send, so it is accepted.
 */
function lockingApi(options: { lock: "strict" | "lenient" | "none"; readOnly?: boolean; lockKey?: "version" | "lock_version" }) {
  const lockKey = options.lockKey ?? "version";
  let tick = 0;
  const stamp = () => new Date(Date.UTC(2026, 8, 27, 10, 0, tick++)).toISOString();
  const created = stamp();
  const tasks: JsonObject[] = [
    { id: 1, title: "Account A's own task", done: false, notes: "", [lockKey]: 4, createdAt: created, updatedAt: created },
    { id: 7, title: TEST_VALUE, done: false, notes: "", [lockKey]: 1, createdAt: created, updatedAt: created },
  ];
  /** Every save the server refused, with its status. */
  const refused: { status: number; body: JsonObject }[] = [];

  const save = (task: JsonObject, body: JsonObject): IdentityResponse => {
    const refuse = (status: number, message: string) => {
      refused.push({ status, body });
      return json(status, { error: message });
    };
    if (options.readOnly) {
      const stale = SERVER_SET.filter((k) => Object.prototype.hasOwnProperty.call(body, k) && String(body[k]) !== String(task[k]));
      if (stale.length > 0) return refuse(422, `${stale.join(", ")} can't be set`);
    }
    const sentVersion = Object.prototype.hasOwnProperty.call(body, lockKey) ? Number(body[lockKey]) : undefined;
    if (options.lock === "strict" && sentVersion === undefined) return refuse(409, "Send the version you last read.");
    if (options.lock !== "none" && sentVersion !== undefined && sentVersion !== task[lockKey]) return refuse(409, "Someone else changed this task.");
    for (const [k, v] of Object.entries(body)) if (!SERVER_SET.includes(k)) task[k] = k === "done" && typeof v === "string" ? v === "true" : v;
    task[lockKey] = (task[lockKey] as number) + 1;
    task.updatedAt = stamp();
    return json(200, task);
  };

  const handler = (req: Sent): IdentityResponse => {
    const url = new URL(req.url);
    const method = (req.method ?? "GET").toUpperCase();
    if (method === "GET" && url.pathname === "/api/tasks") return json(200, { tasks });
    const m = /^\/api\/tasks\/(\d+)$/.exec(url.pathname);
    const task = m ? tasks.find((t) => t.id === Number(m[1])) : undefined;
    if (!task) return json(404, { error: "Not found" });
    if (method !== "PATCH" && method !== "PUT") return json(405, { error: "Method not allowed" });
    const body: JsonObject = req.headers?.["content-type"]?.includes("json")
      ? (JSON.parse(req.body ?? "{}") as JsonObject)
      : Object.fromEntries(new URLSearchParams(req.body ?? ""));
    return save(task, body);
  };

  /** A write that changed the test record behind the app's back (the attempt a check made), accepted as current. */
  const forge = (changes: JsonObject) => {
    const task = tasks[1]!;
    return save(task, { ...changes, [lockKey]: task[lockKey] });
  };

  return { tasks, handler, forge, refused, lockKey };
}

const writesOf = (sent: Sent[]) => sent.filter((r) => (r.method ?? "GET").toUpperCase() !== "GET");

describe("serverManaged", () => {
  it("knows the fields an app sets itself: ids, created and updated stamps, versions and lock tokens", () => {
    for (const k of [
      "id",
      "_id",
      "uuid",
      "created_at",
      "createdAt",
      "inserted_at",
      "updated_at",
      "updatedAt",
      "modified_on",
      "lastModified",
      "last_updated_at",
      "date_modified",
      "updatedBy",
      "version",
      "lock_version",
      "lockVersion",
      "row_version",
      "etag",
      "_etag",
      "@odata.etag",
      "_rev",
      "revision",
      "__v",
      // Google AIP / protobuf-style stamps, and who created or changed the record, by id.
      "createTime",
      "updateTime",
      "create_time",
      "update_time",
      "modifyTime",
      "last_update_time",
      "lastUpdate",
      "modification_date",
      "creationTimestamp",
      "createdById",
      "updated_by_id",
      "lastModifiedById",
      "resourceVersion",
      "_attachments",
      // Directus's system fields: who created the record, and who changed it last (set on every save).
      "user_created",
      "user_updated",
    ]) {
      expect(serverManaged(k), k).toBe(true);
    }
  });

  it("never takes the record's own data for one: its values, flags, owner, or a soft delete that must be undone", () => {
    for (const k of [
      "title",
      "done",
      "notes",
      "projectId",
      "ownerId",
      "status",
      "deletedAt",
      "deleted_at",
      "archived",
      "timestamp",
      "v",
      "name",
      "dueAt",
      "releaseVersionNotes",
      // A bare present-tense verb is the record's own data (an "update" note, a "change" log), not a stamp.
      "update",
      "change",
      "edit",
      "create",
      "changes",
      "updates",
      "editor",
      "creator",
      "lastEditor",
      "appVersion",
      "position",
    ]) {
      expect(serverManaged(k), k).toBe(false);
    }
  });
});

describe("serverSetField", () => {
  it("is the rule restoreRecord puts back by: a server-set name or the record's id key, unless its snapshot value is the run's own test value", async () => {
    const api = lockingApi({ lock: "none" });
    Object.assign(api.tasks[1]!, { revision: "Rev rs7e57a1ws", _id: "abc" });
    const { ctx } = fakeContext(api.handler);
    const snap = (await snapshotRecord(ctx, LIST, [TEST_VALUE, "Rev rs7e57a1ws"]))!;
    for (const k of ["id", "version", "updatedAt", "createdAt", "_id"]) expect(serverSetField(snap, k, RUN_TOKEN), k).toBe(true);
    // "revision" holds text Run Hound typed: the record's data. "title", "done" and "notes" are the record's own fields.
    for (const k of ["revision", "title", "done", "notes"]) expect(serverSetField(snap, k, RUN_TOKEN), k).toBe(false);
  });
});

describe("changesOnSave", () => {
  it("is a server-set field the app changes again on every save: a version, etag or update stamp, never the id or a creation stamp", async () => {
    const api = lockingApi({ lock: "none" });
    Object.assign(api.tasks[1]!, { revision: "Rev rs7e57a1ws", lock_version: 1, createdById: 4, _rid: "Ab1=", _ts: 1 });
    const { ctx } = fakeContext(api.handler);
    const snap = (await snapshotRecord(ctx, LIST, [TEST_VALUE, "Rev rs7e57a1ws"]))!;
    for (const k of ["version", "updatedAt", "lock_version", "etag", "_rev", "__v", "_ts", "updated_by_id", "user_updated"]) {
      expect(changesOnSave(snap, k, RUN_TOKEN), k).toBe(true);
    }
    // Fixed once the record exists (its id, when and by whom it was created, a document store's resource id), the
    // run's own test value, and the record's own data.
    for (const k of ["id", "_id", "createdAt", "created_at", "createdById", "insertedAt", "creationTimestamp", "_rid", "_self", "user_created", "revision", "title", "done"]) {
      expect(changesOnSave(snap, k, RUN_TOKEN), k).toBe(false);
    }
  });
});

/** `handler` answering GET /api/tasks without `hide` in any task: the app keeps its version or stamps to itself. */
function hiding(handler: (req: Sent) => IdentityResponse, hide: string[]) {
  return (req: Sent): IdentityResponse => {
    const res = handler(req);
    if ((req.method ?? "GET").toUpperCase() !== "GET" || res.status !== 200) return res;
    const body = JSON.parse(res.body) as { tasks?: JsonObject[] };
    if (!body.tasks) return res;
    return json(200, { tasks: body.tasks.map((t) => Object.fromEntries(Object.entries(t).filter(([k]) => !hide.includes(k)))) });
  };
}

/**
 * A Rails-style tasks app on the lenient lock_version: a form POSTs `_method=patch`, `authenticity_token` and the
 * record's fields as task[title], task[lock_version]; a JSON save sends {task: {...}}. Strong parameters: a key outside
 * `task` (the param key, `model`) never reaches the record. GET /api/tasks lists the tasks with their lock_version, as
 * render json does.
 */
function railsApi(model = "task") {
  const api = lockingApi({ lock: "lenient", lockKey: "lock_version" });
  const nested = new RegExp(`^${model}\\[([^\\]]+)\\]$`);
  const handler = (req: Sent): IdentityResponse => {
    let method = (req.method ?? "GET").toUpperCase();
    if (method === "GET") return api.handler(req);
    let fields: JsonObject = {};
    if (req.headers?.["content-type"]?.includes("json")) {
      const task = (JSON.parse(req.body ?? "{}") as JsonObject)[model];
      fields = task && typeof task === "object" ? (task as JsonObject) : {};
    } else {
      const params = new URLSearchParams(req.body ?? "");
      if (method === "POST" && params.get("_method")) method = params.get("_method")!.toUpperCase();
      for (const [k, v] of params) {
        const m = nested.exec(k);
        if (m) fields[m[1]!] = v;
      }
    }
    return api.handler({ ...req, method, headers: { "content-type": "application/json" }, body: JSON.stringify(fields) });
  };
  return { ...api, handler };
}

describe("restoreRecord with optimistic locking", () => {
  it("sends the version the record has now, never the snapshot's, when the app's own save carries it (a strict lock)", async () => {
    const api = lockingApi({ lock: "strict" });
    const { ctx, sent } = fakeContext(api.handler);
    const snap = (await snapshotRecord(ctx, LIST, [TEST_VALUE]))!;
    // The app's own update, captured when the record was at version 1.
    const save = captured({ method: "PATCH", url: ITEM, postData: JSON.stringify({ title: TEST_VALUE, version: 1 }) });
    expect(api.forge({ title: "forged rs7e57a1zz", done: true }).status).toBe(200);

    const out = await restoreRecord(ctx, snap, { save });
    expect(api.refused).toEqual([]);
    expect(out.restored).toEqual(["title", "done"]);
    // The version and updatedAt can never read as they did: the put-back is a save too. They are named, never sent back.
    expect(out.notRestored).toEqual(["version", "updatedAt"]);
    expect(api.tasks[1]).toMatchObject({ id: 7, title: TEST_VALUE, done: false, notes: "", version: 3 });
    const writes = writesOf(sent);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ as: "self", method: "PATCH", url: ITEM });
    expect(JSON.parse(writes[0]!.body!)).toEqual({ title: TEST_VALUE, version: 2, done: false });
    // Account A's own task was never written to.
    expect(api.tasks[0]).toMatchObject({ id: 1, title: "Account A's own task", version: 4 });
  });

  it("never adds a version the app's own save leaves out (a lenient lock would refuse the snapshot's)", async () => {
    const api = lockingApi({ lock: "lenient" });
    const { ctx, sent } = fakeContext(api.handler);
    const snap = (await snapshotRecord(ctx, LIST, [TEST_VALUE]))!;
    const save = captured({ method: "PATCH", url: ITEM, postData: JSON.stringify({ done: true }) });
    api.forge({ title: "forged rs7e57a1zz" });

    const out = await restoreRecord(ctx, snap, { save });
    expect(api.refused).toEqual([]);
    expect(out).toEqual({ restored: ["title"], notRestored: ["version", "updatedAt"] });
    expect(api.tasks[1]).toMatchObject({ title: TEST_VALUE, done: false });
    const body = JSON.parse(writesOf(sent)[0]!.body!) as JsonObject;
    expect(body).toEqual({ done: false, title: TEST_VALUE });
    for (const k of ["id", "version", "createdAt", "updatedAt"]) expect(body, k).not.toHaveProperty(k);
  });

  it("sends every server-set field a whole-record PUT carries at its value now, and the record's own fields at the snapshot's", async () => {
    const api = lockingApi({ lock: "strict", readOnly: true });
    const { ctx, sent } = fakeContext(api.handler);
    const snap = (await snapshotRecord(ctx, LIST, [TEST_VALUE]))!;
    // A PUT that sends the whole record, as some apps do, captured before the attempt.
    const save = captured({ method: "PUT", url: ITEM, postData: JSON.stringify({ ...snap.record, notes: "typed" }) });
    api.forge({ title: "forged rs7e57a1zz", notes: "forged" });
    const now = { ...api.tasks[1]! };

    const out = await restoreRecord(ctx, snap, { save });
    expect(api.refused).toEqual([]);
    expect(out.restored).toEqual(["title", "notes"]);
    expect(out.notRestored).toEqual(["version", "updatedAt"]);
    const body = JSON.parse(writesOf(sent)[0]!.body!) as JsonObject;
    expect(body).toEqual({ id: 7, title: TEST_VALUE, done: false, notes: "", version: now.version, createdAt: now.createdAt, updatedAt: now.updatedAt });
    expect(api.tasks[1]).toMatchObject({ title: TEST_VALUE, notes: "", done: false });
  });

  it("does the same through a form-encoded save that carries lock_version", async () => {
    const api = lockingApi({ lock: "strict", lockKey: "lock_version" });
    const { ctx, sent } = fakeContext(api.handler);
    const snap = (await snapshotRecord(ctx, LIST, [TEST_VALUE]))!;
    const save = captured({ method: "PATCH", url: ITEM, postData: `title=${encodeURIComponent(TEST_VALUE)}&lock_version=1` });
    api.forge({ title: "forged rs7e57a1zz" });

    const out = await restoreRecord(ctx, snap, { save });
    expect(api.refused).toEqual([]);
    expect(out).toEqual({ restored: ["title"], notRestored: ["lock_version", "updatedAt"] });
    const write = writesOf(sent)[0]!;
    expect(write.headers?.["content-type"]).toBe("application/x-www-form-urlencoded");
    const params = new URLSearchParams(write.body!);
    expect(params.get("title")).toBe(TEST_VALUE);
    expect(params.get("lock_version")).toBe("2");
    expect([...params.keys()].sort()).toEqual(["lock_version", "title"]);
  });

  it("sends nothing when only fields the server sets itself differ, and names them", async () => {
    const api = lockingApi({ lock: "strict" });
    const { ctx, sent } = fakeContext(api.handler);
    const snap = (await snapshotRecord(ctx, LIST, [TEST_VALUE]))!;
    const save = captured({ method: "PATCH", url: ITEM, postData: JSON.stringify({ title: TEST_VALUE, version: 1 }) });
    // A save that changed none of the record's own values: only its version and updatedAt moved.
    api.forge({ title: TEST_VALUE });

    expect(await restoreRecord(ctx, snap, { save })).toEqual({ restored: [], notRestored: ["version", "updatedAt"] });
    expect(writesOf(sent)).toEqual([]);
  });

  it("leaves out a version the save carries when the re-read doesn't show it: the captured one is always stale", async () => {
    const api = lockingApi({ lock: "lenient" });
    const { ctx, sent } = fakeContext(hiding(api.handler, ["version"]));
    const snap = (await snapshotRecord(ctx, LIST, [TEST_VALUE]))!;
    expect(snap.record).not.toHaveProperty("version");
    // The app's own save, captured at version 1; the attempt has moved the record on since.
    const save = captured({ method: "PATCH", url: ITEM, postData: JSON.stringify({ title: TEST_VALUE, version: 1 }) });
    api.forge({ title: "forged rs7e57a1zz" });

    const out = await restoreRecord(ctx, snap, { save });
    expect(api.refused).toEqual([]);
    expect(out).toEqual({ restored: ["title"], notRestored: ["updatedAt"] });
    expect(api.tasks[1]).toMatchObject({ title: TEST_VALUE });
    const body = JSON.parse(writesOf(sent)[0]!.body!) as JsonObject;
    expect(body).toEqual({ title: TEST_VALUE });
    expect(body).not.toHaveProperty("version");
  });

  it("leaves out a form's lock_version the re-read doesn't show, and keeps the rest of the form", async () => {
    const api = lockingApi({ lock: "lenient", lockKey: "lock_version" });
    const { ctx, sent } = fakeContext(hiding(api.handler, ["lock_version"]));
    const snap = (await snapshotRecord(ctx, LIST, [TEST_VALUE]))!;
    const save = captured({ method: "PATCH", url: ITEM, postData: `title=${encodeURIComponent(TEST_VALUE)}&lock_version=1&commit=Save` });
    api.forge({ title: "forged rs7e57a1zz" });

    const out = await restoreRecord(ctx, snap, { save });
    expect(api.refused).toEqual([]);
    expect(out).toEqual({ restored: ["title"], notRestored: ["updatedAt"] });
    const params = new URLSearchParams(writesOf(sent)[0]!.body!);
    expect([...params.keys()].sort()).toEqual(["commit", "title"]);
    expect(params.get("title")).toBe(TEST_VALUE);
  });

  it("keeps the id and creation stamp a whole-record PUT carries when the re-read doesn't show them: they never change", async () => {
    const api = lockingApi({ lock: "lenient" });
    const createdAt = api.tasks[1]!.createdAt;
    // A PUT replaces the record: a field the body leaves out is gone afterwards, the creation stamp too.
    const replacing = (req: Sent): IdentityResponse => {
      const res = api.handler(req);
      if ((req.method ?? "GET").toUpperCase() === "PUT" && res.status === 200) {
        const body = JSON.parse(req.body ?? "{}") as JsonObject;
        const task = api.tasks[1]!;
        for (const k of Object.keys(task)) if (!["id", "version", "updatedAt"].includes(k) && !(k in body)) delete task[k];
      }
      return res;
    };
    const { ctx, sent } = fakeContext(hiding(replacing, ["version", "createdAt"]));
    const snap = (await snapshotRecord(ctx, LIST, [TEST_VALUE]))!;
    const save = captured({
      method: "PUT",
      url: ITEM,
      postData: JSON.stringify({ id: 7, title: TEST_VALUE, done: false, notes: "", version: 1, createdAt }),
    });
    api.forge({ title: "forged rs7e57a1zz" });

    const out = await restoreRecord(ctx, snap, { save });
    expect(api.refused).toEqual([]);
    expect(out.restored).toEqual(["title"]);
    expect(JSON.parse(writesOf(sent)[0]!.body!)).toEqual({ id: 7, title: TEST_VALUE, done: false, notes: "", createdAt });
    expect(api.tasks[1]).toMatchObject({ id: 7, title: TEST_VALUE, createdAt });
  });
});

describe("restoreRecord through a Rails-style save (task[title], {task: {...}})", () => {
  it("puts the record back through a form that nests the record's fields and its lock_version under the model's name", async () => {
    const api = railsApi();
    const { ctx, sent } = fakeContext(api.handler);
    const snap = (await snapshotRecord(ctx, LIST, [TEST_VALUE]))!;
    const save = captured({
      method: "POST",
      url: ITEM,
      postData: `_method=patch&authenticity_token=tok123&task%5Btitle%5D=${encodeURIComponent(TEST_VALUE)}&task%5Block_version%5D=1&commit=Update+Task`,
    });
    api.forge({ title: "forged rs7e57a1zz", done: true });

    const out = await restoreRecord(ctx, snap, { save });
    expect(api.refused).toEqual([]);
    expect(out).toEqual({ restored: ["title", "done"], notRestored: ["lock_version", "updatedAt"] });
    expect(api.tasks[1]).toMatchObject({ title: TEST_VALUE, done: false, lock_version: 3 });
    const params = new URLSearchParams(writesOf(sent)[0]!.body!);
    expect(params.get("task[title]")).toBe(TEST_VALUE);
    // The lock_version the record has now, and the field the save didn't carry under the same name.
    expect(params.get("task[lock_version]")).toBe("2");
    expect(params.get("task[done]")).toBe("false");
    expect(params.get("_method")).toBe("patch");
    expect(params.get("commit")).toBe("Update Task");
    expect(params.has("title")).toBe(false);
    expect(params.has("done")).toBe(false);
  });

  it("puts the record back through a JSON save that wraps the record's fields in {task: {...}}", async () => {
    const api = railsApi();
    const { ctx, sent } = fakeContext(api.handler);
    const snap = (await snapshotRecord(ctx, LIST, [TEST_VALUE]))!;
    const save = captured({ method: "PATCH", url: ITEM, postData: JSON.stringify({ task: { title: TEST_VALUE, lock_version: 1 } }) });
    api.forge({ title: "forged rs7e57a1zz", done: true });

    const out = await restoreRecord(ctx, snap, { save });
    expect(api.refused).toEqual([]);
    expect(out).toEqual({ restored: ["title", "done"], notRestored: ["lock_version", "updatedAt"] });
    expect(JSON.parse(writesOf(sent)[0]!.body!)).toEqual({ task: { title: TEST_VALUE, lock_version: 2, done: false } });
  });

  it("reads the model's name from an irregular plural: {person: {...}} on /api/people/7", async () => {
    const api = railsApi("person");
    const { ctx, sent } = fakeContext((req) => api.handler({ ...req, url: req.url.replace("/api/people/", "/api/tasks/") }));
    const snap = (await snapshotRecord(ctx, LIST, [TEST_VALUE]))!;
    const save = captured({
      method: "PATCH",
      url: "http://localhost:4100/api/people/7",
      postData: JSON.stringify({ person: { title: TEST_VALUE, lock_version: 1 } }),
    });
    api.forge({ title: "forged rs7e57a1zz" });

    const out = await restoreRecord(ctx, snap, { save });
    expect(api.refused).toEqual([]);
    expect(out.restored).toEqual(["title"]);
    expect(JSON.parse(writesOf(sent)[0]!.body!)).toEqual({ person: { title: TEST_VALUE, lock_version: 2 } });
    expect(api.tasks[1]).toMatchObject({ title: TEST_VALUE });
  });

  it("keeps task[createdAt] a form carries when the re-read doesn't show it: a creation stamp never changes", async () => {
    const api = railsApi();
    const createdAt = api.tasks[1]!.createdAt as string;
    const { ctx, sent } = fakeContext(hiding(api.handler, ["createdAt"]));
    const snap = (await snapshotRecord(ctx, LIST, [TEST_VALUE]))!;
    expect(snap.record).not.toHaveProperty("createdAt");
    const save = captured({
      method: "PATCH",
      url: ITEM,
      postData: `task%5Bid%5D=7&task%5BcreatedAt%5D=${encodeURIComponent(createdAt)}&task%5Btitle%5D=${encodeURIComponent(TEST_VALUE)}`,
    });
    api.forge({ title: "forged rs7e57a1zz" });

    const out = await restoreRecord(ctx, snap, { save });
    expect(api.refused).toEqual([]);
    expect(out.restored).toEqual(["title"]);
    const params = new URLSearchParams(writesOf(sent)[0]!.body!);
    expect(params.get("task[id]")).toBe("7");
    expect(params.get("task[createdAt]")).toBe(createdAt);
    expect(params.get("task[title]")).toBe(TEST_VALUE);
  });

  it("never reads a nested reference to another record as the record: its id stays as the app sent it (JSON)", async () => {
    const api = lockingApi({ lock: "none" });
    const { ctx, sent } = fakeContext(api.handler);
    const snap = (await snapshotRecord(ctx, LIST, [TEST_VALUE]))!;
    const save = captured({ method: "PATCH", url: ITEM, postData: JSON.stringify({ title: TEST_VALUE, owner: { id: 3, title: "Lead" } }) });
    api.forge({ title: "forged rs7e57a1zz", done: true });

    const out = await restoreRecord(ctx, snap, { save });
    expect(out.restored).toEqual(["title", "done"]);
    expect(JSON.parse(writesOf(sent)[0]!.body!)).toEqual({ title: TEST_VALUE, done: false, owner: { id: 3, title: "Lead" } });
  });

  it("never reads a nested reference to another record as the record: its id stays as the app sent it (form)", async () => {
    const api = lockingApi({ lock: "none" });
    const { ctx, sent } = fakeContext(api.handler);
    const snap = (await snapshotRecord(ctx, LIST, [TEST_VALUE]))!;
    const save = captured({ method: "PATCH", url: ITEM, postData: `title=${encodeURIComponent(TEST_VALUE)}&owner%5Bid%5D=3&owner%5Btitle%5D=Lead` });
    api.forge({ title: "forged rs7e57a1zz", done: true });

    const out = await restoreRecord(ctx, snap, { save });
    expect(out.restored).toEqual(["title", "done"]);
    const params = new URLSearchParams(writesOf(sent)[0]!.body!);
    expect(Object.fromEntries(params)).toEqual({ title: TEST_VALUE, "owner[id]": "3", "owner[title]": "Lead", done: "false" });
  });
});

/**
 * A save whose top level holds none of the record's own fields may still not nest the record: it may carry only a
 * reference to another record (an assignee, an owner) that happens to share a field name with it. Through nested
 * attributes (Rails' accepts_nested_attributes_for, an ORM's nested update) a put-back that took that reference for the
 * record would write the test record's values, or its id, into a record Run Hound never created. The model's name is
 * only the resource the save's URL updates, and never an object naming an id other than the record's own.
 */
describe("restoreRecord never reads a reference to another record as the record", () => {
  it("keeps a nested reference to another record as the app sent it (JSON, only the reference)", async () => {
    const api = lockingApi({ lock: "none" });
    const { ctx, sent } = fakeContext(api.handler);
    const snap = (await snapshotRecord(ctx, LIST, [TEST_VALUE]))!;
    const save = captured({ method: "PATCH", url: ITEM, postData: JSON.stringify({ assignee: { id: 3, title: "Sam" } }) });
    api.forge({ title: "forged rs7e57a1zz" });

    const out = await restoreRecord(ctx, snap, { save });
    expect(JSON.parse(writesOf(sent)[0]!.body!)).toEqual({ assignee: { id: 3, title: "Sam" }, title: TEST_VALUE });
    expect(out.restored).toEqual(["title"]);
    expect(api.tasks[1]).toMatchObject({ id: 7, title: TEST_VALUE });
  });

  it("keeps a nested reference as the app sent it when the top level holds only the version (JSON)", async () => {
    const api = lockingApi({ lock: "lenient" });
    const { ctx, sent } = fakeContext(api.handler);
    const snap = (await snapshotRecord(ctx, LIST, [TEST_VALUE]))!;
    const save = captured({ method: "PATCH", url: ITEM, postData: JSON.stringify({ version: 1, assignee: { id: 3, title: "Sam" } }) });
    api.forge({ title: "forged rs7e57a1zz" });

    const out = await restoreRecord(ctx, snap, { save });
    expect(api.refused).toEqual([]);
    expect(JSON.parse(writesOf(sent)[0]!.body!)).toEqual({ version: 2, assignee: { id: 3, title: "Sam" }, title: TEST_VALUE });
    expect(out.restored).toEqual(["title"]);
  });

  it("keeps a nested reference as the app sent it (form, only owner[id] and owner[title])", async () => {
    const api = lockingApi({ lock: "none" });
    const { ctx, sent } = fakeContext(api.handler);
    const snap = (await snapshotRecord(ctx, LIST, [TEST_VALUE]))!;
    const save = captured({ method: "PATCH", url: ITEM, postData: "owner%5Bid%5D=3&owner%5Btitle%5D=Lead" });
    api.forge({ title: "forged rs7e57a1zz" });

    const out = await restoreRecord(ctx, snap, { save });
    expect(Object.fromEntries(new URLSearchParams(writesOf(sent)[0]!.body!))).toEqual({ "owner[id]": "3", "owner[title]": "Lead", title: TEST_VALUE });
    expect(out.restored).toEqual(["title"]);
  });

  it("keeps a nested reference with no id as the app sent it: its name isn't the resource the save updates (JSON)", async () => {
    const api = lockingApi({ lock: "none" });
    const { ctx, sent } = fakeContext(api.handler);
    const snap = (await snapshotRecord(ctx, LIST, [TEST_VALUE]))!;
    const save = captured({ method: "PATCH", url: ITEM, postData: JSON.stringify({ assignee: { title: "Sam" } }) });
    api.forge({ title: "forged rs7e57a1zz" });

    await restoreRecord(ctx, snap, { save });
    expect(JSON.parse(writesOf(sent)[0]!.body!)).toEqual({ assignee: { title: "Sam" }, title: TEST_VALUE });
  });

  it("keeps a form reference with no id as the app sent it (owner[title] only)", async () => {
    const api = lockingApi({ lock: "none" });
    const { ctx, sent } = fakeContext(api.handler);
    const snap = (await snapshotRecord(ctx, LIST, [TEST_VALUE]))!;
    const save = captured({ method: "PATCH", url: ITEM, postData: "owner%5Btitle%5D=Lead" });
    api.forge({ title: "forged rs7e57a1zz" });

    await restoreRecord(ctx, snap, { save });
    expect(Object.fromEntries(new URLSearchParams(writesOf(sent)[0]!.body!))).toEqual({ "owner[title]": "Lead", title: TEST_VALUE });
  });

  it("keeps a nested-attributes reference as the app sent it ({assignee_attributes: {id: 3, ...}})", async () => {
    const api = lockingApi({ lock: "none" });
    const { ctx, sent } = fakeContext(api.handler);
    const snap = (await snapshotRecord(ctx, LIST, [TEST_VALUE]))!;
    const save = captured({ method: "PATCH", url: ITEM, postData: JSON.stringify({ assignee_attributes: { id: 3, title: "Sam" } }) });
    api.forge({ title: "forged rs7e57a1zz" });

    await restoreRecord(ctx, snap, { save });
    expect(JSON.parse(writesOf(sent)[0]!.body!)).toEqual({ assignee_attributes: { id: 3, title: "Sam" }, title: TEST_VALUE });
  });

  it("never takes an object under the resource's own name for the record when it names another id", async () => {
    const api = lockingApi({ lock: "none" });
    const { ctx, sent } = fakeContext(api.handler);
    const snap = (await snapshotRecord(ctx, LIST, [TEST_VALUE]))!;
    // A parent task the save refers to by id 3, under the name "task": not the record at /api/tasks/7.
    const save = captured({ method: "PATCH", url: ITEM, postData: JSON.stringify({ task: { id: 3, title: "Parent" } }) });
    api.forge({ title: "forged rs7e57a1zz" });

    await restoreRecord(ctx, snap, { save });
    expect(JSON.parse(writesOf(sent)[0]!.body!)).toEqual({ task: { id: 3, title: "Parent" }, title: TEST_VALUE });
  });

  it("still reads the model's name when it carries the record's own id (JSON and form)", async () => {
    for (const postData of [
      JSON.stringify({ task: { id: 7, title: TEST_VALUE, lock_version: 1 } }),
      `task%5Bid%5D=7&task%5Btitle%5D=${encodeURIComponent(TEST_VALUE)}&task%5Block_version%5D=1`,
    ]) {
      const api = railsApi();
      const { ctx, sent } = fakeContext(api.handler);
      const snap = (await snapshotRecord(ctx, LIST, [TEST_VALUE]))!;
      api.forge({ title: "forged rs7e57a1zz", done: true });

      const out = await restoreRecord(ctx, snap, { save: captured({ method: "PATCH", url: ITEM, postData }) });
      expect(api.refused, postData).toEqual([]);
      expect(out, postData).toEqual({ restored: ["title", "done"], notRestored: ["lock_version", "updatedAt"] });
      expect(api.tasks[1], postData).toMatchObject({ id: 7, title: TEST_VALUE, done: false });
      expect(sent.filter((r) => (r.method ?? "GET").toUpperCase() !== "GET")).toHaveLength(1);
    }
  });

  it("keeps a same-name object as the app sent it when the top level carries the record's own fields (JSON)", async () => {
    const api = lockingApi({ lock: "none" });
    const { ctx, sent } = fakeContext(api.handler);
    const snap = (await snapshotRecord(ctx, LIST, [TEST_VALUE]))!;
    // {task: {...}} with no id beside the record's own title: a parent task, not the record's wrapper.
    const save = captured({ method: "PATCH", url: ITEM, postData: JSON.stringify({ title: TEST_VALUE, task: { title: "Parent" } }) });
    api.forge({ title: "forged rs7e57a1zz", done: true });

    const out = await restoreRecord(ctx, snap, { save });
    expect(out.restored).toEqual(["title", "done"]);
    expect(JSON.parse(writesOf(sent)[0]!.body!)).toEqual({ title: TEST_VALUE, task: { title: "Parent" }, done: false });
  });

  it("keeps a same-name form key as the app sent it when the plain keys carry the record's own fields (form)", async () => {
    const api = lockingApi({ lock: "none" });
    const { ctx, sent } = fakeContext(api.handler);
    const snap = (await snapshotRecord(ctx, LIST, [TEST_VALUE]))!;
    const save = captured({ method: "PATCH", url: ITEM, postData: `title=${encodeURIComponent(TEST_VALUE)}&task%5Btitle%5D=Parent` });
    api.forge({ title: "forged rs7e57a1zz", done: true });

    const out = await restoreRecord(ctx, snap, { save });
    expect(out.restored).toEqual(["title", "done"]);
    expect(Object.fromEntries(new URLSearchParams(writesOf(sent)[0]!.body!))).toEqual({ title: TEST_VALUE, "task[title]": "Parent", done: "false" });
  });

  it("takes no model's name when two names qualify (JSON): {task: {...}, tasks: {...}} stay as the app sent them", async () => {
    const api = lockingApi({ lock: "none" });
    const { ctx, sent } = fakeContext(api.handler);
    const snap = (await snapshotRecord(ctx, LIST, [TEST_VALUE]))!;
    const save = captured({ method: "PATCH", url: ITEM, postData: JSON.stringify({ task: { title: "One" }, tasks: { title: "Two" } }) });
    api.forge({ title: "forged rs7e57a1zz" });

    await restoreRecord(ctx, snap, { save });
    expect(JSON.parse(writesOf(sent)[0]!.body!)).toEqual({ task: { title: "One" }, tasks: { title: "Two" }, title: TEST_VALUE });
  });

  it("takes no model's name when two names qualify (form): task[title] and tasks[title] stay as the app sent them", async () => {
    const api = lockingApi({ lock: "none" });
    const { ctx, sent } = fakeContext(api.handler);
    const snap = (await snapshotRecord(ctx, LIST, [TEST_VALUE]))!;
    const save = captured({ method: "PATCH", url: ITEM, postData: "task%5Btitle%5D=One&tasks%5Btitle%5D=Two" });
    api.forge({ title: "forged rs7e57a1zz" });

    await restoreRecord(ctx, snap, { save });
    expect(Object.fromEntries(new URLSearchParams(writesOf(sent)[0]!.body!))).toEqual({ "task[title]": "One", "tasks[title]": "Two", title: TEST_VALUE });
  });

  it("reads the model's name from the resource before the record's id on a nested route, even when the parent's id is the same", async () => {
    const api = railsApi();
    // PATCH /api/projects/7/tasks/7: project 7's task 7.
    const { ctx, sent } = fakeContext((req) => api.handler({ ...req, url: req.url.replace("/api/projects/7/tasks/", "/api/tasks/") }));
    const snap = (await snapshotRecord(ctx, LIST, [TEST_VALUE]))!;
    const save = captured({
      method: "PATCH",
      url: "http://localhost:4100/api/projects/7/tasks/7",
      postData: JSON.stringify({ task: { title: TEST_VALUE, lock_version: 1 } }),
    });
    api.forge({ title: "forged rs7e57a1zz" });

    const out = await restoreRecord(ctx, snap, { save });
    expect(api.refused).toEqual([]);
    expect(out.restored).toEqual(["title"]);
    expect(JSON.parse(writesOf(sent)[0]!.body!)).toEqual({ task: { title: TEST_VALUE, lock_version: 2 } });
  });
});

describe("restoreRecord without optimistic locking", () => {
  it("puts the record back and never sends a field the server sets itself that the save leaves out", async () => {
    const api = lockingApi({ lock: "none" });
    const { ctx, sent } = fakeContext(api.handler);
    const snap = (await snapshotRecord(ctx, LIST, [TEST_VALUE]))!;
    const save = captured({ method: "PATCH", url: ITEM, postData: JSON.stringify({ title: TEST_VALUE }) });
    api.forge({ title: "forged rs7e57a1zz", done: true, notes: "forged" });

    const out = await restoreRecord(ctx, snap, { save });
    expect(out).toEqual({ restored: ["title", "done", "notes"], notRestored: ["version", "updatedAt"] });
    expect(api.tasks[1]).toMatchObject({ id: 7, title: TEST_VALUE, done: false, notes: "" });
    const writes = writesOf(sent);
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0]!.body!)).toEqual({ title: TEST_VALUE, done: false, notes: "" });
  });

  it("is accepted by a strict schema that refuses a server-set field at a value other than its own", async () => {
    const api = lockingApi({ lock: "none", readOnly: true });
    const { ctx, sent } = fakeContext(api.handler);
    const snap = (await snapshotRecord(ctx, LIST, [TEST_VALUE]))!;
    const save = captured({ method: "PATCH", url: ITEM, postData: JSON.stringify({ done: true }) });
    api.forge({ title: "forged rs7e57a1zz" });

    const out = await restoreRecord(ctx, snap, { save });
    expect(api.refused).toEqual([]);
    expect(out.restored).toEqual(["title"]);
    expect(api.tasks[1]).toMatchObject({ title: TEST_VALUE, done: false });
    expect(Object.keys(JSON.parse(writesOf(sent)[0]!.body!) as JsonObject).sort()).toEqual(["done", "title"]);
  });

  it("puts back a field whose name looks server-set when it holds the run's own test value (it is the record's data)", async () => {
    const api = lockingApi({ lock: "none" });
    // A release record whose "revision" is text the user typed: Run Hound's own test value.
    Object.assign(api.tasks[1]!, { revision: "Rev rs7e57a1ws" });
    const { ctx, sent } = fakeContext(api.handler);
    const snap = (await snapshotRecord(ctx, LIST, [TEST_VALUE, "Rev rs7e57a1ws"]))!;
    const save = captured({ method: "PATCH", url: ITEM, postData: JSON.stringify({ title: TEST_VALUE }) });
    api.forge({ revision: "Rev rs7e57a1wxb" });

    const out = await restoreRecord(ctx, snap, { save });
    expect(out.restored).toEqual(["revision"]);
    expect(api.tasks[1]!.revision).toBe("Rev rs7e57a1ws");
    expect(JSON.parse(writesOf(sent)[0]!.body!)).toEqual({ title: TEST_VALUE, revision: "Rev rs7e57a1ws" });
  });

  it("still names a field it could not put back, next to the server-set ones", async () => {
    const api = lockingApi({ lock: "none" });
    const { ctx } = fakeContext((req) => {
      // The server keeps `done` as it is whatever a body says.
      if ((req.method ?? "GET").toUpperCase() === "PATCH" && req.body) {
        const body = JSON.parse(req.body) as JsonObject;
        delete body.done;
        return api.handler({ ...req, body: JSON.stringify(body) });
      }
      return api.handler(req);
    });
    const snap = (await snapshotRecord(ctx, LIST, [TEST_VALUE]))!;
    const save = captured({ method: "PATCH", url: ITEM, postData: JSON.stringify({ title: TEST_VALUE }) });
    api.forge({ title: "forged rs7e57a1zz", done: true });

    expect(await restoreRecord(ctx, snap, { save })).toEqual({ restored: ["title"], notRestored: ["done", "version", "updatedAt"] });
  });
});

/**
 * A tasks API that keeps each record's version and update stamp inside an object field, {meta: {version, updatedAt}}
 * (Kubernetes' metadata.resourceVersion and Contentful's sys.version work this way). A save that carries meta must carry
 * meta.version at the current one, else 409; a save without meta is accepted. The server sets the stamps itself: every
 * field but the id and meta reaches the record, meta's own data (label) is merged into it, and each accepted save bumps
 * meta.version and stamps meta.updatedAt. JSON or form-encoded (meta[version]=2).
 */
function metaApi() {
  let tick = 0;
  const stamp = () => new Date(Date.UTC(2026, 8, 27, 11, 0, tick++)).toISOString();
  const tasks: JsonObject[] = [
    { id: 1, title: "Account A's own task", done: false, meta: { version: 4, label: "Own", updatedAt: stamp() } },
    { id: 7, title: TEST_VALUE, done: false, meta: { version: 1, label: "Blue", updatedAt: stamp() } },
  ];
  const refused: { status: number; body: JsonObject }[] = [];
  const metaOf = (t: JsonObject) => t.meta as JsonObject;
  const plain = (v: unknown): v is JsonObject => v !== null && typeof v === "object" && !Array.isArray(v);

  const save = (task: JsonObject, body: JsonObject): IdentityResponse => {
    const sentMeta = body.meta;
    if (sentMeta !== undefined && (!plain(sentMeta) || Number(sentMeta.version) !== metaOf(task).version)) {
      refused.push({ status: 409, body });
      return json(409, { error: "Someone else changed this task." });
    }
    for (const [k, v] of Object.entries(body)) if (k !== "id" && k !== "meta") task[k] = k === "done" && typeof v === "string" ? v === "true" : v;
    const { version: _v, updatedAt: _u, ...data } = plain(sentMeta) ? sentMeta : {};
    task.meta = { ...metaOf(task), ...data, version: (metaOf(task).version as number) + 1, updatedAt: stamp() };
    return json(200, task);
  };

  /** A form body with meta[version]=2 read as {meta: {version: "2"}}. */
  const formBody = (text: string): JsonObject => {
    const out: JsonObject = {};
    for (const [k, v] of new URLSearchParams(text)) {
      const m = /^([^[\]]+)\[([^[\]]+)\]$/.exec(k);
      if (m) out[m[1]!] = { ...(out[m[1]!] as JsonObject | undefined), [m[2]!]: v };
      else out[k] = v;
    }
    return out;
  };

  const handler = (req: Sent): IdentityResponse => {
    const url = new URL(req.url);
    const method = (req.method ?? "GET").toUpperCase();
    if (method === "GET" && url.pathname === "/api/tasks") return json(200, { tasks });
    const m = /^\/api\/tasks\/(\d+)$/.exec(url.pathname);
    const task = m ? tasks.find((t) => t.id === Number(m[1])) : undefined;
    if (!task) return json(404, { error: "Not found" });
    if (method !== "PATCH" && method !== "PUT") return json(405, { error: "Method not allowed" });
    const body = req.headers?.["content-type"]?.includes("json") ? (JSON.parse(req.body ?? "{}") as JsonObject) : formBody(req.body ?? "");
    return save(task, body);
  };

  /** A write that changed the test record behind the app's back (the attempt), with the version it has now. */
  const forge = (changes: JsonObject) => {
    const task = tasks[1]!;
    const meta = plain(changes.meta) ? changes.meta : {};
    return save(task, { ...changes, meta: { ...meta, version: metaOf(task).version } });
  };

  return { tasks, handler, forge, refused };
}

describe("restoreRecord with stamps inside an object field ({meta: {version, updatedAt}})", () => {
  it("sends an object field whose stamps alone moved at its value now, never the snapshot's (a lock on meta.version)", async () => {
    const api = metaApi();
    const { ctx, sent } = fakeContext(api.handler);
    const snap = (await snapshotRecord(ctx, LIST, [TEST_VALUE]))!;
    const save = captured({ method: "PATCH", url: ITEM, postData: JSON.stringify({ title: TEST_VALUE, meta: { version: 1 } }) });
    expect(api.forge({ title: "forged rs7e57a1zz" }).status).toBe(200);
    const metaNow = structuredClone(api.tasks[1]!.meta);

    const out = await restoreRecord(ctx, snap, { save });
    expect(api.refused).toEqual([]);
    // meta can never read as it did (the put-back is a save too): it is named, never sent back at the snapshot's value.
    expect(out).toEqual({ restored: ["title"], notRestored: ["meta"] });
    expect(JSON.parse(writesOf(sent)[0]!.body!)).toEqual({ title: TEST_VALUE, meta: metaNow });
    expect(api.tasks[1]).toMatchObject({ title: TEST_VALUE, meta: { version: 3, label: "Blue" } });
    expect(api.tasks[0]).toMatchObject({ id: 1, title: "Account A's own task", meta: { version: 4 } });
  });

  it("never adds an object field whose stamps alone moved when the app's own save leaves it out", async () => {
    const api = metaApi();
    const { ctx, sent } = fakeContext(api.handler);
    const snap = (await snapshotRecord(ctx, LIST, [TEST_VALUE]))!;
    const save = captured({ method: "PATCH", url: ITEM, postData: JSON.stringify({ title: TEST_VALUE }) });
    api.forge({ title: "forged rs7e57a1zz" });

    const out = await restoreRecord(ctx, snap, { save });
    expect(api.refused).toEqual([]);
    expect(out).toEqual({ restored: ["title"], notRestored: ["meta"] });
    expect(JSON.parse(writesOf(sent)[0]!.body!)).toEqual({ title: TEST_VALUE });
  });

  it("sends nothing when only the stamps inside an object field moved, and names the field", async () => {
    const api = metaApi();
    const { ctx, sent } = fakeContext(api.handler);
    const snap = (await snapshotRecord(ctx, LIST, [TEST_VALUE]))!;
    const save = captured({ method: "PATCH", url: ITEM, postData: JSON.stringify({ title: TEST_VALUE, meta: { version: 1 } }) });
    api.forge({ title: TEST_VALUE });

    expect(await restoreRecord(ctx, snap, { save })).toEqual({ restored: [], notRestored: ["meta"] });
    expect(writesOf(sent)).toEqual([]);
  });

  it("puts an object field's own data back with its stamps at their value now (a save that carries it)", async () => {
    const api = metaApi();
    const { ctx, sent } = fakeContext(api.handler);
    const snap = (await snapshotRecord(ctx, LIST, [TEST_VALUE]))!;
    const save = captured({ method: "PATCH", url: ITEM, postData: JSON.stringify({ title: TEST_VALUE, meta: { version: 1 } }) });
    api.forge({ title: "forged rs7e57a1zz", meta: { label: "Red" } });
    const metaNow = structuredClone(api.tasks[1]!.meta) as JsonObject;

    const out = await restoreRecord(ctx, snap, { save });
    expect(api.refused).toEqual([]);
    expect(JSON.parse(writesOf(sent)[0]!.body!)).toEqual({ title: TEST_VALUE, meta: { version: metaNow.version, label: "Blue", updatedAt: metaNow.updatedAt } });
    expect(api.tasks[1]).toMatchObject({ title: TEST_VALUE, meta: { label: "Blue" } });
    // label is back, but meta's stamps moved again with the put-back: it is still named.
    expect(out).toEqual({ restored: ["title"], notRestored: ["meta"] });
  });

  it("puts an object field's own data back with its stamps at their value now (a save that leaves it out)", async () => {
    const api = metaApi();
    const { ctx, sent } = fakeContext(api.handler);
    const snap = (await snapshotRecord(ctx, LIST, [TEST_VALUE]))!;
    const save = captured({ method: "PATCH", url: ITEM, postData: JSON.stringify({ title: TEST_VALUE }) });
    api.forge({ meta: { label: "Red" } });
    const metaNow = structuredClone(api.tasks[1]!.meta) as JsonObject;

    await restoreRecord(ctx, snap, { save });
    expect(api.refused).toEqual([]);
    expect(JSON.parse(writesOf(sent)[0]!.body!)).toEqual({ title: TEST_VALUE, meta: { version: metaNow.version, label: "Blue", updatedAt: metaNow.updatedAt } });
    expect(api.tasks[1]).toMatchObject({ meta: { label: "Blue" } });
  });

  it("sends a form's meta[version] at its value now", async () => {
    const api = metaApi();
    const { ctx, sent } = fakeContext(api.handler);
    const snap = (await snapshotRecord(ctx, LIST, [TEST_VALUE]))!;
    const save = captured({ method: "PATCH", url: ITEM, postData: `title=${encodeURIComponent(TEST_VALUE)}&meta%5Bversion%5D=1` });
    api.forge({ title: "forged rs7e57a1zz" });

    const out = await restoreRecord(ctx, snap, { save });
    expect(api.refused).toEqual([]);
    expect(out).toEqual({ restored: ["title"], notRestored: ["meta"] });
    expect(Object.fromEntries(new URLSearchParams(writesOf(sent)[0]!.body!))).toEqual({ title: TEST_VALUE, "meta[version]": "2" });
  });

  it("puts a swapped reference back as the snapshot has it, its stamps too: another record's stamps are not this one's", async () => {
    const api = lockingApi({ lock: "none" });
    const sam = { id: 3, name: "Sam", updatedAt: "2026-09-01T00:00:00.000Z" };
    Object.assign(api.tasks[1]!, { owner: sam });
    const { ctx, sent } = fakeContext(api.handler);
    const snap = (await snapshotRecord(ctx, LIST, [TEST_VALUE]))!;
    const save = captured({ method: "PATCH", url: ITEM, postData: JSON.stringify({ title: TEST_VALUE }) });
    api.forge({ owner: { id: 4, name: "Lee", updatedAt: "2026-09-20T00:00:00.000Z" } });

    const out = await restoreRecord(ctx, snap, { save });
    expect(JSON.parse(writesOf(sent)[0]!.body!)).toEqual({ title: TEST_VALUE, owner: sam });
    expect(out).toEqual({ restored: ["owner"], notRestored: ["version", "updatedAt"] });
    expect(api.tasks[1]!.owner).toEqual(sam);
  });

  it("puts back a stamp-named field inside an object field when it holds the run's own test value (it is the record's data)", async () => {
    const api = lockingApi({ lock: "none" });
    Object.assign(api.tasks[1]!, { meta: { revision: "Rev rs7e57a1ws" } });
    const { ctx, sent } = fakeContext(api.handler);
    const snap = (await snapshotRecord(ctx, LIST, [TEST_VALUE]))!;
    const save = captured({ method: "PATCH", url: ITEM, postData: JSON.stringify({ title: TEST_VALUE }) });
    api.forge({ meta: { revision: "Rev rs7e57a1wxb" } });

    const out = await restoreRecord(ctx, snap, { save });
    expect(JSON.parse(writesOf(sent)[0]!.body!)).toEqual({ title: TEST_VALUE, meta: { revision: "Rev rs7e57a1ws" } });
    expect(out.restored).toEqual(["meta"]);
  });
});
