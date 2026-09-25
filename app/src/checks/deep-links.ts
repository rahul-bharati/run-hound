/**
 * The app's pages load when opened directly (0.4.0, V2). Page scope (docs/v2-spec.md "deep-links"): opens up to 10 same-origin links from the page directly in a fresh context and reports those that answer >= 400 or render a not-found view.
 * Contract stub: plans nothing until implemented.
 */
import type { Check } from "../core/types.js";
import { notImplemented } from "../ai/not-implemented.js";

export const check: Check = {
  id: "deep-links",
  title: "The app's pages load when opened directly",
  category: "broken-feature",
  scope: "page",
  plan() {
    return [];
  },
  async run() {
    return notImplemented("deep-links");
  },
};
