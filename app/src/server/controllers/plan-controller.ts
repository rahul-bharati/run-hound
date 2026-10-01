/**
 * Plan controller: POST /api/plan takes a URL (and optional AI flag and sign-in account), runs discoverAndPlan through
 * planBounded, redacts secrets, hides usernames in the response, and stores the plan for /api/runs. A failed sign-in
 * or bad URL answers 400 with the page's own reason; anything else is 500. The accounts' passwords are registered as
 * literal secrets for the duration of the request and unregistered in `finally`.
 */
import { randomUUID } from "node:crypto";
import type { Hono } from "hono";
import {
  hideInJson,
  isAccountId,
  registerPasswords,
  usernameHider,
} from "../accounts.js";
import { notReadyMessage, resolveAccounts } from "../../config/accounts.js";
import { aiForRequest, planBounded, type SignedInForPlanning } from "../models/ai-session.js";
import type { Services } from "../models/services.js";
import { redactSecrets } from "../../engine/redact.js";
import type { Plan } from "../../core/types.js";

export interface PlanControllerDeps {
  services: Services;
}

export function registerPlanRoutes(app: Hono, deps: PlanControllerDeps): void {
  const { services } = deps;
  app.post("/api/plan", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        {
          error:
            'The request body must be JSON like {"url": "http://localhost:3000/"}.',
        },
        400,
      );
    }
    const url = (body as { url?: unknown } | null)?.url;
    if (typeof url !== "string" || url.trim() === "")
      return c.json(
        { error: "Enter the URL of the page with your form." },
        400,
      );
    const wantAi = (body as { ai?: unknown }).ai;
    if (wantAi !== undefined && typeof wantAi !== "boolean")
      return c.json({ error: "ai must be true or false." }, 400);
    const signInAs = (body as { signInAs?: unknown }).signInAs;
    if (signInAs !== undefined && signInAs !== null && !isAccountId(signInAs)) {
      return c.json(
        {
          error:
            'signInAs must be "a" (Account A), "b" (Account B) or null (not signed in).',
        },
        400,
      );
    }
    // An account that isn't set up is refused before anything is sent to the app.
    let signedIn: SignedInForPlanning | undefined;
    if (isAccountId(signInAs)) {
      const { config, status } = await resolveAccounts();
      const why = notReadyMessage(status.accounts[signInAs]);
      if (why) return c.json({ error: redactSecrets(why) }, 400);
      signedIn = { id: signInAs, accounts: config };
    }

    const unregister = signedIn
      ? registerPasswords(signedIn.accounts, [signedIn.id])
      : () => undefined;
    const hide = usernameHider(signedIn?.accounts);
    try {
      const { ai, warning } = await aiForRequest(wantAi);
      const { plan, warning: budgetWarning } = await planBounded(
        url.trim(),
        ai,
        c.req.raw.signal,
        services.host.aiPlanBudgetMs,
        (target, opts) =>
          services.discoverAndPlan(target, {
            checks: services.options.checks,
            allowedHosts: services.options.allowedHosts,
            ...opts,
          }),
        signedIn,
      );
      const planId = randomUUID();
      services.plans.set(planId, { plan, ai: ai !== undefined });
      // The stored plan keeps the real target; what leaves the process is redacted (and names no username).
      const warnings = [
        ...services.planWarnings(plan),
        ...(warning ? [warning] : []),
        ...(budgetWarning ? [budgetWarning] : []),
      ].map((w) => hide(redactSecrets(w)));
      return c.json(
        {
          planId,
          plan: hideInJson(redactPlan(plan), hide),
          checks: await services.checkTitles(services.checks),
          warnings,
        },
        200,
      );
    } catch (err) {
      const message = hide(
        redactSecrets(
          services.cleanErrorMessage(
            err instanceof Error ? err.message : String(err),
          ),
        ),
      );
      if (services.isUserError(err)) return c.json({ error: message }, 400);
      return c.json({ error: `Could not plan a run: ${message}` }, 500);
    } finally {
      unregister();
    }
  });
}

/** A plan with secrets redacted (its target URL may carry a token). */
function redactPlan(plan: Plan): Plan {
  return JSON.parse(redactSecrets(JSON.stringify(plan))) as Plan;
}
