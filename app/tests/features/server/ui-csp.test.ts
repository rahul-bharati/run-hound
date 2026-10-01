/**
 * The web UI and report.html under the server's Content-Security-Policy, in real Chromium against createApp served
 * on a random port: every view (New Run, the plan, the running view, the report with evidence, Runs, Settings) and
 * report.html work with no CSP violation (no blocked inline script, style, style attribute or image), and both refuse
 * to be framed.
 */
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve, type ServerType } from "@hono/node-server";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import type { Check, Scenario } from "../core/types.js";
import { createApp } from "./app.js";

const FORM_PAGE = `<!doctype html><html lang="en"><head><title>CSP fixture</title></head><body>
<form id="booking">
  <h1>Book a sitter</h1>
  <label for="petName">Pet name</label><input id="petName" name="petName" required>
  <button type="submit">Book</button>
</form>
</body></html>`;

const scenario = (id: string, checkId: Scenario["checkId"] = "persistence"): Scenario => ({ id, checkId, title: `Fake ${id}`, description: "fake", kind: "golden", priority: "medium", destructive: false, defaultSelected: true });

/** Holds the second scenario until the test has looked at the running view. */
let release: () => void = () => {};
const gate = new Promise<void>((r) => (release = r));

/**
 * One finding backed by an annotated frame and an exported spec, so the report shows images and links; then a
 * scenario that waits for the gate, so the running view stays on screen.
 */
const checks: Check[] = [
  {
    id: "dead-control",
    title: "Fake gated check",
    category: "broken-feature",
    plan: () => [scenario("dc:gated", "dead-control")],
    async run(ctx, s) {
      const { page } = await ctx.openPage();
      ctx.step("Waiting", page);
      await gate;
      return { checkId: "dead-control", scenarioId: s.id, status: "pass", findings: [], durationMs: 1 };
    },
  },
  {
    id: "persistence",
    title: "Fake evidence check",
    category: "broken-feature",
    plan: () => [scenario("p:evidence")],
    async run(ctx, s) {
      const { page } = await ctx.openPage();
      ctx.step("Checking the pet name", page);
      const frame = await ctx.capture(page, "Pet name after reload", { step: "After reload", highlights: [{ selector: "#petName", label: "Not found" }] });
      return {
        checkId: "persistence",
        scenarioId: s.id,
        status: "fail",
        durationMs: 1,
        findings: [
          {
            checkId: "persistence",
            id: "persistence#1",
            title: "Pet name is not saved",
            severity: "high",
            category: "broken-feature",
            confidence: "confirmed",
            meaning: "m",
            impact: "i",
            fix: "Save the pet name.",
            evidence: [frame],
            spec: { filename: "persistence-1.spec.ts", source: "// fake spec\n" },
          },
        ],
      };
    },
  },
];

let site: FixtureServer;
let runsDir: string;
let server: ServerType;
let base: string;
let browser: Browser;

beforeAll(async () => {
  site = await startFixtureServer({ pages: { "/book": FORM_PAGE } });
  runsDir = await mkdtemp(join(tmpdir(), "rh-ui-csp-"));
  const app = createApp({ checks, runsDir, canShowBrowser: false });
  const port = await new Promise<number>((resolve) => {
    server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, (info: AddressInfo) => resolve(info.port));
  });
  base = `http://127.0.0.1:${port}`;
  browser = await chromium.launch();
});

afterAll(async () => {
  release();
  await browser?.close();
  await new Promise((r) => server?.close(r));
  await site?.close();
  if (runsDir) await rm(runsDir, { recursive: true, force: true });
});

/** A page that records every CSP violation (the event and Chromium's "Refused to …" console errors). */
async function watched(): Promise<{ page: Page; violations: string[]; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const violations: string[] = [];
  const errors: string[] = [];
  await page.exposeFunction("__cspViolation", (v: string) => violations.push(v));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      (window as unknown as { __cspViolation(v: string): void }).__cspViolation(`${e.violatedDirective} ${e.blockedURI} ${e.sample}`);
    });
  });
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
    if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  return { page, violations, errors };
}

describe("the UI under its CSP", () => {
  it("plans, runs and shows the report with evidence, and every other view renders, with no CSP violation", async () => {
    const { page, violations, errors } = await watched();
    await page.goto(`${base}/#/new`);
    // The inline stylesheet applies (the page has its dark background, not the browser default).
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
    await page.getByLabel("Page URL").fill(`${site.url}/book`);
    await page.getByRole("button", { name: "Plan checks" }).click();
    await page.locator("#plan-section").waitFor({ state: "visible" });
    await page.getByRole("button", { name: /Start run/ }).click();
    // The running view: its status rings sit in a display:contents slot (a class, not a style attribute).
    await page.locator("#running").waitFor();
    await page.locator('#scenario-list [data-scenario-id="dc:gated"][data-status="running"]').waitFor({ timeout: 45_000 });
    expect(await page.locator("#scenario-list .ring-slot").first().evaluate((el) => getComputedStyle(el).display)).toBe("contents");
    release();
    await page.getByRole("heading", { name: "Test run complete" }).waitFor({ timeout: 45_000 });
    await page.locator('#results [data-scenario-id="p:evidence"]').click();
    // The evidence frame (an image from /api/runs/<id>/artifacts/) loads.
    const img = page.locator("#detail img").first();
    await img.waitFor();
    await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0)).toBe(true);
    // The explanation paragraphs keep their colour without a style attribute.
    expect(await page.locator("#detail p.fg").count()).toBeGreaterThan(0);

    await page.goto(`${base}/#/runs`);
    await page.locator("#runs-list a.run-row").first().waitFor();
    await page.goto(`${base}/#/settings`);
    await page.getByRole("heading", { name: "Settings" }).waitFor();
    await page.locator(".settings-list code").first().waitFor();
    // The Defaults options sit flush under the heading (a class, not a style attribute).
    expect(await page.locator(".options.flush").evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe("none");

    expect(violations).toEqual([]);
    expect(errors).toEqual([]);
    await page.close();
  }, 90_000);

  it("report.html renders with its styles and images, sandboxed, with no CSP violation", async () => {
    const runs = (await (await fetch(`${base}/api/runs`)).json()) as { runs: { runId: string }[] };
    const runId = runs.runs[0]!.runId;
    const { page, violations } = await watched();
    const res = await page.goto(`${base}/api/runs/${runId}/report.html`);
    expect(res!.status()).toBe(200);
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
    const images = await page.locator("img").evaluateAll((els) => els.map((el) => ({ src: (el as HTMLImageElement).getAttribute("src")!.slice(0, 40), ok: (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0 })));
    expect(images.length).toBeGreaterThan(1);
    for (const i of images) expect(i.ok, i.src).toBe(true);
    // Links to the spec still work.
    await page.locator('a[href^="specs/"]').first().click();
    await expect.poll(() => page.url()).toMatch(/\/specs\/persistence-1\.spec\.ts$/);
    expect(await page.locator("body").innerText()).toContain("// fake spec");
    expect(violations).toEqual([]);
    await page.close();
  });

  it("neither the UI nor report.html can be framed by another page", async () => {
    const runs = (await (await fetch(`${base}/api/runs`)).json()) as { runs: { runId: string }[] };
    const other = await startFixtureServer({
      pages: { "/frame": `<!doctype html><iframe id="ui" src="${base}/"></iframe><iframe id="report" src="${base}/api/runs/${runs.runs[0]!.runId}/report.html"></iframe>` },
    });
    const page = await browser.newPage();
    try {
      await page.goto(`${other.url}/frame`);
      await page.waitForTimeout(500);
      for (const id of ["ui", "report"]) {
        const frame = await (await page.$(`#${id}`))!.contentFrame();
        // A blocked frame stays empty (Chromium shows its error page, which has no Run Hound content).
        const text = frame ? await frame.evaluate(() => document.body?.innerText ?? "").catch(() => "") : "";
        expect(text, id).not.toMatch(/Run Hound|New run|Pet name/);
      }
    } finally {
      await page.close();
      await other.close();
    }
  });
});
