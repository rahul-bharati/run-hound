/**
 * Limits for goal-driven agent runs (A1, docs/agent-spec.md). Pure data; nothing reads it until A3 and A4. The pilot's
 * action and time caps are the maintainer's (2026-10-06); the rest are A1's.
 */

import type { AgentBudgetUse } from "../interfaces/agent.js";
import type { ActionClass } from "../types/grant.js";

/** The pilot budgets: at most 60 browser actions and 20 minutes (maintainer), 120 model calls and 20 test records (A1). */
export const AGENT_PILOT_BUDGETS: AgentBudgetUse = {
  browserActions: 60,
  durationMs: 20 * 60_000,
  modelCalls: 120,
  testRecords: 20,
};

/** What one observation may hold before it is cut (and marked truncated). */
export const AGENT_OBSERVATION_LIMITS = { nodes: 400, nameChars: 120, textChars: 200, totalChars: 24_000 } as const;

/** Limits on what the model may send: the same 200 characters as AI flows for a typed value. */
export const AGENT_INPUT_LIMITS = { valueChars: 200, pathChars: 2_048, thoughtChars: 300, summaryChars: 600 } as const;

/** How many earlier steps each turn shows the model, as one line each. */
export const AGENT_HISTORY_STEPS = 12;

/** Invalid decisions in a row before the run stops as model-failure. */
export const AGENT_MAX_INVALID_DECISIONS = 3;

/**
 * Whether the agent's features are on (A2 decision, 2026-10-09): only with RUNHOUND_AGENT=1 until A4 can run an
 * approved brief. Read once when the server starts.
 */
export function agentEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.RUNHOUND_AGENT === "1";
}

/** Briefs kept in memory, like plans (the oldest go first). */
export const MAX_BRIEFS = 50;

/** What a brief may hold. The model's share is capped lower than the user's. */
export const BRIEF_LIMITS = {
  goalChars: 2_000,
  ticketChars: 8_000,
  featureChars: 80,
  expectationChars: 300,
  expectations: 30,
  ticketExpectations: 20,
  modelExpectations: 8,
  scopePaths: 5,
  testData: 8,
  dataNameChars: 40,
  dataValueChars: 200,
  questions: 3,
  questionChars: 200,
  questionOptions: 6,
  optionChars: 80,
} as const;

/** What a new brief permits before the user changes it. The model can't add to it (A2). */
export const DEFAULT_BRIEF_ACTIONS: readonly ActionClass[] = ["observation", "test-data-creation"];

/** How long drafting a brief may wait for the model: one call, so the same as one AI request. */
export const BRIEF_DRAFT_BUDGET_MS = 120_000;

/** How long one navigation may take to load before it fails as page-error. Network idle is waited for briefly after. */
export const AGENT_NAVIGATION_TIMEOUT_MS = 20_000;
