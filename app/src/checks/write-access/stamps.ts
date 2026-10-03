/**
 * Version-stamp refresh for write-access: rewrites a Write's body and URL so the record's current version or
 * lock value goes (withFreshStamps), at every spot the app's own update sent it: top, one level down
 * ({"task": {...}}; task[lock_version] in a form), an object field ({meta: {version}}), and the URL's query
 * (PATCH /api/tasks/2?lock_version=0). A stamp the re-read doesn't show is left as the app sent it and named
 * in `staleStamps`. The form-text helper lives in `./format.ts`. The other focused modules (identity, record
 * matching, record body, write build, CSRF tokens, credentials, restoration) live alongside this one.
 */
import { jsonObjectBody, saveStamp, type JsonObject } from "../../checks/lib/record-state.js";
import { NESTED_FORM_KEY } from "../../checks/lib/record-state.js";
import type { Write } from "../../interfaces/write-access.js";
import { formText } from "./format.js";

/**
 * `w` with each stamp the app changes on every save (saveStamp: lock_version, version, __v, _rev, etag, updatedAt) at
 * its value in `pre`, the record re-read as Account A just before the attempt, as record-state's put-back sends them:
 * at the body's top, where the body holds the record one level down ({"task": {...}}; task[lock_version] in a form),
 * and in one of the record's object fields ({meta: {version}}, meta[version]); and in the URL's query
 * (PATCH /api/tasks/2?lock_version=0, ?task[lock_version]=0: close-out review, round 1). The app's own update carried
 * the value the record had then, which its own save made stale: with optimistic locking the replay would be a conflict
 * (409) whoever sent it, and read as a refusal. A stamp the re-read doesn't show is left as the app sent it, and named
 * in `staleStamps` (a refusal of that write proves nothing about who may change the record). In the URL's query, only
 * the parameters `queryStamps` names (recordQueryStamps: their value is one the record showed before the app's update
 * was sent) are the record's stamps; another by a stamp's name (?version=2, an API version) is left as the app sent it
 * and named in `staleStamps` too (close-out review, round 2).
 */
export function withFreshStamps(w: Write, pre: JsonObject, runToken: string, queryStamps: ReadonlySet<string>): Write {
  const isObject = (v: unknown): v is JsonObject => !!v && typeof v === "object" && !Array.isArray(v);
  const has = (o: unknown, k: string): o is JsonObject => isObject(o) && Object.prototype.hasOwnProperty.call(o, k);
  /**
   * The stamps of form-style `params` (a form body, or the URL's query) at their value in `pre`, and those it doesn't
   * show. With `known` (the URL's query), a parameter it doesn't name is left as it is and counted as one not shown.
   */
  const freshParams = (params: URLSearchParams, known?: ReadonlySet<string>): { changed: boolean; stale: string[] } => {
    let changed = false;
    const stale: string[] = [];
    for (const k of new Set(params.keys())) {
      const m = NESTED_FORM_KEY.exec(k);
      const field = m ? m[2]! : k;
      if (!saveStamp(field, params.get(k), runToken)) continue;
      if (known && !known.has(k)) {
        stale.push(field);
        continue;
      }
      // meta[version]: a stamp of the record's object field meta. task[lock_version] (the model's name, which the record
      // doesn't hold) and a flat lock_version: the record's own.
      const outer = m && isObject(pre[m[1]!]) ? (pre[m[1]!] as JsonObject) : pre;
      if (!has(outer, field)) {
        stale.push(field);
        continue;
      }
      const now = formText(outer[field]);
      if (params.get(k) !== now) {
        params.set(k, now);
        changed = true;
      }
    }
    return { changed, stale };
  };
  // The URL's query first: a version there is as stale as one in the body.
  let url = w.url;
  const urlStale: string[] = [];
  let parsed: URL | null = null;
  try {
    parsed = new URL(w.url);
  } catch {
    parsed = null;
  }
  if (parsed && parsed.search) {
    const q = freshParams(parsed.searchParams, queryStamps);
    if (q.changed) url = parsed.href;
    urlStale.push(...q.stale);
  }
  const withStale = (out: Write, stale: Iterable<string>): Write => {
    const names = [...new Set([...urlStale, ...stale])];
    const at = url === w.url ? out : { ...out, url };
    return names.length > 0 ? { ...at, staleStamps: names } : at;
  };
  if (!w.body || !w.kind) return withStale(w, []);
  if (w.kind === "form") {
    const params = new URLSearchParams(w.body);
    const { changed, stale } = freshParams(params);
    return withStale(changed ? { ...w, body: params.toString() } : w, stale);
  }
  const sent = jsonObjectBody(w.body);
  if (!sent) return withStale(w, []);
  /** The stamps left as the app sent them, by path ("lock_version", "meta.version", "task.lock_version"). */
  const stale = new Map<string, string>();
  const fresh = (obj: JsonObject, now: JsonObject | undefined, nested: boolean, path: string): JsonObject => {
    const out: JsonObject = { ...obj };
    for (const [k, v] of Object.entries(obj)) {
      if (saveStamp(k, v, runToken)) {
        if (now && has(now, k)) out[k] = now[k];
        else stale.set(`${path}${k}`, k);
      } else if (!nested && isObject(v)) {
        out[k] = fresh(v, now && isObject(now[k]) ? (now[k] as JsonObject) : undefined, true, `${path}${k}.`);
      }
    }
    return out;
  };
  let body = fresh(sent, pre, false, "");
  if (w.nest && isObject(sent[w.nest])) {
    // The body's record one level down is the record itself: its stamps are judged against the record as read.
    const pathsToDelete: string[] = [];
    for (const path of stale.keys()) if (path.startsWith(`${w.nest}.`)) pathsToDelete.push(path);
    for (const path of pathsToDelete) stale.delete(path);
    body = { ...body, [w.nest]: fresh(sent[w.nest] as JsonObject, pre, false, `${w.nest}.`) };
  }
  const text = JSON.stringify(body);
  return withStale(text === w.body ? w : { ...w, body: text }, stale.values());
}
