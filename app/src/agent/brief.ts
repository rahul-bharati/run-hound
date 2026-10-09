/**
 * Testing briefs (A2, docs/agent-spec.md "Briefs"): pure functions from what the user typed and what the model drafted
 * to an editable, approvable TestingBrief. The engine, never the model or the client, decides which expectations are
 * supplied and which inferred, and what the brief permits.
 */

import type { BriefDraft, BriefDraftAnswer, BriefEdit, TestingBrief } from "../interfaces/agent.js";
import type { AccountId } from "../core/types.js";

/** The parts of a brief request the engine has already checked: the target through the safety gate, the account's readiness. */
export interface CheckedBriefRequest {
  goal: string;
  ticketContext: string | null;
  feature: string | null;
  account: AccountId | null;
  target: { origin: string; startPath: string };
}

/** A path a brief may hold: starts with "/", at most 2,048 characters, no scheme, no "//", no "..", no query or hash. */
export function isBriefPath(value: string): boolean {
  void value;
  throw new Error("not implemented (A2)");
}

/**
 * The supplied expectations in ticket text: each list line ("- ", "* ", "• ", "1. ", "- [ ] "), without its marker,
 * collapsed to one line, cut to BRIEF_LIMITS.expectationChars, duplicates dropped, at most BRIEF_LIMITS.ticketExpectations.
 */
export function ticketExpectations(ticket: string | null): string[] {
  void ticket;
  throw new Error("not implemented (A2)");
}

/** A new draft: the checked request, the ticket's supplied expectations, DEFAULT_BRIEF_ACTIONS, no questions, unapproved. */
export function newDraft(id: string, request: CheckedBriefRequest): BriefDraft {
  void id, request;
  throw new Error("not implemented (A2)");
}

/**
 * Adds the model's draft: its expectations as inferred (after the supplied ones, skipping repeats), scope paths that
 * pass isBriefPath, test data whose names don't look like a credential, and questions of known kinds, each within
 * BRIEF_LIMITS. Never changes what the brief permits. What was dropped is named in the draft's warnings.
 */
export function applyModelDraft(draft: BriefDraft, answer: BriefDraftAnswer): BriefDraft {
  void draft, answer;
  throw new Error("not implemented (A2)");
}

/**
 * Applies the user's edit and answers. An expectation whose text matches an existing one keeps that one's source; any
 * other is supplied. Answers are applied by their question's kind. Any change clears the approval and the hash.
 * Returns the problems instead when the edit is invalid; nothing is applied then.
 */
export function editDraft(draft: BriefDraft, edit: BriefEdit): { draft: BriefDraft } | { problems: string[] } {
  void draft, edit;
  throw new Error("not implemented (A2)");
}

/** What stands in the way of approval: no goal, no expectation, an open question. (The flow checks the target and account.) */
export function approvalProblems(draft: BriefDraft): string[] {
  void draft;
  throw new Error("not implemented (A2)");
}

/** The approved draft: approval {by, at} and the brief's hash. */
export function approveDraft(draft: BriefDraft, by: string, at: Date): BriefDraft {
  void draft, by, at;
  throw new Error("not implemented (A2)");
}

/** SHA-256 (hex) of the brief with `approval: null`, serialized as JSON with object keys sorted at every level. */
export function briefHash(brief: TestingBrief): string {
  void brief;
  throw new Error("not implemented (A2)");
}
