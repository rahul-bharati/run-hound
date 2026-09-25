import type { AiConfig, JsonSchema } from "./types.js";
import { AiError } from "./types.js";
import { httpError, parseBody, send } from "./http.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Why a model stopped at its length limit with nothing to show (finish_reason / done_reason "length"). */
export const OUT_OF_SPACE =
  "The model used up its output space before answering (reasoning models often spend it thinking). Choose a non-reasoning model, turn reasoning off on the server, or raise its context length.";

/** Removes a leading <think>…</think> block; an unterminated leading <think> (cut off mid-thought) leaves nothing. */
export function stripThink(content: string): string {
  if (/^\s*<think>/.test(content) && !content.includes("</think>")) return "";
  return content.replace(/^\s*<think>[\s\S]*?<\/think>\s*/, "");
}

/** Base URLs whose server rejected json_schema; they get json_object from then on. */
const jsonObjectOnly = new Set<string>();

function withSchemaInSystem(messages: ChatMessage[], schema: JsonSchema): ChatMessage[] {
  const note = `Answer with one JSON object that matches this JSON Schema exactly:\n${JSON.stringify(schema)}`;
  const i = messages.findIndex((m) => m.role === "system");
  if (i < 0) return [{ role: "system", content: note }, ...messages];
  return messages.map((m, j) => (j === i ? { ...m, content: `${m.content}\n\n${note}` } : m));
}

/**
 * POST {baseUrl}/chat/completions with `temperature: 0`, `stream: false` and
 * `response_format: {type: "json_schema", json_schema: {name, schema, strict: true}}`; `Authorization: Bearer <apiKey>`
 * when a key is set. Returns choices[0].message.content (reasoning models: strips a leading <think>…</think> block).
 * finish_reason "length" with no content left after that (empty or only thinking) → AiError "bad-output" OUT_OF_SPACE;
 * partial content on a length stop is returned for the client to judge.
 * If the server answers 400 and the body mentions response_format or json_schema, retries once with
 * `response_format: {type: "json_object"}` and the schema appended to the system message, and remembers that for
 * this baseUrl for the life of the process.
 * Errors: AiError "unreachable" (fetch failed), "timeout" (signal/timeoutMs), "auth" (401/403), "http" (other non-2xx,
 * message includes the status and the first 200 chars of the body with secrets redacted), "bad-output" (a 2xx
 * answer without a text message).
 */
export async function chatJson(
  config: Pick<AiConfig, "baseUrl" | "model" | "apiKey" | "timeoutMs">,
  messages: ChatMessage[],
  schema: { name: string; schema: JsonSchema },
  signal?: AbortSignal,
): Promise<string> {
  const base = config.baseUrl.replace(/\/+$/, "");
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
  if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;

  const post = (fallback: boolean) =>
    send(
      `${base}/chat/completions`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: config.model,
          messages: fallback ? withSchemaInSystem(messages, schema.schema) : messages,
          temperature: 0,
          stream: false,
          response_format: fallback
            ? { type: "json_object" }
            : { type: "json_schema", json_schema: { name: schema.name, schema: schema.schema, strict: true } },
        }),
      },
      config.timeoutMs,
      signal,
    );

  let response = await post(jsonObjectOnly.has(base));
  if (response.status === 400 && !jsonObjectOnly.has(base) && /response_format|json_schema/i.test(response.text)) {
    jsonObjectOnly.add(base);
    response = await post(true);
  }
  if (response.status < 200 || response.status >= 300) throw httpError(response.status, response.text);

  const choice = parseBody(response.text)?.choices?.[0];
  const content: unknown = choice?.message?.content;
  const answer = typeof content === "string" ? stripThink(content) : null;
  if (choice?.finish_reason === "length" && !answer?.trim()) throw new AiError("bad-output", OUT_OF_SPACE);
  if (answer === null) throw new AiError("bad-output", "The server's answer had no message content");
  return answer;
}
