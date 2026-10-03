/** Existing-record hold / replay restore: holds writes the form's submit sends, restores the test record, and judges whether the form changed one Account A already had. */

import { setTimeout as delay } from "node:timers/promises";
import type { Page, Request, Route } from "playwright";
import { carriesTestValues, isGraphQlRead, isLocalOrigin, isSameOrigin, tokenKey } from "../../../core/saves.js";
import type { Capture, CheckContext } from "../../../core/types.js";
import { actsWhenLoaded } from "../acting-links.js";
import {
  CONTENT_TYPE,
  EXISTING_RECORD,
  FIXED_KEYS,
  ID_KEYS,
  NESTED_FORM_KEY,
  SERVER_SET_KEYS,
  SERVER_SET_NAME,
} from "../../../constants/record-state-constants.js";
import type { ReadAnswer, ReadBeforeSave, RecordIO, RecordSnapshot, SaveHold, StoppedWrite } from "../../../interfaces/record-state.js";
import type { CapturedRequest, JsonObject } from "../../../types/record-state.js";
import {
  bodyKind,
  bodyNamesId,
  changedFields,
  holdsId,
  jsonObjectBody,
  multipartHas,
  multipartNames,
  parseJson,
  plainObject,
} from "./parsing.js";
import {
  bare,
  chainsWithId,
  idLikeKey,
  idValue,
  modelNames,
  neverWritten,
  readsList,
  recordChains,
  recordId,
  recordWrites,
  requestIO,
  resourceNames,
  rereadRecord,
  snapshotFrom,
  urlNamesId,
} from "./snapshot.js";
import {
  graphQlIds,
  graphQlLiterals,
  graphQlReadLike,
  namesReadRecord,
  pathKey,
  pathToValues,
  readBeforeSave,
  unclearGraphQlSave,
} from "./graphql.js";

/** True when `value` is text carrying the run token: text Run Hound typed, the record's own data whatever its name. */
function typedByRun(value: unknown, runToken: string): boolean {
  const token = tokenKey(runToken);
  return token !== "" && typeof value === "string" && value.toLowerCase().includes(token);
}

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
  for (const k of new Set(parsed.searchParams.keys())) {
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

/** True when `id` appeared in any answer the page got before the save: the form changed an existing record. */
export function seenBefore(bodies: string[], id: { key: string; value: string | number }): boolean {
  return bodies.some((b) => holdsId(b, id));
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
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(req.url);
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
    if (parsedUrl.pathname.split("/").filter(Boolean).some((seg) => ownIds.has(decode(seg)))) return true;
    if (read.records.has(path)) return true;
  }
  const saveNames = resourceNames(req.url);
  const names = (key: string, value: unknown) => namesReadRecord(key, value, read, saveNames);
  for (const [name, value] of parsedUrl.searchParams) if (names(name, value)) return true;
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
 * The reason a write-side check gives when the hold stopped the form's GraphQL save because its mutation (`fields`)
 * doesn't say it creates a record: nothing tells it from an edit of a record Account A already had.
 */
export function unclearGraphQlNote(fields: string): string {
  return `Skipped: this form saves through a GraphQL mutation (${fields}) whose name doesn't say it creates a record, so Run Hound can't tell it from a change to a record Account A already had, and it only ever writes to a record it created in this run.`;
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
 * its answer counts with the GETs'. So does the answer to a persisted operation sent by hash or document id with no
 * query text (Apollo's automatic persisted queries, Relay's doc_id: graphQlReadLike), which is still judged as a write
 * and never sent again. A GraphQL mutation carrying the test values whose name doesn't say it creates a
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
    const requests = capture.requests.slice();
    for (const r of requests) {
      if (typeof r.status !== "number" || r.status < 200 || r.status >= 300) continue;
      // A GraphQL read sent as a POST (Apollo's default) whose answer the capture kept: its ids count like a GET's.
      if (r.method.toUpperCase() === "POST" && isGraphQlRead(r.postData)) {
        if (r.responseBody) out.push({ url: r.url, body: r.responseBody, post: r.postData });
        continue;
      }
      // A persisted GraphQL operation (a hash or document id, no query text) or a query with a key beside the GraphQL
      // ones: its ids count too, but it is never sent again (it may be a mutation).
      if (r.method.toUpperCase() === "POST" && graphQlReadLike(r.postData)) {
        if (r.responseBody) out.push({ url: r.url, body: r.responseBody, graphql: true });
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
  for (const r of reads) distinct.set(`${r.url}\n${r.post ?? ""}\n${r.graphql ? "graphql" : ""}`, r);
  for (const r of [...distinct.values()].slice(0, 10)) {
    // A persisted GraphQL operation the page sent may be a mutation: never sent again, so what it read is unknown.
    if (r.graphql && !r.post) {
      unknown = true;
      continue;
    }
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
