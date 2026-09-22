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
} from "../../test/fixtures/checks/assert-finding.js";
import * as fixtures from "../../test/fixtures/checks/error-announcement/variants.js";
import { check } from "./error-announcement.js";

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
  return { scenarios, results, findings: allFindings(results), created: app.created };
}

const requiredFields = [/pet name/i, /pet type/i, /owner email/i];

describe("error-announcement check", () => {
  it("is registered under its id as an accessibility check", () => {
    expect(check.id).toBe("error-announcement");
    expect(check.category).toBe("accessibility");
    expect(check.title.trim().length).toBeGreaterThan(0);
  });

  it("GOOD: aria-invalid + aria-describedby + polite live region -> pass, zero findings", async () => {
    const { scenarios, results, findings, created } = await run(fixtures.good);
    expectPlanShape(scenarios, "error-announcement");
    expect(overallStatus(results)).toBe("pass");
    expect(findings).toEqual([]);
    // The scenario submits EMPTY required fields, so nothing is created.
    expect(created).toHaveLength(0);
  });

  it("GOOD: a form that relies on the browser's own validation is not reported", async () => {
    const { results, findings, created } = await run(fixtures.nativeValidation);
    expect(findings).toEqual([]);
    expect(overallStatus(results)).toBe("pass");
    expect(created).toHaveLength(0);
  });

  it("BAD (A05): errors are red text only -> fail, and every required field is covered", async () => {
    const { results, findings } = await run(fixtures.redTextOnly);
    expect(overallStatus(results)).toBe("fail");
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expectUniqueIds(findings);
    for (const f of findings) {
      expectWellFormedFinding(f, {
        checkId: "error-announcement",
        category: "accessibility",
        severity: bug("A05").severity,
        confidence: "confirmed",
      });
    }
    // Whether reported as one finding per field or one grouped finding, each required field is named.
    const text = findings.map((f) => `${f.title} ${f.location ?? ""} ${JSON.stringify(f.evidence)}`).join("\n");
    for (const field of requiredFields) expect(text).toMatch(field);
    // Optional fields were not invalid and must not be reported.
    expect(findings.some((f) => /phone|password/i.test(f.location ?? ""))).toBe(false);
  });

  it("BAD: aria-invalid set but the message is not associated or announced -> fail", async () => {
    const { results, findings } = await run(fixtures.invalidWithoutMessage);
    expect(overallStatus(results)).toBe("fail");
    expect(findings.length).toBeGreaterThanOrEqual(1);
    for (const f of findings) {
      expectWellFormedFinding(f, { checkId: "error-announcement", category: "accessibility", confidence: "confirmed" });
    }
    // Pet name keeps its hint in aria-describedby; a describedby that doesn't point at the error message is not enough.
    const text = findings.map((f) => `${f.title} ${f.location ?? ""} ${JSON.stringify(f.evidence)}`).join("\n");
    for (const field of requiredFields) expect(text).toMatch(field);
  });
});
