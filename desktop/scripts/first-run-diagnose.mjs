// What to look at when the INSTALLED desktop app doesn't open on a clean machine (D5). first-run-check.mjs drives the app
// with Playwright, which starts it with --inspect and --remote-debugging-port; when that fails, it can't say whether the
// app itself starts. This script looks at the app without Playwright:
//
//   node scripts/first-run-diagnose.mjs fuses  --app <installed executable> --evidence <dir>
//   node scripts/first-run-diagnose.mjs direct --app <installed executable> --evidence <dir> [--seconds 25] [--screenshot-at 15]
//
// fuses   reads the Electron fuses of the binary (@electron/fuses, a dependency of electron-builder), on every platform.
//         Writes fuses.json and fuses.txt.
// direct  runs the app with ELECTRON_ENABLE_LOGGING=1 and RUNHOUND_NO_UPDATE_CHECK=1: plain (app-direct.log) and with the
//         two flags Playwright adds (app-direct-inspect.log). Each run is watched for --seconds, or until it exits; a
//         full-screen screenshot is taken at --screenshot-at (macOS and Windows only: screen-<run>.png); then it is
//         killed. app-direct.json records whether it was still running and its exit code. Linux uses a fresh home; macOS and
//         Windows use the machine's own (a fresh HOME has no login keychain on macOS, and Windows' profile is not ours to
//         change). On Windows, where the installed app crashes at start-up, six more runs follow that isolate the cause:
//         Chromium's own log, V8's optimizing compilers off in turn, and stock Electron running a hello-world main.js and
//         then this repository's unpackaged app (needs `electron:fetch` and `build` first), with and without --js-flags.
// Both append their findings to diagnostics.md, which the workflow adds to the job summary. They always exit 0: they report,
// the first-run check decides.
import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { diagnosticsMarkdown, describeFuses, exitCodeHex, inheritedEnv, isolatedEnv, parseDiagnoseArgs } from "./first-run-lib.mjs";

const platform = process.platform;
let args;
try {
  args = parseDiagnoseArgs(process.argv.slice(2));
} catch (err) {
  console.error(`first-run-diagnose: ${err.message}`);
  process.exit(2);
}
const evidence = resolve(args.evidence);
const app = resolve(args.app);
mkdirSync(evidence, { recursive: true });
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

if (args.command === "fuses") {
  let fuses;
  try {
    const { getCurrentFuseWire, FuseV1Options } = createRequire(import.meta.url)("@electron/fuses");
    // The bytes a fuse can hold (@electron/fuses dist/constants.js FuseState, which its index doesn't export).
    const states = { 48: "DISABLE", 49: "ENABLE", 114: "REMOVED" };
    fuses = describeFuses(await getCurrentFuseWire(app), FuseV1Options, states);
  } catch (err) {
    fuses = { error: err instanceof Error ? err.message : String(err) };
  }
  writeFileSync(join(evidence, "fuses.json"), `${JSON.stringify({ app, platform, ...fuses }, null, 2)}\n`);
  writeFileSync(join(evidence, "fuses.txt"), fuses.error ? `not read: ${fuses.error}\n` : `${fuses.fuses.map((fuse) => `${fuse.name}: ${fuse.state}`).join("\n")}\n`);
  appendFileSync(join(evidence, "diagnostics.md"), diagnosticsMarkdown({ fuses }));
  console.log(readFileSync(join(evidence, "fuses.txt"), "utf8"));
  process.exit(0);
}

// ---- direct ----

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const WINDOWS_SHOT = `
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$b = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)
$bmp.Save($env:SHOT, [System.Drawing.Imaging.ImageFormat]::Png)
`;

/** A full-screen PNG; the result says what happened, and never throws. */
function screenshot(path) {
  const run =
    platform === "darwin"
      ? spawnSync("screencapture", ["-x", path], { timeout: 20_000 })
      : platform === "win32"
        ? spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_SHOT], { timeout: 30_000, env: { ...process.env, SHOT: path } })
        : null;
  if (!run) return { note: "no screenshot tool on this platform" };
  if (run.error || run.status !== 0 || !existsSync(path)) return { note: `screenshot failed: ${run.error?.message ?? (String(run.stderr ?? "").trim() || run.status)}` };
  return { file: path };
}

function killTree(child) {
  try {
    if (platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { timeout: 20_000 });
    else process.kill(-child.pid, "SIGKILL");
  } catch {
    // already gone
  }
}

/** Start `exe` and watch it for --seconds (or until it exits), with a screenshot on the way, then kill it. */
async function run({ id, what, exe, flags, log }) {
  const ownHome = platform === "linux" ? mkdtempSync(join(tmpdir(), "run-hound-direct-")) : null;
  const base = ownHome ? isolatedEnv(process.env, platform, ownHome) : inheritedEnv(process.env);
  const env = { ...base, ELECTRON_ENABLE_LOGGING: "1", ELECTRON_ENABLE_STACK_DUMPING: "1" };
  // The sandbox flag Playwright adds on Linux (a runner has no setuid sandbox); nothing else is added.
  const argv = [...flags, ...(platform === "linux" ? ["--no-sandbox"] : [])];
  const fd = openSync(join(evidence, log), "w");
  const started = Date.now();
  const child = spawn(exe, argv, { env, stdio: ["ignore", fd, fd], detached: platform !== "win32" });
  closeSync(fd);
  const result = { id, what, args: argv, seconds: args.seconds, log, pid: child.pid ?? null, running: false, exitCode: null, exitCodeHex: null, signal: null, screenshot: null, screenshotNote: null };
  let exited = false;
  let killing = false;
  const gone = new Promise((done) => {
    child.once("error", (err) => {
      exited = true;
      result.error = err.message;
      done();
    });
    child.once("exit", (code, signal) => {
      exited = true;
      if (!killing) {
        // our own kill is not how the app ended
        result.exitCode = code;
        result.exitCodeHex = exitCodeHex(code);
        result.signal = signal;
      }
      done();
    });
  });
  await Promise.race([gone, sleep(Math.min(args.screenshotAt, args.seconds) * 1000)]);
  if (!exited) {
    const taken = screenshot(join(evidence, `screen-${id}.png`));
    result.screenshot = taken.file ? `screen-${id}.png` : null;
    result.screenshotNote = taken.note ?? null;
  } else {
    result.screenshotNote = "it had exited";
  }
  await Promise.race([gone, sleep(Math.max(0, args.seconds * 1000 - (Date.now() - started)))]);
  result.running = !exited;
  result.elapsedMs = Date.now() - started;
  if (!exited) {
    killing = true;
    killTree(child);
    await Promise.race([gone, sleep(5000)]);
  }
  result.logBytes = existsSync(join(evidence, log)) ? statSync(join(evidence, log)).size : 0;
  if (ownHome) rmSync(ownHome, { recursive: true, force: true });
  console.log(`first-run-diagnose: ${id}: ${result.running ? `still running after ${args.seconds} s` : `exited ${result.exitCode ?? result.signal} ${result.exitCodeHex ?? ""}`}`);
  await sleep(2000); // let the single-instance lock and the ports go before the next run
  return result;
}

const runs = [];
const installed = (id, flags, extra = {}) => ({ id, what: "installed app", exe: app, flags, log: `app-direct-${id}.log`, ...extra });
runs.push(await run({ ...installed("plain", []), log: "app-direct.log" }));
runs.push(await run({ ...installed("playwright-flags", ["--inspect=0", "--remote-debugging-port=0"]), log: "app-direct-inspect.log" }));

if (platform === "win32") {
  // The installed app crashes at start-up on Windows (exit 0x80000003, EXCEPTION_BREAKPOINT, on a V8 background thread). V8 flags valid for this Electron's V8 (checked with --js-flags=--help): --turbofan (--opt is its
  // alias), --maglev, --sparkplug, --concurrent-recompilation, --jitless.
  runs.push(await run(installed("chromium-log", ["--enable-logging=file", `--log-file=${join(evidence, "chromium.log")}`, "--v=1"])));
  runs.push(await run(installed("no-opt", ["--js-flags=--no-opt"])));
  runs.push(await run(installed("no-maglev-turbofan", ["--js-flags=--no-maglev --no-turbofan"])));
  runs.push(await run(installed("no-concurrent-recompilation", ["--js-flags=--no-concurrent-recompilation"])));
  runs.push(await run(installed("jitless", ["--js-flags=--jitless"])));

  // Stock Electron, from node_modules (after `pnpm --filter @run-hound/desktop electron:fetch`), on this runner.
  let stock = null;
  let why = null;
  try {
    stock = createRequire(join(repo, "desktop", "package.json"))("electron");
    if (typeof stock !== "string" || !existsSync(stock)) throw new Error(`electron resolved to ${String(stock)}`);
  } catch (err) {
    why = `stock Electron is not installed (run electron:fetch first): ${err instanceof Error ? err.message : String(err)}`;
  }
  const desktop = join(repo, "desktop");
  const built = existsSync(join(desktop, "dist", "main.js"));
  const hello = mkdtempSync(join(tmpdir(), "run-hound-hello-"));
  writeFileSync(join(hello, "package.json"), '{ "name": "hello", "main": "main.js" }\n');
  writeFileSync(
    join(hello, "main.js"),
    [
      'const { app, BrowserWindow } = require("electron");',
      "app.whenReady().then(() => {",
      '  new BrowserWindow({ width: 400, height: 300 }).loadURL("data:text/html,<h1>hello</h1>");',
      '  console.log("hello");',
      "  setTimeout(() => app.quit(), 10000);",
      "});",
      "",
    ].join("\n"),
  );
  const stockRun = (id, what, flags, ok = true, note = "") => (stock && ok ? run({ id, what, exe: stock, flags, log: `app-direct-${id}.log` }) : { id, what, skipped: why ?? note });
  runs.push(await stockRun("stock-hello", "stock Electron, a window that says hello (quits after 10 s)", [hello]));
  const noMain = "the unpackaged app is not built (run pnpm --filter @run-hound/desktop build first)";
  runs.push(await stockRun("stock-app", "stock Electron running desktop/ unpackaged", [desktop], built, noMain));
  runs.push(await stockRun("stock-app-no-opt", "stock Electron running desktop/ unpackaged", ["--js-flags=--no-opt", desktop], built, noMain));
  rmSync(hello, { recursive: true, force: true });
}

writeFileSync(join(evidence, "app-direct.json"), `${JSON.stringify({ app, platform, runs }, null, 2)}\n`);
appendFileSync(join(evidence, "diagnostics.md"), diagnosticsMarkdown({ runs }));
process.exit(0);
