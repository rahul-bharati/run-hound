/**
 * paywall-trust orchestrator: plan/run/timeLimitMs, the high-level scenario flow (snapshot the entitlement,
 * open candidate routes, re-read after each, decide grant/drift/pass, restore via the app's own cancel/downgrade).
 * Local types `Outcome`/`Opened`/`Route`/`Visit`/`Grant`/`Drift`/`Moving`/`Unconfirmed`/`Unrepeated`/`Link`/
 * `OtherRead`/`ProviderLog`/`LocalReads` are the same shapes the original module declared inline.
 */
import type { Page } from "playwright";
import { isSameOrigin, originOf } from "../../core/saves.js";
import type { Check, PlanEnv, Scenario } from "../../core/types.js";
import { redactSecrets } from "../../engine/redact.js";
import { actsWhenLoaded, linkActs, urlWords } from "../lib/acting-links.js";
import { endpointOf, errorResult, guarded, result } from "../lib/functional-finding.js";
import { settle, sleep } from "../lib/functional-form.js";
import {
  changedEntitlement,
  endpointRank,
  gainedEntitlement,
  isPaid,
  onlyRaised,
  rereadEntitlement,
  type EntitlementSnapshot,
} from "../lib/entitlement.js";
import {
  ACTING_LINK,
  BILLING_WORDS,
  CLAIMS_UPGRADE,
  CONVENTIONAL_PATHS,
  DOWNLOAD_EXT,
  INTERRUPTED_NOTE,
  NEVER_READ,
  READ_WORDS,
  SIGN_IN_PATH,
  START_STEP,
  SUCCESS_WORDS,
  PAYWALL_TRUST_ID,
} from "../../constants/paywall-trust-constants.js";
import {
  BASELINE_GAP_MS,
  CONFIRM_RESERVE_MS,
  MAX_CANDIDATES,
  MAX_LINKED_PAGES,
  OPEN_GOTO_TIMEOUT_MS,
  OPEN_LOAD_TIMEOUT_MS,
  OPEN_RELOAD_TIMEOUT_MS,
  OPEN_SETTLE_MS,
  QUIET_MAX_MS,
  QUIET_MIN_MS,
  RESTORE_MARGIN_MS,
  RESTORE_RESERVE_MS,
  TIME_LIMIT_MS,
} from "../../config/paywall-trust.js";
import {
  ofTheApp,
  pageKey,
  pathOf,
  pathWords,
  placeOf,
  shown,
  startsFrom,
  stepNoun,
} from "./urls.js";
import {
  FINGERPRINT,
  NOT_FOUND_VIEW,
  SCAN_LINKS,
  SHOWS_PASSWORD,
} from "./page-scripts.js";
import type { Hold } from "./page-navigation.js";
import {
  billingTabs,
  chooseTab,
  heldBy,
  holdScenario,
  holdingNavigation,
  leaveTabPage,
  tabTried,
  tabNote,
  tabName,
  stepPage,
} from "./page-navigation.js";
import {
  bodiesRead,
  locateEntitlements,
  restore,
  grantEvidence,
  grantFinding,
  didFor,
  fieldNoun,
  lastPart,
  RAN,
  cancelUndoes,
} from "./entitlement-reads.js";
import {
  openAsSelf,
  watchBrowser,
  providerNote,
  reachedProvider,
} from "./browser-guards.js";
import type { PaywallOpened, PaywallLink, PaywallRoute, PaywallRouteSource, PaywallVisit, PaywallOtherRead, PaywallGrant, PaywallDrift, PaywallMoving, PaywallUnconfirmed, PaywallUnrepeated, PaywallOutcome, ProviderLog, LocalReads } from "../../interfaces/paywall-trust.js";
import { lateChangeNote, outcomeText, capital } from "./check-notes.js";
import { settleFor, PLAN_FIELD } from "./paywall-trust.helpers.js";
import { listed } from "./urls.js";

// Local aliases preserve the original variable names inside the orchestrator body.

type Outcome = PaywallOutcome;
type Opened = PaywallOpened;
type Link = PaywallLink;
type Route = PaywallRoute;
type Visit = PaywallVisit;
type OtherRead = PaywallOtherRead;
type Grant = PaywallGrant;
type Drift = PaywallDrift;
type Moving = PaywallMoving;
type Unconfirmed = PaywallUnconfirmed;
type Unrepeated = PaywallUnrepeated;

const ID = PAYWALL_TRUST_ID;

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
export async function openRoute(page: Page, url: string, stopped: readonly string[]): Promise<Opened> {
  let status: number | null = null;
  let threw = false;
  try {
    const response = await page.goto(url, { waitUntil: "load", timeout: OPEN_GOTO_TIMEOUT_MS });
    status = response?.status() ?? null;
  } catch {
    // The page's own navigation replaced this one (an app sending the browser to sign-in), it was blocked, the guard
    // closed the context, or the load timed out.
    threw = true;
  }
  await page.waitForLoadState("load", { timeout: OPEN_LOAD_TIMEOUT_MS }).catch(() => undefined);
  await settle(page);
  await sleep(OPEN_SETTLE_MS);
  await page.waitForLoadState("load", { timeout: OPEN_RELOAD_TIMEOUT_MS }).catch(() => undefined);
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



/** `["a", "b", "c"]` as "a, b and c". */


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

/** `text` with every account marker (3 characters or more, any case) hidden, on top of redactSecrets. */
export function hider(markers: string[]): (text: string) => string {
  const names = markers.map((m) => m.trim()).filter((m) => m.length >= 3);
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = escaped.length > 0 ? new RegExp(escaped.join("|"), "gi") : null;
  return (text: string) => {
    const clean = redactSecrets(text);
    return re ? clean.replace(re, "[account]") : clean;
  };
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
    return guarded(ID, scenario, ctx, async (started: number) => {
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
      const heldByFn = (c: import("playwright").BrowserContext, url: string, kind: "navigation" | "write") => heldBy(c, url, kind);
      const workers = await watchBrowser(ctx.browser, providers);
      stopWorkers = workers?.stop ?? null;
      let session = await openAsSelf(ctx, providers, heldByFn, local, workers);
      await holdScenario(session.context, scenarioHold);
      let sessionClosed = false;
      const watchClose = (s: typeof session) => s.context.once("close", () => (sessionClosed = true));
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
        session = await openAsSelf(ctx, providers, heldByFn, undefined, workers);
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
        const addCandidate = (url: string, source: PaywallRouteSource) => {
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



// scanLinks is local to the orchestrator (reads Billing tabs and the page's links).
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