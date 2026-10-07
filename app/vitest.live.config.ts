import { defineConfig } from "vitest/config";

/**
 * Live provider smoke tests only (`pnpm test:live`). They call real provider APIs with the caller's own keys, so the
 * normal vitest.config.ts excludes them. No isolate-config setup file: the encrypted store of `pnpm live-keys` is read
 * from the real config folder (RUNHOUND_CONFIG_DIR, XDG_CONFIG_HOME or ~/.config/run-hound).
 */
export default defineConfig({
  test: {
    include: ["tests/live/**/*.live.test.ts"],
    testTimeout: 180_000,
    hookTimeout: 60_000,
  },
});
