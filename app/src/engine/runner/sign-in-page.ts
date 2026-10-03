/** Page-side sign-in detection used by both plan-flow and run-flow. The raw page script SHOWS_SIGN_IN_FORM is a private module-local literal — every line is a regression risk, so it lives next to its only consumer. */

import type { Page } from "playwright";
import type { DiscoveredPage } from "../../core/types.js";
import { firstStepForm, samePage } from "../auth.js";
import type { TestAccount } from "../../interfaces/accounts.js";
import { discoverPage } from "../discover.js";

/**
 * Runs in the page: true when it shows a sign-in form: a visible form with one visible password field that isn't a
 * new password, one or two fields for the username, and sign-in words in the form, its buttons or the page heading
 * (and not only sign-up words). A "Change email" form that asks for the current password is not one.
 */
const SHOWS_SIGN_IN_FORM = String.raw`(() => {
  const shown = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const signIn = /\b(sign|log)[\s-]?(in|on)\b|\blogin\b/i;
  const signUp = /\b(sign[\s-]?up|register|create\s+(an?\s+|your\s+|my\s+)?account|join)\b/i;
  const text = (el) => (el ? [el.getAttribute("aria-label"), el.getAttribute("name"), el.id, el.innerText].join(" ") : "");
  const heading = [document.title, text(document.querySelector("h1"))].join(" ");
  for (const pw of document.querySelectorAll("input[type=password]")) {
    if (!shown(pw) || /new-password/i.test(pw.getAttribute("autocomplete") || "")) continue;
    const form = pw.form || pw.closest("form, [role=form]") || (pw.parentElement && pw.parentElement.parentElement);
    if (!form) continue;
    if (Array.from(form.querySelectorAll("input[type=password]")).filter(shown).length !== 1) continue;
    const ids = Array.from(form.querySelectorAll("input")).filter((el) => shown(el) && ["text", "email", "tel", ""].includes((el.getAttribute("type") || "").toLowerCase()));
    if (ids.length === 0 || ids.length > 2) continue;
    const buttons = Array.from(form.querySelectorAll("button, input[type=submit], [role=button]")).map((b) => b.innerText || b.value || b.getAttribute("aria-label") || "").join(" ");
    const own = [form.getAttribute("aria-label"), form.getAttribute("name"), form.id, buttons, text(form.querySelector("h1, h2, legend"))].join(" ");
    if (signUp.test(own) && !signIn.test(own)) continue;
    if (signIn.test(own) || signIn.test(heading)) return true;
  }
  return false;
})()`;

/** True when a page opened with the account's session landed on the sign-in page anyway. */
export async function landedOnSignIn(page: Page, target: string, account: TestAccount): Promise<boolean> {
  const now = page.url();
  if (samePage(target, account.loginUrl)) return false;
  if (samePage(now, account.loginUrl)) return true;
  let path = "";
  try {
    path = new URL(now).pathname;
  } catch {
    return false;
  }
  if (!samePage(now, target) && /log-?in|sign-?in|auth/i.test(path)) {
    if ((await page.locator("input[type=password]:visible").count().catch(() => 0)) > 0) return true;
    if (await showsFirstStep(page)) return true;
  }
  return Boolean(await page.evaluate(SHOWS_SIGN_IN_FORM).catch(() => false));
}

/** True when the page shows the first step of a two-step sign-in. */
export async function showsFirstStep(page: Page): Promise<boolean> {
  try {
    const { forms } = await discoverPage(page);
    return (await firstStepForm(page, forms, page.url())) !== null;
  } catch {
    return false;
  }
}

/** Marks the email fields that hold the signed-in account's own email. */
export async function markAccountEmail(page: Page, found: DiscoveredPage, username: string): Promise<void> {
  const own = username.trim().toLowerCase();
  if (!own.includes("@")) return;
  for (const form of found.forms) {
    for (const field of form.fields) {
      if (field.type !== "email" && !/e-?mail/i.test(`${field.key} ${field.accessibleName ?? ""} ${field.label ?? ""}`)) continue;
      const value = await page.locator(field.selector).first().inputValue({ timeout: 1_000 }).catch(() => null);
      if (value !== null && value.trim().toLowerCase() === own) field.holdsAccountEmail = true;
    }
  }
}
