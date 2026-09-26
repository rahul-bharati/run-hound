import { afterAll, describe, expect, it } from "vitest";
import { closeBrowser, runCheck } from "../../test-support/harness.js";
import { json } from "../../test-support/server.js";
import { startBookingApp, sampleForm, type BookingServer, type ClientOptions } from "../../test/fixtures/checks/_behavior/booking-app.js";
import { evidenceText, expectCheckShape, expectCleanPass, expectFailure, expectPlan } from "../../test/fixtures/checks/_behavior/expectations.js";
import { startModernApp, type ModernApp } from "../../test/fixtures/checks/modern-apps.js";
import { check } from "./double-submit.js";
import { MULTI_STEP_NOTE } from "./lib/functional-form.js";

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

describe("double-submit: a server that turns a repeated post into the same record", () => {
  it("GOOD: two posts that come back with the same record id (an idempotency key) saved only once -> pass", async () => {
    const s = await startBookingApp(
      { submitGuard: "none" },
      {},
      {
        routes: {
          "POST /api/bookings": async (req, res) => {
            await new Promise((r) => setTimeout(r, 800));
            json(res, 201, { id: "booking-1", ...(JSON.parse(req.body) as object) });
          },
        },
      },
    );
    servers.push(s);
    const { results } = await runCheck(check, s.url);
    expect(s.createRequests().length).toBeGreaterThanOrEqual(2);
    expectCleanPass(results, ID);
    expect(results[0]!.notes).toMatch(/same record \(booking-1\)/);
  });
});

describe("double-submit: GraphQL apps, where reads are POSTs too (CHK-5)", () => {
  const apps: ModernApp[] = [];
  afterAll(async () => {
    await Promise.all(apps.map((a) => a.close()));
  });
  async function graphqlApp(options: { noGuard?: boolean }) {
    const a = await startModernApp({
      path: "/guestbook",
      heading: "Sign the guestbook",
      fields: [
        { name: "name", label: "Full name", type: "text" },
        { name: "email", label: "Work email", type: "email" },
      ],
      submitLabel: "Sign",
      after: "toast",
      api: "graphql",
      saveDelayMs: 800,
      ...options,
    });
    apps.push(a);
    return a;
  }
  const mutations = (a: ModernApp) => a.requests.filter((r) => r.url === "/graphql" && r.body.includes("mutation"));

  it("GOOD: one mutation from a guarded button passes, though the page posts a query on load and after saving", async () => {
    const a = await graphqlApp({});
    const { results } = await runCheck(check, a.formUrl);
    expect(mutations(a)).toHaveLength(1);
    expect(a.requests.filter((r) => r.url === "/graphql").length).toBeGreaterThanOrEqual(3);
    expectCleanPass(results, ID);
  });

  it("BAD: an unguarded button sends the mutation twice: reported as 2 saves, not counting the queries", async () => {
    const a = await graphqlApp({ noGuard: true });
    const { results } = await runCheck(check, a.formUrl);
    expect(mutations(a)).toHaveLength(2);
    const findings = expectFailure(results, ID, "broken-feature", ["high"]);
    expect(findings[0]!.title).toBe('Double-clicking "Sign" saves 2 times');
    // Every request on the evidence card is the mutation, each with a measured start time.
    const card = JSON.stringify(findings[0]!.evidence.filter((e) => e.kind === "network").map((e) => e.data));
    expect(card).not.toMatch(/query Records/);
  });
});

describe("double-submit: the first step of a wizard (LOV-12)", () => {
  it("skips with the multi-step reason, not as refused test values", async () => {
    const a = await startModernApp({
      path: "/wizard",
      heading: "Set up your workspace",
      fields: [
        { name: "workspace", label: "Workspace name", type: "text" },
        { name: "email", label: "Invite a teammate", type: "email" },
      ],
      submitLabel: "Finish setup",
      after: "toast",
      wizard: true,
    });
    try {
      const { results } = await runCheck(check, a.formUrl);
      expect(results[0]!.status).toBe("skipped");
      expect(results[0]!.notes).toBe(MULTI_STEP_NOTE);
    } finally {
      await a.close();
    }
  });
});
