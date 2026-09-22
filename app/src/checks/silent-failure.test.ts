import { afterAll, describe, expect, it } from "vitest";
import { closeBrowser, runCheck } from "../../test-support/harness.js";
import { startBookingApp, sampleForm, type BookingServer, type ClientOptions } from "../../test/fixtures/checks/_behavior/booking-app.js";
import { expectCheckShape, expectCleanPass, expectFailure, expectPlan } from "../../test/fixtures/checks/_behavior/expectations.js";
import { check } from "./silent-failure.js";

const ID = "silent-failure" as const;
const servers: BookingServer[] = [];

/**
 * The fixture server itself always accepts valid bookings (201). A finding on a BAD page therefore
 * proves the check answered the submit request with a 500 by interception, as the spec requires.
 */
async function app(client: ClientOptions) {
  const s = await startBookingApp(client);
  servers.push(s);
  return s;
}

afterAll(async () => {
  await Promise.all(servers.map((s) => s.server.close()));
  await closeBrowser();
});

describe("silent-failure: contract", () => {
  it("exports a check with the right id and category", () => {
    expectCheckShape(check, ID, "broken-feature");
  });

  it("plans a danger (fault-injection), non-destructive scenario", () => {
    expectPlan(check, sampleForm(), "danger");
  });
});

describe("silent-failure: GOOD", () => {
  it('passes when the error appears in a role="alert" element and inputs are kept', async () => {
    const s = await app({ errorMode: "alert" });
    const { results } = await runCheck(check, s.url);
    expectCleanPass(results, ID);
  });

  it("passes when the error appears (after 1.5 s) in a polite live region present from page load", async () => {
    const s = await app({ errorMode: "live-region", errorDelayMs: 1500 });
    const { results } = await runCheck(check, s.url);
    expectCleanPass(results, ID);
  });

  it("passes when focus moves to the error message instead of using a live region", async () => {
    const s = await app({ errorMode: "focus" });
    const { results } = await runCheck(check, s.url);
    expectCleanPass(results, ID);
  });

  it("does not create a real booking: the submit request is intercepted", async () => {
    const s = await app({ errorMode: "alert" });
    await runCheck(check, s.url);
    expect(s.api.bookings).toHaveLength(0);
  });
});

describe("silent-failure: BAD", () => {
  it("fails when a 500 leaves the form spinning with no message (F02)", async () => {
    const s = await app({ errorMode: "spinner" });
    const { results } = await runCheck(check, s.url);
    expectFailure(results, ID, "broken-feature", ["high", "critical"]);
  });

  it("fails when the error is visible but never announced (no live region, no alert role, focus not moved)", async () => {
    const s = await app({ errorMode: "unannounced" });
    const { results } = await runCheck(check, s.url);
    expectFailure(results, ID, "broken-feature", ["high", "medium", "critical"]);
  });

  it("fails when the error is announced but the user's input is wiped", async () => {
    const s = await app({ errorMode: "reset-form" });
    const { results } = await runCheck(check, s.url);
    expectFailure(results, ID, "broken-feature", ["high", "medium", "critical"]);
  });

  it("fails when the message only appears after the 5 s budget", async () => {
    const s = await app({ errorMode: "alert", errorDelayMs: 7000 });
    const { results } = await runCheck(check, s.url);
    expectFailure(results, ID, "broken-feature", ["high", "medium", "critical"]);
  });
});
