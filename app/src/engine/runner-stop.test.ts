/**
 * Stopping a run (RunOptions.signal), per-scenario steps (CheckResult.steps) and the browser name (Report.browser).
 * See docs/app-ui-spec.md ("Stop run", API). Fake checks only: no check opens a page, every result is controlled here.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import type { Check, CheckId, DiscoveredForm, Report, Scenario } from "../core/types.js";
import { buildPlan } from "./plan.js";
import { runPlan, type ProgressEvent } from "./runner.js";

const FORM_PAGE = `<!doctype html><html lang="en"><head><title>Stop fixture</title></head><body>
<form id="booking"><h1>Book a sitter</h1>
<label for="petName">Pet name</label><input id="petName" name="petName" required>
<button type="submit">Book</button></form></body></html>`;

const STOPPED = "Stopped by you";
/** Fake credential: only matches the shape of a Stripe secret key. */
const FAKE_SECRET = "sk_live_FAKEFAKEFAKE1234567890abcdEFGH";

function scenario(checkId: CheckId, id: string): Scenario {
  return { id, checkId, title: `Fake ${id}`, description: "fake", kind: "golden", priority: "medium", destructive: false, defaultSelected: true };
}

let server: FixtureServer;
let runsDir: string;
let ran: string[];
/** Resolves the "hang" check's wait, so an abandoned check never outlives its test. */
let release: () => void;
let hung: Promise<void>;
/** Resolves once the "hang" check has started (and taken its steps). */
let hangStarted: Promise<void>;
let markHangStarted: () => void;

/**
 * Accessibility: axe-states "axe:1" passes after two steps (one carrying a secret).
 * Features: dead-control "dc:1" takes one step then hangs until released (the scenario to stop mid-way).
 * Security: bundle-secrets "bs:1" passes.
 */
function fakeChecks(): Check[] {
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
    make("axe-states", "accessibility", "axe:1", async (ctx, s) => {
      ctx.step("Filling the form");
      ctx.step(`Typing the key ${FAKE_SECRET}`);
      return { checkId: s.checkId, scenarioId: s.id, status: "pass", findings: [], durationMs: 1 };
    }),
    make("dead-control", "broken-feature", "dc:1", async (ctx, s) => {
      ctx.step("Clicking Book");
      markHangStarted();
      await hung;
      return { checkId: s.checkId, scenarioId: s.id, status: "pass", findings: [], durationMs: 1 };
    }),
    make("bundle-secrets", "security", "bs:1", async (ctx, s) => {
      ctx.step("Reading the bundles");
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
  runsDir = await mkdtemp(join(tmpdir(), "rh-stop-"));
  ran = [];
  hung = new Promise<void>((r) => (release = r));
  hangStarted = new Promise<void>((r) => (markHangStarted = r));
});

afterEach(async () => {
  release();
  await rm(runsDir, { recursive: true, force: true });
});

const target = () => `${server.url}/book`;
const form = (): DiscoveredForm => ({ url: target(), selector: "#booking", name: "Book a sitter", fields: [], controls: [] });
const ALL = ["axe:1", "dc:1", "bs:1"];

async function readReport(dir: string): Promise<Report> {
  return JSON.parse(await readFile(join(dir, "report.json"), "utf8")) as Report;
}

describe("runPlan with an AbortSignal", () => {
  it("aborting mid-scenario abandons it, skips the rest, writes the report with stopped: true, and resolves", async () => {
    const checks = fakeChecks();
    const plan = buildPlan(target(), form(), checks);
    const controller = new AbortController();
    const events: ProgressEvent[] = [];
    void hangStarted.then(() => {
      controller.abort();
      // Safety net so a runner that ignores the signal fails fast instead of timing out.
      setTimeout(release, 3_000);
    });

    // runPlan must resolve without waiting for the hanging check (released only by the safety net).
    const { report, dir } = await runPlan(plan, {
      checks,
      approved: ALL,
      runsDir,
      log: () => undefined,
      signal: controller.signal,
      onProgress: (e) => events.push(e),
    });

    expect(ran).toEqual(["axe:1", "dc:1"]); // bs:1 never runs
    const byId = new Map(report.results.map((r) => [r.scenarioId, r]));
    expect(byId.get("axe:1")?.status).toBe("pass");
    expect(byId.get("dc:1")).toMatchObject({ status: "skipped", notes: STOPPED, findings: [] });
    expect(byId.get("bs:1")).toMatchObject({ status: "skipped", notes: STOPPED, findings: [] });
    expect(report.stopped).toBe(true);
    expect(report.summary).toMatchObject({ passed: 1, skipped: 2, failed: 0, errored: 0 });

    const onDisk = await readReport(dir);
    expect(onDisk.stopped).toBe(true);
    expect(onDisk.results.find((r) => r.scenarioId === "dc:1")).toMatchObject({ status: "skipped", notes: STOPPED });

    // The abandoned scenario still ends (the UI needs its scenario-end).
    const ends = events.filter((e): e is Extract<ProgressEvent, { type: "scenario-end" }> => e.type === "scenario-end");
    expect(ends.map((e) => e.scenarioId)).toContain("dc:1");
  }, 60_000);

  it("aborting before the run starts skips every scenario", async () => {
    const checks = fakeChecks();
    const plan = buildPlan(target(), form(), checks);
    const controller = new AbortController();
    controller.abort();
    release(); // no check should run; if one does, it must not hang the test

    const { report, dir } = await runPlan(plan, { checks, approved: ALL, runsDir, log: () => undefined, signal: controller.signal });

    expect(ran).toEqual([]);
    expect(report.results).toHaveLength(3);
    for (const r of report.results) expect(r).toMatchObject({ status: "skipped", notes: STOPPED, findings: [] });
    expect(report.stopped).toBe(true);
    expect((await readReport(dir)).stopped).toBe(true);
  }, 60_000);

  it("a run that is not stopped does not say it was", async () => {
    const checks = fakeChecks();
    const plan = buildPlan(target(), form(), checks);
    const { report } = await runPlan(plan, { checks, approved: ["axe:1", "bs:1"], runsDir, log: () => undefined, signal: new AbortController().signal });
    expect(report.stopped).not.toBe(true);
    expect(report.results.every((r) => r.status === "pass")).toBe(true);
  }, 60_000);
});

describe("CheckResult.steps and Report.browser", () => {
  it("records each scenario's ctx.step() labels in order with url and ISO time, secrets redacted", async () => {
    const checks = fakeChecks();
    const plan = buildPlan(target(), form(), checks);
    // No onProgress: steps are recorded for the report whether or not anyone is watching.
    const { report, dir } = await runPlan(plan, { checks, approved: ["axe:1", "bs:1"], runsDir, log: () => undefined });

    const axe = report.results.find((r) => r.scenarioId === "axe:1")!;
    expect(axe.steps?.map((s) => s.label)).toEqual(["Filling the form", expect.stringMatching(/^Typing the key /)]);
    expect(axe.steps![1]!.label).not.toContain(FAKE_SECRET);
    const bs = report.results.find((r) => r.scenarioId === "bs:1")!;
    expect(bs.steps?.map((s) => s.label)).toEqual(["Reading the bundles"]);

    for (const step of [...axe.steps!, ...bs.steps!]) {
      expect(typeof step.url).toBe("string");
      expect(step.url.length).toBeGreaterThan(0);
      expect(new Date(step.at).toISOString()).toBe(step.at);
    }
    expect(Date.parse(axe.steps![0]!.at)).toBeLessThanOrEqual(Date.parse(axe.steps![1]!.at));

    const onDisk = await readReport(dir);
    expect(onDisk.results.find((r) => r.scenarioId === "axe:1")?.steps).toEqual(axe.steps);
    expect(JSON.stringify(onDisk)).not.toContain(FAKE_SECRET);
  }, 60_000);

  it("keeps the steps an abandoned scenario took before it was stopped", async () => {
    const checks = fakeChecks();
    const plan = buildPlan(target(), form(), checks);
    const controller = new AbortController();
    void hangStarted.then(() => {
      controller.abort();
      // Safety net so a runner that ignores the signal fails fast instead of timing out.
      setTimeout(release, 3_000);
    });
    const { report } = await runPlan(plan, { checks, approved: ALL, runsDir, log: () => undefined, signal: controller.signal });
    expect(report.results.find((r) => r.scenarioId === "dc:1")?.steps?.map((s) => s.label)).toEqual(["Clicking Book"]);
  }, 60_000);

  it("names the browser the run used", async () => {
    const checks = fakeChecks();
    const plan = buildPlan(target(), form(), checks);
    const { report, dir } = await runPlan(plan, { checks, approved: ["bs:1"], runsDir, log: () => undefined });
    expect(report.browser).toMatch(/^Chromium \d+/);
    expect((await readReport(dir)).browser).toBe(report.browser);
  }, 60_000);
});
