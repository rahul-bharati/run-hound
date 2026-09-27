/**
 * write-access (0.6.0, docs/v2-spec.md "`write-access`" and "`write-access` amendments"): can Account B, or a visitor
 * who isn't signed in, change or delete a record that belongs to Account A?
 *
 * - Scenarios `other-account` (as B; needs B set up and `isolated`) and `signed-out`, planned per form only on a
 *   signed-in run and only for a form that saves a record (`savesOwnRecord`). Unticked by default, not destructive.
 *   Who a scenario runs as comes from its id the way the runner reads it to sign B in (identityOf): on a later form
 *   ("@form-<n>") and under a collided id ("#<n>") too. An id that names neither identity is skipped.
 * - As A, create the run's test record through the form, find its record endpoint and snapshot it
 *   (lib/record-state.ts). A form that edits a record Account A already had is skipped: its save is held in the page
 *   and stopped before it reaches the app (holdExistingEdits), so nothing is written; one that went through and only
 *   then shows it changed such a record (editsExistingRecord) is put back as the page read it before the save
 *   (putBackEdited), and what can't be is named with "check Account A". The update and delete requests
 *   are only those the app itself sent for that record: never a guessed endpoint. None observed → skipped with the reason.
 *   "For that record" means sent after the save, to a URL whose last segment (or an id-named query value) is its id,
 *   and either in its collection (the save's path; the read's, with the id cut out only when the read is the record at
 *   its own URL, never from a list read's URL, which may name another record by the same id: ?listId=3, /api/lists/3),
 *   or naming the id itself (last segment, or ?<id key>=) with the record itself in its body or answer (the same
 *   run-token field with the same value, and in an answer its id) and a URL that reads, as Account A, as the whole
 *   record: its id and every field the snapshot has, with the same run-token values (the write's own answer is never
 *   enough). Another of Account A's records that shares the id is never written to, even when its write mentions a
 *   test value, copies one in verbatim under the record's own key, or its answer names one or holds the whole record.
 *   A body with a password or email key is never sent.
 * - As the scenario's identity, send each observed update with one field set to a fresh run-token marker that can't
 *   be confused with the created value or another scenario's marker, where the app's body holds the record (at the
 *   top, or one level down: {"task": {...}}); DELETE last, only when the app showed one.
 * - Verdict from a re-read as A, never a status code, judged against a re-read taken just before the attempt: changed
 *   or gone → critical, confirmed; otherwise pass, naming the requests tried. After every attempt, restore and re-read;
 *   anything not restored is named, no further write is sent, and the scenario is not a pass while that note stands.
 *   When all that is left is fields the app sets itself on every save (updatedAt, version), the note says so and the
 *   remaining writes still go: the record's own values are back. Still never a pass.
 *   Fields that change on their own (they differ between two reads with no write in between) are left out of every
 *   comparison, never a run-token field or one a probe sets. A DELETE that leaves the record there counts only through
 *   a field that says it was removed. An attempt that changed anything else of the record (and not what it set) is put
 *   back and makes the scenario inconclusive: not a finding, never a pass.
 */
import { setTimeout as delay } from "node:timers/promises";
import { isLocalOrigin, isSameOrigin, tokenKey } from "../core/saves.js";
import type { Capture, Check, CheckContext, Evidence, Finding, Identity, PlanEnv, Scenario } from "../core/types.js";
import { redactSecrets } from "../engine/redact.js";
import { endpointOf, errorResult, guarded, result, tryCard } from "./lib/functional-finding.js";
import { canaryValues, createRequests, fillForm, settle, submitControl, submitForm, waitForCreates, type FieldValue } from "./lib/functional-form.js";
import {
  changedFields,
  changesOnSave,
  editsExistingRecord,
  EXISTING_RECORD,
  findOwnRecord,
  getsBefore,
  holdExistingEdits,
  jsonObjectBody,
  neverWritten,
  parseJson,
  putBackEdited,
  readsList,
  recordId,
  recordWrites,
  rereadRecord,
  restoreRecord,
  savesOwnRecord,
  snapshotFrom,
  snapshotRecord,
  stoppedByHold,
  type CapturedRequest,
  type JsonObject,
  type RecordSnapshot,
} from "./lib/record-state.js";

const ID = "write-access" as const;

const INTERRUPTED_NOTE =
  "If Run Hound had already sent a change as another account or signed out, Account A's test record may have changed or been deleted: check Account A.";

type Who = Exclude<Identity, "self">;

/** How each identity is named in notes, and the subject of a title. */
const WHO: Record<Who, { words: string; subject: string; slug: string }> = {
  other: { words: "Account B", subject: "Account B", slug: "other-account" },
  "signed-out": { words: "a signed-out visitor", subject: "Signed-out visitors", slug: "signed-out" },
};

/**
 * A scenario id that ends in `slug`, as the planner makes it (plan.ts buildPlan): after a colon (the check's id, and
 * again on a collision), then a later form's "@form-<n>" and a collision's "#<n>". The same shape
 * runner.needsOtherAccount matches to sign Account B in.
 */
const idEndingIn = (slug: string) => new RegExp(`(?:^|:)${slug}(?:@form-\\d+)?(?:#\\d+)?$`);
const SCENARIO_ID: Record<Who, RegExp> = { other: idEndingIn(WHO.other.slug), "signed-out": idEndingIn(WHO["signed-out"].slug) };

/**
 * Who a write-access scenario sends its writes as, decided from the scenario the way runner.needsOtherAccount decides
 * that Account B signs in for it: "other" for the other-account scenario on any form and under any collision suffix,
 * "signed-out" for the signed-out one. Null for an id that names neither (such a scenario is skipped, never run as a
 * guessed identity).
 */
export function identityOf(scenario: Pick<Scenario, "id">): Who | null {
  if (SCENARIO_ID.other.test(scenario.id)) return "other";
  if (SCENARIO_ID["signed-out"].test(scenario.id)) return "signed-out";
  return null;
}

/**
 * Per scenario: the salt of the values the test record is created with, and the tag its markers carry. A marker is the
 * created value with the tag inserted right after the run token, so it still carries the token but never contains the
 * created value (the tag doesn't start with the salt), and the two scenarios' markers never contain each other.
 */
const SALT: Record<Who, { create: string; mark: string }> = {
  other: { create: "wab", mark: "wxb" },
  "signed-out": { create: "was", mark: "wxs" },
};

/** `value` with `tag` inserted right after the run token (`key`), or appended with the token when it has none. */
function markValue(value: string, key: string, tag: string): string {
  const i = value.toLowerCase().indexOf(key);
  if (i < 0) return `${value} ${key}${tag}`;
  return `${value.slice(0, i + key.length)}${tag}${value.slice(i + key.length)}`;
}

/** How a request body is encoded, judged from the body itself (the capture keeps no request headers). */
function kindOf(body: string | null): "json" | "form" | null {
  if (!body) return null;
  if (jsonObjectBody(body)) return "json";
  return /^[^=&\s]+=[^&\s]*(&[^=&\s]+=[^&\s]*)*$/.test(body) ? "form" : null;
}

const CONTENT_TYPE = { json: "application/json", form: "application/x-www-form-urlencoded" } as const;

/** A request this scenario sends as its identity: one the app itself sent for the test record, with a marker body. */
interface Write {
  method: string;
  url: string;
  /** The body sent (null for a DELETE). */
  body: string | null;
  kind: "json" | "form" | null;
  /** For an update: the record field set to `value`. */
  field?: string;
  value?: string;
  /** For a JSON update whose body holds the record one level down ({"task": {...}}): that key ("task"). */
  nest?: string;
  /** The app's own request this write was made from. */
  observed: CapturedRequest;
}

const endpoints = (ws: { method: string; url: string }[]) => ws.map((w) => endpointOf(w.method, w.url)).join(", ");

function decodeSegment(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

type RecordIdOf = { key: string; value: string | number };

/**
 * True when a query parameter named `name` carries a record id: the id's own key, or a name that ends in id (task_id,
 * taskId). A value under any other name (?count=3, ?page=3) is never taken for the record's id.
 */
const isIdParam = (name: string, key: string) => name === key || /(^|[_-])id$/i.test(name) || /[a-z]Id$/.test(name);

/**
 * True when the record's id is what `url` addresses: its last path segment, or a query value under a parameter that
 * names an id (isIdParam). Not a sub-resource.
 */
function addressesRecord(url: string, id: RecordIdOf): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url, "http://x");
  } catch {
    return false;
  }
  const want = String(id.value);
  const segments = parsed.pathname.split("/").filter(Boolean);
  const last = segments[segments.length - 1];
  if (last !== undefined && decodeSegment(last) === want) return true;
  return [...parsed.searchParams].some(([name, value]) => value === want && isIdParam(name, id.key));
}

/**
 * The collection `url` belongs to: its origin and path with the record's id cut out (aroundId's prefix), else its
 * origin and path with one trailing "/" (a list or a create: "/api/tasks" and "/api/tasks/" are the same). Null when
 * `url` doesn't parse.
 */
function collectionOf(url: string, id: RecordIdOf): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const around = aroundId(parsed, id);
  return `${parsed.origin}${around ? around.prefix : `${parsed.pathname.replace(/\/+$/, "")}/`}`;
}

/**
 * The collection a list read at `url` is: its origin and path with one trailing "/", its query left out and nothing cut
 * out. A list read's URL may name another record by the test record's id (GET /api/tasks?listId=3, GET /api/lists/3),
 * so no id is cut from it as if it were the record's own. Null when `url` doesn't parse.
 */
function pathCollectionOf(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}/`;
}

/** True when `value` is the record's id: the same value, or the same number or text in the other form (a form body's "3"). */
const isIdValue = (value: unknown, id: RecordIdOf) =>
  sameValue(value, id.value) || ((typeof value === "string" || typeof value === "number") && String(value) === String(id.value));

/**
 * True when the JSON (or, for a request body, form-encoded) text `text` is the test record itself, or holds it one
 * level down ({"task": {...}}; never inside an array, and never under a parent with an id of its own): an object with
 * one of the record's run-token fields (`key` is the run token) under the same key and with the same value as in the
 * snapshot, and the record's id under its key, which an answer must have (`needsId`) and a body may leave out. Another
 * record that only mentions a test value (a note's "Latest task: …", a list's items, a "latest" field) or merely
 * shares the id never counts.
 */
function isTheRecord(text: string | null, snap: RecordSnapshot, id: RecordIdOf, key: string, needsId: boolean): boolean {
  const kind = kindOf(text);
  const top = kind === "form" ? Object.fromEntries(new URLSearchParams(text!)) : kind === "json" ? jsonObjectBody(text) : null;
  if (!top) return false;
  const tokenFields = Object.keys(snap.record).filter((k) => typeof snap.record[k] === "string" && (snap.record[k] as string).toLowerCase().includes(key));
  const inner = recordId(top) === null ? Object.values(top).filter((v): v is JsonObject => !!v && typeof v === "object" && !Array.isArray(v)) : [];
  return [top, ...inner].some(
    (o) =>
      (Object.prototype.hasOwnProperty.call(o, id.key) ? isIdValue(o[id.key], id) : !needsId) && tokenFields.some((k) => sameValue(o[k], snap.record[k])),
  );
}

/**
 * True when `json` (a read's answer, parsed) is the test record in full: an object with the record's id under its key,
 * every field the snapshot has, and each of its run-token fields with the snapshot's value. At the top, or one level
 * down ({"task": {...}}) when the top has no id and that is the only object under it with an id of its own; never
 * inside an array. Another of Account A's records that shares the id and was given a test value (a note's {id: 3,
 * title}) lacks the record's other fields, and an answer that holds the record beside another one ({note: {id: 3},
 * latest: {id: 3, title, done}}) is not the record's.
 */
function holdsWholeRecord(json: unknown, snap: RecordSnapshot, id: RecordIdOf, key: string): boolean {
  const isObj = (v: unknown): v is JsonObject => !!v && typeof v === "object" && !Array.isArray(v);
  if (!isObj(json)) return false;
  const tokenFields = Object.keys(snap.record).filter((k) => typeof snap.record[k] === "string" && (snap.record[k] as string).toLowerCase().includes(key));
  if (tokenFields.length === 0) return false;
  const withIds = recordId(json) === null ? Object.values(json).filter(isObj).filter((o) => recordId(o) !== null) : [];
  const inner = withIds.length === 1 ? withIds : [];
  const has = (o: JsonObject, k: string) => Object.prototype.hasOwnProperty.call(o, k);
  return [json, ...inner].some(
    (o) => has(o, id.key) && isIdValue(o[id.key], id) && Object.keys(snap.record).every((k) => has(o, k)) && tokenFields.every((k) => sameValue(o[k], snap.record[k])),
  );
}

/**
 * True when `url` names the record's id itself: as its last path segment, or in its query under the record's own id
 * key (?id=3). Not only under another name (?listId=3, ?projectId=3), which may be a different record's id.
 */
function namesOwnId(url: string, id: RecordIdOf): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url, "http://x");
  } catch {
    return false;
  }
  const want = String(id.value);
  const segments = parsed.pathname.split("/").filter(Boolean);
  const last = segments[segments.length - 1];
  return (last !== undefined && decodeSegment(last) === want) || parsed.searchParams.getAll(id.key).includes(want);
}

/** A key that holds a password or an email address: a body that has one is never sent, as anyone. */
const SENSITIVE_KEY = /pass(word|code|phrase)|e-?mail/i;

/** True when a JSON or form-encoded body has a password or email key, at any depth. */
function sensitiveBody(body: string | null): boolean {
  const kind = kindOf(body);
  if (kind === "form") return [...new URLSearchParams(body!).keys()].some((k) => SENSITIVE_KEY.test(k));
  if (kind !== "json") return false;
  const walk = (n: unknown, depth: number): boolean => {
    if (depth > 12 || !n || typeof n !== "object") return false;
    if (Array.isArray(n)) return n.some((item) => walk(item, depth + 1));
    return Object.entries(n as JsonObject).some(([k, v]) => SENSITIVE_KEY.test(k) || walk(v, depth + 1));
  };
  return walk(parseJson(body!), 0);
}

/**
 * The update this scenario sends for an observed one: the app's own body with one run-token field of the record set to
 * a new marker, where the app's body holds the record: at the top, or one level down ({"task": {...}}) when the top has
 * no run-token field and one object under it does (as isTheRecord reads it; never inside an array). A server that
 * reads the record from body.task would ignore a marker set beside it and read as a pass. Null when the body is neither
 * JSON nor form-encoded, has a password or email key, or the record has no run-token text field. `observed` is always
 * a write for the test record (the `own` writes in run): in the test record's own collection, or at a URL naming its id
 * whose body or answer is the record itself (isTheRecord) and that reads, as Account A, as the whole record
 * (holdsWholeRecord). So the fallback to a run-token field the app's body doesn't send only ever goes to the test
 * record's own URL, never to another record that shares the id and merely mentions, or copies in, a test value.
 */
function updateFrom(observed: CapturedRequest, snap: RecordSnapshot, key: string, tag: string): Write | null {
  const kind = kindOf(observed.postData);
  if (!kind || sensitiveBody(observed.postData)) return null;
  const record = snap.record;
  const sent = kind === "json" ? jsonObjectBody(observed.postData)! : Object.fromEntries(new URLSearchParams(observed.postData ?? ""));
  const carriesToken = (k: string) => typeof record[k] === "string" && (record[k] as string).toLowerCase().includes(key);
  const isObject = (v: unknown): v is JsonObject => !!v && typeof v === "object" && !Array.isArray(v);
  // Where the app's own JSON body holds the record: at the top, or one level down when the top has no run-token field.
  const nest =
    kind === "json" && !Object.keys(sent).some(carriesToken)
      ? Object.keys(sent).find((k) => {
          const v = sent[k];
          return isObject(v) && Object.keys(v).some(carriesToken);
        })
      : undefined;
  const holder: JsonObject = nest ? (sent[nest] as JsonObject) : sent;
  // A field the app's own update sends and the record holds, else any run-token field of the record.
  const field = Object.keys(holder).find(carriesToken) ?? Object.keys(record).find(carriesToken);
  if (!field || SENSITIVE_KEY.test(field)) return null;
  const value = markValue(record[field] as string, key, tag);
  let body: string;
  if (kind === "json") {
    body = JSON.stringify(nest ? { ...sent, [nest]: { ...holder, [field]: value } } : { ...sent, [field]: value });
  } else {
    const params = new URLSearchParams(observed.postData ?? "");
    params.set(field, value);
    body = params.toString();
  }
  return { method: observed.method.toUpperCase(), url: observed.url, body, kind, field, value, ...(nest ? { nest } : {}), observed };
}

/** Sends `w` as `who`; its status, or null when no answer came. */
async function send(ctx: CheckContext, who: Identity, w: Write): Promise<number | null> {
  const answer = await ctx
    .request(who, { method: w.method, url: w.url, ...(w.body !== null && w.kind ? { headers: { "content-type": CONTENT_TYPE[w.kind] }, body: w.body } : {}) })
    .catch(() => null);
  return answer ? answer.status : null;
}

const sameValue = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/** What an attempt did to the test record, as a re-read as Account A shows it. */
interface Effect {
  /** The record is no longer there. */
  gone: boolean;
  /** The fields that changed (none when it is gone). */
  changed: string[];
}

/** The words of a field name, lowercased: "deletedAt" and "deleted_at" are both ["deleted", "at"]. */
function wordsOf(field: string): string[] {
  return field
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** A word that says the record was removed, whatever the field then holds (deletedAt, is_archived, trashed). */
const REMOVED_WORD = /^(deleted?|deletion|archived?|trash|trashed|removed|discarded|destroyed)$/;
/** A word that says the record is shown, counted only when the field holds true or false (isActive, visible). */
const SHOWN_WORD = /^(active|inactive|enabled|disabled|visible|hidden)$/;
/** A status or state value that says the record was removed. */
const REMOVED_VALUE = /\b(deleted|archived|trashed|removed|discarded|destroyed|inactive|hidden|disabled)\b/i;

/**
 * True when `field` now holding `after` says the record was removed: what a soft delete leaves. A field that changes
 * on its own (a "viewed 3 minutes ago", a counter, updatedAt) says nothing of the kind.
 */
function saysRemoved(field: string, after: unknown): boolean {
  const words = wordsOf(field);
  if (words.some((w) => REMOVED_WORD.test(w))) return true;
  if (typeof after === "boolean" && words.some((w) => SHOWN_WORD.test(w))) return true;
  return typeof after === "string" && words.some((w) => w === "status" || w === "state") && REMOVED_VALUE.test(after);
}

/**
 * What the re-read `now` shows `w` did, judged against `before` (the record re-read just before the attempt), or null
 * when it took no effect. Gone counts for any write. For an update, the field it set no longer holds its value (a
 * server that stores the value altered still changed it). For a DELETE that left the record there, a field other
 * than the `volatile` ones that changed and says the record was removed (a soft delete: deletedAt, archived).
 */
function effectOf(w: Write, before: JsonObject, now: JsonObject[] | "gone", volatile: ReadonlySet<string>): Effect | null {
  if (now === "gone") return { gone: true, changed: [] };
  const after = now[0]!;
  if (w.method === "DELETE") {
    const changed = changedFields(before, after).filter((k) => !volatile.has(k) && saysRemoved(k, after[k]));
    return changed.length > 0 ? { gone: false, changed } : null;
  }
  return sameValue(after[w.field!], before[w.field!]) ? null : { gone: false, changed: [w.field!] };
}

/**
 * Fields the app sets itself whenever the record is saved (updatedAt, modified_on, version, etag): the put-back is a
 * save too, so it changes them again and they can never read as they did before. putBack also takes every field
 * record-state's changesOnSave names (rowVersion, updateTime, lastUpdate, _ts, concurrencyStamp …), the rule
 * restoreRecord itself uses, so both classify a field the same way.
 */
const SERVER_MANAGED = /^(last_?)?(updated|modified|changed|edited)(_?(at|on|date|time))?$|^(version|lock_?version|etag|_?rev|__v)$/i;

/** How long Run Hound watches the record, sending nothing, to tell a field that changes on its own from one a write left. */
const WATCH_MS = 2_500;

/**
 * Of `fields`, those that change on their own: the record re-read as Account A WATCH_MS after `first` (a read of it,
 * made now when not given), with no write sent in between, holds other values for them. Also the later read. Null when
 * a read failed, or the record was gone at the first one.
 */
async function stillMoving(
  ctx: CheckContext,
  snap: RecordSnapshot,
  fields: string[],
  first?: JsonObject,
): Promise<{ moving: string[]; again: JsonObject[] | "gone" } | null> {
  let from = first;
  if (!from) {
    const read = await rereadRecord(ctx, snap);
    if (read === null || read === "gone") return null;
    from = read[0]!;
  }
  await delay(WATCH_MS);
  const again = await rereadRecord(ctx, snap);
  if (again === null) return null;
  if (again === "gone") return { moving: [], again };
  const moved = new Set(changedFields(from, again[0]!));
  return { moving: fields.filter((k) => moved.has(k)), again };
}

const joinFields = (fields: string[]) => (fields.length <= 1 ? fields.join("") : `${fields.slice(0, -1).join(", ")} and ${fields[fields.length - 1]}`);

/**
 * What a put-back did: its notes, whether something could not be undone (the scenario is then never a pass), whether
 * all of that is fields the app sets itself on every save (the record's own values are back), and whether a deleted
 * record was created again (it then has a new id, so no later write can address it).
 */
interface PutBack {
  notes: string[];
  failed: boolean;
  serverOnly: boolean;
  recreated: boolean;
  /** The fields left changed that couldn't be put back ("the record" when it is gone). */
  left: string[];
}

const PUT_BACK_NOTHING: PutBack = { notes: [], failed: false, serverOnly: false, recreated: false, left: [] };

/**
 * Puts the test record back from a re-read as Account A, judged against `before` (the read just before the attempt):
 * changed fields through the app's own update for it, a deleted record by sending the create again. Fields in
 * `volatile` change on their own, so they are neither restored nor named; a field still changed after the put-back
 * that keeps changing with nothing sent joins them, unless it is `pinned` (a run-token field or one a probe sets: those
 * are always restored and, when they can't be, named). The notes say what was restored and what could not be undone.
 */
async function putBack(
  ctx: CheckContext,
  snap: RecordSnapshot,
  before: JsonObject,
  update: CapturedRequest | undefined,
  save: CapturedRequest,
  volatile: Set<string>,
  pinned: ReadonlySet<string>,
): Promise<PutBack> {
  const now = await rereadRecord(ctx, snap);
  if (now === null) {
    return { ...PUT_BACK_NOTHING, notes: ["Run Hound couldn't read Account A's test record back to put it back: check Account A."], failed: true };
  }
  const differs = now === "gone" ? ["the record"] : changedFields(before, now[0]!).filter((k) => !volatile.has(k));
  if (differs.length === 0) return PUT_BACK_NOTHING;
  // An update of this record puts changed fields back; the create is only ever sent to make a deleted record again.
  const outcome =
    now === "gone" || update ? await restoreRecord(ctx, snap, { save: update ?? save, create: save }) : { restored: [], notRestored: differs };
  // Only what this attempt changed is named: a field that already differed from the snapshot before it isn't its doing.
  const ours = (k: string) => !volatile.has(k) && differs.includes(k);
  const restored = outcome.restored.filter(ours);
  let left = outcome.notRestored.filter(ours);
  const notes: string[] = [];
  if (now === "gone") {
    if (restored.length > 0) notes.push("Created Account A's test record again after it was deleted (it has a new id).");
    else notes.push("Could not be undone: Account A's test record was deleted and couldn't be created again: check Account A.");
    return { notes, failed: left.length > 0, serverOnly: false, recreated: restored.length > 0, left };
  }
  if (left.length > 0) {
    const watched = await stillMoving(ctx, snap, left);
    if (watched) {
      for (const k of watched.moving) if (!pinned.has(k)) volatile.add(k);
      left = left.filter((k) => !volatile.has(k));
    }
  }
  if (restored.length > 0) notes.push(`Restored ${restored.join(", ")} of Account A's test record.`);
  if (left.length === 0) return { ...PUT_BACK_NOTHING, notes };
  if (left.every((k) => SERVER_MANAGED.test(k) || changesOnSave(snap, k, ctx.runToken))) {
    notes.push(`Account A's test record is back to its values except ${joinFields(left)}, which the app sets itself.`);
    return { notes, failed: true, serverOnly: true, recreated: false, left };
  }
  notes.push(
    update
      ? `Could not be undone: ${left.join(", ")} of Account A's test record: check Account A.`
      : `Could not be undone: ${left.join(", ")} of Account A's test record changed, and the app sent no update for it that Run Hound could reuse: check Account A.`,
  );
  return { notes, failed: true, serverOnly: false, recreated: false, left };
}

export const check: Check = {
  id: ID,
  title: "Other accounts and visitors can't change your records",
  category: "security",
  scope: "form",
  interruptedNote: INTERRUPTED_NOTE,

  plan(form, _page, env?: PlanEnv): Scenario[] {
    if (!env?.signedIn || !savesOwnRecord(form)) return [];
    const scenario = (who: Who, description: string): Scenario => ({
      id: `${ID}:${WHO[who].slug}`,
      checkId: ID,
      title: `${WHO[who].subject} can't change Account A's records`,
      description,
      kind: "danger",
      priority: "high",
      destructive: false,
      defaultSelected: false,
    });
    return [
      ...(env.otherAccount
        ? [
            scenario(
              "other",
              "Save a test record as Account A, then send the app's own update for it (and its delete, if the app shows one) as Account B. Re-read as Account A: the record must be unchanged. Run Hound restores the record. Off by default: it changes Account A's data.",
            ),
          ]
        : []),
      scenario(
        "signed-out",
        "Save a test record as Account A, then send the app's own update for it (and its delete, if the app shows one) with no session. Re-read as Account A: the record must be unchanged. Run Hound restores the record. Off by default: it changes Account A's data.",
      ),
    ];
  },

  run(ctx, scenario) {
    // Decided as the runner decides whether Account B signs in (identityOf): on a page's later form ("@form-<n>") and
    // under a collided id ("#<n>") the other-account scenario still runs as Account B, never signed out.
    const identity = identityOf(scenario);
    return guarded(ID, scenario, ctx, async (started) => {
      const form = ctx.form;
      const skip = (notes: string) => errorResult(ID, scenario, started, notes, "skipped");
      if (!identity) return skip("Skipped: this scenario names neither Account B nor a signed-out visitor, so Run Hound doesn't know who to send its writes as.");
      const who: Who = identity;
      if (ctx.accounts && !ctx.accounts.self) return skip("Skipped: this run isn't signed in, so there is no Account A record to protect.");
      if (who === "other" && !ctx.accounts?.other) return skip("Skipped: this run has no Account B signed in, so nothing can be sent as another account.");
      if (form.fields.length === 0 || !submitControl(form)) return skip("Skipped: this form has no fields that save a record.");

      // 1. As Account A, save a new test record through the form (this scenario's own values). The form's writes are
      //    held and judged before they reach the app (holdExistingEdits): a save that would change a record Account A
      //    already had is stopped, and the scenario is skipped with nothing written.
      const { page, capture } = await ctx.openPage({ as: "self" });
      ctx.step("Saving a test record as Account A", page);
      const salt = SALT[who];
      const values: FieldValue[] = canaryValues(form, ctx.runToken, salt.create);
      await fillForm(page, values);
      const hold = await holdExistingEdits(ctx, page, capture);
      try {
        await submitForm(page, form);
        await waitForCreates(page, capture, ctx.targetUrl, undefined, ctx.runToken);
      } finally {
        await hold.release();
      }
      const stopped = hold.verdict();
      if (stopped) return skip(stopped);
      const creates = createRequests(capture, ctx.targetUrl, ctx.runToken).filter(
        (r) => (isSameOrigin(r.url, ctx.targetUrl) || isLocalOrigin(r.url, ctx.targetUrl)) && !stoppedByHold(hold, r),
      );
      const save = creates.find((r) => r.postData && r.method.toUpperCase() === "POST") ?? creates.find((r) => r.postData);
      if (!save) return skip("Skipped: submitting the form sent no save request, so there is no test record to protect.");
      if (neverWritten(save.url)) {
        return skip(`Skipped: this form saves to ${endpointOf(save.method, save.url)}, an endpoint Run Hound never writes to (sign-out, password, email, payment, invitations or sharing).`);
      }
      // What the page read before the save (with its reads of an API on another local origin, made again as Account A
      // while the save was held): a record id it held then belongs to one of Account A's own records.
      const heldBefore = hold.before();
      const before = heldBefore.length > 0 ? heldBefore : getsBefore(capture, save);
      const saveAt = capture.requests.indexOf(save);

      // 2. The record endpoint and a snapshot of the new test record, read as Account A.
      ctx.step("Reloading to read the saved record", page);
      await page.reload({ waitUntil: "load" }).catch(() => undefined);
      await settle(page);
      const testValues = values.filter((v) => v.canary && v.value).map((v) => v.value);
      const recordGet = await findOwnRecord(ctx, capture, testValues, { arrays: true });
      const snap = recordGet ? await snapshotRecord(ctx, recordGet.url, testValues) : null;
      if (!recordGet || !snap) {
        return skip("Skipped: Run Hound couldn't read the saved record back as Account A, so it couldn't tell whether a write as someone else changed it.");
      }
      // The save went through and turned out to change a record Account A already had (its id was in an answer from
      // before the save, its URL or body named the id, or the record is a single one read at a URL without its id):
      // put it back as the page read it before the save, and say what the save changed.
      if (editsExistingRecord(save, snap, recordGet, before, ctx.runToken)) {
        ctx.step("Putting back the record the form changed", page);
        return skip([EXISTING_RECORD, ...(await putBackEdited(ctx, { capture, save, snap, before }))].join(" "));
      }
      const firstJson = parseJson(recordGet.body);
      const firstSnap = snapshotFrom(recordGet.url, firstJson, testValues, ctx.runToken);
      const listed = firstSnap ? readsList(firstJson, firstSnap.record) : false;
      const id = snap.id;
      if (!id) return skip("Skipped: the test record has no id, so Run Hound can't tell which of the app's writes are for it.");

      // 3. The writes to send: only those the app itself sent for the test record's own URL; the DELETE last. The id
      //    didn't exist before the save, so only what the app sent after it counts; and a write must belong to the
      //    test record: to its collection (the save's, or the record read's), or, at a URL that names the id itself,
      //    with the record itself in its body or answer (isTheRecord: the same run-token field and value, never an
      //    object that only mentions a test value) and a URL that reads as the whole record (holdsWholeRecord, below).
      //    Another of Account A's records that shares the id (numeric ids, another table), even one the page copied the
      //    new title into verbatim, or a create into one named by a foreign key (?listId=3), is never taken for it.
      const key = tokenKey(ctx.runToken);
      const afterSave: Capture = { ...capture, requests: saveAt < 0 ? [] : capture.requests.slice(saveAt + 1) };
      // The save's URL never names the id (a save that does is skipped above), so nothing is cut from it. The read's
      // collection has the id cut out only when the read is the record at its own URL (GET /api/tasks/3, ?id=3). A
      // list read's URL may name another of Account A's records by the same id (GET /api/tasks?listId=3,
      // GET /api/lists/3): only its path counts, with nothing cut out, so that record's writes stay outside it.
      const readCollection = !listed && namesOwnId(recordGet.url, id) ? collectionOf(recordGet.url, id) : pathCollectionOf(recordGet.url);
      const collections = new Set([collectionOf(save.url, id), readCollection].filter((c): c is string => c !== null));
      const inCollection = (r: CapturedRequest) => collections.has(collectionOf(r.url, id) ?? "");
      const forRecord = (r: CapturedRequest) =>
        inCollection(r) || (namesOwnId(r.url, id) && (isTheRecord(r.postData, snap, id, key, false) || isTheRecord(r.responseBody, snap, id, key, true)));
      const candidates = recordWrites(afterSave, snap, ctx.targetUrl).filter((r) => addressesRecord(r.url, id) && forRecord(r));
      // Outside the record's collections, a write is the record's only when its URL reads, as Account A, as the record
      // itself in full (holdsWholeRecord): its id and every field the snapshot has, with the same run-token values. A
      // write to another of Account A's records that shares the id (a note the page copied the new title into, verbatim,
      // under the same key) reads as that record, not this one. The write's own answer is never enough on its own: an
      // answer may hold the new record beside, or instead of, the one written. Each URL is read once, a GET as Account A
      // (recordWrites has already left out every URL that acts when loaded).
      const readsAsRecord = new Map<string, boolean>();
      const own: CapturedRequest[] = [];
      for (const r of candidates) {
        if (inCollection(r)) {
          own.push(r);
          continue;
        }
        if (!readsAsRecord.has(r.url)) {
          const read = await ctx.request("self", { method: "GET", url: r.url }).catch(() => null);
          readsAsRecord.set(r.url, !!read && read.status >= 200 && read.status < 300 && holdsWholeRecord(parseJson(read.body), snap, id, key));
        }
        if (readsAsRecord.get(r.url)) own.push(r);
      }
      const observedUpdates = own.filter((r) => r.method.toUpperCase() !== "DELETE");
      const observedDelete = own.find((r) => r.method.toUpperCase() === "DELETE");
      if (observedUpdates.length === 0 && !observedDelete) {
        return skip(`Skipped: the app showed no update or delete for its test record, so there is nothing to try as ${WHO[who].words}.`);
      }
      const updates = observedUpdates
        .map((r, i) => updateFrom(r, snap, key, `${salt.mark}${i === 0 ? "" : i + 1}`))
        .filter((w): w is Write => w !== null);
      const unusable = observedUpdates.filter((r) => !updates.some((w) => w.observed === r));
      // Why an update isn't sent: a body with a password or email key never is, whatever else it holds.
      const sensitive = unusable.filter((r) => sensitiveBody(r.postData));
      const noField = unusable.filter((r) => !sensitive.includes(r));
      const why = (rs: CapturedRequest[], reason: string) => `${endpoints(rs)} (${rs.length === 1 ? "its body has" : "their bodies have"} ${reason})`;
      const reasons = [
        ...(noField.length > 0 ? [why(noField, "no field Run Hound can set to a test value")] : []),
        ...(sensitive.length > 0 ? [why(sensitive, "a password or email field, which Run Hound never sends")] : []),
      ];
      const writes: Write[] = [...updates, ...(observedDelete ? [{ method: "DELETE", url: observedDelete.url, body: null, kind: null, observed: observedDelete }] : [])];
      if (writes.length === 0) {
        if (sensitive.length === 0) {
          const one = unusable.length === 1;
          return skip(
            `Skipped: the app's ${one ? "update" : "updates"} for its test record (${endpoints(unusable)}) ${one ? "has" : "have"} no field Run Hound can set to a test value, so there is nothing to try as ${WHO[who].words}.`,
          );
        }
        return skip(`Skipped: none of the app's updates for its test record can be sent, so there is nothing to try as ${WHO[who].words}. Not tried: ${reasons.join("; ")}.`);
      }
      const unusableNote = reasons.length > 0 ? `Not tried: ${reasons.join("; ")}.` : "";
      // The app's own update with a body, for putting changed fields back (never one with a password or email key).
      const restoreWith = observedUpdates.find((r) => kindOf(r.postData) !== null && !sensitiveBody(r.postData));

      const notes: string[] = [];
      /** Adds a put-back's notes, each once: the same leftover after two attempts is said once. */
      const noteOnce = (more: string[]) => {
        for (const n of more) if (!notes.includes(n)) notes.push(n);
      };
      const findings: Finding[] = [];
      const tried: string[] = [];
      /**
       * Fields that change on their own: those that differ between the snapshot and a re-read before any attempt, and
       * any found still changing later while nothing was sent.
       */
      const volatile = new Set<string>();
      /**
       * Fields never taken for ones that change on their own: the record's run-token fields and those a probe sets.
       * They are always put back, and named when they can't be.
       */
      const pinned = new Set<string>([
        ...Object.keys(snap.record).filter((k) => typeof snap.record[k] === "string" && (snap.record[k] as string).toLowerCase().includes(key)),
        ...writes.flatMap((w) => (w.field ? [w.field] : [])),
      ]);
      const markVolatile = (fields: Iterable<string>) => {
        for (const k of fields) if (!pinned.has(k)) volatile.add(k);
      };
      /**
       * Other fields of the record an attempt changed while the value it set (or, for a DELETE, the record) stayed: the
       * put-back undoes them, but the scenario is then inconclusive, never a pass.
       */
      const sideChanges: string[] = [];
      /** What was left that couldn't be put back: only fields the app sets itself on every save, or record values too. */
      let leftover: "none" | "server" | "values" = "none";
      /** The server-managed fields a put-back left, for the summary. */
      const serverLeft = new Set<string>();
      /** Set when writes were left untried because Account A's test record couldn't be read before them. */
      let unread = "";
      let sentAny = false;
      /** The read just before the attempt under way: what a put-back is judged against. */
      let lastPre: JsonObject = snap.record;
      try {
        for (const [i, w] of writes.entries()) {
          const rest = writes.slice(i + 1);
          // Each attempt is judged against the record as it is just before it, read as Account A.
          const pre = await rereadRecord(ctx, snap);
          if (pre === null || pre === "gone") {
            if (i === 0) {
              return skip("Skipped: Run Hound couldn't read the saved record back as Account A, so it couldn't tell whether a write as someone else changed it.");
            }
            unread = `Inconclusive: Run Hound couldn't read Account A's test record before sending ${endpoints([w, ...rest])} as ${WHO[who].words}, so it didn't send ${rest.length === 0 ? "it" : "them"}: check Account A.`;
            break;
          }
          if (i === 0) markVolatile(changedFields(snap.record, pre[0]!));
          lastPre = pre[0]!;

          ctx.step(`Sending ${endpointOf(w.method, w.url)} as ${WHO[who].words}`, page);
          sentAny = true;
          const status = await send(ctx, who, w);
          tried.push(`${endpointOf(w.method, w.url)} (${status ?? "no answer"})`);
          const now = await rereadRecord(ctx, snap);
          if (now === null) {
            const back = await putBack(ctx, snap, lastPre, restoreWith, save, volatile, pinned);
            noteOnce(back.notes);
            const unknown = `Inconclusive: the re-read as Account A failed after ${endpointOf(w.method, w.url)} was sent as ${WHO[who].words}, so Run Hound can't tell whether it worked: check Account A.`;
            // An earlier attempt's confirmed finding stands.
            if (findings.length > 0) return result(ID, scenario, started, findings, [changedSummary(who, findings), unknown, ...sideChanges, ...notes].join(" "));
            return skip([unknown, ...sideChanges, ...notes].join(" "));
          }
          let effect = effectOf(w, lastPre, now, volatile);
          if (w.method === "DELETE" && effect && !effect.gone && now !== "gone") {
            // A DELETE that left the record there, changed (a soft delete): confirm the change holds while nothing is
            // sent, so a field that changes on its own now and then is never taken for one.
            const watched = await stillMoving(ctx, snap, effect.changed, now[0]!);
            if (watched?.again === "gone") effect = { gone: true, changed: [] };
            else if (watched) {
              markVolatile(watched.moving);
              const changed = effect.changed.filter((k) => !volatile.has(k));
              effect = changed.length > 0 ? { gone: false, changed } : null;
            }
          }
          if (!effect && now !== "gone") {
            // The value the attempt set didn't change (nor did a DELETE remove the record), but did anything else of
            // the record? A refused write that still stamps it (flagged, a soft delete the words above don't know) is
            // no pass. Watched while nothing is sent first, so a field that changes on its own is left out.
            const side = changedFields(lastPre, now[0]!).filter((k) => !volatile.has(k) && k !== w.field);
            if (side.length > 0) {
              const watched = await stillMoving(ctx, snap, side, now[0]!);
              if (watched?.again === "gone") effect = { gone: true, changed: [] };
              else {
                if (watched) markVolatile(watched.moving);
                const stays = side.filter((k) => !volatile.has(k));
                if (stays.length > 0) {
                  sideChanges.push(
                    `${joinFields(stays)} of Account A's test record changed after ${WHO[who].words} sent ${endpointOf(w.method, w.url)}, though ${
                      w.method === "DELETE" ? "the record is still there" : "the value Run Hound set didn't"
                    }.`,
                  );
                }
              }
            }
          }
          // Put the record back first, then write the finding up (rendering its evidence takes a while).
          const back = await putBack(ctx, snap, lastPre, restoreWith, save, volatile, pinned);
          noteOnce(back.notes);
          if (effect) findings.push(await finding(ctx, scenario, who, w, status, findings.length + 1, effect, snap.url, id));
          if (back.failed) {
            if (back.serverOnly) {
              // The record's own values are back; only fields the app sets on every save differ, so the next write
              // is still judged against a record in a known state. The scenario can't pass, but goes on.
              if (leftover === "none") leftover = "server";
              for (const k of back.left) serverLeft.add(k);
            } else {
              leftover = "values";
              if (rest.length > 0) notes.push(`Not tried after a change that couldn't be undone: ${endpoints(rest)}.`);
              break;
            }
          }
          if (back.recreated) {
            // The record made again has a new id, and the app's remaining writes name the old one.
            if (rest.length > 0) notes.push(`Not tried after Account A's test record was deleted and created again with a new id: ${endpoints(rest)}.`);
            break;
          }
        }
      } catch (error) {
        // A write may already have been sent: put the test record back first, then say what may be left.
        const message = error instanceof Error ? error.message : String(error);
        const back = sentAny
          ? await putBack(ctx, snap, lastPre, restoreWith, save, volatile, pinned).catch(() => PUT_BACK_NOTHING)
          : PUT_BACK_NOTHING;
        noteOnce(back.notes);
        throw new Error([message.replace(/\.?$/, "."), ...sideChanges, ...notes, INTERRUPTED_NOTE].join(" "));
      }
      if (unusableNote) notes.push(unusableNote);

      if (findings.length > 0) {
        return result(ID, scenario, started, findings, [changedSummary(who, findings), ...sideChanges, ...(unread ? [unread] : []), ...notes].join(" "));
      }
      if (leftover === "values") {
        return skip(
          [
            `Inconclusive: Account A's test record differs from how it was before the test and Run Hound couldn't put all of it back, so it can't call this a pass: check Account A.`,
            ...sideChanges,
            ...notes,
          ].join(" "),
        );
      }
      if (sideChanges.length > 0) {
        // The value a write set held, but the write changed something else of the record: not a confirmed finding (a
        // clean app may stamp a refused attempt, an audit field), and never a pass.
        return skip(
          [
            `Inconclusive: Account A's test record changed while Run Hound sent ${tried.join(", ")} as ${WHO[who].words}, so it can't call this a pass: check Account A.`,
            ...sideChanges,
            ...(unread ? [unread] : []),
            ...notes,
          ].join(" "),
        );
      }
      if (leftover === "server") {
        // No write changed a value the test watches, but the record was saved while they were sent: never a pass.
        return skip(
          [
            `Inconclusive: ${joinFields([...serverLeft])} of Account A's test record, which the app sets itself when the record is saved, changed while Run Hound sent ${tried.join(", ")} as ${WHO[who].words}, so it can't call this a pass: check Account A.`,
            ...(unread ? [unread] : []),
            ...notes,
          ].join(" "),
        );
      }
      if (unread) return skip([unread, ...(tried.length > 0 ? [`Sent as ${WHO[who].words}: ${tried.join(", ")}.`] : []), ...notes].join(" "));
      const summary = `Account A's test record was unchanged after ${WHO[who].words} sent ${tried.join(", ")}.`;
      return result(ID, scenario, started, [], [summary, ...notes].join(" "));
    });
  },
};

/** The notes' first sentence when `who` got writes through: the requests that did. */
function changedSummary(who: Who, findings: Finding[]): string {
  return `${WHO[who].subject.replace("visitors", "visitor")} changed Account A's test record: ${findings.map((f) => f.location).join(", ")}.`;
}

/** The finding for a write `who` got through on Account A's test record (read at `readUrl`, its id `id`). */
async function finding(
  ctx: CheckContext,
  scenario: Scenario,
  who: Who,
  w: Write,
  status: number | null,
  n: number,
  effect: Effect,
  readUrl: string,
  id: { key: string; value: string | number },
): Promise<Finding> {
  const endpoint = endpointOf(w.method, w.url);
  const isDelete = w.method === "DELETE";
  const verb = isDelete || effect.gone ? "delete" : "change";
  const changed = effect.changed.join(", ");
  const title = `${WHO[who].subject} can ${verb} Account A's records`;
  const evidence: Evidence[] = await tryCard(ctx, `${endpoint} as ${WHO[who].words}`, {
    title: `${endpoint} sent as ${WHO[who].words}`,
    subtitle: effect.gone ? "Re-read as Account A: the record is gone." : `Re-read as Account A: ${changed} changed.`,
    lines: [
      { text: `Sent as: ${WHO[who].words}`, mark: true },
      { text: `Answer: ${status ?? "none"}` },
      { text: effect.gone ? "Account A's test record was deleted." : `Account A's test record changed after the request (${changed}).`, mark: true },
    ],
    facts: [
      { label: "Request", value: endpoint },
      { label: "Sent as", value: WHO[who].words },
      { label: "Status", value: status === null ? "none" : String(status) },
      ...(effect.gone ? [] : [{ label: effect.changed.length === 1 ? "Field changed" : "Fields changed", value: changed }]),
    ],
  });
  // An update's spec watches the field it sets; a DELETE that left the record there, changed (the app's soft delete),
  // the fields it changed. Every spec also checks that the record is still there.
  const watch = !isDelete ? [w.field!] : effect.gone ? [] : effect.changed;
  return {
    checkId: ID,
    id: `${ID}#${scenario.id}-${n}`,
    title,
    severity: "critical",
    category: "security",
    confidence: "confirmed",
    meaning: `Run Hound saved a test record as Account A, then sent ${endpoint} as ${WHO[who].words}. Re-reading the record as Account A showed it ${
      effect.gone ? "was deleted" : `had changed (${changed})`
    }. The server doesn't check that the record belongs to whoever sends the ${verb === "delete" ? "delete" : "update"}.`,
    impact:
      who === "other"
        ? `Any signed-in user can ${verb} other users' records by sending their ids (insecure direct object reference).`
        : `Anyone, without signing in, can ${verb} users' records by sending their ids.`,
    fix: `Ask your AI or developer: "${endpoint} must only let the signed-in owner of the record ${verb} it: require a session, look the record up by id AND the session user's id, and answer 404 (or 403) otherwise. The same for every update and delete route."`,
    location: endpoint,
    evidence,
    spec: {
      filename: `${ID}-${WHO[who].slug}-${n}.spec.ts`,
      source: redactSecrets(replaySpec({ target: ctx.targetUrl, write: w, who, verb, readUrl, id, watch })),
    },
  };
}

/**
 * `url`'s path around the record's id, so a spec can aim it at another record: the part before the id and the part
 * after it. Null when the id is neither the last path segment nor a query value under a parameter that names an id
 * (isIdParam). In the query form only the parameter naming the id is kept.
 */
function aroundId(url: URL, id: RecordIdOf): { prefix: string; suffix: string } | null {
  const want = String(id.value);
  const segments = url.pathname.split("/");
  let i = segments.length - 1;
  while (i >= 0 && segments[i] === "") i -= 1;
  if (i >= 0 && decodeSegment(segments[i]!) === want) {
    return { prefix: `${segments.slice(0, i).join("/")}/`, suffix: i + 1 < segments.length ? `/${segments.slice(i + 1).join("/")}` : "" };
  }
  for (const [name, value] of url.searchParams) {
    if (value === want && isIdParam(name, id.key)) return { prefix: `${url.pathname}?${encodeURIComponent(name)}=`, suffix: "" };
  }
  return null;
}

interface SpecInput {
  target: string;
  write: Write;
  who: Who;
  verb: "change" | "delete";
  /** The record endpoint: a GET as Account A that holds the record. */
  readUrl: string;
  id: { key: string; value: string | number };
  /** The record's fields that must read the same after the write (for any write, the record must still be there). */
  watch: string[];
}

/**
 * A standalone spec: signs in as Account A (and B) from environment variables, reads a record Account A owns, sends the
 * same request as the other identity, and re-reads it as Account A: the record must still be there with the watched
 * fields unchanged. The status code is only reported, never the verdict. It creates nothing itself; no value Run Hound
 * typed and no credential is in it.
 */
function replaySpec(o: SpecInput): string {
  const q = (v: unknown) => JSON.stringify(v);
  const w = o.write;
  const isDelete = w.method === "DELETE";
  const urlExpr = (url: string) => {
    const parsed = new URL(url, o.target);
    const around = aroundId(parsed, o.id);
    return around
      ? `${q(around.prefix)} + encodeURIComponent(RECORD_ID)${around.suffix ? ` + ${q(around.suffix)}` : ""}`
      : q(`${parsed.pathname}${parsed.search}`);
  };
  // The value goes where the app's own update holds the record: one level down ({"task": {...}}) when it nests it.
  const value = `{ [FIELD]: "runhound-" + Date.now() }`;
  const payload = isDelete ? "" : `, ${w.kind === "form" ? "form" : "data"}: ${w.nest ? `{ ${q(w.nest)}: ${value} }` : value}`;
  const identity = o.who === "other" ? "Account B" : "a visitor with no session";
  return [
    `import { test, expect, request, type APIRequestContext } from "@playwright/test";`,
    ``,
    `// Exported by Run Hound. Set the accounts' environment variables before running:`,
    `//   RUNHOUND_ACCOUNT_A_LOGIN_URL, RUNHOUND_ACCOUNT_A_USERNAME, RUNHOUND_ACCOUNT_A_PASSWORD${o.who === "other" ? ", and the same with _B_" : ""}.`,
    `// Create a test record as Account A first and set RECORD_ID to its id: this test sends the request below for it as`,
    `// ${identity}, which ${isDelete ? "deletes" : "changes"} it when the app is vulnerable. The verdict comes from re-reading the record as`,
    `// Account A, not from the answer's status (a server can answer 403 and still apply the write, or 200 and ignore it).`,
    `const TARGET = ${q(o.target)};`,
    `// No default: an app that reuses ids could have given Run Hound's test record id to one of Account A's real records.`,
    `const RECORD_ID = process.env.RECORD_ID ?? "";`,
    `const ID_KEY = ${q(o.id.key)};`,
    `const RECORD_URL = process.env.RECORD_URL ?? ${urlExpr(w.url)}; // the request Run Hound sent`,
    `const RECORD_READ = process.env.RECORD_READ ?? ${urlExpr(o.readUrl)}; // reads the record as Account A`,
    `const METHOD = ${q(w.method)};`,
    ...(isDelete ? [] : [`const FIELD = ${q(w.field ?? "title")};`]),
    `const WATCH = ${q(o.watch)} as string[]; // fields that must read the same after the request`,
    ``,
    `// Your app's sign-in request (a path on the login page's origin). Run Hound signed in through the login page, so it`,
    `// doesn't know this request: set it, and the body sessionFor sends, before running the test.`,
    `const SIGN_IN_ENDPOINT = "/YOUR-SIGN-IN-ENDPOINT";`,
    ``,
    `// Sign in through the app's own login and return the session as storage state (cookies + localStorage).`,
    `async function sessionFor(slot: "A" | "B") {`,
    `  if (SIGN_IN_ENDPOINT.startsWith("/YOUR-")) throw new Error("Replace SIGN_IN_ENDPOINT and sessionFor with your app's sign-in before running this test.");`,
    `  const loginUrl = process.env["RUNHOUND_ACCOUNT_" + slot + "_LOGIN_URL"]!;`,
    `  const username = process.env["RUNHOUND_ACCOUNT_" + slot + "_USERNAME"]!;`,
    `  const password = process.env["RUNHOUND_ACCOUNT_" + slot + "_PASSWORD"]!;`,
    `  const ctx = await request.newContext();`,
    `  // Your app's sign-in call: it must set the session cookie or return a token.`,
    `  await ctx.post(new URL(SIGN_IN_ENDPOINT, loginUrl).href, { data: { username, password } });`,
    `  const state = await ctx.storageState();`,
    `  await ctx.dispose();`,
    `  return state;`,
    `}`,
    ``,
    `// The object in \`node\` (the read's JSON) whose ID_KEY is RECORD_ID, or undefined when it isn't there.`,
    `function findRecord(node: unknown): Record<string, unknown> | undefined {`,
    `  if (Array.isArray(node)) {`,
    `    for (const item of node) {`,
    `      const found = findRecord(item);`,
    `      if (found) return found;`,
    `    }`,
    `    return undefined;`,
    `  }`,
    `  if (!node || typeof node !== "object") return undefined;`,
    `  const obj = node as Record<string, unknown>;`,
    `  if (obj[ID_KEY] !== undefined && String(obj[ID_KEY]) === RECORD_ID) return obj;`,
    `  for (const value of Object.values(obj)) {`,
    `    const found = findRecord(value);`,
    `    if (found) return found;`,
    `  }`,
    `  return undefined;`,
    `}`,
    ``,
    `// The record as Account A reads it, or undefined when it is gone.`,
    `async function readAsA(a: APIRequestContext) {`,
    `  const res = await a.get(new URL(RECORD_READ, TARGET).href);`,
    `  if (res.status() === 404 || res.status() === 410) return undefined;`,
    `  expect(res.ok(), "Account A can read its record").toBe(true);`,
    `  return findRecord(await res.json());`,
    `}`,
    ``,
    `test(${q(`${WHO[o.who].subject} can't ${o.verb} Account A's records`)}, async () => {`,
    `  if (!RECORD_ID) throw new Error(${q(`Set RECORD_ID to the id of a test record you created as Account A (Run Hound's was ${String(o.id.value)}).`)});`,
    `  const a = await request.newContext({ storageState: await sessionFor("A") });`,
    o.who === "other"
      ? `  const other = await request.newContext({ storageState: await sessionFor("B") });`
      : `  const other = await request.newContext(); // no session`,
    `  try {`,
    `    const before = await readAsA(a);`,
    `    expect(before, "Account A's record " + RECORD_ID + " is there before the test").toBeDefined();`,
    `    const res = await other.fetch(new URL(RECORD_URL, TARGET).href, { method: METHOD${payload} });`,
    `    test.info().annotations.push({ type: "answer", description: METHOD + " " + RECORD_URL + " answered " + res.status() });`,
    `    const after = await readAsA(a);`,
    `    expect(after, "the record is gone after a " + METHOD + " from someone who doesn't own it").toBeDefined();`,
    `    for (const key of WATCH) {`,
    `      expect(after?.[key], key + " changed after a " + METHOD + " from someone who doesn't own it").toEqual(before?.[key]);`,
    `    }`,
    `  } finally {`,
    `    await other.dispose();`,
    `    await a.dispose();`,
    `  }`,
    `});`,
    ``,
  ].join("\n");
}
