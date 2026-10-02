/**
 * Each finding in report.html and report.md links to its check's page on Run Hound's public site (DESIGN.md §5.5):
 * - report.html: right after the Fix line, `<p class="check-link"><a href="<page>" target="_blank"
 *   rel="noopener noreferrer">About the <id> check</a></p>`.
 * - report.md: right after "- Fix: …", `- About this check: <page>`.
 * The link is derived from the check id when the report is rendered: report.json is unchanged, a redacted report keeps
 * the link, and the link carries no run data (no query, no target, no run or finding id). As in the web UI, a finding
 * whose check id isn't in CHECK_IDS gets no link (the runner never writes one; a direct caller of renderHtml or
 * renderMarkdown could). report.html is still served with the same sandboxed CSP, whose allow-popups and
 * allow-popups-to-escape-sandbox let the link open a new tab.
 */
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SITE_URL, checkPageUrl } from "../core/links.js";
import type { CheckId, Finding, Report } from "../core/types.js";
import { createApp } from "../server/app.js";
import { NOT_VISIBLE, redactReport, renderHtml, renderMarkdown, writeReport } from "./report.js";

/** Obviously fake, but shaped like a real OpenAI project key so the redactor must catch it. */
const FAKE_SECRET = "sk-proj-FAKEFAKEfake1234567890abcdefghijklmnopqrstuvwxyzABCDEFGH";

const RUN_ID = "20260928-101500-a1c4e7";
const TARGET = "http://127.0.0.1:3100/book?ref=newsletter";

const DOUBLE_SUBMIT_LINK =
  '<p class="check-link"><a href="https://run-hound.rahulbharati.com/checks/double-submit/" target="_blank" rel="noopener noreferrer">About the double-submit check</a></p>';

function doubleSubmit(overrides: Partial<Finding> = {}): Finding {
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
    scope: "Book a sitter form",
    evidence: [{ kind: "network", label: "Create requests", data: { count: 2 } }],
    spec: { filename: "double-submit-1.spec.ts", source: 'import { test } from "@playwright/test";\ntest("double submit", async () => {});\n' },
    ...overrides,
  };
}

function aiFlow(): Finding {
  return {
    checkId: "ai-flow",
    id: "ai-flow#1",
    title: "Saving an empty pet name shows no error",
    severity: "medium",
    category: "validation",
    confidence: "advisory",
    meaning: "An AI-suggested flow saved the form with the pet name empty and the page said nothing.",
    impact: "People don't learn why their booking didn't go through.",
    fix: "Show an error next to the pet name when it is empty.",
    evidence: [],
  };
}

function makeReport(findings: Finding[]): Report {
  const scenarioOf = (f: Finding) => `${f.checkId}:1`;
  return {
    runId: RUN_ID,
    target: TARGET,
    startedAt: "2026-09-28T10:15:00.000Z",
    finishedAt: "2026-09-28T10:16:00.000Z",
    durationMs: 60_000,
    groups: [],
    runHoundVersion: "0.6.0",
    plan: {
      target: TARGET,
      form: { url: TARGET, selector: "form", name: "Book a sitter", fields: [], controls: [] },
      groups: [],
      scenarios: findings.map((f) => ({
        id: scenarioOf(f),
        checkId: f.checkId,
        title: `Scenario for ${f.checkId}`,
        description: "d",
        kind: "danger",
        priority: "high",
        destructive: false,
        defaultSelected: true,
      })),
    },
    approved: findings.map(scenarioOf),
    results: findings.map((f) => ({ checkId: f.checkId, scenarioId: scenarioOf(f), status: "fail", findings: [f], durationMs: 1200 })),
    findings,
    summary: { critical: 0, high: findings.filter((f) => f.severity === "high").length, medium: findings.filter((f) => f.severity === "medium").length, low: 0, passed: 0, failed: findings.length, errored: 0, skipped: 0 },
    notVisible: NOT_VISIBLE,
  };
}

/** Each finding's <article> in report.html, in document order. */
function articles(html: string): string[] {
  return [...html.matchAll(/<article class="finding[^"]*">[\s\S]*?<\/article>/g)].map((m) => m[0]);
}

/** Every check-link href in a document. */
function checkLinkHrefs(html: string): string[] {
  return [...html.matchAll(/<p class="check-link"><a href="([^"]*)"/g)].map((m) => m[1]!.replace(/&amp;/g, "&"));
}

describe("report.html: each finding links to its check's page", () => {
  it("puts exactly the contract's link right after the double-submit finding's Fix line", () => {
    const html = renderHtml(makeReport([doubleSubmit()]));
    const [article] = articles(html);
    expect(article).toBeDefined();
    expect(article).toContain(DOUBLE_SUBMIT_LINK);
    expect(article!.split('class="check-link"')).toHaveLength(2);
    expect(article).toMatch(/<dt>Fix<\/dt><dd>Disable the Book button while the request is pending\.<\/dd><\/dl>\s*<p class="check-link">/);
  });

  it("links every finding to its own check, and ai-flow to its card on the checks hub", () => {
    const html = renderHtml(makeReport([doubleSubmit(), aiFlow()]));
    const found = articles(html);
    expect(found).toHaveLength(2);
    const byTitle = (title: string) => found.find((a) => a.includes(title))!;
    expect(byTitle("Double click books twice")).toContain(DOUBLE_SUBMIT_LINK);
    expect(byTitle("Saving an empty pet name shows no error")).toContain(
      '<p class="check-link"><a href="https://run-hound.rahulbharati.com/checks/#ai-flow" target="_blank" rel="noopener noreferrer">About the ai-flow check</a></p>',
    );
    expect(checkLinkHrefs(html)).toEqual([checkPageUrl("double-submit"), checkPageUrl("ai-flow")]);
  });

  it("adds no link to a report without findings", () => {
    const html = renderHtml(makeReport([]));
    expect(html).not.toContain('<p class="check-link">');
    expect(html).not.toContain(SITE_URL);
  });

  it("carries no run data: no query, and nothing from the target, the run or the finding", () => {
    const report = makeReport([doubleSubmit({ id: "double-submit#7", location: "Book button #book-now" })]);
    const [href] = checkLinkHrefs(renderHtml(report));
    expect(href).toBe(`${SITE_URL}/checks/double-submit/`);
    const url = new URL(href!);
    expect(url.origin).toBe(SITE_URL);
    expect(url.search).toBe("");
    expect(url.hash).toBe("");
    for (const leak of ["127.0.0.1", "3100", "newsletter", RUN_ID, "#7", "book-now", "Book a sitter"]) expect(href, leak).not.toContain(leak);
  });

  it("gives a finding whose check id this version doesn't know (one outside CHECK_IDS) no link, as the web UI does", () => {
    // "." and ".." would resolve out of a check's page (links.test.ts), so only ids in CHECK_IDS are linked.
    for (const id of ['"><img src=x onerror=alert(1)>', "..", ".", "no-such-check", "a/b?token=x#y"]) {
      const html = renderHtml(makeReport([doubleSubmit(), doubleSubmit({ checkId: id as CheckId, id: `${id}#1`, title: "Unknown check" })]));
      const found = articles(html);
      expect(found, id).toHaveLength(2);
      expect(found.find((a) => a.includes("Double click books twice")), id).toContain(DOUBLE_SUBMIT_LINK);
      const unknown = found.find((a) => a.includes("Unknown check"))!;
      expect(unknown, id).not.toContain('class="check-link"');
      expect(unknown, id).not.toContain(SITE_URL);
      expect(checkLinkHrefs(html), id).toEqual([checkPageUrl("double-submit")]);
    }
  });

  it("still escapes an unexpected check id where the finding shows it", () => {
    const html = renderHtml(makeReport([doubleSubmit({ checkId: '"><img src=x onerror=alert(1)>' as CheckId })]));
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(articles(html)[0]).toContain("&quot;&gt;&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain('<p class="check-link">');
  });
});

describe("report.md: each finding links to its check's page", () => {
  it("adds '- About this check: <page>' right after the Fix line", () => {
    const lines = renderMarkdown(makeReport([doubleSubmit()])).split("\n");
    const fix = lines.indexOf("- Fix: Disable the Book button while the request is pending.");
    expect(fix).toBeGreaterThan(-1);
    expect(lines[fix + 1]).toBe("- About this check: https://run-hound.rahulbharati.com/checks/double-submit/");
    expect(lines.filter((l) => l.startsWith("- About this check: "))).toHaveLength(1);
  });

  it("links ai-flow to its card on the checks hub", () => {
    const md = renderMarkdown(makeReport([doubleSubmit(), aiFlow()]));
    const links = md.split("\n").filter((l) => l.startsWith("- About this check: "));
    expect(links).toEqual([`- About this check: ${SITE_URL}/checks/double-submit/`, `- About this check: ${SITE_URL}/checks/#ai-flow`]);
  });

  it("adds no link for a check id this version doesn't know, as the web UI does", () => {
    for (const id of ["a\nb [x](y)", "..", ".", "no-such-check"]) {
      const md = renderMarkdown(makeReport([doubleSubmit({ checkId: id as CheckId, id: `${id}#1` }), aiFlow()]));
      const links = md.split("\n").filter((l) => l.includes("About this check"));
      expect(links, JSON.stringify(id)).toEqual([`- About this check: ${SITE_URL}/checks/#ai-flow`]);
    }
  });
});

describe("writeReport: the link is derived at render time", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "rh-report-check-links-"));
  });
  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("keeps the link in a redacted report.html and report.md, and leaves report.json unchanged", async () => {
    const report = makeReport([doubleSubmit({ meaning: `Clicking Book twice sends two bookings with key ${FAKE_SECRET}.` })]);
    await writeReport(report, dir);
    const [html, md, json] = await Promise.all(["report.html", "report.md", "report.json"].map((f) => readFile(join(dir, f), "utf8")));

    for (const text of [html!, md!, json!]) expect(text).not.toContain(FAKE_SECRET);
    expect(articles(html!)[0]).toContain(DOUBLE_SUBMIT_LINK);
    expect(md).toContain(`\n- About this check: ${SITE_URL}/checks/double-submit/\n`);

    // report.json is the redacted report and nothing more: no link, no new field.
    expect(JSON.parse(json!)).toEqual(JSON.parse(JSON.stringify(redactReport(report))));
    expect(json).not.toContain(SITE_URL);
    expect(json).not.toContain("check-link");
  });
});

describe("report.html as the local server serves it", () => {
  let runsDir: string;
  beforeAll(async () => {
    runsDir = await mkdtemp(join(tmpdir(), "rh-report-check-links-served-"));
  });
  afterAll(async () => {
    if (runsDir) await rm(runsDir, { recursive: true, force: true });
  });

  it("keeps its sandboxed CSP, whose allow-popups lets the link open a new tab, and sends no Referer", async () => {
    const dir = join(runsDir, RUN_ID);
    await mkdir(dir, { recursive: true });
    await writeReport(makeReport([doubleSubmit()]), dir);
    const app = createApp({ checks: [], runsDir, canShowBrowser: false });

    const res = await app.request(`/api/runs/${RUN_ID}/report.html`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toBe(
      "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; " +
        "sandbox allow-popups allow-popups-to-escape-sandbox",
    );
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(articles(await res.text())[0]).toContain(DOUBLE_SUBMIT_LINK);
  });
});
