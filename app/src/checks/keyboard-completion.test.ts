import { afterAll, afterEach, describe, expect, it } from "vitest";
import { closeBrowser, overallStatus, runCheck } from "../../test-support/harness.js";
import { startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import { bookingApp, type BookingVariant } from "../../test/fixtures/checks/booking-page.js";
import {
  allFindings,
  bug,
  expectPlanShape,
  expectWellFormedFinding,
  findingText,
} from "../../test/fixtures/checks/assert-finding.js";
import * as fixtures from "../../test/fixtures/checks/keyboard-completion/variants.js";
import { check } from "./keyboard-completion.js";

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

describe("keyboard-completion check", () => {
  it("is registered under its id as an accessibility check", () => {
    expect(check.id).toBe("keyboard-completion");
    expect(check.category).toBe("accessibility");
    expect(check.title.trim().length).toBeGreaterThan(0);
  });

  it("GOOD: native radio group -> form completed with the keyboard only, booking created, pass", async () => {
    const { scenarios, results, findings, created } = await run(fixtures.good);
    expectPlanShape(scenarios, "keyboard-completion");
    expect(overallStatus(results)).toBe("pass");
    expect(findings).toEqual([]);
    // "Pass when ... the booking is created": exactly the keyboard-driven booking reached the server.
    expect(created).toHaveLength(1);
    const booking = created[0]!;
    expect(booking.petName).toEqual(expect.any(String));
    expect(["dog", "cat", "other"]).toContain(booking.petType);
    expect(String(booking.ownerEmail)).toContain("@");
  });

  it("BAD (A03): clickable-div pet picker can't be set from the keyboard -> fail naming the pet type picker", async () => {
    const { results, findings, created } = await run(fixtures.clickableDivPicker);
    expect(overallStatus(results)).toBe("fail");
    expect(findings.length).toBeGreaterThanOrEqual(1);
    for (const f of findings) {
      expectWellFormedFinding(f, { checkId: "keyboard-completion", category: "accessibility", confidence: "confirmed" });
    }
    const picker = findings.find((f) => /pet type/i.test(f.location ?? "") || /pet type/i.test(f.title));
    expect(picker, "a finding whose location or title names the Pet type picker").toBeDefined();
    expect(picker!.severity).toBe(bug("A03").severity);
    // Only the picker is broken; the text fields are reachable and must not be reported.
    expect(findings.some((f) => /pet name|owner email/i.test(`${f.title} ${f.location ?? ""}`))).toBe(false);
    // The keyboard user could not complete the booking.
    expect(created).toHaveLength(0);
    expect(findingText(picker!)).toMatch(/keyboard/i);
  });
});
