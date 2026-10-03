/**
 * Reusable fixed values for the write-access check: regexes the check matches against, the identity names the
 * notes use, the salt for the test record's values, the status sets for the verdict, the server-managed field
 * pattern, the anti-CSRF header source by name, the scenario id patterns, the put-back sentinel, the body
 * content types, and the check id literal. The configurable time limits live in `config/write-access.ts`; the
 * type aliases live in `types/write-access.ts`; the interfaces live in `interfaces/write-access.ts`; the
 * runtime helpers (id predicates, formatting, status-set predicates, drift) live under
 * `checks/write-access/`; the focused modules live alongside them.
 */

/** A key that holds a password or an email address: a body that has one is never sent, as anyone. */
export const SENSITIVE_KEY = /pass(word|code|phrase)|e-?mail/i;

/**
 * Fields the app sets itself whenever the record is saved (updatedAt, modified_on, version, etag): the put-back is a
 * save too, so it changes them again and they can never read as they did before. putBack also takes every field
 * record-state's changesOnSave names (rowVersion, updateTime, lastUpdate, _ts, concurrencyStamp …), the rule
 * restoreRecord itself uses, so both classify a field the same way.
 */
export const SERVER_MANAGED = /^(last_?)?(updated|modified|changed|edited)(_?(at|on|date|time))?$|^(version|lock_?version|etag|_rev|__v)$/i;

/** A word that says the record was removed, whatever the field then holds (deletedAt, is_archived, trashed). */
export const REMOVED_WORD = /^(deleted?|deletion|archived?|trash|trashed|removed|discarded|destroyed)$/;

/** A word that says the record is shown, counted only when the field holds true or false (isActive, visible). */
export const SHOWN_WORD = /^(active|inactive|enabled|disabled|visible|hidden)$/;

/** A status or state value that says the record was removed. */
export const REMOVED_VALUE = /\b(deleted|archived|trashed|removed|discarded|destroyed|inactive|hidden|disabled)\b/i;

/**
 * Statuses an app's CSRF check refuses a write with: Django's 403, Laravel's 419, Rails' 422 (InvalidAuthenticityToken)
 * and ASP.NET Core antiforgery's 400 (close-out round 2). A write that still carried Account A's body token, or went
 * without the anti-CSRF header the app's own request carried, and was refused with one of them is no proof of an
 * ownership check.
 */
export const TOKEN_REFUSALS = new Set([400, 403, 419, 422]);

/** Statuses that answer a write with a conflict with the record's version (optimistic locking, If-Match): 409, 412, 428. */
export const CONFLICT = new Set([409, 412, 428]);

/**
 * The usual source of an anti-CSRF header, by the header's name (lower case): axios' and Angular's X-XSRF-TOKEN reads the
 * XSRF-TOKEN cookie (URL-decoded), Django's X-CSRFToken the csrftoken cookie, Rails' and Laravel's X-CSRF-Token the
 * <meta name="csrf-token">.
 */
export const HEADER_SOURCE: Record<string, { kind: "cookie" | "meta" | "input"; name: string; decode: boolean }> = {
  "x-xsrf-token": { kind: "cookie", name: "xsrf-token", decode: true },
  "x-csrftoken": { kind: "cookie", name: "csrftoken", decode: false },
  "x-csrf-token": { kind: "meta", name: "csrf-token", decode: false },
};

/** What this check's note says when an interruption left Account A's record changed or deleted. */
export const INTERRUPTED_NOTE = "If Run Hound had already sent a change as another account or signed out, Account A's test record may have changed or been deleted: check Account A.";

/** How each identity is named in notes, and the subject of a title. */
export const WHO: Record<"other" | "signed-out", { words: string; subject: string; slug: string }> = {
  other: { words: "Account B", subject: "Account B", slug: "other-account" },
  "signed-out": { words: "a signed-out visitor", subject: "Signed-out visitors", slug: "signed-out" },
};

/**
 * Per scenario: the salt of the values the test record is created with, the tag its markers carry, and the tag of the
 * value Account A's own comparison sets (compareAsOwner). A marker is the created value with the tag inserted right
 * after the run token, so it still carries the token but never contains the created value (no tag starts with the
 * salt), and no two of a scenario's or the two scenarios' markers contain each other.
 */
export const SALT: Record<"other" | "signed-out", { create: string; mark: string; compare: string }> = {
  other: { create: "wab", mark: "wxb", compare: "wyb" },
  "signed-out": { create: "was", mark: "wxs", compare: "wys" },
};

/** The empty put-back result: no changes to undo, no leftover fields, no recreated record. */
export const PUT_BACK_NOTHING: { notes: string[]; failed: boolean; serverOnly: boolean; recreated: boolean; left: string[] } = { notes: [], failed: false, serverOnly: false, recreated: false, left: [] };

/** The content type for a body kind. */
export const CONTENT_TYPE: { json: "application/json"; form: "application/x-www-form-urlencoded" } = { json: "application/json", form: "application/x-www-form-urlencoded" } as const;

/** A check-id literal for the orchestrator. */
export const WRITE_ACCESS_ID = "write-access" as const;

/** No run-token-keyed values known to the cross-site-query helper (we keep query values verbatim). */
export const NO_TOKENS: ReadonlySet<string> = new Set();
