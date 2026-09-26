import { afterAll, describe, expect, it } from "vitest";
import { closeBrowser, runCheck } from "../../test-support/harness.js";
import { startFixtureServer } from "../../test-support/server.js";
import {
  FAKE_CSRF_TOKEN,
  startBookingApp,
  sampleForm,
  type ApiOptions,
  type BookingServer,
  type ClientOptions,
} from "../../test/fixtures/checks/_behavior/booking-app.js";
import { evidenceText, expectCheckShape, expectCleanPass, expectFailure, expectPlan, findingText } from "../../test/fixtures/checks/_behavior/expectations.js";
import { startHangApp } from "../../test/fixtures/checks/hang-app.js";
import { startModernApp } from "../../test/fixtures/checks/modern-apps.js";
import { startSchemaFormApp, type SchemaFormApp, type SchemaFormOptions } from "../../test/fixtures/checks/schema-form.js";
import { MULTI_STEP_NOTE } from "./lib/functional-form.js";
import { check } from "./client-only-validation.js";

const ID = "client-only-validation" as const;
const servers: BookingServer[] = [];

/**
 * Every fixture blocks "end date before start date" in the browser. The server either validates it too
 * (GOOD) or does not (BAD); it always validates everything else, so replaying with some other field made
 * invalid (e.g. an empty pet name) is not enough to catch the BAD server.
 */
async function app(client: ClientOptions, api: ApiOptions) {
  const s = await startBookingApp({ dateOrderCheck: true, ...client }, api);
  servers.push(s);
  return s;
}

afterAll(async () => {
  await Promise.all(servers.map((s) => s.server.close()));
  await closeBrowser();
});

describe("client-only-validation: contract", () => {
  it("exports a check with the right id and category", () => {
    expectCheckShape(check, ID, "validation");
  });

  it("plans a danger, non-destructive scenario for a localhost form", () => {
    expectPlan(check, sampleForm("http://127.0.0.1:5173/book"), "danger");
    expectPlan(check, sampleForm("http://localhost:3000/book"), "danger");
  });

  it("still plans the scenario for a non-localhost target, saying it will be skipped", () => {
    // Leaving it out of the plan hid the check from the plan and the report; it is now planned and skipped with a reason.
    const [scenario, ...rest] = check.plan(sampleForm("https://shop.example.com/book"));
    expect(rest).toEqual([]);
    expect(scenario!.description).toMatch(/skipped/i);
    expect(scenario!.description).toMatch(/localhost/i);
  });
});

describe("client-only-validation: GOOD", () => {
  it("passes when the server rejects the replayed request (end before start) with 400", async () => {
    const s = await app({}, {});
    const { results } = await runCheck(check, s.url);
    expectCleanPass(results, ID);
    // The replay reached the server, and at most one test record was created per scenario.
    expect(s.createRequests().length).toBeGreaterThanOrEqual(1);
    expect(s.api.bookings.length).toBeLessThanOrEqual(results.length);
  });

  it("passes when the server rejects with another 4xx (422)", async () => {
    const s = await app({}, { invalidStatus: 422 });
    const { results } = await runCheck(check, s.url);
    expectCleanPass(results, ID);
  });

  it("passes when the create request needs a CSRF header and the server validates dates", async () => {
    const s = await app({ csrfToken: FAKE_CSRF_TOKEN }, { requireCsrf: FAKE_CSRF_TOKEN });
    const { results } = await runCheck(check, s.url);
    expectCleanPass(results, ID);
  });

  it("picks the request that carries the typed values, not another write the page makes on submit", async () => {
    const s = await app(
      {
        extraScript:
          'document.getElementById("booking").addEventListener("submit", function () { fetch("/api/track", { method: "POST", body: JSON.stringify({ event: "submit" }) }); });',
      },
      { checkDateOrder: false },
    );
    const { results } = await runCheck(check, s.url);
    // The date-order bug is still found, which only works if the booking request (not /api/track) was replayed.
    const findings = expectFailure(results, ID, "validation", ["high", "critical", "medium"]);
    expect(findings.map(findingText).join("\n")).toMatch(/end date|endDate/i);
    // The valid booking was answered by Run Hound, so only the invalid replay reached the server.
    expect(s.api.bookings.length).toBeLessThanOrEqual(results.length);
  });
});

describe("client-only-validation: BAD", () => {
  it("fails when end-before-start is only blocked in the browser and the server accepts it with 201 (F06)", async () => {
    const s = await app({}, { checkDateOrder: false });
    const { results } = await runCheck(check, s.url);
    const findings = expectFailure(results, ID, "validation", ["high", "critical", "medium"]);
    // "Creates at most one test record."
    expect(s.api.bookings.length).toBeLessThanOrEqual(results.length);
    // The accepted invalid record really is end-before-start.
    const invalid = s.api.bookings.filter((b) => (b.endDate ?? "") < (b.startDate ?? ""));
    expect(invalid.length).toBeGreaterThanOrEqual(1);
    expect(findings.map(findingText).join("\n")).toMatch(/end date|endDate/i);
    expect(evidenceText(findings)).toMatch(/201|2\d\d/);
  });

  it("replays the captured request faithfully (same headers), so a CSRF-protected endpoint cannot hide the bug behind a 403", async () => {
    const s = await app({ csrfToken: FAKE_CSRF_TOKEN }, { requireCsrf: FAKE_CSRF_TOKEN, checkDateOrder: false });
    const { results } = await runCheck(check, s.url);
    expectFailure(results, ID, "validation", ["high", "critical", "medium"]);
    expect(s.api.bookings.length).toBeLessThanOrEqual(results.length);
  });
});

describe("client-only-validation: a server error is not a rejection", () => {
  it("fails (medium) when the server answers the invalid replay with 5xx instead of 4xx", async () => {
    const s = await startBookingApp(
      { dateOrderCheck: true },
      {},
      {
        routes: {
          "POST /api/bookings": (_req, res) => {
            res.writeHead(500, { "content-type": "application/json" });
            res.end('{"error":"Something went wrong"}');
          },
        },
      },
    );
    servers.push(s);
    const { results } = await runCheck(check, s.url);
    const findings = expectFailure(results, ID, "validation", ["medium"]);
    expect(findings.map(findingText).join("\n")).toMatch(/500/);
  });
});

describe("client-only-validation: the replay stays on the target", () => {
  it("does not follow a redirect that would send the replayed request to another host", async () => {
    const elsewhere = await startFixtureServer({
      routes: {
        "POST /api/bookings": (_req, res) => {
          res.writeHead(201, { "content-type": "application/json" });
          res.end("{}");
        },
      },
    });
    const s = await startBookingApp(
      { dateOrderCheck: true },
      {},
      {
        routes: {
          "POST /api/bookings": (_req, res) => {
            res.writeHead(307, { location: `${elsewhere.url}/api/bookings` });
            res.end();
          },
        },
      },
    );
    servers.push(s);
    try {
      const { results } = await runCheck(check, s.url);
      expect(elsewhere.requests).toEqual([]);
      expect(results.some((r) => r.status === "fail")).toBe(false);
    } finally {
      await elsewhere.close();
    }
  });
});

describe("client-only-validation: a server that never answers the replay (ENG-1)", () => {
  it("gives up on the replay after 10 seconds and says so plainly", async () => {
    const s = await startHangApp("invalid");
    try {
      const started = Date.now();
      const { results } = await runCheck(check, `${s.url}/contact`);
      expect(Date.now() - started, "the check finished on its own").toBeLessThan(30_000);
      expect(s.hung(), "the replay reached the server and was never answered").toBeGreaterThan(0);
      expect(results[0]!.findings).toEqual([]);
      expect(results[0]!.notes).toMatch(/did not answer within 10 seconds/);
    } finally {
      await s.close();
    }
  }, 45_000);
});

describe("client-only-validation: the first step of a wizard (LOV-12)", () => {
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

describe("client-only-validation: schema-validated forms that mark nothing as required (LOV-6, RH-08)", () => {
  const schemaApps: SchemaFormApp[] = [];
  afterAll(async () => {
    await Promise.all(schemaApps.map((a) => a.close()));
  });
  async function schema(options: SchemaFormOptions) {
    const a = await startSchemaFormApp(options);
    schemaApps.push(a);
    return a;
  }

  it("empties a field the page refuses when empty (found by an empty submit) and reports a server that saves it", async () => {
    const a = await schema({ serverChecks: false });
    const { results } = await runCheck(check, a.formUrl);
    const findings = expectFailure(results, ID, "validation", ["high"]);
    expect(findings[0]!.title).toBe("The server accepts required Task left empty");
    // Only the replay reached the server: the valid save and the empty submit were answered by Run Hound.
    expect(a.posts()).toHaveLength(1);
    expect(a.posts()[0]).toMatchObject({ title: "" });
  });

  it("passes when the server refuses the emptied field", async () => {
    const a = await schema({});
    const { results } = await runCheck(check, a.formUrl);
    expectCleanPass(results, ID);
    expect(results[0]!.notes).toMatch(/400.*required Task left empty/);
  });

  it("never empties an optional field: a page that refuses nothing when empty is skipped with a plain reason", async () => {
    const a = await schema({ validate: false, serverChecks: false });
    const { results } = await runCheck(check, a.formUrl);
    expect(results[0]!.status).toBe("skipped");
    expect(results[0]!.notes).toMatch(/^Skipped: /);
    expect(results[0]!.notes).toMatch(/no error/);
    expect(results[0]!.notes).not.toMatch(/could not be changed/);
    // Nothing reached the app: the valid save and the empty submit were both answered by Run Hound.
    expect(a.posts()).toEqual([]);
  });

  it("RH-10: when the page refuses Run Hound's value, the skip note names that field instead of blaming the app", async () => {
    const a = await schema({ taskMinLength: 80 });
    const { results } = await runCheck(check, a.formUrl);
    expect(results[0]!.status).toBe("skipped");
    expect(results[0]!.notes).toMatch(/showed an error on "Task"/);
    expect(results[0]!.notes).not.toMatch(/may have refused/);
  });
});
