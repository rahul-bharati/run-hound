/**
 * Brief controller (A2): POST /api/briefs, GET and PUT /api/briefs/:id, POST /api/briefs/:id/approve. Parses the
 * bodies and hands them to BriefFlow. Registered only when the agent is enabled (RUNHOUND_AGENT=1).
 */
import type { Context, Hono } from "hono";
import { isAccountId } from "../models/account-flow.js";
import type { BriefEdit, BriefRequest } from "../../interfaces/agent.js";
import type { BriefFlowOutcome, IBriefFlow } from "../../interfaces/server.js";

export interface BriefControllerDeps {
  flow: IBriefFlow;
}

const answer = (c: Context, outcome: BriefFlowOutcome) =>
  outcome.ok ? c.json(outcome.draft, outcome.status) : c.json({ error: outcome.error }, outcome.status);

async function jsonObject(c: Context): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await c.req.json();
    return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** A BriefRequest from the body, or the reason it isn't one. */
function briefRequest(body: Record<string, unknown> | null): BriefRequest | string {
  if (body === null) return 'The request body must be JSON like {"goal": "make sure my tasks save", "url": "http://localhost:3000/"}.';
  const { goal, url, ticketContext, feature, signInAs } = body;
  if (typeof goal !== "string" || goal.trim() === "") return "Describe what to test.";
  if (typeof url !== "string" || url.trim() === "") return "Enter the URL of the app to test.";
  if (ticketContext !== undefined && ticketContext !== null && typeof ticketContext !== "string") return "ticketContext must be text or null.";
  if (feature !== undefined && feature !== null && typeof feature !== "string") return "feature must be text or null.";
  if (signInAs !== undefined && signInAs !== null && !isAccountId(signInAs)) return 'signInAs must be "a" (Account A), "b" (Account B) or null (not signed in).';
  return {
    goal,
    url,
    ...(ticketContext !== undefined ? { ticketContext } : {}),
    ...(feature !== undefined ? { feature } : {}),
    ...(signInAs !== undefined ? { signInAs } : {}),
  };
}

export function registerBriefRoutes(app: Hono, deps: BriefControllerDeps): void {
  app.post("/api/briefs", async (c) => {
    const request = briefRequest(await jsonObject(c));
    if (typeof request === "string") return c.json({ error: request }, 400);
    return answer(c, await deps.flow.create(request, c.req.raw.signal));
  });
  app.get("/api/briefs/:id", (c) => answer(c, deps.flow.get(c.req.param("id"))));
  app.put("/api/briefs/:id", async (c) => {
    const body = await jsonObject(c);
    if (body === null) return c.json({ error: 'The request body must be a JSON object of the fields to change, like {"goal": "..."}.' }, 400);
    return answer(c, await deps.flow.edit(c.req.param("id"), body as BriefEdit));
  });
  app.post("/api/briefs/:id/approve", async (c) => answer(c, await deps.flow.approve(c.req.param("id"))));
}
