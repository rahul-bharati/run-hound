import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startFakeLlm, type FakeLlm } from "../../test-support/fake-llm.js";
import { startFixtureServer } from "../../test-support/server.js";
import { createLlmClient, testConnection } from "./client.js";
import { DEFAULT_AI_CONFIG } from "./config.js";
import type { ChatMessage } from "./openai-compatible.js";
import { AiError, type AiConfig, type JsonRequest } from "./types.js";

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
/** Messages of an OpenAI-compatible call. */
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
    expect(fake.calls[0]!.path).toBe("/v1/chat/completions");
    expect(messagesOf(0)).toEqual([
      { role: "system", content: "Answer with JSON." },
      { role: "user", content: "Are you there?" },
    ]);
    expect(fake.calls[0]!.body.response_format.json_schema.name).toBe("ok_check");
  });

  it("returns the validated answer from an OpenAI-compatible server, with the key", async () => {
    fake.reply({ ok: true });
    const client = createLlmClient(ollama({ provider: "openai-compatible", apiKey: "sk-test-key" }), { env: {} });
    expect(await client.generateJson(request())).toEqual({ ok: true });
    expect(fake.calls[0]!.headers.authorization).toBe("Bearer sk-test-key");
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
