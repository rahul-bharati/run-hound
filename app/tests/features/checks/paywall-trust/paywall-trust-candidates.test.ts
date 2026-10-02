/**
 * Paywall-trust test: paywall-trust: candidate routes
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
} from "../../test-support/paywall-app.js";
import type { BillingApp, CancelControl, BillingAppOptions, Link } from "../../test-support/paywall-app.js";

usePaywallApp();

describe("paywall-trust: candidate routes", () => {
  it("opens at most 10 candidates, links first, same origin only", async () => {
    // Another origin serving success routes of its own, linked under another host name and under the same host name
    // (127.0.0.1, another port): never opened, there or as the same path on the target.
    const other = await billingApp({ grants: true, successPages: { "/billing/success/99": {}, "/billing/success/98": {} } });
    const linked = Array.from({ length: 15 }, (_, i) => `/billing/success/${i + 1}`);
    // Looks like a candidate (under /billing/success) but its path acts ("cancel"): never opened.
    const acting: Link = { href: "/billing/success/cancel", text: "Cancel upgrade" };
    const app = await billingApp({
      grants: false,
      cancel: "button",
      successPages: Object.fromEntries([acting.href, ...linked].map((p) => [p, {}])),
      // The other-origin, provider and acting links come first, so a check that didn't keep to the origin, or opened a
      // link that acts, would open them. The three off-origin links are candidates by every other rule (a success path
      // under /billing, neutral text that doesn't act): only their origin rules them out.
      links: [
        { href: `http://localhost:${new URL(other.url).port}/billing/success/99`, text: "Receipt 99" },
        { href: `${other.url}/billing/success/98`, text: "Receipt 98" },
        { href: "https://checkout.stripe.com/billing/success/97", text: "Receipt 97" },
        acting,
        ...linked.map((href, i) => ({ href, text: `Receipt ${i + 1}` })),
      ],
    });
    const result = await runOn(app);
    expect(loads(app, acting.href)).toEqual([]);
    // 15 same-origin links answer, so only the limit stops the check: exactly ten are opened (and none is opened only to
    // read its links).
    const opened = new Set(app.requests.filter((r) => r.method === "GET" && /^\/billing\/success\/\d+$/.test(pathOf(r))).map(pathOf));
    expect(opened.size).toBe(10);
    // Links fill the ten before any conventional path is tried.
    for (const path of CONVENTIONAL) expect(loads(app, path)).toEqual([]);
    // Nothing went to the other origin or to the provider, and no off-origin path was tried on the target instead.
    expect(other.requests).toEqual([]);
    expect(loads(app, "/billing/success/99")).toEqual([]);
    expect(loads(app, "/billing/success/98")).toEqual([]);
    expect(loads(app, "/billing/success/97")).toEqual([]);
    // A provider link the check had tried to open would have been blocked, and listed in the notes.
    expect(result.notes ?? "").not.toContain("checkout.stripe.com");
    expect(other.state.plan).toBe("free");
    expect(result.findings).toEqual([]);
    expectSafe(app, result);
  }, 120_000);

  it("counts links and conventional paths together: at most 10 in all, every link kept", async () => {
    const linked = ["/billing/thanks/1", "/billing/thanks/2", "/billing/thanks/3", "/billing/thanks/4"];
    const app = await billingApp({
      grants: false,
      cancel: "button",
      links: linked.map((href, i) => ({ href, text: `Receipt ${i + 1}` })),
      // Every conventional path answers too, so only the limit stops the check from opening all nine.
      successPages: Object.fromEntries([...linked, ...CONVENTIONAL].map((p) => [p, {}])),
    });
    const result = await runOn(app);
    const tried = [...linked, ...CONVENTIONAL].filter((p) => app.requests.some((r) => isNavigation(r) && pathOf(r) === p));
    // Every link, then the conventional paths in the contract's order until the ten are used up.
    expect(tried).toEqual([...linked, ...CONVENTIONAL.slice(0, 6)]);
    expect(result.status).toBe("pass");
    expectSafe(app, result);
  }, 120_000);
});

