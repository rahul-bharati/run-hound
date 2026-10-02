/**
 * Groups and timing through the runner and the report renderers (docs/v0-spec.md, "Groups and timing").
 * Fake checks only: no check opens a page, so the run is fast and every result is controlled here.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import { formatDuration } from "../core/format.js";
import type { Category, Check, CheckId, CheckResult, DiscoveredForm, Finding, Report, Scenario } from "../core/types.js";
import { buildPlan } from "./plan.js";
import { NOT_VISIBLE, renderHtml, renderMarkdown } from "./report.js";
import { runPlan, type ProgressEvent } from "./runner.js";

const FORM_PAGE = `<!doctype html><html lang="en"><head><title>Groups fixture</title></head><body>
<form id="booking"><h1>Book a sitter</h1>
<label for="petName">Pet name</label><input id="petName" name="petName" required>
<button type="submit">Book</button></form></body></html>`;

function scenario(checkId: CheckId, id: string, extra: Partial<Scenario> = {}): Scenario {
  return { id, checkId, title: `Fake ${id}`, description: "fake", kind: "golden", priority: "medium", destructive: false, defaultSelected: true, ...extra };
}

function finding(checkId: CheckId, category: Category, n: number): Finding {
  return {
    checkId,
    id: `${checkId}#${n}`,
    title: `Fake problem ${checkId} ${n}`,
    severity: "high",
    category,
    confidence: "confirmed",
    meaning: "Something is off.",
    impact: "People notice.",
    fix: "Make it right.",
    evidence: [{ kind: "note", label: "fake" }],
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fake checks in a scrambled order across all three groups:
 *   Accessibility: axe-states "axe:1" passes (1000 ms), focus-visible "fv:1" fails with one finding (2000 ms)
 *   Features: dead-control "dc:1" passes (500 ms), client-only-validation "cov:1" throws, persistence "pe:1" is destructive
 *   Security: bundle-secrets "bs:1" fails with two findings (3000 ms)
 */
function fakeChecks(ran: string[]): Check[] {
  const make = (id: CheckId, category: Category, scenarios: Scenario[], run: (s: Scenario) => Omit<CheckResult, "checkId" | "scenarioId">): Check => ({
    id,
    title: `Fake ${id}`,
    category,
    plan: () => scenarios,
    async run(_ctx, s) {
      ran.push(s.id);
      await sleep(2);
      return { checkId: id, scenarioId: s.id, ...run(s) };
    },
  });
  return [
    make("bundle-secrets", "security", [scenario("bundle-secrets", "bs:1")], () => ({
      status: "fail",
      findings: [finding("bundle-secrets", "security", 1), finding("bundle-secrets", "security", 2)],
      durationMs: 3000,
    })),
    make("dead-control", "broken-feature", [scenario("dead-control", "dc:1")], () => ({ status: "pass", findings: [], durationMs: 500 })),
    make("focus-visible", "accessibility", [scenario("focus-visible", "fv:1")], () => ({
      status: "fail",
      findings: [finding("focus-visible", "accessibility", 1)],
      durationMs: 2000,
    })),
    make("persistence", "broken-feature", [scenario("persistence", "pe:1", { destructive: true })], () => ({ status: "pass", findings: [], durationMs: 1 })),
    make("client-only-validation", "validation", [scenario("client-only-validation", "cov:1")], () => {
      throw new Error("boom from fake check");
    }),
    make("axe-states", "accessibility", [scenario("axe-states", "axe:1")], () => ({ status: "pass", findings: [], durationMs: 1000 })),
  ];
}

let server: FixtureServer;
let runsDir: string;
let ran: string[];
let checks: Check[];

beforeAll(async () => {
  server = await startFixtureServer({ pages: { "/book": FORM_PAGE } });
});

afterAll(async () => {
  await server?.close();
});

beforeEach(async () => {
  runsDir = await mkdtemp(join(tmpdir(), "rh-groups-"));
  ran = [];
  checks = fakeChecks(ran);
});

afterEach(async () => {
  await rm(runsDir, { recursive: true, force: true });
});

const target = () => `${server.url}/book`;
const form = (): DiscoveredForm => ({ url: target(), selector: "#booking", name: "Book a sitter", fields: [], controls: [] });
const ALL = ["axe:1", "fv:1", "dc:1", "cov:1", "pe:1", "bs:1"];

async function run(approved: string[]) {
  const plan = buildPlan(target(), form(), checks);
  const events: ProgressEvent[] = [];
  const { report, dir } = await runPlan(plan, { checks, approved, runsDir, log: () => undefined, onProgress: (e) => events.push(e) });
  return { plan, report, dir, events };
}

describe("runPlan groups", () => {
  it("runs scenarios group by group, CHECK_IDS order inside a group", async () => {
    await run(ALL);
    expect(ran).toEqual(["axe:1", "fv:1", "dc:1", "cov:1", "bs:1"]); // pe:1 is destructive: skipped, never run
  }, 60_000);

  it("emits group-start before each group's first scenario, and scenario-start carries the group", async () => {
    const { events } = await run(ALL);
    const seq = events
      .filter((e) => e.type === "group-start" || e.type === "scenario-start")
      .map((e) =>
        e.type === "group-start"
          ? { type: e.type, group: e.group, label: e.label, index: e.index, total: e.total, scenarios: e.scenarios }
          : { type: e.type, scenarioId: (e as Extract<ProgressEvent, { type: "scenario-start" }>).scenarioId, group: e.group },
      );
    expect(seq).toEqual([
      { type: "group-start", group: "accessibility", label: "Accessibility", index: 0, total: 3, scenarios: 2 },
      { type: "scenario-start", scenarioId: "axe:1", group: "accessibility" },
      { type: "scenario-start", scenarioId: "fv:1", group: "accessibility" },
      { type: "group-start", group: "features", label: "Features", index: 1, total: 3, scenarios: 3 },
      { type: "scenario-start", scenarioId: "dc:1", group: "features" },
      // CHECK_IDS order: persistence comes before client-only-validation.
      { type: "scenario-start", scenarioId: "pe:1", group: "features" },
      { type: "scenario-start", scenarioId: "cov:1", group: "features" },
      { type: "group-start", group: "security", label: "Security", index: 2, total: 3, scenarios: 1 },
      { type: "scenario-start", scenarioId: "bs:1", group: "security" },
    ]);
    // scenario-start index/total still count scenarios over the whole run.
    const starts = events.filter((e): e is Extract<ProgressEvent, { type: "scenario-start" }> => e.type === "scenario-start");
    expect(starts.map((e) => [e.index, e.total])).toEqual([0, 1, 2, 3, 4, 5].map((i) => [i, 6]));
  }, 60_000);

  it("records the whole run's duration: durationMs > 0 and equal to finishedAt - startedAt", async () => {
    const { report, dir } = await run(ALL);
    expect(report.durationMs).toBeGreaterThan(0);
    expect(Math.abs(report.durationMs - (Date.parse(report.finishedAt) - Date.parse(report.startedAt)))).toBeLessThanOrEqual(5);
    const onDisk = JSON.parse(await readFile(join(dir, "report.json"), "utf8")) as Report;
    expect(onDisk.durationMs).toBe(report.durationMs);
    expect(onDisk.groups).toEqual(report.groups);
  }, 60_000);

  it("reports per-group counts, findings and durations", async () => {
    const { report } = await run(ALL);
    const sum = (ids: string[]) => report.results.filter((r) => ids.includes(r.scenarioId)).reduce((n, r) => n + r.durationMs, 0);
    expect(report.groups).toEqual([
      { id: "accessibility", label: "Accessibility", scenarioIds: ["axe:1", "fv:1"], passed: 1, failed: 1, errored: 0, skipped: 0, findings: 1, durationMs: 3000 },
      { id: "features", label: "Features", scenarioIds: ["dc:1", "pe:1", "cov:1"], passed: 1, failed: 0, errored: 1, skipped: 1, findings: 0, durationMs: sum(["dc:1", "pe:1", "cov:1"]) },
      { id: "security", label: "Security", scenarioIds: ["bs:1"], passed: 0, failed: 1, errored: 0, skipped: 0, findings: 2, durationMs: 3000 },
    ]);
    for (const g of report.groups) expect(g.durationMs, g.id).toBe(sum(g.scenarioIds));
    // The report's plan carries the plan's groups.
    expect(report.plan.groups.map((g) => g.id)).toEqual(["accessibility", "features", "security"]);
  }, 60_000);

  it("leaves out groups with no approved scenarios, and group-start counts only the groups that run", async () => {
    const { report, events } = await run(["bs:1", "fv:1"]);
    expect(ran).toEqual(["fv:1", "bs:1"]);
    expect(report.groups.map((g) => [g.id, g.scenarioIds])).toEqual([
      ["accessibility", ["fv:1"]],
      ["security", ["bs:1"]],
    ]);
    const groupStarts = events.filter((e): e is Extract<ProgressEvent, { type: "group-start" }> => e.type === "group-start");
    expect(groupStarts.map((e) => [e.group, e.index, e.total, e.scenarios])).toEqual([
      ["accessibility", 0, 2, 1],
      ["security", 1, 2, 1],
    ]);
  }, 60_000);

  it("writes the run duration into report.md and report.html", async () => {
    const { report, dir } = await run(ALL);
    const text = formatDuration(report.durationMs);
    const md = await readFile(join(dir, "report.md"), "utf8");
    const html = await readFile(join(dir, "report.html"), "utf8");
    expect(md).toContain(`Finished in ${text}`);
    expect(visibleText(html)).toContain(`Finished in ${text}`);
  }, 60_000);
});

/** Text a reader sees in the HTML: tags removed, entities for & decoded, whitespace collapsed. */
function visibleText(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
}

describe("report renderers: groups and timing", () => {
  // Scenario titles and finding texts never contain a group label, so a label found near them was put there on purpose.
  const S = (checkId: CheckId, id: string, title: string): Scenario => ({ ...scenario(checkId, id), title });
  const scenarios: Scenario[] = [
    S("axe-states", "axe:1", "Scan the empty form with axe"),
    S("focus-visible", "fv:1", "Tab through and look for focus rings"),
    S("dead-control", "dc:1", "Click every control"),
    S("client-only-validation", "cov:1", "Send bad values straight to the server"),
    S("bundle-secrets", "bs:1", "Look for keys in the scripts"),
    S("verbose-errors", "ve:1", "Provoke a server error"),
  ];
  const DUR: Record<string, [number, string]> = {
    "axe:1": [1_200, "1.2 s"],
    "fv:1": [2_500, "2.5 s"],
    "dc:1": [1_500, "1.5 s"],
    "cov:1": [2_000, "2.0 s"],
    "bs:1": [42_000, "42 s"],
    "ve:1": [3_000, "3.0 s"],
  };
  const GROUP_OF: Record<string, string> = {
    "axe:1": "Accessibility",
    "fv:1": "Accessibility",
    "dc:1": "Features",
    "cov:1": "Features",
    "bs:1": "Security",
    "ve:1": "Security",
  };
  const fvFinding: Finding = { ...finding("focus-visible", "accessibility", 1), title: "No visible focus ring on 3 controls" };
  const bsFinding: Finding = { ...finding("bundle-secrets", "security", 1), title: "API key shipped in the page script" };
  const results: CheckResult[] = scenarios.map((s) => ({
    checkId: s.checkId,
    scenarioId: s.id,
    status: s.id === "fv:1" || s.id === "bs:1" ? "fail" : "pass",
    findings: s.id === "fv:1" ? [fvFinding] : s.id === "bs:1" ? [bsFinding] : [],
    durationMs: DUR[s.id]![0],
  }));
  const report: Report = {
    runId: "run-groups",
    target: "http://127.0.0.1:5173/book",
    startedAt: "2026-09-24T10:00:00.000Z",
    finishedAt: "2026-09-24T10:01:12.000Z",
    durationMs: 72_000,
    groups: [
      { id: "accessibility", label: "Accessibility", scenarioIds: ["axe:1", "fv:1"], passed: 1, failed: 1, errored: 0, skipped: 0, findings: 1, durationMs: 3_700 },
      { id: "features", label: "Features", scenarioIds: ["dc:1", "cov:1"], passed: 2, failed: 0, errored: 0, skipped: 0, findings: 0, durationMs: 3_500 },
      { id: "security", label: "Security", scenarioIds: ["bs:1", "ve:1"], passed: 1, failed: 1, errored: 0, skipped: 0, findings: 1, durationMs: 45_000 },
    ],
    runHoundVersion: "0.1.0",
    plan: {
      target: "http://127.0.0.1:5173/book",
      form: { url: "http://127.0.0.1:5173/book", selector: "form", name: "Book a sitter", fields: [], controls: [] },
      scenarios,
      groups: [
        { id: "accessibility", label: "Accessibility", scenarioIds: ["axe:1", "fv:1"] },
        { id: "features", label: "Features", scenarioIds: ["dc:1", "cov:1"] },
        { id: "security", label: "Security", scenarioIds: ["bs:1", "ve:1"] },
      ],
    },
    approved: scenarios.map((s) => s.id),
    results,
    findings: [fvFinding, bsFinding],
    summary: { critical: 0, high: 2, medium: 0, low: 0, passed: 4, failed: 2, errored: 0, skipped: 0 },
    notVisible: NOT_VISIBLE,
  };
  const GROUP_TOTALS: [string, string][] = [
    ["Accessibility", "3.7 s"],
    ["Features", "3.5 s"],
    ["Security", "45 s"],
  ];

  describe("renderMarkdown", () => {
    const md = renderMarkdown(report);
    const lines = md.split("\n");

    it('shows the run duration ("Finished in")', () => {
      expect(md).toContain("Finished in 1 min 12 s");
    });

    it("has a per-group summary table with the three labels in order, each with its total duration", () => {
      const rows = GROUP_TOTALS.map(([label]) => lines.findIndex((l) => new RegExp(`^\\|\\s*${label}\\s*\\|`).test(l)));
      for (const [i, [label, total]] of GROUP_TOTALS.entries()) {
        expect(rows[i], `table row for ${label}`).toBeGreaterThan(-1);
        expect(lines[rows[i]!], `${label} row shows its duration`).toContain(total);
      }
      expect([...rows].sort((a, b) => a - b)).toEqual(rows);
    });

    it("lists scenarios under their group's heading, each with its duration", () => {
      for (const s of scenarios) {
        const at = lines.findIndex((l) => l.includes(s.title) && !l.startsWith("#"));
        expect(at, `a line for ${s.title}`).toBeGreaterThan(-1);
        expect(lines[at], `${s.title} shows its duration`).toContain(DUR[s.id]![1]);
        const heading = lines.slice(0, at).reverse().find((l) => /^#{1,6} /.test(l));
        expect(heading, `heading above ${s.title}`).toMatch(new RegExp(`\\b${GROUP_OF[s.id]}\\b`));
      }
    });

    it("labels each finding with its group", () => {
      for (const [f, label] of [[fvFinding, "Accessibility"], [bsFinding, "Security"]] as const) {
        const at = lines.findIndex((l) => /^#{1,6} /.test(l) && l.includes(f.title));
        expect(at, `heading for ${f.title}`).toBeGreaterThan(-1);
        const next = lines.findIndex((l, i) => i > at && /^#{1,6} /.test(l));
        const section = lines.slice(at, next === -1 ? undefined : next).join("\n");
        expect(section, `${f.title} is labelled ${label}`).toContain(label);
      }
    });
  });

  describe("renderHtml", () => {
    const html = renderHtml(report);

    it('shows the run duration ("Finished in")', () => {
      expect(visibleText(html)).toContain("Finished in 1 min 12 s");
    });

    it("has a per-group summary table with the three labels in order, each with its total duration", () => {
      const tables = html.match(/<table[\s\S]*?<\/table>/g) ?? [];
      const table = tables.find((t) => GROUP_TOTALS.every(([label]) => t.includes(label)));
      expect(table, "a table naming all three groups").toBeDefined();
      const rows = table!.match(/<tr[\s\S]*?<\/tr>/g) ?? [];
      const at = GROUP_TOTALS.map(([label]) => rows.findIndex((r) => visibleText(r).includes(label)));
      for (const [i, [label, total]] of GROUP_TOTALS.entries()) {
        expect(at[i], `row for ${label}`).toBeGreaterThan(-1);
        expect(visibleText(rows[at[i]!]!), `${label} row shows its duration`).toContain(total);
      }
      expect([...at].sort((a, b) => a - b)).toEqual(at);
    });

    it("lists scenarios under their group's heading, each with its duration", () => {
      for (const s of scenarios) {
        const at = html.indexOf(s.title);
        expect(at, `${s.title} is listed`).toBeGreaterThan(-1);
        const rest = html.slice(at);
        const end = rest.search(/<\/li>|<\/tr>/);
        const item = end === -1 ? rest : rest.slice(0, end);
        expect(visibleText(item), `${s.title} shows its duration`).toContain(DUR[s.id]![1]);
        const headings = [...html.slice(0, at).matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/g)];
        const heading = headings.at(-1)?.[1] ?? "";
        expect(visibleText(heading), `heading above ${s.title}`).toMatch(new RegExp(`\\b${GROUP_OF[s.id]}\\b`));
      }
    });

    it("labels each finding with its group", () => {
      for (const [f, label] of [[fvFinding, "Accessibility"], [bsFinding, "Security"]] as const) {
        const at = html.indexOf(f.title);
        expect(at, `${f.title} is shown`).toBeGreaterThan(-1);
        const rest = html.slice(at);
        const end = rest.indexOf("</article>");
        expect(visibleText(end === -1 ? rest : rest.slice(0, end)), `${f.title} is labelled ${label}`).toContain(label);
      }
    });
  });
});
