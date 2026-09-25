/**
 * Another account or a signed-out visitor can't read your data (0.4.0, V2). Planned signed in (docs/v2-spec.md "access-control"): scenarios "access-control:other-account" (account B, when configured and isolated) and "access-control:signed-out". Establishes account A's data on the page (a test record from the main saving form, else responses naming the account), then replays A's data requests as B and signed out. Read-only.
 * Contract stub: plans nothing until implemented.
 */
import type { Check } from "../core/types.js";
import { notImplemented } from "../ai/not-implemented.js";

export const check: Check = {
  id: "access-control",
  title: "Another account or a signed-out visitor can't read your data",
  category: "security",
  scope: "page",
  plan() {
    return [];
  },
  async run() {
    return notImplemented("access-control");
  },
};
