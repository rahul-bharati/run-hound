/**
 * Environment AI keys are bound to their endpoint (docs/ai-spec.md rule 7, docs/onboarding-spec.md "Environment keys
 * bound to their endpoint"). RUNHOUND_AI_API_KEY and AWS_BEARER_TOKEN_BEDROCK are sent only to a fixed provider's
 * official endpoint, to Bedrock in the configured region, or to an endpoint the same invocation sets through the
 * environment or a flag. Never to a base URL that only the saved ai.json names, which PUT /api/ai can change.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startFakeLlm, type FakeLlm } from "../../support/fake-llm.js";
import { aiStatus, resolveAiConfig, saveAiConfig } from "../../../src/ai/config.js";
import { testConnection } from "../../../src/ai/client.js";
import { createApp } from "../../../src/server/app.js";

const ENV_KEY = "env-test-key-0a9b8c7d6e5f4a3b";
const SAVED_KEY = "saved-test-key-1f2e3d4c5b6a7988";
const EVIL = "https://evil.example/v1";

let tmp: string;
let env: NodeJS.ProcessEnv;
let fake: FakeLlm;

beforeAll(async () => {
  fake = await startFakeLlm({ models: [{ id: "m" }] });
});
afterAll(async () => {
  await fake?.close();
});
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "rh-env-key-"));
  env = { RUNHOUND_CONFIG_DIR: join(tmp, "config") };
  fake.calls.length = 0;
  fake.reply({ ok: true });
});
afterEach(async () => {
  await rm(join(tmp, "config"), { recursive: true, force: true });
  await resolveAiConfig({ env, home: tmp }); // drops the redaction this test registered
  await rm(tmp, { recursive: true, force: true });
});

/** Saves what Settings would, with no key in the environment of the save. */
const savedSettings = (patch: Parameters<typeof saveAiConfig>[0]) => saveAiConfig(patch, { env, home: tmp });
const resolveWith = (extra: NodeJS.ProcessEnv = {}, flags = {}) => resolveAiConfig({ env: { ...env, ...extra }, flags, home: tmp });

describe("an environment key and a base URL saved in ai.json", () => {
  beforeEach(async () => {
    await savedSettings({ enabled: true, provider: "openai-compatible", baseUrl: EVIL, model: "m", allowRemote: true });
  });

  it("is not applied: the key resolves to none and the status asks for a key for that endpoint", async () => {
    const resolved = await resolveWith({ RUNHOUND_AI_API_KEY: ENV_KEY });
    expect(resolved.config.baseUrl).toBe(EVIL);
    expect(resolved.config.apiKey).toBeNull();
    expect(resolved.sources.apiKey).toBe("default");
    expect(resolved.staleKey).toEqual({ savedFor: "", endpoint: "https://evil.example", fromEnvironment: true });
    const status = aiStatus(resolved, env, tmp);
    expect(status.hasKey).toBe(false);
    expect(status.problem).toMatch(/enter a key for https:\/\/evil\.example/);
    expect(JSON.stringify(status)).not.toContain(ENV_KEY);
  });

  it("is applied when the same environment sets the base URL", async () => {
    const resolved = await resolveWith({ RUNHOUND_AI_API_KEY: ENV_KEY, RUNHOUND_AI_BASE_URL: EVIL });
    expect(resolved.config.apiKey).toBe(ENV_KEY);
    expect(resolved.sources.apiKey).toBe("env");
    expect(resolved.staleKey).toBeUndefined();
  });

  it("is applied when a flag sets the base URL", async () => {
    const resolved = await resolveWith({ RUNHOUND_AI_API_KEY: ENV_KEY }, { baseUrl: "https://flag.example/v1" });
    expect(resolved.config.baseUrl).toBe("https://flag.example/v1");
    expect(resolved.config.apiKey).toBe(ENV_KEY);
  });

  it("gives way to the provider's own saved key for that endpoint, which stays bound to its origin", async () => {
    await savedSettings({ apiKey: SAVED_KEY });
    const resolved = await resolveWith({ RUNHOUND_AI_API_KEY: ENV_KEY });
    expect(resolved.config.apiKey).toBe(SAVED_KEY);
    expect(resolved.sources.apiKey).toBe("file");
    expect(resolved.staleKey).toBeUndefined();
    expect(aiStatus(resolved, env, tmp).problem).toBeNull();
  });
});

describe("an environment key and an endpoint that is not only saved", () => {
  it("goes to a fixed provider's official endpoint, whatever base URL is saved", async () => {
    await savedSettings({ enabled: true, provider: "openai", model: "m", allowRemote: true });
    const resolved = await resolveWith({ RUNHOUND_AI_API_KEY: ENV_KEY });
    expect(resolved.config.baseUrl).toBe("https://api.openai.com/v1");
    expect(resolved.config.apiKey).toBe(ENV_KEY);
    expect(aiStatus(resolved, env, tmp).problem).toBeNull();
  });

  it("goes to a base URL that is the provider's own default, even when ai.json names it", async () => {
    await savedSettings({ enabled: true, provider: "ollama", baseUrl: "http://127.0.0.1:11434/v1", model: "m" });
    expect((await resolveWith({ RUNHOUND_AI_API_KEY: ENV_KEY })).config.apiKey).toBe(ENV_KEY);
  });

  it("goes to a provider's default endpoint when only the provider is saved", async () => {
    await savedSettings({ enabled: true, provider: "openai-compatible", model: "m" });
    const resolved = await resolveWith({ RUNHOUND_AI_API_KEY: ENV_KEY });
    expect(resolved.config.baseUrl).toBe("http://127.0.0.1:1234/v1");
    expect(resolved.config.apiKey).toBe(ENV_KEY);
  });

  it("goes to an endpoint set with the provider by the same environment", async () => {
    const resolved = await resolveWith({ RUNHOUND_AI: "1", RUNHOUND_AI_PROVIDER: "openai-compatible", RUNHOUND_AI_BASE_URL: EVIL, RUNHOUND_AI_API_KEY: ENV_KEY });
    expect(resolved.config.apiKey).toBe(ENV_KEY);
  });
});

describe("AWS_BEARER_TOKEN_BEDROCK", () => {
  const TOKEN = "bedrock-bearer-token-0123456789abcdef0123456789abcdef";

  it("goes to Bedrock in the configured region", async () => {
    await savedSettings({ enabled: true, provider: "bedrock", region: "us-east-1", model: "m", allowRemote: true });
    const resolved = await resolveWith({ AWS_BEARER_TOKEN_BEDROCK: TOKEN });
    expect(resolved.config.apiKey).toBe(TOKEN);
    expect(resolved.sources.apiKey).toBe("env");
  });

  it("is not sent to an endpoint override that only ai.json names", async () => {
    await savedSettings({ enabled: true, provider: "bedrock", region: "us-east-1", baseUrl: EVIL, model: "m", allowRemote: true });
    const resolved = await resolveWith({ AWS_BEARER_TOKEN_BEDROCK: TOKEN });
    expect(resolved.config.baseUrl).toBe(EVIL);
    expect(resolved.config.apiKey).toBeNull();
    expect(resolved.staleKey?.fromEnvironment).toBe(true);
    const status = aiStatus(resolved, env, tmp);
    expect(status.hasKey).toBe(false);
    expect(status.problem).toMatch(/enter a key for https:\/\/evil\.example/);
  });

  it("is sent to an endpoint override that the same environment sets", async () => {
    await savedSettings({ enabled: true, provider: "bedrock", region: "us-east-1", model: "m", allowRemote: true });
    const resolved = await resolveWith({ AWS_BEARER_TOKEN_BEDROCK: TOKEN, RUNHOUND_AI_BASE_URL: "https://vpce.example" });
    expect(resolved.config.apiKey).toBe(TOKEN);
  });
});

describe("a connection test after the base URL is changed from Settings", () => {
  it("reaches the new endpoint without the environment key", async () => {
    // The key is in the environment of the process, as in the Docker image; the endpoint is changed over the API.
    const saved = { ...process.env };
    process.env.RUNHOUND_CONFIG_DIR = join(tmp, "config");
    process.env.RUNHOUND_AI_API_KEY = ENV_KEY;
    try {
      const app = createApp({ canShowBrowser: false });
      const put = await app.request("/api/ai", {
        method: "PUT",
        headers: { "content-type": "application/json", "x-run-hound": "1" },
        body: JSON.stringify({ enabled: true, provider: "openai-compatible", baseUrl: fake.baseUrl, model: "m" }),
      });
      expect(put.status).toBe(200);
      expect(((await put.json()) as { hasKey: boolean }).hasKey).toBe(false);
      const test = await app.request("/api/ai/test", { method: "POST", headers: { "content-type": "application/json", "x-run-hound": "1" }, body: "{}" });
      expect(test.status).toBe(200);
      expect(fake.calls.length).toBeGreaterThan(0);
      for (const call of fake.calls) expect(call.headers.authorization).toBeUndefined();
      expect(JSON.stringify(fake.calls)).not.toContain(ENV_KEY);
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
      Object.assign(process.env, saved);
    }
  });

  it("sends the key to an endpoint the environment itself sets", async () => {
    const resolved = await resolveWith({ RUNHOUND_AI: "1", RUNHOUND_AI_PROVIDER: "openai-compatible", RUNHOUND_AI_BASE_URL: fake.baseUrl, RUNHOUND_AI_MODEL: "m", RUNHOUND_AI_API_KEY: ENV_KEY });
    const result = await testConnection(resolved.config, { env });
    expect(result.ok).toBe(true);
    expect(fake.calls[0]!.headers.authorization).toBe(`Bearer ${ENV_KEY}`);
  });
});
