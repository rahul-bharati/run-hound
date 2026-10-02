// A billing tab that heads for a payment provider: chosen to read links and look for the plan's control; a held portal start, write, or beacon.

import type { Browser } from "playwright";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "../../../../test-support/server.js";
import {
  A,
  ALEX,
  billingApp,
  browser,
  contexts,
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
import type { BillingApp, CancelControl, BillingAppOptions } from "../../../../test-support/paywall-app.js";

usePaywallApp();

describe("paywall-trust: a billing tab that heads for a payment provider", () => {
  it("chooses Billing tabs that send the browser to the app's billing portal (which redirects to the provider) or straight to the provider, and neither gets there", async () => {
    const server = await billingApp({
      grants: true,
      successPages: { "/app/upgraded": {} },
      cancel: "button",
      navTabs: [
        { name: "Billing", to: "/billing/portal" },
        { name: "Payments", to: "https://billing.stripe.com/p/session/test_tab" },
      ],
      providerRedirects: ["/billing/portal"],
    });
    const result = await runOn(server);
    // Tabs chosen to read links and look for the plan's control; probe granted Pro on /app/upgraded and Cancel plan put it back.
    expectGrantFinding(result, "/app/upgraded");
    expectRestored(server, result, "/app/billing");
    // Portal start was held before the app's server saw it, so its redirect to the provider never happened.
    expect(loads(server, "/billing/portal")).toEqual([]);
    expect(result.notes).toMatch(/"Billing" tab on \/app sent the browser to \/billing\/portal[^.]*stopped/);
    // The tab that went straight to the provider was blocked, and listed.
    expect(result.notes).toMatch(/billing\.stripe\.com: blocked \(payment provider\)/);
    // Chosen after Billing on the same page, whose script may still be running: both are named (review round 2).
    expect(result.notes).toMatch(/After Run Hound chose the "Billing" and "Payments" tabs on \/app, the page headed for billing\.stripe\.com \(payment provider\)[^.]*blocked/);
    expectSafe(server, result);
  }, 120_000);

  it("never lets a Billing tab create a billing portal session (a write its script sends before heading for the provider), and names it", async () => {
    // The usual Stripe customer-portal button: POST to the app, which creates the session at the provider and answers with its URL.
    const server = await billingApp({
      grants: false,
      cancel: "button",
      successPages: { "/thanks": {} },
      navTabs: [{ name: "Billing", to: "fetch:/api/billing/portal-session" }],
    });
    const result = await runOn(server);
    expect(result.status).toBe("pass");
    expect(posts(server, "/api/billing/portal-session")).toEqual([]);
    expect(result.notes).toMatch(/"Billing" tab on \/app sent a request to \/api\/billing\/portal-session[^.]*stopped/);
    expectSafe(server, result);
  }, 120_000);

  it("never lets a Billing tab's beacon create a billing portal session, and names a tab that heads for a site the provider list doesn't name", async () => {
    // navigator.sendBeacon is a POST like a fetch (DevTools calls it a "Ping"): the portal session must not be created.
    const server = await billingApp({
      grants: false,
      cancel: "button",
      successPages: { "/thanks": {} },
      navTabs: [
        { name: "Billing", to: "script:navigator.sendBeacon('/api/billing/portal-session'); location.href = 'https://billing.stripe.com/p/session/x';" },
        { name: "Payments", to: "https://pay.gateway.test/portal" },
      ],
    });
    const result = await runOn(server);
    expect(result.status).toBe("pass");
    expect(posts(server, "/api/billing/portal-session")).toEqual([]);
    expect(result.notes).toMatch(/"Billing" tab on \/app sent a request to \/api\/billing\/portal-session[^.]*stopped/);
    expect(result.notes).toMatch(/After Run Hound chose the "Billing" and "Payments" tabs on \/app, the page headed for pay\.gateway\.test \(another site\)[^.]*stopped/);
    expectSafe(server, result);
  }, 120_000);

  it("names a held tab once, even when a page it opens to read links lands back on the page under test (whose tab is chosen again)", async () => {
    const server = await billingApp({
      grants: false,
      successPages: { "/app/upgraded": {} },
      cancel: "button",
      navTabs: [{ name: "Billing", to: "/billing/portal" }],
      providerRedirects: ["/billing/portal"],
      links: [{ href: "/app/account", text: "Account" }],
      redirects: { "/app/account": "/app" },
    });
    const result = await runOn(server);
    expect(result.status).toBe("pass");
    // /app/account was opened to read its links and landed on /app, whose Billing tab was chosen there too.
    expect(loads(server, "/app/account").length).toBeGreaterThan(0);
    expect(loads(server, "/billing/portal")).toEqual([]);
    expect(result.notes?.match(/"Billing" tab on \/app sent the browser to \/billing\/portal/g)).toHaveLength(1);
    expectSafe(server, result);
  }, 120_000);
});

