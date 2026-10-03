/**
 * Reusable declarations for the write-access check: time limits and small timeouts. The fixed values the check
 * reuses (regexes, the server-managed field pattern, the salt, the identity names, the token-refusal status set)
 * live in `constants/write-access-constants.ts`; the type aliases live in `types/write-access.ts`; the interfaces
 * live in `interfaces/write-access.ts`; the focused modules live under `checks/write-access/`.
 */

/** How long Run Hound watches the record, sending nothing, to tell a field that changes on its own from one a write left. */
export const WATCH_MS = 2_500;

/**
 * How long Run Hound waits, sending nothing, before it looks at the record once more after a write the app accepted
 * (2xx, or no answer) that showed no effect yet: an app may apply a write a moment later (202 Accepted, a queued job).
 */
export const LATE_MS = 2_500;
