// What to look at when the INSTALLED desktop app doesn't open on a clean machine (D5). first-run-check.mjs drives the app
// with Playwright, which starts it with --inspect and --remote-debugging-port; when that fails, it can't say whether the
// app itself starts. This script looks at the app without Playwright:
//
//   node scripts/first-run-diagnose.mjs fuses  --app <installed executable> --evidence <dir>
//   node scripts/first-run-diagnose.mjs direct --app <installed executable> --evidence <dir> [--seconds 25] [--screenshot-at 15]
//
// fuses   reads the Electron fuses of the binary (@electron/fuses, a dependency of electron-builder), on every platform.
//         Writes fuses.json and fuses.txt.
// direct  runs the app twice on a fresh home with ELECTRON_ENABLE_LOGGING=1 and RUNHOUND_NO_UPDATE_CHECK=1: once plain
//         (app-direct.log) and once with the two flags Playwright adds (app-direct-inspect.log). Each run is watched for
//         --seconds; a full-screen screenshot is taken at --screenshot-at (screen.png, screen-inspect.png; macOS and
//         Windows only); then it is killed. app-direct.json records whether it was still running and its exit code.
// Both append their findings to diagnostics.md, which the workflow adds to the job summary. They always exit 0: they report,
// the first-run check decides.
import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { diagnosticsMarkdown, describeFuses, exitCodeHex, isolatedEnv, parseDiagnoseArgs } from "./first-run-lib.mjs";

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
  if (run.error || run.status !== 0 || !existsSync(path)) return { note: `screenshot failed: ${run.error?.message ?? String(run.stderr ?? "").trim() ?? run.status}` };
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

async function run({ id, extra, log, shot }) {
  const home = mkdtempSync(join(tmpdir(), "run-hound-direct-"));
  const env = { ...isolatedEnv(process.env, platform, home), ELECTRON_ENABLE_LOGGING: "1", ELECTRON_ENABLE_STACK_DUMPING: "1" };
  // The sandbox flag Playwright adds on Linux (a runner has no setuid sandbox); nothing else is added.
  const flags = [...extra, ...(platform === "linux" ? ["--no-sandbox"] : [])];
  const fd = openSync(join(evidence, log), "w");
  const started = Date.now();
  const child = spawn(app, flags, { env, stdio: ["ignore", fd, fd], detached: platform !== "win32" });
  closeSync(fd);
  const result = { id, args: flags, seconds: args.seconds, log, pid: child.pid ?? null, running: false, exitCode: null, exitCodeHex: null, signal: null, screenshot: null, screenshotNote: null };
  let exited = false;
  let killing = false;
  child.once("error", (err) => {
    exited = true;
    result.error = err.message;
  });
  child.once("exit", (code, signal) => {
    exited = true;
    if (killing) return; // our own kill, not how the app ended
    result.exitCode = code;
    result.exitCodeHex = exitCodeHex(code);
    result.signal = signal;
  });
  await sleep(Math.min(args.screenshotAt, args.seconds) * 1000);
  const shotPath = join(evidence, shot);
  const taken = screenshot(shotPath);
  result.screenshot = taken.file ? shot : null;
  result.screenshotNote = taken.note ?? null;
  await sleep(Math.max(0, args.seconds * 1000 - (Date.now() - started)));
  result.running = !exited;
  result.elapsedMs = Date.now() - started;
  if (!exited) {
    killing = true;
    killTree(child);
    await Promise.race([new Promise((done) => child.once("exit", done)), sleep(5000)]);
  }
  result.logBytes = existsSync(join(evidence, log)) ? statSync(join(evidence, log)).size : 0;
  rmSync(home, { recursive: true, force: true });
  console.log(`first-run-diagnose: ${id}: ${result.running ? `still running after ${args.seconds} s` : `exited ${result.exitCode ?? result.signal} ${result.exitCodeHex ?? ""}`}`);
  return result;
}

const runs = [];
runs.push(await run({ id: "plain", extra: [], log: "app-direct.log", shot: "screen.png" }));
runs.push(await run({ id: "playwright-flags", extra: ["--inspect=0", "--remote-debugging-port=0"], log: "app-direct-inspect.log", shot: "screen-inspect.png" }));
writeFileSync(join(evidence, "app-direct.json"), `${JSON.stringify({ app, platform, runs }, null, 2)}\n`);
appendFileSync(join(evidence, "diagnostics.md"), diagnosticsMarkdown({ runs }));
process.exit(0);
