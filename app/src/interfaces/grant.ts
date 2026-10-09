/**
 * The execution grant (G1, docs/execution-grants.md, "Grant structure"): the one authorization contract a run's
 * privileged actions are checked against. Contract only: G2 owns its storage and audit, G3 its run-wide enforcement;
 * agent runs (docs/agent-spec.md) are the first to carry one, enforced by the agent's tools (A3). A grant never holds
 * a secret, only references.
 */

import type { ActionClass } from "../types/grant.js";

/** Finer-grained write permissions, on top of the permitted classes. */
export interface MutationPermissions {
  createTestRecords: boolean;
  /** Changes to records that existed before the run, as the run's own account. */
  modifyExisting: boolean;
  delete: boolean;
  changeCredentials: boolean;
  externalWrite: boolean;
}

/** Resource caps for the run the grant covers. Absent = not capped by the grant (other limits still apply). */
export interface GrantBudgets {
  maxDurationMs: number;
  /** Agent runs: browser tool calls (docs/agent-spec.md, "Budgets"). */
  maxBrowserActions?: number;
  /** Agent runs: model calls, one per turn. */
  maxModelCalls?: number;
  maxRequests?: number;
  maxTestRecordsCreated?: number;
  maxPages?: number;
}

export interface ExecutionGrant {
  /** Opaque and unique; audit and invalidation refer to it. */
  id: string;
  /** Who performs the run. Never a credential. */
  actor: { type: "local-user" | "team"; id: string };
  /** Who granted it: a person's id, "policy:<version>", or "self" for a local desktop approval. */
  approver: string;
  /** Team scoping (T1). Absent for a single-user desktop. */
  project?: string;
  environment?: string;
  /**
   * The exact plan approved: the SHA-256 of its serialized form. For an agent run, the plan is the approved testing
   * brief, so this is the brief's hash (docs/agent-spec.md, "Grants for agent runs").
   */
  planVersion: string;
  policyVersion: string;
  /** Account references ("a", "b", "self"), never passwords, session values or tokens. */
  identityRefs: string[];
  /** Origins (scheme, host and port) the run may act on; a subset of what the safety gate allows. */
  allowedTargetOrigins: string[];
  /** Origins the app under test may contact besides the target (CDNs, sign-in providers). */
  allowedDependencyOrigins: string[];
  permittedActionClasses: ActionClass[];
  mutationPermissions: MutationPermissions;
  /** ISO 8601. After it, the grant is invalid even when every binding still matches. */
  expiry: string;
  budgets: GrantBudgets;
}
