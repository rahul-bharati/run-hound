import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import type { Finding } from "../core/types.js";
import { closeBrowser, getBrowser, overallStatus, runCheck } from "../../test-support/harness.js";
import { json, startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import { createCheckContext } from "../engine/context.js";
import { discoverPage } from "../engine/discover.js";
import { bookingApp, type BookingVariant } from "../../test/fixtures/checks/booking-page.js";
import {
  allFindings,
  bug,
  expectPlanShape,
  expectUniqueIds,
  expectWellFormedFinding,
  findingText,
} from "../../test/fixtures/checks/assert-finding.js";
import * as fixtures from "../../test/fixtures/checks/axe-states/variants.js";
import { check } from "./axe-states.js";

const servers: FixtureServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});
afterAll(closeBrowser);

async function run(variant: BookingVariant) {
  const app = bookingApp(variant);
  const server = await startFixtureServer(app.options);
  servers.push(server);
  const { scenarios, results } = await runCheck(check, `${server.url}/book`);
  return { scenarios, results, findings: allFindings(results), server, created: app.created };
}

/**
 * Contract: each axe finding carries an evidence item of kind "axe" whose data has the axe rule id
 * (`ruleId`) and the affected nodes (`nodes`, each with the axe `target` selector list).
 */
function axeRuleIds(finding: Finding): string[] {
  return finding.evidence
    .filter((e) => e.kind === "axe")
    .map((e) => (e.data as { ruleId?: unknown } | undefined)?.ruleId)
    .filter((id): id is string => typeof id === "string");
}

function expectAxeFinding(finding: Finding, rule: string, bugId: string) {
  const b = bug(bugId);
  expectWellFormedFinding(finding, { checkId: "axe-states", category: "accessibility", severity: b.severity, confidence: "confirmed" });
  expect(axeRuleIds(finding)).toContain(rule);
  const axeEvidence = finding.evidence.find((e) => e.kind === "axe")!;
  const nodes = (axeEvidence.data as { nodes?: unknown }).nodes;
  expect(Array.isArray(nodes) && nodes.length > 0, "axe evidence lists the violating nodes").toBe(true);
}

describe("axe-states check", () => {
  it("is registered under its id as an accessibility check", () => {
    expect(check.id).toBe("axe-states");
    expect(check.category).toBe("accessibility");
    expect(check.title.trim().length).toBeGreaterThan(0);
  });

  it("GOOD: clean form passes in every state with zero findings", async () => {
    const { scenarios, results, findings, created } = await run(fixtures.good);
    expectPlanShape(scenarios, "axe-states");
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) expect(r.checkId).toBe("axe-states");
    expect(overallStatus(results)).toBe("pass");
    expect(findings).toEqual([]);
    // Reaching the success state means the check submitted valid data and the booking was created.
    expect(created.length).toBeGreaterThan(0);
  });

  it("BAD (A01): input labelled only by a placeholder is one finding pointing at that input", async () => {
    const { results, findings } = await run(fixtures.bad.missingLabel.variant);
    expect(overallStatus(results)).toBe("fail");
    // The violation exists in all four states but is reported once.
    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    // axe 4.13's `label` rule accepts a non-empty placeholder, so the check must treat
    // placeholder-only labelling as a violation itself (reconfigured `label` rule or an extra rule).
    expectWellFormedFinding(f, { checkId: "axe-states", category: "accessibility", severity: bug("A01").severity, confidence: "confirmed" });
    expect(findingText(f)).toContain("#phone");
  });

  it("BAD (A02): icon-only button with no accessible name -> one button-name finding", async () => {
    const { results, findings } = await run(fixtures.bad.namelessIconButton.variant);
    expect(overallStatus(results)).toBe("fail");
    expect(findings).toHaveLength(1);
    expectAxeFinding(findings[0]!, "button-name", "A02");
    expect(findingText(findings[0]!)).toContain("#clear");
  });

  it("BAD (A06): low-contrast helper text -> one color-contrast finding", async () => {
    const { results, findings } = await run(fixtures.bad.lowContrastHelper.variant);
    expect(overallStatus(results)).toBe("fail");
    expect(findings).toHaveLength(1);
    expectAxeFinding(findings[0]!, "color-contrast", "A06");
    expect(findingText(findings[0]!)).toContain("#petName-hint");
  });

  it("BAD (A08): 16px packed icon buttons -> one target-size finding (WCAG 2.2 AA tags are on)", async () => {
    const { results, findings } = await run(fixtures.bad.smallTargets.variant);
    expect(overallStatus(results)).toBe("fail");
    expect(findings).toHaveLength(1);
    expectAxeFinding(findings[0]!, "target-size", "A08");
    expect(findingText(findings[0]!)).toContain("Remove booking for");
  });

  it("BAD: a violation that only appears after an invalid submit is caught", async () => {
    const { results, findings } = await run(fixtures.invalidStateOnly.variant);
    expect(overallStatus(results)).toBe("fail");
    expect(findings).toHaveLength(1);
    expectAxeFinding(findings[0]!, fixtures.invalidStateOnly.rule, fixtures.invalidStateOnly.bug);
    // The low-contrast inline error messages are hidden until validation fails.
    expect(findingText(findings[0]!)).toMatch(/#(petName|petType|ownerEmail)-error/);
    expect(findingText(findings[0]!)).toMatch(/invalid/i);
  });

  it("BAD: several violated rules -> exactly one finding per rule with unique ids", async () => {
    const { results, findings } = await run(fixtures.allRules);
    expect(overallStatus(results)).toBe("fail");
    expect(findings).toHaveLength(4);
    expectUniqueIds(findings);
    const rules = findings.flatMap(axeRuleIds);
    for (const rule of ["button-name", "color-contrast", "target-size"]) {
      expect(rules.filter((r) => r === rule), `findings for ${rule}`).toHaveLength(1);
    }
    expect(findings.filter((f) => findingText(f).includes("#phone"))).toHaveLength(1);
  });
});

describe("axe-states: text that is fading in is not measured mid-fade (LOV-9)", () => {
  const contrast = (findings: Finding[]) => findings.filter((f) => axeRuleIds(f).includes("color-contrast"));

  it("GOOD: a hero paragraph with an entrance fade (Web Animations) passes once it has faded in", async () => {
    const { results, findings } = await run(fixtures.fadeInWaapi);
    expect(contrast(findings), JSON.stringify(findings.map((f) => f.evidence.find((e) => e.kind === "axe")?.data))).toEqual([]);
    expect(overallStatus(results)).toBe("pass");
  });

  it("GOOD: the same fade driven by script frame by frame passes too", async () => {
    const { findings } = await run(fixtures.fadeInScript);
    expect(contrast(findings), JSON.stringify(findings.map((f) => f.evidence.find((e) => e.kind === "axe")?.data))).toEqual([]);
  });

  it("BAD: text that stays too faint after its fade-in is still one color-contrast finding", async () => {
    const { findings } = await run(fixtures.fadeInLowContrast);
    const found = contrast(findings);
    expect(found).toHaveLength(1);
    expect(findingText(found[0]!)).toContain("#hero");
  });
});

describe("axe-states: a form in a dialog that closes after saving (LOV-8)", () => {
  it("opens the dialog again for the second submission", async () => {
    const members: unknown[] = [];
    const server = await startFixtureServer({
      root: fileURLToPath(new URL("../../test/fixtures/discover/", import.meta.url)),
      routes: {
        "GET /api/members": (_req, res) => json(res, 200, members),
        "POST /api/members": (req, res) => {
          members.push(JSON.parse(req.body));
          json(res, 201, {});
        },
      },
    });
    servers.push(server);
    const url = `${server.url}/dialog-only.html`;
    const browser = await getBrowser();
    const discovery = await browser.newPage();
    await discovery.goto(url, { waitUntil: "networkidle" });
    const found = await discoverPage(discovery, { openers: true });
    await discovery.close();
    const form = found.forms[0]!;
    expect(form.opener?.name).toBe("Add member");

    const artifactsDir = await mkdtemp(join(tmpdir(), "rh-axe-dialog-"));
    const ctx = createCheckContext({ browser, form, discoveredPage: found, targetUrl: url, artifactsDir, runToken: "t3st" });
    try {
      const [scenario] = check.plan(form, found);
      const result = await check.run(ctx, scenario!);
      expect(result.status, result.notes).not.toBe("error");
      expect(members, "both submissions of the success state were saved").toHaveLength(2);
    } finally {
      await ctx.dispose();
      await rm(artifactsDir, { recursive: true, force: true });
    }
  }, 120_000);
});
