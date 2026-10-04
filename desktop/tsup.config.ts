import { defineConfig } from "tsup";

/**
 * Build the Electron main process, the engine utility-process entry, and
 * the preload script. All three are transpiled only (no bundling),
 * because the engine's transitive dependencies include Playwright and
 * many native-binding shims that tsup/esbuild cannot bundle. Marking
 * every `node_modules` import as external keeps the bundler from
 * following them.
 */

const NO_NODE_MODULES_BUNDLE = (entry: string, format: "cjs" | "esm") => ({
  entry: [entry],
  outDir: "dist",
  format: [format] as Array<"cjs" | "esm">,
  platform: "node" as const,
  target: "node22",
  sourcemap: true,
  noBundle: true,
  clean: true,
  splitting: false,
  // Everything under node_modules is external; tsup will leave
  // import paths as runtime require/import statements.
  external: [/node_modules/],
});

export default defineConfig([
  // Electron main process: ESM. Electron 28+ supports an ESM main;
  // ESM lets us use import.meta.url for the preload path.
  NO_NODE_MODULES_BUNDLE("src/main.ts", "esm"),
  // Engine utility-process entry: ESM.
  NO_NODE_MODULES_BUNDLE("src/entry.ts", "esm"),
  // Preload script: CJS so Electron's contextBridge can require it.
  {
    entry: ["src/preload.ts"],
    outDir: "dist",
    format: ["cjs"],
    platform: "node",
    target: "node22",
    sourcemap: true,
    clean: false, // already cleaned by the first config
    external: [/node_modules/, "electron"],
    splitting: false,
  },
]);
