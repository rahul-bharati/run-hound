/**
 * Middleware barrel: each piece is a small factory that closes over the bit of state it needs (host predicate,
 * header-guard path string). app.ts applies them in the same order as the pre-refactor app.ts.
 */
export { inlineHashes, uiCsp, securityHeaders } from "./security.js";
export { hostKey, hostOf, isDefaultHost, extraHostsOf, hostAllowedOf, hostAllow } from "./host.js";
export { jsonOnlyApi } from "./json-only.js";
export { headerGuard } from "./header-guard.js";