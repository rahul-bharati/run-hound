/**
 * Fixed values for the AI feature: the set of supported providers, default endpoints per provider, and the notice the
 * Settings page shows when a saved API key is dropped because the endpoint changed.
 */
import type { AiProvider } from "../ai/types.js";

export const AI_PROVIDERS: readonly AiProvider[] = ["ollama", "openai-compatible", "bedrock"];

/** Default endpoints per provider, used when baseUrl is empty and to prefill the Settings form. */
export const DEFAULT_BASE_URLS = {
  ollama: "http://127.0.0.1:11434/v1",
  "openai-compatible": "http://127.0.0.1:1234/v1",
  bedrock: "",
} as const;

/** Set on saveAiConfig's result when a saved key was dropped because the endpoint changed. */
export const KEY_REMOVED_NOTICE = "The saved API key was removed because the endpoint changed.";