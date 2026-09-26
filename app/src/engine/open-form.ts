/**
 * Forms that only appear after a click (0.4.0): a form in a dialog, sheet or popover (DiscoveredForm.opener).
 * CheckContext.openPage calls openForm after every page load, so checks never need to know the form was hidden.
 */
import type { Page } from "playwright";
import type { DiscoveredForm } from "../core/types.js";

/** How long openForm waits for the form to be visible after clicking its opener. */
export const OPEN_FORM_TIMEOUT_MS = 5_000;

/** "the New project form", "the Signup form", or "the form" for a form without a name. */
function formPhrase(form: DiscoveredForm): string {
  const name = form.name?.replace(/\s+/g, " ").trim();
  if (!name) return "the form";
  return /\bform$/i.test(name) ? `the ${name}` : `the ${name} form`;
}

/**
 * Clicks `form.opener` and waits until the form's selector is visible. No-op for a form without an opener or one that
 * is already visible. Throws an Error with a plain message ("Clicking \"New project\" didn't show the New project
 * form.") when the form doesn't appear within OPEN_FORM_TIMEOUT_MS.
 */
export async function openForm(page: Page, form: DiscoveredForm): Promise<void> {
  if (!form.opener) return;
  const target = page.locator(form.selector).first();
  if (await target.isVisible().catch(() => false)) return;
  const deadline = Date.now() + OPEN_FORM_TIMEOUT_MS;
  const left = () => Math.max(1, deadline - Date.now());
  try {
    await page.locator(form.opener.selector).first().click({ timeout: left() });
    await target.waitFor({ state: "visible", timeout: left() });
  } catch {
    const opener = form.opener.name ? `"${form.opener.name}"` : "its button";
    throw new Error(`Clicking ${opener} didn't show ${formPhrase(form)}.`);
  }
}

/**
 * Spec lines that do what openForm does, for an exported spec right after it loads the page: click the opener and
 * wait for the form. None for a form without an opener.
 */
export function openFormSpec(form: DiscoveredForm): string[] {
  if (!form.opener) return [];
  const what = form.opener.name ? `: click "${form.opener.name.replace(/\s+/g, " ").trim()}"` : "";
  return [
    `// The form is in a dialog; open it${what}.`,
    `await page.locator(${JSON.stringify(form.opener.selector)}).first().click();`,
    `await page.locator(${JSON.stringify(form.selector)}).first().waitFor();`,
  ];
}
