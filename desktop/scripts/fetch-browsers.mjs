// Download the Chromium the packaged app ships, into build/playwright-browsers, for electron-builder to copy into
// resources/playwright-browsers (package.json "extraResources"). The app never downloads a browser at runtime, so this
// is the only place one is fetched for a release. It is Playwright's own installer, pointed at a private folder by
// PLAYWRIGHT_BROWSERS_PATH, so the folder holds exactly what Playwright resolves at launch (chromium-<revision>/...).
//
// Full Chromium only (--no-shell): manual sign-in needs a visible browser (Rule 3 of docs/desktop-architecture.md), and
// the desktop app makes its headless launches use that same build (RUNHOUND_FULL_CHROMIUM, app/src/engine/isolation.ts),
// so the 260 MB chromium-headless-shell is not shipped.
//
// The host platform's browser is fetched, so build each platform's installer on that platform. Running it again is
// cheap: Playwright skips what is already there, and removes the browser revisions the installed Playwright no longer
// needs from this private folder.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "build", "playwright-browsers");
const require = createRequire(import.meta.url);

// Playwright's CLI is resolved from the installed package (the same pattern dist.mjs uses for electron-builder), so
// this runs the same with or without pnpm's PATH.
const manifest = require.resolve("playwright/package.json");
const cli = join(dirname(manifest), JSON.parse(readFileSync(manifest, "utf8")).bin.playwright);

const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: target };
// An opt-out left in the caller's environment would make the install skip the download (a mirror, PLAYWRIGHT_DOWNLOAD_HOST,
// is kept: it only changes where the download comes from).
delete env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD;

const install = spawnSync(process.execPath, [cli, "install", "chromium", "--no-shell"], { env, stdio: "inherit" });
if (install.error) throw install.error;
if (install.status !== 0) {
  console.error("fetch-browsers: Playwright could not download Chromium. Check the network connection and run it again.");
  process.exit(install.status ?? 1);
}

// Ask Playwright where it will look for the full Chromium with this folder, and require it to be there. The variable
// is set before Playwright is imported because Playwright reads it once, when it loads (Rule 4).
process.env.PLAYWRIGHT_BROWSERS_PATH = target;
const { chromium } = await import("playwright");
const executable = chromium.executablePath();
if (!executable || !existsSync(executable)) {
  console.error(`fetch-browsers: Chromium is not at ${executable || "(no path for this platform)"} after the install.`);
  process.exit(1);
}

/** Total bytes under `dir`, not following links. */
function sizeOf(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) total += sizeOf(path);
    else if (entry.isFile()) total += statSync(path).size;
  }
  return total;
}
console.log(`fetch-browsers: ${executable} (${(sizeOf(target) / 1024 / 1024).toFixed(0)} MB in ${target})`);
