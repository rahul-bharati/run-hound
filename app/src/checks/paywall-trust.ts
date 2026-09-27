/**
 * paywall-trust (0.6.0, docs/v2-spec.md "`paywall-trust`" and "`paywall-trust` amendments"): can Account A get a paid
 * plan without paying?
 *
 * Contract (implemented by node N5; tests by N4):
 * - One page-scoped scenario, planned only on a signed-in run. Unticked by default, not destructive.
 * - It may change Account A's entitlement (plan, role, credits, entitlements) and nothing else: snapshot it first with
 *   lib/entitlement.ts, restore it after, and never pass while a restore note stands.
 * - No entitlement endpoint → skipped ("No plan or entitlement data was found, so this can't be checked"); A already
 *   paid → skipped.
 * - Probe (0.6.0 only): open the app's own success/upgraded/thank-you routes (links first, then the conventional paths
 *   the spec lists; same origin, at most 10) as A with the guard on, and re-read the entitlement after each. Run Hound
 *   never enters payment details and never calls a payment provider; blocked provider requests are listed.
 * - Verdict: the entitlement changed → critical, confirmed, "Account A got a paid plan without paying", naming the
 *   route; page text alone is at most advisory.
 * - Restore through the app's own cancel/downgrade control (the only check allowed to click one, and only to undo its
 *   own change), then re-read; a remaining difference is named ("… check Account A").
 * - Not in 0.6.0: the client-sent price/plan replay and the paid-feature API probe (known limits).
 *
 * Foundation stub: registered so the id plans and reports like the other checks, but it plans nothing yet.
 */
import type { Check, Scenario } from "../core/types.js";
import { errorResult } from "./lib/functional-finding.js";

const ID = "paywall-trust" as const;

export const check: Check = {
  id: ID,
  title: "Paid plans need a real payment",
  category: "security",
  scope: "page",
  interruptedNote: "If Run Hound had already opened a success page, Account A's plan, role or credits may have changed: check Account A.",

  plan(): Scenario[] {
    return [];
  },

  async run(_ctx, scenario) {
    return errorResult(ID, scenario, Date.now(), "Skipped: this check isn't built yet.", "skipped");
  },
};
