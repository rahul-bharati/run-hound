/**
 * Desktop controller: GET/POST /api/onboarding and POST /api/data/delete. Mounted by server/desktop-app.ts only, so the
 * routes exist in the desktop app's engine and nowhere else. Each path is behind the same header guard as /api/ai
 * (X-Run-Hound, Sec-Fetch-Site); the Origin check and the JSON-only rule are the app-wide middleware's.
 */
import type { Hono } from "hono";
import type { IDesktopFlow } from "../../interfaces/server.js";
import { headerGuard } from "../middleware/index.js";

export interface DesktopControllerDeps {
  flow: IDesktopFlow;
}

/** The request's JSON body, or `null` when it is not JSON. */
async function readBody(c: { req: { json(): Promise<unknown> } }): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

export function registerDesktopRoutes(app: Hono, deps: DesktopControllerDeps): void {
  const onboardingGuard = headerGuard("/api/onboarding");
  app.use("/api/onboarding", onboardingGuard);
  const dataGuard = headerGuard("/api/data");
  app.use("/api/data/*", dataGuard);

  app.get("/api/onboarding", async (c) => c.json(await deps.flow.getOnboarding(), 200, { "cache-control": "no-store" }));
  app.post("/api/onboarding", async (c) => {
    const body = await readBody(c);
    if (body === null) return c.json({ error: "The request body must be JSON." }, 400);
    const out = await deps.flow.postOnboarding(body);
    if (!out.ok) return c.json({ error: out.message }, out.status);
    return c.json(out.marker, 200, { "cache-control": "no-store" });
  });
  app.post("/api/data/delete", async (c) => {
    const body = await readBody(c);
    if (body === null) return c.json({ error: "The request body must be JSON." }, 400);
    const out = await deps.flow.deleteData(body);
    if (!out.ok) return c.json({ error: out.message }, out.status);
    return c.json(out.result, 200, { "cache-control": "no-store" });
  });
}
