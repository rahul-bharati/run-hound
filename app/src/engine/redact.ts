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

/** Start and end offsets of every secret findSecrets would report, in the order they appear. */
export function secretSpans(text: string): { kind: string; start: number; end: number }[] {
  return scan(text).map(({ kind, index, value }) => ({ kind, start: index, end: index + value.length }));
}

/**
 * Finds secret-looking values. Publishable keys (Stripe pk_, Supabase anon JWTs, Firebase apiKey) are NOT secrets.
 * A JWT counts as a secret only when its payload has role "service_role".
 */
export function findSecrets(text: string): SecretMatch[] {
  return scan(text).map(({ kind, index, value }) => ({
    kind,
    index,
    preview: `${value.slice(0, 4)}…(${value.length} chars)`,
  }));
}

/** Replaces every value findSecrets would report with "[REDACTED:<kind>]". */
export function redactSecrets(text: string): string {
  let out = text;
  for (const m of scan(text).reverse()) {
    out = `${out.slice(0, m.index)}[REDACTED:${m.kind}]${out.slice(m.index + m.value.length)}`;
  }
  return out;
}

/**
 * Registers literal secrets (0.4.0: test-account passwords and the session values sign-in produced) that
 * redactSecrets must replace with "[REDACTED:account-secret]" wherever they appear, until the returned function
 * unregisters them. Values shorter than 4 characters are ignored (they would redact ordinary text).
 */
export function registerSecretLiterals(values: string[]): () => void {
  void values;
  throw new Error("registerSecretLiterals is not implemented yet");
}
