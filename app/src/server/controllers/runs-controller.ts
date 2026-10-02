/**
 * Runs controller: starts, lists, polls, stops, reruns and serves the artifacts. Parses requests, hands them to
 * RunsFlow, and serialises responses.
 */
import type { Hono } from "hono";
import type { IRunsFlow } from "../../interfaces/server.js";

export interface RunsControllerDeps {
  flow: IRunsFlow;
}

export function registerRunsRoutes(app: Hono, deps: RunsControllerDeps): void {
  app.post("/api/runs", async (c) => {
    let body: { planId?: unknown; approved?: unknown; allowDestructive?: unknown; headed?: unknown };
    try {
      body = ((await c.req.json()) ?? {}) as typeof body;
    } catch {
      return c.json({ error: "The request body must be JSON." }, 400);
    }
    const out = await deps.flow.start(body);
    if (!out.ok) return c.json({ error: out.message }, out.status);
    return c.json({ runId: out.runId }, 202);
  });

  app.get("/api/runs", async (c) =>
    c.json({ runs: await deps.flow.list() }, 200, { "cache-control": "no-store" }),
  );

  app.post("/api/runs/:runId/stop", async (c) => {
    const out = await deps.flow.stop(c.req.param("runId"));
    if (!out.ok) return c.json({ error: out.message }, out.status);
    return c.json({ runId: out.runId }, 202);
  });

  app.post("/api/runs/:runId/rerun", async (c) => {
    const out = await deps.flow.rerun(c.req.param("runId"), c.req.raw.signal);
    if (!out.ok) return c.json({ error: out.message }, out.status);
    return c.json({ runId: out.runId }, 202);
  });

  app.get("/api/runs/:runId", async (c) => {
    const out = await deps.flow.runStatus(c.req.param("runId"));
    if ("notFound" in out) return c.json({ error: "Unknown run." }, 404);
    return c.json(out);
  });

  app.get("/api/runs/:runId/live", async (c) => {
    const out = await deps.flow.runLive(c.req.param("runId"));
    if ("notFound" in out) return c.json({ error: "Unknown run." }, 404);
    return c.json(out, 200, { "cache-control": "no-store" });
  });

  app.get("/api/runs/:runId/live.jpg", (c) => {
    const { frame } = deps.flow.runFrame(c.req.param("runId"));
    if (!frame) return c.json({ error: "No frame yet." }, 404);
    return c.body(new Uint8Array(frame), 200, {
      "content-type": "image/jpeg",
      "cache-control": "no-store",
    });
  });

  app.get("/api/runs/:runId/:file{report\\.(?:json|md|html)}", async (c) => {
    const file = await deps.flow.reportFile(c.req.param("runId"), c.req.param("file"));
    if (!file) return c.json({ error: "Not found." }, 404);
    const headers: Record<string, string> = { "content-type": file.contentType };
    if (file.contentSecurityPolicy) headers["content-security-policy"] = file.contentSecurityPolicy;
    return c.body(file.body, 200, headers);
  });

  app.get("/api/runs/:runId/specs/:file", async (c) => {
    const out = await deps.flow.specFile(c.req.param("runId"), c.req.param("file"));
    if ("invalidName" in out) return c.json({ error: "Invalid file name." }, 400);
    if ("notFound" in out) return c.json({ error: "Not found." }, 404);
    return c.body(out.file.body, 200, { "content-type": "text/plain; charset=utf-8" });
  });

  app.get("/api/runs/:runId/artifacts/:file", async (c) => {
    const out = await deps.flow.artifactFile(c.req.param("runId"), c.req.param("file"));
    if ("invalidName" in out) return c.json({ error: "Invalid file name." }, 400);
    if ("notFound" in out) return c.json({ error: "Not found." }, 404);
    return c.body(new Uint8Array(out.file.bytes), 200, { "content-type": out.file.contentType });
  });
}
