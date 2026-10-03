/**
 * Interfaces for the paywall-trust check. The type aliases live in `types/paywall-trust.ts` (re-exported below).
 * The configurable limits live in `config/paywall-trust.ts`; the reusable fixed values and short predicates live
 * in `constants/paywall-trust-constants.ts`; the focused modules live under `checks/paywall-trust/`.
 */
import type { Page } from "playwright";
import type { Evidence } from "../core/types.js";
import type { EntitlementSnapshot } from "../checks/lib/entitlement.js";
import type { PaywallOutcome, PaywallRouteSource } from "../types/paywall-trust.js";
export type { PaywallHoldRoute, PaywallDialogHandler, PaywallSession } from "../types/paywall-trust.js";
export type { PaywallOutcome, PaywallRouteSource };

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
export interface Marked {
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

/** A link found on a page: its absolute URL and accessible text. */
export interface PaywallLink {
  url: string;
  text: string;
}

/** A route Run Hound opened, with how it was chosen. */
export interface PaywallRoute {
  url: string;
  path: string;
  source: PaywallRouteSource;
  /** For a "tab": the tab's name. */
  tab?: string;
}

/** A route Run Hound opened (or a tab it chose: `res` undefined) and how it answered. */
export interface PaywallVisit {
  route: PaywallRoute;
  res?: PaywallOpened;
}

/** What this check's pages tried with payment providers. */
export interface ProviderLog {
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

/** A route Run Hound opened and how it answered. */
export interface PaywallOpened {
  outcome: PaywallOutcome;
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

/** What a hold stops before it is sent, and what it stopped. */
export interface PaywallHold {
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



/** How a click on the plan control ended: what was held and why its confirmation wasn't clicked. */
export interface PaywallClicked {
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
 * Another GET of Account A's plan that changed too (0.6.0 review, round 1): named in the notes, and read back after a restore.
 */
export interface PaywallOtherRead {
  snap: EntitlementSnapshot;
  changed: string[];
  after: Record<string, unknown>;
}

/**
 * A page under test on which Billing tabs were chosen, with its tabs. The restore leaves it under their hold
 * (leaveTabPage), so a tab's late write never reaches the app.
 */
export interface PaywallTabsChosen {
  page: Page;
  url: string;
  tabs: string[];
}

/** A successful grant the check reports. */
export interface PaywallGrant {
  route: PaywallRoute;
  seenAfter?: PaywallVisit;
  between?: PaywallVisit[];
  lateMs?: number;
  snap: EntitlementSnapshot;
  others: PaywallOtherRead[];
  changed: string[];
  gained: string[];
  after: Record<string, unknown>;
  /**
   * How long the exported spec reads the plan after the route loaded (review round 1): the time from opening the
   * credited route to the read that showed the change, plus QUIET_MIN_MS.
   */
  settleMs: number;
  repeat?: { after: Record<string, unknown>; quietMs: number };
  evidence: Evidence[];
}

/**
 * A change after a probe that isn't counted as a grant: nothing was gained (credits spent, a free plan moved to a
 * trial, a role), or the gain came after a route that showed the page under test itself (`shell`: its path), which is
 * the app's own page and not a success page. The probing ends there, inconclusive.
 */
export interface PaywallDrift {
  route: PaywallRoute;
  snap: EntitlementSnapshot;
  others: PaywallOtherRead[];
  changed: string[];
  gained: string[];
  after: Record<string, unknown>;
  shell?: string;
  unplaced?: PaywallVisit;
  disagrees?: { gained: EntitlementSnapshot; other: EntitlementSnapshot };
  late?: { ms: number; after: PaywallVisit };
  changes: string;
}

/**
 * A gain in credits, entitlements or features alone that went on changing while Run Hound opened nothing
 * (QUIET_MIN_MS): the value moves on its own, so the change can't be put down to the route. Nothing is put back, since
 * nothing shows Run Hound changed it.
 */
export interface PaywallMoving {
  route: PaywallRoute;
  snap: EntitlementSnapshot;
  changed: string[];
  after: Record<string, unknown>;
  repeated?: Record<string, unknown>;
  later: Record<string, unknown>;
  again: string[];
  waitedMs: number;
}

/**
 * A gain made only of numbers that went up (credits, a limit or allowance: onlyRaised), with no plan field changed
 * (0.6.0 review, round 3).
 */
export interface PaywallUnconfirmed {
  credit: PaywallVisit;
  seenAfter?: PaywallVisit;
  between?: PaywallVisit[];
  lateMs?: number;
  snap: EntitlementSnapshot;
  others: PaywallOtherRead[];
  changed: string[];
  gained: string[];
  after: Record<string, unknown>;
  stillAt: number;
  openedAt: number;
  seenAt: number;
}

/**
 * A gain of raised numbers (Unconfirmed) that opening the route again didn't repeat.
 */
export interface PaywallUnrepeated {
  pending: PaywallUnconfirmed;
  why: "same" | "not-loaded" | "no-tab" | "time";
  again?: Record<string, unknown>;
  res?: PaywallOpened;
}

/**
 * The answers of the GETs the app made to its API on another local origin while the page under test loaded (the
 * capture keeps no body for those): kept as they arrive, so finding the entitlement there sends nothing.
 */
export interface LocalReads {
  /** In the order the app made them; null while the body is still being read, or when it was too big. */
  reads: (import("../checks/lib/entitlement.js").ObservedRead | null)[];
  pending: Promise<void>[];
  /** Set once the entitlement was looked for: later pages' reads aren't kept. */
  closed: boolean;
}

