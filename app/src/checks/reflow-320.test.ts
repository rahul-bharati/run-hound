import { afterAll, afterEach, describe, expect, it } from "vitest";
import { closeBrowser, overallStatus, runCheck } from "../../test-support/harness.js";
import { startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import { bookingApp, type BookingVariant } from "../../test/fixtures/checks/booking-page.js";
import { allFindings, bug, expectPlanShape, expectWellFormedFinding } from "../../test/fixtures/checks/assert-finding.js";
import * as fixtures from "../../test/fixtures/checks/reflow-320/variants.js";
import { check } from "./reflow-320.js";

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
  return { scenarios, results, findings: allFindings(results) };
}

describe("reflow-320 check", () => {
  it("is registered under its id as an accessibility check", () => {
    expect(check.id).toBe("reflow-320");
    expect(check.category).toBe("accessibility");
    expect(check.title.trim().length).toBeGreaterThan(0);
  });

  it("GOOD: fluid layout has no horizontal scroll at 320x800 -> pass, zero findings", async () => {
    const { scenarios, results, findings } = await run(fixtures.good);
    expectPlanShape(scenarios, "reflow-320");
    expect(overallStatus(results)).toBe("pass");
    expect(findings).toEqual([]);
  });

  it("BAD (A09): fixed 600px container overflows at 320 px -> one finding with the measured widths", async () => {
    const { results, findings } = await run(fixtures.fixedWidth);
    expect(overallStatus(results)).toBe("fail");
    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expectWellFormedFinding(f, {
      checkId: "reflow-320",
      category: "accessibility",
      severity: bug("A09").severity,
      confidence: "confirmed",
    });
    // Evidence records the measurement: scrollWidth (about 616 here) against clientWidth (320).
    const evidence = JSON.stringify(f.evidence);
    expect(evidence).toMatch(/scrollWidth/);
    expect(evidence).toMatch(/\b320\b/);
    expect(evidence).toMatch(/\b6\d\d\b/);
    // A screenshot at 320 px is the most useful evidence for a layout bug.
    expect(f.evidence.some((e) => e.kind === "screenshot" && typeof e.path === "string")).toBe(true);
  });
});
