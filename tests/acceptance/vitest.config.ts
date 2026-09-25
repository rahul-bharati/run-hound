import { defineConfig } from "vitest/config";

/**
 * Acceptance suite: runs Run Hound end to end against Kennel, once per mode (clean + every V0 bug), against Fernway
 * (every route clean, then each planted bug on its page) and against the sample apps.
 *
 * Env:
 *   ACCEPTANCE_MODES=clean,F01   run only these Kennel modes (default: all)
 *   ACCEPTANCE_FERNWAY=/app,W03  run only these Fernway routes and bugs (default: all; "clean" = every route, "bugs" = every bug)
 *   ACCEPTANCE_CONCURRENCY=2     modes run at the same time (each has its own Kennel or Fernway on free ports)
 *   KENNEL_SKIP_BUILD=1          reuse fixtures/kennel/dist instead of running `vite build`
 *   FERNWAY_SKIP_BUILD=1         reuse fixtures/fernway/dist instead of running `vite build`
 *   UPDATE_GOLDEN=1              print observed results as a diff against the golden file (never writes)
 *   KEEP_RUNS=1                  keep the runs/ directories (paths are printed)
 */
const concurrency = Number(process.env.ACCEPTANCE_CONCURRENCY ?? 2);

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Never the developer's real AI settings (they would add AI steps to the golden runs).
    setupFiles: ["../../app/test-support/isolate-config.ts"],
    testTimeout: 10 * 60_000,
    hookTimeout: 5 * 60_000,
    maxConcurrency: Number.isFinite(concurrency) && concurrency > 0 ? concurrency : 2,
  },
});
