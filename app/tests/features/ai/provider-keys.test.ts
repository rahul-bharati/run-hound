/**
 * K1 (bring your own key): no default provider, fixed endpoints for Anthropic, OpenAI and Gemini, and one API key per
 * provider, sealed in the encrypted store as "ai.key.<provider>" and bound to an origin saved in ai.json `keyOrigins`.
 * - switching provider keeps every key; a key is applied only to its own provider; `apiKey` in a patch sets (or, null,
 *   removes) the key of the provider in effect after the patch, and is refused when none is chosen;
 * - moving the SAME provider to another origin without a new key removes that provider's key, with KEY_REMOVED_NOTICE;
 * - a file saved before 0.7 without a provider means Ollama; the K0-era single key ("ai.apiKey" in the store, or a
 *   plain-text `apiKey` in the file) becomes the file's provider's own key;
 * - every saved key is registered for redaction; the Docker image (RUNHOUND_SECRETS=environment) saves no key.
 */
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { aiStatus, AI_PROVIDERS, DEFAULT_AI_CONFIG, DEFAULT_BASE_URLS, KEY_REMOVED_NOTICE, resolveAiConfig, saveAiConfig } from "../../../src/ai/config.js";
import type { AiProvider } from "../../../src/ai/types.js";
import type { AiFlags } from "../../../src/interfaces/ai.js";
import { KEYS_FROM_ENVIRONMENT, PROVIDER_LABELS } from "../../../src/constants/ai-constants.js";
import { redactSecrets } from "../../../src/engine/redact.js";
import { readSecrets, writeSecrets } from "../../../src/operations/secret-store.js";

const MARK = "[REDACTED:account-secret]";
/** Shapes no redaction pattern knows (and 16+ characters): only registration can hide them. */
const KEYS = {
  anthropic: "anthropic-test-key-7f3a9c2d41",
  openai: "openai-test-key-5b8e1d90a2c7",
  gemini: "gemini-test-key-3c6f0a48e1b9",
} as const;
const OTHER_KEY = "other-test-key-9d2e7b14c3a0";

const FIXED = ["anthropic", "openai", "gemini"] as const satisfies readonly AiProvider[];
const HOSTS: Record<(typeof FIXED)[number], string> = {
  anthropic: "api.anthropic.com",
  openai: "api.openai.com",
  gemini: "generativelanguage.googleapis.com",
};
const A = "https://api.a.example";
const B = "https://api.b.example";

let tmp: string;
let dir: string;
/** Points the config dir at the temp dir, so the real ~/.config is never touched. */
let env: NodeJS.ProcessEnv;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "runhound-provider-keys-"));
  dir = join(tmp, "config");
  env = { RUNHOUND_CONFIG_DIR: dir };
});

afterEach(async () => {
  // Leave no redaction registered for the next test: resolve an empty config.
  await rm(dir, { recursive: true, force: true });
  await resolveAiConfig({ env, home: tmp });
  await rm(tmp, { recursive: true, force: true });
});

const file = () => join(dir, "ai.json");
const aiJson = async () => JSON.parse(await readFile(file(), "utf8")) as Record<string, unknown>;
const storeValues = async (e: NodeJS.ProcessEnv = env) => (await readSecrets(dir, { env: e })).values;
const save = (patch: Parameters<typeof saveAiConfig>[0], e: NodeJS.ProcessEnv = env) => saveAiConfig(patch, { env: e, home: tmp });
const resolveWith = (options: { env?: NodeJS.ProcessEnv; flags?: AiFlags } = {}) =>
  resolveAiConfig({ env: options.env ?? env, ...(options.flags ? { flags: options.flags } : {}), home: tmp });

async function writeAiJson(value: unknown): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(file(), typeof value === "string" ? value : JSON.stringify(value), { mode: 0o644 });
}

/** The three bring-your-own-key providers, each with its own key, ending on `last`. */
async function saveThreeKeys(last: (typeof FIXED)[number] = "gemini"): Promise<void> {
  for (const provider of FIXED.filter((p) => p !== last)) await save({ enabled: true, provider, model: "m", apiKey: KEYS[provider] });
  await save({ enabled: true, provider: last, model: "m", apiKey: KEYS[last] });
}

describe("no default provider", () => {
  it("a fresh config has no provider, no endpoint and no keys", async () => {
    const r = await resolveWith();
    expect(DEFAULT_AI_CONFIG).toMatchObject({ provider: null, baseUrl: "" });
    expect(r.config).toMatchObject({ provider: null, baseUrl: "", apiKey: null, enabled: false });
    expect(r.sources.provider).toBe("default");
    expect(r.savedKeys ?? []).toEqual([]);
    const status = aiStatus(r, env, tmp);
    expect(status).toMatchObject({ provider: null, baseUrl: "", hasKey: false, remote: true, savedKeys: [] });
    await expect(stat(dir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it('says "AI is off" first, then "Choose a provider", then "Choose a model"', async () => {
    expect(aiStatus(await resolveWith(), env, tmp).problem).toBe("AI is off");
    const on = await save({ enabled: true });
    expect(aiStatus(on, env, tmp).problem).toBe("Choose a provider");
    expect(aiStatus(await save({ provider: "ollama" }), env, tmp).problem).toBe("Choose a model");
    expect(aiStatus(await save({ model: "llama" }), env, tmp).problem).toBeNull();
  });

  it("saving settings without a provider does not invent one", async () => {
    const r = await save({ model: "m" });
    expect(r.config.provider).toBeNull();
    expect(await aiJson()).not.toHaveProperty("provider");
  });

  it("an empty or provider-less, setting-less file has no provider either", async () => {
    await writeAiJson({});
    expect((await resolveWith()).config.provider).toBeNull();
  });

  it("a provider from the environment or a flag is a choice", async () => {
    expect((await resolveWith({ env: { ...env, RUNHOUND_AI_PROVIDER: "gemini" } })).config).toMatchObject({ provider: "gemini", baseUrl: DEFAULT_BASE_URLS.gemini });
    expect((await resolveWith({ flags: { provider: "openai" } })).config).toMatchObject({ provider: "openai", baseUrl: DEFAULT_BASE_URLS.openai });
  });

  it("lists the six providers, Ollama last", () => {
    expect([...AI_PROVIDERS]).toEqual(["anthropic", "openai", "gemini", "bedrock", "openai-compatible", "ollama"]);
  });
});

describe("a file saved before 0.7 without a provider means Ollama", () => {
  it("resolves to Ollama and its default endpoint", async () => {
    await writeAiJson({ enabled: true, model: "llama3" });
    const r = await resolveWith();
    expect(r.config).toMatchObject({ provider: "ollama", baseUrl: DEFAULT_BASE_URLS.ollama, model: "llama3" });
    expect(aiStatus(r, env, tmp).problem).toBeNull();
  });

  it("keeps the saved base URL", async () => {
    await writeAiJson({ enabled: true, model: "llama3", baseUrl: "http://127.0.0.1:9999/v1" });
    expect((await resolveWith()).config).toMatchObject({ provider: "ollama", baseUrl: "http://127.0.0.1:9999/v1" });
  });

  it("gives way to a provider set by the environment or a flag", async () => {
    await writeAiJson({ enabled: true, model: "llama3" });
    expect((await resolveWith({ env: { ...env, RUNHOUND_AI_PROVIDER: "anthropic" } })).config.provider).toBe("anthropic");
    expect((await resolveWith({ flags: { provider: "openai" } })).config.provider).toBe("openai");
  });

  it("writes provider: ollama into the file the next time it is saved", async () => {
    await writeAiJson({ enabled: true, model: "llama3" });
    const r = await save({ model: "llama3.2" });
    expect(r.config).toMatchObject({ provider: "ollama", model: "llama3.2" });
    expect(await aiJson()).toMatchObject({ provider: "ollama", model: "llama3.2" });
  });

  it("a key saved at the same time goes to Ollama", async () => {
    await writeAiJson({ enabled: true, model: "llama3" });
    const r = await save({ apiKey: "placeholder-key-ollama" });
    expect(r.config.apiKey).toBe("placeholder-key-ollama");
    expect(r.savedKeys).toEqual(["ollama"]);
    expect(await storeValues()).toEqual({ "ai.key.ollama": "placeholder-key-ollama" });
  });

  it("an explicit provider in the file is never replaced by Ollama", async () => {
    await writeAiJson({ enabled: true, provider: "anthropic", model: "m" });
    expect((await resolveWith()).config.provider).toBe("anthropic");
    await save({ model: "m2" });
    expect(await aiJson()).toMatchObject({ provider: "anthropic" });
  });
});

describe("fixed endpoints: Anthropic, OpenAI and Gemini", () => {
  it.each(FIXED)("%s resolves to its own base URL, whatever is saved", async (provider) => {
    const r = await save({ enabled: true, provider, baseUrl: "https://evil.example/v1", model: "m" });
    expect(r.config.baseUrl).toBe(DEFAULT_BASE_URLS[provider]);
    expect(aiStatus(r, env, tmp)).toMatchObject({ baseUrl: DEFAULT_BASE_URLS[provider], host: HOSTS[provider], remote: true });
    // Even a hand-edited file naming another endpoint.
    await writeAiJson({ enabled: true, provider, baseUrl: "https://evil.example/v1", model: "m" });
    expect((await resolveWith()).config.baseUrl).toBe(DEFAULT_BASE_URLS[provider]);
  });

  it.each(FIXED)("%s ignores a base URL set by the environment or a flag", async (provider) => {
    await save({ enabled: true, provider, model: "m", apiKey: KEYS[provider], allowRemote: true });
    const viaEnv = await resolveWith({ env: { ...env, RUNHOUND_AI_BASE_URL: "https://evil.example/v1" } });
    const viaFlag = await resolveWith({ flags: { baseUrl: "https://evil.example/v1" } });
    for (const r of [viaEnv, viaFlag]) {
      expect(r.config.baseUrl).toBe(DEFAULT_BASE_URLS[provider]);
      // The saved key still applies, and only to the official endpoint: it never follows the moved base URL.
      expect(r.config.apiKey).toBe(KEYS[provider]);
      expect(r.staleKey).toBeUndefined();
      expect(aiStatus(r, env, tmp)).toMatchObject({ host: HOSTS[provider], problem: null });
    }
  });

  it.each(FIXED)("%s: a provider chosen by the environment or a flag also gets the official endpoint", async (provider) => {
    await save({ model: "m" });
    expect((await resolveWith({ env: { ...env, RUNHOUND_AI_PROVIDER: provider, RUNHOUND_AI_BASE_URL: "https://evil.example/v1" } })).config.baseUrl).toBe(DEFAULT_BASE_URLS[provider]);
    expect((await resolveWith({ flags: { provider, baseUrl: "https://evil.example/v1" } })).config.baseUrl).toBe(DEFAULT_BASE_URLS[provider]);
  });

  it.each(FIXED)("%s is remote: consent is for its host, and saved with it", async (provider) => {
    const needsConsent = await save({ enabled: true, provider, model: "m", apiKey: KEYS[provider] });
    expect(aiStatus(needsConsent, env, tmp).problem).toBe(`Sending page structure to ${HOSTS[provider]} needs your consent`);
    const consented = await save({ allowRemote: true });
    expect(aiStatus(consented, env, tmp).problem).toBeNull();
    expect(await aiJson()).toMatchObject({ allowRemote: true, allowRemoteHost: HOSTS[provider] });
  });

  it("consent saved for one provider's host does not carry over to another's", async () => {
    await save({ enabled: true, provider: "anthropic", model: "m", apiKey: KEYS.anthropic, allowRemote: true });
    const r = await save({ provider: "openai", apiKey: KEYS.openai });
    expect(r.config.allowRemote).toBe(false);
    expect(aiStatus(r, env, tmp).problem).toBe("Sending page structure to api.openai.com needs your consent");
  });

  it("OpenAI-compatible and Ollama keep a configurable endpoint", async () => {
    expect((await save({ provider: "openai-compatible", baseUrl: "http://127.0.0.1:4000/v1" })).config.baseUrl).toBe("http://127.0.0.1:4000/v1");
    expect((await save({ provider: "ollama", baseUrl: "http://127.0.0.1:9999/v1" })).config.baseUrl).toBe("http://127.0.0.1:9999/v1");
  });
});

describe("the key problems", () => {
  it.each(FIXED)('%s with no key says "Enter your <Label> API key"', async (provider) => {
    const r = await save({ enabled: true, provider, model: "m" });
    expect(aiStatus(r, env, tmp)).toMatchObject({ hasKey: false, problem: `Enter your ${PROVIDER_LABELS[provider]} API key` });
  });

  it("names the three providers as Anthropic, OpenAI and Google Gemini", () => {
    expect([PROVIDER_LABELS.anthropic, PROVIDER_LABELS.openai, PROVIDER_LABELS.gemini]).toEqual(["Anthropic", "OpenAI", "Google Gemini"]);
  });

  it("asks for a model before a key, and for a key before consent", async () => {
    expect(aiStatus(await save({ enabled: true, provider: "openai" }), env, tmp).problem).toBe("Choose a model");
    expect(aiStatus(await save({ model: "m" }), env, tmp).problem).toBe("Enter your OpenAI API key");
    expect(aiStatus(await save({ apiKey: KEYS.openai }), env, tmp).problem).toBe("Sending page structure to api.openai.com needs your consent");
  });

  it("is satisfied by RUNHOUND_AI_API_KEY from the environment", async () => {
    await save({ enabled: true, provider: "anthropic", model: "m", allowRemote: true });
    const withEnvKey = { ...env, RUNHOUND_AI_API_KEY: OTHER_KEY };
    const r = await resolveWith({ env: withEnvKey });
    expect(r.config.apiKey).toBe(OTHER_KEY);
    expect(aiStatus(r, withEnvKey, tmp).problem).toBeNull();
  });

  it("another provider's saved key does not satisfy it", async () => {
    await save({ enabled: true, provider: "openai", model: "m", apiKey: KEYS.openai });
    const r = await save({ provider: "anthropic" });
    expect(r.config.apiKey).toBeNull();
    expect(aiStatus(r, env, tmp)).toMatchObject({ hasKey: false, savedKeys: ["openai"], problem: "Enter your Anthropic API key" });
  });

  it("an OpenAI-compatible or Ollama endpoint on this machine needs no key", async () => {
    const r = await save({ enabled: true, provider: "openai-compatible", baseUrl: "http://127.0.0.1:1234/v1", model: "m" });
    expect(aiStatus(r, env, tmp).problem).toBeNull();
  });
});

describe("one key per provider", () => {
  it("keeps every key while switching back and forth, and applies each only to its own provider", async () => {
    for (const provider of ["anthropic", "openai", "gemini"] as const) {
      const r = await save({ enabled: true, provider, model: "m", apiKey: KEYS[provider] });
      expect(r.config.apiKey).toBe(KEYS[provider]);
      expect(r.notice).toBeUndefined();
    }
    for (const provider of ["anthropic", "openai", "gemini", "openai", "anthropic", "gemini", "anthropic"] as const) {
      const r = await save({ provider });
      expect(r.config).toMatchObject({ provider, apiKey: KEYS[provider] });
      expect(r.sources.apiKey).toBe("file");
      expect(r.notice).toBeUndefined();
      expect(r.savedKeys).toEqual(["anthropic", "openai", "gemini"]);
    }
    expect(await storeValues()).toEqual({
      "ai.key.anthropic": KEYS.anthropic,
      "ai.key.openai": KEYS.openai,
      "ai.key.gemini": KEYS.gemini,
    });
  });

  it("applies a key to its own provider only, whichever way the provider is chosen", async () => {
    await saveThreeKeys("anthropic");
    for (const provider of FIXED) {
      expect((await resolveWith({ flags: { provider } })).config.apiKey).toBe(KEYS[provider]);
      expect((await resolveWith({ env: { ...env, RUNHOUND_AI_PROVIDER: provider } })).config.apiKey).toBe(KEYS[provider]);
    }
    // Providers without a key of their own get none, though three keys are saved.
    for (const provider of ["openai-compatible", "ollama"] as const) {
      expect((await resolveWith({ flags: { provider } })).config.apiKey).toBeNull();
    }
    expect((await resolveWith({ flags: { provider: "bedrock" } })).config.apiKey).toBeNull();
    // A provider-less config applies none.
    await writeAiJson({ keyOrigins: { anthropic: "https://api.anthropic.com" } });
    expect((await resolveWith()).config.apiKey).toBeNull();
  });

  it("an OpenAI-compatible key and an Ollama key are separate from the three", async () => {
    await save({ provider: "openai", apiKey: KEYS.openai });
    await save({ provider: "openai-compatible", baseUrl: `${A}/v1`, apiKey: OTHER_KEY });
    expect((await save({ provider: "ollama" })).config.apiKey).toBeNull();
    expect((await save({ provider: "openai-compatible", baseUrl: `${A}/v1` })).config.apiKey).toBe(OTHER_KEY);
    expect((await save({ provider: "openai" })).config.apiKey).toBe(KEYS.openai);
  });

  it("saves each key in the store, bound to the provider's origin in keyOrigins; ai.json holds no key", async () => {
    await saveThreeKeys();
    const text = await readFile(file(), "utf8");
    for (const key of Object.values(KEYS)) expect(text).not.toContain(key);
    const json = await aiJson();
    expect(json).not.toHaveProperty("apiKey");
    expect(json).not.toHaveProperty("apiKeyOrigin");
    expect(json.keyOrigins).toEqual({
      anthropic: "https://api.anthropic.com",
      openai: "https://api.openai.com",
      gemini: "https://generativelanguage.googleapis.com",
    });
    expect((await stat(file())).mode & 0o777).toBe(0o600);
    expect((await readdir(dir)).sort()).toEqual(["ai.json", "secrets.json", "secrets.key"]);
    for (const name of ["secrets.json", "secrets.key"]) {
      const sealed = await readFile(join(dir, name), "utf8");
      for (const key of Object.values(KEYS)) expect(sealed).not.toContain(key);
    }
  });

  it("savedKeys lists provider names, in the providers' order, and the status never holds a key", async () => {
    await saveThreeKeys("openai");
    const r = await resolveWith();
    expect(r.savedKeys).toEqual(["anthropic", "openai", "gemini"]);
    const status = aiStatus(r, env, tmp);
    expect(status.savedKeys).toEqual(["anthropic", "openai", "gemini"]);
    expect(status.hasKey).toBe(true);
    expect(status).not.toHaveProperty("apiKey");
    const text = JSON.stringify(status);
    for (const key of Object.values(KEYS)) expect(text).not.toContain(key);
  });

  it("removing one provider's key (null) leaves the others", async () => {
    await saveThreeKeys("openai");
    const r = await save({ apiKey: null });
    expect(r.config.apiKey).toBeNull();
    expect(r.sources.apiKey).toBe("default");
    expect(r.savedKeys).toEqual(["anthropic", "gemini"]);
    expect(r.notice).toBeUndefined();
    expect(await storeValues()).toEqual({ "ai.key.anthropic": KEYS.anthropic, "ai.key.gemini": KEYS.gemini });
    expect((await aiJson()).keyOrigins).not.toHaveProperty("openai");
    expect((await save({ provider: "anthropic" })).config.apiKey).toBe(KEYS.anthropic);
    expect((await save({ provider: "gemini" })).config.apiKey).toBe(KEYS.gemini);
    expect((await save({ provider: "openai" })).config.apiKey).toBeNull();
  });

  it("removing the last key leaves no keyOrigins and an empty store entry list", async () => {
    await save({ provider: "anthropic", model: "m", apiKey: KEYS.anthropic });
    await save({ apiKey: null });
    expect(await aiJson()).not.toHaveProperty("keyOrigins");
    expect(await storeValues()).toEqual({});
  });

  it("an empty or missing apiKey keeps the provider's key", async () => {
    await save({ provider: "openai", apiKey: KEYS.openai });
    expect((await save({ apiKey: "" })).config.apiKey).toBe(KEYS.openai);
    expect((await save({ model: "m" })).config.apiKey).toBe(KEYS.openai);
    expect((await save({ apiKey: undefined })).config.apiKey).toBe(KEYS.openai);
  });

  it("replacing a key changes only that provider's", async () => {
    await saveThreeKeys("openai");
    const r = await save({ apiKey: OTHER_KEY });
    expect(r.config.apiKey).toBe(OTHER_KEY);
    expect(await storeValues()).toEqual({ "ai.key.anthropic": KEYS.anthropic, "ai.key.openai": OTHER_KEY, "ai.key.gemini": KEYS.gemini });
  });

  it("a key sent with a provider change belongs to the new provider, not the old one", async () => {
    await save({ provider: "anthropic", apiKey: KEYS.anthropic });
    const r = await save({ provider: "gemini", apiKey: KEYS.gemini });
    expect(r.config).toMatchObject({ provider: "gemini", apiKey: KEYS.gemini });
    expect(await storeValues()).toEqual({ "ai.key.anthropic": KEYS.anthropic, "ai.key.gemini": KEYS.gemini });
  });

  it("a key with no provider in the file goes to the provider the environment chooses", async () => {
    const chosen = { ...env, RUNHOUND_AI_PROVIDER: "anthropic" };
    const r = await save({ apiKey: KEYS.anthropic }, chosen);
    expect(r.savedKeys).toEqual(["anthropic"]);
    expect(await storeValues()).toEqual({ "ai.key.anthropic": KEYS.anthropic });
  });

  it("a Bedrock key has its own slot and survives switching away and back", async () => {
    await save({ provider: "bedrock", region: "us-east-1", apiKey: "bedrock-api-key-7f3a9c2d41" });
    await save({ provider: "anthropic", apiKey: KEYS.anthropic });
    expect((await save({ provider: "bedrock" })).config.apiKey).toBe("bedrock-api-key-7f3a9c2d41");
    expect(await storeValues()).toMatchObject({ "ai.key.bedrock": "bedrock-api-key-7f3a9c2d41", "ai.key.anthropic": KEYS.anthropic });
  });

  it("a Bedrock region change rebinds Bedrock's key and leaves the other keys' origins alone", async () => {
    await save({ provider: "anthropic", apiKey: KEYS.anthropic });
    await save({ provider: "bedrock", region: "eu-central-1", apiKey: "bedrock-api-key-7f3a9c2d41" });
    const r = await save({ region: "us-east-1" });
    expect(r.config.apiKey).toBe("bedrock-api-key-7f3a9c2d41");
    expect(r.notice).toBeUndefined();
    expect((await aiJson()).keyOrigins).toEqual({
      anthropic: "https://api.anthropic.com",
      bedrock: "https://bedrock-runtime.us-east-1.amazonaws.com",
    });
  });

  it("a key saved by hand without a recorded origin is never sent", async () => {
    await save({ provider: "anthropic", apiKey: KEYS.anthropic });
    await writeAiJson({ ...(await aiJson()), keyOrigins: {} });
    const r = await resolveWith();
    expect(r.config.apiKey).toBeNull();
    expect(r.savedKeys).toEqual(["anthropic"]);
  });
});

describe("refusing a key when no provider is chosen", () => {
  it.each([KEYS.anthropic, null])("refuses apiKey %j without writing anything", async (apiKey) => {
    await expect(save({ apiKey, model: "m" })).rejects.toThrow("Choose a provider before saving an API key");
    await expect(stat(dir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses it for a provider-less file too, leaving the file as it was", async () => {
    await writeAiJson({});
    const before = await readFile(file());
    await expect(save({ apiKey: KEYS.openai })).rejects.toThrow(/Choose a provider/);
    expect(await readFile(file())).toEqual(before);
    expect(await readdir(dir)).toEqual(["ai.json"]);
  });

  it("accepts it in the same patch that chooses a provider", async () => {
    const r = await save({ provider: "openai", apiKey: KEYS.openai });
    expect(r.savedKeys).toEqual(["openai"]);
  });

  it("an empty apiKey is not a key: no refusal", async () => {
    await expect(save({ apiKey: "", model: "m" })).resolves.toMatchObject({ config: { model: "m", provider: null } });
  });
});

describe("a key does not follow the same provider to another endpoint", () => {
  const compat = { provider: "openai-compatible" as const, baseUrl: `${A}/v1`, apiKey: OTHER_KEY };

  it("removes only that provider's key, says so, and keeps the other providers' keys", async () => {
    await save({ provider: "anthropic", apiKey: KEYS.anthropic });
    await save({ provider: "gemini", apiKey: KEYS.gemini });
    await save(compat);
    const r = await save({ baseUrl: `${B}/v1` });
    expect(r.notice).toBe(KEY_REMOVED_NOTICE);
    expect(r.config.apiKey).toBeNull();
    expect(r.savedKeys).toEqual(["anthropic", "gemini"]);
    expect(await storeValues()).toEqual({ "ai.key.anthropic": KEYS.anthropic, "ai.key.gemini": KEYS.gemini });
    expect((await aiJson()).keyOrigins).not.toHaveProperty("openai-compatible");
    expect((await save({ provider: "gemini" })).config.apiKey).toBe(KEYS.gemini);
  });

  it("keeps a key moved with a new key in the same patch, rebound to the new origin, without a notice", async () => {
    await save(compat);
    const r = await save({ baseUrl: `${B}/v1`, apiKey: KEYS.openai });
    expect(r.notice).toBeUndefined();
    expect(r.config.apiKey).toBe(KEYS.openai);
    expect((await aiJson()).keyOrigins).toEqual({ "openai-compatible": B });
  });

  it("keeps the key for another path on the same origin", async () => {
    await save(compat);
    const r = await save({ baseUrl: `${A}/v2` });
    expect(r.notice).toBeUndefined();
    expect(r.config.apiKey).toBe(OTHER_KEY);
  });

  it("does not say it when the provider changes: that is not a move of the same provider", async () => {
    await save(compat);
    const r = await save({ provider: "ollama" });
    expect(r.notice).toBeUndefined();
    expect(r.savedKeys).toEqual(["openai-compatible"]);
  });

  it("says nothing when the provider had no key", async () => {
    await save({ provider: "anthropic", apiKey: KEYS.anthropic });
    await save({ provider: "openai-compatible", baseUrl: `${A}/v1` });
    const r = await save({ baseUrl: `${B}/v1` });
    expect(r.notice).toBeUndefined();
    expect(r.savedKeys).toEqual(["anthropic"]);
  });

  it("a flag or the environment pointing elsewhere hides the key for that run without deleting it", async () => {
    await save(compat);
    const r = await resolveWith({ flags: { baseUrl: `${B}/v1` } });
    expect(r.config.apiKey).toBeNull();
    expect(r.staleKey).toEqual({ savedFor: A, endpoint: B });
    expect(r.savedKeys).toEqual(["openai-compatible"]);
    expect((await resolveWith()).config.apiKey).toBe(OTHER_KEY);
  });
});

describe("keys saved before 0.7 move into the provider's own slot", () => {
  const k0 = { enabled: true, provider: "openai-compatible", baseUrl: `${A}/v1`, model: "m", allowRemote: true, allowRemoteHost: "api.a.example", apiKeyOrigin: A };

  it("the K0 store key (ai.apiKey) with its apiKeyOrigin becomes ai.key.<provider> and keyOrigins", async () => {
    await writeAiJson(k0);
    await writeSecrets(dir, { "ai.apiKey": KEYS.openai }, { env });
    const r = await resolveWith();
    expect(r.config).toMatchObject({ provider: "openai-compatible", apiKey: KEYS.openai });
    expect(r.savedKeys).toEqual(["openai-compatible"]);
    expect(await storeValues()).toEqual({ "ai.key.openai-compatible": KEYS.openai });
    const json = await aiJson();
    expect(json).not.toHaveProperty("apiKey");
    expect(json).not.toHaveProperty("apiKeyOrigin");
    expect(json).toMatchObject({ provider: "openai-compatible", baseUrl: `${A}/v1`, model: "m", allowRemote: true, keyOrigins: { "openai-compatible": A } });
    expect((await stat(file())).mode & 0o777).toBe(0o600);
    // Later resolves read it from the new place.
    expect((await resolveWith()).config.apiKey).toBe(KEYS.openai);
  });

  it("a plain-text apiKey in the file moves the same way", async () => {
    await writeAiJson({ ...k0, apiKey: KEYS.openai });
    const r = await resolveWith();
    expect(r.config.apiKey).toBe(KEYS.openai);
    expect(await storeValues()).toEqual({ "ai.key.openai-compatible": KEYS.openai });
    const json = await aiJson();
    expect(json).not.toHaveProperty("apiKey");
    expect(json).not.toHaveProperty("apiKeyOrigin");
    expect(json.keyOrigins).toEqual({ "openai-compatible": A });
    expect(await readFile(file(), "utf8")).not.toContain(KEYS.openai);
  });

  it("without an apiKeyOrigin the key is bound to the file's own endpoint", async () => {
    const { apiKeyOrigin: _drop, ...noOrigin } = k0;
    await writeAiJson({ ...noOrigin, apiKey: KEYS.openai });
    await resolveWith();
    expect((await aiJson()).keyOrigins).toEqual({ "openai-compatible": A });
    // A flag moving the endpoint does not get the key.
    expect((await resolveWith({ flags: { baseUrl: `${B}/v1` } })).config.apiKey).toBeNull();
  });

  it("a Bedrock file's key is bound to its region's endpoint", async () => {
    await writeAiJson({ enabled: true, provider: "bedrock", region: "eu-west-1", model: "m", apiKey: "bedrock-api-key-7f3a9c2d41" });
    await resolveWith();
    expect((await aiJson()).keyOrigins).toEqual({ bedrock: "https://bedrock-runtime.eu-west-1.amazonaws.com" });
    expect(await storeValues()).toEqual({ "ai.key.bedrock": "bedrock-api-key-7f3a9c2d41" });
  });

  it("a file without a provider gives its key to Ollama and gets provider: ollama written", async () => {
    await writeAiJson({ enabled: true, model: "llama3", apiKey: "legacy-ollama-key-0001" });
    expect((await resolveWith()).config).toMatchObject({ provider: "ollama", apiKey: "legacy-ollama-key-0001" });
    expect(await storeValues()).toEqual({ "ai.key.ollama": "legacy-ollama-key-0001" });
    expect(await aiJson()).toMatchObject({ provider: "ollama", model: "llama3", keyOrigins: { ollama: "http://127.0.0.1:11434" } });
    expect(await aiJson()).not.toHaveProperty("apiKey");
  });

  it("a provider-less file with the K0 store key does the same", async () => {
    await writeAiJson({ enabled: true, model: "llama3" });
    await writeSecrets(dir, { "ai.apiKey": "legacy-ollama-key-0002" }, { env });
    const r = await resolveWith();
    expect(r.config).toMatchObject({ provider: "ollama", apiKey: "legacy-ollama-key-0002" });
    expect(await storeValues()).toEqual({ "ai.key.ollama": "legacy-ollama-key-0002" });
    expect(await aiJson()).toMatchObject({ provider: "ollama", keyOrigins: { ollama: "http://127.0.0.1:11434" } });
  });

  it("a provider that already has its own key keeps it; the old key is dropped from the store", async () => {
    await writeAiJson({ ...k0, keyOrigins: { "openai-compatible": A } });
    await writeSecrets(dir, { "ai.apiKey": KEYS.openai, "ai.key.openai-compatible": OTHER_KEY }, { env });
    const r = await resolveWith();
    expect(r.config.apiKey).toBe(OTHER_KEY);
    expect(await storeValues()).toEqual({ "ai.key.openai-compatible": OTHER_KEY });
    expect(await aiJson()).not.toHaveProperty("apiKeyOrigin");
  });

  it("the old key joins the keys of other providers without touching them", async () => {
    await writeAiJson({ ...k0, keyOrigins: { anthropic: "https://api.anthropic.com" } });
    await writeSecrets(dir, { "ai.apiKey": KEYS.openai, "ai.key.anthropic": KEYS.anthropic }, { env });
    const r = await resolveWith();
    expect(r.savedKeys).toEqual(["anthropic", "openai-compatible"]);
    expect(await storeValues()).toEqual({ "ai.key.anthropic": KEYS.anthropic, "ai.key.openai-compatible": KEYS.openai });
    expect((await aiJson()).keyOrigins).toEqual({ anthropic: "https://api.anthropic.com", "openai-compatible": A });
  });

  it("saving a file that still has the old key rewrites it in the new shape", async () => {
    await writeAiJson({ ...k0, apiKey: KEYS.openai });
    const r = await save({ model: "m2" });
    expect(r.config).toMatchObject({ model: "m2", apiKey: KEYS.openai });
    expect(await storeValues()).toEqual({ "ai.key.openai-compatible": KEYS.openai });
    const json = await aiJson();
    expect(json).not.toHaveProperty("apiKey");
    expect(json).not.toHaveProperty("apiKeyOrigin");
    expect(json.keyOrigins).toEqual({ "openai-compatible": A });
  });

  it("a K0 store key (ai.apiKey) is gone from the store after a save", async () => {
    await writeAiJson(k0);
    await writeSecrets(dir, { "ai.apiKey": KEYS.openai }, { env });
    await save({ model: "m2" });
    expect(Object.keys(await storeValues())).toEqual(["ai.key.openai-compatible"]);
  });
});

describe("every saved key is registered for redaction", () => {
  /** Drops the registration (an empty config dir), so only what the next resolve reads can register. */
  const unregister = () => resolveAiConfig({ env: { RUNHOUND_CONFIG_DIR: join(tmp, "empty") }, home: tmp });

  it("registers all providers' keys, not just the one in effect", async () => {
    await saveThreeKeys("anthropic");
    await unregister();
    for (const key of Object.values(KEYS)) expect(redactSecrets(`k=${key}`)).toBe(`k=${key}`);
    await resolveWith();
    for (const key of Object.values(KEYS)) expect(redactSecrets(`k=${key}`), key).toBe(`k=${MARK}`);
  });

  it("registers them whichever provider a flag or env picks, and when none is chosen", async () => {
    await saveThreeKeys();
    await unregister();
    await resolveWith({ flags: { provider: "ollama" } });
    for (const key of Object.values(KEYS)) expect(redactSecrets(key)).toBe(MARK);
    await unregister();
    await resolveWith({ env: { ...env, RUNHOUND_AI_PROVIDER: "bedrock" } });
    for (const key of Object.values(KEYS)) expect(redactSecrets(key)).toBe(MARK);
  });

  it("registers a key that does not apply because the endpoint moved", async () => {
    await save({ provider: "openai-compatible", baseUrl: `${A}/v1`, apiKey: OTHER_KEY });
    await unregister();
    const r = await resolveWith({ flags: { baseUrl: `${B}/v1` } });
    expect(r.config.apiKey).toBeNull();
    expect(redactSecrets(OTHER_KEY)).toBe(MARK);
  });

  it("stops registering a key once it is removed, and keeps the others", async () => {
    await saveThreeKeys("openai");
    expect(redactSecrets(KEYS.openai)).toBe(MARK);
    await save({ apiKey: null });
    expect(redactSecrets(KEYS.openai)).toBe(KEYS.openai);
    expect(redactSecrets(KEYS.anthropic)).toBe(MARK);
    expect(redactSecrets(KEYS.gemini)).toBe(MARK);
  });

  it("registers a key moved from the K0 shape", async () => {
    await writeAiJson({ enabled: true, provider: "anthropic", model: "m", apiKey: KEYS.anthropic, apiKeyOrigin: "https://api.anthropic.com" });
    await resolveWith();
    await unregister();
    expect(redactSecrets(KEYS.anthropic)).toBe(KEYS.anthropic);
    await resolveWith();
    expect(redactSecrets(KEYS.anthropic)).toBe(MARK);
  });

  it("does not register a short placeholder key saved for a local server", async () => {
    await save({ provider: "ollama", apiKey: "none" });
    expect(redactSecrets("none of these are secrets: test")).toBe("none of these are secrets: test");
  });
});

describe("the Docker image (RUNHOUND_SECRETS=environment)", () => {
  let envOnly: NodeJS.ProcessEnv;
  const legacy = { enabled: true, provider: "openai-compatible", baseUrl: `${A}/v1`, model: "m", allowRemote: true, allowRemoteHost: "api.a.example" };
  beforeEach(() => {
    envOnly = { RUNHOUND_CONFIG_DIR: dir, RUNHOUND_SECRETS: "environment" };
  });

  it("keeps a legacy plain-text key where it is and still uses it, migrating nothing", async () => {
    await writeAiJson({ ...legacy, apiKey: KEYS.openai, apiKeyOrigin: A });
    const before = await readFile(file());
    const r = await resolveWith({ env: envOnly });
    expect(r.config.apiKey).toBe(KEYS.openai);
    expect(r.sources.apiKey).toBe("file");
    expect(await readFile(file())).toEqual(before);
    expect(await readdir(dir)).toEqual(["ai.json"]);
    expect(aiStatus(r, envOnly, tmp)).toMatchObject({ secretProtection: "environment", hasKey: true, secretNotice: expect.stringContaining("plain text") });
  });

  it("refuses a new key and says where keys come from, whichever provider it is for", async () => {
    await expect(save({ provider: "anthropic", apiKey: KEYS.anthropic }, envOnly)).rejects.toThrow(KEYS_FROM_ENVIRONMENT);
    await expect(save({ provider: "gemini", apiKey: KEYS.gemini, model: "m" }, envOnly)).rejects.toThrow(KEYS_FROM_ENVIRONMENT);
    await expect(stat(dir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses a key with no provider because no provider is chosen, before anything else", async () => {
    await expect(save({ apiKey: KEYS.anthropic }, envOnly)).rejects.toThrow("Choose a provider before saving an API key");
  });

  it("still saves other settings, keeping the plain-text key and pinning it to its origin", async () => {
    await writeAiJson({ ...legacy, apiKey: KEYS.openai });
    const r = await save({ model: "m2" }, envOnly);
    expect(r.config).toMatchObject({ model: "m2", apiKey: KEYS.openai });
    expect(await aiJson()).toMatchObject({ model: "m2", apiKey: KEYS.openai, apiKeyOrigin: A });
    expect(await readdir(dir)).toEqual(["ai.json"]);
  });

  it("a legacy file without a provider gets provider: ollama when saved, and its key stays in the file", async () => {
    await writeAiJson({ enabled: true, model: "llama3", apiKey: "legacy-ollama-key-0003" });
    const r = await save({ model: "llama3.2" }, envOnly);
    expect(r.config).toMatchObject({ provider: "ollama", apiKey: "legacy-ollama-key-0003" });
    expect(await aiJson()).toMatchObject({ provider: "ollama", apiKey: "legacy-ollama-key-0003" });
    expect(await readdir(dir)).toEqual(["ai.json"]);
  });

  it("the plain-text key is never sent to another provider's endpoint after a switch", async () => {
    await writeAiJson({ ...legacy, apiKey: KEYS.openai, apiKeyOrigin: A });
    const r = await save({ provider: "anthropic" }, envOnly);
    expect(r.config.provider).toBe("anthropic");
    expect(r.config.apiKey).not.toBe(KEYS.openai);
    expect((await resolveWith({ env: envOnly })).config.apiKey).not.toBe(KEYS.openai);
  });

  it("the key from the environment applies to the provider in effect", async () => {
    const withKey = { ...envOnly, RUNHOUND_AI_API_KEY: KEYS.anthropic, RUNHOUND_AI_PROVIDER: "anthropic", RUNHOUND_AI_MODEL: "m" };
    const r = await resolveWith({ env: withKey });
    expect(r.config).toMatchObject({ provider: "anthropic", apiKey: KEYS.anthropic });
    expect(aiStatus(r, withKey, tmp).problem).toBe("AI is off");
    expect(aiStatus({ ...r, config: { ...r.config, enabled: true } }, withKey, tmp).problem).toBe("Sending page structure to api.anthropic.com needs your consent");
  });
});
