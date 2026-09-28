/**
 * paywall-trust against other app shapes (0.6.0 review, round 1): where Account A's plan is read from, how a trial or a
 * renamed free plan looks, metered entitlements, a grant that lands late, a teammate's card with a heading of its own,
 * and the loads a page makes outside its frame (speculation rules, a SharedWorker). Driven through createCheckContext
 * like paywall-trust.test.ts, against small fixture apps built per test.
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
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
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

/** A page with the app's nav (Dashboard, Billing). */
function page(title: string, body: string, script = "", head = ""): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>${head}</head><body>
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
  const dir = await mkdtemp(join(tmpdir(), "rh-paywall-shapes-"));
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

const SUCCESS_LINK = `<a href="/app/upgraded">Already paid? Refresh your plan</a>`;
const WHO = { id: "u_alex", email: ALEX, name: "Alex Rivera" };
const SHOW = `fetch('/api/me').then(r => r.json()).then(m => { document.getElementById('plan').textContent = JSON.stringify(m.plan); });`;
const DASHBOARD = page("Dashboard", `<p id="plan">Loading…</p>${SUCCESS_LINK}`, SHOW);
const BILLING = page(
  "Billing",
  `<p id="plan">Loading…</p><button type="button" id="cancel">Cancel plan</button>`,
  `${SHOW}
document.getElementById('cancel').addEventListener('click', () => fetch('/api/billing/cancel', { method: 'POST' }));`,
);
const CONFIRM_ON_LOAD = page("Your upgrade", `<p>Confirming…</p>`, `fetch('/api/billing/confirm', { method: 'POST' });`);

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

describe("paywall-trust: loads a page makes outside its frame never reach a payment provider", () => {
  // The app's own "Manage billing" link: a billing portal start the check never opens itself.
  const MANAGE = `<a href="/billing/portal">Manage billing</a>`;
  it.each([
    ["list prerender", `<script type="speculationrules">{"prerender":[{"source":"list","urls":["/billing/portal"]}]}</script>`, ""],
    ["list prefetch", `<script type="speculationrules">{"prefetch":[{"source":"list","urls":["/billing/portal"]}]}</script>`, ""],
    ["document rules, immediate prefetch", `<script type="speculationrules">{"prefetch":[{"source":"document","where":{"href_matches":"/*"},"eagerness":"immediate"}]}</script>`, ""],
    ["document rules, immediate prerender", `<script type="speculationrules">{"prerender":[{"source":"document","where":{"href_matches":"/*"},"eagerness":"immediate"}]}</script>`, ""],
    ["a Speculation-Rules header", "", "/speculation.json"],
    ["link rel=prefetch", `<link rel="prefetch" href="/billing/portal">`, ""],
  ])("speculation rules on the page under test (%s) never load the app's portal start", async (_name, head, header) => {
    const server = await app({
      pages: {
        "/app/billing": page("Billing", `<p id="plan">Loading…</p>`, SHOW),
        "/app/upgraded": page("Your upgrade", `<p>We couldn't find a payment.</p>`),
      },
      routes: {
        "GET /app": (_req, res) => {
          res.writeHead(200, { "content-type": "text/html; charset=utf-8", ...(header ? { "speculation-rules": `"${header}"` } : {}) });
          res.end(page("Dashboard", `<p id="plan">Loading…</p>${SUCCESS_LINK} ${MANAGE}`, SHOW, head));
        },
        "GET /speculation.json": (_req, res) => {
          res.writeHead(200, { "content-type": "application/speculationrules+json" });
          res.end(JSON.stringify({ prerender: [{ source: "list", urls: ["/billing/portal"] }] }));
        },
        "GET /api/me": (req, res) => (signedIn(req) ? send(res, 200, { ...WHO, plan: "free" }) : send(res, 401, {})),
        // A billing portal start: the app's server creates a portal session at the provider and redirects there.
        "GET /billing/portal": (_req, res) => {
          res.writeHead(303, { location: "https://billing.stripe.com/p/session/test_portal" });
          res.end();
        },
      },
    });
    const result = await runOn(server);
    await new Promise((r) => setTimeout(r, 1000));
    expect(server.requests.filter((r) => pathOf(r) === "/billing/portal")).toEqual([]);
    expect(sinkHits).toEqual([]);
    expect(result.status).not.toBe("error");
    if (_name === "link rel=prefetch") expect(result.notes).toMatch(/prefetch or prerender \/billing\/portal/);
  }, 120_000);

  it("a SharedWorker the page under test starts never reaches the provider", async () => {
    const state = { plan: "free" };
    const server = await app({
      pages: {
        "/app": page("Dashboard", `<p id="plan">Loading…</p>${SUCCESS_LINK}`, `${SHOW} try { new SharedWorker('/shared.js'); } catch (e) {}`),
        "/app/billing": BILLING,
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
          return send(res, 200, {});
        },
        "GET /shared.js": (_req, res) => {
          res.writeHead(200, { "content-type": "text/javascript" });
          res.end(`fetch('https://js.stripe.com/v3/', { mode: 'no-cors' }).catch(() => {}); fetch('https://api.stripe.com/v1/billing_portal/sessions', { method: 'POST', mode: 'no-cors' }).catch(() => {});`);
        },
      },
    });
    const result = await runOn(server);
    await new Promise((r) => setTimeout(r, 1000));
    expect(sinkHits).toEqual([]);
    expect(server.requests.filter((r) => pathOf(r) === "/shared.js")).toEqual([]);
    expect(result.status).toBe("fail");
    expect(state.plan).toBe("free");
  }, 120_000);
});
