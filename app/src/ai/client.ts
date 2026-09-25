import type { AiConfig, LlmClient } from "./types.js";
import { notImplemented } from "./not-implemented.js";

/**
 * Builds the client for a resolved config. Throws AiError "not-configured" when disabled or no model, and
 * "remote-not-allowed" (before any request) when isRemote(config) && !config.allowRemote.
 * generateJson: calls chatJson (ollama, openai-compatible) or converseJson (bedrock); strips ``` fences; JSON.parse;
 * request.validate. On a parse or validation error, one retry with the model's answer as an assistant message and a
 * user message "Your answer was not valid: <error>. Answer again with JSON that matches the schema." A second
 * failure → AiError "bad-output". Transport errors are not retried.
 * `fetchImpl`/`env` are for tests.
 */
export function createLlmClient(config: AiConfig, options: { env?: NodeJS.ProcessEnv } = {}): LlmClient {
  return notImplemented("createLlmClient");
}

/**
 * The connection test behind "Test connection" and `run-hound ai test`: one tiny structured call
 * ({"ok": true}). Never throws: returns {ok, model, ms} or {ok: false, error: plain-language message}.
 */
export async function testConnection(config: AiConfig, options: { env?: NodeJS.ProcessEnv } = {}): Promise<{ ok: true; model: string; ms: number } | { ok: false; error: string }> {
  return notImplemented("testConnection");
}
