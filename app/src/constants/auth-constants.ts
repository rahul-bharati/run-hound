/**
 * Fixed values for the auth engine: the action-time and wait-for-settled timeouts signIn and form-detection share.
 * The browser-evaluate payloads (MARK_PASSWORDS, NEW_PASSWORD_SHOWN, NEW_ELEMENTS) are sent verbatim to the page,
 * declare no module variables, and stay with the form-detection helper that builds them.
 */

/** Filling a field or clicking the submit control. */
export const ACTION_TIMEOUT_MS = 10_000;

/** Poll interval for the wait loop. */
export const POLL_MS = 150;

/** How long the page gets to react to the submit: a new URL, or the password field going away (spec step 5). */
export const SUBMIT_WAIT_MS = 15_000;

/** Once an error message appears, how long the page still gets to move on (some show "Signing in…" as an alert). */
export const ALERT_GRACE_MS = 1_000;

/**
 * How long an outcome must hold before the wait ends: the page off the sign-in page, or the password field gone. A
 * form that hides for a moment while the app checks the session, or comes back, is not an outcome yet.
 */
export const SETTLED_MS = 750;

/** Network idle wait after the page loads. */
export const NETWORK_IDLE_MS = 5_000;

/** How long the sign-in page gets to load. */
export const LOAD_TIMEOUT_MS = 30_000;

/** How long the page gets, after the first step, with no field left to fill and nothing loading. */
export const NO_STEP_SETTLED_MS = 3_000;