import { afterAll, describe, expect, it } from "vitest";
import { closeBrowser, runCheck } from "../../test-support/harness.js";
import { startBookingApp, sampleForm, type ApiOptions, type BookingServer } from "../../test/fixtures/checks/_behavior/booking-app.js";
import { expectCheckShape, expectCleanPass, expectFailure, expectPlan, findingText } from "../../test/fixtures/checks/_behavior/expectations.js";
import { check } from "./persistence.js";

const ID = "persistence" as const;
const servers: BookingServer[] = [];

async function app(api: ApiOptions = {}) {
  // "Your bookings" is rendered from GET /api/bookings, so it survives a reload. Passwords are never shown.
  const s = await startBookingApp({}, api);
  servers.push(s);
  return s;
}

afterAll(async () => {
  await Promise.all(servers.map((s) => s.server.close()));
  await closeBrowser();
});

describe("persistence: contract", () => {
  it("exports a check with the right id and category", () => {
    expectCheckShape(check, ID, "broken-feature");
  });

  it("plans a golden, non-destructive scenario", () => {
    expectPlan(check, sampleForm(), "golden");
  });
});

describe("persistence: GOOD", () => {
  it("passes when every submitted canary is visible after reload, without requiring passwords to show", async () => {
    const s = await app();
    const { results } = await runCheck(check, s.url);
    expectCleanPass(results, ID);
  });

  it("submits unique canary values (run token) in every text field, including optional ones, and valid data overall", async () => {
    const s = await app();
    await runCheck(check, s.url);
    // The server validates strictly (email shape, dates, pet type), so this also proves the canaries are valid input.
    expect(s.api.bookings.length).toBeGreaterThanOrEqual(1);
    const stored = s.api.bookings[0]!;
    for (const field of ["petName", "email", "phone", "notes"]) {
      expect(stored[field], field).toBeTruthy();
    }
    expect(stored.petName).toContain("t3st");
    expect(stored.notes).toContain("t3st");
    expect(stored.email).toContain("t3st");
    // Every value is distinct, so one missing field cannot be masked by another field showing the same text.
    const texts = ["petName", "email", "phone", "notes"].map((k) => stored[k]);
    expect(new Set(texts).size).toBe(texts.length);
  });
});

describe("persistence: BAD", () => {
  it('fails when "Special instructions" gets a success toast but is never saved (F03)', async () => {
    const s = await app({ dropFields: ["notes"] });
    const { results } = await runCheck(check, s.url);
    const findings = expectFailure(results, ID, "broken-feature", ["critical", "high"]);
    const text = findings.map(findingText).join("\n");
    expect(text).toMatch(/special instructions|notes/i);
    // Only the dropped field is reported: passwords (never shown) and the saved fields are not.
    const headline = findings.map((f) => `${f.title}\n${f.location ?? ""}`).join("\n");
    expect(headline).toMatch(/special instructions|notes/i);
    expect(headline).not.toMatch(/password/i);
    expect(headline).not.toMatch(/Owner email|Pet name|Phone/i);
  });

  it("fails when an optional field (phone) is dropped", async () => {
    const s = await app({ dropFields: ["phone"] });
    const { results } = await runCheck(check, s.url);
    const findings = expectFailure(results, ID, "broken-feature", ["critical", "high", "medium"]);
    expect(findings.map(findingText).join("\n")).toMatch(/phone/i);
  });
});
