/**
 * paywall-trust against the shapes the 0.6.0 review's round 2 found (docs/v2-spec.md "`paywall-trust` amendments"): a
 * grant that lands after the last route's re-read, a plan read only from a session endpoint, a snake_case plan flag, a
 * clean trial kept as an object, a WebSocket or a new window that heads for a payment provider, and a cancel flow's
 * retention offer. Driven through createCheckContext like paywall-trust.test.ts, against small fixture apps built per
 * test.
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
  const dir = await mkdtemp(join(tmpdir(), "rh-paywall-edges-"));
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
const me = (state: { plan: string }) => (req: RecordedRequest, res: ServerResponse) => (signedIn(req) ? send(res, 200, { ...WHO, plan: state.plan }) : send(res, 401, {}));

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
