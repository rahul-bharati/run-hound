import type { AiConfig, JsonSchema } from "./types.js";
import { AiError } from "./types.js";
import type { ChatMessage } from "./openai-compatible.js";
import { httpError, parseBody, send } from "./http.js";
import { signV4, type AwsCredentials } from "./sigv4.js";
import { awsProfileRegion, resolveAwsCredentials } from "./aws-credentials.js";
import { isAwsRegion } from "./config.js";

/** "<endpoint>|<model>" pairs whose model rejected `inferenceConfig.temperature`; they are sent without it from then on. */
const noTemperature = new Set<string>();

/** "<endpoint>|<model>" pairs whose model rejected a forced tool choice; they get `toolChoice: {auto: {}}` from then on. */
const autoToolChoice = new Set<string>();

/** A 400 about the tool choice itself ("tool_choice", "forced tool use", "specific tool"), not about tools in general. */
const TOOL_CHOICE_REJECTED = /tool[_\s-]?choice|forced\s+tool|force[sd]?\s+(?:a\s+|the\s+)?(?:specific\s+)?tool|specific\s+tool/i;

/**
 * Bedrock Converse: POST {endpoint}/model/{encodeURIComponent(model)}/converse, endpoint = baseUrl or
 * https://bedrock-runtime.{region}.amazonaws.com. System messages go to `system: [{text}]`, others to `messages`
 * as `{role, content: [{text}]}`. Structured output: one tool `{toolSpec: {name, description, inputSchema: {json:
 * schema}}}` and `toolChoice: {tool: {name}}`; returns JSON.stringify of the first toolUse.input in
 * output.message.content (the joined text blocks when the model answered without the tool, so the caller can parse
 * the JSON in it or retry). `inferenceConfig: {temperature: 0}`.
 * Models that reject those two settings are retried, once per setting, and remembered per endpoint and model for the
 * life of the process: a 400 mentioning `temperature` → again without `inferenceConfig.temperature`; a 400 saying the
 * tool choice can't be forced (Claude 5.x) → again with `toolChoice: {auto: {}}`.
 * Auth: config.apiKey (a Bedrock API key) as `Authorization: Bearer`; else SigV4 (service "bedrock") with the
 * credentials of the AWS chain (ai/aws-credentials.ts: AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN
 * from `env`, then the pair saved in the config (awsAccessKeyId / awsSecretAccessKey / awsSessionToken), then the
 * named profile config.awsProfile / AWS_PROFILE: static keys, credential_process or SSO; no implicit "default");
 * nothing there → AiError "auth" (nothing sent to Bedrock). No config.region → the named profile's region (none when
 * no profile is named: ~/.aws is not read). No region and no baseUrl, or SigV4 without a region → AiError
 * "not-configured", checked before any credential is resolved.
 * `options.home` (for ~/.aws) is for tests; it defaults to os.homedir().
 * Errors as in chatJson; a 400 whose body says the model doesn't support tool use (and isn't about the tool choice) →
 * AiError "http" with a message saying to choose a model that supports tool use.
 */
export async function converseJson(
  config: Pick<AiConfig, "baseUrl" | "model" | "apiKey" | "region" | "timeoutMs" | "awsProfile" | "awsAccessKeyId" | "awsSecretAccessKey" | "awsSessionToken">,
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
  const key = `${endpoint}|${config.model}`;
  const bodyFor = () =>
    JSON.stringify({
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
        toolChoice: autoToolChoice.has(key) ? { auto: {} } : { tool: { name: schema.name } },
      },
      ...(noTemperature.has(key) ? {} : { inferenceConfig: { temperature: 0 } }),
    });

  const base: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
  let credentials: AwsCredentials | null = null;
  if (!config.apiKey) {
    if (!region) throw new AiError("not-configured", "Choose a Bedrock region");
    const saved =
      config.awsAccessKeyId && config.awsSecretAccessKey
        ? { accessKeyId: config.awsAccessKeyId, secretAccessKey: config.awsSecretAccessKey, ...(config.awsSessionToken ? { sessionToken: config.awsSessionToken } : {}) }
        : null;
    ({ credentials } = await resolveAwsCredentials({ ...aws, saved, timeoutMs: config.timeoutMs, ...(signal ? { signal } : {}) }));
  }

  // A SigV4 signature covers the body, so every attempt is built and signed on its own.
  const post = () => {
    const body = bodyFor();
    let headers: Record<string, string>;
    if (credentials) {
      headers = signV4({ method: "POST", url, headers: base, body }, credentials, region!, "bedrock");
      delete headers.host; // fetch sets the same Host itself
    } else {
      headers = { ...base, authorization: `Bearer ${config.apiKey}` };
    }
    return send(url, { method: "POST", headers, body }, config.timeoutMs, signal);
  };

  let response = await post();
  for (let retry = 0; retry < 2 && response.status === 400; retry++) {
    if (!noTemperature.has(key) && /temperature/i.test(response.text)) noTemperature.add(key);
    else if (!autoToolChoice.has(key) && TOOL_CHOICE_REJECTED.test(response.text)) autoToolChoice.add(key);
    else break;
    response = await post();
  }
  if (response.status === 400 && /tool/i.test(response.text) && /support/i.test(response.text) && !TOOL_CHOICE_REJECTED.test(response.text)) {
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
