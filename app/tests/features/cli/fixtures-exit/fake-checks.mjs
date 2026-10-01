// Fake checks exercise exit codes without opening pages after discovery.
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
      if (mode === "errored" || (mode === "partly-errored" && checkId === "silent-failure")) {
        throw new Error("The app closed the connection without answering.");
      }
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
