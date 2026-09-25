import { redactSecrets } from "../engine/redact.js";
import { AiError } from "./types.js";

/**
 * One HTTP exchange for the providers, with the timeout and the caller's signal combined. Resolves with the status
 * and body text of any response; rejects with AiError "timeout" (aborted) or "unreachable" (fetch failed).
 */
export async function send(
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ status: number; text: string }> {
  const combined = signal ? AbortSignal.any([AbortSignal.timeout(timeoutMs), signal]) : AbortSignal.timeout(timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: combined });
    return { status: response.status, text: await response.text() };
  } catch (error) {
    if (combined.aborted) throw new AiError("timeout", `${originOf(url)} did not answer within ${Math.round(timeoutMs / 1000)} s`);
    const cause = error instanceof Error && error.cause instanceof Error ? `: ${error.cause.message}` : "";
    throw new AiError("unreachable", `Could not reach ${originOf(url)}${cause}`);
  }
}

/** AiError for a non-2xx answer: "auth" on 401/403, else "http"; the body snippet is redacted and cut to 200 chars. */
export function httpError(status: number, text: string, prefix = "The server"): AiError {
  const snippet = redactSecrets(text).replace(/\s+/g, " ").trim().slice(0, 200);
  const detail = snippet ? `: ${snippet}` : "";
  if (status === 401 || status === 403) return new AiError("auth", `${prefix} refused the credentials (HTTP ${status})${detail}`, status);
  return new AiError("http", `${prefix} answered HTTP ${status}${detail}`, status);
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
