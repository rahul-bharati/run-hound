import type { AiConfig, JsonSchema } from "./types.js";
import { AiError } from "./types.js";
import { PROVIDER_LABELS } from "../constants/ai-constants.js";
import { httpError, parseBody, requireKey, send } from "./http.js";
import { OUT_OF_SPACE, type ChatMessage } from "./openai-compatible.js";

/** How Google says a key is wrong: HTTP 400 (not 401) with reason API_KEY_INVALID, also for an expired key. */
export const GEMINI_INVALID_KEY = /API_KEY_INVALID|API key not valid/i;

/** The model id without a leading "models/" (the API's own name for it), for the URL path. */
export function geminiModelId(model: string): string {
  return model.replace(/^models\//, "");
}

/**
 * `schema` for Gemini's responseJsonSchema, which documents `enum` for strings and numbers only: a schema with null in
 * its enum (`{type: ["string", "null"], enum: ["a", "b", null]}`) becomes `{anyOf: [{type: "string", enum: ["a", "b"]},
 * {type: "null"}]}`, anywhere in the schema. Other keys of that schema (description, …) stay beside the anyOf. Pure:
 * the input is not changed.
 */
export function withoutNullEnums(schema: unknown): any {
  if (Array.isArray(schema)) return schema.map(withoutNullEnums);
  if (typeof schema !== "object" || schema === null) return schema;
  const node = schema as Record<string, unknown>;
  const entries = Object.entries(node).map(([key, value]) => [key, withoutNullEnums(value)] as const);
  if (!Array.isArray(node.enum) || !node.enum.includes(null)) return Object.fromEntries(entries);

  const values = node.enum.filter((v) => v !== null);
  const types = (Array.isArray(node.type) ? node.type : [node.type]).filter((t) => typeof t === "string" && t !== "null");
  const kind = types.length === 1 ? types[0] : typeof values[0] === "number" ? "number" : "string";
  const { type: _type, enum: _enum, ...rest } = Object.fromEntries(entries);
  return { ...rest, anyOf: [...(values.length ? [{ type: kind, enum: values }] : []), { type: "null" }] };
}

/**
 * Gemini generateContent: POST {baseUrl}/models/{model}:generateContent with `x-goog-api-key` (never in the URL) and
 * `{systemInstruction: {parts: [{text}]}, contents: [{role: "user" | "model", parts: [{text}]}], generationConfig:
 * {responseMimeType: "application/json", responseJsonSchema}}` (assistant turns are role "model"; the schema goes through
 * withoutNullEnums). No temperature and no maxOutputTokens. The model id may carry a "models/" prefix.
 * Returns the joined text of candidates[0].content.parts, leaving out thought parts.
 * finishReason MAX_TOKENS → AiError "bad-output" OUT_OF_SPACE; any other reason than STOP (SAFETY, RECITATION,
 * BLOCKLIST, PROHIBITED_CONTENT, SPII, LANGUAGE, OTHER, …) → "bad-output" naming it; no candidate with a
 * promptFeedback.blockReason → "bad-output" "Gemini blocked the request (<reason>)".
 * No key → AiError "not-configured" ("Enter your Google Gemini API key"), nothing sent.
 * Errors as in chatJson, and an invalid key (HTTP 400, API_KEY_INVALID) is "auth" like a 401.
 */
export async function geminiJson(
  config: Pick<AiConfig, "baseUrl" | "model" | "apiKey" | "timeoutMs">,
  messages: ChatMessage[],
  schema: { name: string; schema: JsonSchema },
  signal?: AbortSignal,
): Promise<string> {
  const apiKey = requireKey(config.apiKey, PROVIDER_LABELS.gemini);
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const body = JSON.stringify({
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents: messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
    generationConfig: { responseMimeType: "application/json", responseJsonSchema: withoutNullEnums(schema.schema) },
  });
  const url = `${config.baseUrl.replace(/\/+$/, "")}/models/${encodeURIComponent(geminiModelId(config.model))}:generateContent`;
  const headers = { "x-goog-api-key": apiKey, "content-type": "application/json", accept: "application/json" };

  const response = await send(url, { method: "POST", headers, body }, config.timeoutMs, signal);
  if (response.status < 200 || response.status >= 300) {
    throw httpError(response.status, response.text, PROVIDER_LABELS.gemini, [apiKey], GEMINI_INVALID_KEY);
  }

  const answer = parseBody(response.text);
  const candidate = answer?.candidates?.[0];
  if (!candidate) {
    const reason: unknown = answer?.promptFeedback?.blockReason;
    if (typeof reason === "string" && reason) throw new AiError("bad-output", `Gemini blocked the request (${reason})`);
    throw new AiError("bad-output", "Gemini's answer had no candidates");
  }
  const finish: unknown = candidate.finishReason;
  if (finish === "MAX_TOKENS") throw new AiError("bad-output", OUT_OF_SPACE);
  if (typeof finish === "string" && finish !== "STOP" && finish !== "FINISH_REASON_UNSPECIFIED") {
    throw new AiError("bad-output", `Gemini stopped without answering (${finish})`);
  }
  const parts: unknown[] = Array.isArray(candidate.content?.parts) ? candidate.content.parts : [];
  const text = parts.map((p: any) => (p && p.thought !== true && typeof p.text === "string" ? p.text : "")).join("");
  if (!text) throw new AiError("bad-output", "Gemini's answer had no text");
  return text;
}
