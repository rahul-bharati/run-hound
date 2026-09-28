/**
 * The web UI's finding detail links the finding's check page on Run Hound's public site (DESIGN.md §5.5): in the
 * "Why it matters" panel, "About the <id> check", target="_blank", rel="noopener noreferrer", to core/links.ts's
 * checkPageUrl (ai-flow to its card on the checks hub). In real Chromium against createApp served on a random port,
 * with the public site answered by a local stub (context.route), so nothing leaves this machine:
 * - the UI's link opens the check's page in a new tab with no opener and no Referer, under the UI's CSP;
 * - report.html's link (sandboxed, allow-popups, allow-popups-to-escape-sandbox) does the same.
 */
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve, type ServerType } from "@hono/node-server";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SITE_URL, checkPageUrl } from "../core/links.js";
import type { Finding, Report } from "../core/types.js";
import { NOT_VISIBLE, writeReport } from "../engine/report.js";
import { createApp } from "./app.js";

const RUN_ID = "20260928-101500-b2d5f8";
/** A hand-edited report.json whose finding names a check this version doesn't have. */
const UNKNOWN_RUN_ID = "20260928-101500-c3e6a9";
const TARGET = "http://127.0.0.1:3100/book";

const DOUBLE_SUBMIT: Finding = {
  checkId: "double-submit",
  id: "double-submit#1",
  title: "Double click books twice",
  severity: "high",
  category: "broken-feature",
  confidence: "confirmed",
  meaning: "Clicking Book twice quickly sends two bookings.",
  impact: "Customers get charged twice.",
  fix: "Disable the Book button while the request is pending.",
  location: "Book button",
  evidence: [],
};

const AI_FLOW: Finding = {
  checkId: "ai-flow",
  id: "ai-flow#1",
  title: "Saving an empty pet name shows no error",
  severity: "medium",
  category: "validation",
  confidence: "advisory",
  meaning: "An AI-suggested flow saved the form with the pet name empty and the page said nothing.",
  impact: "People don't learn why their booking didn't go through.",
  fix: "Show an error next to the pet name when it is empty.",
  evidence: [],
};

function scenario(id: string, checkId: Finding["checkId"]) {
  return { id, checkId, title: `Scenario ${id}`, description: "d", kind: "danger" as const, priority: "high" as const, destructive: false, defaultSelected: true };
}

const REPORT: Report = {
  runId: RUN_ID,
  target: TARGET,
  startedAt: "2026-09-28T10:15:00.000Z",
  finishedAt: "2026-09-28T10:16:00.000Z",
  durationMs: 60_000,
  groups: [
    { id: "features", label: "Features", scenarioIds: ["ds:1", "af:1"], passed: 0, failed: 2, errored: 0, skipped: 0, findings: 2, durationMs: 2400 },
    { id: "accessibility", label: "Accessibility", scenarioIds: ["rf:1"], passed: 1, failed: 0, errored: 0, skipped: 0, findings: 0, durationMs: 300 },
  ],
  runHoundVersion: "0.6.0",
  plan: {
    target: TARGET,
    form: { url: TARGET, selector: "form", name: "Book a sitter", fields: [], controls: [] },
    scenarios: [scenario("ds:1", "double-submit"), scenario("af:1", "ai-flow"), scenario("rf:1", "reflow-320")],
    groups: [
      { id: "features", label: "Features", scenarioIds: ["ds:1", "af:1"] },
      { id: "accessibility", label: "Accessibility", scenarioIds: ["rf:1"] },
    ],
  },
  approved: ["ds:1", "af:1", "rf:1"],
  results: [
    { checkId: "double-submit", scenarioId: "ds:1", status: "fail", findings: [DOUBLE_SUBMIT], durationMs: 1200 },
    { checkId: "ai-flow", scenarioId: "af:1", status: "fail", findings: [AI_FLOW], durationMs: 1200 },
    { checkId: "reflow-320", scenarioId: "rf:1", status: "pass", findings: [], durationMs: 300, notes: "No horizontal overflow" },
  ],
  findings: [DOUBLE_SUBMIT, AI_FLOW],
  summary: { critical: 0, high: 1, medium: 1, low: 0, passed: 1, failed: 2, errored: 0, skipped: 0 },
  notVisible: NOT_VISIBLE,
};

let runsDir: string;
let server: ServerType | undefined;
let base: string;
let browser: Browser;

beforeAll(async () => {
  runsDir = await mkdtemp(join(tmpdir(), "rh-ui-check-links-"));
  const dir = join(runsDir, RUN_ID);
  await mkdir(dir, { recursive: true });
  await writeReport(REPORT, dir);
  const unknown = { ...DOUBLE_SUBMIT, checkId: "no-such-check" as Finding["checkId"], id: "no-such-check#1" };
  const unknownDir = join(runsDir, UNKNOWN_RUN_ID);
  await mkdir(unknownDir, { recursive: true });
  await writeReport(
    {
      ...REPORT,
      runId: UNKNOWN_RUN_ID,
      results: REPORT.results.map((r) => (r.scenarioId === "ds:1" ? { ...r, checkId: unknown.checkId, findings: [unknown] } : r)),
      findings: [unknown, AI_FLOW],
    },
    unknownDir,
  );
  const app = createApp({ checks: [], runsDir, canShowBrowser: false });
  const port = await new Promise<number>((resolve) => {
    server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, (info: AddressInfo) => resolve(info.port));
  });
  base = `http://127.0.0.1:${port}`;
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  if (runsDir) await rm(runsDir, { recursive: true, force: true });
});

interface Watched {
  context: BrowserContext;
  page: Page;
  /** Requests to the public site, with every header the browser sent (the stub answers them). */
  siteRequests: { url: string; headers: Record<string, string> }[];
  /** Requests to anywhere but the local server and the public site. */
  elsewhere: string[];
  violations: string[];
  errors: string[];
}

/** A fresh context whose requests to the public site are answered by a stub page, recording CSP violations and errors. */
async function watched(): Promise<Watched> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const siteRequests: Watched["siteRequests"] = [];
  const elsewhere: string[] = [];
  await context.route(`${SITE_URL}/**`, async (route) => {
    siteRequests.push({ url: route.request().url(), headers: await route.request().allHeaders() });
    await route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Check page</title><p>Stub of the check's page.</p>" });
  });
  context.on("request", (req) => {
    const url = req.url();
    if (!url.startsWith(base) && !url.startsWith(SITE_URL) && !url.startsWith("data:")) elsewhere.push(url);
  });
  const page = await context.newPage();
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
  return { context, page, siteRequests, elsewhere, violations, errors };
}

/** Clicks `link`, waits for the new tab and returns what it saw: its URL, its referrer and whether it has an opener. */
async function followInNewTab(w: Watched, link: Locator) {
  const opened = w.context.waitForEvent("page");
  await link.click();
  const tab = await opened;
  await tab.waitForLoadState("domcontentloaded");
  const seen = await tab.evaluate(() => ({ referrer: document.referrer, opener: window.opener !== null }));
  return { url: tab.url(), ...seen, tab };
}

describe("the web UI's finding detail", () => {
  it("links the check's page from Why it matters, in a new tab with no opener and no Referer", async () => {
    const w = await watched();
    const { page } = w;
    await page.goto(`${base}/#/runs/${RUN_ID}`);
    await page.getByRole("heading", { name: "Test run complete" }).waitFor();
    // The first finding (double-submit) is shown without a click.
    await expect.poll(() => page.locator("#detail-title").innerText()).toBe("Double click books twice");

    const why = page.locator('#detail section[aria-labelledby="why-h"]');
    const link = why.getByRole("link", { name: "About the double-submit check (opens in a new tab)", exact: true });
    expect(await link.count()).toBe(1);
    expect(await link.getAttribute("href")).toBe(checkPageUrl("double-submit"));
    expect(await link.getAttribute("href")).toBe("https://run-hound.rahulbharati.com/checks/double-submit/");
    expect(await link.getAttribute("target")).toBe("_blank");
    expect(await link.getAttribute("rel")).toBe("noopener noreferrer");
    expect((await link.innerText()).startsWith("About the double-submit check")).toBe(true);
    // Its icon comes first, as on the UI's other new-tab links ("Open HTML report", "Feedback form").
    const iconFirst = (a: Element) => a.firstChild instanceof Element && a.firstChild.classList.contains("ic") && a.firstChild.getAttribute("aria-hidden") === "true";
    expect(await link.evaluate(iconFirst)).toBe(true);
    expect(await page.getByRole("link", { name: "Open HTML report (opens in a new tab)", exact: true }).evaluate(iconFirst)).toBe(true);
    // One check link in the whole detail, inside the Why it matters panel.
    expect(await page.locator(`#detail a[href^="${SITE_URL}"]`).count()).toBe(1);

    const tab = await followInNewTab(w, link);
    expect(tab.url).toBe(checkPageUrl("double-submit"));
    expect(tab.referrer).toBe("");
    expect(tab.opener).toBe(false);
    expect(w.siteRequests.map((r) => r.url)).toEqual([checkPageUrl("double-submit")]);
    expect(w.siteRequests[0]!.headers.referer).toBeUndefined();
    // The UI itself stayed on the run.
    expect(page.url()).toBe(`${base}/#/runs/${RUN_ID}`);

    expect(w.elsewhere).toEqual([]);
    expect(w.violations).toEqual([]);
    expect(w.errors).toEqual([]);
    await w.context.close();
  });

  it("links an AI-suggested flow's finding to the ai-flow card on the checks hub", async () => {
    const w = await watched();
    const { page } = w;
    await page.goto(`${base}/#/runs/${RUN_ID}`);
    await page.getByRole("heading", { name: "Test run complete" }).waitFor();
    await page.locator('#results [data-scenario-id="af:1"]').click();
    await expect.poll(() => page.locator("#detail-title").innerText()).toBe("Saving an empty pet name shows no error");

    const link = page.locator('#detail section[aria-labelledby="why-h"]').getByRole("link", { name: "About the ai-flow check (opens in a new tab)", exact: true });
    expect(await link.getAttribute("href")).toBe(`${SITE_URL}/checks/#ai-flow`);
    expect(await link.getAttribute("target")).toBe("_blank");
    expect(await link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(w.violations).toEqual([]);
    expect(w.errors).toEqual([]);
    await w.context.close();
  });
});

describe("a finding whose check this version doesn't know", () => {
  it("shows the finding without a check link", async () => {
    const w = await watched();
    const { page } = w;
    await page.goto(`${base}/#/runs/${UNKNOWN_RUN_ID}`);
    await page.getByRole("heading", { name: "Test run complete" }).waitFor();
    await expect.poll(() => page.locator("#detail-title").innerText()).toBe("Double click books twice");
    const why = page.locator('#detail section[aria-labelledby="why-h"]');
    expect(await why.innerText()).toContain("Customers get charged twice.");
    expect(await why.locator("a").count()).toBe(0);
    expect(w.errors).toEqual([]);
    await w.context.close();
  });
});

describe("report.html as the local server serves it", () => {
  it("opens the check's page in a new tab, out of the sandbox, with no opener and no Referer", async () => {
    const w = await watched();
    const { page } = w;
    const res = await page.goto(`${base}/api/runs/${RUN_ID}/report.html`);
    expect(res!.status()).toBe(200);
    const link = page.getByRole("link", { name: "About the double-submit check", exact: true });
    expect(await link.getAttribute("href")).toBe(checkPageUrl("double-submit"));

    const tab = await followInNewTab(w, link);
    expect(tab.url).toBe(checkPageUrl("double-submit"));
    expect(tab.referrer).toBe("");
    expect(tab.opener).toBe(false);
    expect(w.siteRequests.map((r) => r.url)).toEqual([checkPageUrl("double-submit")]);
    expect(w.siteRequests[0]!.headers.referer).toBeUndefined();
    // allow-popups-to-escape-sandbox: the new tab has the site's own origin, not the report's opaque one.
    expect(await tab.tab.evaluate(() => window.origin)).toBe(SITE_URL);

    expect(w.elsewhere).toEqual([]);
    expect(w.violations).toEqual([]);
    await w.context.close();
  });
});
