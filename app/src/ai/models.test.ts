import { afterEach, describe, expect, it, vi } from "vitest";
import { startFakeLlm } from "../../test-support/fake-llm.js";
import { json, startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import { listModels } from "./models.js";
import type { AiConfig } from "./types.js";

type ModelConfig = Pick<AiConfig, "provider" | "baseUrl" | "apiKey" | "region" | "allowRemote">;
const cfg = (overrides: Partial<ModelConfig>): ModelConfig => ({
  provider: "ollama",
  baseUrl: "http://127.0.0.1:11434/v1",
  apiKey: null,
  region: null,
  allowRemote: false,
  ...overrides,
});

const servers: FixtureServer[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map((s) => s.close()));
});
async function track<T extends FixtureServer>(server: Promise<T>): Promise<T> {
  const s = await server;
  servers.push(s);
  return s;
}
async function closedPort(): Promise<string> {
  const server = await startFixtureServer();
  await server.close();
  return server.url;
}
const paths = (s: FixtureServer) => s.requests.map((r) => new URL(r.url, "http://x").pathname);

describe("listModels", () => {
  it("lists Ollama models from /api/tags with size and quantization, sorted by id", async () => {
    const fake = await track(
      startFakeLlm({
        models: [
          { id: "ornith-1.5:9b", parameterSize: "9.0B", quantization: "Q4_K_M", capabilities: ["completion", "tools"] },
          { id: "nomic-embed-text:latest", parameterSize: "137M", quantization: "F16", capabilities: ["embedding"] },
          { id: "qwen-old:7b", parameterSize: "7.6B", quantization: "Q4_0" },
        ],
      }),
    );
    const list = await listModels(cfg({ baseUrl: fake.baseUrl }));
    expect(list.error).toBeNull();
    expect(list.models).toEqual([
      { id: "nomic-embed-text:latest", details: "137M F16", suitable: false },
      { id: "ornith-1.5:9b", details: "9.0B Q4_K_M", suitable: true },
      { id: "qwen-old:7b", details: "7.6B Q4_0", suitable: null },
    ]);
    expect(paths(fake)).toContain("/api/tags");
    expect(paths(fake)).not.toContain("/v1/models");
  });

  it("falls back to /v1/models when /api/tags is not found", async () => {
    const server = await track(
      startFixtureServer({
        routes: { "GET /v1/models": (_req, res) => json(res, 200, { object: "list", data: [{ id: "zeta" }, { id: "alpha" }] }) },
      }),
    );
    const list = await listModels(cfg({ baseUrl: `${server.url}/v1` }));
    expect(list.error).toBeNull();
    expect(list.models).toEqual([
      { id: "alpha", details: null, suitable: null },
      { id: "zeta", details: null, suitable: null },
    ]);
    expect(paths(server)).toEqual(["/api/tags", "/v1/models"]);
  });

  it("lists OpenAI-compatible models from /models with the Bearer key and marks embedding models unsuitable", async () => {
    const fake = await track(startFakeLlm({ models: [{ id: "text-embedding-3-small" }, { id: "gpt-x" }] }));
    const list = await listModels(cfg({ provider: "openai-compatible", baseUrl: fake.baseUrl, apiKey: "sk-test-key" }));
    expect(list.error).toBeNull();
    expect(list.models).toEqual([
      { id: "gpt-x", details: null, suitable: null },
      { id: "text-embedding-3-small", details: null, suitable: false },
    ]);
    const request = fake.requests.find((r) => r.url.startsWith("/v1/models"))!;
    expect(request.headers.authorization).toBe("Bearer sk-test-key");
    expect(paths(fake)).not.toContain("/api/tags");
  });

  it("returns an empty list and no error for Bedrock", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(await listModels(cfg({ provider: "bedrock", baseUrl: "", region: "us-east-1", allowRemote: true }))).toEqual({ models: [], error: null });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("asks for consent and sends nothing for a remote endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no requests allowed in this test"));
    const list = await listModels(cfg({ provider: "openai-compatible", baseUrl: "https://api.openai.com/v1", apiKey: "sk-test-key" }));
    expect(list).toEqual({ models: [], error: "Tick the consent box to list models from api.openai.com" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("says Ollama may not be running when nothing answers", async () => {
    const origin = await closedPort();
    const list = await listModels(cfg({ baseUrl: `${origin}/v1` }));
    expect(list.models).toEqual([]);
    expect(list.error).toBe(`Nothing is answering at ${origin} — is Ollama running?`);
  });

  it("says the server may not be running for an OpenAI-compatible endpoint", async () => {
    const origin = await closedPort();
    const list = await listModels(cfg({ provider: "openai-compatible", baseUrl: `${origin}/v1` }));
    expect(list.models).toEqual([]);
    expect(list.error).toBe(`Nothing is answering at ${origin} — is the server running?`);
  });

  it("suggests ollama pull when Ollama has no models", async () => {
    const fake = await track(startFakeLlm({ models: [] }));
    const list = await listModels(cfg({ baseUrl: fake.baseUrl }));
    expect(list.models).toEqual([]);
    expect(list.error).toContain(`No models found at ${fake.url}`);
    expect(list.error).toContain("ollama pull");
  });

  it("says no models were found for an empty OpenAI-compatible list", async () => {
    const fake = await track(startFakeLlm({ models: [] }));
    const list = await listModels(cfg({ provider: "openai-compatible", baseUrl: fake.baseUrl }));
    expect(list.error).toBe(`No models found at ${fake.url}`);
  });

  it("says the server refused the key on a 401", async () => {
    const server = await track(
      startFixtureServer({ routes: { "GET /v1/models": (_req, res) => json(res, 401, { error: { message: "Incorrect API key" } }) } }),
    );
    const list = await listModels(cfg({ provider: "openai-compatible", baseUrl: `${server.url}/v1`, apiKey: "sk-wrong" }));
    expect(list.models).toEqual([]);
    expect(list.error).toBe("The server refused the API key");
  });
});
