import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    // Never the developer's real AI settings: each worker gets an empty config folder (see the file).
    setupFiles: ["test-support/isolate-config.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // expect.poll() waits on browser events (requests, console messages, guard blocks) whose latency grows
    // with machine load; the 1 s default is too tight while the whole suite runs. A poll returns as soon as
    // its condition holds, so the higher ceiling only matters when something is really wrong.
    expect: { poll: { timeout: 10_000 } },
  },
});
