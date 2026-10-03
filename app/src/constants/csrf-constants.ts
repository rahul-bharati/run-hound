/** Reusable fixed values for the csrf check: id, salt, marker suffix, sign-in path regex, non-loopback origin, interrupted note. */

export const CSRF_ID = "csrf" as const;

/** Salt of the values the test record is created with; must not contain "csrf" (the marker suffix). */
export const SALT = "xsite";

/** Marker suffix inserted right after the run token so the forged value still carries it but is unique. */
export const MARKER_SUFFIX = "csrf";

/** A redirect to a sign-in page: the app's answer to a request that isn't signed in, so a refusal. */
export const SIGN_IN_PATH = /\/(?:log[-_]?in|sign[-_]?in|auth|authenticate|sessions?\/new|users\/sign_in)(?:[/?#.]|$)/i;

/** An origin that is no loopback name or address: a CORS allowlist that trusts it trusts any site. */
export const OTHER_SITE = "http://run-hound-other-site.invalid";

/** What this check's note says when an interruption left Account A's test record changed. */
export const INTERRUPTED_NOTE =
  "If Run Hound had already sent the forged request, Account A's test record may still hold the value it changed: check Account A.";