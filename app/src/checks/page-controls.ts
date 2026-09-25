/**
 * page-controls (V1): click every button and button-like control outside the page's forms (toolbars, list actions,
 * toggles, href="#" links) on a freshly loaded page, and fail when a click causes no request, DOM change, navigation,
 * storage change, value change or focus change. The same probe as dead-control, without typing anything first.
 */
import type { Check, Scenario } from "../core/types.js";
import { clickEach, isDestructiveControl } from "./dead-control.js";
import { listOf } from "./lib/a11y-common.js";
import { controlName } from "./lib/functional-form.js";

const ID = "page-controls" as const;

/** At most this many controls are clicked; each needs a fresh page load. */
export const MAX_PAGE_CONTROLS = 20;

export const check: Check = {
  id: ID,
  title: "Every button on the page does something",
  category: "broken-feature",
  scope: "page",

  plan(_form, page): Scenario[] {
    const controls = page?.controls ?? [];
    const safe = controls.filter((c) => !isDestructiveControl(c)).slice(0, MAX_PAGE_CONTROLS);
    const risky = controls.filter(isDestructiveControl);
    if (safe.length === 0) return [];
    return [
      {
        id: "page-controls:click-outside-forms",
        checkId: ID,
        title: "Click every button outside the forms",
        description:
          (safe.length === 1
            ? `Click ${listOf(safe.map(controlName))} on a freshly loaded page and check that it causes`
            : `Click ${listOf(safe.map(controlName), 12)} one at a time, each on a freshly loaded page, and check that each causes`) +
          " a request, a page change, navigation, a storage change or a focus change." +
          (risky.length > 0 ? ` Left out unless you allow destructive scenarios: ${listOf(risky.map(controlName), 8)}.` : "") +
          " A button that saves something may create test records.",
        kind: "golden",
        priority: "high",
        destructive: false,
        defaultSelected: true,
      },
    ];
  },

  run(ctx, scenario) {
    const controls = (ctx.discoveredPage?.controls ?? []).slice(0, MAX_PAGE_CONTROLS + 20);
    const safe = controls.filter((c) => !isDestructiveControl(c)).slice(0, MAX_PAGE_CONTROLS);
    return clickEach(ctx, scenario, { id: ID, controls: [...safe, ...controls.filter(isDestructiveControl)], values: [] });
  },
};
