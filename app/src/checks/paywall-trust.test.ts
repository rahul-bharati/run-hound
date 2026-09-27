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
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer, type RecordedRequest } from "../../test-support/server.js";
import type { AccountRef, CheckResult, DiscoveredPage, Finding, Scenario } from "../core/types.js";
import type { SessionState } from "../engine/auth.js";
import { createCheckContext, type RunningCheckContext } from "../engine/context.js";
import { discoverPage, emptyForm } from "../engine/discover.js";
import { check } from "./paywall-trust.js";

const A: AccountRef = { id: "a", label: "Account A" };
const RUN_TOKEN = "pw7e57a1";
/** Account A's username (the account marker the runner passes): never printed. */
const ALEX = "alex@example.test";
const SAM = "sam@example.test";
/** Account A's session cookie value: never printed. */
const SESSION = "a-session-7d1f";
const SELF: SessionState = {
  cookies: [{ name: "sid", value: SESSION, domain: "127.0.0.1", path: "/", expires: -1, httpOnly: true, secure: false, sameSite: "Lax" }],
  origins: [],
};

/** Host patterns of the payment providers the sink stands in for. */
const PROVIDER_PATTERNS = [
  "*.stripe.com",
  "*.paypal.com",
  "*.paddle.com",
  "*.lemonsqueezy.com",
  // A checkout host the check's list doesn't name (a regional or less common provider).
  "*.gateway.test",
];
/** The contract's conventional success paths, tried after the links. */
const CONVENTIONAL = ["/upgraded", "/app/upgraded", "/success", "/checkout/success", "/billing/success", "/payment/success", "/thank-you", "/thanks", "/app/billing/success"];

let browser: Browser;
let sink: NetServer;
let sinkPort = 0;
/** One entry per connection that reached the stand-in payment provider. */
const sinkHits: string[] = [];
const servers: FixtureServer[] = [];
const contexts: RunningCheckContext[] = [];
const dirs: string[] = [];

const resolverRules = (port: number) => `--host-resolver-rules=${PROVIDER_PATTERNS.map((p) => `MAP ${p} 127.0.0.1:${port}`).join(", ")}`;

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

type Link = { href: string; text: string };

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
type CancelControl =
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

interface SuccessPage {
  /** False: the page only says "Thanks for visiting" and sends no confirm (it answers, but can't grant). Default true. */
  confirms?: boolean;
  /** What the page says once the confirm answers, whatever it answered (page text alone). Default: from the answer. */
  says?: string;
  /** HTML added to the page (provider scripts, a card form). */
  extra?: string;
  /** Script run after the confirm answered. */
  after?: string;
}

interface BillingAppOptions {
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

type BillingApp = FixtureServer & { state: { plan: string; credits: number; confirms: number; cancels: number; signedOut: boolean } };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const anchors = (links: Link[]) => links.map((l) => `<a href="${esc(l.href)}">${esc(l.text)}</a>`).join("\n");

/** Every page's nav: the app's pages, and two links that act when opened (never followed by a check). */
function shell(title: string, nav: string, body: string, script: string): string {
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
const DECOYS = `<section aria-label="Invitations"><h2>Invitations</h2><p>${SAM}</p><button type="button" id="cancel-invite">Cancel invite</button></section>
<button type="button" id="delete-account">Delete account</button>`;

/** Shared page script: load A's account and show the plan; `pro-only` / `free-only` blocks follow it. */
const SHOW_PLAN = `
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
function billingTabs(links: Link[], cancelName = "Cancel plan"): string {
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
const BILLING_TABS_SCRIPT = `function select(name) {
  ['profile', 'billing'].forEach(function (n) { $('tab-' + n).setAttribute('aria-selected', String(n === name)); $('panel-' + n).hidden = n !== name; });
}
$('tab-profile').addEventListener('click', function () { select('profile'); });
$('tab-billing').addEventListener('click', function () { select('billing'); });
$('cancel').addEventListener('click', cancelPlan);`;

async function billingApp(o: BillingAppOptions = {}): Promise<BillingApp> {
  const state: BillingApp["state"] = { plan: o.startPlan ?? "free", credits: o.credits ?? 0, confirms: 0, cancels: 0, signedOut: false };
  const holdsCredits = o.grantsCredits === true || o.credits !== undefined;
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
async function discover(url: string): Promise<DiscoveredPage> {
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
function scenarioFor(page: DiscoveredPage): Scenario {
  const planned = check.plan(page.forms[0] ?? emptyForm(page.url), page, { signedIn: true, otherAccount: false });
  if (planned.length !== 1) throw new Error(`paywall-trust planned ${planned.length} scenarios for a signed-in page (expected 1)`);
  return { ...planned[0]!, scope: "page", scopeLabel: "Whole page" };
}

/** Plans and runs the check on the app's /app as Account A (server.requests hold only what the run sent). */
async function runOn(server: BillingApp): Promise<CheckResult> {
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

const pathOf = (r: RecordedRequest) => new URL(r.url, "http://x").pathname;
/** Page loads (GETs) of `path`. */
const loads = (server: FixtureServer, path: string) => server.requests.filter((r) => r.method === "GET" && pathOf(r) === path);
const posts = (server: FixtureServer, path: string) => server.requests.filter((r) => r.method === "POST" && pathOf(r) === path);
/**
 * Sent by Run Hound itself (CheckContext.request), not by a page in the browser: Playwright's API client names itself in
 * the user agent by default. Were a user agent ever set on it, expectSafe's Run Hound checks would see nothing, but the
 * suite can't go quietly green: every re-read assertion (isReRead, expectReReadAfterEachProbe) would fail first.
 */
const fromRunHound = (r: RecordedRequest) => /^Playwright\//.test(String(r.headers["user-agent"] ?? ""));
/** Sent by a page in the browser (the app's own fetch), as a click in the app sends it. */
const fromBrowser = (r: RecordedRequest) => /Chrome\//.test(String(r.headers["user-agent"] ?? "")) && Boolean(r.headers["sec-fetch-mode"]);
/** Where a finding names what it is about. */
const named = (f: Finding) => [f.title, f.meaning, f.location ?? "", ...(f.locations ?? [])].join("\n");
const confirmed = (result: CheckResult) => result.findings.filter((f) => f.confidence === "confirmed");

/**
 * The safety contract, for every run: the only writes are the app's own (the success page's confirm and, to restore,
 * the cancel), sent by pages in the browser (so no decoy was clicked, no side-effect page opened, no sign-in form
 * filled); Run Hound itself sends nothing but its re-reads of Account A's entitlement (GET /api/me here: "no request
 * other than these page loads and the re-reads", so no pre-check of a candidate and no guessed endpoint); the sign-out
 * and account-deletion links were never opened (A is still signed in); every request stayed on the target's origin;
 * nothing reached a payment provider; no session value or Account A's username is in the result.
 */
function expectSafe(server: BillingApp, result: CheckResult, appWrites?: RegExp): void {
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
function expectGrantFinding(result: CheckResult, route: string): Finding {
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
function expectRestored(server: BillingApp, result: CheckResult, from: string): void {
  expect(server.state.plan).toBe("free");
  const cancels = posts(server, "/api/billing/cancel");
  expect(cancels).toHaveLength(1);
  expect(fromBrowser(cancels[0]!)).toBe(true);
  expect(new URL(String(cancels[0]!.headers.referer)).pathname).toBe(from);
  expect(result.notes ?? "").not.toMatch(/check Account A/);
}

/** A page load in the browser (a navigation), as opening a candidate route sends it. */
const isNavigation = (r: RecordedRequest) => r.method === "GET" && r.headers["sec-fetch-mode"] === "navigate";
/** Run Hound's own re-read of Account A's entitlement (CheckContext.request, not a page's fetch). */
const isReRead = (r: RecordedRequest) => r.method === "GET" && pathOf(r) === "/api/me" && fromRunHound(r);

/**
 * "Open each candidate route … then re-read": every candidate in `answering` that was opened before the restore's
 * cancel is followed by a re-read as Account A before the next candidate is opened (or before the cancel). `candidates`
 * are every path the check may open as a candidate here (a 404 or a sign-in redirect needs no re-read).
 */
function expectReReadAfterEachProbe(server: BillingApp, candidates: string[], answering: string[]): void {
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

const SUCCESS_LINK: Link = { href: "/app/upgraded", text: "Already paid? Refresh your plan" };

describe("paywall-trust: planning", () => {
  const page: DiscoveredPage = {
    url: "http://127.0.0.1:4100/app",
    title: "Dashboard",
    forms: [],
    controls: [],
    links: 3,
    linkTargets: ["http://127.0.0.1:4100/app/billing", "http://127.0.0.1:4100/app/upgraded"],
  };
  const form = emptyForm(page.url);

  it("is a page-scoped Security check that asks the user to check Account A when interrupted", () => {
    expect(check.id).toBe("paywall-trust");
    expect(check.scope).toBe("page");
    expect(check.category).toBe("security");
    expect(check.interruptedNote).toMatch(/check Account A/);
  });

  it("plans nothing signed out", () => {
    expect(check.plan(form, page)).toEqual([]);
    expect(check.plan(form, page, { signedIn: false, otherAccount: false })).toEqual([]);
  });

  it("plans one unticked, non-destructive scenario signed in, also on a page with no form", () => {
    for (const env of [
      { signedIn: true, otherAccount: false },
      { signedIn: true, otherAccount: true },
    ]) {
      const scenarios = check.plan(form, page, env);
      expect(scenarios).toHaveLength(1);
      const s = scenarios[0]!;
      expect(s.checkId).toBe("paywall-trust");
      expect(s.id.startsWith("paywall-trust")).toBe(true);
      expect(s.defaultSelected).toBe(false);
      expect(s.destructive).toBe(false);
      // Unticked, the plan says what it would do: it may change Account A's plan.
      expect(s.description).toMatch(/Account A/);
      expect(s.description).toMatch(/plan/i);
      // Up to 10 candidates, the linked pages read for links, and a restore, each load waiting up to 5 s for the network
      // to go quiet: more than the runner's default 3 minutes on a slow app, and a scenario stopped between a grant and
      // its restore leaves Account A on the paid plan.
      expect(check.timeLimitMs?.(s, form, page) ?? 180_000).toBeGreaterThanOrEqual(300_000);
    }
  });
});

describe("paywall-trust: skipped before any probe", () => {
  it("skips with the contract's reason when no plan or entitlement data is found (another user's plan doesn't count)", async () => {
    const server = await billingApp({ entitlement: false, grants: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} } });
    const result = await runOn(server);
    expect(result.status).toBe("skipped");
    expect(result.findings).toEqual([]);
    expect(result.notes).toMatch(/No plan or entitlement data was found, so this can't be checked/);
    // Nothing was probed: no success page opened, no confirm, no cancel, and A's plan is as it was.
    expect(loads(server, "/app/upgraded")).toEqual([]);
    expect(posts(server, "/api/billing/confirm")).toEqual([]);
    expect(posts(server, "/api/billing/cancel")).toEqual([]);
    expect(server.state.plan).toBe("free");
    expectSafe(server, result);
  }, 90_000);

  it("takes the entitlement only from a GET the app makes while loading the page under test, never a guessed or linked page's", async () => {
    // GET /api/me holds A's plan, but /app never requests it (only /api/team, other users). /app/billing, which /app links
    // to, does: reading the plan from that page's load, or from a guessed /api/me, isn't what the contract allows.
    const server = await billingApp({ pageReadsPlan: false, grants: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} } });
    const result = await runOn(server);
    expect(result.status).toBe("skipped");
    expect(result.findings).toEqual([]);
    expect(result.notes).toMatch(/No plan or entitlement data was found, so this can't be checked/);
    // Run Hound itself sent nothing (no guessed read), and nothing was probed.
    expect(server.requests.filter(fromRunHound)).toEqual([]);
    expect(loads(server, "/app/upgraded")).toEqual([]);
    expect(posts(server, "/api/billing/confirm")).toEqual([]);
    expect(posts(server, "/api/billing/cancel")).toEqual([]);
    expect(server.state.plan).toBe("free");
    expectSafe(server, result);
  }, 90_000);

  it("skips when Account A already has a paid plan, and leaves it alone", async () => {
    const server = await billingApp({ startPlan: "pro", grants: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} } });
    const result = await runOn(server);
    expect(result.status).toBe("skipped");
    expect(result.findings).toEqual([]);
    expect(result.notes).toMatch(/Account A already has a paid plan/);
    expect(loads(server, "/app/upgraded")).toEqual([]);
    expect(posts(server, "/api/billing/confirm")).toEqual([]);
    expect(posts(server, "/api/billing/cancel")).toEqual([]);
    expect(server.state.plan).toBe("pro");
    expectSafe(server, result);
  }, 90_000);
});

describe("paywall-trust: a success page that grants a paid plan on load", () => {
  it("finds a success route the page links to, as Account A, and puts Account A back on Free through the app's Cancel plan", async () => {
    const route = "/account/plan/activated";
    const server = await billingApp({ grants: true, links: [{ href: route, text: "Already paid? Refresh your plan" }], successPages: { [route]: {} }, cancel: "button" });
    const result = await runOn(server);
    expectGrantFinding(result, route);
    // The route was opened in Account A's own browser session, and the page ran (its confirm reached the app).
    const opened = loads(server, route);
    expect(opened.length).toBeGreaterThan(0);
    expect(opened.every((r) => String(r.headers.cookie ?? "").includes(`sid=${SESSION}`))).toBe(true);
    expect(posts(server, "/api/billing/confirm").length).toBeGreaterThan(0);
    // The plan was put back through the Billing page's own control, then re-read.
    expectRestored(server, result, "/app/billing");
    const lastCancel = server.requests.indexOf(posts(server, "/api/billing/cancel")[0]!);
    expect(server.requests.slice(lastCancel + 1).some((r) => r.method === "GET" && pathOf(r) === "/api/me" && fromRunHound(r))).toBe(true);
    expectSafe(server, result);
    // The exported spec replays the probe: it opens the route that granted.
    expect(result.findings[0]!.spec!.source).toContain(route);
  }, 90_000);

  it("finds a success route that is only at a conventional path (no link to it)", async () => {
    const route = "/checkout/success";
    const server = await billingApp({ grants: true, successPages: { [route]: {} }, cancel: "button" });
    const result = await runOn(server);
    expectGrantFinding(result, route);
    expectReReadAfterEachProbe(server, CONVENTIONAL, [route]);
    expectRestored(server, result, "/app/billing");
    expectSafe(server, result);
  }, 90_000);

  it("re-reads after each candidate and names only the route that granted, not one that answered without granting", async () => {
    const links: Link[] = [
      // Answers, but sends nothing: loading it can't change the plan.
      { href: "/billing/thanks", text: "Thanks from the billing team" },
      { href: "/account/plan/activated", text: "Plan activated" },
    ];
    const server = await billingApp({
      grants: true,
      links,
      successPages: { "/billing/thanks": { confirms: false }, "/account/plan/activated": {} },
      cancel: "button",
    });
    const result = await runOn(server);
    const f = expectGrantFinding(result, "/account/plan/activated");
    expect([f.title, f.location ?? "", ...(f.locations ?? [])].join("\n")).not.toContain("/billing/thanks");
    expectReReadAfterEachProbe(server, [...links.map((l) => l.href), ...CONVENTIONAL], ["/billing/thanks", "/account/plan/activated"]);
    expectRestored(server, result, "/app/billing");
    expectSafe(server, result);
  }, 90_000);

  it("names only the route that granted when a candidate that answers without granting comes after it", async () => {
    // The grant comes first; the later page changes nothing, though a re-read after it still differs from the snapshot
    // until the plan is put back. Naming it too would blame a route that didn't grant.
    const server = await billingApp({
      grants: true,
      links: [SUCCESS_LINK, { href: "/billing/thanks", text: "Thanks from the billing team" }],
      successPages: { "/app/upgraded": {}, "/billing/thanks": { confirms: false } },
      cancel: "button",
    });
    const result = await runOn(server);
    const f = expectGrantFinding(result, "/app/upgraded");
    expect([f.title, f.location ?? "", ...(f.locations ?? [])].join("\n")).not.toContain("/billing/thanks");
    expectRestored(server, result, "/app/billing");
    expectSafe(server, result);
  }, 90_000);

  it("opens a linked success route under a checkout path whose text names a payment (the contract's billing words, not acting ones)", async () => {
    // Not a conventional path. "checkout" and "payment" make it a candidate: they don't make a link that acts.
    const route = "/app/checkout/thank-you";
    const server = await billingApp({ grants: true, links: [{ href: route, text: "Payment received" }], successPages: { [route]: {} }, cancel: "button" });
    const result = await runOn(server);
    expectGrantFinding(result, route);
    expectRestored(server, result, "/app/billing");
    expectSafe(server, result);
  }, 90_000);

  it("opens a linked route whose text alone names a success result (the path names none and isn't a conventional one)", async () => {
    // "path or text": /billing/return holds no success word; "Your Pro plan is confirmed" does, with a billing word.
    const route = "/billing/return";
    const server = await billingApp({ grants: true, links: [{ href: route, text: "Your Pro plan is confirmed" }], successPages: { [route]: {} }, cancel: "button" });
    const result = await runOn(server);
    expectGrantFinding(result, route);
    expectRestored(server, result, "/app/billing");
    expectSafe(server, result);
  }, 90_000);

  it("reports a grant of credits that leaves the plan on Free (credits that went up count), and says to check Account A", async () => {
    // The plan's control only shows on Pro, so there is nothing to click to take the credits back.
    const server = await billingApp({ grantsCredits: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "button" });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expect(server.state.plan).toBe("free");
    expect(server.state.credits).toBeGreaterThan(0);
    expect(result.notes).toMatch(/check Account A/);
    expectSafe(server, result);
  }, 90_000);

  it("finds a success route linked from a page the page under test links to, and follows the app's confirm() to downgrade", async () => {
    const route = "/billing/welcome";
    const server = await billingApp({
      grants: true,
      billingLinks: [{ href: route, text: "See what's included in Pro" }],
      successPages: { [route]: {} },
      cancel: "native-confirm",
    });
    const result = await runOn(server);
    expectGrantFinding(result, route);
    expectRestored(server, result, "/app/billing");
    expectSafe(server, result);
  }, 90_000);

  it("follows the app's own confirmation dialog when the cancel control is on the page under test", async () => {
    const server = await billingApp({ grants: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "dialog-on-page" });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expectRestored(server, result, "/app");
    expectSafe(server, result);
  }, 90_000);

  it("finds a success link inside the app's hidden Billing tab and chooses that tab to reach Cancel plan, as on Fernway's Settings page", async () => {
    // Not a conventional path: the only way to it is the link in the hidden panel.
    const route = "/app/plan/activated";
    const server = await billingApp({
      grants: true,
      links: [{ href: route, text: "Already paid? Refresh your plan" }],
      successPages: { [route]: {} },
      cancel: "billing-tab",
    });
    const result = await runOn(server);
    expectGrantFinding(result, route);
    expectRestored(server, result, "/app");
    expectSafe(server, result);
  }, 90_000);

  it("chooses the hidden Billing tab on a Settings page the page under test links to, for the success link and for Cancel plan", async () => {
    // Fernway's shape seen from its dashboard: the link and the plan's control are only in /app/settings' Billing tab.
    const route = "/app/plan/activated";
    const server = await billingApp({
      grants: true,
      links: [{ href: "/app/settings", text: "Settings" }],
      billingLinks: [{ href: route, text: "Already paid? Refresh your plan" }],
      successPages: { [route]: {} },
      cancel: "settings-tab",
    });
    const result = await runOn(server);
    expectGrantFinding(result, route);
    expectRestored(server, result, "/app/settings");
    expectSafe(server, result);
  }, 90_000);

  it("skips a candidate that redirects to sign-in or answers 404, and names only the route that granted", async () => {
    const server = await billingApp({
      grants: true,
      links: [{ href: "/success", text: "Payment successful" }],
      signInPaths: ["/success"],
      successPages: { "/app/upgraded": {} },
      cancel: "button",
    });
    const result = await runOn(server);
    const f = expectGrantFinding(result, "/app/upgraded");
    const where = [f.title, f.location ?? "", ...(f.locations ?? [])].join("\n");
    expect(where).not.toContain("/success");
    expect(where).not.toContain("/login");
    // The sign-in page it was sent to was never filled in (expectSafe: no write but confirm and cancel).
    expectRestored(server, result, "/app/billing");
    expectSafe(server, result);
  }, 90_000);
});

describe("paywall-trust: a restore that fails is never a pass", () => {
  it("names Account A's plan and says to check Account A when the app has no cancel or downgrade control", async () => {
    const server = await billingApp({ grants: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "none" });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expect(server.state.plan).toBe("pro");
    expect(posts(server, "/api/billing/cancel")).toEqual([]);
    expect(result.notes).toMatch(/Account A's plan is still "?pro"?: check Account A/);
    expectSafe(server, result);
  }, 90_000);

  it("re-reads after the cancel and says to check Account A when the app kept the paid plan", async () => {
    const server = await billingApp({ grants: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "ignored" });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expect(server.state.plan).toBe("pro");
    expect(posts(server, "/api/billing/cancel").length).toBeGreaterThan(0);
    expect(result.notes).toMatch(/Account A's plan is still "?pro"?: check Account A/);
    expectSafe(server, result);
  }, 90_000);

  it("says to check Account A when the re-read that should confirm the restore fails (a restore it can't see is not a restore)", async () => {
    const server = await billingApp({ grants: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "button", failReadAfterCancel: true });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expect(posts(server, "/api/billing/cancel")).toHaveLength(1);
    // The confirming re-read was sent after the cancel (and failed).
    const cancelAt = server.requests.indexOf(posts(server, "/api/billing/cancel")[0]!);
    expect(server.requests.slice(cancelAt + 1).some(isReRead)).toBe(true);
    expect(result.notes).toMatch(/check Account A/);
    expectSafe(server, result);
  }, 90_000);
});

describe("paywall-trust: a re-read that fails", () => {
  it("is inconclusive, never a pass or a confirmed finding, and says to check Account A", async () => {
    const server = await billingApp({ grants: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "button", failReadAfterConfirm: true });
    const result = await runOn(server);
    // The success page did run (and, in this buggy app, granted Pro), but Run Hound can't see the result.
    expect(server.state.confirms).toBeGreaterThan(0);
    expect(result.status).not.toBe("pass");
    expect(confirmed(result)).toEqual([]);
    expect(result.notes).toMatch(/check Account A/);
    // A change it couldn't see is not its own change to undo: no cancel or downgrade is clicked.
    expect(posts(server, "/api/billing/cancel")).toEqual([]);
    expectSafe(server, result);
  }, 90_000);
});

describe("paywall-trust: a clean app", () => {
  it("passes when the success page grants nothing, without touching the cancel control", async () => {
    const server = await billingApp({ grants: false, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "button" });
    const result = await runOn(server);
    expect(result.findings).toEqual([]);
    expect(result.status).toBe("pass");
    expect(result.notes).toContain("/app/upgraded");
    expect(result.notes).not.toMatch(/check Account A/);
    // The success page really ran as Account A.
    expect(posts(server, "/api/billing/confirm").length).toBeGreaterThan(0);
    expect(loads(server, "/app/upgraded").every((r) => String(r.headers.cookie ?? "").includes(`sid=${SESSION}`))).toBe(true);
    expect(posts(server, "/api/billing/cancel")).toEqual([]);
    expect(server.state.plan).toBe("free");
    expectSafe(server, result);
  }, 90_000);

  it("never confirms a finding from page text alone ('You're on Pro') when the entitlement didn't change", async () => {
    const server = await billingApp({
      grants: false,
      links: [SUCCESS_LINK],
      successPages: { "/app/upgraded": { says: "You're on Pro! Thanks for upgrading." } },
      cancel: "button",
    });
    const result = await runOn(server);
    // The route answered and the entitlement didn't change: a verdict, pass or (with an advisory finding) fail.
    expect(result.status).toBe(result.findings.length > 0 ? "fail" : "pass");
    expect(confirmed(result)).toEqual([]);
    for (const f of result.findings) expect(f.confidence).toBe("advisory");
    expect(posts(server, "/api/billing/cancel")).toEqual([]);
    expect(server.state.plan).toBe("free");
    expectSafe(server, result);
  }, 90_000);

  it("skips, never passes, when no success route answers (every candidate is a 404 or a sign-in redirect)", async () => {
    const server = await billingApp({ grants: true, signInPaths: ["/success", "/app/upgraded"], cancel: "button" });
    const result = await runOn(server);
    expect(result.status).toBe("skipped");
    expect(result.findings).toEqual([]);
    expect(result.notes).toMatch(/No success or upgrade page answered, so this can't be checked/);
    expect(posts(server, "/api/billing/cancel")).toEqual([]);
    expect(server.state.plan).toBe("free");
    expectSafe(server, result);
  }, 90_000);

  it("counts a route a single-page app sends to sign-in in the browser as a sign-in redirect: skipped, never a pass", async () => {
    // Every path the app has no page for answers 200 with the app's shell, whose script goes to /login.
    const server = await billingApp({ grants: true, links: [SUCCESS_LINK], spaFallback: "sign-in", cancel: "button" });
    const result = await runOn(server);
    expect(result.status).toBe("skipped");
    expect(result.findings).toEqual([]);
    expect(result.notes).toMatch(/No success or upgrade page answered, so this can't be checked/);
    expect(server.state.confirms).toBe(0);
    expect(posts(server, "/api/billing/cancel")).toEqual([]);
    expect(server.state.plan).toBe("free");
    // The sign-in page it landed on was never filled in (expectSafe: no POST /login).
    expectSafe(server, result);
  }, 90_000);

  it("opens only links that name a success or upgrade result together with a billing word, never other welcome or success pages", async () => {
    // On the Billing page (a page the page under test links to): a product tour and a blog post. Neither is about a
    // plan, and each marks onboarding done as soon as it loads.
    const tour: Link = { href: "/welcome", text: "Take the product tour" };
    const stories: Link = { href: "/blog/customer-success-stories", text: "Customer success stories" };
    const server = await billingApp({
      grants: false,
      links: [SUCCESS_LINK],
      successPages: { "/app/upgraded": {} },
      billingLinks: [tour, stories],
      onboardingPages: [tour.href, stories.href],
      cancel: "button",
    });
    const result = await runOn(server);
    expect(result.status).toBe("pass");
    expect(result.findings).toEqual([]);
    expect(loads(server, tour.href)).toEqual([]);
    expect(loads(server, stories.href)).toEqual([]);
    // expectSafe also fails a POST /api/onboarding/complete.
    expectSafe(server, result);
  }, 90_000);
});

describe("paywall-trust: only a gain is a grant", () => {
  it("never confirms a finding on a clean app whose success page spends a credit as it loads: inconclusive, naming the credits, check Account A", async () => {
    // Nothing ever raises the plan or adds credits; the page's own "AI summary" spends one credit (45 → 44).
    const server = await billingApp({ grants: false, credits: 45, successSpends: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "button" });
    const result = await runOn(server);
    expect(server.state.credits).toBeLessThan(45);
    expect(confirmed(result)).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(result.status).toBe("skipped");
    expect(result.notes).toContain("/app/upgraded");
    expect(result.notes).toMatch(/credits/);
    expect(result.notes).toContain("45 → 44");
    expect(result.notes).toMatch(/check Account A/);
    // Spent credits aren't a plan a cancel can put back: nothing was clicked.
    expect(posts(server, "/api/billing/cancel")).toEqual([]);
    expect(server.state.plan).toBe("free");
    expectSafe(server, result, /^POST \/api\/summary$/);
  }, 90_000);

  it("never confirms a finding when a success page moves the plan from free to a trial (not a paid plan)", async () => {
    const server = await billingApp({ grants: false, confirmPlan: "trial", links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "button" });
    const result = await runOn(server);
    expect(server.state.confirms).toBeGreaterThan(0);
    expect(confirmed(result)).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(result.status).toBe("skipped");
    expect(result.notes).toContain("/app/upgraded");
    expect(result.notes).toMatch(/plan/);
    expect(result.notes).toMatch(/"trial"/);
    expect(result.notes).toMatch(/check Account A/);
    expectSafe(server, result);
  }, 90_000);

  it.each(["pro_trial", "Pro trial"])("never confirms a finding when a success page moves the plan from free to a named trial (%s)", async (plan) => {
    const server = await billingApp({ grants: false, confirmPlan: plan, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "button" });
    const result = await runOn(server);
    expect(server.state.confirms).toBeGreaterThan(0);
    expect(confirmed(result)).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(result.status).toBe("skipped");
    expect(result.notes).toContain("/app/upgraded");
    expect(result.notes).toMatch(/check Account A/);
    expectSafe(server, result);
  }, 90_000);

  it("never confirms a finding when A's credits refill on a timer while the success page does nothing", async () => {
    // +1 credit every 1.5 s, starting after Run Hound's two baseline reads (so they can't see it): whichever route is
    // open when it ticks looks like it granted a credit, unless the change is confirmed while nothing is opened.
    const server = await billingApp({ grants: false, credits: 5, refillEveryMs: 1_500, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "button" });
    const result = await runOn(server);
    expect(confirmed(result)).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(result.status).toBe("skipped");
    expect(result.notes).toMatch(/^Inconclusive/);
    expect(result.notes).toMatch(/credits/);
    expect(result.notes).toMatch(/on (its|their) own/);
    // Run Hound changed nothing: no note blames it on the check or asks to check Account A for it.
    expect(result.notes).not.toMatch(/still[^.]*check Account A/);
    expect(posts(server, "/api/billing/cancel")).toEqual([]);
    expect(server.state.plan).toBe("free");
    expectSafe(server, result);
  }, 120_000);

  it("never credits a gain to a route that showed the page under test itself (a single-page app's catch-all)", async () => {
    // Every path the app has no page for shows the dashboard (the page under test), whose own load adds a bonus credit.
    const server = await billingApp({ grants: false, credits: 5, shellBonus: true, spaFallback: "shell", cancel: "button" });
    const result = await runOn(server);
    expect(confirmed(result)).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(result.status).toBe("skipped");
    expect(result.notes).toMatch(/credits/);
    expect(result.notes).toMatch(/same page as \/app\b/);
    expect(result.notes).toMatch(/check Account A/);
    expect(posts(server, "/api/billing/cancel")).toEqual([]);
    expectSafe(server, result, /^POST \/api\/daily-bonus$/);
  }, 90_000);

  it("still confirms a paid plan granted by a success page that also spends a credit, and names the plan, not the credits", async () => {
    const server = await billingApp({ grants: true, credits: 45, successSpends: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "button" });
    const result = await runOn(server);
    const f = expectGrantFinding(result, "/app/upgraded");
    expect(f.meaning).toMatch(/plan "free" → "pro"/);
    expect(f.meaning).not.toMatch(/credits/);
    // The plan was put back; the credit the page spent is still named.
    expect(server.state.plan).toBe("free");
    expect(posts(server, "/api/billing/cancel")).toHaveLength(1);
    expect(result.notes).toMatch(/credits/);
    expect(result.notes).toMatch(/check Account A/);
    expectSafe(server, result, /^POST \/api\/summary$/);
  }, 90_000);
});

describe("paywall-trust: candidate routes", () => {
  it("opens at most 10 candidates, links first, same origin only", async () => {
    // Another origin serving success routes of its own, linked under another host name and under the same host name
    // (127.0.0.1, another port): never opened, there or as the same path on the target.
    const other = await billingApp({ grants: true, successPages: { "/billing/success/99": {}, "/billing/success/98": {} } });
    const linked = Array.from({ length: 15 }, (_, i) => `/billing/success/${i + 1}`);
    // Looks like a candidate (under /billing/success) but its path acts ("cancel"): never opened.
    const acting: Link = { href: "/billing/success/cancel", text: "Cancel upgrade" };
    const app = await billingApp({
      grants: false,
      cancel: "button",
      successPages: Object.fromEntries([acting.href, ...linked].map((p) => [p, {}])),
      // The other-origin, provider and acting links come first, so a check that didn't keep to the origin, or opened a
      // link that acts, would open them. The three off-origin links are candidates by every other rule (a success path
      // under /billing, neutral text that doesn't act): only their origin rules them out.
      links: [
        { href: `http://localhost:${new URL(other.url).port}/billing/success/99`, text: "Receipt 99" },
        { href: `${other.url}/billing/success/98`, text: "Receipt 98" },
        { href: "https://checkout.stripe.com/billing/success/97", text: "Receipt 97" },
        acting,
        ...linked.map((href, i) => ({ href, text: `Receipt ${i + 1}` })),
      ],
    });
    const result = await runOn(app);
    expect(loads(app, acting.href)).toEqual([]);
    // 15 same-origin links answer, so only the limit stops the check: exactly ten are opened (and none is opened only to
    // read its links).
    const opened = new Set(app.requests.filter((r) => r.method === "GET" && /^\/billing\/success\/\d+$/.test(pathOf(r))).map(pathOf));
    expect(opened.size).toBe(10);
    // Links fill the ten before any conventional path is tried.
    for (const path of CONVENTIONAL) expect(loads(app, path)).toEqual([]);
    // Nothing went to the other origin or to the provider, and no off-origin path was tried on the target instead.
    expect(other.requests).toEqual([]);
    expect(loads(app, "/billing/success/99")).toEqual([]);
    expect(loads(app, "/billing/success/98")).toEqual([]);
    expect(loads(app, "/billing/success/97")).toEqual([]);
    // A provider link the check had tried to open would have been blocked, and listed in the notes.
    expect(result.notes ?? "").not.toContain("checkout.stripe.com");
    expect(other.state.plan).toBe("free");
    expect(result.findings).toEqual([]);
    expectSafe(app, result);
  }, 120_000);

  it("counts links and conventional paths together: at most 10 in all, every link kept", async () => {
    const linked = ["/billing/thanks/1", "/billing/thanks/2", "/billing/thanks/3", "/billing/thanks/4"];
    const app = await billingApp({
      grants: false,
      cancel: "button",
      links: linked.map((href, i) => ({ href, text: `Receipt ${i + 1}` })),
      // Every conventional path answers too, so only the limit stops the check from opening all nine.
      successPages: Object.fromEntries([...linked, ...CONVENTIONAL].map((p) => [p, {}])),
    });
    const result = await runOn(app);
    const tried = [...linked, ...CONVENTIONAL].filter((p) => app.requests.some((r) => isNavigation(r) && pathOf(r) === p));
    // Every link, then the conventional paths in the contract's order until the ten are used up.
    expect(tried).toEqual([...linked, ...CONVENTIONAL.slice(0, 6)]);
    expect(result.status).toBe("pass");
    expectSafe(app, result);
  }, 120_000);
});

describe("paywall-trust: payment providers", () => {
  it("the stand-in provider really receives a request nothing blocks (so the zero counts in these tests mean something)", async () => {
    const unguarded = await chromium.launch({ args: [resolverRules(sinkPort)] });
    try {
      const page = await unguarded.newPage();
      await page.goto("about:blank");
      await page.evaluate(() => fetch("https://api.stripe.com/v1/ping").catch(() => undefined));
      await expect.poll(() => sinkHits.length).toBeGreaterThan(0);
    } finally {
      await unguarded.close();
      sinkHits.length = 0;
    }
  }, 60_000);

  it("blocks and lists every payment-provider request the success page makes, and never types payment details", async () => {
    const providerScripts = [
      "https://js.stripe.com/v3/",
      "https://www.paypal.com/sdk/js?client-id=test",
      "https://cdn.paddle.com/paddle/v2/paddle.js",
      "https://app.lemonsqueezy.com/js/lemon.js",
    ];
    const cardForm = `<form id="card" aria-label="Pay for Pro">
<label for="cc">Card number</label><input id="cc" name="cardnumber" autocomplete="cc-number" inputmode="numeric">
<label for="exp">Expiry</label><input id="exp" name="exp-date" autocomplete="cc-exp">
<label for="cvc">CVC</label><input id="cvc" name="cvc" autocomplete="cc-csc">
<button type="submit">Pay $12</button></form>
<script>
document.querySelectorAll('#card input').forEach(function (i) { i.addEventListener('input', function () { navigator.sendBeacon('/api/typed', i.name); }); });
document.getElementById('card').addEventListener('submit', function (e) { e.preventDefault(); fetch('/api/pay', { method: 'POST', body: '{}' }); });
</script>`;
    const server = await billingApp({
      grants: true,
      links: [SUCCESS_LINK],
      cancel: "button",
      successPages: {
        "/app/upgraded": {
          extra: providerScripts.map((src) => `<script src="${src}"></script>`).join("\n") + cardForm,
          after: `fetch('https://api.stripe.com/v1/payment_intents', { method: 'POST' }).catch(function () {});
    location.href = 'https://checkout.stripe.com/c/pay/cs_test_fixture';`,
        },
      },
    });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    // Nothing reached the provider, and each blocked provider request is listed.
    expect(sinkHits).toEqual([]);
    expect(result.notes).toMatch(/blocked \(payment provider\)/);
    for (const host of ["js.stripe.com", "www.paypal.com", "cdn.paddle.com", "app.lemonsqueezy.com", "api.stripe.com", "checkout.stripe.com"]) {
      expect(result.notes).toContain(host);
    }
    // No card field was typed in and nothing was paid (expectSafe: no /api/typed, no /api/pay).
    expect(posts(server, "/api/typed")).toEqual([]);
    expect(posts(server, "/api/pay")).toEqual([]);
    expectRestored(server, result, "/app/billing");
    expectSafe(server, result);
  }, 90_000);

  it("exports a replay spec that stops a server redirect's hop to a provider and a new window's first load too, as the check does", async () => {
    const server = await billingApp({ grants: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "button" });
    const result = await runOn(server);
    const source = expectGrantFinding(result, "/app/upgraded").spec!.source;
    // Routes never see a redirect hop: a DevTools-level block on the replayed page stops it.
    expect(source).toMatch(/newCDPSession\(page\)/);
    expect(source).toMatch(/Fetch\.failRequest/);
    expect(source).toMatch(/Fetch\.enable/);
    // A redirect hop to a checkout host the provider list doesn't name is stopped too: once signed in (a sign-in page
    // may be on another site), a page load off the target is failed at the DevTools level.
    expect(source).toMatch(/resourceType === "Document"/);
    expect(source).toMatch(/guardOffSite = true/);
    expect(source.indexOf("guardOffSite = true")).toBeGreaterThan(source.indexOf("await signIn(page);"));
    // A new window's first load is never sent (it can't be watched for a redirect to a provider).
    expect(source).toMatch(/isNavigationRequest\(\)/);
    // The DevTools protocol is Chromium's: in another browser the spec is skipped, never run without that block.
    expect(source).toMatch(/test\.skip\(browserName !== "chromium"/);
    // PATH is typed as a string: a bare `const PATH = ""` is the literal type "", which strict TypeScript narrows to
    // never in `PATH ? PATH.split(".") : []`, so the spec wouldn't type-check in the user's project.
    expect(source).toMatch(/const PATH: string = "";/);
    expectRestored(server, result, "/app/billing");
    expectSafe(server, result);
  }, 90_000);

  it("never names a provider request the page makes in the background as where the cancel went, when the cancel just didn't work", async () => {
    const server = await billingApp({
      grants: true,
      links: [SUCCESS_LINK],
      successPages: { "/app/upgraded": {} },
      cancel: "ignored",
      // The Billing page's payment script polls its host in the background, as Stripe.js does.
      billingScript: "setInterval(function () { fetch('https://api.stripe.com/v1/ping').catch(function () {}); }, 150);",
    });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expect(server.state.plan).toBe("pro");
    expect(posts(server, "/api/billing/cancel").length).toBeGreaterThan(0);
    expect(result.notes).toMatch(/api\.stripe\.com: blocked \(payment provider\)/);
    expect(result.notes).not.toMatch(/headed for the payment provider/);
    expect(result.notes).toMatch(/Run Hound clicked the app's own "Cancel plan" on \/app\/billing, but Account A's plan didn't go back/);
    expect(result.notes).toMatch(/Account A's plan is still "?pro"?: check Account A/);
    expectSafe(server, result);
  }, 90_000);

  it("counts the restore as failed when the cancel control heads for the payment provider (blocked)", async () => {
    const server = await billingApp({ grants: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "provider-portal" });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expect(server.state.plan).toBe("pro");
    expect(sinkHits).toEqual([]);
    expect(result.notes).toMatch(/blocked \(payment provider\)/);
    expect(result.notes).toContain("billing.stripe.com");
    expect(result.notes).toMatch(/Account A's plan is still "?pro"?: check Account A/);
    expectSafe(server, result);
  }, 90_000);
});

describe("paywall-trust: a billing tab that heads for a payment provider", () => {
  it("chooses Billing tabs that send the browser to the app's billing portal (which redirects to the provider) or straight to the provider, and neither gets there", async () => {
    const server = await billingApp({
      grants: true,
      successPages: { "/app/upgraded": {} },
      cancel: "button",
      navTabs: [
        { name: "Billing", to: "/billing/portal" },
        { name: "Payments", to: "https://billing.stripe.com/p/session/test_tab" },
      ],
      providerRedirects: ["/billing/portal"],
    });
    const result = await runOn(server);
    // The tabs were chosen (to read the links they show, and again to look for the plan's control) and the probe went
    // on: the conventional /app/upgraded granted Pro, and the Billing page's Cancel plan put it back.
    expectGrantFinding(result, "/app/upgraded");
    expectRestored(server, result, "/app/billing");
    // The portal start was held before the app's server saw it, so its redirect to the provider never happened, and
    // the notes say so.
    expect(loads(server, "/billing/portal")).toEqual([]);
    expect(result.notes).toMatch(/"Billing" tab on \/app sent the browser to \/billing\/portal[^.]*stopped/);
    // The tab that went straight to the provider was blocked, and listed; the notes say the tab did it.
    expect(result.notes).toMatch(/billing\.stripe\.com: blocked \(payment provider\)/);
    expect(result.notes).toMatch(/"Payments" tab on \/app headed for billing\.stripe\.com \(payment provider\)[^.]*blocked/);
    expectSafe(server, result);
  }, 120_000);

  it("never lets a Billing tab create a billing portal session (a write its script sends before heading for the provider), and names it", async () => {
    // The usual Stripe customer-portal button: POST to the app, which creates the session at the provider and answers
    // with its URL. The write is held before the app's server gets it; the provider is never reached either.
    const server = await billingApp({
      grants: false,
      cancel: "button",
      successPages: { "/thanks": {} },
      navTabs: [{ name: "Billing", to: "fetch:/api/billing/portal-session" }],
    });
    const result = await runOn(server);
    expect(result.status).toBe("pass");
    expect(posts(server, "/api/billing/portal-session")).toEqual([]);
    expect(result.notes).toMatch(/"Billing" tab on \/app sent a request to \/api\/billing\/portal-session[^.]*stopped/);
    expectSafe(server, result);
  }, 120_000);

  it("never lets a Billing tab's beacon create a billing portal session, and names a tab that heads for a site the provider list doesn't name", async () => {
    // navigator.sendBeacon is a POST like a fetch (DevTools calls it a "Ping"): the portal session must not be created.
    const server = await billingApp({
      grants: false,
      cancel: "button",
      successPages: { "/thanks": {} },
      navTabs: [
        { name: "Billing", to: "script:navigator.sendBeacon('/api/billing/portal-session'); location.href = 'https://billing.stripe.com/p/session/x';" },
        { name: "Payments", to: "https://pay.gateway.test/portal" },
      ],
    });
    const result = await runOn(server);
    expect(result.status).toBe("pass");
    expect(posts(server, "/api/billing/portal-session")).toEqual([]);
    expect(result.notes).toMatch(/"Billing" tab on \/app sent a request to \/api\/billing\/portal-session[^.]*stopped/);
    expect(result.notes).toMatch(/"Payments" tab on \/app headed for pay\.gateway\.test \(another site\)[^.]*stopped/);
    expectSafe(server, result);
  }, 120_000);

  it("names a held tab once, even when a page it opens to read links lands back on the page under test (whose tab is chosen again)", async () => {
    const server = await billingApp({
      grants: false,
      successPages: { "/app/upgraded": {} },
      cancel: "button",
      navTabs: [{ name: "Billing", to: "/billing/portal" }],
      providerRedirects: ["/billing/portal"],
      links: [{ href: "/app/account", text: "Account" }],
      redirects: { "/app/account": "/app" },
    });
    const result = await runOn(server);
    expect(result.status).toBe("pass");
    // /app/account was opened to read its links and landed on /app, whose Billing tab was chosen there too.
    expect(loads(server, "/app/account").length).toBeGreaterThan(0);
    expect(loads(server, "/billing/portal")).toEqual([]);
    expect(result.notes?.match(/"Billing" tab on \/app sent the browser to \/billing\/portal/g)).toHaveLength(1);
    expectSafe(server, result);
  }, 120_000);
});

describe("paywall-trust: a restore whose confirmation heads for a payment provider", () => {
  it("never clicks the app's confirmation when its form posts to the payment provider, and says to check Account A", async () => {
    const server = await billingApp({ grants: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "provider-confirm" });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expect(server.state.plan).toBe("pro");
    expect(posts(server, "/api/billing/cancel")).toEqual([]);
    expect(result.notes).toMatch(/"Yes, cancel plan"[^.]*payment provider \(billing\.stripe\.com\)/);
    expect(result.notes).toMatch(/billing\.stripe\.com: blocked \(payment provider\)/);
    expect(result.notes).toMatch(/Account A's plan is still "?pro"?: check Account A/);
    expectSafe(server, result);
  }, 90_000);

  it("stops the redirect to the provider when the confirmation posts to the app and the app answers with the provider's cancel page", async () => {
    const server = await billingApp({ grants: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "redirect-confirm" });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    // The app's own cancel went from its confirmation, in the browser; the provider's page it answered with never loaded.
    const cancels = posts(server, "/api/billing/cancel");
    expect(cancels).toHaveLength(1);
    expect(fromBrowser(cancels[0]!)).toBe(true);
    expect(server.state.plan).toBe("pro");
    expect(result.notes).toMatch(/billing\.stripe\.com: blocked \(payment provider\)/);
    expect(result.notes).not.toMatch(/reached the provider/);
    expect(result.notes).toMatch(/Account A's plan is still "?pro"?: check Account A/);
    expectSafe(server, result);
  }, 90_000);

  it("stops the hop when the confirmation posts to the app and the app redirects to a checkout host the provider list doesn't name", async () => {
    const server = await billingApp({ grants: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "redirect-unlisted" });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expect(posts(server, "/api/billing/cancel")).toHaveLength(1);
    expect(server.state.plan).toBe("pro");
    // The notes say where the click headed (not "that click may have changed something else"), and to check Account A.
    expect(result.notes).toMatch(/"Cancel plan" on \/app\/billing headed for another site \(pay\.gateway\.test\), which Run Hound stopped/);
    expect(result.notes).not.toMatch(/may have changed something else/);
    expect(result.notes).toMatch(/Account A's plan is still "?pro"?: check Account A/);
    // expectSafe: nothing reached the stand-in host.
    expectSafe(server, result);
  }, 90_000);

  it("never loads a new window the cancel control opens (whose address redirects to the provider), and names it", async () => {
    const server = await billingApp({
      grants: true,
      links: [SUCCESS_LINK],
      successPages: { "/app/upgraded": {} },
      cancel: "opens-window",
      providerRedirects: ["/billing/return"],
    });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expect(loads(server, "/billing/return")).toEqual([]);
    expect(result.notes).toMatch(/\/app\/billing opened a new window at \/billing\/return, which Run Hound didn't load/);
    expect(result.notes).not.toMatch(/reached the provider/);
    expectRestored(server, result, "/app/billing");
    expectSafe(server, result);
  }, 90_000);

  it("holds the hop of a server redirect: a confirmation whose cancel answers with a redirect to the app's own billing portal start never reaches it", async () => {
    const server = await billingApp({
      grants: true,
      links: [SUCCESS_LINK],
      successPages: { "/app/upgraded": {} },
      cancel: "redirect-portal-confirm",
      providerRedirects: ["/billing/portal"],
    });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    // The app's own cancel went (from its confirmation, in the browser); the portal start it redirected to never did.
    expect(posts(server, "/api/billing/cancel")).toHaveLength(1);
    expect(loads(server, "/billing/portal")).toEqual([]);
    expect(server.state.plan).toBe("pro");
    expect(result.notes).toMatch(/"Cancel plan" on \/app\/billing went on to \/billing\/portal[^.]*stopped/);
    expect(result.notes).toMatch(/Account A's plan is still "?pro"?: check Account A/);
    expectSafe(server, result);
  }, 90_000);

  it("never lets the plan control create a billing portal session (a write its script sends before heading for the provider)", async () => {
    const server = await billingApp({ grants: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "portal-fetch" });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expect(posts(server, "/api/billing/portal-session")).toEqual([]);
    expect(server.state.plan).toBe("pro");
    expect(result.notes).toMatch(/"Cancel subscription" on \/app\/billing sent a request to \/api\/billing\/portal-session[^.]*stopped/);
    expect(result.notes).toMatch(/Account A's plan is still "?pro"?: check Account A/);
    expectSafe(server, result);
  }, 90_000);

  it("never clicks a plan control that links to the app's own billing portal start", async () => {
    const server = await billingApp({ grants: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "portal-link", providerRedirects: ["/billing/portal"] });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expect(loads(server, "/billing/portal")).toEqual([]);
    expect(server.state.plan).toBe("pro");
    expect(result.notes).toMatch(/"Cancel plan" on \/app\/billing opens \/billing\/portal/);
    expect(result.notes).toMatch(/Account A's plan is still "?pro"?: check Account A/);
    expectSafe(server, result);
  }, 90_000);

  it("holds a plan control whose script sends the browser to the app's own billing portal start, and counts the restore as failed", async () => {
    const server = await billingApp({ grants: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "portal-script", providerRedirects: ["/billing/portal"] });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expect(loads(server, "/billing/portal")).toEqual([]);
    expect(server.state.plan).toBe("pro");
    expect(result.notes).toMatch(/"Cancel plan" on \/app\/billing went on to \/billing\/portal[^.]*stopped/);
    expect(result.notes).toMatch(/Account A's plan is still "?pro"?: check Account A/);
    expectSafe(server, result);
  }, 90_000);

  it("never clicks a confirmation whose form posts to the app's own billing portal start", async () => {
    const server = await billingApp({ grants: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "portal-confirm", providerRedirects: ["/billing/portal"] });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expect(server.requests.filter((r) => pathOf(r) === "/billing/portal")).toEqual([]);
    expect(server.state.plan).toBe("pro");
    expect(result.notes).toMatch(/"Yes, cancel plan" on \/app\/billing opens \/billing\/portal/);
    expect(result.notes).toMatch(/Account A's plan is still "?pro"?: check Account A/);
    expectSafe(server, result);
  }, 90_000);

  it("never clicks a plan control whose form goes to a path that names the payment provider, and says so", async () => {
    // Safe direction on purpose: /api/stripe/… may be a cancel, or a portal the app's server opens at the provider.
    const server = await billingApp({ grants: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "stripe-path-form" });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expect(server.requests.filter((r) => pathOf(r) === "/api/stripe/cancel-subscription")).toEqual([]);
    expect(server.state.plan).toBe("pro");
    expect(result.notes).toMatch(/"Cancel plan" on \/app\/billing opens \/api\/stripe\/cancel-subscription \(a path that names the payment provider\)/);
    expect(result.notes).toMatch(/Account A's plan is still "?pro"?: check Account A/);
    expectSafe(server, result);
  }, 90_000);

  it("keeps holding the page's navigation to a billing portal start after the click's own hold ended (a timer the cancel set)", async () => {
    const server = await billingApp({ grants: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "timer-portal", providerRedirects: ["/billing/portal"] });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expectRestored(server, result, "/app/billing");
    // The page's timer fires 1.5 s after the cancel answered, after the check is done with the click: still held.
    await new Promise((resolve) => setTimeout(resolve, 3000));
    expect(loads(server, "/billing/portal")).toEqual([]);
    expectSafe(server, result);
  }, 90_000);
});

describe("paywall-trust: the restore clicks only Account A's own plan control", () => {
  const othersWrites = (server: BillingApp) => server.requests.filter((r) => r.method === "POST" && /^\/api\/(team|addons)\//.test(pathOf(r)));

  it('never clicks a teammate\'s or an add-on\'s "Downgrade" (in a table, a one-row list, beside an e-mail address, under another heading), only Account A\'s own', async () => {
    const server = await billingApp({ grants: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "among-teammates" });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expect(othersWrites(server)).toEqual([]);
    expectRestored(server, result, "/app/billing");
    expectSafe(server, result);
  }, 90_000);

  it('never clicks an add-on\'s "Cancel subscription" (one in each row of a list) before Account A\'s own control of the same name', async () => {
    const server = await billingApp({ grants: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "among-add-ons" });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expect(othersWrites(server)).toEqual([]);
    expectRestored(server, result, "/app/billing");
    expectSafe(server, result);
  }, 90_000);

  it('never clicks a teammate\'s "Downgrade" on a card (no list or table), only Account A\'s own under "Your plan"', async () => {
    const server = await billingApp({ grants: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "team-cards" });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expect(othersWrites(server)).toEqual([]);
    expectRestored(server, result, "/app/billing");
    expectSafe(server, result);
  }, 90_000);

  it('clicks no "Downgrade" when teammates\' cards carry the same name and none sits under a heading about Account A\'s own plan, and says to check Account A', async () => {
    // Account A's "Downgrade" is under "Pro plan": a billing heading, but nothing tells it apart from the cards' own.
    const server = await billingApp({ grants: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "team-cards-pro-plan" });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expect(othersWrites(server)).toEqual([]);
    expect(posts(server, "/api/billing/cancel")).toEqual([]);
    expect(server.state.plan).toBe("pro");
    expect(result.notes).toMatch(/Account A's plan is still "?pro"?: check Account A/);
    expectSafe(server, result);
  }, 90_000);

  it('clicks Account A\'s own "Cancel plan" under "Your plan", never a lone teammate card\'s "Downgrade to Free" before it', async () => {
    const server = await billingApp({ grants: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "team-card-free" });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expect(othersWrites(server)).toEqual([]);
    expectRestored(server, result, "/app/billing");
    expectSafe(server, result);
  }, 90_000);

  it('clicks Account A\'s own "Cancel plan" outside any list before a teammate\'s "Downgrade to Free" in a one-row list', async () => {
    const server = await billingApp({ grants: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "team-row-free" });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expect(othersWrites(server)).toEqual([]);
    expectRestored(server, result, "/app/billing");
    expectSafe(server, result);
  }, 90_000);

  it('clicks Account A\'s own "Cancel plan" before a lone teammate card\'s bare "Downgrade" (no list, no heading for either)', async () => {
    const server = await billingApp({ grants: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "team-card-bare" });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expect(othersWrites(server)).toEqual([]);
    expectRestored(server, result, "/app/billing");
    expectSafe(server, result);
  }, 90_000);

  it('never clicks a lone add-on\'s "Cancel subscription" in a list row before Account A\'s own "Cancel membership"', async () => {
    const server = await billingApp({ grants: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "addon-row-membership" });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expect(othersWrites(server)).toEqual([]);
    expectRestored(server, result, "/app/billing");
    expectSafe(server, result);
  }, 90_000);

  it('clicks neither a teammate card\'s bare "Downgrade" nor another control when nothing says which is Account A\'s plan', async () => {
    // "Downgrade" (a teammate's card) and "Cancel subscription" (Account A's): neither names the plan or a free tier, and
    // no heading says which is Account A's plan.
    const server = await billingApp({ grants: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "team-card-sub" });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expect(othersWrites(server)).toEqual([]);
    expect(posts(server, "/api/billing/cancel")).toEqual([]);
    expect(server.state.plan).toBe("pro");
    expect(result.notes).toMatch(/On \/app\/billing, "Downgrade" and "Cancel subscription" might each be the way back to Free[^.]*clicked neither/);
    expect(result.notes).not.toMatch(/found no cancel or downgrade control/);
    expect(result.notes).toMatch(/Account A's plan is still "?pro"?: check Account A/);
    expectSafe(server, result);
  }, 90_000);

  /** A teammate's card with a bare "Downgrade", outside the Settings page's tabs (shown whichever tab is chosen). */
  const TEAMMATE_CARD = `<div class="seat"><span>Jo Park</span> · <span>Pro</span> <button type="button" data-down="/api/team/u_jo/downgrade">Downgrade</button></div>`;

  it('looks behind the Billing tab for Account A\'s own "Cancel plan" before clicking a teammate card\'s bare "Downgrade" shown on the page', async () => {
    const server = await billingApp({ grants: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "billing-tab", extraDashboard: TEAMMATE_CARD });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expect(othersWrites(server)).toEqual([]);
    expectRestored(server, result, "/app");
    expectSafe(server, result);
  }, 90_000);

  it('clicks neither when a teammate card\'s bare "Downgrade" is on the page and Account A\'s "Cancel subscription" is behind the Billing tab', async () => {
    // The Billing tab shows both at once: nothing says which is Account A's, so the one on the page isn't clicked either.
    const server = await billingApp({
      grants: true,
      links: [SUCCESS_LINK],
      successPages: { "/app/upgraded": {} },
      cancel: "billing-tab",
      extraDashboard: TEAMMATE_CARD,
      tabCancel: "Cancel subscription",
    });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expect(othersWrites(server)).toEqual([]);
    expect(posts(server, "/api/billing/cancel")).toEqual([]);
    expect(server.state.plan).toBe("pro");
    expect(result.notes).toMatch(/On \/app, "Downgrade" and "Cancel subscription" might each be the way back to Free[^.]*clicked neither/);
    expect(result.notes).toMatch(/Account A's plan is still "?pro"?: check Account A/);
    expectSafe(server, result);
  }, 90_000);

  it('still clicks Account A\'s own bare "Downgrade" on the tab shown when the page loaded, after its Billing tab showed nothing that names the plan', async () => {
    // "Payments" (a Billing tab) hides the Overview panel when chosen: the Overview tab is chosen again to click it.
    const server = await billingApp({ grants: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "overview-tab" });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expectRestored(server, result, "/app/billing");
    expectSafe(server, result);
  }, 90_000);

  it('never clicks a lone add-on\'s "Cancel subscription" in a list row, even when nothing else could put the plan back', async () => {
    const server = await billingApp({ grants: true, links: [SUCCESS_LINK], successPages: { "/app/upgraded": {} }, cancel: "addon-row-only" });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expect(othersWrites(server)).toEqual([]);
    expect(posts(server, "/api/billing/cancel")).toEqual([]);
    expect(server.state.plan).toBe("pro");
    expect(result.notes).toMatch(/Account A's plan is still "?pro"?: check Account A/);
    expectSafe(server, result);
  }, 90_000);
});

describe("paywall-trust: a success page that sends the browser on to a payment provider", () => {
  it("holds the page's own navigation to a checkout start on this site (which would redirect to the provider) and still reports the grant", async () => {
    const server = await billingApp({
      grants: true,
      links: [SUCCESS_LINK],
      cancel: "button",
      successPages: { "/app/upgraded": { after: "location.href = '/checkout/start';" } },
      providerRedirects: ["/checkout/start"],
    });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expect(loads(server, "/checkout/start")).toEqual([]);
    expect(result.notes).toMatch(/\/app\/upgraded sent the browser to \/checkout\/start[^.]*stopped/);
    expectRestored(server, result, "/app/billing");
    expectSafe(server, result);
  }, 90_000);

  it("stops the provider redirect when the page goes on to a page of this site whose path names no checkout", async () => {
    const server = await billingApp({
      grants: true,
      links: [SUCCESS_LINK],
      cancel: "button",
      successPages: { "/app/upgraded": { after: "location.href = '/billing/return';" } },
      providerRedirects: ["/billing/return"],
    });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expect(result.notes).toMatch(/checkout\.stripe\.com: blocked \(payment provider\)/);
    expect(result.notes).not.toMatch(/reached the provider/);
    expectRestored(server, result, "/app/billing");
    expectSafe(server, result);
  }, 90_000);

  it("stops a server redirect's hop to a checkout host the provider list doesn't name, on a page the success page goes on to", async () => {
    const server = await billingApp({
      grants: true,
      links: [SUCCESS_LINK],
      cancel: "button",
      successPages: { "/app/upgraded": { after: "location.href = '/billing/return';" } },
      redirects: { "/billing/return": "https://pay.gateway.test/c/1" },
    });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expect(result.notes).toMatch(/pay\.gateway\.test: another site \(\/app\/upgraded headed there\)/);
    expect(result.notes).not.toMatch(/reached the provider/);
    expectRestored(server, result, "/app/billing");
    // expectSafe: nothing reached the stand-in host.
    expectSafe(server, result);
  }, 90_000);

  it("never loads a new window the success page opens (whose address redirects to the provider), and names it", async () => {
    // A new window's first request comes before Run Hound can watch that window for a redirect to a provider.
    const server = await billingApp({
      grants: true,
      links: [SUCCESS_LINK],
      cancel: "button",
      successPages: { "/app/upgraded": { after: "window.open('/billing/return');" } },
      providerRedirects: ["/billing/return"],
    });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    // The window's first load was never sent, so the app's server never got to send it on to the provider.
    expect(loads(server, "/billing/return")).toEqual([]);
    expect(result.notes).toMatch(/\/app\/upgraded opened a new window at \/billing\/return, which Run Hound didn't load/);
    expect(result.notes).not.toMatch(/reached the provider/);
    expectRestored(server, result, "/app/billing");
    expectSafe(server, result);
  }, 90_000);

  it("stops the provider redirect when a success route itself answers with one, and goes on to the next route", async () => {
    // A clean app: /checkout/success (a conventional path) sends the browser to the provider; /thanks answers after it.
    const server = await billingApp({ grants: false, cancel: "button", successPages: { "/thanks": {} }, providerRedirects: ["/checkout/success"] });
    const result = await runOn(server);
    expect(loads(server, "/checkout/success").length).toBeGreaterThan(0);
    expect(loads(server, "/thanks").length).toBeGreaterThan(0);
    expect(result.status).toBe("pass");
    expect(result.findings).toEqual([]);
    expect(result.notes).toMatch(/checkout\.stripe\.com: blocked \(payment provider\)/);
    expect(result.notes).not.toMatch(/reached the provider/);
    expect(server.state.plan).toBe("free");
    expectSafe(server, result);
  }, 120_000);

  it("holds the hop of a server redirect: a page the success page goes on to redirects to a checkout start, which is never reached", async () => {
    const server = await billingApp({
      grants: true,
      links: [SUCCESS_LINK],
      cancel: "button",
      successPages: { "/app/upgraded": { after: "location.href = '/billing/return';" } },
      redirects: { "/billing/return": "/checkout/start" },
      providerRedirects: ["/checkout/start"],
    });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expect(loads(server, "/checkout/start")).toEqual([]);
    expect(result.notes).toMatch(/\/app\/upgraded sent the browser to \/checkout\/start[^.]*stopped/);
    expectRestored(server, result, "/app/billing");
    expectSafe(server, result);
  }, 90_000);

  it("holds the hop of a server redirect on a route Run Hound opens itself: a conventional path that redirects to a checkout start", async () => {
    // A clean app: /checkout/success answers 302 to /checkout/start (which would redirect to the provider).
    const server = await billingApp({
      grants: false,
      cancel: "button",
      successPages: { "/thanks": {} },
      redirects: { "/checkout/success": "/checkout/start" },
      providerRedirects: ["/checkout/start"],
    });
    const result = await runOn(server);
    expect(loads(server, "/checkout/success").length).toBeGreaterThan(0);
    expect(loads(server, "/checkout/start")).toEqual([]);
    expect(result.status).toBe("pass");
    expect(result.notes).toMatch(/\/checkout\/success sent the browser to \/checkout\/start[^.]*stopped/);
    expect(result.notes).toMatch(/\/checkout\/success \(stopped\)/);
    expectSafe(server, result);
  }, 120_000);

  it("holds the page's navigation to a checkout start of the app on another local origin (localhost for 127.0.0.1)", async () => {
    const server = await billingApp({
      grants: true,
      links: [SUCCESS_LINK],
      cancel: "button",
      successPages: {
        "/app/upgraded": { after: "location.href = location.href.replace('127.0.0.1', 'localhost').replace(/\\/app\\/upgraded.*$/, '/checkout/start');" },
      },
      providerRedirects: ["/checkout/start"],
    });
    const result = await runOn(server);
    expectGrantFinding(result, "/app/upgraded");
    expect(loads(server, "/checkout/start")).toEqual([]);
    // The note names the other origin's host, so it isn't taken for a path of the page's own origin.
    expect(result.notes).toMatch(/\/app\/upgraded sent the browser to localhost:\d+\/checkout\/start[^.]*stopped/);
    expectRestored(server, result, "/app/billing");
    // expectSafe also checks that no request reached the app under another host name.
    expectSafe(server, result);
  }, 90_000);
});
