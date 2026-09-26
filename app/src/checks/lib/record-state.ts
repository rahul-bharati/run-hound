/**
 * The run's own test record, read and put back as Account A (0.5.0, docs/v2-spec.md "Types and shared helpers"). Shared
 * by the write-side checks (write-access, csrf, paywall-trust) and mass-assignment: find the record endpoint after a
 * save, snapshot the record, re-read it after an attempt, and restore it. Every read is a GET as Account A through
 * CheckContext.request (the safety gate applies), and a snapshot only ever holds a record carrying the run token, so
 * a restore never writes to one of Account A's own records.
 */
import { isLocalOrigin, isSameOrigin, tokenKey } from "../../core/saves.js";
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
export async function rereadRecord(ctx: CheckContext, snap: RecordSnapshot): Promise<JsonObject[] | "gone" | null> {
  const read = await readJson(ctx, snap.url);
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

/** The save's body with every field the snapshot's record holds set back to the snapshot's value, or null. */
function restoreBody(save: CapturedRequest, record: JsonObject, fields: string[]): { body: string; kind: "json" | "form" } | null {
  const kind = bodyKind(save.postData);
  if (!kind) return null;
  const has = (k: string) => Object.prototype.hasOwnProperty.call(record, k);
  if (kind === "json") {
    const sent = jsonObjectBody(save.postData)!;
    const body: JsonObject = {};
    for (const [k, v] of Object.entries(sent)) body[k] = has(k) ? record[k] : v;
    for (const k of fields) if (has(k)) body[k] = record[k];
    return { body: JSON.stringify(body), kind };
  }
  const params = new URLSearchParams(save.postData!);
  const text = (v: unknown) => (typeof v === "string" ? v : v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
  for (const k of [...new Set(params.keys())]) if (has(k)) params.set(k, text(record[k]));
  for (const k of fields) if (has(k) && (typeof record[k] !== "object" || record[k] === null)) params.set(k, text(record[k]));
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
 */
export async function restoreRecord(
  ctx: CheckContext,
  snap: RecordSnapshot,
  how: { save: CapturedRequest; create?: CapturedRequest },
): Promise<{ restored: string[]; notRestored: string[] }> {
  const now = await rereadRecord(ctx, snap);
  const allowed = (r: CapturedRequest) => {
    const m = r.method.toUpperCase();
    return m !== "GET" && m !== "DELETE" && !actsWhenLoaded(r.url) && !neverWritten(r.url);
  };
  const send = (r: CapturedRequest, body: string, kind: "json" | "form") =>
    ctx.request("self", { method: r.method.toUpperCase(), url: r.url, headers: { "content-type": CONTENT_TYPE[kind] }, body }).catch(() => null);

  if (now === "gone") {
    const create = how.create ?? how.save;
    const kind = bodyKind(create.postData);
    if (!allowed(create) || !kind) return { restored: [], notRestored: ["the record"] };
    await send(create, create.postData!, kind);
    // The record made again has a new id, so it is found by its test values.
    const back = await rereadRecord(ctx, { ...snap, id: null });
    return back !== null && back !== "gone" ? { restored: ["the record"], notRestored: [] } : { restored: [], notRestored: ["the record"] };
  }

  // The re-read failed: nothing is known about the record, so nothing is sent and nothing counts as restored.
  if (now === null) return { restored: [], notRestored: Object.keys(snap.record) };
  const changed = changedFields(snap.record, now[0]!);
  if (changed.length === 0) return { restored: [], notRestored: [] };
  const had = (k: string) => Object.prototype.hasOwnProperty.call(snap.record, k);
  const added = changed.filter((k) => !had(k));
  const toPut = changed.filter(had);

  // An update of this record: to its id when it has one, else anything but a POST (a POST without the id creates).
  const updatesIt = snap.id ? urlNamesId(how.save.url, snap.id.value) : how.save.method.toUpperCase() !== "POST";
  const body = allowed(how.save) && updatesIt && toPut.length > 0 ? restoreBody(how.save, snap.record, toPut) : null;
  if (!body) return { restored: [], notRestored: changed };
  await send(how.save, body.body, body.kind);
  const after = await rereadRecord(ctx, snap);
  if (after === null || after === "gone") return { restored: [], notRestored: changed };
  const still = new Set(changedFields(snap.record, after[0]!));
  return { restored: toPut.filter((k) => !still.has(k)), notRestored: [...toPut, ...added].filter((k) => still.has(k)) };
}
