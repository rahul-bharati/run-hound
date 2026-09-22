import { afterAll, describe, expect, it } from "vitest";
import { closeBrowser, runCheck } from "../../test-support/harness.js";
import { startBookingApp, sampleForm, type BookingServer, type ClientOptions } from "../../test/fixtures/checks/_behavior/booking-app.js";
import { evidenceText, expectCheckShape, expectCleanPass, expectFailure, expectPlan } from "../../test/fixtures/checks/_behavior/expectations.js";
import { check } from "./double-submit.js";

const ID = "double-submit" as const;
const servers: BookingServer[] = [];

/** The create request takes 800 ms, so a double click always lands while it is pending. */
async function app(client: ClientOptions) {
  const s = await startBookingApp(client, { delayMs: 800 });
  servers.push(s);
  return s;
}

afterAll(async () => {
  await Promise.all(servers.map((s) => s.server.close()));
  await closeBrowser();
});

describe("double-submit: contract", () => {
  it("exports a check with the right id and category", () => {
    expectCheckShape(check, ID, "broken-feature");
  });

  it("plans a danger, non-destructive scenario", () => {
    expectPlan(check, sampleForm(), "danger");
  });
});

describe("double-submit: GOOD", () => {
  it("passes when Book is disabled while the request is pending (list-refresh GETs are not create requests)", async () => {
    const s = await app({ submitGuard: "disable" });
    const { results } = await runCheck(check, s.url);
    expectCleanPass(results, ID);
    expect(s.createRequests().length).toBeGreaterThanOrEqual(1);
  });

  it("passes when the button stays enabled but the app sends exactly one create request (in-flight guard)", async () => {
    const s = await app({ submitGuard: "in-flight-flag" });
    const { results } = await runCheck(check, s.url);
    expectCleanPass(results, ID);
    expect(s.createRequests()).toHaveLength(results.length);
  });

  it("passes when the app also posts something else (telemetry) to its own origin: only repeats of one endpoint count", async () => {
    const s = await app({
      submitGuard: "disable",
      extraScript:
        'document.getElementById("booking").addEventListener("submit", function () { fetch("/api/track", { method: "POST", body: "{}" }); });',
    });
    const { results } = await runCheck(check, s.url);
    expectCleanPass(results, ID);
    expect(s.createRequests()).toHaveLength(1);
    expect(s.server.requests.filter((r) => r.url === "/api/track").length).toBeGreaterThanOrEqual(1);
  });
});

describe("double-submit: BAD", () => {
  it("fails when Book stays enabled while sending and a double click books twice (F04)", async () => {
    const s = await app({ submitGuard: "none" });
    const { results } = await runCheck(check, s.url);
    const findings = expectFailure(results, ID, "broken-feature", ["high", "medium", "critical"]);
    // Sanity: the check really double-clicked with valid data.
    expect(s.createRequests().length).toBeGreaterThanOrEqual(2);
    expect(s.api.bookings.length).toBeGreaterThanOrEqual(2);
    // Evidence lists the duplicate create requests.
    expect(evidenceText(findings)).toContain("/api/bookings");
  });
});
