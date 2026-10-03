/**
 * URL-credential extraction for write-access: the credentials an app puts in its URLs (?access_token=,
 * ?api_token=, ?auth=) so a replay can carry the identity's own, never Account A's. `NO_TOKENS` lives in
 * `constants/write-access-constants.ts`.
 */
import { tokenKey } from "../../core/saves.js";
import { queryParamKind } from "../../checks/lib/cross-site-query.js";
import { NO_TOKENS } from "../../constants/write-access-constants.js";
import type { Capture } from "../../core/types.js";

/**
 * The credentials `url` carries in its query: each parameter the shared helper names a credential (cross-site-query.ts
 * queryParamKind: access_token, api_token, auth, api_key, jwt, sid …), never a value carrying the run token (`runToken`,
 * text Run Hound typed). An app that takes its session as ?access_token= (Laravel's api_token, Firebase REST's ?auth=)
 * puts the account's own credential in every API request's URL.
 */
export function credentialParams(url: string, runToken: string): { name: string; value: string }[] {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return [];
  }
  const key = tokenKey(runToken);
  return [...parsed.searchParams].filter(([name, value]) => queryParamKind(name, value, NO_TOKENS, key) === "credential").map(([name, value]) => ({ name, value }));
}

/**
 * A value random enough to be a credential, not a placeholder ("null", "undefined") or a setting ("dark", a page
 * number), as auth.ts judges a session value: only such a value is registered as a secret, or taken as an identity's own.
 */
export function looksLikeCredential(value: string): boolean {
  if (value.length < 8 || /\s/.test(value)) return false;
  return value.length >= 24 || (/\d/.test(value) && /[A-Za-z]/.test(value));
}

/** Every credential value the requests of `capture` carried in their query (credentialParams) that looks like one. */
export function credentialValues(capture: Capture, runToken: string): string[] {
  return capture.requests.flatMap((r) => credentialParams(r.url, runToken).map((c) => c.value)).filter(looksLikeCredential);
}

/**
 * The credentials the requests of `capture` carried in their query (credentialParams), by origin and name: the last one
 * sent that looks like one (a signed-out page's ?access_token=null is none).
 */
export function credentialsSent(capture: Capture, runToken: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of capture.requests) {
    let origin: string;
    try {
      origin = new URL(r.url).origin;
    } catch {
      continue;
    }
    for (const { name, value } of credentialParams(r.url, runToken)) if (looksLikeCredential(value)) out.set(`${origin} ${name}`, value);
  }
  return out;
}
