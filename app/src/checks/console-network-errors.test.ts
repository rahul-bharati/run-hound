import { afterAll, describe, expect, it } from "vitest";
import { closeBrowser, runCheck } from "../../test-support/harness.js";
import { startBookingApp, sampleForm, type ApiOptions, type BookingServer, type ClientOptions } from "../../test/fixtures/checks/_behavior/booking-app.js";
import { evidenceText, expectCheckShape, expectCleanPass, expectFailure, expectPlan } from "../../test/fixtures/checks/_behavior/expectations.js";
import { check } from "./console-network-errors.js";

const ID = "console-network-errors" as const;
const servers: BookingServer[] = [];

async function app(client: ClientOptions = {}, api: ApiOptions = {}) {
  const s = await startBookingApp(client, api);
  servers.push(s);
  return s;
}

afterAll(async () => {
  await Promise.all(servers.map((s) => s.server.close()));
  await closeBrowser();
});

describe("console-network-errors: contract", () => {
  it("exports a check with the right id and category", () => {
    expectCheckShape(check, ID, "broken-feature");
  });

  it("plans a golden, non-destructive scenario for a form", () => {
    expectPlan(check, sampleForm(), "golden");
  });
});

describe("console-network-errors: GOOD", () => {
  it("passes a clean page and completes the golden path with valid data (the booking is created)", async () => {
    // The server validates strictly; a check that submits junk would cause its own 400 and blame the app.
    const s = await app();
    const { results } = await runCheck(check, s.url);
    expectCleanPass(results, ID);
    expect(s.api.bookings.length).toBeGreaterThanOrEqual(1);
  });

  it("passes a page that declares no favicon (headless Chromium asks for none)", async () => {
    const s = await app({ replaceHtml: [['<link rel="icon" href="data:,">', ""]] });
    const { results } = await runCheck(check, s.url);
    expectCleanPass(results, ID);
  });

  it("ignores console.log / info / warn / debug (only errors count)", async () => {
    const s = await app({
      extraScript: [
        'console.log("app booted");',
        'console.info("build 1.2.3");',
        'console.warn("Deprecated prop `size` used");',
        'console.debug("debug detail");',
      ].join("\n"),
    });
    const { results } = await runCheck(check, s.url);
    expectCleanPass(results, ID);
  });

  it("ignores errors the app catches and handles without a failed request (no console error, no page error)", async () => {
    const s = await app({
      extraScript: 'try { JSON.parse("{not json"); } catch (e) { /* handled */ }\nPromise.reject(new Error("handled")).catch(function () {});',
    });
    const { results } = await runCheck(check, s.url);
    expectCleanPass(results, ID);
  });
});

describe("console-network-errors: BAD", () => {
  it("fails when the page requests an undefined env-var URL (undefined/api/availability -> 404) (F05)", async () => {
    const s = await app({ availabilityUrl: "undefined/api/availability" });
    const { results } = await runCheck(check, s.url);
    const findings = expectFailure(results, ID, "broken-feature", ["medium", "high"]);
    expect(evidenceText(findings)).toContain("undefined/api/availability");
    expect(evidenceText(findings)).toMatch(/404/);
  });

  it("fails on an uncaught page error and lists its message as evidence", async () => {
    const s = await app({
      extraScript: 'setTimeout(function () { throw new Error("availability widget crashed"); }, 0);',
    });
    const { results } = await runCheck(check, s.url);
    const findings = expectFailure(results, ID, "broken-feature", ["medium", "high"]);
    expect(evidenceText(findings)).toContain("availability widget crashed");
  });

  it("fails on a console.error even when every request succeeds", async () => {
    const s = await app({ extraScript: 'console.error("Warning: Each child in a list should have a unique key");' });
    const { results } = await runCheck(check, s.url);
    const findings = expectFailure(results, ID, "broken-feature", ["low", "medium", "high"]);
    expect(evidenceText(findings)).toContain("unique key");
  });

  it("fails on a 5xx that only happens during the golden path (after submitting)", async () => {
    // Load is clean; GET /api/bookings answers 500 only once a booking exists.
    const s = await app({}, { failListAfterCreate: true });
    const { results } = await runCheck(check, s.url);
    const findings = expectFailure(results, ID, "broken-feature", ["medium", "high"]);
    expect(evidenceText(findings)).toContain("/api/bookings");
    expect(evidenceText(findings)).toMatch(/500/);
  });
});
