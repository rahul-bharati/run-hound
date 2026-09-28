/**
 * restoreRecord through an app's own update that carries the record's version in its URL's query
 * (PATCH /api/tasks/7?lock_version=1: close-out review, round 1). The query's version is as stale as one in the body
 * once the record was saved again, so the put-back sends it at its value in the re-read, as it does a body's. When the
 * re-read doesn't show it, the query is left as the app sent it (a parameter by that name may be something else, such
 * as an API version, and the put-back never drops what the app sends).
 *
 * Round 2 of the close-out review: a parameter by a stamp's name is the record's own only when its value is one the
 * record showed before the app's update was sent (recordQueryStamps: the save's answer, an answer or read of the record
 * captured after it, or the snapshot). A caller that names the record's query stamps (`how.queryStamps`) gets only those
 * refreshed: PATCH /api/tasks/7?version=2, an API version, on a record whose own `version` is 5, stays as the app sent it.
 */
import { describe, expect, it } from "vitest";
import type { Capture, CheckContext, IdentityRequest, IdentityResponse } from "../../core/types.js";
import { recordQueryStamps, restoreRecord, snapshotRecord, type CapturedRequest, type JsonObject } from "./record-state.js";

const TARGET = "http://localhost:4100/app";
const RUN_TOKEN = "Rs7e57a1";
const TEST_VALUE = "Task rs7e57a1ws";
const LIST = "http://localhost:4100/api/tasks";

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

/**
 * A tasks API whose update takes the version in its URL's query (?lock_version=) and refuses a stale one with 409.
 * `shown`: whether the list read shows lock_version.
 */
function queryLockApi(shown: boolean) {
  const tasks: { id: number; title: string; lock_version: number }[] = [
    { id: 1, title: "Account A's own task", lock_version: 4 },
    { id: 7, title: TEST_VALUE, lock_version: 1 },
  ];
  const view = (t: (typeof tasks)[number]) => (shown ? { ...t } : { id: t.id, title: t.title });
  const refused: string[] = [];
  const handler = (req: Sent): IdentityResponse => {
    const url = new URL(req.url);
    const method = (req.method ?? "GET").toUpperCase();
    if (method === "GET" && url.pathname === "/api/tasks") return json(200, tasks.map(view));
    const m = /^\/api\/tasks\/(\d+)$/.exec(url.pathname);
    const task = m ? tasks.find((t) => t.id === Number(m[1])) : undefined;
    if (!task || method !== "PATCH") return json(404, { error: "Not found" });
    if (Number(url.searchParams.get("lock_version")) !== task.lock_version) {
      refused.push(req.url);
      return json(409, { error: "Someone else changed this task." });
    }
    const body = JSON.parse(req.body ?? "{}") as JsonObject;
    if (typeof body.title === "string") task.title = body.title;
    task.lock_version += 1;
    return json(200, view(task));
  };
  /** A write that changed the test record behind the app's back (the attempt a check made). */
  const forge = (title: string) => {
    tasks[1]!.title = title;
    tasks[1]!.lock_version += 1;
  };
  return { tasks, handler, forge, refused };
}

const writesOf = (sent: Sent[]) => sent.filter((r) => (r.method ?? "GET").toUpperCase() !== "GET");

describe("restoreRecord through an update that carries the version in its URL's query", () => {
  it("sends the version the re-read shows, never the one the app's own update carried", async () => {
    const api = queryLockApi(true);
    const { ctx, sent } = fakeContext(api.handler);
    const snap = (await snapshotRecord(ctx, LIST, [TEST_VALUE]))!;
    // The app's own update, captured when the record was at version 1 (it bumped it to 2).
    const save = captured({ method: "PATCH", url: `${LIST}/7?lock_version=1`, postData: JSON.stringify({ title: TEST_VALUE }) });
    api.tasks[1]!.lock_version = 2;
    api.forge("forged rs7e57a1zz");

    const out = await restoreRecord(ctx, snap, { save });
    expect(api.refused).toEqual([]);
    expect(out.restored).toEqual(["title"]);
    expect(api.tasks[1]).toMatchObject({ id: 7, title: TEST_VALUE, lock_version: 4 });
    const writes = writesOf(sent);
    expect(writes).toHaveLength(1);
    expect(new URL(writes[0]!.url).searchParams.get("lock_version")).toBe("3");
    expect(new URL(writes[0]!.url).pathname).toBe("/api/tasks/7");
    // Account A's own task was never written to.
    expect(api.tasks[0]).toMatchObject({ id: 1, title: "Account A's own task", lock_version: 4 });
  });

  it("leaves the query as the app sent it when the re-read doesn't show the version", async () => {
    const api = queryLockApi(false);
    const { ctx, sent } = fakeContext(api.handler);
    const snap = (await snapshotRecord(ctx, LIST, [TEST_VALUE]))!;
    const save = captured({ method: "PATCH", url: `${LIST}/7?lock_version=1`, postData: JSON.stringify({ title: TEST_VALUE }) });
    api.forge("forged rs7e57a1zz");

    const out = await restoreRecord(ctx, snap, { save });
    // Refused (409) for the stale version: named as not restored, never claimed.
    expect(out.restored).toEqual([]);
    expect(out.notRestored).toEqual(["title"]);
    expect(writesOf(sent).map((w) => w.url)).toEqual([`${LIST}/7?lock_version=1`]);
  });
});

describe("recordQueryStamps: which of an update's query parameters carry the record's own version", () => {
  const snapAt = (record: JsonObject) => ({ url: LIST, testValues: [TEST_VALUE], id: { key: "id", value: 7 }, chain: [record], record });
  const capture = (...requests: CapturedRequest[]): Capture => ({ requests, console: [], pageErrors: [] });
  const create = (answer: unknown) =>
    captured({ method: "POST", url: LIST, postData: JSON.stringify({ title: TEST_VALUE }), status: 201, responseBody: JSON.stringify(answer) });

  it("names a parameter whose value the save's answer showed for the record", () => {
    const save = create({ id: 7, title: TEST_VALUE, lock_version: 0 });
    const update = captured({ method: "PATCH", url: `${LIST}/7?lock_version=0&task%5Bversion%5D=0`, postData: JSON.stringify({ title: TEST_VALUE }) });
    const snap = snapAt({ id: 7, title: TEST_VALUE, lock_version: 1, version: 1 });
    expect([...recordQueryStamps(capture(save, update), save, update, snap, RUN_TOKEN)].sort()).toEqual(["lock_version"]);
  });

  it("names one a read of the record between the save and the update showed, or the snapshot shows", () => {
    const save = create({ ok: true });
    const read = captured({ url: LIST, responseBody: JSON.stringify([{ id: 1, title: "Groceries", etag: "e1" }, { id: 7, title: TEST_VALUE, etag: "e2" }]) });
    const update = captured({ method: "PATCH", url: `${LIST}/7?etag=e2&_rev=r9`, postData: JSON.stringify({ title: TEST_VALUE }) });
    expect([...recordQueryStamps(capture(save, read, update), save, update, snapAt({ id: 7, title: TEST_VALUE, etag: "e3", _rev: "r9" }), RUN_TOKEN)].sort()).toEqual([
      "_rev",
      "etag",
    ]);
  });

  it("never names a parameter whose value the record never showed (an API version), nor one another record showed", () => {
    const save = create({ id: 7, title: TEST_VALUE, version: 5 });
    const read = captured({ url: LIST, responseBody: JSON.stringify([{ id: 1, title: "Groceries", version: 2 }, { id: 7, title: TEST_VALUE, version: 5 }]) });
    const update = captured({ method: "PATCH", url: `${LIST}/7?version=2`, postData: JSON.stringify({ title: TEST_VALUE }) });
    // A read after the update (the record at 6) is not what the update was sent with.
    const later = captured({ url: LIST, responseBody: JSON.stringify([{ id: 7, title: TEST_VALUE, version: 2 }]) });
    expect([...recordQueryStamps(capture(save, read, update, later), save, update, snapAt({ id: 7, title: TEST_VALUE, version: 6 }), RUN_TOKEN)]).toEqual([]);
  });
});

describe("restoreRecord with the record's query stamps named (how.queryStamps)", () => {
  it("leaves a parameter the caller doesn't name as the app sent it, even when the re-read shows a field by that name", async () => {
    // An API that insists on ?version=2 (its API version); the record's own `version` is 5 and never checked.
    const tasks = [{ id: 7, title: TEST_VALUE, version: 5 }];
    const { ctx, sent } = fakeContext((req) => {
      const url = new URL(req.url);
      const method = (req.method ?? "GET").toUpperCase();
      if (method === "GET" && url.pathname === "/api/tasks") return json(200, tasks);
      if (method !== "PATCH" || url.pathname !== "/api/tasks/7") return json(404, { error: "Not found" });
      if (url.searchParams.get("version") !== "2") return json(400, { error: "Unsupported API version" });
      const body = JSON.parse(req.body ?? "{}") as JsonObject;
      if (typeof body.title === "string") tasks[0]!.title = body.title;
      tasks[0]!.version += 1;
      return json(200, tasks[0]);
    });
    const snap = (await snapshotRecord(ctx, LIST, [TEST_VALUE]))!;
    const save = captured({ method: "PATCH", url: `${LIST}/7?version=2`, postData: JSON.stringify({ title: TEST_VALUE }) });
    tasks[0]!.title = "forged rs7e57a1zz";
    tasks[0]!.version += 1;

    const out = await restoreRecord(ctx, snap, { save, queryStamps: new Set() });
    expect(out.restored).toEqual(["title"]);
    expect(tasks[0]!.title).toBe(TEST_VALUE);
    expect(writesOf(sent).map((w) => w.url)).toEqual([`${LIST}/7?version=2`]);
  });

  it("still refreshes a parameter the caller names", async () => {
    const api = queryLockApi(true);
    const { ctx, sent } = fakeContext(api.handler);
    const snap = (await snapshotRecord(ctx, LIST, [TEST_VALUE]))!;
    const save = captured({ method: "PATCH", url: `${LIST}/7?lock_version=1`, postData: JSON.stringify({ title: TEST_VALUE }) });
    api.tasks[1]!.lock_version = 2;
    api.forge("forged rs7e57a1zz");
    const out = await restoreRecord(ctx, snap, { save, queryStamps: new Set(["lock_version"]) });
    expect(out.restored).toEqual(["title"]);
    expect(new URL(writesOf(sent)[0]!.url).searchParams.get("lock_version")).toBe("3");
  });
});
