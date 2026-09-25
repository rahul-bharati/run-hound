import type { AiConfig, JsonRequest, LlmClient } from "./types.js";
import { AiError } from "./types.js";
import { converseJson } from "./bedrock.js";
import { endpointHost, isRemote } from "./config.js";
import { originOf } from "./http.js";
import { ollamaChatJson } from "./ollama.js";
import { chatJson, OUT_OF_SPACE, type ChatMessage } from "./openai-compatible.js";

/** Removes a ``` / ```json fence around the whole answer. */
function stripFences(text: string): string {
  const m = /^\s*```[a-zA-Z]*\s*\n?([\s\S]*?)\n?\s*```\s*$/.exec(text);
  return (m ? m[1]! : text).trim();
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Builds the client for a resolved config. Throws AiError "not-configured" when disabled or no model, and
 * "remote-not-allowed" (before any request) when isRemote(config) && !config.allowRemote.
 * generateJson: calls ollamaChatJson (ollama, native /api/chat), chatJson (openai-compatible) or converseJson
 * (bedrock); strips ``` fences; JSON.parse; request.validate. On a parse or validation error, one retry with the
 * model's answer as an assistant message and a user message "Your answer was not valid: <error>. Answer again with
 * JSON that matches the schema." A second failure → AiError "bad-output". Errors thrown by the provider call
 * (transport, HTTP, and "bad-output" such as OUT_OF_SPACE, which would only happen again) are not retried.
 * `env` (AWS credentials for bedrock SigV4) is for tests; it defaults to process.env.
 */
export function createLlmClient(config: AiConfig, options: { env?: NodeJS.ProcessEnv } = {}): LlmClient {
  if (!config.enabled) throw new AiError("not-configured", "AI is off");
  if (!config.model) throw new AiError("not-configured", "Choose a model");
  if (isRemote(config) && !config.allowRemote) {
    throw new AiError("remote-not-allowed", `Sending page structure to ${endpointHost(config)} needs your consent`);
  }
  const env = options.env ?? process.env;
  const call = (messages: ChatMessage[], schema: { name: string; schema: Record<string, unknown> }, signal?: AbortSignal) =>
    config.provider === "bedrock"
      ? converseJson(config, messages, schema, signal, env)
      : config.provider === "ollama"
        ? ollamaChatJson(config, messages, schema, signal)
        : chatJson(config, messages, schema, signal);

  return {
    provider: config.provider,
    model: config.model,
    async generateJson<T>(request: JsonRequest<T>): Promise<T> {
      const schema = { name: request.name, schema: request.schema };
      const messages: ChatMessage[] = [
        { role: "system", content: request.system },
        { role: "user", content: request.user },
      ];
      let lastError = "";
      for (let attempt = 0; attempt < 2; attempt++) {
        const answer = await call(messages, schema, request.signal);
        try {
          return request.validate(JSON.parse(stripFences(answer)));
        } catch (error) {
          lastError = messageOf(error).replace(/\.+$/, "");
          messages.push(
            { role: "assistant", content: answer },
            { role: "user", content: `Your answer was not valid: ${lastError}. Answer again with JSON that matches the schema.` },
          );
        }
      }
      throw new AiError("bad-output", `The model's answer was not valid twice: ${lastError}`);
    },
  };
}

/** Plain-language text for a failed connection test. Never includes the key. */
function explain(error: unknown, config: AiConfig): string {
  if (!(error instanceof AiError)) return messageOf(error);
  const where = config.provider === "bedrock" ? endpointHost(config) : originOf(config.baseUrl);
  switch (error.code) {
    case "unreachable":
      return `Nothing is answering at ${where} — is ${config.provider === "ollama" ? "Ollama" : "the server"} running?`;
    case "timeout":
      return `${where} did not answer within ${Math.round(config.timeoutMs / 1000)} s`;
    case "auth":
      return `The server refused the credentials (HTTP ${error.status ?? "?"}); check the API key`;
    case "bad-output":
      if (error.message === OUT_OF_SPACE) return error.message;
      return `The model answered, but not with valid JSON: ${error.message}`;
    default:
      return error.message;
  }
}

interface ConnectionCheck {
  ok: boolean;
}

/**
 * The connection test behind "Test connection" and `run-hound ai test`: one tiny structured call
 * ({"ok": true}). Never throws: returns {ok, model, ms} or {ok: false, error: plain-language message}.
 */
export async function testConnection(config: AiConfig, options: { env?: NodeJS.ProcessEnv } = {}): Promise<{ ok: true; model: string; ms: number } | { ok: false; error: string }> {
  const started = Date.now();
  try {
    const client = createLlmClient(config, options);
    await client.generateJson<ConnectionCheck>({
      name: "connection_test",
      system: "You are a connection test. Answer with JSON only.",
      user: 'Answer {"ok": true}.',
      schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false },
      validate(value) {
        if (typeof value !== "object" || value === null || typeof (value as ConnectionCheck).ok !== "boolean") throw new Error('expected {"ok": true}');
        return value as ConnectionCheck;
      },
    });
    return { ok: true, model: config.model, ms: Date.now() - started };
  } catch (error) {
    return { ok: false, error: explain(error, config) };
  }
}
