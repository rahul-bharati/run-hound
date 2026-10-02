// Channels that head for a payment provider (WebSocket, new window) and the cancel flow's retention offer the restore must never accept.

import { describe, expect, it } from "vitest";
import { app, CONFIRM_ON_LOAD, DASHBOARD, me, page, runOn, send, SHOW, sinkHits, usePaywallHarness } from "../../../../test-support/paywall-harness.js";

usePaywallHarness({ tmpPrefix: "rh-paywall-edges-" });

describe("paywall-trust: channels that head for a payment provider", () => {
  it("stops a WebSocket a success page opens to a payment provider's host, and lists it", async () => {
    const state = { plan: "free" };
    const server = await app({
      pages: {
        "/app": DASHBOARD,
        "/app/upgraded": page("Your upgrade", `<p>Confirming…</p>`, `try { new WebSocket('ws://realtime.stripe.com/v1/checkout'); } catch (e) {}`),
      },
      routes: { "GET /api/me": me(state) },
    });
    const result = await runOn(server);
    await new Promise((r) => setTimeout(r, 1000));
    expect(sinkHits).toEqual([]);
    expect(result.notes).toMatch(/realtime\.stripe\.com: blocked \(payment provider\)/);
  }, 180_000);

  it("never lets a new window opened blank, then sent at once to a page of the app that redirects to the provider, reach it", async () => {
    const state = { plan: "free", go: 0 };
    const server = await app({
      pages: {
        "/app": DASHBOARD,
        "/app/upgraded": page("Your upgrade", `<p>Confirming…</p>`, `const w = window.open('', '_blank'); if (w) w.location.href = '/go/manage';`),
      },
      routes: {
        "GET /api/me": me(state),
        "GET /go/manage": (_req, res) => {
          state.go += 1;
          res.writeHead(302, { location: "https://billing.stripe.com/p/session/test_1" });
          res.end();
        },
      },
    });
    const result = await runOn(server);
    await new Promise((r) => setTimeout(r, 1000));
    expect(sinkHits).toEqual([]);
    expect(result.notes).not.toMatch(/reached the provider/);
    expect(result.notes).toMatch(/\/app\/upgraded opened a new window at \/go\/manage, which Run Hound didn't load|billing\.stripe\.com: blocked \(payment provider\)/);
  }, 180_000);

  it("never lets the restore's 'Cancel plan', which opens a blank window and sends it to the app's portal redirect, reach the provider", async () => {
    const state = { plan: "free", manage: 0 };
    const server = await app({
      pages: {
        "/app": DASHBOARD,
        "/app/billing": page(
          "Billing",
          `<section><h2>Your plan</h2><p id="plan">Loading…</p><button type="button" id="cancel">Cancel plan</button></section>`,
          `${SHOW}
document.getElementById('cancel').addEventListener('click', () => { const w = window.open('', '_blank'); if (w) w.location.href = '/account/billing/manage'; });`,
        ),
        "/app/upgraded": CONFIRM_ON_LOAD,
      },
      routes: {
        "GET /api/me": me(state),
        "POST /api/billing/confirm": (_req, res) => {
          state.plan = "pro"; // V09
          return send(res, 200, {});
        },
        // Laravel Cashier's redirectToBillingPortal(): the app's server opens a portal session and redirects there.
        "GET /account/billing/manage": (_req, res) => {
          state.manage += 1;
          res.writeHead(302, { location: "https://billing.stripe.com/p/session/test_1" });
          res.end();
        },
      },
    });
    const result = await runOn(server);
    await new Promise((r) => setTimeout(r, 1000));
    expect(result.status).toBe("fail");
    expect(sinkHits).toEqual([]);
    expect(result.notes).not.toMatch(/reached the provider/);
    expect(result.notes).toMatch(/check Account A/);
  }, 180_000);
});

describe("paywall-trust: the restore never accepts a retention offer", () => {
  const OFFER_BILLING = (buttons: string) =>
    page(
      "Billing",
      `<section><h2>Your plan</h2><p id="plan">Loading…</p><button type="button" id="cancel">Cancel plan</button></section>
<div role="dialog" aria-labelledby="t" id="dlg" hidden><h2 id="t">Before you go</h2><p>Stay on Pro for 50% off your next 3 months?</p>
${buttons}</div>`,
      `${SHOW}
document.getElementById('cancel').addEventListener('click', () => { document.getElementById('dlg').hidden = false; });
document.getElementById('yes').addEventListener('click', () => fetch('/api/billing/retention/accept', { method: 'POST' }).then(() => { document.getElementById('dlg').hidden = true; }));
const no = document.getElementById('no');
if (no) no.addEventListener('click', () => fetch('/api/billing/cancel', { method: 'POST' }).then(() => { document.getElementById('dlg').hidden = true; }));`,
    );
  const offerApp = (billing: string, state: { plan: string; offers: number; cancels: number }) =>
    app({
      pages: { "/app": DASHBOARD, "/app/billing": billing, "/app/upgraded": CONFIRM_ON_LOAD },
      routes: {
        "GET /api/me": me(state),
        "POST /api/billing/confirm": (_req, res) => {
          state.plan = "pro"; // V09
          return send(res, 200, {});
        },
        "POST /api/billing/retention/accept": (_req, res) => {
          state.offers += 1; // the app applies the 50% coupon to the subscription
          return send(res, 200, { coupon: "STAY50" });
        },
        "POST /api/billing/cancel": (_req, res) => {
          state.cancels += 1;
          state.plan = "free";
          return send(res, 200, {});
        },
      },
    });

  it("clicks the offer's 'No, cancel my plan', never its 'Yes please'", async () => {
    const state = { plan: "free", offers: 0, cancels: 0 };
    const server = await offerApp(OFFER_BILLING(`<button type="button" id="yes">Yes please</button> <button type="button" id="no">No, cancel my plan</button>`), state);
    const result = await runOn(server);
    expect(result.status).toBe("fail");
    expect(state.offers).toBe(0);
    expect(state.cancels).toBe(1);
    expect(state.plan).toBe("free");
  }, 180_000);

  it("clicks nothing in an offer none of whose buttons says it cancels the plan, and says so", async () => {
    const state = { plan: "free", offers: 0, cancels: 0 };
    const server = await offerApp(OFFER_BILLING(`<button type="button" id="yes">Yes please</button> <button type="button" id="later">Continue</button>`), state);
    const result = await runOn(server);
    expect(result.status).toBe("fail");
    expect(state.offers).toBe(0);
    expect(result.notes).toMatch(/offer/i);
    expect(result.notes).toMatch(/check Account A/);
  }, 180_000);

  it("never accepts the browser's own confirm() when it makes an offer", async () => {
    const state = { plan: "free", offers: 0, cancels: 0 };
    const billing = page(
      "Billing",
      `<section><h2>Your plan</h2><p id="plan">Loading…</p><button type="button" id="cancel">Cancel plan</button></section>`,
      `${SHOW}
document.getElementById('cancel').addEventListener('click', () => {
  if (confirm('Before you go: stay on Pro for 50% off your next 3 months?')) fetch('/api/billing/retention/accept', { method: 'POST' });
  else fetch('/api/billing/cancel', { method: 'POST' });
});`,
    );
    const server = await offerApp(billing, state);
    const result = await runOn(server);
    expect(result.status).toBe("fail");
    expect(state.offers).toBe(0);
  }, 180_000);
});
