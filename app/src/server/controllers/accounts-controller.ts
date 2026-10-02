/**
 * Accounts controller: GET /api/accounts (AccountsStatus, never a password), PUT /api/accounts (AccountsPatch →
 * AccountsStatus), POST /api/accounts/test (one sign-in check, with the test count guard). Mounted under
 * /api/accounts* and /api/accounts, guarded by headerGuard.
 */
import type { Hono } from "hono";
import type { IAccountsFlow } from "../../interfaces/server.js";

export interface AccountsControllerDeps {
  flow: IAccountsFlow;
}

export function registerAccountsRoutes(app: Hono, deps: AccountsControllerDeps): void {
  app.get("/api/accounts", async (c) => {
    return c.json(await deps.flow.status(), 200, { "cache-control": "no-store" });
  });

  app.put("/api/accounts", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "The request body must be JSON." }, 400);
    }
    const out = await deps.flow.save(body);
    if (!out.ok) return c.json({ error: out.message }, out.status);
    return c.json(out.status, 200, { "cache-control": "no-store" });
  });

  app.post("/api/accounts/test", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'The request body must be JSON like {"id": "a"}.' }, 400);
    }
    const out = await deps.flow.testSignIn((body as { id?: unknown } | null)?.id);
    if (!out.ok) return c.json({ error: out.message }, out.status);
    return c.json(out.check, 200, { "cache-control": "no-store" });
  });
}