/**
 * Test-only preload for test/cli-groups.test.ts, loaded with `node --import`: swaps the registered check library
 * (src/checks/index.ts, imported lazily by the runner) for fake-checks.mjs. Nothing in src/ knows about it.
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
