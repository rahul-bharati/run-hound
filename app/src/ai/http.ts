import { redactSecrets } from "../engine/redact.js";
import { AiError } from "./types.js";

/** What a redacted key reads as in an error message. */
const REDACTED_KEY = "[REDACTED:api-key]";

/** Request headers whose values are credentials: the configured key (as a Bearer token), session and SSO tokens. */
const CREDENTIAL_HEADER = /^(authorization|proxy-authorization|cookie)$|key|token|secret/i;

/** The credential values among `headers` (8 characters or more), each also without its "Bearer " prefix, longest first. */
function credentialValues(headers: Record<string, string>): string[] {
  const values = new Set<string>();
  for (const [name, value] of Object.entries(headers)) {
    if (!CREDENTIAL_HEADER.test(name) || typeof value !== "string") continue;
    const whole = value.trim();
    for (const v of [whole, whole.replace(/^(bearer|basic|token)\s+/i, "")]) if (v.length >= 8) values.add(v);
  }
  return [...values].sort((a, b) => b.length - a.length);
}

/** `text` with every occurrence of each literal replaced by [REDACTED:api-key]. */
function withoutLiterals(text: string, literals: string[]): string {
  let out = text;
  for (const literal of literals) if (literal) out = out.split(literal).join(REDACTED_KEY);
  return out;
}

/**
 * Key formats of the AI providers Run Hound talks to directly or through an OpenAI-compatible gateway, for error
 * text that quotes a key it was not sent in a header (redactSecrets only knows keys that must never ship to a browser,
 * and wants mixed case for sk-). Over-redacting an error snippet costs nothing; leaking a key into a report does.
 */
const PROVIDER_KEYS: [RegExp, string][] = [
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{6,}/gi, `Bearer ${REDACTED_KEY}`],
  // OpenAI and look-alikes: sk-, sk-proj-, sk-or-v1- (OpenRouter), sk-ant-, lower-case or not.
  [/\bsk-[A-Za-z0-9_-]{16,}/g, REDACTED_KEY],
  // Groq, xAI, Google AI, Hugging Face, Perplexity, Replicate, NVIDIA, Fireworks.
  [/\b(?:gsk_|xai-|hf_|pplx-|r8_|nvapi-|fw_)[A-Za-z0-9_-]{16,}/g, REDACTED_KEY],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, REDACTED_KEY],
  // Bare hex keys (Together's are 64 hex characters).
  [/\b[0-9a-f]{40,}\b/gi, REDACTED_KEY],
  // "api_key=…", "token: …", "secret": "…" of any shape.
  [/((?:api[_-]?key|access[_-]?token|token|secret|password)["']?\s*[:=]\s*["']?)[^\s"',;}&]{6,}/gi, `$1${REDACTED_KEY}`],
];

/** `text` with provider key formats replaced (PROVIDER_KEYS), after redactSecrets. */
function redactKeys(text: string): string {
  return PROVIDER_KEYS.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), redactSecrets(text));
}

/**
 * One HTTP exchange for the providers, with the timeout and the caller's signal combined. Resolves with the status
 * and body text of any response; rejects with AiError "timeout" (aborted) or "unreachable" (fetch failed).
 * The body of a non-2xx answer comes back with every credential this request sent (the configured key, a session or
 * SSO token: any authorization, cookie, *key*, *token* or *secret* header value) replaced by [REDACTED:api-key], so a
 * server that echoes the key cannot put it in an error message, a warning or a report (docs/ai-spec.md Rule 7).
 * A 2xx body is returned as it came: it is data the caller parses.
 */
export async function send(
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ status: number; text: string }> {
  const combined = signal ? AbortSignal.any([AbortSignal.timeout(timeoutMs), signal]) : AbortSignal.timeout(timeoutMs);
  const credentials = credentialValues(init.headers);
  try {
    const response = await fetch(url, { ...init, signal: combined });
    const text = await response.text();
    return { status: response.status, text: response.ok ? text : withoutLiterals(text, credentials) };
  } catch (error) {
    if (combined.aborted) throw new AiError("timeout", `${originOf(url)} did not answer within ${Math.round(timeoutMs / 1000)} s`);
    const cause = error instanceof Error && error.cause instanceof Error ? `: ${withoutLiterals(error.cause.message, credentials)}` : "";
    throw new AiError("unreachable", `Could not reach ${originOf(url)}${cause}`);
  }
}

/** The readable message of a JSON error body ({"error": {"message"}} as OpenAI, Anthropic and Google send it, {"message"} as Bedrock does), else `text` itself. */
function messageOfBody(text: string): string {
  try {
    const body = JSON.parse(text);
    const message = body?.error?.message ?? body?.message;
    if (typeof message === "string" && message.trim()) return message;
  } catch {
    // Not JSON: the text is the message.
  }
  return text;
}

/**
 * AiError for a non-2xx answer: "auth" on 401/403, else "http". The message is the JSON error body's own message when
 * it has one, else the body; with `secrets` (the configured key, when the caller passes it) removed literally, then
 * secrets and provider key formats redacted, and cut to 200 chars.
 * `authOn400`: a 400 whose body matches it is an "auth" error too (Google answers an invalid key with HTTP 400).
 */
export function httpError(status: number, text: string, prefix = "The server", secrets: string[] = [], authOn400?: RegExp): AiError {
  const snippet = redactKeys(withoutLiterals(messageOfBody(text), secrets.filter((s) => s.length >= 4))).replace(/\s+/g, " ").trim().slice(0, 200);
  const detail = snippet ? `: ${snippet}` : "";
  if (status === 401 || status === 403 || (status === 400 && authOn400?.test(text))) {
    return new AiError("auth", `${prefix} refused the credentials (HTTP ${status})${detail}`, status);
  }
  return new AiError("http", `${prefix} answered HTTP ${status}${detail}`, status);
}

/** The key of a provider that cannot answer without one, or AiError "not-configured" ("Enter your Anthropic API key"); nothing is sent without it. */
export function requireKey(apiKey: string | null | undefined, provider: string): string {
  if (!apiKey) throw new AiError("not-configured", `Enter your ${provider} API key`);
  return apiKey;
}

/** Parses a JSON response body, or rejects with AiError "bad-output". */
export function parseBody(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    throw new AiError("bad-output", "The server's answer was not JSON");
  }
}

export function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}
