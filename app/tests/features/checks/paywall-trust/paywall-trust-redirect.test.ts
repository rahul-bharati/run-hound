/**
 * Paywall-trust test: paywall-trust: a success page that sends the browser on to a payment provider
 * Split from app/src/checks/paywall-trust.test.ts for parallel execution
 * Shared fixtures: test-support/paywall-app.ts
 */

import type { Browser } from "playwright";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "../../test-support/server.js";
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
} from "../../test-support/paywall-app.js";
import type { BillingApp, CancelControl, BillingAppOptions } from "../../test-support/paywall-app.js";

usePaywallApp();

describe("paywall-trust: a success page that sends the browser on to a payment provider", () => {
  it("holds the page's own navigation to a checkout start on this site (which would redirect to the provider) and still reports the grant", async () => {
    const server = await billingApp({
      grants: true,
      links: [SUCCESS_LINK],
      cancel: "button",
      successPages: { "/app/upgraded": { after: "location.href = '/checkout/start';" } },
      providerRedirects: ["/checkout/start"],
    });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expect(loads(server, "/checkout/start")).toEqual([]);
    expect(result.notes).toMatch(/\/app\/upgraded sent the browser to \/checkout\/start[^.]*stopped/);
    expectRestored(server, result, "/app/billing");
    expectSafe(server, result);
  }, 90_000);

  it("stops the provider redirect when the page goes on to a page of this site whose path names no checkout", async () => {
    const server = await billingApp({
      grants: true,
      links: [SUCCESS_LINK],
      cancel: "button",
      successPages: { "/app/upgraded": { after: "location.href = '/billing/return';" } },
      providerRedirects: ["/billing/return"],
    });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expect(result.notes).toMatch(/checkout\.stripe\.com: blocked \(payment provider\)/);
    expect(result.notes).not.toMatch(/reached the provider/);
    expectRestored(server, result, "/app/billing");
    expectSafe(server, result);
  }, 90_000);

  it("stops a server redirect's hop to a checkout host the provider list doesn't name, on a page the success page goes on to", async () => {
    const server = await billingApp({
      grants: true,
      links: [SUCCESS_LINK],
      cancel: "button",
      successPages: { "/app/upgraded": { after: "location.href = '/billing/return';" } },
      redirects: { "/billing/return": "https://pay.gateway.test/c/1" },
    });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expect(result.notes).toMatch(/pay\.gateway\.test: another site \(\/app\/upgraded headed there\)/);
    expect(result.notes).not.toMatch(/reached the provider/);
    expectRestored(server, result, "/app/billing");
    // expectSafe: nothing reached the stand-in host.
    expectSafe(server, result);
  }, 90_000);

  it("never loads a new window the success page opens (whose address redirects to the provider), and names it", async () => {
    // A new window's first request comes before Run Hound can watch that window for a redirect to a provider.
    const server = await billingApp({
      grants: true,
      links: [SUCCESS_LINK],
      cancel: "button",
      successPages: { "/app/upgraded": { after: "window.open('/billing/return');" } },
      providerRedirects: ["/billing/return"],
    });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    // The window's first load was never sent, so the app's server never got to send it on to the provider.
    expect(loads(server, "/billing/return")).toEqual([]);
    expect(result.notes).toMatch(/\/app\/upgraded opened a new window at \/billing\/return, which Run Hound didn't load/);
    expect(result.notes).not.toMatch(/reached the provider/);
    expectRestored(server, result, "/app/billing");
    expectSafe(server, result);
  }, 90_000);

  it("stops the provider redirect when a success route itself answers with one, and goes on to the next route", async () => {
    // A clean app: /checkout/success (a conventional path) sends the browser to the provider; /thanks answers after it.
    const server = await billingApp({ grants: false, cancel: "button", successPages: { "/thanks": {} }, providerRedirects: ["/checkout/success"] });
    const result = await runOn(server);
    expect(loads(server, "/checkout/success").length).toBeGreaterThan(0);
    expect(loads(server, "/thanks").length).toBeGreaterThan(0);
    expect(result.status).toBe("pass");
    expect(result.findings).toEqual([]);
    expect(result.notes).toMatch(/checkout\.stripe\.com: blocked \(payment provider\)/);
    expect(result.notes).not.toMatch(/reached the provider/);
    expect(server.state.plan).toBe("free");
    expectSafe(server, result);
  }, 120_000);

  it("holds the hop of a server redirect: a page the success page goes on to redirects to a checkout start, which is never reached", async () => {
    const server = await billingApp({
      grants: true,
      links: [SUCCESS_LINK],
      cancel: "button",
      successPages: { "/app/upgraded": { after: "location.href = '/billing/return';" } },
      redirects: { "/billing/return": "/checkout/start" },
      providerRedirects: ["/checkout/start"],
    });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expect(loads(server, "/checkout/start")).toEqual([]);
    expect(result.notes).toMatch(/\/app\/upgraded sent the browser to \/checkout\/start[^.]*stopped/);
    expectRestored(server, result, "/app/billing");
    expectSafe(server, result);
  }, 90_000);

  it("holds the hop of a server redirect on a route Run Hound opens itself: a conventional path that redirects to a checkout start", async () => {
    // A clean app: /checkout/success answers 302 to /checkout/start (which would redirect to the provider).
    const server = await billingApp({
      grants: false,
      cancel: "button",
      successPages: { "/thanks": {} },
      redirects: { "/checkout/success": "/checkout/start" },
      providerRedirects: ["/checkout/start"],
    });
    const result = await runOn(server);
    expect(loads(server, "/checkout/success").length).toBeGreaterThan(0);
    expect(loads(server, "/checkout/start")).toEqual([]);
    expect(result.status).toBe("pass");
    expect(result.notes).toMatch(/\/checkout\/success sent the browser to \/checkout\/start[^.]*stopped/);
    expect(result.notes).toMatch(/\/checkout\/success \(stopped\)/);
    expectSafe(server, result);
  }, 120_000);

  it("holds the page's navigation to a checkout start of the app on another local origin (localhost for 127.0.0.1)", async () => {
    const server = await billingApp({
      grants: true,
      links: [SUCCESS_LINK],
      cancel: "button",
      successPages: {
        "/app/upgraded": { after: "location.href = location.href.replace('127.0.0.1', 'localhost').replace(/\\/app\\/upgraded.*$/, '/checkout/start');" },
      },
      providerRedirects: ["/checkout/start"],
    });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expect(loads(server, "/checkout/start")).toEqual([]);
    // The note names the other origin's host, so it isn't taken for a path of the page's own origin.
    expect(result.notes).toMatch(/\/app\/upgraded sent the browser to localhost:\d+\/checkout\/start[^.]*stopped/);
    expectRestored(server, result, "/app/billing");
    // expectSafe also checks that no request reached the app under another host name.
    expectSafe(server, result);
  }, 90_000);
});

