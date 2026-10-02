// The restore clicks only Account A's own plan control: never a teammate's or add-on's "Downgrade" / "Cancel subscription" in a list, table, card, or hidden tab.

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

describe("paywall-trust: the restore clicks only Account A's own plan control", () => {
  const othersWrites = (server: BillingApp) => server.requests.filter((r) => r.method === "POST" && /^\/api\/(team|addons)\//.test(pathOf(r)));

  it('never clicks a teammate\'s or an add-on\'s "Downgrade" (in a table, a one-row list, beside an e-mail address, under another heading), only Account A\'s own', async () => {
    const server = await billingApp({ grants: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "among-teammates" });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expect(othersWrites(server)).toEqual([]);
    expectRestored(server, result, "/app/billing");
    expectSafe(server, result);
  }, 90_000);

  it('never clicks an add-on\'s "Cancel subscription" (one in each row of a list) before Account A\'s own control of the same name', async () => {
    const server = await billingApp({ grants: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "among-add-ons" });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expect(othersWrites(server)).toEqual([]);
    expectRestored(server, result, "/app/billing");
    expectSafe(server, result);
  }, 90_000);

  it('never clicks a teammate\'s "Downgrade" on a card (no list or table), only Account A\'s own under "Your plan"', async () => {
    const server = await billingApp({ grants: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "team-cards" });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expect(othersWrites(server)).toEqual([]);
    expectRestored(server, result, "/app/billing");
    expectSafe(server, result);
  }, 90_000);

  it('clicks no "Downgrade" when teammates\' cards carry the same name and none sits under a heading about Account A\'s own plan, and says to check Account A', async () => {
    // Account A's "Downgrade" is under "Pro plan": a billing heading, but nothing tells it apart from the cards' own.
    const server = await billingApp({ grants: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "team-cards-pro-plan" });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expect(othersWrites(server)).toEqual([]);
    expect(posts(server, "/api/billing/cancel")).toEqual([]);
    expect(server.state.plan).toBe("pro");
    expect(result.notes).toMatch(/Account A's plan is still "?pro"?: check Account A/);
    expectSafe(server, result);
  }, 90_000);

  it('clicks Account A\'s own "Cancel plan" under "Your plan", never a lone teammate card\'s "Downgrade to Free" before it', async () => {
    const server = await billingApp({ grants: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "team-card-free" });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expect(othersWrites(server)).toEqual([]);
    expectRestored(server, result, "/app/billing");
    expectSafe(server, result);
  }, 90_000);

  it('clicks Account A\'s own "Cancel plan" outside any list before a teammate\'s "Downgrade to Free" in a one-row list', async () => {
    const server = await billingApp({ grants: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "team-row-free" });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expect(othersWrites(server)).toEqual([]);
    expectRestored(server, result, "/app/billing");
    expectSafe(server, result);
  }, 90_000);

  it('clicks Account A\'s own "Cancel plan" before a lone teammate card\'s bare "Downgrade" (no list, no heading for either)', async () => {
    const server = await billingApp({ grants: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "team-card-bare" });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expect(othersWrites(server)).toEqual([]);
    expectRestored(server, result, "/app/billing");
    expectSafe(server, result);
  }, 90_000);

  it('never clicks a lone add-on\'s "Cancel subscription" in a list row before Account A\'s own "Cancel membership"', async () => {
    const server = await billingApp({ grants: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "addon-row-membership" });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expect(othersWrites(server)).toEqual([]);
    expectRestored(server, result, "/app/billing");
    expectSafe(server, result);
  }, 90_000);

  it('clicks neither a teammate card\'s bare "Downgrade" nor another control when nothing says which is Account A\'s plan', async () => {
    // "Downgrade" (teammate's card) and "Cancel subscription" (A's): neither names the plan or a free tier, no heading says which is A's plan.
    const server = await billingApp({ grants: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "team-card-sub" });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expect(othersWrites(server)).toEqual([]);
    expect(posts(server, "/api/billing/cancel")).toEqual([]);
    expect(server.state.plan).toBe("pro");
    expect(result.notes).toMatch(/On \/app\/billing, "Downgrade" and "Cancel subscription" might each be the way back to Free[^.]*clicked neither/);
    expect(result.notes).not.toMatch(/found no cancel or downgrade control/);
    expect(result.notes).toMatch(/Account A's plan is still "?pro"?: check Account A/);
    expectSafe(server, result);
  }, 90_000);

  /** A teammate's card with a bare "Downgrade", outside the Settings page's tabs (shown whichever tab is chosen). */
  const TEAMMATE_CARD = `<div class="seat"><span>Jo Park</span> · <span>Pro</span> <button type="button" data-down="/api/team/u_jo/downgrade">Downgrade</button></div>`;

  it('looks behind the Billing tab for Account A\'s own "Cancel plan" before clicking a teammate card\'s bare "Downgrade" shown on the page', async () => {
    const server = await billingApp({ grants: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "billing-tab", extraDashboard: TEAMMATE_CARD });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expect(othersWrites(server)).toEqual([]);
    expectRestored(server, result, "/app");
    expectSafe(server, result);
  }, 90_000);

  it('clicks neither when a teammate card\'s bare "Downgrade" is on the page and Account A\'s "Cancel subscription" is behind the Billing tab', async () => {
    // The Billing tab shows both at once: nothing says which is Account A's, so the one on the page isn't clicked either.
    const server = await billingApp({
      grants: true,
      links: [SUCCESS_LINK],
      successPages: { "/app/upgraded": {} },
      cancel: "billing-tab",
      extraDashboard: TEAMMATE_CARD,
      tabCancel: "Cancel subscription",
    });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expect(othersWrites(server)).toEqual([]);
    expect(posts(server, "/api/billing/cancel")).toEqual([]);
    expect(server.state.plan).toBe("pro");
    expect(result.notes).toMatch(/On \/app, "Downgrade" and "Cancel subscription" might each be the way back to Free[^.]*clicked neither/);
    expect(result.notes).toMatch(/Account A's plan is still "?pro"?: check Account A/);
    expectSafe(server, result);
  }, 90_000);

  it('still clicks Account A\'s own bare "Downgrade" on the tab shown when the page loaded, after its Billing tab showed nothing that names the plan', async () => {
    // "Payments" (a Billing tab) hides the Overview panel when chosen: the Overview tab is chosen again to click it.
    const server = await billingApp({ grants: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "overview-tab" });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expectRestored(server, result, "/app/billing");
    expectSafe(server, result);
  }, 90_000);

  it('never clicks a lone add-on\'s "Cancel subscription" in a list row, even when nothing else could put the plan back', async () => {
    const server = await billingApp({ grants: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "addon-row-only" });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expect(othersWrites(server)).toEqual([]);
    expect(posts(server, "/api/billing/cancel")).toEqual([]);
    expect(server.state.plan).toBe("pro");
    expect(result.notes).toMatch(/Account A's plan is still "?pro"?: check Account A/);
    expectSafe(server, result);
  }, 90_000);
});

