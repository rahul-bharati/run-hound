/**
 * paywall-trust (0.6.0, docs/v2-spec.md "`paywall-trust`" and "`paywall-trust` amendments"): can Account A get a paid
 * plan without paying? The 0.6.0 probe opens the app's own success, upgraded and thank-you routes as Account A and
 * re-reads Account A's entitlement after each; a change is a confirmed critical finding, which the check then undoes
 * through the app's own cancel or downgrade control and re-reads.
 *
 * Driven through createCheckContext against a small SaaS fixture built in this file. GET /api/me holds Account A's plan
 * (and GET /api/team, loaded first, other users' plans: never A's). /app is the page under test; /app/billing shows the
 * plan and, on Pro, the way back to Free; success pages send POST /api/billing/confirm on load, which grants Pro only
 * when the app is buggy (Fernway's V09). Options pick the success routes, where they are linked, the cancel control,
 * and the payment-provider scripts a success page loads.
 *
 * Traps on every run (expectSafe fails a run that springs one): every page's nav links to "Sign out" (/logout, which
 * ends A's session) and "Delete account"; the dashboard, the Billing page and the Billing tab show "Cancel invite" and
 * "Delete account" buttons before the plan's own control, and the dialog offers "Keep my plan" beside the confirm.
 *
 * Payment providers: the browser is launched with host-resolver rules that send every Stripe, PayPal, Paddle and Lemon
 * Squeezy host to a local TCP sink, so a request that reaches "the provider" is a connection the sink counts (a
 * sanity test proves an unblocked request does reach it). The check must never let one through. The safety gate gets
 * a DNS lookup that always fails, so no test depends on the machine's resolver: provider hosts are refused offline.
 */

import { mkdtemp, rm } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { createServer as createNetServer, type Server as NetServer } from "node:net";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, expect } from "vitest";
import { startFixtureServer, type FixtureServer, type RecordedRequest } from "./server.js";
import type { AccountRef, CheckResult, DiscoveredPage, Finding, Scenario } from "../src/core/types.js";
import type { SessionState } from "../src/engine/auth.js";
import { createCheckContext, type RunningCheckContext } from "../src/engine/context.js";
import { discoverPage, emptyForm } from "../src/engine/discover.js";

export { emptyForm };
import { check } from "../src/checks/paywall-trust.js";

export { check };
export type { DiscoveredPage };

export const A: AccountRef = { id: "a", label: "Account A" };
export const RUN_TOKEN = "pw7e57a1";
/** Account A's username (the account marker the runner passes): never printed. */
export const ALEX = "alex@example.test";
export const SAM = "sam@example.test";
/** Account A's session cookie value: never printed. */
export const SESSION = "a-session-7d1f";
export const SELF: SessionState = {
  cookies: [{ name: "sid", value: SESSION, domain: "127.0.0.1", path: "/", expires: -1, httpOnly: true, secure: false, sameSite: "Lax" }],
  origins: [],
};

/** Host patterns of the payment providers the sink stands in for. */
export const PROVIDER_PATTERNS = [
  "*.stripe.com",
  "*.paypal.com",
  "*.paddle.com",
  "*.lemonsqueezy.com",
  // A checkout host the check's list doesn't name (a regional or less common provider).
  "*.gateway.test",
];
/** The contract's conventional success paths, tried after the links. */
export const CONVENTIONAL = ["/upgraded", "/app/upgraded", "/success", "/checkout/success", "/billing/success", "/payment/success", "/thank-you", "/thanks", "/app/billing/success"];

export let browser: Browser;
export let sink: NetServer;
export let sinkPort = 0;
/** One entry per connection that reached the stand-in payment provider. */
export const sinkHits: string[] = [];
export const servers: FixtureServer[] = [];
export const contexts: RunningCheckContext[] = [];
export const dirs: string[] = [];

export const resolverRules = (port: number) => `--host-resolver-rules=${PROVIDER_PATTERNS.map((p) => `MAP ${p} 127.0.0.1:${port}`).join(", ")}`;

export function usePaywallApp(): void {
  beforeAll(async () => {
    sink = createNetServer((socket) => {
      sinkHits.push(`connection from ${socket.remoteAddress ?? "?"}`);
      socket.destroy();
    });
    await new Promise<void>((resolve) => sink.listen(0, "127.0.0.1", resolve));
    sinkPort = (sink.address() as AddressInfo).port;
    browser = await chromium.launch({ args: [resolverRules(sinkPort)] });
  });
  beforeEach(() => {
    sinkHits.length = 0;
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
}


export type Link = { href: string; text: string };

/**
 * How Account A goes back to Free on Pro:
 * - "button": "Cancel plan" on /app/billing (POST /api/billing/cancel);
 * - "native-confirm": "Downgrade to Free" on /app/billing, behind the browser's confirm() dialog;
 * - "dialog-on-page": "Cancel plan" on the page under test (/app), behind an in-page dialog ("Keep my plan" or
 *   "Yes, switch to Free");
 * - "ignored": "Cancel plan" on /app/billing, but the server answers 200 and keeps Pro;
 * - "billing-tab": /app is a Settings page whose Billing tab (hidden until chosen, as Fernway's) holds the plan, the
 *   links and "Cancel plan";
 * - "settings-tab": /app is the dashboard; /app/settings (a page it links to) has the same hidden Billing tab, holding
 *   the plan, the billingLinks and "Cancel plan" (/app/billing then only says "Manage your plan in Settings.");
 * - "provider-portal": "Cancel subscription" on /app/billing links to the payment provider's customer portal;
 * - "provider-confirm": "Cancel plan" on /app/billing opens the app's dialog, whose "Yes, cancel plan" posts a form
 *   straight to the payment provider (billing.stripe.com);
 * - "redirect-confirm": the same dialog, whose "Yes, cancel plan" posts a form to the app's POST /api/billing/cancel,
 *   which answers 303 to the payment provider's cancel page (a Stripe portal cancel flow) and leaves the plan on Pro;
 * - "among-teammates": /app/billing lists people on the account first, each with a "Downgrade" of their own (a table
 *   of two, a one-row list, a row with an e-mail address) and an "Extra storage" add-on with its own "Downgrade", then
 *   Account A's own plan under "Your plan" with a bare "Downgrade" (POST /api/billing/cancel). Every other "Downgrade"
 *   posts to /api/team/<id>/downgrade or /api/addons/storage/downgrade;
 * - "among-add-ons": /app/billing lists two add-ons first, each with "Cancel subscription" (POST
 *   /api/addons/<id>/cancel), then Account A's own plan under "Your plan" with "Cancel subscription" (POST
 *   /api/billing/cancel);
 * - "team-cards": /app/billing shows two teammates as cards (no list or table) right under the page's heading, each with
 *   a "Downgrade" of its own, then Account A's own plan under "Your plan" with "Downgrade" (POST /api/billing/cancel);
 * - "team-cards-pro-plan": the same cards, but Account A's "Downgrade" sits under "Pro plan" (a billing heading that
 *   doesn't say it is Account A's own): no "Downgrade" on the page can be told apart from the others;
 * - "team-card-free": one teammate's card right under the page's heading with "Downgrade to Free", then Account A's own
 *   plan under "Your plan" with "Cancel plan";
 * - "team-row-free": one teammate in a one-row list right under the page's heading with "Downgrade to Free", then
 *   Account A's own "Cancel plan" under no heading of its own (not in a list either);
 * - "addon-row-membership": under "Subscriptions", a lone add-on in a one-item list with "Cancel subscription", then
 *   Account A's own plan under "Your plan" with "Cancel membership";
 * - "addon-row-only": no control of Account A's plan ("contact support"), only a lone add-on in a one-item list with
 *   "Cancel subscription";
 * - "opens-window": "Cancel plan" on /app/billing, whose click also opens a new window at /billing/return;
 * - "redirect-portal-confirm": the "redirect-confirm" dialog, but POST /api/billing/cancel answers 303 to the app's own
 *   /billing/portal (a billing portal start: pass it in providerRedirects) and leaves the plan on Pro;
 * - "portal-fetch": "Cancel subscription" on /app/billing, whose script creates a billing portal session (POST
 *   /api/billing/portal-session, as Stripe's customer portal is opened) and sends the browser to the URL it answers;
 * - "team-card-bare": one teammate's card right under the page's heading with a bare "Downgrade", then Account A's own
 *   "Cancel plan" under no heading of its own (neither in a list nor under "Your plan");
 * - "portal-link": "Cancel plan" is a link to the app's own /billing/portal;
 * - "portal-script": a "Cancel plan" button whose script sends the browser to the app's own /billing/portal;
 * - "portal-confirm": the "redirect-confirm" dialog, whose "Yes, cancel plan" posts its form to /billing/portal;
 * - "stripe-path-form": "Cancel plan" submits a form to /api/stripe/cancel-subscription (a path that names the payment
 *   provider);
 * - "timer-portal": "Cancel plan" on /app/billing puts Account A back on Free, then, 1.5 s after the cancel answered,
 *   sends the browser to the app's own /billing/portal ("Taking you to the billing portal…");
 * - "redirect-unlisted": the "redirect-confirm" dialog, but POST /api/billing/cancel answers 303 to
 *   https://pay.gateway.test/cancel (a checkout host the check's list doesn't name) and leaves the plan on Pro;
 * - "team-card-sub": one teammate's card right under the page's heading with a bare "Downgrade", then Account A's own
 *   "Cancel subscription" under no heading of its own: nothing on the page says which of the two is Account A's plan;
 * - "overview-tab": /app/billing has tabs of its own: "Overview" (shown) holds Account A's bare "Downgrade" (POST
 *   /api/billing/cancel), and "Payments" (a Billing tab, hidden until chosen) shows only the card on file;
 * - "none": no control ("contact support").
 */
export type CancelControl =
  | "button"
  | "native-confirm"
  | "dialog-on-page"
  | "billing-tab"
  | "settings-tab"
  | "ignored"
  | "provider-portal"
  | "provider-confirm"
  | "redirect-confirm"
  | "among-teammates"
  | "among-add-ons"
  | "team-cards"
  | "team-cards-pro-plan"
  | "team-card-free"
  | "team-row-free"
  | "addon-row-membership"
  | "addon-row-only"
  | "opens-window"
  | "redirect-portal-confirm"
  | "portal-fetch"
  | "team-card-bare"
  | "portal-link"
  | "portal-script"
  | "portal-confirm"
  | "stripe-path-form"
  | "timer-portal"
  | "redirect-unlisted"
  | "team-card-sub"
  | "overview-tab"
  | "none";

export interface SuccessPage {
  /** False: the page only says "Thanks for visiting" and sends no confirm (it answers, but can't grant). Default true. */
  confirms?: boolean;
  /** What the page says once the confirm answers, whatever it answered (page text alone). Default: from the answer. */
  says?: string;
  /** HTML added to the page (provider scripts, a card form). */
  extra?: string;
  /** Script run after the confirm answered. */
  after?: string;
}

export interface BillingAppOptions {
  /** The plan Account A starts on (default "free"). */
  startPlan?: "free" | "pro";
  /** POST /api/billing/confirm grants Pro to whoever loads a success page (Fernway's V09). Default false (clean). */
  grants?: boolean;
  /** Success pages the app serves, by path; each sends POST /api/billing/confirm on load. */
  successPages?: Record<string, SuccessPage>;
  /** Extra links on the page under test (/app). */
  links?: Link[];
  /** Extra links on /app/billing. */
  billingLinks?: Link[];
  /** Paths that redirect to /login?next=… (a route behind a sign-in the session doesn't satisfy). */
  signInPaths?: string[];
  /**
   * "sign-in": a single-page app's fallback. Any other GET outside /api answers 200 with a page whose script sends the
   * browser to /login?next=… (the redirect to sign-in happens in the page, not in the HTTP answer). "shell": any other
   * GET outside /api answers 200 with the page under test's own page (a single-page app's catch-all that keeps the URL).
   */
  spaFallback?: "sign-in" | "shell";
  /** Pages that are not success routes and act on load (POST /api/onboarding/complete), by path. */
  onboardingPages?: string[];
  /** GET /api/me holds A's plan and role (default true); false = only who A is. */
  entitlement?: boolean;
  /**
   * The page under test (/app) reads A's plan itself (GET /api/me after /api/team; default true). False: it loads only
   * the team and says "Your plan is on the Billing page"; GET /api/me and /app/billing (which reads it) stay as they are.
   */
  pageReadsPlan?: boolean;
  cancel?: CancelControl;
  /** Once a success page has sent its confirm, GET /api/me answers 500 (the re-read as A fails). */
  failReadAfterConfirm?: boolean;
  /** Once the cancel was received, GET /api/me answers 500 (the re-read that confirms the restore fails). */
  failReadAfterCancel?: boolean;
  /** GET /api/me also holds A's credits (from 0), and the confirm adds 500 of them (a grant that leaves the plan alone). */
  grantsCredits?: boolean;
  /** GET /api/me also holds A's credits, starting at this many (with grantsCredits, the default is 0). */
  credits?: number;
  /** GET /api/me also holds A's credits (from 0), and only the first confirm adds 500 of them (a one-time bonus). */
  grantsCreditsOnce?: boolean;
  /**
   * Every success page also spends one of A's credits as it loads (POST /api/summary, an "AI summary" of the page),
   * whatever the confirm answers: a clean app's own spending, never a grant.
   */
  successSpends?: boolean;
  /** The plan POST /api/billing/confirm moves A to in a clean app (a free trial started on the success page). */
  confirmPlan?: string;
  /** The page under test adds one of A's credits each time it loads (POST /api/daily-bonus): the app's own bonus. */
  shellBonus?: boolean;
  /**
   * A's credits go up by one every this many ms on their own (a free tier's timed refill), counted from Run Hound's
   * second read of A's plan: after its two baseline reads, so the refill is slower than the gap between them and they
   * can't see it. Nothing a page does changes it.
   */
  refillEveryMs?: number;
  /**
   * Tabs on the page under test (the dashboard; not with cancel "billing-tab"), after a selected "Overview" tab: each is
   * a button (role="tab", not a link) whose click sends the browser to `to`, as an app whose "Billing" tab opens the
   * billing portal does. A `to` of "fetch:<path>" POSTs to that path of the app first (creating a billing portal
   * session) and sends the browser to the `url` it answers with; one of "script:<js>" runs that script instead.
   */
  navTabs?: { name: string; to: string }[];
  /**
   * With cancel "billing-tab": HTML added to the Settings page under test after its Teammates section, outside the tabs
   * (shown whichever tab is chosen). A `data-down` button in it POSTs to that path when clicked.
   */
  extraDashboard?: string;
  /** With cancel "billing-tab" or "settings-tab": the name of Account A's own control in the Billing tab (default "Cancel plan"). */
  tabCancel?: string;
  /**
   * Same-origin paths whose GET answers 303 to the payment provider's checkout (https://checkout.stripe.com/…): a
   * checkout or billing portal start, or a success route that itself sends the browser to the provider.
   */
  providerRedirects?: string[];
  /** Same-origin paths whose GET answers 302 to another path of the app (from → to). */
  redirects?: Record<string, string>;
  /** Script run on /app/billing after its own (a payment provider's script polling in the background). */
  billingScript?: string;
}

export type BillingApp = FixtureServer & { state: { plan: string; credits: number; confirms: number; cancels: number; signedOut: boolean } };

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
export const anchors = (links: Link[]) => links.map((l) => `<a href="${esc(l.href)}">${esc(l.text)}</a>`).join("\n");

/** Every page's nav: the app's pages, and two links that act when opened (never followed by a check). */
export function shell(title: string, nav: string, body: string, script: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body>
<header><nav aria-label="Main"><a href="/app">Dashboard</a> <a href="/app/billing">Billing</a>
<a href="/logout">Sign out</a> <a href="/account/delete">Delete account</a>
${nav}</nav></header>
<main><h1>${title}</h1>${body}</main>
<script>${script}</script></body></html>`;
}

/**
 * Controls named "cancel" or "delete" that are not the plan's: shown before the plan's own control wherever it is.
 * Clicking one sends an invitation or account-deletion write, which expectSafe fails.
 */
export const DECOYS = `<section aria-label="Invitations"><h2>Invitations</h2><p>${SAM}</p><button type="button" id="cancel-invite">Cancel invite</button></section>
<button type="button" id="delete-account">Delete account</button>`;

/** Shared page script: load A's account and show the plan; `pro-only` / `free-only` blocks follow it. */
export const SHOW_PLAN = `
var $ = function (id) { return document.getElementById(id); };
function me() { return fetch('/api/me').then(function (r) { return r.json(); }); }
function show(m) {
  $('plan').textContent = m.plan === 'pro' ? 'Pro plan' : 'Free plan';
  if ($('pro-only')) $('pro-only').hidden = m.plan !== 'pro';
  if ($('free-only')) $('free-only').hidden = m.plan === 'pro';
}
function cancelPlan() { return fetch('/api/billing/cancel', { method: 'POST' }).then(me).then(show); }
function startCheckout() {
  fetch('/api/billing/checkout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ plan: 'pro' }) })
    .then(function () { location.href = 'https://checkout.stripe.com/c/pay/cs_test_fixture'; });
}
if ($('cancel-invite')) $('cancel-invite').addEventListener('click', function () { fetch('/api/invites/inv_1/cancel', { method: 'POST' }); });
if ($('delete-account')) $('delete-account').addEventListener('click', function () { fetch('/api/account/delete', { method: 'POST' }); });`;

/**
 * A Settings page's tabs, as on Fernway's: Profile is shown; the Billing tab (hidden until chosen) holds the plan,
 * `links`, the decoys and, on Pro, "Cancel plan" (or `cancelName`). BILLING_TABS_SCRIPT (after SHOW_PLAN) makes the tabs
 * and the cancel work.
 */
export function billingTabs(links: Link[], cancelName = "Cancel plan"): string {
  return `<div role="tablist" aria-label="Settings"><button type="button" role="tab" id="tab-profile" aria-selected="true" aria-controls="panel-profile">Profile</button>
<button type="button" role="tab" id="tab-billing" aria-selected="false" aria-controls="panel-billing">Billing</button></div>
<div role="tabpanel" id="panel-profile" aria-labelledby="tab-profile"><p>Alex Rivera, member</p></div>
<div role="tabpanel" id="panel-billing" aria-labelledby="tab-billing" hidden>
<p id="plan" role="status">Loading your plan…</p>
<div id="free-only" hidden><button type="button" id="upgrade">Upgrade to Pro</button></div>
<p>${anchors(links)}</p>
${DECOYS}
<div id="pro-only" hidden><button type="button" id="cancel">${esc(cancelName)}</button></div>
</div>`;
}
export const BILLING_TABS_SCRIPT = `function select(name) {
  ['profile', 'billing'].forEach(function (n) { $('tab-' + n).setAttribute('aria-selected', String(n === name)); $('panel-' + n).hidden = n !== name; });
}
$('tab-profile').addEventListener('click', function () { select('profile'); });
$('tab-billing').addEventListener('click', function () { select('billing'); });
$('cancel').addEventListener('click', cancelPlan);`;

export async function billingApp(o: BillingAppOptions = {}): Promise<BillingApp> {
  const state: BillingApp["state"] = { plan: o.startPlan ?? "free", credits: o.credits ?? 0, confirms: 0, cancels: 0, signedOut: false };
  const holdsCredits = o.grantsCredits === true || o.grantsCreditsOnce === true || o.credits !== undefined;
  /** Run Hound's own reads of GET /api/me so far, and when the timed refill (refillEveryMs) started. */
  let runHoundReads = 0;
  let refillFrom: number | null = null;
  const cancel = o.cancel ?? "button";
  // GET /logout ends the session on the server: every later request with the cookie is signed out.
  const signedIn = (req: RecordedRequest) => !state.signedOut && new RegExp(`(?:^|;\\s*)sid=${SESSION}\\b`).test(req.headers.cookie ?? "");

  const dashboardDialog =
    cancel === "dialog-on-page"
      ? `<div id="pro-only" hidden><button type="button" id="cancel">Cancel plan</button></div>
<div id="confirm" role="dialog" aria-modal="true" aria-labelledby="confirm-title" hidden><h2 id="confirm-title">Cancel your Pro plan?</h2>
<p>You'll go back to Free straight away.</p><button type="button" id="keep">Keep my plan</button> <button type="button" id="yes">Yes, switch to Free</button></div>`
      : "";
  const team = `<section aria-labelledby="team-title"><h2 id="team-title">Teammates</h2><ul id="team"></ul></section>`;
  const tabs = cancel === "billing-tab";
  const navTabs = o.navTabs ?? [];
  const navTabsHtml =
    navTabs.length > 0
      ? `<div role="tablist" aria-label="Sections"><button type="button" role="tab" aria-selected="true">Overview</button>
${navTabs.map((t, i) => `<button type="button" role="tab" aria-selected="false" id="nav-tab-${i}">${esc(t.name)}</button>`).join("\n")}</div>`
      : "";
  const navTabsScript = navTabs
    .map((t, i) => {
      const go = t.to.startsWith("fetch:")
        ? `fetch(${JSON.stringify(t.to.slice("fetch:".length))}, { method: 'POST' }).then(function (r) { return r.json(); }).then(function (d) { location.href = d.url; });`
        : t.to.startsWith("script:")
          ? t.to.slice("script:".length)
          : `location.href = ${JSON.stringify(t.to)};`;
      return `$('nav-tab-${i}').addEventListener('click', function () { ${go} });`;
    })
    .join("\n");
  const dashboard = shell(
    tabs ? "Settings" : "Dashboard",
    tabs ? "" : anchors(o.links ?? []),
    tabs
      ? `${billingTabs(o.links ?? [], o.tabCancel)}
${team}${o.extraDashboard ?? ""}`
      : `${navTabsHtml}
<p id="plan" role="status">Loading your plan…</p>
<button type="button" id="upgrade">Upgrade to Pro</button>
${DECOYS}
${dashboardDialog}
${team}`,
    `${SHOW_PLAN}
fetch('/api/team').then(function (r) { return r.json(); })
  .then(function (team) { $('team').innerHTML = team.map(function (t) { return '<li>' + t.name + ' (' + t.role + ')</li>'; }).join(''); })
  ${o.pageReadsPlan === false ? `.then(function () { $('plan').textContent = 'Your plan is on the Billing page'; });` : `.then(me).then(show);`}
$('upgrade').addEventListener('click', startCheckout);
${o.shellBonus ? "fetch('/api/daily-bonus', { method: 'POST' });" : ""}
${
  cancel === "dialog-on-page"
    ? `$('cancel').addEventListener('click', function () { $('confirm').hidden = false; $('yes').focus(); });
$('keep').addEventListener('click', function () { $('confirm').hidden = true; });
$('yes').addEventListener('click', function () { cancelPlan().then(function () { $('confirm').hidden = true; }); });`
    : tabs
      ? BILLING_TABS_SCRIPT
      : ""
}
${tabs ? "" : navTabsScript}
document.querySelectorAll('[data-down]').forEach(function (b) { b.addEventListener('click', function () { fetch(b.getAttribute('data-down'), { method: 'POST' }); }); });`,
  );
  // "settings-tab": the page under test links to a Settings page whose hidden Billing tab holds the plan's control.
  const settings = shell(
    "Settings",
    "",
    billingTabs(o.billingLinks ?? [], o.tabCancel),
    `${SHOW_PLAN}
me().then(show);
$('upgrade').addEventListener('click', startCheckout);
${BILLING_TABS_SCRIPT}`,
  );

  /** The app's own confirmation for "Cancel plan", whose "Yes, cancel plan" posts a form to `action`. */
  const confirmPostingTo = (action: string) => `<button type="button" id="cancel">Cancel plan</button>
<div id="confirm" role="dialog" aria-modal="true" aria-labelledby="confirm-title" hidden><h2 id="confirm-title">Cancel your Pro plan?</h2>
<p>You'll go back to Free at the end of the billing period.</p><button type="button" id="keep">Keep my plan</button>
<form method="post" action="${esc(action)}"><button type="submit" id="yes">Yes, cancel plan</button></form></div>`;
  const cancelHtml: Record<CancelControl, string> = {
    button: `<button type="button" id="cancel">Cancel plan</button>`,
    ignored: `<button type="button" id="cancel">Cancel plan</button>`,
    "native-confirm": `<button type="button" id="cancel">Downgrade to Free</button>`,
    "provider-portal": `<a id="portal" href="https://billing.stripe.com/p/session/test_fixture">Cancel subscription</a>`,
    "provider-confirm": confirmPostingTo("https://billing.stripe.com/p/session/test_fixture/cancel"),
    "redirect-confirm": confirmPostingTo("/api/billing/cancel"),
    // Every "Downgrade" before "Your plan" is someone else's or an add-on's; none sits under a heading about billing.
    "among-teammates": `<table><tbody>
<tr><td>Jo Park</td><td>Pro</td><td><button type="button" data-down="/api/team/u_jo/downgrade">Downgrade</button></td></tr>
<tr><td>Kim Ito</td><td>Pro</td><td><button type="button" data-down="/api/team/u_kim/downgrade">Downgrade</button></td></tr>
</tbody></table>
<ul><li>Riley Chen · Pro <button type="button" data-down="/api/team/u_riley/downgrade">Downgrade</button></li></ul>
<ul><li>Sam Lee (${SAM}) · Pro <button type="button" data-down="/api/team/u_sam/downgrade">Downgrade</button></li></ul>
<section aria-labelledby="storage-title"><h2 id="storage-title">Extra storage</h2><p>200 GB, $4 a month</p><button type="button" data-down="/api/addons/storage/downgrade">Downgrade</button></section>
<section aria-labelledby="your-plan-title"><h2 id="your-plan-title">Your plan</h2><p>Pro, $12 a month</p><button type="button" id="cancel">Downgrade</button></section>`,
    // Each add-on is a subscription of its own, cancelled from its own row; the plan's control has the same name.
    "among-add-ons": `<ul>
<li>Extra storage · $4 a month <button type="button" data-down="/api/addons/storage/cancel">Cancel subscription</button></li>
<li>Priority support · $6 a month <button type="button" data-down="/api/addons/support/cancel">Cancel subscription</button></li>
</ul>
<section aria-labelledby="your-plan-title"><h2 id="your-plan-title">Your plan</h2><p>Pro, $12 a month</p><button type="button" id="cancel">Cancel subscription</button></section>`,
    // Teammates as cards, right under the page's own heading: no list item, table row or sub-section of their own.
    "team-cards": `<div class="seats"><div class="seat"><span>Jo Park</span> · <span>Pro</span> <button type="button" data-down="/api/team/u_jo/downgrade">Downgrade</button></div>
<div class="seat"><span>Kim Ito</span> · <span>Pro</span> <button type="button" data-down="/api/team/u_kim/downgrade">Downgrade</button></div></div>
<section aria-labelledby="your-plan-title"><h2 id="your-plan-title">Your plan</h2><p>Pro, $12 a month</p><button type="button" id="cancel">Downgrade</button></section>`,
    "team-cards-pro-plan": `<div class="seats"><div class="seat"><span>Jo Park</span> · <span>Pro</span> <button type="button" data-down="/api/team/u_jo/downgrade">Downgrade</button></div>
<div class="seat"><span>Kim Ito</span> · <span>Pro</span> <button type="button" data-down="/api/team/u_kim/downgrade">Downgrade</button></div></div>
<section aria-labelledby="pro-plan-title"><h2 id="pro-plan-title">Pro plan</h2><p>$12 a month</p><button type="button" id="cancel">Downgrade</button></section>`,
    "team-card-free": `<div class="seat"><span>Jo Park</span> · <span>Pro</span> <button type="button" data-down="/api/team/u_jo/downgrade">Downgrade to Free</button></div>
<section aria-labelledby="your-plan-title"><h2 id="your-plan-title">Your plan</h2><p>Pro, $12 a month</p><button type="button" id="cancel">Cancel plan</button></section>`,
    "team-row-free": `<ul><li>Jo Park · Pro <button type="button" data-down="/api/team/u_jo/downgrade">Downgrade to Free</button></li></ul>
<p>You're on Pro, $12 a month.</p><button type="button" id="cancel">Cancel plan</button>`,
    "addon-row-membership": `<section aria-labelledby="subs-title"><h2 id="subs-title">Subscriptions</h2>
<ul><li>Extra storage add-on · $4 a month <button type="button" data-down="/api/addons/storage/cancel">Cancel subscription</button></li></ul>
<section aria-labelledby="your-plan-title"><h3 id="your-plan-title">Your plan</h3><p>Pro membership, $12 a month</p><button type="button" id="cancel">Cancel membership</button></section></section>`,
    "addon-row-only": `<p>To change your plan, contact support.</p>
<ul><li>Extra storage add-on · $4 a month <button type="button" data-down="/api/addons/storage/cancel">Cancel subscription</button></li></ul>`,
    "opens-window": `<button type="button" id="cancel">Cancel plan</button>`,
    "redirect-portal-confirm": confirmPostingTo("/api/billing/cancel"),
    "portal-fetch": `<button type="button" id="cancel">Cancel subscription</button>`,
    // A teammate's card (no list, no table, no heading of its own) with a bare "Downgrade", before A's own "Cancel plan".
    "team-card-bare": `<div class="seat"><span>Jo Park</span> · <span>Pro</span> <button type="button" data-down="/api/team/u_jo/downgrade">Downgrade</button></div>
<p>You're on Pro, $12 a month.</p><button type="button" id="cancel">Cancel plan</button>`,
    "portal-link": `<a id="cancel" href="/billing/portal">Cancel plan</a>`,
    "portal-script": `<button type="button" id="cancel">Cancel plan</button>`,
    "portal-confirm": confirmPostingTo("/billing/portal"),
    "stripe-path-form": `<form method="post" action="/api/stripe/cancel-subscription"><button type="submit" id="cancel">Cancel plan</button></form>`,
    "timer-portal": `<p id="after-cancel"></p><button type="button" id="cancel">Cancel plan</button>`,
    "redirect-unlisted": confirmPostingTo("/api/billing/cancel"),
    // A teammate's card (no list, no table, no heading of its own) with a bare "Downgrade", before A's own "Cancel
    // subscription": neither names the plan or a free tier, and nothing says which is Account A's.
    "team-card-sub": `<div class="seat"><span>Jo Park</span> · <span>Pro</span> <button type="button" data-down="/api/team/u_jo/downgrade">Downgrade</button></div>
<p>You're on Pro, $12 a month.</p><button type="button" id="cancel">Cancel subscription</button>`,
    "overview-tab": `<div role="tablist" aria-label="Billing sections"><button type="button" role="tab" id="tab-overview" aria-selected="true">Overview</button>
<button type="button" role="tab" id="tab-payments" aria-selected="false">Payments</button></div>
<div role="tabpanel" id="panel-overview"><p>Pro, $12 a month.</p><button type="button" id="cancel">Downgrade</button></div>
<div role="tabpanel" id="panel-payments" hidden><p>Visa ending in 4242.</p></div>`,
    "dialog-on-page": `<p>Manage your plan from the dashboard.</p>`,
    "billing-tab": `<p>Manage your plan in Settings.</p>`,
    "settings-tab": `<p>Manage your plan in Settings.</p>`,
    none: `<p>To change your plan, contact support.</p>`,
  };
  const billing = shell(
    "Billing",
    "",
    `<p id="plan" role="status">Loading your plan…</p>
<div id="free-only" hidden><button type="button" id="upgrade">Upgrade to Pro</button></div>
${DECOYS}
<div id="pro-only" hidden>${cancelHtml[cancel]}</div>
<p>${cancel === "settings-tab" ? "" : anchors(o.billingLinks ?? [])}</p>`,
    `${SHOW_PLAN}
me().then(show);
$('upgrade').addEventListener('click', startCheckout);
${
  cancel === "button" ||
  cancel === "ignored" ||
  cancel === "among-teammates" ||
  cancel === "among-add-ons" ||
  cancel === "team-cards" ||
  cancel === "team-cards-pro-plan" ||
  cancel === "team-card-free" ||
  cancel === "team-row-free" ||
  cancel === "addon-row-membership" ||
  cancel === "team-card-bare" ||
  cancel === "team-card-sub"
    ? `$('cancel').addEventListener('click', cancelPlan);`
    : cancel === "overview-tab"
      ? `function choose(name) {
  ['overview', 'payments'].forEach(function (n) { $('tab-' + n).setAttribute('aria-selected', String(n === name)); $('panel-' + n).hidden = n !== name; });
}
$('tab-overview').addEventListener('click', function () { choose('overview'); });
$('tab-payments').addEventListener('click', function () { choose('payments'); });
$('cancel').addEventListener('click', cancelPlan);`
    : cancel === "opens-window"
      ? `$('cancel').addEventListener('click', function () { cancelPlan(); window.open('/billing/return'); });`
      : cancel === "native-confirm"
        ? `$('cancel').addEventListener('click', function () { if (confirm('Downgrade to Free? You will lose Pro features.')) cancelPlan(); });`
        : cancel === "provider-confirm" ||
            cancel === "redirect-confirm" ||
            cancel === "redirect-portal-confirm" ||
            cancel === "portal-confirm" ||
            cancel === "redirect-unlisted"
          ? `$('cancel').addEventListener('click', function () { $('confirm').hidden = false; $('keep').focus(); });
$('keep').addEventListener('click', function () { $('confirm').hidden = true; });`
          : cancel === "portal-script"
            ? `$('cancel').addEventListener('click', function () { location.href = '/billing/portal'; });`
            : cancel === "portal-fetch"
              ? `$('cancel').addEventListener('click', function () {
  fetch('/api/billing/portal-session', { method: 'POST' }).then(function (r) { return r.json(); }).then(function (d) { location.href = d.url; });
});`
              : cancel === "timer-portal"
                ? `$('cancel').addEventListener('click', function () {
  fetch('/api/billing/cancel', { method: 'POST' }).then(function () {
    $('after-cancel').textContent = 'Taking you to the billing portal…';
    setTimeout(function () { location.href = '/billing/portal'; }, 1500);
    return me().then(show);
  });
});`
                : ""
}
document.querySelectorAll('[data-down]').forEach(function (b) { b.addEventListener('click', function () { fetch(b.getAttribute('data-down'), { method: 'POST' }); }); });
${o.billingScript ?? ""}`,
  );

  const successPage = (p: SuccessPage) =>
    shell(
      "Your upgrade",
      "",
      `<p id="s" role="status">Confirming your upgrade…</p>${p.extra ?? ""}`,
      `${o.successSpends ? "fetch('/api/summary', { method: 'POST' });" : ""}` +
      (p.confirms === false
        ? `document.getElementById('s').textContent = "Thanks for visiting";`
        : `fetch('/api/billing/confirm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ checkout: new URLSearchParams(location.search).get('checkout') }) })
  .then(function (r) { return r.json(); })
  .then(function (d) {
    document.getElementById('s').textContent = ${p.says ? JSON.stringify(p.says) : `d.confirmed ? "You're on Pro. Thanks for upgrading!" : "We couldn't find a payment for this upgrade."`};
    ${p.after ?? ""}
  });`),
    );

  const login = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Sign in</title></head><body><main><h1>Sign in</h1>
<form method="post" action="/login"><label for="e">Email</label><input id="e" type="email" name="email" autocomplete="username">
<label for="p">Password</label><input id="p" type="password" name="password" autocomplete="current-password"><button type="submit">Sign in</button></form></main></body></html>`;

  const deleteAccount = shell(
    "Delete your account",
    "",
    `<p>This deletes your account and everything in it.</p><button type="button" id="really-delete">Delete my account</button>`,
    `document.getElementById('really-delete').addEventListener('click', function () { fetch('/api/account/delete', { method: 'POST' }); });`,
  );
  // A page that is not a success route, and that acts as soon as it loads (it marks onboarding done).
  const onboarding = shell("Welcome", "", `<p>Here's a quick look around.</p>`, `fetch('/api/onboarding/complete', { method: 'POST' });`);
  // A single-page app's shell for a path it has no route for, when that route needs a sign-in the app thinks is missing.
  const spaToSignIn = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>App</title></head><body><div id="root"></div>
<script>location.replace('/login?next=' + encodeURIComponent(location.pathname));</script></body></html>`;

  const pages: Record<string, string> = { "/app": dashboard, "/app/billing": billing, "/login": login, "/account/delete": deleteAccount };
  if (cancel === "settings-tab") pages["/app/settings"] = settings;
  for (const path of o.onboardingPages ?? []) pages[path] = onboarding;
  for (const [path, page] of Object.entries(o.successPages ?? {})) pages[path] = successPage(page);

  const send = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const server = await startFixtureServer({
    pages,
    routes: {
      "GET /api/me": (req, res) => {
        if (!signedIn(req)) return send(res, 401, { error: "Sign in first" });
        if (o.failReadAfterConfirm && state.confirms > 0) return send(res, 500, { error: "Something went wrong" });
        if (o.failReadAfterCancel && state.cancels > 0) return send(res, 500, { error: "Something went wrong" });
        const who = { id: "u_alex", email: ALEX, name: "Alex Rivera", avatar: "portrait-1" };
        if (o.entitlement === false) return send(res, 200, who);
        if (o.refillEveryMs !== undefined && fromRunHound(req) && ++runHoundReads === 2) refillFrom = Date.now();
        const refilled = o.refillEveryMs !== undefined && refillFrom !== null ? Math.floor((Date.now() - refillFrom) / o.refillEveryMs) : 0;
        return send(res, 200, { ...who, plan: state.plan, role: "member", ...(holdsCredits ? { credits: state.credits + refilled } : {}) });
      },
      // Other users only, one of them on Pro: never Account A's entitlement.
      "GET /api/team": (req, res) => {
        if (!signedIn(req)) return send(res, 401, { error: "Sign in first" });
        return send(res, 200, [{ id: "u_sam", email: SAM, name: "Sam Lee", role: "owner", plan: "pro" }]);
      },
      "POST /api/billing/confirm": (req, res) => {
        if (!signedIn(req)) return send(res, 401, { error: "Sign in first" });
        state.confirms += 1;
        if (o.grants) state.plan = "pro";
        else if (o.confirmPlan !== undefined) state.plan = o.confirmPlan;
        if (o.grantsCredits) state.credits += 500;
        if (o.grantsCreditsOnce && state.confirms === 1) state.credits += 500;
        return send(res, 200, { confirmed: Boolean(o.grants), plan: state.plan });
      },
      "POST /api/billing/cancel": (req, res) => {
        if (!signedIn(req)) return send(res, 401, { error: "Sign in first" });
        state.cancels += 1;
        if (cancel === "redirect-portal-confirm") {
          // The app sends the browser on to its own billing portal start, which redirects to the provider.
          res.writeHead(303, { location: "/billing/portal" });
          res.end();
          return;
        }
        if (cancel === "redirect-unlisted") {
          // The app sends the browser on to a checkout host the check's list doesn't name; the plan stays on Pro.
          res.writeHead(303, { location: "https://pay.gateway.test/cancel" });
          res.end();
          return;
        }
        if (cancel === "redirect-confirm") {
          // The cancel happens at the provider (a Stripe portal cancel flow): the plan stays on Pro until it does.
          res.writeHead(303, { location: "https://billing.stripe.com/p/session/test_fixture/flow/subscription_cancel" });
          res.end();
          return;
        }
        if (cancel !== "ignored") state.plan = "free";
        return send(res, 200, { plan: "free" });
      },
      "POST /api/billing/checkout": (req, res) => send(res, signedIn(req) ? 201 : 401, { id: "chk_1", status: "open" }),
      // The app's own spending and bonus (successSpends, shellBonus): writes a page makes as it loads, never a grant.
      "POST /api/summary": (req, res) => {
        if (!signedIn(req)) return send(res, 401, { error: "Sign in first" });
        state.credits -= 1;
        return send(res, 200, { summary: "…" });
      },
      "POST /api/daily-bonus": (req, res) => {
        if (!signedIn(req)) return send(res, 401, { error: "Sign in first" });
        state.credits += 1;
        return send(res, 200, { credits: state.credits });
      },
      "POST /api/typed": (_req, res) => send(res, 204, {}),
      "POST /api/pay": (_req, res) => send(res, 204, {}),
      // Creates a billing portal session (at the payment provider, on a real app): no check may send it.
      "POST /api/billing/portal-session": (req, res) => send(res, signedIn(req) ? 200 : 401, { url: "https://billing.stripe.com/p/session/test_portal" }),
      // Writes no check may send: the decoys' and the side-effect pages' (expectSafe fails any of them).
      "POST /api/invites/inv_1/cancel": (_req, res) => send(res, 204, {}),
      "POST /api/account/delete": (_req, res) => send(res, 204, {}),
      "POST /api/onboarding/complete": (_req, res) => send(res, 204, {}),
      // Sign out: ends Account A's session on the server.
      "GET /logout": (_req, res) => {
        state.signedOut = true;
        res.writeHead(302, { location: "/login" });
        res.end();
      },
      "GET /favicon.ico": (_req, res) => {
        res.writeHead(204);
        res.end();
      },
    },
    fallback: (req, res) => {
      const path = new URL(req.url, "http://x").pathname;
      if (req.method === "GET" && (o.providerRedirects ?? []).includes(path)) {
        res.writeHead(303, { location: "https://checkout.stripe.com/c/pay/cs_test_fixture" });
        res.end();
        return;
      }
      const to = req.method === "GET" ? o.redirects?.[path] : undefined;
      if (to !== undefined) {
        res.writeHead(302, { location: to });
        res.end();
        return;
      }
      // Other people's and add-ons' downgrades and cancels (expectSafe fails any of them).
      if (req.method === "POST" && /^\/api\/(team\/[^/]+\/downgrade|addons\/[^/]+\/(downgrade|cancel))$/.test(path)) {
        res.writeHead(204);
        res.end();
        return;
      }
      if ((o.signInPaths ?? []).includes(path)) {
        res.writeHead(302, { location: `/login?next=${encodeURIComponent(path)}` });
        res.end();
        return;
      }
      if (o.spaFallback === "sign-in" && req.method === "GET" && !path.startsWith("/api/")) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(spaToSignIn);
        return;
      }
      if (o.spaFallback === "shell" && req.method === "GET" && !path.startsWith("/api/") && path !== "/favicon.ico") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(dashboard);
        return;
      }
      res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><html lang="en"><head><title>Not found</title></head><body><main><h1>Page not found</h1></main></body></html>`);
    },
  });
  servers.push(server);
  return Object.assign(server, { state });
}

/** Discovers /app as Account A, the way the planner sees it. */
export async function discover(url: string): Promise<DiscoveredPage> {
  const context = await browser.newContext({ storageState: SELF });
  try {
    const page = await context.newPage();
    await page.goto(url);
    await page.waitForFunction(() => document.getElementById("plan")?.textContent !== "Loading your plan…");
    await page.waitForLoadState("networkidle");
    return await discoverPage(page);
  } finally {
    await context.close();
  }
}

/** The scenario as the check plans it for a signed-in page, with the scope the planner adds. */
export function scenarioFor(page: DiscoveredPage): Scenario {
  const planned = check.plan(page.forms[0] ?? emptyForm(page.url), page, { signedIn: true, otherAccount: false });
  if (planned.length !== 1) throw new Error(`paywall-trust planned ${planned.length} scenarios for a signed-in page (expected 1)`);
  return { ...planned[0]!, scope: "page", scopeLabel: "Whole page" };
}

/** Plans and runs the check on the app's /app as Account A (server.requests hold only what the run sent). */
export async function runOn(server: BillingApp): Promise<CheckResult> {
  const targetUrl = `${server.url}/app`;
  const page = await discover(targetUrl);
  const scenario = scenarioFor(page);
  server.requests.length = 0;
  const dir = await mkdtemp(join(tmpdir(), "rh-paywall-"));
  dirs.push(dir);
  const ctx = createCheckContext({
    browser,
    form: page.forms[0] ?? emptyForm(targetUrl),
    openForm: false,
    discoveredPage: page,
    targetUrl,
    artifactsDir: dir,
    runToken: RUN_TOKEN,
    checkId: "paywall-trust",
    scenarioTitle: scenario.title,
    sessions: { self: SELF },
    accounts: { self: A, other: null },
    markers: [ALEX],
    // No DNS in tests: 127.0.0.1 and localhost never need a lookup, and every provider host is refused without one.
    lookup: async (host: string) => {
      throw new Error(`no DNS in tests (${host})`);
    },
  });
  contexts.push(ctx);
  return check.run(ctx, scenario);
}

export const pathOf = (r: RecordedRequest) => new URL(r.url, "http://x").pathname;
/** Page loads (GETs) of `path`. */
export const loads = (server: FixtureServer, path: string) => server.requests.filter((r) => r.method === "GET" && pathOf(r) === path);
export const posts = (server: FixtureServer, path: string) => server.requests.filter((r) => r.method === "POST" && pathOf(r) === path);
/**
 * Sent by Run Hound itself (CheckContext.request), not by a page in the browser: Playwright's API client names itself in
 * the user agent by default. Were a user agent ever set on it, expectSafe's Run Hound checks would see nothing, but the
 * suite can't go quietly green: every re-read assertion (isReRead, expectReReadAfterEachProbe) would fail first.
 */
export const fromRunHound = (r: RecordedRequest) => /^Playwright\//.test(String(r.headers["user-agent"] ?? ""));
/** Sent by a page in the browser (the app's own fetch), as a click in the app sends it. */
export const fromBrowser = (r: RecordedRequest) => /Chrome\//.test(String(r.headers["user-agent"] ?? "")) && Boolean(r.headers["sec-fetch-mode"]);
/** Where a finding names what it is about. */
export const named = (f: Finding) => [f.title, f.meaning, f.location ?? "", ...(f.locations ?? [])].join("\n");
export const confirmed = (result: CheckResult) => result.findings.filter((f) => f.confidence === "confirmed");

/**
 * The safety contract, for every run: the only writes are the app's own (the success page's confirm and, to restore,
 * the cancel), sent by pages in the browser (so no decoy was clicked, no side-effect page opened, no sign-in form
 * filled); Run Hound itself sends nothing but its re-reads of Account A's entitlement (GET /api/me here: "no request
 * other than these page loads and the re-reads", so no pre-check of a candidate and no guessed endpoint); the sign-out
 * and account-deletion links were never opened (A is still signed in); every request stayed on the target's origin;
 * nothing reached a payment provider; no session value or Account A's username is in the result.
 */
export function expectSafe(server: BillingApp, result: CheckResult, appWrites?: RegExp): void {
  const writes = server.requests.filter((r) => r.method !== "GET" && r.method !== "HEAD");
  for (const w of writes) {
    const sent = `${w.method} ${pathOf(w)}`;
    // `appWrites`: other writes the app's own pages send as they load (successSpends, shellBonus), from the browser too.
    if (!appWrites?.test(sent)) expect(sent).toMatch(/^POST \/api\/billing\/(confirm|cancel)$/);
    expect(fromBrowser(w)).toBe(true);
  }
  expect(loads(server, "/logout")).toEqual([]);
  expect(loads(server, "/account/delete")).toEqual([]);
  expect(server.state.signedOut).toBe(false);
  for (const r of server.requests.filter(fromRunHound)) {
    expect(`${r.method} ${pathOf(r)}`).toBe("GET /api/me");
    // As Account A (its session), never signed out or as anyone else.
    expect(String(r.headers.cookie ?? "")).toContain(`sid=${SESSION}`);
  }
  for (const r of server.requests) expect(String(r.headers.host)).toMatch(/^127\.0\.0\.1:\d+$/);
  expect(sinkHits).toEqual([]);
  const text = JSON.stringify(result);
  expect(text).not.toContain(SESSION);
  expect(text).not.toContain(ALEX);
  for (const f of result.findings) {
    if (!f.spec) continue;
    expect(f.spec.source).not.toContain(SESSION);
    expect(f.spec.source).not.toContain(ALEX);
  }
}

/**
 * The finding a granting success page must produce, naming `route`. "No evidence, no finding": it carries evidence and
 * a replayable spec that signs in from environment variables (expectSafe: with no session value or username in either).
 */
export function expectGrantFinding(result: CheckResult, route: string): Finding {
  expect(result.status).toBe("fail");
  expect(result.findings).toHaveLength(1);
  const f = result.findings[0]!;
  expect(f.checkId).toBe("paywall-trust");
  expect(f.severity).toBe("critical");
  expect(f.confidence).toBe("confirmed");
  expect(f.title).toMatch(/Account A got a paid plan without paying/);
  expect(named(f)).toContain(route);
  expect(f.evidence.length).toBeGreaterThan(0);
  expect(f.spec).toBeDefined();
  expect(f.spec!.filename).toMatch(/\.spec\.ts$/);
  expect(f.spec!.source).toContain("@playwright/test");
  expect(f.spec!.source).toMatch(/RUNHOUND_ACCOUNT_A_PASSWORD/);
  expect(f.spec!.source).not.toMatch(/storageState\s*:\s*["'`]/);
  return f;
}

/** Account A was put back on Free through the app's own control, clicked once in the browser, and nothing is left to check. */
export function expectRestored(server: BillingApp, result: CheckResult, from: string): void {
  expect(server.state.plan).toBe("free");
  const cancels = posts(server, "/api/billing/cancel");
  expect(cancels).toHaveLength(1);
  expect(fromBrowser(cancels[0]!)).toBe(true);
  expect(new URL(String(cancels[0]!.headers.referer)).pathname).toBe(from);
  expect(result.notes ?? "").not.toMatch(/check Account A/);
}

/** A page load in the browser (a navigation), as opening a candidate route sends it. */
export const isNavigation = (r: RecordedRequest) => r.method === "GET" && r.headers["sec-fetch-mode"] === "navigate";
/** Run Hound's own re-read of Account A's entitlement (CheckContext.request, not a page's fetch). */
export const isReRead = (r: RecordedRequest) => r.method === "GET" && pathOf(r) === "/api/me" && fromRunHound(r);

/**
 * "Open each candidate route … then re-read": every candidate in `answering` that was opened before the restore's
 * cancel is followed by a re-read as Account A before the next candidate is opened (or before the cancel). `candidates`
 * are every path the check may open as a candidate here (a 404 or a sign-in redirect needs no re-read).
 */
export function expectReReadAfterEachProbe(server: BillingApp, candidates: string[], answering: string[]): void {
  const cancelAt = server.requests.findIndex((r) => r.method === "POST" && pathOf(r) === "/api/billing/cancel");
  const end = cancelAt === -1 ? server.requests.length : cancelAt;
  const probes = server.requests.flatMap((r, i) => (i < end && isNavigation(r) && candidates.includes(pathOf(r)) ? [i] : []));
  const answered = probes.filter((i) => answering.includes(pathOf(server.requests[i]!)));
  expect(answered.length).toBeGreaterThan(0);
  for (const i of answered) {
    const next = probes.find((j) => j > i) ?? end;
    const reread = server.requests.slice(i + 1, next).some(isReRead);
    expect(reread, `a re-read as Account A after opening ${pathOf(server.requests[i]!)} and before the next candidate`).toBe(true);
  }
}

export const SUCCESS_LINK: Link = { href: "/app/upgraded", text: "Already paid? Refresh your plan" };
