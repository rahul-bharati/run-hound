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
import * as fixtures from "../../test/fixtures/checks/credential-fields/variants.js";
import { check } from "./credential-fields.js";

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

describe("credential-fields check", () => {
  it("is registered under its id as an accessibility check", () => {
    expect(check.id).toBe("credential-fields");
    expect(check.category).toBe("accessibility");
    expect(check.title.trim().length).toBeGreaterThan(0);
  });

  it("GOOD: paste works and autocomplete=new-password is present -> pass, zero findings", async () => {
    const { scenarios, results, findings } = await run(fixtures.good);
    expectPlanShape(scenarios, "credential-fields");
    expect(overallStatus(results)).toBe("pass");
    expect(findings).toEqual([]);
  });

  it("BAD (A07): paste blocked on confirm password -> confirmed finding for that field only", async () => {
    const { results, findings } = await run(fixtures.pasteBlocked);
    expect(overallStatus(results)).toBe("fail");
    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expectWellFormedFinding(f, {
      checkId: "credential-fields",
      category: "accessibility",
      severity: bug("A07").severity,
      confidence: "confirmed",
    });
    expect(`${f.title} ${f.location ?? ""}`).toMatch(/confirm password/i);
    expect(`${f.title} ${f.meaning}`).toMatch(/paste/i);
  });

  it("BAD (advisory): missing autocomplete tokens -> advisory findings only, paste is not reported", async () => {
    const { results, findings } = await run(fixtures.autocompleteMissing);
    expect(overallStatus(results)).toBe("fail");
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expectUniqueIds(findings);
    for (const f of findings) {
      expectWellFormedFinding(f, { checkId: "credential-fields", category: "accessibility", confidence: "advisory" });
      expect(`${f.title} ${f.meaning} ${f.fix}`).toMatch(/autocomplete/i);
      expect(f.title).not.toMatch(/paste/i);
    }
    const text = findings.map((f) => `${f.title} ${f.location ?? ""}`).join("\n");
    expect(text).toMatch(/password/i);
  });
});
