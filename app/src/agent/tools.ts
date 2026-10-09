/**
 * Agent tools (A3a: observe, navigate and back; A3b and A3c add the rest), docs/agent-spec.md "Navigation tools".
 * Each call is validated when it runs; a refusal is a tool error the model sees, never a thrown exception.
 */

import { oneLine } from "../ai/schema.js";
import type { AgentToolResult, PageObservation } from "../interfaces/agent.js";
import type { AgentToolCall, AgentToolErrorCode } from "../types/agent.js";
import type { ActionClass } from "../types/grant.js";
import { isBriefPath } from "./brief.js";
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

/** Whether `path` lies in one of the brief's scope paths (none = the whole origin): equal to one, or under it. */
function inScope(path: string, scopePaths: readonly string[]): boolean {
  return scopePaths.length === 0 || scopePaths.some((scope) => path === scope || path.startsWith(scope.endsWith("/") ? scope : `${scope}/`));
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
  const started = Date.now();
  const counted = call.tool !== "observe";
  const done = (result: AgentToolResult, wasCounted = counted): ToolRun => ({
    result,
    actionClass: "observation",
    counted: wasCounted,
    path: browser.path,
    durationMs: Date.now() - started,
  });
  /** The observation after a failure, or null when the page can't give one. */
  const observeAfter = async (status: number | null = null): Promise<PageObservation | null> => browser.observe(status).catch(() => null);
  const fail = async (code: AgentToolErrorCode, message: string): Promise<ToolRun> =>
    done({ ok: false, error: { code, message: oneLine(message, 300) }, observation: await observeAfter() });
  const succeed = async (status: number | null = null): Promise<ToolRun> => {
    try {
      return done({ ok: true, observation: await browser.observe(status), check: null });
    } catch (error) {
      return done({ ok: false, error: { code: "page-error", message: oneLine(`The page couldn't be observed: ${error instanceof Error ? error.message : String(error)}`, 300) }, observation: null });
    }
  };

  if (options.signal?.aborted) return done({ ok: false, error: { code: "cancelled", message: "The run was stopped." }, observation: null }, false);

  switch (call.tool) {
    case "observe":
      return succeed();
    case "navigate": {
      const path: unknown = call.path;
      if (typeof path !== "string" || !isBriefPath(path)) return fail("invalid-input", "navigate takes a path on the target, like /app/settings, with no query or #.");
      if (!inScope(path, options.scopePaths)) return fail("off-target", `${path} is outside the areas the brief keeps to: ${options.scopePaths.join(", ")}.`);
      const moved = await browser.goto(path);
      return "error" in moved ? fail(moved.error, moved.message) : succeed(moved.status);
    }
    case "back": {
      const moved = await browser.back();
      return "error" in moved ? fail(moved.error, moved.message) : succeed(moved.status);
    }
  }
}
