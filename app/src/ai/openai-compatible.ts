import type { AiConfig, JsonSchema } from "./types.js";
import { notImplemented } from "./not-implemented.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * POST {baseUrl}/chat/completions with `temperature: 0`, `stream: false` and
 * `response_format: {type: "json_schema", json_schema: {name, schema, strict: true}}`; `Authorization: Bearer <apiKey>`
 * when a key is set. Returns choices[0].message.content (reasoning models: strips a leading <think>…</think> block).
 * If the server answers 400 and the body mentions response_format or json_schema, retries once with
 * `response_format: {type: "json_object"}` and the schema appended to the system message, and remembers that for
 * this baseUrl for the life of the process.
 * Errors: AiError "unreachable" (fetch failed), "timeout" (signal/timeoutMs), "auth" (401/403), "http" (other non-2xx,
 * message includes the status and the first 200 chars of the body with secrets redacted).
 */
export async function chatJson(
  config: Pick<AiConfig, "baseUrl" | "model" | "apiKey" | "timeoutMs">,
  messages: ChatMessage[],
  schema: { name: string; schema: JsonSchema },
  signal?: AbortSignal,
): Promise<string> {
  return notImplemented("chatJson");
}
