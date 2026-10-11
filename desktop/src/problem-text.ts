/**
 * What the problem page says (D11), in plain words: an error in the main process, a page that would not load, a
 * renderer that crashed. Pure, so the wording and what is left out of it (a page's query string and fragment, which can
 * carry tokens) are unit tested.
 */

import { inspect } from "node:util";

import type { Problem } from "./problem-page.js";

/** Chromium's net::ERR_ABORTED (-3): a navigation that another one replaced or the page cancelled. Normal, never a problem. */
export const ERR_ABORTED = -3;

export const UNCAUGHT_TITLE = "Run Hound ran into a problem";

/** The longest one-line summary of an error shown as a paragraph; the whole text is in the monospace block and on stderr. */
const SUMMARY_MAX = 300;

/** What an error says (its message) and the whole of it as one block (its stack when it has one). Never throws. */
function describe(reason: unknown): { message: string; text: string } {
  try {
    if (reason instanceof Error) return { message: reason.message, text: reason.stack ?? `${reason.name}: ${reason.message}` };
    const text = typeof reason === "string" ? reason : inspect(reason, { depth: 2, breakLength: 100 });
    return { message: text, text };
  } catch {
    return { message: "an error that could not be printed", text: "(an error that could not be printed)" };
  }
}

/** The error as one block of text: its stack when it has one, else what it says. Never throws. */
export function errorText(reason: unknown): string {
  return describe(reason).text;
}

/** The first line of what the error says, cut short. */
function summaryOf(message: string): string {
  const line = (message.split("\n")[0] ?? "").trim();
  return line.length > SUMMARY_MAX ? `${line.slice(0, SUMMARY_MAX)}…` : line;
}

/**
 * An uncaught exception or an unhandled rejection in the main process. `log` is the line for stderr (without the
 * `[run-hound] ` prefix); the problem is what the window says.
 */
export function uncaughtProblem(reason: unknown, origin: string): { problem: Problem; log: string } {
  const { message, text } = describe(reason);
  const summary = summaryOf(message);
  const background = origin === "unhandledRejection";
  return {
    log: `${background ? "unhandled rejection" : "uncaught exception"}: ${text}`,
    problem: {
      title: UNCAUGHT_TITLE,
      paragraphs: [
        background ? "Something Run Hound was doing in the background failed." : "Something unexpected went wrong inside Run Hound.",
        "You can keep using it. If it stops responding or acts strangely, quit and open it again.",
        ...(summary === "" ? [] : [`The error was: ${summary}`]),
      ],
      details: text,
    },
  };
}

/** The path of a page, leaving out its query, fragment and credentials, which can carry tokens. */
export function pathOf(raw: string): string {
  try {
    return new URL(raw).pathname;
  } catch {
    return "(unknown)";
  }
}

/** Chromium's short names (without "net::") for a connection that failed because nothing answered. */
const NOT_ANSWERING = new Set(["ERR_CONNECTION_REFUSED", "ERR_CONNECTION_RESET", "ERR_CONNECTION_CLOSED", "ERR_CONNECTION_FAILED", "ERR_CONNECTION_ABORTED", "ERR_EMPTY_RESPONSE"]);
const TOO_SLOW = new Set(["ERR_TIMED_OUT", "ERR_CONNECTION_TIMED_OUT"]);
const NETWORK = new Set(["ERR_INTERNET_DISCONNECTED", "ERR_NETWORK_CHANGED", "ERR_NETWORK_ACCESS_DENIED", "ERR_ADDRESS_UNREACHABLE"]);

export interface LoadFailure {
  /** Chromium's net error code, e.g. -102. */
  readonly code: number;
  /** Chromium's short name for it, e.g. "ERR_CONNECTION_REFUSED". */
  readonly description: string;
  /** The address that failed; only its path is shown. */
  readonly url: string;
}

/** A window whose page did not load: what happened, in words, then the error and the page's path as Chromium names them. */
export function loadFailureProblem({ code, description, url }: LoadFailure): Problem {
  const name = description.replace(/^net::/, "");
  const why = NOT_ANSWERING.has(name)
    ? "The part of Run Hound that serves this page isn't answering. It may have stopped or restarted."
    : TOO_SLOW.has(name)
      ? "The part of Run Hound that serves this page took too long to answer."
      : NETWORK.has(name)
        ? "This computer's network connection changed or went offline while the page was loading."
        : "Something stopped the page from loading.";
  return {
    title: "This page didn't load",
    paragraphs: [why, "Try again. If it keeps happening, quit and open Run Hound again."],
    details: `Error: ${name || "unknown"} (${code})\nPage: ${pathOf(url)}`,
  };
}

/** A window whose renderer process is gone (`reason` is Electron's: "crashed", "killed", "oom", …). */
export function crashProblem(reason: string, url: string): Problem {
  return {
    title: "This page stopped working",
    paragraphs: ["The page in this window crashed.", "Reload it to carry on. Settings and results Run Hound has already saved are not affected."],
    details: `Reason: ${reason}\nPage: ${pathOf(url)}`,
  };
}
