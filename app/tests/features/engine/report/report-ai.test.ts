import { describe, expect, it } from "vitest";
import type { Finding, Report } from "../core/types.js";
import { NOT_VISIBLE, renderHtml, renderMarkdown } from "./report.js";

/** Report rendering of the AI fields (docs/ai-spec.md "Surfaces" → Reports). */

const FORM = {
  url: "http://127.0.0.1:3000/book",
  selector: "form",
  name: "Book a sitter",
  fields: [{ key: "petName", accessibleName: "Pet name", label: "Pet name", placeholder: null, type: "text", role: "textbox", required: true, selector: "#petName" }],
  controls: [{ accessibleName: "Book", text: "Book", role: "button", tag: "button", selector: "button", isSubmit: true }],
};

function finding(ai?: Finding["ai"]): Finding {
  return {
    checkId: "silent-failure",
    id: "silent-failure#1",
    title: "Booking fails silently",
    severity: "high",
    category: "broken-feature",
    confidence: "confirmed",
    meaning: "Nothing is shown when saving fails.",
    impact: "People think they booked.",
    fix: "Show an error message.",
    evidence: [],
    ...(ai ? { ai } : {}),
  };
}

function report(options: { ai: boolean }): Report {
  const f = finding(
    options.ai ? { summary: "The page stays <quiet> when the server fails.", askYourAi: "Add an error <div role=alert> to the booking form.", model: "ollama/fake:9b" } : undefined,
  );
  return {
    runId: "run-ai",
    target: "http://127.0.0.1:3000/book",
    startedAt: "2026-09-25T10:00:00.000Z",
    finishedAt: "2026-09-25T10:01:00.000Z",
    durationMs: 60_000,
    groups: [{ id: "features", label: "Features", scenarioIds: ["sf:1", "ai-flow:1"], passed: 1, failed: 1, errored: 0, skipped: 0, findings: 1, durationMs: 10 }],
    runHoundVersion: "0.3.0",
    plan: {
      target: "http://127.0.0.1:3000/book",
      form: FORM,
      page: { url: FORM.url, title: "Book", forms: [FORM], controls: [], links: 0 },
      scenarios: [
        {
          id: "sf:1",
          checkId: "silent-failure",
          title: "Server error is shown",
          description: "d",
          kind: "danger",
          priority: "high",
          destructive: false,
          defaultSelected: true,
          ...(options.ai ? { ai: { rationale: "Bookings <must> not fail silently.", recommended: true } } : {}),
        },
        ...(options.ai
          ? [
              {
                id: "ai-flow:1",
                checkId: "ai-flow" as const,
                title: "Book Rex",
                description: "Main job.",
                kind: "golden" as const,
                priority: "medium" as const,
                destructive: false,
                defaultSelected: false,
                scope: "form" as const,
                formIndex: 0,
                flow: [
                  { action: "fill" as const, field: "petName", value: "Rex" },
                  { action: "click" as const, control: 0 },
                  { action: "expect" as const, expect: "request-ok" as const, text: null },
                ],
                ai: { rationale: "Booking is the main job.", recommended: true, suggested: true },
              },
            ]
          : []),
      ],
      groups: [{ id: "features", label: "Features", scenarioIds: options.ai ? ["sf:1", "ai-flow:1"] : ["sf:1"] }],
      ...(options.ai
        ? { ai: { provider: "ollama", model: "fake:9b", remote: false, warnings: ["Left out a flow: <bad>"], reviewedAt: "2026-09-25T10:00:00.000Z", reviewed: true, suggested: 1 } }
        : {}),
    },
    approved: options.ai ? ["sf:1", "ai-flow:1"] : ["sf:1"],
    results: [
      { checkId: "silent-failure", scenarioId: "sf:1", status: "fail", findings: [f], durationMs: 5 },
      ...(options.ai ? [{ checkId: "ai-flow" as const, scenarioId: "ai-flow:1", status: "pass" as const, findings: [], durationMs: 5 }] : []),
    ],
    findings: [f],
    summary: { critical: 0, high: 1, medium: 0, low: 0, passed: options.ai ? 1 : 0, failed: 1, errored: 0, skipped: 0 },
    notVisible: NOT_VISIBLE,
    ...(options.ai ? { ai: { provider: "ollama", model: "fake:9b", remote: false, warnings: ["Could not explain a finding: timeout"], explained: 1 } } : {}),
  };
}

describe("Markdown report with AI", () => {
  const md = renderMarkdown(report({ ai: true }));

  it("names the model in the header", () => {
    expect(md).toContain("Planned with help from ollama/fake:9b");
  });

  it("shows the rationale and the suggested flow's steps in human words", () => {
    expect(md).toContain("AI: recommended — Bookings <must> not fail silently.");
    expect(md).toContain("Suggested by AI — Booking is the main job.");
    expect(md).toContain('1. Type "Rex" into Pet name');
    expect(md).toContain("2. Click Book");
    expect(md).toContain("3. Check that a save request reaches the app and succeeds");
  });

  it("adds the explanation after the built-in fix, labelled advisory", () => {
    const fix = md.indexOf("- Fix: Show an error message.");
    const ai = md.indexOf("AI explanation (advisory");
    expect(fix).toBeGreaterThan(-1);
    expect(ai).toBeGreaterThan(fix);
    expect(md).toContain("Ask your AI: Add an error <div role=alert> to the booking form.");
  });

  it("lists the AI warnings", () => {
    expect(md).toContain("## AI notes");
    expect(md).toContain("Left out a flow: <bad>");
    expect(md).toContain("Could not explain a finding: timeout");
  });
});

describe("HTML report with AI", () => {
  const html = renderHtml(report({ ai: true }));

  it("escapes every AI text", () => {
    expect(html).toContain("Planned with help from ollama/fake:9b");
    expect(html).toContain("Bookings &lt;must&gt; not fail silently.");
    expect(html).toContain("The page stays &lt;quiet&gt; when the server fails.");
    expect(html).toContain("Add an error &lt;div role=alert&gt; to the booking form.");
    expect(html).toContain("Left out a flow: &lt;bad&gt;");
    expect(html).not.toContain("<quiet>");
    expect(html).not.toContain("<div role=alert>");
  });

  it("shows the explanation after the built-in fix and the flow's steps", () => {
    expect(html.indexOf("AI explanation (advisory)")).toBeGreaterThan(html.indexOf("<dt>Fix</dt>"));
    expect(html).toContain("Ask your AI");
    expect(html).toContain("<li>Type &quot;Rex&quot; into Pet name</li>");
    expect(html).toContain("<li>Click Book</li>");
  });
});

describe("reports without AI", () => {
  it("say nothing about AI", () => {
    const r = report({ ai: false });
    for (const text of [renderMarkdown(r), renderHtml(r)]) {
      expect(text).not.toContain("Planned with help");
      expect(text).not.toContain("AI explanation");
      expect(text).not.toContain("AI notes");
      expect(text).not.toContain("Suggested by AI");
    }
  });
});
