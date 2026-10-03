/**
 * Plan flow: from URL to stored plan, with password registration, AI session and redaction. The composition root
 * injects the narrow mandatory deps; the flow itself doesn't read process.env or a Services bag.
 */
import { randomUUID } from "node:crypto";
import { isSignInFailure } from "../accounts.js";
import { notReadyMessage } from "../../config/accounts.js";
import {
  NoFormFoundError,
  TargetNotAllowedError,
  TargetUnreachableError,
} from "../../engine/errors.js";
import { planWarnings } from "../../engine/runner.js";
import { redactSecrets } from "../../engine/redact.js";
import { checks as defaultChecks } from "../../checks/index.js";
import { planBounded } from "./ai-session.js";
import { neutralRedactor, redactorFor, type Redactor } from "./redact-text.js";
import { isAccountId } from "./account-flow.js";
import { REDACTED } from "../../constants/server-constants.js";
import type { Plan, Check } from "../../core/types.js";
import type {
  FlowError,
  IPlanFlow,
  PlanFlowDeps,
  PlanFlowOutcome,
  PlanFlowRequest,
  SignedInForPlanning,
} from "../../interfaces/server.js";

async function loadCheckTitles(checks: Check[] | undefined): Promise<Record<string, string>> {
  const all: Check[] = checks ?? defaultChecks;
  return Object.fromEntries(all.map((c) => [c.id, c.title]));
}

/** Plan flow: builds plans for /api/plan. */
export class PlanFlow implements IPlanFlow {
  readonly #deps: PlanFlowDeps;

  constructor(deps: PlanFlowDeps) {
    this.#deps = deps;
  }

  async planForRequest(request: PlanFlowRequest): Promise<PlanFlowOutcome> {
    let signedIn: SignedInForPlanning | undefined;
    if (isAccountId(request.signInAs)) {
      const { config, status } = await this.#deps.resolveAccounts();
      const why = notReadyMessage(status.accounts[request.signInAs]);
      if (why) {
        return {
          ok: false,
          error: { message: redactSecrets(why), status: 400 },
          unregister: () => undefined,
        };
      }
      signedIn = { id: request.signInAs, accounts: config };
    }

    const unregister = signedIn
      ? this.#deps.registerPasswords(signedIn.accounts, [signedIn.id])
      : () => undefined;
    const redactor = signedIn ? redactorFor(signedIn.accounts) : neutralRedactor();
    try {
      const { ai, warning } = await this.#deps.aiForRequest(request.ai);
      const { plan, warning: budgetWarning } = await planBounded(
        request.url,
        ai,
        request.signal,
        this.#deps.aiPlanBudgetMs ?? 0,
        (target, opts) =>
          this.#deps.discoverAndPlan(target, {
            checks: this.#deps.checks,
            allowedHosts: this.#deps.allowedHosts,
            ...opts,
          }),
        signedIn,
      );
      const planId = randomUUID();
      this.#deps.store.set(planId, { plan, ai: ai !== undefined });
      const titles = await loadCheckTitles(this.#deps.checks);
      const warnings = [
        ...planWarnings(plan),
        ...(warning ? [warning] : []),
        ...(budgetWarning ? [budgetWarning] : []),
      ].map((w) => redactor.redact(w));
      return {
        ok: true,
        planId,
        plan: redactPlanThrough(plan, redactor.hideJson),
        checks: titles,
        warnings,
        unregister,
      };
    } catch (err) {
      return {
        ok: false,
        error: flowError(err, redactor),
        unregister,
      };
    }
  }
}

/** A plan with secrets redacted (its target URL may carry a token). */
export function redactPlan(plan: Plan): Plan {
  return JSON.parse(redactSecrets(JSON.stringify(plan))) as Plan;
}

function redactPlanThrough(plan: Plan, hideJson: <T>(value: T) => T): Plan {
  return hideJson(redactPlan(plan));
}

/** Classify an error from the planning flow into a 400/500 message. */
export function flowError(err: unknown, redactor: Redactor): FlowError {
  const cleaned = redactor.clearError(err);
  if (isUserError(err)) return { message: cleaned, status: 400 };
  return { message: `Could not plan a run: ${cleaned}`, status: 500 };
}

/** Whether the failure is the user's input (a refused URL, a sign-in failure) rather than Run Hound's fault. */
export function isUserError(err: unknown): boolean {
  return (
    isSignInFailure(err) ||
    err instanceof TargetNotAllowedError ||
    err instanceof NoFormFoundError ||
    err instanceof TargetUnreachableError ||
    (err instanceof Error && /net::ERR_|Timeout .*exceeded/.test(err.message))
  );
}

export { isAccountId } from "./account-flow.js";

/** True when the target carries a redacted secret (URLs as runPlan writes them to disk). */
export function isRedactedTarget(target: string): boolean {
  return REDACTED.test(target);
}
