import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import type { Check, CheckResult, Plan, Report, Scenario } from "../core/types.js";
import { createCheckContext } from "./context.js";
import { discoverForm } from "./discover.js";
import { TargetNotAllowedError } from "./errors.js";
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
}

export type ProgressEvent =
  | { type: "scenario-start"; scenarioId: string; index: number; total: number }
  | { type: "scenario-end"; scenarioId: string; result: CheckResult };

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

/** Safety gate (host checked and pinned), open the target, discover the form, build the plan. */
export async function discoverAndPlan(url: string, options: RunOptions = {}): Promise<Plan> {
  const safety = safetyOptions(options);
  const target = await checkTarget(url, safety);
  const checks = await resolveChecks(options);
  const browser = await chromium.launch({ args: pinArgs(target) });
  try {
    const context = await browser.newContext();
    const guard = await guardContext(context, safety);
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: "networkidle" });
    } catch (err) {
      if (guard.escaped.length > 0) throw new TargetNotAllowedError(url, guardSummary(guard)!);
      throw err;
    }
    if (guard.escaped.length > 0) throw new TargetNotAllowedError(url, guardSummary(guard)!);
    const form = await discoverForm(page);
    return buildPlan(url, form, checks);
  } finally {
    await browser.close();
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
  const toRun = plan.scenarios.filter((s) => approvedIds.has(s.id));

  const startedAt = new Date().toISOString();
  const dir = join(resolve(options.runsDir ?? "runs"), runId);
  const artifactsDir = join(dir, "artifacts");
  await mkdir(artifactsDir, { recursive: true });

  const results: CheckResult[] = [];
  const browser = await chromium.launch({ args: pinArgs(target) });
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
    const ctx = createCheckContext({
      browser,
      form: plan.form,
      targetUrl: plan.target,
      artifactsDir,
      allowDestructive,
      allowedHosts: safety.allowedHosts,
      lookup: safety.lookup,
      log: (message) => log(`[${scenario.id}] ${message}`),
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
      const notes = ctx.escaped.length > 0 ? guardSummary(ctx)! : redactSecrets(message);
      return { ...base, status: "error", findings: [], durationMs: Date.now() - started, notes };
    } finally {
      await ctx.dispose();
    }
  }

  const findings = results.flatMap((r) => r.findings);
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
  });
  await writeReport(report, dir);
  return { report, dir };
}
