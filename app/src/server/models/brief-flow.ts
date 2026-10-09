/**
 * Brief flow (A2): POST/GET/PUT /api/briefs and POST /api/briefs/:id/approve. Checks the target through the safety
 * gate and the account's readiness, asks the model once for a draft, and keeps drafts in memory. The model's answer
 * never changes what a brief permits, and a failed model call leaves a draft the user can fill in.
 */
import { randomUUID } from "node:crypto";
import { boundSession } from "../../ai/session.js";
import { applyModelDraft, approvalProblems, approveDraft, editDraft, isBriefPath, newDraft } from "../../agent/brief.js";
import { draftBriefWithModel } from "../../agent/draft-brief.js";
import { BRIEF_LIMITS } from "../../config/agent.js";
import { notReadyMessage } from "../../config/accounts.js";
import { TargetNotAllowedError } from "../../engine/errors.js";
import { redactSecrets } from "../../engine/redact.js";
import { checkTarget } from "../../engine/safety.js";
import type { AccountId } from "../../core/types.js";
import type { BriefDraft, BriefEdit, BriefRequest } from "../../interfaces/agent.js";
import type { BriefFlowDeps, BriefFlowOutcome, IBriefFlow } from "../../interfaces/server.js";

const NOT_FOUND: BriefFlowOutcome = {
  ok: false,
  status: 404,
  error: "There is no brief with that id. Briefs are kept in memory, so they are lost when Run Hound restarts.",
};
const refuse = (status: 400 | 409, error: string): BriefFlowOutcome => ({ ok: false, status, error: redactSecrets(error) });

export class BriefFlow implements IBriefFlow {
  readonly #deps: BriefFlowDeps;

  constructor(deps: BriefFlowDeps) {
    this.#deps = deps;
  }

  /** 201 with the new draft; 400 for invalid input, a refused target or an account that isn't ready; 409 when no model can be used. */
  async create(request: BriefRequest, signal: AbortSignal): Promise<BriefFlowOutcome> {
    const goal = redactSecrets(request.goal).trim();
    if (goal === "") return refuse(400, "Describe what to test.");
    if (goal.length > BRIEF_LIMITS.goalChars) return refuse(400, `Describe what to test in at most ${BRIEF_LIMITS.goalChars} characters.`);
    const ticket = redactSecrets(request.ticketContext ?? "").trim();
    if (ticket.length > BRIEF_LIMITS.ticketChars) return refuse(400, `The ticket text can be at most ${BRIEF_LIMITS.ticketChars} characters.`);
    const feature = (request.feature ?? "").replace(/\s+/g, " ").trim();
    if (feature.length > BRIEF_LIMITS.featureChars) return refuse(400, `The feature name can be at most ${BRIEF_LIMITS.featureChars} characters.`);

    const target = await this.#target(request.url);
    if ("error" in target) return refuse(400, target.error);
    const accounts = await this.#accounts();
    const account = request.signInAs ?? null;
    if (account !== null && accounts.notReady[account]) return refuse(400, accounts.notReady[account]!);

    const ai = await this.#deps.aiSession();
    if ("problem" in ai) return refuse(409, `A brief is drafted by a model, and none can be used: ${ai.problem}. Set one up in Settings.`);

    let draft = newDraft(this.#deps.newId?.() ?? randomUUID(), {
      goal,
      ticketContext: ticket === "" ? null : ticket,
      feature: feature === "" ? null : feature,
      account,
      target,
    });
    const bound = boundSession(ai.session, { signal, budgetMs: this.#deps.draftBudgetMs });
    try {
      const answer = await draftBriefWithModel(bound.session.client, draft, {
        remote: ai.session.remote,
        accountsReady: { a: accounts.notReady.a === null, b: accounts.notReady.b === null },
      });
      draft = applyModelDraft(draft, answer);
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      draft.warnings.push(redactSecrets(`The model couldn't draft the brief (${why}), so it holds only what you wrote. Add what should be true yourself, or try again.`));
    }
    const typed = new URL(request.url);
    if (typed.search !== "" || typed.hash !== "") draft.warnings.push("The brief starts on the page's path only: the part of the address after ? or # was left out, since it can carry tokens.");
    this.#deps.store.set(draft.id, draft);
    return { ok: true, status: 201, draft };
  }

  /** 200 with the draft, or 404. */
  get(id: string): BriefFlowOutcome {
    const draft = this.#deps.store.get(id);
    return draft ? { ok: true, status: 200, draft } : NOT_FOUND;
  }

  /** 200 with the edited draft (approval cleared), 400 with the problems, or 404. */
  async edit(id: string, edit: BriefEdit): Promise<BriefFlowOutcome> {
    const draft = this.#deps.store.get(id);
    if (!draft) return NOT_FOUND;
    const result = editDraft(draft, edit);
    if ("problems" in result) return refuse(400, result.problems.join(" "));
    const account = result.draft.brief.account;
    if (account !== null && account !== draft.brief.account) {
      const why = (await this.#accounts()).notReady[account];
      if (why) return refuse(400, why);
    }
    this.#deps.store.set(id, result.draft);
    return { ok: true, status: 200, draft: result.draft };
  }

  /** 200 with the approved draft and its hash, 400 naming what is missing (the target is checked again), or 404. */
  async approve(id: string): Promise<BriefFlowOutcome> {
    const draft = this.#deps.store.get(id);
    if (!draft) return NOT_FOUND;
    if (draft.hash !== null) return { ok: true, status: 200, draft };
    const problems = approvalProblems(draft);
    const { origin, startPath } = draft.brief.target;
    const target = await this.#target(`${origin}${startPath}`);
    if ("error" in target) problems.push(target.error);
    const account = draft.brief.account;
    if (account !== null) {
      const why = (await this.#accounts()).notReady[account];
      if (why) problems.push(why);
    }
    if (problems.length > 0) return refuse(400, problems.join(" "));
    const approved = approveDraft(draft, "self", this.#deps.now?.() ?? new Date());
    this.#deps.store.set(id, approved);
    return { ok: true, status: 200, draft: approved };
  }

  /** The target's origin and path once the safety gate allows it (query and hash dropped), or why it doesn't. */
  async #target(url: string): Promise<{ origin: string; startPath: string } | { error: string }> {
    try {
      await checkTarget(url, {
        ...(this.#deps.allowedHosts() ? { allowedHosts: this.#deps.allowedHosts() } : {}),
        ...(this.#deps.lookup ? { lookup: this.#deps.lookup } : {}),
      });
    } catch (error) {
      if (error instanceof TargetNotAllowedError) return { error: error.message };
      throw error;
    }
    const parsed = new URL(url);
    return { origin: parsed.origin, startPath: isBriefPath(parsed.pathname) ? parsed.pathname : "/" };
  }

  /** Why each account can't be used now (null = ready). */
  async #accounts(): Promise<{ notReady: Record<AccountId, string | null> }> {
    const { status } = await this.#deps.resolveAccounts();
    return { notReady: { a: notReadyMessage(status.accounts.a), b: notReadyMessage(status.accounts.b) } };
  }
}

export type { BriefDraft };
