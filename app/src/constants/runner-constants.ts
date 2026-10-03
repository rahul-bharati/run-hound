/** Fixed values the runner reaches for: protocol strings the app matches on (STOPPED_NOTE, ENGINE_STEP), the security-sensitive regexes (CLOSED_BY_GUARD, ANSI, CALL_LOG), the write-side check set (CHANGES_ACCOUNT_A), the plan-text address-key set (PLAN_ADDRESS_KEYS), the explain cap (MAX_EXPLAINED), and the user-facing message (NO_DISPLAY_MESSAGE). No functions; no I/O. */

/** explainFindings explains at most this many findings (the rest get none). */
export const MAX_EXPLAINED = 20;

/** "Stopped by you" — the app counts a scenario as stopped by that prefix. */
export const STOPPED_NOTE = "Stopped by you";

/** scenarioId of step events the engine reports outside any scenario (discovery, launching, writing the report). */
export const ENGINE_STEP = "";

/** Why headed mode is unavailable, in plain words. */
export const NO_DISPLAY_MESSAGE =
  "There is no display on the machine running Run Hound (no DISPLAY or WAYLAND_DISPLAY, as in a container), so a browser window can't be shown. Run without it; the live view in the web UI works either way.";

/** Plan fields that address the page (selectors, URLs, field keys, and option labels, which a select is set by): they must keep working, so they keep their text. */
export const PLAN_ADDRESS_KEYS = new Set(["selector", "nativeSelector", "url", "target", "key", "linkTargets", "options"]);

/** The checks that change Account A's data and have an interruptedNote; their notes can say what they could not put back, so an escape never drops them. */
export const CHANGES_ACCOUNT_A: ReadonlySet<CheckId> = new Set<CheckId>(["mass-assignment", "csrf", "write-access", "paywall-trust"]);

/** A closed-context message at the start of what a check's next browser call throws. */
export const CLOSED_BY_GUARD = /^(?:[a-z]\w*\.[a-z]\w*: )?(?:Run Hound stopped: the page went to \S+?|Target page, context or browser has been closed)\.?(?=\s|$)/;

// eslint-disable-next-line no-control-regex
export const ANSI = /\u001b\[[0-9;]*m/g;

/** Playwright's call log at the end of a failed call's message, with an optional trailing full stop a write-side check adds before its own notes. */
export const CALL_LOG = /\n[ \t]*Call log:\n(?:[^\n]*\n)*?(?=[^\n]*$|[^\n]*\n[ \t]*Call log:\n)(\.(?=\s|$))?/g;

import type { CheckId } from "../core/types.js";
