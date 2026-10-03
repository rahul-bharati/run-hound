/**
 * Entitlement reads and restoration for paywall-trust: readsOf, locateEntitlements, bodiesRead, findPlanControl,
 * clickPlanControl, restore, restoreOnPages, grantEvidence, grantFinding, replaySpec, refusal, surelyThePlan,
 * sameElement, cancelUndoes (the two-branch plan-field-or-features check), didFor, putDownTo, fieldNoun,
 * lastPart, RAN.
 */
import type { Page } from "playwright";
import { isSameOrigin } from "../../core/saves.js";
import type { Capture, CheckContext, Evidence, Finding, Scenario } from "../../core/types.js";
import {
  BILLING_SECTION,
  CONFIRM,
  CONFIRM_AVOID,
  CONFIRM_NAMES_IT,
  CONFIRM_OR_CANCEL,
  NEVER_CLICK,
  NAMES_THE_PLAN,
  NOT_THE_PLAN,
  OFFER,
  PAYMENT_PROVIDERS,
  PERSON_HEADING,
  PERSON_ROW,
  PLAN_CONTROL,
  PLAN_CONTROL_AVOID,
  PORTAL_STEP,
  RESTORE_HOLD,
  RESTORE_WRITE_HOLD,
  YOUR_PLAN_SECTION,
} from "../../constants/paywall-trust-constants.js";
import { namesTheCancel } from "./paywall-trust.helpers.js";
import {
  hostOf,
  isPaymentProvider,
  listed,
  pageKey,
  pathOf,
  pathWords,
  placeOf,
  q,
  shown,
  startsFrom,
  stepNoun,
} from "./urls.js";
import {
  marked,
  locatorOf,
  CLICKABLE,
  DIALOGS,
} from "./page-scripts.js";
import {
  billingTabs,
  chooseTab,
  selectedTabs,
  holdingNavigation,
  leaveTabPage,
  stepPage,
} from "./page-navigation.js";
import { endpointOf, evidence, tryCapture, tryCard } from "../lib/functional-finding.js";
import { endpointRank, findEntitlements, rereadEntitlement, saysFree, changedEntitlement } from "../lib/entitlement.js";
import type { EntitlementSnapshot } from "../lib/entitlement.js";
import { parseJson } from "../lib/record-state.js";
import { settle, sleep, waitFor } from "../lib/functional-form.js";
import { RESTORE_CLICK_MS, RESTORE_STEP_MS, MAX_ENTITLEMENT_READS, QUIET_MIN_MS, CLICK_SETTLE_MS, CONFIRM_SETTLE_MS } from "../../config/paywall-trust.js";
import { PAYWALL_TRUST_ID } from "../../constants/paywall-trust-constants.js";
import { capital } from "./check-notes.js";
import { PLAN_FIELD } from "./paywall-trust.helpers.js";
import type { PaywallTabsChosen } from "../../interfaces/paywall-trust.js";

/** The GETs of the page load as ObservedRead, in the order the app made them (bodies only when the capture kept one). */
export function readsOf(requests: Capture["requests"]): import("../lib/entitlement.js").ObservedRead[] {
  return requests
    .filter((r) => r.method.toUpperCase() === "GET" && r.responseBody)
    .map((r) => ({ method: "GET", url: r.url, status: r.status ?? 0, json: parseJson(r.responseBody!) }));
}

/**
 * Every GET the app made while loading the page under test that holds Account A's entitlement (0.6.0 review, round 1:
 * not only the first, which may be a session endpoint that caches the plan the account signed in with): the same-origin
 * ones from the capture and the app's own reads from its API on another local origin, as the page received them
 * (LocalReads), the account and billing endpoints first (findEntitlements), at most MAX_ENTITLEMENT_READS. Nothing is
 * sent to find them.
 */
export async function locateEntitlements(requests: Capture["requests"], local: import("../../interfaces/paywall-trust.js").LocalReads, markers: string[]): Promise<EntitlementSnapshot[]> {
  local.closed = true;
  await Promise.race([Promise.allSettled(local.pending), sleep(3000)]);
  const reads = [...readsOf(requests), ...local.reads.filter((r): r is import("../lib/entitlement.js").ObservedRead => r !== null)];
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
export async function bodiesRead(capture: Capture, targetUrl: string): Promise<void> {
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
export function refusal(control: { href: string | null; formAction: string | null; name: string }, pageUrl: string, path: string): { note: string; provider?: string } | null {
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
export const surelyThePlan = (m: import("../../interfaces/paywall-trust.js").Marked | null): m is import("../../interfaces/paywall-trust.js").Marked => m !== null && (NAMES_THE_PLAN.test(m.name) || (m.subSection && YOUR_PLAN_SECTION.test(m.section)));

/** True when `a` and `b` (marked by two searches, each with its own attribute) are the same element of the page. */
export async function sameElement(page: Page, a: import("../../interfaces/paywall-trust.js").Marked, b: import("../../interfaces/paywall-trust.js").Marked): Promise<boolean> {
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
export async function findPlanControl(page: Page, tabs = true, seen: { ambiguous?: string[]; chose?: string[] } = {}): Promise<import("../../interfaces/paywall-trust.js").Marked | null> {
  let refused: import("../../interfaces/paywall-trust.js").Marked | null = null;
  const ambiguous = (controls: import("../../interfaces/paywall-trust.js").Marked[]) => {
    seen.ambiguous = [...new Set([...(seen.ambiguous ?? []), ...controls.map((m) => m.name)])];
  };
  const pick = (all: import("../../interfaces/paywall-trust.js").Marked[]) => {
    const namesPlan = (m: import("../../interfaces/paywall-trust.js").Marked) => /\b(plan|free|downgrade|pro|premium)\b/i.test(m.name);
    const ownPlan = (m: import("../../interfaces/paywall-trust.js").Marked) => m.subSection && YOUR_PLAN_SECTION.test(m.section);
    const shared = (m: import("../../interfaces/paywall-trust.js").Marked) => all.filter((o) => o.name.toLowerCase() === m.name.toLowerCase()).length > 1;
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
    const tier = (m: import("../../interfaces/paywall-trust.js").Marked) => (NAMES_THE_PLAN.test(m.name) ? 0 : namesPlan(m) ? 1 : 2);
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
  const settled = (m: import("../../interfaces/paywall-trust.js").Marked | null) => (seen.ambiguous ? null : (m ?? refused));
  const now = await look();
  if (surelyThePlan(now)) return now;
  if (!tabs) return settled(now);
  const billing = (await billingTabs(page)).slice(0, 3);
  if (billing.length === 0) return settled(now);
  // The view the page loaded with: chosen again when a Billing tab hid the one candidate found in it.
  const home = await selectedTabs(page);
  /** Candidates behind a Billing tab that aren't surely Account A's and aren't `now` (or found behind an earlier tab). */
  const behindTabs: { control: import("../../interfaces/paywall-trust.js").Marked; tab: import("../../interfaces/paywall-trust.js").Marked }[] = [];
  for (const tab of billing) {
    const behind: { control: import("../../interfaces/paywall-trust.js").Marked | null; known: boolean } = { control: null, known: false };
    const chosen = await chooseTab(page, tab, 3000, async () => {
      await sleep(200);
      behind.control = await look();
      if (!behind.control || surelyThePlan(behind.control)) return;
      for (const other of [...(now ? [now] : []), ...behindTabs.map((b) => b.control)]) {
        if (await sameElement(page, other, behind.control!)) behind.known = true;
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
export async function clickPlanControl(page: Page, control: import("../../interfaces/paywall-trust.js").Marked, path: string): Promise<import("../../interfaces/paywall-trust.js").PaywallClicked> {
  /** The browser's own confirm() dialogs that read as an offer (OFFER): dismissed, never accepted. */
  const declined: string[] = [];
  const onDialog = (dialog: import("playwright").Dialog) => {
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
      async (stopped): Promise<import("../../interfaces/paywall-trust.js").PaywallClicked["refusedConfirm"]> => {
        // Confirmation buttons already on screen (a dialog that holds the control itself) are not the app's answer to it.
        const before = new Set((await marked(page, { selector: CLICKABLE, match: CONFIRM_OR_CANCEL, within: DIALOGS })).map((m) => m.name));
        await locatorOf(page, control).click({ timeout: 5000 });
        await sleep(CLICK_SETTLE_MS);
        if (stopped.length > 0) return null;
        const shown = (await marked(page, { selector: CLICKABLE, match: CONFIRM_OR_CANCEL, avoid: NEVER_CLICK, within: DIALOGS })).filter((m) => !before.has(m.name));
        // In an offer, only a button that names the cancel goes ahead; elsewhere a plain go-ahead does too.
        const offer = (m: import("../../interfaces/paywall-trust.js").Marked) => OFFER.test(m.area) || OFFER.test(m.name);
        const offeredAll = shown.filter((m) => namesTheCancel(m.name) || (!offer(m) && CONFIRM.test(m.name) && !CONFIRM_AVOID.test(m.name)));
        const offered = offeredAll.filter((m) => refusal(m, page.url(), path) === null);
        const confirm = offered.find((m) => CONFIRM_NAMES_IT.test(m.name)) ?? offered[0];
        if (confirm) {
          await locatorOf(page, confirm)
            .click({ timeout: 5000 })
            .catch(() => undefined);
          await sleep(CONFIRM_SETTLE_MS);
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

/** Fields that follow the plan when the answer has no plan field of its own (`{ features: [...] }`). */
const PLAN_FEATURES = /^(entitlements|features)$/i;
/** The last part of a dotted field name as lib/entitlement compares keys: lower-case, without "-", "_" or spaces (`is_pro` is "ispro"). */
export const lastPart = (field: string) => (field.split(".").pop() ?? field).toLowerCase().replace(/[-_\s]/g, "");

/** What a changed entitlement field is called in a note ("plan" for plan and tier). */
export function fieldNoun(field: string): string {
  const last = lastPart(field);
  return last === "plan" || last === "tier" ? "plan" : field;
}

/**
 * True when a cancel or downgrade can undo `changed`: a plan field changed (plan, tier, subscription, isPro, pro), or
 * the entitlements or features did in an answer that has no plan field (they then are the plan). Credits and a role
 * alone never: clicking the app's cancel would change something the scenario didn't (a free subscription, a trial).
 */
export function cancelUndoes(changed: string[], snapshot: Record<string, unknown>): boolean {
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
 * RESTORE_STEP_MS is left before `deadline`, and nothing is clicked once less than RESTORE_CLICK_MS is. A page on which
 * Billing tabs were chosen is left under their hold (leaveTabPage) before the next page loads and at the end (0.6.0
 * closeout, review round 2), so a tab's late write never reaches the app. Returns the notes, which name whatever is
 * still changed after a final re-read ("… check Account A"), and what a tab's page sent that was held.
 */
export async function restore(
  ctx: CheckContext,
  livePage: () => Promise<Page>,
  snap: EntitlementSnapshot,
  grant: import("../../interfaces/paywall-trust.js").PaywallGrant,
  pages: string[],
  providers: import("../../interfaces/paywall-trust.js").ProviderLog,
  who: string,
  endpoint: string,
  deadline: number,
): Promise<string[]> {
  const chosen: { on: PaywallTabsChosen | null } = { on: null };
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
  grant: import("../../interfaces/paywall-trust.js").PaywallGrant,
  pages: string[],
  providers: import("../../interfaces/paywall-trust.js").ProviderLog,
  who: string,
  endpoint: string,
  deadline: number,
  chosen: { on: PaywallTabsChosen | null },
  leave: (notes: string[]) => Promise<void>,
): Promise<string[]> {
  const notes: string[] = [];
  const stillChanged = (now: Record<string, unknown>) =>
    changedEntitlement(snap.values, now).map((f) => `${who}'s ${fieldNoun(f)} ${fieldNoun(f).endsWith("s") ? "are" : "is"} still ${shown(now[f])}: check ${who}.`);
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
      let control: import("../../interfaces/paywall-trust.js").Marked | null = null;
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

/**
 * The frame of the route that changed the entitlement (when `page` still shows it) and a card of the plan before and
 * after, taken before any restore.
 */
export async function grantEvidence(
  ctx: CheckContext,
  page: Page | null,
  route: import("../../interfaces/paywall-trust.js").PaywallRoute,
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

/** What Run Hound did for a route, as a note says it: "opening /app/upgraded", "choosing the Billing tab on /app". */
export function didFor(route: import("../../interfaces/paywall-trust.js").PaywallRoute): string {
  return route.source === "tab" ? `choosing the ${q(route.tab ?? "billing")} tab on ${pathOf(route.url)}` : `opening ${route.path}`;
}

/**
 * A route a late change is put down to, as a note names it, when it was read after a later route that didn't load as a
 * page: "/app/upgraded, the last page before it that did", or, for a tab (review round 1), "choosing the "Billing" tab
 * on /app, the last thing Run Hound did before it".
 */
export function putDownTo(route: import("../../interfaces/paywall-trust.js").PaywallRoute): string {
  return route.source === "tab" ? `${didFor(route)}, the last thing Run Hound did before it` : `${route.path}, the last page before it that did`;
}

/** How a route answered when it loaded as a page, and so may have made a change (see readAfter). */
export const RAN = new Set<import("../../interfaces/paywall-trust.js").PaywallOutcome>(["answered", "moved", "stopped", "left"]);

/** The critical finding: the route, what changed, the evidence, and a spec that replays the probe. */
export function grantFinding(
  ctx: CheckContext,
  scenario: Scenario,
  grant: import("../../interfaces/paywall-trust.js").PaywallGrant,
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
    checkId: "paywall-trust",
    id: `${PAYWALL_TRUST_ID}#${scenario.id}-1`,
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
      filename: `${PAYWALL_TRUST_ID}-success-page.spec.ts`,
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



// Import needed here (after grantEvidence definition) so it can use `capital` and `didFor`.
import { reachedProvider } from "./browser-guards.js";
import { ofTheApp } from "./urls.js";
import { excerpt } from "./urls.js";

/**
 * A standalone spec: signs in as the run's account (slot A or B) through the app's sign-in page from environment
 * variables, reads its plan, opens the success route (with every payment provider blocked as the check blocks them: a
 * request to one, a new window's first load, and through the DevTools protocol the hop of a server redirect to one and,
 * once signed in, any page load off the target, so it runs in Chromium only; with `tab`, then chooses that tab on it),
 * then reads it again until `settleMs` have passed (review round 1: a change that lands late, a queued job's, shows only
 * a while after the network went idle) and fails on the first change. No value Run Hound read, no session value and no
 * credential is written into it.
 */
export function replaySpec(o: {
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