import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type LaunchOptions } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import type { Check, CheckContext, CheckId, CheckResult, Plan, Report, Scenario } from "../core/types.js";
import { discoverAndPlan, runPlan, type ProgressEvent } from "./runner.js";

/** A form page that keeps repainting, so a screencast always has frames to send. */
const FORM_PAGE = `<!doctype html><html lang="en"><head><title>Live fixture</title>
<style>@keyframes spin { to { transform: rotate(360deg); } } .spinner { width: 40px; height: 40px; background: #F5B642; animation: spin 0.5s linear infinite; }</style>
</head><body>
<form id="booking" action="/thanks" method="get">
  <h1>Book a sitter</h1>
  <label for="petName">Pet name</label><input id="petName" name="petName" required>
  <button type="submit">Book</button>
</form>
<div class="spinner"></div><p>Tick <span id="tick">0</span></p>
<script>let n = 0; setInterval(() => { document.getElementById("tick").textContent = String(++n); }, 40);</script>
</body></html>`;

const THANKS_PAGE = `<!doctype html><html lang="en"><head><title>Thanks</title></head><body><h1>Thanks</h1>
<p>Tick <span id="tick">0</span></p>
<script>let n = 0; setInterval(() => { document.getElementById("tick").textContent = String(++n); }, 40);</script>
</body></html>`;

function scenario(checkId: CheckId, id: string): Scenario {
  return { id, checkId, title: `Fake ${id}`, description: "fake", kind: "golden", priority: "medium", destructive: false, defaultSelected: true };
}

const pass = (checkId: CheckId, s: Scenario): CheckResult => ({ checkId, scenarioId: s.id, status: "pass", findings: [], durationMs: 1 });

let site: FixtureServer;
let runsDir: string;

/**
 * Two fake checks:
 *  - dead-control "dc:walk": steps without a page, opens /book, steps on it, navigates to /thanks, steps again.
 *  - silent-failure "sf:second": opens /book and steps once.
 * Each lingers briefly on a repainting page so the screencast (when live) has time to deliver frames.
 */
function liveChecks(): Check[] {
  return [
    {
      id: "dead-control",
      title: "Fake walk",
      category: "broken-feature",
      plan: () => [scenario("dead-control", "dc:walk")],
      async run(ctx: CheckContext, s) {
        ctx.step("Preparing test data");
        const { page } = await ctx.openPage();
        ctx.step("Clicking Book", page);
        await page.waitForTimeout(400);
        await page.goto(`${site.url}/thanks`, { waitUntil: "load" });
        ctx.step("Reading the thanks page", page);
        await page.waitForTimeout(400);
        return pass("dead-control", s);
      },
    },
    {
      id: "silent-failure",
      title: "Fake second",
      category: "broken-feature",
      plan: () => [scenario("silent-failure", "sf:second")],
      async run(ctx, s) {
        const { page } = await ctx.openPage();
        ctx.step("Looking at the form again", page);
        await page.waitForTimeout(400);
        return pass("silent-failure", s);
      },
    },
  ];
}

type StepEvent = Extract<ProgressEvent, { type: "step" }>;
type PageEvent = Extract<ProgressEvent, { type: "page" }>;
type FrameEvent = Extract<ProgressEvent, { type: "frame" }>;

const isIso = (at: string) => typeof at === "string" && !Number.isNaN(Date.parse(at)) && /^\d{4}-\d{2}-\d{2}T/.test(at);

/** True when `wanted` appears in `seen` in the same order (other entries may sit between them). */
function inOrder(seen: string[], wanted: string[]): boolean {
  let i = 0;
  for (const s of seen) if (s === wanted[i]) i += 1;
  return i === wanted.length;
}

let checks: Check[];
let plan: Plan;
const bookUrl = () => `${site.url}/book`;
const thanksUrl = () => `${site.url}/thanks`;

beforeAll(async () => {
  site = await startFixtureServer({ pages: { "/book": FORM_PAGE, "/thanks": THANKS_PAGE } });
  checks = liveChecks();
  plan = await discoverAndPlan(bookUrl(), { checks });
});

afterAll(async () => {
  await site?.close();
});

beforeEach(async () => {
  runsDir = await mkdtemp(join(tmpdir(), "rh-live-"));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(runsDir, { recursive: true, force: true });
});

async function run(extra: { live?: boolean; headed?: boolean } = {}): Promise<{ report: Report; dir: string; events: ProgressEvent[] }> {
  const events: ProgressEvent[] = [];
  const { report, dir } = await runPlan(plan, {
    checks,
    runsDir,
    approved: ["dc:walk", "sf:second"],
    onProgress: (e) => events.push(e),
    ...extra,
  });
  return { report, dir, events };
}

describe("runPlan live progress", () => {
  it("emits a step event for every ctx.step, in order, with the scenario, the page URL and an ISO time", async () => {
    const { report, events } = await run();
    expect(report.results.map((r) => r.status)).toEqual(["pass", "pass"]);

    const steps = events.filter((e): e is StepEvent => e.type === "step");
    for (const s of steps) {
      expect(typeof s.scenarioId).toBe("string");
      expect(typeof s.label).toBe("string");
      expect(typeof s.url).toBe("string");
      expect(isIso(s.at), s.at).toBe(true);
    }

    const walk = steps.filter((s) => s.scenarioId === "dc:walk");
    expect(inOrder(walk.map((s) => s.label), ["Preparing test data", "Clicking Book", "Reading the thanks page"])).toBe(true);
    expect(walk.find((s) => s.label === "Clicking Book")?.url).toBe(bookUrl());
    expect(walk.find((s) => s.label === "Reading the thanks page")?.url).toBe(thanksUrl());

    const second = steps.filter((s) => s.scenarioId === "sf:second");
    expect(second.find((s) => s.label === "Looking at the form again")?.url).toBe(bookUrl());

    // Times never go backwards.
    const times = steps.map((s) => Date.parse(s.at));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("emits each scenario's step and page events between its scenario-start and scenario-end", async () => {
    const { events } = await run();
    const index = (pred: (e: ProgressEvent) => boolean) => events.findIndex(pred);
    for (const id of ["dc:walk", "sf:second"]) {
      const start = index((e) => e.type === "scenario-start" && e.scenarioId === id);
      const end = index((e) => e.type === "scenario-end" && e.scenarioId === id);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeGreaterThan(start);
      events.forEach((e, i) => {
        if ((e.type === "step" || e.type === "page") && e.scenarioId === id) {
          expect(i).toBeGreaterThan(start);
          expect(i).toBeLessThan(end);
        }
      });
    }
  });

  it("emits a page event for every page load, with its URL", async () => {
    const { events } = await run();
    const pages = events.filter((e): e is PageEvent => e.type === "page");
    for (const p of pages) expect(isIso(p.at), p.at).toBe(true);
    const walk = pages.filter((p) => p.scenarioId === "dc:walk").map((p) => p.url);
    expect(inOrder(walk, [bookUrl(), thanksUrl()])).toBe(true);
    expect(pages.filter((p) => p.scenarioId === "sf:second").map((p) => p.url)).toContain(bookUrl());
  });

  it("lists every loaded URL once in report.pagesVisited, in first-visit order, with the scenarios that loaded it", async () => {
    const { report, dir } = await run();
    expect(report.pagesVisited).toBeDefined();
    const visited = report.pagesVisited!;
    const urls = visited.map((p) => p.url);
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls).toEqual([bookUrl(), thanksUrl()]);
    expect(visited.find((p) => p.url === bookUrl())!.scenarioIds).toEqual(["dc:walk", "sf:second"]);
    expect(visited.find((p) => p.url === thanksUrl())!.scenarioIds).toEqual(["dc:walk"]);

    const onDisk = JSON.parse(await readFile(join(dir, "report.json"), "utf8")) as Report;
    expect(onDisk.pagesVisited).toEqual(visited);
  });

  it("sends no frame events unless live is on", async () => {
    const off = await run();
    expect(off.events.filter((e) => e.type === "frame")).toEqual([]);
    const explicitOff = await run({ live: false });
    expect(explicitOff.events.filter((e) => e.type === "frame")).toEqual([]);
  });

  it("streams JPEG frames of the page under test when live is on", async () => {
    const { events, report } = await run({ live: true });
    expect(report.results.map((r) => r.status)).toEqual(["pass", "pass"]);
    const frames = events.filter((e): e is FrameEvent => e.type === "frame");
    expect(frames.length).toBeGreaterThan(0);
    for (const f of frames) {
      expect(Buffer.isBuffer(f.jpeg)).toBe(true);
      expect(f.jpeg.length).toBeGreaterThan(100);
      // JPEG SOI marker.
      expect([...f.jpeg.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
      expect(["dc:walk", "sf:second"]).toContain(f.scenarioId);
      expect(typeof f.url).toBe("string");
      expect(isIso(f.at), f.at).toBe(true);
    }
    expect(frames.some((f) => f.scenarioId === "dc:walk")).toBe(true);
    expect(frames.some((f) => f.url === bookUrl() || f.url === thanksUrl())).toBe(true);
  });
});

describe("runPlan headed mode", () => {
  /** Spies on chromium.launch but always launches headless, so the test never opens a window. */
  function spyLaunch() {
    const original = chromium.launch.bind(chromium);
    return vi.spyOn(chromium, "launch").mockImplementation((options?: LaunchOptions) => original({ ...options, headless: true }));
  }

  it("launches a visible browser (headless: false) when headed is on", async () => {
    const launch = spyLaunch();
    const { report } = await run({ headed: true });
    expect(report.results.map((r) => r.status)).toEqual(["pass", "pass"]);
    expect(launch).toHaveBeenCalled();
    expect(launch.mock.calls.some(([opts]) => opts?.headless === false)).toBe(true);
    // The pinned-host args are still passed.
    expect(launch.mock.calls.every(([opts]) => Array.isArray(opts?.args))).toBe(true);
  });

  it("stays headless by default", async () => {
    const launch = spyLaunch();
    await run();
    expect(launch).toHaveBeenCalled();
    for (const [opts] of launch.mock.calls) expect(opts?.headless).not.toBe(false);
  });
});
