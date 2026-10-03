/**
 * AI session helpers for /api/plan and rerun: resolves the config (saved file + env) per request, registers the saved
 * AI secrets with the redactor (0.6.1), and returns the session or the reason it couldn't be used. The config is
 * resolved even when AI is not wanted: resolving registers the saved AI secrets, so they stay out of the plan and
 * run output whatever the tested page shows.
 */
import { resolveAiConfig } from "../../ai/config.js";
import { aiSession, boundSession, AI_PLAN_BUDGET_MS } from "../../ai/session.js";
import type { AiSession } from "../../ai/session.js";
import type { Plan } from "../../core/types.js";
import type { RunOptions } from "../../engine/runner.js";
import type { SignedInForPlanning } from "../../interfaces/server.js";

export type { AiSession, SignedInForPlanning };

/**
 * The AI session for one request, from the config as it is now (saved file + env). `wanted` undefined = use AI when
 * it is enabled and usable. When AI is wanted but can't be used, the reason comes back as a plan warning.
 */
export async function aiForRequest(
  wanted: boolean | undefined,
): Promise<{ ai?: AiSession; warning?: string }> {
  const resolved = await resolveAiConfig();
  if (wanted === false) return {};
  const out = aiSession(resolved);
  if ("session" in out) return { ai: out.session };
  return wanted ? { warning: `AI was not used: ${out.problem}.` } : {};
}

export { AI_PLAN_BUDGET_MS };

/**
 * Bound the AI steps of a planning call so they stop when the HTTP request is aborted and after aiPlanBudgetMs in
 * all. Either way the built-in plan comes back with the runner's warnings; a spent budget adds `warning`.
 */
export async function planBounded(
  target: string,
  ai: AiSession | undefined,
  signal: AbortSignal,
  aiPlanBudgetMs: number,
  discoverAndPlan: (target: string, options: Partial<RunOptions>) => Promise<Plan>,
  signedIn?: SignedInForPlanning,
): Promise<{ plan: Plan; warning?: string }> {
  const bound = ai
    ? boundSession(ai, { signal, budgetMs: aiPlanBudgetMs })
    : undefined;
  const plan = await discoverAndPlan(target, {
    ...(bound ? { ai: bound.session } : {}),
    ...(signedIn
      ? { signInAs: signedIn.id, accounts: signedIn.accounts }
      : {}),
  });
  if (!bound?.timedOut()) return { plan };
  const limit =
    aiPlanBudgetMs >= 60_000
      ? `${Math.round(aiPlanBudgetMs / 60_000)} minutes`
      : `${Math.round(aiPlanBudgetMs / 100) / 10} s`;
  return {
    plan,
    warning: `AI planning was stopped after ${limit}, so the plan has only what the model finished in time.`,
  };
}
