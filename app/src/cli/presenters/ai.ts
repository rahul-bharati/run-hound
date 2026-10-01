import type { AiStatus } from "../../ai/types.js";
import { NO_CREDENTIALS } from "../../ai/aws-credentials.js";
import { formatDuration } from "../../core/format.js";

export function aiRemedy(status: AiStatus): string {
  if (status.remote && !status.allowRemote && status.problem?.includes("consent")) {
    return ` Nothing was sent. Pass --ai-allow-remote (or set RUNHOUND_AI_ALLOW_REMOTE=1) to send redacted page structure to ${status.host}, or use a local endpoint.`;
  }
  if (status.problem === "Choose a model") return " Pass --ai-model <id> or set RUNHOUND_AI_MODEL.";
  if (status.problem === NO_CREDENTIALS) return " Set RUNHOUND_AI_API_KEY (or AWS_BEARER_TOKEN_BEDROCK); set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, or save access keys in Settings; or name an AWS profile with RUNHOUND_AI_AWS_PROFILE or AWS_PROFILE. ~/.aws is read only for a named profile: set it to default to use your [default] profile.";
  return "";
}

export function aiStatusLines(status: AiStatus): string[] {
  const from = (field: keyof AiStatus["sources"]) =>
    status.sources[field] === "env" || status.sources[field] === "flag" ? ` (from ${status.sources[field]})` : "";
  const features = (
    Object.keys(status.features) as (keyof AiStatus["features"])[]
  ).filter((f) => status.features[f]);
  return [
    `AI: ${status.enabled ? "on" : "off"}${from("enabled")}`,
    `Provider: ${status.provider}${from("provider")}`,
    `Model: ${status.model || "(none)"}${from("model")}`,
    `Endpoint: ${status.baseUrl ? `${status.baseUrl}${from("baseUrl")} ` : ""}(${status.remote ? "remote" : "local"}: ${status.host})`,
    ...(status.provider === "bedrock" ? [`Region: ${status.region ?? "(none)"}${from("region")}`] : []),
    `Key: ${status.hasKey ? "set" : "not set"}${status.hasKey ? from("apiKey") : ""}`,
    ...(status.remote ? [`Consent to send to ${status.host}: ${status.allowRemote ? "yes" : "no"}${from("allowRemote")}`] : []),
    `Features: ${features.length ? features.join(", ") : "none"}${from("features")}`,
    `Timeout: ${formatDuration(status.timeoutMs)}${from("timeoutMs")}`,
    `Config file: ${status.file}`,
    status.problem ? `Problem: ${status.problem}.${aiRemedy(status)}` : "Ready.",
  ];
}

export function aiTestOk(provider: string, model: string, ms: number): string {
  return `ok: ${provider}/${model} answered in ${formatDuration(ms)}\n`;
}

export function aiTestFailed(message: string, status: AiStatus): string {
  return `run-hound: AI test failed: ${message}${aiRemedy(status)}\n`;
}
