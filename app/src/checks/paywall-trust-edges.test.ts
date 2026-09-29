/**
 * paywall-trust against the shapes the 0.6.0 review's round 2 found (docs/v2-spec.md "`paywall-trust` amendments"):
 * never a pass while a change could still land — a grant that lands after the last route's re-read, a plan read only
 * from a session endpoint, a snake_case plan flag, and a clean trial kept as an object. Driven through
 * createCheckContext like paywall-trust.test.ts, against small fixture apps built per test.
 *
 * Split from the original paywall-trust-edges.test.ts (which also covered a WebSocket or a new window that heads for
 * a payment provider, and a cancel flow's retention offer) to keep each file under the suite's per-file time budget:
 * see paywall-trust-edges-channels.test.ts. Both share test-support/paywall-harness.ts's fixture-app, discovery and
 * browser/sink setup.
 */
import { describe, expect, it } from "vitest";
import { ALEX, app, BILLING, confirmed, CONFIRM_ON_LOAD, me, page, runOn, send, SHOW, signedIn, SUCCESS_LINK, usePaywallHarness, WHO } from "../../test-support/paywall-harness.js";

usePaywallHarness({ tmpPrefix: "rh-paywall-edges-" });

describe("paywall-trust: never a pass while a change could still land", () => {
  it("reads the plan once more after a quiet pause: a queued grant from the last conventional path (/app/billing/success) is found and put back", async () => {
    const state = { plan: "free", confirms: 0 };
    const server = await app({
      pages: {
        "/app": page("Dashboard", `<p id="plan">Loading…</p>`, SHOW),
        "/app/billing": BILLING,
        "/app/billing/success": page("Payment received", `<p>Thanks! Activating your plan…</p>`, `fetch('/api/billing/confirm', { method: 'POST' });`),
      },
      routes: {
        "GET /api/me": me(state),
        // V09 through a job queue: the upgrade lands 2 s after the confirm.
        "POST /api/billing/confirm": (_req, res) => {
          state.confirms += 1;
          setTimeout(() => (state.plan = "pro"), 2000);
          return send(res, 202, { queued: true });
        },
        "POST /api/billing/cancel": (_req, res) => {
          state.plan = "free";
          return send(res, 200, {});
        },
      },
    });
    const result = await runOn(server);
    expect(state.confirms).toBe(1);
    expect(result.status).toBe("fail");
    const finding = confirmed(result)[0]!;
    expect(finding.severity).toBe("critical");
    expect(finding.location).toBe("/app/billing/success");
    expect(result.notes).toMatch(/read only after Run Hound had opened nothing for \d+ s after \/app\/billing\/success/);
    expect(state.plan).toBe("free");
  }, 180_000);

  it("never passes when Account A's plan is read only from a session endpoint (NextAuth useSession, JWT strategy) that may keep the plan it signed in with", async () => {
    const state = { plan: "free", grants: 0 };
    const server = await app({
      pages: {
        "/app": page(
          "Dashboard",
          `<p id="plan">Loading…</p>${SUCCESS_LINK}`,
          `fetch('/api/auth/session').then(r => r.json()).then(s => { document.getElementById('plan').textContent = s.user && s.user.plan; });`,
        ),
        "/app/billing": BILLING,
        "/app/upgraded": CONFIRM_ON_LOAD,
      },
      routes: {
        // The JWT carries the plan it was signed in with; the database has the real one.
        "GET /api/auth/session": (req, res) =>
          signedIn(req) ? send(res, 200, { user: { ...WHO, plan: "free" }, expires: "2026-10-28T00:00:00.000Z" }) : send(res, 200, {}),
        "POST /api/billing/confirm": (_req, res) => {
          state.plan = "pro"; // V09
          state.grants += 1;
          return send(res, 200, { confirmed: true });
        },
        "POST /api/billing/cancel": (_req, res) => {
          state.plan = "free";
          return send(res, 200, {});
        },
      },
    });
    const result = await runOn(server);
    expect(state.grants).toBe(1);
    expect(result.status).toBe("skipped");
    expect(result.findings).toEqual([]);
    expect(result.notes).toContain(
      "Account A's plan was read only from GET /api/auth/session, which may keep the plan Account A signed in with, so a change can't be seen: check Account A.",
    );
    expect(result.notes).not.toContain(ALEX);
  }, 180_000);

  it("still reports a gain a session endpoint shows", async () => {
    const state = { plan: "free" };
    const server = await app({
      pages: {
        "/app": page(
          "Dashboard",
          `<p id="plan">Loading…</p>${SUCCESS_LINK}`,
          `fetch('/api/auth/session').then(r => r.json()).then(s => { document.getElementById('plan').textContent = s.user && s.user.plan; });`,
        ),
        "/app/billing": BILLING,
        "/app/upgraded": CONFIRM_ON_LOAD,
      },
      routes: {
        // A database session: the answer reads the plan as it is now.
        "GET /api/auth/session": (req, res) => (signedIn(req) ? send(res, 200, { user: { ...WHO, plan: state.plan }, expires: "2026-10-28T00:00:00.000Z" }) : send(res, 200, {})),
        "POST /api/billing/confirm": (_req, res) => {
          state.plan = "pro";
          return send(res, 200, { confirmed: true });
        },
        "POST /api/billing/cancel": (_req, res) => {
          state.plan = "free";
          return send(res, 200, {});
        },
      },
    });
    const result = await runOn(server);
    expect(result.status).toBe("fail");
    expect(confirmed(result)[0]?.location).toBe("/app/upgraded");
    expect(state.plan).toBe("free");
  }, 180_000);

  it("reads a snake_case plan flag (is_pro, a Supabase or Postgres profile) as isPro: a success page that sets it is a grant", async () => {
    const state = { is_pro: false, credits: 3 };
    const server = await app({
      pages: {
        "/app": page(
          "Dashboard",
          `<p id="plan">Loading…</p>${SUCCESS_LINK}`,
          `fetch('/api/me').then(r => r.json()).then(m => { document.getElementById('plan').textContent = m.is_pro ? 'Pro' : 'Free'; });`,
        ),
        "/app/billing": BILLING,
        "/app/upgraded": CONFIRM_ON_LOAD,
      },
      routes: {
        "GET /api/me": (req, res) =>
          signedIn(req) ? send(res, 200, { id: "u_alex", email: ALEX, full_name: "Alex Rivera", credits: state.credits, is_pro: state.is_pro }) : send(res, 401, {}),
        "POST /api/billing/confirm": (_req, res) => {
          state.is_pro = true; // V09
          return send(res, 200, { confirmed: true });
        },
        "POST /api/billing/cancel": (_req, res) => {
          state.is_pro = false;
          return send(res, 200, {});
        },
      },
    });
    const result = await runOn(server);
    expect(result.status).toBe("fail");
    const finding = confirmed(result)[0]!;
    expect(finding.location).toBe("/app/upgraded");
    expect(finding.meaning).toMatch(/is_pro false → true/);
    expect(state.is_pro).toBe(false);
  }, 180_000);

  it("never confirms a clean no-card trial kept as an object ({ trial: { active, ends_at } })", async () => {
    const state: { plan: string; trial: null | { active: boolean; ends_at: string } } = { plan: "free", trial: null };
    const server = await app({
      pages: {
        "/app": page(
          "Dashboard",
          `<p id="plan">Loading…</p><a href="/app/billing/trial-activated">Try Pro free for 14 days: activate your trial</a>`,
          `fetch('/api/me').then(r => r.json()).then(m => { document.getElementById('plan').textContent = m.plan; });`,
        ),
        "/app/billing": BILLING,
        // The app's own trial: no card needed, so starting it is legitimate.
        "/app/billing/trial-activated": page("Your Pro trial is active", `<p>Enjoy Pro free for 14 days.</p>`, `fetch('/api/trial/start', { method: 'POST' });`),
      },
      routes: {
        "GET /api/me": (req, res) => (signedIn(req) ? send(res, 200, { ...WHO, plan: state.plan, trial: state.trial }) : send(res, 401, {})),
        "POST /api/trial/start": (_req, res) => {
          state.plan = "pro";
          state.trial = { active: true, ends_at: new Date(Date.now() + 14 * 86_400_000).toISOString() };
          return send(res, 200, {});
        },
        "POST /api/billing/cancel": (_req, res) => {
          state.plan = "free";
          state.trial = null;
          return send(res, 200, {});
        },
      },
    });
    const result = await runOn(server);
    expect(confirmed(result)).toEqual([]);
    expect(result.status).toBe("skipped");
    expect(result.notes).toMatch(/^Inconclusive/);
  }, 180_000);
});
