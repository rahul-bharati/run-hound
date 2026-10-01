/**
 * Test-only preload for the exit-code tests (test/cli-exit.test.ts). Loaded with `node --import`, it swaps the
 * registered check library (src/checks/index.ts, which the runner imports lazily) for fake-checks.mjs, so the real
 * CLI runs end to end with findings the test controls. Nothing in src/ knows about it.
 */
import { registerHooks } from "node:module";

const FAKE = new URL("./fake-checks.mjs", import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/\/checks\/index\.(js|ts)$/.test(specifier) && /\/src\/engine\/[^/]+\.ts$/.test(context.parentURL ?? "")) {
      return { url: FAKE, shortCircuit: true, format: "module" };
    }
    return nextResolve(specifier, context);
  },
});
