/**
 * Fixed values for the desktop's first-launch onboarding (docs/onboarding-spec.md) and for "Delete all keys and data".
 */

/** The marker in the desktop settings folder that onboarding was finished, skipped or not needed. */
export const ONBOARDING_FILE = "onboarding.json";

/**
 * The version written into the marker. Onboarding shows again when the marker's version is lower than this, so a later
 * onboarding that must reach existing users bumps it.
 */
export const ONBOARDING_VERSION = 1;

/** What POST /api/onboarding accepts: finished with a working setup, or skipped. */
export const ONBOARDING_POSTED_OUTCOMES = ["configured", "skipped"] as const;

/** The AI settings file in a settings folder (config/ai.ts configFile). */
export const AI_SETTINGS_FILE = "ai.json";

/** The test-account settings file in a settings folder (config/accounts.ts). */
export const ACCOUNTS_SETTINGS_FILE = "accounts.json";

/** Said by POST /api/data/delete when the desktop and command line settings folders are the same folder. */
export const SHARED_FOLDER_REFUSAL =
  "Run Hound's settings folder is the command line's folder too (RUNHOUND_CONFIG_DIR is set), so it won't delete from it. Delete the saved keys with the command line, or remove the files in that folder yourself.";

/** The short guide to getting a key, shown on the key screen: numbered steps and the name on the button that opens the provider's page. */
export interface KeyGuide {
  /** "Open the Claude Console" (the page itself is AI_KEY_URLS[provider]). */
  button: string;
  steps: readonly string[];
  /** One line after the steps, or null. */
  note: string | null;
}

/**
 * The key guides, checked against the providers' own pages on 2026-10-17 (docs/onboarding-spec.md, "Key"). They name the
 * pages and buttons loosely ("API keys", "Create key"), so a console redesign doesn't make them wrong. The sentence
 * "Keep this key private. …" is added after them by the screen, naming the host the key is sent to.
 */
export const KEY_GUIDES: Readonly<Record<"anthropic" | "openai" | "gemini" | "bedrock" | "local", KeyGuide>> = {
  anthropic: {
    button: "Open the Claude Console",
    steps: [
      "Sign in to the Claude Console. Create an account if you don't have one.",
      "Open Settings, then API keys.",
      "Choose Create key, give it a name and create it.",
      "Copy the key now. It is shown only once.",
    ],
    note: "The API is prepaid: your account needs billing set up, with credits added, before the key works.",
  },
  openai: {
    button: "Open the OpenAI Platform",
    steps: [
      "Sign in to the OpenAI Platform. Create an account if you don't have one.",
      "Open API keys.",
      "Create a new secret key.",
      "Copy the key now. It is shown only once.",
    ],
    note: "Your account may need billing set up before the key works.",
  },
  gemini: {
    button: "Open Google AI Studio",
    steps: [
      "Sign in to Google AI Studio with your Google account.",
      "Open Get API key.",
      "Choose Create API key in a project.",
      "Copy the key.",
    ],
    note: "Some Gemini models need a paid account. If a model is refused, pick another one on the next screen.",
  },
  bedrock: {
    button: "Open the Amazon Bedrock console",
    steps: [
      "In the AWS console, open Amazon Bedrock and switch to the Region you want to use.",
      "Choose API keys in the left menu and generate a key. A key works only in the Region it was made in.",
      "Copy the key now. It is shown only once. Enter its Region below.",
      "Make sure the models you want are available to your account in that Region.",
    ],
    note: "Or use an AWS profile that is already set up on this computer: choose AWS profile below and type its name.",
  },
  local: {
    button: "",
    steps: [
      "Start your local server: Ollama, or LM Studio's local server (Developer tab, then Start server).",
      "Make sure it has a model: pull one in Ollama, or load one in LM Studio.",
      "Check the address below. Leave the key empty unless your server asks for one.",
    ],
    note: null,
  },
};
