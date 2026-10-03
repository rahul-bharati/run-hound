/**
 * write-access (0.6.0, docs/v2-spec.md "`write-access`" and "`write-access` amendments") facade. The orchestrator
 * lives in `./write-access/check.ts`; the implementation is in focused modules under `./write-access/`.
 */
export { check } from "./write-access/check.js";
export { identityOf } from "./write-access/identity.js";
