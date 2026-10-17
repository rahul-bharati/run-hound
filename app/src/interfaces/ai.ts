/**
 * Interfaces for the AI feature (canonical home for AiFlags and ResolvedAiConfig). The richer shapes (AiConfig,
 * AiStatus, AiProvider, JsonSchema, LlmClient) live in ai/types.ts, which is the canonical home of the AI's
 * wire/contract types. The fixed values (AI_PROVIDERS, DEFAULT_BASE_URLS, KEY_REMOVED_NOTICE) live in
 * constants/ai-constants.ts.
 */
import type { AiConfig, AiProvider, AiStatus, ConfigSource } from "../ai/types.js";

/** CLI flag overrides (`run --ai --ai-provider … --ai-model … --ai-helper-model … --ai-base-url … --ai-allow-remote`). */
export interface AiFlags {
  enabled?: boolean;
  provider?: AiConfig["provider"];
  model?: string;
  helperModel?: string;
  baseUrl?: string;
  allowRemote?: boolean;
}

/** What the resolveAiConfig call returns. */
export interface ResolvedAiConfig {
  config: AiConfig;
  sources: AiStatus["sources"];
  file: string;
  /**
   * Set when the file holds a key bound to another origin than the effective endpoint's (a flag or env moved it): the
   * key was not applied. `savedFor` is the key's origin, `endpoint` the current one (keyOriginFor). `fromEnvironment` is
   * a key from the environment that was not applied because the endpoint comes only from the saved ai.json (`savedFor`
   * is then empty).
   */
  staleKey?: { savedFor: string; endpoint: string; fromEnvironment?: boolean };
  /** The providers that have their own saved API key (AiStatus.savedKeys). */
  savedKeys?: AiProvider[];
  /** Set when saved keys could not be read, or (Docker) a key is still saved in plain text (AiStatus.secretNotice). */
  secretNotice?: string;
}

export type { ConfigSource };
