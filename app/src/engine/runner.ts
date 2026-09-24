import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium, type LaunchOptions } from "playwright";
import type { Check, CheckResult, Plan, Report, Scenario } from "../core/types.js";
import { createCheckContext } from "./context.js";
import { discoverForm } from "./discover.js";
import { cleanErrorMessage, explainNavigationError, normalizeTargetUrl, TargetNotAllowedError } from "./errors.js";
import { guardContext, guardSummary } from "./guard.js";
import { buildPlan } from "./plan.js";
import { redactSecrets } from "./redact.js";
import { NOT_VISIBLE, redactReport, writeReport } from "./report.js";
import { checkTarget, pinArgs, type SafetyOptions } from "./safety.js";

export interface RunOptions {
  /** Defaults to the registered V0 checks. */
  checks?: Check[];
  /** Scenario ids to run. Defaults to every defaultSelected scenario. */
  approved?: string[];
  allowDestructive?: boolean;
  /** Where run folders go. Defaults to ./runs. */
  runsDir?: string;
  /** Defaults to the comma list in RUNHOUND_ALLOWED_HOSTS. */
  allowedHosts?: string[];
  /** DNS lookup used by the safety gate, injectable for tests. */
  lookup?: SafetyOptions["lookup"];
  /** Where a check's log lines go. Defaults to stderr. */
  log?: (line: string) => void;
  onProgress?: (event: ProgressEvent) => void;
  /** Run id to use (letters, digits, "_" and "-"). Generated when omitted; the server passes its own. */
  runId?: string;
  /** Stream JPEG frames of the page under test as "frame" progress events (the web UI's live view). Default false. */
  live?: boolean;
  /** Open a visible browser window instead of headless Chromium, so a person can watch. Default false. */
  headed?: boolean;
}

export type ProgressEvent =
  | { type: "scenario-start"; scenarioId: string; index: number; total: number }
  | { type: "scenario-end"; scenarioId: string; result: CheckResult }
  /**
   * A check reported what it is doing (CheckContext.step) or the engine started a phase (discovery, report).
   * Engine steps outside any scenario carry ENGINE_STEP ("") as their scenarioId.
   */
  | { type: "step"; scenarioId: string; label: string; url: string; at: string }
  /** A page finished loading in the browser under test (main frame only). Feeds report.pagesVisited. */
  | { type: "page"; scenarioId: string; url: string; at: string }
  /** Latest screencast frame of the page under test; only when RunOptions.live. Secrets can't be redacted from pixels. */
  | { type: "frame"; scenarioId: string; url: string; jpeg: Buffer; at: string };

/** scenarioId of step events the engine reports outside any scenario (discovery, launching, writing the report). */
export const ENGINE_STEP = "";

const VERSION: string = (() => {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

function allowedHosts(options: RunOptions): string[] {
  return options.allowedHosts ?? (process.env.RUNHOUND_ALLOWED_HOSTS ?? "").split(",").map((h) => h.trim()).filter(Boolean);
}

/** Safety options the gate and the navigation guard share. */
function safetyOptions(options: RunOptions): SafetyOptions {
  return { allowedHosts: allowedHosts(options), lookup: options.lookup };
}

/** Launch options shared by discovery and the run: pinned host, and a visible window when headed. */
function launchOptions(target: Awaited<ReturnType<typeof checkTarget>>, options: RunOptions): LaunchOptions {
  return { args: pinArgs(target), headless: !options.headed };
}

/** Reports an engine phase (not tied to a scenario) to onProgress. */
function engineStep(options: RunOptions, label: string, url: string): void {
  options.onProgress?.({ type: "step", scenarioId: ENGINE_STEP, label, url: redactSecrets(url), at: new Date().toISOString() });
}

/** Loaded lazily so the engine does not pull in the whole check library when callers pass their own checks. */
async function resolveChecks(options: RunOptions): Promise<Check[]> {
  if (options.checks) return options.checks;
  const { checks } = await import("../checks/index.js");
  return checks;
}

/** Sortable, filesystem-safe run id, e.g. "20260922-101500-3f9a1c". */
export function newRunId(): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  return `${stamp}-${randomBytes(3).toString("hex")}`;
}

/** How long to wait for the network to go quiet after "load"; apps that poll or stream never go idle. */
export const NETWORK_IDLE_TIMEOUT_MS = 5_000;

/**
 * Safety gate (host checked and pinned), open the target, discover the form, build the plan.
 * "localhost:3000/book" (no scheme) is read as http://localhost:3000/book. A target that doesn't answer is reported
 * as a TargetUnreachableError with one plain sentence, not Playwright's call log.
 */
export async function discoverAndPlan(rawUrl: string, options: RunOptions = {}): Promise<Plan> {
  const url = normalizeTargetUrl(rawUrl);
  const safety = safetyOptions(options);
  const target = await checkTarget(url, safety);
  const checks = await resolveChecks(options);
  engineStep(options, "Opening the page to find the form", url);
  const browser = await chromium.launch(launchOptions(target, options));
  try {
    const context = await browser.newContext();
    const guard = await guardContext(context, safety);
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: "load" });
      await page.waitForLoadState("networkidle", { timeout: NETWORK_IDLE_TIMEOUT_MS }).catch(() => undefined);
    } catch (err) {
      if (guard.escaped.length > 0) throw new TargetNotAllowedError(url, guardSummary(guard)!);
      throw explainNavigationError(err, url);
    }
    if (guard.escaped.length > 0) throw new TargetNotAllowedError(url, guardSummary(guard)!);
    engineStep(options, "Reading the form", page.url());
    const form = await discoverForm(page);
    return buildPlan(url, form, checks);
  } finally {
    await browser.close();
  }
}

/** The approval is empty or names scenarios the plan doesn't have. The CLI and the API report it as a usage error. */
export class NothingToRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NothingToRunError";
  }
}

/**
 * Finding ids and spec file names must be unique across the run: checks number their findings per scenario, and
 * two scenarios of one check could otherwise produce the same id or overwrite each other's spec file.
 * Later duplicates get "-2", "-3", ... (ids) or "-2.spec.ts" (files). Mutates the findings in place.
 */
function makeUnique(findings: Report["findings"]): void {
  const ids = new Set<string>();
  const files = new Set<string>();
  for (const f of findings) {
    let id = f.id;
    for (let n = 2; ids.has(id); n++) id = `${f.id}-${n}`;
    ids.add(id);
    f.id = id;
    if (!f.spec) continue;
    const base = f.spec.filename.replace(/\.spec\.ts$/, "");
    let file = f.spec.filename;
    for (let n = 2; files.has(file.toLowerCase()); n++) file = `${base}-${n}.spec.ts`;
    files.add(file.toLowerCase());
    f.spec.filename = file;
  }
}

function skipped(scenario: Scenario, notes: string): CheckResult {
  return { checkId: scenario.checkId, scenarioId: scenario.id, status: "skipped", findings: [], durationMs: 0, notes };
}

function summarize(results: CheckResult[], findings: Report["findings"]): Report["summary"] {
  const count = (status: CheckResult["status"]) => results.filter((r) => r.status === status).length;
  const severity = (s: string) => findings.filter((f) => f.severity === s).length;
  return {
    critical: severity("critical"),
    high: severity("high"),
    medium: severity("medium"),
    low: severity("low"),
    passed: count("pass"),
    failed: count("fail"),
    errored: count("error"),
    skipped: count("skipped"),
  };
}

/**
 * Runs approved scenarios in plan order. A destructive scenario runs only with allowDestructive.
 * A scenario whose check throws gets status "error" (the run continues). Writes the report
 * (see report.ts) into <runsDir>/<runId>/ and returns it. Re-checks the safety gate first.
 * Unapproved scenarios are left out of results; approved destructive ones without opt-in are "skipped".
 */
export async function runPlan(plan: Plan, options: RunOptions = {}): Promise<{ report: Report; dir: string }> {
  const safety = safetyOptions(options);
  const target = await checkTarget(plan.target, safety);
  const runId = options.runId ?? newRunId();
  if (!/^[\w-]+$/.test(runId)) throw new Error(`Invalid run id: ${runId}`);

  const checks = await resolveChecks(options);
  const allowDestructive = options.allowDestructive ?? false;
  const approvedIds = new Set(options.approved ?? plan.scenarios.filter((s) => s.defaultSelected).map((s) => s.id));
  const unknown = [...approvedIds].filter((id) => !plan.scenarios.some((s) => s.id === id));
  if (unknown.length > 0) throw new NothingToRunError(`Unknown scenario id(s): ${unknown.join(", ")}.`);
  const toRun = plan.scenarios.filter((s) => approvedIds.has(s.id));
  // A run with nothing in it would report "0 findings" and look like a clean pass.
  if (toRun.length === 0) throw new NothingToRunError("No scenarios were approved, so there is nothing to run. Approve at least one scenario.");

  const startedAt = new Date().toISOString();
  const dir = join(resolve(options.runsDir ?? "runs"), runId);
  const artifactsDir = join(dir, "artifacts");
  await mkdir(artifactsDir, { recursive: true });

  const results: CheckResult[] = [];
  // One evidence file counter for the whole run, so artifact numbers follow the order evidence was taken.
  const fileCounter = { value: 0 };
  // Every page any scenario loaded, in first-visit order (Map keeps insertion order).
  const pagesVisited = new Map<string, string[]>();
  const recordVisit = (url: string, scenarioId: string) => {
    const ids = pagesVisited.get(url) ?? [];
    if (!ids.includes(scenarioId)) ids.push(scenarioId);
    pagesVisited.set(url, ids);
  };

  engineStep(options, options.headed ? "Opening a browser window" : "Starting the browser", plan.target);
  const browser = await chromium.launch(launchOptions(target, options));
  try {
    for (const [index, scenario] of toRun.entries()) {
      options.onProgress?.({ type: "scenario-start", scenarioId: scenario.id, index, total: toRun.length });
      const result = await runScenario(scenario);
      results.push(result);
      options.onProgress?.({ type: "scenario-end", scenarioId: scenario.id, result });
    }
  } finally {
    await browser.close();
  }

  async function runScenario(scenario: Scenario): Promise<CheckResult> {
    if (scenario.destructive && !allowDestructive) {
      return skipped(scenario, "Destructive scenario; run again with --allow-destructive to include it.");
    }
    const check = checks.find((c) => c.id === scenario.checkId);
    if (!check) return { ...skipped(scenario, `No check registered for ${scenario.checkId}.`), status: "error" };

    // A fresh CheckContext per scenario, so every scenario gets its own browser contexts.
    const log = options.log ?? ((line: string) => process.stderr.write(`${line}\n`));
    const scenarioId = scenario.id;
    const progress = options.onProgress;
    const ctx = createCheckContext({
      browser,
      form: plan.form,
      targetUrl: plan.target,
      artifactsDir,
      allowDestructive,
      allowedHosts: safety.allowedHosts,
      lookup: safety.lookup,
      log: (message) => log(`[${scenario.id}] ${message}`),
      fileCounter,
      checkId: scenario.checkId,
      scenarioTitle: scenario.title,
      // The context redacts step labels and URLs before these hooks see them.
      onStep: progress && ((step) => progress({ type: "step", scenarioId, ...step })),
      onPageLoad: (page) => {
        recordVisit(page.url, scenarioId);
        progress?.({ type: "page", scenarioId, ...page });
      },
      onFrame: progress && options.live ? (frame) => progress({ type: "frame", scenarioId, ...frame }) : undefined,
    });
    const started = Date.now();
    const base = { checkId: scenario.checkId, scenarioId: scenario.id };
    try {
      const result = await check.run(ctx, scenario);
      // A scenario that left the allowed targets never produces findings: whatever it saw was not the target.
      if (ctx.escaped.length > 0) {
        return { ...base, status: "error", findings: [], durationMs: Date.now() - started, notes: guardSummary(ctx)! };
      }
      const notes = [result.notes, ctx.blocked.length > 0 ? guardSummary(ctx) : null].filter(Boolean).join(" ");
      return { ...result, ...base, ...(notes ? { notes } : {}) };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const notes = ctx.escaped.length > 0 ? guardSummary(ctx)! : redactSecrets(cleanErrorMessage(message));
      return { ...base, status: "error", findings: [], durationMs: Date.now() - started, notes };
    } finally {
      await ctx.dispose();
    }
  }

  engineStep(options, "Writing the report", plan.target);
  const findings = results.flatMap((r) => r.findings);
  makeUnique(findings);
  // Callers (CLI, server) get the same redacted report that was written to disk.
  const report: Report = redactReport({
    runId,
    target: plan.target,
    startedAt,
    finishedAt: new Date().toISOString(),
    runHoundVersion: VERSION,
    plan,
    approved: toRun.map((s) => s.id),
    results,
    findings,
    summary: summarize(results, findings),
    notVisible: [...NOT_VISIBLE],
    pagesVisited: [...pagesVisited].map(([url, scenarioIds]) => ({ url, scenarioIds })),
  });
  await writeReport(report, dir);
  return { report, dir };
}
