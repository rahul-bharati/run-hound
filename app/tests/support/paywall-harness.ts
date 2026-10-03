/**
 * Shared preamble for the paywall-trust split test files (paywall-trust-shapes*, paywall-trust-quiet*,
 * paywall-trust-edges*, byte-identical across the three families before this merge): the browser launched with
 * payment-provider host-resolver rules and a TCP sink that counts connections that reach them, the fixture-app and
 * discovery helpers, and the small HTML/state fixtures (WHO, SHOW, DASHBOARD, BILLING, CONFIRM_ON_LOAD, settings, me)
 * the split files build their apps from.
 *
 * usePaywallHarness() holds the beforeAll/afterEach/afterAll every split file had verbatim; each file calls it with
 * its own family's original mkdtemp prefix, and, for the files whose preamble called vi.restoreAllMocks() in
 * afterEach (quiet, quiet-hold), restoreMocks: true reproduces that.
 *
 * Payment providers: the browser is launched with host-resolver rules that send every Stripe, PayPal, Paddle and
 * Lemon Squeezy host to a local TCP sink, so any connection that "reaches the provider" is counted.
 */
import { mkdtemp, rm } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { createServer as createNetServer, type AddressInfo, type Server as NetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { afterAll, afterEach, beforeAll, vi } from "vitest";
import type { AccountRef, CheckResult, DiscoveredPage, Scenario } from "../../src/core/types.js";
import type { SessionState } from "../../src/engine/auth.js";
import { createCheckContext, type RunningCheckContext } from "../../src/engine/context.js";
import { discoverPage, emptyForm } from "../../src/engine/discover.js";
import { check } from "../../src/checks/paywall-trust.js";
import { startFixtureServer, type FixtureServer, type RecordedRequest, type RouteHandler } from "./server.js";

const A: AccountRef = { id: "a", label: "Account A" };
/** Account A's username (the account marker): never printed. */
export const ALEX = "alex@example.test";
const SESSION = "a-session-7d1f";
export const SELF: SessionState = {
  cookies: [{ name: "sid", value: SESSION, domain: "127.0.0.1", path: "/", expires: -1, httpOnly: true, secure: false, sameSite: "Lax" }],
  origins: [],
};
const PROVIDER_PATTERNS = ["*.stripe.com", "*.paypal.com", "*.paddle.com", "*.lemonsqueezy.com"];

export let browser: Browser;
let sink: NetServer;
/** One entry per connection that reached the stand-in payment provider. */
export const sinkHits: string[] = [];
const servers: FixtureServer[] = [];
const contexts: RunningCheckContext[] = [];
const dirs: string[] = [];
let tmpPrefix = "rh-paywall-";

/**
 * Wires up the beforeAll/afterEach/afterAll every paywall-trust split file had verbatim. `tmpPrefix` is the family's
 * original mkdtemp prefix (e.g. "rh-paywall-shapes-"); `restoreMocks` reproduces the quiet family's afterEach, which
 * called vi.restoreAllMocks() before the usual teardown.
 */
export function usePaywallHarness(o: { tmpPrefix: string; restoreMocks?: boolean }): void {
  tmpPrefix = o.tmpPrefix;
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
    if (o.restoreMocks) vi.restoreAllMocks();
    await Promise.all(contexts.splice(0).map((c) => c.dispose()));
    await Promise.all(servers.splice(0).map((s) => s.close()));
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });
  afterAll(async () => {
    await browser?.close();
    await new Promise<void>((resolve) => sink.close(() => resolve()));
  });
}

export const send = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
export const signedIn = (req: RecordedRequest) => new RegExp(`(?:^|;\\s*)sid=${SESSION}\\b`).test(req.headers.cookie ?? "");
export const pathOf = (r: RecordedRequest) => new URL(r.url, "http://x").pathname;
export const posts = (server: FixtureServer, path: string) => server.requests.filter((r) => r.method === "POST" && pathOf(r) === path);
export const loads = (server: FixtureServer, path: string) => server.requests.filter((r) => r.method === "GET" && pathOf(r) === path);

/** A page with the app's nav (Dashboard, Billing). With `head` empty this is exactly quiet's original page(). */
export function page(title: string, body: string, script = "", head = ""): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>${head}</head><body>
<header><nav aria-label="Main"><a href="/app">Dashboard</a> <a href="/app/billing">Billing</a></nav></header>
<main><h1>${title}</h1>${body}</main>
<script>${script}</script></body></html>`;
}

export const notFound = (res: ServerResponse) => {
  res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><html lang="en"><head><title>Not found</title></head><body><main><h1>Page not found</h1></main></body></html>`);
};

export async function app(o: { pages: Record<string, string>; routes: Record<string, RouteHandler>; fallback?: RouteHandler }): Promise<FixtureServer> {
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

export async function discover(url: string): Promise<DiscoveredPage> {
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
export async function runOn(server: FixtureServer, path = "/app"): Promise<CheckResult> {
  const targetUrl = `${server.url}${path}`;
  const discovered = await discover(targetUrl);
  const planned = check.plan(discovered.forms[0] ?? emptyForm(discovered.url), discovered, { signedIn: true, otherAccount: false });
  const scenario: Scenario = { ...planned[0]!, scope: "page", scopeLabel: "Whole page" };
  // Let whatever discovery started finish before counting.
  await new Promise((r) => setTimeout(r, 1000));
  server.requests.length = 0;
  sinkHits.length = 0;
  const dir = await mkdtemp(join(tmpdir(), tmpPrefix));
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

export const confirmed = (r: CheckResult) => r.findings.filter((f) => f.confidence === "confirmed");

export const SUCCESS_LINK = `<a href="/app/upgraded">Already paid? Refresh your plan</a>`;
export const WHO = { id: "u_alex", email: ALEX, name: "Alex Rivera" };
export const SHOW = `fetch('/api/me').then(r => r.json()).then(m => { document.getElementById('plan').textContent = JSON.stringify(m.plan); });`;
export const DASHBOARD = page("Dashboard", `<p id="plan">Loading…</p>${SUCCESS_LINK}`, SHOW);
export const BILLING = page(
  "Billing",
  `<p id="plan">Loading…</p><button type="button" id="cancel">Cancel plan</button>`,
  `${SHOW}
document.getElementById('cancel').addEventListener('click', () => fetch('/api/billing/cancel', { method: 'POST' }));`,
);
export const CONFIRM_ON_LOAD = page("Your upgrade", `<p>Confirming…</p>`, `fetch('/api/billing/confirm', { method: 'POST' });`);
/** A settings page whose tabs run `scripts` (by tab id) when chosen. */
export const settings = (tabs: { id: string; name: string }[], scripts: string) =>
  page(
    "Settings",
    `<p id="plan">Loading…</p>
<div role="tablist" aria-label="Settings"><button type="button" role="tab" id="t-profile" aria-selected="true">Profile</button>
${tabs.map((t) => `<button type="button" role="tab" id="${t.id}" aria-selected="false">${t.name}</button>`).join("\n")}</div>`,
    `${SHOW}
${scripts}`,
  );
export const me = (state: { plan: string }) => (req: RecordedRequest, res: ServerResponse) => (signedIn(req) ? send(res, 200, { ...WHO, plan: state.plan }) : send(res, 401, {}));
