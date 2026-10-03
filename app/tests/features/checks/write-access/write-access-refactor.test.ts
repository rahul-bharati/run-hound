/**
 * Behavioral regression tests for the write-access refactor. Each test exercises a path that the focused modules
 * classify: URL/record matching (addressesRecord, collectionOf, resourceOf, namesOwnId, isTheRecord,
 * wholeRecordDiff, aroundId), the body's anti-CSRF swap (swapToken, withOwnTokens), the URL credential swap
 * (withOwnCredentials), the version-stamp refresh (withFreshStamps), and the effect/late-hit verdict helpers
 * (effectOf, saysRemoved, lateHit). The pure helpers come from `src/checks/write-access/`.
 */
import { describe, expect, it } from "vitest";
import { addressesRecord, aroundId, collectionOf, namesOwnId, pathCollectionOf, resourceOf } from "../../../../src/checks/write-access/record-match.js";
import { isTheRecord, kindOf, sensitiveBody, wholeRecordDiff } from "../../../../src/checks/write-access/record-body.js";
import { identityOf, markValue } from "../../../../src/checks/write-access/identity.js";
import { withOwnCredentials } from "../../../../src/checks/write-access/write-credentials.js";
import { swapToken, tokenFieldsOf, withOwnTokens } from "../../../../src/checks/write-access/csrf-tokens.js";
import { withOwnHeaderTokens } from "../../../../src/checks/write-access/header-tokens.js";
import { withFreshStamps } from "../../../../src/checks/write-access/stamps.js";
import { changedSummary, effectOf, lateHit, saysRemoved } from "../../../../src/checks/write-access/effect.js";
import type { CapturedRequest, JsonObject, RecordSnapshot } from "../../../../src/checks/lib/record-state.js";
import type { Sent, Write } from "../../../../src/interfaces/write-access.js";

function snap(over: Partial<RecordSnapshot> = {}): RecordSnapshot {
  return {
    id: { key: "id", value: 3 },
    record: { id: 3, title: "wa1hello", done: false, createdAt: "2024-01-01T00:00:00.000Z" },
    url: "https://app.example.com/api/tasks/3",
    ...over,
  } as RecordSnapshot;
}

function capture(url: string, postData: string | null, method: string = "PATCH", extra: Partial<CapturedRequest> = {}): CapturedRequest {
  return {
    url,
    method,
    postData,
    responseBody: null,
    headers: {},
    csrfHeaders: {},
    status: null,
    ...extra,
  } as CapturedRequest;
}

function write(over: Partial<Write> = {}): Write {
  return {
    method: "PATCH",
    url: "https://app.example.com/api/tasks/3",
    body: null,
    kind: null,
    observed: capture("https://app.example.com/api/tasks/3", null, "PATCH"),
    ...over,
  } as Write;
}

describe("write-access refactor: identity matching (identityOf)", () => {
  it("reads an other-account scenario id as the other identity", () => {
    expect(identityOf({ id: "write-access:other-account" })).toBe("other");
  });

  it("reads a signed-out scenario id as the signed-out identity", () => {
    expect(identityOf({ id: "write-access:signed-out" })).toBe("signed-out");
  });

  it("reads a later-form other-account scenario id as the other identity", () => {
    expect(identityOf({ id: "write-access:other-account@form-2" })).toBe("other");
  });

  it("reads a collided other-account scenario id as the other identity", () => {
    expect(identityOf({ id: "write-access:other-account#2" })).toBe("other");
  });

  it("returns null for an id that names neither identity", () => {
    expect(identityOf({ id: "write-access:other-account-bogus" })).toBeNull();
    expect(identityOf({ id: "csrf:cross-site-forge" })).toBeNull();
    expect(identityOf({ id: "write-access" })).toBeNull();
  });
});

describe("write-access refactor: markValue inserts the tag right after the run token", () => {
  it("appends the key and tag when the value has no run token", () => {
    expect(markValue("hello", "wa1", "x")).toBe("hello wa1x");
  });

  it("inserts the tag right after the run token when the value has one", () => {
    expect(markValue("hello wa1", "wa1", "x")).toBe("hello wa1x");
  });

  it("matches the run token case-insensitively (the value may be upper-cased)", () => {
    expect(markValue("Hello WA1 bye", "wa1", "x")).toBe("Hello WA1x bye");
  });
});

describe("write-access refactor: URL/record matching", () => {
  it("addressesRecord: matches the record's id as a path segment", () => {
    expect(addressesRecord("https://app.example.com/api/tasks/3", { key: "id", value: 3 })).toBe(true);
    expect(addressesRecord("https://app.example.com/api/tasks/9", { key: "id", value: 3 })).toBe(false);
  });

  it("addressesRecord: matches the record's id as a query value under the id key", () => {
    expect(addressesRecord("https://app.example.com/api/tasks?id=3", { key: "id", value: 3 })).toBe(true);
  });

  it("addressesRecord: a non-id-named query value is not the record's id", () => {
    expect(addressesRecord("https://app.example.com/api/tasks?count=3", { key: "id", value: 3 })).toBe(false);
  });

  it("addressesRecord: decodes percent-encoded path segments", () => {
    expect(addressesRecord("https://app.example.com/api/tasks/%33", { key: "id", value: 3 })).toBe(true);
  });

  it("collectionOf: cuts the record's id from the path (aroundId prefix)", () => {
    expect(collectionOf("https://app.example.com/api/tasks/3", { key: "id", value: 3 })).toBe("https://app.example.com/api/tasks/");
  });

  it("collectionOf: a list URL whose query doesn't name the id is left whole with one trailing slash", () => {
    expect(collectionOf("https://app.example.com/api/tasks?count=3", { key: "id", value: 3 })).toBe("https://app.example.com/api/tasks/");
  });

  it("collectionOf: a list URL whose query names the id cuts it out (aroundId prefix)", () => {
    expect(collectionOf("https://app.example.com/api/tasks?listId=3", { key: "id", value: 3 })).toBe("https://app.example.com/api/tasks?listId=");
  });

  it("pathCollectionOf: a list read's path (with nothing cut) is the collection", () => {
    expect(pathCollectionOf("https://app.example.com/api/lists/3")).toBe("https://app.example.com/api/lists/3/");
  });

  it("resourceOf: the resource of a URL naming the id is the path segment before it (singular and plural)", () => {
    expect(resourceOf("https://app.example.com/api/tasks/3", { key: "id", value: 3 })).toEqual(
      expect.arrayContaining(["task", "tasks"]),
    );
  });

  it("namesOwnId: matches the id in the path or under the id query key only", () => {
    expect(namesOwnId("https://app.example.com/api/tasks/3", { key: "id", value: 3 })).toBe(true);
    expect(namesOwnId("https://app.example.com/api/tasks?id=3", { key: "id", value: 3 })).toBe(true);
    expect(namesOwnId("https://app.example.com/api/tasks?listId=3", { key: "id", value: 3 })).toBe(false);
  });

  it("aroundId: a path-segment id is the last segment, split into prefix and suffix", () => {
    const around = aroundId(new URL("https://app.example.com/api/tasks/3"), { key: "id", value: 3 });
    expect(around).toEqual({ prefix: "/api/tasks/", suffix: "" });
  });

  it("aroundId: a query-value id is split with a percent-encoded parameter", () => {
    const around = aroundId(new URL("https://app.example.com/api/tasks?id=3"), { key: "id", value: 3 });
    expect(around).toEqual({ prefix: "/api/tasks?id=", suffix: "" });
  });
});

describe("write-access refactor: body kind and sensitive-key detection", () => {
  it("kindOf: a JSON object body is 'json'", () => {
    expect(kindOf('{"title":"x"}')).toBe("json");
  });

  it("kindOf: a form body with at least one value is 'form'", () => {
    expect(kindOf("title=x&done=1")).toBe("form");
  });

  it("kindOf: an empty body is null", () => {
    expect(kindOf(null)).toBeNull();
    expect(kindOf("")).toBeNull();
  });

  it("kindOf: a free-form string that is not form-encoded is null", () => {
    expect(kindOf("not a body")).toBeNull();
  });

  it("sensitiveBody: a body with a password key is sensitive (at the top)", () => {
    expect(sensitiveBody('{"title":"x","password":"x"}')).toBe(true);
  });

  it("sensitiveBody: a body with a password key one level down is sensitive", () => {
    expect(sensitiveBody('{"task":{"title":"x","password":"x"}}')).toBe(true);
  });

  it("sensitiveBody: a body with a nested email key is sensitive", () => {
    expect(sensitiveBody('{"user":{"email":"a@b.c"}}')).toBe(true);
  });

  it("sensitiveBody: a body without password or email is not sensitive", () => {
    expect(sensitiveBody('{"title":"x"}')).toBe(false);
  });
});

describe("write-access refactor: isTheRecord and wholeRecordDiff", () => {
  const key = "wa1";
  const id = { key: "id", value: 3 };
  const snapShot = snap();

  it("isTheRecord: a JSON body with the record's run-token field and id is the record", () => {
    expect(isTheRecord('{"id":3,"title":"wa1hello","done":false}', snapShot, id, key, true)).toBe(true);
  });

  it("isTheRecord: a body without the id is the record only when needsId is false (the request body case)", () => {
    expect(isTheRecord('{"title":"wa1hello","done":false}', snapShot, id, key, false)).toBe(true);
  });

  it("isTheRecord: a body that only mentions a test value under another key is not the record", () => {
    expect(isTheRecord('{"latest":"wa1hello"}', snapShot, id, key, false)).toBe(false);
  });

  it("isTheRecord: a form body holding the record under the model's name (Rails) is the record", () => {
    expect(isTheRecord("task[title]=wa1hello&task[done]=false", snapShot, id, key, false)).toBe(true);
  });

  it("wholeRecordDiff: a read that holds every snapshot field, with the same run-token values, diffs to nothing", () => {
    const json = { id: 3, title: "wa1hello", done: false, createdAt: "2024-01-01T00:00:00.000Z" };
    expect(wholeRecordDiff(json, snapShot, id, key, key)).toEqual([]);
  });

  it("wholeRecordDiff: a read missing one of the snapshot's other fields is not the record (returns null)", () => {
    const json = { id: 3, title: "wa1hello", done: false };
    expect(wholeRecordDiff(json, snapShot, id, key, key)).toBeNull();
  });

  it("wholeRecordDiff: a read that differs in a non-managed field lists that field as the diff", () => {
    const json = { id: 3, title: "wa1hello", done: true, createdAt: "2024-01-01T00:00:00.000Z" };
    expect(wholeRecordDiff(json, snapShot, id, key, key)).toEqual(["done"]);
  });

  it("wholeRecordDiff: a read under a different createdAt is the record with a different non-managed field", () => {
    const json = { id: 3, title: "wa1hello", done: false, createdAt: "2024-01-02T00:00:00.000Z" };
    expect(wholeRecordDiff(json, snapShot, id, key, key)).toEqual(["createdAt"]);
  });
});

describe("write-access refactor: body anti-CSRF token helpers", () => {
  it("tokenFieldsOf: a JSON body's csrf token field is found at any depth", () => {
    const body = JSON.stringify({ task: { title: "x", csrfmiddlewaretoken: "csrf-aa11" } });
    const tokens = new Set(["csrf-aa11"]);
    expect(tokenFieldsOf(body, "json", tokens, "wa1")).toEqual([{ field: "task.csrfmiddlewaretoken", value: "csrf-aa11" }]);
  });

  it("tokenFieldsOf: a form body's csrf token field is found at the top", () => {
    const tokens = new Set(["csrf-aa11"]);
    expect(tokenFieldsOf("csrfmiddlewaretoken=csrf-aa11&title=x", "form", tokens, "wa1")).toEqual([
      { field: "csrfmiddlewaretoken", value: "csrf-aa11" },
    ]);
  });

  it("tokenFieldsOf: a value the identity typed is not a token field (carries the run key)", () => {
    const tokens = new Set<string>();
    expect(tokenFieldsOf("title=wa1hello&done=1", "form", tokens, "wa1")).toEqual([]);
  });

  it("swapToken: a JSON body's token field value is replaced at any depth", () => {
    const out = swapToken(JSON.stringify({ task: { title: "x", csrfmiddlewaretoken: "csrf-aa11" } }), "json", "csrf-aa11", "csrf-bb22");
    expect(out).toBe(JSON.stringify({ task: { title: "x", csrfmiddlewaretoken: "csrf-bb22" } }));
  });

  it("swapToken: a form body's token field value is replaced", () => {
    expect(swapToken("csrfmiddlewaretoken=csrf-aa11&title=x", "form", "csrf-aa11", "csrf-bb22")).toBe(
      "csrfmiddlewaretoken=csrf-bb22&title=x",
    );
  });

  it("withOwnTokens: a write whose body token is in `ours` is swapped to the identity's value", () => {
    const w = write({ body: JSON.stringify({ csrfmiddlewaretoken: "csrf-aa11" }), kind: "json" });
    const ours = [{ kind: "meta" as const, name: "csrf-token", value: "csrf-aa11" }];
    const theirs = [{ kind: "meta" as const, name: "csrf-token", value: "csrf-bb22" }];
    const out = withOwnTokens([w], ours, theirs, "wa1", new Set())[0]!;
    expect(JSON.parse(out.body!).csrfmiddlewaretoken).toBe("csrf-bb22");
    expect(out.tokens).toEqual([{ field: "csrfmiddlewaretoken", swapped: true }]);
  });

  it("withOwnTokens: a write whose body token can't be matched stays as Account A's (swapped: false)", () => {
    const w = write({ body: JSON.stringify({ csrfmiddlewaretoken: "csrf-aa11" }), kind: "json" });
    const ours = [{ kind: "meta" as const, name: "csrf-token", value: "csrf-aa11" }];
    const theirs: { kind: "meta"; name: string; value: string }[] = [];
    const out = withOwnTokens([w], ours, theirs, "wa1", new Set())[0]!;
    expect(JSON.parse(out.body!).csrfmiddlewaretoken).toBe("csrf-aa11");
    expect(out.tokens).toEqual([{ field: "csrfmiddlewaretoken", swapped: false }]);
  });

  it("withOwnTokens: a cookie-token value read from a page that set the cookie anew is drifted", () => {
    const w = write({ body: JSON.stringify({ csrfmiddlewaretoken: "csrf-aa11" }), kind: "json" });
    const ours = [{ kind: "cookie" as const, name: "csrftoken", value: "csrf-aa11" }];
    const theirs = [{ kind: "cookie" as const, name: "csrftoken", value: "csrf-bb22" }];
    const out = withOwnTokens([w], ours, theirs, "wa1", new Set(["csrftoken"]))[0]!;
    expect(JSON.parse(out.body!).csrfmiddlewaretoken).toBe("csrf-bb22");
    expect(out.tokens).toEqual([{ field: "csrfmiddlewaretoken", swapped: true, drifted: ["csrftoken"] }]);
  });

  it("withOwnTokens: a form body with the token value in a later duplicate field swaps both, not just the first", () => {
    // The app sent the token field twice (Rails / some templates duplicate the hidden input). The first has a
    // placeholder, the second holds Account A's real token. A naive `Set(params.keys()) + params.get` would see
    // the placeholder and skip; HEAD's [...params] snapshot visits both and replaces both. Otherwise the swap
    // looks like it didn't happen, withOwnTokens reports swapped=false, and a CSRF refusal is misread as a pass.
    const w = write({ body: "guard=placeholder&guard=csrf-aa11&title=x", kind: "form" });
    const ours = [{ kind: "input" as const, name: "guard", value: "csrf-aa11" }];
    const theirs = [{ kind: "input" as const, name: "guard", value: "csrf-bb22" }];
    const out = withOwnTokens([w], ours, theirs, "wa1", new Set())[0]!;
    expect(out.body).toBe("guard=csrf-bb22&title=x");
    expect(out.tokens).toEqual([{ field: "guard", swapped: true }]);
  });

  it("withOwnTokens: a form body with the token field repeated replaces the first matching value via params.set; the b/c duplicates of the same key are collapsed", () => {
    // URLSearchParams.set on a repeated key keeps one entry and discards the others. The body ends up as
    // `csrf=X`; the `b` and `c` are gone. `tokenFieldsOf` still reports all three entries from the snapshot
    // (b and c weren't in `ours`, so swapped:false), and the verdict uses the swap result: one of three
    // occurrences swapped is the security-relevant outcome.
    const w = write({ body: "csrf=a&csrf=b&csrf=c", kind: "form" });
    const ours = [{ kind: "meta" as const, name: "csrf-token", value: "a" }];
    const theirs = [{ kind: "meta" as const, name: "csrf-token", value: "X" }];
    const out = withOwnTokens([w], ours, theirs, "wa1", new Set())[0]!;
    expect(out.body).toBe("csrf=X");
    expect(out.tokens).toEqual([
      { field: "csrf", swapped: true },
      { field: "csrf", swapped: false },
      { field: "csrf", swapped: false },
    ]);
  });
});

describe("write-access refactor: header anti-CSRF token helpers", () => {
  it("withOwnHeaderTokens: a header paired with a same-name source goes as the identity's value", () => {
    const w = write({ observed: capture("https://app.example.com/api/tasks/3", null, "PATCH", { csrfHeaders: { "X-CSRFToken": "csrf-aa11" } }) });
    const ours = [{ kind: "cookie" as const, name: "csrftoken", value: "csrf-aa11" }];
    const theirs = [{ kind: "cookie" as const, name: "csrftoken", value: "csrf-bb22" }];
    const out = withOwnHeaderTokens([w], ours, theirs, new Set())[0]!;
    expect(out.headers).toEqual({ "X-CSRFToken": "csrf-bb22" });
    expect(out.headerTokens).toEqual([{ name: "X-CSRFToken", swapped: true }]);
  });

  it("withOwnHeaderTokens: a header whose value no source on Account A's page holds any more is paired by name (Laravel's X-XSRF-TOKEN re-encrypted cookie)", () => {
    const w = write({ observed: capture("https://app.example.com/api/tasks/3", null, "PATCH", { csrfHeaders: { "X-XSRF-TOKEN": "csrf-aa11" } }) });
    const ours: { kind: "cookie" | "meta" | "input"; name: string; value: string }[] = [];
    const theirs = [{ kind: "cookie" as const, name: "xsrf-token", value: "csrf-bb22%3D" }];
    const out = withOwnHeaderTokens([w], ours, theirs, new Set())[0]!;
    expect(out.headers).toEqual({ "X-XSRF-TOKEN": "csrf-bb22=" });
    expect(out.headerTokens).toEqual([{ name: "X-XSRF-TOKEN", swapped: true }]);
  });

  it("withOwnHeaderTokens: a header with no token of the identity's own is left out (Account A's is never sent)", () => {
    const w = write({ observed: capture("https://app.example.com/api/tasks/3", null, "PATCH", { csrfHeaders: { "X-CSRFToken": "csrf-aa11" } }) });
    const out = withOwnHeaderTokens([w], [], [], new Set())[0]!;
    expect(out.headers).toEqual({});
    expect(out.headerTokens).toEqual([{ name: "X-CSRFToken", swapped: false }]);
  });
});

describe("write-access refactor: URL credential swap", () => {
  it("withOwnCredentials: a URL credential is replaced with the identity's own value", () => {
    const w = write({ url: "https://app.example.com/api/tasks/3?access_token=token-aa11" });
    const theirs = new Map([["https://app.example.com access_token", "token-bb22"]]);
    const out = withOwnCredentials(w, theirs, "wa1");
    expect(out.url).toBe("https://app.example.com/api/tasks/3?access_token=token-bb22");
    expect(out.credentials).toEqual([{ param: "access_token", swapped: true }]);
  });

  it("withOwnCredentials: a URL credential the identity didn't send is removed (not sent as Account A's)", () => {
    const w = write({ url: "https://app.example.com/api/tasks/3?access_token=token-aa11" });
    const out = withOwnCredentials(w, new Map(), "wa1");
    expect(out.url).toBe("https://app.example.com/api/tasks/3");
    expect(out.credentials).toEqual([{ param: "access_token", swapped: false }]);
  });

  it("withOwnCredentials: a URL with no credential is unchanged", () => {
    const w = write({ url: "https://app.example.com/api/tasks/3" });
    const out = withOwnCredentials(w, new Map(), "wa1");
    expect(out).toBe(w);
  });
});

describe("write-access refactor: version-stamp refresh (withFreshStamps)", () => {
  it("withFreshStamps: a JSON body stamp is updated to the re-read's value", () => {
    const w = write({ body: JSON.stringify({ title: "x", lock_version: 0 }), kind: "json" });
    const pre: JsonObject = { id: 3, title: "x", done: false, lock_version: 1 };
    const out = withFreshStamps(w, pre, "wa1", new Set());
    expect(JSON.parse(out.body!).lock_version).toBe(1);
  });

  it("withFreshStamps: a JSON body stamp the re-read doesn't show is left as the app sent it, and named in staleStamps", () => {
    const w = write({ body: JSON.stringify({ title: "x", updatedAt: "2024-01-01" }), kind: "json" });
    const pre: JsonObject = { id: 3, title: "x", done: false };
    const out = withFreshStamps(w, pre, "wa1", new Set());
    expect(out.staleStamps).toContain("updatedAt");
  });

  it("withFreshStamps: a form body stamp is updated", () => {
    const w = write({ body: "title=x&lock_version=0", kind: "form" });
    const pre: JsonObject = { id: 3, title: "x", done: false, lock_version: 2 };
    const out = withFreshStamps(w, pre, "wa1", new Set());
    expect(out.body).toBe("title=x&lock_version=2");
  });

  it("withFreshStamps: a URL-query stamp is updated only when the parameter is in queryStamps", () => {
    const w = write({ url: "https://app.example.com/api/tasks/3?lock_version=0", body: "title=x", kind: "form" });
    const pre: JsonObject = { id: 3, title: "x", done: false, lock_version: 2 };
    const out = withFreshStamps(w, pre, "wa1", new Set(["lock_version"]));
    expect(out.url).toBe("https://app.example.com/api/tasks/3?lock_version=2");
  });

  it("withFreshStamps: a URL-query stamp the re-read doesn't show is left as the app sent it, and named in staleStamps", () => {
    const w = write({ url: "https://app.example.com/api/tasks/3?version=5", body: "title=x", kind: "form" });
    const pre: JsonObject = { id: 3, title: "x", done: false };
    const out = withFreshStamps(w, pre, "wa1", new Set());
    expect(out.url).toBe("https://app.example.com/api/tasks/3?version=5");
    expect(out.staleStamps).toContain("version");
  });

  it("withFreshStamps: a URL query with the stamp key repeated visits the key once and the fresh value is applied (HEAD's Set(params.keys()) semantics)", () => {
    // HEAD's `for (const k of new Set(params.keys()))` iterates each distinct key once. `params.set(k, now)` overwrites
    // the first occurrence and discards the rest (URLSearchParams.set on a repeated key). The fresh value is applied
    // to the surviving first entry.
    const w = write({ url: "https://app.example.com/api/tasks/3?lock_version=0&lock_version=1", body: "title=x", kind: "form" });
    const pre: JsonObject = { id: 3, title: "x", done: false, lock_version: 2 };
    const out = withFreshStamps(w, pre, "wa1", new Set(["lock_version"]));
    expect(out.url).toBe("https://app.example.com/api/tasks/3?lock_version=2");
  });
});

describe("write-access refactor: effect classification", () => {
  const before: JsonObject = { id: 3, title: "wa1hello", done: false, deletedAt: null };

  it("saysRemoved: a field named deletedAt with a date says the record was removed", () => {
    expect(saysRemoved("deletedAt", "2024-01-01T00:00:00.000Z")).toBe(true);
  });

  it("saysRemoved: a boolean isActive=false says the record was removed", () => {
    expect(saysRemoved("isActive", false)).toBe(true);
  });

  it("saysRemoved: a status='inactive' string says the record was removed", () => {
    expect(saysRemoved("status", "inactive")).toBe(true);
  });

  it("saysRemoved: a changed-by-itself field (updatedAt) doesn't say removed", () => {
    expect(saysRemoved("updatedAt", "2024-01-01T00:00:00.000Z")).toBe(false);
  });

  it("effectOf: a missing record is 'gone'", () => {
    const w = write({ field: "title" });
    expect(effectOf(w, before, "gone", new Set())).toEqual({ gone: true, changed: [] });
  });

  it("effectOf: an update whose field changed is the field's effect", () => {
    const w = write({ field: "title" });
    const after: JsonObject = { ...before, title: "wa1xbhello" };
    expect(effectOf(w, before, [after], new Set())).toEqual({ gone: false, changed: ["title"] });
  });

  it("effectOf: a DELETE that left the record with a deletedAt says removed via the deletedAt field", () => {
    const w = write({ method: "DELETE" });
    const after: JsonObject = { ...before, deletedAt: "2024-01-01T00:00:00.000Z" };
    expect(effectOf(w, before, [after], new Set())).toEqual({ gone: false, changed: ["deletedAt"] });
  });

  it("effectOf: a volatile field's change is not the effect", () => {
    const w = write({ field: "title" });
    const after: JsonObject = { ...before, updatedAt: "2024-01-01T00:00:00.000Z" };
    expect(effectOf(w, before, [after], new Set(["updatedAt"]))).toBeNull();
  });
});

describe("write-access refactor: late-hit verdict (lateHit)", () => {
  const before: JsonObject = { id: 3, title: "wa1hello", done: false };

  it("lateHit: a later re-read where the field no longer holds its pre value is the late write's effect", () => {
    const w = write({ method: "PATCH", field: "title", value: "wa1xbhello" });
    const sent: Sent[] = [{ w, status: 200 }];
    const later: JsonObject = { ...before, title: "wa1xbhello" };
    expect(lateHit(sent, [later], before, new Set())).toEqual({
      w,
      status: 200,
      effect: { gone: false, changed: ["title"] },
    });
  });

  it("lateHit: a later re-read where the field still holds its pre value returns null", () => {
    const w = write({ method: "PATCH", field: "title", value: "wa1xbhello" });
    const sent: Sent[] = [{ w, status: 200 }];
    const later: JsonObject = { ...before };
    expect(lateHit(sent, [later], before, new Set())).toBeNull();
  });

  it("lateHit: a later re-read where the record is gone names the DELETE (else the last write) as the cause", () => {
    const del = write({ method: "DELETE" });
    const sent: Sent[] = [{ w: del, status: 200 }];
    expect(lateHit(sent, "gone", before, new Set())).toEqual({
      w: del,
      status: 200,
      effect: { gone: true, changed: [] },
    });
  });

  it("lateHit: a later re-read where the record is gone and the last write is an update names the last write", () => {
    const w = write({ method: "PATCH", field: "title", value: "wa1xbhello" });
    const sent: Sent[] = [{ w, status: 200 }];
    expect(lateHit(sent, "gone", before, new Set())).toEqual({
      w,
      status: 200,
      effect: { gone: true, changed: [] },
    });
  });
});

describe("write-access refactor: changedSummary (notes' first sentence)", () => {
  it("changedSummary: an other-account subject with two findings joins them with ', '", () => {
    const text = changedSummary("other", [{ location: "PATCH /api/tasks/3" }, { location: "DELETE /api/tasks/3" }]);
    expect(text).toBe("Account B changed Account A's test record: PATCH /api/tasks/3, DELETE /api/tasks/3.");
  });

  it("changedSummary: a signed-out subject singularises 'visitors' to 'visitor'", () => {
    const text = changedSummary("signed-out", [{ location: "PATCH /api/tasks/3" }]);
    expect(text).toBe("Signed-out visitor changed Account A's test record: PATCH /api/tasks/3.");
  });

  it("changedSummary: a signed-out subject singularises 'visitors' to 'visitor'", () => {
    const text = changedSummary("signed-out", [{ location: "PATCH /api/tasks/3" }]);
    expect(text).toBe("Signed-out visitor changed Account A's test record: PATCH /api/tasks/3.");
  });
});
