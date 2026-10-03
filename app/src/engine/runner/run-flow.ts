/** Execution, session lifecycle, and report writing. */

import { randomBytes } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Browser } from "playwright";
import { explainFindings } from "../../ai/explain.js";
import { modelLabel } from "../../ai/session.js";
import { groupOf } from "../../core/format.js";
import { CHECK_GROUPS, type Check, type CheckGroup, type CheckResult, type Plan, type Report, type Scenario } from "../../core/types.js";
import type { TestAccount } from "../../interfaces/accounts.js";
import { changesCredentials, credentialFormNote, NEVER_SUBMITS } from "../../checks/lib/functional-form.js";
import { formOfScenario } from "../plan.js";
import { launchChromium } from "../isolation.js";
import { NOT_VISIBLE, redactReport, writeReport } from "../report.js";
import { redactDeep, redactSecrets } from "../redact.js";
import { checkTarget } from "../safety.js";
import { signIn, SignInError, type SessionState, accountLabel } from "../auth.js";
import { createCheckContext, createCredentialHeaders, type CredentialHeaders, type SessionStorageItems } from "../context.js";
import { guardSummary, type NavigationGuard } from "../guard.js";
import { RUN_HOUND_VERSION, needsOtherAccount, newRunId, scenarioLimitMs, scenarioTimeoutNote, stillSignedOutMessage } from "./options.js";
import { MAX_EXPLAINED, CHANGES_ACCOUNT_A, CLOSED_BY_GUARD, ANSI, CALL_LOG, STOPPED_NOTE } from "../../constants/runner-constants.js";
import { otherSlot, refOf, signingIn } from "./account-helpers.js";
import { landedOnSignIn } from "./sign-in-page.js";
import { SecretRegistrations, redactError } from "./secrets.js";
import { engineStep, launchOptions, resolveChecks, safetyOptions } from "./shared.js";
import { NothingToRunError } from "../../errors/nothing-to-run-error.js";
import type { RunOptions, Signing } from "../../interfaces/runner.js";

/** Notes of a scenario that needs a second account the run doesn't have. */
function noOtherAccountNote(signing: Signing | null): string {
  if (!signing) return "Skipped: this scenario needs a run signed in as a test account, with a second test account to compare.";
  const other = signing.config.accounts[otherSlot(signing.account.id)];
  const label = other ? accountLabel(other) : "The other test account";
  if (!signing.config.isolated) {
    return `Skipped: the test accounts are not marked as unable to see each other's data (Settings → Test accounts), so ${label} was not used.`;
  }
  return `Skipped: ${label} isn't set up (Settings → Test accounts), so no other account could try to read or change ${accountLabel(signing.account)}'s data.`;
}

/** Finding ids and spec file names must be unique across the run. */
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

function scenarioGroup(scenario: Scenario, checks: Check[], plan: Plan): CheckGroup {
  const check = checks.find((c) => c.id === scenario.checkId);
  if (check) return groupOf(check.category);
  return plan.groups?.find((g) => g.scenarioIds.includes(scenario.id))?.id ?? "features";
}

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

function skipped(scenario: Scenario, notes: string): CheckResult {
  return { checkId: scenario.checkId, scenarioId: scenario.id, status: "skipped", findings: [], durationMs: 0, notes };
}

/** A message a check threw as one line of notes: no ANSI codes and no call log, whitespace collapsed. */
function thrownNote(message: string): string {
  const plain = message.replace(ANSI, "");
  const cut = plain.replace(CALL_LOG, (_log: string, stop: string | undefined, at: number) => (stop && !/[.?!]$/.test(plain.slice(0, at)) ? stop : ""));
  return cut.replace(/\s+/g, " ").trim();
}

/** Notes of a scenario whose page left the allowed targets. */
function escapedNotes(guard: NavigationGuard, check: Check, own: string | undefined, thrown: boolean): string {
  if (!CHANGES_ACCOUNT_A.has(check.id)) return guardSummary(guard)!;
  const kept = thrown ? thrownNote(own ?? "").replace(CLOSED_BY_GUARD, "").trim() : (own ?? "").trim();
  return [guardSummary(guard), redactSecrets(kept)].filter(Boolean).join(" ");
}

/** Notes of a scenario abandoned at its time limit. */
function abandonedNotes(guard: NavigationGuard, note: string): string {
  return [guard.escaped.length > 0 ? guardSummary(guard) : null, note].filter(Boolean).join(" ");
}

/** Notes of the scenario a stop abandoned. */
function stoppedNotes(guard: NavigationGuard, interrupted: (note: string) => string): string {
  return interrupted(guard.escaped.length > 0 ? `${STOPPED_NOTE}. ${guardSummary(guard)}` : STOPPED_NOTE);
}

/** Opens the target once as `identity` so the credential headers the app sends are known to CheckContext.request. */
async function preHarvest(
  browser: Browser,
  plan: Plan,
  identity: "self" | "other",
  shared: {
    sessions: { self?: SessionState; other?: SessionState };
    sessionStorage: { self?: SessionStorageItems; other?: SessionStorageItems };
    credentialHeaders: CredentialHeaders;
    artifactsDir: string;
    safety: import("../safety.js").SafetyOptions;
  },
  account: TestAccount,
): Promise<void> {
  const ctx = createCheckContext({
    browser,
    form: plan.form,
    openForm: false,
    ...(plan.page ? { discoveredPage: plan.page } : {}),
    targetUrl: plan.target,
    artifactsDir: shared.artifactsDir,
    allowedHosts: shared.safety.allowedHosts,
    lookup: shared.safety.lookup,
    sessions: shared.sessions,
    sessionStorage: shared.sessionStorage,
    credentialHeaders: shared.credentialHeaders,
  });
  try {
    const { page } = await ctx.openPage({ as: identity });
    if (await landedOnSignIn(page, plan.target, account)) throw new SignInError(stillSignedOutMessage(accountLabel(account), plan.target, account.loginUrl));
  } catch (err) {
    if (err instanceof SignInError) throw err;
  } finally {
    await ctx.dispose();
  }
}

/** Runs approved scenarios group by group; writes the report into <runsDir>/<runId>/. */
export async function runPlan(plan: Plan, options: RunOptions = {}): Promise<{ report: Report; dir: string }> {
  const secrets = new SecretRegistrations();
  try {
    return await runPlanWith(plan, options, secrets);
  } catch (err) {
    throw redactError(err);
  } finally {
    secrets.release();
  }
}

async function runPlanWith(plan: Plan, options: RunOptions, secrets: SecretRegistrations): Promise<{ report: Report; dir: string }> {
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
  const toRun = plan.scenarios.filter((s) => approvedIds.has(s.id)).sort((a, b) => groupIndex(a) - groupIndex(b));
  if (toRun.length === 0) throw new NothingToRunError("No scenarios were approved, so there is nothing to run. Approve at least one scenario.");

  const signing = plan.account ? await signingIn(plan.account.id, options) : null;
  if (signing) secrets.addAccounts(signing.config);
  const selfRef = signing ? refOf(signing.account) : null;
  const wantsOther = toRun.some(needsOtherAccount);
  const sessions: { self?: SessionState; other?: SessionState } = {};
  const sessionItems: { self?: SessionStorageItems; other?: SessionStorageItems } = {};
  const credentialHeaders = createCredentialHeaders();
  const markers = signing ? [signing.account.username] : [];

  const startedAt = new Date(startedMs).toISOString();
  const dir = join(resolve(options.runsDir ?? "runs"), runId);
  const artifactsDir = join(dir, "artifacts");
  await mkdir(artifactsDir, { recursive: true });

  const results: CheckResult[] = [];
  const runToken = randomBytes(4).toString("hex");
  let testRecordsCreated = 0;
  const fileCounter = { value: 0 };
  const pagesVisited = new Map<string, string[]>();
  const recordVisit = (url: string, scenarioId: string) => {
    const ids = pagesVisited.get(url) ?? [];
    if (!ids.includes(scenarioId)) ids.push(scenarioId);
    pagesVisited.set(url, ids);
  };

  const signal = options.signal;
  const stopped = () => signal?.aborted === true;
  const whenStopped = new Promise<"stopped">((res) => {
    if (!signal) return;
    if (signal.aborted) res("stopped");
    else signal.addEventListener("abort", () => res("stopped"), { once: true });
  });
  let wasStopped = false;
  const skipRest = () => {
    for (const scenario of toRun) {
      if (results.some((r) => r.scenarioId === scenario.id)) continue;
      const result = skipped(scenario, STOPPED_NOTE);
      wasStopped = true;
      results.push(result);
      options.onProgress?.({ type: "scenario-end", scenarioId: scenario.id, result: redactDeep(result) });
    }
  };

  let browserName: string | undefined;
  if (stopped()) skipRest();
  else {
    engineStep(options, options.headed ? "Opening a browser window" : "Starting the browser", plan.target);
    const browser = await launchChromium(launchOptions(target, options));
    browserName = `Chromium ${browser.version()}`;
    options.onProgress?.({ type: "browser", name: browserName });
    try {
      if (signing) {
        try {
          engineStep(options, `Signing in as ${accountLabel(signing.account)}`, signing.account.loginUrl);
          const self = await signIn(browser, signing.account, safety);
          secrets.add(self.secrets);
          sessions.self = self.state;
          if (self.sessionStorage) sessionItems.self = self.sessionStorage;
          if (wantsOther && signing.other) {
            engineStep(options, `Signing in as ${accountLabel(signing.other)}`, signing.other.loginUrl);
            const other = await signIn(browser, signing.other, safety);
            secrets.add(other.secrets);
            sessions.other = other.state;
            if (other.sessionStorage) sessionItems.other = other.sessionStorage;
          }
          engineStep(options, "Opening the page signed in, to see how the app sends its session", plan.target);
          const shared = { sessions, sessionStorage: sessionItems, credentialHeaders, artifactsDir, safety };
          await preHarvest(browser, plan, "self", shared, signing.account);
          if (sessions.other && signing.other) await preHarvest(browser, plan, "other", shared, signing.other);
        } catch (err) {
          await rm(dir, { recursive: true, force: true }).catch(() => undefined);
          throw err;
        }
      }
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
        options.onProgress?.({ type: "scenario-end", scenarioId: scenario.id, result: redactDeep(result) });
      }
      if (stopped()) skipRest();
    } finally {
      await browser.close();
    }
  }

  async function runScenario(scenario: Scenario, browser: Browser): Promise<CheckResult> {
    if (signing && scenario.scope !== "page" && !NEVER_SUBMITS.has(scenario.checkId) && changesCredentials(formOfScenario(plan, scenario))) {
      return skipped(scenario, credentialFormNote(accountLabel(signing.account)));
    }
    if (scenario.destructive && !allowDestructive) {
      return skipped(scenario, "Destructive scenario; run again with --allow-destructive to include it.");
    }
    const check = checks.find((c) => c.id === scenario.checkId);
    if (!check) return { ...skipped(scenario, `No check registered for ${scenario.checkId}.`), status: "error" };
    if (needsOtherAccount(scenario) && !sessions.other) return skipped(scenario, noOtherAccountNote(signing));

    const log = options.log ?? ((line: string) => process.stderr.write(`${line}\n`));
    const scenarioId = scenario.id;
    const progress = options.onProgress;
    const steps: NonNullable<CheckResult["steps"]> = [];
    const withSteps = (result: CheckResult): CheckResult => (steps.length > 0 ? { ...result, steps: [...steps] } : result);
    let ended = false;
    const ctx = createCheckContext({
      browser,
      form: formOfScenario(plan, scenario),
      openForm: scenario.scope !== "page",
      discoveredPage: plan.page,
      targetUrl: plan.target,
      artifactsDir,
      allowDestructive,
      runToken,
      allowedHosts: safety.allowedHosts,
      lookup: safety.lookup,
      log: (message) => log(`[${scenario.id}] ${message}`),
      fileCounter,
      sessions,
      sessionStorage: sessionItems,
      accounts: { self: selfRef, other: sessions.other && signing?.other ? refOf(signing.other) : null },
      markers,
      credentialHeaders,
      checkId: scenario.checkId,
      scenarioTitle: scenario.title,
      onStep: (step) => {
        if (ended) return;
        steps.push(step);
        progress?.({ type: "step", scenarioId, ...step });
      },
      onPageLoad: (page) => {
        if (ended) return;
        recordVisit(page.url, scenarioId);
        progress?.({ type: "page", scenarioId, ...page });
      },
      onFrame:
        progress && options.live
          ? (frame) => {
              if (!ended) progress({ type: "frame", scenarioId, ...frame });
            }
          : undefined,
    });
    const started = Date.now();
    const base = { checkId: scenario.checkId, scenarioId: scenario.id };
    const limitMs = scenarioLimitMs(check, scenario, ctx.form, plan.page, options);
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<"timed-out">((res) => (timer = setTimeout(() => res("timed-out"), limitMs)));
    let abandoned: Promise<unknown> | undefined;
    try {
      const running = check.run(ctx, scenario);
      running.catch(() => undefined);
      const outcome = await Promise.race([running, whenStopped, timedOut]);
      if (outcome === "stopped" || outcome === "timed-out") abandoned = running;
      const interrupted = (note: string) => (check.interruptedNote ? `${note.replace(/\.?$/, ".")} ${check.interruptedNote}` : note);
      if (outcome === "stopped") {
        wasStopped = true;
        return withSteps({ ...skipped(scenario, stoppedNotes(ctx, interrupted)), durationMs: Date.now() - started });
      }
      if (outcome === "timed-out") {
        const notes = abandonedNotes(ctx, interrupted(scenarioTimeoutNote(limitMs)));
        return withSteps({ ...base, status: "error", findings: [], durationMs: Date.now() - started, notes });
      }
      const result = outcome;
      if (ctx.escaped.length > 0) {
        return withSteps({ ...base, status: "error", findings: [], durationMs: Date.now() - started, notes: escapedNotes(ctx, check, result.notes, false) });
      }
      const notes = [result.notes, ctx.blocked.length > 0 ? guardSummary(ctx) : null].filter(Boolean).join(" ");
      const findings = scenario.scopeLabel ? result.findings.map((f) => ({ ...f, scope: scenario.scopeLabel })) : result.findings;
      return withSteps({ ...result, ...base, findings, ...(notes ? { notes } : {}) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const notes = ctx.escaped.length > 0 ? escapedNotes(ctx, check, message, true) : redactSecrets(thrownNote(message));
      return withSteps({ ...base, status: "error", findings: [], durationMs: Date.now() - started, notes });
    } finally {
      clearTimeout(timer);
      ended = true;
      testRecordsCreated += ctx.testRecordsCreated();
      await ctx.dispose();
      if (abandoned) void abandoned.catch(() => undefined).then(() => ctx.dispose());
    }
  }

  const findings = results.flatMap((r) => r.findings);
  makeUnique(findings);
  let raw: Report = {
    runId,
    target: plan.target,
    startedAt,
    finishedAt: startedAt,
    durationMs: 0,
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
    options: { allowDestructive, headed: options.headed ?? false },
    ...(browserName ? { browser: browserName } : {}),
    accounts: { signedInAs: selfRef, other: sessions.other && signing?.other ? refOf(signing.other) : null },
  };
  const ai = options.ai;
  if (ai?.features.explain && findings.length > 0 && !stopped()) {
    const n = Math.min(findings.length, MAX_EXPLAINED);
    engineStep(options, `Asking ${modelLabel(ai.client)} to explain ${n} ${n === 1 ? "finding" : "findings"}`, plan.target);
    try {
      raw = await explainFindings(raw, ai.client, { remote: ai.remote, runToken, signal });
    } catch {
      // Only a stop rejects: the report is written without explanations.
    }
  }
  engineStep(options, "Writing the report", plan.target);
  const finishedMs = Date.now();
  const report: Report = redactReport({ ...raw, finishedAt: new Date(finishedMs).toISOString(), durationMs: finishedMs - startedMs });
  await writeReport(report, dir);
  return { report, dir };
}
