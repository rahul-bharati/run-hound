/**
 * Middleware barrel: each piece (security headers, host allow, JSON-only API, header guard) is a small factory that
 * closes over the bit of state it needs (host predicate, header-guard path string). app.ts applies them in the same
 * order as the pre-refactor app.ts: security headers (every response), host allow (loopback + configured hosts,
 * cross-site POSTs), JSON-only for /api/*, then per-route headerGuard for /api/ai* and /api/accounts*.
 */
export { BASE_HEADERS, DEFAULT_CSP, REPORT_CSP, inlineHashes, uiCsp, securityHeaders } from "./security.js";
export { hostKey, hostOf, isDefaultHost, extraHostsOf, hostAllowedOf, hostAllow } from "./host.js";
export { jsonOnlyApi } from "./json-only.js";
export { headerGuard } from "./header-guard.js";
