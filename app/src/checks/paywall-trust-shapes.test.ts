/**
 * paywall-trust against other app shapes (0.6.0 review, round 1): where Account A's plan is read from, a grant that
 * lands late, and a teammate's card with a heading of its own. Driven through createCheckContext like
 * paywall-trust.test.ts, against small fixture apps built per test.
 *
 * Split from the original paywall-trust-shapes.test.ts (which also covered a clean success page that changes the
 * plan without a grant, and the loads a page makes outside its frame) to keep each file under the suite's per-file
 * time budget: see paywall-trust-shapes-trial.test.ts, paywall-trust-frames.test.ts and
 * paywall-trust-frames-rules.test.ts. All four share test-support/paywall-harness.ts's fixture-app, discovery and
 * browser/sink setup.
 */
import { describe, expect, it } from "vitest";
import type { FixtureServer } from "../../test-support/server.js";
import {
  ALEX,
  app,
  BILLING,
  browser,
  confirmed,
  CONFIRM_ON_LOAD,
  DASHBOARD,
  notFound,
  page,
  pathOf,
  runOn,
  SELF,
  send,
  SHOW,
  signedIn,
  SUCCESS_LINK,
  usePaywallHarness,
  WHO,
} from "../../test-support/paywall-harness.js";

usePaywallHarness({ tmpPrefix: "rh-paywall-shapes-" });

describe("paywall-trust: where Account A's plan is read from", () => {
  it("re-reads every GET that holds Account A's plan: a grant seen by /api/me is found when the page read a session endpoint (a cached JWT) first", async () => {
    const state = { plan: "free", grants: 0, cancels: 0 };
    const server = await app({
      pages: {
        // Like useSession(): the page reads the session first, then the account from the database.
        "/app": page(
          "Dashboard",
          `<p id="plan">Loading…</p>${SUCCESS_LINK}`,
          `fetch('/api/auth/session').then(r => r.json()).then(() => fetch('/api/me')).then(r => r.json()).then(m => { document.getElementById('plan').textContent = m.plan; });`,
        ),
        "/app/billing": BILLING,
        "/app/upgraded": CONFIRM_ON_LOAD,
      },
      routes: {
        // The JWT carries the plan it was signed in with; only a new sign-in refreshes it.
        "GET /api/auth/session": (req, res) =>
          signedIn(req) ? send(res, 200, { user: { ...WHO, plan: "free" }, expires: new Date(Date.now() + 86400000).toISOString() }) : send(res, 200, {}),
        "GET /api/me": (req, res) => (signedIn(req) ? send(res, 200, { ...WHO, plan: state.plan }) : send(res, 401, {})),
        "POST /api/billing/confirm": (_req, res) => {
          state.plan = "pro"; // V09
          state.grants += 1;
          return send(res, 200, { confirmed: true });
        },
        "POST /api/billing/cancel": (_req, res) => {
          state.plan = "free";
          state.cancels += 1;
          return send(res, 200, {});
        },
      },
    });
    const result = await runOn(server);
    expect(state.grants).toBeGreaterThan(0);
    expect(result.status).toBe("fail");
    expect(confirmed(result)).toHaveLength(1);
    expect(result.findings[0]!.location).toBe("/app/upgraded");
    expect(result.findings[0]!.meaning).toContain("/api/me");
    // Put back through the app's own "Cancel plan".
    expect(state.cancels).toBe(1);
    expect(state.plan).toBe("free");
    expect(result.notes).toMatch(/Put back/);
    expect(JSON.stringify(result)).not.toContain(ALEX);
  }, 120_000);

  it("never confirms a finding when one GET of the plan reads a gain and another a change that isn't one: they disagree", async () => {
    const state = { plan: "free", credits: 5, cancels: 0 };
    const server = await app({
      pages: {
        "/app": page(
          "Dashboard",
          `<p id="plan">Loading…</p>${SUCCESS_LINK}`,
          `fetch('/api/me').then(r => r.json()).then(m => { document.getElementById('plan').textContent = m.plan; }); fetch('/api/wallet');`,
        ),
        "/app/billing": BILLING,
        "/app/upgraded": CONFIRM_ON_LOAD,
      },
      routes: {
        "GET /api/me": (req, res) => (signedIn(req) ? send(res, 200, { ...WHO, plan: state.plan }) : send(res, 401, {})),
        "GET /api/wallet": (req, res) => (signedIn(req) ? send(res, 200, { owner: { ...WHO }, credits: state.credits }) : send(res, 401, {})),
        // The page's confirm moves the plan and spends a credit: /api/me reads a gain, /api/wallet a spend.
        "POST /api/billing/confirm": (_req, res) => {
          state.plan = "pro";
          state.credits -= 1;
          return send(res, 200, { confirmed: true });
        },
        "POST /api/billing/cancel": (_req, res) => {
          state.plan = "free";
          state.cancels += 1;
          return send(res, 200, {});
        },
      },
    });
    const result = await runOn(server);
    expect(confirmed(result)).toEqual([]);
    expect(result.status).toBe("skipped");
    expect(result.notes).toMatch(/^Inconclusive/);
    expect(result.notes).toContain("GET /api/me");
    expect(result.notes).toContain("GET /api/wallet");
    expect(result.notes).toMatch(/which to believe/);
    // The plan field changed, so it is put back like any other change the scenario made.
    expect(state.plan).toBe("free");
  }, 120_000);

  it("reads isPro kept as 0/1 (SQLite, MySQL tinyint): a success page that sets it to 1 is a grant", async () => {
    const state = { pro: 0 };
    const server = await app({
      pages: { "/app": DASHBOARD.replace("m.plan", "m.isPro"), "/app/billing": BILLING, "/app/upgraded": CONFIRM_ON_LOAD },
      routes: {
        "GET /api/me": (req, res) => (signedIn(req) ? send(res, 200, { ...WHO, isPro: state.pro }) : send(res, 401, {})),
        "POST /api/billing/confirm": (_req, res) => {
          state.pro = 1; // V09
          return send(res, 200, { confirmed: true });
        },
        "POST /api/billing/cancel": (_req, res) => {
          state.pro = 0;
          return send(res, 200, {});
        },
      },
    });
    const result = await runOn(server);
    expect(result.status).toBe("fail");
    expect(confirmed(result)).toHaveLength(1);
    expect(result.findings[0]!.meaning).toMatch(/isPro 0 → 1/);
    expect(state.pro).toBe(0);
  }, 120_000);
});

/**
 * The exported spec's wait for a late change (review round 1): SETTLE_MS, a poll loop that reads the plan until then and
 * stops at the first change, and a test timeout that covers it. Returns SETTLE_MS.
 */
function expectSettles(source: string): number {
  const settle = /const SETTLE_MS = ([\d_]+);/.exec(source);
  expect(settle).not.toBeNull();
  expect(source).toMatch(/const settleBy = Date\.now\(\) \+ SETTLE_MS;/);
  expect(source).toMatch(/while \(Date\.now\(\) < settleBy && JSON\.stringify\(after\) === JSON\.stringify\(before\)\)/);
  expect(source).toMatch(/test\.setTimeout\([^)]*SETTLE_MS\)/);
  // The poll comes after the route was opened, and the check after the poll.
  expect(source.indexOf("page.goto(new URL(ROUTE, TARGET).href)")).toBeLessThan(source.indexOf("const settleBy"));
  expect(source.indexOf("const settleBy")).toBeLessThan(source.indexOf(").toEqual(before)"));
  return Number(settle![1]!.replace(/_/g, ""));
}

/**
 * Replays the exported spec's steps against the fixture as Account A (signed in with its session cookie instead of the
 * sign-in page): the plan before, the route opened and the network idle, then the plan read until `settleMs` have passed
 * or it changed. Returns the plan before and the last one read.
 */
async function replaysSpec(server: FixtureServer, route: string, settleMs: number): Promise<{ before: unknown; after: unknown }> {
  const context = await browser.newContext({ storageState: SELF, serviceWorkers: "block" });
  try {
    const p = await context.newPage();
    const plan = async () => ((await (await p.request.get(`${server.url}/api/me`)).json()) as { plan: unknown }).plan;
    const before = await plan();
    await p.goto(`${server.url}${route}`);
    await p.waitForLoadState("networkidle");
    const settleBy = Date.now() + settleMs;
    let after = await plan();
    while (Date.now() < settleBy && after === before) {
      await new Promise((r) => setTimeout(r, 500));
      after = await plan();
    }
    return { before, after };
  } finally {
    await context.close();
  }
}

describe("paywall-trust: a grant that lands late", () => {
  it("is never credited to a route that answered 404: a queued job's grant after /app/upgraded is named as /app/upgraded's", async () => {
    const state = { plan: "free", queued: false };
    const server = await app({
      pages: { "/app": DASHBOARD, "/app/billing": BILLING, "/app/upgraded": CONFIRM_ON_LOAD },
      routes: {
        "GET /api/me": (req, res) => (signedIn(req) ? send(res, 200, { ...WHO, plan: state.plan }) : send(res, 401, {})),
        // V09, through a job queue: the confirm only queues the upgrade.
        "POST /api/billing/confirm": (_req, res) => {
          state.queued = true;
          return send(res, 202, { queued: true });
        },
        "POST /api/billing/cancel": (_req, res) => {
          state.plan = "free";
          return send(res, 200, {});
        },
      },
      // A slow 404 for every other path (a server-rendered not-found page). The queued upgrade lands while the first
      // of them loads: after the quiet read that follows /app/upgraded (0.6.0 closeout), so the change is first read
      // after a route that answered 404.
      fallback: (_req, res) => {
        if (state.queued) {
          state.queued = false;
          state.plan = "pro";
        }
        setTimeout(() => notFound(res), 2500);
      },
    });
    const result = await runOn(server);
    expect(result.status).toBe("fail");
    const finding = confirmed(result)[0]!;
    expect(finding.location).toBe("/app/upgraded");
    expect(finding.meaning).toContain("/app/upgraded");
    expect(finding.meaning).not.toMatch(/opened \/upgraded/);
    expect(finding.spec?.source).toContain(`const ROUTE = "/app/upgraded"`);
    expect(result.notes).toMatch(/\/upgraded \(answered 404\)/);
    expect(state.plan).toBe("free");
  }, 180_000);

  it("is never credited to the next page when that page answered too: a queued job's grant after /app/upgraded is still /app/upgraded's (0.6.0 closeout)", async () => {
    const state = { plan: "free", confirms: 0 };
    const server = await app({
      pages: {
        "/app": DASHBOARD,
        "/app/billing": BILLING,
        "/app/upgraded": CONFIRM_ON_LOAD,
        // The next candidate (a conventional path) is a page of the app that answers and changes nothing.
        "/upgraded": page("What's new", `<p>The editor was upgraded to a new look.</p>`),
      },
      routes: {
        "GET /api/me": (req, res) => (signedIn(req) ? send(res, 200, { ...WHO, plan: state.plan }) : send(res, 401, {})),
        // V09, through a job queue: the upgrade lands 1.5 s after the confirm answered.
        "POST /api/billing/confirm": (_req, res) => {
          state.confirms += 1;
          setTimeout(() => (state.plan = "pro"), 1500);
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
    expect(finding.location).toBe("/app/upgraded");
    expect(finding.meaning).toContain("opened /app/upgraded");
    expect(finding.spec?.source).toContain(`const ROUTE = "/app/upgraded"`);
    expect(result.notes).toMatch(/read only after Run Hound had opened nothing for \d+ s after \/app\/upgraded/);
    // Nothing was opened after /app/upgraded: the change was read before the next page.
    expect(result.notes).not.toMatch(/[\s:,]\/upgraded \(answered\)/);
    expect(server.requests.filter((r) => pathOf(r) === "/upgraded")).toEqual([]);
    expect(state.plan).toBe("free");
    // The exported spec waits for a change that lands late (review round 1): it reads the plan until SETTLE_MS have
    // passed (at least as long as Run Hound waited, plus the quiet pause) and fails on any change. Replayed as the spec
    // does, it fails on this app, where a read right after the network went idle still shows the free plan.
    const source = finding.spec!.source;
    const lateS = Number(/opened nothing for (\d+) s after/.exec(result.notes ?? "")?.[1]);
    const settleMs = expectSettles(source);
    expect(settleMs).toBeGreaterThanOrEqual((lateS + 4.5) * 1000);
    expect(await replaysSpec(server, "/app/upgraded", settleMs)).toEqual({ before: "free", after: "pro" });
    expect(state.confirms).toBe(2);
    state.plan = "free";
  }, 180_000);

  it("is never credited to the next Billing tab chosen: a queued grant the Billing tab started is still that tab's (0.6.0 closeout)", async () => {
    const state = { plan: "free", syncs: 0 };
    const server = await app({
      pages: {
        "/app": page(
          "Settings",
          `<p id="plan">Loading…</p>
<div role="tablist" aria-label="Settings"><button type="button" role="tab" id="t-profile" aria-selected="true">Profile</button>
<button type="button" role="tab" id="t-billing" aria-selected="false">Billing</button>
<button type="button" role="tab" id="t-plans" aria-selected="false">Plans</button></div>`,
          `${SHOW}
document.getElementById('t-billing').addEventListener('click', () => fetch('/api/billing/sync', { method: 'POST' }));`,
        ),
        "/app/billing": BILLING,
      },
      routes: {
        "GET /api/me": (req, res) => (signedIn(req) ? send(res, 200, { ...WHO, plan: state.plan }) : send(res, 401, {})),
        // V09 through a job queue, started by showing the Billing tab: the upgrade lands 1.5 s later.
        "POST /api/billing/sync": (_req, res) => {
          state.syncs += 1;
          setTimeout(() => (state.plan = "pro"), 1500);
          return send(res, 202, { queued: true });
        },
        "POST /api/billing/cancel": (_req, res) => {
          state.plan = "free";
          return send(res, 200, {});
        },
      },
    });
    const result = await runOn(server);
    expect(state.syncs).toBe(1);
    expect(result.status).toBe("fail");
    const finding = confirmed(result)[0]!;
    expect(finding.location).toBe("/app (Billing tab)");
    expect(finding.meaning).toContain(`chose the "Billing" tab on /app`);
    expect(result.notes).not.toMatch(/Plans/);
    // The late read's note names the tab as chosen, never as a page opened (review round 1).
    expect(result.notes).toMatch(/opened nothing for \d+ s after choosing the "Billing" tab on \/app, so it is put down to that tab/);
    expect(result.notes).not.toMatch(/the last page it opened/);
    const lateS = Number(/opened nothing for (\d+) s after/.exec(result.notes ?? "")?.[1]);
    expect(expectSettles(finding.spec!.source)).toBeGreaterThanOrEqual((lateS + 4.5) * 1000);
    expect(state.plan).toBe("free");
  }, 180_000);
});

describe("paywall-trust: the restore clicks only Account A's own plan control", () => {
  it.each([
    ["an e-mail and tier in the card's heading", "jo@acme.test · Pro"],
    ["a name and tier in the card's heading", "Jo Park · Pro"],
  ])("never clicks a teammate's 'Downgrade to Free' in a card with a heading of its own (%s)", async (_n, heading) => {
    const state = { plan: "free", teammateDowngrades: 0, cancels: 0 };
    const server = await app({
      pages: {
        "/app": DASHBOARD,
        "/app/billing": page(
          "Billing",
          `<div class="seat"><h3>${heading}</h3><p>Seat 2</p><button type="button" data-down="/api/team/u_jo/downgrade">Downgrade to Free</button></div>
<section><h2>Plan &amp; billing</h2><p id="plan">Loading…</p><button type="button" id="cancel">Cancel plan</button></section>`,
          `${SHOW}
document.getElementById('cancel').addEventListener('click', () => fetch('/api/billing/cancel', { method: 'POST' }));
document.querySelectorAll('[data-down]').forEach(b => b.addEventListener('click', () => fetch(b.getAttribute('data-down'), { method: 'POST' })));`,
        ),
        "/app/upgraded": CONFIRM_ON_LOAD,
      },
      routes: {
        "GET /api/me": (req, res) => (signedIn(req) ? send(res, 200, { ...WHO, plan: state.plan }) : send(res, 401, {})),
        "POST /api/billing/confirm": (_req, res) => {
          state.plan = "pro";
          return send(res, 200, { confirmed: true });
        },
        "POST /api/billing/cancel": (_req, res) => {
          state.plan = "free";
          state.cancels += 1;
          return send(res, 200, {});
        },
        "POST /api/team/u_jo/downgrade": (_req, res) => {
          state.teammateDowngrades += 1;
          return send(res, 204, {});
        },
      },
    });
    const result = await runOn(server);
    expect(result.status).toBe("fail");
    expect(state.teammateDowngrades).toBe(0);
    expect(state.cancels).toBe(1);
    expect(state.plan).toBe("free");
  }, 120_000);
});
