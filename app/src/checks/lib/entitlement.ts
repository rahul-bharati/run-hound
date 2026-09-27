/**
 * Account A's entitlement (plan, role, credits, entitlements), read and compared as Account A (0.6.0, docs/v2-spec.md
 * "`paywall-trust` amendments"). Used by paywall-trust only. Every read is a GET as Account A through
 * CheckContext.request (the safety gate applies). Nothing here writes: restoring a changed plan goes through the app's
 * own UI in paywall-trust.
 *
 * Contract (implemented by node N5; tests by N4, in entitlement.test.ts).
 */
import type { CheckContext } from "../../core/types.js";

/** The fields that make a JSON object an entitlement, matched case-insensitively on the key. */
export const ENTITLEMENT_KEYS = ["plan", "tier", "subscription", "isPro", "pro", "credits", "entitlements", "features", "role"] as const;

/** A request the app itself made as Account A while the page loaded (method, absolute URL, JSON response body). */
export interface ObservedRead {
  method: string;
  url: string;
  status: number;
  /** The parsed JSON body, or null when it wasn't JSON. */
  json: unknown;
}

/** Where Account A's entitlement lives, and its values when it was found. */
export interface EntitlementSnapshot {
  /** The GET that returned it (same origin as the page, or the app's local API). */
  url: string;
  /** Dotted path to the object inside the response (e.g. "" for the root, "user", "data.account"). */
  path: string;
  /** The entitlement fields found, with their values (JSON values, compared structurally). */
  values: Record<string, unknown>;
}

/**
 * The first observed GET whose JSON describes the signed-in account and holds at least one ENTITLEMENT_KEYS field.
 * `account` names Account A (its username or email) so a list of other users' objects isn't taken for A's; the value is
 * matched but never returned or logged. Null when none qualifies.
 */
export function findEntitlement(_reads: ObservedRead[], _account: { username: string }): EntitlementSnapshot | null {
  throw new Error("entitlement.findEntitlement isn't built yet");
}

/** Re-read the entitlement as Account A; null when the read itself failed (not "changed"). */
export async function rereadEntitlement(_ctx: CheckContext, _snap: EntitlementSnapshot): Promise<Record<string, unknown> | null> {
  throw new Error("entitlement.rereadEntitlement isn't built yet");
}

/** The field names whose values differ between the snapshot and a re-read (structural comparison). */
export function changedEntitlement(_before: Record<string, unknown>, _after: Record<string, unknown>): string[] {
  throw new Error("entitlement.changedEntitlement isn't built yet");
}

/** True when the values already describe a paid plan (e.g. plan/tier not "free", isPro/pro true). */
export function isPaid(_values: Record<string, unknown>): boolean {
  throw new Error("entitlement.isPaid isn't built yet");
}
