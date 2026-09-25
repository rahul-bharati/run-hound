import type { AiConfig, AiConfigPatch, AiStatus, ConfigSource } from "./types.js";
import { notImplemented } from "./not-implemented.js";

/** Default endpoints per provider, used when baseUrl is empty and to prefill the Settings form. */
export const DEFAULT_BASE_URLS = {
  ollama: "http://127.0.0.1:11434/v1",
  "openai-compatible": "http://127.0.0.1:1234/v1",
  bedrock: "",
} as const;

/** AI off, provider "ollama", its default base URL, no model, all three features on (they apply once enabled), 120 s. */
export const DEFAULT_AI_CONFIG: AiConfig = {
  enabled: false,
  provider: "ollama",
  baseUrl: DEFAULT_BASE_URLS.ollama,
  model: "",
  apiKey: null,
  region: null,
  allowRemote: false,
  features: { review: true, suggest: true, explain: true },
  timeoutMs: 120_000,
};

/**
 * Directory of the saved config: $RUNHOUND_CONFIG_DIR, else $XDG_CONFIG_HOME/run-hound, else ~/.config/run-hound.
 * `env` defaults to process.env; `home` to os.homedir().
 */
export function configDir(env: NodeJS.ProcessEnv = process.env, home?: string): string {
  return notImplemented("configDir");
}

/** Path of the saved AI config: <configDir>/ai.json. */
export function configFile(env: NodeJS.ProcessEnv = process.env, home?: string): string {
  return notImplemented("configFile");
}

/** CLI flag overrides (`run --ai --ai-provider … --ai-model … --ai-base-url … --ai-allow-remote`). */
export interface AiFlags {
  enabled?: boolean;
  provider?: AiConfig["provider"];
  model?: string;
  baseUrl?: string;
  allowRemote?: boolean;
}

export interface ResolvedAiConfig {
  config: AiConfig;
  sources: AiStatus["sources"];
  file: string;
}

/**
 * Resolves the effective config: DEFAULT_AI_CONFIG < saved file (missing or unreadable file = defaults; a corrupt
 * file is ignored, not thrown) < env < flags.
 * Env: RUNHOUND_AI ("1"/"true"/"on" | "0"/"false"/"off"), RUNHOUND_AI_PROVIDER, RUNHOUND_AI_MODEL,
 * RUNHOUND_AI_BASE_URL, RUNHOUND_AI_API_KEY, RUNHOUND_AI_REGION, RUNHOUND_AI_ALLOW_REMOTE, RUNHOUND_AI_TIMEOUT_MS,
 * RUNHOUND_AI_FEATURES (comma list of review,suggest,explain). For bedrock, a missing key falls back to
 * AWS_BEARER_TOKEN_BEDROCK and a missing region to AWS_REGION, then AWS_DEFAULT_REGION (source "env").
 * Setting a provider (anywhere) with no base URL from the same or a later source uses that provider's default URL.
 * Unknown provider names and non-numeric timeouts are ignored (the lower source stands).
 */
export async function resolveAiConfig(options: { env?: NodeJS.ProcessEnv; flags?: AiFlags; home?: string } = {}): Promise<ResolvedAiConfig> {
  return notImplemented("resolveAiConfig");
}

/**
 * Applies a patch to the saved file (never to env/flag values: fields whose source is env or flag are rejected with
 * an Error naming the variable) and writes it with mode 0600, creating the directory. `apiKey` undefined or "" keeps
 * the saved key; null removes it. Validates: provider in AI_PROVIDERS, baseUrl empty or an http(s) URL (trailing
 * slash removed), timeoutMs 5 000–600 000. Returns the newly resolved config.
 */
export async function saveAiConfig(patch: AiConfigPatch, options: { env?: NodeJS.ProcessEnv; home?: string } = {}): Promise<ResolvedAiConfig> {
  return notImplemented("saveAiConfig");
}

/**
 * True when requests would leave this machine / private network: bedrock always; otherwise when the base URL's host
 * is not "localhost", "*.localhost", "host.docker.internal", "host.containers.internal" or a literal private address
 * (engine/safety.ts isPrivateAddress). Host names are not resolved (a public name is remote).
 */
export function isRemote(config: Pick<AiConfig, "provider" | "baseUrl" | "region">): boolean {
  return notImplemented("isRemote");
}

/** Host shown in consent text: base URL host, or bedrock-runtime.<region>.amazonaws.com. */
export function endpointHost(config: Pick<AiConfig, "provider" | "baseUrl" | "region">): string {
  return notImplemented("endpointHost");
}

/**
 * The status for the UI and CLI. `problem`, first match wins: "AI is off" (disabled), "Choose a model",
 * "Choose a Bedrock region" (bedrock without region), "Bedrock needs an API key or AWS access keys" (bedrock with no
 * apiKey and no AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY in env), "Sending page structure to <host> needs your consent"
 * (remote && !allowRemote); else null.
 */
export function aiStatus(resolved: ResolvedAiConfig, env: NodeJS.ProcessEnv = process.env): AiStatus {
  return notImplemented("aiStatus");
}

export type { ConfigSource };
