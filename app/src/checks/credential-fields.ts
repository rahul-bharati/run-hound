/**
 * credential-fields: password and one-time-code fields must accept paste (WCAG 3.3.8, password
 * managers) and should carry autocomplete tokens. Paste blocking is confirmed by a cancelable paste
 * event the page prevents; a missing autocomplete token is advisory.
 */
import type { Check, CheckContext, DiscoveredForm, FormField, Scenario } from "../core/types.js";
import { checkResult, fieldName, FindingList, guarded, playwrightSpec, scenarioFor } from "./lib/a11y-common.js";

function isCredentialField(field: FormField): boolean {
  return field.type === "password" || /otp|one-?time|2fa|mfa|verification-?code/i.test(field.key);
}

/** Dispatches a cancelable paste event; returns true when the page did NOT prevent it. */
const PASTE_ALLOWED = `(selector) => {
  const el = document.querySelector(selector);
  if (!el) return true;
  const dt = new DataTransfer();
  dt.setData("text/plain", "Pasted-Test-Value-123");
  return el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
}`;

const AUTOCOMPLETE = `(selector) => {
  const el = document.querySelector(selector);
  return el ? (el.getAttribute("autocomplete") || "") : "";
}`;

function expectedToken(field: FormField): string {
  if (field.type === "password") return /confirm|new|repeat|again/i.test(`${field.key} ${fieldName(field)}`) ? "new-password" : "current-password or new-password";
  return "one-time-code";
}

export const check: Check = {
  id: "credential-fields",
  title: "Password fields allow paste and autofill",
  category: "accessibility",

  plan(form: DiscoveredForm): Scenario[] {
    if (!form.fields.some(isCredentialField)) return [];
    return [
      scenarioFor("credential-fields", "paste-and-autocomplete", {
        title: "Paste into password fields and check autofill hints",
        description: "Pastes a test value into each password or one-time-code field (nothing is submitted) and checks each has an autocomplete hint.",
        priority: "medium",
      }),
    ];
  },

  async run(ctx: CheckContext, scenario: Scenario) {
    return guarded("credential-fields", scenario, async (startedAt) => {
      const findings = new FindingList("credential-fields", "accessibility");
      const { page } = await ctx.openPage();
      const fields = ctx.form.fields.filter(isCredentialField);
      for (const field of fields) {
        const name = fieldName(field);
        const pasteOk = await page.evaluate(`(${PASTE_ALLOWED})(${JSON.stringify(field.selector)})`);
        if (pasteOk === false) {
          findings.add({
            title: `Paste is blocked in "${name}"`,
            severity: "medium",
            meaning: `The "${name}" field stops people from pasting into it. Password managers and people who copy their password from somewhere else can't fill it in.`,
            impact: "People with memory or motor difficulties, and anyone using a password manager, have to type a long password by hand, and many will give up or pick a weaker one.",
            fix: `Remove the code that cancels paste on "${name}" (an onPaste/"paste" handler calling preventDefault or returning false).`,
            location: name,
            evidence: [{ kind: "dom", label: `Paste event on ${field.selector} was cancelled by the page`, data: { selector: field.selector, pasteAllowed: false } }],
            spec: playwrightSpec(
              "credential-fields",
              findings.items.length + 1,
              `paste is allowed in ${name}`,
              ctx.targetUrl,
              `const allowed = await page.locator(${JSON.stringify(field.selector)}).evaluate((el) => {
  const dt = new DataTransfer();
  dt.setData("text/plain", "Pasted-Test-Value-123");
  return el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
});
expect(allowed).toBe(true);`,
            ),
          });
        }
        const autocomplete = String(await page.evaluate(`(${AUTOCOMPLETE})(${JSON.stringify(field.selector)})`)).trim();
        if (!autocomplete || autocomplete === "off") {
          const token = expectedToken(field);
          findings.add({
            title: `"${name}" has no autocomplete hint`,
            severity: "low",
            confidence: "advisory",
            meaning: `The "${name}" field doesn't tell browsers and password managers what it is for (its autocomplete attribute is ${autocomplete ? `"${autocomplete}"` : "missing"}), so they may not offer to fill or save the password.`,
            impact: "People who rely on autofill have to type or remember credentials, which is harder for people with memory or motor difficulties.",
            fix: `Add autocomplete="${token}" to the "${name}" field.`,
            location: name,
            evidence: [{ kind: "dom", label: `autocomplete attribute on ${field.selector}`, data: { selector: field.selector, autocomplete: autocomplete || null, suggested: token } }],
            spec: playwrightSpec(
              "credential-fields",
              findings.items.length + 1,
              `${name} has an autocomplete hint`,
              ctx.targetUrl,
              `await expect(page.locator(${JSON.stringify(field.selector)})).toHaveAttribute("autocomplete", /\\S/);
await expect(page.locator(${JSON.stringify(field.selector)})).not.toHaveAttribute("autocomplete", "off");`,
            ),
          });
        }
      }
      return checkResult("credential-fields", scenario, startedAt, findings.items, `Checked ${fields.length} credential field(s)`);
    });
  },
};
