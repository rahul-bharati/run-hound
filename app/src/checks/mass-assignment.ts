/**
 * The server ignores fields the form never sends (role, plan) (0.4.0, V2). Planned signed in, per saving form, unticked (docs/v2-spec.md "mass-assignment"): replays the form's JSON save with privilege fields added, re-reads the record, reports fields the server stored, and restores what it can.
 * Contract stub: plans nothing until implemented.
 */
import type { Check } from "../core/types.js";
import { notImplemented } from "../ai/not-implemented.js";

export const check: Check = {
  id: "mass-assignment",
  title: "The server ignores fields the form never sends (role, plan)",
  category: "security",
  scope: "form",
  plan() {
    return [];
  },
  async run() {
    return notImplemented("mass-assignment");
  },
};
