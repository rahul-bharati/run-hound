import { afterAll, afterEach, describe, expect, it } from "vitest";
import { closeBrowser, overallStatus, runCheck } from "../../test-support/harness.js";
import { startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import { bookingApp, type BookingVariant } from "../../test/fixtures/checks/booking-page.js";
import { allFindings, bug, expectPlanShape, expectWellFormedFinding } from "../../test/fixtures/checks/assert-finding.js";
import * as fixtures from "../../test/fixtures/checks/reflow-320/variants.js";
import { check, looksLikeTestValue } from "./reflow-320.js";

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
    // A capture at 320 px is the most useful evidence for a layout bug (an annotated "frame" per docs/v0-spec.md "Evidence").
    expect(f.evidence.some((e) => (e.kind === "frame" || e.kind === "screenshot") && typeof e.path === "string")).toBe(true);
  });

  it("ADVISORY: only a long test value saved by Run Hound spills past the screen -> low, advisory, the value is named", async () => {
    const { results, findings } = await run(fixtures.longTestValue);
    expect(overallStatus(results)).toBe("fail");
    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expect(f.confidence).toBe("advisory");
    expect(f.severity).toBe("low");
    expect(f.title).toMatch(/long unbroken text/i);
    expect(f.meaning).toMatch(/saved by Run Hound/);
    expect(f.fix).toMatch(/overflow-wrap/);
    expect(f.location).toMatch(/#saved-email/);
  });

  it("BAD: the page's own long text spills past the screen -> confirmed, and the element it comes from is named", async () => {
    const { findings } = await run(fixtures.longPageText);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.confidence).toBe("confirmed");
    expect(findings[0]!.location).toMatch(/#long-code/);
  });

  it("ADVISORY: an oversized test record saved by an EARLIER run (another run token) is Run Hound's data too (LOV-11)", async () => {
    const { results, findings } = await run(fixtures.earlierRunRecord);
    expect(overallStatus(results)).toBe("fail");
    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expect(f.confidence).toBe("advisory");
    expect(f.severity).toBe("low");
    expect(f.title).toMatch(/long unbroken text/i);
    expect(f.meaning).toMatch(/earlier Run Hound run/);
    expect(f.location).toMatch(/#old-task/);
  });
});

describe("reflow-320: Run Hound's test values, from any run (LOV-11)", () => {
  it("recognises every shape Run Hound types, whatever the run token", () => {
    for (const text of [
      "Task deadbeefverbose",
      "fa145884verbose " + "x".repeat(300),
      "owner.1a2b3c4dkeepf2@example.test",
      "runhound-1a2b3c4dax@example.com",
      "Run Hound test 1a2b3c4d",
      "Rh 1a2b3c4day",
      "Feed twice a day, note 1a2b3c4dsilent",
      "https://example.test/1a2b3c4dcne",
      "Fake-Passw0rd-1a2b3c4dtwice!",
      "x".repeat(250),
    ]) {
      expect(looksLikeTestValue(text), text).toBe(true);
    }
  });

  it("does not take the page's own text for a test value", () => {
    for (const text of ["SUPPORT-REFERENCE-CODE-ABCDEFGHIJKLMNOPQRSTUVWXYZ", "Order deadbeef shipped", "a1b2c3d4e5f6a7b8c9d0", "help@example.com", "Rhubarb pie"]) {
      expect(looksLikeTestValue(text), text).toBe(false);
    }
  });
});
