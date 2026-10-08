// Pure helpers for first-run-check.mjs (the D5 first-run check of an INSTALLED desktop app): argument parsing, the
// documented data folders, the app's isolated environment, the step recorder, the report assertions and the evidence
// summary. Nothing here launches anything, so desktop/tests/first-run.test.ts covers it without Electron.
import { posix, win32 } from "node:path";

/** What the check accepts; see first-run-check.mjs for what each is for. */
export function parseArgs(argv) {
  const out = { app: "", evidence: "", artifact: "", home: "", realHome: false, installedPaths: [], packageFiles: "", afterUninstall: false, waitSeconds: 0 };
  const takes = new Map([
    ["--app", (v) => (out.app = v)],
    ["--evidence", (v) => (out.evidence = v)],
    ["--artifact", (v) => (out.artifact = v)],
    ["--home", (v) => (out.home = v)],
    ["--installed-path", (v) => out.installedPaths.push(v)],
    ["--package-files", (v) => (out.packageFiles = v)],
    ["--wait-seconds", (v) => (out.waitSeconds = Number(v))],
  ]);
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--after-uninstall") {
      out.afterUninstall = true;
      continue;
    }
    if (flag === "--real-home") {
      out.realHome = true;
      continue;
    }
    const set = takes.get(flag);
    if (!set) throw new Error(`Unknown argument ${flag}.`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${flag} needs a value.`);
    set(value);
    i += 1;
  }
  if (!out.app) throw new Error("--app <path to the installed executable> is required.");
  if (!out.evidence) throw new Error("--evidence <directory> is required.");
  if (!Number.isFinite(out.waitSeconds) || out.waitSeconds < 0) throw new Error("--wait-seconds must be a number of seconds.");
  if (out.realHome && out.home) throw new Error("--real-home and --home are alternatives.");
  if (out.afterUninstall && !out.home && !out.realHome) throw new Error("--after-uninstall needs the --home the first run used, or --real-home.");
  return out;
}

/**
 * Where the app keeps its settings and its reports, as docs/desktop-install.md ("Where your data lives") documents them.
 * This is written out here rather than imported from desktop/src/config.ts on purpose: the check verifies the documented
 * folders against what the installed app really wrote.
 */
export function expectedDataDirs(platform, home, env = {}) {
  if (platform === "darwin") {
    const settings = posix.join(home, "Library", "Application Support", "run-hound");
    return { settings, runs: posix.join(settings, "runs") };
  }
  if (platform === "win32") {
    const roaming = env.APPDATA || win32.join(home, "AppData", "Roaming");
    const local = env.LOCALAPPDATA || win32.join(home, "AppData", "Local");
    return { settings: win32.join(roaming, "run-hound"), runs: win32.join(local, "run-hound", "runs") };
  }
  const config = env.XDG_CONFIG_HOME || posix.join(home, ".config");
  const data = env.XDG_DATA_HOME || posix.join(home, ".local", "share");
  return { settings: posix.join(config, "run-hound-desktop"), runs: posix.join(data, "run-hound", "runs") };
}

/** Variables that would move the app's folders or switch its AI on by themselves: a first run has none of them. */
const LEAKING = [/^RUNHOUND_/, /^PLAYWRIGHT_/, /^XDG_(?:CONFIG|DATA)_HOME$/, /^(?:ANTHROPIC|OPENAI|GEMINI|GOOGLE)_API_KEY$/];

/**
 * The environment of the app under test: a fresh home (so Playwright's per-user browser cache is out of reach and no
 * settings exist), the folders the OS variables name inside it, no update check (it would call GitHub), and nothing from
 * the caller that could move the app's folders or hand it a key.
 */
export function isolatedEnv(base, platform, home) {
  const env = {};
  for (const [name, value] of Object.entries(base)) {
    if (value === undefined) continue;
    if (name.toUpperCase() === "RUNHOUND_NO_UPDATE_CHECK") continue;
    if (LEAKING.some((pattern) => pattern.test(name.toUpperCase()))) continue;
    env[name] = value;
  }
  env.HOME = home;
  env.RUNHOUND_NO_UPDATE_CHECK = "1";
  if (platform === "win32") {
    env.USERPROFILE = home;
    env.APPDATA = win32.join(home, "AppData", "Roaming");
    env.LOCALAPPDATA = win32.join(home, "AppData", "Local");
  } else if (platform === "linux") {
    env.XDG_CACHE_HOME = posix.join(home, ".cache");
  }
  return env;
}

/**
 * What a package manager says it installed (one path per line, as `dpkg -L` and `rpm -ql` print it) that is still on disk
 * as a file or symlink. Directories don't count: a package may leave a shared one, and the app's own is checked by path.
 * `kind` answers "file", "dir" or null for a path.
 */
export function leftoverFiles(listing, kind) {
  return listing
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("/") && line !== "/")
    .filter((path) => kind(path) === "file");
}

/** The product's name, as the OS shows it: Electron's app name, the profile folder, the bundle and the Windows exe. */
export const APP_NAME = "Run Hound";

/**
 * Whether the installed executable and the app's own names are the ones desktop/package.json promises: the Linux binary
 * is `run-hound` (the package puts it under /opt/Run Hound), the macOS bundle is `Run Hound.app` with `Run Hound` inside
 * it, the Windows exe is `Run Hound.exe`, and Electron's app name, which names its profile folder (`userData`) and the
 * keychain or libsecret item, is `Run Hound` (the package.json `productName`).
 */
export function nameProblems({ platform, executable, appName, userData }) {
  const problems = [];
  const path = String(executable).replace(/\\/g, "/");
  const want = platform === "darwin" ? `/${APP_NAME}.app/Contents/MacOS/${APP_NAME}` : platform === "win32" ? `/${APP_NAME}.exe` : "/run-hound";
  if (!path.endsWith(want)) problems.push(`the installed executable is ${executable}, which should end in ${want.slice(1)}`);
  if (appName !== APP_NAME) problems.push(`Electron's app name is ${JSON.stringify(appName)}, not ${JSON.stringify(APP_NAME)}`);
  const folder = String(userData).replace(/\\/g, "/").split("/").pop();
  if (folder !== APP_NAME) problems.push(`the profile folder is ${userData}, which should be named ${APP_NAME}`);
  return problems;
}

/**
 * The environment of the app under test on the machine's own home (--real-home): what isolatedEnv leaves out (the variables
 * that would move the app's folders or hand it a key), and nothing added but the update check switched off. A fresh GitHub
 * runner is already a clean machine; on macOS a fresh HOME has no login keychain, so the first safeStorage access shows a
 * system dialog ("Keychain Not Found") before the window, and on Windows a changed profile is not what a user has.
 */
export function inheritedEnv(base) {
  const env = {};
  for (const [name, value] of Object.entries(base)) {
    if (value === undefined) continue;
    if (name.toUpperCase() === "RUNHOUND_NO_UPDATE_CHECK") continue;
    if (LEAKING.some((pattern) => pattern.test(name.toUpperCase()))) continue;
    env[name] = value;
  }
  env.RUNHOUND_NO_UPDATE_CHECK = "1";
  return env;
}

/**
 * Where Run Hound would have left data on this machine, to assert none is there before a first run on the machine's own
 * home: its settings and reports folders (docs/desktop-install.md) and the app's profile folder named after the product.
 */
export function cleanMachinePaths(platform, home, env = {}) {
  const dirs = expectedDataDirs(platform, home, env);
  // On macOS the reports folder is inside the settings folder.
  if (platform === "darwin") return [dirs.settings, posix.join(home, "Library", "Application Support", "Run Hound")];
  if (platform === "win32") return [dirs.settings, dirs.runs, win32.join(env.APPDATA || win32.join(home, "AppData", "Roaming"), "Run Hound")];
  return [dirs.settings, dirs.runs, posix.join(env.XDG_CONFIG_HOME || posix.join(home, ".config"), "Run Hound")];
}

/** Replace every secret in a message, so a failure never prints a key. */
export function redact(text, secrets) {
  let out = String(text);
  for (const secret of secrets) if (secret) out = out.split(secret).join("[key]");
  return out;
}

/** Records each step in order with its result and duration. `now` and `secrets` are injectable for the tests. */
export class StepRecorder {
  constructor({ now = () => performance.now(), secrets = [] } = {}) {
    this.now = now;
    this.secrets = secrets;
    this.steps = [];
  }

  /** Run one step. `fn` may return a short detail string. A throw fails the step and the check goes on. */
  async run(name, fn) {
    const started = this.now();
    let step;
    try {
      const detail = await fn();
      step = { name, ok: true, ms: 0, ...(typeof detail === "string" && detail ? { detail: redact(detail, this.secrets) } : {}) };
    } catch (err) {
      if (process.env.FIRST_RUN_DEBUG) console.error(redact(err?.stack, this.secrets));
      const message = err instanceof Error ? err.message : String(err);
      step = { name, ok: false, ms: 0, error: redact(message, this.secrets) };
    }
    step.ms = Math.max(0, Math.round(this.now() - started));
    this.steps.push(step);
    return step.ok;
  }

  get ok() {
    return this.steps.length > 0 && this.steps.every((step) => step.ok);
  }
}

/** Ask until `fn` returns a value other than undefined, or throw with `what` after `timeoutMs`. */
export async function poll(fn, { timeoutMs, intervalMs = 500, what, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const deadline = now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value !== undefined) return value;
    if (now() >= deadline) throw new Error(`Timed out after ${Math.round(timeoutMs / 1000)} s waiting for ${what}.`);
    await sleep(intervalMs);
  }
}

/** The files (of {path, bytes}) that hold `secret` as text: plain, or as UTF-16 (which Windows tools write). */
export function findPlainText(files, secret) {
  const needles = [Buffer.from(secret, "utf8"), Buffer.from(secret, "utf16le")];
  return files.filter((file) => needles.some((needle) => Buffer.from(file.bytes).includes(needle))).map((file) => file.path);
}

/** The findings a report calls confirmed: on a sample app each one is a false positive. */
export function confirmedFindings(report) {
  return (report?.findings ?? []).filter((finding) => finding.confidence === "confirmed");
}

/** The engine's note on a scenario the user stopped (app/src/constants/runner-constants.ts STOPPED_NOTE). */
export const STOPPED_NOTE = "Stopped by you";

/**
 * Whether a report is a cancelled run as the product describes it: `stopped` is set, every approved scenario has a result,
 * and each scenario that did not finish is skipped with the stopped note (never passed, failed or errored).
 */
export function stoppedRunProblems(report) {
  const problems = [];
  if (report?.stopped !== true) problems.push("the report is not marked stopped");
  const results = report?.results ?? [];
  const stopped = results.filter((result) => result.status === "skipped" && String(result.notes ?? "").startsWith(STOPPED_NOTE));
  if (stopped.length === 0) problems.push(`no scenario is recorded as skipped with "${STOPPED_NOTE}"`);
  const resultIds = new Set(results.map((result) => result.scenarioId));
  const missing = (report?.approved ?? []).filter((id) => !resultIds.has(id));
  if (missing.length > 0) problems.push(`approved scenarios with no result: ${missing.join(", ")}`);
  const wrong = results.filter((result) => String(result.notes ?? "").startsWith(STOPPED_NOTE) && result.status !== "skipped");
  if (wrong.length > 0) problems.push(`scenarios with the stopped note that are not skipped: ${wrong.map((result) => result.scenarioId).join(", ")}`);
  return { problems, stopped: stopped.map((result) => result.scenarioId) };
}

/** What a finished run's report says, for the evidence (counts only, no page content). */
export function reportDigest(report) {
  return {
    runId: report?.runId ?? null,
    runHoundVersion: report?.runHoundVersion ?? null,
    browser: report?.browser ?? null,
    stopped: report?.stopped === true,
    summary: report?.summary ?? null,
    confirmedFindings: confirmedFindings(report).length,
    advisoryFindings: (report?.findings ?? []).length - confirmedFindings(report).length,
    scenariosApproved: (report?.approved ?? []).length,
    pagesVisited: (report?.pagesVisited ?? []).length,
    durationMs: report?.durationMs ?? null,
  };
}

/** The document first-run-check.mjs writes as first-run.json. */
export function buildEvidence(facts, steps) {
  return { schema: 1, ...facts, ok: steps.length > 0 && steps.every((step) => step.ok), steps };
}

const cell = (text) => String(text).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

/** The job summary: one table row per step, then the facts a reader needs to find the evidence. */
export function summaryMarkdown(evidence) {
  const seconds = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`);
  const lines = [
    `### First run: ${evidence.artifact || evidence.executable} (${evidence.platform} ${evidence.arch})`,
    "",
    `Run Hound ${evidence.appVersion ?? "(version unknown)"}: **${evidence.ok ? "all steps passed" : "FAILED"}**`,
    ...(evidence.installer ? ["", `Installer \`${evidence.artifact}\`: ${evidence.installer.bytes} bytes, sha256 \`${evidence.installer.sha256}\``] : []),
    "",
    "| Step | Result | Time | Detail |",
    "| --- | --- | --- | --- |",
    ...evidence.steps.map((step) => `| ${cell(step.name)} | ${step.ok ? "pass" : "**FAIL**"} | ${seconds(step.ms)} | ${cell(step.ok ? step.detail ?? "" : step.error ?? "")} |`),
  ];
  if (evidence.runs) lines.push("", `Runs: completed \`${evidence.runs.completed ?? "-"}\`, stopped \`${evidence.runs.stopped ?? "-"}\``);
  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------------------------------------------------
// first-run-diagnose.mjs: what to look at when the installed app doesn't open (no Playwright involved).
// ---------------------------------------------------------------------------------------------------------------------

/** `fuses` or `direct`, --app, --evidence, and for `direct` --seconds (how long to watch, 25) and --screenshot-at (15). */
export function parseDiagnoseArgs(argv) {
  const [command, ...rest] = argv;
  if (command !== "fuses" && command !== "direct") throw new Error("The first argument is fuses or direct.");
  const out = { command, app: "", evidence: "", seconds: 25, screenshotAt: 15 };
  const takes = new Map([
    ["--app", (v) => (out.app = v)],
    ["--evidence", (v) => (out.evidence = v)],
    ["--seconds", (v) => (out.seconds = Number(v))],
    ["--screenshot-at", (v) => (out.screenshotAt = Number(v))],
  ]);
  for (let i = 0; i < rest.length; i += 2) {
    const set = takes.get(rest[i]);
    const value = rest[i + 1];
    if (!set) throw new Error(`Unknown argument ${rest[i]}.`);
    if (value === undefined || value.startsWith("--")) throw new Error(`${rest[i]} needs a value.`);
    set(value);
  }
  if (!out.app) throw new Error("--app <the installed executable> is required.");
  if (!out.evidence) throw new Error("--evidence <directory> is required.");
  for (const name of ["seconds", "screenshotAt"]) if (!Number.isFinite(out[name]) || out[name] <= 0) throw new Error("--seconds and --screenshot-at must be positive numbers.");
  return out;
}

/**
 * The fuses of an Electron binary as rows. `wire` is what @electron/fuses' getCurrentFuseWire returns ({version, 0: 49, ...}),
 * `optionNames` its FuseV1Options enum (index to name) and `stateNames` its FuseState (48 DISABLE, 49 ENABLE, 114 REMOVED).
 * A fuse this list doesn't name (a newer Electron's) is shown by its index.
 */
export function describeFuses(wire, optionNames, stateNames) {
  const fuses = Object.keys(wire)
    .filter((key) => key !== "version")
    .map(Number)
    .sort((a, b) => a - b)
    .map((index) => ({ index, name: optionNames[index] ?? `fuse ${index}`, state: stateNames[wire[index]] ?? `byte ${wire[index]}` }));
  return { version: wire.version, fuses };
}

/** An exit code as Windows writes it: 2147483651 (or -2147483645) is 0x80000003. */
export function exitCodeHex(code) {
  return typeof code === "number" ? `0x${(code >>> 0).toString(16).toUpperCase().padStart(8, "0")}` : null;
}

/** The fuse table and the direct runs as Markdown, for the job summary. */
export function diagnosticsMarkdown({ fuses, runs }) {
  const lines = [];
  if (fuses) {
    lines.push("### Electron fuses of the installed app", "");
    if (fuses.error) lines.push(`Not read: ${cell(fuses.error)}`);
    else lines.push("| Fuse | State |", "| --- | --- |", ...fuses.fuses.map((fuse) => `| ${cell(fuse.name)} | ${fuse.state} |`));
    lines.push("");
  }
  if (runs) {
    lines.push("### Run directly, without Playwright", "", "| Run | What | Flags | After the wait | Exit | Screenshot |", "| --- | --- | --- | --- | --- | --- |");
    for (const run of runs) {
      const what = cell(run.what ?? "installed app");
      if (run.skipped) {
        lines.push(`| ${cell(run.id)} | ${what} | - | skipped: ${cell(run.skipped)} | - | - |`);
        continue;
      }
      const after = run.running ? `still running after ${run.seconds} s` : "had exited";
      const exit = run.running ? "-" : `${run.exitCode ?? "-"}${run.exitCodeHex ? ` (${run.exitCodeHex})` : ""}${run.signal ? ` ${run.signal}` : ""}`;
      lines.push(`| ${cell(run.id)} | ${what} | ${cell((run.args ?? []).join(" ") || "none")} | ${after} | ${exit} | ${run.screenshot ? cell(run.screenshot) : cell(run.screenshotNote ?? "none")} |`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}
