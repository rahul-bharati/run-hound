/** Shared assertions for the behaviour-check tests. */
import { expect } from "vitest";
import { CHECK_IDS, type Category, type Check, type CheckId, type CheckResult, type DiscoveredForm, type Finding, type Scenario, type Severity } from "../../../../src/core/types.js";
import { overallStatus } from "../../../../test-support/harness.js";

/** The check module's export is well-formed and matches its file name. */
export function expectCheckShape(check: Check, id: CheckId, category: Category) {
  expect(check.id).toBe(id);
  expect(CHECK_IDS).toContain(check.id);
  expect(check.category).toBe(category);
  expect(check.title.trim().length).toBeGreaterThan(0);
  expect(typeof check.plan).toBe("function");
  expect(typeof check.run).toBe("function");
}

/**
 * plan(form) proposes at least one scenario of the documented kind; every scenario belongs to the
 * check, has a unique id, is non-destructive and selected by default.
 */
export function expectPlan(check: Check, form: DiscoveredForm, kind: Scenario["kind"]): Scenario[] {
  const scenarios = check.plan(form);
  expect(scenarios.length).toBeGreaterThanOrEqual(1);
  expect(new Set(scenarios.map((s) => s.id)).size).toBe(scenarios.length);
  for (const s of scenarios) {
    expect(s.checkId).toBe(check.id);
    expect(s.kind).toBe(kind);
    expect(s.destructive).toBe(false);
    expect(s.defaultSelected).toBe(true);
    expect(["high", "medium", "low"]).toContain(s.priority);
    expect(s.title.trim().length).toBeGreaterThan(0);
    expect(s.description.trim().length).toBeGreaterThan(0);
  }
  return scenarios;
}

/** Every scenario ran and passed with zero findings. */
export function expectCleanPass(results: CheckResult[], checkId: CheckId) {
  expect(results.length).toBeGreaterThanOrEqual(1);
  const detail = JSON.stringify(results.map((r) => ({ status: r.status, notes: r.notes, findings: r.findings.map((f) => f.title) })));
  expect(overallStatus(results), detail).toBe("pass");
  for (const r of results) {
    expect(r.checkId).toBe(checkId);
    expect(r.findings, detail).toEqual([]);
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  }
}

/** Overall "fail" with at least one well-formed confirmed finding; returns every finding. */
export function expectFailure(
  results: CheckResult[],
  checkId: CheckId,
  category: Category,
  severities: Severity[],
): Finding[] {
  const detail = JSON.stringify(results.map((r) => ({ status: r.status, notes: r.notes })));
  expect(overallStatus(results), detail).toBe("fail");
  const findings = results.flatMap((r) => r.findings);
  expect(findings.length).toBeGreaterThanOrEqual(1);
  for (const r of results) {
    expect(r.checkId).toBe(checkId);
    if (r.status === "fail") expect(r.findings.length).toBeGreaterThanOrEqual(1);
  }
  for (const f of findings) expectWellFormedFinding(f, checkId, category, severities);
  expect(new Set(findings.map((f) => f.id)).size).toBe(findings.length);
  return findings;
}

export function expectWellFormedFinding(f: Finding, checkId: CheckId, category: Category, severities: Severity[]) {
  expect(f.checkId).toBe(checkId);
  expect(f.id.length).toBeGreaterThan(0);
  expect(f.title.trim().length).toBeGreaterThan(0);
  expect(f.category).toBe(category);
  expect(severities).toContain(f.severity);
  expect(f.confidence).toBe("confirmed");
  expect(f.meaning.trim().length).toBeGreaterThan(0);
  expect(f.impact.trim().length).toBeGreaterThan(0);
  expect(f.fix.trim().length).toBeGreaterThan(0);
  expect(f.evidence.length).toBeGreaterThanOrEqual(1);
  for (const e of f.evidence) {
    expect(["screenshot", "network", "console", "dom", "axe", "note"]).toContain(e.kind);
    expect(e.label.trim().length).toBeGreaterThan(0);
  }
  expect(f.spec).toBeDefined();
  expect(f.spec!.filename).toMatch(/\.spec\.ts$/);
  expect(f.spec!.source).toContain("@playwright/test");
}

/** Everything a reader of the finding sees, as one searchable string. */
export function findingText(f: Finding): string {
  return [f.title, f.location ?? "", f.meaning, f.impact, f.fix, JSON.stringify(f.evidence)].join("\n");
}

/** Evidence only (labels + data), as one searchable string. */
export function evidenceText(findings: Finding[]): string {
  return JSON.stringify(findings.map((f) => f.evidence));
}
