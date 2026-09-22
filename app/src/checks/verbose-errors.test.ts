import { afterAll, describe, expect, it } from "vitest";
import { closeBrowser, runCheck } from "../../test-support/harness.js";
import { startBookingApp, sampleForm, type ApiOptions, type BookingServer, type ClientOptions } from "../../test/fixtures/checks/_behavior/booking-app.js";
import { evidenceText, expectCheckShape, expectCleanPass, expectFailure, expectPlan } from "../../test/fixtures/checks/_behavior/expectations.js";
import { check } from "./verbose-errors.js";

const ID = "verbose-errors" as const;
const servers: BookingServer[] = [];

/**
 * The fixture form has no client-side length or format checks, so oversized and malformed values reach
 * the server whether the check types them into the form or sends them directly.
 * GOOD server: 400 { errors: { field: friendly message } }, or 400 { error } for a malformed body.
 * BAD server (stackOnBadInput): 500 { error, stack } with a Node stack trace and /srv/kennel/... paths.
 */
async function app(client: ClientOptions, api: ApiOptions) {
  const s = await startBookingApp(client, api);
  servers.push(s);
  return s;
}

afterAll(async () => {
  await Promise.all(servers.map((s) => s.server.close()));
  await closeBrowser();
});

describe("verbose-errors: contract", () => {
  it("exports a check with the right id and category", () => {
    expectCheckShape(check, ID, "security");
  });

  it("plans a danger, non-destructive scenario", () => {
    expectPlan(check, sampleForm(), "danger");
  });
});

describe("verbose-errors: GOOD", () => {
  it("passes when bad input gets friendly field messages, even though they contain words like 'error' and 'at'", async () => {
    // The page also says "Sitters arrive at 9 am" and shows "... must be 50 characters or fewer." messages:
    // ordinary prose with "at" or "Error" is not a stack trace.
    const s = await app(
      { extraScript: 'document.querySelector(".help").insertAdjacentText("beforeend", " Error codes are listed at help.example.test.");' },
      {},
    );
    const { results } = await runCheck(check, s.url);
    expectCleanPass(results, ID);
    // Sanity: the check really sent bad input and the server rejected it.
    expect(s.createRequests().length).toBeGreaterThanOrEqual(1);
  });

  it("passes when the server answers 500 with a generic message and no internals", async () => {
    // A plain 500 is someone else's finding (console-network-errors / silent-failure), not a verbose error.
    const s = await app({}, { genericErrorOnBadInput: true });
    const { results } = await runCheck(check, s.url);
    expectCleanPass(results, ID);
    expect(s.createRequests().length).toBeGreaterThanOrEqual(1);
  });
});

describe("verbose-errors: BAD", () => {
  it("fails when a server error shows a stack trace in the page (S04)", async () => {
    const s = await app({ showStack: true }, { stackOnBadInput: true });
    const { results } = await runCheck(check, s.url);
    const findings = expectFailure(results, ID, "security", ["medium", "high"]);
    expect(evidenceText(findings)).toMatch(/validateBooking|\/srv\/kennel\/server\/bookings\.js/);
  });

  it("fails when the stack trace is only in the response body (the page shows a generic message)", async () => {
    const s = await app({ showStack: false }, { stackOnBadInput: true });
    const { results } = await runCheck(check, s.url);
    const findings = expectFailure(results, ID, "security", ["medium", "high", "low"]);
    expect(evidenceText(findings)).toMatch(/validateBooking|\/srv\/kennel\/server\/bookings\.js/);
  });
});
