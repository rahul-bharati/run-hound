/**
 * URL / record identity matching for write-access: decides whether a URL addresses the test record, what collection
 * it belongs to, what resource it names, and how a spec can aim it at another record. The id-parameter predicate
 * lives in `./id-pattern.ts`. The other focused modules (record body, write build, CSRF tokens, credentials,
 * version stamps, restoration) live alongside this one.
 */
import { isIdParam } from "./id-pattern.js";
import type { RecordIdOf } from "../../interfaces/write-access.js";

/** URL-decoded path segment, or its original when the decode fails. */
export function decodeSegment(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * True when the record's id is what `url` addresses: its last path segment, or a query value under a parameter that
 * names an id (isIdParam). Not a sub-resource.
 */
export function addressesRecord(url: string, id: RecordIdOf): boolean {
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
export function collectionOf(url: string, id: RecordIdOf): string | null {
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
export function pathCollectionOf(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}/`;
}

/**
 * The resource a URL addresses, as bare singular and plural names: the path segment before the record's id when it
 * names the id ("tasks" and "task" for /api/tasks/3 or /api/task/3), else its last segment (/api/tasks).
 */
export function resourceOf(url: string, id: RecordIdOf): string[] {
  let segs: string[];
  try {
    segs = new URL(url, "http://x").pathname.split("/").filter(Boolean).map(decodeSegment);
  } catch {
    return [];
  }
  const at = segs.lastIndexOf(String(id.value));
  const seg = (at > 0 ? segs[at - 1] : segs[segs.length - 1]) ?? "";
  const n = seg.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!n) return [];
  return [...new Set([n, n.replace(/ies$/, "y"), n.replace(/(ch|sh|ss|x)es$/, "$1"), n.replace(/s$/, "")])];
}

/**
 * True when `url` names the record's id itself: as its last path segment, or in its query under the record's own id
 * key (?id=3). Not only under another name (?listId=3, ?projectId=3), which may be a different record's id.
 */
export function namesOwnId(url: string, id: RecordIdOf): boolean {
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

/**
 * `url`'s path around the record's id, so a spec can aim it at another record: the part before the id and the part
 * after it. Null when the id is neither the last path segment nor a query value under a parameter that names an id
 * (isIdParam). In the query form only the parameter naming the id is kept.
 */
export function aroundId(url: URL, id: RecordIdOf): { prefix: string; suffix: string } | null {
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
