export interface SecretMatch {
  /** Pattern name, e.g. "openai-key", "stripe-secret", "aws-access-key", "supabase-service-role", "private-key". */
  kind: string;
  /** Redacted form safe to show: first 4 chars + "…" + length, never the full value. */
  preview: string;
  index: number;
}

interface Pattern {
  kind: string;
  regex: RegExp;
  /** Optional extra test on the matched value (e.g. only service_role JWTs). */
  accept?: (value: string) => boolean;
}

/**
 * True for a value random enough to be a real key: it mixes digits with upper- and lower-case letters.
 * Keeps kebab-case identifiers such as "sk-skeleton-loader-container" out of the results.
 */
function looksRandom(value: string): boolean {
  return /\d/.test(value) && /[a-z]/.test(value) && /[A-Z]/.test(value);
}

/** True when a JWT's payload claims role "service_role" (Supabase admin key). */
function isServiceRoleJwt(token: string): boolean {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as unknown;
    return typeof payload === "object" && payload !== null && (payload as { role?: unknown }).role === "service_role";
  } catch {
    return false;
  }
}

/** Order matters for overlaps: earlier patterns win when two matches start at the same place. */
const PATTERNS: Pattern[] = [
  { kind: "private-key", regex: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----/g },
  { kind: "anthropic-key", regex: /\bsk-ant-[A-Za-z0-9_-]{20,}/g, accept: looksRandom },
  { kind: "openai-key", regex: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/g, accept: looksRandom },
  { kind: "stripe-secret", regex: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/g },
  { kind: "aws-access-key", regex: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { kind: "github-token", regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/g },
  { kind: "github-token", regex: /\bgithub_pat_[A-Za-z0-9_]{30,}\b/g },
  { kind: "slack-token", regex: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  {
    kind: "supabase-service-role",
    regex: /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g,
    accept: isServiceRoleJwt,
  },
];

interface RawMatch {
  kind: string;
  index: number;
  value: string;
}

function scan(text: string): RawMatch[] {
  const raw: RawMatch[] = [];
  for (const { kind, regex, accept } of PATTERNS) {
    for (const m of text.matchAll(regex)) {
      if (accept && !accept(m[0])) continue;
      raw.push({ kind, index: m.index, value: m[0] });
    }
  }
  // Keep the first (then longest) match and drop anything overlapping it.
  raw.sort((a, b) => a.index - b.index || b.value.length - a.value.length);
  const kept: RawMatch[] = [];
  let end = -1;
  for (const m of raw) {
    if (m.index < end) continue;
    kept.push(m);
    end = m.index + m.value.length;
  }
  return kept;
}

/** Replacement kind of registered literal secrets (test-account passwords, session values). */
const LITERAL_KIND = "account-secret";
/** Replacement kind of registered account usernames (registerAccountUsernames). */
const USERNAME_KIND = "account-username";

/** Registered literal secrets and how many registrations hold each (registerSecretLiterals). Matched as written. */
const literals = new Map<string, number>();
/** Registered usernames (lowercased) and how many registrations hold each. Matched in any letter case. */
const usernames = new Map<string, number>();
/** The registered values, longest first; rebuilt when a registration changes. */
let literalList: string[] = [];
/** One case-insensitive pattern per registered username form, longest first. */
let usernamePatterns: RegExp[] = [];

type Span = { kind: string; start: number; end: number };

/** Every place a registered literal occurs in `text`, overlapping occurrences included. */
function literalMatches(text: string): RawMatch[] {
  const out: RawMatch[] = [];
  if (literalList.length === 0 || text.length === 0) return out;
  for (const value of literalList) {
    for (let at = text.indexOf(value); at !== -1; at = text.indexOf(value, at + 1)) out.push({ kind: LITERAL_KIND, index: at, value });
  }
  return out;
}

/** Every place a registered username occurs in `text`, in any letter case, overlapping occurrences included. */
function usernameMatches(text: string): RawMatch[] {
  const out: RawMatch[] = [];
  if (usernamePatterns.length === 0 || text.length === 0) return out;
  for (const pattern of usernamePatterns) {
    pattern.lastIndex = 0;
    for (let m = pattern.exec(text); m !== null; m = pattern.exec(text)) {
      out.push({ kind: USERNAME_KIND, index: m.index, value: m[0] });
      pattern.lastIndex = m.index + 1;
    }
  }
  return out;
}

/** How strongly a merged span's kind wins over another's: a password beats a username beats a pattern. */
function rank(kind: string): number {
  return kind === LITERAL_KIND ? 2 : kind === USERNAME_KIND ? 1 : 0;
}

/** Overlapping spans merged into one, keeping the strongest kind (rank). In text order. */
function mergeSpans(spans: Span[]): Span[] {
  const all = [...spans].sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: Span[] = [];
  for (const span of all) {
    const last = merged[merged.length - 1];
    if (last && span.start < last.end) {
      last.end = Math.max(last.end, span.end);
      if (rank(span.kind) > rank(last.kind)) last.kind = span.kind;
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

const toSpan = ({ kind, index, value }: RawMatch): Span => ({ kind, start: index, end: index + value.length });

/**
 * What redactSecrets replaces: the pattern matches (scan), every occurrence of a registered literal and every
 * registered username, with overlapping spans merged into one, so no fragment of either survives. A merged span that
 * holds a literal is an "account-secret", else one that holds a username an "account-username"; one made of pattern
 * matches only keeps its pattern's kind. In text order.
 */
function redactionSpans(text: string): Span[] {
  const patterns = scan(text).map(toSpan);
  const found = outsideMarkers(text, [...literalMatches(text), ...usernameMatches(text)]);
  if (found.length === 0) return patterns;
  return mergeSpans([...patterns, ...found.map(toSpan)]);
}

/** A marker redactSecrets wrote. */
const MARKER = /\[REDACTED:[a-z0-9-]+\]/g;

/**
 * The matches that are not inside a marker redactSecrets already wrote: a username "user" or a password "secret" must
 * not be found again in "[REDACTED:account-username]", or redacting twice would nest markers.
 */
function outsideMarkers(text: string, found: RawMatch[]): RawMatch[] {
  if (found.length === 0 || !text.includes("[REDACTED:")) return found;
  const markers = [...text.matchAll(MARKER)].map((m) => ({ start: m.index, end: m.index + m[0].length }));
  return found.filter((f) => !markers.some((m) => f.index >= m.start && f.index + f.value.length <= m.end));
}

/**
 * Start and end offsets of every span redactSecrets replaces, in text order: the secrets findSecrets reports and,
 * while any are registered, the literal secrets of registerSecretLiterals (kind "account-secret", merged with any
 * pattern match they overlap).
 */
export function secretSpans(text: string): { kind: string; start: number; end: number }[] {
  return redactionSpans(text);
}

function replaceSpans(text: string, spans: Span[]): string {
  let out = text;
  for (const span of [...spans].reverse()) {
    out = `${out.slice(0, span.start)}[REDACTED:${span.kind}]${out.slice(span.end)}`;
  }
  return out;
}

/**
 * Finds secret-looking values. Publishable keys (Stripe pk_, Supabase anon JWTs, Firebase apiKey) are NOT secrets.
 * A JWT counts as a secret only when its payload has role "service_role". Registered literals are not reported here:
 * they are known values to hide, not findings.
 */
export function findSecrets(text: string): SecretMatch[] {
  return scan(text).map(({ kind, index, value }) => ({
    kind,
    index,
    preview: `${value.slice(0, 4)}…(${value.length} chars)`,
  }));
}

/**
 * Replaces every value findSecrets would report with "[REDACTED:<kind>]", and every registered literal secret with
 * "[REDACTED:account-secret]" (overlapping matches become one marker, so no part of either is left).
 */
export function redactSecrets(text: string): string {
  return replaceSpans(text, redactionSpans(text));
}

/**
 * Replaces only the registered literal secrets (passwords and session values) with "[REDACTED:account-secret]":
 * no pattern secrets, no usernames. For a plan's address fields (selectors, URLs, link targets), which must keep
 * working: a session id in a link is never needed to find anything, a username in a selector may be.
 */
export function redactAccountSecrets(text: string): string {
  const found = outsideMarkers(text, literalMatches(text));
  return found.length === 0 ? text : replaceSpans(text, mergeSpans(found.map(toSpan)));
}

/** A deep copy of any JSON-like value with redactSecrets applied to every string (object keys included). */
export function redactDeep<T>(value: T): T {
  if (typeof value === "string") return redactSecrets(value) as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v)) as T;
  if (value && typeof value === "object" && !Buffer.isBuffer(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[redactSecrets(k)] = redactDeep(v);
    return out as T;
  }
  return value;
}

/** Shortest value registerSecretLiterals accepts: shorter ones would redact ordinary text. */
const MIN_LITERAL_LENGTH = 4;
/** Shortest username registerAccountUsernames accepts (the server's usernameHider rule). */
const MIN_USERNAME_LENGTH = 3;

/** "%2f" for "%2F": percent-encodings in lowercase hex (both are valid, and servers and pages use either). */
const lowerHex = (text: string) => text.replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase());

/**
 * The forms a value takes when a page or a request carries it: as typed, URL-encoded (encodeURIComponent, where a
 * space may be "+"), form-URL-encoded (a query string from a GET form or a urlencoded body, which also encodes
 * ! ' ( ) ~), with lowercase hex as well, inside a JSON string, and HTML-escaped.
 */
function encodings(value: string): string[] {
  const forms = new Set([value]);
  const encoded = encodeURIComponent(value);
  const form = new URLSearchParams({ x: value }).toString().slice(2);
  for (const url of [encoded, encoded.replace(/%20/g, "+"), form]) {
    forms.add(url);
    forms.add(lowerHex(url));
  }
  forms.add(JSON.stringify(value).slice(1, -1));
  forms.add(value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"));
  return [...forms];
}

function rebuildLiterals(): void {
  literalList = [...literals.keys()].sort((a, b) => b.length - a.length);
  usernamePatterns = [...usernames.keys()]
    .sort((a, b) => b.length - a.length)
    .map((u) => new RegExp(u.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"));
}

/** Adds one registration of `held` to `store`, and returns the function that takes it back (once). */
function hold(store: Map<string, number>, held: Set<string>): () => void {
  for (const value of held) store.set(value, (store.get(value) ?? 0) + 1);
  if (held.size > 0) rebuildLiterals();
  let live = true;
  return () => {
    if (!live) return;
    live = false;
    for (const value of held) {
      const n = (store.get(value) ?? 0) - 1;
      if (n > 0) store.set(value, n);
      else store.delete(value);
    }
    if (held.size > 0) rebuildLiterals();
  };
}

/**
 * Registers literal secrets (0.4.0: test-account passwords and the session values sign-in produced) that
 * redactSecrets must replace with "[REDACTED:account-secret]" wherever they appear (also URL-encoded, form-encoded,
 * JSON-escaped or HTML-escaped), until the returned function unregisters them. Values shorter than 4 characters are
 * ignored (they would redact ordinary text). Registrations are independent: a value stays registered while any
 * registration that holds it is live, and calling an unregister function again does nothing.
 */
export function registerSecretLiterals(values: string[]): () => void {
  const held = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string" || value.length < MIN_LITERAL_LENGTH) continue;
    for (const form of encodings(value)) if (form.length >= MIN_LITERAL_LENGTH) held.add(form);
  }
  return hold(literals, held);
}

/**
 * Registers test-account usernames (usually emails) that redactSecrets must replace with
 * "[REDACTED:account-username]" wherever they appear, in any letter case (a page may show "Alex@…" as "alex@…") and
 * in the same encodings as registerSecretLiterals, until the returned function unregisters them. Reports, evidence,
 * specs, logs, progress events and AI prompts name accounts by label only (docs/v2-spec.md "Test accounts").
 * Usernames shorter than 3 characters are ignored. Registrations are independent, as for registerSecretLiterals.
 */
export function registerAccountUsernames(values: string[]): () => void {
  const held = new Set<string>();
  for (const value of values) {
    const name = typeof value === "string" ? value.trim() : "";
    if (name.length < MIN_USERNAME_LENGTH) continue;
    for (const form of encodings(name)) if (form.length >= MIN_USERNAME_LENGTH) held.add(form.toLowerCase());
  }
  return hold(usernames, held);
}

/**
 * The values registered right now, as they may appear on a page (registered encodings included): the literal secrets
 * and the usernames (lowercased). For hiding them in evidence images; never print them.
 */
export function registeredLiterals(): { secrets: string[]; usernames: string[] } {
  return { secrets: [...literalList], usernames: [...usernames.keys()] };
}
