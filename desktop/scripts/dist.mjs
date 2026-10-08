// Package the built app with electron-builder, stamped with the engine's version from app/package.json so the
// desktop package keeps no version of its own to drift. Extra arguments pass through (--dir for an unpacked build).
// electron-builder's CLI is resolved from the installed package, so this runs the same with or without pnpm's PATH.
//
// The Chromium the app ships (package.json "extraResources" copies build/playwright-browsers) is fetched first, so no
// way of packaging can produce an app without its browser. That Chromium is the host's, so the installer is built for the
// host's architecture: --x64 or --arm64 is added when none is given, and an architecture that isn't the host's is refused.
//
// Signing follows the environment (scripts/signing.mjs): with a complete set of secrets for the platform the installers
// are signed (and, on macOS, notarized) and electron-builder is told to fail if it can't; without them they are built
// unsigned, named "...-unsigned.<ext>", and the build says so. Nothing here publishes: --publish never keeps
// electron-builder from uploading on its own (it would otherwise, implicitly, on a CI tag build), so a release goes
// through the publish job of .github/workflows/desktop-installers.yml, which checks the builds are signed first.
// Under GitHub Actions the result is written to the step's outputs as `signing` (signed, unsigned or not-required).
import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { builderEnv, resolveSigning } from "./signing.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const builderManifest = require.resolve("electron-builder/package.json");
const builderCli = join(dirname(builderManifest), JSON.parse(readFileSync(builderManifest, "utf8")).bin["electron-builder"]);
const { version } = JSON.parse(readFileSync(join(root, "../app/package.json"), "utf8"));

const args = process.argv.slice(2);

const hostArch = process.arch;
if (hostArch !== "x64" && hostArch !== "arm64") {
  console.error(`dist: ${hostArch} is not an architecture Run Hound ships (x64 and arm64).`);
  process.exit(1);
}
const asked = ["x64", "arm64", "ia32", "armv7l", "universal"].filter((arch) => args.includes(`--${arch}`));
if (asked.some((arch) => arch !== hostArch)) {
  console.error(`dist: ${asked.map((arch) => `--${arch}`).join(" ")} would ship this ${hostArch} machine's Chromium. Build each architecture on a machine of its own.`);
  process.exit(1);
}
if (asked.length === 0) args.push(`--${hostArch}`);
if (!args.some((arg) => arg === "-p" || arg === "--publish" || arg.startsWith("--publish="))) args.push("--publish", "never");

const signing = resolveSigning(process.platform, process.env);
if (signing.state === "signed") {
  args.push("-c.forceCodeSigning=true");
  console.log(`dist: signing with ${signing.reason}.`);
} else if (signing.state === "unsigned") {
  console.log(`::warning title=Unsigned installer::Building unsigned installers: ${signing.reason}. They are for testing, not for release.`);
  console.warn(`dist: UNSIGNED build (${signing.reason}).`);
}
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `signing=${signing.state}\n`);

const fetched = spawnSync(process.execPath, [join(root, "scripts", "fetch-browsers.mjs")], { cwd: root, stdio: "inherit" });
if (fetched.error) console.error(fetched.error);
if (fetched.status !== 0) process.exit(fetched.status ?? 1);

const result = spawnSync(process.execPath, [builderCli, ...args, `-c.extraMetadata.version=${version}`], {
  cwd: root,
  env: builderEnv(signing, process.env),
  stdio: "inherit",
});
if (result.error) console.error(result.error);
process.exit(result.status ?? 1);
