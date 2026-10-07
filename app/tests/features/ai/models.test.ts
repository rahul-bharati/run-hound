import { afterEach, describe, expect, it, vi } from "vitest";
import { startFakeLlm } from "../../support/fake-llm.js";
import { json, startFixtureServer, type FixtureServer } from "../../support/server.js";
import { listModels } from "../../../src/ai/models.js";
import { resolveModelsList } from "../../../src/server/models/ai-models.js";
import type { AiConfig } from "../../../src/ai/types.js";

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

const KEY = "fake-provider-key-0123456789";
const query = (s: FixtureServer) => s.requests.map((r) => new URL(r.url, "http://x").search);

describe("listModels for Anthropic", () => {
  const anthropic = (server: FixtureServer, overrides: Partial<ModelConfig> = {}) => cfg({ provider: "anthropic", baseUrl: `${server.url}/v1`, apiKey: KEY, ...overrides });

  it("lists models with the key and version headers, display name as details, and marks no-structured-output models unsuitable", async () => {
    const server = await track(
      startFixtureServer({
        routes: {
          "GET /v1/models": (_req, res) =>
            json(res, 200, {
              data: [
                { id: "claude-sonnet-x", display_name: "Claude Sonnet X", type: "model", capabilities: { structured_outputs: { supported: true } } },
                { id: "claude-old-1", display_name: "Claude Old 1", type: "model", capabilities: { structured_outputs: { supported: false } } },
                { id: "claude-bare", type: "model" },
              ],
              has_more: false,
              first_id: "claude-sonnet-x",
              last_id: "claude-bare",
            }),
        },
      }),
    );
    const list = await listModels(anthropic(server));
    expect(list.error).toBeNull();
    expect(list.models).toEqual([
      { id: "claude-bare", details: null, suitable: null },
      { id: "claude-old-1", details: "Claude Old 1", suitable: false },
      { id: "claude-sonnet-x", details: "Claude Sonnet X", suitable: true },
    ]);
    const request = server.requests[0]!;
    expect(request.url).toBe("/v1/models?limit=1000");
    expect(request.headers["x-api-key"]).toBe(KEY);
    expect(request.headers["anthropic-version"]).toBe("2023-06-01");
    expect(request.headers.authorization).toBeUndefined();
  });

  it("follows has_more and last_id with after_id", async () => {
    const pages: Record<string, unknown> = {
      "": { data: [{ id: "m-1" }, { id: "m-2" }], has_more: true, last_id: "m-2" },
      "m-2": { data: [{ id: "m-3" }], has_more: false, last_id: "m-3" },
    };
    const server = await track(
      startFixtureServer({ routes: { "GET /v1/models": (req, res) => json(res, 200, pages[new URL(req.url, "http://x").searchParams.get("after_id") ?? ""]) } }),
    );
    const list = await listModels(anthropic(server));
    expect(list.models.map((m) => m.id)).toEqual(["m-1", "m-2", "m-3"]);
    expect(query(server)).toEqual(["?limit=1000", "?limit=1000&after_id=m-2"]);
  });

  it("asks for the key and sends nothing without one", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const server = await track(startFixtureServer());
    expect(await listModels(anthropic(server, { apiKey: null }))).toEqual({ models: [], error: "Enter your Anthropic API key to list its models" });
    expect(await listModels(anthropic(server, { apiKey: "" }))).toEqual({ models: [], error: "Enter your Anthropic API key to list its models" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("says Anthropic refused the key on a 401", async () => {
    const server = await track(startFixtureServer({ routes: { "GET /v1/models": (_req, res) => json(res, 401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }) } }));
    expect(await listModels(anthropic(server))).toEqual({ models: [], error: "Anthropic refused the API key" });
  });

  it("points at the internet connection when it can't be reached", async () => {
    const origin = await closedPort();
    const list = await listModels(cfg({ provider: "anthropic", baseUrl: `${origin}/v1`, apiKey: KEY }));
    expect(list.error).toBe(`Could not reach ${origin} — check the internet connection`);
  });

  it("asks for consent before listing from the real endpoint, and sends nothing", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no requests allowed in this test"));
    const list = await listModels(cfg({ provider: "anthropic", baseUrl: "https://api.anthropic.com/v1", apiKey: KEY }));
    expect(list).toEqual({ models: [], error: "Tick the consent box to list models from api.anthropic.com" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("listModels for Gemini", () => {
  const gemini = (server: FixtureServer, overrides: Partial<ModelConfig> = {}) => cfg({ provider: "gemini", baseUrl: `${server.url}/v1beta`, apiKey: KEY, ...overrides });

  it("lists the generateContent models without the models/ prefix, with the key in a header", async () => {
    const server = await track(
      startFixtureServer({
        routes: {
          "GET /v1beta/models": (_req, res) =>
            json(res, 200, {
              models: [
                { name: "models/gemini-2.5-flash", displayName: "Gemini 2.5 Flash", supportedGenerationMethods: ["generateContent", "countTokens"] },
                { name: "models/gemini-embedding-001", displayName: "Gemini Embedding", supportedGenerationMethods: ["embedContent"] },
                { name: "models/gemini-2.5-flash-preview-tts", displayName: "Gemini 2.5 Flash TTS", supportedGenerationMethods: ["generateContent"] },
                { name: "models/aqa", supportedGenerationMethods: ["generateAnswer"] },
              ],
            }),
        },
      }),
    );
    const list = await listModels(gemini(server));
    expect(list.error).toBeNull();
    expect(list.models).toEqual([
      { id: "gemini-2.5-flash", details: "Gemini 2.5 Flash", suitable: null },
      { id: "gemini-2.5-flash-preview-tts", details: "Gemini 2.5 Flash TTS", suitable: false },
    ]);
    const request = server.requests[0]!;
    expect(request.url).toBe("/v1beta/models?pageSize=1000");
    expect(request.url).not.toContain("key=");
    expect(request.headers["x-goog-api-key"]).toBe(KEY);
    expect(request.headers.authorization).toBeUndefined();
  });

  it("follows nextPageToken with pageToken", async () => {
    const pages: Record<string, unknown> = {
      "": { models: [{ name: "models/gemini-a", supportedGenerationMethods: ["generateContent"] }], nextPageToken: "tok/2" },
      "tok/2": { models: [{ name: "models/gemini-b", supportedGenerationMethods: ["generateContent"] }] },
    };
    const server = await track(
      startFixtureServer({ routes: { "GET /v1beta/models": (req, res) => json(res, 200, pages[new URL(req.url, "http://x").searchParams.get("pageToken") ?? ""]) } }),
    );
    const list = await listModels(gemini(server));
    expect(list.models.map((m) => m.id)).toEqual(["gemini-a", "gemini-b"]);
    expect(query(server)).toEqual(["?pageSize=1000", "?pageSize=1000&pageToken=tok%2F2"]);
  });

  it("says Google refused the key on its HTTP 400 for an invalid key, and on a 403", async () => {
    const invalid = await track(
      startFixtureServer({
        routes: { "GET /v1beta/models": (_req, res) => json(res, 400, { error: { code: 400, message: "API key not valid. Please pass a valid API key.", details: [{ reason: "API_KEY_INVALID" }] } }) },
      }),
    );
    expect(await listModels(gemini(invalid))).toEqual({ models: [], error: "Google Gemini refused the API key" });
    const forbidden = await track(startFixtureServer({ routes: { "GET /v1beta/models": (_req, res) => json(res, 403, { error: { code: 403, message: "denied" } }) } }));
    expect(await listModels(gemini(forbidden))).toEqual({ models: [], error: "Google Gemini refused the API key" });
  });

  it("reports any other 400 as an HTTP error", async () => {
    const server = await track(startFixtureServer({ routes: { "GET /v1beta/models": (_req, res) => json(res, 400, { error: { code: 400, message: "bad page token" } }) } }));
    const list = await listModels(gemini(server));
    expect(list.error).toBe(`${server.url} answered HTTP 400 when asked for its models`);
  });

  it("asks for the key and sends nothing without one", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const server = await track(startFixtureServer());
    expect(await listModels(gemini(server, { apiKey: null }))).toEqual({ models: [], error: "Enter your Google Gemini API key to list its models" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("listModels for OpenAI", () => {
  it("lists the chat models with the Bearer key and leaves out the rest", async () => {
    const ids = [
      "gpt-5",
      "gpt-5-mini",
      "o4-mini",
      "text-embedding-3-small",
      "tts-1",
      "gpt-4o-transcribe",
      "gpt-4o-realtime-preview",
      "gpt-image-1",
      "dall-e-3",
      "whisper-1",
      "omni-moderation-latest",
      "gpt-4o-audio-preview",
      "gpt-4o-search-preview",
    ];
    const server = await track(startFixtureServer({ routes: { "GET /v1/models": (_req, res) => json(res, 200, { object: "list", data: ids.map((id) => ({ id, object: "model" })) }) } }));
    const list = await listModels(cfg({ provider: "openai", baseUrl: `${server.url}/v1`, apiKey: KEY }));
    expect(list.error).toBeNull();
    expect(list.models).toEqual([
      { id: "gpt-5", details: null, suitable: null },
      { id: "gpt-5-mini", details: null, suitable: null },
      { id: "o4-mini", details: null, suitable: null },
    ]);
    expect(server.requests[0]!.headers.authorization).toBe(`Bearer ${KEY}`);
  });

  it("asks for the key and sends nothing without one", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const server = await track(startFixtureServer());
    expect(await listModels(cfg({ provider: "openai", baseUrl: `${server.url}/v1`, apiKey: null }))).toEqual({ models: [], error: "Enter your OpenAI API key to list its models" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("says OpenAI refused the key on a 401 and that no models were found for an empty list", async () => {
    const refused = await track(startFixtureServer({ routes: { "GET /v1/models": (_req, res) => json(res, 401, { error: { message: "Incorrect API key" } }) } }));
    expect(await listModels(cfg({ provider: "openai", baseUrl: `${refused.url}/v1`, apiKey: KEY }))).toEqual({ models: [], error: "OpenAI refused the API key" });
    const onlyOther = await track(startFixtureServer({ routes: { "GET /v1/models": (_req, res) => json(res, 200, { data: [{ id: "whisper-1" }] }) } }));
    expect((await listModels(cfg({ provider: "openai", baseUrl: `${onlyOther.url}/v1`, apiKey: KEY }))).error).toBe(`No models found at ${onlyOther.url}`);
  });
});

describe("listModels without a provider", () => {
  it("asks to choose one and sends nothing", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(await listModels(cfg({ provider: null }))).toEqual({ models: [], error: "Choose a provider" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("resolveModelsList for the official providers", () => {
  const saved = { provider: "anthropic" as const, baseUrl: "https://api.anthropic.com/v1", region: null, apiKey: KEY, allowRemote: true };
  const fetched = () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ data: [{ id: "claude-x" }] }), { status: 200 }));
    return () => spy.mock.calls.map(([url, init]) => ({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> }));
  };

  it("lists at the official endpoint with the saved key, whatever baseUrl the query names", async () => {
    const calls = fetched();
    const out = await resolveModelsList(saved, { baseUrl: "https://evil.example/v1" });
    expect(out.ok && out.list.models.map((m) => m.id)).toEqual(["claude-x"]);
    expect(calls()).toHaveLength(1);
    expect(calls()[0]!.url).toBe("https://api.anthropic.com/v1/models?limit=1000");
    expect(calls()[0]!.headers["x-api-key"]).toBe(KEY);
  });

  it("never sends the saved key of one provider to another's endpoint", async () => {
    const calls = fetched();
    const out = await resolveModelsList(saved, { provider: "gemini", allowRemote: "1" });
    expect(out).toEqual({ ok: true, list: { models: [], error: "Enter your Google Gemini API key to list its models" } });
    expect(calls()).toHaveLength(0);
  });

  it("uses the key saved for the provider asked about, when the caller can give it", async () => {
    const calls = fetched();
    await resolveModelsList(saved, { provider: "openai", allowRemote: "1" }, (provider) => (provider === "openai" ? "sk-openai-saved" : null));
    expect(calls()[0]!.url).toBe("https://api.openai.com/v1/models");
    expect(calls()[0]!.headers.authorization).toBe("Bearer sk-openai-saved");
  });

  it("needs consent for the official endpoint unless the saved consent is for its host", async () => {
    const calls = fetched();
    const out = await resolveModelsList({ ...saved, allowRemote: false }, {});
    expect(out).toEqual({ ok: true, list: { models: [], error: "Tick the consent box to list models from api.anthropic.com" } });
    expect(calls()).toHaveLength(0);
  });

  it("asks to choose a provider when there is none", async () => {
    expect(await resolveModelsList({ ...saved, provider: null }, {})).toEqual({ ok: true, list: { models: [], error: "Choose a provider" } });
  });
});
