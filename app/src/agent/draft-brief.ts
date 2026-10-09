/**
 * The model's one call for a brief (A2): from the goal, the ticket text, the feature name and the start page's
 * address to inferred expectations, scope paths, test data and at most three questions. The model sees no page and
 * no account names; its answer is validated here for shape and capped by applyModelDraft.
 */

import type { BriefDraft, BriefDraftAnswer } from "../interfaces/agent.js";
import type { JsonSchema, LlmClient } from "../ai/types.js";

/** {expectations, scopePaths, testData: [{name, value}], questions: [{kind, text, options, dataName}]} in the portable subset. */
export const BRIEF_DRAFT_SCHEMA: JsonSchema = {};

/** Throws when `value` isn't a BriefDraftAnswer (shape and types only; limits and kinds are applied by applyModelDraft). */
export function validateBriefDraft(value: unknown): BriefDraftAnswer {
  void value;
  throw new Error("not implemented (A2)");
}

/**
 * System and user prompts. The page is its path for a remote model and its origin and path for a local one; accounts
 * are named only as "A" and "B" with whether each is ready. The goal and ticket text are the user's, redacted.
 */
export function briefDraftPrompt(draft: BriefDraft, options: { remote: boolean; accountsReady: { a: boolean; b: boolean } }): { system: string; user: string } {
  void draft, options;
  throw new Error("not implemented (A2)");
}

/** briefDraftPrompt + generateJson. Rejects with AiError; the caller keeps the draft without the model's part and warns. */
export async function draftBriefWithModel(
  client: LlmClient,
  draft: BriefDraft,
  options: { remote: boolean; accountsReady: { a: boolean; b: boolean }; signal?: AbortSignal },
): Promise<BriefDraftAnswer> {
  void client, draft, options;
  throw new Error("not implemented (A2)");
}
