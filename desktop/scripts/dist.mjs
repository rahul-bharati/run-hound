// Package the built app with electron-builder, stamped with the engine's version from app/package.json so the
// desktop package keeps no version of its own to drift. Extra arguments pass through (--dir for an unpacked build).
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(join(root, "../app/package.json"), "utf8"));
const result = spawnSync("electron-builder", [...process.argv.slice(2), `-c.extraMetadata.version=${version}`], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(result.status ?? 1);
