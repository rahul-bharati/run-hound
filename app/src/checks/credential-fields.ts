/**
 * credential-fields: password and one-time-code fields must accept paste (WCAG 3.3.8, password
 * managers) and should carry autocomplete tokens. Paste blocking is confirmed by a cancelable paste
 * event the page prevents; a missing autocomplete token is advisory.
 */
import type { Check, CheckContext, DiscoveredForm, FormField, Scenario } from "../core/types.js";
import { checkResult, evalIn, fieldName, FindingList, guarded, playwrightSpec, scenarioFor } from "./lib/a11y-common.js";

function isCredentialField(field: FormField): boolean {
  return field.type === "password" || /otp|one-?time|2fa|mfa|verification-?code/i.test(field.key);
}

/** The text Run Hound pastes. Not a real credential. */
const PASTED = "Pasted-Test-Value-123";

interface PasteResult {
  /** False when the page cancelled the paste event. */
  allowed: boolean;
  /** Length of the field's value after the paste. */
  valueLength: number;
}

/**
 * Focuses the field and pastes into it: a cancelable paste event, then (when the page lets it through) the text is
 * inserted the way the browser would. Reports whether the page cancelled it and what the field holds afterwards.
 */
const PASTE = `(args) => {
  const el = document.querySelector(args.selector);
  if (!el) return { allowed: true, valueLength: 0 };
  el.focus();
  const dt = new DataTransfer();
  dt.setData("text/plain", args.text);
  const allowed = el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  if (allowed) document.execCommand("insertText", false, args.text);
  return { allowed, valueLength: typeof el.value === "string" ? el.value.length : 0 };
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
      // Paste into every field first, so a field that accepted the paste can be shown next to one that blocked it.
      const pastes: PasteResult[] = [];
      for (const field of fields) {
        ctx.step(`Pasting a test value into "${fieldName(field)}"`, page);
        pastes.push(await evalIn<PasteResult>(page, PASTE, { selector: field.selector, text: PASTED }));
      }
      const accepted = fields.find((_, i) => pastes[i]!.allowed && pastes[i]!.valueLength > 0);
      for (const [i, field] of fields.entries()) {
        const name = fieldName(field);
        const paste = pastes[i]!;
        const autocomplete = String(await page.evaluate(`(${AUTOCOMPLETE})(${JSON.stringify(field.selector)})`)).trim();
        const autocompleteFact = { label: "autocomplete attribute", value: autocomplete ? `"${autocomplete}"` : "missing" };
        if (!paste.allowed) {
          const frame = await ctx.capture(page, `Paste into ${name}`, {
            step: `Paste ${PASTED.length} characters into "${name}"`,
            highlights: [
              { selector: field.selector, label: "Paste blocked" },
              ...(accepted ? [{ selector: accepted.selector, label: `Same paste accepted in "${fieldName(accepted)}"`, tone: "pass" as const }] : []),
            ],
            facts: [
              { label: "Pasted text length", value: `${PASTED.length} characters` },
              { label: "Value length after paste", value: `${paste.valueLength} characters` },
              { label: "Paste event", value: "cancelled by the page (preventDefault)" },
              autocompleteFact,
            ],
            caption: `${PASTED.length} characters were pasted into "${name}"; the page cancelled the paste and the field holds ${paste.valueLength}.`,
          });
          findings.add({
            title: `Paste is blocked in "${name}"`,
            severity: "medium",
            meaning: `The "${name}" field stops people from pasting into it. Password managers and people who copy their password from somewhere else can't fill it in.`,
            impact: "People with memory or motor difficulties, and anyone using a password manager, have to type a long password by hand, and many will give up or pick a weaker one.",
            fix: `Remove the code that cancels paste on "${name}" (an onPaste/"paste" handler calling preventDefault or returning false).`,
            location: name,
            evidence: [
              { kind: "dom", label: `Paste event on ${field.selector} was cancelled by the page`, data: { selector: field.selector, pasteAllowed: false, pastedLength: PASTED.length, valueLength: paste.valueLength } },
              frame,
            ],
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
        if (!autocomplete || autocomplete === "off") {
          const token = expectedToken(field);
          const frame = await ctx.capture(page, `autocomplete on ${name}`, {
            step: `Read the autocomplete attribute of "${name}"`,
            highlights: [{ selector: field.selector, label: "No autocomplete hint" }],
            facts: [autocompleteFact, { label: "Expected autocomplete", value: token }],
            caption: `"${name}" doesn't tell password managers what it holds (autocomplete is ${autocompleteFact.value}).`,
          });
          findings.add({
            title: `"${name}" has no autocomplete hint`,
            severity: "low",
            confidence: "advisory",
            meaning: `The "${name}" field doesn't tell browsers and password managers what it is for (its autocomplete attribute is ${autocomplete ? `"${autocomplete}"` : "missing"}), so they may not offer to fill or save the password.`,
            impact: "People who rely on autofill have to type or remember credentials, which is harder for people with memory or motor difficulties.",
            fix: `Add autocomplete="${token}" to the "${name}" field.`,
            location: name,
            evidence: [
              { kind: "dom", label: `autocomplete attribute on ${field.selector}`, data: { selector: field.selector, autocomplete: autocomplete || null, suggested: token } },
              frame,
            ],
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
