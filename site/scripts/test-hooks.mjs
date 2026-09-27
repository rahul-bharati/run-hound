/**
 * Lets `node --test` (package.json "test") load the site's TypeScript modules the way Next.js does, without a
 * dependency: Node strips the types itself, and this resolves the "@/…" alias (tsconfig.json "paths") and imports
 * written without an extension to the .ts file. Loaded with `node --import ./scripts/test-hooks.mjs`.
 *
 * Only plain .ts modules can be tested this way: Node doesn't compile JSX, and static image imports need Next.js.
 */
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";

const src = new URL("../src/", import.meta.url);

registerHooks({
  resolve(specifier, context, nextResolve) {
    let target;
    if (specifier.startsWith("@/")) target = new URL(specifier.slice(2), src);
    else if (/^\.\.?\//.test(specifier) && context.parentURL?.endsWith(".ts")) target = new URL(specifier, context.parentURL);
    if (target && !/\.[cm]?[jt]sx?$/.test(target.pathname)) {
      const file = [".ts", "/index.ts"].map((ending) => new URL(`${target.href}${ending}`)).find((url) => existsSync(url));
      if (file) target = file;
    }
    const resolved = nextResolve(target ? target.href : specifier, context);
    // The site's .ts files are ES modules (package.json has no "type"), so Node needn't guess and warn.
    return resolved.url.startsWith("file:") && resolved.url.endsWith(".ts")
      ? { ...resolved, format: "module-typescript" }
      : resolved;
  },
});
