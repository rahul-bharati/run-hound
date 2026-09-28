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
 *   the entitlement as Account A. Run Hound never enters payment details and sends nothing itself but these page loads,
 *   the Billing tabs it chooses and the re-reads (the entitlement is found in the answers the app itself received). A
 *   hidden Billing tab (any element with role tab, unselected, named for billing, plans, subscriptions, payments or
 *   membership) is chosen only when it isn't a link to another page and doesn't submit a form, with every navigation to
 *   the app held while it is clicked, and so is a write (a fetch or XHR other than GET, HEAD or OPTIONS, or a beacon) it
 *   sends to a checkout, subscription or billing portal start (`POST /api/billing/portal-session`), for as long as its
 *   page stays on screen (see the round 2 note below): a tab whose script heads for a billing portal never gets there,
 *   and the notes name what the tab tried, a payment provider or another site it headed for included. The plan is
 *   re-read after it, like after a page load. Once the page under test has
 *   loaded and until the scenario ends, on every page of Account A's context, the page's own navigations to a checkout,
 *   subscription or billing portal start of the app (its own origin, or its API on another local origin: ofTheApp),
 *   other than to a page Run Hound opens itself, are held (holdingNavigation, holdScenario): the app's server never
 *   gets to open a checkout or portal session or redirect to a provider, the notes name each, and a route that tried
 *   one is "stopped", never an answer. Every hold is kept at two levels: a Playwright route for the first hop, and the
 *   page's DevTools-level block (blockAtBrowser), which also sees any hop of a server redirect (no route does). That
 *   block also stops every request to a provider, listed as "blocked (payment provider)" too, and every page load that
 *   would leave the app for another site, a first hop or any hop of a server redirect (a checkout host that isn't in
 *   PAYMENT_PROVIDERS, a regional provider's, is never reached either), listed as "another site". No navigation of a
 *   page goes out before that page's block is attached, and a new window a page opens never loads its first page (the
 *   block can't be attached before that request: the notes name the window). A redirect that reaches a provider anyway
 *   (should the block miss one) is named in the notes, never as "blocked", and no further page is opened. No new page
 *   is opened once only RESTORE_RESERVE_MS of the time limit is left.
 * - Verdict: the entitlement changed → critical, confirmed, "Account A got a paid plan without paying", naming the
 *   route; the probing stops there. Page text alone is only mentioned in the notes. A failed re-read is inconclusive,
 *   and nothing is clicked to undo a change Run Hound can't see. No route that answered as itself (every one a 404, a
 *   not-found view, a sign-in page, another page of the app, the page under test again or the same page as another
 *   conventional path, or a load that failed) → skipped.
 * - Restore through the app's own cancel/downgrade control (only to undo its own change, so only when a plan field
 *   changed; `page-controls` and `dead-control`, the buttons outside and inside a form, may also click a plan button
 *   whose name doesn't look destructive, such as "Switch to Free", and with destructive scenarios allowed a "Cancel
 *   subscription": a known limit of those checks, 0.6.0 closeout) on the page under test or its billing and settings pages that loaded,
 *   choosing a hidden Billing tab when needed (never on the page whose Billing tab made the change) and following the
 *   app's own confirmation when needed (never a retention offer, a checkout step, or a control or confirmation that
 *   opens a billing portal or checkout, or a path of the app that names the payment provider, such as
 *   `/api/stripe/cancel-subscription`: safe on purpose, as such a path may open a portal at the provider). While it
 *   clicks, a navigation to the app (any hop of a server redirect included) to a billing portal, checkout, session,
 *   subscribe, upgrade, buy, purchase, pay, order or trial path, or one that names the provider, is held; so is the
 *   click's own write (a fetch or XHR other than GET, HEAD or OPTIONS, or a beacon) to a portal, checkout, subscribe,
 *   upgrade, buy, purchase, order or trial path; a navigation to the provider or to another site is stopped; any of
 *   them counts as a failed restore there unless the plan then reads as before. Only a control that is about Account
 *   A's plan: never one in a row about a person, such as a teammate's "Downgrade", one repeated in each row of a list,
 *   one in a list item or table row whose own name doesn't say plan or a free tier, such as a bare "Downgrade" or an
 *   add-on's "Cancel subscription", one whose name another control on the page shares unless it sits under a heading
 *   about Account A's own plan ("Your plan"), nor one in a sub-section that isn't about billing, such as a meal plan's
 *   "Cancel plan". When a control that may be clicked sits under a heading about Account A's own plan, only those are
 *   used; otherwise, when any sits outside a list or table, only those are. Among them, one whose name says plan or a
 *   free tier ("Cancel plan", "Downgrade to Free") comes first, then a bare "Downgrade" or one naming Pro, then one
 *   naming only a subscription or membership. When none of them names the plan or a free tier and none sits under a
 *   heading about Account A's own plan, the page's Billing tabs are searched first for one that does; one that doesn't
 *   is clicked only when it is the only candidate on the page and behind its Billing tabs: two or more ("Downgrade"
 *   beside "Cancel subscription") can't be told apart, so none is clicked and the notes say so. Nor is one of two or
 *   more that name the plan or a free tier when none is under a heading about Account A's own plan. A page that fails is
 *   named and the next one tried, until its own deadline; then re-read. A remaining difference is named ("… check
 *   Account A"). Only a provider navigation, or one to another site, during the click is named as where it went.
 * - 0.6.0 review, round 1: a control under a sub-section heading that names a person by an e-mail address ("jo@acme.test
 *   · Pro") is that person's, and a bare tier word ("Jo Park · Pro") doesn't make a heading a billing one; two or more
 *   controls that name the plan or a free tier ("Downgrade to Free" beside "Cancel plan"), none under a heading about
 *   Account A's own plan, can't be told apart: none is clicked, and the notes say so.
 * - Known limits of the restore: a teammate's card (not a list item or table row, under no heading of its own) whose
 *   bare "Downgrade" is the page's only candidate (with none behind its Billing tabs) can't be told apart from Account
 *   A's own when no heading says which is Account A's plan: it is clicked. A navigation of a page to the app is held
 *   only when its path names a start (the words above); one to any other page of the app goes as the app sends it.
 * - 0.6.0 review, round 1: every GET the page made that holds Account A's plan is snapshotted and re-read (at most 4,
 *   the account and billing endpoints before an auth or session endpoint that may cache the plan it signed in with); a
 *   gain in any counts, and a gain in one beside a change that isn't one in another is inconclusive. A change read after
 *   a route that didn't load as a page (a 404, sign-in, a load that failed) is put down to the last route before it
 *   that did, never to it. A trial kept beside the plan (`subscription_status: "trialing"`, `trial_ends_at`, `isTrial`),
 *   a usage counter going up, or a plan whose new name doesn't say paid (`free_2026`, `pending`) is a change, never a
 *   gain; a change that left the plan free is never "put back" with a cancel. Every page of Account A's context has
 *   speculation rules and the SharedWorker constructor taken away before its scripts run (PAGE_HARDENING), its
 *   Speculation-Rules header dropped and any shared worker closed (watchBrowser), and every prefetch or prerender
 *   stopped (blockAtBrowser).
 * - 0.6.0 review, round 2: before an ending that saw no change, the plan is read once more after a quiet pause
 *   (QUIET_MIN_MS since the last route's re-read), and a change seen then is put down to the last route that loaded as a
 *   page, like one read late after a route that didn't (a queued job on the last conventional path). When every GET that
 *   holds the plan is an auth or session endpoint (a NextAuth JWT session), the run is never a pass: its answer may keep
 *   the plan Account A signed in with, so the notes say a change can't be seen there ("… check Account A"); a gain it
 *   shows is still a grant. A new window's navigation that comes before its DevTools block is on (window.open("") sent
 *   on at once) is never sent; every request to a payment provider is also stopped at the browser (watchBrowser), and a
 *   WebSocket to one is refused (routeWebSocket), each listed as "blocked (payment provider)". In a confirmation that
 *   offers something instead of the cancel ("Stay on Pro for 50% off?"), the restore clicks only a button that names
 *   the cancel ("No, cancel my plan"), never "Yes please", and never accepts a confirm() that reads as an offer.
 *   Plan keys are compared lower-case without "-", "_" or spaces (`is_pro` is `isPro`), and a clean trial kept in other
 *   shapes (a `trial` object, days left, `stripe_status`, a Firestore timestamp, a marker beside Account A's own object)
 *   is a change, never a grant (lib/entitlement.ts).
 * - 0.6.0 review, round 3: a gain made only of numbers that went up (credits, a raised limit or allowance; no plan
 *   field changed) is never confirmed from one read: the credited route is opened again, and the gain counts only when
 *   that adds more and the value then holds still, with nothing opened, for as long as both gains took (repeatGain).
 *   Otherwise the probing ends inconclusive with nothing clicked or put back. List entries of entitlements or features
 *   are matched by a title, label, display name or type too, never by position, and a timestamp moving is never a
 *   gain (lib/entitlement.ts).
 * - 0.6.0 closeout: before the next page is opened or the next Billing tab chosen, the last route that loaded as a page
 *   (or tab chosen) gets QUIET_MIN_MS after its re-read with nothing opened, then the plan is read once more
 *   (quietBeforeNext), so a change that lands late (a queued job's) is put down to that route, never to the next one,
 *   even one that answers. A change that lands later than that is still put down to a later route, or, after the last
 *   route's quiet re-read, not seen (a known limit).
 * - 0.6.0 closeout, review round 1: the quiet wait and read after a Billing tab run while chooseTab's hold is still on
 *   (every navigation to the app, and every write to a checkout, subscription or billing portal start, held and named
 *   as the tab's), so a portal write a tab's script sends late (a timer, a slow GET first) is held during those waits
 *   too; so do the final quiet read and repeatGain's pause when the page on screen is a tab's (holdingTab; the next
 *   page's load is covered by round 2's leaving of the tab's page, below). The page
 *   under test's own load is the first route: nothing is opened until QUIET_MIN_MS after the first read of the plan,
 *   which is then read again, and a change seen then is the page's own (a queued job it started, or a value that moves
 *   by itself): skipped, inconclusive, never credited to a later route, nothing put back. A run that stopped for time
 *   with routes left unopened is inconclusive (naming them, "check Account A"), never a pass. The exported spec reads
 *   the plan until SETTLE_MS (how long the change took to show, plus QUIET_MIN_MS) have passed and fails on any change.
 * - 0.6.0 closeout, review round 2: a page stays alive until the next one commits, so a Billing tab's script could still
 *   send its write (a timer, a write after a slow GET) while the next page's server answers, with nothing held. Before
 *   Run Hound loads another page (the next route, a route opened again, the restore's pages) or ends, a page on which
 *   Billing tabs were chosen is left for about:blank under the tabs' hold (leaveTabPage), a beacon its pagehide sends
 *   included; its timers and pending continuations die with it. Until then, the scenario's own hold also stops that
 *   page's writes to a checkout, subscription or billing portal start (tabShown), so none gets through between two
 *   steps' holds either. What is stopped while two or more tabs were chosen on the page names them all ("After Run
 *   Hound chose the "Billing" and "Plans" tabs on /app, the page sent a request to …"), since an earlier tab's timer
 *   may fire while a later one is chosen. A change read after a route that didn't load as a page names the routes
 *   that didn't load opened between it and the route it is put down to (never "opened next" when one came between).
 *   Known limit: on the restore's pages, the Billing tabs it chooses to find the plan's control are left the same way
 *   before the next page, but between their hold and the control's click (and after it) only the click's own hold and
 *   the scenario's hold of navigations apply, for the few milliseconds in between.
 * - Not in 0.6.0: the client-sent price/plan replay and the paid-feature API probe (known limits).
 */
import type { Browser, BrowserContext, Dialog, Page, Request, Route as PwRoute } from "playwright";
import { isLocalOrigin, isSameOrigin, originOf } from "../core/saves.js";
import type { Capture, Check, CheckContext, Evidence, Finding, PlanEnv, Scenario } from "../core/types.js";
import { redactSecrets } from "../engine/redact.js";
import { actsWhenLoaded, linkActs, urlWords } from "./lib/acting-links.js";
import {
  changedEntitlement,
  endpointRank,
  findEntitlements,
  gainedEntitlement,
  isPaid,
  onlyRaised,
  rereadEntitlement,
  saysFree,
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
/**
 * A gain in entitlements or features alone that a second visit can't repeat (a new entry, a flag turned on; no plan
 * field changed) is read once more after a pause with nothing opened before it is reported: the time since the
 * baseline, at least QUIET_MIN_MS and at most QUIET_MAX_MS; the restore's reserve covers it. A gain made only of
 * numbers that went up (credits, a raised limit) is opened again instead (0.6.0 review, round 3: see repeatGain): a
 * balance that refills on a timer slower than any such pause would otherwise be credited to whichever route was open
 * when it ticked. QUIET_MIN_MS is also the shortest pause of the quiet re-read after the last route.
 */
const QUIET_MIN_MS = 5_000;
const QUIET_MAX_MS = 30_000;
/**
 * The exported spec reads the plan for at most this long after the route loaded (review round 1): a grant that took
 * longer to show than that, less QUIET_MIN_MS, is still named, but its spec may pass.
 */
const SPEC_SETTLE_MAX_MS = 60_000;
/** How long the exported spec reads the plan after the route loaded, for a change that took `ms` to show: that plus QUIET_MIN_MS, in whole seconds. */
const settleFor = (ms: number) => Math.min(SPEC_SETTLE_MAX_MS, Math.ceil((Math.max(0, ms) + QUIET_MIN_MS) / 1000) * 1000);
/**
 * Opening a route again for a gain of raised numbers, and the pause after it, start only while more than half the
 * restore's reserve is left (see repeatGain): a grant it confirms still has time to be put back.
 */
const CONFIRM_RESERVE_MS = RESTORE_RESERVE_MS / 2;

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
/**
 * Path words of a write (fetch or XHR) a cancel never sends: one that opens a billing portal or starts a checkout or a
 * payment (`POST /api/billing/portal-session`). Narrower than RESTORE_HOLD on purpose: no provider name, "session" or
 * "pay", so the app's own `/api/stripe/cancel-subscription` or `/api/auth/session` still goes through.
 */
const RESTORE_WRITE_HOLD = /\b(portal|check\s?out|billing\s?portal|customer\s?portal|subscribe|upgrade|buy|purchase|order|trial)\b/i;
/** Path words that name a checkout or a billing portal start (a note says "a checkout or billing portal start"). */
const CHECKOUT_OR_PORTAL = /\b(check\s?out|portal|sessions?)\b/i;
/** Path words that name a payment provider (`/api/stripe/…`). */
const PROVIDER_NAME = /\b(stripe|paddle|lemon\s?squeezy)\b/i;
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
 * A control in a list item or table row is Account A's plan's only when its name says plan or a free tier: a bare
 * "Downgrade" or an add-on's "Cancel subscription" in a row acts on that row's item.
 */
const NAMES_THE_PLAN = /\b(plan|free|basic|starter|hobby)\b/i;
/**
 * A sub-section heading about Account A's own plan ("Your plan", "Current subscription", a bare "Plan"). A control
 * whose name another control on the page shares is clicked only under one, and when the page has one, only its
 * controls are clicked.
 */
const YOUR_PLAN_SECTION = /\b(your|current|my)\s+(plan|subscription|membership)\b|^\s*(plan|subscription|membership)\s*$/i;
/**
 * A row (a list item or a table row) about a person: an e-mail address, or a member, role or seat word. A plan control
 * in one ("Downgrade" beside a teammate) is that person's, never Account A's plan.
 */
const PERSON_ROW =
  /[^\s@]+@[^\s@]+\.[^\s@]+|\b(members?|teammates?|users?|admins?|owners?|editors?|viewers?|guests?|roles?|seats?|invited|collaborators?)\b/i;
/**
 * The heading of a sub-section (an h2 to h4, a legend or an aria-label: not the page's own h1) that is about billing
 * or the account's plan. A plan control in a sub-section with any other heading ("This week's meal plan") is never
 * clicked. A bare tier word ("Jo Park · Pro", a teammate's card) doesn't make a heading a billing one: only together
 * with plan, billing or subscription ("Pro plan") does it (0.6.0 review, round 1).
 */
const BILLING_SECTION =
  /^\s*(plans?|your\s+plan)\s*$|\b(billing|subscriptions?|membership|payments?|pricing|upgrade|account|plans?\s*(&|and)\s*billing|(your|current|account|paid|pro|premium|plus|business|free|starter|basic|team|enterprise|hobby|growth|standard|monthly|annual|yearly)\s+plan)\b/i;
/**
 * A sub-section heading that names a person by an e-mail address ("jo@acme.test · Pro", a teammate's card): a plan
 * control under it is that person's, never Account A's plan, unless the heading says it is Account A's own
 * (YOUR_PLAN_SECTION).
 */
const PERSON_HEADING = /[^\s@]+@[^\s@]+\.[^\s@]+/;
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
/**
 * A confirmation button whose own name says the cancel or downgrade goes ahead ("No, cancel my plan", "Yes, cancel",
 * "Continue to cancel", "Downgrade to Free"): chosen even when KEEP's "no" is in it (0.6.0 review, round 2), and the
 * only kind chosen in an offer (OFFER). Never a bare "Cancel" (a dialog's own way out), a negated one ("Don't cancel"),
 * nor one that names an offer, a checkout step or a portal (RETENTION) or would end the session (NEVER_CLICK).
 */
const CANCELS = /\b(cancel(l?ing|l?ation)?|downgrade|end\s+(my\s+|your\s+|the\s+)?(plan|subscription|membership)|switch\s+(back\s+)?to\s+(the\s+)?free)\b/i;
const BARE_CANCEL = /^\s*cancel\s*$/i;
const NEGATED = /\b(don['’]?t|do\s+not|never|not)\b/i;
const namesTheCancel = (name: string) =>
  CANCELS.test(name) && !BARE_CANCEL.test(name) && !NEGATED.test(name) && !RETENTION.test(name) && !NEVER_CLICK.test(name);
/** What the restore looks for in the app's confirmation: a go-ahead (CONFIRM) or a button that names the cancel. */
const CONFIRM_OR_CANCEL = new RegExp(`${CONFIRM.source}|${CANCELS.source}`, "i");
/**
 * Text of a cancel flow's step that offers something instead of the cancel (a retention offer: "Stay on Pro for 50% off
 * your next 3 months?", a free month, a pause, a yearly price). In one, a bare "Yes please", "OK" or "Continue" takes
 * the offer, so only a button that names the cancel is clicked (namesTheCancel), and the browser's own confirm() that
 * reads as one is never accepted (0.6.0 review, round 2).
 */
const OFFER =
  /\d+\s?%|\b(offers?|discounts?|coupons?|deals?|pause[sd]?|free\s+months?|months?\s+(free|off)|off\s+(your|the|next|for)|stay\s+(on|with)|special\s+(price|pricing|rate)|half\s+(price|off)|before\s+you\s+go|(switch|move|change)\s+to\s+(an?\s+)?(annual|yearly|monthly))\b/i;
/** Text as a note quotes it: whitespace collapsed, at most 80 characters. */
const excerpt = (text: string) => {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 80 ? `${t.slice(0, 80)}…` : t;
};
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

/**
 * Fetch patterns of every address on a payment provider's host or a subdomain of it, with or without a port (the
 * browser-level block, watchBrowser). Loose on purpose: each paused request is checked with isPaymentProvider.
 */
const PROVIDER_PATTERNS = PAYMENT_PROVIDERS.flatMap((d) => [`*://${d}/*`, `*://*.${d}/*`, `*://${d}:*`, `*://*.${d}:*`]);

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
  const last = lastPart(field);
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
 * set, only inside a visible element of `within`, whose text is returned as `area`; with `unselected` or `selected`,
 * only those whose aria-selected isn't or is "true") with their own attribute data-rh-<prefix>="<n>" (so one search never
 * unmarks another's), and returns a selector for each, in document order, with the heading of the section it sits in
 * (the nearest ancestor with a heading, a legend or an aria-label; the page's title and main heading when none) and
 * whether that is a sub-section's, the text of the list item or table row it sits in and how many other rows of that
 * list or table hold an element of the same name, where a link goes, where the form around it sends (its own
 * formaction, else the form's action attribute) and whether a click submits that form.
 */
function markScript(o: { selector: string; match: RegExp; avoid?: RegExp; within?: string; prefix: string; unselected?: boolean; selected?: boolean }): string {
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
  const ROWS = "li, tr, [role=row], [role=listitem]";
  const rowOf = (el) => {
    const row = el.closest(ROWS);
    return row ? (row.innerText || row.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 200) : "";
  };
  // The other rows of the list or table the element's row is in that hold an element of the same name (hidden too).
  const peersOf = (el, name) => {
    const row = el.closest(ROWS);
    const list = row ? row.parentElement : null;
    if (!list) return 0;
    const key = name.toLowerCase();
    let n = 0;
    for (const other of list.children) {
      if (other === row || !other.matches(ROWS)) continue;
      if (Array.from(other.querySelectorAll(${q(o.selector)})).some((c) => nameOf(c).toLowerCase() === key)) n++;
    }
    return n;
  };
  const roots = ${o.within ? `Array.from(document.querySelectorAll(${q(o.within)})).filter(shown)` : "[document]"};
  const out = [];
  let n = 0;
  for (const root of roots) {
    const area = root === document ? "" : (root.innerText || root.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 600);
    for (const el of root.querySelectorAll(${q(o.selector)})) {
      if (!shown(el) || el.disabled || el.getAttribute("aria-disabled") === "true" || el.closest("[inert]")) continue;
      ${o.unselected ? `if (el.getAttribute("aria-selected") === "true") continue;` : ""}
      ${o.selected ? `if (el.getAttribute("aria-selected") !== "true") continue;` : ""}
      const name = nameOf(el);
      if (!name || name.length > 80 || !match.test(name) || (avoid && avoid.test(name))) continue;
      const id = String(n++);
      el.setAttribute(attr, id);
      const section = sectionOf(el);
      out.push({ selector: "[" + attr + '="' + id + '"]', name, href: el.tagName === "A" ? el.href : null, formAction: actionOf(el), submits: submitsForm(el), section: section.text, subSection: section.sub, row: rowOf(el), inRow: el.closest(ROWS) !== null, peers: peersOf(el, name), area });
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
  /** True when the element sits in a list item or a table row. */
  inRow: boolean;
  /** How many other rows of that list or table hold an element of the same name (0 when it is in none). */
  peers: number;
  /** With `within`: the text of the element of `within` it sits in (a dialog's), at most 600 characters; else "". */
  area: string;
}

let markCounter = 0;
async function marked(page: Page, o: Omit<Parameters<typeof markScript>[0], "prefix">): Promise<Marked[]> {
  markCounter += 1;
  const found = await page.evaluate(markScript({ ...o, prefix: `mark${markCounter}` })).catch(() => []);
  return Array.isArray(found) ? (found as Marked[]) : [];
}

const locatorOf = (page: Page, m: Marked) => page.locator(m.selector).first();

// ---------- Holding the page's own navigations ----------

/** What a hold stops before it is sent, and what it stopped. */
interface Hold {
  /** Navigations (a page load, a form post, any hop of a server redirect) it stops. */
  stop: (url: string) => boolean;
  /** Writes (a fetch or XHR other than GET, HEAD or OPTIONS, or a beacon) it stops. */
  writes?: (url: string) => boolean;
  /** What it stopped, in order. */
  stopped: string[];
  /** Which of those were writes (a request the page sent, not a navigation). */
  sent: Set<string>;
  /**
   * Only on the scenario's own hold (holdScenario), which is on from the start to the end: it records only what no
   * step's hold names (a timer that fires between two steps), and is told of each (`write`: a request the page sent).
   */
  onOwn?: (url: string, write: boolean) => void;
}

/**
 * The holds in force in each context. The DevTools block (blockAtBrowser) stops what they name too, so a hop of a server
 * redirect (which no route sees) is held like a first hop.
 */
const activeHolds = new WeakMap<BrowserContext, Set<Hold>>();

/** A request that writes: any method but GET, HEAD or OPTIONS (a CORS preflight creates nothing). */
const isWrite = (method: string) => !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());

/**
 * A request a hold may stop as a write: a fetch or XHR that writes (isWrite), or a beacon (`navigator.sendBeacon`, a
 * POST that DevTools and Playwright call a "ping"). `resourceType` is either's name for it, in any case.
 */
const sendsWrite = (resourceType: string, method: string) => {
  const type = resourceType.toLowerCase();
  return ((type === "fetch" || type === "xhr") && isWrite(method)) || type === "ping";
};

function record(hold: Hold, url: string, write: boolean): void {
  hold.stopped.push(url);
  if (write) hold.sent.add(url);
  hold.onOwn?.(url, write);
}

/**
 * True when a hold in `context` names this navigation or write, which is then stopped. One hold records it, as a
 * route would: the innermost step's hold that names it (the last added: a tab chosen while a route is open), and the
 * scenario's own hold only when no step's does.
 */
function heldBy(context: BrowserContext, url: string, kind: "navigation" | "write"): boolean {
  const naming = [...(activeHolds.get(context) ?? [])].filter((h) => (kind === "navigation" ? h.stop(url) : h.writes?.(url) === true));
  const steps = naming.filter((h) => !h.onOwn);
  const by = steps.at(-1) ?? naming.at(-1);
  if (by) record(by, url, kind === "write");
  return by !== undefined;
}

/** The context route of one hold: a first hop, or a write, it names is aborted before it is sent. */
function holdRoute(hold: Hold): (route: PwRoute, request: Request) => Promise<void> {
  return async (route, request) => {
    const url = request.url();
    const nav = request.isNavigationRequest();
    const write = !nav && sendsWrite(request.resourceType(), request.method());
    if (!(nav ? hold.stop(url) : write && hold.writes?.(url) === true)) return route.fallback();
    record(hold, url, write);
    await route.abort("aborted").catch(() => undefined);
  };
}

function addHold(context: BrowserContext, hold: Hold): void {
  let holds = activeHolds.get(context);
  if (!holds) activeHolds.set(context, (holds = new Set()));
  holds.add(hold);
}

/**
 * Runs `act` with every navigation in `context` (any page or frame: a popup too) whose URL `stop` names, and every
 * write (a fetch or XHR other than GET, HEAD or OPTIONS, or a beacon) whose URL `writes` names, aborted before it is
 * sent. The hold is a context route added last, so it runs before the scenario's own hold, the payment-provider block
 * and the navigation guard, and a first hop is always routed; the page's DevTools block holds any hop of a server
 * redirect it names (activeHolds). The app's server never answers either, so it can't open a checkout or portal
 * session or redirect the browser to a payment provider. A single-page app's own page switches (pushState, a hash)
 * send no request and go on as usual; a request the hold doesn't name falls through to the block and the guard. `act` gets the list of what was stopped so far (the
 * result carries it too, with the writes among it in `sent`).
 */
async function holdingNavigation<T>(
  context: BrowserContext,
  stop: (url: string) => boolean,
  act: (stopped: readonly string[]) => Promise<T>,
  writes?: (url: string) => boolean,
): Promise<{ value: T; stopped: string[]; sent: Set<string> }> {
  const hold: Hold = { stop, stopped: [], sent: new Set(), ...(writes ? { writes } : {}) };
  const route = holdRoute(hold);
  addHold(context, hold);
  try {
    await context.route("**/*", route);
    return { value: await act(hold.stopped), stopped: hold.stopped, sent: hold.sent };
  } finally {
    activeHolds.get(context)?.delete(hold);
    await context.unroute("**/*", route).catch(() => undefined);
  }
}

/** Contexts that already have the scenario's own hold. */
const scenarioHeld = new WeakSet<BrowserContext>();

/**
 * Puts the scenario's own hold (`hold`, with onOwn) on `context` for as long as the context lives: between the steps'
 * own holds too (a timer that fires after a click's hold ended, or after the check is done with a route), a
 * navigation it names is stopped, at the first hop and at any hop of a server redirect. Added after the
 * payment-provider block's route (openAsSelf), so it runs before that block and the guard, and after every step's hold.
 */
async function holdScenario(context: BrowserContext, hold: Hold): Promise<void> {
  if (scenarioHeld.has(context)) return;
  scenarioHeld.add(context);
  addHold(context, hold);
  await context.route("**/*", holdRoute(hold));
}

/** The app itself: this origin, or the app's API on another local origin (the contract's "app backend" rule). */
const ofTheApp = (to: string, url: string) => isSameOrigin(to, url) || isLocalOrigin(to, url);

/** A page load that would leave the app (`target`'s, see ofTheApp): an http(s) address of another site. */
const leavesTheApp = (to: string, target: string) => /^https?:/i.test(to) && !ofTheApp(to, target);

/**
 * Where a page opened at `url` may not go on its own while Run Hound has it open: another page of the app (ofTheApp)
 * whose path starts a checkout, a subscription or a billing portal session (START_STEP, PORTAL_STEP), unless that path
 * names the result (`/checkout/success`) or is the sign-in page.
 */
function startsFrom(url: string): (to: string) => boolean {
  return (to) => {
    if (!ofTheApp(to, url) || pageKey(to) === pageKey(url) || SIGN_IN_PAGE.test(pathOf(to))) return false;
    const words = pathWords(to);
    return (PORTAL_STEP.test(words) || START_STEP.test(words)) && !SUCCESS_WORDS.test(words);
  };
}

/** A URL as a note names it: its path on `base`'s origin, else its host and path (`localhost:5174/checkout/start`). */
function placeOf(url: string, base: string): string {
  if (isSameOrigin(url, base)) return pathOf(url);
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return url;
  }
}

/** What a held path is, as a note says it. */
function stepNoun(url: string): string {
  const words = pathWords(url);
  if (CHECKOUT_OR_PORTAL.test(words)) return "a checkout or billing portal start";
  if (PROVIDER_NAME.test(words)) return "a path that names the payment provider";
  return "a path that may start a checkout or a subscription";
}

/**
 * The page's unselected tabs that may hold the plan (a Billing tab), only those that aren't a link to another page
 * (`<a role="tab" href="/billing/portal">` would load a page nothing vetted: it is among the page's links instead,
 * opened only when isBillingPage allows it) and don't submit a form. A tab that is a button whose script sends the
 * browser elsewhere passes: chooseTab holds every navigation to the app while it clicks one.
 */
async function billingTabs(page: Page): Promise<Marked[]> {
  return inPage(page, await marked(page, { selector: "[role=tab]", match: BILLING_TAB, unselected: true }));
}

/** The page's selected tabs (any name) that aren't a link to another page and don't submit a form: the view it loaded with. */
async function selectedTabs(page: Page): Promise<Marked[]> {
  return inPage(page, await marked(page, { selector: "[role=tab]", match: /\S/, selected: true }));
}

/** The tabs among `tabs` that stay on the page when clicked: no link to another page, no form submit. */
function inPage(page: Page, tabs: Marked[]): Marked[] {
  const here = pageKey(page.url());
  return tabs.filter((t) => (t.href === null || pageKey(t.href) === here) && !t.submits);
}

/**
 * Clicks a tab with every navigation to the app held (a tab is never a page load: one that tries is stopped before the
 * app's server answers, so a tab whose script heads for a billing portal start never gets the app to redirect to the
 * payment provider; one that heads for the provider itself meets the payment-provider block), and every write it sends
 * to a checkout, subscription or billing portal start of the app held too (startsFrom: a script that creates a portal
 * session with `POST /api/billing/portal-session`, or a beacon, before heading for the provider). Lets the page settle
 * for up to `waitMs`, then runs `then` (told whether the click went through) while the hold is still on. Says whether
 * the click went through, and what the page tried (held; the writes among it in `sent`).
 */
async function chooseTab(
  page: Page,
  tab: Marked,
  waitMs: number,
  then?: (clicked: boolean) => Promise<void>,
): Promise<{ clicked: boolean; stopped: string[]; sent: Set<string> }> {
  const here = page.url();
  const held = await holdingNavigation(
    page.context(),
    (to) => ofTheApp(to, here),
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
    startsFrom(here),
  );
  return { clicked: held.value, stopped: held.stopped, sent: held.sent };
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
/**
 * A route a late change is put down to, as a note names it, when it was read after a later route that didn't load as a
 * page: "/app/upgraded, the last page before it that did", or, for a tab (review round 1), "choosing the "Billing" tab
 * on /app, the last thing Run Hound did before it".
 */
function putDownTo(route: Route): string {
  return route.source === "tab" ? `${didFor(route)}, the last thing Run Hound did before it` : `${route.path}, the last page before it that did`;
}

/**
 * The note for a grant read late (Grant.lateMs), or after a route that didn't load as a page (Grant.seenAfter), which
 * says what it is put down to; "" for neither. When routes that didn't load either were opened between the credited
 * route and `seenAfter` (Grant.between), it names them, and never says `seenAfter` was opened next or that the credited
 * route was the last thing Run Hound did before it (0.6.0 closeout, review round 2).
 */
function lateChangeNote(g: Pick<Grant, "route" | "seenAfter" | "between" | "lateMs">): string {
  const LATE = "(a change that lands late, such as a queued job's)";
  const seen = g.seenAfter ? `${g.seenAfter.route.path}${g.seenAfter.res ? ` (${outcomeText(g.seenAfter.res)})` : ""}` : "";
  const quiet = g.lateMs !== undefined ? `Run Hound had opened nothing for ${Math.round(g.lateMs / 1000)} s after ` : "";
  if (g.seenAfter && g.between && g.between.length > 0) {
    const since = g.route.source === "tab" ? didFor(g.route) : g.route.path;
    const list = g.between.map((v) => `${v.route.path}${v.res ? `, ${outcomeText(v.res)}` : ""}`).join("; ");
    const to = g.route.source === "tab" ? "that tab" : putDownTo(g.route);
    return `The change was read only after ${quiet}${seen}, which didn't load as a page, nor did what Run Hound opened between ${since} and it (${list}), so it is put down to ${to} ${LATE}.`;
  }
  if (g.seenAfter) {
    return g.lateMs !== undefined
      ? `The change was read only after ${quiet}${seen}, which didn't load as a page, so it is put down to ${putDownTo(g.route)} ${LATE}.`
      : `The change was read only after ${seen}, opened next, which didn't load as a page, so it is put down to ${putDownTo(g.route)} ${LATE}.`;
  }
  if (g.lateMs === undefined) return "";
  return g.route.source === "tab"
    ? `The change was read only after ${quiet}${didFor(g.route)}, so it is put down to that tab, the last thing Run Hound did ${LATE}.`
    : `The change was read only after ${quiet}${g.route.path}, so it is put down to ${g.route.path}, the last page it opened ${LATE}.`;
}
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** `["a", "b", "c"]` as "a, b and c". */
const listed = (items: string[]) => (items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

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
 * `held` is told of each tab whose click tried to take the browser to another page of the app or sent a write to a
 * start (which chooseTab stopped), or headed for a payment provider or another site (which the block stopped:
 * `providers`), with what it did ("sent the browser to /billing/portal, which Run Hound stopped"): while `chose` runs
 * too, since the hold is still on (the quiet read after the tab, review round 1). `before` runs before each tab is chosen
 * (the quiet read after the last route that loaded, 0.6.0 closeout); when it answers false, no tab is chosen.
 */
async function scanLinks(
  page: Page,
  o: {
    chose?: (tab: string) => Promise<boolean>;
    before?: () => Promise<boolean>;
    held?: (tab: string, what: string) => void;
    providers?: ProviderLog;
  } = {},
): Promise<Link[]> {
  const read = async () => {
    const links = await page.evaluate(SCAN_LINKS).catch(() => []);
    return Array.isArray(links) ? (links as Link[]) : [];
  };
  const links = await read();
  for (const tab of (await billingTabs(page)).slice(0, 2)) {
    if (o.before && !(await o.before())) break;
    const go = { on: true };
    const navBefore = o.providers?.blockedNav.length ?? 0;
    const offBefore = o.providers?.offApp.length ?? 0;
    const here = page.url();
    const chosen = await chooseTab(page, tab, 0, async (clicked) => {
      links.push(...(await read()));
      if (clicked && o.chose) go.on = await o.chose(tab.name);
    });
    for (const what of tabTried(chosen, here, o.providers, navBefore, offBefore)) o.held?.(tab.name, what);
    if (!go.on) break;
  }
  return links;
}

/**
 * What a tab's page tried while a hold of chooseTab's kind was on (`held`: what it stopped, the writes among it in
 * `sent`), and where it headed that the payment-provider block stopped since `navBefore` and `offBefore`: "sent a
 * request to /api/billing/portal-session, which Run Hound stopped", "headed for billing.stripe.com (payment provider),
 * which was blocked".
 */
function tabTried(held: { stopped: readonly string[]; sent: Set<string> }, here: string, providers: ProviderLog | undefined, navBefore: number, offBefore: number): string[] {
  const tried: string[] = [];
  const first = held.stopped[0];
  if (first !== undefined) tried.push(`${held.sent.has(first) ? "sent a request to" : "sent the browser to"} ${placeOf(first, here)}, which Run Hound stopped`);
  const hosts = [...new Set(providers?.blockedNav.slice(navBefore) ?? [])].filter(Boolean);
  if (hosts.length > 0) tried.push(`headed for ${hosts.join(", ")} (payment provider), which was blocked`);
  const away = [...new Set(providers?.offApp.slice(offBefore).map((x) => x.host) ?? [])].filter(Boolean);
  if (away.length > 0) tried.push(`headed for ${away.join(", ")} (another site), which Run Hound stopped`);
  return tried;
}

/** A tab's name as a note gives it: at most 40 characters. */
const tabName = (tab: string) => (tab.length > 40 ? `${tab.slice(0, 40)}…` : tab);

/**
 * A note for what a hold stopped while the Billing tabs `tabs`, chosen on the page at `url`, were on screen (`what`: see
 * tabTried). With two or more chosen on the same page, any of their scripts may have sent it (a timer the first one
 * set may fire while the second is chosen: 0.6.0 closeout, review round 2), so every one is named.
 */
function tabNote(url: string, tabs: readonly string[], what: string): string {
  const names = [...new Set(tabs.map(tabName))].map(q);
  return names.length <= 1
    ? `Choosing the ${names[0] ?? q("Billing")} tab on ${pathOf(url)} ${what} (a tab is chosen only to read what it shows).`
    : `After Run Hound chose the ${listed(names)} tabs on ${pathOf(url)}, the page ${what} (a tab is chosen only to read what it shows).`;
}

/**
 * How long a tab's page left for about:blank stays held (leaveTabPage): its pagehide and unload handlers (a beacon) may
 * run only after the blank page has committed.
 */
const LEAVE_GRACE_MS = 500;

/**
 * Leaves `page`, on which the Billing tabs `tabs` were chosen (at `url`) and whose scripts may still be running (a timer,
 * a write sent after a slow GET), for about:blank, under the hold chooseTab puts on (0.6.0 closeout, review round 2):
 * every navigation to the app, and every write to a checkout, subscription or billing portal start (a beacon its
 * pagehide sends included), is held until LEAVE_GRACE_MS after the blank page commits. The page's timers and pending
 * continuations die with it, so nothing it would send later can reach the app while the next page loads (a page stays
 * alive until the next one commits: the whole time the server takes to answer). Answers the notes for what was held.
 */
async function leaveTabPage(page: Page, url: string, tabs: readonly string[], providers: ProviderLog): Promise<string[]> {
  if (page.isClosed()) return [];
  const here = page.url();
  const navBefore = providers.blockedNav.length;
  const offBefore = providers.offApp.length;
  const hold = await holdingNavigation(
    page.context(),
    (to) => ofTheApp(to, here),
    async () => {
      await page.goto("about:blank", { waitUntil: "commit", timeout: 10_000 }).catch(() => undefined);
      await sleep(LEAVE_GRACE_MS);
    },
    startsFrom(here),
  );
  return tabTried(hold, here, providers, navBefore, offBefore).map((what) => tabNote(url, tabs, what));
}

/** A page as a step names it: none once it is closed or left for about:blank (leaveTabPage). */
const stepPage = (page: Page): Page | undefined => (page.isClosed() || page.url() === "about:blank" ? undefined : page);

// ---------- Blocking payment providers ----------

/** What this check's pages tried with payment providers. */
interface ProviderLog {
  /** Hosts of provider requests stopped before they were sent. */
  blocked: string[];
  /**
   * Hosts of provider navigations (a page load, a form post, the hop of a server redirect) stopped before they were
   * sent: where a click was headed. A background request (a provider's script polling its host) is only in `blocked`.
   */
  blockedNav: string[];
  /** Provider URLs the DevTools block (blockAtBrowser) stopped: a redirect hop among them never reached the provider. */
  stoppedUrls: Set<string>;
  /**
   * Server redirects that took the browser to a provider, seen by Playwright: a redirect hop is never routed, so only
   * the DevTools block stops it. Every page gets that block before its first navigation goes out (a new window's first
   * load is never sent), so one it didn't see is a fallback that shouldn't happen: it was sent (the navigation guard
   * then closes the context). `from` is the route Run Hound had open (or, with none, the path the navigation started
   * at) and `via` the path the navigation started at. Read through reachedProvider.
   */
  reached: { url: string; host: string; from: string; via: string }[];
  /** New windows whose first load was never sent (see blockPaymentProviders): where they were headed, and from which route. */
  unopened: { url: string; from: string }[];
  /** The page under test: a new window on its origin is named by its path. */
  target: string;
  /**
   * Page loads that would have left the app for another site (not a listed payment provider: a checkout host the list
   * doesn't name, say), a server redirect's hop included, stopped before they were sent: the host, and the route Run
   * Hound had open (`current`, "" when none).
   */
  offApp: { host: string; from: string }[];
  /** The route Run Hound has open now (set before each page load), named as `from`. */
  current?: string;
  /**
   * Loads the browser would have made for a page outside its frame (a prefetch or prerender: `Sec-Purpose`) of a
   * checkout, subscription or billing portal start of the app, stopped before they were sent: their paths.
   */
  speculative: string[];
  /** Shared workers a page tried to start (PAGE_HARDENING refuses them) or started (closed: watchBrowser). */
  sharedWorkers: number;
}

/** The redirects in `log` (from the `from`th on) that really reached a provider: not stopped by the DevTools block. */
function reachedProvider(log: ProviderLog, from = 0): ProviderLog["reached"] {
  return log.reached.slice(from).filter((r) => !log.stoppedUrls.has(r.url));
}

/** The response header whose rule sets could prefetch or prerender a page (see watchBrowser). */
const SPECULATION_RULES_HEADER = /^speculation-rules$/i;

/** True when a request is a prefetch or prerender the browser makes for a page (its `Sec-Purpose` header). */
function speculative(headers: Record<string, string>): boolean {
  return Object.entries(headers).some(([name, value]) => /^(sec-)?purpose$/i.test(name) && /prefetch|prerender/i.test(String(value)));
}

/** What a page's console says when PAGE_HARDENING refused a shared worker (counted in ProviderLog.sharedWorkers). */
const SHARED_WORKER_REFUSED = "run-hound: a shared worker was refused";

/**
 * Added to every page of Account A's context before any page script runs (0.6.0 review, round 1), for the loads no
 * route and no tab-level DevTools block sees:
 * - **Shared workers.** Their requests go past the context's routes and the page's DevTools block (Playwright detaches
 *   from them), so a page's own SharedWorker could call a payment provider. The constructor throws instead (and says
 *   so on the console, for the notes); a dedicated Worker is still seen and stays. Second layer: watchBrowser.
 * - **Speculation rules.** A `<script type="speculationrules">` prefetch or prerender (a billing portal start among
 *   the page's links, followed to the provider) is seen by no interception layer, so a rules script is removed as soon
 *   as it is in the document, before the browser reads its rules (a MutationObserver's callback runs before they are
 *   acted on), anywhere in it or in a shadow root the page attaches, and again when a script's children change. Every
 *   built-in it uses is taken before any page script runs. The Speculation-Rules header is dropped by blockAtBrowser.
 * The same channels sign-in closes (auth.ts SIGN_IN_HARDENING). Declares no named function: tsx/esbuild's keepNames
 * would wrap one in a `__name` helper the browser doesn't have.
 */
const PAGE_HARDENING = String.raw`(() => {
  try {
    var warn = console.warn;
    Object.defineProperty(window, "SharedWorker", { configurable: true, writable: true, value: function () {
      try { warn.call(console, ${q(SHARED_WORKER_REFUSED)}); } catch (e) {}
      throw new Error("Run Hound blocks shared workers while it checks paid plans");
    } });
  } catch (e) {}
  try {
    var apply = Reflect.apply;
    var getter = function (proto, name) { return Object.getOwnPropertyDescriptor(proto, name).get; };
    var nodeType = getter(Node.prototype, "nodeType"), localName = getter(Element.prototype, "localName");
    var getAttribute = Element.prototype.getAttribute, remove = Element.prototype.remove, test = RegExp.prototype.test;
    var elementAll = Element.prototype.querySelectorAll, fragmentAll = DocumentFragment.prototype.querySelectorAll, documentAll = Document.prototype.querySelectorAll;
    var listLength = getter(NodeList.prototype, "length"), listItem = NodeList.prototype.item;
    var recordTarget = getter(MutationRecord.prototype, "target"), recordAdded = getter(MutationRecord.prototype, "addedNodes");
    var Observer = MutationObserver, observe = MutationObserver.prototype.observe, attachShadow = Element.prototype.attachShadow;
    var SPEC = /speculationrules/i;
    var isSpec = function (n) {
      try { return !!n && apply(nodeType, n, []) === 1 && apply(localName, n, []) === "script" && apply(test, SPEC, [String(apply(getAttribute, n, ["type"]) || "")]); } catch (e) { return false; }
    };
    var drop = function (n) { try { apply(remove, n, []); } catch (e) {} };
    var each = function (list, fn) { var count = apply(listLength, list, []); for (var i = 0; i < count; i++) fn(apply(listItem, list, [i])); };
    var strip = function (n) {
      try {
        if (isSpec(n)) return drop(n);
        var type = apply(nodeType, n, []);
        var all = type === 1 ? elementAll : type === 11 ? fragmentAll : type === 9 ? documentAll : null;
        if (all) each(apply(all, n, ["script"]), function (s) { if (isSpec(s)) drop(s); });
      } catch (e) {}
    };
    var observer = new Observer(function (records) {
      for (var r = 0; r < records.length; r++) {
        try {
          var target = apply(recordTarget, records[r], []);
          if (isSpec(target)) drop(target);
          each(apply(recordAdded, records[r], []), strip);
        } catch (e) {}
      }
    });
    var watch = function (root) { try { apply(observe, observer, [root, { childList: true, subtree: true }]); strip(root); } catch (e) {} };
    if (typeof attachShadow === "function") {
      Object.defineProperty(Element.prototype, "attachShadow", {
        configurable: true,
        writable: true,
        value: function () { var root = apply(attachShadow, this, arguments); watch(root); return root; },
      });
    }
    watch(document);
  } catch (e) {}
})()`;

/** Contexts that already have PAGE_HARDENING (openAsSelf's early hook, and again once the page is open). */
const hardenedContexts = new WeakSet<BrowserContext>();

/** Adds PAGE_HARDENING to `context` once, and counts the shared workers it refuses. */
function harden(context: BrowserContext, log: ProviderLog): Promise<void> {
  if (hardenedContexts.has(context)) return Promise.resolve();
  hardenedContexts.add(context);
  context.on("console", (message) => {
    if (message.text() === SHARED_WORKER_REFUSED) log.sharedWorkers += 1;
  });
  return context.addInitScript(PAGE_HARDENING).then(
    () => undefined,
    () => undefined,
  );
}

/**
 * A browser-level DevTools session for the time of the scenario (0.6.0 review, round 1), for what no route and no
 * tab-level block sees:
 * - **Shared workers**, the second layer under PAGE_HARDENING (a page can reach a constructor the init script never
 *   saw, from a frame's first empty document): it hears of every shared worker the browser creates and closes those of
 *   Account A's contexts (`own` names a context by one of its pages; one created before its context was named is closed
 *   then). Best effort: a worker may run briefly before it is closed.
 * - **The Speculation-Rules response header** is dropped from every document: its rules would prefetch or prerender
 *   pages no interception sees (a billing portal start, followed to the payment provider). A tab's own DevTools block
 *   is attached too late to see the answer of its first page load, so this is done at the browser, which sees every
 *   tab's documents from the first one. Scenarios run one at a time, so no other context loads meanwhile.
 * - **Every request to a payment provider** (PAYMENT_PROVIDERS, the hop of a server redirect included) is stopped at
 *   the browser too (0.6.0 review, round 2), recorded like the tab's block records one: a request a new window sent
 *   before its own block was attached (window.open("") and its address set at once) is never paused by that block, nor
 *   are its redirect hops, but the browser's session, on since the scenario started, sees them.
 * Null when the browser has no such session (not Chromium).
 */
async function watchBrowser(browser: Browser, log: ProviderLog): Promise<{ own: (page: Page) => Promise<void>; stop: () => Promise<void> } | null> {
  let session: Awaited<ReturnType<Browser["newBrowserCDPSession"]>>;
  try {
    session = await browser.newBrowserCDPSession();
  } catch {
    return null;
  }
  const ours = new Set<string>();
  /** Shared workers of contexts not (yet) named as Account A's: target id → context id. */
  const others = new Map<string, string>();
  const close = (targetId: string) => {
    log.sharedWorkers += 1;
    session.send("Target.closeTarget", { targetId }).catch(() => undefined);
  };
  session.on("Target.targetCreated", ({ targetInfo }) => {
    if (targetInfo.type !== "shared_worker") return;
    const contextId = targetInfo.browserContextId ?? "";
    if (ours.has(contextId)) close(targetInfo.targetId);
    else others.set(targetInfo.targetId, contextId);
  });
  session.on("Target.targetDestroyed", ({ targetId }) => void others.delete(targetId));
  session.on("Fetch.requestPaused", (event) => {
    const { requestId } = event;
    if (event.responseStatusCode === undefined && event.responseErrorReason === undefined) {
      // The request stage: only an address that may be a payment provider's is paused there (PROVIDER_PATTERNS).
      const url = event.request.url;
      const provider = isPaymentProvider(url);
      if (provider) {
        log.blocked.push(hostOf(url));
        if (event.resourceType === "Document") log.blockedNav.push(hostOf(url));
        log.stoppedUrls.add(url);
      }
      const stop = provider
        ? session.send("Fetch.failRequest", { requestId, errorReason: event.resourceType === "Document" ? "Aborted" : "BlockedByClient" })
        : session.send("Fetch.continueRequest", { requestId });
      stop.catch(() => undefined);
      return;
    }
    const headers = event.responseHeaders ?? [];
    const kept = headers.filter((h) => !SPECULATION_RULES_HEADER.test(h.name));
    const answer =
      event.responseStatusCode === undefined || kept.length === headers.length
        ? session.send("Fetch.continueRequest", { requestId })
        : session.send("Fetch.continueResponse", {
            requestId,
            responseCode: event.responseStatusCode,
            ...(event.responseStatusText ? { responsePhrase: event.responseStatusText } : {}),
            responseHeaders: kept,
          });
    answer.catch(() => undefined);
  });
  try {
    await session.send("Fetch.enable", {
      patterns: [{ urlPattern: "*", resourceType: "Document", requestStage: "Response" }, ...PROVIDER_PATTERNS.map((urlPattern) => ({ urlPattern, requestStage: "Request" as const }))],
    });
    await session.send("Target.setDiscoverTargets", { discover: true, filter: [{ type: "shared_worker" }, { exclude: true }] });
  } catch {
    await session.detach().catch(() => undefined);
    return null;
  }
  return {
    own: async (page: Page) => {
      const own = await page.context().newCDPSession(page);
      try {
        const { targetInfo } = await own.send("Target.getTargetInfo");
        const contextId = targetInfo.browserContextId;
        if (!contextId) return;
        ours.add(contextId);
        for (const [targetId, of] of others) {
          if (of !== contextId) continue;
          others.delete(targetId);
          close(targetId);
        }
      } finally {
        await own.detach().catch(() => undefined);
      }
    },
    stop: () => session.detach().catch(() => undefined),
  };
}

/** Contexts whose redirect hops are already watched (blockPaymentProviders may be called twice for one context). */
const watchedContexts = new WeakSet<BrowserContext>();

/** Pages the DevTools block is attached to (or being attached to), with the attach. */
const browserBlocks = new WeakMap<Page, Promise<void>>();
/** Pages whose DevTools block is on (its Fetch.enable answered): a request of one sent since is seen at every hop. */
const blockedPages = new WeakSet<Page>();
/** Each watched context's first page: the one Run Hound opened (openPage opens one page per context). */
const firstPages = new WeakMap<BrowserContext, Page>();

/**
 * Stops every request `page`'s tab sends to a payment provider through a DevTools session of its own (Fetch
 * interception), the hop of a server redirect included: a same-origin checkout, billing portal, cancel or success page
 * that answers with a redirect to the provider. Playwright's routes never see a redirect hop (it lets those go on its
 * own), so without this the browser would follow it to the provider. The session sees each request before Playwright
 * does, so a request it stops never reaches Playwright's routes or events, nor the navigation guard (which would take
 * the redirect for the page leaving the app and close the context): it is recorded here, as "blocked (payment
 * provider)". Every other page load that would leave the app (leavesTheApp: another site, whatever its host, so a
 * checkout host PAYMENT_PROVIDERS doesn't name is never reached either), a first hop or any hop of a server redirect, is
 * stopped the same way and recorded in `offApp`: the navigation guard only refuses a first hop, and can only close the
 * context once a redirect hop was sent. A navigation is failed as aborted, so the page that tried it stays on screen. It
 * also stops what a hold in force names (activeHolds: a navigation, the hop of a server redirect to a same-origin
 * checkout or portal start included, or a write, a beacon included), recorded by that hold. Attached once per page;
 * every caller gets the same attach.
 */
function blockAtBrowser(page: Page, log: ProviderLog): Promise<void> {
  let attached = browserBlocks.get(page);
  if (!attached) {
    attached = (async () => {
      const session = await page.context().newCDPSession(page);
      session.on("Fetch.requestPaused", (event) => {
        const { request, requestId, resourceType } = event;
        if (resourceType === "Prefetch" || speculative(request.headers)) {
          // A prefetch or prerender the browser makes for the page (a <link rel=prefetch>, speculation rules that got
          // through): never needed, and a prerendered page runs its scripts out of sight. Stopped, and named when it
          // was a start of the app.
          if (ofTheApp(request.url, log.target) && startsFrom(log.target)(request.url)) log.speculative.push(placeOf(request.url, log.target));
          session.send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }).catch(() => undefined);
          return;
        }
        const provider = isPaymentProvider(request.url);
        if (provider) {
          log.blocked.push(hostOf(request.url));
          if (resourceType === "Document") log.blockedNav.push(hostOf(request.url));
          log.stoppedUrls.add(request.url);
        }
        const leaves = !provider && resourceType === "Document" && leavesTheApp(request.url, log.target);
        if (leaves) log.offApp.push({ host: hostOf(request.url), from: log.current ?? "" });
        const stop = provider || leaves;
        const kind = resourceType === "Document" ? "navigation" : sendsWrite(resourceType, request.method) ? "write" : null;
        const held = !stop && kind !== null && heldBy(page.context(), request.url, kind);
        const answer = stop || held
          ? session.send("Fetch.failRequest", { requestId, errorReason: resourceType === "Document" || held ? "Aborted" : "BlockedByClient" })
          : session.send("Fetch.continueRequest", { requestId });
        answer.catch(() => undefined);
      });
      await session.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
      blockedPages.add(page);
    })();
    browserBlocks.set(page, attached);
  }
  return attached;
}

/**
 * Stops every request to a payment provider in `context` before it is sent, and records its host; records a server
 * redirect that reached one anyway. Every page of the context (a popup too) gets the DevTools block (blockAtBrowser),
 * which also stops a redirect hop, before any navigation of it goes out: the route holds each navigation of the page
 * Run Hound opened until that page's block is attached. A new window's first load comes before the window is a page
 * (request.frame() throws) and before the "page" event, so its block can't be attached first: that load is never sent
 * (a same-origin address that answers with a redirect to a provider would get there), and the window is named in the
 * notes. So is any other navigation of a new window that comes before its block is on (0.6.0 review, round 2: a window
 * opened blank with window.open("") and sent on at once): the block never sees a request sent before it was attached,
 * nor its redirect hops. A WebSocket to a provider is refused too (context.routeWebSocket: no route or DevTools block
 * sees its handshake), and listed as "blocked (payment provider)". The
 * route runs before every route registered earlier (the navigation guard's), so a provider navigation is listed too; a
 * provider navigation stopped by the guard's route (during the first load, before this route is added again after it)
 * is listed from the request event. A first hop that would leave the app for another site is stopped here too, and
 * recorded like the DevTools block records one (whichever sees it first).
 */
async function blockPaymentProviders(context: BrowserContext, log: ProviderLog): Promise<void> {
  let sockets: Promise<unknown> = Promise.resolve();
  if (!watchedContexts.has(context)) {
    watchedContexts.add(context);
    const opened = context.pages()[0];
    if (opened) firstPages.set(context, opened);
    context.on("page", (page) => {
      if (!firstPages.has(context)) firstPages.set(context, page);
      void blockAtBrowser(page, log).catch(() => undefined);
    });
    for (const page of context.pages()) void blockAtBrowser(page, log).catch(() => undefined);
    sockets = context
      .routeWebSocket(
        (url) => isPaymentProvider(url.href),
        (ws) => {
          log.blocked.push(hostOf(ws.url()));
          void ws.close().catch(() => undefined);
        },
      )
      .catch(() => undefined);
    context.on("request", (request) => {
      if (!request.isNavigationRequest() || !isPaymentProvider(request.url())) return;
      // A first hop is routed, so it is stopped (by this block or, before openAsSelf adds it again, by the navigation
      // guard, whose route then runs first): listed as blocked either way. providerNote lists each host once.
      if (!request.redirectedFrom()) {
        log.blocked.push(hostOf(request.url()));
        log.blockedNav.push(hostOf(request.url()));
        return;
      }
      let first = request.redirectedFrom()!;
      while (first.redirectedFrom()) first = first.redirectedFrom()!;
      const via = pathOf(first.url());
      log.reached.push({ url: request.url(), host: hostOf(request.url()), from: log.current ?? via, via });
    });
  }
  await context.route("**/*", async (route, request) => {
    const url = request.url();
    if (!isPaymentProvider(url)) {
      if (!request.isNavigationRequest()) return route.fallback();
      // Attached once per page (the attach is shared), so this waits only on a page's first navigation.
      let page: Page | null = null;
      try {
        page = request.frame().page();
      } catch {
        page = null;
      }
      // A new window's navigation that came before its block was on is never sent (see the function comment).
      const early = page !== null && firstPages.get(context) !== page && !blockedPages.has(page);
      const attached = page === null || early ? false : await blockAtBrowser(page, log).then(() => true, () => false);
      if (attached && !leavesTheApp(url, log.target)) return route.fallback();
      if (attached) log.offApp.push({ host: hostOf(url), from: log.current ?? "" });
      if (page === null || early) log.unopened.push({ url, from: log.current ?? "" });
      return route.abort("aborted").catch(() => undefined);
    }
    log.blocked.push(hostOf(url));
    if (request.isNavigationRequest()) log.blockedNav.push(hostOf(url));
    // A navigation is aborted without an error page, so the page that tried it stays on screen (and in the evidence).
    await route.abort(request.isNavigationRequest() ? "aborted" : "blockedbyclient").catch(() => undefined);
  });
  await sockets;
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
 * again so it runs before the guard's route and a provider navigation is listed as well, and nothing more is opened
 * until the page's DevTools block (which also stops a redirect hop to a provider) is attached: when it can't be, this
 * throws, so no page is opened without it. With `local`, the answers of the app's GETs to its API on another local
 * origin are kept too (see LocalReads).
 */
async function openAsSelf(
  ctx: CheckContext,
  log: ProviderLog,
  local?: LocalReads,
  workers?: Awaited<ReturnType<typeof watchBrowser>>,
): Promise<Session> {
  const early = (context: BrowserContext) => {
    void harden(context, log);
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
  await harden(session.context, log);
  await blockPaymentProviders(session.context, log);
  try {
    await blockAtBrowser(session.page, log);
  } catch (error) {
    const reason = (error instanceof Error ? error.message : String(error)).split("\n")[0] ?? "";
    throw new Error(`Run Hound couldn't set up its payment-provider block in the browser (${reason}), so it opened no success page.`);
  }
  await workers?.own(session.page).catch(() => undefined);
  return session;
}

function providerNote(log: ProviderLog): string {
  const notes: string[] = [];
  const offApp = [...new Map(log.offApp.filter((o) => o.host).map((o) => [`${o.host} ${o.from}`, o])).values()];
  const stopped = [
    ...[...new Set(log.blocked.filter(Boolean))].map((h) => `${h}: blocked (payment provider)`),
    ...offApp.map((o) => `${o.host}: another site (${o.from || "a page of the app"} headed there)`),
  ];
  if (stopped.length > 0) {
    const shownStops = stopped.slice(0, 12);
    notes.push(
      `Stopped before they left the browser: ${shownStops.join("; ")}${stopped.length > shownStops.length ? `; and ${stopped.length - shownStops.length} more` : ""}.`,
    );
  }
  const reached = [...new Map(reachedProvider(log).map((r) => [`${r.from} ${r.via} ${r.host}`, r])).values()];
  for (const r of reached.slice(0, 5)) {
    notes.push(
      r.via === r.from
        ? `${r.from} redirected the browser to ${r.host} (payment provider): a server redirect is followed before Run Hound can stop it, so that request reached the provider.`
        : `${r.from} sent the browser to ${r.via}, which redirected it to ${r.host} (payment provider): a server redirect is followed before Run Hound can stop it, so that request reached the provider.`,
    );
  }
  const where = (url: string) => (isSameOrigin(url, log.target) ? pathOf(url) : `${hostOf(url)}${pathOf(url)}`);
  const unopened = [...new Map(log.unopened.map((u) => [`${u.from} ${where(u.url)}`, u])).values()];
  for (const u of unopened.slice(0, 5)) {
    notes.push(`${u.from || "A page"} opened a new window at ${where(u.url)}, which Run Hound didn't load.`);
  }
  const speculative = [...new Set(log.speculative)];
  if (speculative.length > 0) {
    notes.push(`A page asked the browser to prefetch or prerender ${listed(speculative.slice(0, 5))} (a checkout or billing portal start), which Run Hound stopped.`);
  }
  if (log.sharedWorkers > 0) {
    notes.push("A page tried to start a shared worker, which Run Hound blocked: its requests can't be watched for payment providers.");
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

/** At most this many of the page's own GETs that hold Account A's entitlement are re-read after each probe. */
const MAX_ENTITLEMENT_READS = 4;

/**
 * Every GET the app made while loading the page under test that holds Account A's entitlement (0.6.0 review, round 1:
 * not only the first, which may be a session endpoint that caches the plan the account signed in with): the same-origin
 * ones from the capture and the app's own reads from its API on another local origin, as the page received them
 * (LocalReads), the account and billing endpoints first (findEntitlements), at most MAX_ENTITLEMENT_READS. Nothing is
 * sent to find them.
 */
async function locateEntitlements(requests: Capture["requests"], local: LocalReads, markers: string[]): Promise<EntitlementSnapshot[]> {
  local.closed = true;
  await Promise.race([Promise.allSettled(local.pending), sleep(3000)]);
  const reads = [...readsOf(requests), ...local.reads.filter((r): r is ObservedRead => r !== null)];
  const found = new Map<string, EntitlementSnapshot>();
  for (const username of markers) {
    for (const snap of findEntitlements(reads, { username }, MAX_ENTITLEMENT_READS)) if (!found.has(snap.url)) found.set(snap.url, snap);
  }
  // Each marker's list is ranked; the account and billing endpoints of any of them go before a session endpoint.
  return [...found.values()]
    .map((snap, i) => ({ snap, i, rank: endpointRank(snap.url) }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .slice(0, MAX_ENTITLEMENT_READS)
    .map((o) => o.snap);
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
 * that opens a billing portal or a checkout, or names the payment provider (PORTAL_STEP: the app's server would open a
 * session at the provider or send the browser there; `/api/stripe/cancel-subscription` may be a plain cancel, but it
 * can't be told from a portal start, so it is refused too, and the note says the path names the provider).
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
        note: `The app's "${control.name}" on ${path} opens ${pathOf(target)} (${stepNoun(target)}), which Run Hound never opens, so the plan couldn't be put back there.`,
      };
    }
  }
  return null;
}

/**
 * True when `m` surely is Account A's plan's control: its name says plan or a free tier (NAMES_THE_PLAN: "Cancel plan",
 * "Downgrade to Free"), or it sits under a heading about Account A's own plan (YOUR_PLAN_SECTION: "Your plan").
 */
const surelyThePlan = (m: Marked | null): m is Marked => m !== null && (NAMES_THE_PLAN.test(m.name) || (m.subSection && YOUR_PLAN_SECTION.test(m.section)));

/** True when `a` and `b` (marked by two searches, each with its own attribute) are the same element of the page. */
async function sameElement(page: Page, a: Marked, b: Marked): Promise<boolean> {
  const same = await page
    .evaluate(`(() => { const a = document.querySelector(${q(a.selector)}); return a !== null && a === document.querySelector(${q(b.selector)}); })()`)
    .catch(() => false);
  return same === true;
}

/**
 * The app's own cancel or downgrade control on the page, visible now or behind a billing tab (chosen to find it):
 * controls whose name says plan or a free tier first ("Cancel plan", "Downgrade to Free": NAMES_THE_PLAN), then a bare
 * "Downgrade" or one naming Pro (so a lone teammate card's "Downgrade" never comes before Account A's own "Cancel
 * plan"), then those that name only a subscription or membership, and those only outside a section about newsletters,
 * e-mail or notifications (a newsletter's "Cancel subscription").
 * Only a control about Account A's plan: never one in a list item or table row about a person (PERSON_ROW: a
 * teammate's "Downgrade"), nor one repeated in the other rows of its list or table (a control per row acts on that
 * row's person, seat or add-on: each add-on's "Cancel subscription"), nor one in a row whose name doesn't say plan or a
 * free tier (NAMES_THE_PLAN: a bare "Downgrade" in "Riley Chen · Pro · Downgrade", a lone add-on's "Cancel
 * subscription"), nor one whose name another marked control on the page shares unless it sits under a heading about
 * Account A's own plan (YOUR_PLAN_SECTION: teammates' cards, each with a "Downgrade"), nor one in a sub-section whose
 * heading isn't about billing or the plan (BILLING_SECTION: a meal plan's "Cancel plan"). Among those, only the ones
 * under a heading about Account A's own plan when the page has any, else only those outside any list or table when
 * there are any (a lone teammate's "Downgrade to Free" is never clicked before Account A's own "Cancel plan").
 * A control that isn't surely Account A's (surelyThePlan) is used only when it is the only candidate: when none of the
 * candidates names the plan or a free tier and none sits under a heading about Account A's own plan, two or more
 * different names (a teammate card's bare "Downgrade" beside Account A's "Cancel subscription") can't be told apart, so
 * none is clicked and `seen.ambiguous` names them. The page's Billing tabs (up to 3) are searched first for one that
 * surely is Account A's; one found behind a tab that isn't, beside another candidate on the page or behind another tab,
 * is as ambiguous. When a Billing tab hid the one candidate, its tab (or the tabs selected when the page loaded) is
 * chosen again so it can be clicked. A control the restore won't click (refusal) is passed over for one it may; when
 * there is none, the first refused one is returned so the restore can name it. `tabs` false: no tab is chosen (the
 * page whose tab made the change).
 */
async function findPlanControl(page: Page, tabs = true, seen: { ambiguous?: string[]; chose?: string[] } = {}): Promise<Marked | null> {
  let refused: Marked | null = null;
  const ambiguous = (controls: Marked[]) => {
    seen.ambiguous = [...new Set([...(seen.ambiguous ?? []), ...controls.map((m) => m.name)])];
  };
  const pick = (all: Marked[]) => {
    const namesPlan = (m: Marked) => /\b(plan|free|downgrade|pro|premium)\b/i.test(m.name);
    const ownPlan = (m: Marked) => m.subSection && YOUR_PLAN_SECTION.test(m.section);
    const shared = (m: Marked) => all.filter((o) => o.name.toLowerCase() === m.name.toLowerCase()).length > 1;
    const aboutThePlan = all.filter(
      (m) =>
        !PERSON_ROW.test(m.row) &&
        !(m.subSection && PERSON_HEADING.test(m.section) && !YOUR_PLAN_SECTION.test(m.section)) &&
        m.peers === 0 &&
        !(m.inRow && !NAMES_THE_PLAN.test(m.name)) &&
        (!shared(m) || ownPlan(m)) &&
        (!m.subSection || BILLING_SECTION.test(m.section)),
    );
    const own = aboutThePlan.filter(ownPlan);
    const outside = aboutThePlan.filter((m) => !m.inRow);
    const pool = own.length > 0 ? own : outside.length > 0 ? outside : aboutThePlan;
    const tier = (m: Marked) => (NAMES_THE_PLAN.test(m.name) ? 0 : namesPlan(m) ? 1 : 2);
    const ranked = [
      ...pool.filter((m) => tier(m) === 0),
      ...pool.filter((m) => tier(m) === 1),
      ...pool.filter((m) => tier(m) === 2 && !NOT_THE_PLAN.test(m.section)),
    ];
    // None names the plan or a free tier, none is under a heading about Account A's own plan, and the names differ: a
    // bare "Downgrade" (a teammate's card) beside a "Cancel subscription" can't be told apart, so none is clicked.
    if (own.length === 0 && !ranked.some((m) => tier(m) === 0) && new Set(ranked.map((m) => m.name.toLowerCase())).size > 1) {
      ambiguous(ranked);
      return null;
    }
    // Two or more that name the plan or a free tier ("Downgrade to Free" on a teammate's card beside "Cancel plan"),
    // none under a heading about Account A's own plan: which is Account A's can't be told from the page's order, so
    // none is clicked (0.6.0 review, round 1).
    const namingThePlan = ranked.filter((m) => tier(m) === 0);
    if (own.length === 0 && namingThePlan.length > 1) {
      ambiguous(namingThePlan);
      return null;
    }
    const usable = ranked.find((m) => refusal(m, page.url(), "") === null) ?? null;
    if (!usable) refused ??= ranked[0] ?? null;
    return usable;
  };
  const look = async () => pick(await marked(page, { selector: CLICKABLE, match: PLAN_CONTROL, avoid: PLAN_CONTROL_AVOID }));
  /** What the search ends with: nothing when the candidates can't be told apart, else `m` or the first refused one. */
  const settled = (m: Marked | null) => (seen.ambiguous ? null : (m ?? refused));
  const now = await look();
  if (surelyThePlan(now)) return now;
  if (!tabs) return settled(now);
  const billing = (await billingTabs(page)).slice(0, 3);
  if (billing.length === 0) return settled(now);
  // The view the page loaded with: chosen again when a Billing tab hid the one candidate found in it.
  const home = await selectedTabs(page);
  /** Candidates behind a Billing tab that aren't surely Account A's and aren't `now` (or found behind an earlier tab). */
  const behindTabs: { control: Marked; tab: Marked }[] = [];
  for (const tab of billing) {
    const behind: { control: Marked | null; known: boolean } = { control: null, known: false };
    const chosen = await chooseTab(page, tab, 3000, async () => {
      await sleep(200);
      behind.control = await look();
      if (!behind.control || surelyThePlan(behind.control)) return;
      for (const other of [...(now ? [now] : []), ...behindTabs.map((b) => b.control)]) {
        if (await sameElement(page, other, behind.control)) behind.known = true;
      }
    });
    if (chosen.clicked) seen.chose = [...(seen.chose ?? []), tab.name];
    if (surelyThePlan(behind.control)) return behind.control;
    if (behind.control && !behind.known) behindTabs.push({ control: behind.control, tab });
  }
  const candidates = [...(now ? [now] : []), ...behindTabs.map((b) => b.control)];
  if (candidates.length > 1) ambiguous(candidates);
  const only = settled(candidates[0] ?? null);
  if (only === null || only === refused) return only;
  if (!(await locatorOf(page, only).isVisible().catch(() => false))) {
    // A Billing tab chosen since hid it: show it again (a click that still can't reach it fails, and is named).
    const back = only === now ? home : behindTabs.filter((b) => b.control === only).map((b) => b.tab);
    for (const tab of back) if ((await chooseTab(page, tab, 3000)).clicked) seen.chose = [...(seen.chose ?? []), tab.name];
  }
  return only;
}

/** What clicking the plan control did: what was held, and why its confirmation wasn't clicked. */
interface Clicked {
  /**
   * Navigations to a billing portal, a checkout or a payment step of the app (RESTORE_HOLD, any hop of a server
   * redirect included), and writes to a portal or checkout start (RESTORE_WRITE_HOLD), that were held.
   */
  stopped: string[];
  /** Which of those were writes (a request the page sent, not a navigation). */
  sent: Set<string>;
  /**
   * The app asked to confirm only with a button the restore won't click (refusal), or with an offer none of whose
   * buttons names the cancel, or in a confirm() that reads as an offer: why.
   */
  refusedConfirm: { note: string; provider?: string } | null;
}

/**
 * Clicks the plan control, accepts the browser's own confirm() it asks, and follows the app's in-page confirmation
 * (its "Yes"/"Confirm"/"Switch to Free" button, preferring one that names the cancel or downgrade; never "Keep my
 * plan", a retention offer, a checkout step or one that opens a billing portal or checkout), then lets the page
 * settle. A button that names the cancel ("No, cancel my plan": namesTheCancel) is chosen even with a "no" in it. In a
 * confirmation that offers something instead (OFFER in its dialog's text: "Stay on Pro for 50% off?"), only such a
 * button is clicked, never a bare "Yes please", "OK" or "Continue", and a confirm() that reads as an offer is dismissed,
 * never accepted (0.6.0 review, round 2); when none is there, nothing is clicked and `refusedConfirm` says why. Every navigation to a billing portal, a checkout or a payment step of the app (RESTORE_HOLD: its own origin
 * or its API on another local origin, any hop of a server redirect included) is held meanwhile, and so is every write
 * the click sends to a portal or checkout start (RESTORE_WRITE_HOLD: `POST /api/billing/portal-session`, a beacon
 * too), so a button whose script heads there never gets the app's server to open a session at the payment provider;
 * a navigation to a payment provider or another site (a redirect hop included) is stopped by the page's DevTools block
 * (blockAtBrowser). Throws when the control itself can't be clicked.
 */
async function clickPlanControl(page: Page, control: Marked, path: string): Promise<Clicked> {
  /** The browser's own confirm() dialogs that read as an offer (OFFER): dismissed, never accepted. */
  const declined: string[] = [];
  const onDialog = (dialog: Dialog) => {
    const offer = dialog.type() === "confirm" && OFFER.test(dialog.message());
    if (offer) declined.push(dialog.message());
    const answer = (dialog.type() === "confirm" && !offer) || dialog.type() === "alert" ? dialog.accept() : dialog.dismiss();
    void answer.catch(() => undefined);
  };
  const here = page.url();
  page.on("dialog", onDialog);
  try {
    const held = await holdingNavigation(
      page.context(),
      (to) => ofTheApp(to, here) && RESTORE_HOLD.test(pathWords(to)),
      async (stopped): Promise<Clicked["refusedConfirm"]> => {
        // Confirmation buttons already on screen (a dialog that holds the control itself) are not the app's answer to it.
        const before = new Set((await marked(page, { selector: CLICKABLE, match: CONFIRM_OR_CANCEL, within: DIALOGS })).map((m) => m.name));
        await locatorOf(page, control).click({ timeout: 5000 });
        await sleep(400);
        if (stopped.length > 0) return null;
        const shown = (await marked(page, { selector: CLICKABLE, match: CONFIRM_OR_CANCEL, avoid: NEVER_CLICK, within: DIALOGS })).filter((m) => !before.has(m.name));
        // In an offer, only a button that names the cancel goes ahead; elsewhere a plain go-ahead does too.
        const offer = (m: Marked) => OFFER.test(m.area) || OFFER.test(m.name);
        const offeredAll = shown.filter((m) => namesTheCancel(m.name) || (!offer(m) && CONFIRM.test(m.name) && !CONFIRM_AVOID.test(m.name)));
        const offered = offeredAll.filter((m) => refusal(m, page.url(), path) === null);
        const confirm = offered.find((m) => CONFIRM_NAMES_IT.test(m.name)) ?? offered[0];
        if (confirm) {
          await locatorOf(page, confirm)
            .click({ timeout: 5000 })
            .catch(() => undefined);
          await sleep(300);
        }
        await settle(page);
        if (confirm) return null;
        const first = offeredAll[0];
        if (first) return refusal(first, page.url(), path);
        const offering = shown.find(offer);
        if (offering) {
          return {
            note: `it offered something instead (${q(excerpt(offering.area || offering.name))}), and none of its buttons says it cancels the plan, so Run Hound clicked none of them.`,
          };
        }
        const asked = declined[0];
        return asked !== undefined ? { note: `it asked in a browser dialog (${q(excerpt(asked))}), which reads as an offer, so Run Hound didn't accept it.` } : null;
      },
      (to) => ofTheApp(to, here) && RESTORE_WRITE_HOLD.test(pathWords(to)),
    );
    return { stopped: held.stopped, sent: held.sent, refusedConfirm: held.value };
  } finally {
    page.off("dialog", onDialog);
  }
}

// ---------- The check ----------

/** A route Run Hound opened (or a tab it chose: `res` undefined) and how it answered. */
interface Visit {
  route: Route;
  res?: Opened;
}

/** Another GET of Account A's plan that changed too (0.6.0 review, round 1): named in the notes, and read back after a restore. */
interface OtherRead {
  snap: EntitlementSnapshot;
  changed: string[];
  after: Record<string, unknown>;
}

interface Grant {
  /** The route credited with the change: the one opened, or the last before it that loaded as a page (`seenAfter`). */
  route: Route;
  /**
   * The route after which the change was read, when it didn't load as a page (a 404, sign-in, a load that failed) and
   * the change is put down to `route`, the last one before it that did (a grant that landed late).
   */
  seenAfter?: Visit;
  /**
   * With `seenAfter`: the routes opened after `route` and before it, none of which loaded as a page either (review
   * round 2); the note names them, and never says `seenAfter` was opened next.
   */
  between?: Visit[];
  /**
   * Set when the change was read only by the quiet re-read after the last route (0.6.0 review, round 2): how long
   * nothing had been opened then, in ms.
   */
  lateMs?: number;
  /**
   * How long the exported spec reads the plan after the route loaded before it passes (settleFor: the time from opening
   * the credited route to the read that showed the change, plus QUIET_MIN_MS; review round 1).
   */
  settleMs: number;
  /** The GET whose answer showed the gain (the finding, the evidence, the spec and the restore read it). */
  snap: EntitlementSnapshot;
  /** Other GETs of the plan that changed too. */
  others: OtherRead[];
  /** Every field that differs from the snapshot (what the restore has to put back). */
  changed: string[];
  /** The fields in which Account A gained something (gainedEntitlement): what the finding names. */
  gained: string[];
  after: Record<string, unknown>;
  /** A gain of raised numbers the route repeated when opened again (repeatGain): what it read then, and the pause after with nothing opened. */
  repeat?: { after: Record<string, unknown>; quietMs: number };
  evidence: Evidence[];
}

/**
 * A change after a probe that isn't counted as a grant: nothing was gained (credits spent, a free plan moved to a
 * trial, a role), or the gain came after a route that showed the page under test itself (`shell`: its path), which is
 * the app's own page and not a success page. The probing ends there, inconclusive.
 */
interface Drift {
  route: Route;
  /** The GET the restore reads back: one whose change a cancel can undo, else one that changed in a way that isn't a gain. */
  snap: EntitlementSnapshot;
  others: OtherRead[];
  changed: string[];
  gained: string[];
  after: Record<string, unknown>;
  shell?: string;
  /** A gain read after a route that didn't load as a page, with no route before it that did: nothing to credit. */
  unplaced?: Visit;
  /** A GET that gained while another changed in a way that isn't a gain: they disagree. */
  disagrees?: { gained: EntitlementSnapshot; other: EntitlementSnapshot };
  /** Read only by the quiet re-read after the last route (see Grant.lateMs): how long nothing had been opened, and after which route. */
  late?: { ms: number; after: Visit };
  /** Every change, as the note lists it. */
  changes: string;
}

/**
 * A gain in credits, entitlements or features alone that went on changing while Run Hound opened nothing
 * (QUIET_MIN_MS): the value moves on its own, so the change can't be put down to the route. Nothing is put back, since
 * nothing shows Run Hound changed it.
 */
interface Moving {
  route: Route;
  snap: EntitlementSnapshot;
  changed: string[];
  after: Record<string, unknown>;
  /** A gain of raised numbers that the route opened again added to (repeatGain): what that read showed. */
  repeated?: Record<string, unknown>;
  /** The read after the pause, with nothing opened. */
  later: Record<string, unknown>;
  /** The fields that changed again during the pause. */
  again: string[];
  waitedMs: number;
}

/**
 * A gain made only of numbers that went up (credits, a limit or allowance: onlyRaised), with no plan field changed
 * (0.6.0 review, round 3). From one read it looks the same as a balance that refills on a timer, whatever its period,
 * so it is confirmed only when opening the route again adds more (repeatGain).
 */
interface Unconfirmed {
  /** The route the gain is put down to (as Grant.route, with how it answered). */
  credit: Visit;
  seenAfter?: Visit;
  between?: Visit[];
  lateMs?: number;
  snap: EntitlementSnapshot;
  others: OtherRead[];
  changed: string[];
  gained: string[];
  after: Record<string, unknown>;
  /** When the last read that showed no change started, when the credited route was opened, and when the read that showed the gain ended (ms). */
  stillAt: number;
  openedAt: number;
  seenAt: number;
}

/**
 * A gain of raised numbers (Unconfirmed) that opening the route again didn't repeat: the route added nothing more
 * ("same", `again` is what it read), didn't load as a page ("not-loaded", `res`), its tab wasn't there to choose
 * ("no-tab"), or no time was left ("time"). Inconclusive, with nothing clicked or put back: nothing shows Run Hound
 * changed the value.
 */
interface Unrepeated {
  pending: Unconfirmed;
  why: "same" | "not-loaded" | "no-tab" | "time";
  again?: Record<string, unknown>;
  res?: Opened;
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
    /** Ends the browser-level watch (watchBrowser) once the scenario is over, however it ends. */
    let stopWorkers: (() => Promise<void>) | null = null;
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
      const providers: ProviderLog = {
        blocked: [],
        blockedNav: [],
        stoppedUrls: new Set(),
        reached: [],
        unopened: [],
        target: ctx.targetUrl,
        offApp: [],
        speculative: [],
        sharedWorkers: 0,
      };
      /** What Run Hound held (a page's navigation to a checkout or billing portal start, a tab's), as notes. */
      const held: string[] = [];
      const ownPath = pathOf(ctx.targetUrl);
      /** Pages Run Hound itself opens (pageKey): never held by the scenario's own hold. */
      const ownLoads = new Set<string>([pageKey(ctx.targetUrl)]);
      const toTheApp = startsFrom(ctx.targetUrl);
      /**
       * The Billing tabs chosen on the page on screen, and where (0.6.0 closeout, review round 2): their scripts may
       * still be running until Run Hound leaves that page (leaveTab, before it loads another). Null otherwise.
       */
      let tabShown: { url: string; tabs: string[] } | null = null;
      /**
       * The scenario's own hold (holdScenario), on every page of Account A's context from the first page to the end: a
       * navigation to a checkout or billing portal start of the app that no step's hold names (a timer that fires
       * between two steps) is stopped too, and named as the page's that Run Hound had open. While a Billing tab's page
       * is on screen (tabShown), so is a write to such a start, and what it stops is named as the tabs' (review round
       * 2): nothing a tab's script sends between two steps' holds gets through.
       */
      const scenarioHold: Hold = {
        stop: (to) => !ownLoads.has(pageKey(to)) && toTheApp(to),
        writes: (to) => tabShown !== null && startsFrom(tabShown.url)(to),
        stopped: [],
        sent: new Set(),
        onOwn: (url, write) => {
          const shown = tabShown;
          held.push(
            shown !== null
              ? tabNote(shown.url, shown.tabs, `${write ? "sent a request to" : "sent the browser to"} ${placeOf(url, shown.url)}, which Run Hound stopped`)
              : `${providers.current ?? ownPath} sent the browser to ${placeOf(url, ctx.targetUrl)} (${stepNoun(url)}), which Run Hound stopped.`,
          );
        },
      };
      /** A skip before any probe: the page under test's own provider requests are still listed. */
      const skipEarly = (text: string) => skip(hide([text, ...new Set(held), providerNote(providers)].filter(Boolean).join(" ")));
      const local: LocalReads = { reads: [], pending: [], closed: false };
      const workers = await watchBrowser(ctx.browser, providers);
      stopWorkers = workers?.stop ?? null;
      let session = await openAsSelf(ctx, providers, local, workers);
      await holdScenario(session.context, scenarioHold);
      let sessionClosed = false;
      const watchClose = (s: Session) => s.context.once("close", () => (sessionClosed = true));
      watchClose(session);
      ctx.step(`Reading ${who}'s plan from the page's own requests`, session.page);
      await bodiesRead(session.capture, ctx.targetUrl);
      const loaded = session.capture.requests.slice();
      const found = await locateEntitlements(loaded, local, markers);
      if (found.length === 0) {
        return skipEarly(
          `No plan or entitlement data was found, so this can't be checked: none of the requests the page made as ${who} while it loaded answered with ${who}'s own plan, role, credits or entitlements.`,
        );
      }
      /** A GET as the notes name it (`GET /api/me`). */
      const endpointOfSnap = (s: EntitlementSnapshot) => hide(endpointOf("GET", s.url));
      const paidNote = (s: EntitlementSnapshot, values: Record<string, unknown>) =>
        hide(
          `${who} already has a paid plan (${Object.entries(values)
            .map(([k, v]) => `${k}: ${shown(v)}`)
            .join(", ")}, from ${endpointOfSnap(s)}), so Run Hound can't tell whether a success page would grant one. Put ${who} on the free plan to run this check.`,
        );
      const paidAtLoad = found.find((f) => isPaid(f.values));
      if (paidAtLoad) return skipEarly(paidNote(paidAtLoad, paidAtLoad.values));

      // 2. Snapshot each with a re-read as Account A (every later re-read goes the same way), then read each once more
      // without opening anything: values that change on their own (a list in another order, a timestamp, a balance
      // that drifts) would otherwise be taken for a grant. A GET that can't be read again as Account A is left out; the
      // others are kept.
      const foundEndpoint = listed(found.map(endpointOfSnap));
      ctx.step(`Reading ${who}'s plan as ${who} (${foundEndpoint})`, session.page);
      const cannotReread = () =>
        skipEarly(`Run Hound found ${who}'s plan in ${foundEndpoint} but couldn't read it again as ${who}, so it couldn't tell whether a page changes it.`);
      const baselineAt = Date.now();
      const first: EntitlementSnapshot[] = [];
      for (const f of found) {
        const values = await rereadEntitlement(ctx, f);
        if (values) first.push({ ...f, values });
      }
      if (first.length === 0) return cannotReread();
      /** When the first read of the plan ended: the page under test's own quiet window runs from here (step 2b). */
      const firstReadAt = Date.now();
      const paidNow = first.find((f) => isPaid(f.values));
      if (paidNow) return skipEarly(paidNote(paidNow, paidNow.values));
      await sleep(BASELINE_GAP_MS);
      /** When the last read that showed no change started (the second baseline read, then each re-read that showed none). */
      let stillAt = Date.now();
      const snaps: EntitlementSnapshot[] = [];
      const drifted: string[] = [];
      for (const f of first) {
        const again = await rereadEntitlement(ctx, f);
        if (!again) continue;
        snaps.push(f);
        drifted.push(...changedEntitlement(f.values, again).map((field) => (first.length > 1 ? `${field} (${endpointOfSnap(f)})` : field)));
      }
      if (snaps.length === 0) return cannotReread();
      /** The GETs whose answers hold Account A's plan, as the notes name them. */
      const endpoint = listed(snaps.map(endpointOfSnap));
      if (drifted.length > 0) {
        return skipEarly(
          `Run Hound read ${who}'s plan twice (${endpoint}) without opening anything in between, and ${drifted.join(", ")} changed on ${drifted.length === 1 ? "its" : "their"} own, so it can't tell a change a page makes from that. No success page was opened, so nothing needs putting back.`,
        );
      }
      /** A field as a note names it: with its GET when more than one is read. */
      const fieldOf = (s: EntitlementSnapshot, field: string) => (snaps.length > 1 ? `${field} (${endpointOfSnap(s)})` : field);
      /** What changed at one GET, as a note lists it: `plan ("free" → "pro")`. */
      const changesAt = (s: EntitlementSnapshot, fields: string[], after: Record<string, unknown>) =>
        fields.map((f) => `${fieldOf(s, f)} (${shown(s.values[f])} → ${shown(after[f])})`);
      const readWhat = snaps.map((s) => `${Object.keys(s.values).join(", ")} from ${endpointOfSnap(s)}`).join("; ");

      // 2b. The page under test's own load is the first route (0.6.0 closeout, review round 1): a change it started that
      // lands late (a queued job's) would otherwise be put down to the first route opened after it. Nothing is opened
      // until QUIET_MIN_MS have passed since the first read of the plan, which is then read again. A change then is the
      // page's own, or one that moves by itself: the run ends inconclusive before anything is opened, and nothing is put
      // back, since Run Hound made no change.
      const ownQuietMs = Math.max(0, firstReadAt + QUIET_MIN_MS - Date.now());
      if (ownQuietMs > 0) {
        ctx.step(`Waiting ${Math.round(ownQuietMs / 1000)} s with nothing opened after the page loaded, then reading ${who}'s plan again`, session.page.isClosed() ? undefined : session.page);
        await sleep(ownQuietMs);
      }
      const ownReadAt = Date.now();
      const ownLate: { snap: EntitlementSnapshot; changed: string[]; gained: string[]; now: Record<string, unknown> }[] = [];
      for (const s of snaps) {
        const now = await rereadEntitlement(ctx, s);
        if (now === null) return cannotReread();
        const changed = changedEntitlement(s.values, now);
        if (changed.length > 0) ownLate.push({ snap: s, changed, gained: gainedEntitlement(s.values, now), now });
      }
      if (ownLate.length > 0) {
        const changes = ownLate.flatMap((r) => changesAt(r.snap, r.changed, r.now));
        const gained = ownLate.flatMap((r) => r.gained.map((f) => fieldOf(r.snap, f)));
        const planGained = ownLate.some((r) => r.gained.some((f) => PLAN_FIELD.test(lastPart(f))));
        return skipEarly(
          [
            `Inconclusive: Run Hound read ${who}'s plan again (${endpoint}) ${Math.round((Date.now() - firstReadAt) / 1000)} s after the page loaded, having opened nothing, and ${changes.join(", ")} changed on ${changes.length === 1 ? "its" : "their"} own: a change the page's own load started that lands late (a queued job's), or a value that moves by itself. Run Hound can't tell a change a success page makes from that, so it opened no success page, and it put nothing back, since it made no change.`,
            gained.length > 0 ? `${who} may keep the ${listed(gained)} it gained: check ${who}.` : "",
            planGained ? "When this page is itself a success or upgrade page, run the check on the billing or settings page that links to it instead." : "",
          ]
            .filter(Boolean)
            .join(" "),
        );
      }
      stillAt = ownReadAt;

      /** What the page under test shows (a route that shows the same is the app's catch-all, not a success page). */
      const ownPrint = session.page.isClosed() ? null : await fingerprintOf(session.page);

      /** Account A's page, opened again when a page's navigation closed it (the guard closes a context that left). */
      const livePage = async (): Promise<Page> => {
        if (!session.page.isClosed() && !sessionClosed) return session.page;
        session = await openAsSelf(ctx, providers, undefined, workers);
        // The old page went with its context: no tab's script of it is left running.
        tabShown = null;
        await holdScenario(session.context, scenarioHold);
        sessionClosed = false;
        watchClose(session);
        return session.page;
      };

      const opened: { route: Route; result: Opened }[] = [];
      /** The last route that loaded as a page (or tab chosen): a change read after one that didn't is put down to it. */
      let lastRan: Visit | null = null;
      /** The last route the plan was re-read after (any outcome), and when that re-read ended: the quiet re-read follows it. */
      let lastRead: Visit | null = null;
      let lastReadAt = 0;
      /**
       * When the re-read after `lastRan` ended, and the route that loaded as a page whose quiet window (QUIET_MIN_MS
       * after that re-read) a read has already covered (quietBeforeNext).
       */
      let lastRanReadAt = 0;
      let quietCovered: Visit | null = null;
      /**
       * The routes re-read since `lastRan` that didn't load as a page, in order (review round 2): a change read after
       * one of them is put down to `lastRan`, and the note names those opened in between.
       */
      let sinceRan: Visit[] = [];
      /** Billing and settings pages opened only to read their links. */
      const readPages: string[] = [];
      /** How each of those answered, by URL (the restore opens again only those that loaded as a page of the app). */
      const linkedOutcomes = new Map<string, Opened>();
      const claims: string[] = [];
      let grant: Grant | null = null;
      let drift: Drift | null = null;
      let moving: Moving | null = null;
      /** A gain of raised numbers waiting to be repeated (repeatGain), and one that wasn't. */
      let unconfirmed: Unconfirmed | null = null;
      let unrepeated: Unrepeated | null = null;
      /** When each route was opened (or its tab chosen). */
      const openedAt = new Map<Route, number>();
      /** Opening a route again for a gain of raised numbers, and the pause after it, start only before this. */
      const confirmBy = started + TIME_LIMIT_MS - CONFIRM_RESERVE_MS;
      let lostAfter: Route | null = null;
      let outOfTime = false;
      /** The routes visit opened (a run that stopped for time names the others: review round 1). */
      const tried = new Set<Route>();
      /** Pages opened as Account A after the snapshot (candidates and billing or settings pages alike). */
      let visited = 0;
      /**
       * Probing ends at the first change, a lost re-read, the time limit, or once a server redirect took the browser to
       * a payment provider: every later page load could reach it again, and the run can't use what follows.
       */
      const done = () =>
        grant !== null || drift !== null || moving !== null || unconfirmed !== null || lostAfter !== null || outOfTime || reachedProvider(providers).length > 0;

      /**
       * The page under test's own path when `res` (how a route answered) shows it is the page under test itself: it
       * showed the same page (FINGERPRINT), or it went on to the page under test. Such a route is the app's own page (a
       * single-page app's catch-all that keeps the URL), never a success page, so a change after it is never a grant.
       */
      const showsOwnPage = (res: Opened | undefined): string | undefined => {
        if (!res) return undefined;
        if (res.outcome === "answered" && ownPrint !== null && res.fingerprint === ownPrint) return ownPath;
        if (res.outcome === "moved" && pageKey(res.landed) === pageKey(ctx.targetUrl)) return ownPath;
        return undefined;
      };

      /**
       * Re-reads the entitlement after `route` (a page load, or a billing tab chosen on `page`; `res`: how a page load
       * answered) and records a grant, a change that isn't one (drift), or a lost re-read. False when any of them
       * happened (the probing ends). Only a gain (gainedEntitlement) after a route that isn't the page under test itself
       * is a grant. With `lateMs`, it is the quiet re-read after the last route (`route`, opened `lateMs` before with
       * nothing opened since): a change it reads is put down to the last route that loaded as a page, like one read
       * after a route that didn't.
       */
      const readAfter = async (route: Route, page: Page, res?: Opened, lateMs?: number): Promise<boolean> => {
        const late = lateMs !== undefined;
        ctx.step(
          late ? `Reading ${who}'s plan again after ${Math.round(lateMs / 1000)} s with nothing opened` : `Reading ${who}'s plan again after ${didFor(route)}`,
          page.isClosed() ? undefined : page,
        );
        const reads: { snap: EntitlementSnapshot; now: Record<string, unknown>; changed: string[]; gained: string[] }[] = [];
        const readAt = Date.now();
        for (const snap of snaps) {
          const now = await rereadEntitlement(ctx, snap);
          if (now === null) {
            lostAfter = route;
            return false;
          }
          reads.push({ snap, now, changed: changedEntitlement(snap.values, now), gained: gainedEntitlement(snap.values, now) });
        }
        /** When the read that showed a change (if any) ended. */
        const seenAt = Date.now();
        if (!late) {
          lastRead = { route, ...(res ? { res } : {}) };
          lastReadAt = Date.now();
        }
        // A route that didn't load as a page (a 404, sign-in, a load that failed) made no change: one read after it is
        // put down to the last route before it that did (a grant that lands late, a queued job), never to it. So is one
        // read by the quiet re-read after the last route.
        const ran = !late && (res === undefined || RAN.has(res.outcome));
        const credit: Visit | null = ran ? { route, ...(res ? { res } : {}) } : lastRan;
        if (ran) {
          lastRan = { route, ...(res ? { res } : {}) };
          lastRanReadAt = lastReadAt;
          sinceRan = [];
        } else if (!late) {
          sinceRan.push({ route, ...(res ? { res } : {}) });
        }
        const moved = reads.filter((r) => r.changed.length > 0);
        if (moved.length === 0) {
          stillAt = readAt;
          return true;
        }
        const others = (main: (typeof reads)[number]): OtherRead[] => moved.filter((r) => r !== main).map((r) => ({ snap: r.snap, changed: r.changed, after: r.now }));
        const changes = moved.flatMap((r) => changesAt(r.snap, r.changed, r.now)).join(", ");
        const gaining = moved.find((r) => r.gained.length > 0);
        // One GET gained while another changed in a way that isn't a gain: they disagree, so neither is believed. One
        // that didn't change at all (a session that caches the plan it signed in with) doesn't disagree.
        const other = moved.find((r) => r.gained.length === 0);
        const shell = credit ? showsOwnPage(credit.res) : undefined;
        if (!gaining || other || shell !== undefined || !credit) {
          // The GET the restore reads back: one whose change a cancel or downgrade can undo (a plan field), the others
          // are read back after it.
          const main = moved.find((r) => cancelUndoes(r.changed, r.snap.values)) ?? other ?? moved[0]!;
          drift = {
            route: credit?.route ?? route,
            snap: main.snap,
            others: others(main),
            changed: main.changed,
            gained: gaining?.gained ?? [],
            after: main.now,
            changes,
            ...(shell !== undefined ? { shell } : {}),
            ...(!credit && gaining ? { unplaced: { route, ...(res ? { res } : {}) } } : {}),
            ...(gaining && other ? { disagrees: { gained: gaining.snap, other: other.snap } } : {}),
            ...(late ? { late: { ms: lateMs, after: { route, ...(res ? { res } : {}) } } } : {}),
          };
          return false;
        }
        const { snap, now, changed, gained } = gaining;
        const seenAfter: Visit | undefined = credit.route === route ? undefined : { route, ...(res ? { res } : {}) };
        /** The routes opened after the credited one and before `seenAfter` (the last of sinceRan), none of which loaded. */
        const between = seenAfter ? sinceRan.slice(0, -1) : [];
        // Numbers that went up alone (credits, a raised limit; no plan field moved): a balance that refills on a timer
        // looks the same from one read, whatever its period. The route is opened again once the probing is over
        // (repeatGain), and the gain counts only when that adds more (0.6.0 review, round 3).
        if (!changed.some((f) => PLAN_FIELD.test(lastPart(f))) && onlyRaised(snap.values, now)) {
          unconfirmed = {
            credit,
            ...(seenAfter ? { seenAfter } : {}),
            ...(between.length > 0 ? { between } : {}),
            ...(late ? { lateMs } : {}),
            snap,
            others: others(gaining),
            changed,
            gained,
            after: now,
            stillAt,
            openedAt: openedAt.get(credit.route) ?? stillAt,
            seenAt,
          };
          return false;
        }
        // Entitlements or features alone that a second visit can't add again (a new entry, a flag turned on): read
        // again after a pause with nothing opened: any further change means the value moves on its own, and the route
        // can't be credited with it. The evidence (the route's page and the values read right after it) is taken only
        // for a grant, so an inconclusive run leaves no frame behind.
        if (!changed.some((f) => PLAN_FIELD.test(lastPart(f)))) {
          const waitedMs = Math.min(QUIET_MAX_MS, Math.max(QUIET_MIN_MS, Date.now() - baselineAt));
          ctx.step(`Reading ${who}'s plan again after ${Math.round(waitedMs / 1000)} s with nothing opened`, page.isClosed() ? undefined : page);
          await sleep(waitedMs);
          const later = await rereadEntitlement(ctx, snap);
          if (later === null) {
            lostAfter = route;
            return false;
          }
          const again = changedEntitlement(now, later);
          if (again.length > 0) {
            moving = { route: credit.route, snap, changed, after: now, later, again, waitedMs };
            return false;
          }
        }
        // The page on screen is the credited route's only when the change was read right after it (or by the quiet
        // re-read after it, with nothing opened since).
        const shownPage = seenAfter || page.isClosed() ? null : page;
        grant = {
          route: credit.route,
          ...(seenAfter ? { seenAfter } : {}),
          ...(between.length > 0 ? { between } : {}),
          ...(late ? { lateMs } : {}),
          snap,
          others: others(gaining),
          changed,
          gained,
          after: now,
          settleMs: settleFor(seenAt - (openedAt.get(credit.route) ?? readAt)),
          evidence: await grantEvidence(ctx, shownPage, credit.route, snap, now, gained, hide),
        };
        return false;
      };

      /**
       * Before the next page is opened (0.6.0 closeout): the last route that loaded as a page (`lastRan`) gets
       * QUIET_MIN_MS after its re-read with nothing opened, then the plan is read once more (readAfter's quiet re-read),
       * so a change that lands late (a queued job's) is put down to it, never to the page opened next, even one that
       * answers. Once per such route, and only while no read has covered that span yet (a route after it that didn't load
       * as a page, re-read QUIET_MIN_MS or more after it, has). False when that read ended the probing. With `held`, the
       * caller already holds what the page on screen sends (afterTab, inside chooseTab's hold); otherwise the wait and
       * the read run under holdingTab while a Billing tab's page is on screen.
       */
      const quietBeforeNext = async (o: { held?: boolean } = {}): Promise<boolean> => {
        const ran = lastRan as Visit | null;
        const last = lastRead as Visit | null;
        if (ran === null || last === null || quietCovered === ran || done()) return true;
        quietCovered = ran;
        if (lastReadAt - lastRanReadAt >= QUIET_MIN_MS) return true;
        const page = session.page;
        const quiet = async () => {
          const quietMs = Math.max(0, lastRanReadAt + QUIET_MIN_MS - Date.now());
          if (quietMs > 0) {
            ctx.step(`Waiting ${Math.round(quietMs / 1000)} s with nothing opened after ${didFor(ran.route)}, then reading ${who}'s plan again`, page.isClosed() ? undefined : page);
            await sleep(quietMs);
          }
          return readAfter(last.route, page, last.res, Date.now() - lastReadAt);
        };
        return o.held ? quiet() : holdingTab(quiet);
      };

      /**
       * Runs `act` (a quiet wait and its read) under the hold chooseTab puts on while it clicks a tab, while a Billing
       * tab's page is on screen (tabShown; 0.6.0 closeout, review round 1): the tab's script may still be running (a
       * timer, a write it sends after a slow GET), so every navigation to the app and every write to a checkout,
       * subscription or billing portal start is held, and the notes name what the tabs tried. After a page load, `act`
       * runs as it is: what the page sends is its own (its navigations to a start stay held by the scenario's own hold).
       */
      const holdingTab = async <T>(act: () => Promise<T>): Promise<T> => {
        const shown = tabShown;
        const page = session.page;
        if (shown === null || page.isClosed() || sessionClosed) return act();
        const here = page.url();
        const navBefore = providers.blockedNav.length;
        const offBefore = providers.offApp.length;
        const hold = await holdingNavigation(page.context(), (to) => ofTheApp(to, here), () => act(), startsFrom(here));
        for (const what of tabTried(hold, here, providers, navBefore, offBefore)) held.push(tabNote(shown.url, shown.tabs, what));
        return hold.value;
      };

      /**
       * Leaves the page on screen when Billing tabs were chosen on it (tabShown), under their hold (leaveTabPage), before
       * Run Hound loads another page or ends (0.6.0 closeout, review round 2): the page stays alive until the next one
       * commits, so a tab's late write (a timer, a write after a slow GET) would otherwise reach the app while the next
       * page's server answers. What was held is named as the tabs'.
       */
      const leaveTab = async (): Promise<void> => {
        const shown = tabShown;
        if (shown === null) return;
        if (!session.page.isClosed() && !sessionClosed) held.push(...(await leaveTabPage(session.page, shown.url, shown.tabs, providers)));
        tabShown = null;
      };
      /** The tabs chosen on the page at `url` so far, with `tab` (a note names them all: tabNote). */
      const tabsAt = (url: string, tab: string): string[] =>
        tabShown !== null && pageKey(tabShown.url) === pageKey(url) ? [...tabShown.tabs, tabName(tab)] : [tabName(tab)];

      /**
       * Called by scanLinks after it chose a billing tab on `page` (at `url`), while chooseTab's hold is still on:
       * re-reads, as after a page load, so a change the tab made is named as the tab's, never the next route's; then,
       * still under that hold (review round 1), the tab's quiet wait and read (quietBeforeNext), so what the tab's script
       * sends late is held and named as the tab's. The page is then a tab's until Run Hound leaves it (tabShown,
       * leaveTab: review round 2). False once the probing is over.
       */
      const afterTab =
        (url: string, page: Page) =>
        async (tab: string): Promise<boolean> => {
          visited += 1;
          const name = tabName(tab);
          tabShown = { url, tabs: tabsAt(url, name) };
          const route: Route = { url, path: `${pathOf(url)} (${name} tab)`, source: "tab", tab: name };
          openedAt.set(route, Date.now());
          return (await readAfter(route, page)) && !done() && (await quietBeforeNext({ held: true })) && !done();
        };
      /**
       * How scanLinks reads a page at `url` in `page`: the quiet read after the last route that loaded before each tab
       * (quietBeforeNext), a re-read and a quiet read after each tab, and a note for a tab whose page tried something
       * held, naming every tab chosen on the page so far (review round 2: an earlier tab's timer may fire meanwhile).
       */
      const scanning = (url: string, page: Page) => ({
        before: async () => (await quietBeforeNext()) && !done(),
        chose: afterTab(url, page),
        held: (tab: string, what: string) => void held.push(tabNote(url, tabsAt(url, tab), what)),
        providers,
      });

      /**
       * Opens a route as Account A with the page's own navigations to a checkout or billing portal start on this site
       * held (startsFrom), re-reads the entitlement, and records a grant or a lost re-read; then, when the probing goes
       * on, runs `then` (reading a billing or settings page's links) while the hold is still on. Null when there was no
       * time left to open it, or the quiet read before it (quietBeforeNext) ended the probing (nothing was opened).
       */
      const visit = async (route: Route, then?: (page: Page, res: Opened) => Promise<void>): Promise<Opened | null> => {
        if (Date.now() >= probeDeadline) {
          outOfTime = true;
          return null;
        }
        // A change that lands late from the last page that loaded is read before this one opens (quietBeforeNext).
        if (!(await quietBeforeNext()) || done()) return null;
        if (Date.now() >= probeDeadline) {
          outOfTime = true;
          return null;
        }
        tried.add(route);
        // A Billing tab's page on screen is left under the tab's hold first (review round 2).
        await leaveTab();
        const page = await livePage();
        ctx.step(`Opening ${route.path} as ${who}`, stepPage(page));
        visited += 1;
        providers.current = route.path;
        ownLoads.add(pageKey(route.url));
        openedAt.set(route, Date.now());
        const { value: res, stopped } = await holdingNavigation(page.context(), startsFrom(route.url), async (stopping) => {
          const res = await openRoute(page, route.url, stopping);
          if (route.source === "linked-page") {
            readPages.push(route.path);
            linkedOutcomes.set(route.url, res);
          } else {
            opened.push({ route, result: res });
          }
          if (!(await readAfter(route, page, res))) return res;
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
          held.push(`${route.path} sent the browser to ${placeOf(stopped[0]!, route.url)} (${stepNoun(stopped[0]!)}), which Run Hound stopped.`);
        }
        return res;
      };

      /**
       * A gain of raised numbers (Unconfirmed, 0.6.0 review, round 3): opens the credited route again with the same
       * hold (a tab: loads its page and chooses the tab again) and re-reads right after, then once more when the first
       * gain was read late, once as long has passed as then (at most QUIET_MAX_MS). It counts only when that read adds
       * more of the same fields and the value then holds still, with nothing opened, for as long as passed from the
       * last read that showed no change to that read (at least QUIET_MIN_MS). A value that goes up on a timer by itself
       * would have gone up twice within that span, so its period is shorter than the pause, and it goes up in the pause
       * too (Moving). Anything else ends the probing inconclusive (Unrepeated), with nothing clicked or put back.
       */
      const repeatGain = async (p: Unconfirmed): Promise<void> => {
        const route = p.credit.route;
        if (Date.now() >= confirmBy) {
          unrepeated = { pending: p, why: "time" };
          return;
        }
        // A Billing tab's page on screen is left under the tab's hold first (review round 2).
        await leaveTab();
        const page = await livePage();
        ctx.step(`${capital(didFor(route))} again as ${who}, to see whether it adds more`, stepPage(page));
        providers.current = route.path;
        ownLoads.add(pageKey(route.url));
        const reopenedAt = Date.now();
        const seen: { again?: Record<string, unknown> | null; at: number; res?: Opened } = { at: 0 };
        const addsMore = (values: Record<string, unknown> | null | undefined) =>
          values != null && gainedEntitlement(p.after, values).some((f) => p.gained.includes(f));
        const read = async () => {
          seen.again = await rereadEntitlement(ctx, p.snap);
          seen.at = Date.now();
          const wait = Math.min(QUIET_MAX_MS, p.seenAt - p.openedAt) - (Date.now() - reopenedAt);
          if (seen.again === null || addsMore(seen.again) || wait <= 0) return;
          await sleep(wait);
          seen.again = await rereadEntitlement(ctx, p.snap);
          seen.at = Date.now();
        };
        const { value: why, stopped } = await holdingNavigation(page.context(), startsFrom(route.url), async (stopping): Promise<Unrepeated["why"] | null> => {
          const res = await openRoute(page, route.url, stopping);
          seen.res = res;
          if (!RAN.has(res.outcome)) return "not-loaded";
          if (route.source !== "tab") {
            await read();
            return null;
          }
          const tab = (await billingTabs(page)).find((t) => tabName(t.name) === route.tab);
          if (!tab) return "no-tab";
          const chosen = await chooseTab(page, tab, 0, async (clicked) => {
            if (!clicked) return;
            tabShown = { url: route.url, tabs: [tabName(tab.name)] };
            await read();
          });
          return chosen.clicked ? null : "no-tab";
        });
        if (stopped.length > 0) held.push(`${route.path} sent the browser to ${placeOf(stopped[0]!, route.url)} (${stepNoun(stopped[0]!)}), which Run Hound stopped.`);
        if (why !== null) {
          unrepeated = { pending: p, why, ...(seen.res ? { res: seen.res } : {}) };
          return;
        }
        if (seen.again === null || seen.again === undefined) {
          lostAfter = route;
          return;
        }
        const again = seen.again;
        if (!addsMore(again)) {
          unrepeated = { pending: p, why: "same", again };
          return;
        }
        const quietMs = Math.max(QUIET_MIN_MS, seen.at - p.stillAt);
        if (Date.now() + quietMs > confirmBy) {
          unrepeated = { pending: p, why: "time", again };
          return;
        }
        // A tab's page is still on screen, with its script perhaps still running: held as while it was chosen (holdingTab).
        const later = await holdingTab(async () => {
          ctx.step(`Reading ${who}'s plan again after ${Math.round(quietMs / 1000)} s with nothing opened`, page.isClosed() ? undefined : page);
          await sleep(quietMs);
          return rereadEntitlement(ctx, p.snap);
        });
        if (later === null) {
          lostAfter = route;
          return;
        }
        const movedAgain = changedEntitlement(again, later);
        if (movedAgain.length > 0) {
          moving = { route, snap: p.snap, changed: p.changed, after: p.after, repeated: again, later, again: movedAgain, waitedMs: quietMs };
          return;
        }
        grant = {
          route,
          ...(p.seenAfter ? { seenAfter: p.seenAfter } : {}),
          ...(p.between ? { between: p.between } : {}),
          ...(p.lateMs !== undefined ? { lateMs: p.lateMs } : {}),
          snap: p.snap,
          others: p.others,
          changed: [...new Set([...p.changed, ...changedEntitlement(p.snap.values, later)])],
          gained: p.gained,
          after: p.after,
          repeat: { after: again, quietMs },
          settleMs: settleFor(p.seenAt - p.openedAt),
          evidence: await grantEvidence(ctx, page.isClosed() ? null : page, route, p.snap, p.after, p.gained, hide),
        };
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
        const links = (await scanLinks(session.page, scanning(ctx.targetUrl, session.page))).filter(sameSite);
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
            for (const link of (await scanLinks(page, scanning(at, page))).filter(sameSite)) if (isSuccessLink(link)) addCandidate(link.url, "link");
          });
        }
        const origin = originOf(ctx.targetUrl)!;
        // Also when the probing stopped for time, so the notes name the conventional paths it didn't open.
        if (!done() || outOfTime) for (const path of CONVENTIONAL_PATHS) addCandidate(new URL(path, origin).href, "conventional");

        // 4. Open each candidate as Account A and re-read after each. The first change ends the probing.
        for (const route of candidates) {
          if (done()) break;
          await visit(route);
        }

        // 4b. Nothing changed (yet): read once more after a quiet pause (0.6.0 review, round 2). A change that lands
        // after the last route's re-read (a queued job the last conventional path started) would otherwise end in a
        // pass while Account A is on the paid plan. The pause runs until QUIET_MIN_MS have passed since that re-read.
        const last = lastRead as Visit | null;
        if (last !== null && grant === null && drift === null && moving === null && unconfirmed === null && lostAfter === null) {
          // After a tab, its page is still on screen: held as while it was chosen (holdingTab, review round 1).
          await holdingTab(async () => {
            const quietMs = Math.max(0, QUIET_MIN_MS - (Date.now() - lastReadAt));
            if (quietMs > 0) {
              ctx.step(`Waiting ${Math.round(quietMs / 1000)} s with nothing opened, then reading ${who}'s plan once more`, session.page.isClosed() ? undefined : session.page);
              await sleep(quietMs);
            }
            await readAfter(last.route, session.page, last.res, Date.now() - lastReadAt);
          });
        }

        // 4c. A gain of raised numbers alone: open its route again (repeatGain, 0.6.0 review, round 3).
        const pending = unconfirmed as Unconfirmed | null;
        if (pending !== null) await repeatGain(pending);
        // The probing is over (a grant's evidence is taken): a Billing tab's page still on screen is left under the tab's
        // hold, before the restore loads a page and before the scenario ends (review round 2).
        await leaveTab();

        const g = grant as Grant | null;
        const d = drift as Drift | null;
        const m = moving as Moving | null;
        const u = unrepeated as Unrepeated | null;
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
        const reached = reachedProvider(providers)[0];
        const stopNote =
          reached && !g && !d && !m && !lost ? `Run Hound stopped opening pages after ${reached.from} sent the browser to a payment provider.` : "";
        const triedNote = [
          opened.length > 0 ? `Opened as ${who}: ${opened.map((o) => `${o.route.path} (${outcomeText(o.result)})`).join(", ")}.` : "",
          readPages.length > 0 ? `Also opened to read their links: ${readPages.join(", ")}.` : "",
          ...new Set(held),
        ]
          .filter(Boolean)
          .join(" ");
        // The routes left unopened when the probing stopped for time (review round 1): the run is then never a pass.
        const unopened = outOfTime ? [...linkedPages, ...candidates].filter((r) => !tried.has(r)).map((r) => r.path) : [];
        const shownLeft = unopened.slice(0, 6);
        const leftList = unopened.length > shownLeft.length ? `${shownLeft.join(", ")} and ${unopened.length - shownLeft.length} more` : listed(shownLeft);
        const timeNote =
          outOfTime && !g && !d && !m && !lost
            ? `Run Hound stopped after ${visited} ${visited === 1 ? "page" : "pages"} to leave time to put ${who}'s plan back had one changed it${unopened.length > 0 ? `, and didn't open ${leftList}` : "; the remaining routes weren't opened"}.`
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

        // A page under test and its billing and settings pages, where the restore looks for the app's own cancel or
        // downgrade control, except one that didn't load as a page of the app when it was opened (it answered an error,
        // went to sign-in, or left the app, possibly for a payment provider).
        const reopen = (p: Route) => {
          const was = linkedOutcomes.get(p.url)?.outcome;
          return was === undefined || was === "answered" || was === "moved";
        };
        const restorePages = [ctx.targetUrl, ...linkedPages.filter(reopen).map((p) => p.url)];
        const restoreDeadline = started + TIME_LIMIT_MS - RESTORE_MARGIN_MS;
        const putBack = async (change: Grant): Promise<{ notes: string[]; heldNow: string[] }> => {
          for (const url of restorePages) ownLoads.add(pageKey(url));
          const heldBefore = new Set(held);
          const notes = await restore(ctx, livePage, change.snap, change, restorePages, providers, who, endpointOfSnap(change.snap), restoreDeadline);
          // The other GETs of the plan that changed too: read back, and whatever is still changed is named.
          for (const other of change.others) {
            const now = await rereadEntitlement(ctx, other.snap);
            if (now === null) {
              notes.push(`Run Hound couldn't read ${who}'s plan back from ${endpointOfSnap(other.snap)} to see whether it is still changed: check ${who}.`);
              continue;
            }
            for (const f of changedEntitlement(other.snap.values, now)) notes.push(`${who}'s ${fieldNoun(f)} (${endpointOfSnap(other.snap)}) is still ${shown(now[f])}: check ${who}.`);
          }
          // What the scenario's own hold stopped while the plan was put back (a timer between two clicks).
          return { notes, heldNow: [...new Set(held.filter((n) => !heldBefore.has(n)))] };
        };

        if (m) {
          // The gain went on changing with nothing opened: the value moves on its own (a timed refill), so the change
          // can't be put down to the route. Never a finding and never a pass; nothing is put back, since nothing shows
          // Run Hound changed it.
          const changes = changesAt(m.snap, m.changed, m.after).join(", ");
          const from = m.repeated ?? m.after;
          const again = m.again.map((f) => `${fieldOf(m.snap, f)} (${shown(from[f])} → ${shown(m.later[f])})`).join(", ");
          const repeated = m.repeated ? ` (and went up again on ${didFor(m.route)} a second time)` : "";
          return skip(
            hide(
              [
                `Inconclusive: after ${didFor(m.route)} as ${who}, ${who}'s ${changes} changed${repeated}, but then ${again} changed again on ${m.again.length === 1 ? "its" : "their"} own while Run Hound opened nothing for ${Math.round(m.waitedMs / 1000)} s, so it can't tell a change a page makes from that (a balance that refills on a timer, for example). Run Hound opened no further success pages and clicked nothing.`,
                triedNote,
                providerNote(providers),
              ]
                .filter(Boolean)
                .join(" "),
            ),
          );
        }

        if (u) {
          // A gain of raised numbers that opening the route again didn't repeat: it may be a value that goes up on its
          // own (a timed refill), so it is never a finding and never a pass, and nothing is clicked or put back, since
          // nothing shows Run Hound changed it (0.6.0 review, round 3).
          const p = u.pending;
          const changes = changesAt(p.snap, p.changed, p.after).join(", ");
          const why =
            u.why === "same"
              ? `but ${didFor(p.credit.route)} again didn't add more${u.again ? ` (${p.gained.map((f) => `${fieldOf(p.snap, f)}: ${shown(u.again![f])}`).join(", ")})` : ""}`
              : u.why === "not-loaded"
                ? `but ${didFor(p.credit.route)} again didn't load as a page${u.res ? ` (${outcomeText(u.res)})` : ""}`
                : u.why === "no-tab"
                  ? `but Run Hound couldn't choose that tab again`
                  : `but too little time was left to open it again`;
          return skip(
            hide(
              [
                `Inconclusive: after ${didFor(p.credit.route)} as ${who}, ${who}'s ${changes} went up, ${why}. From one read, credits or a limit that went up look the same as a value that goes up on its own (a balance that refills on a timer, for example), so Run Hound counts them only when a second visit adds more. Run Hound opened no further success pages and clicked nothing.`,
                triedNote,
                providerNote(providers),
              ]
                .filter(Boolean)
                .join(" "),
            ),
          );
        }

        if (d) {
          // Something changed that isn't a paid plan given by a success page: never a finding and never a pass. The
          // change is still the scenario's own (it opened the page), so it is put back where a cancel can do it.
          const why = d.disagrees
            ? `but ${endpointOfSnap(d.disagrees.gained)} read as a gain while ${endpointOfSnap(d.disagrees.other)} changed in a way that isn't one, so Run Hound can't tell which to believe`
            : d.unplaced
              ? `read after ${d.unplaced.route.path}${d.unplaced.res ? ` (${outcomeText(d.unplaced.res)})` : ""}, which didn't load as a page, and no page Run Hound opened before it did, so the change can't be put down to a success page (it may have come late from the page under test's own load)`
              : d.shell !== undefined && d.gained.length > 0
                ? `${d.route.path} showed the same page as ${d.shell} (the page under test, not a success page), so the change can't be put down to a success page`
                : `which isn't a paid plan: Run Hound counts only a move to a paid plan, more credits, or more entitlements or features, and a page that changes ${who}'s plan in other ways hides whether one would`;
          const { notes: restoreNotes, heldNow } = await putBack({
            route: d.route,
            snap: d.snap,
            others: d.others,
            changed: d.changed,
            gained: d.gained,
            after: d.after,
            settleMs: 0,
            evidence: [],
          });
          const lateNote = d.late
            ? `The change was read only after Run Hound had opened nothing for ${Math.round(d.late.ms / 1000)} s after ${d.late.after.route.source === "tab" ? didFor(d.late.after.route) : d.late.after.route.path}.`
            : "";
          return skip(
            hide(
              [
                `Inconclusive: ${didFor(d.route)} as ${who} changed ${who}'s ${d.changes}, ${why}. Run Hound opened no further success pages.`,
                lateNote,
                ...restoreNotes,
                triedNote,
                ...heldNow,
                providerNote(providers),
              ]
                .filter(Boolean)
                .join(" "),
            ),
          );
        }

        if (!g) {
          const answered = opened.filter((o) => o.result.outcome === "answered");
          // Account A's plan read only from an auth or session endpoint (NextAuth's /api/auth/session with the JWT
          // strategy): its answer may keep the plan Account A signed in with, so a grant can't be seen there, and the
          // run is never a pass (0.6.0 review, round 2). A gain it does show is still a grant (above).
          const sessionOnly = visited > 0 && snaps.every((s) => endpointRank(s.url) === 1);
          const sessionNote = sessionOnly
            ? `${who}'s plan was read only from ${endpoint}, which may keep the plan ${who} signed in with, so a change can't be seen: check ${who}.`
            : "";
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
                  sessionNote,
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
          // A run that stopped for time with routes left unopened is never a pass (review round 1): one of them may be
          // the success page that grants, and a slow app is where that happens.
          const inconclusive = sessionOnly || outOfTime;
          const lead = `${answered.length === 1 ? "one success or upgrade page" : `${answered.length} success or upgrade pages`} opened as ${who} (${answered.map((o) => o.route.path).join(", ")}), and ${who}'s plan (${readWhat}) read the same after each${outOfTime ? ", but Run Hound ran out of time before it opened every route" : ""}.`;
          const notes = [
            inconclusive ? `Inconclusive: ${lead}` : capital(lead),
            sessionNote,
            stopNote,
            timeNote,
            outOfTime ? `Run Hound can't say that none of the routes it didn't open gives ${who} a paid plan: check ${who}, or run the check on a faster copy of the app.` : "",
            triedNote,
            claimNote,
            providerNote(providers),
          ];
          if (inconclusive) return skip(hide(notes.filter(Boolean).join(" ")));
          return result(ID, scenario, started, [], hide(notes.filter(Boolean).join(" ")));
        }

        // 5. A page gave Account A a paid plan, credits, entitlements or features: put it back through the app's own
        // control (the page under test first, then its billing and settings pages), then report.
        const { notes: restoreNotes, heldNow } = await putBack(g);
        const finding = grantFinding(ctx, scenario, g, g.snap, endpointOfSnap(g.snap), who, hide);
        const notes = [
          `${capital(didFor(g.route))} as ${who} changed ${who}'s ${[...changesAt(g.snap, g.changed, g.after), ...g.others.flatMap((o) => changesAt(o.snap, o.changed, o.after))].join(", ")}.`,
          g.repeat
            ? `${capital(didFor(g.route))} again added more (${g.gained.map((f) => `${fieldOf(g.snap, f)} ${shown(g.after[f])} → ${shown(g.repeat!.after[f])}`).join(", ")}), and nothing changed in the ${Math.round(g.repeat.quietMs / 1000)} s after with nothing opened, so the gain comes from the page, not from a value that goes up on its own.`
            : "",
          lateChangeNote(g),
          ...restoreNotes,
          triedNote,
          ...heldNow,
          providerNote(providers),
        ];
        return result(ID, scenario, started, [finding], hide(notes.filter(Boolean).join(" ")));
      } catch (error) {
        // A Billing tab's page still on screen goes too, under the tab's hold (review round 2).
        await leaveTab().catch(() => undefined);
        // A page may already have changed Account A's plan: say so with the error.
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(hide([message.replace(/\.?$/, "."), visited > 0 ? INTERRUPTED_NOTE : "", providerNote(providers)].filter(Boolean).join(" ")));
      }
    }).finally(() => stopWorkers?.());
  },
};

/**
 * The frame of the route that changed the entitlement (when `page` still shows it) and a card of the plan before and
 * after, taken before any restore.
 */
async function grantEvidence(
  ctx: CheckContext,
  page: Page | null,
  route: Route,
  snap: EntitlementSnapshot,
  after: Record<string, unknown>,
  changed: string[],
  hide: (s: string) => string,
): Promise<Evidence[]> {
  const who = ctx.accounts?.self?.label ?? "Account A";
  const tab = route.source === "tab";
  const frame = page === null ? [] : await tryCapture(ctx, page, hide(tab ? `${route.path} chosen as ${who}` : `${route.path} opened as ${who}`), {
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

/** How a route answered when it loaded as a page, and so may have made a change (see readAfter). */
const RAN = new Set<Outcome>(["answered", "moved", "stopped", "left"]);

/** Entitlement fields a cancel or downgrade puts back (by the last part of a dotted name, as lastPart compares it). */
const PLAN_FIELD = /^(plan|tier|subscription|ispro|pro)$/i;
/** Fields that follow the plan when the answer has no plan field of its own (`{ features: [...] }`). */
const PLAN_FEATURES = /^(entitlements|features)$/i;
/** The last part of a dotted field name as lib/entitlement compares keys: lower-case, without "-", "_" or spaces (`is_pro` is "ispro"). */
const lastPart = (field: string) => (field.split(".").pop() ?? field).toLowerCase().replace(/[-_\s]/g, "");

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

/** A page on which the restore chose Billing tabs looking for the plan's control (findPlanControl), at `url`. */
interface TabsChosen {
  page: Page;
  url: string;
  tabs: string[];
}

/**
 * Puts Account A's entitlement back after a grant, through the app's own cancel or downgrade control: on the page under
 * test, then on its billing and settings pages. Only when a cancel or downgrade can undo what changed (cancelUndoes);
 * otherwise nothing is clicked. Each click is followed by a re-read; the first that reads as the snapshot again ends
 * it. A page that fails (a control covered by an overlay, a page that doesn't load) is named and the next page is
 * tried; a control that goes to a billing portal, a checkout or another site is never clicked (refusal), and a click
 * that heads for one anyway is held and counts as failed (clickPlanControl). No page is opened once less than
 * RESTORE_STEP_MS is left before `deadline`, and nothing is clicked once less than RESTORE_CLICK_MS is. A page on which
 * Billing tabs were chosen is left under their hold (leaveTabPage) before the next page loads and at the end (0.6.0
 * closeout, review round 2), so a tab's late write never reaches the app. Returns the notes, which name whatever is
 * still changed after a final re-read ("… check Account A"), and what a tab's page sent that was held.
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
  const chosen: { on: TabsChosen | null } = { on: null };
  const leave = async (notes: string[]) => {
    const on = chosen.on;
    chosen.on = null;
    if (on) notes.push(...(await leaveTabPage(on.page, on.url, on.tabs, providers).catch(() => [])));
  };
  const notes = await restoreOnPages(ctx, livePage, snap, grant, pages, providers, who, endpoint, deadline, chosen, leave);
  await leave(notes);
  return notes;
}

/** restore's search and clicks, page by page (`chosen`: the page whose Billing tabs it chose; `leave` leaves it). */
async function restoreOnPages(
  ctx: CheckContext,
  livePage: () => Promise<Page>,
  snap: EntitlementSnapshot,
  grant: Grant,
  pages: string[],
  providers: ProviderLog,
  who: string,
  endpoint: string,
  deadline: number,
  chosen: { on: TabsChosen | null },
  leave: (notes: string[]) => Promise<void>,
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
    // A change that left the plan free (a free plan renamed, `free_2026`) has nothing a cancel could undo: clicking one
    // on a free account would only change something else (0.6.0 review, round 1).
    const leftFree = saysFree(grant.after);
    const undoable = cancelUndoes(grant.changed, snap.values) && !leftFree;
    if (!undoable) {
      const planNow = grant.changed.filter((f) => PLAN_FIELD.test(lastPart(f))).map((f) => `${f}: ${shown(grant.after[f])}`);
      notes.push(
        leftFree && planNow.length > 0
          ? `${who}'s plan reads as a free plan now (${planNow.join(", ")}), so a cancel or downgrade has nothing to put back, and Run Hound clicked nothing.`
          : `A cancel or downgrade can't put back ${who}'s ${[...new Set(grant.changed.map(fieldNoun))].join(", ")}, so Run Hound clicked nothing.`,
      );
    }
    const outOfTime = () => notes.push(`Run Hound ran out of time to put ${who}'s plan back.`);
    for (const url of undoable ? pages : []) {
      if (Date.now() + RESTORE_STEP_MS >= deadline) {
        outOfTime();
        break;
      }
      const path = pathOf(url);
      let control: Marked | null = null;
      /** Candidates on this page that can't be told apart (findPlanControl): none was clicked; and the tabs it chose. */
      const seen: { ambiguous?: string[]; chose?: string[] } = {};
      try {
        // The last page's Billing tabs may still have scripts running: left under their hold first.
        await leave(notes);
        const page = await livePage();
        providers.current = path;
        ctx.step(`Looking for the app's own cancel or downgrade control on ${path}`, stepPage(page));
        // Loaded like a probed route: the page's own navigations to a checkout or billing portal start are held.
        const found = await holdingNavigation(page.context(), startsFrom(url), async () => {
          await page.goto(url, { waitUntil: "load", timeout: 30_000 }).catch(() => undefined);
          await settle(page);
          // Choosing a tab again on the page whose tab made the change would make it again.
          return findPlanControl(page, !(grant.route.source === "tab" && pageKey(url) === pageKey(grant.route.url)), seen);
        });
        if (seen.chose && seen.chose.length > 0) chosen.on = { page, url: page.url(), tabs: seen.chose };
        if (found.stopped.length > 0) {
          notes.push(`${path} sent the browser to ${placeOf(found.stopped[0]!, url)} (${stepNoun(found.stopped[0]!)}), which Run Hound stopped, so it clicked nothing there.`);
          continue;
        }
        control = found.value;
        if (!control) {
          const names = (seen.ambiguous ?? []).map((n) => `"${n}"`);
          const which = `nothing on the page says which is ${who}'s plan, so Run Hound clicked`;
          if (names.length === 1) notes.push(`On ${path}, more than one ${names[0]} might be the way back to Free, and ${which} none of them.`);
          if (names.length > 1) notes.push(`On ${path}, ${listed(names)} might each be the way back to Free, and ${which} ${names.length === 2 ? "neither" : "none of them"}.`);
          continue;
        }
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
        // Only a provider navigation counts as where the click went: a provider's script polling its host in the
        // background meanwhile is blocked too, but it isn't the cancel.
        const navBefore = providers.blockedNav.length;
        const offBefore = providers.offApp.length;
        const reachedBefore = providers.reached.length;
        attempted = true;
        const clicked = await clickPlanControl(page, control, path);
        const how = clicked.stopped[0];
        /** What the click did that was held: "went on to /billing/portal", "sent a request to /api/billing/portal-session". */
        const went = how === undefined ? "" : `${clicked.sent.has(how) ? "sent a request to" : "went on to"} ${placeOf(how, url)}`;
        const now = await rereadEntitlement(ctx, snap);
        if (how !== undefined || clicked.refusedConfirm) {
          // The click headed for a billing portal or checkout (held), or the app asked to confirm only with a button
          // that does: the restore failed there, unless the plan reads as before anyway (the app cancelled, then
          // went on). Read first, so nothing more is clicked once the plan is back.
          if (clicked.refusedConfirm?.provider) providers.blocked.push(clicked.refusedConfirm.provider);
          if (now === null) {
            notes.push(
              `Run Hound clicked the app's own "${control.name}" on ${path}${how !== undefined ? ` (it ${went}, which Run Hound stopped)` : ""}, but couldn't read ${who}'s plan back (${endpoint}), so it can't confirm the plan was put back: check ${who}.`,
            );
            return notes;
          }
          const back = changedEntitlement(snap.values, now).length === 0;
          if (back && how !== undefined) {
            notes.push(`Put back: Run Hound clicked the app's own "${control.name}" on ${path}, and ${who}'s plan read as it was before afterwards (the app then ${went}, which Run Hound stopped).`);
            return notes;
          }
          notes.push(
            how !== undefined
              ? `The app's "${control.name}" on ${path} ${went} (${stepNoun(how)}); Run Hound stopped it, so the plan couldn't be put back there.`
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
        const blockedHosts = [...new Set(providers.blockedNav.slice(navBefore))];
        const reachedHosts = [...new Set(reachedProvider(providers, reachedBefore).map((r) => r.host))];
        const awayHosts = [...new Set(providers.offApp.slice(offBefore).map((o) => o.host))].filter(Boolean);
        notes.push(
          reachedHosts.length > 0
            ? `The app's "${control.name}" on ${path} took the browser to the payment provider (${reachedHosts.join(", ")}) through a server redirect, so the plan couldn't be put back there.`
            : blockedHosts.length > 0
              ? `The app's "${control.name}" on ${path} headed for the payment provider (${blockedHosts.join(", ")}), which was blocked, so the plan couldn't be put back there.`
              : awayHosts.length > 0
                ? `The app's "${control.name}" on ${path} headed for another site (${awayHosts.join(", ")}), which Run Hound stopped, so the plan couldn't be put back there.`
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
  const changes = grant.gained.map((f) => `${f} ${shown(snap.values[f])} → ${shown(grant.after[f])}`);
  const data = Object.fromEntries(grant.gained.map((f) => [f, { before: snap.values[f], after: grant.after[f] }]));
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
          fields: grant.gained,
          slot: ctx.accounts?.self?.id === "b" ? "B" : "A",
          settleMs: grant.settleMs,
          ...(grant.route.source === "tab" ? { tab: grant.route.tab ?? "Billing" } : {}),
        }),
      ),
    },
  };
}

/**
 * A standalone spec: signs in as the run's account (slot A or B) through the app's sign-in page from environment
 * variables, reads its plan, opens the success route (with every payment provider blocked as the check blocks them: a
 * request to one, a new window's first load, and through the DevTools protocol the hop of a server redirect to one and,
 * once signed in, any page load off the target, so it runs in Chromium only; with `tab`, then chooses that tab on it),
 * then reads it again until `settleMs` have passed (review round 1: a change that lands late, a queued job's, shows only
 * a while after the network went idle) and fails on the first change. No value Run Hound read, no session value and no
 * credential is written into it.
 */
function replaySpec(o: {
  target: string;
  route: string;
  entitlement: string;
  path: string;
  fields: string[];
  slot: "A" | "B";
  tab?: string;
  settleMs: number;
}): string {
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
    `const PATH: string = ${q(o.path)}; // where ${who}'s object sits in that answer ("" = the whole answer)`,
    `const FIELDS = ${q(o.fields)} as string[];`,
    `// How long the plan is read after ROUTE loads${o.tab === undefined ? "" : " and TAB is chosen"}: Run Hound saw the change about ${Math.max(0, Math.round((o.settleMs - QUIET_MIN_MS) / 1000))} s after it ${o.tab === undefined ? "opened ROUTE" : "chose TAB"}`,
    `// (a change can land late, such as a queued job's), and this adds ${QUIET_MIN_MS / 1000} s.`,
    `const SETTLE_MS = ${String(o.settleMs).replace(/\B(?=(\d{3})+(?!\d))/g, "_")};`,
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
    `// Never reach a payment provider: every request to one is stopped, and so is a new window's first load (it goes out`,
    `// before the window can be watched). Routes never see the hop of a server redirect (a page of the app that answers`,
    `// with a redirect to the provider), so a DevTools-level block on the page stops that one (Chromium only). Once signed`,
    `// in (the sign-in page may be on another site), it also stops every page load off TARGET, a redirect hop included:`,
    `// a checkout host PAYMENT_PROVIDER doesn't name is never reached either.`,
    `let guardOffSite = false;`,
    `async function blockPaymentProviders(page: Page) {`,
    `  const context = page.context();`,
    `  await context.route((url) => PAYMENT_PROVIDER.test(url.href), (route) => route.abort());`,
    `  await context.route("**/*", (route, request) => {`,
    `    if (!request.isNavigationRequest()) return route.fallback();`,
    `    let owner: Page | null = null;`,
    `    try {`,
    `      owner = request.frame().page();`,
    `    } catch {`,
    `      owner = null;`,
    `    }`,
    `    return owner === page ? route.fallback() : route.abort();`,
    `  });`,
    `  const cdp = await context.newCDPSession(page);`,
    `  cdp.on("Fetch.requestPaused", (event) => {`,
    `    const url = event.request.url;`,
    `    const offSite = guardOffSite && event.resourceType === "Document" && /^https?:/i.test(url) && new URL(url).origin !== new URL(TARGET).origin;`,
    `    const answer = PAYMENT_PROVIDER.test(url) || offSite`,
    `      ? cdp.send("Fetch.failRequest", { requestId: event.requestId, errorReason: "Aborted" })`,
    `      : cdp.send("Fetch.continueRequest", { requestId: event.requestId });`,
    `    answer.catch(() => undefined);`,
    `  });`,
    `  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });`,
    `}`,
    ``,
    `test(${q(`opening a success page doesn't give ${who} a paid plan`)}, async ({ page, browserName }) => {`,
    `  test.skip(browserName !== "chromium", "The payment-provider block needs Chromium's DevTools protocol.");`,
    `  test.setTimeout(60_000 + SETTLE_MS);`,
    `  await blockPaymentProviders(page);`,
    `  await signIn(page);`,
    `  guardOffSite = true;`,
    `  const before = await entitlement(page);`,
    `  await page.goto(new URL(ROUTE, TARGET).href);`,
    `  await page.waitForLoadState("networkidle");`,
    ...(o.tab === undefined ? [] : [`  await page.getByRole("tab", { name: TAB }).click();`, `  await page.waitForLoadState("networkidle");`]),
    `  // Read the plan until SETTLE_MS have passed; the first change ends the wait and fails the test.`,
    `  const settleBy = Date.now() + SETTLE_MS;`,
    `  let after = await entitlement(page);`,
    `  while (Date.now() < settleBy && JSON.stringify(after) === JSON.stringify(before)) {`,
    `    await new Promise((resolve) => setTimeout(resolve, 500));`,
    `    after = await entitlement(page);`,
    `  }`,
    `  expect(after, ${q(`${who}'s plan changed just by opening `)} + ROUTE).toEqual(before);`,
    `});`,
    ``,
  ].join("\n");
}
