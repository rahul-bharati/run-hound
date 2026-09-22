import { afterAll, afterEach, describe, expect, it } from "vitest";
import { closeBrowser, overallStatus, runCheck } from "../../test-support/harness.js";
import { startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import { bookingApp, type BookingVariant } from "../../test/fixtures/checks/booking-page.js";
import {
  allFindings,
  bug,
  expectPlanShape,
  expectUniqueIds,
  expectWellFormedFinding,
  findingText,
} from "../../test/fixtures/checks/assert-finding.js";
import * as fixtures from "../../test/fixtures/checks/focus-visible/variants.js";
import { check } from "./focus-visible.js";

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

describe("focus-visible check", () => {
  it("is registered under its id as an accessibility check", () => {
    expect(check.id).toBe("focus-visible");
    expect(check.category).toBe("accessibility");
    expect(check.title.trim().length).toBeGreaterThan(0);
  });

  it("GOOD: every control shows an outline on keyboard focus -> pass, zero findings", async () => {
    const { scenarios, results, findings } = await run(fixtures.good);
    expectPlanShape(scenarios, "focus-visible");
    expect(overallStatus(results)).toBe("pass");
    expect(findings).toEqual([]);
  });

  it("GOOD: outline removed but replaced by a box-shadow ring still counts as visible focus", async () => {
    const { results, findings } = await run(fixtures.outlineReplacedByShadow);
    expect(overallStatus(results)).toBe("pass");
    expect(findings).toEqual([]);
  });

  it.each([
    ["a border change", "outlineReplacedByBorder"],
    ["a background change", "outlineReplacedByBackground"],
  ] as const)("GOOD: outline replaced by %s still counts as visible focus", async (_what, variant) => {
    const { results, findings } = await run(fixtures[variant]);
    expect(findings).toEqual([]);
    expect(overallStatus(results)).toBe("pass");
  });

  it("GOOD: an element focused on page load is judged against its unfocused style", async () => {
    const { results, findings } = await run(fixtures.autofocus);
    expect(findings).toEqual([]);
    expect(overallStatus(results)).toBe("pass");
  });

  it("BAD (A04): outline:none with no replacement on text inputs -> fail naming those inputs only", async () => {
    const { results, findings } = await run(fixtures.outlineRemoved);
    expect(overallStatus(results)).toBe("fail");
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expectUniqueIds(findings);
    for (const f of findings) {
      expectWellFormedFinding(f, {
        checkId: "focus-visible",
        category: "accessibility",
        severity: bug("A04").severity,
        confidence: "confirmed",
      });
    }
    const all = findings.map(findingText).join("\n");
    expect(all).toMatch(/pet name|#petName\b/i);
    expect(all).toMatch(/owner email|#ownerEmail\b/i);
    // Buttons, radios and password fields keep their outline and must not be reported.
    expect(all).not.toMatch(/"location":"[^"]*(Book|Pet type|Password|Confirm password|Clear pet name)/);
  });
});
