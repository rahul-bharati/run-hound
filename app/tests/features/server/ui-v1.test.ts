/**
 * V1 in the web UI: the plan shows what was found on the page (forms, controls outside them, the whole page) and a
 * scope chip and "New in V1" tag on scenarios; a report written by 0.1.0 (no page, no scopes) still opens.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve, type ServerType } from "@hono/node-server";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import type { Check, Report } from "../core/types.js";
import { discoverAndPlan, runPlan } from "../engine/runner.js";
import { createApp } from "./app.js";

const PAGE = `<!doctype html><html lang="en"><head><title>Shop</title></head><body>
<header><form role="search" action="/search"><label for="q">Search</label><input id="q" name="q" type="search"><button>Go</button></form>
<button type="button" id="menu">Menu</button></header>
<main><h1>Contact us</h1><form id="contact"><label for="n">Name</label><input id="n" name="name"><label for="m">Message</label><textarea id="m" name="message"></textarea><button>Send</button></form></main>
</body></html>`;

const pass = (id: Check["id"], scope?: "page"): Check => ({
  id,
  title: id,
  category: id === "security-headers" ? "security" : "broken-feature",
  ...(scope ? { scope } : {}),
  plan: () => [{ id: `${id}:s`, checkId: id, title: `Check ${id}`, description: "fake", kind: "golden", priority: "low", destructive: false, defaultSelected: true }],
  run: async (_ctx, s) => ({ checkId: id, scenarioId: s.id, status: "pass", findings: [], durationMs: 5 }),
});
const checks = [pass("dead-control"), pass("security-headers", "page")];

let site: FixtureServer;
let runsDir: string;
let server: ServerType | undefined;
let base: string;
let browser: Browser;
let oldRunId: string;

beforeAll(async () => {
  site = await startFixtureServer({ pages: { "/": PAGE } });
  runsDir = await mkdtemp(join(tmpdir(), "rh-ui-v1-"));

  // A report as 0.1.0 wrote it: no Plan.page, no scenario scopes, no form index.
  const plan = await discoverAndPlan(`${site.url}/`, { checks });
  const { report, dir } = await runPlan(plan, { checks, runsDir, log: () => undefined });
  const old = JSON.parse(await readFile(join(dir, "report.json"), "utf8")) as Report & { plan: Record<string, unknown> };
  delete old.plan.page;
  delete (old.plan.form as { index?: number }).index;
  for (const s of old.plan.scenarios as unknown as Record<string, unknown>[]) {
    delete s.scope;
    delete s.formIndex;
    delete s.scopeLabel;
  }
  old.runHoundVersion = "0.1.0";
  oldRunId = `${report.runId}-old`;
  old.runId = oldRunId;
  await mkdir(join(runsDir, oldRunId, "artifacts"), { recursive: true });
  await writeFile(join(runsDir, oldRunId, "report.json"), JSON.stringify(old));

  const app = createApp({ checks, runsDir, canShowBrowser: false });
  const port = await new Promise<number>((resolve) => {
    server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, (info: AddressInfo) => resolve(info.port));
  });
  base = `http://127.0.0.1:${port}`;
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  await site?.close();
  if (runsDir) await rm(runsDir, { recursive: true, force: true });
});

async function open(hash: string, width = 1280): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(`${base}/${hash}`);
  return { page, errors };
}

describe("V1 web UI", () => {
  it("shows the page inventory, scope chips and New in V1 tags in the plan", async () => {
    const { page, errors } = await open("#/new");
    await page.getByLabel("Page URL").fill(`${site.url}/`);
    await page.getByRole("button", { name: "Plan checks" }).click();
    const inventory = page.getByRole("list", { name: "What Run Hound found on the page" });
    await inventory.waitFor({ state: "visible", timeout: 30_000 });
    const items = await inventory.getByRole("listitem").allInnerTexts();
    expect(items.map((t) => t.replace(/\s+/g, " ").trim())).toEqual([
      "Contact us form 2 fields · 1 button",
      "Search form 1 field · 1 button",
      "Outside the forms 1 control",
      "Whole page headers, cookies, CORS, scripts, layout",
    ]);
    await expect.poll(() => page.locator("#plan-summary").innerText()).toMatch(/Found 2 forms · 3 scenarios/);
    // Two forms: each form scenario names its form; the page scenario says "Whole page" and is new in V1.
    const row = (id: string) => page.locator(`.scenario-row:has(input[value="${id}"])`);
    await expect.poll(() => row("dead-control:s").innerText()).toContain("Contact us form");
    await expect.poll(() => row("dead-control:s@form-2").innerText()).toContain("Search form");
    const pageRow = await row("security-headers:s").innerText();
    expect(pageRow).toContain("Whole page");
    expect(pageRow).toMatch(/new in v1/i);
    expect(await row("dead-control:s").innerText()).not.toMatch(/new in v1/i);
    expect(errors).toEqual([]);
    await page.close();
  });

  it("keeps the inventory inside a 360 px screen", async () => {
    const { page } = await open("#/new", 360);
    await page.getByLabel("Page URL").fill(`${site.url}/`);
    await page.getByRole("button", { name: "Plan checks" }).click();
    await page.getByRole("list", { name: "What Run Hound found on the page" }).waitFor({ state: "visible", timeout: 30_000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.close();
  });

  it("opens a report written by 0.1.0 (no page, no scopes) from the runs list", async () => {
    const { page, errors } = await open("#/runs");
    await page.locator(`#runs-list a[href="#/runs/${oldRunId}"]`).click();
    await page.locator("#report").waitFor({ state: "visible", timeout: 30_000 });
    await expect.poll(() => page.locator("#results").innerText()).toContain("Check dead-control");
    expect(errors).toEqual([]);
    await page.close();
  });
});
