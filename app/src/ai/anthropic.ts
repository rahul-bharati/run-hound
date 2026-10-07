import type { AiConfig, JsonSchema } from "./types.js";
import { AiError } from "./types.js";
import { PROVIDER_LABELS } from "../constants/ai-constants.js";
import { httpError, parseBody, requireKey, send } from "./http.js";
import { OUT_OF_SPACE, type ChatMessage } from "./openai-compatible.js";

/** The API version header Anthropic's Messages API requires. */
export const ANTHROPIC_VERSION = "2023-06-01";

/** Ceiling for one answer; the structured answers are small, and a model that thinks first needs the room. */
export const ANTHROPIC_MAX_TOKENS = 16000;

/**
 * Anthropic Messages: POST {baseUrl}/messages with `x-api-key`, `anthropic-version: 2023-06-01` and
 * `{model, max_tokens: 16000, system, messages: [{role, content}], output_config: {format: {type: "json_schema",
 * schema}}}` (GA structured outputs: no beta header). System messages are joined into `system` (left out when there is
 * none). No `temperature` (the newest models reject it), no forced tool (rejected on the newest models) and no prefill:
 * the conversation always ends with a user turn.
 * Returns the text of the first `text` content block (thinking blocks may come before it).
 * stop_reason "max_tokens" → AiError "bad-output" OUT_OF_SPACE; "refusal" → "bad-output" "The model refused";
 * "model_context_window_exceeded" → "bad-output"; no text block → "bad-output".
 * No key → AiError "not-configured" ("Enter your Anthropic API key"), nothing sent.
 * Errors as in chatJson: "unreachable", "timeout", "auth" (401/403), "http" (429 rate limit, 529 overloaded and other
 * non-2xx, with the API's own message, secrets redacted), "bad-output".
 */
export async function anthropicJson(
  config: Pick<AiConfig, "baseUrl" | "model" | "apiKey" | "timeoutMs">,
  messages: ChatMessage[],
  schema: { name: string; schema: JsonSchema },
  signal?: AbortSignal,
): Promise<string> {
  const apiKey = requireKey(config.apiKey, PROVIDER_LABELS.anthropic);
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const body = JSON.stringify({
    model: config.model,
    max_tokens: ANTHROPIC_MAX_TOKENS,
    ...(system ? { system } : {}),
    messages: messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content })),
    output_config: { format: { type: "json_schema", schema: schema.schema } },
  });

  const headers = { "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json", accept: "application/json" };
  const response = await send(`${config.baseUrl.replace(/\/+$/, "")}/messages`, { method: "POST", headers, body }, config.timeoutMs, signal);
  if (response.status < 200 || response.status >= 300) throw httpError(response.status, response.text, PROVIDER_LABELS.anthropic, [apiKey]);

  const answer = parseBody(response.text);
  switch (answer?.stop_reason) {
    case "max_tokens":
      throw new AiError("bad-output", OUT_OF_SPACE);
    case "refusal":
      throw new AiError("bad-output", "The model refused");
    case "model_context_window_exceeded":
      throw new AiError("bad-output", "The model reached its context window limit before it finished answering");
  }
  const content: unknown[] = Array.isArray(answer?.content) ? answer.content : [];
  const block = content.find((c: any) => c?.type === "text" && typeof c.text === "string") as { text: string } | undefined;
  if (!block) throw new AiError("bad-output", "Anthropic's answer had no text");
  return block.text;
}
