/**
 * Live provider smoke tests (K1): one tiny structured call per provider through createLlmClient, plus one call with a
 * deliberately invalid key that must come back as AiError "auth". Run with `pnpm --filter run-hound test:live`; the
 * normal `pnpm test` never includes this folder (see vitest.config.ts) and never calls a provider.
 *
 * Keys never come from the repository or a .env file. Each provider's key is read from the environment
 * (RUNHOUND_LIVE_<PROVIDER>_KEY, in CI from GitHub Actions secrets), else from Run Hound's encrypted store
 * (`pnpm --filter run-hound live-keys set <provider>`). With no key the provider's tests are skipped, and the skipped
 * test's name says how to set one. Nothing here prints or records a key: failures show only the AiError code, status
 * and message (which the clients keep free of credentials).
 */
import { describe, expect, it } from "vitest";
import { createLlmClient } from "../../src/ai/client.js";
import { AiError, type AiConfig, type AiProvider } from "../../src/ai/types.js";
import { DEFAULT_BASE_URLS } from "../../src/constants/ai-constants.js";
import { configDir } from "../../src/config/ai.js";
import { readSecrets } from "../../src/operations/secret-store.js";

type LiveProvider = Extract<AiProvider, "anthropic" | "openai" | "gemini" | "bedrock">;

/** Cheap defaults, overridable with RUNHOUND_LIVE_<PROVIDER>_MODEL. */
const DEFAULT_MODELS: Record<LiveProvider, string> = {
  anthropic: "claude-haiku-4-5",
  openai: "gpt-6-luna",
  gemini: "gemini-3.5-flash-lite",
  bedrock: "global.anthropic.claude-haiku-4-5-20251001-v1:0",
};

const LABELS: Record<LiveProvider, string> = { anthropic: "Anthropic", openai: "OpenAI", gemini: "Gemini", bedrock: "Bedrock" };

/** Credentials as the clients take them; never logged. */
interface Credentials {
  apiKey: string | null;
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  awsSessionToken?: string;
}

const env = process.env;
const nonEmpty = (value: string | undefined): string | null => (value && value.trim() !== "" ? value.trim() : null);

/** Saved with `live-keys set`; an unreadable store is the same as no saved key. */
const stored = await readSecrets(configDir()).then(
  (read) => read.values,
  () => ({}) as Record<string, string>,
);
const fromEnvOrStore = (envName: string, storeName: string): string | null => nonEmpty(env[envName]) ?? nonEmpty(stored[storeName]);

function credentialsFor(provider: LiveProvider): Credentials | null {
  if (provider === "bedrock") {
    const token = fromEnvOrStore("RUNHOUND_LIVE_BEDROCK_TOKEN", "live.bedrock.token");
    if (token) return { apiKey: token };
    const id = nonEmpty(env.RUNHOUND_LIVE_BEDROCK_ACCESS_KEY_ID);
    const secret = nonEmpty(env.RUNHOUND_LIVE_BEDROCK_SECRET_ACCESS_KEY);
    if (id && secret) {
      const session = nonEmpty(env.RUNHOUND_LIVE_BEDROCK_SESSION_TOKEN);
      return { apiKey: null, awsAccessKeyId: id, awsSecretAccessKey: secret, ...(session ? { awsSessionToken: session } : {}) };
    }
    return null;
  }
  const key = fromEnvOrStore(`RUNHOUND_LIVE_${provider.toUpperCase()}_KEY`, `live.${provider}.key`);
  return key ? { apiKey: key } : null;
}

const HOW_TO_SET: Record<LiveProvider, string> = {
  anthropic: "set RUNHOUND_LIVE_ANTHROPIC_KEY or run pnpm live-keys set anthropic",
  openai: "set RUNHOUND_LIVE_OPENAI_KEY or run pnpm live-keys set openai",
  gemini: "set RUNHOUND_LIVE_GEMINI_KEY or run pnpm live-keys set gemini",
  bedrock:
    "set RUNHOUND_LIVE_BEDROCK_TOKEN (or RUNHOUND_LIVE_BEDROCK_ACCESS_KEY_ID and RUNHOUND_LIVE_BEDROCK_SECRET_ACCESS_KEY) or run pnpm live-keys set bedrock",
};

function configFor(provider: LiveProvider, credentials: Credentials): AiConfig {
  return {
    enabled: true,
    provider,
    baseUrl: DEFAULT_BASE_URLS[provider],
    model: nonEmpty(env[`RUNHOUND_LIVE_${provider.toUpperCase()}_MODEL`]) ?? DEFAULT_MODELS[provider],
    apiKey: credentials.apiKey,
    region: provider === "bedrock" ? (nonEmpty(env.RUNHOUND_LIVE_BEDROCK_REGION) ?? "us-east-1") : null,
    awsAccessKeyId: credentials.awsAccessKeyId ?? null,
    awsSecretAccessKey: credentials.awsSecretAccessKey ?? null,
    awsSessionToken: credentials.awsSessionToken ?? null,
    allowRemote: true,
    features: { review: false, suggest: false, explain: false },
    timeoutMs: 60_000,
  };
}

interface Smoke {
  answer: string;
  n: number;
}

/** Strict-compatible: every property required, additionalProperties false, no limits. */
const request = {
  name: "live_smoke",
  system: "Answer with JSON only.",
  user: "Return answer 'ok' and n 2.",
  schema: {
    type: "object",
    properties: { answer: { type: "string" }, n: { type: "integer" } },
    required: ["answer", "n"],
    additionalProperties: false,
  },
  validate(value: unknown): Smoke {
    const v = value as Partial<Smoke> | null;
    if (typeof v !== "object" || v === null || typeof v.answer !== "string" || typeof v.n !== "number") {
      throw new Error('expected {"answer": "ok", "n": 2}');
    }
    if (v.answer.trim().toLowerCase() !== "ok" || v.n !== 2) throw new Error('expected answer "ok" and n 2');
    return { answer: v.answer, n: v.n };
  },
};

/**
 * What a failed live call reports. Never the provider's message for an auth failure: some providers echo a masked copy
 * of the key ("sk-pr**...-key") in it. Anything else is shown with the key itself removed.
 */
function describeFailure(error: unknown, credentials: Credentials): string {
  if (!(error instanceof AiError)) return "failed with an error that is not an AiError";
  const status = error.status === undefined ? "" : ` (HTTP ${error.status})`;
  if (error.code === "auth") return `auth${status}: the provider refused the test credentials`;
  const secrets = [credentials.apiKey, credentials.awsAccessKeyId, credentials.awsSecretAccessKey, credentials.awsSessionToken].filter(Boolean) as string[];
  const message = secrets.reduce((text, secret) => text.split(secret).join("[key]"), error.message);
  return `${error.code}${status}: ${message.slice(0, 300)}`;
}

/** A key no provider accepts; the shape is irrelevant, the call must fail as "auth" without a credential of ours. */
const INVALID_KEY = "runhound-live-test-invalid-key";

for (const provider of ["anthropic", "openai", "gemini", "bedrock"] as const) {
  const credentials = credentialsFor(provider);
  const label = LABELS[provider];
  // Without a key the reason is in the test's name, so the report says why nothing ran.
  const skipped = `skipped: no ${label} test key (${HOW_TO_SET[provider]})`;
  const test = credentials ? it : it.skip;

  describe(`live ${provider}`, () => {
    test(credentials ? "answers one structured call" : `${skipped}: answers one structured call`, async () => {
      const client = createLlmClient(configFor(provider, credentials!));
      expect(client.provider).toBe(provider);
      const result = await client.generateJson(request).catch((error: unknown) => {
        throw new Error(`${label} call ${describeFailure(error, credentials!)}`);
      });
      expect(result).toEqual({ answer: expect.stringMatching(/^ok$/i), n: 2 });
    });

    test(credentials ? "rejects an invalid key as auth" : `${skipped}: rejects an invalid key as auth`, async () => {
      // env {}: for Bedrock nothing ambient (AWS_*) may stand in for the invalid bearer token.
      const client = createLlmClient(configFor(provider, { apiKey: INVALID_KEY }), { env: {} });
      const error = await client.generateJson(request).then(
        () => null,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(AiError);
      expect({ code: (error as AiError).code, status: (error as AiError).status }).toMatchObject({ code: "auth" });
    });
  });
}
