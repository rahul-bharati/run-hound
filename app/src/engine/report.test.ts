import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Finding, Report } from "../core/types.js";
import { NotImplementedError } from "./errors.js";
import { NOT_VISIBLE, renderHtml, renderMarkdown, writeReport } from "./report.js";

/** Obviously fake, but shaped like a real OpenAI project key so the redactor must catch it. */
const FAKE_SECRET = "sk-proj-FAKEFAKEfake1234567890abcdefghijklmnopqrstuvwxyzABCDEFGH";

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    checkId: "double-submit",
    id: "double-submit#1",
    title: "Double click books twice",
    severity: "high",
    category: "broken-feature",
    confidence: "confirmed",
    meaning: "Clicking Book twice quickly sends two bookings.",
    impact: "Customers get charged twice.",
    fix: "Disable the Book button while the request is pending.",
    location: "Book button",
    evidence: [{ kind: "network", label: "Create requests", data: { count: 2 } }],
    spec: { filename: "double-submit-1.spec.ts", source: 'import { test } from "@playwright/test";\ntest("double submit", async () => {});\n' },
    ...overrides,
  };
}

function makeReport(findings: Finding[]): Report {
  return {
    runId: "run-2026-09-22-abc",
    target: "http://127.0.0.1:3000/book",
    startedAt: "2026-09-22T10:00:00.000Z",
    finishedAt: "2026-09-22T10:01:00.000Z",
    runHoundVersion: "0.0.1",
    plan: {
      target: "http://127.0.0.1:3000/book",
      form: { url: "http://127.0.0.1:3000/book", selector: "form", name: "Book a sitter", fields: [], controls: [] },
      scenarios: [
        { id: "ds:1", checkId: "double-submit", title: "Double-click submit", description: "d", kind: "danger", priority: "high", destructive: false, defaultSelected: true },
        { id: "rf:1", checkId: "reflow-320", title: "Reflow at 320px", description: "r", kind: "golden", priority: "medium", destructive: false, defaultSelected: true },
      ],
    },
    approved: ["ds:1", "rf:1"],
    results: [
      { checkId: "double-submit", scenarioId: "ds:1", status: "fail", findings, durationMs: 1200 },
      { checkId: "reflow-320", scenarioId: "rf:1", status: "pass", findings: [], durationMs: 300, notes: "No horizontal overflow" },
    ],
    findings,
    summary: { critical: 0, high: findings.length, medium: 0, low: 0, passed: 1, failed: 1, errored: 0, skipped: 0 },
    notVisible: NOT_VISIBLE,
  };
}

describe("NOT_VISIBLE", () => {
  it("is a non-empty list", () => {
    expect(NOT_VISIBLE.length).toBeGreaterThan(0);
  });
});

describe("renderMarkdown", () => {
  it("contains the findings with meaning, impact and fix", () => {
    const md = renderMarkdown(makeReport([makeFinding()]));
    expect(md).toContain("Double click books twice");
    expect(md).toContain("Clicking Book twice quickly sends two bookings.");
    expect(md).toContain("Customers get charged twice.");
    expect(md).toContain("Disable the Book button while the request is pending.");
    expect(md.toLowerCase()).toContain("high");
    expect(md).toContain("http://127.0.0.1:3000/book");
  });

  it("lists every not-visible item", () => {
    const md = renderMarkdown(makeReport([makeFinding()]));
    for (const item of NOT_VISIBLE) expect(md).toContain(item);
  });

  it("lists passed checks", () => {
    const md = renderMarkdown(makeReport([makeFinding()]));
    expect(md).toContain("reflow-320");
  });

  it("still lists not-visible items on a clean report", () => {
    const md = renderMarkdown(makeReport([]));
    for (const item of NOT_VISIBLE) expect(md).toContain(item);
  });
});

describe("renderHtml", () => {
  it("is a full, self-contained HTML document", () => {
    const html = renderHtml(makeReport([makeFinding()]));
    expect(html.trimStart().toLowerCase().startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<style");
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/<link[^>]+href=["']?https?:/i);
    expect(html).not.toMatch(/<img[^>]+src=["']?https?:/i);
  });

  it("contains findings and not-visible items", () => {
    const html = renderHtml(makeReport([makeFinding()]));
    expect(html).toContain("Double click books twice");
    expect(html).toContain("Disable the Book button while the request is pending.");
    for (const item of NOT_VISIBLE) expect(html).toContain(item);
  });

  it("escapes HTML in report text", () => {
    const html = renderHtml(
      makeReport([
        makeFinding({
          title: '<script>alert("pwned")</script>',
          meaning: "Tag <img src=x onerror=alert(1)> in meaning & more",
          location: '"quoted" <b>place</b>',
        }),
      ]),
    );
    expect(html).not.toContain('<script>alert("pwned")</script>');
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).not.toContain("<b>place</b>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp; more");
    expect(html).not.toMatch(/<script(\s|>)/i);
  });
});

describe("writeReport", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "rh-report-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes report.json, report.md, report.html and spec files", async () => {
    const report = makeReport([makeFinding()]);
    await writeReport(report, dir);
    const entries = await readdir(dir);
    expect(entries).toEqual(expect.arrayContaining(["report.json", "report.md", "report.html", "specs"]));

    const parsed = JSON.parse(await readFile(join(dir, "report.json"), "utf8")) as Report;
    expect(parsed.runId).toBe(report.runId);
    expect(parsed.findings).toHaveLength(1);
    expect(parsed.notVisible).toEqual(NOT_VISIBLE);

    expect(await readFile(join(dir, "report.md"), "utf8")).toContain("Double click books twice");
    expect(await readFile(join(dir, "report.html"), "utf8")).toContain("Double click books twice");
    expect(await readFile(join(dir, "specs", "double-submit-1.spec.ts"), "utf8")).toBe(makeFinding().spec!.source);
  });

  it("works without any spec files", async () => {
    await writeReport(makeReport([]), dir);
    expect(await readdir(dir)).toEqual(expect.arrayContaining(["report.json", "report.md", "report.html"]));
  });

  it("redacts secrets in every artifact", async () => {
    const finding = makeFinding({
      id: "bundle-secrets#1",
      checkId: "bundle-secrets",
      title: `Secret key ${FAKE_SECRET} in bundle`,
      meaning: `The bundle contains ${FAKE_SECRET}.`,
      evidence: [
        { kind: "note", label: `found ${FAKE_SECRET}`, data: { match: FAKE_SECRET, nested: [{ value: FAKE_SECRET }] } },
      ],
      spec: { filename: "bundle-secrets-1.spec.ts", source: `// key: ${FAKE_SECRET}\n` },
    });
    await writeReport(makeReport([finding]), dir);

    for (const name of ["report.json", "report.md", "report.html", join("specs", "bundle-secrets-1.spec.ts")]) {
      const text = await readFile(join(dir, name), "utf8");
      expect(text, name).not.toContain(FAKE_SECRET);
      expect(text, name).not.toContain(FAKE_SECRET.slice(8));
    }
    const json = await readFile(join(dir, "report.json"), "utf8");
    expect(() => JSON.parse(json)).not.toThrow();
    expect(json).toContain("[REDACTED:openai-key]");
  });

  it("never writes a spec file outside dir/specs", async () => {
    const escapeName = `rh-escape-${Date.now()}.spec.ts`;
    const finding = makeFinding({ spec: { filename: `../../${escapeName}`, source: "// nope\n" } });
    // Rejecting the unsafe name or sanitising it are both fine; escaping dir is not.
    const err = await writeReport(makeReport([finding]), dir).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).not.toBeInstanceOf(NotImplementedError);
    await expect(readFile(join(dir, "..", escapeName), "utf8")).rejects.toThrow();
    await expect(readFile(join(dir, escapeName), "utf8")).rejects.toThrow();
  });

  it("does not modify the report object passed in", async () => {
    const finding = makeFinding({ meaning: `leak ${FAKE_SECRET}` });
    const report = makeReport([finding]);
    const before = JSON.stringify(report);
    await writeReport(report, dir);
    expect(JSON.stringify(report)).toBe(before);
  });
});
