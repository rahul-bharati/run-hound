import { createLlmClient } from "./client.js";
import { aiStatus, isRemote, type ResolvedAiConfig } from "./config.js";
import type { AiFeatures, AiStatus, LlmClient } from "./types.js";

/** What the runner takes as RunOptions.ai: the client, whether the endpoint is remote, and which features to use. */
export interface AiSession {
  client: LlmClient;
  remote: boolean;
  features: AiFeatures;
}

/**
 * A session for a resolved config, or the plain-language reason there can't be one (AiStatus.problem, e.g. "AI is
 * off", "Choose a model", "Sending page structure to api.openai.com needs your consent"). Never sends anything.
 */
export function aiSession(resolved: ResolvedAiConfig, env: NodeJS.ProcessEnv = process.env): { session: AiSession; status: AiStatus } | { problem: string; status: AiStatus } {
  const status = aiStatus(resolved, env);
  if (status.problem) return { problem: status.problem, status };
  try {
    const client = createLlmClient(resolved.config, { env });
    return { session: { client, remote: isRemote(resolved.config), features: { ...resolved.config.features } }, status };
  } catch (error) {
    return { problem: error instanceof Error ? error.message : String(error), status };
  }
}

/** "<provider>/<model>", as shown in engine steps and reports. */
export function modelLabel(client: Pick<LlmClient, "provider" | "model">): string {
  return `${client.provider}/${client.model}`;
}
