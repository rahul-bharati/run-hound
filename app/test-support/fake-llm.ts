import type { ServerResponse } from "node:http";
import { json, startFixtureServer, type FixtureServer, type RecordedRequest } from "./server.js";

/** What the fake answers to one chat/converse call: a JSON value (serialized as the answer), raw text, or an HTTP error. */
export type FakeReply = unknown | { raw: string } | { status: number; body: string };

export interface FakeLlm extends FixtureServer {
  /** OpenAI-compatible base URL, e.g. http://127.0.0.1:5000/v1 */
  baseUrl: string;
  /** Chat-completion and converse requests, parsed. */
  calls: { path: string; body: any; headers: RecordedRequest["headers"] }[];
  /** Queue replies; each call takes the next one (the last one repeats when the queue runs dry). */
  reply(...replies: FakeReply[]): void;
}

function isRaw(r: FakeReply): r is { raw: string } {
  return typeof r === "object" && r !== null && "raw" in r && Object.keys(r).length === 1;
}
function isError(r: FakeReply): r is { status: number; body: string } {
  return typeof r === "object" && r !== null && "status" in r && "body" in r && Object.keys(r).length === 2;
}

/**
 * A fake LLM server for tests: OpenAI-compatible `POST /v1/chat/completions`, `GET /v1/models`, Ollama `GET /api/tags`
 * and Bedrock `POST /model/<id>/converse` (any model id). Replies come from the queue set with reply().
 * `models` sets /v1/models and /api/tags (Ollama-style entries with details and capabilities).
 */
export async function startFakeLlm(options: {
  models?: { id: string; parameterSize?: string; quantization?: string; capabilities?: string[] }[];
  /** Delay before answering chat/converse calls, for timeout tests. */
  delayMs?: number;
} = {}): Promise<FakeLlm> {
  const queue: FakeReply[] = [];
  const calls: FakeLlm["calls"] = [];
  const next = (): FakeReply => (queue.length > 1 ? queue.shift() : queue[0]) ?? { ok: true };
  const wait = () => new Promise((r) => setTimeout(r, options.delayMs ?? 0));

  const send = async (req: RecordedRequest, res: ServerResponse, shape: "openai" | "bedrock"): Promise<void> => {
    const path = new URL(req.url, "http://x").pathname;
    let body: any = null;
    try {
      body = JSON.parse(req.body);
    } catch {
      body = req.body;
    }
    calls.push({ path, body, headers: req.headers });
    await wait();
    const r = next();
    if (isError(r)) {
      res.writeHead(r.status, { "content-type": "application/json" });
      res.end(r.body);
      return;
    }
    const text = isRaw(r) ? r.raw : JSON.stringify(r);
    if (shape === "openai") {
      return json(res, 200, {
        id: "chatcmpl-fake",
        object: "chat.completion",
        model: body?.model ?? "fake",
        choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: text } }],
      });
    }
    // Bedrock Converse with a forced tool: the answer is the tool input (raw text can't be tool input; send it as text).
    const content = isRaw(r) ? [{ text }] : [{ toolUse: { toolUseId: "t1", name: body?.toolConfig?.tools?.[0]?.toolSpec?.name ?? "answer", input: r } }];
    return json(res, 200, { output: { message: { role: "assistant", content } }, stopReason: isRaw(r) ? "end_turn" : "tool_use" });
  };

  const models = options.models ?? [];
  const server = await startFixtureServer({
    routes: {
      "POST /v1/chat/completions": (req, res) => send(req, res, "openai"),
      "GET /v1/models": (_req, res) => json(res, 200, { object: "list", data: models.map((m) => ({ id: m.id, object: "model" })) }),
      "GET /api/tags": (_req, res) =>
        json(res, 200, {
          models: models.map((m) => ({
            name: m.id,
            model: m.id,
            details: { parameter_size: m.parameterSize ?? "", quantization_level: m.quantization ?? "" },
            ...(m.capabilities ? { capabilities: m.capabilities } : {}),
          })),
        }),
    },
    // Converse paths carry the model id, so they can't be exact routes.
    fallback: (req, res) => {
      if (req.method === "POST" && /^\/model\/[^/]+\/converse$/.test(new URL(req.url, "http://x").pathname)) return send(req, res, "bedrock");
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
    },
  });
  return {
    ...server,
    baseUrl: `${server.url}/v1`,
    calls,
    reply: (...replies: FakeReply[]) => {
      queue.length = 0;
      queue.push(...replies);
    },
  };
}
