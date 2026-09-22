import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
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
import * as fixtures from "../../test/fixtures/checks/pii-leak/variants.js";
import { check } from "./pii-leak.js";

const servers: FixtureServer[] = [];
let analytics: FixtureServer;

beforeEach(async () => {
  // Second fixture server on its own random port = a different origin = a third party.
  analytics = await startFixtureServer({
    routes: {
      "GET /collect": (_req, res) => { res.writeHead(204); res.end(); },
      "POST /collect": (_req, res) => { res.writeHead(204); res.end(); },
    },
  });
  servers.push(analytics);
});
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});
afterAll(closeBrowser);

async function run(variant: BookingVariant) {
  const app = bookingApp(variant);
  const server = await startFixtureServer(app.options);
  servers.push(server);
  const { scenarios, results } = await runCheck(check, `${server.url}/book`);
  const booking = app.created.at(-1) as { ownerEmail?: string; phone?: string } | undefined;
  return { scenarios, results, findings: allFindings(results), server, booking };
}

/** The canary email the check submitted, read back from what the target's own API received. */
function submittedEmail(booking: { ownerEmail?: string } | undefined): string {
  expect(booking?.ownerEmail, "the check submitted the form with a canary email").toEqual(expect.any(String));
  return booking!.ownerEmail!;
}

function expectLeakFinding(findingsText: string) {
  // Evidence names the third-party origin that received the data.
  expect(findingsText).toContain(new URL(analytics.url).host);
}

describe("pii-leak check", () => {
  it("is registered under its id as a security check", () => {
    expect(check.id).toBe("pii-leak");
    expect(check.category).toBe("security");
    expect(check.title.trim().length).toBeGreaterThan(0);
  });

  it("GOOD: email only goes to the same-origin API; third party gets an event name -> pass", async () => {
    const { scenarios, results, findings, booking } = await run(fixtures.good(analytics.url));
    expectPlanShape(scenarios, "pii-leak");
    expect(overallStatus(results)).toBe("pass");
    expect(findings).toEqual([]);
    // Sanity: the check really submitted a canary (containing the run token) and the third party was contacted.
    expect(submittedEmail(booking)).toContain("t3st");
    expect(analytics.requests.some((r) => r.url.includes("event=booking_created"))).toBe(true);
  });

  it("BAD (S03): canary email in a third-party query string -> high security finding", async () => {
    const { results, findings, booking } = await run(fixtures.emailInQuery(analytics.url));
    expect(overallStatus(results)).toBe("fail");
    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expectWellFormedFinding(f, { checkId: "pii-leak", category: "security", severity: bug("S03").severity, confidence: "confirmed" });
    expectLeakFinding(findingText(f));
    // Sanity: the leak really happened in this run.
    const email = submittedEmail(booking);
    expect(analytics.requests.some((r) => decodeURIComponent(r.url).includes(email))).toBe(true);
    expect(`${f.title} ${f.meaning}`).toMatch(/email/i);
  });

  it("BAD: SHA-256 of the canary email sent to a third party is still a leak", async () => {
    const { results, findings, booking } = await run(fixtures.hashedEmail(analytics.url));
    expect(overallStatus(results)).toBe("fail");
    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expectWellFormedFinding(f, { checkId: "pii-leak", category: "security", confidence: "confirmed" });
    expectLeakFinding(findingText(f));
    const email = submittedEmail(booking);
    const hash = createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
    expect(analytics.requests.some((r) => r.url.includes(hash))).toBe(true);
    expect(findingText(f)).toMatch(/sha-?256|hash/i);
  });

  it("BAD: canary phone in a third-party POST body -> finding", async () => {
    const { results, findings, booking } = await run(fixtures.phoneInBody(analytics.url));
    expect(overallStatus(results)).toBe("fail");
    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expectWellFormedFinding(f, { checkId: "pii-leak", category: "security", confidence: "confirmed" });
    expectLeakFinding(findingText(f));
    expect(booking?.phone, "the check filled the phone field with a canary").toEqual(expect.any(String));
    expect(analytics.requests.some((r) => r.method === "POST" && r.body.includes(booking!.phone!))).toBe(true);
    expect(`${f.title} ${f.meaning}`).toMatch(/phone/i);
  });
});
