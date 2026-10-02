// Only a gain is a grant: spent credits, trials, refills, and SPA catch-alls must not be confirmed; paid-plan gain alongside a spend still is.

import type { Browser } from "playwright";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "../../../../test-support/server.js";
import {
  A,
  ALEX,
  billingApp,
  browser,
  confirmed,
  contexts,
  CONVENTIONAL,
  dirs,
  discover,
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
} from "../../../../test-support/paywall-app.js";
import type { BillingApp, CancelControl, BillingAppOptions, SuccessPage } from "../../../../test-support/paywall-app.js";

usePaywallApp();

describe("paywall-trust: only a gain is a grant", () => {
  it("never confirms a finding on a clean app whose success page spends a credit as it loads: inconclusive, naming the credits, check Account A", async () => {
    // Nothing ever raises the plan or adds credits; the page's own "AI summary" spends one credit (45 → 44).
    const server = await billingApp({ grants: false, credits: 45, successSpends: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "button" });
    const result = await runOn(server);
    expect(server.state.credits).toBeLessThan(45);
    expect(confirmed(result)).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(result.status).toBe("skipped");
    expect(result.notes).toContain("/app/upgraded");
    expect(result.notes).toMatch(/credits/);
    expect(result.notes).toContain("45 → 44");
    expect(result.notes).toMatch(/check Account A/);
    // Spent credits aren't a plan a cancel can put back: nothing was clicked.
    expect(posts(server, "/api/billing/cancel")).toEqual([]);
    expect(server.state.plan).toBe("free");
    expectSafe(server, result, /^POST \/api\/summary$/);
  }, 90_000);

  it("never confirms a finding when a success page moves the plan from free to a trial (not a paid plan)", async () => {
    const server = await billingApp({ grants: false, confirmPlan: "trial", links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "button" });
    const result = await runOn(server);
    expect(server.state.confirms).toBeGreaterThan(0);
    expect(confirmed(result)).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(result.status).toBe("skipped");
    expect(result.notes).toContain("/app/upgraded");
    expect(result.notes).toMatch(/plan/);
    expect(result.notes).toMatch(/"trial"/);
    expect(result.notes).toMatch(/check Account A/);
    expectSafe(server, result);
  }, 90_000);

  it.each(["pro_trial", "Pro trial"])("never confirms a finding when a success page moves the plan from free to a named trial (%s)", async (plan) => {
    const server = await billingApp({ grants: false, confirmPlan: plan, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "button" });
    const result = await runOn(server);
    expect(server.state.confirms).toBeGreaterThan(0);
    expect(confirmed(result)).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(result.status).toBe("skipped");
    expect(result.notes).toContain("/app/upgraded");
    expect(result.notes).toMatch(/check Account A/);
    expectSafe(server, result);
  }, 90_000);

  it("never confirms a finding when A's credits refill on a timer while the success page does nothing", async () => {
    // +1 credit every 1.5 s, starting after Run Hound's two baseline reads (so they can't see it).
    const server = await billingApp({ grants: false, credits: 5, refillEveryMs: 1_500, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "button" });
    const result = await runOn(server);
    expect(confirmed(result)).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(result.status).toBe("skipped");
    expect(result.notes).toMatch(/^Inconclusive/);
    expect(result.notes).toMatch(/credits/);
    expect(result.notes).toMatch(/on (its|their) own/);
    // Run Hound changed nothing: no note blames it on the check or asks to check Account A for it.
    expect(result.notes).not.toMatch(/still[^.]*check Account A/);
    expect(posts(server, "/api/billing/cancel")).toEqual([]);
    expect(server.state.plan).toBe("free");
    expectSafe(server, result);
  }, 120_000);

  it("never confirms a finding when A's credits refill every 40 s, slower than any pause with nothing opened (0.6.0 review, round 3)", async () => {
    // Every success page keeps the network busy for ~5 s (beacon every 400 ms), so the refill can tick once while a route is open.
    const busy: SuccessPage = {
      confirms: false,
      extra: `<script>var n = 0, t = setInterval(function () { fetch('/api/team'); if (++n >= 12) clearInterval(t); }, 400);</script>`,
    };
    const successPages = Object.fromEntries(CONVENTIONAL.map((p) => [p, busy]));
    const server = await billingApp({ grants: false, credits: 5, refillEveryMs: 40_000, links: [SUCCESS_LINK], successPages, cancel: "button" });
    const result = await runOn(server);
    expect(confirmed(result)).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(result.status).toBe("skipped");
    expect(result.notes).toMatch(/^Inconclusive/);
    expect(result.notes).toMatch(/credits/);
    expect(result.notes).not.toMatch(/still[^.]*check Account A/);
    expect(posts(server, "/api/billing/cancel")).toEqual([]);
    expect(server.state.plan).toBe("free");
    expectSafe(server, result);
  }, 240_000);

  it("never credits a gain to a route that showed the page under test itself (a single-page app's catch-all)", async () => {
    // Every path the app has no page for shows the dashboard (the page under test), whose own load adds a bonus credit.
    const server = await billingApp({ grants: false, credits: 5, shellBonus: true, spaFallback: "shell", cancel: "button" });
    const result = await runOn(server);
    expect(confirmed(result)).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(result.status).toBe("skipped");
    expect(result.notes).toMatch(/credits/);
    expect(result.notes).toMatch(/same page as \/app\b/);
    expect(result.notes).toMatch(/check Account A/);
    expect(posts(server, "/api/billing/cancel")).toEqual([]);
    expectSafe(server, result, /^POST \/api\/daily-bonus$/);
  }, 90_000);

  it("still confirms a paid plan granted by a success page that also spends a credit, and names the plan, not the credits", async () => {
    const server = await billingApp({ grants: true, credits: 45, successSpends: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "button" });
    const result = await runOn(server);
    const f = expectGrantFinding(result, "/app/upgraded");
    expect(f.meaning).toMatch(/plan "free" → "pro"/);
    expect(f.meaning).not.toMatch(/credits/);
    // The plan was put back; the credit the page spent is still named.
    expect(server.state.plan).toBe("free");
    expect(posts(server, "/api/billing/cancel")).toHaveLength(1);
    expect(result.notes).toMatch(/credits/);
    expect(result.notes).toMatch(/check Account A/);
    expectSafe(server, result, /^POST \/api\/summary$/);
  }, 90_000);
});

