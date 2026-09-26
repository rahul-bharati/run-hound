import { afterEach, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import { httpError, send } from "./http.js";
import { ollamaChatJson } from "./ollama.js";
import { chatJson } from "./openai-compatible.js";
import { AiError } from "./types.js";

/** Fake credential shapes only: never valid anywhere. */
const OPENROUTER_KEY = `sk-or-v1-${"0123456789abcdef".repeat(4)}`;
const GROQ_KEY = "gsk_aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY3zA5bC7dE9fG1hJ3";
const TOGETHER_KEY = "f".repeat(8) + "0123456789abcdef".repeat(3) + "01234567";
const LOWERCASE_OPENAI_KEY = "sk-1234567890abcdef1234567890abcdef1234567890abcdef";
const GOOGLE_KEY = "AIzaSyFAKEfake0123456789FAKEfake01234";
const XAI_KEY = "xai-FAKEfake0123456789FAKEfake0123456789FAKEfake01";
const HF_KEY = "hf_FAKEfakeFAKEfakeFAKEfakeFAKEfake01";
/** Configured keys can have any shape; this one matches no known pattern. */
const ODD_KEY = "my-gateway-key-2F7Q9ZK4X1";

const servers: FixtureServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

/** A server that answers every request with `status` and a body quoting the credentials it was sent. */
async function echoServer(status: number): Promise<string> {
  const server = await startFixtureServer({
    fallback: (req, res) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: {
            message: `Invalid credentials. Authorization header was: ${String(req.headers.authorization ?? "")}; sso token: ${String(req.headers["x-amz-sso_bearer_token"] ?? "")}`,
          },
        }),
      );
    },
  });
  servers.push(server);
  return server.url;
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

const SCHEMA = { name: "plan_review", schema: { type: "object", properties: {}, required: [], additionalProperties: false } };
const MESSAGES = [{ role: "user" as const, content: "hi" }];

describe("AI endpoint errors never carry the key (AI-2)", () => {
  it("removes the configured key a gateway echoes back in an error (openai-compatible)", async () => {
    const base = await echoServer(400);
    const error = await caught(chatJson({ baseUrl: `${base}/v1`, model: "m", apiKey: OPENROUTER_KEY, timeoutMs: 10_000 }, MESSAGES, SCHEMA));
    expect(error.code).toBe("http");
    expect(error.message).toMatch(/HTTP 400/);
    expect(error.message).not.toContain(OPENROUTER_KEY);
    expect(error.message).not.toContain(OPENROUTER_KEY.slice(12, 40));
    expect(error.message).toContain("[REDACTED:api-key]");
  });

  it("removes a configured key of any shape, and on a refused key (401) too", async () => {
    const base = await echoServer(401);
    const error = await caught(chatJson({ baseUrl: `${base}/v1`, model: "m", apiKey: ODD_KEY, timeoutMs: 10_000 }, MESSAGES, SCHEMA));
    expect(error.code).toBe("auth");
    expect(error.message).not.toContain(ODD_KEY);
  });

  it("removes the key from Ollama's errors too", async () => {
    const base = await echoServer(500);
    const error = await caught(ollamaChatJson({ baseUrl: `${base}/v1`, model: "m", apiKey: GROQ_KEY, timeoutMs: 10_000 }, MESSAGES, SCHEMA));
    expect(error.message).not.toContain(GROQ_KEY);
  });

  it("send removes every credential header value it sent from an error answer, not from a good one", async () => {
    const base = await echoServer(500);
    const token = "sso-access-token-FAKE-0123456789";
    const bad = await send(`${base}/federation/credentials`, { method: "GET", headers: { accept: "application/json", "x-amz-sso_bearer_token": token } }, 10_000);
    expect(bad.status).toBe(500);
    expect(bad.text).not.toContain(token);
    const good = await startFixtureServer({ fallback: (_req, res) => void res.end(JSON.stringify({ roleCredentials: { secretAccessKey: token } })) });
    servers.push(good);
    const ok = await send(`${good.url}/x`, { method: "GET", headers: { "x-amz-sso_bearer_token": token } }, 10_000);
    // A 2xx body is data the caller parses (credentials from IAM Identity Center): left as it is.
    expect(ok.text).toContain(token);
  });

  it.each([
    ["OpenRouter", OPENROUTER_KEY],
    ["Groq", GROQ_KEY],
    ["Together (64 hex characters)", TOGETHER_KEY],
    ["OpenAI, lower case", LOWERCASE_OPENAI_KEY],
    ["Google AI", GOOGLE_KEY],
    ["xAI", XAI_KEY],
    ["Hugging Face", HF_KEY],
  ])("httpError redacts a %s key quoted in the body", (_name, key) => {
    const error = httpError(400, `{"error":"Incorrect API key provided: ${key}"}`);
    expect(error.message).not.toContain(key);
    expect(error.message).toMatch(/HTTP 400/);
  });

  it("httpError redacts a Bearer token and an api_key value of any shape", () => {
    expect(httpError(400, "bad header Authorization: Bearer abc.DEF-ghi_123").message).not.toContain("abc.DEF-ghi_123");
    expect(httpError(400, '{"detail":"api_key=zz-custom-9f8e7d6c5b is not valid"}').message).not.toContain("zz-custom-9f8e7d6c5b");
    // Ordinary words stay readable.
    expect(httpError(404, '{"error":"model not found"}').message).toContain("model not found");
  });
});
