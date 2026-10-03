/**
 * Reusable declarations for the AI feature: defaults, validators, endpoint helpers, and the file-path helpers.
 * Persistence (resolve / save) lives in `operations/ai-storage.ts`; fixed values (provider set, default base URLs,
 * key-removed notice) live in `constants/ai-constants.ts`; type aliases (AiFlags, ResolvedAiConfig) live in
 * `interfaces/ai.ts`. App consumers should import the storage layer from `operations/ai-storage.ts` directly.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { isPrivateAddress } from "../engine/safety.js";
import type { AiConfig } from "../ai/types.js";
import { DEFAULT_BASE_URLS } from "../constants/ai-constants.js";

/**
 * AI off, provider "ollama", its default base URL, no model, no key, no AWS profile or access keys, all three features
 * on (they apply once enabled), 120 s.
 */
export const DEFAULT_AI_CONFIG: AiConfig = {
  enabled: false,
  provider: "ollama",
  baseUrl: DEFAULT_BASE_URLS.ollama,
  model: "",
  apiKey: null,
  region: null,
  awsProfile: null,
  awsAccessKeyId: null,
  awsSecretAccessKey: null,
  awsSessionToken: null,
  allowRemote: false,
  features: { review: true, suggest: true, explain: true },
  timeoutMs: 120_000,
};

/**
 * Directory of the saved config: $RUNHOUND_CONFIG_DIR, else $XDG_CONFIG_HOME/run-hound, else ~/.config/run-hound.
 * `env` defaults to process.env; `home` to os.homedir().
 */
export function configDir(env: NodeJS.ProcessEnv = process.env, home?: string): string {
  if (env.RUNHOUND_CONFIG_DIR) return env.RUNHOUND_CONFIG_DIR;
  if (env.XDG_CONFIG_HOME) return join(env.XDG_CONFIG_HOME, "run-hound");
  return join(home ?? homedir(), ".config", "run-hound");
}

/** Path of the saved AI config: <configDir>/ai.json. */
export function configFile(env: NodeJS.ProcessEnv = process.env, home?: string): string {
  return join(configDir(env, home), "ai.json");
}

/**
 * True for an AWS region name such as us-east-1, eu-central-2 or us-gov-west-1. The region becomes part of the host
 * bedrock-runtime.<region>.amazonaws.com, so anything else (e.g. "x@evil.com/") could send the key to another host.
 */
export function isAwsRegion(value: unknown): value is string {
  return typeof value === "string" && /^[a-z]{2}(-[a-z0-9]+)+-\d+$/.test(value);
}

/**
 * The origin a key is bound to and may be sent to: the base URL's origin, or for Bedrock without a base URL
 * https://bedrock-runtime.<region>.amazonaws.com. An unparsable base URL is its own string.
 */
export function keyOriginFor(config: Pick<AiConfig, "provider" | "baseUrl" | "region">): string {
  if (config.provider === "bedrock" && !config.baseUrl) return `https://bedrock-runtime.${config.region ?? "<region>"}.amazonaws.com`;
  try {
    return new URL(config.baseUrl).origin;
  } catch {
    return config.baseUrl;
  }
}

const LOCAL_NAMES = new Set(["localhost", "host.docker.internal", "host.containers.internal"]);

/**
 * True when requests would leave this machine / private network: bedrock always; otherwise when the base URL's host
 * is not "localhost", "*.localhost", "host.docker.internal", "host.containers.internal" or a literal private address
 * (engine/safety.ts isPrivateAddress). Host names are not resolved (a public name is remote); an unparsable URL is remote.
 */
export function isRemote(config: Pick<AiConfig, "provider" | "baseUrl" | "region">): boolean {
  if (config.provider === "bedrock") return true;
  let host: string;
  try {
    host = new URL(config.baseUrl).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    return true;
  }
  return !(LOCAL_NAMES.has(host) || host.endsWith(".localhost") || isPrivateAddress(host));
}

/** Host shown in consent text: base URL host (with a non-default port), or bedrock-runtime.<region>.amazonaws.com. */
export function endpointHost(config: Pick<AiConfig, "provider" | "baseUrl" | "region">): string {
  if (config.provider === "bedrock" && !config.baseUrl) return `bedrock-runtime.${config.region ?? "<region>"}.amazonaws.com`;
  try {
    return new URL(config.baseUrl).host;
  } catch {
    return config.baseUrl;
  }
}
