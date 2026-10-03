/**
 * Session-value detection helpers for sign-in (auth.ts): the regexes and functions that say which cookies,
 * localStorage, IndexedDB and sessionStorage values are session tokens; which cookies never hold a session; which
 * values come from the app's own addresses (ids rather than secrets); whether the session lives in sessionStorage;
 * and whether the session keeps the password. No Playwright Page; this is data-only logic over SessionState.
 */
import type { SessionState, CookieJar } from "../../types/auth.js";
import type { IndexedDbState, SessionStorageReading, SignedIn } from "../../interfaces/auth.js";
import { isWeak, passwordIn, PASSWORD_KEY, safeDecode, textCarries } from "./password-primitives.js";

/** Names of cookies and storage keys that usually hold a session. */
export const SESSION_NAME = /sess|sid|auth|token|jwt|remember|login|identity|credential|secret|key|bearer/i;
const JWT = /^eyJ[\w-]+\.eyJ[\w-]+\.[\w-]*$/;
/** A value made only of token characters, 24 or more (no spaces, no ":" of an address); sessionSecrets adds a digit and a letter. */
const OPAQUE_TOKEN = /^[A-Za-z0-9._~+/=-]{24,}$/;

/** A value random enough to be a session id or token, not a setting such as "dark" or "en-US". */
function looksLikeToken(value: string): boolean {
  if (value.length < 8 || /\s/.test(value)) return false;
  return value.length >= 24 || (/\d/.test(value) && /[A-Za-z]/.test(value));
}

/** A Web Storage value's strings: the whole value, and every string of the JSON it holds. */
function storedStrings(value: string): string[] {
  const out = [value];
  if (/^\s*[[{"]/.test(value)) {
    try {
      JSON.parse(value, (_key, v: unknown) => {
        if (typeof v === "string") out.push(v);
        return v;
      });
    } catch {
      // Not JSON.
    }
  }
  return out;
}

/**
 * The values of `state` that identify the session, for redaction: cookie values that look like session ids or tokens,
 * and the tokens an app keeps in localStorage, IndexedDB or sessionStorage.
 */
export function sessionSecrets(state: SessionState, sessionStorage: SignedIn["sessionStorage"] = [], reading: SessionStorageReading = {}): string[] {
  const addressValues = reading.addressValues ?? new Set<string>();
  const out = new Set<string>();
  const add = (value: string) => {
    out.add(value);
    try {
      const decoded = decodeURIComponent(value);
      if (decoded !== value && looksLikeToken(decoded)) out.add(decoded);
    } catch {
      // Not URL-encoded.
    }
  };
  for (const cookie of state.cookies) {
    if (looksLikeToken(cookie.value) && (SESSION_NAME.test(cookie.name) || cookie.value.length >= 16)) add(cookie.value);
  }
  const walk = (value: unknown, key: string, depth: number) => {
    if (depth > 6) return;
    if (typeof value === "string") {
      if (JWT.test(value) || (SESSION_NAME.test(key) && looksLikeToken(value))) add(value);
      return;
    }
    if (Array.isArray(value)) value.forEach((v) => walk(v, key, depth + 1));
    else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walk(v, k, depth + 1);
  };
  const opaqueToken = (v: string) => OPAQUE_TOKEN.test(v) && /\d/.test(v) && /[A-Za-z]/.test(v);
  const walkOpaque = (value: unknown, depth: number) => {
    if (depth > 6) return;
    if (typeof value === "string") {
      if (opaqueToken(value) && !addressValues.has(value)) add(value);
    } else if (Array.isArray(value)) value.forEach((v) => walkOpaque(v, depth + 1));
    else if (value && typeof value === "object") for (const v of Object.values(value)) walkOpaque(v, depth + 1);
  };
  const walkItem = (opaque: boolean) => ({ name, value }: { name: string; value: string }) => {
    let parsed: unknown = undefined;
    if (/^\s*[[{"]/.test(value)) {
      try {
        parsed = JSON.parse(value);
      } catch {
        parsed = undefined;
      }
    }
    const whole = parsed === undefined ? value : parsed;
    if (opaque) walkOpaque(whole, 0);
    walk(whole, name, 0);
  };
  for (const origin of state.origins) {
    for (const db of (origin as { indexedDB?: IndexedDbState[] }).indexedDB ?? []) {
      for (const store of db.stores ?? []) {
        for (const record of store.records ?? []) {
          walk(record.value, store.name ?? "", 0);
          walk(record.key, store.name ?? "", 0);
        }
      }
    }
    origin.localStorage.forEach(walkItem(false));
  }
  for (const entry of sessionStorage) entry.items.forEach(walkItem(reading.sessionStorageSession !== false));
  return [...out];
}

/**
 * Cookies that never hold the session: a CSRF token, and the analytics, advertising and bot-check cookies a sign-in
 * may set, plus the HttpOnly cookies a load balancer or a bot manager in front of the app sets, and Heroku's
 * router cookie and AWS WAF's challenge token.
 */
export const NOT_SESSION_COOKIE =
  /csrf|xsrf|antiforgery|^__RequestVerificationToken|^__cflb$|^__cfwaitingroom$|^heroku-session-affinity$|^aws-waf-token$|^_ga($|_)|^_gid$|^_gat|^_gcl_|^_fb[pc]$|^ajs_|^_hj|^__stripe_|^__cf_bm$|^cf_clearance$|^_cfuvid$|^__cfruid$|^mp_|^amp_|^_clck$|^_clsk$|^intercom-|^__hs|^hubspotutk$|^_uet[sv]id$|^_pk_|^_dd_s$|^ARRAffinity|^AWSALB|^AWSELB$|^GCI?LB$|^ak_bmsc$|^bm_(sv|sz|mi|so|s)$|^_abck$|^visid_incap_|^incap_ses_|^nlbi_|^BIGipServer|^TS01[0-9a-f]*$|^NSC_|^datadome$|^_px|^INGRESSCOOKIE$|^ROUTEID$/i;

const cookieKey = (c: { name: string; domain: string; path: string }): string => `${c.domain} ${c.path} ${c.name}`;

/** Whether the submit set or changed a cookie that can hold a session. */
export function sessionCookieSet(before: CookieJar, after: CookieJar): boolean {
  const was = new Map(before.map((c) => [cookieKey(c), c.value]));
  return after.some((c) => !NOT_SESSION_COOKIE.test(c.name) && looksLikeToken(c.value) && was.get(cookieKey(c)) !== c.value);
}

/**
 * A host name's site, near enough to tell the app's own cookies from another site's without a public-suffix list: its
 * last two labels; an IP address, or a name of one label, as it is.
 */
export function siteOf(host: string): string {
  const h = host.toLowerCase().replace(/^\./, "").replace(/^\[|\]$/g, "");
  if (/^[\d.]+$/.test(h) || h.includes(":") || !h.includes(".")) return h;
  return h.split(".").slice(-2).join(".");
}

/**
 * Whether the session lives in the sessionStorage signIn read (0.6.0 review, rounds 1 and 2; the close-out).
 */
export function sessionInStorage(
  state: SessionState,
  kept: NonNullable<SignedIn["sessionStorage"]>,
  credentials: ReadonlySet<string>,
  cookiesBefore: CookieJar,
  hosts: readonly string[],
): boolean {
  if (kept.length === 0) return false;
  const sent = [...credentials];
  for (const entry of kept) {
    for (const item of entry.items) {
      if (storedStrings(item.value).some((v) => looksLikeToken(v) && sent.some((header) => header.includes(v)))) return true;
    }
  }
  if (sessionCookieSet(cookiesBefore, state.cookies)) return false;
  const sites = new Set(hosts.map(siteOf));
  const cookieSession = state.cookies.some(
    (c) => !NOT_SESSION_COOKIE.test(c.name) && looksLikeToken(c.value) && (SESSION_NAME.test(c.name) || (c.httpOnly && sites.has(siteOf(c.domain)))),
  );
  if (cookieSession) return false;
  return sessionSecrets({ ...state, cookies: [] }).length === 0;
}

/**
 * The token-like values the app's own requests carried as a path segment or as a query value under a key that
 * doesn't say session, token or key, except those also sent in a credential header.
 */
export function idsInAddresses(urls: readonly string[], origins: ReadonlySet<string>, credentials: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  const safeDecode = (text: string): string => {
    try {
      return decodeURIComponent(text);
    } catch {
      return text;
    }
  };
  for (const raw of urls) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    if (!origins.has(url.origin)) continue;
    for (const segment of url.pathname.split("/")) {
      const value = safeDecode(segment);
      if (looksLikeToken(value)) out.add(value);
    }
    for (const [key, value] of url.searchParams) if (!SESSION_NAME.test(key) && looksLikeToken(value)) out.add(value);
  }
  const sent = [...credentials];
  for (const value of out) if (sent.some((header) => header.includes(value))) out.delete(value);
  return out;
}

/** Every string of a JSON text with the key it is under (an array's items under the array's key), or none. */
export function jsonStringsByKey(text: string, key: string): [string, string][] {
  const out: [string, string][] = [];
  const walk = (value: unknown, under: string, depth: number) => {
    if (depth > 8) return;
    if (typeof value === "string") out.push([under, value]);
    else if (Array.isArray(value)) value.forEach((v) => walk(v, under, depth + 1));
    else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walk(v, k, depth + 1);
  };
  if (/^\s*[[{"]/.test(text)) {
    try {
      walk(JSON.parse(text), key, 0);
    } catch {
      // Not JSON.
    }
  }
  return out;
}

/**
 * Where the session signIn would return keeps the password.
 */
export function passwordKeptIn(
  state: SessionState,
  sessionStorage: NonNullable<SignedIn["sessionStorage"]>,
  password: string,
  username: string,
): string | null {
  if (!password) return null;
  const namesPassword = (key: string) => {
    const k = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    return PASSWORD_KEY.test(k) || /pass|pwd|^pw|secret|credential/.test(k);
  };
  const holds = passwordIn(password);
  const strict = isWeak(password) || password === username;
  const keeps = (value: string, key: string): boolean => {
    if (!value) return false;
    const decoded = safeDecode(value);
    if (strict) {
      if (namesPassword(key) && (value === password || decoded === password)) return true;
      return [value, decoded].some((v) => jsonStringsByKey(v, key).some(([k, s]) => s === password && namesPassword(k)));
    }
    return textCarries(value, password, holds) || (decoded !== value && textCarries(decoded, password, holds));
  };
  for (const cookie of state.cookies) if (keeps(cookie.value, cookie.name)) return `a cookie (${cookie.name})`;
  for (const origin of state.origins) {
    for (const item of origin.localStorage) if (keeps(item.value, item.name)) return `localStorage (${item.name})`;
    for (const db of (origin as { indexedDB?: (IndexedDbState & { name?: string })[] }).indexedDB ?? []) {
      for (const store of db.stores ?? []) {
        for (const record of store.records ?? []) {
          const texts = [record.value, record.key].map((v) => (typeof v === "string" ? v : JSON.stringify(v ?? null)));
          if (texts.some((t) => keeps(t, store.name ?? ""))) return `IndexedDB (${db.name ?? store.name ?? "a database"})`;
        }
      }
    }
  }
  for (const entry of sessionStorage) for (const item of entry.items) if (keeps(item.value, item.name)) return `sessionStorage (${item.name})`;
  return null;
}

/** The most request addresses signIn keeps after the submit (for idsInAddresses). */
export const MAX_ADDRESSES = 2_000;

/** Exported for engine/auth.ts (orchestrator) to use the helpers. */
export { looksLikeToken, storedStrings, JWT, OPAQUE_TOKEN };