import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium, type Browser, type LaunchOptions } from "playwright";
import { groupOf } from "../core/format.js";
import { CHECK_GROUPS, type Check, type CheckGroup, type CheckResult, type Plan, type Report, type Scenario } from "../core/types.js";
import { BROWSER_LOCALE, createCheckContext } from "./context.js";
import { discoverPage } from "./discover.js";
import {
  cleanErrorMessage,
  containerLocalhostHint,
  explainNavigationError,
  explainNoForm,
  inContainer,
  NoFormFoundError,
  normalizeTargetUrl,
  TargetNotAllowedError,
  TargetUnreachableError,
} from "./errors.js";
import { guardContext, guardSummary } from "./guard.js";
import { buildPlan, formOfScenario } from "./plan.js";
import { redactSecrets } from "./redact.js";
import { NOT_VISIBLE, redactReport, writeReport } from "./report.js";
import { checkTarget, pinArgs, type SafetyOptions } from "./safety.js";

export interface RunOptions {
  /**
   * Stops the run when aborted: the scenario in progress is abandoned (its browser context closed, status "skipped",
   * notes "Stopped by you"), remaining approved scenarios are "skipped" with the same note, and the report is still
   * written with stopped: true. runPlan resolves normally; it does not throw on abort.
   */
  signal?: AbortSignal;
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
  | { type: "scenario-start"; scenarioId: string; index: number; total: number; group: CheckGroup }
  /** A group's first scenario is about to start; index/total count groups with approved scenarios. */
  | { type: "group-start"; group: CheckGroup; label: string; index: number; total: number; scenarios: number }
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

/**
 * Whether a visible browser window (headed mode) can open here: always on macOS and Windows, and on Linux only with a
 * display server (DISPLAY or WAYLAND_DISPLAY). A container has none, and Chromium then fails with a long banner.
 */
export function canShowBrowser(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): boolean {
  if (platform === "darwin" || platform === "win32") return true;
  return Boolean(env.DISPLAY || env.WAYLAND_DISPLAY);
}

/** Why headed mode is unavailable, in plain words. */
export const NO_DISPLAY_MESSAGE =
  "There is no display on the machine running Run Hound (no DISPLAY or WAYLAND_DISPLAY, as in a container), so a browser window can't be shown. Run without it; the live view in the web UI works either way.";

/** scenarioId of step events the engine reports outside any scenario (discovery, launching, writing the report). */
export const ENGINE_STEP = "";

/** Run Hound's version, from app/package.json: printed by --version, stored in every report, shown in the web UI. */
export const RUN_HOUND_VERSION: string = (() => {
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
  engineStep(options, "Opening the page to find its forms and controls", url);
  const browser = await chromium.launch(launchOptions(target, options));
  try {
    const context = await browser.newContext({ locale: BROWSER_LOCALE });
    const guard = await guardContext(context, safety);
    const page = await context.newPage();
    let status: number | null = null;
    try {
      status = (await page.goto(url, { waitUntil: "load" }))?.status() ?? null;
      await page.waitForLoadState("networkidle", { timeout: NETWORK_IDLE_TIMEOUT_MS }).catch(() => undefined);
    } catch (err) {
      if (guard.escaped.length > 0) throw new TargetNotAllowedError(url, guardSummary(guard)!);
      const explained = explainNavigationError(err, url);
      // In a container, "localhost" is the container: say so instead of only "nothing is answering".
      const hint = explained instanceof TargetUnreachableError && inContainer(existsSync) ? containerLocalhostHint(url) : undefined;
      throw hint ? new TargetUnreachableError(url, `${(explained as Error).message} ${hint}`) : explained;
    }
    if (guard.escaped.length > 0) throw new TargetNotAllowedError(url, guardSummary(guard)!);
    engineStep(options, "Reading the page: forms, fields and controls", page.url());
    const found = await discoverPage(page);
    if (found.forms.length === 0) {
      // A page without a form still gets the page-wide checks, unless it is an error page or a dev server refusing
      // the host name: testing that page would only test the error.
      const text = String(await page.evaluate("document.body ? document.body.innerText.slice(0, 400) : ''").catch(() => ""));
      const broken = (status !== null && status >= 400) || /Blocked request\. This host|Invalid Host header|Blocked cross-origin request/i.test(text);
      if (broken) throw new NoFormFoundError(url, explainNoForm({ requested: url, final: page.url(), status, text }));
    }
    const plan = buildPlan(url, found, checks);
    // Nothing applies (only form checks are registered, or none apply): an empty plan would look like a clean pass.
    if (found.forms.length === 0 && plan.scenarios.length === 0) {
      throw new NoFormFoundError(url, "none of the page-wide checks apply to it either");
    }
    return plan;
  } finally {
    await browser.close();
  }
}

/**
 * Things a person should know before approving the plan: the page the form was found on is not the page they asked
 * for (a redirect, often to a sign-in page, so a different form would be tested).
 */
export function planWarnings(plan: Plan): string[] {
  const warnings: string[] = [];
  try {
    const asked = new URL(plan.target);
    const found = new URL(plan.form.url);
    if (asked.origin !== found.origin || asked.pathname !== found.pathname) {
      const login = /log-?in|sign-?in|auth/i.test(found.pathname) ? " It looks like a sign-in page: pages behind a login aren't supported yet." : "";
      warnings.push(`${plan.target} redirected to ${plan.form.url}, so that page is the one being tested.${login}`);
    }
  } catch {
    // An unparseable URL can't be compared; the safety gate has already judged it.
  }
  if (plan.page && plan.page.forms.length === 0) {
    warnings.push("No form was found on this page, so only the page-wide checks are planned (buttons outside forms, headers, cookies, CORS, source maps, scripts and layout).");
  }
  return warnings;
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

/** Notes of every scenario a stopped run did not finish (RunOptions.signal). */
export const STOPPED_NOTE = "Stopped by you";

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
 * A scenario's group: its check's category, else the plan group that lists it (a check that is no longer registered),
 * else Features.
 */
function scenarioGroup(scenario: Scenario, checks: Check[], plan: Plan): CheckGroup {
  const check = checks.find((c) => c.id === scenario.checkId);
  if (check) return groupOf(check.category);
  return plan.groups?.find((g) => g.scenarioIds.includes(scenario.id))?.id ?? "features";
}

/** Per-group results for every group with at least one scenario in the run, in CHECK_GROUPS order. */
function groupResults(results: CheckResult[], groupOfScenario: Map<string, CheckGroup>): Report["groups"] {
  return CHECK_GROUPS.flatMap((g) => {
    const mine = results.filter((r) => groupOfScenario.get(r.scenarioId) === g.id);
    if (mine.length === 0) return [];
    const count = (status: CheckResult["status"]) => mine.filter((r) => r.status === status).length;
    return [
      {
        id: g.id,
        label: g.label,
        scenarioIds: mine.map((r) => r.scenarioId),
        passed: count("pass"),
        failed: count("fail"),
        errored: count("error"),
        skipped: count("skipped"),
        findings: mine.reduce((n, r) => n + r.findings.length, 0),
        durationMs: mine.reduce((n, r) => n + r.durationMs, 0),
      },
    ];
  });
}

/**
 * Runs approved scenarios group by group (CHECK_GROUPS order), plan order inside a group; a group-start event
 * precedes each group. A destructive scenario runs only with allowDestructive.
 * A scenario whose check throws gets status "error" (the run continues). Writes the report
 * (see report.ts) into <runsDir>/<runId>/ and returns it. Re-checks the safety gate first.
 * Unapproved scenarios are left out of results; approved destructive ones without opt-in are "skipped".
 */
export async function runPlan(plan: Plan, options: RunOptions = {}): Promise<{ report: Report; dir: string }> {
  const startedMs = Date.now();
  const safety = safetyOptions(options);
  const target = await checkTarget(plan.target, safety);
  const runId = options.runId ?? newRunId();
  if (!/^[\w-]+$/.test(runId)) throw new Error(`Invalid run id: ${runId}`);

  const checks = await resolveChecks(options);
  const allowDestructive = options.allowDestructive ?? false;
  const approvedIds = new Set(options.approved ?? plan.scenarios.filter((s) => s.defaultSelected).map((s) => s.id));
  const unknown = [...approvedIds].filter((id) => !plan.scenarios.some((s) => s.id === id));
  if (unknown.length > 0) throw new NothingToRunError(`Unknown scenario id(s): ${unknown.join(", ")}.`);
  const groupOfScenario = new Map(plan.scenarios.map((s) => [s.id, scenarioGroup(s, checks, plan)] as const));
  const groupIndex = (s: Scenario) => CHECK_GROUPS.findIndex((g) => g.id === groupOfScenario.get(s.id));
  // Stable sort: plan order is kept inside a group.
  const toRun = plan.scenarios.filter((s) => approvedIds.has(s.id)).sort((a, b) => groupIndex(a) - groupIndex(b));
  // A run with nothing in it would report "0 findings" and look like a clean pass.
  if (toRun.length === 0) throw new NothingToRunError("No scenarios were approved, so there is nothing to run. Approve at least one scenario.");

  const startedAt = new Date(startedMs).toISOString();
  const dir = join(resolve(options.runsDir ?? "runs"), runId);
  const artifactsDir = join(dir, "artifacts");
  await mkdir(artifactsDir, { recursive: true });

  const results: CheckResult[] = [];
  // One token for the whole run: every test value carries it, so any scenario can recognise test data an earlier
  // scenario left in the app (reflow-320 names it as the cause of an overflow instead of blaming the layout).
  const runToken = randomBytes(4).toString("hex");
  // Save requests the app accepted, summed over every scenario (report.testRecordsCreated).
  let testRecordsCreated = 0;
  // One evidence file counter for the whole run, so artifact numbers follow the order evidence was taken.
  const fileCounter = { value: 0 };
  // Every page any scenario loaded, in first-visit order (Map keeps insertion order).
  const pagesVisited = new Map<string, string[]>();
  const recordVisit = (url: string, scenarioId: string) => {
    const ids = pagesVisited.get(url) ?? [];
    if (!ids.includes(scenarioId)) ids.push(scenarioId);
    pagesVisited.set(url, ids);
  };

  const signal = options.signal;
  const stopped = () => signal?.aborted === true;
  // Settles (never rejects) when the run is stopped, so a scenario in progress can be abandoned.
  const whenStopped = new Promise<"stopped">((res) => {
    if (!signal) return;
    if (signal.aborted) res("stopped");
    else signal.addEventListener("abort", () => res("stopped"), { once: true });
  });
  // True once the stop cost the run a scenario; a stop after the last scenario ended changes nothing.
  let wasStopped = false;
  /** Every approved scenario without a result yet, "skipped" as stopped; each still gets its scenario-end. */
  const skipRest = () => {
    for (const scenario of toRun) {
      if (results.some((r) => r.scenarioId === scenario.id)) continue;
      const result = skipped(scenario, STOPPED_NOTE);
      wasStopped = true;
      results.push(result);
      options.onProgress?.({ type: "scenario-end", scenarioId: scenario.id, result });
    }
  };

  let browserName: string | undefined;
  if (stopped()) skipRest();
  else {
    engineStep(options, options.headed ? "Opening a browser window" : "Starting the browser", plan.target);
    const browser = await chromium.launch(launchOptions(target, options));
    browserName = `Chromium ${browser.version()}`;
    try {
      const runGroups = CHECK_GROUPS.filter((g) => toRun.some((s) => groupOfScenario.get(s.id) === g.id));
      let current: CheckGroup | undefined;
      for (const [index, scenario] of toRun.entries()) {
        if (stopped()) break;
        const group = groupOfScenario.get(scenario.id)!;
        if (group !== current) {
          current = group;
          const g = runGroups.find((x) => x.id === group)!;
          const scenarios = toRun.filter((s) => groupOfScenario.get(s.id) === group).length;
          options.onProgress?.({ type: "group-start", group, label: g.label, index: runGroups.indexOf(g), total: runGroups.length, scenarios });
        }
        options.onProgress?.({ type: "scenario-start", scenarioId: scenario.id, index, total: toRun.length, group });
        const result = await runScenario(scenario, browser);
        results.push(result);
        options.onProgress?.({ type: "scenario-end", scenarioId: scenario.id, result });
      }
      if (stopped()) skipRest();
    } finally {
      await browser.close();
    }
  }

  async function runScenario(scenario: Scenario, browser: Browser): Promise<CheckResult> {
    if (scenario.destructive && !allowDestructive) {
      return skipped(scenario, "Destructive scenario; run again with --allow-destructive to include it.");
    }
    const check = checks.find((c) => c.id === scenario.checkId);
    if (!check) return { ...skipped(scenario, `No check registered for ${scenario.checkId}.`), status: "error" };

    // A fresh CheckContext per scenario, so every scenario gets its own browser contexts.
    const log = options.log ?? ((line: string) => process.stderr.write(`${line}\n`));
    const scenarioId = scenario.id;
    const progress = options.onProgress;
    const steps: NonNullable<CheckResult["steps"]> = [];
    const withSteps = (result: CheckResult): CheckResult => (steps.length > 0 ? { ...result, steps: [...steps] } : result);
    const ctx = createCheckContext({
      browser,
      form: formOfScenario(plan, scenario),
      discoveredPage: plan.page,
      targetUrl: plan.target,
      artifactsDir,
      allowDestructive,
      runToken,
      allowedHosts: safety.allowedHosts,
      lookup: safety.lookup,
      log: (message) => log(`[${scenario.id}] ${message}`),
      fileCounter,
      checkId: scenario.checkId,
      scenarioTitle: scenario.title,
      // The context redacts step labels and URLs before these hooks see them. Steps are kept for the report
      // (CheckResult.steps) whether or not anyone is watching.
      onStep: (step) => {
        steps.push(step);
        progress?.({ type: "step", scenarioId, ...step });
      },
      onPageLoad: (page) => {
        recordVisit(page.url, scenarioId);
        progress?.({ type: "page", scenarioId, ...page });
      },
      onFrame: progress && options.live ? (frame) => progress({ type: "frame", scenarioId, ...frame }) : undefined,
    });
    const started = Date.now();
    const base = { checkId: scenario.checkId, scenarioId: scenario.id };
    try {
      const running = check.run(ctx, scenario);
      // An abandoned check keeps running until its contexts close under it (dispose below); its failure is moot.
      running.catch(() => undefined);
      const outcome = await Promise.race([running, whenStopped]);
      if (outcome === "stopped") {
        wasStopped = true;
        return withSteps({ ...skipped(scenario, STOPPED_NOTE), durationMs: Date.now() - started });
      }
      const result = outcome;
      // A scenario that left the allowed targets never produces findings: whatever it saw was not the target.
      if (ctx.escaped.length > 0) {
        return withSteps({ ...base, status: "error", findings: [], durationMs: Date.now() - started, notes: guardSummary(ctx)! });
      }
      const notes = [result.notes, ctx.blocked.length > 0 ? guardSummary(ctx) : null].filter(Boolean).join(" ");
      // Each finding says which form (or the whole page) it is about.
      const findings = scenario.scopeLabel ? result.findings.map((f) => ({ ...f, scope: scenario.scopeLabel })) : result.findings;
      return withSteps({ ...result, ...base, findings, ...(notes ? { notes } : {}) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const notes = ctx.escaped.length > 0 ? guardSummary(ctx)! : redactSecrets(cleanErrorMessage(message));
      return withSteps({ ...base, status: "error", findings: [], durationMs: Date.now() - started, notes });
    } finally {
      testRecordsCreated += ctx.testRecordsCreated();
      await ctx.dispose();
    }
  }

  engineStep(options, "Writing the report", plan.target);
  const findings = results.flatMap((r) => r.findings);
  makeUnique(findings);
  // Callers (CLI, server) get the same redacted report that was written to disk.
  const finishedMs = Date.now();
  const report: Report = redactReport({
    runId,
    target: plan.target,
    startedAt,
    finishedAt: new Date(finishedMs).toISOString(),
    durationMs: finishedMs - startedMs,
    groups: groupResults(results, groupOfScenario),
    runHoundVersion: RUN_HOUND_VERSION,
    plan,
    approved: toRun.map((s) => s.id),
    results,
    findings,
    summary: summarize(results, findings),
    notVisible: [...NOT_VISIBLE],
    pagesVisited: [...pagesVisited].map(([url, scenarioIds]) => ({ url, scenarioIds })),
    testRecordsCreated,
    ...(wasStopped ? { stopped: true } : {}),
    ...(browserName ? { browser: browserName } : {}),
  });
  await writeReport(report, dir);
  return { report, dir };
}
