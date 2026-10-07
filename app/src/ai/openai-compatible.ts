import type { AiConfig, JsonSchema } from "./types.js";
import { AiError } from "./types.js";
import { PROVIDER_LABELS } from "../constants/ai-constants.js";
import { httpError, parseBody, requireKey, send } from "./http.js";
import { oneLine } from "./schema.js";

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

/** Base URLs whose server rejected `temperature`; they are sent without it from then on. */
const noTemperature = new Set<string>();

function withSchemaInSystem(messages: ChatMessage[], schema: JsonSchema): ChatMessage[] {
  const note = `Answer with one JSON object that matches this JSON Schema exactly:\n${JSON.stringify(schema)}`;
  const i = messages.findIndex((m) => m.role === "system");
  if (i < 0) return [{ role: "system", content: note }, ...messages];
  return messages.map((m, j) => (j === i ? { ...m, content: `${m.content}\n\n${note}` } : m));
}

/**
 * POST {baseUrl}/chat/completions with `stream: false` and
 * `response_format: {type: "json_schema", json_schema: {name, schema, strict: true}}`; `Authorization: Bearer <apiKey>`
 * when a key is set. Never sends `max_tokens`. Returns choices[0].message.content (reasoning models: strips a leading
 * <think>…</think> block).
 * `temperature: 0` for openai-compatible servers and local models; never for provider "openai", whose reasoning models
 * reject it. If any other server answers 400 and the body mentions `temperature`, retries once without it and remembers
 * that for this baseUrl for the life of the process.
 * Provider "openai" without a key → AiError "not-configured" ("Enter your OpenAI API key"), nothing sent.
 * If the server answers 400 and the body mentions response_format or json_schema, retries once with
 * `response_format: {type: "json_object"}` and the schema appended to the system message, and remembers that for
 * this baseUrl for the life of the process.
 * choices[0].message.refusal set → AiError "bad-output" "The model refused: <refusal>".
 * finish_reason "length" with no content left after that (empty or only thinking) → AiError "bad-output" OUT_OF_SPACE;
 * partial content on a length stop is returned for the client to judge.
 * Errors: AiError "unreachable" (fetch failed), "timeout" (signal/timeoutMs), "auth" (401/403), "http" (other non-2xx,
 * message includes the status and the first 200 chars of the body with secrets redacted), "bad-output" (a 2xx
 * answer without a text message).
 */
export async function chatJson(
  config: Pick<AiConfig, "baseUrl" | "model" | "apiKey" | "timeoutMs"> & Partial<Pick<AiConfig, "provider">>,
  messages: ChatMessage[],
  schema: { name: string; schema: JsonSchema },
  signal?: AbortSignal,
): Promise<string> {
  const base = config.baseUrl.replace(/\/+$/, "");
  const official = config.provider === "openai";
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
  if (official) headers.authorization = `Bearer ${requireKey(config.apiKey, PROVIDER_LABELS.openai)}`;
  else if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;

  // The flags are read when each request is built, so a retry picks up what the last answer taught.
  const post = () => {
    const fallback = jsonObjectOnly.has(base);
    return send(
      `${base}/chat/completions`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: config.model,
          messages: fallback ? withSchemaInSystem(messages, schema.schema) : messages,
          ...(official || noTemperature.has(base) ? {} : { temperature: 0 }),
          stream: false,
          response_format: fallback
            ? { type: "json_object" }
            : { type: "json_schema", json_schema: { name: schema.name, schema: schema.schema, strict: true } },
        }),
      },
      config.timeoutMs,
      signal,
    );
  };

  let response = await post();
  // One retry per thing the server can reject (temperature, json_schema), each remembered for this base URL.
  for (let retry = 0; retry < 2 && response.status === 400; retry++) {
    if (!official && !noTemperature.has(base) && /temperature/i.test(response.text)) noTemperature.add(base);
    else if (!jsonObjectOnly.has(base) && /response_format|json_schema/i.test(response.text)) jsonObjectOnly.add(base);
    else break;
    response = await post();
  }
  if (response.status < 200 || response.status >= 300) {
    throw httpError(response.status, response.text, official ? PROVIDER_LABELS.openai : "The server", config.apiKey ? [config.apiKey] : []);
  }

  const choice = parseBody(response.text)?.choices?.[0];
  const refusal: unknown = choice?.message?.refusal;
  if (typeof refusal === "string" && refusal.trim()) throw new AiError("bad-output", `The model refused: ${oneLine(refusal, 200)}`);
  const content: unknown = choice?.message?.content;
  const answer = typeof content === "string" ? stripThink(content) : null;
  if (choice?.finish_reason === "length" && !answer?.trim()) throw new AiError("bad-output", OUT_OF_SPACE);
  if (answer === null) throw new AiError("bad-output", "The server's answer had no message content");
  return answer;
}
