/** Default runs allowed at the same time when ServerOptions.maxConcurrentRuns is not set. */
export const DEFAULT_MAX_CONCURRENT_RUNS = 2;

/** Bounded retention of in-memory plans. */
export const MAX_PLANS = 50;

/** Bounded retention of finished in-memory runs (running runs are never pruned). */
export const MAX_RUNS = 50;

/** Concurrent sign-in tests allowed (/api/accounts/test); each drives its own Chromium. */
export const MAX_SIGN_IN_TESTS = 2;

/** Steps the live log keeps (oldest dropped first). */
export const LIVE_STEPS = 100;