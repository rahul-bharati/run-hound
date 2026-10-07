/**
 * Fixed values for the AI feature: the set of supported providers, default endpoints per provider, and the notice the
 * Settings page shows when a saved API key is dropped because the endpoint changed.
 */
import type { AiProvider } from "../ai/types.js";

/** In the order Settings lists them: the bring-your-own-key providers first, Ollama (opt-in) last. */
export const AI_PROVIDERS: readonly AiProvider[] = ["anthropic", "openai", "gemini", "bedrock", "openai-compatible", "ollama"];

/** Providers with one official endpoint: their base URL is always DEFAULT_BASE_URLS[provider], whatever is saved or set. */
export const FIXED_ENDPOINT_PROVIDERS: ReadonlySet<AiProvider> = new Set(["anthropic", "openai", "gemini"]);

/** How the UI, the CLI and messages name each provider. */
export const PROVIDER_LABELS: Record<AiProvider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  gemini: "Google Gemini",
  bedrock: "Amazon Bedrock",
  "openai-compatible": "OpenAI-compatible",
  ollama: "Ollama",
};

/** What a config saved before 0.7 (no provider in it) meant: Ollama was the default then. */
export const LEGACY_DEFAULT_PROVIDER: AiProvider = "ollama";

/** Default endpoints per provider, used when baseUrl is empty and to prefill the Settings form. */
export const DEFAULT_BASE_URLS: Record<AiProvider, string> = {
  anthropic: "https://api.anthropic.com/v1",
  openai: "https://api.openai.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  bedrock: "",
  "openai-compatible": "http://127.0.0.1:1234/v1",
  ollama: "http://127.0.0.1:11434/v1",
};

/** Set on saveAiConfig's result when a saved key was dropped because the endpoint changed. */
export const KEY_REMOVED_NOTICE = "The saved API key was removed because the endpoint changed.";

/** saveAiConfig's error when a key would be saved where secrets come from the environment only (the Docker image). */
export const KEYS_FROM_ENVIRONMENT =
  "Keys aren't saved in the Docker image: set RUNHOUND_AI_API_KEY (for Bedrock: AWS_BEARER_TOKEN_BEDROCK, or AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY) when you start the container.";

/** AiStatus.secretNotice in the Docker image when a key is still saved in plain text in `file`. */
export const plainTextKeyNotice = (file: string): string =>
  `A key is still saved in plain text in ${file}. Set it with an environment variable instead and remove it from the file.`;
