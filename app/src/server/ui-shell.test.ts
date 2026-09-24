import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve, type ServerType } from "@hono/node-server";
import type { Hono } from "hono";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import type { Category, Check, CheckId, Finding, Scenario } from "../core/types.js";
import { RUN_HOUND_VERSION } from "../engine/runner.js";
import { createApp } from "./app.js";
import { renderUi } from "./ui/index.js";

/**
 * The app shell UI (docs/app-ui-spec.md, mockups site/assets/mockups/mockup-1.png and mockup-2.png), driven in real
 * Chromium against createApp served on a random port.
 *
 * DOM contract, beyond what src/server/ui/index.ts already lists:
 * - #/new: the plan's scenario checkboxes carry the scenario id as `value`; one labelled "Select all <Group>"
 *   checkbox per group (accessible name contains "select all" and the group label). The option checkboxes are
 *   labelled "Allow destructive scenarios" and "Show the browser window". The start button's name is
 *   "Start run (N scenarios)" and follows the selection.
 * - Running view (#running): every scenario row in #scenario-list carries `data-scenario-id` and `data-status`
 *   ("queued" | "running" | "pass" | "fail" | "error" | "skipped") and its visible text starts with its 1-based number.
 *   #address shows the page URL (text or input value). #activity holds one <li> per logged step, each starting with
 *   an hh:mm:ss time, plus a "<n> steps" count.
 * - Report view (#report): result rows live in #results, each with `data-scenario-id`; the selected row has
 *   aria-current="true"; rows filtered out by a tab are hidden. #detail is made of <section>s, each named by a
 *   heading ("Reproduction steps", "Key facts", "What to ask your AI", "Generated Playwright test").
 *   Evidence images are served from /api/runs/<id>/artifacts/.
 * - #runs-list: one link per run, href="#/runs/<id>", newest first.
 */

const FORM_PAGE = `<!doctype html><html lang="en"><head><title>Shell fixture</title>
<style>@keyframes spin { to { transform: rotate(360deg); } } .spinner { width: 40px; height: 40px; background: #F5B642; animation: spin 0.5s linear infinite; }</style>
</head><body>
<form id="booking">
  <h1>Book a sitter</h1>
  <label for="petName">Pet name</label><input id="petName" name="petName" required>
  <label for="password">Password</label><input id="password" name="password" type="password">
  <button type="submit">Book</button>
</form>
<div class="spinner"></div><p>Tick <span id="tick">0</span></p>
<script>let n = 0; setInterval(() => { document.getElementById("tick").textContent = String(++n); }, 40);</script>
</body></html>`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function scenario(checkId: CheckId, id: string, title: string): Scenario {
  return { id, checkId, title, description: `What ${title} checks`, kind: "golden", priority: "medium", destructive: false, defaultSelected: true };
}

/** Holds the Features scenario until the test releases it. */
let gate: { promise: Promise<void>; release: () => void; released: boolean };
function newGate() {
  let release!: () => void;
  const g = { promise: new Promise<void>((r) => (release = r)), release: () => {}, released: false };
  g.release = () => {
    g.released = true;
    release();
  };
  return g;
}

const A11Y_SPEC_LINE = "await expect(page.getByLabel('Pet name')).toBeVisible();";
const SEC_SPEC_LINE = "expect(request.url()).not.toContain('password=');";

function finding(checkId: CheckId, category: Category, title: string, extra: Partial<Finding>): Finding {
  return {
    checkId,
    id: `${checkId}#1`,
    title,
    severity: "high",
    category,
    confidence: "confirmed",
    meaning: `Meaning of ${title}`,
    impact: `Impact of ${title}`,
    fix: `Ask your AI to fix ${title}`,
    evidence: [],
    ...extra,
  };
}

// Run order: a11y:axe (fail), a11y:focus (pass), feat:dead (held by the gate, pass), feat:valid (skipped), sec:cred (fail).
const fakeChecks: Check[] = [
  {
    id: "axe-states",
    title: "Fake axe",
    category: "accessibility",
    plan: () => [scenario("axe-states", "a11y:axe", "Pet name is labelled")],
    async run(ctx, s) {
      const { page } = await ctx.openPage();
      ctx.step("Open the booking form", page);
      ctx.step("Inspect the pet name field", page);
      const frame = await ctx.capture(page, "Pet name without a label", {
        step: "Inspect the pet name field",
        highlights: [{ selector: "#petName", label: "No accessible name" }],
        facts: [
          { label: "Accessible name", value: "(none)" },
          { label: "Canary", value: "t3st-canary" },
        ],
      });
      return {
        checkId: "axe-states",
        scenarioId: s.id,
        status: "fail",
        durationMs: 1200,
        findings: [
          finding("axe-states", "accessibility", "Pet name field has no accessible name", {
            location: "#petName",
            evidence: [frame],
            spec: {
              filename: "pet-name-label.spec.ts",
              source: `import { test, expect } from '@playwright/test';\n\ntest('pet name has a label', async ({ page }) => {\n  await page.goto('${ctx.targetUrl}');\n  ${A11Y_SPEC_LINE}\n});\n`,
            },
          }),
        ],
      };
    },
  },
  {
    id: "focus-visible",
    title: "Fake focus",
    category: "accessibility",
    plan: () => [scenario("focus-visible", "a11y:focus", "Focus is visible")],
    async run(ctx, s) {
      ctx.step("Tab through the form");
      return { checkId: "focus-visible", scenarioId: s.id, status: "pass", durationMs: 800, findings: [], notes: "Focus ring visible on every control" };
    },
  },
  {
    id: "dead-control",
    title: "Fake held check",
    category: "broken-feature",
    plan: () => [scenario("dead-control", "feat:dead", "Book button responds")],
    async run(ctx, s) {
      const g = gate;
      const { page } = await ctx.openPage();
      ctx.step("Fill pet name", page);
      await page.fill("#petName", "Rex");
      ctx.step("Click Book", page);
      // Keeps logging while held, so the activity log grows; ends when the gate opens (or after ~2 minutes).
      for (let n = 1; !g.released && n <= 240; n++) {
        ctx.step(`Waiting for the test (${n})`);
        await Promise.race([g.promise, sleep(500)]);
      }
      return { checkId: "dead-control", scenarioId: s.id, status: "pass", durationMs: 900, findings: [] };
    },
  },
  {
    id: "client-only-validation",
    title: "Fake validation",
    category: "validation",
    plan: () => [scenario("client-only-validation", "feat:valid", "Server validates input")],
    async run(_ctx, s) {
      return { checkId: "client-only-validation", scenarioId: s.id, status: "skipped", durationMs: 0, findings: [], notes: "Needs destructive scenarios" };
    },
  },
  {
    id: "credential-fields",
    title: "Fake credentials",
    category: "security",
    plan: () => [scenario("credential-fields", "sec:cred", "Password stays private")],
    async run(ctx, s) {
      const { page } = await ctx.openPage();
      ctx.step("Open the booking form", page);
      ctx.step("Type a password", page);
      await page.fill("#password", "hunter-two");
      const frame = await ctx.capture(page, "Password field", {
        step: "Type a password",
        highlights: [{ selector: "#password", label: "Sent in the URL" }],
        facts: [{ label: "Method", value: "GET" }],
      });
      const card = await ctx.captureCard("Request with the password", {
        title: "GET /book",
        lines: [{ text: "GET /book?petName=Rex&password=[redacted]", mark: true }],
      });
      return {
        checkId: "credential-fields",
        scenarioId: s.id,
        status: "fail",
        durationMs: 1500,
        findings: [
          finding("credential-fields", "security", "Password sent in the URL", {
            location: "#password",
            evidence: [frame, card],
            spec: {
              filename: "password-in-url.spec.ts",
              source: `import { test, expect } from '@playwright/test';\n\ntest('password not in URL', async ({ page }) => {\n  const request = await page.waitForRequest('**/book**');\n  ${SEC_SPEC_LINE}\n});\n`,
            },
          }),
        ],
      };
    },
  },
];

let site: FixtureServer;
let runsDir: string;
let app: Hono;
let server: ServerType | undefined;
let base: string;
let browser: Browser;
const contexts: BrowserContext[] = [];

/** Filled in by the tests, in order. */
let stoppedRunId: string | undefined;
let reportRunId: string | undefined;
let rerunId: string | undefined;

beforeAll(async () => {
  site = await startFixtureServer({ pages: { "/book": FORM_PAGE } });
  runsDir = await mkdtemp(join(tmpdir(), "rh-ui-shell-"));
  // canShowBrowser: true so "Show the browser window" is enabled; no test starts a headed run.
  app = createApp({ checks: fakeChecks, runsDir, canShowBrowser: true });
  const port = await new Promise<number>((resolve) => {
    server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, (info: AddressInfo) => resolve(info.port));
  });
  base = `http://127.0.0.1:${port}`;
  browser = await chromium.launch();
});

afterAll(async () => {
  gate?.release();
  for (const id of [stoppedRunId, reportRunId, rerunId]) if (id) await waitForDone(id).catch(() => {});
  await browser?.close();
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  await site?.close();
  if (runsDir) await rm(runsDir, { recursive: true, force: true });
});

beforeEach(() => {
  gate = newGate();
});

afterEach(async () => {
  gate.release();
  for (const c of contexts.splice(0)) await c.close().catch(() => {});
});

async function openUi(hash = "", viewport = { width: 1280, height: 900 }): Promise<Page> {
  const context = await browser.newContext({ viewport, permissions: ["clipboard-read", "clipboard-write"] });
  contexts.push(context);
  const page = await context.newPage();
  page.on("dialog", (d) => void d.accept());
  await page.goto(`${base}/${hash}`);
  return page;
}

async function until<T>(read: () => Promise<T>, ok: (v: T) => boolean, what: string, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (ok(value)) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}; last value: ${JSON.stringify(value)}`);
    await sleep(100);
  }
}

async function runStatus(runId: string): Promise<{ status: string; report?: { approved: string[]; stopped?: boolean } }> {
  return (await (await app.request(`/api/runs/${runId}`)).json()) as { status: string; report?: { approved: string[]; stopped?: boolean } };
}

const waitForDone = (runId: string) => until(() => runStatus(runId), (s) => s.status !== "running", "the run to finish", 45_000);

const navLink = (page: Page, name: string) => page.locator("#sidebar nav").getByRole("link", { name });
const groupBox = (page: Page, label: string) =>
  page.getByRole("checkbox", { name: new RegExp(`select all.*\\b${label}\\b|\\b${label}\\b.*select all`, "i") });
const scenarioBox = (page: Page, id: string) => page.locator(`#view input[type="checkbox"][value="${id}"]`);
const startButton = (page: Page) => page.getByRole("button", { name: /^Start run/ });

async function planInUi(page: Page): Promise<void> {
  await page.getByLabel("Page URL").fill(`${site.url}/book`);
  await page.getByRole("button", { name: "Plan checks" }).click();
  await startButton(page).waitFor({ state: "visible", timeout: 30_000 });
}

async function currentRunId(page: Page): Promise<string> {
  const hash = await until(() => page.evaluate(() => location.hash), (h) => /^#\/runs\/[\w-]+$/.test(h), "a run id in the address");
  return hash.slice("#/runs/".length);
}

/** Whether an element is inside, or is, a live region. */
async function inLiveRegion(el: Locator): Promise<boolean> {
  return el.evaluate((e) => Boolean(e.closest('[aria-live]:not([aria-live="off"]), [role="status"], [role="alert"], [role="log"], [role="timer"]')));
}

async function imagesLoaded(scope: Locator): Promise<boolean[]> {
  return scope.locator("img").evaluateAll((imgs) =>
    Promise.all(
      (imgs as HTMLImageElement[]).map(
        (i) =>
          new Promise<boolean>((resolve) => {
            if (i.complete) return resolve(i.naturalWidth > 0);
            i.addEventListener("load", () => resolve(i.naturalWidth > 0), { once: true });
            i.addEventListener("error", () => resolve(false), { once: true });
          }),
      ),
    ),
  );
}

async function hasNoSidewaysScroll(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
}

describe("app shell UI", () => {
  it("serves renderUi's document at / and loads nothing but its own origin", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(renderUi({ version: RUN_HOUND_VERSION, canShowBrowser: true }));

    const context = await browser.newContext();
    contexts.push(context);
    const page = await context.newPage();
    const foreign: string[] = [];
    page.on("request", (r) => {
      const url = r.url();
      if (!url.startsWith(base) && !url.startsWith("data:") && !url.startsWith("blob:")) foreign.push(url);
    });
    await page.goto(`${base}/`);
    await page.locator("#stepper").waitFor();
    expect(foreign).toEqual([]);
  });

  it("has a sidebar with nav, a local footer card and hash routing that survives back, forward and reload", async () => {
    const page = await openUi();
    const sidebar = page.locator("aside#sidebar");
    expect(await sidebar.count()).toBe(1);
    expect(await sidebar.innerText()).toMatch(/run hound/i);
    expect(await sidebar.locator("img, svg").count()).toBeGreaterThan(0);
    const footer = await sidebar.innerText();
    expect(footer).toContain("Local · this machine");
    expect(footer).toContain(RUN_HOUND_VERSION);

    const nav = page.locator('#sidebar nav[aria-label="Main"]');
    expect(await nav.count()).toBe(1);
    expect(await navLink(page, "New Run").getAttribute("href")).toBe("#/new");
    expect(await navLink(page, "Runs").getAttribute("href")).toBe("#/runs");
    expect(await navLink(page, "Settings").getAttribute("href")).toBe("#/settings");

    // Default route: New Run.
    await page.locator("#stepper").waitFor();
    expect(await page.evaluate(() => location.hash)).toMatch(/^(#\/new)?$/);
    expect(await navLink(page, "New Run").getAttribute("aria-current")).toBe("page");
    expect(await page.locator("main#view").count()).toBe(1);

    const current = async () => nav.locator('[aria-current="page"]').allTextContents();

    await navLink(page, "Runs").click();
    await page.locator("#runs-list").waitFor();
    expect(await page.evaluate(() => location.hash)).toBe("#/runs");
    expect((await current()).map((t) => t.trim())).toEqual(["Runs"]);
    expect(await page.locator("#stepper").count()).toBe(0);

    await navLink(page, "Settings").click();
    await page.getByLabel("Allow destructive scenarios").waitFor();
    expect(await page.evaluate(() => location.hash)).toBe("#/settings");
    expect((await current()).map((t) => t.trim())).toEqual(["Settings"]);

    await page.goBack();
    await page.locator("#runs-list").waitFor();
    expect((await current()).map((t) => t.trim())).toEqual(["Runs"]);

    await page.goForward();
    await page.getByLabel("Allow destructive scenarios").waitFor();
    expect((await current()).map((t) => t.trim())).toEqual(["Settings"]);

    await page.reload();
    await page.getByLabel("Allow destructive scenarios").waitFor();
    expect(await page.evaluate(() => location.hash)).toBe("#/settings");
    expect((await current()).map((t) => t.trim())).toEqual(["Settings"]);

    // Unknown routes fall back to New Run.
    await page.goto(`${base}/#/nope`);
    await page.locator("#stepper").waitFor();
    expect(await navLink(page, "New Run").getAttribute("aria-current")).toBe("page");
  });

  it("walks Target -> Plan with a stepper and a grouped plan with select-all per group", async () => {
    const page = await openUi("#/new");
    const stepper = page.locator("ol#stepper");
    await stepper.waitFor();
    const steps = stepper.locator("li");
    expect((await steps.allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim())).toEqual([
      expect.stringMatching(/Target/),
      expect.stringMatching(/Plan/),
      expect.stringMatching(/Run/),
      expect.stringMatching(/Report/),
    ]);
    const currentStep = () => stepper.locator('[aria-current="step"]').allInnerTexts();
    expect(await currentStep()).toEqual([expect.stringMatching(/Target/)]);
    expect(await page.locator("#target-form").getByLabel("Page URL").count()).toBe(1);

    // Inline error under the input.
    await page.getByLabel("Page URL").fill("not a url at all ::");
    await page.getByRole("button", { name: "Plan checks" }).click();
    await expect.poll(async () => (await page.locator("#target-form").innerText()).length).toBeGreaterThan("Page URL Plan checks".length + 5);

    await planInUi(page);
    expect(await currentStep()).toEqual([expect.stringMatching(/Plan/)]);
    expect(await page.locator("#view").innerText()).toMatch(/5 scenarios/);

    const headings = page.locator("#view").getByRole("heading", { name: /^(Accessibility|Features|Security)\b/ });
    const names = await headings.allTextContents();
    expect(names).toHaveLength(3);
    expect(names[0]).toMatch(/^\s*Accessibility\b.*\b2\b/s);
    expect(names[1]).toMatch(/^\s*Features\b.*\b2\b/s);
    expect(names[2]).toMatch(/^\s*Security\b.*\b1\b/s);

    for (const label of ["Accessibility", "Features", "Security"]) {
      const all = groupBox(page, label);
      expect(await all.count(), `select all for ${label}`).toBe(1);
      expect(await all.isChecked()).toBe(true);
    }
    expect(await startButton(page).innerText()).toMatch(/Start run \(5 scenarios\)/);

    await groupBox(page, "Accessibility").click();
    expect(await scenarioBox(page, "a11y:axe").isChecked()).toBe(false);
    expect(await scenarioBox(page, "a11y:focus").isChecked()).toBe(false);
    expect(await scenarioBox(page, "feat:dead").isChecked()).toBe(true);
    expect(await startButton(page).innerText()).toMatch(/Start run \(3 scenarios\)/);
    await groupBox(page, "Accessibility").click();
    expect(await startButton(page).innerText()).toMatch(/Start run \(5 scenarios\)/);
    await scenarioBox(page, "feat:valid").click();
    expect(await groupBox(page, "Features").evaluate((i: HTMLInputElement) => i.indeterminate)).toBe(true);

    for (const name of ["Allow destructive scenarios", "Show the browser window"]) {
      const box = page.getByLabel(name);
      expect(await box.count(), name).toBe(1);
      expect(await box.getAttribute("type")).toBe("checkbox");
      expect(await box.isChecked()).toBe(false);
    }
  });

  it("shows the running view (counter, elapsed, browser, numbered list, preview, activity) and Stop run stops it", async () => {
    const page = await openUi("#/new");
    await planInUi(page);
    await startButton(page).click();
    const runId = await currentRunId(page);
    stoppedRunId = runId;

    const running = page.locator("#running");
    await running.waitFor({ state: "visible", timeout: 30_000 });
    expect(await running.innerText()).toContain("Running tests…");
    expect(await running.innerText()).toContain(`${site.url}/book`);

    // Held on the Features scenario, third of five.
    const row = (id: string) => page.locator(`#scenario-list [data-scenario-id="${id}"]`);
    await expect.poll(() => row("feat:dead").getAttribute("data-status"), { timeout: 30_000 }).toBe("running");
    expect(await page.locator("#counter").innerText()).toMatch(/^\s*[23]\s*\/\s*5\s*$/);

    // Numbered list with every scenario and its status.
    expect(await page.locator("ol#scenario-list").count()).toBe(1);
    expect(await page.locator("#scenario-list [data-scenario-id]").count()).toBe(5);
    expect(await row("a11y:axe").getAttribute("data-status")).toBe("fail");
    expect(await row("a11y:focus").getAttribute("data-status")).toBe("pass");
    expect(await row("sec:cred").getAttribute("data-status")).toBe("queued");
    expect((await row("a11y:axe").innerText()).trim()).toMatch(/^1\b/);
    expect((await row("feat:dead").innerText()).trim()).toMatch(/^3\b/);
    // The running scenario is expanded with its live sub-steps.
    await expect.poll(async () => row("feat:dead").innerText()).toContain("Click Book");
    expect(await row("feat:dead").innerText()).toContain("Fill pet name");
    expect(await row("feat:dead").getByText("Fill pet name").first().isVisible()).toBe(true);

    // Elapsed time ticks silently.
    const elapsed = page.locator("#elapsed");
    expect(await inLiveRegion(elapsed)).toBe(false);
    const first = (await elapsed.innerText()).trim();
    expect(first).toMatch(/\d+:\d{2}/);
    await page.waitForTimeout(2200);
    expect((await elapsed.innerText()).trim()).not.toBe(first);

    // The real browser.
    await expect.poll(async () => page.locator("#browser-card").innerText()).toMatch(/Chromium \d+/);

    // Browser preview: the page URL, a Live badge and a real frame.
    const preview = page.locator("#browser-preview");
    const address = await preview.locator("#address").evaluate((e) => ((e as HTMLInputElement).value || e.textContent || "").trim());
    expect(address).toContain(`${site.url}/book`);
    await expect.poll(async () => preview.innerText()).toMatch(/\bLive\b/);
    await expect.poll(async () => (await imagesLoaded(preview)).some(Boolean), { timeout: 15_000 }).toBe(true);

    // Activity log: timestamped, counted, growing.
    const activity = page.locator("#activity");
    const items = activity.locator("li");
    await expect.poll(() => items.count()).toBeGreaterThan(0);
    expect((await items.first().innerText()).trim()).toMatch(/^\d{2}:\d{2}:\d{2}\b/);
    expect(await activity.innerText()).toMatch(/\b\d+ steps?\b/);
    expect(await inLiveRegion(items.first())).toBe(false);
    const before = await items.count();
    await expect.poll(() => items.count(), { timeout: 15_000 }).toBeGreaterThan(before);

    // Stop run, for real: the report says so and the rest is skipped.
    await page.getByRole("button", { name: "Stop run" }).click();
    const report = page.locator("#report");
    await report.waitFor({ state: "visible", timeout: 30_000 });
    expect(await report.getByRole("heading", { name: "Run stopped" }).count()).toBeGreaterThan(0);
    expect(await report.innerText()).toMatch(/\b3 skipped\b/);
    expect(await currentRunId(page)).toBe(runId);
    const status = await waitForDone(runId);
    expect(status.report?.stopped).toBe(true);
  }, 120_000);

  it("shows the report: summary, tabs, rows with thumbnails, detail with evidence, steps, facts and spec; Re-run starts a new run", async () => {
    gate.release();
    const page = await openUi("#/new");
    await planInUi(page);
    await startButton(page).click();
    const runId = await currentRunId(page);
    reportRunId = runId;

    const report = page.locator("#report");
    await report.waitFor({ state: "visible", timeout: 45_000 });
    const text = await report.innerText();
    expect(await report.getByRole("heading", { name: "Test run complete" }).count()).toBeGreaterThan(0);
    expect(text).toContain(`Run ${runId}`);
    expect(text).toMatch(/5 scenarios run/);
    expect(text).toMatch(/2 passed/);
    expect(text).toMatch(/2 with issues/);
    expect(text).toMatch(/1 skipped/);
    expect(await report.getByRole("link", { name: /Open HTML report/ }).getAttribute("href")).toMatch(new RegExp(`/api/runs/${runId}/report\\.html$`));

    // Tabs filter the rows.
    const tab = (name: RegExp) => report.getByRole("tab", { name });
    expect(await tab(/^All \(5\)$/).count()).toBe(1);
    expect(await tab(/^Passed \(2\)$/).count()).toBe(1);
    expect(await tab(/^Issues \(2\)$/).count()).toBe(1);
    expect(await tab(/^Skipped \(1\)$/).count()).toBe(1);
    expect(await tab(/^All/).getAttribute("aria-selected")).toBe("true");
    const visibleRows = () =>
      page.locator("#results [data-scenario-id]").evaluateAll((els) =>
        els.filter((e) => (e as HTMLElement).offsetParent !== null).map((e) => e.getAttribute("data-scenario-id")),
      );
    expect((await visibleRows()).sort()).toEqual(["a11y:axe", "a11y:focus", "feat:dead", "feat:valid", "sec:cred"]);
    await tab(/^Passed/).click();
    expect(await tab(/^Passed/).getAttribute("aria-selected")).toBe("true");
    expect(await tab(/^All/).getAttribute("aria-selected")).toBe("false");
    expect((await visibleRows()).sort()).toEqual(["a11y:focus", "feat:dead"]);
    await tab(/^Issues/).click();
    expect((await visibleRows()).sort()).toEqual(["a11y:axe", "sec:cred"]);
    await tab(/^Skipped/).click();
    expect(await visibleRows()).toEqual(["feat:valid"]);
    await tab(/^All/).click();
    expect(await visibleRows()).toHaveLength(5);

    // Thumbnails for scenarios with image evidence only.
    const resultRow = (id: string) => page.locator(`#results [data-scenario-id="${id}"]`);
    expect(await resultRow("a11y:axe").locator("img").count()).toBeGreaterThan(0);
    expect(await resultRow("sec:cred").locator("img").count()).toBeGreaterThan(0);
    expect(await resultRow("a11y:focus").locator("img").count()).toBe(0);
    expect((await imagesLoaded(resultRow("sec:cred"))).every(Boolean)).toBe(true);

    // The first issue is selected by default.
    const detail = page.locator("#detail");
    expect(await resultRow("a11y:axe").getAttribute("aria-current")).toBe("true");
    expect(await detail.innerText()).toContain("Pet name field has no accessible name");
    const section = (name: string) => detail.locator("section").filter({ has: page.getByRole("heading", { name }) });

    const facts = await section("Key facts").innerText();
    expect(facts).toContain(`${site.url}/book`);
    expect(facts).toContain("#petName");
    expect(facts).toContain("Accessible name");
    expect(facts).toContain("t3st-canary");
    expect(await section("What to ask your AI").innerText()).toContain("Ask your AI to fix Pet name field has no accessible name");

    const steps = await section("Reproduction steps").locator("ol li").allInnerTexts();
    const openAt = steps.findIndex((s) => s.includes("Open the booking form"));
    const inspectAt = steps.findIndex((s) => s.includes("Inspect the pet name field"));
    expect(openAt).toBeGreaterThanOrEqual(0);
    expect(inspectAt).toBeGreaterThan(openAt);

    const spec = section("Generated Playwright test");
    expect(await spec.locator("pre, code").first().innerText()).toContain(A11Y_SPEC_LINE);
    await spec.getByRole("button", { name: /copy/i }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain(A11Y_SPEC_LINE);

    // Selecting another row updates the detail: main image plus a thumbnail strip of both evidence images.
    await resultRow("sec:cred").click();
    await expect.poll(() => detail.innerText()).toContain("Password sent in the URL");
    expect(await resultRow("sec:cred").getAttribute("aria-current")).toBe("true");
    expect(await resultRow("a11y:axe").getAttribute("aria-current")).not.toBe("true");
    const srcs = await detail.locator("img").evaluateAll((imgs) => imgs.map((i) => (i as HTMLImageElement).getAttribute("src") ?? ""));
    expect(srcs.length).toBeGreaterThanOrEqual(3);
    expect(new Set(srcs).size).toBe(2);
    for (const src of srcs) expect(src).toContain(`/api/runs/${runId}/artifacts/`);
    expect((await imagesLoaded(detail)).every(Boolean)).toBe(true);
    const credSteps = await section("Reproduction steps").locator("ol li").allInnerTexts();
    expect(credSteps.findIndex((s) => s.includes("Type a password"))).toBeGreaterThan(credSteps.findIndex((s) => s.includes("Open the booking form")));
    expect(await section("Generated Playwright test").locator("pre, code").first().innerText()).toContain(SEC_SPEC_LINE);

    // A passed scenario shows what was checked, without evidence.
    await resultRow("a11y:focus").click();
    await expect.poll(() => detail.innerText()).toContain("Focus ring visible on every control");
    expect(await detail.locator("img").count()).toBe(0);

    // Re-run: a new run with the same scenarios.
    await report.getByRole("button", { name: /Re-run/ }).click();
    const newId = await until(() => currentRunId(page), (id) => id !== runId, "the re-run's id");
    rerunId = newId;
    await page.locator("#running, #report").first().waitFor({ state: "visible", timeout: 30_000 });
    const rerun = await waitForDone(newId);
    const original = await runStatus(runId);
    expect([...(rerun.report?.approved ?? [])].sort()).toEqual([...(original.report?.approved ?? [])].sort());
  }, 150_000);

  it("lists runs newest first, and opens one from the list", async () => {
    expect(stoppedRunId && reportRunId && rerunId).toBeTruthy();
    const page = await openUi("#/runs");
    const list = page.locator("#runs-list");
    await list.locator(`a[href="#/runs/${reportRunId}"]`).waitFor({ timeout: 15_000 });
    const hrefs = await list.locator('a[href^="#/runs/"]').evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    const at = (id: string) => hrefs.indexOf(`#/runs/${id}`);
    expect(at(rerunId!)).toBeGreaterThanOrEqual(0);
    expect(at(rerunId!)).toBeLessThan(at(reportRunId!));
    expect(at(reportRunId!)).toBeLessThan(at(stoppedRunId!));
    expect(await list.locator(`a[href="#/runs/${reportRunId}"]`).innerText()).toContain(new URL(site.url).host);

    await list.locator(`a[href="#/runs/${reportRunId}"]`).click();
    await page.locator("#report").waitFor({ state: "visible", timeout: 15_000 });
    expect(await page.evaluate(() => location.hash)).toBe(`#/runs/${reportRunId}`);

    // History survives a restart: a new server on the same runs folder lists them from disk.
    const restarted = createApp({ checks: fakeChecks, runsDir, canShowBrowser: true });
    const res = await restarted.request("/api/runs");
    expect(res.status).toBe(200);
    const { runs } = (await res.json()) as { runs: { runId: string }[] };
    expect(runs.map((r) => r.runId)).toEqual(expect.arrayContaining([stoppedRunId, reportRunId, rerunId]));
  });

  it("saves Settings defaults in this browser and pre-fills the plan options with them", async () => {
    const page = await openUi("#/settings");
    const destructive = page.getByLabel("Allow destructive scenarios");
    const headed = page.getByLabel("Show the browser window");
    await destructive.waitFor();
    const view = page.locator("#view");
    await expect.poll(() => view.innerText()).toContain(runsDir);
    expect(await view.innerText()).toContain(RUN_HOUND_VERSION);

    await destructive.check();
    await headed.check();
    const save = page.getByRole("button", { name: /save/i });
    if (await save.count()) await save.first().click();
    await expect.poll(() => page.evaluate(() => Object.keys(localStorage).length)).toBeGreaterThan(0);

    await page.reload();
    await page.getByLabel("Allow destructive scenarios").waitFor();
    expect(await page.getByLabel("Allow destructive scenarios").isChecked()).toBe(true);
    expect(await page.getByLabel("Show the browser window").isChecked()).toBe(true);

    await navLink(page, "New Run").click();
    await planInUi(page);
    expect(await page.getByLabel("Allow destructive scenarios").isChecked()).toBe(true);
    expect(await page.getByLabel("Show the browser window").isChecked()).toBe(true);
  });

  it("works at 360 px: no sideways scrolling, and the sidebar becomes a top bar with a menu button", async () => {
    expect(reportRunId).toBeTruthy();
    const desktop = await openUi("#/new");
    await desktop.locator("#stepper").waitFor();
    expect(await desktop.getByRole("button", { name: /menu/i }).isVisible().catch(() => false)).toBe(false);
    expect(await navLink(desktop, "Runs").isVisible()).toBe(true);

    const page = await openUi("#/new", { width: 360, height: 740 });
    await page.locator("#stepper").waitFor();
    const box = (await page.locator("#sidebar").boundingBox())!;
    expect(box.height).toBeLessThan(120);
    expect(box.width).toBeGreaterThan(300);
    const menu = page.getByRole("button", { name: /menu/i });
    expect(await menu.isVisible()).toBe(true);
    expect(await menu.getAttribute("aria-expanded")).toBe("false");
    expect(await navLink(page, "Runs").isVisible()).toBe(false);
    expect(await hasNoSidewaysScroll(page)).toBe(true);

    await menu.click();
    expect(await menu.getAttribute("aria-expanded")).toBe("true");
    await navLink(page, "Runs").click();
    await page.locator("#runs-list").waitFor();
    expect(await hasNoSidewaysScroll(page)).toBe(true);

    await page.goto(`${base}/#/new`);
    await planInUi(page);
    expect(await hasNoSidewaysScroll(page)).toBe(true);

    await page.goto(`${base}/#/runs/${reportRunId}`);
    await page.locator("#report").waitFor({ state: "visible", timeout: 15_000 });
    await page.locator("#detail").waitFor();
    expect(await hasNoSidewaysScroll(page)).toBe(true);

    await page.goto(`${base}/#/settings`);
    await page.getByLabel("Allow destructive scenarios").waitFor();
    expect(await hasNoSidewaysScroll(page)).toBe(true);
  });
});
