/**
 * credential-fields: password and one-time-code fields must accept paste (WCAG 3.3.8, password
 * managers) and should carry autocomplete tokens. Paste blocking is confirmed by a cancelable paste
 * event the page prevents; a missing autocomplete token is advisory.
 */
import type { Check, CheckContext, DiscoveredForm, Evidence, FormField, Scenario } from "../core/types.js";
import { checkResult, evalIn, fieldName, FindingList, guarded, listOf, playwrightSpec, scenarioFor, uniquePlaces } from "./lib/a11y-common.js";

/** At most this many fields per problem get their own evidence frame (the finding still names every field). */
const MAX_FRAMES = 6;

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
      interface Hit {
        field: FormField;
        name: string;
        frame: Evidence | null;
        autocomplete: string;
        valueLength: number;
      }
      const blocked: Hit[] = [];
      const unhinted: Hit[] = [];
      for (const [i, field] of fields.entries()) {
        const name = fieldName(field);
        const paste = pastes[i]!;
        const autocomplete = String(await page.evaluate(`(${AUTOCOMPLETE})(${JSON.stringify(field.selector)})`)).trim();
        const autocompleteFact = { label: "autocomplete attribute", value: autocomplete ? `"${autocomplete}"` : "missing" };
        if (!paste.allowed) {
          // A frame per field, up to 6; the finding still names every field.
          const frame =
            blocked.length >= MAX_FRAMES
              ? null
              : await ctx.capture(page, `Paste into ${name}`, {
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
          blocked.push({ field, name, frame, autocomplete, valueLength: paste.valueLength });
        }
        if (!autocomplete || autocomplete === "off") {
          const token = expectedToken(field);
          const frame =
            unhinted.length >= MAX_FRAMES
              ? null
              : await ctx.capture(page, `autocomplete on ${name}`, {
                  step: `Read the autocomplete attribute of "${name}"`,
                  highlights: [{ selector: field.selector, label: "No autocomplete hint" }],
                  facts: [autocompleteFact, { label: "Expected autocomplete", value: token }],
                  caption: `"${name}" doesn't tell password managers what it holds (autocomplete is ${autocompleteFact.value}).`,
                });
          unhinted.push({ field, name, frame, autocomplete, valueLength: paste.valueLength });
        }
      }

      // One finding per problem (paste blocked; no autocomplete hint), each naming every field it affects.
      if (blocked.length > 0) {
        const many = blocked.length > 1;
        const first = blocked[0]!;
        const places = uniquePlaces(blocked.map((b) => ({ name: b.name, selector: b.field.selector })));
        const names = listOf(blocked.map((b) => b.name));
        findings.add({
          title: many ? `Paste is blocked in ${blocked.length} fields` : `Paste is blocked in "${first.name}"`,
          severity: "medium",
          meaning: `${many ? `The ${names} fields stop` : `The "${first.name}" field stops`} people from pasting. Password managers and people who copy their password from somewhere else can't fill ${many ? "them" : "it"} in.`,
          impact: "People with memory or motor difficulties, and anyone using a password manager, have to type a long password by hand, and many will give up or pick a weaker one.",
          fix: `Remove the code that cancels paste on ${names} (an onPaste/"paste" handler calling preventDefault or returning false).`,
          location: places[0]!,
          ...(many ? { locations: places } : {}),
          evidence: [
            {
              kind: "dom",
              label: many ? `Paste events on ${blocked.length} fields were cancelled by the page` : `Paste event on ${first.field.selector} was cancelled by the page`,
              data: blocked.map((b) => ({ field: b.name, selector: b.field.selector, pasteAllowed: false, pastedLength: PASTED.length, valueLength: b.valueLength })),
            },
            ...blocked.flatMap((b) => (b.frame ? [b.frame] : [])),
          ],
          spec: playwrightSpec(
            "credential-fields",
            findings.items.length + 1,
            many ? "paste is allowed in every password field" : `paste is allowed in ${first.name}`,
            ctx.targetUrl,
            `for (const selector of ${JSON.stringify(blocked.map((b) => b.field.selector))}) {
  const allowed = await page.locator(selector).evaluate((el) => {
    const dt = new DataTransfer();
    dt.setData("text/plain", "Pasted-Test-Value-123");
    return el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  expect(allowed, selector).toBe(true);
}`,
          ),
        });
      }
      if (unhinted.length > 0) {
        const many = unhinted.length > 1;
        const first = unhinted[0]!;
        const places = uniquePlaces(unhinted.map((u) => ({ name: u.name, selector: u.field.selector })));
        findings.add({
          title: many ? `${unhinted.length} password fields have no autocomplete hint` : `"${first.name}" has no autocomplete hint`,
          severity: "low",
          confidence: "advisory",
          meaning: `${
            many
              ? `${listOf(unhinted.map((u) => u.name))} don't tell browsers and password managers what they are for`
              : `The "${first.name}" field doesn't tell browsers and password managers what it is for (its autocomplete attribute is ${first.autocomplete ? `"${first.autocomplete}"` : "missing"})`
          }, so they may not offer to fill or save the password.`,
          impact: "People who rely on autofill have to type or remember credentials, which is harder for people with memory or motor difficulties.",
          fix: unhinted.map((u) => `Add autocomplete="${expectedToken(u.field)}" to the "${u.name}" field.`).join(" "),
          location: places[0]!,
          ...(many ? { locations: places } : {}),
          evidence: [
            {
              kind: "dom",
              label: many ? `autocomplete attributes on ${unhinted.length} fields` : `autocomplete attribute on ${first.field.selector}`,
              data: unhinted.map((u) => ({ field: u.name, selector: u.field.selector, autocomplete: u.autocomplete || null, suggested: expectedToken(u.field) })),
            },
            ...unhinted.flatMap((u) => (u.frame ? [u.frame] : [])),
          ],
          spec: playwrightSpec(
            "credential-fields",
            findings.items.length + 1,
            many ? "every password field has an autocomplete hint" : `${first.name} has an autocomplete hint`,
            ctx.targetUrl,
            `for (const selector of ${JSON.stringify(unhinted.map((u) => u.field.selector))}) {
  await expect(page.locator(selector)).toHaveAttribute("autocomplete", /\\S/);
  await expect(page.locator(selector)).not.toHaveAttribute("autocomplete", "off");
}`,
          ),
        });
      }
      return checkResult("credential-fields", scenario, startedAt, findings.items, `Checked ${fields.length} credential field(s)`);
    });
  },
};
