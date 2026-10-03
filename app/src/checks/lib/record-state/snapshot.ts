/** Read snapshots: finding the record endpoint, snapshotting the test record, and re-reading it as Account A. */

import type { Capture, CheckContext, DiscoveredForm } from "../../../core/types.js";
import { isLocalOrigin, isSameOrigin, tokenKey } from "../../../core/saves.js";
import { isDestructiveControl } from "../../dead-control.js";
import { actsWhenLoaded, urlWords } from "../acting-links.js";
import { fieldName, isSearchForm, submitControl } from "../functional-form.js";
import { ACCOUNT_FORM, ID_KEYS, IRREGULAR_PLURALS, NEVER_WRITTEN } from "../../../constants/record-state-constants.js";
import type { RecordIO, RecordSnapshot } from "../../../interfaces/record-state.js";
import type { CapturedRequest, JsonObject } from "../../../types/record-state.js";
import { jsonObjectBody, parseJson } from "./parsing.js";

/** Lower case, letters and digits only: "assignee_attributes" and "assigneeAttributes" compare the same. */
export const bare = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

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

/** A string or number an id can be. */
export const idValue = (v: unknown): v is string | number => (typeof v === "string" && v !== "") || (typeof v === "number" && Number.isFinite(v));

/**
 * True when `key` names an id: one of ID_KEYS, or a name that ends in one (taskId, task_id, task-id, TaskID), the rule
 * write-access's isIdParam uses. A reference to another record (projectId) is one too: idResource tells them apart.
 */
export function idLikeKey(key: string): boolean {
  return ID_KEYS.includes(key) || /(^|[_-])id$/i.test(key) || /[a-z0-9]I[dD]$/.test(key);
}

/** The resource an id-like key names, bare ("task" for taskId, task_id, TaskID), or "" for one of ID_KEYS. */
export function idResource(key: string): string {
  if (ID_KEYS.includes(key)) return "";
  return bare(key.replace(/[_-]?id$/i, ""));
}

/** A name's singular and plural forms, bare: "tasks" and "task" for either, "people" and "person" (IRREGULAR_PLURALS). */
export function nameForms(name: string): string[] {
  const n = bare(name);
  if (!n) return [];
  const singular = [IRREGULAR_PLURALS.get(n), n.replace(/ies$/, "y"), n.replace(/(ch|sh|ss|x)es$/, "$1"), n.replace(/s$/, "")];
  return [n, ...singular.filter((s): s is string => Boolean(s))];
}

/** The resource names `url`'s path segments give (singular and plural): {api, tasks, task, rename} for /api/tasks/rename. */
export function resourceNames(url: string): Set<string> {
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

/** The chains (deepest first) of every object in `node` whose `key` is `value`. */
export function chainsWithId(node: unknown, key: string, value: string | number): JsonObject[][] {
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

/**
 * The names a save may nest the record under (Rails' param key): the resource the save's URL updates, the path segment
 * before the record's id (the last such, so /projects/7/tasks/7 is "tasks"), else the last segment, plural and
 * singular ("tasks" and "task" for PATCH /api/tasks/7, "categories" and "category" for /categories/7, "people" and
 * "person" for /people/7, see IRREGULAR_PLURALS).
 */
export function modelNames(url: string, id: string | number | undefined): Set<string> {
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