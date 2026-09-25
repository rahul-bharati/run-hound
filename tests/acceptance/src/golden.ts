/**
 * Accepted responses (golden files) for Kennel: loading, validation, comparison and the
 * UPDATE_GOLDEN review diff. Schema documented in fixtures/kennel/expected/README.md.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CHECK_IDS, type CheckId, type CheckResult, type Report, type ResultStatus, type Severity } from "../../../app/src/core/types.js";
import { KENNEL_DIR } from "./kennel.js";

export const EXPECTED_DIR = join(KENNEL_DIR, "expected");
const SEVERITIES: readonly Severity[] = ["critical", "high", "medium", "low"];

export interface ExpectedFinding {
  checkId: CheckId;
  severity: Severity;
  /** Case-insensitive substring of the finding title. */
  titleIncludes?: string;
}

export interface Golden {
  /** "clean" or a V0/V1 bug id. */
  mode: string;
  /** Checks that must fail with at least one finding. */
  mustFail: CheckId[];
  /** Checks that must pass with zero findings. "all-others" = every check not in mustFail or allowedSideEffects. */
  mustPass: "all-others" | CheckId[];
  /** Checks that may pass or fail in this mode (never error), each with a written justification. */
  allowedSideEffects: { checkId: CheckId; reason: string }[];
  /** Each entry must be matched by at least one observed finding. */
  expectedFindings: ExpectedFinding[];
  /** Free text: side effects considered and rejected, open questions. Ignored by the comparison. */
  notes?: string;
}

export interface BugEntry {
  id: string;
  version: string;
  category: string;
  severity: Severity;
  title: string;
  detectedBy: CheckId | null;
}

export async function loadBugs(): Promise<BugEntry[]> {
  const raw = JSON.parse(await readFile(join(KENNEL_DIR, "bugs.json"), "utf8")) as { bugs: BugEntry[] };
  return raw.bugs;
}

/** Bugs Kennel builds today (V0 and V1); later versions are listed in bugs.json but not built yet. */
export async function loadBuiltBugs(): Promise<BugEntry[]> {
  return (await loadBugs()).filter((b) => b.version === "V0" || b.version === "V1");
}

/** @deprecated use loadBuiltBugs: V0 bugs only. */
export async function loadV0Bugs(): Promise<BugEntry[]> {
  return (await loadBugs()).filter((b) => b.version === "V0");
}

export async function loadGolden(mode: string): Promise<Golden> {
  const golden = JSON.parse(await readFile(join(EXPECTED_DIR, `${mode}.json`), "utf8")) as unknown;
  const problems = validateGolden(golden, mode);
  if (problems.length > 0) throw new Error(`Invalid golden file ${mode}.json:\n  - ${problems.join("\n  - ")}`);
  return golden as Golden;
}

const isCheckId = (v: unknown): v is CheckId => typeof v === "string" && (CHECK_IDS as readonly string[]).includes(v);

/** Structural validation of a golden file. Returns human-readable problems (empty when valid). */
export function validateGolden(value: unknown, mode?: string): string[] {
  const p: string[] = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) return ["not a JSON object"];
  const g = value as Record<string, unknown>;
  const known = new Set(["$comment", "mode", "mustFail", "mustPass", "allowedSideEffects", "expectedFindings", "notes"]);
  for (const k of Object.keys(g)) if (!known.has(k)) p.push(`unknown key "${k}"`);

  if (typeof g.mode !== "string") p.push("mode must be a string");
  else if (mode !== undefined && g.mode !== mode) p.push(`mode is "${g.mode}", expected "${mode}"`);

  const mustFail = Array.isArray(g.mustFail) ? g.mustFail : (p.push("mustFail must be an array"), []);
  for (const c of mustFail) if (!isCheckId(c)) p.push(`mustFail: unknown check id ${JSON.stringify(c)}`);
  if (new Set(mustFail).size !== mustFail.length) p.push("mustFail has duplicates");

  const side = Array.isArray(g.allowedSideEffects) ? g.allowedSideEffects : (p.push("allowedSideEffects must be an array"), []);
  const sideIds: unknown[] = [];
  for (const s of side) {
    const e = s as Record<string, unknown>;
    if (typeof e !== "object" || e === null || !isCheckId(e.checkId)) p.push(`allowedSideEffects: bad entry ${JSON.stringify(s)}`);
    else if (typeof e.reason !== "string" || e.reason.trim().length < 10) p.push(`allowedSideEffects[${String(e.checkId)}]: reason must justify the side effect`);
    sideIds.push(e?.checkId);
  }
  if (new Set(sideIds).size !== sideIds.length) p.push("allowedSideEffects has duplicates");
  for (const c of sideIds) if (mustFail.includes(c)) p.push(`${String(c)} is both mustFail and an allowed side effect`);

  if (g.mustPass !== "all-others") {
    if (!Array.isArray(g.mustPass)) p.push('mustPass must be "all-others" or an array of check ids');
    else {
      for (const c of g.mustPass) {
        if (!isCheckId(c)) p.push(`mustPass: unknown check id ${JSON.stringify(c)}`);
        if (mustFail.includes(c) || sideIds.includes(c)) p.push(`${String(c)} is in mustPass and in mustFail/allowedSideEffects`);
      }
    }
  }

  const findings = Array.isArray(g.expectedFindings) ? g.expectedFindings : (p.push("expectedFindings must be an array"), []);
  for (const f of findings) {
    const e = f as Record<string, unknown>;
    if (typeof e !== "object" || e === null) {
      p.push(`expectedFindings: bad entry ${JSON.stringify(f)}`);
      continue;
    }
    if (!isCheckId(e.checkId)) p.push(`expectedFindings: unknown check id ${JSON.stringify(e.checkId)}`);
    else if (!mustFail.includes(e.checkId) && !sideIds.includes(e.checkId)) p.push(`expectedFindings: ${e.checkId} is not in mustFail or allowedSideEffects`);
    if (!SEVERITIES.includes(e.severity as Severity)) p.push(`expectedFindings: bad severity ${JSON.stringify(e.severity)}`);
    if (e.titleIncludes !== undefined && (typeof e.titleIncludes !== "string" || e.titleIncludes.length === 0)) p.push("expectedFindings: titleIncludes must be a non-empty string");
  }
  for (const c of mustFail) if (!findings.some((f) => (f as ExpectedFinding)?.checkId === c)) p.push(`mustFail check ${String(c)} has no expectedFindings entry`);
  if (g.notes !== undefined && typeof g.notes !== "string") p.push("notes must be a string");
  return p;
}

/** Collapses a check's scenario results: fail > error > pass > skipped. Undefined when the check has no results. */
export function checkStatus(results: CheckResult[]): ResultStatus | undefined {
  if (results.length === 0) return undefined;
  if (results.some((r) => r.status === "fail")) return "fail";
  if (results.some((r) => r.status === "error")) return "error";
  if (results.some((r) => r.status === "pass")) return "pass";
  return "skipped";
}

function byCheck(report: Report) {
  const map = new Map<CheckId, { status: ResultStatus | undefined; results: CheckResult[]; findings: Report["findings"] }>();
  for (const id of CHECK_IDS) {
    const results = report.results.filter((r) => r.checkId === id);
    map.set(id, { status: checkStatus(results), results, findings: report.findings.filter((f) => f.checkId === id) });
  }
  return map;
}

function mustPassIds(golden: Golden): CheckId[] {
  if (golden.mustPass !== "all-others") return golden.mustPass;
  const excluded = new Set<CheckId>([...golden.mustFail, ...golden.allowedSideEffects.map((s) => s.checkId)]);
  return CHECK_IDS.filter((id) => !excluded.has(id));
}

const describe = (id: CheckId, s: { status: ResultStatus | undefined; results: CheckResult[]; findings: Report["findings"] }) =>
  `${id}: status ${s.status ?? "not run"}, ${s.findings.length} finding(s)` +
  (s.findings.length ? ` [${s.findings.map((f) => `${f.severity} "${f.title}"`).join("; ")}]` : "") +
  (s.results.some((r) => r.notes) ? ` notes: ${s.results.map((r) => r.notes).filter(Boolean).join(" | ")}` : "");

/**
 * Compares a report with a golden file. Returns mismatches (empty = accepted).
 * Ignores timings, run ids, finding ids, evidence and artifact paths.
 */
export function compareToGolden(report: Report, golden: Golden): string[] {
  const m: string[] = [];
  const checks = byCheck(report);

  // Every check must have planned and run at least one non-skipped scenario, and nothing may error.
  for (const [id, s] of checks) {
    if (s.status === undefined) m.push(`${id}: no scenario was planned or run`);
    else if (s.status === "skipped") m.push(`${id}: every scenario was skipped (${s.results.map((r) => r.notes ?? "no note").join(" | ")})`);
    for (const r of s.results) if (r.status === "error") m.push(`${id}: scenario ${r.scenarioId} errored: ${r.notes ?? "no note"}`);
  }

  // Findings and statuses must agree (a failed result carries findings; a passed one carries none).
  for (const r of report.results) {
    if (r.status === "fail" && r.findings.length === 0) m.push(`${r.checkId}: scenario ${r.scenarioId} failed without a finding`);
    if (r.status === "pass" && r.findings.length > 0) m.push(`${r.checkId}: scenario ${r.scenarioId} passed but has findings`);
  }

  for (const id of golden.mustFail) {
    const s = checks.get(id)!;
    if (s.status !== "fail" || s.findings.length === 0) m.push(`expected ${id} to FAIL with a finding; got ${describe(id, s)}`);
  }
  for (const id of mustPassIds(golden)) {
    const s = checks.get(id)!;
    if (s.status !== "pass" || s.findings.length > 0) m.push(`expected ${id} to PASS with no findings; got ${describe(id, s)}`);
  }
  for (const { checkId } of golden.allowedSideEffects) {
    const s = checks.get(checkId)!;
    if (s.status !== "pass" && s.status !== "fail") m.push(`allowed side effect ${checkId} may pass or fail but got ${describe(checkId, s)}`);
  }

  const allowed = new Set<CheckId>([...golden.mustFail, ...golden.allowedSideEffects.map((s) => s.checkId)]);
  for (const f of report.findings) {
    if (!allowed.has(f.checkId)) m.push(`unexpected finding from ${f.checkId}: ${f.severity} "${f.title}"`);
  }

  for (const e of golden.expectedFindings) {
    const hit = report.findings.some(
      (f) =>
        f.checkId === e.checkId &&
        f.severity === e.severity &&
        (e.titleIncludes === undefined || f.title.toLowerCase().includes(e.titleIncludes.toLowerCase())),
    );
    if (!hit) {
      const got = report.findings.filter((f) => f.checkId === e.checkId).map((f) => `${f.severity} "${f.title}"`);
      m.push(
        `missing expected finding: ${e.checkId} ${e.severity}${e.titleIncludes ? ` title~"${e.titleIncludes}"` : ""}; ` +
          `observed from ${e.checkId}: ${got.length ? got.join("; ") : "none"}`,
      );
    }
  }
  return m;
}

/**
 * Golden-shaped summary of what a run actually produced, for human review (UPDATE_GOLDEN=1).
 * Carries over the current golden's side-effect reasons and notes so the diff shows only behaviour.
 */
export function observedGolden(report: Report, current: Golden | undefined, mode: string): Golden {
  const checks = byCheck(report);
  const failing = CHECK_IDS.filter((id) => checks.get(id)!.status === "fail");
  const expectedFail = new Set(current?.mustFail ?? []);
  const mustFail = failing.filter((id) => expectedFail.has(id) || !current);
  const side = failing
    .filter((id) => !mustFail.includes(id))
    .map((checkId) => ({
      checkId,
      reason: current?.allowedSideEffects.find((s) => s.checkId === checkId)?.reason ?? "TODO: justify or fix (observed failing)",
    }));
  const expectedFindings: ExpectedFinding[] = report.findings.map((f) => ({ checkId: f.checkId, severity: f.severity, titleIncludes: f.title }));
  const out: Golden = { mode, mustFail, mustPass: "all-others", allowedSideEffects: side, expectedFindings };
  if (current?.notes) out.notes = current.notes;
  const nonPass = CHECK_IDS.filter((id) => !["pass", "fail"].includes(checks.get(id)!.status ?? "not run"));
  if (nonPass.length) out.notes = `${out.notes ?? ""} OBSERVED NOT PASS/FAIL: ${nonPass.map((id) => `${id}=${checks.get(id)!.status ?? "not run"}`).join(", ")}`.trim();
  return out;
}

/** Minimal line diff (LCS) for review output: "-" current golden, "+" observed. */
export function lineDiff(a: string, b: string): string {
  const x = a.split("\n");
  const y = b.split("\n");
  const dp: number[][] = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i--)
    for (let j = y.length - 1; j >= 0; j--)
      dp[i]![j] = x[i] === y[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) {
      out.push(`  ${x[i]}`);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) out.push(`- ${x[i++]}`);
    else out.push(`+ ${y[j++]}`);
  }
  while (i < x.length) out.push(`- ${x[i++]}`);
  while (j < y.length) out.push(`+ ${y[j++]}`);
  return out.join("\n");
}
