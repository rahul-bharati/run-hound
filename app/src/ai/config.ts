/**
 * Compatibility facade for the AI config: re-exports the canonical homes (config/ai.ts for declarations, operations/
 * ai-storage.ts for persistence, constants/ai-constants.ts for fixed values, interfaces/ai.ts for type aliases,
 * ai/types.ts for the AI's wire/contract types). New code should import directly from the canonical homes.
 */
export {
  DEFAULT_AI_CONFIG,
  configDir,
  configFile,
  isAwsRegion,
  keyOriginFor,
  isRemote,
  endpointHost,
} from "../config/ai.js";
export { resolveAiConfig, saveAiConfig, aiStatus } from "../operations/ai-storage.js";
export { AI_PROVIDERS, DEFAULT_BASE_URLS, KEY_REMOVED_NOTICE } from "../constants/ai-constants.js";
export type { AiFlags, ResolvedAiConfig, ConfigSource } from "../interfaces/ai.js";
