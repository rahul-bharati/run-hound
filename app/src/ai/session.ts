import { createLlmClient } from "./client.js";
import { aiStatus, isRemote, type ResolvedAiConfig } from "./config.js";
import { AiError, type AiFeatures, type AiStatus, type JsonRequest, type LlmClient } from "./types.js";

/**
 * What the runner takes as RunOptions.ai: two clients on the same provider, endpoint, key and consent, whether the
 * endpoint is remote, and which features to use. `client` is the main model (briefs and the agent's turns); `helper`
 * is the helper model (plan review, suggested flows, explanations), the same client as `client` when no helper model is
 * set. A call site picks the one for its job, so what it records (plan.ai, report.ai) names the model that did the job.
 */
export interface AiSession {
  client: LlmClient;
  helper: LlmClient;
  remote: boolean;
  features: AiFeatures;
}

/**
 * A session for a resolved config, or the plain-language reason there can't be one (AiStatus.problem, e.g. "AI is
 * off", "Choose a model", "Sending page structure to api.openai.com needs your consent"). Never sends anything.
 */
export function aiSession(resolved: ResolvedAiConfig, env: NodeJS.ProcessEnv = process.env): { session: AiSession; status: AiStatus } | { problem: string; status: AiStatus } {
  const status = aiStatus(resolved, env);
  if (status.problem) return { problem: status.problem, status };
  try {
    const client = createLlmClient(resolved.config, { env });
    const helperModel = resolved.config.helperModel ?? "";
    const helper = helperModel !== "" && helperModel !== resolved.config.model ? createLlmClient({ ...resolved.config, model: helperModel }, { env }) : client;
    return { session: { client, helper, remote: isRemote(resolved.config), features: { ...resolved.config.features } }, status };
  } catch (error) {
    return { problem: error instanceof Error ? error.message : String(error), status };
  }
}

/** How long the AI part of planning (review + suggest) may take in all: 4 minutes. */
export const AI_PLAN_BUDGET_MS = 240_000;

function describeBudget(ms: number): string {
  if (ms >= 60_000 && ms % 60_000 === 0) return `${ms / 60_000} minute${ms === 60_000 ? "" : "s"}`;
  return `${Math.round(ms / 100) / 10} s`;
}

/**
 * The session with every model call bounded: each call's signal is AbortSignal.any of its own signal, `signal` (e.g.
 * the HTTP request's, aborted when the browser goes away) and one AbortSignal.timeout(budgetMs) shared by all calls and
 * started at the first call. A call cut short by the budget rejects with AiError "timeout" ("The AI steps took longer
 * than 4 minutes, so they were stopped"), and so does every later call; one cut short by `signal` rejects with AiError
 * "timeout" ("Planning was cancelled"). The runner turns those into plan warnings, as for any failed AI call.
 * `timedOut()` says whether the budget ran out.
 */
export function boundSession(session: AiSession, options: { signal?: AbortSignal; budgetMs?: number }): { session: AiSession; timedOut: () => boolean } {
  const budgetMs = options.budgetMs ?? AI_PLAN_BUDGET_MS;
  let deadline: AbortSignal | undefined;
  const overBudget = () => new AiError("timeout", `The AI steps took longer than ${describeBudget(budgetMs)}, so they were stopped`);
  const cancelled = () => new AiError("timeout", "Planning was cancelled");
  // The main and helper clients share one deadline, so the budget is for all the model calls together.
  const bind = (inner: LlmClient): LlmClient => ({
    provider: inner.provider,
    model: inner.model,
    async generateJson<T>(request: JsonRequest<T>): Promise<T> {
      deadline ??= AbortSignal.timeout(budgetMs);
      if (deadline.aborted) throw overBudget();
      if (options.signal?.aborted) throw cancelled();
      const signal = AbortSignal.any([deadline, ...(options.signal ? [options.signal] : []), ...(request.signal ? [request.signal] : [])]);
      const why = () => (deadline!.aborted ? overBudget() : options.signal?.aborted ? cancelled() : null);
      // Also race the abort, so a provider that ignores its signal can't hold planning past the budget.
      let onAbort: (() => void) | undefined;
      const aborted = new Promise<never>((_, reject) => {
        onAbort = () => reject(why() ?? new AiError("timeout", "The AI call was stopped"));
        signal.addEventListener("abort", onAbort, { once: true });
      });
      try {
        return await Promise.race([inner.generateJson({ ...request, signal }), aborted]);
      } catch (error) {
        throw why() ?? error;
      } finally {
        if (onAbort) signal.removeEventListener("abort", onAbort);
        aborted.catch(() => {});
      }
    },
  });
  const client = bind(session.client);
  const helper = session.helper === session.client ? client : bind(session.helper);
  return { session: { ...session, client, helper }, timedOut: () => deadline?.aborted === true };
}

/** "<provider>/<model>", as shown in engine steps and reports. */
export function modelLabel(client: Pick<LlmClient, "provider" | "model">): string {
  return `${client.provider}/${client.model}`;
}
