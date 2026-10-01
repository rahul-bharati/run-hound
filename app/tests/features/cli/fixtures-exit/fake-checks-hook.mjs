// Test-only preload: swaps the registered check library for fake-checks.mjs.
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