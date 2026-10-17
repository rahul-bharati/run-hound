// D5: the first-run check of an INSTALLED Run Hound desktop app, on a clean machine (a fresh GitHub runner).
//
//   node scripts/first-run-check.mjs --app <installed executable> --evidence <dir> [--artifact <installer file>] [--home <dir> | --real-home]
//   node scripts/first-run-check.mjs --app <installed executable> --evidence <dir> (--home <dir> | --real-home) --after-uninstall
//                                    [--installed-path <what the uninstaller removes>]... [--package-files <dpkg -L / rpm -ql listing>]
//                                    [--wait-seconds 120]
//
// (--artifact: the installer's path, whose name, size and SHA-256 go into the evidence; a bare name is recorded as is.)
// The first form launches the installed app with Playwright's Electron support (`_electron.launch({ executablePath })`) on
// a fresh home, so it is a true first run, and drives it through what a new user does:
//   1 First launch      the window shows, the engine answers, saved keys report how they are protected, nothing imported,
//                       and the app is named Run Hound (executable, Electron's app name and profile folder)
//   2 Model setup       an Anthropic model and a FAKE key are saved; the key is never on disk as plain text
//   3 Representative run  plan a small well-built app (fixtures/samples/spa-fetch) and run it: no confirmed finding
//   4 Cancellation      stop a second run once it has begun: it ends stopped, the unfinished scenarios are skipped
//   5 Restart           close and launch again on the same home: both runs, the AI settings and the key are still there
// and writes first-run.json (the evidence), summary.md (for the job summary), the reports and two window screenshots to
// --evidence (FIRST_RUN_DEBUG=1 also prints a failed step's stack). The second form runs after the platform's uninstaller
// has, and adds two steps to that first-run.json: the app is gone, and the user's data is not.
//
// No call goes to an AI provider (plans are made with ai:false, /api/ai/test is never called) and no key is ever printed.
// The app under test is only the installed artifact; the harness (this file, Playwright, the fixture) comes from the repo.
import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { arch, homedir, release, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  STOPPED_NOTE,
  StepRecorder,
  buildEvidence,
  confirmedFindings,
  cleanMachinePaths,
  expectedDataDirs,
  findPlainText,
  inheritedEnv,
  isolatedEnv,
  leftoverFiles,
  nameProblems,
  parseArgs,
  poll,
  reportDigest,
  stoppedRunProblems,
  summaryMarkdown,
} from "./first-run-lib.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const platform = process.platform;
const MINUTE = 60_000;

// A made-up key (the shape of a real one, never one): the check must never need, or print, a real key.
const FAKE_KEY = "sk-ant-first-run-FAKE-0123456789abcdefghijklmnopqrstuvwxyz";
const MODEL = "claude-sonnet-4-5";

let args;
try {
  args = parseArgs(process.argv.slice(2));
} catch (err) {
  console.error(`first-run-check: ${err.message}`);
  process.exit(2);
}
const evidenceDir = resolve(args.evidence);
mkdirSync(evidenceDir, { recursive: true });

const rec = new StepRecorder({ secrets: [FAKE_KEY] });
const log = (text) => console.log(`first-run-check: ${text}`);

function writeEvidence(facts) {
  const evidence = buildEvidence(facts, rec.steps);
  writeFileSync(join(evidenceDir, "first-run.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  writeFileSync(join(evidenceDir, "summary.md"), summaryMarkdown(evidence));
  console.log(summaryMarkdown(evidence));
  return evidence;
}

/** All regular files under a folder, with their bytes (skipping anything over 64 MB: a key is never in one). */
function filesUnder(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((path) => statSync(path).size < 64 * 1024 * 1024)
    .map((path) => ({ path, bytes: readFileSync(path) }));
}

// ---------------------------------------------------------------------------------------------------------------------
// After the uninstaller: the app is gone, the user's data is not.
// ---------------------------------------------------------------------------------------------------------------------
if (args.afterUninstall) {
  const evidencePath = join(evidenceDir, "first-run.json");
  const facts = JSON.parse(readFileSync(evidencePath, "utf8"));
  const home = args.realHome ? homedir() : resolve(args.home);
  const dirs = facts.dataDirs ?? expectedDataDirs(platform, home, isolatedEnv({}, platform, home));
  const userDataKept = facts.userData ? existsSync(facts.userData) : null; // the Electron profile: recorded, not required
  rec.steps.push(...facts.steps.filter((step) => !step.name.startsWith("Uninstall")));

  await rec.run("Uninstall removed the app", async () => {
    const gone = [args.app, ...args.installedPaths];
    const left = () => gone.filter((path) => existsSync(path));
    // The Windows uninstaller hands over to a copy of itself and returns at once, so give it --wait-seconds.
    await poll(() => (left().length === 0 ? true : undefined), { timeoutMs: args.waitSeconds * 1000, intervalMs: 1000, what: "the uninstall" }).catch(() => {
      throw new Error(`still there after the uninstall: ${left().join(", ")}`);
    });
    return `gone: ${gone.join(", ")}`;
  });

  if (args.packageFiles) {
    await rec.run("Uninstall left none of the package's files", async () => {
      const kind = (path) => {
        try {
          return lstatSync(path).isDirectory() ? "dir" : "file";
        } catch {
          return null;
        }
      };
      const left = leftoverFiles(readFileSync(args.packageFiles, "utf8"), kind);
      assert.deepEqual(left, [], `the package manager left ${left.length} of its files: ${left.slice(0, 5).join(", ")}`);
      return `none of ${readFileSync(args.packageFiles, "utf8").split("\n").filter(Boolean).length} listed paths is left`;
    });
  }

  await rec.run("Uninstall kept your data", async () => {
    for (const dir of [dirs.settings, dirs.runs]) assert.ok(existsSync(dir), `${dir} was removed by the uninstall`);
    for (const file of ["ai.json", "secrets.json"]) assert.ok(existsSync(join(dirs.settings, file)), `${file} is gone from ${dirs.settings}`);
    for (const id of Object.values(facts.runs ?? {}).filter(Boolean)) assert.ok(existsSync(join(dirs.runs, id, "report.json")), `the report of run ${id} is gone`);
    return `kept: ${dirs.settings} and ${dirs.runs}`;
  });

  writeEvidence({ ...facts, uninstall: { app: args.app, removed: [args.app, ...args.installedPaths], dataKept: [dirs.settings, dirs.runs], userDataKept } });
  process.exit(rec.ok ? 0 : 1);
}

// ---------------------------------------------------------------------------------------------------------------------
// The first run.
// ---------------------------------------------------------------------------------------------------------------------
const appPath = resolve(args.app);
if (!existsSync(appPath)) {
  console.error(`first-run-check: ${appPath} does not exist; --app is the installed executable.`);
  process.exit(2);
}
// --real-home (macOS and Windows on a fresh runner): the machine's own home, asserted to hold no Run Hound data. A fresh HOME on
// macOS has no login keychain, so the first safeStorage access shows a "Keychain Not Found" system dialog before the window.
const ownsHome = !args.home && !args.realHome;
const home = args.realHome ? homedir() : args.home ? resolve(args.home) : mkdtempSync(join(tmpdir(), "run-hound-first-run-"));
mkdirSync(home, { recursive: true });
const env = args.realHome ? inheritedEnv(process.env) : isolatedEnv(process.env, platform, home);
const dirs = expectedDataDirs(platform, home, env);

const artifactBytes = args.artifact && existsSync(args.artifact) ? readFileSync(args.artifact) : null;
const facts = {
  artifact: args.artifact ? basename(args.artifact) : null,
  installer: artifactBytes ? { bytes: artifactBytes.length, sha256: createHash("sha256").update(artifactBytes).digest("hex") } : null,
  executable: appPath,
  platform,
  arch: arch(),
  osRelease: release(),
  appVersion: null,
  appName: null,
  userData: null,
  electron: null,
  chromium: null,
  startedAt: new Date().toISOString(),
  home,
  realHome: args.realHome,
  dataDirs: dirs,
  target: null,
  runs: { completed: null, stopped: null },
  windowShownAfterMs: {},
  secretProtection: null,
  report: null,
  stoppedReport: null,
};

const apps = [];
const pids = new Map();
let fixture;

/** Launch the installed app. On Linux, Playwright adds --no-sandbox itself (the runner has no setuid sandbox). */
async function launch(label) {
  const started = Date.now();
  const app = await electron.launch({ executablePath: appPath, env, timeout: 2 * MINUTE });
  apps.push(app);
  pids.set(app, await app.evaluate(() => process.pid));
  // Playwright's default of 30 s for the first window is short for a cold first launch of an app of this size.
  const page = await app.firstWindow({ timeout: 2 * MINUTE });
  await page.waitForLoadState("domcontentloaded");
  await page.waitForSelector("main#view > *", { timeout: MINUTE });
  facts.windowShownAfterMs[label] = Date.now() - started;
  return { app, page };
}

/** Quit the app the way a user does (Playwright asks it to close); if it hasn't gone after 30 s, kill it. */
async function closeApp(app) {
  const pid = pids.get(app);
  let closed = false;
  app.once("close", () => (closed = true));
  await Promise.race([app.close().catch(() => undefined), new Promise((done) => setTimeout(done, 30_000))]);
  if (!closed && pid) {
    try {
      process.kill(pid);
    } catch {
      // already gone
    }
  }
}

/** A call to the engine's API from the page, with the header the settings routes need: what the UI itself does. */
function api(page, method, path, body = method === "POST" ? {} : undefined, { text = false } = {}) {
  // POST routes only take JSON (a plain POST is refused with 415), so a POST without a body sends {}.
  return page.evaluate(
    async ({ method, path, body, text }) => {
      const res = await fetch(path, {
        method,
        headers: { "x-run-hound": "1", ...(body === undefined ? {} : { "content-type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const raw = await res.text();
      let json = null;
      try {
        json = JSON.parse(raw);
      } catch {
        // not JSON (the HTML report)
      }
      return { status: res.status, json, ...(text ? { text: raw } : {}) };
    },
    { method, path, body, text },
  );
}

const freePort = () =>
  new Promise((done, fail) => {
    const server = createServer();
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => done(port));
    });
  });

async function startFixture() {
  const port = await freePort();
  const child = spawn(process.execPath, [join(repo, "fixtures", "samples", "spa-fetch", "server.mjs")], {
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error("the spa-fetch fixture did not start")), 15_000);
    child.stdout.on("data", (chunk) => {
      if (String(chunk).includes("listening")) {
        clearTimeout(timer);
        done();
      }
    });
    child.once("exit", (code) => fail(new Error(`the spa-fetch fixture exited with ${code}`)));
  });
  return { url: `http://127.0.0.1:${port}/`, stop: () => child.kill() };
}

/** Plan the fixture without AI (a configured model would otherwise be called: a network call to the provider). */
async function planTarget(page) {
  const reply = await api(page, "POST", "/api/plan", { url: facts.target, ai: false });
  assert.equal(reply.status, 200, `POST /api/plan answered ${reply.status}: ${JSON.stringify(reply.json)}`);
  assert.equal(typeof reply.json.planId, "string", "the plan has no planId");
  const scenarios = reply.json.plan?.scenarios ?? [];
  assert.ok(scenarios.length > 0, "the plan has no scenarios");
  return { planId: reply.json.planId, scenarios };
}

const startRun = async (page, planId, approved) => {
  const reply = await api(page, "POST", "/api/runs", { planId, approved });
  assert.equal(reply.status, 202, `POST /api/runs answered ${reply.status}: ${JSON.stringify(reply.json)}`);
  return reply.json.runId;
};

/** Wait until the run is no longer running, and return its status view. */
const finished = (page, runId, timeoutMs) =>
  poll(
    async () => {
      const reply = await api(page, "GET", `/api/runs/${runId}`);
      assert.equal(reply.status, 200, `GET /api/runs/${runId} answered ${reply.status}`);
      return reply.json.status === "running" ? undefined : reply.json;
    },
    { timeoutMs, intervalMs: 500, what: `run ${runId} to finish` },
  );

async function reportOf(page, runId) {
  const reply = await api(page, "GET", `/api/runs/${runId}/report.json`, undefined, { text: true });
  assert.equal(reply.status, 200, `report.json of run ${runId} answered ${reply.status}`);
  return { report: reply.json, text: reply.text };
}

let session;
try {
  fixture = await startFixture();
  facts.target = fixture.url;
  log(`${appPath} on a fresh home ${home}; target ${facts.target}`);

  // 1 ---------------------------------------------------------------------------------------------------------------
  await rec.run("First launch", async () => {
    if (args.realHome) {
      const present = cleanMachinePaths(platform, home, env).filter((path) => existsSync(path));
      assert.ok(present.length === 0, `this is not a clean machine: Run Hound data is already at ${present.join(", ")}`);
    }
    session = await launch("first");
    const { app, page } = session;
    assert.match(page.url(), /^http:\/\/127\.0\.0\.1:\d+\//, `the window shows ${page.url()}, not the engine on loopback`);
    assert.match(await page.title(), /Run Hound/);
    [facts.appVersion, facts.appName, facts.userData, facts.electron, facts.chromium] = await app.evaluate(({ app }) => [app.getVersion(), app.getName(), app.getPath("userData"), process.versions.electron, process.versions.chrome]);
    assert.match(facts.appVersion, /^\d+\.\d+\.\d+/, `the app version is ${facts.appVersion}`);
    const named = nameProblems({ platform, executable: appPath, appName: facts.appName, userData: facts.userData });
    assert.deepEqual(named, [], named.join("; "));
    await page.screenshot({ path: join(evidenceDir, "window-first-launch.png") });

    const runs = await api(page, "GET", "/api/runs");
    assert.equal(runs.status, 200, "the engine's /api/runs did not answer 200");
    assert.deepEqual(runs.json.runs, [], "a first run already lists runs");
    const ai = await api(page, "GET", "/api/ai");
    assert.equal(ai.status, 200, `GET /api/ai answered ${ai.status}`);
    facts.secretProtection = ai.json.secretProtection;
    assert.ok(["os-keychain", "run-hound"].includes(facts.secretProtection), `secretProtection was ${JSON.stringify(facts.secretProtection)}`);
    assert.equal(ai.json.hasKey, false, "a first run already has a key");
    assert.deepEqual(ai.json.savedKeys ?? [], [], "a first run already has saved keys");
    assert.equal(ai.json.file.startsWith(dirs.settings), true, `settings are at ${ai.json.file}, not in ${dirs.settings} (docs/desktop-install.md)`);
    // The first launch always writes the marker (even when the command line saved nothing); it must say nothing was imported.
    const marker = join(dirs.settings, "imported-from-cli.json");
    if (existsSync(marker)) {
      const { from, files, secrets } = JSON.parse(readFileSync(marker, "utf8"));
      assert.deepEqual([from, files, secrets], [null, [], 0], `the first launch imported settings on a clean home: ${readFileSync(marker, "utf8")}`);
    }
    return `Run Hound ${facts.appVersion}, Electron ${facts.electron}, Chromium ${facts.chromium}; window after ${(facts.windowShownAfterMs.first / 1000).toFixed(1)} s; keys: ${facts.secretProtection}`;
  });

  // 2 ---------------------------------------------------------------------------------------------------------------
  await rec.run("Model setup", async () => {
    assert.ok(session, "the app did not launch");
    const { page } = session;
    const put = await api(page, "PUT", "/api/ai", { enabled: true, provider: "anthropic", model: MODEL, apiKey: FAKE_KEY, allowRemote: true });
    assert.equal(put.status, 200, `PUT /api/ai answered ${put.status}: ${JSON.stringify(put.json)}`);
    assert.ok(!JSON.stringify(put.json).includes(FAKE_KEY), "PUT /api/ai echoed the key");
    const ai = await api(page, "GET", "/api/ai");
    assert.ok(!JSON.stringify(ai.json).includes(FAKE_KEY), "GET /api/ai returned the key");
    assert.equal(ai.json.provider, "anthropic");
    assert.equal(ai.json.model, MODEL);
    assert.equal(ai.json.allowRemote, true);
    assert.equal(ai.json.hasKey, true, "hasKey is false after saving a key");
    assert.ok((ai.json.savedKeys ?? []).includes("anthropic"), `savedKeys is ${JSON.stringify(ai.json.savedKeys)}`);
    assert.ok(existsSync(join(dirs.settings, "secrets.json")), `no secrets.json in ${dirs.settings}`);
    const files = [...filesUnder(dirs.settings), ...filesUnder(dirs.runs)];
    const leaks = findPlainText(files, FAKE_KEY);
    assert.deepEqual(leaks, [], `these files hold the key in plain text: ${leaks.join(", ")}`);
    return `${ai.json.provider}/${ai.json.model} with a saved key (${facts.secretProtection}); ${files.length} files checked, none holds it`;
  });

  // 3 ---------------------------------------------------------------------------------------------------------------
  await rec.run("Representative URL run", async () => {
    assert.ok(session, "the app did not launch");
    const { page } = session;
    const { planId, scenarios } = await planTarget(page);
    const approved = scenarios.filter((s) => s.defaultSelected && !s.destructive).map((s) => s.id);
    assert.ok(approved.length > 0, "the plan selects no scenario by default");
    const runId = await startRun(page, planId, approved);
    facts.runs.completed = runId;
    const view = await finished(page, runId, 12 * MINUTE);
    assert.equal(view.status, "done", `the run ended ${view.status}: ${view.error ?? ""}`);
    const { report, text } = await reportOf(page, runId);
    writeFileSync(join(evidenceDir, "report.json"), text);
    const html = await api(page, "GET", `/api/runs/${runId}/report.html`, undefined, { text: true });
    assert.equal(html.status, 200, `report.html answered ${html.status}`);
    writeFileSync(join(evidenceDir, "report.html"), html.text);
    facts.report = reportDigest(report);
    assert.equal(report.runHoundVersion, facts.appVersion, `the report says Run Hound ${report.runHoundVersion}, the app is ${facts.appVersion}`);
    assert.equal(report.stopped === true, false, "an uninterrupted run is marked stopped");
    assert.equal(report.summary.errored, 0, `${report.summary.errored} scenarios errored`);
    assert.ok((report.pagesVisited ?? []).length > 0, "the run visited no page");
    const confirmed = confirmedFindings(report);
    assert.equal(confirmed.length, 0, `spa-fetch is built correctly, so these confirmed findings are false positives: ${confirmed.map((f) => f.title ?? f.id).join("; ")}`);
    return `run ${runId}: ${approved.length} scenarios in ${Math.round((report.durationMs ?? 0) / 1000)} s, ${report.summary.passed} passed, ${report.summary.skipped} skipped, 0 confirmed findings`;
  });

  // 4 ---------------------------------------------------------------------------------------------------------------
  await rec.run("Cancellation", async () => {
    assert.ok(session, "the app did not launch");
    const { page } = session;
    // Every scenario that may run without the destructive opt-in, so the run has plenty left when it is stopped.
    const { planId, scenarios } = await planTarget(page);
    const approved = scenarios.filter((s) => !s.destructive).map((s) => s.id);
    const runId = await startRun(page, planId, approved);
    facts.runs.stopped = runId;
    // "Shortly after it begins": once the first scenario has finished, so the report keeps what ran as well as what didn't.
    await poll(
      async () => {
        const reply = await api(page, "GET", `/api/runs/${runId}`);
        assert.equal(reply.status, 200, `GET /api/runs/${runId} answered ${reply.status}`);
        assert.equal(reply.json.status, "running", `the run was already ${reply.json.status} before it could be stopped`);
        return reply.json.completed >= 1 ? true : undefined;
      },
      { timeoutMs: 3 * MINUTE, intervalMs: 100, what: `run ${runId} to finish its first scenario` },
    );
    const stop = await api(page, "POST", `/api/runs/${runId}/stop`);
    assert.equal(stop.status, 202, `POST /api/runs/${runId}/stop answered ${stop.status}: ${JSON.stringify(stop.json)}`);
    const view = await finished(page, runId, 3 * MINUTE);
    assert.equal(view.status, "done", `the stopped run ended ${view.status}: ${view.error ?? ""}`);
    const { report, text } = await reportOf(page, runId);
    writeFileSync(join(evidenceDir, "report-stopped.json"), text);
    facts.stoppedReport = reportDigest(report);
    const { problems, stopped } = stoppedRunProblems(report);
    assert.deepEqual(problems, [], `the stopped run's report: ${problems.join("; ")}`);
    return `run ${runId} stopped with ${approved.length - stopped.length} of ${approved.length} scenarios finished; ${stopped.length} recorded as skipped ("${STOPPED_NOTE}")`;
  });

  // 5 ---------------------------------------------------------------------------------------------------------------
  await rec.run("Restart", async () => {
    assert.ok(session, "the app did not launch");
    await closeApp(session.app);
    session = await launch("restart");
    const { page } = session;
    const runs = await api(page, "GET", "/api/runs");
    assert.equal(runs.status, 200);
    const listed = new Map(runs.json.runs.map((run) => [run.runId, run]));
    for (const [what, id] of Object.entries(facts.runs)) {
      assert.ok(id, `no ${what} run to look for`);
      assert.ok(listed.has(id), `the ${what} run ${id} is not listed after the restart (${[...listed.keys()].join(", ") || "no runs"})`);
      assert.ok(existsSync(join(dirs.runs, id, "report.json")), `${join(dirs.runs, id, "report.json")} is missing`);
      const again = await reportOf(page, id);
      assert.equal(again.report.runId, id, `the report served for ${id} is run ${again.report.runId}`);
    }
    assert.equal((await reportOf(page, facts.runs.completed)).report.stopped === true, false, "the completed run reads back as stopped");
    const ai = await api(page, "GET", "/api/ai");
    assert.equal(ai.json.provider, "anthropic", `the provider is ${ai.json.provider} after the restart`);
    assert.equal(ai.json.model, MODEL);
    assert.equal(ai.json.allowRemote, true);
    assert.equal(ai.json.hasKey, true, "the saved key can't be read after the restart");
    assert.ok((ai.json.savedKeys ?? []).includes("anthropic"));
    assert.equal(ai.json.secretProtection, facts.secretProtection);
    assert.ok(!JSON.stringify(ai.json).includes(FAKE_KEY), "GET /api/ai returned the key");
    // The Runs list, as the user sees it after a restart (the screenshot is evidence only, so a UI change can't fail the check).
    await page.locator("#sidebar").getByText("Runs", { exact: true }).first().click({ timeout: 5000 }).catch(() => undefined);
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(evidenceDir, "window-after-restart.png") });
    return `${listed.size} runs listed, AI settings and the saved key intact`;
  });
} catch (err) {
  // Setup failed before a step could record it (the fixture, the evidence folder).
  await rec.run("Setup", () => {
    throw err;
  });
} finally {
  for (const app of apps) await closeApp(app).catch(() => undefined);
  fixture?.stop();
}

facts.finishedAt = new Date().toISOString();
const evidence = writeEvidence(facts);
if (ownsHome) rmSync(home, { recursive: true, force: true });
process.exit(evidence.ok ? 0 : 1);
