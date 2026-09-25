import type { AiConfig, JsonSchema } from "./types.js";
import { AiError } from "./types.js";
import type { ChatMessage } from "./openai-compatible.js";
import { httpError, parseBody, send } from "./http.js";
import { signV4 } from "./sigv4.js";

/**
 * Bedrock Converse: POST {endpoint}/model/{encodeURIComponent(model)}/converse, endpoint = baseUrl or
 * https://bedrock-runtime.{region}.amazonaws.com. System messages go to `system: [{text}]`, others to `messages`
 * as `{role, content: [{text}]}`. Structured output: one tool `{toolSpec: {name, description, inputSchema: {json:
 * schema}}}` and `toolChoice: {tool: {name}}`; returns JSON.stringify of the first toolUse.input in
 * output.message.content (the joined text blocks when the model answered without the tool, so the caller can retry).
 * `inferenceConfig: {temperature: 0}`.
 * Auth: config.apiKey (a Bedrock API key) as `Authorization: Bearer`; else SigV4 (service "bedrock") with
 * AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN from `env`; else AiError "auth" (nothing sent).
 * No region and no baseUrl, or SigV4 without a region → AiError "not-configured".
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
  if (!config.baseUrl && !config.region) throw new AiError("not-configured", "Choose a Bedrock region");
  const endpoint = (config.baseUrl || `https://bedrock-runtime.${config.region}.amazonaws.com`).replace(/\/+$/, "");
  const url = `${endpoint}/model/${encodeURIComponent(config.model)}/converse`;
  const body = JSON.stringify({
    system: messages.filter((m) => m.role === "system").map((m) => ({ text: m.content })),
    messages: messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: [{ text: m.content }] })),
    toolConfig: {
      tools: [
        {
          toolSpec: {
            name: schema.name,
            description: `Give your answer as the input of this tool; it must match the ${schema.name} schema.`,
            inputSchema: { json: schema.schema },
          },
        },
      ],
      toolChoice: { tool: { name: schema.name } },
    },
    inferenceConfig: { temperature: 0 },
  });

  let headers: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
  if (config.apiKey) {
    headers.authorization = `Bearer ${config.apiKey}`;
  } else if (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) {
    if (!config.region) throw new AiError("not-configured", "Choose a Bedrock region");
    const credentials = {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      ...(env.AWS_SESSION_TOKEN ? { sessionToken: env.AWS_SESSION_TOKEN } : {}),
    };
    headers = signV4({ method: "POST", url, headers, body }, credentials, config.region, "bedrock");
    delete headers.host; // fetch sets the same Host itself
  } else {
    throw new AiError("auth", "Bedrock needs an API key or AWS access keys");
  }

  const response = await send(url, { method: "POST", headers, body }, config.timeoutMs, signal);
  if (response.status === 400 && /tool/i.test(response.text) && /support/i.test(response.text)) {
    throw new AiError("http", `${config.model} doesn't support tool use on Bedrock; choose a model that supports tool use`, 400);
  }
  if (response.status < 200 || response.status >= 300) throw httpError(response.status, response.text, "Bedrock");

  const content: unknown = parseBody(response.text)?.output?.message?.content;
  if (!Array.isArray(content)) throw new AiError("bad-output", "Bedrock's answer had no message content");
  const tool = content.find((c) => c && typeof c === "object" && c.toolUse);
  if (tool) return JSON.stringify(tool.toolUse.input);
  return content
    .map((c) => (c && typeof c.text === "string" ? c.text : ""))
    .join("")
    .trim();
}
