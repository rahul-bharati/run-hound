/**
 * Tester release (0.1.0): test data is disclosed, not deleted (docs/v0-spec.md, "Tester release").
 * The report states how many test records the run created, in report.md and report.html, so a tester knows what
 * to clean up in their own app. Checked against the fixture app's own count of created bookings.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import { bookingApp } from "../../test/fixtures/checks/booking-page.js";
import type { Check } from "../core/types.js";
import { check as axeStates } from "../checks/axe-states.js";
import { check as consoleNetworkErrors } from "../checks/console-network-errors.js";
import { check as focusVisible } from "../checks/focus-visible.js";
import { startModernApp } from "../../test/fixtures/checks/modern-apps.js";
import { discoverAndPlan, runPlan } from "./runner.js";

let runsDir: string;
const servers: FixtureServer[] = [];

beforeEach(async () => {
  runsDir = await mkdtemp(join(tmpdir(), "rh-test-records-"));
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
  await rm(runsDir, { recursive: true, force: true });
});

async function runWith(checks: Check[]) {
  const app = bookingApp();
  const server = await startFixtureServer(app.options);
  servers.push(server);
  const plan = await discoverAndPlan(`${server.url}/book`, { checks });
  const { report, dir } = await runPlan(plan, { checks, approved: plan.scenarios.map((s) => s.id), runsDir, log: () => undefined });
  const md = await readFile(join(dir, "report.md"), "utf8");
  const html = await readFile(join(dir, "report.html"), "utf8");
  return { report, md, html, created: app.created };
}

/** The number the report gives in "N test record(s)", with "no test records" read as 0; null when it says nothing. */
function statedCount(text: string): number | null {
  const plain = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const m = /\b(\d+|no) test records?\b/i.exec(plain);
  if (!m) return null;
  return /^no$/i.test(m[1]!) ? 0 : Number(m[1]);
}

describe("test records created by the run", () => {
  it("a run that submits the form states how many test records it created", async () => {
    const { md, html, created } = await runWith([axeStates]);
    expect(created.length, "the fixture app recorded bookings").toBeGreaterThan(0);
    expect(statedCount(md), "report.md states the count").toBe(created.length);
    expect(statedCount(html), "report.html states the count").toBe(created.length);
  }, 240_000);

  it("a run that creates nothing says so (0 / no test records)", async () => {
    const { md, html, created } = await runWith([focusVisible]);
    expect(created).toHaveLength(0);
    expect(statedCount(md)).toBe(0);
    expect(statedCount(html)).toBe(0);
  }, 240_000);

  it("the plan text of a scenario that creates records says so", async () => {
    const app = bookingApp();
    const server = await startFixtureServer(app.options);
    servers.push(server);
    const plan = await discoverAndPlan(`${server.url}/book`, { checks: [axeStates] });
    for (const s of plan.scenarios) expect(`${s.title} ${s.description}`).toMatch(/test records?/i);
  }, 120_000);
});

describe("test records created by a GraphQL app (CHK-5)", () => {
  it("counts the mutation that saved the record, not the queries the page posts on load and after saving", async () => {
    const app = await startModernApp({
      path: "/guestbook",
      heading: "Guest book",
      fields: [{ name: "name", label: "Your name", type: "text" }],
      submitLabel: "Sign",
      after: "toast",
      api: "graphql",
    });
    try {
      const plan = await discoverAndPlan(app.formUrl, { checks: [consoleNetworkErrors] });
      const { report } = await runPlan(plan, { checks: [consoleNetworkErrors], approved: plan.scenarios.map((s) => s.id), runsDir, log: () => undefined });
      expect(app.requests.filter((r) => r.url === "/graphql" && r.body.includes("query Records")).length, "the page posted queries").toBeGreaterThan(1);
      expect(app.records).toHaveLength(1);
      expect(report.testRecordsCreated).toBe(1);
    } finally {
      await app.close();
    }
  }, 120_000);
});
