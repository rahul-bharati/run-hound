/**
 * keyboard-completion: fill and submit the form using only Tab, arrow keys, Space, Enter and typing.
 * Every required field (and every custom picker, whose "required" state the page can't tell us) must
 * be reachable with Tab and settable from the keyboard, and the submission must be accepted (2xx).
 */
import type { Page } from "playwright";
import type { Check, CheckContext, DiscoveredForm, Finding, FormField, Scenario } from "../core/types.js";
import { checkResult, evalIn, fieldName, FindingList, guarded, playwrightSpec, scenarioFor, submitControl } from "./lib/a11y-common.js";
import { canaries, sameOrigin, settle, textValueFor, type Canaries } from "./lib/a11y-form.js";

const MAX_TABS = 200;

interface Focus {
  /** Stable index of the focused element; -1 for the body. */
  index: number;
  /** Index into the target selectors of the field containing focus, or -1. */
  field: number;
  isSubmit: boolean;
  tag: string;
}

const WHERE = `(args) => {
  const el = document.activeElement;
  window.__rhKb = window.__rhKb || new Map();
  if (!el || el === document.body || el === document.documentElement) return { index: -1, field: -1, isSubmit: false, tag: "" };
  if (!window.__rhKb.has(el)) window.__rhKb.set(el, window.__rhKb.size);
  const inside = (sel) => { const t = document.querySelector(sel); return !!t && (t === el || t.contains(el)); };
  return {
    index: window.__rhKb.get(el),
    field: args.selectors.findIndex(inside),
    isSubmit: inside(args.submit),
    tag: el.tagName.toLowerCase(),
  };
}`;

/** Whether a field now holds a value (checked radio, non-empty input/select). */
const HAS_VALUE = `(sel) => {
  const el = document.querySelector(sel);
  if (!el) return false;
  if (el.matches("input[type=radio],input[type=checkbox]")) return el.checked;
  if (el.matches("input,select,textarea")) return el.value !== "";
  const inputs = [...el.querySelectorAll("input,select,textarea")];
  if (inputs.some((i) => (i.type === "radio" || i.type === "checkbox") ? i.checked : i.type !== "hidden" && i.value !== "")) return true;
  const hidden = inputs.filter((i) => i.type === "hidden");
  if (hidden.length) return hidden.some((i) => i.value !== "");
  return !!el.querySelector('[aria-checked="true"],[aria-selected="true"]');
}`;

const DATE_ORDER = `() => new Intl.DateTimeFormat(navigator.language).formatToParts(new Date(2030, 0, 5))
  .filter((p) => p.type === "year" || p.type === "month" || p.type === "day").map((p) => p.type)`;

/** Sets the focused field using only the keyboard. */
async function operate(page: Page, field: FormField, values: Canaries): Promise<void> {
  if (field.type === "radio" || field.type === "checkbox" || field.type === "custom") {
    await page.keyboard.press("Space");
    if (field.type === "custom") await page.keyboard.press("Enter");
    return;
  }
  if (field.type === "select" || field.type === "select-one") {
    for (let i = 0; i < (field.options?.length ?? 1) + 1; i++) {
      if (await evalIn<boolean>(page, HAS_VALUE, field.selector)) return;
      await page.keyboard.press("ArrowDown");
    }
    return;
  }
  const value = textValueFor(field, values);
  if (value === null) return;
  if (field.type === "date") {
    const [year, month, day] = value.split("-") as [string, string, string];
    const parts: Record<string, string> = { year, month, day };
    for (const part of await evalIn<string[]>(page, DATE_ORDER)) await page.keyboard.type(parts[part] ?? "");
    return;
  }
  await page.keyboard.type(value);
}

function keyboardSpec(ctx: CheckContext, no: number, name: string, selector: string) {
  return playwrightSpec(
    "keyboard-completion",
    no,
    `${name} can be reached with the Tab key`,
    ctx.targetUrl,
    `const target = page.locator(${JSON.stringify(selector)}).first();
let reached = false;
for (let i = 0; i < ${MAX_TABS} && !reached; i++) {
  await page.keyboard.press("Tab");
  reached = await target.evaluate((t) => t === document.activeElement || t.contains(document.activeElement));
}
expect(reached).toBe(true);`,
  );
}

export const check: Check = {
  id: "keyboard-completion",
  title: "Form can be completed with the keyboard only",
  category: "accessibility",

  plan(form: DiscoveredForm): Scenario[] {
    if (!submitControl(form) || form.fields.length === 0) return [];
    return [
      scenarioFor("keyboard-completion", "keyboard-only", {
        title: "Fill in and submit the form using only the keyboard",
        description: "Uses only Tab, arrow keys, Space, Enter and typing to fill every required field and submit. Creates one test booking.",
        priority: "high",
      }),
    ];
  },

  async run(ctx: CheckContext, scenario: Scenario) {
    return guarded("keyboard-completion", scenario, async (startedAt) => {
      const findings = new FindingList("keyboard-completion", "accessibility");
      const submit = submitControl(ctx.form)!;
      const targets = ctx.form.fields.filter((f) => f.required || f.type === "custom");
      const values = canaries(ctx.runToken, "kb");
      const { page } = await ctx.openPage();
      const args = { selectors: targets.map((f) => f.selector), submit: submit.selector };

      const reached = new Set<number>();
      const set = new Set<number>();
      let submitReachable = false;
      const visited = new Set<number>();
      let previous = -2;
      for (let i = 0; i < MAX_TABS; i++) {
        await page.keyboard.press("Tab");
        const at = await evalIn<Focus>(page, WHERE, args);
        if (at.index === -1) {
          if (visited.size > 0) break;
          continue;
        }
        if (at.index === previous) continue;
        if (visited.has(at.index)) break;
        visited.add(at.index);
        previous = at.index;
        if (at.isSubmit) submitReachable = true;
        if (at.field >= 0 && !reached.has(at.field)) {
          reached.add(at.field);
          const field = targets[at.field]!;
          await operate(page, field, values);
          if (await evalIn<boolean>(page, HAS_VALUE, field.selector)) set.add(at.field);
          // Typing can move focus inside a widget; re-read so the next Tab starts from here.
          previous = (await evalIn<Focus>(page, WHERE, args)).index;
        }
      }

      const problems: { field: FormField | null; kind: "unreachable" | "inoperable" | "submit" | "rejected" }[] = [];
      targets.forEach((field, i) => {
        if (!reached.has(i)) problems.push({ field, kind: "unreachable" });
        else if (!set.has(i) && field.type !== "custom") problems.push({ field, kind: "inoperable" });
      });
      if (!submitReachable) problems.push({ field: null, kind: "submit" });

      let status: number | null = null;
      if (problems.length === 0) {
        // Second pass: Tab to the submit button and press Enter.
        const response = page
          .waitForResponse((r) => r.request().method() !== "GET" && sameOrigin(r.url(), page.url()), { timeout: 10_000 })
          .catch(() => null);
        for (let i = 0; i < MAX_TABS; i++) {
          await page.keyboard.press("Tab");
          if ((await evalIn<Focus>(page, WHERE, args)).isSubmit) break;
        }
        await page.keyboard.press("Enter");
        status = (await response)?.status() ?? null;
        await settle(page);
        if (status === null || status < 200 || status >= 300) problems.push({ field: null, kind: "rejected" });
      }

      const shot = problems.length > 0 ? await ctx.screenshot(page, "Form after keyboard-only attempt") : null;
      for (const p of problems) {
        const no = findings.items.length + 1;
        const name = p.field ? fieldName(p.field) : (submit.accessibleName ?? submit.text) || "Submit button";
        const selector = p.field?.selector ?? submit.selector;
        const base = {
          severity: "high" as const,
          location: name,
          evidence: [
            {
              kind: "dom" as const,
              label: `Keyboard walk through the form (${visited.size} stops)`,
              data: { selector, problem: p.kind, tabStops: visited.size, submitStatus: status },
            },
            ...(shot ? [shot] : []),
          ],
          spec: keyboardSpec(ctx, no, name, selector),
        };
        const texts: Record<typeof p.kind, Pick<Finding, "title" | "meaning" | "impact" | "fix">> = {
          unreachable: {
            title: `"${name}" can't be reached with the keyboard`,
            meaning: `Pressing Tab never moves to "${name}", so someone using only a keyboard can't choose a value and can't finish the form.`,
            impact: "People who can't use a mouse (including many screen reader users and people with motor impairments) are completely blocked from booking.",
            fix: `Build "${name}" from native controls (for example <input type="radio"> in a <fieldset> with a <legend>), or give the custom widget role="radiogroup"/role="radio", tabindex and arrow-key/Space handlers.`,
          },
          inoperable: {
            title: `"${name}" can't be set with the keyboard`,
            meaning: `Tab reaches "${name}", but typing, Space and arrow keys don't change its value, so a keyboard user can't fill it in.`,
            impact: "Keyboard-only users can't complete the form.",
            fix: `Make "${name}" respond to the keyboard: use a native control, or add key handlers for Space, Enter and the arrow keys.`,
          },
          submit: {
            title: `"${name}" can't be reached with the keyboard`,
            meaning: `Pressing Tab never moves to "${name}", so a keyboard user can fill in the form but can't send it.`,
            impact: "Keyboard-only users can't complete the booking.",
            fix: `Use a real <button type="submit"> for "${name}" (or give the custom control tabindex="0" and Enter/Space handlers).`,
          },
          rejected: {
            title: "Form can't be completed with the keyboard",
            meaning: `Every required field was filled in with the keyboard and the form was submitted with Enter, but no booking was created (${status === null ? "no request was sent" : `the server answered ${status}`}).`,
            impact: "Keyboard-only users can't complete the booking.",
            fix: "Check which fields don't take keyboard input and make them keyboard-operable; make sure pressing Enter on the submit button submits the form.",
          },
        };
        findings.add({ ...base, ...texts[p.kind] });
      }
      return checkResult(
        "keyboard-completion",
        scenario,
        startedAt,
        findings.items,
        `Tab reached ${reached.size}/${targets.length} target field(s); submit status ${status ?? "not sent"}`,
      );
    });
  },
};
