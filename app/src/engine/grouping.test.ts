/**
 * Tester release (0.1.0): one finding per problem (docs/v0-spec.md, "Tester release").
 * When the same problem affects several elements the check reports ONE finding: the title states the count,
 * `locations` lists every element, `location` is the first, and the evidence marks all of them (one frame marking
 * every element, or one frame per element, up to 6). Different problems stay separate findings, and the report
 * shows every location.
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";
import type { Finding, Report } from "../core/types.js";
import { closeBrowser, overallStatus, runCheck } from "../../test-support/harness.js";
import { startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import { bookingApp, type BookingVariant } from "../../test/fixtures/checks/booking-page.js";
import { allFindings, expectUniqueIds } from "../../test/fixtures/checks/assert-finding.js";
import * as axeFixtures from "../../test/fixtures/checks/axe-states/variants.js";
import * as announceFixtures from "../../test/fixtures/checks/error-announcement/variants.js";
import { check as axeStates } from "../checks/axe-states.js";
import { check as errorAnnouncement } from "../checks/error-announcement.js";
import { check as focusVisible } from "../checks/focus-visible.js";
import { NOT_VISIBLE, renderHtml, renderMarkdown } from "./report.js";

const servers: FixtureServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});
afterAll(closeBrowser);

async function run(check: typeof focusVisible, variant: BookingVariant) {
  const app = bookingApp(variant);
  const server = await startFixtureServer(app.options);
  servers.push(server);
  const { results } = await runCheck(check, `${server.url}/book`);
  return { results, findings: allFindings(results) };
}

/** Every place a finding is about: `locations`, or just `location` for a single element. */
function places(f: Finding): string[] {
  return f.locations ?? (f.location ? [f.location] : []);
}

/** Problem marks (tone "fail", the default) across the finding's evidence frames. */
function marks(f: Finding): number {
  return f.evidence
    .filter((e) => e.kind === "frame")
    .reduce((n, e) => n + (e.highlights ?? []).filter((h) => (h.tone ?? "fail") === "fail").length, 0);
}

/** The grouped-finding contract for a problem found on `count` elements. */
function expectGrouped(f: Finding, count: number) {
  expect(count).toBeGreaterThan(1);
  expect(f.locations, "locations lists every element").toBeDefined();
  expect(f.locations).toHaveLength(count);
  expect(new Set(f.locations).size, "each element is listed once").toBe(count);
  for (const loc of f.locations!) expect(loc.trim().length).toBeGreaterThan(0);
  expect(f.location, "location is the first of locations").toBe(f.locations![0]);
  expect(f.title, "the title states the count").toMatch(new RegExp(`\\b${count}\\b`));
  expect(marks(f), "the evidence marks every element (up to 6)").toBeGreaterThanOrEqual(Math.min(count, 6));
}

/** Text inputs, email, tel and password all lose their focus ring; buttons and radios keep theirs. */
const fiveInputsWithoutFocus: BookingVariant = {
  css: ["text", "email", "tel", "password"]
    .flatMap((t) => [`input[type=${t}]:focus`, `input[type=${t}]:focus-visible`])
    .join(", ")
    .concat(" { outline: none; box-shadow: none; }"),
};

describe("one finding per problem: focus-visible", () => {
  it("5 controls without visible focus -> one finding naming all 5, in Tab order", async () => {
    const { results, findings } = await run(focusVisible, fiveInputsWithoutFocus);
    expect(overallStatus(results)).toBe("fail");
    expect(findings, findings.map((f) => f.title).join("\n")).toHaveLength(1);
    const f = findings[0]!;
    expectGrouped(f, 5);
    const expected = [/pet name/i, /owner email/i, /phone/i, /^password/i, /confirm password/i];
    for (const [i, re] of expected.entries()) expect(f.locations![i], `location ${i + 1}`).toMatch(re);
    expect(f.title).toMatch(/focus/i);
    expect(f.confidence).toBe("confirmed");
  }, 180_000);
});

describe("one finding per problem: error-announcement", () => {
  it("3 required fields whose errors are red text only -> one finding naming all 3", async () => {
    const { results, findings } = await run(errorAnnouncement, announceFixtures.redTextOnly);
    expect(overallStatus(results)).toBe("fail");
    expect(findings, findings.map((f) => f.title).join("\n")).toHaveLength(1);
    const f = findings[0]!;
    expectGrouped(f, 3);
    const expected = [/pet name/i, /pet type/i, /owner email/i];
    for (const [i, re] of expected.entries()) expect(f.locations![i], `location ${i + 1}`).toMatch(re);
    expect(f.title).toMatch(/announce/i);
  }, 180_000);
});

describe("one finding per problem: axe-states", () => {
  function axeNodes(f: Finding): unknown[] {
    const axe = f.evidence.find((e) => e.kind === "axe");
    const nodes = (axe?.data as { nodes?: unknown[] } | undefined)?.nodes;
    return Array.isArray(nodes) ? nodes : [];
  }

  it("a rule failing on several nodes -> one finding whose locations list every failing node", async () => {
    const { findings } = await run(axeStates, axeFixtures.bad.smallTargets.variant);
    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    const n = axeNodes(f).length;
    expect(n, "the fixture has several packed remove buttons").toBeGreaterThan(1);
    expectGrouped(f, n);
  }, 240_000);

  it("different rules stay separate findings, each listing its own nodes", async () => {
    const { findings } = await run(axeStates, axeFixtures.allRules);
    expect(findings).toHaveLength(4);
    expectUniqueIds(findings);
    for (const f of findings) {
      const n = axeNodes(f).length;
      expect(places(f), f.title).toHaveLength(n);
      if (n > 1) expectGrouped(f, n);
    }
  }, 240_000);
});

describe("grouped findings in the report", () => {
  const grouped: Finding = {
    checkId: "focus-visible",
    id: "focus-visible#1",
    title: "No visible focus on 3 controls",
    severity: "high",
    category: "accessibility",
    confidence: "confirmed",
    meaning: "Keyboard users can't see where they are.",
    impact: "Keyboard users get lost.",
    fix: "Add a :focus-visible style.",
    location: "Pet name",
    locations: ["Pet name", "Owner email", "Phone number"],
    evidence: [{ kind: "note", label: "fake" }],
  };
  const other: Finding = { ...grouped, checkId: "reflow-320", id: "reflow-320#1", title: "Page scrolls sideways at 320px", category: "accessibility", location: "Page", locations: undefined };
  const report: Report = {
    runId: "run-grouping",
    target: "http://127.0.0.1:5173/book",
    startedAt: "2026-09-24T10:00:00.000Z",
    finishedAt: "2026-09-24T10:01:00.000Z",
    runHoundVersion: "0.1.0",
    plan: { target: "http://127.0.0.1:5173/book", form: { url: "http://127.0.0.1:5173/book", selector: "form", name: "Book", fields: [], controls: [] }, scenarios: [] },
    approved: [],
    results: [],
    findings: [grouped, other],
    summary: { critical: 0, high: 2, medium: 0, low: 0, passed: 0, failed: 2, errored: 0, skipped: 0 },
    notVisible: NOT_VISIBLE,
  };

  it("report.md and report.html list every location of a grouped finding", () => {
    const md = renderMarkdown(report);
    const html = renderHtml(report);
    for (const loc of grouped.locations!) {
      expect(md, `report.md mentions ${loc}`).toContain(loc);
      expect(html, `report.html mentions ${loc}`).toContain(loc);
    }
  });

  it("the report keeps two different problems as two findings", () => {
    const md = renderMarkdown(report);
    expect(md).toContain(grouped.title);
    expect(md).toContain(other.title);
  });
});
