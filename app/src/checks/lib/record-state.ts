/**
 * The run's own test record, read and put back as Account A (0.5.0, docs/v2-spec.md "Types and shared helpers"). Shared
 * by the write-side checks (csrf, write-access) and mass-assignment: find the record endpoint after a save, snapshot the record, re-read it after an attempt, and restore it. Every read is a GET as Account A through
 * CheckContext.request (the safety gate applies), and a snapshot only ever holds a record carrying the run token, so
 * a restore never writes to one of Account A's own records.
 */
import { setTimeout as delay } from "node:timers/promises";
import type { Page, Request, Route } from "playwright";
import { carriesTestValues, graphQlCode, isGraphQlDocument, isGraphQlRead, isLocalOrigin, isSameOrigin, tokenKey } from "../../core/saves.js";
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

/** The decoded values of `url`'s query, empty ones left out. */
function queryValues(url: string): string[] {
  try {
    return [...new URL(url).searchParams.values()].filter((v) => v !== "");
  } catch {
    return [];
  }
}

/**
 * True when every string of `json` (a GET's answer, parsed) that holds a test value holds it only as an echo of the
 * GET's own query (`asked`): with each query value cut out it holds no test value, and the object holding it has no id
 * (a search's {query, matches}, "Results for …"). A record read by its value (GET /api/tasks?title=…) holds it in an
 * object with an id, so it is the record, not an echo.
 */
function echoesQuery(json: unknown, asked: string[], testValues: string[]): boolean {
  if (asked.length === 0) return false;
  let echoed = false;
  const walk = (n: unknown, holder: JsonObject | null, depth: number): boolean => {
    if (depth > 12) return true;
    if (typeof n === "string") {
      if (!testValues.some((v) => n.includes(v))) return true;
      const rest = asked.reduce((text, q) => text.split(q).join(""), n);
      if (testValues.some((v) => rest.includes(v)) || (holder && recordId(holder) !== null)) return false;
      echoed = true;
      return true;
    }
    if (Array.isArray(n)) return n.every((item) => walk(item, holder, depth + 1));
    if (n && typeof n === "object") return Object.values(n as JsonObject).every((v) => walk(v, n as JsonObject, depth + 1));
    return true;
  };
  return walk(json, null, 0) && echoed;
}

/** True for a write: a request that isn't a GET, HEAD or OPTIONS. */
const isWrite = (r: CapturedRequest) => !["GET", "HEAD", "OPTIONS"].includes(r.method.toUpperCase());

/**
 * True when a request body holds one of `testValues`: as it is (JSON, multipart, text), or form-encoded, where a space
 * is `+` or `%20` (title=Task+rs7e57a1ws). URLSearchParams reads a stray `%` as it is, so a body that isn't valid
 * percent-encoding is still read.
 */
function bodyHolds(body: string | null | undefined, testValues: string[]): boolean {
  if (!body) return false;
  if (testValues.some((v) => body.includes(v))) return true;
  if (!body.includes("=")) return false;
  const decoded = [...new URLSearchParams(body)].flat();
  return decoded.some((part) => testValues.some((v) => part.includes(v)));
}

/**
 * True when a write's URL query holds one of `testValues`, decoded (POST /api/tasks?title=Task+rs7e57a1ws: a save that
 * sends its values there and something else, or nothing, as its body).
 */
const queryHolds = (r: CapturedRequest, testValues: string[]) => queryValues(r.url).some((q) => testValues.some((v) => q.includes(v)));

/**
 * True when a write's URL path holds one of `testValues` in a segment, decoded (PUT /api/tags/Task%20rs7e57a1ws: a save
 * that sends its value there, with no body or a body of other fields, and no query; close-out review, round 2).
 */
function pathHolds(r: CapturedRequest, testValues: string[]): boolean {
  let segments: string[];
  try {
    segments = new URL(r.url, "http://x").pathname.split("/").filter(Boolean);
  } catch {
    return false;
  }
  return segments.some((seg) => {
    let decoded = seg;
    try {
      decoded = decodeURIComponent(seg);
    } catch {
      decoded = seg;
    }
    return testValues.some((v) => decoded.includes(v));
  });
}

/**
 * The record endpoint: a GET the page made after the save whose JSON object holds a test value. A read from the app's
 * API on another local origin has no body in the capture, so those are read again as Account A (at most 10).
 * `arrays` (the write-side checks) also takes a JSON array, such as a bare `GET /api/tasks` list, when a record in it
 * holds a test value; mass-assignment keeps the object-only rule it had.
 *
 * "After the save" in capture order (0.6.0 round 2): the save is `options.save`, else the first write whose body holds
 * a test value, form-encoded too (bodyHolds: title=Task+rs7e57a1ws), else the first whose URL's query does
 * (queryHolds: POST /api/tasks?title=…; close-out review, round 1), else the first whose URL's path does (pathHolds:
 * PUT /api/tags/<name>; close-out review, round 2); a capture with none is read whole. A GET made
 * before it (a search-as-you-type hint, a name-availability check that echoes the typed value in its query or its path)
 * is never the record endpoint: the record didn't exist yet. Of the GETs after the save, those after the reload (the
 * first document request after it) come first. An answer whose test value is only an echo of the GET's own query
 * ({query, matches}: echoesQuery) is never taken.
 */
export async function findOwnRecord(
  ctx: CheckContext,
  capture: Capture,
  testValues: string[],
  options: { arrays?: boolean; save?: CapturedRequest } = {},
): Promise<{ url: string; body: string } | null> {
  const holdsTestValue = (url: string, body: string | null | undefined): body is string => {
    if (!body || !testValues.some((v) => body.includes(v))) return false;
    const json = parseJson(body);
    if (echoesQuery(json, queryValues(url), testValues)) return false;
    if (jsonObjectBody(body)) return true;
    return Boolean(options.arrays) && recordChains(json, testValues).length > 0;
  };
  const ok = (r: CapturedRequest) => r.method.toUpperCase() === "GET" && typeof r.status === "number" && r.status >= 200 && r.status < 300;
  const requests = capture.requests;
  const firstWrite = (holds: (r: CapturedRequest) => boolean) => requests.findIndex((r) => isWrite(r) && holds(r));
  const saveAt = options.save
    ? requests.indexOf(options.save)
    : [(r: CapturedRequest) => bodyHolds(r.postData, testValues), (r: CapturedRequest) => queryHolds(r, testValues), (r: CapturedRequest) => pathHolds(r, testValues)]
        .map(firstWrite)
        .find((at) => at >= 0) ?? -1;
  const after = saveAt < 0 ? requests : requests.slice(saveAt + 1);
  const reloadAt = saveAt < 0 ? -1 : after.findIndex((r) => r.resourceType === "document" && r.method.toUpperCase() === "GET");
  const ordered = reloadAt < 0 ? after : [...after.slice(reloadAt + 1), ...after.slice(0, reloadAt + 1)];
  for (const r of ordered) if (ok(r) && holdsTestValue(r.url, r.responseBody)) return { url: r.url, body: r.responseBody };
  const tried = new Set<string>();
  for (const r of ordered) {
    if (!ok(r) || r.responseBody || !["fetch", "xhr"].includes(r.resourceType) || tried.has(r.url) || tried.size >= 10) continue;
    if (isSameOrigin(r.url, ctx.targetUrl) || !isLocalOrigin(r.url, ctx.targetUrl)) continue;
    tried.add(r.url);
    const again = await ctx.request("self", { method: "GET", url: r.url }).catch(() => null);
    if (again && again.status >= 200 && again.status < 300 && holdsTestValue(r.url, again.body)) return { url: r.url, body: again.body };
  }
  return null;
}

/**
 * Keys that are a record's own id whatever the record is, in the order they are looked for: id, _id, uuid, Django's pk,
 * Parse's objectId, guid.
 */
const ID_KEYS = ["id", "_id", "uuid", "pk", "objectId", "guid"];

/** A string or number an id can be. */
const idValue = (v: unknown): v is string | number => (typeof v === "string" && v !== "") || (typeof v === "number" && Number.isFinite(v));

/**
 * True when `key` names an id: one of ID_KEYS, or a name that ends in one (taskId, task_id, task-id, TaskID), the rule
 * write-access's isIdParam uses. A reference to another record (projectId) is one too: idResource tells them apart.
 */
export function idLikeKey(key: string): boolean {
  return ID_KEYS.includes(key) || /(^|[_-])id$/i.test(key) || /[a-z0-9]I[dD]$/.test(key);
}

/** The resource an id-like key names, bare ("task" for taskId, task_id, TaskID), or "" for one of ID_KEYS. */
function idResource(key: string): string {
  if (ID_KEYS.includes(key)) return "";
  return bare(key.replace(/[_-]?id$/i, ""));
}

/** A name's singular and plural forms, bare: "tasks" and "task" for either, "people" and "person" (IRREGULAR_PLURALS). */
function nameForms(name: string): string[] {
  const n = bare(name);
  if (!n) return [];
  const singular = [IRREGULAR_PLURALS.get(n), n.replace(/ies$/, "y"), n.replace(/(ch|sh|ss|x)es$/, "$1"), n.replace(/s$/, "")];
  return [n, ...singular.filter((s): s is string => Boolean(s))];
}

/** The resource names `url`'s path segments give (singular and plural): {api, tasks, task, rename} for /api/tasks/rename. */
function resourceNames(url: string): Set<string> {
  let segs: string[];
  try {
    segs = new URL(url, "http://x").pathname.split("/").filter(Boolean);
  } catch {
    return new Set();
  }
  return new Set(segs.flatMap((seg) => nameForms(seg)));
}

/**
 * The record's own id, a string or a number, or null when it has none: one of ID_KEYS, else the one id-like key that
 * names the resource the record is read as (`names`: the read's URL and the keys it sits under, see idNames), such as
 * taskId in GET /api/tasks. A reference to another record (projectId on a task) is never taken for its own id.
 */
export function recordId(record: JsonObject, names: ReadonlySet<string> = new Set()): { key: string; value: string | number } | null {
  for (const key of ID_KEYS) {
    const value = record[key];
    if (idValue(value)) return { key, value };
  }
  if (names.size === 0) return null;
  const own = Object.keys(record).filter((k) => idLikeKey(k) && idValue(record[k]) && names.has(idResource(k)));
  return own.length === 1 ? { key: own[0]!, value: record[own[0]!] as string | number } : null;
}

/**
 * The names a record in `chain` (the record, then its parents) is read as: the read's URL (resourceNames) and each key
 * on the way down to it ({tasks: [...]} gives "tasks" and "task").
 */
function idNames(url: string, chain: JsonObject[]): Set<string> {
  const names = resourceNames(url);
  const holds = (v: unknown, child: JsonObject, depth = 0): boolean =>
    v === child || (depth < 3 && Array.isArray(v) && v.some((item) => holds(item, child, depth + 1)));
  for (let i = 1; i < chain.length; i += 1) {
    const parent = chain[i]!;
    const child = chain[i - 1]!;
    for (const [k, v] of Object.entries(parent)) if (holds(v, child)) for (const f of nameForms(k)) names.add(f);
  }
  return names;
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
  return { url, testValues: own, id: recordId(record, idNames(url, chain)), chain, record };
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

/**
 * True when `key` holding `value` is a stamp the app changes again on every save, by its name: a version, lock or
 * update stamp (lock_version, version, __v, _rev, etag, updatedAt), never an id or creation stamp, and never a value
 * carrying the run token (text Run Hound typed). With optimistic locking, a body that carries such a stamp at a value
 * read before the record's last save is a conflict (409), whoever sends it.
 */
export function saveStamp(key: string, value: unknown, runToken: string): boolean {
  return serverManaged(key) && !fixedServerSet(key) && !typedByRun(value, runToken);
}

/** A form key that nests a field under the model's name (Rails, PHP): task[title] is the record's `title`. */
export const NESTED_FORM_KEY = /^([^[\]]+)\[([^[\]]+)\]$/;

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
 * The query parameters of `update`'s URL (the app's own update for the test record) that carry the record's own
 * version or lock (saveStamp: ?lock_version=0, ?task[lock_version]=0, ?meta[version]=0), by name as the URL has them:
 * those whose value the record showed before the update was sent, in an answer or a read captured from `save` on (the
 * save's own answer included) up to the update, or in `snap` (close-out review, round 2). A parameter by a stamp's name
 * whose value the record never showed (?version=2, an API version, on a record whose own version is 5) is something
 * else: it is never rewritten, and a caller names it as a stamp it couldn't refresh.
 */
export function recordQueryStamps(capture: Capture, save: CapturedRequest, update: CapturedRequest, snap: RecordSnapshot, runToken: string): Set<string> {
  const out = new Set<string>();
  let parsed: URL;
  try {
    parsed = new URL(update.url);
  } catch {
    return out;
  }
  if (!parsed.search) return out;
  const from = Math.max(0, capture.requests.indexOf(save));
  const to = capture.requests.indexOf(update);
  const seen: JsonObject[] = [snap.record];
  for (const r of capture.requests.slice(from, to < 0 ? undefined : to)) {
    if (!r.responseBody) continue;
    const json = parseJson(r.responseBody);
    if (json === null) continue;
    const chains = snap.id ? chainsWithId(json, snap.id.key, snap.id.value) : recordChains(json, snap.testValues);
    for (const chain of chains) if (chain[0]) seen.push(chain[0]);
  }
  const text = (v: unknown) => (typeof v === "string" ? v : v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
  for (const k of new Set(parsed.searchParams.keys())) {
    const m = NESTED_FORM_KEY.exec(k);
    const field = m ? m[2]! : k;
    const value = parsed.searchParams.get(k);
    if (!saveStamp(field, value, runToken)) continue;
    const shown = seen.some((record) => {
      // meta[version]: a stamp of the record's object field meta; task[lock_version] and a flat one: the record's own.
      const outer = m && plainObject(record[m[1]!]) ? (record[m[1]!] as JsonObject) : record;
      return Object.prototype.hasOwnProperty.call(outer, field) && text(outer[field]) === value;
    });
    if (shown) out.add(k);
  }
  return out;
}

/**
 * `url` (the app's own update) with each stamp in its query (saveStamp: ?lock_version=1, ?task[lock_version]=1) at its
 * value in `current`, the record as re-read: the value the captured update carried is stale once the record was saved
 * again (close-out review, round 1). A stamp the re-read doesn't show is left as the app sent it: a parameter by that
 * name may be something else (an API version), and the put-back never drops what the app sends in its URL. With `only`
 * (the parameters recordQueryStamps names as the record's own), every other parameter is left as the app sent it too.
 */
function freshQueryStamps(url: string, current: JsonObject, runToken: string, only?: ReadonlySet<string>): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (!parsed.search) return url;
  const text = (v: unknown) => (typeof v === "string" ? v : v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
  let changed = false;
  for (const k of [...new Set(parsed.searchParams.keys())]) {
    const m = NESTED_FORM_KEY.exec(k);
    const field = m ? m[2]! : k;
    if (!saveStamp(field, parsed.searchParams.get(k), runToken) || (only && !only.has(k))) continue;
    // meta[version]: a stamp of the record's object field meta; task[lock_version] and a flat one: the record's own.
    const outer = m && plainObject(current[m[1]!]) ? (current[m[1]!] as JsonObject) : current;
    if (!Object.prototype.hasOwnProperty.call(outer, field)) continue;
    const now = text(outer[field]);
    if (parsed.searchParams.get(k) !== now) {
      parsed.searchParams.set(k, now);
      changed = true;
    }
  }
  return changed ? parsed.href : url;
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
 * nothing else differs nothing is sent. A stamp in the update's URL query goes at its value now when the re-read shows
 * it, and stays as the app sent it otherwise (freshQueryStamps); with `how.queryStamps` (recordQueryStamps), only the
 * parameters it names are taken for the record's stamps.
 */
export async function restoreRecord(
  ctx: CheckContext,
  snap: RecordSnapshot,
  how: { save: CapturedRequest; create?: CapturedRequest; queryStamps?: ReadonlySet<string> },
  io: RecordIO = requestIO(ctx),
): Promise<{ restored: string[]; notRestored: string[] }> {
  const now = await rereadRecord(ctx, snap, io);
  const allowed = (r: CapturedRequest) => {
    const m = r.method.toUpperCase();
    return m !== "GET" && m !== "DELETE" && !actsWhenLoaded(r.url) && !neverWritten(r.url);
  };
  const send = (r: CapturedRequest, body: string, kind: "json" | "form", url = r.url) =>
    io.send({ method: r.method.toUpperCase(), url, contentType: CONTENT_TYPE[kind], body }).catch(() => null);

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
  // A version the update carries in its URL's query goes at its value now, as one in its body does.
  await send(how.save, body.body, body.kind, freshQueryStamps(how.save.url, current, ctx.runToken, how.queryStamps));
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

/** The GETs (2xx, with a body) the page made before `save`, in order, with their URLs: what it had read when it saved. */
export function readsBefore(capture: Capture, save: CapturedRequest): { url: string; body: string }[] {
  const at = capture.requests.indexOf(save);
  return capture.requests
    .slice(0, at < 0 ? 0 : at)
    .filter((r) => r.method.toUpperCase() === "GET" && typeof r.status === "number" && r.status >= 200 && r.status < 300 && r.responseBody)
    .map((r) => ({ url: r.url, body: r.responseBody! }));
}

/** The keys from `json` down to the array that holds `record` itself ([] for a bare array), or null when none does. */
function listPath(json: unknown, record: JsonObject): string[] | null {
  const walk = (n: unknown, path: string[], depth: number): string[] | null => {
    if (depth > 12 || !n || typeof n !== "object") return null;
    if (Array.isArray(n)) return n.includes(record) ? path : null;
    for (const [k, v] of Object.entries(n as JsonObject)) {
      const found = walk(v, [...path, k], depth + 1);
      if (found) return found;
    }
    return null;
  };
  return walk(json, [], 0);
}

/** The value at `path` (object keys) in `json`, or undefined. */
function at(json: unknown, path: string[]): unknown {
  let n: unknown = json;
  for (const k of path) n = plainObject(n) ? n[k] : undefined;
  return n;
}

/**
 * True when the list the record endpoint reads (`recordGet`, its parsed answer holding `record`) has more records than when the
 * page read it before the save (`reads`, the reads before the save with their URLs): the save added one. False when
 * the page didn't read that list before the save, or it had as many records then.
 */
function listGained(recordGet: { url: string; json: unknown }, record: JsonObject, reads: { url: string; body: string }[]): boolean {
  const json = recordGet.json;
  const path = listPath(json, record);
  if (!path) return false;
  const now = at(json, path);
  const where = pathKey(recordGet.url);
  const earlier = [...reads].reverse().find((r) => pathKey(r.url) === where);
  if (!earlier || !Array.isArray(now)) return false;
  const was = at(parseJson(earlier.body), path);
  return Array.isArray(was) && was.length < now.length;
}

/**
 * True when the form's save (which went through) turned out to change a record Account A already had rather than create
 * the run's test record, judged once the record is read back (`snap`, found at `recordGet`), against what the page
 * read before the save (`before`, getsBefore or SaveHold.before; `reads`, the same with their URLs: readsBefore or
 * SaveHold.reads): a PATCH or PUT save; the record's id in an answer from before the save; a save whose URL or body
 * already names the id (a create can't know it); a single record read at a URL that doesn't name its id (a profile, a
 * settings object), which is the account's own record, not a new one; or a record with no id Run Hound recognises in a
 * list that didn't gain a record (nothing shows the save created it, so it is taken for an edit: the safe side).
 */
export function editsExistingRecord(
  save: CapturedRequest,
  snap: RecordSnapshot,
  recordGet: { url: string; body: string },
  before: string[],
  runToken: string,
  reads: { url: string; body: string }[] = [],
): boolean {
  const method = save.method.toUpperCase();
  if (method === "PATCH" || method === "PUT") return true;
  if (snap.id && (seenBefore(before, snap.id) || urlNamesId(save.url, snap.id.value) || bodyNamesId(save.postData, snap.id))) return true;
  const json = parseJson(recordGet.body);
  const first = snapshotFrom(recordGet.url, json, snap.testValues, runToken);
  const listed = first ? readsList(json, first.record) : false;
  if (!listed) return !(snap.id && urlNamesId(recordGet.url, snap.id.value));
  return !snap.id && !(first && listGained({ url: recordGet.url, json }, first.record, reads));
}

/**
 * Puts back a record Account A already had that the form's own save changed (editsExistingRecord), as the page read it
 * before the save (`before`, the answers getsBefore or SaveHold.before give; a read of the record endpoint itself is
 * preferred), only through the app's own update for that record's id (recordWrites: the save itself when its URL names
 * the id, or an update the page sent), never by replaying a create. When the app sent no such update that reached it,
 * one the page sent that never reached the app (heldUpdate: the hold stopped it) is used: the app's own update for that
 * id, only ever sent with the record's values as the page read them. Returns the notes: what was put back, and what
 * could not be undone, naming the form's save and "check Account A". The form's save did reach the app, so no note
 * ever says nothing was written.
 */
export async function putBackEdited(
  ctx: CheckContext,
  o: { capture: Capture; save: CapturedRequest; snap: RecordSnapshot; before: string[]; io?: RecordIO },
): Promise<string[]> {
  const endpoint = endpointText(o.save.method, o.save.url);
  const lead = `The form's own save (${endpoint}) had already reached the app and changed a record Account A already had: check Account A.`;
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
  const update = recordWrites(o.capture, o.snap, ctx.targetUrl).find((r) => r.method.toUpperCase() !== "DELETE") ?? heldUpdate(o.capture, o.snap, ctx.targetUrl);
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

/**
 * An update the page sent for the record's id that never reached the app (the hold stopped it, or it failed): a PUT,
 * PATCH or POST with a JSON or form body, to a URL naming the id, on the target's origin or its local API, never to an
 * endpoint in neverWritten. Only putBackEdited uses one, to put back a record the form's own save had already changed.
 */
function heldUpdate(capture: Capture, snap: RecordSnapshot, targetUrl: string): CapturedRequest | undefined {
  const id = snap.id;
  if (!id) return undefined;
  return capture.requests.find(
    (r) =>
      ["PUT", "PATCH", "POST"].includes(r.method.toUpperCase()) &&
      r.failure !== null &&
      bodyKind(r.postData) !== null &&
      (isSameOrigin(r.url, targetUrl) || isLocalOrigin(r.url, targetUrl)) &&
      urlNamesId(r.url, id.value) &&
      !neverWritten(r.url),
  );
}

/** What the page had read before a save: every record id in a JSON answer, and each read's path as a list or one record. */
interface ReadBeforeSave {
  /** Every id of an object in a JSON answer, as text: under one of ID_KEYS or any other id-like key (projectId too). */
  ids: Set<string>;
  /**
   * The ids read as an object's own id (recordId, with the names the object is read as: taskId of a task in
   * GET /api/tasks), by the key they were read under.
   */
  own: Map<string, Set<string>>;
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
 * Only ID_KEYS count here: {workspaceId, tasks: [...]} is still a list.
 */
function answersList(json: unknown): boolean {
  if (Array.isArray(json)) return true;
  return plainObject(json) && recordId(json) === null && Object.values(json).some(Array.isArray);
}

/**
 * Every id of an object in `node` (parsed JSON), as text, into `read.ids`; and each object's own id (recordId, with the
 * names it is read as: `names`, the read's URL and the keys on the way down) into `read.own` under its key.
 */
function idsIn(node: unknown, read: ReadBeforeSave, names: ReadonlySet<string>, depth = 0): void {
  if (depth > 12 || !node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) idsIn(item, read, names, depth + 1);
    return;
  }
  const obj = node as JsonObject;
  for (const [k, v] of Object.entries(obj)) if (idLikeKey(k) && idValue(v)) read.ids.add(String(v));
  const addOwn = (key: string, value: string | number) => {
    const values = read.own.get(key) ?? new Set<string>();
    values.add(String(value));
    read.own.set(key, values);
  };
  for (const key of ID_KEYS) if (idValue(obj[key])) addOwn(key, obj[key] as string | number);
  const own = recordId(obj, names);
  if (own && !ID_KEYS.includes(own.key)) addOwn(own.key, own.value);
  for (const [k, v] of Object.entries(obj)) {
    if (!v || typeof v !== "object") continue;
    idsIn(v, read, new Set([...names, ...nameForms(k)]), depth + 1);
  }
}

/**
 * A JSON answer the page got before a save: a GET's, or a GraphQL read's sent as a POST (`post`: the query body it
 * sent, so it can be sent again to re-read).
 */
export interface ReadAnswer {
  url: string;
  body: string;
  post?: string | null;
}

/**
 * True for a GraphQL read made as a GET (Relay, Apollo's GET queries): its URL carries a `query` that is a GraphQL
 * document ("{ tasks … }", "query Tasks …": core/saves.ts isGraphQlDocument), or the `extensions` of a persisted query.
 */
function graphQlGet(url: string): boolean {
  let params: URLSearchParams;
  try {
    params = new URL(url).searchParams;
  } catch {
    return false;
  }
  const query = params.get("query") ?? "";
  if (isGraphQlDocument(query) && !/\bmutation\b/.test(graphQlCode(query))) return true;
  return /persistedQuery/.test(params.get("extensions") ?? "");
}

/** True for a GraphQL read: one sent as a POST (it has its query body), or a GET with a GraphQL query in its URL. */
const isGraphQlAnswer = (a: ReadAnswer) => Boolean(a.post) || graphQlGet(a.url);

function readBeforeSave(answers: ReadAnswer[]): ReadBeforeSave {
  const out: ReadBeforeSave = { ids: new Set(), own: new Map(), lists: new Set(), records: new Set() };
  for (const a of answers) {
    const json = parseJson(a.body);
    if (json === null || typeof json !== "object") continue;
    idsIn(json, out, resourceNames(a.url));
    // A GraphQL endpoint serves every operation at one path, so its path is neither a list nor a record the page read:
    // only the ids its answers hold count (0.6.0 close-out round 1).
    if (isGraphQlAnswer(a)) continue;
    const path = pathKey(a.url);
    if (!path) continue;
    if (answersList(json)) out.lists.add(path);
    else out.records.add(path);
  }
  for (const path of out.lists) out.records.delete(path);
  return out;
}

/**
 * True when `key` (a query parameter, a body field, a form or multipart name) holding `value` names a record the page
 * read, as a save's own record rather than a reference to another one:
 * - one of ID_KEYS ({id: "t1"}) holding any id the page read;
 * - another id-like key (taskId, task_id) holding an id the page read, when the key names the resource the save's URL
 *   addresses (taskId on /api/tasks/rename), or when the page read that value as an object's own id under this very
 *   key (a list keyed taskId). A reference to another record (projectId on a task's create) is neither.
 */
function namesReadRecord(key: string, value: unknown, read: ReadBeforeSave, saveNames: ReadonlySet<string>): boolean {
  if (!idLikeKey(key) || !idValue(value)) return false;
  const text = String(value);
  if (!read.ids.has(text)) return false;
  if (ID_KEYS.includes(key)) return true;
  return saveNames.has(idResource(key)) || Boolean(read.own.get(key)?.has(text));
}

/**
 * The objects of `node` (a parsed JSON body) on the way down to a string that holds `key` (the run token, lower case):
 * the object holding the typed value and every object above it, to any depth (at most 12 levels, as idsIn reads). An
 * array is passed through, never an object on the way ([{id, title}] gives the item). A sibling of the way down ({project:
 * {id}} beside the typed title) is never one. Empty when `key` is empty or no string holds it.
 */
function pathToValues(node: unknown, key: string): JsonObject[] {
  if (key === "") return [];
  const out = new Set<JsonObject>();
  const walk = (n: unknown, path: JsonObject[], depth: number) => {
    if (depth > 12) return;
    if (typeof n === "string") {
      if (n.toLowerCase().includes(key)) for (const o of path) out.add(o);
      return;
    }
    if (Array.isArray(n)) {
      for (const item of n) walk(item, path, depth + 1);
      return;
    }
    if (plainObject(n)) for (const v of Object.values(n)) walk(v, [...path, n], depth + 1);
  };
  walk(node, [], 0);
  return [...out];
}

/** The part names of a multipart body. */
function multipartNames(body: string): string[] {
  return [...body.matchAll(/[;\s]name="([^"]*)"/g)].map((m) => m[1]!);
}

/**
 * True when a write the form's submit sends would change a record Account A already had, judged before it reaches the
 * app from what the page read before it (`answers`: the JSON GETs it made, with their URLs):
 * - any method but POST (PATCH, PUT, DELETE …): it changes or removes a record that is already there;
 * - a POST whose path names an id the page read (as any segment: /api/tasks/t1, /api/tasks/t1/rename), unless the page
 *   read that same path as a list (a POST to a list the page reads is a create in it: /api/projects/p1/tasks);
 * - a POST to a path the page read as one record (GET /api/profile, then POST /api/profile);
 * - a POST whose query names such an id under an id key (?id=t1, ?taskId=t1: namesReadRecord);
 * - a POST whose body names such an id under an id key (namesReadRecord): at its top ({id: "t1", title},
 *   {taskId: "t1", title}), on the object that holds the run's test values or any object on the way down to it, at any
 *   depth (pathToValues: {task: {id: "t1", title}}, tRPC's {"0": {"json": {id: "t1", title}}}, Relay's {variables:
 *   {input: {id: "t1", title}}}, JSON:API's {data: {id: "t1", attributes: {title}}}, a bulk [{id: "t1", title}]), as a
 *   form field (id=t1, task_id=t1, task[id]=t1) or a multipart part. A reference to another record beside the typed
 *   values ({project: {id: "p1"}, title}, {projectId: "p1", title}) is not;
 * - a GraphQL mutation naming such an id as a literal argument in its query text (updateTask(id: "t1", title: …)).
 * A GraphQL read (a POST query the page sent, or a GET with ?query=) gives the ids its answer holds, never its path:
 * /graphql serves every operation (0.6.0 close-out round 1).
 */
export function changesReadRecord(
  req: { method: string; url: string; postData: string | null },
  answers: ReadAnswer[],
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
    const ownIds = new Set([...read.own.values()].flatMap((v) => [...v]));
    if (parsed.pathname.split("/").filter(Boolean).some((seg) => ownIds.has(decode(seg)))) return true;
    if (read.records.has(path)) return true;
  }
  const saveNames = resourceNames(req.url);
  const names = (key: string, value: unknown) => namesReadRecord(key, value, read, saveNames);
  for (const [name, value] of parsed.searchParams) if (names(name, value)) return true;
  const body = req.postData;
  if (!body) return false;
  const named = (o: JsonObject) => Object.entries(o).some(([k, v]) => names(k, v));
  const json = parseJson(body);
  if (json !== null && typeof json === "object") {
    if (plainObject(json) && named(json)) return true;
    if (pathToValues(json, tokenKey(runToken)).some(named)) return true;
    // A GraphQL mutation may name the record in its query text rather than its variables: updateTask(id: "t1", …).
    return graphQlLiterals(json).some(([k, v]) => names(k, v));
  }
  if (bodyKind(body) === "form") {
    return [...new URLSearchParams(body)].some(([k, v]) => names(NESTED_FORM_KEY.exec(k)?.[2] ?? k, v));
  }
  return [...new Set(multipartNames(body))].some((name) => {
    const field = NESTED_FORM_KEY.exec(name)?.[2] ?? name;
    return idLikeKey(field) && [...read.ids].some((v) => multipartHas(body, name, v) && names(field, v));
  });
}

/**
 * The root fields of every mutation operation in `text` (a GraphQL document), aliases left out ("t: taskCreate" gives
 * taskCreate), in order; null when it holds no mutation operation. Arguments, directives, fragment spreads and nested
 * selections are skipped. A mutation with no field it can read gives [].
 */
export function mutationFields(text: string): string[] | null {
  const tokens = graphQlCode(text).match(/[_A-Za-z][_0-9A-Za-z]*|\.\.\.|[^\s,]/g) ?? [];
  const fields: string[] = [];
  let mutation = false;
  let i = 0;
  while (i < tokens.length) {
    // A definition at the top: "{" (a query), or a keyword, then its name and variables up to its selection set.
    let kind = "query";
    if (tokens[i] !== "{") {
      kind = tokens[i]!;
      let parens = 0;
      while (i < tokens.length && !(tokens[i] === "{" && parens === 0)) {
        if (tokens[i] === "(") parens += 1;
        else if (tokens[i] === ")") parens -= 1;
        i += 1;
      }
    }
    // A mutation whose selection set can't be found still counts as one: it gives no field.
    if (kind === "mutation") mutation = true;
    if (i >= tokens.length) break;
    // tokens[i] is the selection set's "{".
    let depth = 0;
    let parens = 0;
    for (; i < tokens.length; i += 1) {
      const t = tokens[i]!;
      if (t === "(") parens += 1;
      else if (t === ")") parens -= 1;
      if (parens > 0 || t === ")") continue;
      if (t === "{") depth += 1;
      else if (t === "}") {
        depth -= 1;
        if (depth === 0) {
          i += 1;
          break;
        }
      } else if (depth === 1 && kind === "mutation" && /^[_A-Za-z]/.test(t)) {
        const before = tokens[i - 1];
        // A directive (@include), a fragment spread (...Name) or its type condition (... on Type): not a field.
        if (before === "@" || before === "..." || (before === "on" && tokens[i - 2] === "...") || (t === "on" && before === "...")) continue;
        if (tokens[i + 1] === ":") {
          // An alias: the field is the name after it.
          const field = tokens[i + 2];
          if (field && /^[_A-Za-z]/.test(field)) fields.push(field);
          i += 2;
          continue;
        }
        fields.push(t);
      }
    }
  }
  return mutation ? fields : null;
}

/** The words of a name, lower case: taskCreate, task_create and TaskCreate all give ["task", "create"]. */
function nameWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Verbs that say a mutation makes a new record when they lead its name: createTask, insert_tasks_one, addComment,
 * newTask, postComment, sendMessage. Some are nouns too (likePost, pinLog), so only the first word counts.
 */
const CREATE_WORDS = new Set(["create", "add", "new", "insert", "post", "submit", "send", "upload", "book", "place", "make", "log"]);
/** The verbs that also say it at the end of the name, Shopify's way (productCreate, taskAdd): never a noun. */
const CREATE_LAST = new Set(["create", "add", "insert"]);
/**
 * Nouns for the one record of its kind an account has (0.6.0 close-out round 2): a create verb before one saves that
 * record, it makes no new one (submitProfile, sendSettings, postMyPreferences, accountCreate).
 */
const SINGLETON_NOUNS = new Set(["profile", "settings", "setting", "preferences", "preference", "prefs", "account", "me", "viewer"]);
/** Words that say it changes one that is there: updateTask, upsertTask, saveSettings, renameTask, setTheme. */
const EDIT_WORDS = new Set([
  "update", "edit", "set", "change", "rename", "save", "upsert", "patch", "replace", "delete", "remove", "toggle", "move", "archive",
  "mark", "complete", "modify", "assign", "unassign", "reorder", "merge", "restore", "clear", "reset", "destroy", "unset", "put",
]);

/**
 * True when a mutation field's (or operation's) name says it makes a new record and nothing else: a create verb first
 * (CREATE_WORDS) or last (CREATE_LAST), no word that says it changes one (EDIT_WORDS), and a thing it makes that isn't
 * the one record of its kind an account has (SINGLETON_NOUNS): the last word after a leading verb (submitProfile,
 * createProfileNote makes a note), the word before a trailing one (accountCreate).
 */
function createsRecord(name: string): boolean {
  const words = nameWords(name);
  const first = CREATE_WORDS.has(words[0] ?? "");
  const last = !first && CREATE_LAST.has(words[words.length - 1] ?? "");
  if (!first && !last) return false;
  const noun = first ? words[words.length - 1] : words[words.length - 2];
  return !words.some((w) => EDIT_WORDS.has(w)) && !SINGLETON_NOUNS.has(noun ?? "");
}

/** The operations of a GraphQL request body (one, or a batch), or null when it isn't one. */
function graphQlOperations(json: unknown): JsonObject[] | null {
  const ops = Array.isArray(json) ? json : [json];
  if (ops.length === 0 || !ops.every(plainObject)) return null;
  const isOperation = (o: JsonObject) =>
    typeof o.query === "string" ||
    (plainObject(o.extensions) && plainObject(o.extensions.persistedQuery)) ||
    (typeof o.operationName === "string" && plainObject(o.variables));
  return (ops as JsonObject[]).every(isOperation) ? (ops as JsonObject[]) : null;
}

/**
 * For a GraphQL save the hold can't judge by an id (0.6.0 close-out round 1): the names of the mutation's root fields
 * that don't read as a create (createsRecord), joined with ", ", or null when every one does or the body isn't a GraphQL
 * mutation. updateProfile(name: …) names no record, yet changes Account A's profile. A persisted query (no query text)
 * is judged by its operation name; one with none gives "a persisted query". A mutation whose fields can't be read gives
 * "a mutation".
 */
export function unclearGraphQlSave(postData: string | null | undefined): string | null {
  if (!postData || !/^\s*[[{]/.test(postData)) return null;
  const ops = graphQlOperations(parseJson(postData));
  if (!ops) return null;
  const unclear: string[] = [];
  for (const op of ops) {
    if (typeof op.query === "string") {
      const fields = mutationFields(op.query);
      if (fields === null) continue;
      if (fields.length === 0) unclear.push("a mutation");
      for (const f of fields) if (!createsRecord(f)) unclear.push(f);
      continue;
    }
    const name = typeof op.operationName === "string" ? op.operationName : "";
    if (!name) unclear.push("a persisted query");
    else if (!createsRecord(name)) unclear.push(name);
  }
  return unclear.length > 0 ? [...new Set(unclear)].join(", ") : null;
}

/**
 * The literal arguments (name, value) in the query text of each mutation of a GraphQL request body (`json`, parsed):
 * updateTask(id: "t1", title: "…") gives ["id", "t1"] and ["title", "…"]. Strings and numbers only.
 */
function graphQlLiterals(json: unknown): [string, string | number][] {
  const ops = graphQlOperations(json);
  if (!ops) return [];
  const out: [string, string | number][] = [];
  for (const op of ops) {
    if (typeof op.query !== "string" || mutationFields(op.query) === null) continue;
    const text = op.query.replace(/#[^\n]*/g, " ");
    for (const m of text.matchAll(/([_A-Za-z][_0-9A-Za-z]*)\s*:\s*("(?:[^"\\\n]|\\.)*"|-?\d+(?:\.\d+)?\b)/g)) {
      const raw = m[2]!;
      const value = raw.startsWith('"') ? (parseJson(raw) as string | null) : Number(raw);
      if (value !== null) out.push([m[1]!, value]);
    }
  }
  return out;
}

/** Relay's clientMutationId names no record: it only pairs a mutation with its answer. */
const NOT_A_RECORD_ID = new Set(["clientMutationId"]);

/**
 * The ids a GraphQL request body names (0.6.0 close-out round 2): under an id-like key (idLikeKey) at any depth of an
 * operation's variables, or as a literal argument of one of its mutations (graphQlLiterals). Empty when the body isn't a
 * GraphQL request.
 */
function graphQlIds(postData: string | null): string[] {
  const json = parseJson(postData ?? "");
  const ops = graphQlOperations(json);
  if (!ops) return [];
  const out: string[] = [];
  const walk = (n: unknown, depth: number) => {
    if (depth > 12 || !n || typeof n !== "object") return;
    if (Array.isArray(n)) {
      for (const item of n) walk(item, depth + 1);
      return;
    }
    for (const [k, v] of Object.entries(n as JsonObject)) {
      if (idLikeKey(k) && !NOT_A_RECORD_ID.has(k) && idValue(v)) out.push(String(v));
      else walk(v, depth + 1);
    }
  };
  for (const op of ops) walk(op.variables, 0);
  for (const [k, v] of graphQlLiterals(json)) if (idLikeKey(k) && !NOT_A_RECORD_ID.has(k)) out.push(String(v));
  return out;
}

/** A write the hold stopped before it reached the app. */
export interface StoppedWrite {
  method: string;
  url: string;
  /** Its body carries the run's test values: it is the form's own save. */
  carriesValues: boolean;
  /**
   * Set when it was stopped as a GraphQL mutation whose name doesn't say it creates a record (unclearGraphQlSave), not
   * for an id or path the page read: the names of those fields, for the note.
   */
  graphql?: string;
}

/**
 * The reason a write-side check gives when the hold stopped the form's GraphQL save because its mutation (`fields`)
 * doesn't say it creates a record: nothing tells it from an edit of a record Account A already had.
 */
export function unclearGraphQlNote(fields: string): string {
  return `Skipped: this form saves through a GraphQL mutation (${fields}) whose name doesn't say it creates a record, so Run Hound can't tell it from a change to a record Account A already had, and it only ever writes to a record it created in this run.`;
}

/**
 * Holds the writes the form's submit sends (see holdExistingEdits) and judges each before it reaches the app.
 */
export interface SaveHold {
  /** The writes stopped before they reached the app, in order: each would have changed a record Account A already had. */
  readonly stopped: StoppedWrite[];
  /** The answers the page had read (as Account A) when the form's save was judged, for editsExistingRecord and putBackEdited. */
  before(): string[];
  /** The same answers with their URLs (and a GraphQL read's query body), for editsExistingRecord. */
  reads(): ReadAnswer[];
  /**
   * The note for a form whose save was stopped (its save changes a record Account A already had), or null to go on. Also
   * null when an earlier write carrying the test values went through and, read again on release(), a record the page
   * had read now holds them (or the re-read failed): the caller then reads the record back and puts it back.
   */
  verdict(): string | null;
  /**
   * Ends the hold: later requests reach the app as usual. When a write carrying the test values was stopped after one
   * went through, first re-reads what the page had read, as Account A (see verdict).
   */
  release(): Promise<void>;
}

/**
 * Before the form's submit, as Account A: judges each write the page sends to the app (the target's origin or its local
 * API) before it leaves the page, until release(). A write that would change a record Account A already had
 * (changesReadRecord, against every JSON answer the page read before it, with a read of the app's API on another local
 * origin, whose body the capture doesn't keep, made again as Account A) is stopped: it never reaches the app. So a form
 * that edits one of Account A's records is skipped with nothing written, and the safety contract's "A's pre-existing
 * records are never written to" holds for the form's own save too.
 *
 * Once a write that carries the run's test values has gone through (the form's save), a later write that doesn't carry
 * them goes on unjudged (a DELETE check, a counter), and one that does is still judged (0.6.0 round 3): against what the
 * page had read before that save, by the ids and paths it names and never by its method. The app's own update for the
 * record the save just created (PATCH /api/tasks/t3) names an id the page hadn't read, so it goes; the real save after a
 * pre-save check (POST /api/profile/check, then POST /api/profile the page read as one record), or an edit of a task the
 * page read (PATCH /api/tasks/t1), is stopped.
 * On a GraphQL app (0.6.0 close-out round 1) the page's reads are often POSTs (Apollo Client's default): a POST whose
 * body is a GraphQL query (core/saves.ts isGraphQlRead: only GraphQL request keys, a query that is a GraphQL document
 * with no mutation; a REST body with a "query" field is a write, 0.6.0 close-out round 2) is a read, never judged, and
 * its answer counts with the GETs'. A GraphQL mutation carrying the test values whose name doesn't say it creates a
 * record (unclearGraphQlSave: updateProfile, saveSettings, submitProfile) is stopped too, with its own note: it may
 * change a record Account A already had without naming one. After a save has gone through, such a mutation goes only
 * when it names the record that save created (an id the page hadn't read before it, held by the save's answer).
 * Requests go on through the context's own routes (the safety gate) with route.fallback. Call release() once the save
 * has been waited for.
 */
export async function holdExistingEdits(ctx: CheckContext, page: Page, capture: Capture): Promise<SaveHold> {
  const stopped: StoppedWrite[] = [];
  /** The writes carrying the test values that went through, in order: the first is the form's save. */
  const went: { method: string; url: string }[] = [];
  let released = false;
  let answers: ReadAnswer[] = [];
  /** What the page had read when the first write carrying the test values went through (null until then). */
  let readAtSave: ReadAnswer[] | null = null;
  /**
   * Set on release when a write carrying the test values was stopped after another one went through: whether a record
   * the page had read now holds the run token (that earlier write changed it), or null when a re-read failed.
   */
  let earlierChanged: boolean | null | undefined;
  /** Bodies of the app's API reads on another local origin, read again as Account A (at most 10, once each). */
  const rereads = new Map<string, string | null>();

  const readSoFar = async (): Promise<ReadAnswer[]> => {
    const out: ReadAnswer[] = [];
    for (const r of [...capture.requests]) {
      if (typeof r.status !== "number" || r.status < 200 || r.status >= 300) continue;
      // A GraphQL read sent as a POST (Apollo's default) whose answer the capture kept: its ids count like a GET's.
      if (r.method.toUpperCase() === "POST" && isGraphQlRead(r.postData)) {
        if (r.responseBody) out.push({ url: r.url, body: r.responseBody, post: r.postData });
        continue;
      }
      if (r.method.toUpperCase() !== "GET") continue;
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

  /**
   * The ids the answers to the writes carrying the test values that went through hold (the record the form's save
   * created), from the capture. The capture reads an answer's body a moment after the page gets it, so this waits for
   * those bodies, at most 2 s.
   */
  const answeredIds = async (): Promise<Set<string>> => {
    const deadline = Date.now() + 2_000;
    for (;;) {
      const saves = capture.requests.filter(
        (r) =>
          went.some((w) => w.method === r.method.toUpperCase() && w.url === r.url) &&
          r.failure === null &&
          typeof r.status === "number" &&
          r.status >= 200 &&
          r.status < 300 &&
          carriesTestValues(r.postData, ctx.runToken),
      );
      if (!saves.some((r) => r.responseBody === null) || Date.now() >= deadline) {
        return readBeforeSave(saves.filter((r) => r.responseBody).map((r) => ({ url: r.url, body: r.responseBody!, post: r.postData }))).ids;
      }
      await delay(100);
    }
  };

  /** Whether a write goes on to the app: judged, and stopped on the safe side when judging itself fails. */
  const decide = async (method: string, url: string, postData: string | null): Promise<"go" | "stop"> => {
    if (released || method === "GET" || method === "HEAD" || method === "OPTIONS") return "go";
    if (!isSameOrigin(url, ctx.targetUrl) && !isLocalOrigin(url, ctx.targetUrl)) return "go";
    // A GraphQL query sent as a POST reads; it changes nothing (and its answer counts with the page's reads).
    if (method === "POST" && isGraphQlRead(postData)) return "go";
    const carriesValues = carriesTestValues(postData, ctx.runToken);
    // After the form's save went through, only a write that doesn't carry the test values goes unjudged (the app's
    // own follow-up: a DELETE check, a counter).
    if (readAtSave && !carriesValues) return "go";
    let changes: boolean;
    try {
      if (readAtSave) {
        // A later write carrying the values (a pre-save check went first; the app's own update for the record the save
        // just created) is judged against what the page had read before that save, and by the ids and paths it names,
        // never by its method: PATCH /api/tasks/t3 for the new task goes, POST /api/profile or PATCH /api/tasks/t1 for a
        // record the page read is stopped.
        changes = changesReadRecord({ method: "POST", url, postData }, readAtSave, ctx.runToken);
      } else {
        answers = await readSoFar();
        changes = changesReadRecord({ method, url, postData }, answers, ctx.runToken);
      }
    } catch {
      changes = true;
    }
    if (changes) {
      stopped.push({ method, url, carriesValues });
      return "stop";
    }
    // The form's GraphQL save: a mutation that doesn't say it creates a record may change one of Account A's without
    // naming it (updateProfile), so it is stopped too. After a save went through (0.6.0 close-out round 2), such a
    // mutation goes only when it names the record that save created: an id the page hadn't read before the save, which
    // the save's answer held (the app's own updateTask(id: "t9") for the task createTask just made).
    let graphql = carriesValues ? unclearGraphQlSave(postData) : null;
    if (graphql && readAtSave) {
      try {
        const before = readBeforeSave(readAtSave).ids;
        const fresh = graphQlIds(postData).filter((id) => !before.has(id));
        if (fresh.length > 0) {
          const answered = await answeredIds();
          if (fresh.some((id) => answered.has(id))) graphql = null;
        }
      } catch {
        // Judging failed: stopped, on the safe side.
      }
    }
    if (graphql) {
      stopped.push({ method, url, carriesValues, graphql });
      return "stop";
    }
    if (carriesValues) {
      went.push({ method, url });
      readAtSave ??= [...answers];
    }
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
    reads: () => [...answers],
    verdict() {
      // A write that carries the test values was stopped, or nothing that carries them went through and a write was stopped.
      const save = stopped.find((w) => w.carriesValues) ?? (went.length > 0 ? undefined : stopped[0]);
      if (!save) return null;
      const lead = save.graphql ? unclearGraphQlNote(save.graphql) : EXISTING_RECORD;
      const stoppedNote = `${lead} Run Hound stopped the form's save (${endpointText(save.method, save.url)}) before it reached the app`;
      const earlier = went.map((w) => endpointText(w.method, w.url));
      if (earlier.length === 0) return `${stoppedNote}, so nothing was changed.`;
      // An earlier write with the typed values did reach the app (a check before the save, a save at another URL). When
      // it changed a record the page had read (or a re-read failed), there is no verdict here: the caller reads the
      // record back and puts it back (editsExistingRecord, putBackEdited). Never say that nothing was written.
      if (earlierChanged !== false) return null;
      return `${stoppedNote}, so that record wasn't changed. ${joinWords(earlier)}, which the form sent before it with the values Run Hound typed, did reach the app; the page hadn't read a record ${earlier.length === 1 ? "it changes" : "they change"}.`;
    },
    async release() {
      released = true;
      await page.unroute("**/*", handler).catch(() => undefined);
      if (readAtSave && went.length > 0 && stopped.some((w) => w.carriesValues)) {
        earlierChanged = await readRecordChanged(ctx, page, readAtSave).catch(() => null);
      }
    },
  };
}

/**
 * True when a record the page read before the form's save (`reads`) now holds the run token, each read made again as
 * Account A (at most 10 URLs; through CheckContext.request, else a fetch in Account A's own page for a same-origin one):
 * one the page read at a path as one record, or an object whose own id it read. So a write that went through before the
 * stopped save (POST /api/today renaming task t1) changed that record. False when none does, null when a re-read failed.
 */
async function readRecordChanged(ctx: CheckContext, page: Page, reads: ReadAnswer[]): Promise<boolean | null> {
  const key = tokenKey(ctx.runToken);
  if (!key) return null;
  const read = readBeforeSave(reads);
  // A GET, or a GraphQL read sent again with the query body the page sent (a read, as the page made it).
  const again = async (url: string, post: string | null): Promise<string | null> => {
    const answer = await ctx
      .request("self", post ? { method: "POST", url, headers: { "content-type": "application/json" }, body: post } : { method: "GET", url })
      .catch(() => null);
    if (answer && answer.status >= 200 && answer.status < 300) return answer.body;
    if (!isSameOrigin(url, page.url())) return null;
    return page
      .evaluate(async ([u, p]) => {
        try {
          const r = await fetch(u, p ? { method: "POST", headers: { "content-type": "application/json" }, body: p, credentials: "include" } : { credentials: "include" });
          return r.ok ? await r.text() : null;
        } catch {
          return null;
        }
      }, [url, post] as const)
      .catch(() => null);
  };
  let unknown = false;
  const distinct = new Map<string, ReadAnswer>();
  for (const r of reads) distinct.set(`${r.url}\n${r.post ?? ""}`, r);
  for (const r of [...distinct.values()].slice(0, 10)) {
    const body = await again(r.url, r.post ?? null);
    if (body === null) {
      unknown = true;
      continue;
    }
    if (!body.toLowerCase().includes(key)) continue;
    const path = pathKey(r.url);
    if (path && read.records.has(path)) return true;
    if (ownIdHoldsToken(parseJson(body), read, key)) return true;
  }
  return unknown ? null : false;
}

/** True when an object of `node` whose own id the page read (`read.own`, under the key it was read under) holds `key`. */
function ownIdHoldsToken(node: unknown, read: ReadBeforeSave, key: string, depth = 0): boolean {
  if (depth > 12 || !node || typeof node !== "object") return false;
  if (Array.isArray(node)) return node.some((item) => ownIdHoldsToken(item, read, key, depth + 1));
  const obj = node as JsonObject;
  const own = [...read.own].some(([k, values]) => idValue(obj[k]) && values.has(String(obj[k])));
  if (own && Object.values(obj).some((v) => typeof v === "string" && v.toLowerCase().includes(key))) return true;
  return Object.values(obj).some((v) => ownIdHoldsToken(v, read, key, depth + 1));
}

/** True when the capture's `r` is a write the hold stopped (it never reached the app): never the form's save. */
export function stoppedByHold(hold: SaveHold, r: CapturedRequest): boolean {
  return r.failure !== null && hold.stopped.some((w) => w.method === r.method.toUpperCase() && w.url === r.url);
}
