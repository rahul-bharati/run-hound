/**
 * The start-up error window (D8): a branded page, static/startup-error.html (copied to dist/ by scripts/build.mjs),
 * replaces the native error box. The messages travel in the page's query string and the page writes them with
 * textContent, never as HTML. Pure, so the query is unit tested; main.ts opens the window.
 */

/** The page's file name, next to main.js in dist/. */
export const STARTUP_ERROR_PAGE = "startup-error.html";

/** Most of a long stack trace is no use in a window; the whole of it still goes to stderr. */
export const STARTUP_DETAILS_MAX = 4000;

/**
 * The `query` for `loadFile`: `title`, `problems` (a JSON array of strings, one paragraph each) and, when there is
 * one, `details` (plain text shown in a monospace block).
 */
export function startupErrorQuery(title: string, problems: readonly string[], details?: string): Record<string, string> {
  const trimmed = details?.trim() ?? "";
  return {
    title,
    problems: JSON.stringify(problems),
    ...(trimmed === "" ? {} : { details: trimmed.length > STARTUP_DETAILS_MAX ? `${trimmed.slice(0, STARTUP_DETAILS_MAX)}…` : trimmed }),
  };
}
