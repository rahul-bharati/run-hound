// Footprint contract (0.6.1, docs/launch-spec.md "The footprint contract test"): a real run, discovery then one scenario in headless Chromium against a local fixture page, with HOME, the XDG folders and TMPDIR (TEMP/TMP and USERPROFILE on Windows) pointed at empty sentinel folders and secrets planted in the environment; proves nothing is written outside the runs/config folders (HOME, XDG_* and the temp folder are as empty afterwards as before); no Playwright temp profile, artifacts folder or run-hound-browser-* folder is left behind; Chromium's environment carries no planted secret (HOME in it is the per-launch folder, not the sentinel home); the scenario's download was refused and the report was written under the runs folder; sentinels are set before the run and restored after it; Playwright's browser cache was located when the module loaded so moving HOME does not hide the installed browsers. macOS and Windows (0.6.3 risk): the checks only prove nothing lands where the environment points; on macOS Chromium's per-user folders (Library/Application Support, Library/Caches, Library/Saved Application State) likely honour CFFIXED_USER_HOME not HOME; on Windows the Known Folder APIs are likely used (only TEMP/TMP confirmed env-driven); gated to the real OS.
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { platform as osPlatform, tmpdir, userInfo } from "node:os";
import { basename, dirname, join } from "node:path";
import { chromium, type LaunchOptions } from "playwright";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startFixtureServer, type FixtureServer } from "../../../../test-support/server.js";
import type { Check, CheckResult } from "../../../../src/core/types.js";
import { discoverAndPlan, runPlan } from "../../../../src/engine/runner.js";

/** Chromium- or Playwright-named, the only kind a leak here would create. */
const BROWSER_NAMED = /chromium|playwright|run-hound/i;

/** Top-level entries of `dir` matching BROWSER_NAMED; [] for a missing folder (real user folders may not have one). */
async function browserNamedEntries(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  return (await readdir(dir)).filter((e) => BROWSER_NAMED.test(e)).sort();
}

/** The real, untouched OS-resolved per-user folders this platform's Chromium likely uses, outside what the sentinel env points at (macOS Library folders under the real home via password database, Windows APPDATA/LOCALAPPDATA which `browserEnv` sets per-launch). */
function realOsFolders(): string[] {
  if (osPlatform() === "darwin") {
    const home = userInfo().homedir;
    return ["Library/Application Support", "Library/Caches", "Library/Saved Application State"].map((p) => join(home, ...p.split("/")));
  }
  if (osPlatform() === "win32") {
    return [process.env.LOCALAPPDATA, process.env.APPDATA].filter((v): v is string => Boolean(v));
  }
  return [];
}

const MARK = `rh-planted-${randomBytes(6).toString("hex")}`;
/** Secrets and settings a developer's shell may hold; none may reach the browser. */
const PLANTED: Record<string, string> = {
  AWS_ACCESS_KEY_ID: `${MARK}-key-id`,
  AWS_SECRET_ACCESS_KEY: `${MARK}-aws-secret`,
  AWS_SESSION_TOKEN: `${MARK}-aws-token`,
  RUNHOUND_AI_API_KEY: `${MARK}-ai-key`,
  GITHUB_TOKEN: `${MARK}-gh`,
  HTTPS_PROXY: `http://${MARK}.invalid:3128`,
};

const SENTINELS = ["home", "xdg-config", "xdg-cache", "xdg-data", "xdg-state", "tmp", "config", "runs"] as const;
type Sentinel = (typeof SENTINELS)[number];

const PAGE = `<!doctype html><html lang="en"><head><title>Footprint</title></head><body><main><h1>Pets</h1>
<form id="f" aria-label="Add a pet"><label for="n">Name</label><input id="n" name="name"><button type="submit">Add</button></form>
<a id="export" href="/export.csv" download>Export CSV</a>
</main></body></html>`;

let root: string;
const at: Record<Sentinel, string> = {} as Record<Sentinel, string>;
const saved: Record<string, string | undefined> = {};
let site: FixtureServer;
const launched: LaunchOptions[] = [];
const failures: (string | null)[] = [];
let runDir = "";
/** realOsFolders(), before and after the run: browserNamedEntries() of each, keyed by its own path. darwin/win32 only. */
const realFoldersBefore: Record<string, string[]> = {};
const realFoldersAfter: Record<string, string[]> = {};

/** Every path under `dir`, relative to it; [] for an empty folder. */
async function contents(dir: string): Promise<string[]> {
  return (await readdir(dir, { recursive: true })).map(String).sort();
}

function setEnv(name: string, value: string): void {
  if (!(name in saved)) saved[name] = process.env[name];
  process.env[name] = value;
}

const footprintCheck: Check = {
  id: "dead-control",
  title: "Footprint check",
  category: "broken-feature",
  scope: "page",
  plan: () => [{ id: "footprint:1", checkId: "dead-control", title: "Footprint", description: "Opens the page, exports, draws evidence", kind: "golden", priority: "medium", destructive: false, defaultSelected: true, scope: "page" }],
  async run(ctx, s): Promise<CheckResult> {
    const { page } = await ctx.openPage();
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 15_000 }), page.click("#export")]);
    failures.push(await download.failure());
    const frame = await ctx.capture(page, "the page");
    const card = await ctx.captureCard("export", { title: "GET /export.csv", lines: [{ text: "id,name" }] });
    ctx.log("footprint scenario done");
    return { checkId: "dead-control", scenarioId: s.id, status: "pass", findings: [], durationMs: 1, notes: `${frame.path} ${card.path}` };
  },
};

beforeAll(async () => {
  // Made under the real temp folder, before TMPDIR moves.
  root = await mkdtemp(join(tmpdir(), "rh-footprint-"));
  for (const name of SENTINELS) {
    at[name] = join(root, name);
    await mkdir(at[name]);
  }
  site = await startFixtureServer({
    pages: { "/": PAGE },
    routes: {
      "GET /export.csv": (_req, res) => {
        res.writeHead(200, { "content-type": "text/csv", "content-disposition": 'attachment; filename="export.csv"' });
        res.end("id,name\n1,Rex\n");
      },
    },
  });
  const realLaunch = chromium.launch.bind(chromium);
  vi.spyOn(chromium, "launch").mockImplementation(async (options?: LaunchOptions) => {
    launched.push(options ?? {});
    return realLaunch(options);
  });

  setEnv("HOME", at.home);
  setEnv("USERPROFILE", at.home);
  setEnv("XDG_CONFIG_HOME", at["xdg-config"]);
  setEnv("XDG_CACHE_HOME", at["xdg-cache"]);
  setEnv("XDG_DATA_HOME", at["xdg-data"]);
  setEnv("XDG_STATE_HOME", at["xdg-state"]);
  setEnv("TMPDIR", at.tmp);
  setEnv("TMP", at.tmp);
  setEnv("TEMP", at.tmp);
  setEnv("RUNHOUND_CONFIG_DIR", at.config);
  for (const [name, value] of Object.entries(PLANTED)) setEnv(name, value);

  try {
    // Node reads TMPDIR (TEMP/TMP on Windows) on every call: Playwright's temp folders land in the sentinel.
    expect(tmpdir()).toBe(at.tmp);
    for (const dir of realOsFolders()) realFoldersBefore[dir] = await browserNamedEntries(dir);
    const plan = await discoverAndPlan(`${site.url}/`, { checks: [footprintCheck], runsDir: at.runs, log: () => undefined });
    runDir = (await runPlan(plan, { checks: [footprintCheck], runsDir: at.runs, log: () => undefined })).dir;
    for (const dir of realOsFolders()) realFoldersAfter[dir] = await browserNamedEntries(dir);
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    vi.restoreAllMocks();
  }
});

afterAll(async () => {
  await site?.close();
  await rm(root, { recursive: true, force: true });
});

describe("a real run's footprint", () => {
  it("ran: the report is in the runs folder", async () => {
    expect(dirname(runDir)).toBe(at.runs);
    const report = JSON.parse(await readFile(join(runDir, "report.json"), "utf8")) as { results: { status: string }[] };
    expect(report.results.map((r) => r.status)).toEqual(["pass"]);
  });

  it("gave Chromium an explicit environment without any planted secret, with HOME in the per-launch folder", () => {
    expect(launched).toHaveLength(2);
    for (const options of launched) {
      expect(options.env, "without an explicit env, Playwright gives Chromium all of process.env").toBeDefined();
      expect(JSON.stringify(options.env)).not.toContain(MARK);
      const home = options.env!.HOME ?? options.env!.USERPROFILE!;
      expect(home.startsWith(at.home), "HOME is not the user's home").toBe(false);
      expect(basename(dirname(home)).startsWith("run-hound-browser-")).toBe(true);
      expect(dirname(dirname(home))).toBe(at.tmp);
    }
  });

  it("wrote nothing to HOME or to the XDG config, cache, data and state folders", async () => {
    expect({
      home: await contents(at.home),
      "xdg-config": await contents(at["xdg-config"]),
      "xdg-cache": await contents(at["xdg-cache"]),
      "xdg-data": await contents(at["xdg-data"]),
      "xdg-state": await contents(at["xdg-state"]),
    }).toEqual({ home: [], "xdg-config": [], "xdg-cache": [], "xdg-data": [], "xdg-state": [] });
  });

  it("left nothing in the temp folder: no Playwright profile or artifacts folder, no run-hound-browser-* folder", async () => {
    expect(await contents(at.tmp)).toEqual([]);
  });

  it("created nothing beside the sentinel folders", async () => {
    expect((await readdir(root)).sort()).toEqual([...SENTINELS].sort());
    expect(existsSync(join(at.runs, basename(runDir), "report.json"))).toBe(true);
  });

  it("refused the scenario's download", () => {
    expect(failures).toHaveLength(1);
    expect(failures[0]).not.toBeNull();
  });

  // 0.6.3 risk, not yet run: gated to the real OS, so this only executes once CI reaches macOS or Windows. It proves
  // the CFFIXED_USER_HOME/APPDATA/LOCALAPPDATA assumption, not merely the env variables browserEnv sets.
  it.runIf(osPlatform() === "darwin" || osPlatform() === "win32")(
    "left no new Chromium- or Playwright-named entry in the real, OS-resolved per-user folders (not just where the sentinel env points)",
    () => {
      const dirs = realOsFolders();
      expect(dirs.length, "darwin or win32 names at least one folder to check").toBeGreaterThan(0);
      for (const dir of dirs) expect(realFoldersAfter[dir], dir).toEqual(realFoldersBefore[dir] ?? []);
    },
  );
});
