import type { AiConfig, JsonSchema } from "./types.js";
import { AiError } from "./types.js";
import type { ChatMessage } from "./openai-compatible.js";
import { httpError, parseBody, send } from "./http.js";
import { signV4 } from "./sigv4.js";
import { awsProfileRegion, resolveAwsCredentials } from "./aws-credentials.js";
import { isAwsRegion } from "./config.js";

/**
 * Bedrock Converse: POST {endpoint}/model/{encodeURIComponent(model)}/converse, endpoint = baseUrl or
 * https://bedrock-runtime.{region}.amazonaws.com. System messages go to `system: [{text}]`, others to `messages`
 * as `{role, content: [{text}]}`. Structured output: one tool `{toolSpec: {name, description, inputSchema: {json:
 * schema}}}` and `toolChoice: {tool: {name}}`; returns JSON.stringify of the first toolUse.input in
 * output.message.content (the joined text blocks when the model answered without the tool, so the caller can retry).
 * `inferenceConfig: {temperature: 0}`.
 * Auth: config.apiKey (a Bedrock API key) as `Authorization: Bearer`; else SigV4 (service "bedrock") with the
 * credentials of the AWS chain (ai/aws-credentials.ts: AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN
 * from `env`, then the profile config.awsProfile / AWS_PROFILE / "default": static keys, credential_process or SSO);
 * nothing there → AiError "auth" (nothing sent to Bedrock). No config.region → the profile's region.
 * No region and no baseUrl, or SigV4 without a region → AiError "not-configured".
 * `options.home` (for ~/.aws) is for tests; it defaults to os.homedir().
 * Errors as in chatJson; a 400 whose body says the model doesn't support tool use → AiError "http" with a message
 * saying to choose a model that supports tool use.
 */
export async function converseJson(
  config: Pick<AiConfig, "baseUrl" | "model" | "apiKey" | "region" | "timeoutMs" | "awsProfile">,
  messages: ChatMessage[],
  schema: { name: string; schema: JsonSchema },
  signal?: AbortSignal,
  env: NodeJS.ProcessEnv = process.env,
  options: { home?: string } = {},
): Promise<string> {
  const aws = { env, profile: config.awsProfile ?? null, ...(options.home ? { home: options.home } : {}) };
  const region = config.region || (config.apiKey && config.baseUrl ? null : awsProfileRegion(aws));
  if (!config.baseUrl && !region) throw new AiError("not-configured", "Choose a Bedrock region");
  if (region && !isAwsRegion(region)) throw new AiError("not-configured", `"${region}" is not an AWS region, such as us-east-1`);
  const endpoint = (config.baseUrl || `https://bedrock-runtime.${region}.amazonaws.com`).replace(/\/+$/, "");
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
  } else {
    const { credentials } = await resolveAwsCredentials({ ...aws, timeoutMs: config.timeoutMs, ...(signal ? { signal } : {}) });
    if (!region) throw new AiError("not-configured", "Choose a Bedrock region");
    headers = signV4({ method: "POST", url, headers, body }, credentials, region, "bedrock");
    delete headers.host; // fetch sets the same Host itself
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
