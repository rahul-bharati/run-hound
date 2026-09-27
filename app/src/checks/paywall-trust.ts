/**
 * paywall-trust (0.6.0, docs/v2-spec.md "`paywall-trust`" and "`paywall-trust` amendments"): can Account A get a paid
 * plan without paying?
 *
 * - One page-scoped scenario, planned only on a signed-in run. Unticked by default, not destructive.
 * - It may change Account A's entitlement (plan, role, credits, entitlements) and nothing else: it finds the
 *   entitlement among the GETs the app itself made while loading the page under test (lib/entitlement.ts), snapshots it
 *   with a re-read as Account A, restores it after a probe changed it, and is never a pass while a restore note stands.
 * - No entitlement → skipped ("No plan or entitlement data was found, so this can't be checked"); Account A already on
 *   a paid plan → skipped; a plan that reads differently twice in a row with nothing opened → skipped (a change of its
 *   own can't be told from a grant).
 * - Probe (0.6.0 only): in Account A's own browser context, with the navigation guard on and every request to a payment
 *   provider blocked from the context's first request (and listed as "blocked (payment provider)"), open the app's own
 *   success/upgraded/thank-you routes (links on the page under test first, then links on its billing and settings
 *   pages, then the conventional paths; same origin, at most 10; a link whose path starts a checkout, a subscription or
 *   a portal session never counts through its query; a billing or settings page is opened to read its links only when
 *   its link names no checkout, portal or plan choice) and let each page run as it would for a visitor, then re-read
 *   the entitlement as Account A. Run Hound never enters payment details and sends nothing itself but these page loads
 *   and the re-reads (the entitlement is found in the answers the app itself received). A hidden Billing tab is chosen
 *   only when it isn't a link to another page, with every navigation to this site held while it is clicked (a tab
 *   whose script sends the browser to a billing portal never gets there), and the plan is re-read after it, like after
 *   a page load. While a route is open, the page's own navigations to a checkout or billing portal start on this site
 *   are held too (holdingNavigation): the app's server never gets to redirect them to a provider. A server redirect to
 *   a provider that happens anyway (the route itself redirects) can't be stopped (Chromium never routes a redirect
 *   hop): it is named in the notes, never as "blocked", and no further page is opened. No new page is opened once
 *   only RESTORE_RESERVE_MS of the time limit is left.
 * - Verdict: the entitlement changed → critical, confirmed, "Account A got a paid plan without paying", naming the
 *   route; the probing stops there. Page text alone is only mentioned in the notes. A failed re-read is inconclusive,
 *   and nothing is clicked to undo a change Run Hound can't see. No route that answered as itself (every one a 404, a
 *   not-found view, a sign-in page, another page of the app, the page under test again or the same page as another
 *   conventional path, or a load that failed) → skipped.
 * - Restore through the app's own cancel/downgrade control (the only check that clicks one, and only to undo its own
 *   change, so only when a plan field changed) on the page under test or its billing and settings pages that loaded,
 *   choosing a hidden Billing tab and following the app's own confirmation when needed (never a retention offer, a
 *   checkout step, or a control that opens a billing portal or checkout; a click that still heads for one is held and
 *   counts as failed); only a control that is about Account A's plan (never one in a row about a person, such as a
 *   teammate's "Downgrade", nor one in a sub-section that isn't about billing, such as a meal plan's "Cancel plan");
 *   a page that fails is named and the next one tried, until its own deadline; then re-read. A remaining difference
 *   is named ("… check Account A").
 * - Not in 0.6.0: the client-sent price/plan replay and the paid-feature API probe (known limits).
 */
import type { BrowserContext, Dialog, Page, Request, Route as PwRoute } from "playwright";
import { isLocalOrigin, isSameOrigin, originOf } from "../core/saves.js";
import type { Capture, Check, CheckContext, Evidence, Finding, PlanEnv, Scenario } from "../core/types.js";
import { redactSecrets } from "../engine/redact.js";
import { actsWhenLoaded, linkActs, urlWords } from "./lib/acting-links.js";
import {
  changedEntitlement,
  findEntitlement,
  isPaid,
  rereadEntitlement,
  type EntitlementSnapshot,
  type ObservedRead,
} from "./lib/entitlement.js";
import { endpointOf, errorResult, evidence, guarded, result, tryCapture, tryCard } from "./lib/functional-finding.js";
import { settle, sleep, waitFor } from "./lib/functional-form.js";
import { parseJson } from "./lib/record-state.js";

const ID = "paywall-trust" as const;

const INTERRUPTED_NOTE = "If Run Hound had already opened a success page, Account A's plan, role or credits may have changed: check Account A.";

/** At most this many success routes are opened (links and conventional paths together). */
const MAX_CANDIDATES = 10;
/** At most this many of the page's billing and settings pages are opened to read their links. */
const MAX_LINKED_PAGES = 5;
/**
 * At most this many answers of the app's own GETs to its API on another local origin are kept while the page under
 * test loads (the capture keeps no body for those), each at most MAX_LOCAL_BODY characters.
 */
const MAX_LOCAL_READS = 10;
const MAX_LOCAL_BODY = 1_000_000;
/** The contract's conventional success paths, tried in this order after the links. */
const CONVENTIONAL_PATHS = ["/upgraded", "/app/upgraded", "/success", "/checkout/success", "/billing/success", "/payment/success", "/thank-you", "/thanks", "/app/billing/success"];

/**
 * The scenario's time limit (Check.timeLimitMs). Up to 10 success routes and 5 billing or settings pages, each a page
 * load with up to 5 s of waiting for the network, plus a restore that may load the same pages again: well over the
 * runner's default 3 minutes on a slow app.
 */
const TIME_LIMIT_MS = 360_000;
/**
 * Time kept for the restore: no new page is opened once less than this is left, so a grant found late still has time
 * to be put back before the runner stops the scenario (which would leave Account A on the paid plan).
 */
const RESTORE_RESERVE_MS = 120_000;
/**
 * The restore opens no page once less than this is left of the time limit, so it ends (and names what is still
 * changed) before the runner stops the scenario, which would leave only the generic interrupted note.
 */
const RESTORE_MARGIN_MS = 10_000;
/**
 * What one restore page can take (a load of up to 30 s, up to 3 billing tabs, the click, its confirmation and the
 * waits between them): a page is opened for the restore only while this much is left before its deadline.
 */
const RESTORE_STEP_MS = 45_000;
/** What the click, its confirmation and the re-read after it can take: nothing is clicked once less is left. */
const RESTORE_CLICK_MS = 20_000;
/** Pause between the two baseline reads, so a value that moves on its own (a timestamp in seconds) shows it. */
const BASELINE_GAP_MS = 1_100;

/** Words that name a success or upgrade result (in a link's path or text; never its query). */
const SUCCESS_WORDS = /\b(upgraded|success|successful(ly)?|thank\s?you|thanks|welcome|activated|confirmed)\b/i;
/** Billing words: a success link counts only together with one of them (or under such a path). */
const BILLING_WORDS = /\b(billing|check\s?out|plans?|upgrade[sd]?|pro|premium|subscriptions?|subscribed|payments?|paid|purchased?|pricing|receipts?)\b/i;
/**
 * Path words of a step that starts something (a checkout, a subscription, a billing portal session): loading one makes
 * the app's server create it and usually redirect to the payment provider. A link whose path names one is a candidate
 * only when the path itself also names the result (`/checkout/success`), never through its query or text.
 */
const START_STEP = /\b(check\s?out|subscribe|upgrade|buy|purchase|pay|portal|sessions?|create|order|trial|pricing)\b/i;
/**
 * Link names and path words that act when opened. Narrower than linkActs on purpose: "Payment received" and a
 * checkout path are what a success link looks like, not something that acts.
 */
const ACTING_LINK =
  /\b(log\s?-?out|sign\s?-?out|log\s?off|sign\s?off|delete|remove|cancel|unsubscribe|revoke|deactivate|disconnect|unlink|downgrade|refund|decline|reject|leave|close\s+(my\s+)?account|reset|invite|share|destroy|erase|archive|trash)\b/i;
/** Pages whose links are read too: the page's billing, plan, settings and account pages. */
const READ_WORDS = /\b(billing|plans?|subscriptions?|settings|account|membership|profile)\b/i;
/**
 * Never opened only to read links: loading them may start a checkout, a payment or a billing portal session on the
 * app's server, or choose a plan ("Choose Pro" → /billing/plans/pro, /account/plan-select), which on a real app
 * usually starts a checkout at the payment provider.
 */
const NEVER_READ =
  /\b(check\s?out|upgrade[sd]?|subscribe|pay|payments?|purchase|buy|orders?|pricing|trial|invite|delete|cancel|portal|sessions?|create|choose|select|get|go|start|switch|change|pro|premium|plus|business|enterprise|annual|yearly|monthly|lifetime|seats?|top\s?up|add\s?ons?|credits?|stripe|paddle|lemon\s?squeezy)\b/i;
/**
 * Path words of a control that opens a billing portal or a checkout (a same-origin `/billing/portal` or a form posting
 * to `/create-portal-session`): the app's server creates the session and sends the browser to the payment provider.
 * The restore never clicks one.
 */
const PORTAL_STEP = /\b(portal|sessions?|check\s?out|billing\s?portal|customer\s?portal|stripe|paddle|lemon\s?squeezy)\b/i;
/**
 * Path words of a page a cancel or downgrade never needs to open: a billing portal or checkout (PORTAL_STEP), or a
 * step that starts a payment. A navigation to one on this site during the restore's clicks is held (never sent).
 */
const RESTORE_HOLD = new RegExp(`${PORTAL_STEP.source}|\\b(subscribe|upgrade|buy|purchase|pay|order|trial)\\b`, "i");
/** A path that is the app's sign-in page (a page ending there was "sent to sign-in"). */
const SIGN_IN_PATH = /(^|\/)(log-?in|sign-?in|signin|login|auth|session|sso)(\/|$)/i;
/**
 * The same, narrower, for a navigation a hold lets through (startsFrom): a sign-in word anywhere, or `auth` and
 * `session` only as the first segment (`/session/new`), never `/api/checkout/session`.
 */
const SIGN_IN_PAGE = /(^|\/)(log-?in|sign-?in|signin|login|sso)(\/|$)|^\/(auth|session)(\/|$)/i;
/** Common file extensions a link downloads rather than navigates to. */
const DOWNLOAD_EXT = /\.(pdf|zip|tar|gz|csv|xlsx?|docx?|pptx?|dmg|exe|apk|mp4|mp3|png|jpe?g|gif|svg)(\?|#|$)/i;

/**
 * A control whose name says it cancels or downgrades the plan (the restore's only click). "Downgrade" only as the
 * whole name, or naming the plan or a free tier ("Downgrade to Free"), never "Downgrade member" or "Downgrade to
 * viewer" (a person's role).
 */
const PLAN_CONTROL =
  /^\s*downgrade(\s+(my\s+|your\s+|the\s+)?(plan|subscription|membership))?(\s+to\s+(the\s+)?(free|basic|starter|hobby)(\s+plan)?)?\s*$|\b(cancel\s+(my\s+|your\s+|the\s+)?(plan|subscription|membership|pro|premium)|switch\s+(back\s+)?to\s+(the\s+)?free|(go\s+)?back\s+to\s+(the\s+)?free|end\s+(my\s+|your\s+)?(plan|subscription|membership))\b/i;
/**
 * A row (a list item or a table row) about a person: an e-mail address, or a member, role or seat word. A plan control
 * in one ("Downgrade" beside a teammate) is that person's, never Account A's plan.
 */
const PERSON_ROW =
  /[^\s@]+@[^\s@]+\.[^\s@]+|\b(members?|teammates?|users?|admins?|owners?|editors?|viewers?|guests?|roles?|seats?|invited|collaborators?)\b/i;
/**
 * The heading of a sub-section (an h2 to h4, a legend or an aria-label: not the page's own h1) that is about billing
 * or the account's plan. A plan control in a sub-section with any other heading ("This week's meal plan") is never
 * clicked.
 */
const BILLING_SECTION =
  /^\s*(plans?|your\s+plan)\s*$|\b(billing|subscriptions?|membership|payments?|pricing|upgrade|account|plans?\s*(&|and)\s*billing|(your|current|account|paid|pro|premium|plus|business|free|starter|basic|team|enterprise|hobby|growth|standard|monthly|annual|yearly)\s+plan|pro|premium)\b/i;
/** Names a plan control never has: it would end the session or delete the account. */
const NEVER_CLICK = /\b(delete|remove|close\s+(my\s+)?account|deactivate|sign\s?-?out|log\s?-?out|log\s?off|invite)\b/i;
/**
 * Subscriptions that aren't the plan ("Cancel subscription" under a newsletter or e-mail settings): never clicked as
 * the plan's control.
 */
const NOT_THE_PLAN = /\b(newsletters?|e-?mails?|digests?|notifications?|alerts?|updates|marketing|mailing)\b/i;
/** Names never clicked as the plan's control. */
const PLAN_CONTROL_AVOID = new RegExp(`${NEVER_CLICK.source}|${NOT_THE_PLAN.source}`, "i");
/** The button of the app's own confirmation that goes ahead ("Yes, switch to Free", "Cancel subscription"). */
const CONFIRM =
  /\b(yes|confirm|ok|okay|continue|proceed|downgrade|switch\s+(back\s+)?to\s+(the\s+)?free|cancel\s+(my\s+|your\s+|the\s+)?(plan|subscription|membership|pro|premium)|end\s+(my\s+|your\s+)?(plan|subscription|membership))\b/i;
/** A confirmation button that names the cancel or downgrade itself: preferred over a bare "OK" or "Continue". */
const CONFIRM_NAMES_IT = /\b(cancel|downgrade|free|end)\b/i;
/** The button of a confirmation that backs out ("Keep my plan", "Not now"). */
const KEEP = /\b(keep|stay|no|not\s+now|never\s?mind|go\s+back|dismiss)\b/i;
/**
 * Buttons of a cancel flow that change the billing some other way (a retention offer, a pause, a checkout step):
 * never clicked as its confirmation ("Continue with 50% off", "Continue to checkout", "Pause instead").
 */
const RETENTION =
  /\d+\s?%|\b(offers?|discounts?|coupons?|deals?|pause[sd]?|upgrade|subscribe|check\s?out|pay|purchase|buy|trial|(switch|move|change)\s+to\s+(an?\s+)?(annual|yearly|monthly)|(annual|yearly)\s+(billing|pricing|price|discount)|portal|billing\s?portal|manage\s+(billing|subscription|plan)|stripe|paddle|lemon\s?squeezy)\b/i;
/** Names never clicked as the app's confirmation. */
const CONFIRM_AVOID = new RegExp(`${KEEP.source}|${NEVER_CLICK.source}|${RETENTION.source}`, "i");
/** Tabs that may hold the plan (Fernway's Settings → Billing). */
const BILLING_TAB = /\b(billing|plans?|subscriptions?|payments?|membership)\b/i;
/** Page text that claims an upgrade: never a finding on its own. */
const CLAIMS_UPGRADE =
  /\b(you('re|\s+are)\s+(now\s+)?(on|a)\s+(the\s+)?(pro|premium|plus|paid|business)|(pro|premium)\s+is\s+(now\s+)?active|thanks?\s+(you\s+)?for\s+upgrading|upgrade\s+(is\s+)?(complete|successful)|you('ve|\s+have)\s+been\s+upgraded)\b/i;

/**
 * Hosts of payment providers (and their subdomains). Every request to one, from any page this check opens, is
 * stopped before it leaves the browser and listed as "blocked (payment provider)".
 */
const PAYMENT_PROVIDERS = [
  "stripe.com",
  "stripe.network",
  "paypal.com",
  "paypalobjects.com",
  "braintreegateway.com",
  "braintree-api.com",
  "venmo.com",
  "paddle.com",
  "lemonsqueezy.com",
  "lmsqueezy.com",
  "squareup.com",
  "squareupsandbox.com",
  "squarecdn.com",
  "stripecdn.com",
  "shopify.com",
  "shop.app",
  "adyen.com",
  "adyenpayments.com",
  "checkout.com",
  "razorpay.com",
  "mollie.com",
  "chargebee.com",
  "recurly.com",
  "gumroad.com",
  "fastspring.com",
  "onfastspring.com",
  "2checkout.com",
  "2co.com",
  "klarna.com",
  "afterpay.com",
  "clearpay.co.uk",
  "polar.sh",
  "authorize.net",
  "paystack.co",
  "paystack.com",
  "flutterwave.com",
  "mercadopago.com",
  "payu.com",
  "wepay.com",
  "pay.google.com",
  "pay.amazon.com",
  "payments.amazon.com",
  "apple-pay-gateway.apple.com",
  "dodopayments.com",
  "creem.io",
  "freemius.com",
  "chargify.com",
  "zuora.com",
  "bluesnap.com",
  "worldpay.com",
  "commerce.coinbase.com",
];

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** True when `url` goes to a payment provider (PAYMENT_PROVIDERS, or a subdomain of one). */
function isPaymentProvider(url: string): boolean {
  const host = hostOf(url);
  return host !== "" && PAYMENT_PROVIDERS.some((d) => host === d || host.endsWith(`.${d}`));
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/** Path and query: two links to the same page (with another hash) are one. */
function pageKey(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

const q = (v: unknown) => JSON.stringify(v);

/** A value as a note or a card shows it: strings quoted, a missing field named, long values cut. */
function shown(v: unknown): string {
  if (v === undefined) return "missing";
  const text = JSON.stringify(v) ?? String(v);
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

/** What a changed entitlement field is called in a note ("plan" for plan and tier). */
function fieldNoun(field: string): string {
  const last = (field.split(".").pop() ?? field).toLowerCase();
  return last === "plan" || last === "tier" ? "plan" : field;
}

/** `text` with every account marker (3 characters or more, any case) hidden, on top of redactSecrets. */
function hider(markers: string[]): (text: string) => string {
  const names = markers.map((m) => m.trim()).filter((m) => m.length >= 3);
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = escaped.length > 0 ? new RegExp(escaped.join("|"), "gi") : null;
  return (text: string) => {
    const clean = redactSecrets(text);
    return re ? clean.replace(re, "[account]") : clean;
  };
}

// ---------- In-page scripts (strings: bundler helpers never leak into the page) ----------

/** Every link with a real href, hidden ones too (a Billing tab's panel), with its name, in document order. */
const SCAN_LINKS = String.raw`(() => {
  const out = [];
  for (const a of document.querySelectorAll("a[href]")) {
    if (a.hasAttribute("download")) continue;
    const raw = (a.getAttribute("href") || "").trim();
    if (!raw || raw.charAt(0) === "#" || /^(javascript|mailto|tel|data|blob):/i.test(raw)) continue;
    let url;
    try { url = new URL(raw, location.href); } catch (e) { continue; }
    const text = (a.getAttribute("aria-label") || a.textContent || a.getAttribute("title") || "").replace(/\s+/g, " ").trim();
    out.push({ url: url.href, text: text.slice(0, 200) });
    if (out.length >= 500) break;
  }
  return out;
})()`;

/** True when the page shows a "this page doesn't exist" view (its title or main heading says so). */
const NOT_FOUND_VIEW = String.raw`(() => {
  const title = (document.title || "").toLowerCase();
  const h1 = (document.querySelector("h1") ? document.querySelector("h1").innerText || "" : "").toLowerCase();
  return /\b404\b|not[\s-]?found|does\s?n['’]?t exist|no such page|page (does\s?n['’]?t|cannot be) found/.test(title + " " + h1);
})()`;

/** True when a visible password field is on the page (a success page never asks for one; a sign-in page does). */
const SHOWS_PASSWORD = String.raw`(() => Array.from(document.querySelectorAll("input[type=password]")).some((el) => {
  const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
  return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
}))()`;

/**
 * A fingerprint of what the page shows: its title, its main heading and the start of its main content (whitespace
 * collapsed). Two routes with the same fingerprint showed the same page (a single-page app's catch-all that renders the
 * dashboard at any path and keeps the URL). Read from the page as it is: no request.
 */
const FINGERPRINT = String.raw`(() => {
  const t = (s) => (s || "").replace(/\s+/g, " ").trim();
  const h1 = document.querySelector("h1");
  const main = document.querySelector("main, [role=main]") || document.body;
  return t(document.title) + "\n" + t(h1 ? h1.innerText : "") + "\n" + t(main ? main.innerText : "").slice(0, 1500);
})()`;

/**
 * Marks the visible, enabled elements of `selector` whose name matches `match` and not `avoid` (and, when `within` is
 * set, only inside a visible element of `within`) with their own attribute data-rh-<prefix>="<n>" (so one search never
 * unmarks another's), and returns a selector for each, in document order, with the heading of the section it sits in
 * (the nearest ancestor with a heading, a legend or an aria-label; the page's title and main heading when none) and
 * whether that is a sub-section's, the text of the list item or table row it sits in, where a link goes, where the
 * form around it sends (its own formaction, else the form's action attribute) and whether a click submits that form.
 */
function markScript(o: { selector: string; match: RegExp; avoid?: RegExp; within?: string; prefix: string; unselected?: boolean }): string {
  return `(() => {
  const match = new RegExp(${q(o.match.source)}, "i");
  const avoid = ${o.avoid ? `new RegExp(${q(o.avoid.source)}, "i")` : "null"};
  const attr = ${q(`data-rh-${o.prefix}`)};
  const shown = (el) => { const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; const s = getComputedStyle(el); return s.visibility !== "hidden" && s.display !== "none"; };
  const nameOf = (el) => (el.getAttribute("aria-label") || el.innerText || el.value || el.getAttribute("title") || "").replace(/\\s+/g, " ").trim();
  const clean = (t) => (t || "").replace(/\\s+/g, " ").trim().slice(0, 120);
  const formOf = (el) => el.form || el.closest("form");
  const actionOf = (el) => {
    try {
      const own = el.getAttribute("formaction");
      if (own && own.trim()) return new URL(own, location.href).href;
      const form = formOf(el);
      const action = form ? form.getAttribute("action") : null;
      return action && action.trim() ? new URL(action, location.href).href : null;
    } catch (e) { return null; }
  };
  const submitsForm = (el) => {
    if (!formOf(el)) return false;
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (el.tagName === "BUTTON") return type === "" || type === "submit";
    return el.tagName === "INPUT" && (type === "submit" || type === "image");
  };
  const sectionOf = (el) => {
    let node = el.parentElement;
    for (let depth = 0; node && node !== document.body && depth < 8; depth++, node = node.parentElement) {
      const label = node.getAttribute("aria-label");
      const heading = node.querySelector(":scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > legend, :scope > [role=heading], :scope > header h1, :scope > header h2, :scope > header h3");
      if (label || heading) {
        const pageHeading = heading && (heading.tagName === "H1" || heading.getAttribute("aria-level") === "1");
        const main = node.tagName === "MAIN" || node.getAttribute("role") === "main";
        return { text: clean((label || "") + " " + (heading ? heading.textContent : "")), sub: heading ? !pageHeading : !main };
      }
    }
    const h1 = document.querySelector("h1");
    return { text: clean(document.title + " " + (h1 ? h1.textContent : "")), sub: false };
  };
  const rowOf = (el) => {
    const row = el.closest("li, tr, [role=row], [role=listitem]");
    return row ? (row.innerText || row.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 200) : "";
  };
  const roots = ${o.within ? `Array.from(document.querySelectorAll(${q(o.within)})).filter(shown)` : "[document]"};
  const out = [];
  let n = 0;
  for (const root of roots) {
    for (const el of root.querySelectorAll(${q(o.selector)})) {
      if (!shown(el) || el.disabled || el.getAttribute("aria-disabled") === "true" || el.closest("[inert]")) continue;
      ${o.unselected ? `if (el.getAttribute("aria-selected") === "true") continue;` : ""}
      const name = nameOf(el);
      if (!name || name.length > 80 || !match.test(name) || (avoid && avoid.test(name))) continue;
      const id = String(n++);
      el.setAttribute(attr, id);
      const section = sectionOf(el);
      out.push({ selector: "[" + attr + '="' + id + '"]', name, href: el.tagName === "A" ? el.href : null, formAction: actionOf(el), submits: submitsForm(el), section: section.text, subSection: section.sub, row: rowOf(el) });
    }
  }
  return out;
})()`;
}

const CLICKABLE = "button, a[href], [role=button], [role=menuitem], [role=link], input[type=submit], input[type=button]";
const DIALOGS = "[role=dialog], [role=alertdialog], dialog[open]";

interface Marked {
  /** Finds the element again: its own data-rh-<prefix> attribute. */
  selector: string;
  name: string;
  href: string | null;
  /** Where the form around the element sends (its own formaction, else the form's action attribute), or null. */
  formAction: string | null;
  /** True when a click submits the form around it (a submit button). */
  submits: boolean;
  /** The heading of the section the element sits in (see markScript). */
  section: string;
  /**
   * True when that heading is a sub-section's (an h2 to h4, a legend, or an aria-label of anything but the main
   * landmark), false when it is the page's own h1 or the page's title (no section of its own).
   */
  subSection: boolean;
  /** The text of the list item or table row the element sits in (at most 200 characters), "" when none. */
  row: string;
}

let markCounter = 0;
async function marked(page: Page, o: Omit<Parameters<typeof markScript>[0], "prefix">): Promise<Marked[]> {
  markCounter += 1;
  const found = await page.evaluate(markScript({ ...o, prefix: `mark${markCounter}` })).catch(() => []);
  return Array.isArray(found) ? (found as Marked[]) : [];
}

const locatorOf = (page: Page, m: Marked) => page.locator(m.selector).first();

// ---------- Holding the page's own navigations ----------

/**
 * Runs `act` with every navigation in `context` (any page or frame: a popup too) whose URL `stop` names aborted before
 * it is sent. The hold is a context route added last, so it runs before the payment-provider block and the navigation
 * guard, and a first hop is always routed: the app's server never answers it, so it can't redirect the browser to a
 * payment provider. A single-page app's own page switches (pushState, a hash) send no request and go on as usual; a
 * navigation `stop` doesn't name falls through to the block and the guard. `act` gets the list of what was stopped so
 * far (the result carries it too).
 */
async function holdingNavigation<T>(
  context: BrowserContext,
  stop: (url: string) => boolean,
  act: (stopped: readonly string[]) => Promise<T>,
): Promise<{ value: T; stopped: string[] }> {
  const stopped: string[] = [];
  const hold = async (route: PwRoute, request: Request) => {
    if (!request.isNavigationRequest() || !stop(request.url())) return route.fallback();
    stopped.push(request.url());
    await route.abort("aborted").catch(() => undefined);
  };
  await context.route("**/*", hold);
  try {
    return { value: await act(stopped), stopped };
  } finally {
    await context.unroute("**/*", hold).catch(() => undefined);
  }
}

/**
 * Where a page opened at `url` may not go on its own while Run Hound has it open: another page of this site whose path
 * starts a checkout, a subscription or a billing portal session (START_STEP, PORTAL_STEP), unless that path names the
 * result (`/checkout/success`) or is the sign-in page.
 */
function startsFrom(url: string): (to: string) => boolean {
  return (to) => {
    if (!isSameOrigin(to, url) || pageKey(to) === pageKey(url) || SIGN_IN_PAGE.test(pathOf(to))) return false;
    const words = pathWords(to);
    return (PORTAL_STEP.test(words) || START_STEP.test(words)) && !SUCCESS_WORDS.test(words);
  };
}

/**
 * The page's unselected tabs that may hold the plan (a Billing tab), only those that aren't a link to another page
 * (`<a role="tab" href="/billing/portal">` would load a page nothing vetted: it is among the page's links instead,
 * opened only when isBillingPage allows it) and don't submit a form. A tab that is a button whose script sends the
 * browser elsewhere passes: chooseTab holds every navigation to this site while it clicks one.
 */
async function billingTabs(page: Page): Promise<Marked[]> {
  const here = pageKey(page.url());
  const tabs = await marked(page, { selector: "[role=tab]", match: BILLING_TAB, unselected: true });
  return tabs.filter((t) => (t.href === null || pageKey(t.href) === here) && !t.submits);
}

/**
 * Clicks a tab with every navigation to this site held (a tab is never a page load: one that tries is stopped before
 * the app's server answers), lets the page settle for up to `waitMs`, then runs `then` (told whether the click went
 * through) while the hold is still on. True when the click went through.
 */
async function chooseTab(page: Page, tab: Marked, waitMs: number, then?: (clicked: boolean) => Promise<void>): Promise<boolean> {
  const here = page.url();
  const held = await holdingNavigation(
    page.context(),
    (to) => isSameOrigin(to, here),
    async () => {
      const clicked = await locatorOf(page, tab)
        .click({ timeout: 3000 })
        .then(
          () => true,
          () => false,
        );
      if (waitMs > 300) await settle(page, waitMs);
      await sleep(clicked ? 300 : 0);
      if (then) await then(clicked);
      return clicked;
    },
  );
  return held.value;
}

// ---------- Links and candidate routes ----------

interface Link {
  url: string;
  text: string;
}

interface Route {
  url: string;
  path: string;
  /**
   * "link" (found on a page), "conventional" (one of the contract's paths), "linked-page" (read for its links) or
   * "tab" (a billing tab chosen on the page at `url` to read its links: `path` names the page and the tab).
   */
  source: "link" | "conventional" | "linked-page" | "tab";
  /** For a "tab": the tab's name. */
  tab?: string;
}

/** What Run Hound did for a route, as a note says it: "opening /app/upgraded", "choosing the Billing tab on /app". */
function didFor(route: Route): string {
  return route.source === "tab" ? `choosing the ${q(route.tab ?? "billing")} tab on ${pathOf(route.url)}` : `opening ${route.path}`;
}
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The words of a URL's path only (no query: a `success_url=/billing/success` names where a checkout returns). */
function pathWords(url: string): string {
  try {
    const u = new URL(url);
    return urlWords(`${u.origin}${u.pathname}`);
  } catch {
    return "";
  }
}

/**
 * True when a link's path or text names a success or upgrade result together with a billing word, its path doesn't
 * name a step that starts something (a checkout, a portal session) unless the path itself names the result, and it
 * doesn't act when opened.
 */
function isSuccessLink(link: Link): boolean {
  const path = pathWords(link.url);
  const words = `${path} ${link.text}`;
  if (!SUCCESS_WORDS.test(words) || !BILLING_WORDS.test(words)) return false;
  if (START_STEP.test(path) && !SUCCESS_WORDS.test(path)) return false;
  return !actsWhenLoaded(link.url) && !ACTING_LINK.test(link.text) && !ACTING_LINK.test(urlWords(link.url));
}

/** True when a link goes to one of the app's billing, plan or settings pages worth reading for more links. */
function isBillingPage(link: Link): boolean {
  const words = `${urlWords(link.url)} ${link.text}`;
  return READ_WORDS.test(words) && !NEVER_READ.test(words) && !linkActs(link.text, link.url);
}

/**
 * The page's links, hidden ones too; with each billing tab chosen as well (at most 2, see chooseTab), for tabs that
 * only mount when chosen. After a tab was chosen, `chose` runs with its name (it re-reads the plan, as after a page
 * load, so a change a tab makes is never blamed on the next route); when it answers false, no further tab is chosen.
 */
async function scanLinks(page: Page, chose?: (tab: string) => Promise<boolean>): Promise<Link[]> {
  const read = async () => {
    const links = await page.evaluate(SCAN_LINKS).catch(() => []);
    return Array.isArray(links) ? (links as Link[]) : [];
  };
  const links = await read();
  for (const tab of (await billingTabs(page)).slice(0, 2)) {
    const go = { on: true };
    await chooseTab(page, tab, 0, async (clicked) => {
      links.push(...(await read()));
      if (clicked && chose) go.on = await chose(tab.name);
    });
    if (!go.on) break;
  }
  return links;
}

// ---------- Blocking payment providers ----------

/** What this check's pages tried with payment providers. */
interface ProviderLog {
  /** Hosts of provider requests stopped before they were sent. */
  blocked: string[];
  /**
   * Server redirects that took the browser to a provider: a redirect hop is never routed, so it is sent before Run
   * Hound can stop it (the navigation guard then closes the context). `from` is the route Run Hound had opened (or,
   * with none, the path the navigation started at) and `via` the path the navigation started at.
   */
  reached: { host: string; from: string; via: string }[];
  /** The route Run Hound has open now (set before each page load), named as `from`. */
  current?: string;
}

/** Contexts whose redirect hops are already watched (blockPaymentProviders may be called twice for one context). */
const watchedContexts = new WeakSet<BrowserContext>();

/**
 * Stops every request to a payment provider in `context` before it is sent, and records its host; records a server
 * redirect that reached one anyway (it can't be stopped). The route runs before every route registered earlier (the
 * navigation guard's), so a provider navigation is listed too; a provider navigation stopped by the guard's route
 * (during the first load, before this route is added again after it) is listed from the request event.
 */
async function blockPaymentProviders(context: BrowserContext, log: ProviderLog): Promise<void> {
  if (!watchedContexts.has(context)) {
    watchedContexts.add(context);
    context.on("request", (request) => {
      if (!request.isNavigationRequest() || !isPaymentProvider(request.url())) return;
      // A first hop is routed, so it is stopped (by this block or, before openAsSelf adds it again, by the navigation
      // guard, whose route then runs first): listed as blocked either way. providerNote lists each host once.
      if (!request.redirectedFrom()) {
        log.blocked.push(hostOf(request.url()));
        return;
      }
      let first = request.redirectedFrom()!;
      while (first.redirectedFrom()) first = first.redirectedFrom()!;
      const via = pathOf(first.url());
      log.reached.push({ host: hostOf(request.url()), from: log.current ?? via, via });
    });
  }
  await context.route("**/*", async (route, request) => {
    const url = request.url();
    if (!isPaymentProvider(url)) return route.fallback();
    log.blocked.push(hostOf(url));
    // A navigation is aborted without an error page, so the page that tried it stays on screen (and in the evidence).
    await route.abort(request.isNavigationRequest() ? "aborted" : "blockedbyclient").catch(() => undefined);
  });
}

type Session = Awaited<ReturnType<CheckContext["openPage"]>>;

/**
 * The answers of the GETs the app made to its API on another local origin while the page under test loaded (the
 * capture keeps no body for those): kept as they arrive, so finding the entitlement there sends nothing.
 */
interface LocalReads {
  /** In the order the app made them; null while the body is still being read, or when it was too big. */
  reads: (ObservedRead | null)[];
  pending: Promise<void>[];
  /** Set once the entitlement was looked for: later pages' reads aren't kept. */
  closed: boolean;
}

/** Keeps the JSON answers of the app's own GETs (fetch/XHR) to another local origin, at most MAX_LOCAL_READS. */
function keepLocalReads(context: BrowserContext, targetUrl: string, local: LocalReads): void {
  context.on("response", (response) => {
    if (local.closed || local.reads.length >= MAX_LOCAL_READS) return;
    const request = response.request();
    const url = request.url();
    const status = response.status();
    if (request.method().toUpperCase() !== "GET" || !["fetch", "xhr"].includes(request.resourceType())) return;
    if (status < 200 || status >= 300 || isSameOrigin(url, targetUrl) || !isLocalOrigin(url, targetUrl)) return;
    // A GET that acts when loaded (/invites/7/accept, ?action=delete) is never taken as the entitlement to re-read.
    if (actsWhenLoaded(url)) return;
    const type = response.headers()["content-type"] ?? "";
    if (type !== "" && !/json|text\//i.test(type)) return;
    const at = local.reads.push(null) - 1;
    local.pending.push(
      response.text().then(
        (body) => {
          if (body.length <= MAX_LOCAL_BODY) local.reads[at] = { method: "GET", url, status, json: parseJson(body) };
        },
        () => undefined,
      ),
    );
  });
}

/**
 * Account A's page, opened on the page under test with payment providers blocked from its very first request: the
 * block is added the moment the browser creates the context (Browser "context" event), before openPage installs the
 * guard and loads the page, so a page that loads a provider's script on its first load never reaches the provider.
 * Scenarios run one at a time, so no other scenario's context is created meanwhile. Once open, the block is added
 * again so it runs before the guard's route and a provider navigation is listed as well. With `local`, the answers of
 * the app's GETs to its API on another local origin are kept too (see LocalReads).
 */
async function openAsSelf(ctx: CheckContext, log: ProviderLog, local?: LocalReads): Promise<Session> {
  const early = (context: BrowserContext) => {
    void blockPaymentProviders(context, log).catch(() => undefined);
    if (local) keepLocalReads(context, ctx.targetUrl, local);
  };
  ctx.browser.on("context", early);
  let session: Session;
  try {
    session = await ctx.openPage({ as: "self" });
  } finally {
    ctx.browser.off("context", early);
  }
  await blockPaymentProviders(session.context, log);
  return session;
}

function providerNote(log: ProviderLog): string {
  const notes: string[] = [];
  const hosts = [...new Set(log.blocked.filter(Boolean))];
  if (hosts.length > 0) {
    const shownHosts = hosts.slice(0, 12);
    notes.push(
      `Stopped before they left the browser: ${shownHosts.map((h) => `${h}: blocked (payment provider)`).join("; ")}${hosts.length > shownHosts.length ? `; and ${hosts.length - shownHosts.length} more` : ""}.`,
    );
  }
  const reached = [...new Map(log.reached.map((r) => [`${r.from} ${r.via} ${r.host}`, r])).values()];
  for (const r of reached.slice(0, 5)) {
    notes.push(
      r.via === r.from
        ? `${r.from} redirected the browser to ${r.host} (payment provider): a server redirect is followed before Run Hound can stop it, so that request reached the provider.`
        : `${r.from} sent the browser to ${r.via}, which redirected it to ${r.host} (payment provider): a server redirect is followed before Run Hound can stop it, so that request reached the provider.`,
    );
  }
  return notes.join(" ");
}

// ---------- Opening a route ----------

/**
 * How a route answered. Only "answered" counts toward a pass: the page itself loaded and stayed. "moved" (it went to
 * another page of the app: a redirect, or a single-page app's catch-all, including one that keeps the URL and shows
 * the same page as the page under test or as another conventional path) and "not-loaded" (the load never finished)
 * are still followed by a re-read, but show no success page; nor does "stopped" (the page went on to a checkout or
 * billing portal start on this site, which Run Hound held: startsFrom).
 */
type Outcome = "answered" | "not-found" | "sign-in" | "left" | "moved" | "not-loaded" | "stopped";

interface Opened {
  outcome: Outcome;
  status: number | null;
  /** Where the page ended up. */
  landed: string;
  /** A "stopped" route: where the page tried to go on to. */
  stopped?: string;
  /** What an answered page showed (FINGERPRINT), null when it couldn't be read. */
  fingerprint?: string | null;
  /** A route reclassified as "moved": the path of the page it showed the same page as. */
  sameAs?: string;
}

/** What the page shows now (FINGERPRINT), or null. */
async function fingerprintOf(page: Page): Promise<string | null> {
  const print = await page.evaluate(FINGERPRINT).catch(() => null);
  return typeof print === "string" ? print : null;
}

/** A path without its trailing slash: `/thanks/` is `/thanks`. */
const samePath = (a: string, b: string) => (pathOf(a).replace(/\/+$/, "") || "/") === (pathOf(b).replace(/\/+$/, "") || "/");

/**
 * Opens `url` in Account A's page and lets it run (load, then up to 5 s of network idle), then says how it answered:
 * a 4xx/5xx or a not-found view is "not-found", a page that ends on a sign-in page (a server redirect, or a single-page
 * app that sends the browser there) is "sign-in", a page that ends on another origin or whose context was closed (the
 * guard closes one that left) is "left", one that went on to a checkout or billing portal start the caller's hold
 * stopped (`stopped`, see startsFrom) is "stopped", a load that failed before the page was there is "not-loaded", and
 * one that ended on another page of the app is "moved".
 */
async function openRoute(page: Page, url: string, stopped: readonly string[]): Promise<Opened> {
  let status: number | null = null;
  let threw = false;
  try {
    const response = await page.goto(url, { waitUntil: "load", timeout: 30_000 });
    status = response?.status() ?? null;
  } catch {
    // The page's own navigation replaced this one (an app sending the browser to sign-in), it was blocked, the guard
    // closed the context, or the load timed out.
    threw = true;
  }
  await page.waitForLoadState("load", { timeout: 10_000 }).catch(() => undefined);
  await settle(page);
  await sleep(250);
  await page.waitForLoadState("load", { timeout: 5_000 }).catch(() => undefined);
  const landed = page.url();
  const opened = (outcome: Outcome): Opened => ({ outcome, status, landed });
  if (page.isClosed()) return opened("left");
  if (stopped.length > 0) return { ...opened("stopped"), stopped: stopped[0] };
  if (status !== null && status >= 400) return opened("not-found");
  if (!isSameOrigin(landed, url)) return opened("left");
  const moved = !samePath(landed, url);
  if (moved && SIGN_IN_PATH.test(pathOf(landed))) return opened("sign-in");
  // The load failed and the browser still shows the page it was on before: nothing that follows is about this route.
  if (threw && pageKey(landed) !== pageKey(url)) return opened("not-loaded");
  if (await page.evaluate(SHOWS_PASSWORD).catch(() => false)) return opened("sign-in");
  if (await page.evaluate(NOT_FOUND_VIEW).catch(() => false)) return opened("not-found");
  if (moved) return opened("moved");
  return { ...opened("answered"), fingerprint: await fingerprintOf(page) };
}

function outcomeText(o: Opened): string {
  switch (o.outcome) {
    case "answered":
      return "answered";
    case "not-found":
      return o.status !== null && o.status >= 400 ? `answered ${o.status}` : "showed a not-found page";
    case "sign-in":
      return "sent to sign-in";
    case "left":
      return "left the app";
    case "moved":
      return o.sameAs !== undefined ? `showed the same page as ${o.sameAs}` : `went to ${pathOf(o.landed)}`;
    case "not-loaded":
      return "didn't load";
    case "stopped":
      return "stopped";
  }
}

// ---------- Finding the entitlement ----------

/** The GETs of the page load as ObservedRead, in the order the app made them (bodies only when the capture kept one). */
function readsOf(requests: Capture["requests"]): ObservedRead[] {
  return requests
    .filter((r) => r.method.toUpperCase() === "GET" && r.responseBody)
    .map((r) => ({ method: "GET", url: r.url, status: r.status ?? 0, json: parseJson(r.responseBody!) }));
}

/**
 * Account A's entitlement among the GETs the app made while loading the page under test: the same-origin ones from the
 * capture first, then the app's own reads from its API on another local origin, as the page received them
 * (LocalReads). Nothing is sent to find it.
 */
async function locateEntitlement(requests: Capture["requests"], local: LocalReads, markers: string[]): Promise<EntitlementSnapshot | null> {
  local.closed = true;
  const find = (reads: ObservedRead[]) => {
    for (const username of markers) {
      const snap = findEntitlement(reads, { username });
      if (snap) return snap;
    }
    return null;
  };
  const found = find(readsOf(requests));
  if (found) return found;
  await Promise.race([Promise.allSettled(local.pending), sleep(3000)]);
  return find(local.reads.filter((r): r is ObservedRead => r !== null));
}

/** Waits (up to 3 s) until the same-origin reads of the page load have their bodies in the capture. */
async function bodiesRead(capture: Capture, targetUrl: string): Promise<void> {
  await waitFor(
    () =>
      capture.requests.every(
        (r) =>
          r.method.toUpperCase() !== "GET" ||
          !["fetch", "xhr"].includes(r.resourceType) ||
          !isSameOrigin(r.url, targetUrl) ||
          typeof r.status !== "number" ||
          r.status < 200 ||
          r.status >= 300 ||
          r.responseBody !== null ||
          r.failure !== null,
      ),
    3000,
  );
}

// ---------- Restoring through the app's own control ----------

/**
 * Why the restore won't click `control` (on the page at `pageUrl`, named `path` in the note), or null when it may: a
 * link or a form that goes to another site (a payment provider's is listed as blocked too), or to a path of this site
 * that opens a billing portal or a checkout (PORTAL_STEP: the app's server would send the browser to the provider).
 */
function refusal(control: Marked, pageUrl: string, path: string): { note: string; provider?: string } | null {
  const targets: [string | null, string][] = [
    [control.href, "goes to"],
    [control.formAction, "sends its form to"],
  ];
  for (const [target, how] of targets) {
    if (!target) continue;
    if (!isSameOrigin(target, pageUrl)) {
      const host = hostOf(target);
      return isPaymentProvider(target)
        ? { note: `The app's "${control.name}" on ${path} ${how} the payment provider (${host}), which Run Hound never opens, so the plan couldn't be put back there.`, provider: host }
        : { note: `The app's "${control.name}" on ${path} ${how} another site (${host}), which Run Hound doesn't open.` };
    }
    if (PORTAL_STEP.test(pathWords(target))) {
      return {
        note: `The app's "${control.name}" on ${path} opens ${pathOf(target)} (a billing portal or checkout at the payment provider), which Run Hound never opens, so the plan couldn't be put back there.`,
      };
    }
  }
  return null;
}

/**
 * The app's own cancel or downgrade control on the page, visible now or behind a billing tab (chosen to find it):
 * controls that name the plan, Free or a downgrade first, then those that name only a subscription or membership, and
 * those only outside a section about newsletters, e-mail or notifications (a newsletter's "Cancel subscription").
 * Only a control about Account A's plan: never one in a list item or table row about a person (PERSON_ROW: a
 * teammate's "Downgrade"), nor one in a sub-section whose heading isn't about billing or the plan (BILLING_SECTION: a
 * meal plan's "Cancel plan"). A control the restore won't click (refusal) is passed over for one it may; when there is
 * none, the first refused one is returned so the restore can name it. `tabs` false: no tab is chosen (the page whose
 * tab made the change).
 */
async function findPlanControl(page: Page, tabs = true): Promise<Marked | null> {
  let refused: Marked | null = null;
  const pick = (all: Marked[]) => {
    const namesPlan = (m: Marked) => /\b(plan|free|downgrade|pro|premium)\b/i.test(m.name);
    const aboutThePlan = all.filter((m) => !PERSON_ROW.test(m.row) && (!m.subSection || BILLING_SECTION.test(m.section)));
    const ranked = [...aboutThePlan.filter(namesPlan), ...aboutThePlan.filter((m) => !namesPlan(m) && !NOT_THE_PLAN.test(m.section))];
    const usable = ranked.find((m) => refusal(m, page.url(), "") === null) ?? null;
    if (!usable) refused ??= ranked[0] ?? null;
    return usable;
  };
  const now = pick(await marked(page, { selector: CLICKABLE, match: PLAN_CONTROL, avoid: PLAN_CONTROL_AVOID }));
  if (now || !tabs) return now ?? refused;
  for (const tab of (await billingTabs(page)).slice(0, 3)) {
    const behind: { control: Marked | null } = { control: null };
    await chooseTab(page, tab, 3000, async () => {
      await sleep(200);
      behind.control = pick(await marked(page, { selector: CLICKABLE, match: PLAN_CONTROL, avoid: PLAN_CONTROL_AVOID }));
    });
    if (behind.control) return behind.control;
  }
  return refused;
}

/** What clicking the plan control did: the navigations held, and why its confirmation wasn't clicked. */
interface Clicked {
  /** Navigations to a billing portal, a checkout or a payment step on this site (RESTORE_HOLD) that were held. */
  stopped: string[];
  /** The app asked to confirm only with a button the restore won't click (refusal): why. */
  refusedConfirm: { note: string; provider?: string } | null;
}

/**
 * Clicks the plan control, accepts the browser's own confirm() it asks, and follows the app's in-page confirmation
 * (its "Yes"/"Confirm"/"Switch to Free" button, preferring one that names the cancel or downgrade; never "Keep my
 * plan", a retention offer, a checkout step or one that opens a billing portal or checkout), then lets the page
 * settle. Every navigation to a billing portal, a checkout or a payment step on this site (RESTORE_HOLD) is held
 * meanwhile, so a button whose script heads there never reaches the payment provider through the app's server; one
 * to another site meets the payment-provider block and the navigation guard. Throws when the control itself can't be
 * clicked.
 */
async function clickPlanControl(page: Page, control: Marked, path: string): Promise<Clicked> {
  const onDialog = (dialog: Dialog) => {
    const answer = dialog.type() === "confirm" || dialog.type() === "alert" ? dialog.accept() : dialog.dismiss();
    void answer.catch(() => undefined);
  };
  const here = page.url();
  page.on("dialog", onDialog);
  try {
    const held = await holdingNavigation(
      page.context(),
      (to) => isSameOrigin(to, here) && RESTORE_HOLD.test(pathWords(to)),
      async (stopped): Promise<Clicked["refusedConfirm"]> => {
        // Confirmation buttons already on screen (a dialog that holds the control itself) are not the app's answer to it.
        const before = new Set((await marked(page, { selector: CLICKABLE, match: CONFIRM, within: DIALOGS })).map((m) => m.name));
        await locatorOf(page, control).click({ timeout: 5000 });
        await sleep(400);
        if (stopped.length > 0) return null;
        const offeredAll = (await marked(page, { selector: CLICKABLE, match: CONFIRM, avoid: CONFIRM_AVOID, within: DIALOGS })).filter((m) => !before.has(m.name));
        const offered = offeredAll.filter((m) => refusal(m, page.url(), path) === null);
        const confirm = offered.find((m) => CONFIRM_NAMES_IT.test(m.name)) ?? offered[0];
        if (confirm) {
          await locatorOf(page, confirm)
            .click({ timeout: 5000 })
            .catch(() => undefined);
          await sleep(300);
        }
        await settle(page);
        const first = offeredAll[0];
        return !confirm && first ? refusal(first, page.url(), path) : null;
      },
    );
    return { stopped: held.stopped, refusedConfirm: held.value };
  } finally {
    page.off("dialog", onDialog);
  }
}

// ---------- The check ----------

interface Grant {
  route: Route;
  changed: string[];
  after: Record<string, unknown>;
  evidence: Evidence[];
}

export const check: Check = {
  id: ID,
  title: "Paid plans need a real payment",
  category: "security",
  scope: "page",
  interruptedNote: INTERRUPTED_NOTE,

  plan(_form, _page, env?: PlanEnv): Scenario[] {
    if (!env?.signedIn) return [];
    return [
      {
        id: `${ID}:success-page`,
        checkId: ID,
        title: "Opening a success page doesn't give Account A a paid plan",
        description:
          "As Account A (on a free plan), open the app's own success, upgraded and thank-you pages (those the page and its billing and settings pages link to, then common paths such as /checkout/success; this site only, at most 10) and re-read Account A's plan after each: it must not change without a payment. Run Hound never enters payment details and blocks every request to a payment provider. If a page does change Account A's plan, Run Hound puts it back with the app's own cancel or downgrade control. Off by default: it may change Account A's plan.",
        kind: "danger",
        priority: "high",
        destructive: false,
        defaultSelected: false,
      },
    ];
  },

  // Up to 10 success routes and 5 billing or settings pages, each a page load with up to 5 s of waiting for the
  // network, plus a restore that may load the same pages again: well over the runner's default 3 minutes on a slow app,
  // and a scenario stopped between a grant and its restore would leave Account A on the paid plan. The run keeps
  // RESTORE_RESERVE_MS of it for the restore.
  timeLimitMs: () => TIME_LIMIT_MS,

  run(ctx, scenario) {
    return guarded(ID, scenario, ctx, async (started) => {
      const skip = (notes: string) => errorResult(ID, scenario, started, notes, "skipped");
      const who = ctx.accounts?.self?.label ?? "Account A";
      const markers = ctx.accountMarkers().filter((m) => m.trim() !== "");
      const hide = hider(markers);
      if (!ctx.accounts?.self || markers.length === 0) {
        return skip("Skipped: this check runs signed in as a test account (Account A), so there is no plan of Account A's to check.");
      }
      /** No new page is opened after this, so the restore has time to run. */
      const probeDeadline = started + TIME_LIMIT_MS - RESTORE_RESERVE_MS;

      // 1. Load the page under test as Account A (payment providers blocked from its first request) and find Account
      // A's entitlement among the GETs the app made.
      const providers: ProviderLog = { blocked: [], reached: [] };
      /** A skip before any probe: the page under test's own provider requests are still listed. */
      const skipEarly = (text: string) => skip(hide([text, providerNote(providers)].filter(Boolean).join(" ")));
      const local: LocalReads = { reads: [], pending: [], closed: false };
      let session = await openAsSelf(ctx, providers, local);
      let sessionClosed = false;
      const watchClose = (s: Session) => s.context.once("close", () => (sessionClosed = true));
      watchClose(session);
      ctx.step(`Reading ${who}'s plan from the page's own requests`, session.page);
      await bodiesRead(session.capture, ctx.targetUrl);
      const loaded = session.capture.requests.slice();
      const found = await locateEntitlement(loaded, local, markers);
      if (!found) {
        return skipEarly(
          `No plan or entitlement data was found, so this can't be checked: none of the requests the page made as ${who} while it loaded answered with ${who}'s own plan, role, credits or entitlements.`,
        );
      }
      const endpoint = hide(endpointOf("GET", found.url));
      const paidNote = (values: Record<string, unknown>) =>
        hide(
          `${who} already has a paid plan (${Object.entries(values)
            .map(([k, v]) => `${k}: ${shown(v)}`)
            .join(", ")}, from ${endpoint}), so Run Hound can't tell whether a success page would grant one. Put ${who} on the free plan to run this check.`,
        );
      if (isPaid(found.values)) return skipEarly(paidNote(found.values));

      // 2. Snapshot it with a re-read as Account A (every later re-read goes the same way), then read it once more
      // without opening anything: values that change on their own (a list in another order, a timestamp, a balance
      // that drifts) would otherwise be taken for a grant.
      ctx.step(`Reading ${who}'s plan as ${who} (${endpoint})`, session.page);
      const cannotReread = () =>
        skipEarly(`Run Hound found ${who}'s plan in ${endpoint} but couldn't read it again as ${who}, so it couldn't tell whether a page changes it.`);
      const baseline = await rereadEntitlement(ctx, found);
      if (!baseline) return cannotReread();
      if (isPaid(baseline)) return skipEarly(paidNote(baseline));
      await sleep(BASELINE_GAP_MS);
      const again = await rereadEntitlement(ctx, found);
      if (!again) return cannotReread();
      const drifted = changedEntitlement(baseline, again);
      if (drifted.length > 0) {
        return skipEarly(
          `Run Hound read ${who}'s plan twice (${endpoint}) without opening anything in between, and ${drifted.join(", ")} changed on ${drifted.length === 1 ? "its" : "their"} own, so it can't tell a change a page makes from that. No success page was opened, so nothing needs putting back.`,
        );
      }
      const snap: EntitlementSnapshot = { ...found, values: baseline };
      const fields = Object.keys(snap.values);
      /** What the page under test shows (a route that shows the same is the app's catch-all, not a success page). */
      const ownPrint = session.page.isClosed() ? null : await fingerprintOf(session.page);
      const ownPath = pathOf(ctx.targetUrl);

      /** Account A's page, opened again when a page's navigation closed it (the guard closes a context that left). */
      const livePage = async (): Promise<Page> => {
        if (!session.page.isClosed() && !sessionClosed) return session.page;
        session = await openAsSelf(ctx, providers);
        sessionClosed = false;
        watchClose(session);
        return session.page;
      };

      const opened: { route: Route; result: Opened }[] = [];
      /** Billing and settings pages opened only to read their links. */
      const readPages: string[] = [];
      /** How each of those answered, by URL (the restore opens again only those that loaded as a page of the app). */
      const linkedOutcomes = new Map<string, Opened>();
      const claims: string[] = [];
      let grant: Grant | null = null;
      let lostAfter: Route | null = null;
      let outOfTime = false;
      /** Pages opened as Account A after the snapshot (candidates and billing or settings pages alike). */
      let visited = 0;
      /**
       * Probing ends at the first change, a lost re-read, the time limit, or once a server redirect took the browser to
       * a payment provider: every later page load could reach it again, and the run can't use what follows.
       */
      const done = () => grant !== null || lostAfter !== null || outOfTime || providers.reached.length > 0;
      /** Routes whose page went on to a checkout or billing portal start on this site, which Run Hound held. */
      const held: string[] = [];

      /**
       * Re-reads the entitlement after `route` (a page load, or a billing tab chosen on `page`) and records a grant or a
       * lost re-read. False when either happened (the probing ends).
       */
      const readAfter = async (route: Route, page: Page): Promise<boolean> => {
        ctx.step(`Reading ${who}'s plan again after ${didFor(route)}`, page.isClosed() ? undefined : page);
        const now = await rereadEntitlement(ctx, snap);
        if (now === null) {
          lostAfter = route;
          return false;
        }
        const changed = changedEntitlement(snap.values, now);
        if (changed.length === 0) return true;
        grant = { route, changed, after: now, evidence: page.isClosed() ? [] : await grantEvidence(ctx, page, route, snap, now, changed, hide) };
        return false;
      };

      /**
       * Called by scanLinks after it chose a billing tab on `page` (at `url`): re-reads, as after a page load, so a
       * change the tab made is named as the tab's, never the next route's. False once the probing is over.
       */
      const afterTab =
        (url: string, page: Page) =>
        async (tab: string): Promise<boolean> => {
          visited += 1;
          const name = tab.length > 40 ? `${tab.slice(0, 40)}…` : tab;
          const route: Route = { url, path: `${pathOf(url)} (${name} tab)`, source: "tab", tab: name };
          return (await readAfter(route, page)) && !done();
        };

      /**
       * Opens a route as Account A with the page's own navigations to a checkout or billing portal start on this site
       * held (startsFrom), re-reads the entitlement, and records a grant or a lost re-read; then, when the probing goes
       * on, runs `then` (reading a billing or settings page's links) while the hold is still on. Null when there was no
       * time left to open it (nothing was opened).
       */
      const visit = async (route: Route, then?: (page: Page, res: Opened) => Promise<void>): Promise<Opened | null> => {
        if (Date.now() >= probeDeadline) {
          outOfTime = true;
          return null;
        }
        const page = await livePage();
        ctx.step(`Opening ${route.path} as ${who}`, page);
        visited += 1;
        providers.current = route.path;
        const { value: res, stopped } = await holdingNavigation(page.context(), startsFrom(route.url), async (stopping) => {
          const res = await openRoute(page, route.url, stopping);
          if (route.source === "linked-page") {
            readPages.push(route.path);
            linkedOutcomes.set(route.url, res);
          } else {
            opened.push({ route, result: res });
          }
          if (!(await readAfter(route, page))) return res;
          if (res.outcome === "answered" && route.source !== "linked-page") {
            const text = String(await page.evaluate(() => document.body?.innerText ?? "").catch(() => ""));
            if (CLAIMS_UPGRADE.test(text)) claims.push(route.path);
          }
          if (then && !page.isClosed()) await then(page, res);
          return res;
        });
        if (stopped.length > 0) {
          // Held after the page was classified (a timer that fired during the re-read): still not a success page.
          if (res.outcome !== "stopped") {
            res.outcome = "stopped";
            res.stopped = stopped[0];
          }
          held.push(`${route.path} sent the browser to ${pathOf(stopped[0]!)} (a checkout or billing portal start), which Run Hound stopped.`);
        }
        return res;
      };

      try {
        // 3. Candidate routes: success links on the page, then on its billing and settings pages, then the
        // conventional paths. Same origin only, at most 10, links first.
        ctx.step("Looking for success and upgrade pages among the page's links", session.page);
        const own = pageKey(ctx.targetUrl);
        const seen = new Set<string>([own]);
        const candidates: Route[] = [];
        const addCandidate = (url: string, source: Route["source"]) => {
          if (candidates.length >= MAX_CANDIDATES) return;
          const key = pageKey(url);
          if (seen.has(key)) return;
          seen.add(key);
          candidates.push({ url, path: pathOf(url), source });
        };
        const sameSite = (l: Link) => isSameOrigin(l.url, ctx.targetUrl) && !DOWNLOAD_EXT.test(l.url);
        providers.current = ownPath;
        const links = (await scanLinks(session.page, afterTab(ctx.targetUrl, session.page))).filter(sameSite);
        for (const link of links) if (isSuccessLink(link)) addCandidate(link.url, "link");

        const linkedPages: Route[] = [];
        const seenPages = new Set<string>([own]);
        for (const link of links) {
          const key = pageKey(link.url);
          if (seenPages.has(key) || seen.has(key) || isSuccessLink(link) || !isBillingPage(link)) continue;
          seenPages.add(key);
          linkedPages.push({ url: link.url, path: pathOf(link.url), source: "linked-page" });
          if (linkedPages.length >= MAX_LINKED_PAGES) break;
        }
        for (const linked of linkedPages) {
          if (done() || candidates.length >= MAX_CANDIDATES) break;
          // A page load as Account A like any other: re-read after it, so a change is never blamed on a later route.
          await visit(linked, async (page, res) => {
            // Only a page that loaded as itself (or went to another page of the app) has the app's links to read.
            if (done() || (res.outcome !== "answered" && res.outcome !== "moved")) return;
            const at = res.outcome === "moved" ? res.landed : linked.url;
            for (const link of (await scanLinks(page, afterTab(at, page))).filter(sameSite)) if (isSuccessLink(link)) addCandidate(link.url, "link");
          });
        }
        const origin = originOf(ctx.targetUrl)!;
        if (!done()) for (const path of CONVENTIONAL_PATHS) addCandidate(new URL(path, origin).href, "conventional");

        // 4. Open each candidate as Account A and re-read after each. The first change ends the probing.
        for (const route of candidates) {
          if (done()) break;
          await visit(route);
        }

        const g = grant as Grant | null;
        const lost = lostAfter as Route | null;
        // A route that showed the page under test, or the same page as another conventional path, is the app's
        // catch-all (a single-page app that renders the dashboard at any path and keeps the URL), not a success page.
        const answeredConventional = opened.filter((o) => o.result.outcome === "answered" && o.route.source === "conventional" && o.result.fingerprint);
        for (const o of opened) {
          const print = o.result.fingerprint;
          if (o.result.outcome !== "answered" || !print) continue;
          const twin =
            ownPrint !== null && print === ownPrint
              ? ownPath
              : o.route.source === "conventional"
                ? answeredConventional.find((p) => p !== o && p.result.fingerprint === print)?.route.path
                : undefined;
          if (twin !== undefined) o.result = { ...o.result, outcome: "moved", sameAs: twin };
        }
        const reached = providers.reached[0];
        const stopNote =
          reached && !g && !lost ? `Run Hound stopped opening pages after ${reached.from} sent the browser to a payment provider.` : "";
        const triedNote = [
          opened.length > 0 ? `Opened as ${who}: ${opened.map((o) => `${o.route.path} (${outcomeText(o.result)})`).join(", ")}.` : "",
          readPages.length > 0 ? `Also opened to read their links: ${readPages.join(", ")}.` : "",
          ...held,
        ]
          .filter(Boolean)
          .join(" ");
        const timeNote =
          outOfTime && !g && !lost
            ? `Run Hound stopped after ${visited} ${visited === 1 ? "page" : "pages"} to leave time to put ${who}'s plan back had one changed it; the remaining routes weren't opened.`
            : "";

        if (lost) {
          return skip(
            hide(
              [
                `Inconclusive: after ${didFor(lost)} as ${who}, Run Hound couldn't read ${who}'s plan again (${endpoint}), so it can't tell whether the page changed it, and it clicks nothing to undo a change it can't see: check ${who}.`,
                triedNote,
                providerNote(providers),
              ]
                .filter(Boolean)
                .join(" "),
            ),
          );
        }

        if (!g) {
          const answered = opened.filter((o) => o.result.outcome === "answered");
          const claimed = claims.filter((path) => answered.some((o) => o.route.path === path));
          const claimNote =
            claimed.length > 0
              ? `${claimed.join(", ")} ${claimed.length === 1 ? "says" : "say"} the plan was upgraded, but ${who}'s plan didn't change: page text alone isn't counted.`
              : "";
          if (answered.length === 0) {
            return skip(
              hide(
                [
                  opened.length === 0 && stopNote
                    ? "No success or upgrade page answered, so this can't be checked: Run Hound stopped before it opened one."
                    : opened.length === 0 && outOfTime
                      ? "No success or upgrade page answered, so this can't be checked: Run Hound ran out of time before it opened one."
                      : "No success or upgrade page answered, so this can't be checked: every route Run Hound opened answered with an error or a not-found page, sent the browser to sign-in, to another page, off the app or on to a checkout or billing portal start, showed the same page as another, or didn't load.",
                  stopNote,
                  triedNote,
                  timeNote,
                  providerNote(providers),
                ]
                  .filter(Boolean)
                  .join(" "),
              ),
            );
          }
          const notes = [
            `${answered.length === 1 ? "One success or upgrade page" : `${answered.length} success or upgrade pages`} opened as ${who} (${answered.map((o) => o.route.path).join(", ")}), and ${who}'s plan (${fields.join(", ")} from ${endpoint}) read the same after each.`,
            stopNote,
            triedNote,
            timeNote,
            claimNote,
            providerNote(providers),
          ];
          return result(ID, scenario, started, [], hide(notes.filter(Boolean).join(" ")));
        }

        // 5. A page changed Account A's entitlement: put it back through the app's own control, then report. The page
        // under test first, then its billing and settings pages, except one that didn't load as a page of the app
        // when it was opened (it answered an error, went to sign-in, or left the app, possibly for a payment provider).
        const reopen = (p: Route) => {
          const was = linkedOutcomes.get(p.url)?.outcome;
          return was === undefined || was === "answered" || was === "moved";
        };
        const restorePages = [ctx.targetUrl, ...linkedPages.filter(reopen).map((p) => p.url)];
        const restoreDeadline = started + TIME_LIMIT_MS - RESTORE_MARGIN_MS;
        const restoreNotes = await restore(ctx, livePage, snap, g, restorePages, providers, who, endpoint, restoreDeadline);
        const finding = grantFinding(ctx, scenario, g, snap, endpoint, who, hide);
        const notes = [
          `${capital(didFor(g.route))} as ${who} changed ${who}'s ${g.changed.map((f) => `${f} (${shown(snap.values[f])} → ${shown(g.after[f])})`).join(", ")}.`,
          ...restoreNotes,
          triedNote,
          providerNote(providers),
        ];
        return result(ID, scenario, started, [finding], hide(notes.filter(Boolean).join(" ")));
      } catch (error) {
        // A page may already have changed Account A's plan: say so with the error.
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(hide([message.replace(/\.?$/, "."), visited > 0 ? INTERRUPTED_NOTE : "", providerNote(providers)].filter(Boolean).join(" ")));
      }
    });
  },
};

/** The frame of the route that changed the entitlement and a card of the plan before and after, taken before any restore. */
async function grantEvidence(
  ctx: CheckContext,
  page: Page,
  route: Route,
  snap: EntitlementSnapshot,
  after: Record<string, unknown>,
  changed: string[],
  hide: (s: string) => string,
): Promise<Evidence[]> {
  const who = ctx.accounts?.self?.label ?? "Account A";
  const tab = route.source === "tab";
  const frame = await tryCapture(ctx, page, hide(tab ? `${route.path} chosen as ${who}` : `${route.path} opened as ${who}`), {
    caption: hide(`${capital(didFor(route))} as ${who}, without paying, changed ${who}'s plan on the server.`),
    facts: [
      { label: tab ? "Tab chosen" : "Route opened", value: hide(route.path) },
      ...changed.slice(0, 4).map((f) => ({ label: hide(f), value: hide(`${shown(snap.values[f])} → ${shown(after[f])}`) })),
    ],
  });
  const card = await tryCard(ctx, hide(`${who}'s plan before and after`), {
    title: hide(`${endpointOf("GET", snap.url)} as ${who}`),
    subtitle: hide(`Read before and after ${didFor(route)}`),
    lines: [
      { text: hide(`Before: ${changed.map((f) => `${f}: ${shown(snap.values[f])}`).join(", ")}`) },
      { text: hide(`${tab ? `Chose the ${q(route.tab ?? "billing")} tab on ${pathOf(route.url)}` : `Opened ${route.path}`} (no payment, no card details)`) },
      { text: hide(`After:  ${changed.map((f) => `${f}: ${shown(after[f])}`).join(", ")}`), mark: true },
    ],
  });
  return [...frame, ...card];
}

/** Entitlement fields a cancel or downgrade puts back (by the last part of a dotted name). */
const PLAN_FIELD = /^(plan|tier|subscription|ispro|pro)$/i;
/** Fields that follow the plan when the answer has no plan field of its own (`{ features: [...] }`). */
const PLAN_FEATURES = /^(entitlements|features)$/i;
const lastPart = (field: string) => field.split(".").pop() ?? field;

/**
 * True when a cancel or downgrade can undo `changed`: a plan field changed (plan, tier, subscription, isPro, pro), or
 * the entitlements or features did in an answer that has no plan field (they then are the plan). Credits and a role
 * alone never: clicking the app's cancel would change something the scenario didn't (a free subscription, a trial).
 */
function cancelUndoes(changed: string[], snapshot: Record<string, unknown>): boolean {
  if (changed.some((f) => PLAN_FIELD.test(lastPart(f)))) return true;
  const hasPlanField = Object.keys(snapshot).some((f) => PLAN_FIELD.test(lastPart(f)));
  return !hasPlanField && changed.some((f) => PLAN_FEATURES.test(lastPart(f)));
}

/**
 * Puts Account A's entitlement back after a grant, through the app's own cancel or downgrade control: on the page under
 * test, then on its billing and settings pages. Only when a cancel or downgrade can undo what changed (cancelUndoes);
 * otherwise nothing is clicked. Each click is followed by a re-read; the first that reads as the snapshot again ends
 * it. A page that fails (a control covered by an overlay, a page that doesn't load) is named and the next page is
 * tried; a control that goes to a billing portal, a checkout or another site is never clicked (refusal), and a click
 * that heads for one anyway is held and counts as failed (clickPlanControl). No page is opened once less than
 * RESTORE_STEP_MS is left before `deadline`, and nothing is clicked once less than RESTORE_CLICK_MS is. Returns the
 * notes, which name whatever is still changed after a final re-read ("… check Account A").
 */
async function restore(
  ctx: CheckContext,
  livePage: () => Promise<Page>,
  snap: EntitlementSnapshot,
  grant: Grant,
  pages: string[],
  providers: ProviderLog,
  who: string,
  endpoint: string,
  deadline: number,
): Promise<string[]> {
  const notes: string[] = [];
  const stillChanged = (now: Record<string, unknown>) =>
    changedEntitlement(snap.values, now).map((f) => `${who}'s ${fieldNoun(f)} ${/s$/.test(fieldNoun(f)) ? "are" : "is"} still ${shown(now[f])}: check ${who}.`);
  const firstLine = (error: unknown) => {
    const line = (error instanceof Error ? error.message : String(error)).split("\n")[0] ?? "";
    return line.length > 160 ? `${line.slice(0, 160)}…` : line;
  };
  let attempted = false;
  try {
    const undoable = cancelUndoes(grant.changed, snap.values);
    if (!undoable) {
      notes.push(`A cancel or downgrade can't put back ${who}'s ${[...new Set(grant.changed.map(fieldNoun))].join(", ")}, so Run Hound clicked nothing.`);
    }
    const outOfTime = () => notes.push(`Run Hound ran out of time to put ${who}'s plan back.`);
    for (const url of undoable ? pages : []) {
      if (Date.now() + RESTORE_STEP_MS >= deadline) {
        outOfTime();
        break;
      }
      const path = pathOf(url);
      let control: Marked | null = null;
      try {
        const page = await livePage();
        providers.current = path;
        ctx.step(`Looking for the app's own cancel or downgrade control on ${path}`, page);
        // Loaded like a probed route: the page's own navigations to a checkout or billing portal start are held.
        const found = await holdingNavigation(page.context(), startsFrom(url), async () => {
          await page.goto(url, { waitUntil: "load", timeout: 30_000 }).catch(() => undefined);
          await settle(page);
          // Choosing a tab again on the page whose tab made the change would make it again.
          return findPlanControl(page, !(grant.route.source === "tab" && pageKey(url) === pageKey(grant.route.url)));
        });
        if (found.stopped.length > 0) {
          notes.push(`${path} sent the browser to ${pathOf(found.stopped[0]!)} (a checkout or billing portal start), which Run Hound stopped, so it clicked nothing there.`);
          continue;
        }
        control = found.value;
        if (!control) continue;
        const refused = refusal(control, page.url(), path);
        if (refused) {
          if (refused.provider) providers.blocked.push(refused.provider);
          notes.push(refused.note);
          continue;
        }
        if (Date.now() + RESTORE_CLICK_MS >= deadline) {
          outOfTime();
          break;
        }
        ctx.step(`Clicking the app's own "${control.name}" on ${path} to put ${who}'s plan back`, page);
        const blockedBefore = providers.blocked.length;
        const reachedBefore = providers.reached.length;
        attempted = true;
        const clicked = await clickPlanControl(page, control, path);
        const how = clicked.stopped[0];
        const now = await rereadEntitlement(ctx, snap);
        if (how !== undefined || clicked.refusedConfirm) {
          // The click headed for a billing portal or checkout (held), or the app asked to confirm only with a button
          // that does: the restore failed there, unless the plan reads as before anyway (the app cancelled, then
          // went on). Read first, so nothing more is clicked once the plan is back.
          if (clicked.refusedConfirm?.provider) providers.blocked.push(clicked.refusedConfirm.provider);
          if (now === null) {
            notes.push(
              `Run Hound clicked the app's own "${control.name}" on ${path}${how !== undefined ? ` (it went on to ${pathOf(how)}, which Run Hound stopped)` : ""}, but couldn't read ${who}'s plan back (${endpoint}), so it can't confirm the plan was put back: check ${who}.`,
            );
            return notes;
          }
          const back = changedEntitlement(snap.values, now).length === 0;
          if (back && how !== undefined) {
            notes.push(`Put back: Run Hound clicked the app's own "${control.name}" on ${path}, and ${who}'s plan read as it was before afterwards (the app then went on to ${pathOf(how)}, which Run Hound stopped).`);
            return notes;
          }
          notes.push(
            how !== undefined
              ? `The app's "${control.name}" on ${path} went on to ${pathOf(how)} (a billing portal or checkout start, which leads to the payment provider); Run Hound stopped it, so the plan couldn't be put back there.`
              : `Run Hound clicked the app's own "${control.name}" on ${path}, and the app asked to confirm: ${clicked.refusedConfirm!.note}`,
          );
          if (back) break;
          continue;
        }
        if (now === null) {
          notes.push(`Run Hound clicked the app's own "${control.name}" on ${path}, but couldn't read ${who}'s plan back (${endpoint}), so it can't confirm the plan was put back: check ${who}.`);
          return notes;
        }
        if (changedEntitlement(snap.values, now).length === 0) {
          notes.push(`Put back: Run Hound clicked the app's own "${control.name}" on ${path}, and ${who}'s plan read as it was before afterwards.`);
          return notes;
        }
        const blockedHosts = [...new Set(providers.blocked.slice(blockedBefore))];
        const reachedHosts = [...new Set(providers.reached.slice(reachedBefore).map((r) => r.host))];
        notes.push(
          reachedHosts.length > 0
            ? `The app's "${control.name}" on ${path} took the browser to the payment provider (${reachedHosts.join(", ")}) through a server redirect, so the plan couldn't be put back there.`
            : blockedHosts.length > 0
              ? `The app's "${control.name}" on ${path} headed for the payment provider (${blockedHosts.join(", ")}), which was blocked, so the plan couldn't be put back there.`
              : `Run Hound clicked the app's own "${control.name}" on ${path}, but ${who}'s plan didn't go back; that click may have changed something else on ${path}: check ${who}.`,
        );
      } catch (error) {
        attempted = true;
        notes.push(
          control
            ? `Clicking the app's "${control.name}" on ${path} failed (${firstLine(error)}).`
            : `Looking for the app's cancel or downgrade control on ${path} failed (${firstLine(error)}).`,
        );
      }
    }
    if (!attempted && notes.length === 0) {
      notes.push(`Run Hound found no cancel or downgrade control (such as "Cancel plan" or "Downgrade") on the page or its billing and settings pages to put ${who}'s plan back.`);
    }
    // Nothing (more) to click: read once more and name what is still changed.
    const now = await rereadEntitlement(ctx, snap);
    if (now === null) {
      notes.push(`Run Hound couldn't read ${who}'s plan back (${endpoint}) to see whether it is still changed: check ${who}.`);
    } else {
      const still = stillChanged(now);
      notes.push(...(still.length > 0 ? still : [`${who}'s plan read as it was before.`]));
    }
  } catch (error) {
    // Not read back: what the grant left may still be there.
    notes.push(`Putting ${who}'s plan back failed (${firstLine(error)}).`);
    notes.push(...grant.changed.map((f) => `${who}'s ${fieldNoun(f)} may still be ${shown(grant.after[f])}: check ${who}.`));
  }
  return notes;
}

/** The critical finding: the route, what changed, the evidence, and a spec that replays the probe. */
function grantFinding(
  ctx: CheckContext,
  scenario: Scenario,
  grant: Grant,
  snap: EntitlementSnapshot,
  endpoint: string,
  who: string,
  hide: (s: string) => string,
): Finding {
  const route = grant.route.path;
  const changes = grant.changed.map((f) => `${f} ${shown(snap.values[f])} → ${shown(grant.after[f])}`);
  const data = Object.fromEntries(grant.changed.map((f) => [f, { before: snap.values[f], after: grant.after[f] }]));
  // A billing or settings page opened to read its links, or a billing tab chosen to read its links: not a success page.
  const linkedPage = grant.route.source === "linked-page";
  const tab = grant.route.source === "tab" ? q(grant.route.tab ?? "billing") : null;
  const onPage = pathOf(grant.route.url);
  const opened = tab
    ? `Run Hound chose the ${tab} tab on ${onPage} (to read the links it holds) as ${who}`
    : linkedPage
      ? `Run Hound opened ${route} (one of the app's billing or settings pages, opened to read its links) as ${who}`
      : `Run Hound opened ${route} as ${who}`;
  const because = tab ? `because the ${tab} tab was chosen` : linkedPage ? `because ${route} was loaded` : "because a success page was loaded";
  const trusts = tab
    ? `the app changes the plan when the ${tab} tab on ${onPage} is chosen`
    : linkedPage
      ? `the server changes the plan when ${route} loads`
      : "the server trusts the success page";
  const shows = tab ? "Showing a tab should never change the plan." : linkedPage ? "Loading a page should never change the plan." : "The success page should only show the result.";
  return {
    checkId: ID,
    id: `${ID}#${scenario.id}-1`,
    title: `${who} got a paid plan without paying`,
    severity: "critical",
    category: "security",
    confidence: "confirmed",
    meaning: hide(
      `${opened}, on the free plan and without paying anything, and let the page run as it would for any visitor. Reading ${who}'s plan again as ${who} (${endpoint}) afterwards showed ${changes.join(", ")}: the server changed it ${because}, not because a payment was confirmed.`,
    ),
    impact:
      "Anyone with a free account can get the paid plan (or its credits) for nothing, just by opening this address. You lose the revenue, and paid features are open to everyone who finds it.",
    fix: hide(
      `Ask your AI or developer: "${grant.route.source === "tab" ? `Choosing the ${grant.route.tab ?? "billing"} tab on ${onPage}` : `Opening ${route}`} upgrades the signed-in account without a payment: ${trusts.replace(/"/g, "")}. Grant a plan only from a verified payment: the payment provider's webhook (for example Stripe's checkout.session.completed, checked with its signing secret), or a server-side lookup of the checkout session by its id that checks it was paid, by this account, and wasn't used before. ${shows}"`,
    ),
    location: hide(route),
    evidence: [
      ...grant.evidence,
      evidence("network", hide(`${who}'s plan re-read after opening ${route}`), { route: hide(route), read: endpoint, changed: data }),
    ],
    spec: {
      filename: `${ID}-success-page.spec.ts`,
      source: hide(
        replaySpec({
          target: ctx.targetUrl,
          route: grant.route.url,
          entitlement: snap.url,
          path: snap.path,
          fields: Object.keys(snap.values),
          slot: ctx.accounts?.self?.id === "b" ? "B" : "A",
          ...(grant.route.source === "tab" ? { tab: grant.route.tab ?? "Billing" } : {}),
        }),
      ),
    },
  };
}

/**
 * A standalone spec: signs in as the run's account (slot A or B) through the app's sign-in page from environment
 * variables, reads its plan, opens the success route (with every payment provider blocked; with `tab`, then chooses
 * that tab on it), reads it again and expects no change. No value Run Hound read, no session value and no credential
 * is written into it.
 */
function replaySpec(o: { target: string; route: string; entitlement: string; path: string; fields: string[]; slot: "A" | "B"; tab?: string }): string {
  const rel = (url: string) => (isSameOrigin(url, o.target) ? pageKey(url) : url);
  const who = `Account ${o.slot}`;
  const env = (name: string) => `RUNHOUND_ACCOUNT_${o.slot}_${name}`;
  const providers = PAYMENT_PROVIDERS.map((d) => d.replace(/\./g, "\\.")).join("|");
  return [
    `import { test, expect, type Page } from "@playwright/test";`,
    ``,
    `// Exported by Run Hound. Set ${who}'s environment variables before running:`,
    `//   ${env("LOGIN_URL")}, ${env("USERNAME")}, ${env("PASSWORD")}.`,
    `// Start with ${who} on the free plan. Opening the success route must not change its plan. When it does, put`,
    `// ${who} back afterwards with the app's own "Cancel plan" or "Downgrade".`,
    `const TARGET = ${q(o.target)};`,
    o.tab === undefined
      ? `const ROUTE = ${q(rel(o.route))}; // the page that changed the plan when it loaded`
      : `const ROUTE = ${q(rel(o.route))}; // the page whose tab changed the plan when it was chosen`,
    ...(o.tab === undefined ? [] : [`const TAB = ${q(o.tab)}; // the tab chosen on ROUTE`]),
    `const ENTITLEMENT = ${q(rel(o.entitlement))}; // ${who}'s plan, read as ${who}`,
    `const PATH = ${q(o.path)}; // where ${who}'s object sits in that answer ("" = the whole answer)`,
    `const FIELDS = ${q(o.fields)} as string[];`,
    `const PAYMENT_PROVIDER = new RegExp(${q(`^https?://([^/]+\\.)?(${providers})(:\\d+)?/`)}, "i");`,
    ``,
    `// Signs in through the app's own sign-in page; the password comes from the environment, never from this file.`,
    `async function signIn(page: Page) {`,
    `  await page.goto(process.env.${env("LOGIN_URL")}!);`,
    `  const password = page.locator('input[type="password"]').first();`,
    `  await page`,
    `    .locator('input[autocomplete="username"], input[autocomplete="email"], input[type="email"], input[name*="user" i], input[name*="email" i], input[name*="login" i]')`,
    `    .first()`,
    `    .fill(process.env.${env("USERNAME")}!);`,
    `  await password.fill(process.env.${env("PASSWORD")}!);`,
    `  await password.press("Enter");`,
    `  await expect(page.locator('input[type="password"]')).toHaveCount(0, { timeout: 15_000 });`,
    `}`,
    ``,
    `// ${who}'s plan fields, read with the signed-in page's cookies (an app that sends a bearer token needs its`,
    `// Authorization header added here).`,
    `async function entitlement(page: Page): Promise<Record<string, unknown>> {`,
    `  const answer = await page.request.get(new URL(ENTITLEMENT, TARGET).href);`,
    `  expect(answer.ok(), ${q(`reading ${who}'s plan`)}).toBe(true);`,
    `  let node: any = await answer.json();`,
    `  for (const key of PATH ? PATH.split(".") : []) node = node?.[key];`,
    `  return Object.fromEntries(FIELDS.map((f) => [f, f.split(".").reduce((o: any, k) => o?.[k], node)]));`,
    `}`,
    ``,
    `test(${q(`opening a success page doesn't give ${who} a paid plan`)}, async ({ page }) => {`,
    `  // Never reach a payment provider.`,
    `  await page.context().route((url) => PAYMENT_PROVIDER.test(url.href), (route) => route.abort());`,
    `  await signIn(page);`,
    `  const before = await entitlement(page);`,
    `  await page.goto(new URL(ROUTE, TARGET).href);`,
    `  await page.waitForLoadState("networkidle");`,
    ...(o.tab === undefined ? [] : [`  await page.getByRole("tab", { name: TAB }).click();`, `  await page.waitForLoadState("networkidle");`]),
    `  const after = await entitlement(page);`,
    `  expect(after, ${q(`${who}'s plan changed just by opening `)} + ROUTE).toEqual(before);`,
    `});`,
    ``,
  ].join("\n");
}
