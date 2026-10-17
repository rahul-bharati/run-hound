/**
 * Goal-driven agent shapes (E2): the testing brief, what the model is shown, what it asks for, what the engine
 * records, and what a run leaves on disk. Contract only (A1, docs/agent-spec.md): A2 builds briefs, A3 the tools, A4
 * the loop and its persistence. Nothing here holds a password, a session value, a model key or a selector.
 */

import type { AccountId, CheckId, Severity } from "../core/types.js";
import type { ActionClass } from "../types/grant.js";
import type {
  AgentBudgetName,
  AgentRunStatus,
  AgentStopReason,
  AgentToolCall,
  AgentToolErrorCode,
  BriefQuestionKind,
  ElementRef,
  ExpectationSource,
} from "../types/agent.js";
import type { MutationPermissions } from "./grant.js";

/** One thing the brief says should be true, with where it came from. */
export interface BriefExpectation {
  text: string;
  source: ExpectationSource;
}

/**
 * What the user asked for, made explicit and approved (A2). The approved brief is the agent run's plan: its hash is
 * the grant's planVersion, so an edited brief needs a new approval.
 */
export interface TestingBrief {
  version: 1;
  /** The user's words, as typed. */
  goal: string;
  /** An existing feature the goal belongs to, when the user named one (M1 keeps them). */
  feature: string | null;
  /** Ticket text or acceptance criteria the user pasted, redacted. */
  ticketContext: string | null;
  /** The target's origin and the path the agent starts on. */
  target: { origin: string; startPath: string };
  /** Paths the brief limits the agent to (prefixes). Empty = the whole target origin. */
  scopePaths: string[];
  expectations: BriefExpectation[];
  /** The account the run signs in as; null = signed out. */
  account: AccountId | null;
  /** Data the agent may type, by name ("task title": "Buy milk {canary}"). Never a password. */
  testData: Record<string, string>;
  /** What the user allows, before the policy turns it into a grant. */
  permittedActions: ActionClass[];
  mutationPermissions: MutationPermissions;
  /** Who approved this version, and when; null while it is a draft. */
  approval: { by: string; at: string } | null;
}

/**
 * One element of an observation: a node of Playwright's AI-mode aria snapshot, redacted and capped. Field values are
 * never shown, only whether a field holds one.
 */
export interface ObservedNode {
  ref: ElementRef;
  role: string;
  name?: string;
  /** Visible text the node holds itself (a list item, a status message), redacted and cut to the observation limit. */
  text?: string;
  /** For links: the path on the target's origin; another origin is shown as its origin only. */
  url?: string;
  filled?: boolean;
  checked?: boolean | "mixed";
  disabled?: boolean;
  expanded?: boolean;
  /** The page marks the element invalid (aria-invalid), as forms do after a failed validation. */
  invalid?: boolean;
  pressed?: boolean | "mixed";
  /** For tabs, rows and similar: whether it is the selected one. Never set for a select's options. */
  selected?: boolean;
  level?: number;
  /** For selects and radio groups: the option labels, at most 20. */
  options?: string[];
  /** Set by the engine: clicking it is refused unless the grant permits it (isDestructiveControl and the sign-in rules). */
  destructive?: boolean;
  children?: ObservedNode[];
}

/** What the model sees of the page after each browser action, and when it asks to observe. */
export interface PageObservation {
  /** The path, never the query or hash (they can carry tokens); the origin is the brief's. */
  path: string;
  title: string | null;
  /** The main frame's last HTTP status, when the page came from a navigation. */
  status: number | null;
  tree: ObservedNode[];
  /** True when the tree was cut to the node or character limit. */
  truncated: boolean;
  /** Counts since the last observation, from the page's capture; no bodies, headers or messages. */
  problems: { consoleErrors: number; pageErrors: number; failedRequests: number };
  /** A dialog the page opened (alert, confirm), which the engine dismissed: its type and redacted message. */
  dialog: { type: string; message: string } | null;
}

/** What a run-check call reports back to the model: enough to move on, never the evidence itself. */
export interface AgentCheckOutcome {
  check: CheckId;
  path: string;
  scenarios: { id: string; status: "pass" | "fail" | "error" | "skipped" }[];
  /** Confirmed findings by their built-in title and severity. */
  confirmed: { title: string; severity: Severity }[];
  advisory: number;
}

export type AgentToolResult =
  | { ok: true; observation: PageObservation | null; check: AgentCheckOutcome | null }
  | { ok: false; error: { code: AgentToolErrorCode; message: string }; observation: PageObservation | null };

/** The model's whole answer for one turn: one call, with a short reason the progress view shows. */
export interface AgentDecision {
  /** Advisory, at most 300 characters; recorded and shown, never trusted. */
  thought: string;
  call: AgentToolCall;
}

/** Model usage, per call and summed per run. Tokens are null when the provider didn't report them. */
export interface AgentUsage {
  provider: string;
  model: string;
  calls: number;
  inputTokens: number | null;
  outputTokens: number | null;
}

/** How much of each budget the run has used. */
export type AgentBudgetUse = Record<AgentBudgetName, number>;

/** One line of the run's journal (agent/journal.jsonl): append-only, redacted, enough to audit and to resume. */
export interface AgentStep {
  index: number;
  at: string;
  decision: AgentDecision;
  /** The class the engine assigned to the call, which the grant was checked against. */
  actionClass: ActionClass;
  /** Whether the call counted as a browser action. */
  counted: boolean;
  result: { ok: true } | { ok: false; code: AgentToolErrorCode };
  /** The path the page was on after the call. */
  path: string;
  durationMs: number;
  usage: AgentUsage;
  /** Evidence files this step saved, relative to the run folder. */
  evidence: string[];
}

/** What the model suspected: advisory, kept apart from findings, never counted in the exit code. */
export interface AgentSuspicion {
  id: string;
  step: number;
  summary: string;
  /** Index into the brief's expectations, or null. */
  expectation: number | null;
  path: string;
  evidence: string[];
  /** A check the agent ran on the same page after it, if any, and whether that check confirmed something. */
  followedBy: { check: CheckId; confirmed: boolean } | null;
}

/** Written after every step (agent/checkpoint.json, replaced atomically) so a stopped or crashed run can continue. */
export interface AgentCheckpoint {
  version: 1;
  runId: string;
  briefHash: string;
  grantId: string;
  status: AgentRunStatus;
  steps: number;
  used: AgentBudgetUse;
  path: string;
  /** The checks already run, by check and path, so a resumed run doesn't repeat them. */
  checksRun: { check: CheckId; path: string }[];
  /** Earlier run ids this one continues, oldest first. */
  resumedFrom: string[];
}

/** The agent's section of the report (Report.agent, added by A4); absent on every run that isn't an agent run. */
export interface AgentReport {
  brief: TestingBrief;
  grantId: string;
  status: AgentRunStatus;
  stopReason: AgentStopReason;
  /** Set when the stop reason is budget-exhausted. */
  exhausted: AgentBudgetName | null;
  budgets: AgentBudgetUse;
  used: AgentBudgetUse;
  usage: AgentUsage;
  steps: number;
  checksRun: { check: CheckId; path: string; scenarioIds: string[] }[];
  suspicions: AgentSuspicion[];
  resumedFrom: string[];
}

/** A question the brief asks before it can be approved (A2). The model proposes at most three; the engine applies the answer. */
export interface BriefQuestion {
  id: string;
  kind: BriefQuestionKind;
  text: string;
  /** Answers to pick from (at most 6); null = a free-text answer. */
  options: string[] | null;
  /** For `test-data`: the value's name. Null for every other kind. */
  dataName: string | null;
  /** The answer as applied; null while open or when dismissed. */
  answer: string | null;
  /** True once answered or dismissed. Approval needs every question settled. */
  settled: boolean;
}

/** A brief being drafted, edited or approved, as the API returns it (A2). Kept in memory until a run takes it (A4). */
export interface BriefDraft {
  id: string;
  brief: TestingBrief;
  questions: BriefQuestion[];
  /** Why the draft is thinner than it could be (the model failed, an answer was dropped), redacted. */
  warnings: string[];
  /** SHA-256 of the brief without its approval, set when it is approved; null otherwise. */
  hash: string | null;
}

/** POST /api/briefs: what the user typed on the New run page. */
export interface BriefRequest {
  goal: string;
  url: string;
  ticketContext?: string | null;
  feature?: string | null;
  signInAs?: AccountId | null;
}

/**
 * PUT /api/briefs/:id: the fields the user changed (absent = unchanged), and answers by question id (null = dismissed).
 * Expectations are sent as text only: the server decides which are supplied and which are still inferred.
 */
export interface BriefEdit {
  goal?: string;
  feature?: string | null;
  ticketContext?: string | null;
  startPath?: string;
  scopePaths?: string[];
  expectations?: string[];
  account?: AccountId | null;
  testData?: Record<string, string>;
  /** Whether the agent may change records that existed before the run. */
  allowModification?: boolean;
  answers?: Record<string, string | null>;
}

/** The model's answer for a brief, as validated for shape; applyModelDraft applies the limits. */
export interface BriefDraftAnswer {
  expectations: string[];
  scopePaths: string[];
  testData: { name: string; value: string }[];
  questions: { kind: string; text: string; options: string[] | null; dataName: string | null }[];
}
