// A restore that fails is never a pass: no cancel control, ignored cancel, failed re-read, blocked provider writes, and the exported spec's stop rules.

import { chromium, type Browser } from "playwright";
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
  resolverRules,
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

describe("paywall-trust: a restore that fails is never a pass", () => {
  it("names Account A's plan and says to check Account A when the app has no cancel or downgrade control", async () => {
    const server = await billingApp({ grants: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "none" });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expect(server.state.plan).toBe("pro");
    expect(posts(server, "/api/billing/cancel")).toEqual([]);
    expect(result.notes).toMatch(/Account A's plan is still "?pro"?: check Account A/);
    expectSafe(server, result);
  }, 90_000);

  it("re-reads after the cancel and says to check Account A when the app kept the paid plan", async () => {
    const server = await billingApp({ grants: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "ignored" });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expect(server.state.plan).toBe("pro");
    expect(posts(server, "/api/billing/cancel").length).toBeGreaterThan(0);
    expect(result.notes).toMatch(/Account A's plan is still "?pro"?: check Account A/);
    expectSafe(server, result);
  }, 90_000);

  it("says to check Account A when the re-read that should confirm the restore fails (a restore it can't see is not a restore)", async () => {
    const server = await billingApp({ grants: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "button", failReadAfterCancel: true });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expect(posts(server, "/api/billing/cancel")).toHaveLength(1);
    // The confirming re-read was sent after the cancel (and failed).
    const cancelAt = server.requests.indexOf(posts(server, "/api/billing/cancel")[0]!);
    expect(server.requests.slice(cancelAt + 1).some(isReRead)).toBe(true);
    expect(result.notes).toMatch(/check Account A/);
    expectSafe(server, result);
  }, 90_000);
});

describe("paywall-trust: payment providers", () => {
  it("the stand-in provider really receives a request nothing blocks (so the zero counts in these tests mean something)", async () => {
    const unguarded = await chromium.launch({ args: [resolverRules(sinkPort)] });
    try {
      const page = await unguarded.newPage();
      await page.goto("about:blank");
      await page.evaluate(() => fetch("https://api.stripe.com/v1/ping").catch(() => undefined));
      await expect.poll(() => sinkHits.length).toBeGreaterThan(0);
    } finally {
      await unguarded.close();
      sinkHits.length = 0;
    }
  }, 60_000);

  it("blocks and lists every payment-provider request the success page makes, and never types payment details", async () => {
    const providerScripts = [
      "https://js.stripe.com/v3/",
      "https://www.paypal.com/sdk/js?client-id=test",
      "https://cdn.paddle.com/paddle/v2/paddle.js",
      "https://app.lemonsqueezy.com/js/lemon.js",
    ];
    const cardForm = `<form id="card" aria-label="Pay for Pro">
<label for="cc">Card number</label><input id="cc" name="cardnumber" autocomplete="cc-number" inputmode="numeric">
<label for="exp">Expiry</label><input id="exp" name="exp-date" autocomplete="cc-exp">
<label for="cvc">CVC</label><input id="cvc" name="cvc" autocomplete="cc-csc">
<button type="submit">Pay $12</button></form>
<script>
document.querySelectorAll('#card input').forEach(function (i) { i.addEventListener('input', function () { navigator.sendBeacon('/api/typed', i.name); }); });
document.getElementById('card').addEventListener('submit', function (e) { e.preventDefault(); fetch('/api/pay', { method: 'POST', body: '{}' }); });
</script>`;
    const server = await billingApp({
      grants: true,
      links: [SUCCESS_LINK],
      cancel: "button",
      successPages: {
        "/app/upgraded": {
          extra: providerScripts.map((src) => `<script src="${src}"></script>`).join("\n") + cardForm,
          after: `fetch('https://api.stripe.com/v1/payment_intents', { method: 'POST' }).catch(function () {});
    location.href = 'https://checkout.stripe.com/c/pay/cs_test_fixture';`,
        },
      },
    });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    // Nothing reached the provider, and each blocked provider request is listed.
    expect(sinkHits).toEqual([]);
    expect(result.notes).toMatch(/blocked \(payment provider\)/);
    for (const host of ["js.stripe.com", "www.paypal.com", "cdn.paddle.com", "app.lemonsqueezy.com", "api.stripe.com", "checkout.stripe.com"]) {
      expect(result.notes).toContain(host);
    }
    // No card field was typed in and nothing was paid (expectSafe: no /api/typed, no /api/pay).
    expect(posts(server, "/api/typed")).toEqual([]);
    expect(posts(server, "/api/pay")).toEqual([]);
    expectRestored(server, result, "/app/billing");
    expectSafe(server, result);
  }, 90_000);

  it("exports a replay spec that stops a server redirect's hop to a provider and a new window's first load too, as the check does", async () => {
    const server = await billingApp({ grants: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "button" });
    const result = await runOn(server);
    const source = expectGrantFinding(result, "/app/upgraded").spec!.source;
    // Routes never see a redirect hop: a DevTools-level block on the replayed page stops it.
    expect(source).toMatch(/newCDPSession\(page\)/);
    expect(source).toMatch(/Fetch\.failRequest/);
    expect(source).toMatch(/Fetch\.enable/);
    // Off-target redirect hops (after sign-in, when a sign-in page may be on another site) are failed at the DevTools level too.
    expect(source).toMatch(/resourceType === "Document"/);
    expect(source).toMatch(/guardOffSite = true/);
    expect(source.indexOf("guardOffSite = true")).toBeGreaterThan(source.indexOf("await signIn(page);"));
    // A new window's first load is never sent (it can't be watched for a redirect to a provider).
    expect(source).toMatch(/isNavigationRequest\(\)/);
    // The DevTools protocol is Chromium's: in another browser the spec is skipped, never run without that block.
    expect(source).toMatch(/test\.skip\(browserName !== "chromium"/);
    // PATH is typed as `string` so a bare `const PATH = ""` wouldn't type-check (strict TS narrows it to never in `PATH ? PATH.split(".") : []`).
    expect(source).toMatch(/const PATH: string = "";/);
    expectRestored(server, result, "/app/billing");
    expectSafe(server, result);
  }, 90_000);

  it("never names a provider request the page makes in the background as where the cancel went, when the cancel just didn't work", async () => {
    const server = await billingApp({
      grants: true,
      links: [SUCCESS_LINK],
      successPages: { "/app/upgraded": {} },
      cancel: "ignored",
      // The Billing page's payment script polls its host in the background, as Stripe.js does.
      billingScript: "setInterval(function () { fetch('https://api.stripe.com/v1/ping').catch(function () {}); }, 150);",
    });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expect(server.state.plan).toBe("pro");
    expect(posts(server, "/api/billing/cancel").length).toBeGreaterThan(0);
    expect(result.notes).toMatch(/api\.stripe\.com: blocked \(payment provider\)/);
    expect(result.notes).not.toMatch(/headed for the payment provider/);
    expect(result.notes).toMatch(/Run Hound clicked the app's own "Cancel plan" on \/app\/billing, but Account A's plan didn't go back/);
    expect(result.notes).toMatch(/Account A's plan is still "?pro"?: check Account A/);
    expectSafe(server, result);
  }, 90_000);

  it("counts the restore as failed when the cancel control heads for the payment provider (blocked)", async () => {
    const server = await billingApp({ grants: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "provider-portal" });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expect(server.state.plan).toBe("pro");
    expect(sinkHits).toEqual([]);
    expect(result.notes).toMatch(/blocked \(payment provider\)/);
    expect(result.notes).toContain("billing.stripe.com");
    expect(result.notes).toMatch(/Account A's plan is still "?pro"?: check Account A/);
    expectSafe(server, result);
  }, 90_000);
});

