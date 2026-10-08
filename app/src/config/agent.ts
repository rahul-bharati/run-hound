/**
 * Limits for goal-driven agent runs (A1, docs/agent-spec.md). Pure data; nothing reads it until A3 and A4. The pilot's
 * action and time caps are the maintainer's (2026-10-06); the rest are A1's.
 */

import type { AgentBudgetUse } from "../interfaces/agent.js";

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
