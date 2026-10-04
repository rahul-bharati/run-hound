// Build the desktop app into dist/: the Electron main process, the sandboxed preload and the engine bundle.
//
// The engine is bundled from app/src because the app imports its .ts files by .js specifiers (it runs under tsx), so
// neither Node nor Electron can load that source as it is. Playwright and axe stay external: they find their own
// files and browsers at runtime, and the packaged app ships them as node_modules.
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const appVersion = JSON.parse(readFileSync(join(root, "../app/package.json"), "utf8")).version;

const RUNTIME_EXTERNAL = ["electron", "playwright", "playwright-core", "@axe-core/playwright", "axe-core"];

// ESM output can't call require(); bundled CommonJS dependencies (pngjs, say) still do, for Node built-ins.
const requireShim = 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);';

// main.ts loads the engine with import("./engine.js"): keep that a runtime import of the separate engine bundle.
const engineStaysSeparate = {
  name: "engine-stays-separate",
  setup(b) {
    b.onResolve({ filter: /^\.\/engine\.js$/ }, () => ({ path: "./engine.js", external: true }));
  },
};

// The engine reads its version from app/package.json relative to its own source file, a path that doesn't exist
// once bundled. Inline the version instead, and fail the build if that source line ever changes shape.
const VERSION_READ = 'readFileSync(new URL("../../../package.json", import.meta.url), "utf8")';
const inlineAppVersion = {
  name: "inline-app-version",
  setup(b) {
    b.onLoad({ filter: /app[\\/]src[\\/]engine[\\/]runner[\\/]options\.ts$/ }, (args) => {
      const source = readFileSync(args.path, "utf8");
      if (!source.includes(VERSION_READ)) throw new Error(`inline-app-version: ${args.path} no longer reads the version with ${VERSION_READ}`);
      return { contents: source.replace(VERSION_READ, JSON.stringify(JSON.stringify({ version: appVersion }))), loader: "ts" };
    });
  },
};

const common = { bundle: true, platform: "node", target: "node24", sourcemap: true, logLevel: "info", absWorkingDir: root };

await Promise.all([
  build({
    ...common,
    entryPoints: ["src/main.ts"],
    outfile: "dist/main.js",
    format: "esm",
    external: RUNTIME_EXTERNAL,
    plugins: [engineStaysSeparate],
    banner: { js: requireShim },
  }),
  build({
    ...common,
    entryPoints: ["src/engine.ts"],
    outfile: "dist/engine.js",
    format: "esm",
    external: RUNTIME_EXTERNAL,
    plugins: [inlineAppVersion],
    banner: { js: requireShim },
  }),
  build({
    ...common,
    entryPoints: ["src/preload.ts"],
    outfile: "dist/preload.cjs",
    format: "cjs",
    external: ["electron"],
  }),
]);
