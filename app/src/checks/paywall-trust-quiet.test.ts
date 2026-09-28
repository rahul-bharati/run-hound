/**
 * paywall-trust's quiet waits (0.6.0 closeout, review round 1): what a Billing tab's script still sends while Run Hound
 * waits with nothing opened after it (a timer, a write after a slow GET) is held as it is while the tab is clicked; a
 * change the page under test's own load makes late is never credited to a later route; and a run that ran out of time
 * with routes left unopened is never a pass. Driven through createCheckContext like paywall-trust.test.ts, against small
 * fixture apps built per test.
 *
 * Payment providers: the browser is launched with host-resolver rules that send every Stripe, PayPal, Paddle and Lemon
 * Squeezy host to a local TCP sink, so any connection that "reaches the provider" is counted.
 */
import { mkdtemp, rm } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { createServer as createNetServer, type AddressInfo, type Server as NetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { startFixtureServer, type FixtureServer, type RecordedRequest, type RouteHandler } from "../../test-support/server.js";
import type { AccountRef, CheckResult, DiscoveredPage, Scenario } from "../core/types.js";
import type { SessionState } from "../engine/auth.js";
import { createCheckContext, type RunningCheckContext } from "../engine/context.js";
import { discoverPage, emptyForm } from "../engine/discover.js";
import { check } from "./paywall-trust.js";

const A: AccountRef = { id: "a", label: "Account A" };
/** Account A's username (the account marker): never printed. */
const ALEX = "alex@example.test";
const SESSION = "a-session-7d1f";
const SELF: SessionState = {
  cookies: [{ name: "sid", value: SESSION, domain: "127.0.0.1", path: "/", expires: -1, httpOnly: true, secure: false, sameSite: "Lax" }],
  origins: [],
};
const PROVIDER_PATTERNS = ["*.stripe.com", "*.paypal.com", "*.paddle.com", "*.lemonsqueezy.com"];

let browser: Browser;
let sink: NetServer;
/** One entry per connection that reached the stand-in payment provider. */
const sinkHits: string[] = [];
const servers: FixtureServer[] = [];
const contexts: RunningCheckContext[] = [];
const dirs: string[] = [];

beforeAll(async () => {
  sink = createNetServer((socket) => {
    sinkHits.push("connection");
    socket.destroy();
  });
  await new Promise<void>((resolve) => sink.listen(0, "127.0.0.1", resolve));
  const port = (sink.address() as AddressInfo).port;
  browser = await chromium.launch({ args: [`--host-resolver-rules=${PROVIDER_PATTERNS.map((p) => `MAP ${p} 127.0.0.1:${port}`).join(", ")}`] });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(contexts.splice(0).map((c) => c.dispose()));
  await Promise.all(servers.splice(0).map((s) => s.close()));
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
afterAll(async () => {
  await browser?.close();
  await new Promise<void>((resolve) => sink.close(() => resolve()));
});

const send = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
const signedIn = (req: RecordedRequest) => new RegExp(`(?:^|;\\s*)sid=${SESSION}\\b`).test(req.headers.cookie ?? "");
const pathOf = (r: RecordedRequest) => new URL(r.url, "http://x").pathname;
const posts = (server: FixtureServer, path: string) => server.requests.filter((r) => r.method === "POST" && pathOf(r) === path);
const loads = (server: FixtureServer, path: string) => server.requests.filter((r) => r.method === "GET" && pathOf(r) === path);

/** A page with the app's nav (Dashboard, Billing). */
function page(title: string, body: string, script = ""): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body>
<header><nav aria-label="Main"><a href="/app">Dashboard</a> <a href="/app/billing">Billing</a></nav></header>
<main><h1>${title}</h1>${body}</main>
<script>${script}</script></body></html>`;
}

const notFound = (res: ServerResponse) => {
  res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><html lang="en"><head><title>Not found</title></head><body><main><h1>Page not found</h1></main></body></html>`);
};

async function app(o: { pages: Record<string, string>; routes: Record<string, RouteHandler>; fallback?: RouteHandler }): Promise<FixtureServer> {
  const server = await startFixtureServer({
    pages: o.pages,
    routes: {
      "GET /favicon.ico": (_req, res) => {
        res.writeHead(204);
        res.end();
      },
      ...o.routes,
    },
    fallback: o.fallback ?? ((_req, res) => notFound(res)),
  });
  servers.push(server);
  return server;
}

async function discover(url: string): Promise<DiscoveredPage> {
  const context = await browser.newContext({ storageState: SELF, serviceWorkers: "block" });
  try {
    const p = await context.newPage();
    await p.goto(url);
    await p.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
    return await discoverPage(p);
  } finally {
    await context.close();
  }
}

/** Plans and runs paywall-trust on `path` of the app as Account A. server.requests then hold only what the run sent. */
async function runOn(server: FixtureServer, path = "/app"): Promise<CheckResult> {
  const targetUrl = `${server.url}${path}`;
  const discovered = await discover(targetUrl);
  const planned = check.plan(discovered.forms[0] ?? emptyForm(discovered.url), discovered, { signedIn: true, otherAccount: false });
  const scenario: Scenario = { ...planned[0]!, scope: "page", scopeLabel: "Whole page" };
  // Let whatever discovery started finish before counting.
  await new Promise((r) => setTimeout(r, 1000));
  server.requests.length = 0;
  sinkHits.length = 0;
  const dir = await mkdtemp(join(tmpdir(), "rh-paywall-quiet-"));
  dirs.push(dir);
  const ctx = createCheckContext({
    browser,
    form: discovered.forms[0] ?? emptyForm(targetUrl),
    openForm: false,
    discoveredPage: discovered,
    targetUrl,
    artifactsDir: dir,
    runToken: "pw7e57a1",
    checkId: "paywall-trust",
    scenarioTitle: scenario.title,
    sessions: { self: SELF },
    accounts: { self: A, other: null },
    markers: [ALEX],
    lookup: async (host: string) => {
      throw new Error(`no DNS in tests (${host})`);
    },
  });
  contexts.push(ctx);
  return check.run(ctx, scenario);
}

const confirmed = (r: CheckResult) => r.findings.filter((f) => f.confidence === "confirmed");

const WHO = { id: "u_alex", email: ALEX, name: "Alex Rivera" };
const SHOW = `fetch('/api/me').then(r => r.json()).then(m => { document.getElementById('plan').textContent = JSON.stringify(m.plan); });`;
const BILLING = page(
  "Billing",
  `<p id="plan">Loading…</p><button type="button" id="cancel">Cancel plan</button>`,
  `${SHOW}
document.getElementById('cancel').addEventListener('click', () => fetch('/api/billing/cancel', { method: 'POST' }));`,
);
/** A settings page whose tabs run `scripts` (by tab id) when chosen. */
const settings = (tabs: { id: string; name: string }[], scripts: string) =>
  page(
    "Settings",
    `<p id="plan">Loading…</p>
<div role="tablist" aria-label="Settings"><button type="button" role="tab" id="t-profile" aria-selected="true">Profile</button>
${tabs.map((t) => `<button type="button" role="tab" id="${t.id}" aria-selected="false">${t.name}</button>`).join("\n")}</div>`,
    `${SHOW}
${scripts}`,
  );

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
