/**
 * keyboard-completion: fill and submit the form using only Tab, arrow keys, Space, Enter and typing.
 * Every required field (and every custom picker, whose "required" state the page can't tell us) must
 * be reachable with Tab and settable from the keyboard, and the submission must be accepted (2xx).
 */
import type { Page } from "playwright";
import type { Check, CheckContext, DiscoveredForm, Evidence, Fact, Finding, FormField, Highlight, Scenario } from "../core/types.js";
import { checkResult, clip, evalIn, fieldName, FindingList, guarded, markFocused, playwrightSpec, scenarioFor, submitControl } from "./lib/a11y-common.js";
import { canaries, sameOrigin, settle, textValueFor, type Canaries } from "./lib/a11y-form.js";
import { controlLocator, fieldLocator } from "./lib/functional-finding.js";

const MAX_TABS = 200;

interface Focus {
  /** Stable index of the focused element; -1 for the body. */
  index: number;
  /** Index into the target selectors of the field containing focus, or -1. */
  field: number;
  isSubmit: boolean;
  tag: string;
  /** Short accessible name of the focused element, for the evidence. */
  name: string;
  /** True when the focused element is inside the form. */
  inForm: boolean;
}

/** The Tab walk is recorded at this size: the desktop layout, with the facts panel still readable once the GIF is scaled. */
const RECORD_VIEWPORT = { width: 1024, height: 720 };
/** At most this many tab stops are recorded (the GIF also has a first and a last frame). */
const RECORDED_STOPS = 10;

const WHERE = `(args) => {
  const el = document.activeElement;
  window.__rhKb = window.__rhKb || new Map();
  if (!el || el === document.body || el === document.documentElement) return { index: -1, field: -1, isSubmit: false, tag: "", name: "", inForm: false };
  if (!window.__rhKb.has(el)) window.__rhKb.set(el, window.__rhKb.size);
  const inside = (sel) => { const t = document.querySelector(sel); return !!t && (t === el || t.contains(el)); };
  return {
    index: window.__rhKb.get(el),
    field: args.selectors.findIndex(inside),
    isSubmit: inside(args.submit),
    tag: el.tagName.toLowerCase(),
    name: (el.getAttribute("aria-label") || (el.labels && el.labels[0] ? el.labels[0].textContent : "") ||
      el.getAttribute("placeholder") || el.textContent || el.getAttribute("name") || "").replace(/\\s+/g, " ").trim().slice(0, 40) ||
      el.tagName.toLowerCase() + " (no name)",
    inForm: !!document.querySelector(args.form)?.contains(el),
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

interface WalkArgs {
  selectors: string[];
  submit: string;
  form: string;
}

/** For each selector: whether focus has moved past the element in document order (so Tab skipped it). */
const PASSED = `(selectors) => selectors.map((sel) => {
  const target = document.querySelector(sel);
  const el = document.activeElement;
  return !!target && !!el && !target.contains(el) && !!(target.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
})`;

interface TabStop extends Focus {
  /** 1-based position in the Tab order. */
  n: number;
}

interface Walk {
  /** Indexes (into the targets) of the fields Tab reached, and of the ones that got a value. */
  reached: Set<number>;
  set: Set<number>;
  submitReachable: boolean;
  stops: TabStop[];
}

/**
 * Presses Tab until focus wraps (or MAX_TABS), setting each target field from the keyboard as focus reaches it.
 * `onStop` runs at every new tab stop, after the field (if any) was set.
 */
async function tabThrough(
  page: Page,
  targets: FormField[],
  args: WalkArgs,
  values: Canaries,
  onStop?: (stop: TabStop, field: FormField | null) => Promise<void>,
): Promise<Walk> {
  const walk: Walk = { reached: new Set(), set: new Set(), submitReachable: false, stops: [] };
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
    const stop = { ...at, n: walk.stops.length + 1 };
    walk.stops.push(stop);
    if (at.isSubmit) walk.submitReachable = true;
    let field: FormField | null = null;
    if (at.field >= 0 && !walk.reached.has(at.field)) {
      walk.reached.add(at.field);
      field = targets[at.field]!;
      await operate(page, field, values);
      if (await evalIn<boolean>(page, HAS_VALUE, field.selector)) walk.set.add(at.field);
      // Typing can move focus inside a widget; re-read so the next Tab starts from here.
      previous = (await evalIn<Focus>(page, WHERE, args)).index;
    }
    await onStop?.(stop, field);
  }
  return walk;
}

/** "Pet name → Owner email → Book", shortened in the middle when long. */
function stopTrail(stops: TabStop[]): string {
  const names = stops.map((s) => s.name || s.tag);
  const shown = names.length > 10 ? [...names.slice(0, 5), `… ${names.length - 8} more …`, ...names.slice(-3)] : names;
  return `${stops.length}: ${shown.join(" → ")}`;
}

type ProblemKind = "unreachable" | "inoperable" | "submit" | "rejected";

/** Spec helper: presses Tab until `target` (or something inside it) has focus; false after MAX_TABS presses. */
const TAB_TO = `const tabTo = async (target: import("@playwright/test").Locator) => {
  for (let i = 0; i < ${MAX_TABS}; i++) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((t) => t === document.activeElement || t.contains(document.activeElement))) return true;
  }
  return false;
};`;

/** Spec helper: whether a field (or the inputs / options inside it) holds a value; mirrors HAS_VALUE. */
const HAS_VALUE_SPEC = `const hasValue = (target: import("@playwright/test").Locator) =>
  target.evaluate((el) => {
    if (el.matches("input[type=radio],input[type=checkbox]")) return (el as HTMLInputElement).checked;
    if (el.matches("input,select,textarea")) return (el as HTMLInputElement).value !== "";
    const inputs = [...el.querySelectorAll("input,select,textarea")] as HTMLInputElement[];
    if (inputs.some((i) => (i.type === "radio" || i.type === "checkbox" ? i.checked : i.type !== "hidden" && i.value !== ""))) return true;
    return !!el.querySelector('[aria-checked="true"],[aria-selected="true"]');
  });`;

/** Spec lines that set the focused field from the keyboard, like operate(). */
function operateLines(field: FormField, values: Canaries): string[] {
  if (field.type === "radio" || field.type === "checkbox") return [`await page.keyboard.press("Space");`];
  if (field.type === "custom") return [`await page.keyboard.press("Space");`, `await page.keyboard.press("Enter");`];
  if (field.type === "select" || field.type === "select-one") return [`await page.keyboard.press("ArrowDown");`];
  const value = textValueFor(field, values);
  if (value === null) return [];
  if (field.type === "date") {
    const [year, month, day] = value.split("-");
    return [
      `// Date inputs take the parts in the browser's locale order.`,
      `for (const part of await page.evaluate(() => new Intl.DateTimeFormat(navigator.language).formatToParts(new Date(2030, 0, 5)).filter((p) => ["year", "month", "day"].includes(p.type)).map((p) => p.type))) {`,
      `  await page.keyboard.type(({ year: ${JSON.stringify(year)}, month: ${JSON.stringify(month)}, day: ${JSON.stringify(day)} } as Record<string, string>)[part] ?? "");`,
      `}`,
    ];
  }
  return [`await page.keyboard.type(${JSON.stringify(value)});`];
}

/** A locator a person would write for a field (label, role or placeholder), else its CSS selector. */
function locatorFor(field: FormField): string {
  if (field.type !== "custom") return fieldLocator(field);
  // A custom picker has no role or label to find it by; its first option's text does, and keeps working once the
  // picker is rebuilt as a native radio group (the text becomes the radio's label).
  const first = field.options?.[0]?.label;
  if (!first) return `page.locator(${JSON.stringify(field.selector)})`;
  return `page.getByRole("radio", { name: ${JSON.stringify(first)}, exact: true }).or(page.getByText(${JSON.stringify(first)}, { exact: true })).first()`;
}

/**
 * A spec that fails while the problem is present, for each kind of problem:
 * unreachable / submit: Tab never reaches the control; inoperable: Tab reaches it but the keys don't set a value;
 * rejected: filling every field and pressing Enter on the submit button doesn't produce a 2xx save response.
 */
function keyboardSpec(ctx: CheckContext, no: number, kind: ProblemKind, name: string, field: FormField | null, targets: FormField[], values: Canaries) {
  const submit = submitControl(ctx.form)!;
  const submitLocator = controlLocator(submit);
  const title: Record<ProblemKind, string> = {
    unreachable: `${name} can be reached with the Tab key`,
    submit: `${name} can be reached with the Tab key`,
    inoperable: `${name} can be set with the keyboard`,
    rejected: "the form can be filled in and submitted with the keyboard only",
  };
  let body: string;
  if (kind === "unreachable" || kind === "submit") {
    body = `${TAB_TO}
expect(await tabTo(${field ? locatorFor(field) : submitLocator})).toBe(true);`;
  } else if (kind === "inoperable" && field) {
    body = `${TAB_TO}
${HAS_VALUE_SPEC}
const target = ${locatorFor(field)};
expect(await tabTo(target)).toBe(true);
${operateLines(field, values).join("\n")}
expect(await hasValue(target)).toBe(true);`;
  } else {
    const steps = targets.flatMap((f) => [`expect(await tabTo(${locatorFor(f)})).toBe(true);`, ...operateLines(f, values)]);
    body = `${TAB_TO}
${steps.join("\n")}
expect(await tabTo(${submitLocator})).toBe(true);
const saved = page.waitForResponse((r) => r.request().method() !== "GET" && new URL(r.url()).origin === new URL(TARGET).origin);
await page.keyboard.press("Enter");
const response = await saved;
expect(response.status()).toBeGreaterThanOrEqual(200);
expect(response.status()).toBeLessThan(300);`;
  }
  return playwrightSpec("keyboard-completion", no, title[kind], ctx.targetUrl, body);
}

/**
 * Walks the form again on a fresh page, recording the tab stops inside the form (up to RECORDED_STOPS) with the
 * focused element marked, the moment Tab skips a problem field, and a last frame with the problems marked. Every
 * frame carries the same facts, so all frames have the same size. Returns the GIF evidence.
 */
async function recordTabWalk(
  ctx: CheckContext,
  targets: FormField[],
  args: WalkArgs,
  stops: TabStop[],
  marks: Highlight[],
  facts: Fact[],
  caption: string,
): Promise<Evidence> {
  const recorded = new Set(stops.filter((s) => s.inForm).slice(0, RECORDED_STOPS).map((s) => s.n));
  const skippable = marks.filter((m) => m.label === "Never reached by Tab" && m.selector);
  const skipped = new Set<string>();

  const { page } = await ctx.openPage({ viewport: RECORD_VIEWPORT });
  ctx.step("Recording the Tab sequence", page);
  const recording = ctx.record(page, "Keyboard-only walk through the form");
  await recording.step("Page loaded; only the keyboard is used from here", {
    highlights: marks.map((m) => ({ ...m, tone: "info" as const, label: "Must be usable from the keyboard" })),
    facts,
  });
  await tabThrough(page, targets, args, canaries(ctx.runToken, "kb"), async (stop, field) => {
    const passed = await evalIn<boolean[]>(page, PASSED, skippable.map((m) => m.selector));
    const newlySkipped = skippable.filter((m, i) => passed[i] && !skipped.has(m.selector!));
    for (const m of newlySkipped) skipped.add(m.selector!);
    if (!recorded.has(stop.n) && newlySkipped.length === 0) return;

    const selector = await markFocused(page);
    const did = field ? (field.type === "custom" || field.type === "radio" ? "pressed Space" : "typed a value") : "";
    const label = `Tab ${stop.n}: ${clip(stop.name, 30)}`;
    ctx.step(did ? `${label} (${did})` : label, page);
    const highlights: Highlight[] = [
      ...(selector ? [{ selector, label: `Focus: ${clip(stop.name, 30)}`, tone: field ? ("pass" as const) : ("info" as const) }] : []),
      ...newlySkipped.map((m) => ({ ...m, label: "Skipped by Tab" })),
    ];
    const step = newlySkipped.length > 0 ? `${label}, Tab skipped ${newlySkipped.length === 1 ? "a field" : "fields"}` : did ? `${label}, ${did}` : label;
    await recording.step(step, { highlights, facts });
  });
  await recording.step("End of the Tab order", { highlights: marks, facts, caption });
  return recording.finish({ label: "Tab sequence through the form" });
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
        description: "Uses only Tab, arrow keys, Space, Enter and typing to fill every required field and submit. Creates one test record.",
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
      const args: WalkArgs = { selectors: targets.map((f) => f.selector), submit: submit.selector, form: ctx.form.selector };

      ctx.step("Pressing Tab through the form and filling each field from the keyboard", page);
      const walk = await tabThrough(page, targets, args, values);
      const { reached, set, submitReachable } = walk;

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

      const evidence: Evidence[] = [];
      if (problems.length > 0) {
        const unreached = problems.filter((p) => p.kind === "unreachable").map((p) => fieldName(p.field!));
        const unset = problems.filter((p) => p.kind === "inoperable").map((p) => fieldName(p.field!));
        const facts: Fact[] = [
          { label: "Tab stops visited", value: stopTrail(walk.stops) },
          { label: "Field not reached by Tab", value: unreached.length > 0 ? unreached.join(", ") : "none" },
          ...(unset.length > 0 ? [{ label: "Field not set by keyboard", value: unset.join(", ") }] : []),
          { label: "Submit button reached", value: submitReachable ? "yes" : "no" },
          { label: "Submit status", value: status === null ? "not sent" : String(status) },
        ];
        const marks: Highlight[] = problems.flatMap((p): Highlight[] => {
          if (p.kind === "unreachable") return [{ selector: p.field!.selector, label: "Never reached by Tab" }];
          if (p.kind === "inoperable") return [{ selector: p.field!.selector, label: "Reached, but keys don't set it" }];
          if (p.kind === "submit") return [{ selector: submit.selector, label: "Never reached by Tab" }];
          return [];
        });
        const caption =
          unreached.length > 0 || !submitReachable
            ? `Tab went through ${walk.stops.length} stops and never reached ${[...unreached, ...(submitReachable ? [] : ["the submit button"])].map((n) => `"${n}"`).join(", ")}.`
            : unset.length > 0
              ? `Tab reached ${unset.map((n) => `"${n}"`).join(", ")}, but typing, Space and arrow keys did not set a value.`
              : `Every field was filled from the keyboard, but the submit was ${status === null ? "never sent" : `answered ${status}`}.`;
        evidence.push(await recordTabWalk(ctx, targets, args, walk.stops, marks, facts, caption));
        if (problems.some((p) => p.kind === "rejected")) {
          evidence.push(
            await ctx.capture(page, "Form after a keyboard-only submit", {
              step: "Tab to the submit button and press Enter",
              highlights: [{ selector: submit.selector, label: status === null ? "Enter sent nothing" : `Server answered ${status}` }],
              facts,
              caption: "Every field was filled from the keyboard and Enter was pressed on the submit button, but nothing was saved.",
            }),
          );
        }
      }
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
              label: `Keyboard walk through the form (${walk.stops.length} stops)`,
              data: { selector, problem: p.kind, tabStops: walk.stops.length, submitStatus: status },
            },
            ...evidence,
          ],
          spec: keyboardSpec(ctx, no, p.kind, name, p.field, targets, values),
        };
        const texts: Record<typeof p.kind, Pick<Finding, "title" | "meaning" | "impact" | "fix">> = {
          unreachable: {
            title: `"${name}" can't be reached with the keyboard`,
            meaning: `Pressing Tab never moves to "${name}", so someone using only a keyboard can't choose a value and can't finish the form.`,
            impact: "People who can't use a mouse (including many screen reader users and people with motor impairments) are completely blocked from completing the form.",
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
            impact: "Keyboard-only users can't complete the form.",
            fix: `Use a real <button type="submit"> for "${name}" (or give the custom control tabindex="0" and Enter/Space handlers).`,
          },
          rejected: {
            title: "Form can't be completed with the keyboard",
            meaning: `Every required field was filled in with the keyboard and the form was submitted with Enter, but nothing was saved (${status === null ? "no request was sent" : `the server answered ${status}`}).`,
            impact: "Keyboard-only users can't complete the form.",
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
