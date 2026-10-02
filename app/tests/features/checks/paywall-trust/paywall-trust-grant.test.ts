// A success page that grants a paid plan on load: discover via links, conventional paths, nested pages; named exactly once per grant; re-read failures stay inconclusive.

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
import type { BillingApp, CancelControl, BillingAppOptions, Link } from "../../../../test-support/paywall-app.js";

usePaywallApp();

describe("paywall-trust: a success page that grants a paid plan on load", () => {
  it("finds a success route the page links to, as Account A, and puts Account A back on Free through the app's Cancel plan", async () => {
    const route = "/account/plan/activated";
    const server = await billingApp({ grants: true, links: [{ href: route, text: "Already paid? Refresh your plan" }], successPages: { [route]: {} }, cancel: "button" });
    const result = await runOn(server);
    expectGrantFinding(result, route);
    // The route was opened in Account A's own browser session, and the page ran (its confirm reached the app).
    const opened = loads(server, route);
    expect(opened.length).toBeGreaterThan(0);
    expect(opened.every((r) => String(r.headers.cookie ?? "").includes(`sid=${SESSION}`))).toBe(true);
    expect(posts(server, "/api/billing/confirm").length).toBeGreaterThan(0);
    // The plan was put back through the Billing page's own control, then re-read.
    expectRestored(server, result, "/app/billing");
    const lastCancel = server.requests.indexOf(posts(server, "/api/billing/cancel")[0]!);
    expect(server.requests.slice(lastCancel + 1).some((r) => r.method === "GET" && pathOf(r) === "/api/me" && fromRunHound(r))).toBe(true);
    expectSafe(server, result);
    // The exported spec replays the probe: it opens the route that granted.
    expect(result.findings[0]!.spec!.source).toContain(route);
  }, 90_000);

  it("finds a success route that is only at a conventional path (no link to it)", async () => {
    const route = "/checkout/success";
    const server = await billingApp({ grants: true, successPages: { [route]: {} }, cancel: "button" });
    const result = await runOn(server);
    expectGrantFinding(result, route);
    expectReReadAfterEachProbe(server, CONVENTIONAL, [route]);
    expectRestored(server, result, "/app/billing");
    expectSafe(server, result);
  }, 90_000);

  it("re-reads after each candidate and names only the route that granted, not one that answered without granting", async () => {
    const links: Link[] = [
      // Answers, but sends nothing: loading it can't change the plan.
      { href: "/billing/thanks", text: "Thanks from the billing team" },
      { href: "/account/plan/activated", text: "Plan activated" },
    ];
    const server = await billingApp({
      grants: true,
      links,
      successPages: { "/billing/thanks": { confirms: false }, "/account/plan/activated": {} },
      cancel: "button",
    });
    const result = await runOn(server);
    const f = expectGrantFinding(result, "/account/plan/activated");
    expect([f.title, f.location ?? "", ...(f.locations ?? [])].join("\n")).not.toContain("/billing/thanks");
    expectReReadAfterEachProbe(server, [...links.map((l) => l.href), ...CONVENTIONAL], ["/billing/thanks", "/account/plan/activated"]);
    expectRestored(server, result, "/app/billing");
    expectSafe(server, result);
  }, 90_000);

  it("names only the route that granted when a candidate that answers without granting comes after it", async () => {
    // Grant comes first; the later page changes nothing, but a re-read after it still differs until the plan is put back — naming it would blame a non-granter.
    const server = await billingApp({
      grants: true,
      links: [SUCCESS_LINK, { href: "/billing/thanks", text: "Thanks from the billing team" }],
      successPages: { "/app/upgraded": {}, "/billing/thanks": { confirms: false } },
      cancel: "button",
    });
    const result = await runOn(server);
    const f = expectGrantFinding(result, "/app/upgraded");
    expect([f.title, f.location ?? "", ...(f.locations ?? [])].join("\n")).not.toContain("/billing/thanks");
    expectRestored(server, result, "/app/billing");
    expectSafe(server, result);
  }, 90_000);

  it("opens a linked success route under a checkout path whose text names a payment (the contract's billing words, not acting ones)", async () => {
    // Not a conventional path. "checkout" and "payment" make it a candidate: they don't make a link that acts.
    const route = "/app/checkout/thank-you";
    const server = await billingApp({ grants: true, links: [{ href: route, text: "Payment received" }], successPages: { [route]: {} }, cancel: "button" });
    const result = await runOn(server);
    expectGrantFinding(result, route);
    expectRestored(server, result, "/app/billing");
    expectSafe(server, result);
  }, 90_000);

  it("opens a linked route whose text alone names a success result (the path names none and isn't a conventional one)", async () => {
    // "path or text": /billing/return holds no success word; "Your Pro plan is confirmed" does, with a billing word.
    const route = "/billing/return";
    const server = await billingApp({ grants: true, links: [{ href: route, text: "Your Pro plan is confirmed" }], successPages: { [route]: {} }, cancel: "button" });
    const result = await runOn(server);
    expectGrantFinding(result, route);
    expectRestored(server, result, "/app/billing");
    expectSafe(server, result);
  }, 90_000);

  it("reports a grant of credits that leaves the plan on Free (credits that went up count), and says to check Account A", async () => {
    // The plan's control only shows on Pro, so there is nothing to click to take the credits back.
    const server = await billingApp({ grantsCredits: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "button" });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expect(server.state.plan).toBe("free");
    expect(server.state.credits).toBeGreaterThan(0);
    expect(result.notes).toMatch(/check Account A/);
    // Credits alone are confirmed only once a second visit adds more (0.6.0 review, round 3).
    expect(server.state.confirms).toBe(2);
    expect(result.notes).toMatch(/again/);
    expectSafe(server, result);
  }, 90_000);

  it("never confirms credits that a second visit doesn't add again (a one-time bonus looks like a refill): inconclusive, nothing clicked", async () => {
    const server = await billingApp({ grantsCreditsOnce: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "button" });
    const result = await runOn(server);
    expect(result.findings).toEqual([]);
    expect(result.status).toBe("skipped");
    expect(result.notes).toMatch(/^Inconclusive/);
    expect(result.notes).toMatch(/credits/);
    expect(result.notes).toContain("/app/upgraded");
    // The route was opened a second time to see whether it adds more.
    expect(server.state.confirms).toBe(2);
    expect(server.state.credits).toBe(500);
    expect(posts(server, "/api/billing/cancel")).toEqual([]);
    expect(result.notes).not.toMatch(/still[^.]*check Account A/);
    expectSafe(server, result);
  }, 120_000);

  it("finds a success route linked from a page the page under test links to, and follows the app's confirm() to downgrade", async () => {
    const route = "/billing/welcome";
    const server = await billingApp({
      grants: true,
      billingLinks: [{ href: route, text: "See what's included in Pro" }],
      successPages: { [route]: {} },
      cancel: "native-confirm",
    });
    const result = await runOn(server);
    expectGrantFinding(result, route);
    expectRestored(server, result, "/app/billing");
    expectSafe(server, result);
  }, 90_000);

  it("follows the app's own confirmation dialog when the cancel control is on the page under test", async () => {
    const server = await billingApp({ grants: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "dialog-on-page" });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expectRestored(server, result, "/app");
    expectSafe(server, result);
  }, 90_000);

  it("finds a success link inside the app's hidden Billing tab and chooses that tab to reach Cancel plan, as on Fernway's Settings page", async () => {
    // Not a conventional path: the only way to it is the link in the hidden panel.
    const route = "/app/plan/activated";
    const server = await billingApp({
      grants: true,
      links: [{ href: route, text: "Already paid? Refresh your plan" }],
      successPages: { [route]: {} },
      cancel: "billing-tab",
    });
    const result = await runOn(server);
    expectGrantFinding(result, route);
    expectRestored(server, result, "/app");
    expectSafe(server, result);
  }, 90_000);

  it("chooses the hidden Billing tab on a Settings page the page under test links to, for the success link and for Cancel plan", async () => {
    // Fernway's shape seen from its dashboard: the link and the plan's control are only in /app/settings' Billing tab.
    const route = "/app/plan/activated";
    const server = await billingApp({
      grants: true,
      links: [{ href: "/app/settings", text: "Settings" }],
      billingLinks: [{ href: route, text: "Already paid? Refresh your plan" }],
      successPages: { [route]: {} },
      cancel: "settings-tab",
    });
    const result = await runOn(server);
    expectGrantFinding(result, route);
    expectRestored(server, result, "/app/settings");
    expectSafe(server, result);
  }, 90_000);

  it("skips a candidate that redirects to sign-in or answers 404, and names only the route that granted", async () => {
    const server = await billingApp({
      grants: true,
      links: [{ href: "/success", text: "Payment successful" }],
      signInPaths: ["/success"],
      successPages: { "/app/upgraded": {} },
      cancel: "button",
    });
    const result = await runOn(server);
    const f = expectGrantFinding(result, "/app/upgraded");
    const where = [f.title, f.location ?? "", ...(f.locations ?? [])].join("\n");
    expect(where).not.toContain("/success");
    expect(where).not.toContain("/login");
    // The sign-in page it was sent to was never filled in (expectSafe: no write but confirm and cancel).
    expectRestored(server, result, "/app/billing");
    expectSafe(server, result);
  }, 90_000);
});

describe("paywall-trust: a re-read that fails", () => {
  it("is inconclusive, never a pass or a confirmed finding, and says to check Account A", async () => {
    const server = await billingApp({ grants: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "button", failReadAfterConfirm: true });
    const result = await runOn(server);
    // The success page did run (and, in this buggy app, granted Pro), but Run Hound can't see the result.
    expect(server.state.confirms).toBeGreaterThan(0);
    expect(result.status).not.toBe("pass");
    expect(confirmed(result)).toEqual([]);
    expect(result.notes).toMatch(/check Account A/);
    // A change it couldn't see is not its own change to undo: no cancel or downgrade is clicked.
    expect(posts(server, "/api/billing/cancel")).toEqual([]);
    expectSafe(server, result);
  }, 90_000);
});

