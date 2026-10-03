/**
 * Pure predicates and rounding for the paywall-trust check: namesTheCancel, isWrite, sendsWrite, speculative,
 * settleFor, PLAN_FIELD. Pure data transforms; no Playwright, no engine state.
 */
import { QUIET_MIN_MS } from "../../config/paywall-trust.js";

/** The longest window the spec settle can be (review round 1). */
const SPEC_SETTLE_MAX_MS = 60_000;

/** Plan field names matched case-insensitively against the last part of a dotted field name. */
export const PLAN_FIELD = /^(plan|tier|subscription|ispro|pro)$/i;

/** A request that writes: any method but GET, HEAD or OPTIONS (a CORS preflight creates nothing). */
export const isWrite = (method: string): boolean => !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());

/**
 * A request a hold may stop as a write: a fetch or XHR that writes (isWrite), or a beacon (`navigator.sendBeacon`, a
 * POST that DevTools and Playwright call a "ping"). `resourceType` is either's name for it, in any case.
 */
export const sendsWrite = (resourceType: string, method: string): boolean => {
  const type = resourceType.toLowerCase();
  return ((type === "fetch" || type === "xhr") && isWrite(method)) || type === "ping";
};

/** True when a request is a prefetch or prerender the browser makes for a page (its `Sec-Purpose` header). */
export const speculative = (headers: Record<string, string>): boolean => {
  return Object.entries(headers).some(([name, value]) => /^(sec-)?purpose$/i.test(name) && /prefetch|prerender/i.test(String(value)));
};

// Pre-compute the negated alternation as a single source of truth; tests of the bare/retention/never paths live there.
import { CANCELS, BARE_CANCEL, NEGATED, RETENTION, NEVER_CLICK } from "../../constants/paywall-trust-constants.js";

/** How long the exported spec reads the plan after the route loaded, for a change that took `ms` to show: that plus QUIET_MIN_MS, in whole seconds. */
export const settleFor = (ms: number): number => Math.min(SPEC_SETTLE_MAX_MS, Math.ceil((Math.max(0, ms) + QUIET_MIN_MS) / 1000) * 1000);

/**
 * True when `name` says it goes ahead with the cancel or downgrade: not a bare "Cancel", not negated, not a retention offer, not session-ending.
 */
export const namesTheCancel = (name: string): boolean =>
  CANCELS.test(name) && !BARE_CANCEL.test(name) && !NEGATED.test(name) && !RETENTION.test(name) && !NEVER_CLICK.test(name);