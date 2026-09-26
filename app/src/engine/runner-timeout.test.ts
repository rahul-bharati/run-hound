/**
 * The per-scenario time limit (RunOptions.scenarioTimeoutMs, default SCENARIO_TIMEOUT_MS): a scenario that never
 * finishes, for example because the app never answers a request the check sent, is abandoned like a stopped one
 * (its browser contexts closed) and ends "error" with a plain note, and the run goes on. Fake checks only.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import type { Check, CheckId, DiscoveredForm, DiscoveredPage, FormControl, Report, Scenario } from "../core/types.js";
import { buildPlan } from "./plan.js";
import { check as deadControl } from "../checks/dead-control.js";
import { check as pageControls } from "../checks/page-controls.js";
import { check as persistence } from "../checks/persistence.js";
import { emptyForm } from "./discover.js";
import { runPlan, SCENARIO_TIMEOUT_MS, scenarioLimitMs, scenarioTimeoutNote, type ProgressEvent } from "./runner.js";

const FORM_PAGE = `<!doctype html><html lang="en"><head><title>Timeout fixture</title></head><body>
<form id="booking"><h1>Book a sitter</h1>
<label for="petName">Pet name</label><input id="petName" name="petName" required>
<button type="submit">Book</button></form></body></html>`;

function scenario(checkId: CheckId, id: string): Scenario {
  return { id, checkId, title: `Fake ${id}`, description: "fake", kind: "golden", priority: "medium", destructive: false, defaultSelected: true };
}

let server: FixtureServer;
let runsDir: string;
let ran: string[];
/** Releases the hanging check, so an abandoned check never outlives its test. */
let release: () => void;
let hung: Promise<void>;
/** The page the hanging check opened before it hung, and the one it opens after it is released. */
let firstPage: Page | undefined;
let latePage: Page | undefined;
/** Set once the hanging check's run() has returned (after it was released). */
let hangEnded: boolean;
/** What the passing check saw of the late page while the run was still going. */
let lateClosedDuringRun: boolean | undefined;

/**
 * Features: dead-control "dc:1" opens a page, takes a step, then waits until released; released, it takes another
 * step and opens a second page (what an abandoned check that carries on would do).
 * Security: bundle-secrets "bs:1" passes; with `releaseHang` it first releases dc:1 and watches its late page.
 */
function fakeChecks(options: { releaseHang?: boolean } = {}): Check[] {
  const make = (id: CheckId, category: Check["category"], sid: string, run: Check["run"]): Check => ({
    id,
    title: `Fake ${id}`,
    category,
    plan: () => [scenario(id, sid)],
    async run(ctx, s) {
      ran.push(s.id);
      return run(ctx, s);
    },
  });
  return [
    make("dead-control", "broken-feature", "dc:1", async (ctx, s) => {
      firstPage = (await ctx.openPage()).page;
      ctx.step("Clicking Book");
      await hung;
      ctx.step("A late step after the time limit");
      // A context that refuses new pages once its scenario ended is fine too.
      latePage = await ctx
        .openPage()
        .then((o) => o.page)
        .catch(() => undefined);
      hangEnded = true;
      return { checkId: s.checkId, scenarioId: s.id, status: "pass", findings: [], durationMs: 1 };
    }),
    make("bundle-secrets", "security", "bs:1", async (ctx, s) => {
      ctx.step("Reading the bundles");
      if (options.releaseHang) {
        release();
        // Gives up before its own time limit (5 s in that test), so a page that stays open fails the assertion below.
        const until = Date.now() + 4_000;
        while (!(hangEnded && (latePage === undefined || latePage.isClosed())) && Date.now() < until) {
          await new Promise((r) => setTimeout(r, 50));
        }
        lateClosedDuringRun = latePage?.isClosed();
      }
      return { checkId: s.checkId, scenarioId: s.id, status: "pass", findings: [], durationMs: 1 };
    }),
  ];
}

beforeAll(async () => {
  server = await startFixtureServer({ pages: { "/book": FORM_PAGE } });
});

afterAll(async () => {
  await server?.close();
});

beforeEach(async () => {
  runsDir = await mkdtemp(join(tmpdir(), "rh-timeout-"));
  ran = [];
  hung = new Promise<void>((r) => (release = r));
  firstPage = undefined;
  latePage = undefined;
  hangEnded = false;
  lateClosedDuringRun = undefined;
});

afterEach(async () => {
  release();
  await rm(runsDir, { recursive: true, force: true });
});

const target = () => `${server.url}/book`;
const form = (): DiscoveredForm => ({ url: target(), selector: "#booking", name: "Book a sitter", fields: [], controls: [] });

describe("the per-scenario time limit", () => {
  it("is generous by default (3 minutes) and says so in plain words", () => {
    expect(SCENARIO_TIMEOUT_MS).toBe(3 * 60_000);
    expect(scenarioTimeoutNote(SCENARIO_TIMEOUT_MS)).toMatch(/^The scenario took longer than 3 minutes and was stopped/);
    expect(scenarioTimeoutNote(60_000)).toMatch(/^The scenario took longer than 1 minute and was stopped/);
    expect(scenarioTimeoutNote(1_000)).toMatch(/^The scenario took longer than 1 second and was stopped/);
    expect(scenarioTimeoutNote(90_000)).toMatch(/^The scenario took longer than 90 seconds and was stopped/);
  });

  it("grows with the controls a clicking check tries, so a real finding on a busy page is not lost to the limit", () => {
    const buttons = (n: number): FormControl[] =>
      Array.from({ length: n }, (_, i) => ({ accessibleName: `Action ${i}`, text: `Action ${i}`, role: "button", tag: "button", selector: `#a${i}`, isSubmit: false }));
    const url = "http://localhost:5173/";
    // On a page that never goes quiet, each control costs a fresh load with 5 s of waiting plus 1.5 s of watching
    // (about 6.5 s), and each of up to 6 dead ones a recording (about 7.5 s): about 3 minutes for 20 controls.
    const needed = 20 * 6_500 + 6 * 7_500 + 5_000;
    const page: DiscoveredPage = { url, title: null, forms: [], controls: buttons(20), links: 0 };
    const pageScenario = pageControls.plan(emptyForm(url), page)[0]!;
    expect(scenarioLimitMs(pageControls, pageScenario, emptyForm(url), page)).toBeGreaterThanOrEqual(1.5 * needed);
    const form: DiscoveredForm = { url, index: 0, selector: "#f", name: "Order", fields: [], controls: [...buttons(20), { ...buttons(1)[0]!, text: "Save", accessibleName: "Save", selector: "#save", isSubmit: true }] };
    const formScenario = deadControl.plan(form)[0]!;
    expect(scenarioLimitMs(deadControl, formScenario, form, page)).toBeGreaterThanOrEqual(1.5 * needed);
    // A form with a couple of buttons, and a check that clicks nothing, keep the default.
    const small: DiscoveredForm = { ...form, controls: buttons(2) };
    expect(scenarioLimitMs(deadControl, deadControl.plan(small)[0]!, small, page)).toBe(SCENARIO_TIMEOUT_MS);
    expect(scenarioLimitMs(persistence, persistence.plan(form)[0]!, form, page)).toBe(SCENARIO_TIMEOUT_MS);
  });

  it("abandons a scenario that never finishes: its pages are closed, it ends as an error, and the run goes on", async () => {
    const checks = fakeChecks();
    const plan = buildPlan(target(), form(), checks);
    const events: ProgressEvent[] = [];

    // Without a time limit this never resolves: the hanging check is released only in afterEach.
    const { report, dir } = await runPlan(plan, {
      checks,
      approved: ["dc:1", "bs:1"],
      runsDir,
      log: () => undefined,
      scenarioTimeoutMs: 1_000,
      onProgress: (e) => events.push(e),
    });

    expect(ran).toEqual(["dc:1", "bs:1"]);
    const hungResult = report.results.find((r) => r.scenarioId === "dc:1")!;
    expect(hungResult).toMatchObject({ status: "error", findings: [], notes: scenarioTimeoutNote(1_000) });
    expect(hungResult.notes).toMatch(/^The scenario took longer than 1 second and was stopped/);
    expect(hungResult.durationMs).toBeGreaterThanOrEqual(900);
    // What it did before the limit is kept, like a stopped scenario's steps.
    expect(hungResult.steps?.map((s) => s.label)).toEqual(["Clicking Book"]);
    // Its browser context was closed, so the check can't go on typing into the app.
    expect(firstPage?.isClosed()).toBe(true);

    expect(report.results.find((r) => r.scenarioId === "bs:1")?.status).toBe("pass");
    expect(report.stopped).not.toBe(true);
    expect(report.summary).toMatchObject({ passed: 1, errored: 1, skipped: 0 });

    const onDisk = JSON.parse(await readFile(join(dir, "report.json"), "utf8")) as Report;
    expect(onDisk.results.find((r) => r.scenarioId === "dc:1")).toMatchObject({ status: "error", notes: scenarioTimeoutNote(1_000) });

    const ends = events.filter((e): e is Extract<ProgressEvent, { type: "scenario-end" }> => e.type === "scenario-end");
    expect(ends.map((e) => e.scenarioId)).toEqual(["dc:1", "bs:1"]);
  }, 60_000);

  it("an abandoned check that carries on reports nothing more, and a page it opens late is closed when it ends", async () => {
    const checks = fakeChecks({ releaseHang: true });
    const plan = buildPlan(target(), form(), checks);
    const events: ProgressEvent[] = [];

    // Long enough for bs:1 to watch what the released dc:1 does (the limit applies to every scenario).
    const { report } = await runPlan(plan, {
      checks,
      approved: ["dc:1", "bs:1"],
      runsDir,
      log: () => undefined,
      scenarioTimeoutMs: 5_000,
      onProgress: (e) => events.push(e),
    });

    // dc:1 was released while bs:1 ran and took a step; a second page it opened did not outlive it.
    expect(report.results.find((r) => r.scenarioId === "bs:1")?.status).toBe("pass");
    expect(hangEnded).toBe(true);
    if (latePage) expect(lateClosedDuringRun).toBe(true);

    const hungResult = report.results.find((r) => r.scenarioId === "dc:1")!;
    expect(hungResult.status).toBe("error");
    expect(hungResult.steps?.map((s) => s.label)).toEqual(["Clicking Book"]);
    // Nothing the abandoned check did after its scenario ended reaches the progress events (the live view).
    const endOfHung = events.findIndex((e) => e.type === "scenario-end" && e.scenarioId === "dc:1");
    const late = events.slice(endOfHung + 1).filter((e) => "scenarioId" in e && e.scenarioId === "dc:1");
    expect(late).toEqual([]);
    expect(events.some((e) => e.type === "step" && e.label === "A late step after the time limit")).toBe(false);
  }, 60_000);
});
