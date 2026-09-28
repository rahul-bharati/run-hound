/**
 * Paywall-trust test: paywall-trust: a clean app
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
  confirmed,
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
import type { BillingApp, CancelControl, BillingAppOptions, Link } from "../../test-support/paywall-app.js";

usePaywallApp();

describe("paywall-trust: a clean app", () => {
  it("passes when the success page grants nothing, without touching the cancel control", async () => {
    const server = await billingApp({ grants: false, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "button" });
    const result = await runOn(server);
    expect(result.findings).toEqual([]);
    expect(result.status).toBe("pass");
    expect(result.notes).toContain("/app/upgraded");
    expect(result.notes).not.toMatch(/check Account A/);
    // The success page really ran as Account A.
    expect(posts(server, "/api/billing/confirm").length).toBeGreaterThan(0);
    expect(loads(server, "/app/upgraded").every((r) => String(r.headers.cookie ?? "").includes(`sid=${SESSION}`))).toBe(true);
    expect(posts(server, "/api/billing/cancel")).toEqual([]);
    expect(server.state.plan).toBe("free");
    expectSafe(server, result);
  }, 90_000);

  it("never confirms a finding from page text alone ('You're on Pro') when the entitlement didn't change", async () => {
    const server = await billingApp({
      grants: false,
      links: [SUCCESS_LINK],
      successPages: { "/app/upgraded": { says: "You're on Pro! Thanks for upgrading." } },
      cancel: "button",
    });
    const result = await runOn(server);
    // The route answered and the entitlement didn't change: a verdict, pass or (with an advisory finding) fail.
    expect(result.status).toBe(result.findings.length > 0 ? "fail" : "pass");
    expect(confirmed(result)).toEqual([]);
    for (const f of result.findings) expect(f.confidence).toBe("advisory");
    expect(posts(server, "/api/billing/cancel")).toEqual([]);
    expect(server.state.plan).toBe("free");
    expectSafe(server, result);
  }, 90_000);

  it("skips, never passes, when no success route answers (every candidate is a 404 or a sign-in redirect)", async () => {
    const server = await billingApp({ grants: true, signInPaths: ["/success", "/app/upgraded"], cancel: "button" });
    const result = await runOn(server);
    expect(result.status).toBe("skipped");
    expect(result.findings).toEqual([]);
    expect(result.notes).toMatch(/No success or upgrade page answered, so this can't be checked/);
    expect(posts(server, "/api/billing/cancel")).toEqual([]);
    expect(server.state.plan).toBe("free");
    expectSafe(server, result);
  }, 90_000);

  it("counts a route a single-page app sends to sign-in in the browser as a sign-in redirect: skipped, never a pass", async () => {
    // Every path the app has no page for answers 200 with the app's shell, whose script goes to /login.
    const server = await billingApp({ grants: true, links: [SUCCESS_LINK], spaFallback: "sign-in", cancel: "button" });
    const result = await runOn(server);
    expect(result.status).toBe("skipped");
    expect(result.findings).toEqual([]);
    expect(result.notes).toMatch(/No success or upgrade page answered, so this can't be checked/);
    expect(server.state.confirms).toBe(0);
    expect(posts(server, "/api/billing/cancel")).toEqual([]);
    expect(server.state.plan).toBe("free");
    // The sign-in page it landed on was never filled in (expectSafe: no POST /login).
    expectSafe(server, result);
  }, 90_000);

  it("opens only links that name a success or upgrade result together with a billing word, never other welcome or success pages", async () => {
    // On the Billing page (a page the page under test links to): a product tour and a blog post. Neither is about a
    // plan, and each marks onboarding done as soon as it loads.
    const tour: Link = { href: "/welcome", text: "Take the product tour" };
    const stories: Link = { href: "/blog/customer-success-stories", text: "Customer success stories" };
    const server = await billingApp({
      grants: false,
      links: [SUCCESS_LINK],
      successPages: { "/app/upgraded": {} },
      billingLinks: [tour, stories],
      onboardingPages: [tour.href, stories.href],
      cancel: "button",
    });
    const result = await runOn(server);
    expect(result.status).toBe("pass");
    expect(result.findings).toEqual([]);
    expect(loads(server, tour.href)).toEqual([]);
    expect(loads(server, stories.href)).toEqual([]);
    // expectSafe also fails a POST /api/onboarding/complete.
    expectSafe(server, result);
  }, 90_000);
});

