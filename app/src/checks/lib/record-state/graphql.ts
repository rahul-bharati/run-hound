/** GraphQL read classification / persisted Relay guarding: identifying GraphQL reads, persisted operations, and the names a mutation field needs to count as a create. */

import { isGraphQlDocument, graphQlCode } from "../../../core/saves.js";
import {
  CREATE_LAST,
  CREATE_WORDS,
  EDIT_WORDS,
  ID_KEYS,
  NOT_A_RECORD_ID,
  PERSISTED_GET_KEYS,
  PERSISTED_ID_KEYS,
  SINGLETON_NOUNS,
} from "../../../constants/record-state-constants.js";
import type { ReadAnswer, ReadBeforeSave } from "../../../interfaces/record-state.js";
import type { JsonObject } from "../../../types/record-state.js";
import { parseJson, plainObject } from "./parsing.js";
import { idLikeKey, idResource, idValue, nameForms, recordId, resourceNames } from "./snapshot.js";

/**
 * True for a GraphQL read made as a GET (Relay, Apollo's GET queries): its URL carries a `query` that is a GraphQL
 * document ("{ tasks … }", "query Tasks …": core/saves.ts isGraphQlDocument), the `extensions` of a persisted query, or
 * a persisted document's id (`doc_id` or `documentId`) with its `variables` and no parameter beside GraphQL's own. A
 * REST record read at ?doc_id=n1 or ?documentId=n1 is not one: its path stays a record the page read.
 */
export function graphQlGet(url: string): boolean {
  let params: URLSearchParams;
  try {
    params = new URL(url).searchParams;
  } catch {
    return false;
  }
  const query = params.get("query") ?? "";
  if (isGraphQlDocument(query) && !/\bmutation\b/.test(graphQlCode(query))) return true;
  // A persisted query: Apollo's hash in `extensions`, or a document id sent the GraphQL-over-HTTP way.
  if (/persistedQuery/.test(params.get("extensions") ?? "")) return true;
  return (
    (params.has("doc_id") || params.has("documentId")) &&
    params.has("variables") &&
    [...params.keys()].every((k) => PERSISTED_GET_KEYS.has(k))
  );
}

/**
 * True for a GraphQL read: one sent as a POST (it has its query body, or is a persisted operation's), or a GET with a
 * GraphQL query in its URL.
 */
export const isGraphQlAnswer = (a: ReadAnswer) => Boolean(a.post) || Boolean(a.graphql) || graphQlGet(a.url);

/**
 * The operations of a GraphQL request body (one, or a batch), or null when it isn't one.
 */
export function graphQlOperations(json: unknown): JsonObject[] | null {
  const ops = Array.isArray(json) ? json : [json];
  if (ops.length === 0 || !ops.every(plainObject)) return null;
  const isOperation = (o: JsonObject) =>
    typeof o.query === "string" || persistedOperation(o) || (typeof o.operationName === "string" && plainObject(o.variables));
  return (ops as JsonObject[]).every(isOperation) ? (ops as JsonObject[]) : null;
}

/**
 * True for a persisted GraphQL operation's marker: Apollo's hash (extensions.persistedQuery), or a document id with its
 * variables (Relay's {doc_id, variables}, GraphQL over HTTP's {documentId, variables}, Hot Chocolate's {id, variables}
 * with no key beside GraphQL's own). A REST body {id, variables} taken for one only makes the hold stop more.
 */
export function persistedOperation(o: JsonObject): boolean {
  if (plainObject(o.extensions) && plainObject(o.extensions.persistedQuery)) return true;
  if ((typeof o.doc_id === "string" || typeof o.documentId === "string") && plainObject(o.variables)) return true;
  return typeof o.id === "string" && plainObject(o.variables) && Object.keys(o).every((k) => PERSISTED_ID_KEYS.has(k));
}

/**
 * True for a POST body the page may have read with although core/saves.ts isGraphQlRead can't call it a read (so it is
 * never sent again): each operation a persisted one with no query text (persistedOperation: Apollo's automatic persisted
 * queries, Relay's doc_id), or a query that holds no mutation beside a key that isn't a GraphQL request key (Relay's
 * {id, query, variables}). The hold learns the ids its answer holds: a persisted mutation's too, which only makes it
 * stop more.
 */
export function graphQlReadLike(postData: string | null | undefined): boolean {
  if (!postData || !/^\s*[[{]/.test(postData)) return false;
  const ops = graphQlOperations(parseJson(postData));
  if (!ops) return false;
  return ops.every((op) =>
    typeof op.query === "string" ? isGraphQlDocument(op.query) && !/\bmutation\b/.test(graphQlCode(op.query)) : persistedOperation(op),
  );
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
 * True when a mutation field's (or operation's) name says it makes a new record and nothing else: a create verb first
 * (CREATE_WORDS) or last (CREATE_LAST), no word that says it changes one (EDIT_WORDS), and a thing it makes that isn't
 * the one record of its kind an account has (SINGLETON_NOUNS): the last word after a leading verb (submitProfile,
 * createProfileNote makes a note), the word before a trailing one (accountCreate).
 */
export function createsRecord(name: string): boolean {
  const words = nameWords(name);
  const first = CREATE_WORDS.has(words[0] ?? "");
  const last = !first && CREATE_LAST.has(words[words.length - 1] ?? "");
  if (!first && !last) return false;
  const noun = first ? words[words.length - 1] : words[words.length - 2];
  return !words.some((w) => EDIT_WORDS.has(w)) && !SINGLETON_NOUNS.has(noun ?? "");
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
export function graphQlLiterals(json: unknown): [string, string | number][] {
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

/**
 * The ids a GraphQL request body names (0.6.0 close-out round 2): under an id-like key (idLikeKey) at any depth of an
 * operation's variables, or as a literal argument of one of its mutations (graphQlLiterals). Empty when the body isn't a
 * GraphQL request.
 */
export function graphQlIds(postData: string | null): string[] {
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
export function idsIn(node: unknown, read: ReadBeforeSave, names: ReadonlySet<string>, depth = 0): void {
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

/** `url`'s origin and path, without its query and trailing "/", or null when it doesn't parse. */
export function pathKey(url: string): string | null {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

/**
 * True when `key` (a query parameter, a body field, a form or multipart name) holding `value` names a record the page
 * read, as a save's own record rather than a reference to another one:
 * - one of ID_KEYS ({id: "t1"}) holding any id the page read;
 * - another id-like key (taskId, task_id) holding an id the page read, when the key names the resource the save's URL
 *   addresses (taskId on /api/tasks/rename), or when the page read that value as an object's own id under this very
 *   key (a list keyed taskId). A reference to another record (projectId on a task's create) is neither.
 */
export function namesReadRecord(key: string, value: unknown, read: ReadBeforeSave, saveNames: ReadonlySet<string>): boolean {
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
export function pathToValues(node: unknown, key: string): JsonObject[] {
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

/**
 * What the page had read when the form's save was judged, gathered from each answer: ids in JSON, answers to lists,
 * answers to one record. A GraphQL answer's path is neither a list nor a record the page read: only its ids count.
 */
export function readBeforeSave(answers: ReadAnswer[]): ReadBeforeSave {
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