/**
 * Guards the accepted responses themselves and the comparison logic (no browser, no Kennel).
 */
import { readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { CHECK_IDS, type CheckResult, type Finding, type Report } from "../../../app/src/core/types.js";
import { compareToGolden, EXPECTED_DIR, lineDiff, loadGolden, loadBuiltBugs, observedGolden, validateGolden, type Golden } from "./golden.js";

const bugs = await loadBuiltBugs();

describe("golden files", () => {
  it("there is one golden file for clean mode and for every V0 bug, and nothing else", async () => {
    const files = (await readdir(EXPECTED_DIR)).filter((f) => f.endsWith(".json")).sort();
    expect(files).toEqual(["clean.json", ...bugs.map((b) => `${b.id}.json`)].sort());
  });

  it("clean.json: every check passes, zero findings", async () => {
    const g = await loadGolden("clean");
    expect(g).toMatchObject({ mode: "clean", mustFail: [], mustPass: "all-others", allowedSideEffects: [], expectedFindings: [] });
  });

  it.for(bugs)("$id.json is valid and requires detectedBy to fail at the bug's severity", async (bug) => {
    const g = await loadGolden(bug.id); // throws with the validation problems
    expect(bug.detectedBy).not.toBeNull();
    expect(g.mustFail).toContain(bug.detectedBy);
    expect(g.expectedFindings).toContainEqual(expect.objectContaining({ checkId: bug.detectedBy, severity: bug.severity }));
  });

  it("validateGolden rejects malformed files", () => {
    expect(validateGolden({ mode: "X", mustFail: ["nope"], mustPass: "all-others", allowedSideEffects: [], expectedFindings: [] })).not.toEqual([]);
    expect(validateGolden({ mode: "X", mustFail: ["dead-control"], mustPass: "all-others", allowedSideEffects: [], expectedFindings: [] })).toContain(
      "mustFail check dead-control has no expectedFindings entry",
    );
    expect(
      validateGolden({
        mode: "X",
        mustFail: [],
        mustPass: "all-others",
        allowedSideEffects: [{ checkId: "axe-states", reason: "" }],
        expectedFindings: [],
      }).join(),
    ).toMatch(/reason/);
    expect(validateGolden({ mode: "X", mustFail: [], mustPass: ["dead-control"], allowedSideEffects: [], expectedFindings: [], extra: 1 }).join()).toMatch(/unknown key/);
  });
});

// ---- comparison logic on synthetic reports ----

function finding(checkId: Finding["checkId"], title: string, severity: Finding["severity"] = "high"): Finding {
  return { checkId, id: `${checkId}#1`, title, severity, category: "broken-feature", confidence: "confirmed", meaning: "", impact: "", fix: "", evidence: [] };
}

function report(overrides: Partial<Record<(typeof CHECK_IDS)[number], { status: CheckResult["status"]; findings?: Finding[] }>> = {}): Report {
  const results: CheckResult[] = CHECK_IDS.map((checkId) => {
    const o = overrides[checkId] ?? { status: "pass" as const };
    return { checkId, scenarioId: `${checkId}:1`, status: o.status, findings: o.findings ?? [], durationMs: 1 };
  });
  return {
    runId: "r",
    target: "http://localhost:1/book",
    startedAt: "",
    finishedAt: "",
    durationMs: 0,
    runHoundVersion: "0.0.1",
    plan: { target: "", form: { url: "", selector: "form", name: "Book a sitter", fields: [], controls: [] }, scenarios: [], groups: [] },
    approved: [],
    results,
    findings: results.flatMap((r) => r.findings),
    summary: { critical: 0, high: 0, medium: 0, low: 0, passed: 0, failed: 0, errored: 0, skipped: 0 },
    groups: [],
    notVisible: [],
  };
}

const f01: Golden = {
  mode: "F01",
  mustFail: ["dead-control"],
  mustPass: "all-others",
  allowedSideEffects: [{ checkId: "axe-states", reason: "synthetic side effect for the test" }],
  expectedFindings: [{ checkId: "dead-control", severity: "high", titleIncludes: "save draft" }],
};

describe("compareToGolden", () => {
  it("accepts a clean report against a clean golden", () => {
    expect(compareToGolden(report(), { mode: "clean", mustFail: [], mustPass: "all-others", allowedSideEffects: [], expectedFindings: [] })).toEqual([]);
  });

  it("accepts the expected failure (title match is case-insensitive) and an allowed side effect either way", () => {
    const dead = { status: "fail" as const, findings: [finding("dead-control", '"Save draft" does nothing')] };
    expect(compareToGolden(report({ "dead-control": dead }), f01)).toEqual([]);
    expect(compareToGolden(report({ "dead-control": dead, "axe-states": { status: "fail", findings: [finding("axe-states", "x", "medium")] } }), f01)).toEqual([]);
  });

  it("rejects a missing failure, wrong severity, unexpected findings and errors", () => {
    expect(compareToGolden(report(), f01).join("\n")).toMatch(/expected dead-control to FAIL/);
    const wrongSeverity = report({ "dead-control": { status: "fail", findings: [finding("dead-control", "Save draft does nothing", "low")] } });
    expect(compareToGolden(wrongSeverity, f01).join("\n")).toMatch(/missing expected finding/);
    const extra = report({
      "dead-control": { status: "fail", findings: [finding("dead-control", "Save draft")] },
      "reflow-320": { status: "fail", findings: [finding("reflow-320", "Overflow")] },
    });
    expect(compareToGolden(extra, f01).join("\n")).toMatch(/expected reflow-320 to PASS[\s\S]*unexpected finding from reflow-320/);
    const errored = report({ "dead-control": { status: "fail", findings: [finding("dead-control", "Save draft")] }, "pii-leak": { status: "error" } });
    expect(compareToGolden(errored, f01).join("\n")).toMatch(/pii-leak: scenario pii-leak:1 errored/);
  });

  it("rejects checks that were never planned or only skipped", () => {
    const r = report();
    r.results = r.results.filter((x) => x.checkId !== "bundle-secrets").map((x) => (x.checkId === "reflow-320" ? { ...x, status: "skipped" as const } : x));
    const m = compareToGolden(r, { mode: "clean", mustFail: [], mustPass: "all-others", allowedSideEffects: [], expectedFindings: [] }).join("\n");
    expect(m).toMatch(/bundle-secrets: no scenario was planned or run/);
    expect(m).toMatch(/reflow-320: every scenario was skipped/);
  });

  it("ignores run ids, finding ids, timings and evidence paths", () => {
    const a = report({ "dead-control": { status: "fail", findings: [finding("dead-control", "Save draft")] } });
    const b = structuredClone(a);
    b.runId = "other";
    b.results = b.results.map((x) => ({ ...x, durationMs: 9999 }));
    b.findings = b.findings.map((f) => ({ ...f, id: "zzz", evidence: [{ kind: "screenshot", label: "s", path: "/elsewhere/x.png" }] }));
    expect(compareToGolden(a, f01)).toEqual(compareToGolden(b, f01));
  });
});

describe("UPDATE_GOLDEN helpers", () => {
  it("observedGolden reports unexpected failures as side effects to justify", () => {
    const r = report({
      "dead-control": { status: "fail", findings: [finding("dead-control", "Save draft")] },
      "reflow-320": { status: "fail", findings: [finding("reflow-320", "Overflow", "medium")] },
    });
    const o = observedGolden(r, f01, "F01");
    expect(o.mustFail).toEqual(["dead-control"]);
    expect(o.allowedSideEffects).toEqual([{ checkId: "reflow-320", reason: expect.stringMatching(/TODO/) }]);
  });

  it("lineDiff marks removed and added lines", () => {
    expect(lineDiff("a\nb\nc", "a\nx\nc")).toBe("  a\n- b\n+ x\n  c");
  });
});
