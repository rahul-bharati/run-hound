/**
 * State that lives only in memory on the server (between requests, between modules). Not exported as a public contract:
 * kept internal to the server so the rest of the app can stay free of server-internal data shapes. Mirrors the app
 * pattern (state/, interfaces/, types/).
 */
import type { AccountId, AccountRef, CheckGroup, CheckResult, Plan, Report } from "../../core/types.js";
import type { AccountsConfig } from "../../interfaces/accounts.js";

/** What a run tested, for the runs list: the form's name (V0, or a V1 page with one named form), "2 forms" on a page
 * with several, or null. Redacted. */
export interface RunSummary {
  runId: string;
  target: string;
  formName: string | null;
  status: RunState["status"];
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  summary?: Report["summary"];
  completed: number;
  total: number;
  /** The test account the run signed in as (0.4.0); absent for signed-out runs. Never a username. */
  account?: AccountRef;
}

/** What GET /api/runs/:id/live returns, plus the latest frame (served separately as live.jpg). */
export interface LiveState {
  scenarioId: string | null;
  scenarioTitle: string | null;
  /** 1-based position of the current scenario among the approved ones (0 before the first). */
  scenarioIndex: number;
  /** The current group (CheckGroup id) and its label, from group-start/scenario-start; null before the first scenario. */
  group: CheckGroup | null;
  groupLabel: string | null;
  step: string | null;
  url: string | null;
  /** Counts frames received, so the UI only reloads live.jpg when there is a new one. */
  frameSeq: number;
  updatedAt: string;
  steps: { scenarioId: string; label: string; url: string; at: string }[];
  pagesVisited: string[];
  /** Scenarios that have ended, in run order, with how long each took (the UI's step log shows it). */
  finished: {
    scenarioId: string;
    status: CheckResult["status"];
    durationMs: number;
  }[];
  /** The approved scenarios in run order, with their group, so the UI can list what is queued, running and done. */
  scenarios: {
    id: string;
    title: string;
    group: CheckGroup | null;
    groupLabel: string | null;
  }[];
  /** The browser the run uses, e.g. "Chromium 153.0.8010.12"; null until the report says. */
  browser: string | null;
  /** Only the latest frame is kept; it survives the end of the run so the UI can keep showing it. */
  frame?: Buffer;
}

export interface RunState {
  status: "running" | "done" | "error";
  completed: number;
  total: number;
  dir: string;
  /** When the run was accepted (ISO); the same value on every poll. The report's own startedAt is set by runPlan. */
  startedAt: string;
  /** The whole run, once it has ended: report.durationMs when done, time until the failure when it errored. */
  durationMs?: number;
  report?: Report;
  error?: string;
  live: LiveState;
  /** What the run was started with (the unredacted plan stays in memory only), so it can be re-run. */
  plan: Plan;
  approved: string[];
  allowDestructive: boolean;
  headed: boolean;
  /** Whether the run's plan was made with AI; its findings get AI explanations and a rerun uses AI again. */
  ai: boolean;
  /** Aborts the run (POST /api/runs/:id/stop); absent for runs read back from disk. */
  controller?: AbortController;
}

/** A stored plan and whether it was made with AI (so the run explains its findings). */
export interface StoredPlan {
  plan: Plan;
  ai: boolean;
}

/** A request to sign in as a test account: the slot and the accounts resolved for it. */
export interface SignedInAs {
  id: AccountId;
  accounts: AccountsConfig;
}

/** Cached disk summary keyed by mtime + size; reused by listRuns so it parses each report.json at most once per change. */
export interface DiskSummaryEntry {
  mtimeMs: number;
  size: number;
  summary: RunSummary | null;
}
