/**
 * Implementation of the env-ordering rule declared by `env.ts`. The
 * apply function writes the Playwright environment variables to
 * `process.env` exactly once, so the bundled Chromium is found and the
 * browser garbage collection never runs. It is the only side-effect the
 * desktop package performs at import time; everything else (entry,
 * preload) defers until invoked.
 */

import { PLAYWRIGHT_ENV_NAMES, type ApplyPlaywrightEnv, type PlaywrightEnvInit } from "./env.js";

/** The set of variables the apply function owns. */
type Env = Record<typeof PLAYWRIGHT_ENV_NAMES[number], string | undefined>;

/**
 * True when the variables are already set to the values we would set.
 * The apply function is idempotent: calling it twice with the same init
 * is a no-op, so the engine module can be re-imported without surprising
 * the test harness.
 */
function isApplied(env: Env, init: PlaywrightEnvInit): boolean {
  return env.PLAYWRIGHT_BROWSERS_PATH === init.browsersPath && env.PLAYWRIGHT_SKIP_BROWSER_GC === init.skipBrowserGc;
}

/**
 * Apply the init. The test surface in `tests/env.test.ts` passes a
 * sandboxed `process.env` via the second argument; production code
 * calls `applyPlaywrightEnv(init)` with the default argument and the
 * variables land on the real process.
 */
export const applyPlaywrightEnv: ApplyPlaywrightEnv = (init, target: NodeJS.ProcessEnv = process.env) => {
  if (isApplied(target as Env, init)) return;
  target.PLAYWRIGHT_BROWSERS_PATH = init.browsersPath;
  target.PLAYWRIGHT_SKIP_BROWSER_GC = init.skipBrowserGc;
};
