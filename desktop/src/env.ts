/**
 * The Playwright environment variables the desktop entry must set BEFORE
 * importing the engine. `app/src/engine/isolation.ts:21` imports
 * `playwright` statically, so any path that transitively imports the
 * engine imports Playwright too. Setting these variables after that
 * import is too late.
 *
 * Rule 4 of docs/desktop-architecture.md. This module exports the contract
 * only; the next slice implements the function that applies it.
 */

/** Names of the environment variables the entry must set. */
export const PLAYWRIGHT_ENV_NAMES = [
  "PLAYWRIGHT_BROWSERS_PATH",
  "PLAYWRIGHT_SKIP_BROWSER_GC",
] as const;

export type PlaywrightEnvName = (typeof PLAYWRIGHT_ENV_NAMES)[number];

/**
 * The values the entry must install before the engine is imported. The
 * implementation resolves the application-private, version-tagged
 * directory and writes the values to `process.env` exactly once.
 */
export interface PlaywrightEnvInit {
  /** Absolute, app-private, version-tagged directory of the bundled Chromium. */
  readonly browsersPath: string;
  /** Always "1" for a shipped app: prevents Playwright's GC from deleting the bundled browser. */
  readonly skipBrowserGc: "1";
}

/**
 * Apply the env init to `process.env`. The function must be idempotent
 * and must run before any module that imports the engine is loaded.
 */
export type ApplyPlaywrightEnv = (init: PlaywrightEnvInit) => void;

/**
 * The order rule, expressed as a check the next slice must satisfy. The
 * test in tests/env.test.ts asserts the rule by attempting to read the
 * variables and then importing the contract (which does not import the
 * engine), and separately asserts that the rule is stated clearly.
 */
export const ENV_ORDER_RULE =
  "Set PLAYWRIGHT_BROWSERS_PATH and PLAYWRIGHT_SKIP_BROWSER_GC in process.env before any module that transitively imports app/src/engine/isolation is loaded." as const;
