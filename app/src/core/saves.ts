/**
 * What counts as the form's save request, shared by the engine (report.testRecordsCreated) and every check that
 * submits the form. One definition, so a classic form post, a same-origin JSON API and an API on another origin
 * are recognised the same way everywhere (docs/v0-spec.md, "Tester release (0.1.0)" > "Unfamiliar apps").
 *
 * A save request is a non-GET fetch, XHR or page (document) request that is either
 *   - sent to the target's own origin (a JSON API on the same server, or a classic <form method="post">), or
 *   - sent to another origin with the run's test values in its body (the app's API on another port or host).
 * Analytics beacons carry no test values in a body, and CORS preflights are OPTIONS, so neither counts.
 */

/** The parts of a request (captured or live) the decision needs. */
export interface RequestInfo {
  method: string;
  resourceType: string;
  url: string;
  postData?: string | null;
}

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const SAVE_TYPES = new Set(["fetch", "xhr", "document"]);

/** The URL's origin, or null for opaque origins and unparseable URLs. */
export function originOf(url: string): string | null {
  try {
    const origin = new URL(url).origin;
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
}

/** True when both URLs have the same (non-opaque) origin. */
export function isSameOrigin(url: string, base: string): boolean {
  const a = originOf(url);
  return a !== null && a === originOf(base);
}

/** The run token as it appears inside every test value: lowercase letters and digits only. */
export function tokenKey(runToken: string): string {
  return runToken.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** True when a request body carries the run's test values (any value Run Hound typed contains the run token). */
export function carriesTestValues(postData: string | null | undefined, runToken: string): boolean {
  const key = tokenKey(runToken);
  if (!key || !postData) return false;
  const body = postData.toLowerCase();
  if (body.includes(key)) return true;
  try {
    return decodeURIComponent(body.replace(/\+/g, " ")).includes(key);
  } catch {
    return false;
  }
}

/** A write (POST, PUT, PATCH, DELETE, ...) sent by fetch, XHR or a page form post. */
export function isWrite(r: Pick<RequestInfo, "method" | "resourceType">): boolean {
  return !READ_METHODS.has(r.method.toUpperCase()) && SAVE_TYPES.has(r.resourceType);
}

/**
 * The form's save request: a write to the target's origin, or a write to another origin carrying the run's test
 * values. `runToken` may be empty, which limits the answer to the target's own origin.
 */
export function isSaveRequest(r: RequestInfo, targetUrl: string, runToken = ""): boolean {
  if (!isWrite(r)) return false;
  if (isSameOrigin(r.url, targetUrl)) return true;
  return carriesTestValues(r.postData, runToken);
}

/** A save request sent as a full-page form post (a classic <form method="post">), not by JavaScript. */
export function isPagePost(r: Pick<RequestInfo, "resourceType">): boolean {
  return r.resourceType === "document";
}

/**
 * The app accepted the save: any 2xx, or a 3xx (a classic form post answers "303 See Other" and redirects to a
 * thank-you page; that is success, not a rejection).
 */
export function isAcceptedStatus(status: number | null | undefined): boolean {
  return typeof status === "number" && status >= 200 && status < 400;
}

/** A request to another origin that is on this machine or the local network, like the target itself. */
export function isLocalOrigin(url: string, targetUrl: string): boolean {
  let host: string;
  let targetHost: string;
  try {
    host = new URL(url).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    targetHost = new URL(targetUrl).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return false;
  }
  if (host === targetHost) return true;
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1") return true;
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  return /^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host);
}

/** `text` (GraphQL) with its comments and string literals blanked, so words and braces in them never count. */
export function graphQlCode(text: string): string {
  return text.replace(/"""[\s\S]*?"""|"(?:[^"\\\n]|\\.)*"|#[^\n]*/g, (m) => (m.startsWith("#") ? " " : '""'));
}

const GQL_NAME = "[_A-Za-z][_0-9A-Za-z]*";
/** Directives, each with its arguments: @include(if: $x). */
const GQL_DIRECTIVES = `(?:@${GQL_NAME}\\s*(?:\\([^()]*\\)\\s*)?)*`;
/** A selection set's start: "{" and a field, an alias or a fragment spread. */
const GQL_SELECTION = `\\{\\s*(?:\\.\\.\\.|${GQL_NAME})`;
/**
 * The start of a GraphQL document: a selection set (a query's shorthand), or query or subscription with an optional
 * name, variables and directives before one, or a fragment definition.
 */
const GQL_DOCUMENT = new RegExp(
  `^\\s*(?:${GQL_SELECTION}|(?:query|subscription)(?![_0-9A-Za-z])\\s*(?:${GQL_NAME}\\s*)?(?:\\([^()]*\\)\\s*)?${GQL_DIRECTIVES}${GQL_SELECTION}|fragment\\s+${GQL_NAME}\\s+on\\s+${GQL_NAME}\\s*${GQL_DIRECTIVES}${GQL_SELECTION})`,
);

/**
 * True when `text`, with its comments left out, starts a GraphQL document (GQL_DOCUMENT): "{ tasks { id } }",
 * "query Tasks($first: Int) { … }", "fragment T on Task { … } query { … }". A saved search's text ("status:open"), a JSON
 * filter kept as text ('{"status":"open"}') or a word that only starts like a keyword ("queryString") is not one.
 */
export function isGraphQlDocument(text: string): boolean {
  return GQL_DOCUMENT.test(graphQlCode(text));
}

/** The keys a GraphQL request body's operation may hold (GraphQL over HTTP): nothing else. */
const GRAPHQL_REQUEST_KEYS = new Set(["query", "variables", "operationName", "extensions"]);

/**
 * A GraphQL read sent as a POST (Apollo Client's default): a JSON body, or a batch of them, each operation holding only
 * GraphQL request keys (query, variables, operationName, extensions), with a query that is a GraphQL document
 * (isGraphQlDocument) and holds no mutation. It reads records, even when its variables carry a test value (a search for
 * what was just saved). A REST body with a "query" field ({name, query}: a saved search, a saved filter, a default-search
 * setting) is a write, never a read (0.6.0 close-out round 2). Shared by the test-record count (engine/context.ts
 * isAcceptedSave) and the existing-record hold (checks/lib/record-state.ts), which learns the ids its answer holds and
 * sends its body again to re-read.
 */
export function isGraphQlRead(postData: string | null | undefined): boolean {
  if (!postData || !/^\s*[[{]/.test(postData)) return false;
  let body: unknown;
  try {
    body = JSON.parse(postData);
  } catch {
    return false;
  }
  const operations = Array.isArray(body) ? body : [body];
  return (
    operations.length > 0 &&
    operations.every((op) => {
      if (!op || typeof op !== "object" || Array.isArray(op)) return false;
      if (!Object.keys(op).every((k) => GRAPHQL_REQUEST_KEYS.has(k))) return false;
      const query = (op as { query?: unknown }).query;
      return typeof query === "string" && isGraphQlDocument(query) && !/\bmutation\b/.test(graphQlCode(query));
    })
  );
}

/**
 * True for a request header that carries an anti-CSRF token (a name with csrf or xsrf in it: Django's X-CSRFToken,
 * axios' and Angular's X-XSRF-TOKEN, Rails' X-CSRF-Token). It names no one (the session does), so a check may send
 * one of an identity's own (engine/context.ts request), and the capture keeps a write's (engine/capture.ts).
 */
export function isAntiCsrfHeader(name: string): boolean {
  return /csrf|xsrf/i.test(name);
}
