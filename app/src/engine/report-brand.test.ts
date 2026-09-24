import { describe, expect, it } from "vitest";
import type { Report } from "../core/types.js";
import { NOT_VISIBLE, renderHtml } from "./report.js";

/** A small report with a high and a medium finding, so both severity colours are in play. */
function report(): Report {
  const finding = (severity: "high" | "medium", n: number) => ({
    checkId: "double-submit" as const,
    id: `double-submit#${n}`,
    title: `Finding ${n}`,
    severity,
    category: "broken-feature" as const,
    confidence: "confirmed" as const,
    meaning: "m",
    impact: "i",
    fix: "f",
    evidence: [],
  });
  const findings = [finding("high", 1), finding("medium", 2)];
  return {
    runId: "run-brand",
    target: "http://127.0.0.1:3000/book",
    startedAt: "2026-09-22T10:00:00.000Z",
    finishedAt: "2026-09-22T10:00:05.000Z",
    durationMs: 5000,
    groups: [{ id: "features", label: "Features", scenarioIds: ["ds:1"], passed: 0, failed: 1, errored: 0, skipped: 0, findings: 2, durationMs: 5000 }],
    runHoundVersion: "0.1.0",
    plan: {
      target: "http://127.0.0.1:3000/book",
      form: { url: "http://127.0.0.1:3000/book", selector: "form", name: "Book", fields: [], controls: [] },
      scenarios: [{ id: "ds:1", checkId: "double-submit", title: "Double-click submit", description: "d", kind: "danger", priority: "high", destructive: false, defaultSelected: true }],
      groups: [{ id: "features", label: "Features", scenarioIds: ["ds:1"] }],
    },
    approved: ["ds:1"],
    results: [{ checkId: "double-submit", scenarioId: "ds:1", status: "fail", findings, durationMs: 5000 }],
    findings,
    summary: { critical: 0, high: 1, medium: 1, low: 0, passed: 0, failed: 1, errored: 0, skipped: 0 },
    notVisible: NOT_VISIBLE,
  } satisfies Report;
}

describe("report.html brand", () => {
  it("uses the mint accent", () => {
    expect(renderHtml(report()).toLowerCase()).toContain("#5ee6a3");
  });

  it("keeps the old amber only as the warn token", () => {
    const html = renderHtml(report()).toLowerCase();
    expect(html.replace(/--warn\s*:\s*#f5b642/g, "")).not.toContain("#f5b642");
    expect(html).not.toMatch(/--amber\b/);
  });

  it("shows the logo mark as an embedded image named Run Hound", () => {
    const img = /<img\b[^>]*\balt="Run Hound"[^>]*>/.exec(renderHtml(report()));
    expect(img, "an <img alt=\"Run Hound\">").not.toBeNull();
    expect(img![0]).toMatch(/src="data:image\/png;base64,[A-Za-z0-9+/=]{100,}"/);
  });
});
