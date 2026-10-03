/**
 * Status-set predicates for write-access: acceptedOrUnknown (2xx or no answer), mayRefuseStale (400/422/5xx as
 * possible stale-version refusals). The fixed status sets live in `constants/write-access-constants.ts`.
 */

/** True for a status that says the app accepted a write (2xx), or no answer (the write may still have been applied). */
export const acceptedOrUnknown = (status: number | null) => status === null || (status >= 200 && status < 300);

/**
 * True for an answer that may be an app's refusal of a stale version when it doesn't answer 409, 412 or 428: a
 * validation error (400, 422) or an unhandled one (5xx, Rails' StaleObjectError). A refusal of the sender itself (401,
 * 403, 404) is not one.
 */
export const mayRefuseStale = (status: number) => status === 400 || status === 422 || (status >= 500 && status < 600);
