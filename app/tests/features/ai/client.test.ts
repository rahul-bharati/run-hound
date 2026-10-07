import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startFakeLlm, type FakeLlm } from "../../support/fake-llm.js";
import { json, startFixtureServer, type FixtureServer } from "../../support/server.js";
import { createLlmClient, testConnection } from "../../../src/ai/client.js";
import { DEFAULT_AI_CONFIG } from "../../../src/ai/config.js";
import type { ChatMessage } from "../../../src/ai/openai-compatible.js";
import { AiError, type AiConfig, type JsonRequest } from "../../../src/ai/types.js";

let fake: FakeLlm;
beforeEach(async () => {
  fake = await startFakeLlm();
});
afterEach(async () => {
  await fake.close();
});

const ollama = (overrides: Partial<AiConfig> = {}): AiConfig => ({
  ...DEFAULT_AI_CONFIG,
  enabled: true,
  provider: "ollama",
  baseUrl: fake.baseUrl,
  model: "ornith-1.5:9b",
  timeoutMs: 10_000,
  ...overrides,
});
const bedrock = (overrides: Partial<AiConfig> = {}): AiConfig => ({
  ...DEFAULT_AI_CONFIG,
  enabled: true,
  provider: "bedrock",
  baseUrl: fake.url,
  model: "anthropic.claude-test-v1:0",
  apiKey: "fake-bedrock-api-key",
  region: "us-east-1",
  allowRemote: true,
  timeoutMs: 10_000,
  ...overrides,
});

interface Ok {
  ok: boolean;
}
const request = (validate?: (value: unknown) => Ok): JsonRequest<Ok> => ({
  name: "ok_check",
  system: "Answer with JSON.",
  user: "Are you there?",
  schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false },
  validate:
    validate ??
    ((value) => {
      if (typeof value !== "object" || value === null || typeof (value as Ok).ok !== "boolean") throw new Error("ok must be a boolean");
      return value as Ok;
    }),
});

function thrown(fn: () => unknown): AiError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AiError);
    return error as AiError;
  }
  throw new Error("expected a throw");
}
async function caught(promise: Promise<unknown>): Promise<AiError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AiError);
    return error as AiError;
  }
  throw new Error("expected the call to reject");
}
async function closedPortUrl(): Promise<string> {
  const server = await startFixtureServer();
  await server.close();
  return `${server.url}/v1`;
}
/** Messages of an OpenAI-compatible or Ollama native call. */
const messagesOf = (i: number) => fake.calls[i]!.body.messages as ChatMessage[];

describe("createLlmClient", () => {
  it("throws not-configured when AI is off", () => {
    expect(thrown(() => createLlmClient(ollama({ enabled: false }), { env: {} })).code).toBe("not-configured");
  });

  it("throws not-configured without a model", () => {
    expect(thrown(() => createLlmClient(ollama({ model: "" }), { env: {} })).code).toBe("not-configured");
  });

  it("throws remote-not-allowed for a remote endpoint without consent, before any request", () => {
    expect(thrown(() => createLlmClient(ollama({ provider: "openai-compatible", baseUrl: "https://api.openai.com/v1" }), { env: {} })).code).toBe(
      "remote-not-allowed",
    );
    expect(thrown(() => createLlmClient(bedrock({ allowRemote: false }), { env: {} })).code).toBe("remote-not-allowed");
    expect(fake.requests).toHaveLength(0);
  });

  it("throws remote-not-allowed when the consent was given for another host", () => {
    const remote = ollama({ provider: "openai-compatible", baseUrl: "https://api.b.example/v1", allowRemote: true, allowRemoteHost: "api.a.example" });
    const error = thrown(() => createLlmClient(remote, { env: {} }));
    expect(error.code).toBe("remote-not-allowed");
    expect(error.message).toContain("api.b.example");
    // Consent for the host in use (or env/flag consent, which names no host) is accepted.
    expect(() => createLlmClient({ ...remote, allowRemoteHost: "api.b.example" }, { env: {} })).not.toThrow();
    expect(() => createLlmClient({ ...remote, allowRemoteHost: null }, { env: {} })).not.toThrow();
    expect(fake.requests).toHaveLength(0);
  });

  it("refuses to send a saved key to an origin other than the one it was saved for, before any request", async () => {
    const moved = ollama({ provider: "openai-compatible", apiKey: "sk-saved-key", apiKeyOrigin: "https://api.a.example" });
    const error = thrown(() => createLlmClient(moved, { env: {} }));
    expect(error.code).toBe("not-configured");
    expect(error.message).toContain("https://api.a.example");
    expect(error.message).not.toContain("sk-saved-key");
    expect(fake.requests).toHaveLength(0);
    // Bound to this origin (or not from the file: env/flag keys carry no origin) → used.
    fake.reply({ ok: true });
    await createLlmClient({ ...moved, apiKeyOrigin: new URL(fake.baseUrl).origin }, { env: {} }).generateJson(request());
    expect(fake.calls[0]!.headers.authorization).toBe("Bearer sk-saved-key");
    fake.reply({ ok: true });
    await createLlmClient({ ...moved, apiKeyOrigin: null }, { env: {} }).generateJson(request());
    expect(fake.calls[1]!.headers.authorization).toBe("Bearer sk-saved-key");
  });

  it("names its provider and model", () => {
    const client = createLlmClient(ollama(), { env: {} });
    expect(client.provider).toBe("ollama");
    expect(client.model).toBe("ornith-1.5:9b");
  });
});

describe("generateJson", () => {
  it("returns the validated answer from Ollama", async () => {
    fake.reply({ ok: true });
    const value = await createLlmClient(ollama(), { env: {} }).generateJson(request());
    expect(value).toEqual({ ok: true });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.path).toBe("/api/chat");
    expect(messagesOf(0)).toEqual([
      { role: "system", content: "Answer with JSON." },
      { role: "user", content: "Are you there?" },
    ]);
    expect(fake.calls[0]!.body.format).toEqual(request().schema);
    expect(fake.calls[0]!.body.think).toBe(false);
  });

  it("returns the validated answer from an OpenAI-compatible server, with the key", async () => {
    fake.reply({ ok: true });
    const client = createLlmClient(ollama({ provider: "openai-compatible", apiKey: "sk-test-key" }), { env: {} });
    expect(await client.generateJson(request())).toEqual({ ok: true });
    expect(fake.calls[0]!.path).toBe("/v1/chat/completions");
    expect(fake.calls[0]!.body.response_format.json_schema.name).toBe("ok_check");
    expect(fake.calls[0]!.headers.authorization).toBe("Bearer sk-test-key");
  });

  it("does not retry when the model ran out of output space", async () => {
    fake.reply({ raw: "", finishReason: "length" });
    const client = createLlmClient(ollama({ provider: "openai-compatible" }), { env: {} });
    const error = await caught(client.generateJson(request()));
    expect(error.code).toBe("bad-output");
    expect(error.message).toContain("used up its output space");
    expect(fake.calls).toHaveLength(1);
  });

  it("does not retry when Ollama doesn't have the model", async () => {
    fake.reply({ status: 404, body: JSON.stringify({ error: 'model "nope:1b" not found, try pulling it first' }) });
    const error = await caught(createLlmClient(ollama({ model: "nope:1b" }), { env: {} }).generateJson(request()));
    expect(error.message).toBe("Ollama doesn't have the model nope:1b — run `ollama pull nope:1b`");
    expect(fake.calls).toHaveLength(1);
  });

  it("returns the validated answer from Bedrock", async () => {
    fake.reply({ ok: true });
    const client = createLlmClient(bedrock(), { env: {} });
    expect(client.provider).toBe("bedrock");
    expect(await client.generateJson(request())).toEqual({ ok: true });
    expect(fake.calls[0]!.path).toBe(`/model/${encodeURIComponent("anthropic.claude-test-v1:0")}/converse`);
    expect(fake.calls[0]!.body.toolConfig.toolChoice).toEqual({ tool: { name: "ok_check" } });
  });

  it("strips ``` fences around the JSON", async () => {
    fake.reply({ raw: '```json\n{"ok": true}\n```' });
    expect(await createLlmClient(ollama(), { env: {} }).generateJson(request())).toEqual({ ok: true });
  });

  it("retries once on invalid JSON, feeding the answer and the error back", async () => {
    fake.reply({ raw: "Sure! Here you go: ok" }, { ok: true });
    expect(await createLlmClient(ollama(), { env: {} }).generateJson(request())).toEqual({ ok: true });
    expect(fake.calls).toHaveLength(2);
    const retry = messagesOf(1);
    expect(retry.slice(0, 2)).toEqual(messagesOf(0));
    expect(retry).toContainEqual({ role: "assistant", content: "Sure! Here you go: ok" });
    const last = retry.at(-1)!;
    expect(last.role).toBe("user");
    expect(last.content).toMatch(/^Your answer was not valid: .+\. Answer again with JSON that matches the schema\.$/s);
  });

  it("retries once on a validation error, with the error text", async () => {
    const validate = (value: unknown): Ok => {
      if ((value as Ok).ok !== true) throw new Error("ok must be true");
      return value as Ok;
    };
    fake.reply({ ok: false }, { ok: true });
    expect(await createLlmClient(ollama(), { env: {} }).generateJson(request(validate))).toEqual({ ok: true });
    expect(fake.calls).toHaveLength(2);
    const retry = messagesOf(1);
    const assistant = retry.find((m) => m.role === "assistant")!;
    expect(JSON.parse(assistant.content)).toEqual({ ok: false });
    expect(retry.at(-1)!.content).toContain("ok must be true");
    expect(retry.at(-1)!.content).toContain("Answer again with JSON that matches the schema.");
  });

  it("rejects with bad-output after two failures", async () => {
    fake.reply({ raw: "not json at all" });
    const error = await caught(createLlmClient(ollama(), { env: {} }).generateJson(request()));
    expect(error.code).toBe("bad-output");
    expect(fake.calls).toHaveLength(2);
  });

  it("does not retry an HTTP error", async () => {
    fake.reply({ status: 500, body: "boom" });
    const error = await caught(createLlmClient(ollama(), { env: {} }).generateJson(request()));
    expect(error.code).toBe("http");
    expect(fake.calls).toHaveLength(1);
  });

  it("does not retry when nothing is listening", async () => {
    const error = await caught(createLlmClient(ollama({ baseUrl: await closedPortUrl() }), { env: {} }).generateJson(request()));
    expect(error.code).toBe("unreachable");
  });
});

/** A server for the official APIs' wire formats: Anthropic Messages and Gemini generateContent, answering from a queue. */
async function startOfficialApi(): Promise<FixtureServer & { reply(...bodies: unknown[]): void; bodies(): any[] }> {
  let queue: { status: number; body: unknown }[] = [];
  const server = await startFixtureServer({
    fallback: (_req, res) => {
      const next = (queue.length > 1 ? queue.shift() : queue[0]) ?? { status: 200, body: {} };
      json(res, next.status, next.body);
    },
  });
  return {
    ...server,
    reply: (...bodies) => void (queue = bodies.map((b) => (typeof b === "object" && b !== null && "status" in b && "body" in b ? (b as { status: number; body: unknown }) : { status: 200, body: b }))),
    bodies: () => server.requests.map((r) => JSON.parse(r.body)),
  };
}
const anthropicText = (text: string) => ({ type: "message", content: [{ type: "text", text }], stop_reason: "end_turn" });
const geminiText = (text: string) => ({ candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }] });

describe("generateJson for the official APIs", () => {
  let api: Awaited<ReturnType<typeof startOfficialApi>>;
  beforeEach(async () => {
    api = await startOfficialApi();
  });
  afterEach(async () => {
    await api.close();
  });
  const official = (provider: AiConfig["provider"], baseUrl: string, overrides: Partial<AiConfig> = {}): AiConfig => ({
    ...DEFAULT_AI_CONFIG,
    enabled: true,
    provider,
    baseUrl,
    model: "test-model",
    apiKey: "fake-provider-key-0123456789",
    timeoutMs: 10_000,
    ...overrides,
  });

  it("throws not-configured without a provider", () => {
    const error = thrown(() => createLlmClient(official(null, api.url), { env: {} }));
    expect(error.code).toBe("not-configured");
    expect(error.message).toBe("Choose a provider");
  });

  it("calls the Messages API for anthropic", async () => {
    api.reply(anthropicText('{"ok": true}'));
    const client = createLlmClient(official("anthropic", `${api.url}/v1`), { env: {} });
    expect(client.provider).toBe("anthropic");
    expect(await client.generateJson(request())).toEqual({ ok: true });
    expect(api.requests[0]!.url).toBe("/v1/messages");
    expect(api.requests[0]!.headers["x-api-key"]).toBe("fake-provider-key-0123456789");
    expect(api.bodies()[0].output_config.format.schema).toEqual(request().schema);
  });

  it("calls generateContent for gemini", async () => {
    api.reply(geminiText('{"ok": true}'));
    const client = createLlmClient(official("gemini", `${api.url}/v1beta`), { env: {} });
    expect(client.provider).toBe("gemini");
    expect(await client.generateJson(request())).toEqual({ ok: true });
    expect(api.requests[0]!.url).toBe("/v1beta/models/test-model:generateContent");
    expect(api.requests[0]!.headers["x-goog-api-key"]).toBe("fake-provider-key-0123456789");
  });

  it("calls Chat Completions for openai, with the key and no temperature", async () => {
    api.reply({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: '{"ok": true}' } }] });
    const client = createLlmClient(official("openai", `${api.url}/v1`), { env: {} });
    expect(client.provider).toBe("openai");
    expect(await client.generateJson(request())).toEqual({ ok: true });
    expect(api.requests[0]!.url).toBe("/v1/chat/completions");
    expect(api.requests[0]!.headers.authorization).toBe("Bearer fake-provider-key-0123456789");
    expect(api.bodies()[0]).not.toHaveProperty("temperature");
  });

  it("retries an invalid answer from anthropic with the answer and the error, the user turn last", async () => {
    api.reply(anthropicText("Sure! ok"), anthropicText('{"ok": true}'));
    const client = createLlmClient(official("anthropic", `${api.url}/v1`), { env: {} });
    expect(await client.generateJson(request())).toEqual({ ok: true });
    expect(api.requests).toHaveLength(2);
    const retry = api.bodies()[1].messages as ChatMessage[];
    expect(retry.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(retry[1]!.content).toBe("Sure! ok");
    expect(retry[2]!.content).toContain("Answer again with JSON that matches the schema.");
  });

  it("retries an invalid answer from gemini with the answer as a model turn", async () => {
    api.reply(geminiText("nope"), geminiText('{"ok": true}'));
    const client = createLlmClient(official("gemini", `${api.url}/v1beta`), { env: {} });
    expect(await client.generateJson(request())).toEqual({ ok: true });
    const contents = api.bodies()[1].contents as { role: string }[];
    expect(contents.map((c) => c.role)).toEqual(["user", "model", "user"]);
  });

  it("does not retry a refusal, an out-of-space stop or an HTTP error", async () => {
    api.reply({ type: "message", content: [{ type: "text", text: "no" }], stop_reason: "refusal" });
    const refused = await caught(createLlmClient(official("anthropic", `${api.url}/v1`), { env: {} }).generateJson(request()));
    expect(refused.message).toBe("The model refused");
    api.reply({ status: 529, body: { type: "error", error: { type: "overloaded_error", message: "Overloaded" } } });
    const busy = await caught(createLlmClient(official("anthropic", `${api.url}/v1`), { env: {} }).generateJson(request()));
    expect(busy.code).toBe("http");
    expect(api.requests).toHaveLength(2);
  });

  it("refuses the official endpoints without consent, before any request", () => {
    for (const provider of ["anthropic", "openai", "gemini"] as const) {
      const config = official(provider, { anthropic: "https://api.anthropic.com/v1", openai: "https://api.openai.com/v1", gemini: "https://generativelanguage.googleapis.com/v1beta" }[provider]);
      expect(thrown(() => createLlmClient(config, { env: {} })).code).toBe("remote-not-allowed");
      expect(() => createLlmClient({ ...config, allowRemote: true }, { env: {} })).not.toThrow();
    }
  });

  it("tests the connection of each official provider", async () => {
    api.reply(anthropicText('{"ok": true}'));
    expect(await testConnection(official("anthropic", `${api.url}/v1`), { env: {} })).toMatchObject({ ok: true, model: "test-model" });
    api.reply(geminiText('{"ok": true}'));
    expect(await testConnection(official("gemini", `${api.url}/v1beta`), { env: {} })).toMatchObject({ ok: true });
  });

  it("explains a refused key by provider, without the key", async () => {
    api.reply({ status: 401, body: { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } } });
    const refused = await testConnection(official("anthropic", `${api.url}/v1`), { env: {} });
    expect(refused).toEqual({ ok: false, error: "Anthropic refused the credentials (HTTP 401); check the API key" });
    api.reply({ status: 400, body: { error: { code: 400, message: "API key not valid. Please pass a valid API key.", details: [{ reason: "API_KEY_INVALID" }] } } });
    const invalid = await testConnection(official("gemini", `${api.url}/v1beta`), { env: {} });
    expect(invalid).toEqual({ ok: false, error: "Google Gemini refused the credentials (HTTP 400); check the API key" });
  });

  it("says when a key is missing, and does not blame the server", async () => {
    const result = await testConnection(official("openai", `${api.url}/v1`, { apiKey: null }), { env: {} });
    expect(result).toEqual({ ok: false, error: "Enter your OpenAI API key" });
    expect(api.requests).toHaveLength(0);
  });

  it("points at the internet connection when an official API can't be reached", async () => {
    const closed = await closedPortUrl();
    const result = await testConnection(official("anthropic", closed), { env: {} });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected an error");
    expect(result.error).toContain("Could not reach");
    expect(result.error).toContain("internet connection");
    expect(result.error).not.toContain("is the server running");
  });
});

describe("testConnection", () => {
  it("returns ok, the model and the time taken", async () => {
    fake.reply({ ok: true });
    const result = await testConnection(ollama(), { env: {} });
    expect(result).toMatchObject({ ok: true, model: "ornith-1.5:9b" });
    if (!result.ok) throw new Error("expected ok");
    expect(result.ms).toBeGreaterThanOrEqual(0);
    expect(fake.calls).toHaveLength(1);
  });

  it("returns a plain-language error when nothing is listening", async () => {
    const result = await testConnection(ollama({ baseUrl: await closedPortUrl() }), { env: {} });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected an error");
    expect(result.error.length).toBeGreaterThan(0);
  });

  it("returns an error instead of throwing when AI is not configured", async () => {
    const result = await testConnection(ollama({ model: "" }), { env: {} });
    expect(result.ok).toBe(false);
  });

  it("returns an error and sends nothing for a remote endpoint without consent", async () => {
    const result = await testConnection(bedrock({ allowRemote: false }), { env: {} });
    expect(result.ok).toBe(false);
    expect(fake.requests).toHaveLength(0);
  });

  it("returns an error when the server refuses the key", async () => {
    fake.reply({ status: 401, body: "unauthorized" });
    const result = await testConnection(ollama({ provider: "openai-compatible", apiKey: "sk-wrong" }), { env: {} });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected an error");
    expect(result.error).not.toContain("sk-wrong");
  });
});
