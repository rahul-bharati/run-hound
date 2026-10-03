/**
 * Page-level navigation and link logic for paywall-trust: Hold/activeHolds, holdingNavigation, holdScenario,
 * chooseTab, leaveTabPage, billingTabs, selectedTabs, inPage, tabName, tabNote, tabTried, stepPage, scanLinks,
 * isSuccessLink, isBillingPage, didFor, putDownTo, lateChangeNote, capital, listed.
 */
import type { BrowserContext, Page, Request, Route as PwRoute } from "playwright";
import type { Marked, ProviderLog } from "../../interfaces/paywall-trust.js";
import { BILLING_TAB } from "../../constants/paywall-trust-constants.js";
import { sendsWrite } from "./paywall-trust.helpers.js";
import {
  listed,
  ofTheApp,
  pageKey,
  pathOf,
  placeOf,
  q,
  startsFrom,
} from "./urls.js";
import { marked, locatorOf } from "./page-scripts.js";
import { LEAVE_GRACE_MS, CLICK_TIMEOUT_MS, TAB_SETTLE_MS, LEAVE_TAB_GOTO_TIMEOUT_MS } from "../../config/paywall-trust.js";
import { settle, sleep } from "../lib/functional-form.js";

/** What a hold stops before it is sent, and what it stopped. */
export interface Hold {
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
export const activeHolds = new WeakMap<BrowserContext, Set<Hold>>();

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
export function heldBy(context: BrowserContext, url: string, kind: "navigation" | "write"): boolean {
  const naming = [...(activeHolds.get(context) ?? [])].filter((h) => (kind === "navigation" ? h.stop(url) : h.writes?.(url) === true));
  const steps = naming.filter((h) => !h.onOwn);
  const by = steps.at(-1) ?? naming.at(-1);
  if (by) record(by, url, kind === "write");
  return by !== undefined;
}

/** The context route of one hold: a first hop, or a write, it names is aborted before it is sent. */
export function holdRoute(hold: Hold): (route: PwRoute, request: Request) => Promise<void> {
  return async (route, request) => {
    const url = request.url();
    const nav = request.isNavigationRequest();
    const write = !nav && sendsWrite(request.resourceType(), request.method());
    if (!(nav ? hold.stop(url) : write && hold.writes?.(url) === true)) return route.fallback();
    record(hold, url, write);
    await route.abort("aborted").catch(() => undefined);
  };
}

export function addHold(context: BrowserContext, hold: Hold): void {
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
export async function holdingNavigation<T>(
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
export async function holdScenario(context: BrowserContext, hold: Hold): Promise<void> {
  if (scenarioHeld.has(context)) return;
  scenarioHeld.add(context);
  addHold(context, hold);
  await context.route("**/*", holdRoute(hold));
}

/**
 * The page's unselected tabs that may hold the plan (a Billing tab), only those that aren't a link to another page
 * (`<a role="tab" href="/billing/portal">` would load a page nothing vetted: it is among the page's links instead,
 * opened only when isBillingPage allows it) and don't submit a form. A tab that is a button whose script sends the
 * browser elsewhere passes: chooseTab holds every navigation to the app while it clicks one.
 */
export async function billingTabs(page: Page): Promise<Marked[]> {
  return inPage(page, await marked(page, { selector: "[role=tab]", match: BILLING_TAB, unselected: true }));
}

/** The page's selected tabs (any name) that aren't a link to another page and don't submit a form: the view it loaded with. */
export async function selectedTabs(page: Page): Promise<Marked[]> {
  return inPage(page, await marked(page, { selector: "[role=tab]", match: /\S/, selected: true }));
}

/** The tabs among `tabs` that stay on the page when clicked: no link to another page, no form submit. */
export function inPage(page: Page, tabs: Marked[]): Marked[] {
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
export async function chooseTab(
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
        .click({ timeout: CLICK_TIMEOUT_MS })
        .then(
          () => true,
          () => false,
        );
      if (waitMs > TAB_SETTLE_MS) await settle(page, waitMs);
      await sleep(clicked ? TAB_SETTLE_MS : 0);
      if (then) await then(clicked);
      return clicked;
    },
    startsFrom(here),
  );
  return { clicked: held.value, stopped: held.stopped, sent: held.sent };
}

// ---------- Links and candidate routes ----------

/** A tab's name as a note gives it: at most 40 characters. */
export const tabName = (tab: string) => (tab.length > 40 ? `${tab.slice(0, 40)}…` : tab);

/**
 * What a tab's page tried while a hold of chooseTab's kind was on (`held`: what it stopped, the writes among it in
 * `sent`), and where it headed that the payment-provider block stopped since `navBefore` and `offBefore`: "sent a
 * request to /api/billing/portal-session, which Run Hound stopped", "headed for billing.stripe.com (payment provider),
 * which was blocked".
 */
export function tabTried(held: { stopped: readonly string[]; sent: Set<string> }, here: string, providers: ProviderLog | undefined, navBefore: number, offBefore: number): string[] {
  const tried: string[] = [];
  const first = held.stopped[0];
  if (first !== undefined) tried.push(`${held.sent.has(first) ? "sent a request to" : "sent the browser to"} ${placeOf(first, here)}, which Run Hound stopped`);
  const hosts = [...new Set(providers?.blockedNav.slice(navBefore) ?? [])].filter(Boolean);
  if (hosts.length > 0) tried.push(`headed for ${hosts.join(", ")} (payment provider), which was blocked`);
  const away = [...new Set(providers?.offApp.slice(offBefore).map((x) => x.host) ?? [])].filter(Boolean);
  if (away.length > 0) tried.push(`headed for ${away.join(", ")} (another site), which Run Hound stopped`);
  return tried;
}

/**
 * A note for what a hold stopped while the Billing tabs `tabs`, chosen on the page at `url`, were on screen (`what`: see
 * tabTried). With two or more chosen on the same page, any of their scripts may have sent it (a timer the first one
 * set may fire while the second is chosen: 0.6.0 closeout, review round 2), so every one is named.
 */
export function tabNote(url: string, tabs: readonly string[], what: string): string {
  const names = [...new Set(tabs.map(tabName))].map(q);
  return names.length <= 1
    ? `Choosing the ${names[0] ?? q("Billing")} tab on ${pathOf(url)} ${what} (a tab is chosen only to read what it shows).`
    : `After Run Hound chose the ${listed(names)} tabs on ${pathOf(url)}, the page ${what} (a tab is chosen only to read what it shows).`;
}

/**
 * Leaves `page`, on which the Billing tabs `tabs` were chosen (at `url`) and whose scripts may still be running (a timer,
 * a write sent after a slow GET), for about:blank, under the hold chooseTab puts on (0.6.0 closeout, review round 2):
 * every navigation to the app, and every write to a checkout, subscription or billing portal start (a beacon its
 * pagehide sends included), is held until LEAVE_GRACE_MS after the blank page commits. The page's timers and pending
 * continuations die with it, so nothing it would send later can reach the app while the next page loads (a page stays
 * alive until the next one commits: the whole time the server takes to answer). Answers the notes for what was held.
 */
export async function leaveTabPage(page: Page, url: string, tabs: readonly string[], providers: ProviderLog): Promise<string[]> {
  if (page.isClosed()) return [];
  const here = page.url();
  const navBefore = providers.blockedNav.length;
  const offBefore = providers.offApp.length;
  const hold = await holdingNavigation(
    page.context(),
    (to) => ofTheApp(to, here),
    async () => {
      await page.goto("about:blank", { waitUntil: "commit", timeout: LEAVE_TAB_GOTO_TIMEOUT_MS }).catch(() => undefined);
      await sleep(LEAVE_GRACE_MS);
    },
    startsFrom(here),
  );
  return tabTried(hold, here, providers, navBefore, offBefore).map((what) => tabNote(url, tabs, what));
}

/** A page as a step names it: none once it is closed or left for about:blank (leaveTabPage). */
export const stepPage = (page: Page): Page | undefined => (page.isClosed() || page.url() === "about:blank" ? undefined : page);