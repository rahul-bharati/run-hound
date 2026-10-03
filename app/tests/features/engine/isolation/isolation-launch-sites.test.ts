// Every browser Run Hound launches, and every context it opens, as they really run (0.6.1, docs/launch-spec.md "0.6.1: isolated by default", items 1 and 2): runner discovery (discoverAndPlan), the run (runPlan) and the sign-in test (server/accounts.ts testSignIn) each launch with browserEnv (none of the planted variables), HOME in a run-hound-browser-* folder under os.tmpdir() with an artifactsDir in it, and the folder is gone once the flow has finished; the contexts are all opened with acceptDownloads: false and a download link clicked in a scenario is refused (Download.failure() is set); chromium.launch and each browser's newContext are spied on so options are read exactly as Run Hound passed them to Playwright.
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { chromium, type BrowserContextOptions, type LaunchOptions } from "playwright";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startAccountsApp, type AccountsApp } from "../../../../test-support/accounts-app.js";
import { startFixtureServer, type FixtureServer } from "../../../../test-support/server.js";
import { accountEnvName } from "../../../../src/config/accounts.js";
import { resolveAccounts } from "../../../../src/operations/accounts-storage.js";
import type { Check, CheckResult, Scenario } from "../../../../src/core/types.js";
import { testSignIn } from "../../../../src/server/accounts.js";
import { discoverAndPlan, runPlan } from "../../../../src/engine/runner.js";

const MARK = `rh-planted-${randomBytes(4).toString("hex")}`;
/** Planted in process.env for the whole file: a developer's shell holds such things. */
const PLANTED: Record<string, string> = {
  AWS_ACCESS_KEY_ID: `${MARK}-key-id`,
  AWS_SECRET_ACCESS_KEY: `${MARK}-aws-secret`,
  RUNHOUND_AI_API_KEY: `${MARK}-ai-key`,
  GITHUB_TOKEN: `${MARK}-gh`,
  HTTPS_PROXY: `http://${MARK}.invalid:3128`,
};

const PAGE = `<!doctype html><html lang="en"><head><title>Export</title></head><body><main><h1>Reports</h1>
<form id="f" aria-label="Search"><label for="q">Search</label><input id="q" name="q"><button type="submit">Search</button></form>
<a id="export" href="/export.csv" download>Export CSV</a>
</main></body></html>`;

interface Launch {
  options: LaunchOptions;
  contexts: BrowserContextOptions[];
}
const launches: Launch[] = [];
const saved: Record<string, string | undefined> = {};
let site: FixtureServer;
let app: AccountsApp;
let runsDir: string;

beforeAll(async () => {
  for (const [name, value] of Object.entries(PLANTED)) {
    saved[name] = process.env[name];
    process.env[name] = value;
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
  app = await startAccountsApp();
  runsDir = await mkdtemp(join(tmpdir(), "rh-launch-sites-runs-"));
  const realLaunch = chromium.launch.bind(chromium);
  vi.spyOn(chromium, "launch").mockImplementation(async (options?: LaunchOptions) => {
    const launch: Launch = { options: options ?? {}, contexts: [] };
    launches.push(launch);
    const browser = await realLaunch(options);
    const realNewContext = browser.newContext.bind(browser);
    vi.spyOn(browser, "newContext").mockImplementation(async (contextOptions?: BrowserContextOptions) => {
      launch.contexts.push(contextOptions ?? {});
      return realNewContext(contextOptions);
    });
    return browser;
  });
});

afterAll(async () => {
  vi.restoreAllMocks();
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await site?.close();
  await app?.stop();
  await rm(runsDir, { recursive: true, force: true });
});

/** The launches a flow made. */
async function launchesOf(flow: () => Promise<unknown>): Promise<Launch[]> {
  const from = launches.length;
  await flow();
  return launches.slice(from);
}

function expectIsolatedLaunch(launch: Launch): void {
  const env = launch.options.env;
  expect(env, "the launch passes an explicit env (without one, Playwright gives Chromium all of process.env)").toBeDefined();
  expect(JSON.stringify(env)).not.toContain(MARK);
  const home = env!.HOME ?? env!.USERPROFILE;
  expect(home).toBeDefined();
  const folder = dirname(home!);
  expect(basename(folder).startsWith("run-hound-browser-"), `HOME is in a run-hound-browser-* folder, not ${home}`).toBe(true);
  expect(dirname(folder)).toBe(tmpdir());
  expect(launch.options.artifactsDir).toBe(join(folder, "artifacts"));
  expect(existsSync(folder), "the per-launch folder is removed once the browser has closed").toBe(false);
}

function expectNoDownloads(launch: Launch): void {
  expect(launch.contexts.length).toBeGreaterThan(0);
  for (const options of launch.contexts) expect(options.acceptDownloads, JSON.stringify(options)).toBe(false);
}

function scenario(id: string): Scenario {
  return { id, checkId: "dead-control", title: "Export", description: "Clicks Export CSV", kind: "golden", priority: "medium", destructive: false, defaultSelected: true, scope: "page" };
}

/** Opens the page, clicks the download link (recording the download's failure) and draws an evidence card. */
function exportCheck(failures: (string | null)[]): Check {
  return {
    id: "dead-control",
    title: "Export check",
    category: "broken-feature",
    scope: "page",
    plan: () => [scenario("export:1")],
    async run(ctx, s): Promise<CheckResult> {
      const { page } = await ctx.openPage();
      const [download] = await Promise.all([page.waitForEvent("download", { timeout: 15_000 }), page.click("#export")]);
      failures.push(await download.failure());
      await ctx.captureCard("export", { title: "GET /export.csv", lines: [{ text: "id,name" }] });
      return { checkId: "dead-control", scenarioId: s.id, status: "pass", findings: [], durationMs: 1 };
    },
  };
}

describe("runner: discovery and the run", () => {
  const failures: (string | null)[] = [];
  let made: Launch[] = [];
  beforeAll(async () => {
    const checks = [exportCheck(failures)];
    made = await launchesOf(async () => {
      const plan = await discoverAndPlan(`${site.url}/`, { checks, runsDir });
      await runPlan(plan, { checks, runsDir });
    });
  });

  it("launches twice (discovery, then the run), each with the isolated environment and its folder removed afterwards", () => {
    expect(made).toHaveLength(2);
    for (const launch of made) expectIsolatedLaunch(launch);
  });

  it("opens every context (discovery, openPage, the evidence renderer) with acceptDownloads: false", () => {
    expect(made).toHaveLength(2);
    // The run opens at least the scenario's page and the evidence renderer.
    expect(made[1]!.contexts.length).toBeGreaterThanOrEqual(2);
    for (const launch of made) expectNoDownloads(launch);
  });

  it("refuses the download a scenario clicks", () => {
    expect(failures).toHaveLength(1);
    expect(failures[0], "Download.failure() is null only for a download that was saved").not.toBeNull();
    expect(failures[0]).toMatch(/acceptDownloads/);
  });
});

describe("runner: signed-in discovery (auth.ts sign-in contexts)", () => {
  let made: Launch[] = [];
  beforeAll(async () => {
    made = await launchesOf(() => discoverAndPlan(`${app.url}/notes`, { checks: [exportCheck([])], signInAs: "a", accounts: app.accountsConfig(), runsDir }));
  });

  it("launches with the isolated environment", () => {
    expect(made).toHaveLength(1);
    expectIsolatedLaunch(made[0]!);
  });

  it("opens the sign-in context and discovery's with acceptDownloads: false", () => {
    // Sign-in's own context, then discovery's.
    expect(made[0]!.contexts.length).toBeGreaterThanOrEqual(2);
    expectNoDownloads(made[0]!);
  });
});

describe("server/accounts.ts: the sign-in test", () => {
  let made: Launch[] = [];
  let ok: boolean | undefined;
  beforeAll(async () => {
    const account = app.accountsConfig().accounts.a;
    const configDir = await mkdtemp(join(tmpdir(), "rh-launch-sites-config-"));
    try {
      const resolved = await resolveAccounts({
        env: {
          RUNHOUND_CONFIG_DIR: configDir,
          [accountEnvName("a", "loginUrl")]: account.loginUrl,
          [accountEnvName("a", "username")]: account.username,
          [accountEnvName("a", "password")]: account.password!,
        },
      });
      made = await launchesOf(async () => {
        ok = (await testSignIn("a", resolved, { allowedHosts: [] })).ok;
      });
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("signs in (the flow really ran)", () => {
    expect(ok).toBe(true);
  });

  it("launches with the isolated environment and opens its sign-in context with acceptDownloads: false", () => {
    expect(made).toHaveLength(1);
    expectIsolatedLaunch(made[0]!);
    expectNoDownloads(made[0]!);
  });
});
