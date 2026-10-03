/**
 * Plan controller: POST /api/plan. Parses the body, hands it to PlanFlow, and formats the response. All account, sign-in,
 * AI, redaction and engine orchestration live in the flow.
 */
import type { Context, Hono } from "hono";
import { isAccountId } from "../models/account-flow.js";
import type { IPlanFlow } from "../../interfaces/server.js";
import type { AccountId } from "../../types/accounts.js";

export interface PlanControllerDeps {
  flow: IPlanFlow;
}

export function registerPlanRoutes(app: Hono, deps: PlanControllerDeps): void {
  app.post("/api/plan", async (c) => {
    const parsed = await parsePlanBody(c);
    if (!parsed.ok) return parsed.response;

    const outcome = await deps.flow.planForRequest({
      url: parsed.url,
      ai: parsed.ai,
      signInAs: parsed.signInAs,
      signal: c.req.raw.signal,
    });
    try {
      if (!outcome.ok) return c.json({ error: outcome.error.message }, outcome.error.status);
      return c.json(
        {
          planId: outcome.planId,
          plan: outcome.plan,
          checks: outcome.checks,
          warnings: outcome.warnings,
        },
        200,
      );
    } finally {
      outcome.unregister();
    }
  });
}

type ParsedBody =
  | { ok: true; url: string; ai?: boolean; signInAs?: AccountId | null }
  | { ok: false; response: Response };

async function parsePlanBody(c: Context<any, "/api/plan">): Promise<ParsedBody> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return {
      ok: false,
      response: c.json({
        error: 'The request body must be JSON like {"url": "http://localhost:3000/"}.',
      }, 400),
    };
  }
  const url = (body as { url?: unknown } | null)?.url;
  if (typeof url !== "string" || url.trim() === "") {
    return { ok: false, response: c.json({ error: "Enter the URL of the page with your form." }, 400) };
  }
  const wantAi = (body as { ai?: unknown }).ai;
  if (wantAi !== undefined && typeof wantAi !== "boolean") {
    return { ok: false, response: c.json({ error: "ai must be true or false." }, 400) };
  }
  const signInAs = (body as { signInAs?: unknown }).signInAs;
  if (signInAs !== undefined && signInAs !== null && !isAccountId(signInAs)) {
    return {
      ok: false,
      response: c.json({
        error: 'signInAs must be "a" (Account A), "b" (Account B) or null (not signed in).',
      }, 400),
    };
  }
  return {
    ok: true,
    url,
    ...(wantAi !== undefined ? { ai: wantAi } : {}),
    ...(signInAs !== undefined ? { signInAs } : {}),
  };
}