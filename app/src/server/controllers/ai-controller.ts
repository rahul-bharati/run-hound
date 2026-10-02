/**
 * AI controller: GET /api/ai, PUT /api/ai, POST /api/ai/test, GET /api/ai/models, GET /api/settings. Mounted under
 * /api/ai* and /api/ai, guarded by headerGuard.
 */
import type { Hono } from "hono";
import type { IAiFlow } from "../../interfaces/server.js";

export interface AiControllerDeps {
  flow: IAiFlow;
}

export function registerAiRoutes(app: Hono, deps: AiControllerDeps): void {
  app.get("/api/settings", async (c) => c.json(await deps.flow.getSettings()));
  app.get("/api/ai", async (c) => c.json(await deps.flow.getAi(), 200, { "cache-control": "no-store" }));
  app.put("/api/ai", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "The request body must be JSON." }, 400);
    }
    const out = await deps.flow.putAi(body);
    if (!out.ok) return c.json({ error: out.message }, out.status);
    const payload: Record<string, unknown> = { ...(out.status as Record<string, unknown>), ...(out.notice ? { notice: out.notice } : {}) };
    return c.json(payload, 200, { "cache-control": "no-store" });
  });
  app.post("/api/ai/test", async (c) => {
    const result = await deps.flow.postAiTest();
    return c.json(result, 200, { "cache-control": "no-store" });
  });
  app.get("/api/ai/models", async (c) => {
    const out = await deps.flow.getAiModels({
      provider: c.req.query("provider") ?? undefined,
      baseUrl: c.req.query("baseUrl") ?? undefined,
      allowRemote: c.req.query("allowRemote") ?? undefined,
    });
    if (!out.ok) return c.json({ error: out.message }, out.status);
    return c.json(out.list, 200, { "cache-control": "no-store" });
  });
}