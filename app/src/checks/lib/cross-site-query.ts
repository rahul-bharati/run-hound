/**
 * Query parameters a replayed request must never carry (0.6.0 round 2): an anti-CSRF token or a credential that the
 * app's own page put in a save's URL (Spring's `?_csrf=`, `?access_token=`, Laravel's `?api_token=`, Firebase's
 * `?auth=`). A page on another site can't know them, and Account B doesn't have Account A's, so a forged or replayed
 * request leaves them out; the finding text and an exported spec never hold them. Shared by csrf and write-access.
 * Values are held in memory only: never put in a page Run Hound serves, never written anywhere.
 */
import { looksRandom, TOKEN_FIELD } from "./csrf-tokens.js";

/**
 * Query parameter names that carry a credential: an access, auth, API, ID or refresh token, an API key, a JWT, a
 * session id, a signature or a secret. A whole name, so `?sort=`, `?page=` or `?listId=` never match.
 */
export const CREDENTIAL_PARAM =
  /^(?:(?:access|auth|api|id|refresh|session|bearer)[_-]?token|token|auth|authorization|bearer|api[_-]?key|apikey|x[_-]?api[_-]?key|jwt|session(?:[_-]?id)?|sessid|sid|sig|signature|secret|client[_-]?secret|password|passwd|x-amz-(?:signature|credential|security-token))$/i;

/** A name that says the value is an identifier (id, listId, project_id, uuid), which a random-looking value doesn't make a secret. */
const ID_NAME = /(?:^|[_-])(?:id|uuid|guid)$|[a-z0-9]Id$|^(?:uuid|guid)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Why a query parameter was left out: an anti-CSRF token, a credential, or a random value Run Hound can't place. */
export type QueryParamKind = "csrf" | "credential" | "secret";

export interface DroppedParam {
  name: string;
  kind: QueryParamKind;
}

export interface CleanedUrl {
  /** The URL without the dropped parameters (the same URL when none was dropped). */
  url: string;
  /** The parameters left out, each name once, in order. */
  dropped: DroppedParam[];
  /** Their values, to redact wherever they might still appear. Never print them. */
  values: string[];
}

/**
 * Why `name=value` must be left out of a replayed URL, or null when it may stay: a credential by name
 * (CREDENTIAL_PARAM), an anti-CSRF token by name (csrf-tokens.ts TOKEN_FIELD) or by value (one of `tokens`, the token
 * values the app gave the page), or a random-looking value (looksRandom) that Run Hound didn't type (it doesn't carry
 * `runKey`) under a name that isn't an identifier's. A value that carries `runKey` is Run Hound's own and always stays.
 */
export function queryParamKind(name: string, value: string, tokens: ReadonlySet<string>, runKey: string): QueryParamKind | null {
  const key = runKey.toLowerCase();
  if (key !== "" && value.toLowerCase().includes(key)) return null;
  if (CREDENTIAL_PARAM.test(name)) return "credential";
  if (TOKEN_FIELD.test(name) || (value !== "" && tokens.has(value))) return "csrf";
  if (looksRandom(value) && !ID_NAME.test(name) && !UUID.test(value)) return "secret";
  return null;
}

/** `url` without the query parameters that carry a token or a credential (queryParamKind); the URL as given when it can't be parsed. */
export function withoutQueryCredentials(url: string, tokens: ReadonlySet<string>, runKey: string): CleanedUrl {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { url, dropped: [], values: [] };
  }
  const kept = new URLSearchParams();
  const dropped: DroppedParam[] = [];
  const values: string[] = [];
  for (const [name, value] of parsed.searchParams) {
    const kind = queryParamKind(name, value, tokens, runKey);
    if (!kind) {
      kept.append(name, value);
      continue;
    }
    if (!dropped.some((d) => d.name === name)) dropped.push({ name, kind });
    if (value !== "") values.push(value);
  }
  if (dropped.length === 0) return { url, dropped, values };
  const search = kept.toString();
  parsed.search = search ? `?${search}` : "";
  return { url: parsed.href, dropped, values };
}

/** `text` with every one of `values` (as given and URL-encoded) replaced by "[REDACTED]". */
export function redactValues(text: string, values: readonly string[]): string {
  let out = text;
  const forms = new Set<string>();
  for (const v of values) {
    if (v.length < 4) continue;
    forms.add(v);
    forms.add(encodeURIComponent(v));
    forms.add(new URLSearchParams({ x: v }).toString().slice(2));
  }
  for (const f of [...forms].sort((a, b) => b.length - a.length)) out = out.split(f).join("[REDACTED]");
  return out;
}
