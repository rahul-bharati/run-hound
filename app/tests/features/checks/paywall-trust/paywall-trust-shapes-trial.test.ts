// A clean success page that changes the plan without a grant — a free trial kept beside the plan, a metered entitlement's usage counter going up, and a free plan renamed — must never be a confirmed finding.

import { describe, expect, it } from "vitest";
import { app, BILLING, confirmed, DASHBOARD, page, pathOf, runOn, send, signedIn, usePaywallHarness, WHO } from "../../../support/paywall-harness.js";

usePaywallHarness({ tmpPrefix: "rh-paywall-shapes-" });

describe("paywall-trust: a clean success page that changes the plan without a grant", () => {
  it.each([
    ["subscription_status: trialing", (trial: boolean) => ({ plan: trial ? "pro" : "free", subscription_status: trial ? "trialing" : null })],
    ["trial_ends_at set", (trial: boolean) => ({ plan: trial ? "pro" : "free", trial_ends_at: trial ? new Date(Date.now() + 14 * 86400000).toISOString() : null })],
    ["a plan object with trial_ends_at", (trial: boolean) => ({ plan: trial ? { id: "pro", name: "Pro", trial_ends_at: new Date(Date.now() + 14 * 86400000).toISOString() } : { id: "free", name: "Free" } })],
    ["an isTrial flag", (trial: boolean) => ({ plan: trial ? "pro" : "free", isTrial: trial })],
  ])("a free trial kept beside the plan (%s) is never a confirmed finding", async (_name, shape) => {
    const state = { trial: false, confirms: 0 };
    const server = await app({
      pages: {
        "/app": DASHBOARD,
        "/app/billing": BILLING,
        // The app starts the 14-day Pro trial (no card) when the page loads: a trial, not a paid plan.
        "/app/upgraded": page("Your trial", `<p>Starting your trial…</p>`, `fetch('/api/billing/confirm', { method: 'POST' });`),
      },
      routes: {
        "GET /api/me": (req, res) => (signedIn(req) ? send(res, 200, { ...WHO, ...shape(state.trial) }) : send(res, 401, {})),
        "POST /api/billing/confirm": (_req, res) => {
          state.confirms += 1;
          state.trial = true;
          return send(res, 200, { trial: true });
        },
        "POST /api/billing/cancel": (_req, res) => {
          state.trial = false;
          return send(res, 200, { plan: "free" });
        },
      },
    });
    const result = await runOn(server);
    expect(state.confirms).toBeGreaterThan(0);
    expect(confirmed(result)).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(result.status).toBe("skipped");
    expect(result.notes).toMatch(/^Inconclusive/);
    expect(result.notes).toMatch(/trial/i);
  }, 120_000);

  it("a usage counter of a metered entitlement going up (used 3 → 4) is never a confirmed finding", async () => {
    const state = { used: 3 };
    const server = await app({
      pages: {
        "/app": DASHBOARD,
        "/app/billing": BILLING,
        // Runs the app's "AI summary" of the page as it loads: one use of a metered feature.
        "/app/upgraded": page("Your upgrade", `<p>We couldn't find a payment for this upgrade.</p>`, `fetch('/api/summary', { method: 'POST' });`),
      },
      routes: {
        "GET /api/me": (req, res) =>
          signedIn(req) ? send(res, 200, { ...WHO, plan: "free", entitlements: [{ key: "ai_summaries", limit: 10, used: state.used }] }) : send(res, 401, {}),
        "POST /api/summary": (_req, res) => {
          state.used += 1;
          return send(res, 200, { summary: "…" });
        },
        "POST /api/billing/cancel": (_req, res) => send(res, 200, {}),
      },
    });
    const result = await runOn(server);
    expect(state.used).toBeGreaterThan(3);
    expect(confirmed(result)).toEqual([]);
    expect(result.status).toBe("skipped");
    expect(result.notes).toMatch(/^Inconclusive/);
    expect(result.notes).toMatch(/entitlements/);
  }, 120_000);

  it("a free plan renamed (free → free_2026) is never a confirmed finding, and no cancel is clicked on the free account", async () => {
    const state = { plan: "free", cancels: 0 };
    const server = await app({
      pages: {
        "/app": DASHBOARD,
        "/app/billing": BILLING,
        // "Refresh your plan": stores the provider's name for the free tier (no payment: still the free tier).
        "/app/upgraded": page("Your plan", `<p>We couldn't find a payment. You're on the free plan.</p>`, `fetch('/api/billing/sync', { method: 'POST' });`),
      },
      routes: {
        "GET /api/me": (req, res) => (signedIn(req) ? send(res, 200, { ...WHO, plan: state.plan }) : send(res, 401, {})),
        "POST /api/billing/sync": (_req, res) => {
          state.plan = "free_2026";
          return send(res, 200, { plan: state.plan });
        },
        "POST /api/billing/cancel": (_req, res) => {
          state.cancels += 1;
          return send(res, 200, {});
        },
      },
    });
    const result = await runOn(server);
    expect(state.plan).toBe("free_2026");
    expect(confirmed(result)).toEqual([]);
    expect(result.status).toBe("skipped");
    expect(result.notes).toMatch(/free_2026/);
    expect(state.cancels).toBe(0);
    expect(server.requests.filter((r) => r.method === "POST" && pathOf(r) === "/api/billing/cancel")).toEqual([]);
  }, 120_000);
});
