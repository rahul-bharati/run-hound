/**
 * Request-body helpers for write-access: how a body is encoded (kindOf), how a form-encoded body reads as an
 * object (formObject), whether a body is the test record itself (isTheRecord) and whether a JSON read is the test
 * record in full (wholeRecordDiff), and whether a body holds a password or email key (sensitiveBody). The
 * sensitive-key regex and the server-managed-field pattern live in `constants/write-access-constants.ts`; the
 * id-value predicate and the same-value helper live in `./id-pattern.ts`. The other focused modules (identity,
 * record matching, write build, CSRF tokens, credentials, version stamps, restoration) live alongside this one.
 */
import { SENSITIVE_KEY, SERVER_MANAGED } from "../../constants/write-access-constants.js";
import { jsonObjectBody, parseJson, NESTED_FORM_KEY, recordId, changesOnSave } from "../../checks/lib/record-state.js";
import type { JsonObject, RecordSnapshot } from "../../checks/lib/record-state.js";
import type { RecordIdOf } from "../../interfaces/write-access.js";
import { isIdValue, sameValue } from "./id-pattern.js";

/** How a request body is encoded, judged from the body itself (the capture keeps no request headers). */
export function kindOf(body: string | null): "json" | "form" | null {
  if (!body) return null;
  if (jsonObjectBody(body)) return "json";
  return /^[^=&\s]+=[^&\s]*(&[^=&\s]+=[^&\s]*)*$/.test(body) ? "form" : null;
}

/**
 * A form-encoded body as an object: its flat keys, and each model's nested keys (Rails' task[title]=…) as an object
 * under the model's name ({task: {title}}), as a JSON body nests them.
 */
export function formObject(text: string): JsonObject {
  const out: JsonObject = {};
  for (const [k, v] of new URLSearchParams(text)) {
    const m = NESTED_FORM_KEY.exec(k);
    if (!m) {
      out[k] = v;
      continue;
    }
    const inner = out[m[1]!];
    if (inner && typeof inner === "object" && !Array.isArray(inner)) (inner as JsonObject)[m[2]!] = v;
    else if (inner === undefined) out[m[1]!] = { [m[2]!]: v };
  }
  return out;
}

/**
 * True when the JSON (or, for a request body, form-encoded) text `text` is the test record itself, or holds it one
 * level down ({"task": {...}}; never inside an array, and never under a parent with an id of its own): an object with
 * one of the record's run-token fields (`key` is the run token) under the same key and with the same value as in the
 * snapshot, and the record's id under its key, which an answer must have (`needsId`) and a body may leave out. Another
 * record that only mentions a test value (a note's "Latest task: …", a list's items, a "latest" field) or merely
 * shares the id never counts.
 */
export function isTheRecord(text: string | null, snap: RecordSnapshot, id: RecordIdOf, key: string, needsId: boolean): boolean {
  const kind = kindOf(text);
  const top = kind === "form" ? formObject(text!) : kind === "json" ? jsonObjectBody(text) : null;
  if (!top) return false;
  const tokenFields = Object.keys(snap.record).filter((k) => typeof snap.record[k] === "string" && (snap.record[k] as string).toLowerCase().includes(key));
  const inner = recordId(top) === null ? Object.values(top).filter((v): v is JsonObject => !!v && typeof v === "object" && !Array.isArray(v)) : [];
  return [top, ...inner].some(
    (o) =>
      (Object.prototype.hasOwnProperty.call(o, id.key) ? isIdValue(o[id.key], id) : !needsId) && tokenFields.some((k) => sameValue(o[k], snap.record[k])),
  );
}

/**
 * Whether `json` (a read's answer, parsed) is the test record in full, and if so, how it differs from the snapshot.
 * In full: an object with the record's id under its key, every field the snapshot has, and each of its run-token
 * fields with the snapshot's value. At the top, or one level down ({"task": {...}}) when the top has no id and that is
 * the only object under it with an id of its own; never inside an array. Another of Account A's records that shares the
 * id and was given a test value (a note's {id: 3, title}) lacks the record's other fields, and an answer that holds
 * the record beside another one ({note: {id: 3}, latest: {id: 3, title, done}}) is not the record's. Null when it
 * isn't the record in full.
 *
 * Otherwise the snapshot's other fields it holds another value for, leaving out the id, the run-token fields and those
 * the app sets itself on every save (updatedAt, version: SERVER_MANAGED, changesOnSave). A read of the record itself
 * holds none; another of Account A's records that has every key of a list's projection ({id, title, createdAt})
 * differs in the values it was not given (its own createdAt).
 */
export function wholeRecordDiff(json: unknown, snap: RecordSnapshot, id: RecordIdOf, key: string, runToken: string): string[] | null {
  const isObj = (v: unknown): v is JsonObject => !!v && typeof v === "object" && !Array.isArray(v);
  if (!isObj(json)) return null;
  const tokenFields = Object.keys(snap.record).filter((k) => typeof snap.record[k] === "string" && (snap.record[k] as string).toLowerCase().includes(key));
  if (tokenFields.length === 0) return null;
  const withIds = recordId(json) === null ? Object.values(json).filter(isObj).filter((o) => recordId(o) !== null) : [];
  const inner = withIds.length === 1 ? withIds : [];
  const has = (o: JsonObject, k: string) => Object.prototype.hasOwnProperty.call(o, k);
  const others = Object.keys(snap.record).filter(
    (k) => k !== id.key && !tokenFields.includes(k) && !SERVER_MANAGED.test(k) && !changesOnSave(snap, k, runToken),
  );
  let best: string[] | null = null;
  for (const o of [json, ...inner]) {
    if (!(has(o, id.key) && isIdValue(o[id.key], id) && Object.keys(snap.record).every((k) => has(o, k)) && tokenFields.every((k) => sameValue(o[k], snap.record[k])))) continue;
    const diff = others.filter((k) => !sameValue(o[k], snap.record[k]));
    if (best === null || diff.length < best.length) best = diff;
  }
  return best;
}

/** True when a JSON or form-encoded body has a password or email key, at any depth. */
export function sensitiveBody(body: string | null): boolean {
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
