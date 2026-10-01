import { describe, expect, it } from "vitest";
import { boundSession, type AiSession } from "./session.js";
import { AiError, type JsonRequest, type LlmClient } from "./types.js";

/** A client whose calls wait `ms` (or until their signal aborts) and then answer {ok: true}. */
function slowClient(ms: number, seen: (AbortSignal | undefined)[] = []): LlmClient {
  return {
    provider: "ollama",
    model: "fake",
    generateJson<T>(request: JsonRequest<T>): Promise<T> {
      seen.push(request.signal);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve({ ok: true } as T), ms);
        request.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new AiError("timeout", "aborted"));
        });
      });
    },
  };
}

const session = (client: LlmClient): AiSession => ({ client, remote: false, features: { review: true, suggest: true, explain: false } });
const req: JsonRequest<unknown> = { name: "x", system: "s", user: "u", schema: {}, validate: (v) => v };

async function rejection(promise: Promise<unknown>): Promise<AiError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AiError);
  return error as AiError;
}

describe("boundSession", () => {
  it("passes calls through within the budget, keeping provider, model, remote and features", async () => {
    const bound = boundSession(session(slowClient(5)), { budgetMs: 1_000 });
    expect(bound.session.client.provider).toBe("ollama");
    expect(bound.session.client.model).toBe("fake");
    expect(bound.session.features).toEqual({ review: true, suggest: true, explain: false });
    expect(await bound.session.client.generateJson(req)).toEqual({ ok: true });
    expect(bound.timedOut()).toBe(false);
  });

  it("stops calls once the whole budget is spent, across calls, with a timeout error", async () => {
    const bound = boundSession(session(slowClient(150)), { budgetMs: 250 });
    await bound.session.client.generateJson(req);
    const started = Date.now();
    const error = await rejection(bound.session.client.generateJson(req));
    expect(Date.now() - started).toBeLessThan(200);
    expect(error.code).toBe("timeout");
    expect(error.message).toMatch(/took longer than/);
    expect(bound.timedOut()).toBe(true);
    // Later calls fail at once.
    expect((await rejection(bound.session.client.generateJson(req))).code).toBe("timeout");
  });

  it("starts the budget at the first call, not when the session is made", async () => {
    const bound = boundSession(session(slowClient(20)), { budgetMs: 100 });
    await new Promise((r) => setTimeout(r, 150));
    expect(await bound.session.client.generateJson(req)).toEqual({ ok: true });
  });

  it("aborts calls when the request's signal aborts", async () => {
    const controller = new AbortController();
    const seen: (AbortSignal | undefined)[] = [];
    const bound = boundSession(session(slowClient(5_000, seen)), { budgetMs: 60_000, signal: controller.signal });
    const call = bound.session.client.generateJson(req);
    setTimeout(() => controller.abort(), 20);
    const error = await rejection(call);
    expect(error.code).toBe("timeout");
    expect(seen[0]?.aborted).toBe(true);
    expect(bound.timedOut()).toBe(false);
  });
});
