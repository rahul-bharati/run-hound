/**
 * Brief flow (A2): POST/GET/PUT /api/briefs and POST /api/briefs/:id/approve. Checks the target through the safety
 * gate and the account's readiness, asks the model once for a draft, and keeps drafts in memory. The model's answer
 * never changes what a brief permits, and a failed model call leaves a draft the user can fill in.
 */
import type { BriefEdit, BriefRequest } from "../../interfaces/agent.js";
import type { BriefFlowDeps, BriefFlowOutcome, IBriefFlow } from "../../interfaces/server.js";

export class BriefFlow implements IBriefFlow {
  readonly #deps: BriefFlowDeps;

  constructor(deps: BriefFlowDeps) {
    this.#deps = deps;
  }

  /** 201 with the new draft; 400 for invalid input, a refused target or an account that isn't ready; 409 when no model can be used. */
  async create(request: BriefRequest, signal: AbortSignal): Promise<BriefFlowOutcome> {
    void this.#deps, request, signal;
    throw new Error("not implemented (A2)");
  }

  /** 200 with the draft, or 404. */
  get(id: string): BriefFlowOutcome {
    void id;
    throw new Error("not implemented (A2)");
  }

  /** 200 with the edited draft (approval cleared), 400 with the problems, or 404. */
  async edit(id: string, edit: BriefEdit): Promise<BriefFlowOutcome> {
    void id, edit;
    throw new Error("not implemented (A2)");
  }

  /** 200 with the approved draft and its hash, 400 naming what is missing (the target is checked again), or 404. */
  async approve(id: string): Promise<BriefFlowOutcome> {
    void id;
    throw new Error("not implemented (A2)");
  }
}
