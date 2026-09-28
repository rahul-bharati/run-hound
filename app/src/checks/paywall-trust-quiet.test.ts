/**
 * paywall-trust's quiet waits (0.6.0 closeout, review round 1): what a Billing tab's script still sends while Run
 * Hound waits with nothing opened after it (a timer, a write after a slow GET) is held as it is while the tab is
 * clicked; a change the page under test's own load makes late is never credited to a later route; a run that ran out
 * of time with routes left unopened is never a pass; and a late change put down to a tab names what came between it
 * and the route after which the change was read. Driven through createCheckContext like paywall-trust.test.ts,
 * against small fixture apps built per test.
 *
 * Split from the original paywall-trust-quiet.test.ts (which also covered a Billing tab's page being left under the
 * tab's hold before the next page loads) to keep each file under the suite's per-file time budget: see
 * paywall-trust-quiet-hold.test.ts. Both share test-support/paywall-harness.ts's fixture-app, discovery and
 * browser/sink setup; restoreMocks: true reproduces this family's original afterEach, which called
 * vi.restoreAllMocks() first.
 */
import { describe, expect, it, vi } from "vitest";
import { app, BILLING, confirmed, loads, notFound, page, posts, runOn, send, settings, SHOW, signedIn, sinkHits, usePaywallHarness, WHO } from "../../test-support/paywall-harness.js";

usePaywallHarness({ tmpPrefix: "rh-paywall-quiet-", restoreMocks: true });

describe("paywall-trust: the quiet wait after a Billing tab holds what the tab's script still sends (0.6.0 closeout, review round 1)", () => {
  it("never lets a Billing tab's delayed write create a billing portal session, nor another tab's delayed navigation reach the app, and names both", async () => {
    const state = { plan: "free", portal: 0, manage: 0 };
    const server = await app({
      pages: {
        "/app": settings(
          [
            { id: "t-billing", name: "Billing" },
            { id: "t-payments", name: "Payments" },
          ],
          // Billing: 2 s after it is chosen, the usual Stripe customer-portal button's script (POST to the app, which
          // creates the session at the provider, then off to the URL it answers). Payments: 2 s after it is chosen, off to
          // a page of the app whose path names no start, which creates the portal session and redirects to Stripe.
          `document.getElementById('t-billing').addEventListener('click', () => setTimeout(() => fetch('/api/billing/portal-session', { method: 'POST' }).then(r => r.json()).then(j => { location.href = j.url; }), 2000));
document.getElementById('t-payments').addEventListener('click', () => setTimeout(() => { location.href = '/go/manage'; }, 2000));`,
        ),
        "/app/billing": BILLING,
      },
      routes: {
        "GET /api/me": (req, res) => (signedIn(req) ? send(res, 200, { ...WHO, plan: state.plan }) : send(res, 401, {})),
        "POST /api/billing/portal-session": (_req, res) => {
          state.portal += 1;
          return send(res, 200, { url: "https://billing.stripe.com/p/session/test_123" });
        },
        "GET /go/manage": (_req, res) => {
          state.manage += 1;
          res.writeHead(302, { location: "https://billing.stripe.com/p/session/test_456" });
          res.end();
        },
        "POST /api/billing/cancel": (_req, res) => {
          state.plan = "free";
          return send(res, 200, {});
        },
      },
    });
    const result = await runOn(server);
    expect(state.portal).toBe(0);
    expect(state.manage).toBe(0);
    expect(posts(server, "/api/billing/portal-session")).toEqual([]);
    expect(loads(server, "/go/manage")).toEqual([]);
    expect(sinkHits).toEqual([]);
    expect(result.notes).toMatch(/"Billing" tab on \/app sent a request to \/api\/billing\/portal-session[^.]*stopped/);
    // Payments was chosen after Billing on the same page: either tab's script may have sent it, so both are named
    // (review round 2).
    expect(result.notes).toMatch(/After Run Hound chose the "Billing" and "Payments" tabs on \/app, the page sent the browser to \/go\/manage[^.]*stopped/);
    expect(result.status).not.toBe("fail");
    expect(state.plan).toBe("free");
  }, 180_000);

  it("never lets a Billing tab that loads the subscription first (a slow GET) then pre-creates the portal link reach the app's portal start", async () => {
    const state = { plan: "free", portal: 0 };
    const server = await app({
      pages: {
        "/app": `${settings(
          [{ id: "t-billing", name: "Billing" }],
          `document.getElementById('t-billing').addEventListener('click', async () => {
  await fetch('/api/subscription').then(r => r.json());
  const j = await fetch('/api/billing/portal-session', { method: 'POST' }).then(r => r.json());
  document.getElementById('manage').href = j.url;
});`,
        ).replace("</main>", `<a id="manage" href="#">Manage billing</a></main>`)}`,
        "/app/billing": BILLING,
      },
      routes: {
        "GET /api/me": (req, res) => (signedIn(req) ? send(res, 200, { ...WHO, plan: state.plan }) : send(res, 401, {})),
        "GET /api/subscription": (_req, res) => void setTimeout(() => send(res, 200, { status: "none" }), 800),
        "POST /api/billing/portal-session": (_req, res) => {
          state.portal += 1;
          return send(res, 200, { url: "https://billing.stripe.com/p/session/test_789" });
        },
        "POST /api/billing/cancel": (_req, res) => {
          state.plan = "free";
          return send(res, 200, {});
        },
      },
    });
    const result = await runOn(server);
    expect(state.portal).toBe(0);
    expect(posts(server, "/api/billing/portal-session")).toEqual([]);
    // The tab's own read went through: only the write to the portal start is held.
    expect(loads(server, "/api/subscription").length).toBeGreaterThan(0);
    expect(sinkHits).toEqual([]);
    expect(result.notes).toMatch(/"Billing" tab on \/app sent a request to \/api\/billing\/portal-session[^.]*stopped/);
    expect(result.status).not.toBe("fail");
  }, 180_000);
});

describe("paywall-trust: a late change from the page under test's own load (0.6.0 closeout, review round 1)", () => {
  it("is never credited to a later route: a grant the page under test queues on load, landing 4 s later, ends inconclusive before anything is opened", async () => {
    const state = { plan: "free", refreshes: 0 };
    const server = await app({
      pages: {
        // The page under test itself queues the upgrade on every load (a "refresh my plan" job).
        "/app": page("Dashboard", `<p id="plan">Loading…</p><a href="/app/upgraded">See your upgraded plan</a>`, `${SHOW}
fetch('/api/billing/refresh', { method: 'POST' });`),
        "/app/billing": BILLING,
        // Clean pages: they change nothing.
        "/app/upgraded": page("Your upgraded plan", `<p>Here is what the Pro plan includes: more projects.</p>`),
      },
      routes: {
        "GET /api/me": (req, res) => (signedIn(req) ? send(res, 200, { ...WHO, plan: state.plan }) : send(res, 401, {})),
        "POST /api/billing/refresh": (_req, res) => {
          state.refreshes += 1;
          // The first is discovery's (before the run): only the run's own load of the page under test queues it.
          if (state.refreshes === 2) setTimeout(() => (state.plan = "pro"), 4000);
          return send(res, 202, { queued: true });
        },
        "POST /api/billing/cancel": (_req, res) => {
          state.plan = "free";
          return send(res, 200, {});
        },
      },
    });
    const result = await runOn(server);
    expect(state.refreshes).toBe(2);
    expect(confirmed(result)).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(result.status).toBe("skipped");
    expect(result.notes).toMatch(/^Inconclusive/);
    expect(result.notes).toMatch(/plan \("free" → "pro"\)/);
    expect(result.notes).toMatch(/on its own/);
    expect(result.notes).toMatch(/check Account A/);
    expect(result.notes).not.toMatch(/put down to/);
    // Nothing was opened after the page under test: the change was read before the first route.
    for (const p of ["/app/billing", "/app/upgraded", "/upgraded"]) expect(loads(server, p)).toEqual([]);
    // Nothing was clicked to put it back: Run Hound didn't make the change.
    expect(posts(server, "/api/billing/cancel")).toEqual([]);
  }, 120_000);
});

describe("paywall-trust: running out of time (0.6.0 closeout, review round 1)", () => {
  it("is never a pass when it stopped for time with routes left unopened: inconclusive, naming them", async () => {
    // The clock jumps 250 s ahead when the first route loads, as on a slow app whose pages and quiet waits used up the
    // probing time: the conventional paths after it are never opened.
    const realNow = Date.now.bind(Date);
    let shift = 0;
    vi.spyOn(Date, "now").mockImplementation(() => realNow() + shift);
    const state = { plan: "free" };
    const server = await app({
      pages: {
        "/app": page("Dashboard", `<p id="plan">Loading…</p><a href="/app/upgraded">Already paid? Refresh your plan</a>`, SHOW),
        "/app/billing": BILLING,
      },
      routes: {
        "GET /api/me": (req, res) => (signedIn(req) ? send(res, 200, { ...WHO, plan: state.plan }) : send(res, 401, {})),
        // A clean success page that answers: the only route opened.
        "GET /app/upgraded": (_req, res) => {
          shift = 250_000;
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          res.end(page("Your plan", `<p>Thanks for being with us.</p>`));
        },
        "POST /api/billing/cancel": (_req, res) => {
          state.plan = "free";
          return send(res, 200, {});
        },
      },
    });
    const result = await runOn(server);
    expect(loads(server, "/app/upgraded").length).toBeGreaterThan(0);
    expect(loads(server, "/checkout/success")).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(result.status).toBe("skipped");
    expect(result.notes).toMatch(/^Inconclusive/);
    expect(result.notes).toMatch(/ran out of time/);
    expect(result.notes).toContain("/checkout/success");
    expect(result.notes).toMatch(/check Account A/);
  }, 120_000);
});

describe("paywall-trust: a late change put down to a tab names what came between (0.6.0 closeout, review round 2)", () => {
  it("says which routes that didn't load were opened between the tab and the route after which the change was read, never \"opened next\"", async () => {
    const state = { plan: "free", armed: false };
    const server = await app({
      pages: {
        // No links: the conventional paths are the only routes after the tab.
        "/app": `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Settings</title></head><body><main><h1>Settings</h1><p id="plan">Loading…</p>
<div role="tablist" aria-label="Settings"><button type="button" role="tab" id="t-profile" aria-selected="true">Profile</button>
<button type="button" role="tab" id="t-billing" aria-selected="false">Billing</button></div></main>
<script>${SHOW}
document.getElementById('t-billing').addEventListener('click', () => fetch('/api/billing/sync', { method: 'POST' }));</script></body></html>`,
      },
      routes: {
        "GET /api/me": (req, res) => (signedIn(req) ? send(res, 200, { ...WHO, plan: state.plan }) : send(res, 401, {})),
        // The tab queues the upgrade; it lands while the second conventional path is loading (a queued job's).
        "POST /api/billing/sync": (_req, res) => {
          state.armed = true;
          return send(res, 202, { queued: true });
        },
        "GET /app/upgraded": (_req, res) => {
          if (state.armed) state.plan = "pro";
          notFound(res);
        },
      },
    });
    const result = await runOn(server);
    expect(result.status).toBe("fail");
    expect(confirmed(result)[0]?.location).toBe("/app (Billing tab)");
    expect(result.notes).toMatch(/The change was read only after \/app\/upgraded \(answered 404\)/);
    expect(result.notes).toMatch(/\/upgraded, answered 404/);
    expect(result.notes).not.toMatch(/opened next/);
    expect(result.notes).not.toMatch(/the last thing Run Hound did before it\b/);
  }, 180_000);
});
