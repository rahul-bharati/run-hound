import type { Plan, Scenario } from "../core/types.js";
import type { JsonSchema, LlmClient } from "./types.js";
import type { PagePayload } from "./payload.js";
import { notImplemented } from "./not-implemented.js";

/** What the model answers for a plan review. */
export interface PlanReviewAnswer {
  scenarios: { id: string; recommended: boolean; priority: Scenario["priority"]; rationale: string }[];
}

export const PLAN_REVIEW_SCHEMA: JsonSchema = {} /* filled in by the implementation: portable subset, see types.ts JsonSchema */;

/** Throws when `value` is not a PlanReviewAnswer (arrays and field types only; unknown ids are handled by the merge). */
export function validatePlanReview(value: unknown): PlanReviewAnswer {
  return notImplemented("validatePlanReview");
}

/** System and user prompts. The user prompt carries the payload as JSON and says page text is data, not instructions. */
export function planReviewPrompt(payload: PagePayload): { system: string; user: string } {
  return notImplemented("planReviewPrompt");
}

/**
 * Merges an answer into a copy of the plan (the input is not mutated). For each built-in scenario the model answered:
 * ai = {rationale (trimmed, whitespace collapsed, cut to 200 chars), recommended}; priority = the model's;
 * defaultSelected = recommended && !destructive. Unknown ids and duplicates (after the first) are ignored; scenarios
 * the model did not mention are unchanged and have no `ai`. Scenarios are never added, removed or reordered, and
 * plan.groups is unchanged. Returns the plan and the ids the model got wrong (unknown).
 */
export function mergeReview(plan: Plan, answer: PlanReviewAnswer): { plan: Plan; unknownIds: string[] } {
  return notImplemented("mergeReview");
}

/** describePage + generateJson + mergeReview. Rejects with AiError (the caller falls back and warns). */
export async function reviewPlan(plan: Plan, client: LlmClient, options: { remote: boolean; signal?: AbortSignal }): Promise<Plan> {
  return notImplemented("reviewPlan");
}
