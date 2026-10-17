/**
 * Goal-driven agent unions (E2): how its tool calls, tool failures, run states and stop reasons are spelled. Contract
 * only (A1, docs/agent-spec.md): nothing runs an agent yet. A3 implements the tools, A4 the loop.
 */

import type { CheckId } from "../core/types.js";

/**
 * An element handle from the latest observation: the observation's number, a dot, and Playwright's AI-mode aria
 * snapshot reference ("4.e17"). Valid only until the next observation; the engine resolves it to an element, the model
 * never sees or sends a selector.
 */
export type ElementRef = string;

/** One tool call: what the model asks for in a turn. The engine validates it before anything happens. */
export type AgentToolCall =
  /** A fresh observation of the current page. Not a browser action. */
  | { tool: "observe" }
  /** Opens a path on the target's origin ("/app/settings"); never another origin, scheme or host. */
  | { tool: "navigate"; path: string }
  | { tool: "back" }
  | { tool: "click"; ref: ElementRef }
  /** Types into a text field. `{canary}` in the value becomes a unique run-token value the engine can recognise. */
  | { tool: "fill"; ref: ElementRef; value: string }
  /** Picks one of the options the observation listed for a select, radio group or similar. */
  | { tool: "choose"; ref: ElementRef; option: string }
  | { tool: "press"; ref: ElementRef; key: AgentKey }
  /**
   * Runs a built-in check on the page the agent is on, as the run's account: the only way to a confirmed finding.
   * `form` picks one form; absent = every form the check plans for on the page.
   */
  | { tool: "run-check"; check: CheckId; form?: ElementRef }
  /** Records a suspicion: advisory, never a finding. `expectation` indexes the brief's expectations. */
  | { tool: "note-suspicion"; summary: string; expectation: number | null; refs: ElementRef[] }
  /** Ends the run with the model's own reason. */
  | { tool: "finish"; outcome: AgentFinishOutcome; summary: string };

export type AgentToolName = AgentToolCall["tool"];

/** Keys the agent may press. Tab and Space are refused, as in AI flows: they can reach a control with no visible click. */
export type AgentKey = "Enter" | "Escape";

/** Reasons the model may give for finishing. */
export type AgentFinishOutcome =
  /** Every expectation in the brief has been investigated. */
  | "goal-complete"
  /** A consequential question only the user can answer (A2 asks it). */
  | "ambiguous"
  /** The goal needs a sign-in, an account or a page the run can't reach (S1 hands the browser to the user). */
  | "missing-access"
  /** The goal needs an action class the grant doesn't permit. */
  | "outside-grant";

/** Why a tool call failed. The model sees the code and a one-line message, never a stack trace. */
export type AgentToolErrorCode =
  /** The call doesn't match the schema or its limits (a value over 200 characters, an option not listed). */
  | "invalid-input"
  /** The ref isn't in the latest observation. */
  | "stale-ref"
  /** The element is hidden, disabled, detached, or didn't respond in time. */
  | "not-actionable"
  /** The path or a redirect leaves the target: the safety gate or the navigation guard refused it. */
  | "off-target"
  /** The grant doesn't permit the action's class. */
  | "not-permitted"
  /** A destructive control, a sign-out or a credential form: refused unless the grant permits that class. */
  | "destructive"
  /** The same call on an unchanged page as the last time it was made: refused, so loops end. */
  | "repeated"
  /** The check plans nothing on this page or form. */
  | "check-not-applicable"
  | "budget-exhausted"
  /** The page crashed, or a navigation failed. */
  | "page-error"
  | "cancelled";

/** An agent run's state, as the UI, the CLI and the report show it. */
export type AgentRunStatus = "running" | "completed" | "blocked" | "cancelled" | "incomplete" | "error";

/**
 * Why the run stopped. completed: goal-complete. blocked: ambiguous, missing-access, outside-grant. cancelled:
 * cancelled. incomplete: budget-exhausted, model-failure. error: engine-error.
 */
export type AgentStopReason = AgentFinishOutcome | "cancelled" | "budget-exhausted" | "model-failure" | "engine-error";

/** The budgets the engine counts on its own, whatever the model does. */
export type AgentBudgetName = "browserActions" | "durationMs" | "modelCalls" | "testRecords";

/** Where an expectation in the brief came from (A2): the user said it, or the brief inferred it. */
export type ExpectationSource = "supplied" | "inferred";

/**
 * What a brief's clarifying question asks for, which fixes how its answer is applied (A2): `expectation` adds a
 * supplied expectation, `start-path` sets the start path, `scope` adds a scope path, `test-data` sets the named value,
 * `account` picks the account, `permission` allows or refuses changing existing records.
 */
export type BriefQuestionKind = "expectation" | "start-path" | "scope" | "test-data" | "account" | "permission";
