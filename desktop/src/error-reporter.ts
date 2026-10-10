/**
 * Errors in the main process after start-up (D11). Electron's own handler for an uncaught exception is a native message
 * box, "A JavaScript error occurred in the main process"; having a listener of ours on `uncaughtException` replaces it
 * (it does nothing when another listener exists). Every error is written to stderr, and shown in the branded problem
 * window one at a time: while that window is open, later errors are only logged, so a failing timer can't stack up
 * windows. If the window can't be shown, the native error box is the last resort, once, and nothing is reported about
 * the failure itself, so there is no loop. Electron-free, so it is unit tested; main.ts supplies the window.
 */

import type { Problem } from "./problem-page.js";
import { uncaughtProblem } from "./problem-text.js";

export interface ErrorReporterDeps {
  /** Writes text to stderr (main.ts adds the `[run-hound] ` prefix and the newline here). */
  log(text: string): void;
  /** Shows the problem in the branded window. Resolves when the user has closed it; rejects if it can't be shown. */
  show(problem: Problem): Promise<void>;
  /** The native error box, for when the window can't be shown. */
  fallback(title: string, text: string): void;
}

export interface ErrorReporter {
  /** Never throws. `origin` is Node's: "uncaughtException" or "unhandledRejection". */
  report(reason: unknown, origin: string): void;
}

export function createErrorReporter(deps: ErrorReporterDeps): ErrorReporter {
  let open = false;
  /** Logging must not be able to cause another error to report. */
  const log = (text: string): void => {
    try {
      deps.log(`[run-hound] ${text}\n`);
    } catch {
      // stderr gone (a closed pipe): nothing left to tell.
    }
  };
  return {
    report(reason, origin) {
      const { problem, log: line } = uncaughtProblem(reason, origin);
      log(line);
      if (open) return;
      open = true;
      let shown: Promise<void>;
      try {
        shown = deps.show(problem);
      } catch (err) {
        shown = Promise.reject(err);
      }
      void shown
        .catch((err: unknown) => {
          log(`could not show the error window: ${err instanceof Error ? err.message : String(err)}`);
          try {
            deps.fallback(problem.title, [...problem.paragraphs, ...(problem.details ? [problem.details] : [])].join("\n\n"));
          } catch {
            // The last resort failed too; the error is on stderr.
          }
        })
        .finally(() => {
          open = false;
        });
    },
  };
}
