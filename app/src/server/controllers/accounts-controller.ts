/**
 * Accounts controller: GET /api/accounts (AccountsStatus, never a password), PUT /api/accounts (AccountsPatch →
 * AccountsStatus), POST /api/accounts/test (one sign-in check, with the test count guard). Mounted under
 * /api/accounts* and /api/accounts, guarded by headerGuard.
 */
import type { Hono } from "hono";
import {
  checkAccountsPatch,
  resolveAccounts,
  saveAccounts,
} from "../../config/accounts.js";
import {
  checkLoginUrls,
  isAccountId,
  testSignIn,
} from "../accounts.js";
import { redactSecrets } from "../../engine/redact.js";
import { MAX_SIGN_IN_TESTS } from "../models/sign-in-tests.js";
import type { Services } from "../models/services.js";

export interface AccountsControllerDeps {
  services: Services;
}

export function registerAccountsRoutes(app: Hono, deps: AccountsControllerDeps): void {
  const { services } = deps;

  app.get("/api/accounts", async (c) =>
    c.json((await resolveAccounts()).status, 200, {
      "cache-control": "no-store",
    }),
  );

  app.put("/api/accounts", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "The request body must be JSON." }, 400);
    }
    try {
      checkAccountsPatch(body);
      await checkLoginUrls(body, (await resolveAccounts()).status, {
        allowedHosts: services.host.allowedHosts(),
      });
    } catch (err) {
      return c.json(
        {
          error: redactSecrets(
            err instanceof Error ? err.message : String(err),
          ),
        },
        400,
      );
    }
    try {
      return c.json(await saveAccounts(body), 200, {
        "cache-control": "no-store",
      });
    } catch (err) {
      const message = redactSecrets(
        err instanceof Error ? err.message : String(err),
      );
      // A file system error (the folder can't be written) is Run Hound's problem, not the request's.
      if ((err as NodeJS.ErrnoException).code)
        return c.json(
          { error: `Could not save the test accounts: ${message}` },
          500,
        );
      return c.json({ error: message }, 400);
    }
  });

  app.post("/api/accounts/test", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        { error: 'The request body must be JSON like {"id": "a"}.' },
        400,
      );
    }
    const id = (body as { id?: unknown } | null)?.id;
    if (!isAccountId(id))
      return c.json(
        { error: 'id must be "a" (Account A) or "b" (Account B).' },
        400,
      );
    if (services.signInTests.value >= MAX_SIGN_IN_TESTS)
      return c.json(
        {
          error:
            "Another sign-in test is still running. Wait for it to finish.",
        },
        409,
      );
    services.signInTests.increment();
    try {
      return c.json(
        await testSignIn(id, await resolveAccounts(), {
          allowedHosts: services.host.allowedHosts(),
        }),
        200,
        { "cache-control": "no-store" },
      );
    } finally {
      services.signInTests.decrement();
    }
  });
}

