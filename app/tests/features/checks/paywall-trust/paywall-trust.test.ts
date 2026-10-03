import type { Browser } from "playwright";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "../../../support/server.js";
import {
  A,
  ALEX,
  billingApp,
  browser,
  check,
  contexts,
  dirs,
  discover,
  emptyForm,
  expectGrantFinding,
  expectReReadAfterEachProbe,
  expectRestored,
  expectSafe,
  fromBrowser,
  fromRunHound,
  isNavigation,
  isReRead,
  loads,
  named,
  pathOf,
  posts,
  RUN_TOKEN,
  runOn,
  SAM,
  scenarioFor,
  SELF,
  SESSION,
  sink,
  sinkHits,
  sinkPort,
  SUCCESS_LINK,
  usePaywallApp,
} from "../../../support/paywall-app.js";
import type { BillingApp, CancelControl, BillingAppOptions, DiscoveredPage } from "../../../support/paywall-app.js";

// Planning: the check's identity, plan shape, and time budget for the candidate page and quick-scan.

usePaywallApp();

describe("paywall-trust: planning", () => {
  const page: DiscoveredPage = {
    url: "http://127.0.0.1:4100/app",
    title: "Dashboard",
    forms: [],
    controls: [],
    links: 3,
    linkTargets: ["http://127.0.0.1:4100/app/billing", "http://127.0.0.1:4100/app/upgraded"],
  };
  const form = emptyForm(page.url);

  it("is a page-scoped Security check that asks the user to check Account A when interrupted", () => {
    expect(check.id).toBe("paywall-trust");
    expect(check.scope).toBe("page");
    expect(check.category).toBe("security");
    expect(check.interruptedNote).toMatch(/check Account A/);
  });

  it("plans nothing signed out", () => {
    expect(check.plan(form, page)).toEqual([]);
    expect(check.plan(form, page, { signedIn: false, otherAccount: false })).toEqual([]);
  });

  it("plans one unticked, non-destructive scenario signed in, also on a page with no form", () => {
    for (const env of [
      { signedIn: true, otherAccount: false },
      { signedIn: true, otherAccount: true },
    ]) {
      const scenarios = check.plan(form, page, env);
      expect(scenarios).toHaveLength(1);
      const s = scenarios[0]!;
      expect(s.checkId).toBe("paywall-trust");
      expect(s.id.startsWith("paywall-trust")).toBe(true);
      expect(s.defaultSelected).toBe(false);
      expect(s.destructive).toBe(false);
      // Unticked, the plan says what it would do: it may change Account A's plan.
      expect(s.description).toMatch(/Account A/);
      expect(s.description).toMatch(/plan/i);
      // Time budget: up to 10 candidates + linked pages + a restore, each load waiting up to 5 s for quiet: > runner's default 3 minutes.
      expect(check.timeLimitMs?.(s, form, page) ?? 180_000).toBeGreaterThanOrEqual(300_000);
    }
  });
});

describe("paywall-trust: skipped before any probe", () => {
  it("skips with the contract's reason when no plan or entitlement data is found (another user's plan doesn't count)", async () => {
    const server = await billingApp({ entitlement: false, grants: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} } });
    const result = await runOn(server);
    expect(result.status).toBe("skipped");
    expect(result.findings).toEqual([]);
    expect(result.notes).toMatch(/No plan or entitlement data was found, so this can't be checked/);
    // Nothing was probed: no success page opened, no confirm, no cancel, and A's plan is as it was.
    expect(loads(server, "/app/upgraded")).toEqual([]);
    expect(posts(server, "/api/billing/confirm")).toEqual([]);
    expect(posts(server, "/api/billing/cancel")).toEqual([]);
    expect(server.state.plan).toBe("free");
    expectSafe(server, result);
  }, 90_000);

  it("takes the entitlement only from a GET the app makes while loading the page under test, never a guessed or linked page's", async () => {
    // GET /api/me holds A's plan, but /app never requests it (only /api/team, other users); /app/billing, which /app links to, does.
    const server = await billingApp({ pageReadsPlan: false, grants: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} } });
    const result = await runOn(server);
    expect(result.status).toBe("skipped");
    expect(result.findings).toEqual([]);
    expect(result.notes).toMatch(/No plan or entitlement data was found, so this can't be checked/);
    // Run Hound itself sent nothing (no guessed read), and nothing was probed.
    expect(server.requests.filter(fromRunHound)).toEqual([]);
    expect(loads(server, "/app/upgraded")).toEqual([]);
    expect(posts(server, "/api/billing/confirm")).toEqual([]);
    expect(posts(server, "/api/billing/cancel")).toEqual([]);
    expect(server.state.plan).toBe("free");
    expectSafe(server, result);
  }, 90_000);

  it("skips when Account A already has a paid plan, and leaves it alone", async () => {
    const server = await billingApp({ startPlan: "pro", grants: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} } });
    const result = await runOn(server);
    expect(result.status).toBe("skipped");
    expect(result.findings).toEqual([]);
    expect(result.notes).toMatch(/Account A already has a paid plan/);
    expect(loads(server, "/app/upgraded")).toEqual([]);
    expect(posts(server, "/api/billing/confirm")).toEqual([]);
    expect(posts(server, "/api/billing/cancel")).toEqual([]);
    expect(server.state.plan).toBe("pro");
    expectSafe(server, result);
  }, 90_000);
});
