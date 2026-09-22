import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import type { Check, CheckResult, Scenario } from "../src/core/types.js";
import { createCheckContext } from "../src/engine/context.js";
import { discoverForm } from "../src/engine/discover.js";

let browser: Browser | undefined;

/** One shared headless Chromium per test file. Call closeBrowser() in afterAll. */
export async function getBrowser(): Promise<Browser> {
  browser ??= await chromium.launch();
  return browser;
}

export async function closeBrowser() {
  await browser?.close();
  browser = undefined;
}

/**
 * Discovers the form at `url`, asks the check for its plan, and runs every scenario it proposes
 * (or only `scenarioId`). Returns the plan and results. Artifacts go to a temp dir that is removed after.
 */
export async function runCheck(
  check: Check,
  url: string,
  options: { scenarioId?: string; allowDestructive?: boolean } = {},
): Promise<{ scenarios: Scenario[]; results: CheckResult[] }> {
  const b = await getBrowser();
  const page = await b.newPage();
  await page.goto(url, { waitUntil: "networkidle" });
  const form = await discoverForm(page);
  await page.close();

  const scenarios = check.plan(form);
  const artifactsDir = await mkdtemp(join(tmpdir(), `rh-${check.id}-`));
  const ctx = createCheckContext({
    browser: b,
    form,
    targetUrl: url,
    artifactsDir,
    allowDestructive: options.allowDestructive ?? false,
    runToken: "t3st",
  });
  try {
    const selected = options.scenarioId ? scenarios.filter((s) => s.id === options.scenarioId) : scenarios;
    const results: CheckResult[] = [];
    for (const scenario of selected) results.push(await check.run(ctx, scenario));
    return { scenarios, results };
  } finally {
    await ctx.dispose();
    await rm(artifactsDir, { recursive: true, force: true });
  }
}

/** Collapses results to "fail" if any scenario failed, else "error"/"pass"/"skipped". */
export function overallStatus(results: CheckResult[]): CheckResult["status"] {
  if (results.some((r) => r.status === "fail")) return "fail";
  if (results.some((r) => r.status === "error")) return "error";
  if (results.length > 0 && results.every((r) => r.status === "skipped")) return "skipped";
  return "pass";
}
