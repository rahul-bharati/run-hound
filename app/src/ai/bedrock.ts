import type { AiConfig, JsonSchema } from "./types.js";
import type { ChatMessage } from "./openai-compatible.js";
import { notImplemented } from "./not-implemented.js";

/**
 * Bedrock Converse: POST {endpoint}/model/{encodeURIComponent(model)}/converse, endpoint = baseUrl or
 * https://bedrock-runtime.{region}.amazonaws.com. System messages go to `system: [{text}]`, others to `messages`
 * as `{role, content: [{text}]}`. Structured output: one tool `{toolSpec: {name, description, inputSchema: {json:
 * schema}}}` and `toolChoice: {tool: {name}}`; returns JSON.stringify of the first toolUse.input in
 * output.message.content. `inferenceConfig: {temperature: 0}`.
 * Auth: config.apiKey (a Bedrock API key) as `Authorization: Bearer`; else SigV4 (service "bedrock") with
 * AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN from `env`; else AiError "auth".
 * Errors as in chatJson; a 400 whose body says the model doesn't support tool use → AiError "http" with a message
 * saying to choose a model that supports tool use.
 */
export async function converseJson(
  config: Pick<AiConfig, "baseUrl" | "model" | "apiKey" | "region" | "timeoutMs">,
  messages: ChatMessage[],
  schema: { name: string; schema: JsonSchema },
  signal?: AbortSignal,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  return notImplemented("converseJson");
}
