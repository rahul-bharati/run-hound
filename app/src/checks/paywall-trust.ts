/**
 * paywall-trust (0.5.0, docs/v2-spec.md "`paywall-trust`"): can Account A get a paid plan or paid features without paying?
 * Foundation stub: registered so the id plans and reports like the other checks, but it plans nothing yet. Unticked
 * by default once it plans: it changes Account A's own test record and restores it.
 */
import type { Check, Scenario } from "../core/types.js";
import { errorResult } from "./lib/functional-finding.js";

const ID = "paywall-trust" as const;

export const check: Check = {
  id: ID,
  title: "Paid plans and features need a real payment",
  category: "security",
  scope: "page",
  interruptedNote: "If Run Hound had already sent a probe, Account A's plan, role or credits may have changed: check Account A.",

  plan(): Scenario[] {
    return [];
  },

  async run(_ctx, scenario) {
    return errorResult(ID, scenario, Date.now(), "Skipped: this check isn't built yet.", "skipped");
  },
};
