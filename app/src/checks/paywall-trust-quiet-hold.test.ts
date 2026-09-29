/**
 * paywall-trust's quiet waits (0.6.0 closeout, review round 2): a Billing tab's page must be left under the tab's
 * hold before the next page loads — a slow subscription GET that answers while the next page is still loading, a
 * pagehide beacon, a late write during the restore's first page load, a late write while a page is opened again for
 * a gain, and a change put down to every tab chosen on the page when it may come from an earlier one's script.
 * Driven through createCheckContext like paywall-trust.test.ts, against small fixture apps built per test.
 *
 * Split out of paywall-trust-quiet.test.ts to keep each file under the suite's per-file time budget; see that file
 * for the rest of the original file's coverage. Shares test-support/paywall-harness.ts's fixture-app, discovery and
 * browser/sink setup; restoreMocks: true reproduces this family's original afterEach, which called
 * vi.restoreAllMocks() first.
 */
import type { ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { app, BILLING, confirmed, loads, posts, runOn, send, settings, signedIn, sinkHits, usePaywallHarness, WHO } from "../../test-support/paywall-harness.js";

usePaywallHarness({ tmpPrefix: "rh-paywall-quiet-", restoreMocks: true });

const html = (res: ServerResponse, body: string) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(body);
};

describe("paywall-trust: a Billing tab's page is left under the tab's hold before the next page loads (0.6.0 closeout, review round 2)", () => {
  it("never lets a Billing tab that reads a slow subscription GET, then POSTs to the portal start, reach it while the next page is still loading", async () => {
    // The tab's GET takes 6.5 s, longer than the quiet wait after the tab (5 s); /app/billing then takes 4 s to answer.
    // The tab's page must not still be running (with nothing held) when its GET answers.
    const t0 = Date.now();
    const state = { plan: "free", portal: 0, clickAt: [] as number[], billingAt: [] as number[] };
    const server = await app({
      pages: {
        "/app": settings(
          [{ id: "t-billing", name: "Billing" }],
          `document.getElementById('t-billing').addEventListener('click', async () => {
  await fetch('/api/subscription').then(r => r.json());
  const j = await fetch('/api/billing/portal-session', { method: 'POST' }).then(r => r.json());
  location.href = j.url;
});`,
        ),
      },
      routes: {
        "GET /api/me": (req, res) => (signedIn(req) ? send(res, 200, { ...WHO, plan: state.plan }) : send(res, 401, {})),
        "GET /api/subscription": (_req, res) => {
          state.clickAt.push(Date.now() - t0);
          setTimeout(() => send(res, 200, { status: "none" }), 6500);
        },
        "GET /app/billing": (_req, res) => {
          state.billingAt.push(Date.now() - t0);
          setTimeout(() => html(res, BILLING), 4000);
        },
        "POST /api/billing/portal-session": (_req, res) => {
          state.portal += 1;
          return send(res, 200, { url: "https://billing.stripe.com/p/session/test_r2" });
        },
        "POST /api/billing/cancel": (_req, res) => {
          state.plan = "free";
          return send(res, 200, {});
        },
      },
    });
    const result = await runOn(server);
    // The shape under test: /app/billing was asked for before the tab's GET answered, and was still loading then.
    expect(state.clickAt).toHaveLength(1);
    expect(state.billingAt.length).toBeGreaterThan(0);
    expect(state.billingAt[0]! - state.clickAt[0]!).toBeLessThan(6500);
    expect(state.portal).toBe(0);
    expect(posts(server, "/api/billing/portal-session")).toEqual([]);
    expect(sinkHits).toEqual([]);
    expect(result.status).not.toBe("fail");
    expect(state.plan).toBe("free");
  }, 180_000);

  it("holds a beacon a Billing tab's page sends as it is left (pagehide) to the portal start, and names the tab", async () => {
    const state = { plan: "free", portal: 0 };
    const server = await app({
      pages: {
        "/app": settings(
          [{ id: "t-billing", name: "Billing" }],
          `document.getElementById('t-billing').addEventListener('click', () => {
  addEventListener('pagehide', () => navigator.sendBeacon('/api/billing/portal-session', 'leaving'));
});`,
        ),
        "/app/billing": BILLING,
      },
      routes: {
        "GET /api/me": (req, res) => (signedIn(req) ? send(res, 200, { ...WHO, plan: state.plan }) : send(res, 401, {})),
        "POST /api/billing/portal-session": (_req, res) => {
          state.portal += 1;
          return send(res, 200, { url: "https://billing.stripe.com/p/session/test_r2b" });
        },
        "POST /api/billing/cancel": (_req, res) => {
          state.plan = "free";
          return send(res, 200, {});
        },
      },
    });
    const result = await runOn(server);
    expect(loads(server, "/app/billing").length).toBeGreaterThan(0);
    expect(state.portal).toBe(0);
    expect(posts(server, "/api/billing/portal-session")).toEqual([]);
    expect(result.notes).toMatch(/"Billing" tab on \/app sent a request to \/api\/billing\/portal-session[^.]*stopped/);
    expect(result.status).not.toBe("fail");
  }, 180_000);

  it("leaves the page of a Billing tab that granted before putting the plan back, so its late write never reaches the portal start while the restore's first page loads", async () => {
    const state = { plan: "free", portal: 0, appLoads: 0 };
    const server = await app({
      pages: { "/app/billing": BILLING },
      routes: {
        // The page under test answers slowly from its third load on (discovery's, the run's, then the restore's).
        "GET /app": (_req, res) => {
          state.appLoads += 1;
          const body = settings(
            [{ id: "t-billing", name: "Billing" }],
            // Choosing the tab upgrades Account A at once (the bug) and, 3 s later, pre-creates the portal link.
            `document.getElementById('t-billing').addEventListener('click', () => {
  fetch('/api/billing/sync', { method: 'POST' });
  setTimeout(() => fetch('/api/billing/portal-session', { method: 'POST' }), 3000);
});`,
          );
          if (state.appLoads >= 3) setTimeout(() => html(res, body), 4000);
          else html(res, body);
        },
        "GET /api/me": (req, res) => (signedIn(req) ? send(res, 200, { ...WHO, plan: state.plan }) : send(res, 401, {})),
        "POST /api/billing/sync": (_req, res) => {
          state.plan = "pro";
          return send(res, 200, { ok: true });
        },
        "POST /api/billing/portal-session": (_req, res) => {
          state.portal += 1;
          return send(res, 200, { url: "https://billing.stripe.com/p/session/test_r2c" });
        },
        "POST /api/billing/cancel": (_req, res) => {
          state.plan = "free";
          return send(res, 200, {});
        },
      },
    });
    const result = await runOn(server);
    expect(result.status).toBe("fail");
    expect(confirmed(result)[0]?.location).toBe("/app (Billing tab)");
    expect(state.appLoads).toBeGreaterThanOrEqual(3);
    expect(state.portal).toBe(0);
    expect(posts(server, "/api/billing/portal-session")).toEqual([]);
    expect(sinkHits).toEqual([]);
    // Put back through /app/billing's Cancel plan.
    expect(state.plan).toBe("free");
  }, 180_000);

  it("leaves a Billing tab's page before opening its page again for a gain of credits, so its late write never reaches the portal start while that page loads", async () => {
    const state = { credits: 10, portal: 0, appLoads: 0 };
    const server = await app({
      pages: {},
      routes: {
        // The page under test answers slowly from its third load on (discovery's, the run's, then the one opened again).
        "GET /app": (_req, res) => {
          state.appLoads += 1;
          const body = settings(
            [{ id: "t-billing", name: "Billing" }],
            // Choosing the tab adds credits at once (the bug) and, 3 s later, pre-creates the portal link.
            `document.getElementById('t-billing').addEventListener('click', () => {
  fetch('/api/billing/sync', { method: 'POST' });
  setTimeout(() => fetch('/api/billing/portal-session', { method: 'POST' }), 3000);
});`,
          );
          if (state.appLoads >= 3) setTimeout(() => html(res, body), 4000);
          else html(res, body);
        },
        "GET /api/me": (req, res) => (signedIn(req) ? send(res, 200, { ...WHO, plan: "free", credits: state.credits }) : send(res, 401, {})),
        "POST /api/billing/sync": (_req, res) => {
          state.credits += 100;
          return send(res, 200, { ok: true });
        },
        "POST /api/billing/portal-session": (_req, res) => {
          state.portal += 1;
          return send(res, 200, { url: "https://billing.stripe.com/p/session/test_r2e" });
        },
      },
    });
    const result = await runOn(server);
    // Opened again (the gain of credits alone is confirmed only by a second visit that adds more).
    expect(state.appLoads).toBeGreaterThanOrEqual(3);
    expect(state.portal).toBe(0);
    expect(posts(server, "/api/billing/portal-session")).toEqual([]);
    expect(sinkHits).toEqual([]);
    expect(result.status).toBe("fail");
    expect(confirmed(result)[0]?.location).toBe("/app (Billing tab)");
    // The second choice's timer fires during the pause after it, with the tab's page still on screen: held and named.
    expect(result.notes).toMatch(/"Billing" tab on \/app sent a request to \/api\/billing\/portal-session[^.]*stopped/);
  }, 180_000);

  it("names every tab chosen on the page when what it stopped may come from an earlier tab's script", async () => {
    // Billing POSTs to the portal start on a 7 s timer: that fires while the Plans tab, chosen after it, is on screen.
    const state = { plan: "free", portal: 0 };
    const server = await app({
      pages: {
        "/app": settings(
          [
            { id: "t-billing", name: "Billing" },
            { id: "t-plans", name: "Plans" },
          ],
          `document.getElementById('t-billing').addEventListener('click', () => setTimeout(() => fetch('/api/billing/portal-session', { method: 'POST' }), 7000));`,
        ),
        "/app/billing": BILLING,
      },
      routes: {
        "GET /api/me": (req, res) => (signedIn(req) ? send(res, 200, { ...WHO, plan: state.plan }) : send(res, 401, {})),
        "POST /api/billing/portal-session": (_req, res) => {
          state.portal += 1;
          return send(res, 200, { url: "https://billing.stripe.com/p/session/test_r2d" });
        },
        "POST /api/billing/cancel": (_req, res) => {
          state.plan = "free";
          return send(res, 200, {});
        },
      },
    });
    const result = await runOn(server);
    expect(state.portal).toBe(0);
    expect(result.notes).toMatch(/After Run Hound chose the "Billing" and "Plans" tabs on \/app, the page sent a request to \/api\/billing\/portal-session, which Run Hound stopped/);
    expect(result.notes).not.toMatch(/Choosing the "Plans" tab on \/app sent a request/);
  }, 180_000);
});
