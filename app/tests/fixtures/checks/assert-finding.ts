/**
 * Shared assertions for check tests. They encode the Finding contract from src/core/types.ts and
 * docs/v0-spec.md: every finding is complete, plain-language, evidence-backed and ships a Playwright spec.
 */
import { readFileSync } from "node:fs";
import { expect } from "vitest";
import type { Category, CheckId, CheckResult, Finding, Severity } from "../../../src/core/types.js";

interface Bug {
  id: string;
  severity: Severity;
  category: Category;
  detectedBy: CheckId | null;
}

const bugs: Bug[] = (
  JSON.parse(readFileSync(new URL("../../../../fixtures/kennel/bugs.json", import.meta.url), "utf8")) as { bugs: Bug[] }
).bugs;

/** Ground-truth bug from fixtures/kennel/bugs.json. */
export function bug(id: string): Bug {
  const found = bugs.find((b) => b.id === id);
  if (!found) throw new Error(`unknown bug ${id}`);
  return found;
}

export function allFindings(results: CheckResult[]): Finding[] {
  return results.flatMap((r) => r.findings);
}

/** Every string anywhere in the finding, for "mentions X" assertions that don't depend on field layout. */
export function findingText(finding: Finding): string {
  return JSON.stringify(finding);
}

/** Asserts the structural contract every finding must meet. */
export function expectWellFormedFinding(
  finding: Finding,
  expected: { checkId: CheckId; category: Category; severity?: Severity; confidence?: Finding["confidence"] },
) {
  expect(finding.checkId).toBe(expected.checkId);
  expect(finding.category).toBe(expected.category);
  expect(["critical", "high", "medium", "low"]).toContain(finding.severity);
  if (expected.severity) expect(finding.severity).toBe(expected.severity);
  expect(["confirmed", "advisory"]).toContain(finding.confidence);
  if (expected.confidence) expect(finding.confidence).toBe(expected.confidence);

  expect(finding.id).toMatch(new RegExp(`^${expected.checkId}#`));
  for (const field of ["title", "meaning", "impact", "fix"] as const) {
    expect(finding[field], `finding.${field}`).toEqual(expect.any(String));
    expect(finding[field].trim().length, `finding.${field} is empty`).toBeGreaterThan(0);
  }

  expect(finding.evidence.length, "finding.evidence is empty").toBeGreaterThan(0);
  for (const ev of finding.evidence) {
    expect(["frame", "gif", "card", "screenshot", "network", "console", "dom", "axe", "note"]).toContain(ev.kind);
    expect(ev.label.trim().length).toBeGreaterThan(0);
    expect(ev.path !== undefined || ev.data !== undefined, "evidence needs a path or data").toBe(true);
  }

  expect(finding.spec, "finding.spec").toBeDefined();
  expect(finding.spec!.filename).toMatch(/\.spec\.ts$/);
  expect(finding.spec!.source).toContain("@playwright/test");
}

/** Finding ids must be unique within a run. */
export function expectUniqueIds(findings: Finding[]) {
  expect(new Set(findings.map((f) => f.id)).size).toBe(findings.length);
}

/** The plan contract shared by all checks: at least one scenario, owned by the check, non-destructive. */
export function expectPlanShape(scenarios: { checkId: string; destructive: boolean; id: string }[], checkId: CheckId) {
  expect(scenarios.length).toBeGreaterThan(0);
  for (const s of scenarios) {
    expect(s.checkId).toBe(checkId);
    expect(s.destructive).toBe(false);
  }
  expect(new Set(scenarios.map((s) => s.id)).size).toBe(scenarios.length);
}
