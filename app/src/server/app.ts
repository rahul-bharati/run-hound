/**
 * Composition root for the local server: builds the model facade (services) and mounts middleware in the same order
 * the pre-refactor app.ts used, then registers every controller's routes. Behaviour is byte-for-byte identical to the
 * pre-refactor app.ts: routes, methods, headers, status codes, JSON shapes, ordering and middleware application order
 * are all preserved.
 *
 * Mounted middleware (in order, applied via app.use):
 *  1. Security headers (every response, plus DEFAULT_CSP unless one is set or the response is image/*).
 *  2. Host allow-list (loopback + extraHosts; cross-site Origin on POST/PUT is refused).
 *  3. JSON-only API guard on /api/* (POST/PUT must be application/json, else 415).
 * Then the UI route (GET /) is registered, then the per-route headerGuard for /api/ai* and /api/accounts*. Finally
 * controllers mount /api/plan, /api/runs/*, /api/ai/* and /api/accounts/*.
 */
import { Hono } from "hono";
import {
  buildUi,
  registerAccountsRoutes,
  registerAiRoutes,
  registerPlanRoutes,
  registerRunsRoutes,
  registerUiRoutes,
} from "./controllers/index.js";
import {
  headerGuard,
  hostAllow,
  jsonOnlyApi,
  securityHeaders,
} from "./middleware/index.js";
import { buildServices } from "./models/services.js";
import type { Services } from "./models/services.js";
import type { ServerOptions } from "./interfaces/server.js";

export type { ServerOptions };

export interface CreateAppResult {
  app: Hono;
  services: Services;
}

/** Build the Hono app and the services facade for it (returned for tests / future wiring). */
export function createApp(options: ServerOptions = {}): Hono {
  const services = buildServices(options);
  const app = new Hono();

  // Security headers run after everything else (every response carries nosniff + DENY + no-referrer + default CSP).
  app.use("*", securityHeaders());

  // Host allow-list: only loopback + configured extras; cross-site POST/PUT refused.
  app.use("*", hostAllow(services.host.hostAllowed));

  // UI: pre-render once so the inline script/style hashes are stable.
  const { uiHtml, uiPolicy } = buildUi(services);
  registerUiRoutes(app, { services, uiHtml, uiPolicy });

  // JSON-only guard for /api/* POST/PUT (cross-site page can send text/plain without a preflight, but not JSON).
  app.use("/api/*", jsonOnlyApi());

  // Per-route headerGuard for AI and accounts (X-Run-Hound + Sec-Fetch-Site) — applied before their routes register.
  const aiGuard = headerGuard("/api/ai");
  app.use("/api/ai", aiGuard);
  app.use("/api/ai/*", aiGuard);
  const accountsGuard = headerGuard("/api/accounts");
  app.use("/api/accounts", accountsGuard);
  app.use("/api/accounts/*", accountsGuard);

  // Controllers: plan, runs, AI (settings, models, test), accounts (status, save, test).
  registerPlanRoutes(app, { services });
  registerRunsRoutes(app, { services });
  registerAiRoutes(app, { services });
  registerAccountsRoutes(app, { services });

  app.notFound((c) => c.json({ error: "Not found." }, 404));
  return app;
}
