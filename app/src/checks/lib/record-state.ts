/**
 * The run's own test record, read and put back as Account A (0.5.0, docs/v2-spec.md "Types and shared helpers"). Shared
 * by the write-side checks (csrf, write-access) and mass-assignment: find the record endpoint after a save, snapshot the record, re-read it after an attempt, and restore it. Every read is a GET as Account A through
 * CheckContext.request (the safety gate applies), and a snapshot only ever holds a record carrying the run token, so
 * a restore never writes to one of Account A's own records.
 */
import type { Page, Request, Route } from "playwright";
import { carriesTestValues, isLocalOrigin, isSameOrigin, tokenKey } from "../../core/saves.js";
import type { Capture, CheckContext, DiscoveredForm } from "../../core/types.js";
import { isDestructiveControl } from "../dead-control.js";
import { actsWhenLoaded, urlWords } from "./acting-links.js";
import { fieldName, isSearchForm, submitControl } from "./functional-form.js";

export type JsonObject = Record<string, unknown>;

/** Forms whose save changes the account itself, not a record: never used for the test record (as access-control). */
const ACCOUNT_FORM =
  /\b(passwords?|passcode|e-?mail|two[\s-]?factor|2fa|mfa|security|sign\s?-?(in|up|out)|log\s?-?(in|out)|register|delete|close\s+(my\s+)?account|deactivate|username)\b/i;

/**
 * True for a form that saves a record Run Hound may create as Account A (the write-side checks' test record): fields
 * and a submit control, not a search, no password or email field (a change-password/email form would change the
 * account it signs in with), a submit that isn't destructive, and a name that doesn't say it changes the account. Same
 * rule as access-control step 1.
 */
export function savesOwnRecord(form: DiscoveredForm): boolean {
  const submit = submitControl(form);
  if (!submit || form.fields.length === 0 || isSearchForm(form)) return false;
  if (form.fields.some((f) => f.type === "password" || f.type === "email" || /e-?mail/i.test(fieldName(f)))) return false;
  if (isDestructiveControl(submit)) return false;
  return !ACCOUNT_FORM.test(`${form.name ?? ""} ${submit.accessibleName ?? ""} ${submit.text}`);
}

/** A request the page made, as the capture holds it. */
export type CapturedRequest = Capture["requests"][number];

export function parseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/** A JSON object body (not an array, not a scalar), or null. */
export function jsonObjectBody(body: string | null | undefined): Record<string, unknown> | null {
  if (!body) return null;
  const value = parseJson(body);
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * The records of `node` (parsed JSON) that hold one of `needles` (the test values Run Hound typed): for each, the chain
 * of objects from the one holding the value up to the root, deepest first. One chain per record. A list of other
 * people or older records is never part of a chain, so its values never count.
 */
export function recordChains(node: unknown, needles: string[]): JsonObject[][] {
  const chains: JsonObject[][] = [];
  const seen = new Set<JsonObject>();
  const walk = (n: unknown, parents: JsonObject[], depth: number) => {
    if (depth > 12) return;
    if (typeof n === "string") {
      const holder = parents[parents.length - 1];
      if (holder && !seen.has(holder) && needles.some((v) => n.includes(v))) {
        seen.add(holder);
        chains.push([...parents].reverse());
      }
      return;
    }
    if (Array.isArray(n)) {
      for (const item of n) walk(item, parents, depth + 1);
      return;
    }
    if (n && typeof n === "object") {
      const obj = n as JsonObject;
      for (const v of Object.values(obj)) walk(v, [...parents, obj], depth + 1);
    }
  };
  walk(node, [], 0);
  return chains;
}

/** The value of `key` in the nearest object of `chain` that has it (the record itself first, then its parents). */
export function nearest(chain: JsonObject[], key: string): { found: boolean; value?: unknown } {
  for (const obj of chain) if (Object.prototype.hasOwnProperty.call(obj, key)) return { found: true, value: obj[key] };
  return { found: false };
}

/**
 * The record endpoint: a GET the page made after the save whose JSON object holds a test value. A read from the app's
 * API on another local origin has no body in the capture, so those are read again as Account A (at most 10).
 * `arrays` (the write-side checks) also takes a JSON array, such as a bare `GET /api/tasks` list, when a record in it
 * holds a test value; mass-assignment keeps the object-only rule it had.
 */
export async function findOwnRecord(
  ctx: CheckContext,
  capture: Capture,
  testValues: string[],
  options: { arrays?: boolean } = {},
): Promise<{ url: string; body: string } | null> {
  const holdsTestValue = (body: string | null | undefined): body is string => {
    if (!body || !testValues.some((v) => body.includes(v))) return false;
    if (jsonObjectBody(body)) return true;
    return Boolean(options.arrays) && recordChains(parseJson(body), testValues).length > 0;
  };
  const ok = (r: CapturedRequest) => r.method.toUpperCase() === "GET" && typeof r.status === "number" && r.status >= 200 && r.status < 300;
  for (const r of capture.requests) if (ok(r) && holdsTestValue(r.responseBody)) return { url: r.url, body: r.responseBody };
  const tried = new Set<string>();
  for (const r of [...capture.requests]) {
    if (!ok(r) || r.responseBody || !["fetch", "xhr"].includes(r.resourceType) || tried.has(r.url) || tried.size >= 10) continue;
    if (isSameOrigin(r.url, ctx.targetUrl) || !isLocalOrigin(r.url, ctx.targetUrl)) continue;
    tried.add(r.url);
    const again = await ctx.request("self", { method: "GET", url: r.url }).catch(() => null);
    if (again && again.status >= 200 && again.status < 300 && holdsTestValue(again.body)) return { url: r.url, body: again.body };
  }
  return null;
}

/** Keys a record's own id goes by, in the order they are looked for. */
const ID_KEYS = ["id", "_id", "uuid"];

/** The record's own id (`id`, `_id` or `uuid`, a string or a number), or null when it has none. */
export function recordId(record: JsonObject): { key: string; value: string | number } | null {
  for (const key of ID_KEYS) {
    const value = record[key];
    if ((typeof value === "string" && value !== "") || (typeof value === "number" && Number.isFinite(value))) return { key, value };
  }
  return null;
}

/** Account A's test record as it was before an attempt: where it is read, how it is recognised, and its values. */
export interface RecordSnapshot {
  /** The record endpoint (a GET as Account A). */
  url: string;
  /** The test values that identify the record; every one carries the run token. */
  testValues: string[];
  /** The record's own id, when it has one: a re-read finds the record by it, whatever its values are then. */
  id: { key: string; value: string | number } | null;
  /** The record and its parents, deepest first, as parsed from the snapshot's read. */
  chain: JsonObject[];
  /** The record itself (chain[0]). */
  record: JsonObject;
}

/** The chains (deepest first) of every object in `node` whose `key` is `value`. */
function chainsWithId(node: unknown, key: string, value: string | number): JsonObject[][] {
  const chains: JsonObject[][] = [];
  const walk = (n: unknown, parents: JsonObject[], depth: number) => {
    if (depth > 12) return;
    if (Array.isArray(n)) {
      for (const item of n) walk(item, parents, depth + 1);
      return;
    }
    if (n && typeof n === "object") {
      const obj = n as JsonObject;
      const path = [...parents, obj];
      if (obj[key] === value) chains.push([...path].reverse());
      for (const v of Object.values(obj)) walk(v, path, depth + 1);
    }
  };
  walk(node, [], 0);
  return chains;
}

/** GET `url` as Account A: its JSON, "gone" for a 404 or 410, null when the read failed or is not JSON. */
async function readJson(ctx: CheckContext, url: string): Promise<{ json: unknown } | "gone" | null> {
  const answer = await ctx.request("self", { method: "GET", url }).catch(() => null);
  if (!answer) return null;
  if (answer.status === 404 || answer.status === 410) return "gone";
  if (answer.status < 200 || answer.status >= 300) return null;
  const json = parseJson(answer.body);
  return json === null && answer.body.trim() !== "null" ? null : { json };
}

/**
 * How a check reads and writes as Account A for rereadRecord and restoreRecord. The default goes through
 * CheckContext.request. csrf passes its own (see csrf.ts ioAsA): Playwright's request context sends a `Secure` cookie
 * over http only to localhost, never to 127.0.0.1, so on such a target a SameSite=None session only works through
 * Account A's own browser page.
 */
export interface RecordIO {
  /** GET `url` as Account A: its JSON, "gone" for a 404 or 410, null when the read failed. */
  read(url: string): Promise<{ json: unknown } | "gone" | null>;
  /** Sends a write as Account A: its status, or null when no answer came. */
  send(req: { method: string; url: string; contentType: string; body: string }): Promise<number | null>;
}

/** RecordIO through CheckContext.request, as Account A. */
export function requestIO(ctx: CheckContext): RecordIO {
  return {
    read: (url) => readJson(ctx, url),
    send: async (r) => {
      const answer = await ctx
        .request("self", { method: r.method, url: r.url, headers: { "content-type": r.contentType }, body: r.body })
        .catch(() => null);
      return answer ? answer.status : null;
    },
  };
}

/**
 * Reads the record endpoint as Account A and keeps the run's test record: the first record holding one of `testValues`
 * that carries the run token (values without it are ignored, so one of Account A's own records is never taken for
 * it). Null when the read fails, the answer is not JSON, or no such record is there.
 */
export async function snapshotRecord(ctx: CheckContext, url: string, testValues: string[]): Promise<RecordSnapshot | null> {
  const key = tokenKey(ctx.runToken);
  if (!key || !testValues.some((v) => v.toLowerCase().includes(key))) return null;
  const read = await readJson(ctx, url);
  if (read === null || read === "gone") return null;
  return snapshotFrom(url, read.json, testValues, ctx.runToken);
}

/**
 * snapshotRecord on a read already made (`json`, the record endpoint's parsed answer), for a check that reads as
 * Account A some other way (csrf reads through Account A's own browser page). Same rule: only a run-token record.
 */
export function snapshotFrom(url: string, json: unknown, testValues: string[], runToken: string): RecordSnapshot | null {
  const key = tokenKey(runToken);
  const own = key ? testValues.filter((v) => v.toLowerCase().includes(key)) : [];
  if (own.length === 0) return null;
  const chain = recordChains(json, own)[0];
  if (!chain || chain.length === 0) return null;
  const record = chain[0]!;
  return { url, testValues: own, id: recordId(record), chain, record };
}

/**
 * Re-reads the snapshot's record as Account A: its chain (the record first, then its parents), "gone" when it is no
 * longer there, or null when the re-read itself failed (or can't tell which record is the test record). With an id the
 * record is found by it; without one, by its test values, else by the one record that carries the run token and has
 * the same fields (an attempt may have changed every test value to a new run-token value).
 */
export async function rereadRecord(ctx: CheckContext, snap: RecordSnapshot, io: RecordIO = requestIO(ctx)): Promise<JsonObject[] | "gone" | null> {
  const read = await io.read(snap.url);
  if (read === null || read === "gone") return read;
  return locateRecord(read.json, snap, ctx.runToken);
}

/** rereadRecord on a read already made (`json`, the record endpoint's parsed answer). */
export function locateRecord(json: unknown, snap: RecordSnapshot, runToken: string): JsonObject[] | "gone" | null {
  if (snap.id) {
    const byId = chainsWithId(json, snap.id.key, snap.id.value);
    return byId[0] ?? "gone";
  }
  const byValues = recordChains(json, snap.testValues);
  if (byValues[0]) return byValues[0];
  const key = tokenKey(runToken);
  const fields = Object.keys(snap.record).sort().join("\n");
  const byToken = recordChains(json, key ? [key] : []).filter((c) => Object.keys(c[0]!).sort().join("\n") === fields);
  if (byToken.length === 1) return byToken[0]!;
  return byToken.length === 0 ? "gone" : null;
}

/**
 * True when `record` (an object of `json`) sits in a list: the record endpoint reads a collection, so a record a write
 * created there would show up in a re-read. A read of the one record (GET /api/items/7) would not show it.
 */
export function readsList(json: unknown, record: JsonObject): boolean {
  const walk = (n: unknown, depth: number): boolean => {
    if (depth > 12 || !n || typeof n !== "object") return false;
    if (Array.isArray(n)) return n.some((item) => item === record || walk(item, depth + 1));
    return Object.values(n as JsonObject).some((v) => walk(v, depth + 1));
  };
  return walk(json, 0);
}

/** True when `url` names `id` as a whole path segment or query value ("/api/tasks/7", "?id=7"). */
export function urlNamesId(url: string, id: string | number): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url, "http://x");
  } catch {
    return false;
  }
  const want = String(id);
  const decode = (s: string) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  };
  if (parsed.pathname.split("/").some((seg) => decode(seg) === want)) return true;
  return [...parsed.searchParams.values()].includes(want);
}

/**
 * Endpoints no write-side check ever writes to, even with --allow-destructive (docs/v2-spec.md "Safety contract"):
 * sign-out, password, email, account deletion, payment or checkout, invitations and sharing, plus any path that acts
 * when loaded (deep-links' rule).
 */
const NEVER_WRITTEN =
  /\b(log ?out|log ?off|sign ?out|passwords?|passcode|e ?mails?|delete account|account delete|deactivate|close account|checkout|payments?|pay|billing|stripe|paypal|paddle|invit\w*|share|sharing|shared with|collaborators?)\b/i;

/** True when `url` is an endpoint the write-side checks must never write to (see NEVER_WRITTEN). */
export function neverWritten(url: string): boolean {
  return actsWhenLoaded(url) || NEVER_WRITTEN.test(urlWords(url));
}

/**
 * The writes the app itself sent for the test record in `capture`: PUT, PATCH, POST or DELETE requests to a URL that
 * names the record's id, to the target's origin or the app's local API, that the app accepted (2xx). Never guessed:
 * none without an id. DELETE requests come last. Endpoints in neverWritten are left out.
 */
export function recordWrites(capture: Capture, snap: RecordSnapshot, targetUrl: string): CapturedRequest[] {
  const id = snap.id;
  if (!id) return [];
  const writes = capture.requests.filter((r) => {
    const method = r.method.toUpperCase();
    if (!["PUT", "PATCH", "POST", "DELETE"].includes(method)) return false;
    if (typeof r.status !== "number" || r.status < 200 || r.status >= 300) return false;
    if (!isSameOrigin(r.url, targetUrl) && !isLocalOrigin(r.url, targetUrl)) return false;
    return urlNamesId(r.url, id.value) && !neverWritten(r.url);
  });
  const seen = new Set<string>();
  const unique = writes.filter((r) => {
    const k = `${r.method.toUpperCase()} ${r.url}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return [...unique.filter((r) => r.method.toUpperCase() !== "DELETE"), ...unique.filter((r) => r.method.toUpperCase() === "DELETE")];
}

function sameValue(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The fields of the record whose values differ between `before` and `after` (the record objects): changed, added or
 * removed, in the order they first appear.
 */
export function changedFields(before: JsonObject, after: JsonObject): string[] {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  return keys.filter((k) => {
    const had = Object.prototype.hasOwnProperty.call(before, k);
    const has = Object.prototype.hasOwnProperty.call(after, k);
    return had !== has || (had && !sameValue(before[k], after[k]));
  });
}

/** How a save's body is encoded, judged from the body itself (the capture keeps no request headers). */
function bodyKind(body: string | null): "json" | "form" | null {
  if (!body) return null;
  if (jsonObjectBody(body)) return "json";
  // application/x-www-form-urlencoded: name=value pairs joined by "&", nothing a multipart body or plain text holds.
  return /^[^=&\s]+=[^&\s]*(&[^=&\s]+=[^&\s]*)*$/.test(body) ? "form" : null;
}

const CONTENT_TYPE = { json: "application/json", form: "application/x-www-form-urlencoded" } as const;

/**
 * Field names an app sets itself, never the person using it, compared lower case with letters and digits only: the
 * record's id, when it was created or last changed and by whom, and its version or lock token (updatedAt, updated_at,
 * modified_on, lastModified, createdBy, createdById, createTime, update_time, lastUpdate, modification_date,
 * creationTimestamp, Directus's user_created and user_updated, version, lock_version, rowVersion, resourceVersion, etag,
 * @odata.etag, _rev, revision). A present-tense verb needs its suffix (updateTime, not update), and only "last" makes a
 * bare one a stamp (lastUpdate): a bare "update", "change" or "edit" is the record's own data.
 */
const SERVER_SET_NAME =
  /^(id|uuid|guid|(last)?(created|inserted|updated|modified|changed|edited)(at|on|date|time|timestamp|by(id|userid)?)?|(last)?(create|insert|update|modify|modification|change|edit)(at|on|date|time|timestamp|by(id|userid)?)|last(update|modification|change|edit)|date(created|inserted|updated|modified|changed)|user(created|updated|modified)|creation(date|time|timestamp)|(lock|row|record|object|resource|entity)?version(id|number)?|rev|revision|etag|odataetag|concurrencystamp)$/;

/** Keys only a document store sets, matched as written: Mongoose's version key, Cosmos DB's system properties. */
const SERVER_SET_KEYS = new Set(["__v", "_ts", "_rid", "_self", "_attachments"]);

/**
 * True when `key` names a field the app sets itself (see SERVER_SET_NAME). A put-back never sends one at its snapshot
 * value: an app with optimistic locking answers a stale version or timestamp with a 409, and one with a strict schema
 * refuses it. A soft delete's field (deletedAt, archived, status) is the record's state, not one of these.
 */
export function serverManaged(key: string): boolean {
  return SERVER_SET_KEYS.has(key) || SERVER_SET_NAME.test(key.toLowerCase().replace(/[^a-z0-9]/g, ""));
}

/**
 * True when restoreRecord treats `key` of the snapshot's record as a field the app sets itself: a serverManaged name or
 * the record's own id key, unless its snapshot value carries the run token (text Run Hound typed is the record's data).
 * Such a field is never put back at its snapshot value. A caller telling apart the fields in `notRestored` uses
 * changesOnSave: an id or creation stamp that differs was set by the attempt and is not undone.
 */
export function serverSetField(snap: RecordSnapshot, key: string, runToken: string): boolean {
  return (serverManaged(key) || key === snap.id?.key) && !typedByRun(snap.record[key], runToken);
}

/** True when `value` is text carrying the run token: text Run Hound typed, the record's own data whatever its name. */
function typedByRun(value: unknown, runToken: string): boolean {
  const token = tokenKey(runToken);
  return token !== "" && typeof value === "string" && value.toLowerCase().includes(token);
}

/** Document-store keys fixed once the record exists, matched as written: Cosmos DB's resource id and links. */
const FIXED_KEYS = new Set(["_rid", "_self", "_attachments"]);

/**
 * A server-set field whose value never changes once the record exists: its id, and when and by whom it was created
 * (createdAt, createdById, user_created). The value the app's own save sent is still right after any number of saves; a
 * version, etag or update stamp is not.
 */
function fixedServerSet(key: string): boolean {
  return FIXED_KEYS.has(key) || /^(id|uuid|guid)$|creat|insert/.test(key.toLowerCase().replace(/[^a-z0-9]/g, ""));
}

/**
 * True when `key` of the snapshot's record is a field the app changes again itself on every save, a version, etag or
 * update stamp: serverSetField less the ones fixed once the record exists (its id, when and by whom it was created).
 * Such a field can never read as it did after the put-back (which is a save too), so a caller may say the record is
 * "back to its values except" it. A fixed one that differs was set by the attempt and is named as not undone.
 */
export function changesOnSave(snap: RecordSnapshot, key: string, runToken: string): boolean {
  return serverSetField(snap, key, runToken) && !fixedServerSet(key);
}

/** A form key that nests a field under the model's name (Rails, PHP): task[title] is the record's `title`. */
const NESTED_FORM_KEY = /^([^[\]]+)\[([^[\]]+)\]$/;

/** Lower case, letters and digits only: "assignee_attributes" and "assigneeAttributes" compare the same. */
const bare = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Plurals the suffix rules of modelNames get wrong, as Rails singularizes them: /api/people/7 updates a person. */
const IRREGULAR_PLURALS = new Map([
  ["people", "person"],
  ["children", "child"],
  ["men", "man"],
  ["women", "woman"],
  ["media", "medium"],
  ["criteria", "criterion"],
  ["indices", "index"],
  ["analyses", "analysis"],
]);

/**
 * The names a save may nest the record under (Rails' param key): the resource the save's URL updates, the path segment
 * before the record's id (the last such, so /projects/7/tasks/7 is "tasks"), else the last segment, plural and
 * singular ("tasks" and "task" for PATCH /api/tasks/7, "categories" and "category" for /categories/7, "people" and
 * "person" for /people/7, see IRREGULAR_PLURALS).
 */
function modelNames(url: string, id: string | number | undefined): Set<string> {
  let segs: string[];
  try {
    segs = new URL(url, "http://x").pathname.split("/").filter(Boolean);
  } catch {
    return new Set();
  }
  const decode = (seg: string) => {
    try {
      return decodeURIComponent(seg);
    } catch {
      return seg;
    }
  };
  const at = id === undefined ? -1 : segs.findLastIndex((seg) => decode(seg) === String(id));
  const n = bare((at > 0 ? segs[at - 1] : segs[segs.length - 1]) ?? "");
  const names = [n, IRREGULAR_PLURALS.get(n), n.replace(/ies$/, "y"), n.replace(/es$/, ""), n.replace(/s$/, "")];
  return new Set(names.filter((name): name is string => Boolean(name)));
}

function plainObject(v: unknown): v is JsonObject {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * True when `key` of one of the record's object fields ({meta: {version, updatedAt}}, one level down only) is a stamp
 * the app changes again on every save: a version, etag or update stamp by its name (serverManaged, less the fixed ones:
 * a nested id or creation stamp stays data), unless `value`, its snapshot value, carries the run token.
 */
function nestedStamp(key: string, value: unknown, runToken: string): boolean {
  return serverManaged(key) && !fixedServerSet(key) && !typedByRun(value, runToken);
}

/**
 * The snapshot's `value` of one of the record's fields with each stamp in it (nestedStamp) at its value `now`, or left
 * out when `now` doesn't hold it: {meta: {version: 1}} is never sent stale. A value that isn't an object stays as it is,
 * and so does a reference to another record that `now` no longer names ({owner: {id: 3}} became {owner: {id: 4}} or
 * none): the stamps of owner 4 are not owner 3's, and owner 3's as the snapshot has them are still its own.
 */
function freshStamps(value: unknown, now: unknown, runToken: string): unknown {
  if (!plainObject(value)) return value;
  const was = recordId(value);
  const is = plainObject(now) ? recordId(now) : null;
  if (was && (!is || is.key !== was.key || String(is.value) !== String(was.value))) return value;
  const out: JsonObject = {};
  for (const [k, v] of Object.entries(value)) {
    if (!nestedStamp(k, v, runToken)) out[k] = v;
    else if (plainObject(now) && Object.prototype.hasOwnProperty.call(now, k)) out[k] = now[k];
  }
  return out;
}

/**
 * True when `before` and `now`, an object field's snapshot value and its value now, differ only in stamps
 * (nestedStamp): the field changes again with any save, as a top-level version does.
 */
function stampsOnly(before: unknown, now: unknown, runToken: string): boolean {
  if (!plainObject(before) || !plainObject(now)) return false;
  const changed = changedFields(before, now);
  return changed.length > 0 && changed.every((k) => nestedStamp(k, before[k], runToken));
}

/**
 * The body that puts the record back through `save` (the app's own update). Every field the save sends stays, since a
 * PUT replaces the whole record: the record's own fields at the snapshot's value, a field the record doesn't hold as
 * the app sent it, and a field the server sets itself (`serverSet`) at its value now (`current`, what the app itself
 * would send: a strict optimistic lock needs the version it last read). When the re-read doesn't show such a field,
 * the value the save sent is kept only for one that never changes (fixedServerSet: id, createdAt); a version or update
 * stamp from the captured save is always stale, so it is left out. Then each of `fields` (the record's own fields to
 * put back, never a server-set one) at the snapshot's value.
 *
 * One level down the same holds: an object field of the record goes at the snapshot's value with its version or update
 * stamps at their value now (freshStamps: {meta: {version, updatedAt}}), and a form's meta[version] likewise. An object
 * field whose stamps alone moved is one of `serverSet` (see restoreRecord).
 *
 * A save that nests the record's fields under the model's name (Rails: task[title] in a form, {task: {...}} in JSON) is
 * read the same way inside that name, and a field of `fields` the save doesn't carry goes under it too. That name is
 * only taken when the save's top level carries none of the record's own fields, it is the resource the save's URL
 * updates (task or tasks for /api/tasks/7, see modelNames), it names no id other than the record's own, and exactly one
 * name qualifies. Anything else, such as a nested reference to another record ({assignee: {id: 3, name: "Sam"}},
 * owner[name]=Sam, {assignee_attributes: {...}}), is kept as the app sent it: through nested attributes a put-back
 * into it would write to a record Run Hound never created. Null when the body can't be rebuilt.
 */
function restoreBody(
  save: CapturedRequest,
  record: JsonObject,
  current: JsonObject,
  fields: string[],
  serverSet: (k: string) => boolean,
  runToken: string,
): { body: string; kind: "json" | "form" } | null {
  const kind = bodyKind(save.postData);
  if (!kind) return null;
  const has = (k: string) => Object.prototype.hasOwnProperty.call(record, k);
  const hasNow = (k: string) => Object.prototype.hasOwnProperty.call(current, k);
  // One of the record's own fields (not one the server sets): what tells the model's name from a nested reference to
  // another record ({owner: {id: 3}}, owner[id]=3), whose id must stay as the app sent it.
  const own = (k: string) => has(k) && !serverSet(k);
  // The model's name: the resource the save's URL updates, never an object that names an id other than the record's
  // own ({task: {id: 3}} on /api/tasks/7 is a reference to task 3). `idIn` reads an id key inside the name.
  const idOf = recordId(record);
  const names = modelNames(save.url, idOf?.value);
  const modelName = (name: string, idIn: (key: string) => unknown) =>
    names.has(bare(name)) &&
    !ID_KEYS.some((key) => {
      const v = idIn(key);
      return v !== undefined && v !== null && (!idOf || String(v) !== String(idOf.value));
    });
  if (kind === "json") {
    const fill = (sent: JsonObject, extra: string[]): JsonObject => {
      const out: JsonObject = {};
      for (const [k, v] of Object.entries(sent)) {
        if (!serverSet(k)) out[k] = has(k) ? record[k] : v;
        else if (hasNow(k)) out[k] = current[k];
        else if (fixedServerSet(k)) out[k] = v;
      }
      // `extra` holds every field that changed (the record's own), so a changed object field is set here with its stamps
      // at their value now; one that didn't change already holds them.
      for (const k of extra) if (has(k)) out[k] = freshStamps(record[k], current[k], runToken);
      return out;
    };
    const sent = jsonObjectBody(save.postData)!;
    // Rails' {task: {...}}: the save's top level carries none of the record's own fields, and exactly one key the record
    // doesn't hold, named for the resource the URL updates, is an object that does.
    const wraps = Object.keys(sent).some(own)
      ? []
      : Object.keys(sent).filter(
          (k) =>
            !has(k) &&
            !hasNow(k) &&
            plainObject(sent[k]) &&
            Object.keys(sent[k] as JsonObject).some(own) &&
            modelName(k, (key) => (sent[k] as JsonObject)[key]),
        );
    const wrapper = wraps.length === 1 ? wraps[0]! : null;
    const body = fill(sent, wrapper ? [] : fields);
    if (wrapper) body[wrapper] = fill(sent[wrapper] as JsonObject, fields);
    return { body: JSON.stringify(body), kind };
  }
  const params = new URLSearchParams(save.postData!);
  const text = (v: unknown) => (typeof v === "string" ? v : v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
  const keys = [...new Set(params.keys())];
  // Rails' task[title]: the save's plain keys carry none of the record's own fields, and exactly one name, the resource
  // the URL updates, nests some.
  const outers = keys.some(own)
    ? new Set<string>()
    : new Set(
        keys.flatMap((k) => {
          const m = NESTED_FORM_KEY.exec(k);
          return m && own(m[2]!) && modelName(m[1]!, (key) => params.get(`${m[1]!}[${key}]`) ?? undefined) ? [m[1]!] : [];
        }),
      );
  const outer = outers.size === 1 ? [...outers][0]! : null;
  const fieldOf = (k: string) => {
    const m = NESTED_FORM_KEY.exec(k);
    return m && m[1] === outer ? m[2]! : k;
  };
  for (const k of keys) {
    const f = fieldOf(k);
    // meta[version] outside the model's name: a stamp inside one of the record's object fields.
    const inner = f === k ? NESTED_FORM_KEY.exec(k) : null;
    const field = inner ? inner[1]! : "";
    const obj = inner && has(field) ? record[field] : undefined;
    if (serverSet(f)) {
      if (hasNow(f)) params.set(k, text(current[f]));
      else if (!fixedServerSet(f)) params.delete(k);
    } else if (has(f)) {
      params.set(k, text(record[f]));
    } else if (inner && plainObject(obj) && nestedStamp(inner[2]!, obj[inner[2]!], runToken)) {
      const fresh = freshStamps(obj, current[field], runToken) as JsonObject;
      if (Object.prototype.hasOwnProperty.call(fresh, inner[2]!)) params.set(k, text(fresh[inner[2]!]));
      else params.delete(k);
    }
  }
  // A field the save doesn't carry goes under the model's name when it has one.
  const carried = new Set(keys.map(fieldOf));
  for (const f of fields) {
    if (carried.has(f) || !has(f) || (typeof record[f] === "object" && record[f] !== null)) continue;
    params.set(outer ? `${outer}[${f}]` : f, text(record[f]));
  }
  return { body: params.toString(), kind };
}

/**
 * Puts the test record back as it was in `snap`, then re-reads it as Account A and compares. When the record is still
 * there, the changed fields are sent back with `how.save`: the app's own update for this record (a PUT, PATCH or POST
 * to a URL naming the record's id when it has one; never a DELETE, never a request that acts when loaded, never an
 * endpoint in neverWritten). A create (a POST to the list) would make another record rather than put this one back,
 * so it is never used for that. When the record is gone, `how.create` (else `how.save`) is replayed as captured to
 * create it again. `restored`/`notRestored` name fields; a record that is gone and could (or could not) be created
 * again is named "the record". A field the record did not hold before can't be removed, so it is always in
 * `notRestored`.
 *
 * Only the record's own fields are set back to the snapshot's values. A field the app sets itself (serverSetField: id,
 * createdAt, updatedAt, version, etag …, unless its snapshot value carries the run token, which makes it the record's
 * data) is never sent at its snapshot value: when the app's own save carries it, it goes at its value now, as the app
 * would send it (or as the save sent it, for an id or creation stamp the re-read doesn't show); otherwise it isn't
 * sent. One level down, an object field whose version or update stamps alone moved ({meta: {version, updatedAt}}) is
 * treated the same way, and one whose own data changed goes back with its stamps at their value now (freshStamps). The
 * put-back is a save too, so such a field that differs is named in `notRestored` (changesOnSave tells a caller which of
 * them the app changes again on every save; an id or creation stamp that differs was set by the attempt and is not
 * undone; an object field named for its stamps is not told apart, so a caller reports it as not undone), and when
 * nothing else differs nothing is sent.
 */
export async function restoreRecord(
  ctx: CheckContext,
  snap: RecordSnapshot,
  how: { save: CapturedRequest; create?: CapturedRequest },
  io: RecordIO = requestIO(ctx),
): Promise<{ restored: string[]; notRestored: string[] }> {
  const now = await rereadRecord(ctx, snap, io);
  const allowed = (r: CapturedRequest) => {
    const m = r.method.toUpperCase();
    return m !== "GET" && m !== "DELETE" && !actsWhenLoaded(r.url) && !neverWritten(r.url);
  };
  const send = (r: CapturedRequest, body: string, kind: "json" | "form") =>
    io.send({ method: r.method.toUpperCase(), url: r.url, contentType: CONTENT_TYPE[kind], body }).catch(() => null);

  if (now === "gone") {
    const create = how.create ?? how.save;
    const kind = bodyKind(create.postData);
    if (!allowed(create) || !kind) return { restored: [], notRestored: ["the record"] };
    await send(create, create.postData!, kind);
    // The record made again has a new id, so it is found by its test values.
    const back = await rereadRecord(ctx, { ...snap, id: null }, io);
    return back !== null && back !== "gone" ? { restored: ["the record"], notRestored: [] } : { restored: [], notRestored: ["the record"] };
  }

  // The re-read failed: nothing is known about the record, so nothing is sent and nothing counts as restored.
  if (now === null) return { restored: [], notRestored: Object.keys(snap.record) };
  const current = now[0]!;
  const changed = changedFields(snap.record, current);
  if (changed.length === 0) return { restored: [], notRestored: [] };
  const had = (k: string) => Object.prototype.hasOwnProperty.call(snap.record, k);
  const added = changed.filter((k) => !had(k));
  const kept = changed.filter(had);
  // A server-set field whose snapshot value carries the run token is text Run Hound typed: the record's own data.
  // So is an object field whose stamps alone moved ({meta: {version, updatedAt}}): it changes again with any save.
  const serverSet = (k: string) => serverSetField(snap, k, ctx.runToken) || stampsOnly(snap.record[k], current[k], ctx.runToken);
  // Only the record's own fields are put back; the ones the app sets itself change again with any save.
  const toPut = kept.filter((k) => !serverSet(k));

  // An update of this record: to its id when it has one, else anything but a POST (a POST without the id creates).
  const updatesIt = snap.id ? urlNamesId(how.save.url, snap.id.value) : how.save.method.toUpperCase() !== "POST";
  const body = allowed(how.save) && updatesIt && toPut.length > 0 ? restoreBody(how.save, snap.record, current, toPut, serverSet, ctx.runToken) : null;
  if (!body) return { restored: [], notRestored: changed };
  await send(how.save, body.body, body.kind);
  const after = await rereadRecord(ctx, snap, io);
  if (after === null || after === "gone") return { restored: [], notRestored: changed };
  const still = new Set(changedFields(snap.record, after[0]!));
  return { restored: toPut.filter((k) => !still.has(k)), notRestored: [...kept, ...added].filter((k) => still.has(k)) };
}

// ---------- Records Account A already had (docs/v2-spec.md "Safety contract": "A's pre-existing records are never written to") ----------

/**
 * The reason a write-side check gives when its form changes a record Account A already had. csrf and write-access
 * create their test record through the form, as Account A, so a form that edits a record instead is never used.
 */
export const EXISTING_RECORD =
  "Skipped: this form changes a record Account A already had, not a new one, and Run Hound only ever writes to a record it created in this run.";

/** `method path?query` of a request, for notes. */
function endpointText(method: string, url: string): string {
  try {
    const u = new URL(url);
    return `${method.toUpperCase()} ${u.pathname}${u.search}`;
  } catch {
    return `${method.toUpperCase()} ${url}`;
  }
}

const joinWords = (words: string[]) => (words.length <= 1 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`);

/**
 * True when the JSON text `text` holds the record's id under its key (`"id":"t1"`), at any depth, whitespace aside.
 * A number id must end there: `"id":7` is not in `"id":70`.
 */
export function holdsId(text: string, id: { key: string; value: string | number }): boolean {
  const needle = `${JSON.stringify(id.key)}:${JSON.stringify(id.value)}`.replace(/\s+/g, "");
  const flat = text.replace(/\s+/g, "");
  if (typeof id.value === "string") return flat.includes(needle);
  for (let at = flat.indexOf(needle); at >= 0; at = flat.indexOf(needle, at + 1)) {
    if (!/[0-9.eE]/.test(flat.charAt(at + needle.length))) return true;
  }
  return false;
}

/** True when `id` appeared in any answer the page got before the save: the form changed an existing record. */
export function seenBefore(bodies: string[], id: { key: string; value: string | number }): boolean {
  return bodies.some((b) => holdsId(b, id));
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** True when a multipart body has a part named `name` whose value is `value`. */
function multipartHas(body: string, name: string, value: string): boolean {
  return new RegExp(`[;\\s]name="${escapeRegExp(name)}"[^\\r\\n]*\\r?\\n(?:[^\\r\\n]+\\r?\\n)*\\r?\\n${escapeRegExp(value)}\\r?\\n`).test(body);
}

/**
 * True when a save's own body names the record's id: a JSON body holding it under its key, a form-encoded field of
 * that name, or a multipart part of that name. A create can't know an id the server assigns, so such a save edits a
 * record that was already there. An app that makes its ids in the browser is taken for an edit too: the safe side.
 */
export function bodyNamesId(body: string | null, id: { key: string; value: string | number }): boolean {
  if (!body) return false;
  if (holdsId(body, id)) return true;
  const want = String(id.value);
  if (bodyKind(body) === "form") return new URLSearchParams(body).getAll(id.key).includes(want);
  return multipartHas(body, id.key, want);
}

/** The bodies of the JSON GETs (2xx) the page made before `save`, in order: what it had read when it saved. */
export function getsBefore(capture: Capture, save: CapturedRequest): string[] {
  const at = capture.requests.indexOf(save);
  return capture.requests
    .slice(0, at < 0 ? 0 : at)
    .filter((r) => r.method.toUpperCase() === "GET" && typeof r.status === "number" && r.status >= 200 && r.status < 300 && r.responseBody)
    .map((r) => r.responseBody!);
}

/**
 * True when the form's save (which went through) turned out to change a record Account A already had rather than create
 * the run's test record, judged once the record is read back (`snap`, found at `recordGet`), against what the page
 * read before the save (`before`, getsBefore or SaveHold.before): a PATCH or PUT save; the record's id in an answer
 * from before the save; a save whose URL or body already names the id (a create can't know it); or a single record read
 * at a URL that doesn't name its id (a profile, a settings object), which is the account's own record, not a new one.
 */
export function editsExistingRecord(
  save: CapturedRequest,
  snap: RecordSnapshot,
  recordGet: { url: string; body: string },
  before: string[],
  runToken: string,
): boolean {
  const method = save.method.toUpperCase();
  if (method === "PATCH" || method === "PUT") return true;
  if (snap.id && (seenBefore(before, snap.id) || urlNamesId(save.url, snap.id.value) || bodyNamesId(save.postData, snap.id))) return true;
  const json = parseJson(recordGet.body);
  const first = snapshotFrom(recordGet.url, json, snap.testValues, runToken);
  const listed = first ? readsList(json, first.record) : false;
  return !listed && !(snap.id && urlNamesId(recordGet.url, snap.id.value));
}

/**
 * Puts back a record Account A already had that the form's own save changed (editsExistingRecord), as the page read it
 * before the save (`before`, the answers getsBefore or SaveHold.before give; a read of the record endpoint itself is
 * preferred), only through the app's own update for that record's id (recordWrites: the save itself when its URL names
 * the id, or an update the page sent), never by replaying a create. Returns the notes: what was put back, and what
 * could not be undone, naming the form's save and "check Account A". The form's save did reach the app, so no note
 * ever says nothing was written.
 */
export async function putBackEdited(
  ctx: CheckContext,
  o: { capture: Capture; save: CapturedRequest; snap: RecordSnapshot; before: string[]; io?: RecordIO },
): Promise<string[]> {
  const endpoint = endpointText(o.save.method, o.save.url);
  const lead = `The form's own save (${endpoint}) had already reached the app.`;
  const id = o.snap.id;
  const readBefore = (bodies: string[]) => {
    if (!id) return null;
    for (const body of [...bodies].reverse()) {
      const found = chainsWithId(parseJson(body), id.key, id.value)[0]?.[0];
      if (found) return found;
    }
    return null;
  };
  // What the record endpoint itself answered before the save, when the page read it then; else any earlier answer.
  const own = o.capture.requests
    .slice(0, Math.max(0, o.capture.requests.indexOf(o.save)))
    .filter((r) => r.method.toUpperCase() === "GET" && r.url === o.snap.url && r.responseBody)
    .map((r) => r.responseBody!);
  const was = readBefore(own) ?? readBefore(o.before);
  if (!was) {
    return [lead, `Could not be undone: the form's own save (${endpoint}) changed that record, and Run Hound didn't see it before the save, so it can't put it back: check Account A.`];
  }
  const io = o.io ?? requestIO(ctx);
  const pre: RecordSnapshot = { ...o.snap, chain: [was], record: was };
  const now = await rereadRecord(ctx, pre, io);
  if (now === null) return [lead, `Run Hound couldn't read that record back to put it back: check Account A.`];
  if (now === "gone") return [lead, `Could not be undone: that record is gone after the form's own save (${endpoint}): check Account A.`];
  // Only fields the page read before the save are compared: a field it didn't read then says nothing either way.
  const had = (k: string) => Object.prototype.hasOwnProperty.call(was, k);
  const changed = changedFields(was, now[0]!).filter(had);
  if (changed.length === 0) return [lead, "That record reads as it did before the save."];
  const update = recordWrites(o.capture, o.snap, ctx.targetUrl).find((r) => r.method.toUpperCase() !== "DELETE");
  const outcome = update ? await restoreRecord(ctx, pre, { save: update }, io) : { restored: [], notRestored: changed };
  const restored = outcome.restored.filter(had);
  const left = outcome.notRestored.filter(had);
  const appSet = left.filter((k) => changesOnSave(pre, k, ctx.runToken));
  const rest = left.filter((k) => !appSet.includes(k));
  const notes = [lead];
  if (restored.length > 0) notes.push(`Run Hound put back ${joinWords(restored)} of that record, as the page read it before the save.`);
  if (rest.length > 0) notes.push(`Could not be undone: the form's own save (${endpoint}) changed ${joinWords(rest)} of that record: check Account A.`);
  if (appSet.length > 0) notes.push(`${joinWords(appSet)} of that record, which the app sets itself when it is saved, changed too.`);
  return notes;
}

/** What the page had read before a save: every record id in a JSON answer, and each read's path as a list or one record. */
interface ReadBeforeSave {
  /** Every id (id, _id, uuid) of an object in a JSON answer, as text. */
  ids: Set<string>;
  /** origin + path (no query, no trailing "/") of each read that answered a list. */
  lists: Set<string>;
  /** The same for each read that answered one record, and never a list. */
  records: Set<string>;
}

/** `url`'s origin and path, without its query and trailing "/", or null when it doesn't parse. */
function pathKey(url: string): string | null {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

/**
 * True when a JSON answer is a list: an array, or an object with no id of its own that holds one ({tasks: [...]},
 * {data: [], total: 0}). An object with an id of its own is one record, whatever arrays it holds ({id, title, tags}).
 */
function answersList(json: unknown): boolean {
  if (Array.isArray(json)) return true;
  return plainObject(json) && recordId(json) === null && Object.values(json).some(Array.isArray);
}

/** Every id of an object in `node` (parsed JSON), as text. */
function idsIn(node: unknown, into: Set<string>, depth = 0): void {
  if (depth > 12 || !node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) idsIn(item, into, depth + 1);
    return;
  }
  const obj = node as JsonObject;
  for (const key of ID_KEYS) {
    const v = obj[key];
    if ((typeof v === "string" && v !== "") || (typeof v === "number" && Number.isFinite(v))) into.add(String(v));
  }
  for (const v of Object.values(obj)) idsIn(v, into, depth + 1);
}

function readBeforeSave(answers: { url: string; body: string }[]): ReadBeforeSave {
  const out: ReadBeforeSave = { ids: new Set(), lists: new Set(), records: new Set() };
  for (const a of answers) {
    const json = parseJson(a.body);
    if (json === null || typeof json !== "object") continue;
    idsIn(json, out.ids);
    const path = pathKey(a.url);
    if (!path) continue;
    if (answersList(json)) out.lists.add(path);
    else out.records.add(path);
  }
  for (const path of out.lists) out.records.delete(path);
  return out;
}

/**
 * True when a write the form's submit sends would change a record Account A already had, judged before it reaches the
 * app from what the page read before it (`answers`: the JSON GETs it made, with their URLs):
 * - any method but POST (PATCH, PUT, DELETE …): it changes or removes a record that is already there;
 * - a POST whose path names an id the page read (as any segment: /api/tasks/t1, /api/tasks/t1/rename), unless the page
 *   read that same path as a list (a POST to a list the page reads is a create in it: /api/projects/p1/tasks);
 * - a POST to a path the page read as one record (GET /api/profile, then POST /api/profile);
 * - a POST whose query names such an id under an id key (?id=t1);
 * - a POST whose body names such an id under an id key: at its top ({id: "t1", title}), one level down in the object
 *   that carries the run's test values ({task: {id: "t1", title}}), as a form field (id=t1, task[id]=t1) or a
 *   multipart part. A reference to another record beside the typed values ({project: {id: "p1"}, title}) is not.
 */
export function changesReadRecord(
  req: { method: string; url: string; postData: string | null },
  answers: { url: string; body: string }[],
  runToken: string,
): boolean {
  const read = readBeforeSave(answers);
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return false;
  if (method !== "POST") return true;
  let parsed: URL;
  try {
    parsed = new URL(req.url);
  } catch {
    return false;
  }
  const path = pathKey(req.url) ?? "";
  if (!read.lists.has(path)) {
    const decode = (s: string) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    };
    if (parsed.pathname.split("/").filter(Boolean).some((seg) => read.ids.has(decode(seg)))) return true;
    if (read.records.has(path)) return true;
  }
  for (const [name, value] of parsed.searchParams) if (ID_KEYS.includes(name) && read.ids.has(value)) return true;
  const body = req.postData;
  if (!body) return false;
  const named = (o: JsonObject) => ID_KEYS.some((k) => (typeof o[k] === "string" || typeof o[k] === "number") && read.ids.has(String(o[k])));
  const json = jsonObjectBody(body);
  if (json) {
    if (named(json)) return true;
    const key = tokenKey(runToken);
    return Object.values(json).some((v) => plainObject(v) && named(v) && key !== "" && JSON.stringify(v).toLowerCase().includes(key));
  }
  if (bodyKind(body) === "form") {
    return [...new URLSearchParams(body)].some(([k, v]) => ID_KEYS.includes(NESTED_FORM_KEY.exec(k)?.[2] ?? k) && read.ids.has(v));
  }
  return ID_KEYS.some((k) => [...read.ids].some((v) => multipartHas(body, k, v)));
}

/** A write the hold stopped before it reached the app. */
export interface StoppedWrite {
  method: string;
  url: string;
  /** Its body carries the run's test values: it is the form's own save. */
  carriesValues: boolean;
}

/**
 * Holds the writes the form's submit sends (see holdExistingEdits) and judges each before it reaches the app.
 */
export interface SaveHold {
  /** The writes stopped before they reached the app, in order: each would have changed a record Account A already had. */
  readonly stopped: StoppedWrite[];
  /** The answers the page had read (as Account A) when the form's save was judged, for editsExistingRecord and putBackEdited. */
  before(): string[];
  /** The note for a form whose save was stopped (its save changes a record Account A already had), or null to go on. */
  verdict(): string | null;
  /** Ends the hold: later requests reach the app as usual. */
  release(): Promise<void>;
}

/**
 * Before the form's submit, as Account A: judges each write the page sends to the app (the target's origin or its local
 * API) before it leaves the page, until the form's own save (the first write that carries the run's test values) has
 * gone through; after that, everything goes on as usual (the app's own update for its new record, say). A write that
 * would change a record Account A already had (changesReadRecord, against every JSON answer the page read before it,
 * with a read of the app's API on another local origin, whose body the capture doesn't keep, made again as Account A)
 * is stopped: it never reaches the app. So a form that edits one of Account A's records is skipped with nothing
 * written, and the safety contract's "A's pre-existing records are never written to" holds for the form's own save too.
 * Requests go on through the context's own routes (the safety gate) with route.fallback. Call release() once the save
 * has been waited for.
 */
export async function holdExistingEdits(ctx: CheckContext, page: Page, capture: Capture): Promise<SaveHold> {
  const stopped: StoppedWrite[] = [];
  let saved = false;
  let released = false;
  let answers: { url: string; body: string }[] = [];
  /** Bodies of the app's API reads on another local origin, read again as Account A (at most 10, once each). */
  const rereads = new Map<string, string | null>();

  const readSoFar = async (): Promise<{ url: string; body: string }[]> => {
    const out: { url: string; body: string }[] = [];
    for (const r of [...capture.requests]) {
      if (r.method.toUpperCase() !== "GET" || typeof r.status !== "number" || r.status < 200 || r.status >= 300) continue;
      if (r.responseBody) {
        out.push({ url: r.url, body: r.responseBody });
        continue;
      }
      if (!["fetch", "xhr"].includes(r.resourceType) || isSameOrigin(r.url, ctx.targetUrl) || !isLocalOrigin(r.url, ctx.targetUrl)) continue;
      if (!rereads.has(r.url)) {
        if (rereads.size >= 10) continue;
        const again = await ctx.request("self", { method: "GET", url: r.url }).catch(() => null);
        rereads.set(r.url, again && again.status >= 200 && again.status < 300 ? again.body : null);
      }
      const body = rereads.get(r.url);
      if (body) out.push({ url: r.url, body });
    }
    return out;
  };

  /** Whether a write goes on to the app: judged, and stopped on the safe side when judging itself fails. */
  const decide = async (method: string, url: string, postData: string | null): Promise<"go" | "stop"> => {
    if (released || saved || method === "GET" || method === "HEAD" || method === "OPTIONS") return "go";
    if (!isSameOrigin(url, ctx.targetUrl) && !isLocalOrigin(url, ctx.targetUrl)) return "go";
    const carriesValues = carriesTestValues(postData, ctx.runToken);
    let changes: boolean;
    try {
      answers = await readSoFar();
      changes = changesReadRecord({ method, url, postData }, answers, ctx.runToken);
    } catch {
      changes = true;
    }
    if (changes) {
      stopped.push({ method, url, carriesValues });
      return "stop";
    }
    if (carriesValues) saved = true;
    return "go";
  };
  const handler = async (route: Route, request: Request) => {
    const verdict = await decide(request.method().toUpperCase(), request.url(), request.postData());
    try {
      if (verdict === "stop") await route.abort("blockedbyclient");
      else await route.fallback();
    } catch {
      // The page closed or the request was already handled: nothing more to do with it.
    }
  };
  await page.route("**/*", handler);

  return {
    stopped,
    before: () => answers.map((a) => a.body),
    verdict() {
      // The form's own save was stopped, or nothing that carries the test values went through and a write was stopped.
      const save = stopped.find((w) => w.carriesValues) ?? (saved ? undefined : stopped[0]);
      if (!save) return null;
      return `${EXISTING_RECORD} Run Hound stopped the form's save (${endpointText(save.method, save.url)}) before it reached the app, so nothing was changed.`;
    },
    async release() {
      released = true;
      await page.unroute("**/*", handler).catch(() => undefined);
    },
  };
}

/** True when the capture's `r` is a write the hold stopped (it never reached the app): never the form's save. */
export function stoppedByHold(hold: SaveHold, r: CapturedRequest): boolean {
  return r.failure !== null && hold.stopped.some((w) => w.method === r.method.toUpperCase() && w.url === r.url);
}
