import type { AiConfig, JsonSchema } from "./types.js";
import { AiError } from "./types.js";
import { httpError, parseBody, send } from "./http.js";
import { OUT_OF_SPACE, stripThink, type ChatMessage } from "./openai-compatible.js";

/** Context window asked of Ollama; its default (4096) is too small for the page payload plus a reasoning model. */
export const OLLAMA_NUM_CTX = 16384;

/** "<origin>|<model>" pairs whose model rejected `think`; they are sent without it from then on. */
const noThinkControl = new Set<string>();

/** The native API root: baseUrl without trailing slashes and without a trailing /v1 (as listModels does). */
export function ollamaRoot(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
}

/**
 * Ollama's native POST <root>/api/chat (root = baseUrl minus a trailing /v1) with `stream: false`, `think: false`,
 * `format: <schema>` and `options: {temperature: 0, num_ctx: 16384}`; `Authorization: Bearer <apiKey>` when a key is
 * set. Thinking is off because a reasoning model otherwise spends the context thinking and never answers.
 * Returns message.content with a leading <think>…</think> block stripped.
 * A 400 whose error mentions "think" (the model has no thinking control) is retried once without `think`, and that is
 * remembered for this server and model for the life of the process.
 * Errors: as chatJson ("unreachable", "timeout", "auth", "http" with a redacted snippet); a 404 saying the model is
 * not found → "http" "Ollama doesn't have the model <m> — run `ollama pull <m>`"; done_reason "length" with no answer
 * → "bad-output" (OUT_OF_SPACE); a 2xx answer without a text message → "bad-output".
 */
export async function ollamaChatJson(
  config: Pick<AiConfig, "baseUrl" | "model" | "apiKey" | "timeoutMs">,
  messages: ChatMessage[],
  schema: { name: string; schema: JsonSchema },
  signal?: AbortSignal,
): Promise<string> {
  const root = ollamaRoot(config.baseUrl);
  const key = `${root}|${config.model}`;
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
  if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;

  const post = (withThink: boolean) =>
    send(
      `${root}/api/chat`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: config.model,
          messages,
          stream: false,
          ...(withThink ? { think: false } : {}),
          format: schema.schema,
          options: { temperature: 0, num_ctx: OLLAMA_NUM_CTX },
        }),
      },
      config.timeoutMs,
      signal,
    );

  let response = await post(!noThinkControl.has(key));
  if (response.status === 400 && !noThinkControl.has(key) && /think/i.test(response.text)) {
    noThinkControl.add(key);
    response = await post(false);
  }
  if (response.status === 404 && /model[\s\S]*not found/i.test(response.text)) {
    throw new AiError("http", `Ollama doesn't have the model ${config.model} — run \`ollama pull ${config.model}\``, 404);
  }
  if (response.status < 200 || response.status >= 300) throw httpError(response.status, response.text, "Ollama");

  const body = parseBody(response.text);
  const content: unknown = body?.message?.content;
  if (typeof content !== "string") throw new AiError("bad-output", "Ollama's answer had no message content");
  const answer = stripThink(content);
  if (body?.done_reason === "length" && !answer.trim()) throw new AiError("bad-output", OUT_OF_SPACE);
  return answer;
}
