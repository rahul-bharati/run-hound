import type { FlowStep, Plan, Scenario } from "../core/types.js";
import type { JsonSchema, LlmClient } from "./types.js";
import type { PagePayload } from "./payload.js";
import { notImplemented } from "./not-implemented.js";

export const MAX_SUGGESTIONS = 5;
export const MAX_FLOW_STEPS = 8;

/** What the model answers. `form` is PagePayload.forms[].index. Steps use the FlowStep shape. */
export interface SuggestAnswer {
  suggestions: { title: string; rationale: string; form: number; steps: FlowStep[] }[];
}

export const SUGGEST_SCHEMA: JsonSchema = {} /* filled in by the implementation */;

export function validateSuggest(value: unknown): SuggestAnswer {
  return notImplemented("validateSuggest");
}

export function suggestPrompt(payload: PagePayload): { system: string; user: string } {
  return notImplemented("suggestPrompt");
}

/**
 * Validates one suggested flow against the plan's forms. Returns the problem, or null when valid:
 * the form index exists; 1–MAX_FLOW_STEPS steps; the last step is an "expect"; every fill/choose field is a key of
 * that form (choose: option is one of the field's option labels, case-insensitive); every click control is an index
 * into that form's controls; press keys are FlowKey; expect kinds are FlowExpectation, and text-visible/text-absent
 * have non-empty text (≤ 200 chars); fill values ≤ 200 chars.
 */
export function flowProblem(plan: Plan, form: number, steps: FlowStep[]): string | null {
  return notImplemented("flowProblem");
}

/**
 * Turns valid suggestions into scenarios: checkId "ai-flow", id "ai-flow:<n>" (1-based, in answer order;
 * "@form-<k>" suffix is not used), title (trimmed, ≤ 80 chars), description = rationale, kind "golden",
 * priority "medium", destructive = any click on a destructive control (isDestructiveControl), defaultSelected false,
 * scope "form", formIndex, scopeLabel = formLabel (engine/plan.ts), flow = steps, ai = {rationale, recommended: true,
 * suggested: true}. Invalid suggestions are dropped and described in `rejected`. At most MAX_SUGGESTIONS kept.
 */
export function suggestionsToScenarios(plan: Plan, answer: SuggestAnswer): { scenarios: Scenario[]; rejected: string[] } {
  return notImplemented("suggestionsToScenarios");
}

/**
 * Appends scenarios to a copy of the plan: after every built-in scenario of the Features group, and to that group's
 * scenarioIds (creating the group in CHECK_GROUPS order if absent). Ids already taken are skipped.
 */
export function addSuggestions(plan: Plan, scenarios: Scenario[]): Plan {
  return notImplemented("addSuggestions");
}

/** describePage + generateJson + suggestionsToScenarios + addSuggestions. Rejects with AiError. */
export async function suggestScenarios(plan: Plan, client: LlmClient, options: { remote: boolean; signal?: AbortSignal }): Promise<{ plan: Plan; rejected: string[] }> {
  return notImplemented("suggestScenarios");
}
