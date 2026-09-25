import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  aiStatus,
  configDir,
  configFile,
  DEFAULT_AI_CONFIG,
  DEFAULT_BASE_URLS,
  endpointHost,
  isRemote,
  resolveAiConfig,
  saveAiConfig,
  type ResolvedAiConfig,
} from "./config.js";
import type { AiConfig, AiStatus } from "./types.js";

let tmp: string;
let dir: string;
/** An env that points the config dir at the temp dir, so the real ~/.config is never touched. */
let env: NodeJS.ProcessEnv;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "runhound-ai-config-"));
  dir = join(tmp, "config");
  env = { RUNHOUND_CONFIG_DIR: dir };
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

/** A rejection for a real reason: the contract stubs also throw, which must not count. */
async function expectRejected(promise: Promise<unknown>): Promise<void> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).not.toMatch(/not implemented/);
}

async function writeSaved(value: unknown): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "ai.json"), typeof value === "string" ? value : JSON.stringify(value));
}

const ALL_DEFAULT: AiStatus["sources"] = {
  enabled: "default",
  provider: "default",
  baseUrl: "default",
  model: "default",
  apiKey: "default",
  region: "default",
  allowRemote: "default",
  features: "default",
  timeoutMs: "default",
};

describe("configDir", () => {
  it("uses RUNHOUND_CONFIG_DIR first", () => {
    expect(configDir({ RUNHOUND_CONFIG_DIR: "/a/b", XDG_CONFIG_HOME: "/x" }, "/home/u")).toBe("/a/b");
  });

  it("uses XDG_CONFIG_HOME/run-hound next", () => {
    expect(configDir({ XDG_CONFIG_HOME: "/x" }, "/home/u")).toBe(join("/x", "run-hound"));
  });

  it("falls back to ~/.config/run-hound", () => {
    expect(configDir({}, "/home/u")).toBe(join("/home/u", ".config", "run-hound"));
  });

  it("puts the file at <configDir>/ai.json", () => {
    expect(configFile({ RUNHOUND_CONFIG_DIR: "/a/b" }, "/home/u")).toBe(join("/a/b", "ai.json"));
    expect(configFile({}, "/home/u")).toBe(join("/home/u", ".config", "run-hound", "ai.json"));
  });
});

describe("resolveAiConfig", () => {
  it("returns the defaults when there is no file, env or flag", async () => {
    const r = await resolveAiConfig({ env, home: tmp });
    expect(r.config).toEqual(DEFAULT_AI_CONFIG);
    expect(r.sources).toEqual(ALL_DEFAULT);
    expect(r.file).toBe(join(dir, "ai.json"));
  });

  it("uses the home directory when no env var names a config dir", async () => {
    await mkdir(join(tmp, ".config", "run-hound"), { recursive: true });
    await writeFile(join(tmp, ".config", "run-hound", "ai.json"), JSON.stringify({ model: "from-home" }));
    const r = await resolveAiConfig({ env: {}, home: tmp });
    expect(r.config.model).toBe("from-home");
    expect(r.file).toBe(join(tmp, ".config", "run-hound", "ai.json"));
  });

  it("layers file values over the defaults", async () => {
    await writeSaved({ enabled: true, model: "ornith-1.5:9b", timeoutMs: 60_000, features: { review: true, suggest: false, explain: true } });
    const r = await resolveAiConfig({ env, home: tmp });
    expect(r.config.enabled).toBe(true);
    expect(r.config.model).toBe("ornith-1.5:9b");
    expect(r.config.timeoutMs).toBe(60_000);
    expect(r.config.features).toEqual({ review: true, suggest: false, explain: true });
    expect(r.sources).toMatchObject({ enabled: "file", model: "file", timeoutMs: "file", features: "file", provider: "default", apiKey: "default" });
  });

  it("layers env over the file and flags over env", async () => {
    await writeSaved({ model: "file-model", enabled: false, baseUrl: "http://127.0.0.1:11434/v1" });
    const r = await resolveAiConfig({
      env: { ...env, RUNHOUND_AI_MODEL: "env-model", RUNHOUND_AI: "1", RUNHOUND_AI_BASE_URL: "http://127.0.0.1:9999/v1" },
      flags: { model: "flag-model" },
      home: tmp,
    });
    expect(r.config.model).toBe("flag-model");
    expect(r.config.enabled).toBe(true);
    expect(r.config.baseUrl).toBe("http://127.0.0.1:9999/v1");
    expect(r.sources).toMatchObject({ model: "flag", enabled: "env", baseUrl: "env" });
  });

  it("lets flags turn AI off and set the provider, base URL and consent", async () => {
    const r = await resolveAiConfig({
      env: { ...env, RUNHOUND_AI: "1" },
      flags: { enabled: false, provider: "openai-compatible", baseUrl: "https://api.openai.com/v1", allowRemote: true },
      home: tmp,
    });
    expect(r.config).toMatchObject({ enabled: false, provider: "openai-compatible", baseUrl: "https://api.openai.com/v1", allowRemote: true });
    expect(r.sources).toMatchObject({ enabled: "flag", provider: "flag", baseUrl: "flag", allowRemote: "flag" });
  });

  it("reads the key, region, consent and timeout from env", async () => {
    const r = await resolveAiConfig({
      env: { ...env, RUNHOUND_AI_API_KEY: "sk-test-key", RUNHOUND_AI_REGION: "eu-west-1", RUNHOUND_AI_ALLOW_REMOTE: "1", RUNHOUND_AI_TIMEOUT_MS: "30000" },
      home: tmp,
    });
    expect(r.config).toMatchObject({ apiKey: "sk-test-key", region: "eu-west-1", allowRemote: true, timeoutMs: 30_000 });
    expect(r.sources).toMatchObject({ apiKey: "env", region: "env", allowRemote: "env", timeoutMs: "env" });
  });

  it.each(["1", "true", "on"])("reads RUNHOUND_AI=%s as on", async (value) => {
    const r = await resolveAiConfig({ env: { ...env, RUNHOUND_AI: value }, home: tmp });
    expect(r.config.enabled).toBe(true);
    expect(r.sources.enabled).toBe("env");
  });

  it.each(["0", "false", "off"])("reads RUNHOUND_AI=%s as off, over a file that turns it on", async (value) => {
    await writeSaved({ enabled: true });
    const r = await resolveAiConfig({ env: { ...env, RUNHOUND_AI: value }, home: tmp });
    expect(r.config.enabled).toBe(false);
    expect(r.sources.enabled).toBe("env");
  });

  it("reads RUNHOUND_AI_FEATURES as a comma list", async () => {
    const r = await resolveAiConfig({ env: { ...env, RUNHOUND_AI_FEATURES: "review, explain" }, home: tmp });
    expect(r.config.features).toEqual({ review: true, suggest: false, explain: true });
    expect(r.sources.features).toBe("env");
  });

  describe("provider default base URLs", () => {
    it("uses the provider's default URL when env sets a provider without a URL", async () => {
      const r = await resolveAiConfig({ env: { ...env, RUNHOUND_AI_PROVIDER: "openai-compatible" }, home: tmp });
      expect(r.config.provider).toBe("openai-compatible");
      expect(r.config.baseUrl).toBe(DEFAULT_BASE_URLS["openai-compatible"]);
      expect(r.sources.provider).toBe("env");
    });

    it("drops a lower source's URL when a higher source changes the provider", async () => {
      await writeSaved({ provider: "ollama", baseUrl: "http://127.0.0.1:9999/v1" });
      const r = await resolveAiConfig({ env: { ...env, RUNHOUND_AI_PROVIDER: "openai-compatible" }, home: tmp });
      expect(r.config.baseUrl).toBe(DEFAULT_BASE_URLS["openai-compatible"]);
    });

    it("keeps a URL from the same source as the provider", async () => {
      await writeSaved({ provider: "openai-compatible", baseUrl: "http://127.0.0.1:8080/v1" });
      const r = await resolveAiConfig({ env, home: tmp });
      expect(r.config.baseUrl).toBe("http://127.0.0.1:8080/v1");
    });

    it("keeps a URL from a later source than the provider", async () => {
      await writeSaved({ provider: "openai-compatible" });
      const r = await resolveAiConfig({ env: { ...env, RUNHOUND_AI_BASE_URL: "http://127.0.0.1:8081/v1" }, home: tmp });
      expect(r.config.baseUrl).toBe("http://127.0.0.1:8081/v1");
    });

    it("uses an empty URL for a bedrock flag", async () => {
      const r = await resolveAiConfig({ env, flags: { provider: "bedrock" }, home: tmp });
      expect(r.config.provider).toBe("bedrock");
      expect(r.config.baseUrl).toBe("");
    });
  });

  describe("bedrock fallbacks", () => {
    it("reads the key from AWS_BEARER_TOKEN_BEDROCK and the region from AWS_REGION", async () => {
      const r = await resolveAiConfig({
        env: { ...env, RUNHOUND_AI_PROVIDER: "bedrock", AWS_BEARER_TOKEN_BEDROCK: "fake-bedrock-token", AWS_REGION: "eu-west-1", AWS_DEFAULT_REGION: "us-west-2" },
        home: tmp,
      });
      expect(r.config.apiKey).toBe("fake-bedrock-token");
      expect(r.config.region).toBe("eu-west-1");
      expect(r.sources).toMatchObject({ apiKey: "env", region: "env" });
    });

    it("falls back to AWS_DEFAULT_REGION", async () => {
      const r = await resolveAiConfig({ env: { ...env, RUNHOUND_AI_PROVIDER: "bedrock", AWS_DEFAULT_REGION: "us-west-2" }, home: tmp });
      expect(r.config.region).toBe("us-west-2");
      expect(r.sources.region).toBe("env");
    });

    it("prefers RUNHOUND_AI_REGION and RUNHOUND_AI_API_KEY over the AWS variables", async () => {
      const r = await resolveAiConfig({
        env: {
          ...env,
          RUNHOUND_AI_PROVIDER: "bedrock",
          RUNHOUND_AI_REGION: "ap-south-1",
          RUNHOUND_AI_API_KEY: "runhound-key",
          AWS_REGION: "eu-west-1",
          AWS_BEARER_TOKEN_BEDROCK: "aws-key",
        },
        home: tmp,
      });
      expect(r.config.region).toBe("ap-south-1");
      expect(r.config.apiKey).toBe("runhound-key");
    });

    it("keeps a saved key and region over the AWS variables", async () => {
      await writeSaved({ provider: "bedrock", apiKey: "saved-key", region: "eu-central-1" });
      const r = await resolveAiConfig({ env: { ...env, AWS_BEARER_TOKEN_BEDROCK: "aws-key", AWS_REGION: "eu-west-1" }, home: tmp });
      expect(r.config.apiKey).toBe("saved-key");
      expect(r.config.region).toBe("eu-central-1");
      expect(r.sources).toMatchObject({ apiKey: "file", region: "file" });
    });

    it("ignores the AWS variables for other providers", async () => {
      const r = await resolveAiConfig({ env: { ...env, AWS_BEARER_TOKEN_BEDROCK: "aws-key", AWS_REGION: "eu-west-1" }, home: tmp });
      expect(r.config.apiKey).toBeNull();
      expect(r.config.region).toBeNull();
    });
  });

  it("ignores a corrupt file", async () => {
    await writeSaved("{ this is not json");
    const r = await resolveAiConfig({ env, home: tmp });
    expect(r.config).toEqual(DEFAULT_AI_CONFIG);
    expect(r.sources).toEqual(ALL_DEFAULT);
  });

  it("ignores an unknown provider name and keeps the lower source", async () => {
    await writeSaved({ provider: "openai-compatible" });
    const r = await resolveAiConfig({ env: { ...env, RUNHOUND_AI_PROVIDER: "gemini" }, home: tmp });
    expect(r.config.provider).toBe("openai-compatible");
    expect(r.sources.provider).toBe("file");
  });

  it("ignores a non-numeric timeout and keeps the lower source", async () => {
    await writeSaved({ timeoutMs: 60_000 });
    const r = await resolveAiConfig({ env: { ...env, RUNHOUND_AI_TIMEOUT_MS: "soon" }, home: tmp });
    expect(r.config.timeoutMs).toBe(60_000);
    expect(r.sources.timeoutMs).toBe("file");
  });
});

describe("saveAiConfig", () => {
  const file = () => join(dir, "ai.json");
  const saved = async () => JSON.parse(await readFile(file(), "utf8")) as Record<string, unknown>;

  it("creates the directory and writes the file with mode 0600", async () => {
    const r = await saveAiConfig({ enabled: true, model: "ornith-1.5:9b" }, { env, home: tmp });
    expect((await stat(file())).mode & 0o777).toBe(0o600);
    expect(r.config).toMatchObject({ enabled: true, model: "ornith-1.5:9b" });
    expect(r.sources).toMatchObject({ enabled: "file", model: "file" });
    expect(r.file).toBe(file());
    expect(await saved()).toMatchObject({ enabled: true, model: "ornith-1.5:9b" });
  });

  it("keeps earlier saved values when a later patch doesn't mention them", async () => {
    await saveAiConfig({ model: "m1" }, { env, home: tmp });
    const r = await saveAiConfig({ enabled: true }, { env, home: tmp });
    expect(r.config).toMatchObject({ model: "m1", enabled: true });
  });

  it("merges partial features", async () => {
    const r = await saveAiConfig({ features: { suggest: false } }, { env, home: tmp });
    expect(r.config.features).toEqual({ review: true, suggest: false, explain: true });
  });

  it("keeps the saved key on an empty or missing apiKey and removes it on null", async () => {
    await saveAiConfig({ apiKey: "sk-saved-key" }, { env, home: tmp });
    expect((await saveAiConfig({ apiKey: "" }, { env, home: tmp })).config.apiKey).toBe("sk-saved-key");
    expect((await saveAiConfig({ model: "m" }, { env, home: tmp })).config.apiKey).toBe("sk-saved-key");
    expect((await saveAiConfig({ apiKey: undefined }, { env, home: tmp })).config.apiKey).toBe("sk-saved-key");
    const r = await saveAiConfig({ apiKey: null }, { env, home: tmp });
    expect(r.config.apiKey).toBeNull();
    expect(r.sources.apiKey).toBe("default");
    expect(JSON.stringify(await saved())).not.toContain("sk-saved-key");
  });

  it("rejects a field that comes from env, naming the variable", async () => {
    await expect(saveAiConfig({ model: "other" }, { env: { ...env, RUNHOUND_AI_MODEL: "env-model" }, home: tmp })).rejects.toThrow(/RUNHOUND_AI_MODEL/);
  });

  it("rejects a bedrock region that comes from AWS_REGION", async () => {
    await expect(
      saveAiConfig({ region: "us-east-1" }, { env: { ...env, RUNHOUND_AI_PROVIDER: "bedrock", AWS_REGION: "eu-west-1" }, home: tmp }),
    ).rejects.toThrow(/AWS_REGION/);
  });

  it("allows saving fields that env doesn't set", async () => {
    const r = await saveAiConfig({ enabled: true }, { env: { ...env, RUNHOUND_AI_MODEL: "env-model" }, home: tmp });
    expect(r.config).toMatchObject({ enabled: true, model: "env-model" });
  });

  it("removes a trailing slash from the base URL", async () => {
    const r = await saveAiConfig({ provider: "openai-compatible", baseUrl: "http://127.0.0.1:1234/v1/" }, { env, home: tmp });
    expect(r.config.baseUrl).toBe("http://127.0.0.1:1234/v1");
  });

  it("accepts an empty base URL", async () => {
    const r = await saveAiConfig({ provider: "bedrock", baseUrl: "", region: "us-east-1" }, { env, home: tmp });
    expect(r.config.baseUrl).toBe("");
  });

  it.each(["ftp://127.0.0.1/v1", "not a url", "javascript:alert(1)"])("rejects the base URL %s and writes nothing", async (baseUrl) => {
    await expectRejected(saveAiConfig({ baseUrl }, { env, home: tmp }));
    await expect(stat(file())).rejects.toThrow();
  });

  it.each([1000, 4999, 600_001])("rejects a timeout of %d ms", async (timeoutMs) => {
    await expectRejected(saveAiConfig({ timeoutMs }, { env, home: tmp }));
  });

  it.each([5000, 600_000])("accepts a timeout of %d ms", async (timeoutMs) => {
    expect((await saveAiConfig({ timeoutMs }, { env, home: tmp })).config.timeoutMs).toBe(timeoutMs);
  });

  it("rejects an unknown provider", async () => {
    await expectRejected(saveAiConfig({ provider: "gemini" as AiConfig["provider"] }, { env, home: tmp }));
  });
});

describe("isRemote and endpointHost", () => {
  const ollama = (baseUrl: string) => ({ provider: "ollama" as const, baseUrl, region: null });

  it.each([
    "http://localhost:11434/v1",
    "http://127.0.0.1:11434/v1",
    "http://192.168.1.20:11434/v1",
    "http://10.0.0.5:8000/v1",
    "http://[::1]:11434/v1",
    "http://host.docker.internal:11434/v1",
    "http://host.containers.internal:11434/v1",
    "http://ollama.localhost:11434/v1",
  ])("treats %s as local", (baseUrl) => {
    expect(isRemote(ollama(baseUrl))).toBe(false);
  });

  it.each(["https://api.openai.com/v1", "http://example.com:11434/v1", "https://openrouter.ai/api/v1"])("treats %s as remote", (baseUrl) => {
    expect(isRemote({ provider: "openai-compatible", baseUrl, region: null })).toBe(true);
  });

  it("treats bedrock as remote, even with a local endpoint override", () => {
    expect(isRemote({ provider: "bedrock", baseUrl: "", region: "us-east-1" })).toBe(true);
    expect(isRemote({ provider: "bedrock", baseUrl: "http://127.0.0.1:9000", region: "us-east-1" })).toBe(true);
  });

  it("shows the base URL host", () => {
    expect(endpointHost({ provider: "openai-compatible", baseUrl: "https://api.openai.com/v1", region: null })).toBe("api.openai.com");
    expect(endpointHost(ollama("http://localhost:11434/v1"))).toMatch(/^localhost(:11434)?$/);
    expect(endpointHost(ollama("http://host.containers.internal:11434/v1"))).toMatch(/^host\.containers\.internal(:11434)?$/);
  });

  it("shows the bedrock runtime host for the region", () => {
    expect(endpointHost({ provider: "bedrock", baseUrl: "", region: "us-east-1" })).toBe("bedrock-runtime.us-east-1.amazonaws.com");
  });
});

describe("aiStatus", () => {
  const resolved = (config: Partial<AiConfig>, sources: Partial<AiStatus["sources"]> = {}): ResolvedAiConfig => ({
    config: { ...DEFAULT_AI_CONFIG, ...config },
    sources: { ...ALL_DEFAULT, ...sources },
    file: "/tmp/runhound-test/ai.json",
  });
  const bedrock = { enabled: true, provider: "bedrock" as const, baseUrl: "", model: "anthropic.claude-test" };

  it("says AI is off first, even with nothing else set", () => {
    expect(aiStatus(resolved({ enabled: false }), {}).problem).toBe("AI is off");
  });

  it("asks for a model next", () => {
    expect(aiStatus(resolved({ enabled: true, model: "" }), {}).problem).toBe("Choose a model");
  });

  it("asks for a Bedrock region before a key", () => {
    expect(aiStatus(resolved({ ...bedrock, region: null }), {}).problem).toBe("Choose a Bedrock region");
  });

  it("asks for Bedrock credentials when there is no key and no AWS keys", () => {
    expect(aiStatus(resolved({ ...bedrock, region: "us-east-1" }), {}).problem).toBe("Bedrock needs an API key or AWS access keys");
  });

  it("asks for consent for Bedrock with AWS access keys", () => {
    const status = aiStatus(resolved({ ...bedrock, region: "us-east-1" }), { AWS_ACCESS_KEY_ID: "AKIDEXAMPLE", AWS_SECRET_ACCESS_KEY: "fake-secret" });
    expect(status.problem).toBe("Sending page structure to bedrock-runtime.us-east-1.amazonaws.com needs your consent");
    expect(status.hasKey).toBe(true);
    expect(status.remote).toBe(true);
    expect(status.host).toBe("bedrock-runtime.us-east-1.amazonaws.com");
  });

  it("has no problem for Bedrock with a key and consent", () => {
    const status = aiStatus(resolved({ ...bedrock, region: "us-east-1", apiKey: "fake-bedrock-key", allowRemote: true }), {});
    expect(status.problem).toBeNull();
    expect(status.hasKey).toBe(true);
  });

  it("asks for consent for a remote OpenAI-compatible endpoint", () => {
    const status = aiStatus(resolved({ enabled: true, provider: "openai-compatible", baseUrl: "https://api.openai.com/v1", model: "gpt-5-mini" }), {});
    expect(status.problem).toBe("Sending page structure to api.openai.com needs your consent");
    expect(status.remote).toBe(true);
    expect(status.host).toBe("api.openai.com");
  });

  it("has no problem for local Ollama with a model", () => {
    const status = aiStatus(resolved({ enabled: true, model: "ornith-1.5:9b" }), {});
    expect(status.problem).toBeNull();
    expect(status.remote).toBe(false);
    expect(status.hasKey).toBe(false);
  });

  it("copies the config, sources and file but never the key", () => {
    const r = resolved(
      { enabled: true, provider: "openai-compatible", baseUrl: "https://api.openai.com/v1", model: "gpt-5-mini", apiKey: "sk-secret-do-not-leak", allowRemote: true },
      { apiKey: "env", model: "file" },
    );
    const status = aiStatus(r, {});
    expect(status).toMatchObject({
      enabled: true,
      provider: "openai-compatible",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-5-mini",
      region: null,
      allowRemote: true,
      features: DEFAULT_AI_CONFIG.features,
      timeoutMs: DEFAULT_AI_CONFIG.timeoutMs,
      hasKey: true,
      problem: null,
      file: "/tmp/runhound-test/ai.json",
    });
    expect(status.sources).toEqual(r.sources);
    expect(JSON.stringify(status)).not.toContain("sk-secret-do-not-leak");
    expect(status).not.toHaveProperty("apiKey");
  });
});

describe("remote consent is tied to a host", () => {
  const file = () => join(dir, "ai.json");
  const saved = async () => JSON.parse(await readFile(file(), "utf8")) as Record<string, unknown>;
  const hostA = { enabled: true, provider: "openai-compatible" as const, baseUrl: "https://api.a.example/v1", model: "m" };

  it("saves the endpoint host with the consent", async () => {
    const r = await saveAiConfig({ ...hostA, allowRemote: true }, { env, home: tmp });
    expect(r.config.allowRemote).toBe(true);
    expect(await saved()).toMatchObject({ allowRemote: true, allowRemoteHost: "api.a.example" });
    expect(aiStatus(r, {}).problem).toBeNull();
  });

  it("does not apply saved consent to another host", async () => {
    await writeSaved({ ...hostA, baseUrl: "https://api.b.example/v1", allowRemote: true, allowRemoteHost: "api.a.example" });
    const r = await resolveAiConfig({ env, home: tmp });
    expect(r.config.allowRemote).toBe(false);
    const status = aiStatus(r, {});
    expect(status.allowRemote).toBe(false);
    expect(status.problem).toBe("Sending page structure to api.b.example needs your consent");
  });

  it("ignores saved consent that names no host", async () => {
    await writeSaved({ ...hostA, allowRemote: true });
    expect((await resolveAiConfig({ env, home: tmp })).config.allowRemote).toBe(false);
  });

  it("does not apply saved consent when env points the endpoint elsewhere", async () => {
    await saveAiConfig({ ...hostA, allowRemote: true }, { env, home: tmp });
    const r = await resolveAiConfig({ env: { ...env, RUNHOUND_AI_BASE_URL: "https://api.b.example/v1" }, home: tmp });
    expect(r.config.allowRemote).toBe(false);
  });

  it("applies env or flag consent to whatever endpoint that invocation uses", async () => {
    await writeSaved({ ...hostA, allowRemote: false });
    const viaEnv = await resolveAiConfig({ env: { ...env, RUNHOUND_AI_ALLOW_REMOTE: "1", RUNHOUND_AI_BASE_URL: "https://api.b.example/v1" }, home: tmp });
    expect(viaEnv.config.allowRemote).toBe(true);
    const viaFlag = await resolveAiConfig({ env, home: tmp, flags: { baseUrl: "https://api.c.example/v1", allowRemote: true } });
    expect(viaFlag.config.allowRemote).toBe(true);
  });

  it("clears consent when a patch moves the endpoint to another host without re-consenting", async () => {
    await saveAiConfig({ ...hostA, allowRemote: true }, { env, home: tmp });
    const r = await saveAiConfig({ baseUrl: "https://api.b.example/v1" }, { env, home: tmp });
    expect(r.config.allowRemote).toBe(false);
    expect(await saved()).not.toMatchObject({ allowRemote: true });
    // Moving back to host A does not bring the old consent back.
    const back = await saveAiConfig({ baseUrl: "https://api.a.example/v1" }, { env, home: tmp });
    expect(back.config.allowRemote).toBe(false);
  });

  it("clears consent when the provider change moves the endpoint", async () => {
    await saveAiConfig({ provider: "bedrock", baseUrl: "", region: "us-east-1", model: "m", enabled: true, allowRemote: true }, { env, home: tmp });
    const r = await saveAiConfig({ region: "eu-west-1" }, { env, home: tmp });
    expect(r.config.allowRemote).toBe(false);
  });

  it("keeps consent for a patch that changes the host but consents again, tied to the new host", async () => {
    await saveAiConfig({ ...hostA, allowRemote: true }, { env, home: tmp });
    const r = await saveAiConfig({ baseUrl: "https://api.b.example/v1", allowRemote: true }, { env, home: tmp });
    expect(r.config.allowRemote).toBe(true);
    expect(await saved()).toMatchObject({ allowRemoteHost: "api.b.example" });
  });

  it("keeps consent for a patch on the same host (another path, the model)", async () => {
    await saveAiConfig({ ...hostA, allowRemote: true }, { env, home: tmp });
    const r = await saveAiConfig({ baseUrl: "https://api.a.example/v2", model: "m2" }, { env, home: tmp });
    expect(r.config.allowRemote).toBe(true);
  });
});

describe("the saved key does not follow a changed endpoint", () => {
  const file = () => join(dir, "ai.json");
  const saved = async () => JSON.parse(await readFile(file(), "utf8")) as Record<string, unknown>;
  const NOTICE = "The saved API key was removed because the endpoint changed.";
  const withKey = { provider: "openai-compatible" as const, baseUrl: "https://api.a.example/v1", apiKey: "sk-saved-key" };

  it("removes the key when the base URL origin changes and says so", async () => {
    await saveAiConfig(withKey, { env, home: tmp });
    const r = await saveAiConfig({ baseUrl: "https://api.b.example/v1" }, { env, home: tmp });
    expect(r.config.apiKey).toBeNull();
    expect(r.notice).toBe(NOTICE);
    expect(JSON.stringify(await saved())).not.toContain("sk-saved-key");
  });

  it("removes the key when the port changes (same host name, another origin)", async () => {
    await saveAiConfig(withKey, { env, home: tmp });
    const r = await saveAiConfig({ baseUrl: "https://api.a.example:8443/v1" }, { env, home: tmp });
    expect(r.config.apiKey).toBeNull();
  });

  it("removes the key when the provider changes", async () => {
    await saveAiConfig(withKey, { env, home: tmp });
    const r = await saveAiConfig({ provider: "ollama" }, { env, home: tmp });
    expect(r.config.apiKey).toBeNull();
    expect(r.notice).toBe(NOTICE);
  });

  it("keeps a new key sent with the endpoint change, without a notice", async () => {
    await saveAiConfig(withKey, { env, home: tmp });
    const r = await saveAiConfig({ baseUrl: "https://api.b.example/v1", apiKey: "sk-new-key" }, { env, home: tmp });
    expect(r.config.apiKey).toBe("sk-new-key");
    expect(r.notice).toBeUndefined();
  });

  it("keeps the key for another path on the same origin, without a notice", async () => {
    await saveAiConfig(withKey, { env, home: tmp });
    const r = await saveAiConfig({ baseUrl: "https://api.a.example/v2", model: "m" }, { env, home: tmp });
    expect(r.config.apiKey).toBe("sk-saved-key");
    expect(r.notice).toBeUndefined();
  });

  it("says nothing when there was no saved key", async () => {
    await saveAiConfig({ provider: "openai-compatible", baseUrl: "https://api.a.example/v1" }, { env, home: tmp });
    const r = await saveAiConfig({ baseUrl: "https://api.b.example/v1" }, { env, home: tmp });
    expect(r.notice).toBeUndefined();
  });
});

describe("saveAiConfig file permissions", () => {
  const file = () => join(dir, "ai.json");

  it("creates the config directory with mode 0700", async () => {
    await saveAiConfig({ model: "m" }, { env, home: tmp });
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
  });

  it("replaces a looser pre-existing file with a new 0600 file instead of writing the key into it", async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(file(), JSON.stringify({ model: "m" }), { mode: 0o644 });
    const before = await stat(file());
    expect(before.mode & 0o777).toBe(0o644);
    await saveAiConfig({ apiKey: "sk-new-key" }, { env, home: tmp });
    const after = await stat(file());
    expect(after.mode & 0o777).toBe(0o600);
    expect(after.ino).not.toBe(before.ino);
    expect(JSON.parse(await readFile(file(), "utf8"))).toMatchObject({ model: "m", apiKey: "sk-new-key" });
    const { readdir } = await import("node:fs/promises");
    expect(await readdir(dir)).toEqual(["ai.json"]);
  });
});
