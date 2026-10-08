// Package the built app with electron-builder, stamped with the engine's version from app/package.json so the
// desktop package keeps no version of its own to drift. Extra arguments pass through (--dir for an unpacked build).
// electron-builder's CLI is resolved from the installed package, so this runs the same with or without pnpm's PATH.
//
// The Chromium the app ships (package.json "extraResources" copies build/playwright-browsers) is fetched first, so no
// way of packaging can produce an app without its browser.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const builderManifest = require.resolve("electron-builder/package.json");
const builderCli = join(dirname(builderManifest), JSON.parse(readFileSync(builderManifest, "utf8")).bin["electron-builder"]);
const { version } = JSON.parse(readFileSync(join(root, "../app/package.json"), "utf8"));

const fetched = spawnSync(process.execPath, [join(root, "scripts", "fetch-browsers.mjs")], { cwd: root, stdio: "inherit" });
if (fetched.error) console.error(fetched.error);
if (fetched.status !== 0) process.exit(fetched.status ?? 1);

const result = spawnSync(process.execPath, [builderCli, ...process.argv.slice(2), `-c.extraMetadata.version=${version}`], {
  cwd: root,
  stdio: "inherit",
});
if (result.error) console.error(result.error);
process.exit(result.status ?? 1);
