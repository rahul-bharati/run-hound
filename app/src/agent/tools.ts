/**
 * Agent tools (A3a: observe, navigate and back; A3b and A3c add the rest), docs/agent-spec.md "Navigation tools".
 * Each call is validated when it runs; a refusal is a tool error the model sees, never a thrown exception.
 */

import type { AgentToolResult } from "../interfaces/agent.js";
import type { AgentToolCall } from "../types/agent.js";
import type { ActionClass } from "../types/grant.js";
import type { AgentBrowser } from "./browser.js";

export type NavigationCall = Extract<AgentToolCall, { tool: "observe" | "navigate" | "back" }>;

/** What a tool run reports for the journal and the budgets, beside the result the model sees. */
export interface ToolRun {
  result: AgentToolResult;
  actionClass: ActionClass;
  /** Whether it counts as a browser action (navigate and back, whatever the outcome). */
  counted: boolean;
  /** The page's path after the call. */
  path: string;
  durationMs: number;
}

/**
 * Runs observe, navigate or back. `scopePaths` are the brief's (empty = the whole origin); `signal` is the run's.
 * Never throws for a refusal or a page failure: those are tool errors with the observation when the page is usable.
 */
export async function runNavigationTool(
  browser: AgentBrowser,
  call: NavigationCall,
  options: { scopePaths: readonly string[]; signal?: AbortSignal },
): Promise<ToolRun> {
  void browser, call, options;
  throw new Error("not implemented (A3a)");
}
