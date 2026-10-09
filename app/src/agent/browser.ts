/**
 * The agent's page (A3a, docs/agent-spec.md "The agent's page"): one page opened through the run's own
 * RunningCheckContext, so the safety gate, the navigation guard, isolation, the run's account, capture and the
 * test-record count all apply as they do for a check. Holds the latest observation and the refs it issued.
 */

import type { Locator, Page } from "playwright";
import type { RunningCheckContext } from "../engine/context.js";
import type { PageObservation } from "../interfaces/agent.js";
import type { AgentToolErrorCode } from "../types/agent.js";

export interface AgentBrowserOptions {
  /** The run's context for the agent; openPage() opens its start page as the run's account. */
  context: Pick<RunningCheckContext, "openPage" | "escaped" | "blocked">;
  /** The target's origin (the brief's). */
  origin: string;
  /** Redacts secrets and the run accounts' usernames from anything the model is shown. */
  hide: (text: string) => string;
}

export class AgentBrowser {
  /** Opens the start page (the context's target URL) and records nothing yet; call observe() for the first observation. */
  static async open(options: AgentBrowserOptions): Promise<AgentBrowser> {
    void options;
    throw new Error("not implemented (A3a)");
  }

  /** The page the agent is on now. */
  get page(): Page {
    throw new Error("not implemented (A3a)");
  }

  /** The page's path on the target (no query or hash). */
  get path(): string {
    throw new Error("not implemented (A3a)");
  }

  /** The latest observation, or null before the first. */
  get latest(): PageObservation | null {
    throw new Error("not implemented (A3a)");
  }

  /**
   * A fresh observation: snapshots the page, counts the problems since the last one, reports a dismissed dialog, and
   * replaces the refs the model may use. `status` is the last navigation's HTTP status (null when there was none).
   */
  async observe(status?: number | null): Promise<PageObservation> {
    void status;
    throw new Error("not implemented (A3a)");
  }

  /** The element a model ref names, if it is from the latest observation; else `stale-ref`. */
  resolve(ref: string): { locator: Locator } | { error: AgentToolErrorCode } {
    void ref;
    throw new Error("not implemented (A3a)");
  }

  /**
   * Opens `path` on the target's origin. Returns the response's status, or the failure: `off-target` when the guard
   * refused it or a redirect escaped (then a fresh start page is open), `page-error` for a network error or timeout.
   */
  async goto(path: string): Promise<{ status: number | null } | { error: AgentToolErrorCode; message: string }> {
    void path;
    throw new Error("not implemented (A3a)");
  }

  /** Goes back one page; `invalid-input` when there is no earlier page. */
  async back(): Promise<{ status: number | null } | { error: AgentToolErrorCode; message: string }> {
    throw new Error("not implemented (A3a)");
  }
}
