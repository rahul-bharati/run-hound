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

/** saveAiConfig's error when a key would be saved where secrets come from the environment only (the Docker image). */
export const KEYS_FROM_ENVIRONMENT =
  "Keys aren't saved in the Docker image: set RUNHOUND_AI_API_KEY (for Bedrock: AWS_BEARER_TOKEN_BEDROCK, or AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY) when you start the container.";

/** AiStatus.secretNotice in the Docker image when a key is still saved in plain text in `file`. */
export const plainTextKeyNotice = (file: string): string =>
  `A key is still saved in plain text in ${file}. Set it with an environment variable instead and remove it from the file.`;
