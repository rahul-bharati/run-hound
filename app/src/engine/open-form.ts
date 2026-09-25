/**
 * Forms that only appear after a click (0.4.0): a form in a dialog, sheet or popover (DiscoveredForm.opener).
 * CheckContext.openPage calls openForm after every page load, so checks never need to know the form was hidden.
 */
import type { Page } from "playwright";
import { notImplemented } from "../ai/not-implemented.js";
import type { DiscoveredForm } from "../core/types.js";

/** How long openForm waits for the form to be visible after clicking its opener. */
export const OPEN_FORM_TIMEOUT_MS = 5_000;

/**
 * Clicks `form.opener` and waits until the form's selector is visible. No-op for a form without an opener or one that
 * is already visible. Throws an Error with a plain message ("Clicking \"New project\" didn't show the New project
 * form.") when the form doesn't appear within OPEN_FORM_TIMEOUT_MS.
 */
export async function openForm(page: Page, form: DiscoveredForm): Promise<void> {
  void page;
  void form;
  return notImplemented("openForm");
}
