/**
 * Reusable declarations for the paywall-trust check: time limits, route counts, and restore reserves.
 * Pure data; behavior lives in `checks/paywall-trust.ts` and the focused modules under `checks/paywall-trust/`.
 */

/** At most this many success routes are opened (links and conventional paths together). */
export const MAX_CANDIDATES = 10;

/** At most this many of the page's billing and settings pages are opened to read their links. */
export const MAX_LINKED_PAGES = 5;

/**
 * At most this many answers of the app's own GETs to its API on another local origin are kept while the page under
 * test loads (the capture keeps no body for those), each at most MAX_LOCAL_BODY characters.
 */
export const MAX_LOCAL_READS = 10;

/** Hard cap on the body kept from a cross-origin local-origin GET. */
export const MAX_LOCAL_BODY = 1_000_000;

/**
 * The scenario's time limit (Check.timeLimitMs). Up to 10 success routes and 5 billing or settings pages, each a page
 * load with up to 5 s of waiting for the network, plus a restore that may load the same pages again: well over the
 * runner's default 3 minutes on a slow app.
 */
export const TIME_LIMIT_MS = 360_000;

/**
 * Time kept for the restore: no new page is opened once less than this is left, so a grant found late still has time
 * to be put back before the runner stops the scenario (which would leave Account A on the paid plan).
 */
export const RESTORE_RESERVE_MS = 120_000;

/**
 * The restore opens no page once less than this is left of the time limit, so it ends (and names what is still
 * changed) before the runner stops the scenario, which would leave only the generic interrupted note.
 */
export const RESTORE_MARGIN_MS = 10_000;

/**
 * What one restore page can take (a load of up to 30 s, up to 3 billing tabs, the click, its confirmation and the
 * waits between them): a page is opened for the restore only while this much is left before its deadline.
 */
export const RESTORE_STEP_MS = 45_000;

/** What the click, its confirmation and the re-read after it can take: nothing is clicked once less is left. */
export const RESTORE_CLICK_MS = 20_000;

/** Pause between the two baseline reads, so a value that moves on its own (a timestamp in seconds) shows it. */
export const BASELINE_GAP_MS = 1_100;

/**
 * A gain in entitlements or features alone that a second visit can't repeat (a new entry, a flag turned on; no plan
 * field changed) is read once more after a pause with nothing opened before it is reported: the time since the
 * baseline, at least QUIET_MIN_MS and at most QUIET_MAX_MS; the restore's reserve covers it. A gain made only of
 * numbers that went up (credits, a raised limit) is opened again instead (0.6.0 review, round 3: see repeatGain): a
 * balance that refills on a timer slower than any such pause would otherwise be credited to whichever route was open
 * when it ticked. QUIET_MIN_MS is also the shortest pause of the quiet re-read after the last route.
 */
export const QUIET_MIN_MS = 5_000;
export const QUIET_MAX_MS = 30_000;





/**
 * Opening a route again for a gain of raised numbers, and the pause after it, start only while more than half the
 * restore's reserve is left (see repeatGain): a grant it confirms still has time to be put back.
 */
export const CONFIRM_RESERVE_MS = RESTORE_RESERVE_MS / 2;

/** At most this many of the page's own GETs that hold Account A's entitlement are re-read after each probe. */
export const MAX_ENTITLEMENT_READS = 4;

/** How long a tab's page left for about:blank stays held (leaveTabPage). */
export const LEAVE_GRACE_MS = 500;

/** Click timeout when picking a Billing tab (in chooseTab). */
export const CLICK_TIMEOUT_MS = 3_000;

/** Settle window after a tab click. */
export const TAB_SETTLE_MS = 300;

/** Time to settle after a click. */
export const CLICK_SETTLE_MS = 400;

/** Time to settle after the click's confirmation. */
export const CONFIRM_SETTLE_MS = 300;

/** Initial sleep after opening a route. */
export const OPEN_SETTLE_MS = 250;

/** Second waitForLoadState timeout after openRoute's first load. */
export const OPEN_RELOAD_TIMEOUT_MS = 5_000;

/** waitForLoadState timeout for the first load of openRoute. */
export const OPEN_LOAD_TIMEOUT_MS = 10_000;

/** page.goto timeout for openRoute. */
export const OPEN_GOTO_TIMEOUT_MS = 30_000;

/** page.goto timeout for leaveTabPage's blank page. */
export const LEAVE_TAB_GOTO_TIMEOUT_MS = 10_000;