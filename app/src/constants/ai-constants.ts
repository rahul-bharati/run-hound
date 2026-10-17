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

/** The page where each provider hands out API keys (the guide in onboarding and the link in Settings → AI use this one list). */
export const AI_KEY_URLS: Partial<Record<AiProvider, string>> = {
  anthropic: "https://platform.claude.com/settings/keys",
  openai: "https://platform.openai.com/api-keys",
  gemini: "https://aistudio.google.com/apikey",
  bedrock: "https://console.aws.amazon.com/bedrock/",
};

/** Ordered patterns for one provider: the first pattern that matches any model wins. */
export interface ModelPatterns {
  /** For the main model: briefs and the agent's turns. */
  main: readonly RegExp[];
  /** For the helper model: plan review, suggested flows and explanations. */
  helper: readonly RegExp[];
}

/**
 * The model pair onboarding and Settings preselect from a provider's live model list (ai/recommend.ts). Within the first
 * pattern that matches any model, the newest match wins. A provider without an entry, or a list no pattern matches,
 * starts both selects on the first listed model. A model ID is never the only choice: the user can pick any other.
 */
export const RECOMMENDED_MODELS: Partial<Record<AiProvider, ModelPatterns>> = {
  anthropic: { main: [/opus/i, /sonnet/i], helper: [/sonnet/i, /haiku/i] },
  // From OpenAI's models page (checked 2026-10-17): the flagship tier, then the balanced tier, then the plain legacy flagships
  // for a key that has no gpt-6; the helper takes the balanced tier first, then the efficient one. Anchored, so -pro, -mini,
  // -codex, -chat-latest, realtime, audio, image and the like never match.
  openai: {
    main: [/^gpt-\d+(?:\.\d+)*-astra$/, /^gpt-\d+(?:\.\d+)*-sol$/, /^gpt-5(?:\.\d+)?$/],
    helper: [/^gpt-\d+(?:\.\d+)*-sol$/, /^gpt-\d+(?:\.\d+)*-luna$/, /^gpt-5(?:\.\d+)*-(?:terra|mini)$/],
  },
  // From Google's models page (checked 2026-10-17): ids come without the "models/" prefix. The end anchors keep -tts, -image,
  // -live and -native-audio variants out.
  gemini: {
    main: [/^gemini-\d+(?:\.\d+)*-argon$/, /^gemini-\d+(?:\.\d+)*-pro(?:-preview)?$/, /^gemini-pro-latest$/, /^gemini-\d+(?:\.\d+)*-flash(?:-preview)?$/],
    helper: [/^gemini-\d+(?:\.\d+)*-flash(?:-preview)?$/, /^gemini-\d+(?:\.\d+)*-flash-lite(?:-preview)?$/, /^gemini-flash-latest$/, /^gemini-flash-lite-latest$/],
  },
  // Claude on Bedrock: anthropic.claude-… and us.anthropic.claude-… inference profile IDs.
  bedrock: { main: [/anthropic\.claude.*opus/i, /anthropic\.claude.*sonnet/i], helper: [/anthropic\.claude.*sonnet/i, /anthropic\.claude.*haiku/i] },
};
