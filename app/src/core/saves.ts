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
