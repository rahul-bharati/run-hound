// A restore whose confirmation heads for a payment provider: never click the confirm, name the hop, hold server redirects and portal starts.

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

describe("paywall-trust: a restore whose confirmation heads for a payment provider", () => {
  it("never clicks the app's confirmation when its form posts to the payment provider, and says to check Account A", async () => {
    const server = await billingApp({ grants: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "provider-confirm" });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expect(server.state.plan).toBe("pro");
    expect(posts(server, "/api/billing/cancel")).toEqual([]);
    expect(result.notes).toMatch(/"Yes, cancel plan"[^.]*payment provider \(billing\.stripe\.com\)/);
    expect(result.notes).toMatch(/billing\.stripe\.com: blocked \(payment provider\)/);
    expect(result.notes).toMatch(/Account A's plan is still "?pro"?: check Account A/);
    expectSafe(server, result);
  }, 90_000);

  it("stops the redirect to the provider when the confirmation posts to the app and the app answers with the provider's cancel page", async () => {
    const server = await billingApp({ grants: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "redirect-confirm" });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    // The app's own cancel went from its confirmation, in the browser; the provider's page it answered with never loaded.
    const cancels = posts(server, "/api/billing/cancel");
    expect(cancels).toHaveLength(1);
    expect(fromBrowser(cancels[0]!)).toBe(true);
    expect(server.state.plan).toBe("pro");
    expect(result.notes).toMatch(/billing\.stripe\.com: blocked \(payment provider\)/);
    expect(result.notes).not.toMatch(/reached the provider/);
    expect(result.notes).toMatch(/Account A's plan is still "?pro"?: check Account A/);
    expectSafe(server, result);
  }, 90_000);

  it("stops the hop when the confirmation posts to the app and the app redirects to a checkout host the provider list doesn't name", async () => {
    const server = await billingApp({ grants: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "redirect-unlisted" });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expect(posts(server, "/api/billing/cancel")).toHaveLength(1);
    expect(server.state.plan).toBe("pro");
    // The notes say where the click headed (not "that click may have changed something else"), and to check Account A.
    expect(result.notes).toMatch(/"Cancel plan" on \/app\/billing headed for another site \(pay\.gateway\.test\), which Run Hound stopped/);
    expect(result.notes).not.toMatch(/may have changed something else/);
    expect(result.notes).toMatch(/Account A's plan is still "?pro"?: check Account A/);
    // expectSafe: nothing reached the stand-in host.
    expectSafe(server, result);
  }, 90_000);

  it("never loads a new window the cancel control opens (whose address redirects to the provider), and names it", async () => {
    const server = await billingApp({
      grants: true,
      links: [SUCCESS_LINK],
      successPages: { "/app/upgraded": {} },
      cancel: "opens-window",
      providerRedirects: ["/billing/return"],
    });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expect(loads(server, "/billing/return")).toEqual([]);
    expect(result.notes).toMatch(/\/app\/billing opened a new window at \/billing\/return, which Run Hound didn't load/);
    expect(result.notes).not.toMatch(/reached the provider/);
    expectRestored(server, result, "/app/billing");
    expectSafe(server, result);
  }, 90_000);

  it("holds the hop of a server redirect: a confirmation whose cancel answers with a redirect to the app's own billing portal start never reaches it", async () => {
    const server = await billingApp({
      grants: true,
      links: [SUCCESS_LINK],
      successPages: { "/app/upgraded": {} },
      cancel: "redirect-portal-confirm",
      providerRedirects: ["/billing/portal"],
    });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    // The app's own cancel went (from its confirmation, in the browser); the portal start it redirected to never did.
    expect(posts(server, "/api/billing/cancel")).toHaveLength(1);
    expect(loads(server, "/billing/portal")).toEqual([]);
    expect(server.state.plan).toBe("pro");
    expect(result.notes).toMatch(/"Cancel plan" on \/app\/billing went on to \/billing\/portal[^.]*stopped/);
    expect(result.notes).toMatch(/Account A's plan is still "?pro"?: check Account A/);
    expectSafe(server, result);
  }, 90_000);

  it("never lets the plan control create a billing portal session (a write its script sends before heading for the provider)", async () => {
    const server = await billingApp({ grants: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "portal-fetch" });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expect(posts(server, "/api/billing/portal-session")).toEqual([]);
    expect(server.state.plan).toBe("pro");
    expect(result.notes).toMatch(/"Cancel subscription" on \/app\/billing sent a request to \/api\/billing\/portal-session[^.]*stopped/);
    expect(result.notes).toMatch(/Account A's plan is still "?pro"?: check Account A/);
    expectSafe(server, result);
  }, 90_000);

  it("never clicks a plan control that links to the app's own billing portal start", async () => {
    const server = await billingApp({ grants: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "portal-link", providerRedirects: ["/billing/portal"] });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expect(loads(server, "/billing/portal")).toEqual([]);
    expect(server.state.plan).toBe("pro");
    expect(result.notes).toMatch(/"Cancel plan" on \/app\/billing opens \/billing\/portal/);
    expect(result.notes).toMatch(/Account A's plan is still "?pro"?: check Account A/);
    expectSafe(server, result);
  }, 90_000);

  it("holds a plan control whose script sends the browser to the app's own billing portal start, and counts the restore as failed", async () => {
    const server = await billingApp({ grants: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "portal-script", providerRedirects: ["/billing/portal"] });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expect(loads(server, "/billing/portal")).toEqual([]);
    expect(server.state.plan).toBe("pro");
    expect(result.notes).toMatch(/"Cancel plan" on \/app\/billing went on to \/billing\/portal[^.]*stopped/);
    expect(result.notes).toMatch(/Account A's plan is still "?pro"?: check Account A/);
    expectSafe(server, result);
  }, 90_000);

  it("never clicks a confirmation whose form posts to the app's own billing portal start", async () => {
    const server = await billingApp({ grants: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "portal-confirm", providerRedirects: ["/billing/portal"] });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expect(server.requests.filter((r) => pathOf(r) === "/billing/portal")).toEqual([]);
    expect(server.state.plan).toBe("pro");
    expect(result.notes).toMatch(/"Yes, cancel plan" on \/app\/billing opens \/billing\/portal/);
    expect(result.notes).toMatch(/Account A's plan is still "?pro"?: check Account A/);
    expectSafe(server, result);
  }, 90_000);

  it("never clicks a plan control whose form goes to a path that names the payment provider, and says so", async () => {
    // Safe direction on purpose: /api/stripe/… may be a cancel, or a portal the app's server opens at the provider.
    const server = await billingApp({ grants: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "stripe-path-form" });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expect(server.requests.filter((r) => pathOf(r) === "/api/stripe/cancel-subscription")).toEqual([]);
    expect(server.state.plan).toBe("pro");
    expect(result.notes).toMatch(/"Cancel plan" on \/app\/billing opens \/api\/stripe\/cancel-subscription \(a path that names the payment provider\)/);
    expect(result.notes).toMatch(/Account A's plan is still "?pro"?: check Account A/);
    expectSafe(server, result);
  }, 90_000);

  it("keeps holding the page's navigation to a billing portal start after the click's own hold ended (a timer the cancel set)", async () => {
    const server = await billingApp({ grants: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "timer-portal", providerRedirects: ["/billing/portal"] });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expectRestored(server, result, "/app/billing");
    // The page's timer fires 1.5 s after the cancel answered, after the check is done with the click: still held.
    await new Promise((resolve) => setTimeout(resolve, 3000));
    expect(loads(server, "/billing/portal")).toEqual([]);
    expectSafe(server, result);
  }, 90_000);
});

