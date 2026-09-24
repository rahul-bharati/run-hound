/**
 * Fake check library for test/cli-exit.test.ts. RH_FAKE_FINDINGS picks what the run finds:
 *   none       - two passing scenarios
 *   advisory   - one advisory finding (dead-control), nothing confirmed
 *   confirmed  - one confirmed finding (silent-failure), nothing advisory
 *   mixed      - one advisory and one confirmed finding
 *   skipped    - both scenarios skip, with a note that starts "Skipped: " like the real checks' notes
 * No page is opened, so the run is fast and depends only on the target passing the safety gate and having a form.
 */
const mode = process.env.RH_FAKE_FINDINGS ?? "none";

function scenario(checkId, id) {
  return { id, checkId, title: `Fake ${id}`, description: "Fake scenario for exit-code tests; creates nothing.", kind: "golden", priority: "medium", destructive: false, defaultSelected: true };
}

function finding(checkId, confidence) {
  return {
    checkId,
    id: `${checkId}#1`,
    title: `Fake ${confidence} finding`,
    severity: confidence === "confirmed" ? "high" : "low",
    category: "broken-feature",
    confidence,
    meaning: `A fake ${confidence} finding.`,
    impact: "None; this is a test.",
    fix: "Nothing to fix.",
    location: "Book button",
    evidence: [{ kind: "note", label: "fake" }],
  };
}

function fakeCheck(checkId, confidence, emits) {
  return {
    id: checkId,
    title: `Fake ${checkId}`,
    category: "broken-feature",
    plan: () => [scenario(checkId, `${checkId}:fake`)],
    run: async (_ctx, s) => {
      if (mode === "skipped") {
        return { checkId, scenarioId: s.id, status: "skipped", findings: [], notes: "Skipped: the fake form has nothing to check.", durationMs: 1 };
      }
      const findings = emits.includes(mode) ? [finding(checkId, confidence)] : [];
      return { checkId, scenarioId: s.id, status: findings.length ? "fail" : "pass", findings, durationMs: 1 };
    },
  };
}

export const checks = [
  fakeCheck("dead-control", "advisory", ["advisory", "mixed"]),
  fakeCheck("silent-failure", "confirmed", ["confirmed", "mixed"]),
];
