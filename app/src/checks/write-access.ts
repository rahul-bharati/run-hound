/**
 * write-access (0.6.0, docs/v2-spec.md "`write-access`" and "`write-access` amendments"): can Account B, or a visitor
 * who isn't signed in, change or delete a record that belongs to Account A?
 *
 * Contract (implemented by node N3; tests by N2):
 * - Scenarios `other-account` (as B; needs B set up and `isolated`) and `signed-out`, planned per form only on a
 *   signed-in run and only for a form that saves a record (`savesOwnRecord`). Unticked by default, not destructive.
 * - As A, create the run's test record through the form, find its record endpoint and snapshot it
 *   (lib/record-state.ts). The update and delete requests are only those the app itself sent for that record: never a
 *   guessed endpoint. None observed → skipped with the reason.
 * - As the scenario's identity, send each observed update with one field set to a fresh run-token marker that can't
 *   be confused with the created value or another scenario's marker; DELETE last, only when the app showed one.
 * - Verdict from a re-read as A, never a status code: changed or gone → critical, confirmed; otherwise pass, naming
 *   the requests tried. After every attempt, restore and re-read; anything not restored is named, and the scenario is
 *   not a pass while that note stands.
 *
 * Foundation stub: registered so the id plans and reports like the other checks, but it plans nothing yet.
 */
import type { Check, Scenario } from "../core/types.js";
import { errorResult } from "./lib/functional-finding.js";

const ID = "write-access" as const;

export const check: Check = {
  id: ID,
  title: "Other accounts and visitors can't change your records",
  category: "security",
  scope: "form",
  interruptedNote:
    "If Run Hound had already sent a change as another account or signed out, Account A's test record may have changed or been deleted: check Account A.",

  plan(): Scenario[] {
    return [];
  },

  async run(_ctx, scenario) {
    return errorResult(ID, scenario, Date.now(), "Skipped: this check isn't built yet.", "skipped");
  },
};
