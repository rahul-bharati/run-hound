/**
 * The page Run Hound shows for a problem after start-up (D11), static/problem.html (copied to dist/ by
 * scripts/build.mjs). It has the start-up error window's look and is used two ways: in a small window of its own for an
 * error in the main process (error-reporter.ts), and inside a window whose page would not load or whose renderer
 * crashed, in place of Chromium's own error page. Pure, so the query and the answer to a button press are unit tested;
 * main.ts opens the windows.
 *
 * How a button reaches the main process: the page changes its own address, `…/problem.html?…#retry-1`, and the main
 * process hears the in-page navigation (webContents `did-navigate-in-page`). No preload, `window` global or IPC channel
 * is involved, so the page works in any window whatever preload that window was made with: the main window's has the
 * desktop bridge and the child windows' has the look only, and a preload can't be changed once its window exists.
 */

import { startupErrorQuery } from "./startup-error.js";

/** The page's file name, next to main.js in dist/. */
export const PROBLEM_PAGE = "problem.html";

/**
 * What a button on the page can ask for. The page owns the labels ("Keep using Run Hound", "Quit Run Hound",
 * "Try again", "Reload"), so no label comes from the query.
 */
export const PROBLEM_ACTIONS = ["dismiss", "quit", "retry", "reload"] as const;
export type ProblemAction = (typeof PROBLEM_ACTIONS)[number];

/** What the page says. Text only: the page writes all of it with textContent. */
export interface Problem {
  readonly title: string;
  /** In plain words, one paragraph each. */
  readonly paragraphs: readonly string[];
  /** For the monospace block under the paragraphs: the technical reason, a page's path, a stack trace. */
  readonly details?: string;
}

/**
 * The `query` for `loadFile`: the start-up page's `title`, `problems` and `details`, plus `actions`, the buttons to
 * show in order (the first is the main one).
 */
export function problemQuery(problem: Problem, actions: readonly ProblemAction[]): Record<string, string> {
  return { ...startupErrorQuery(problem.title, problem.paragraphs, problem.details), actions: actions.join(",") };
}

/** True for a file: address of the problem page (any query or fragment). Only Run Hound's own pages are ever loaded from files. */
export function isProblemPageUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "file:" && url.pathname.endsWith(`/${PROBLEM_PAGE}`);
  } catch {
    return false;
  }
}

/**
 * What a button press on the problem page asks for, read from the page's new address, or null when the address isn't
 * one the page makes for a button in `offered` (a web page can't reach a file: address, and the page only ever sets
 * `#<action>-<n>`; the counter makes a second press of the same button a new address).
 */
export function problemAction(raw: string, offered: readonly ProblemAction[]): ProblemAction | null {
  if (!isProblemPageUrl(raw)) return null;
  const match = /^#(dismiss|quit|retry|reload)-\d{1,6}$/.exec(new URL(raw).hash);
  const action = match?.[1] as ProblemAction | undefined;
  return action && offered.includes(action) ? action : null;
}
