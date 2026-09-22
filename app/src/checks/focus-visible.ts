/**
 * focus-visible: Tab through every focusable element on the page and check that each one shows a
 * visible focus indicator: an outline (non-"none", width > 0, not transparent), or a box-shadow,
 * border, background or text-decoration that differs from its unfocused style (WCAG 2.4.7).
 */
import type { Check, CheckContext, DiscoveredForm, Evidence, Scenario } from "../core/types.js";
import { checkResult, evalIn, fieldName, FindingList, guarded, playwrightSpec, scenarioFor } from "./lib/a11y-common.js";

const MAX_TABS = 300;

/** The style properties a page can use to show focus, as computed values. */
interface FocusStyle {
  outline: string;
  boxShadow: string;
  border: string;
  background: string;
  textDecoration: string;
}

interface FocusStep {
  /** Index of the element in the page's focus bookkeeping; -1 when focus is on the body. */
  index: number;
  selector: string;
  name: string;
  visible: boolean;
  focused: FocusStyle;
  unfocused: FocusStyle | null;
}

/**
 * Records every focusable element's resting styles before any Tab is pressed. Anything already focused
 * (autofocus) is blurred first, so a focused element's own focus ring is never taken for its resting style.
 */
const SNAPSHOT = `() => {
  const active = document.activeElement;
  if (active && active !== document.body && active !== document.documentElement && active.blur) active.blur();
  const style = (el) => {
    const s = getComputedStyle(el);
    return {
      outlineStyle: s.outlineStyle, outlineWidth: s.outlineWidth, outlineColor: s.outlineColor, boxShadow: s.boxShadow,
      borderStyle: s.borderStyle, borderWidth: s.borderWidth, borderColor: s.borderColor,
      background: s.backgroundColor + " " + s.backgroundImage, textDecoration: s.textDecorationLine + " " + s.textDecorationColor,
    };
  };
  const map = new Map();
  const sel = 'a[href],button,input,select,textarea,summary,[tabindex],[contenteditable=""],[contenteditable="true"]';
  for (const el of document.querySelectorAll(sel)) map.set(el, style(el));
  window.__rhFocus = { baseline: map, ids: new Map() };
  return map.size;
}`;

/** Describes the focused element and whether its focus indicator is visible. */
const STEP = `(known) => {
  const el = document.activeElement;
  const empty = { outline: "", boxShadow: "", border: "", background: "", textDecoration: "" };
  if (!el || el === document.body || el === document.documentElement) return { index: -1, selector: "", name: "", visible: true, focused: empty, unfocused: null };
  const state = window.__rhFocus;
  if (!state.ids.has(el)) state.ids.set(el, state.ids.size);
  const s = getComputedStyle(el);
  const now = {
    outlineStyle: s.outlineStyle, outlineWidth: s.outlineWidth, outlineColor: s.outlineColor, boxShadow: s.boxShadow,
    borderStyle: s.borderStyle, borderWidth: s.borderWidth, borderColor: s.borderColor,
    background: s.backgroundColor + " " + s.backgroundImage, textDecoration: s.textDecorationLine + " " + s.textDecorationColor,
  };
  const before = state.baseline.get(el) || null;
  const transparent = (c) => c === "transparent" || /rgba\\([^)]*,\\s*0\\)$/.test(c);
  const outlineShown = now.outlineStyle !== "none" && parseFloat(now.outlineWidth) > 0 && !transparent(now.outlineColor);
  const outlineChanged = !before || before.outlineStyle === "none" || parseFloat(before.outlineWidth) === 0 ||
    before.outlineStyle !== now.outlineStyle || before.outlineWidth !== now.outlineWidth || before.outlineColor !== now.outlineColor;
  const changed = (key) => !!before && before[key] !== now[key];
  const shadowShown = now.boxShadow !== "none" && (!before || before.boxShadow !== now.boxShadow);
  // A border, background or underline change is a visible focus indicator too.
  const otherShown = changed("borderStyle") || changed("borderWidth") || changed("borderColor") || changed("background") || changed("textDecoration");
  let match = known.find((k) => { const t = document.querySelector(k.selector); return t && (t === el || t.contains(el)); });
  let name = match ? match.name : "";
  if (!name) {
    const labelled = el.getAttribute("aria-labelledby");
    name = el.getAttribute("aria-label") ||
      (labelled ? labelled.split(/\\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" ") : "") ||
      (el.labels && el.labels[0] ? el.labels[0].textContent : "") || el.getAttribute("placeholder") || el.textContent || el.getAttribute("title") || el.tagName.toLowerCase();
    name = name.replace(/\\s+/g, " ").trim().slice(0, 80);
  }
  const selector = el.id ? "#" + CSS.escape(el.id) : (match ? match.selector : el.tagName.toLowerCase());
  const fmt = (x) => ({
    outline: x.outlineStyle + " " + x.outlineWidth + " " + x.outlineColor,
    boxShadow: x.boxShadow,
    border: x.borderStyle + " " + x.borderWidth + " " + x.borderColor,
    background: x.background,
    textDecoration: x.textDecoration,
  });
  return {
    index: state.ids.get(el), selector, name,
    visible: (outlineShown && outlineChanged) || shadowShown || otherShown,
    focused: fmt(now),
    unfocused: before ? fmt(before) : null,
  };
}`;

export const check: Check = {
  id: "focus-visible",
  title: "Keyboard focus is always visible",
  category: "accessibility",

  plan(form: DiscoveredForm): Scenario[] {
    if (form.fields.length === 0 && form.controls.length === 0) return [];
    return [
      scenarioFor("focus-visible", "tab-through", {
        title: "Tab through every control and look for a focus indicator",
        description: "Presses Tab through the whole page and checks each focused control shows a visible outline or focus ring.",
        priority: "high",
      }),
    ];
  },

  async run(ctx: CheckContext, scenario: Scenario) {
    return guarded("focus-visible", scenario, async (startedAt) => {
      const findings = new FindingList("focus-visible", "accessibility");
      const { page } = await ctx.openPage();
      const known = [
        ...ctx.form.fields.map((f) => ({ selector: f.selector, name: fieldName(f) })),
        ...ctx.form.controls.map((c) => ({ selector: c.selector, name: c.accessibleName ?? c.text })),
      ];
      await evalIn(page, SNAPSHOT);

      const visited = new Set<number>();
      const reported = new Set<number>();
      let previous = -2;
      let bodyHits = 0;
      for (let i = 0; i < MAX_TABS; i++) {
        await page.keyboard.press("Tab");
        const step = await evalIn<FocusStep>(page, STEP, known);
        if (step.index === -1) {
          if (++bodyHits > 1 || visited.size > 0) break;
          continue;
        }
        // Tab can stay on one element (date inputs have several segments); wrapping to an earlier one ends the pass.
        if (step.index === previous) continue;
        if (visited.has(step.index)) break;
        visited.add(step.index);
        previous = step.index;
        if (step.visible || reported.has(step.index)) continue;
        reported.add(step.index);

        const evidence: Evidence[] = [
          {
            kind: "dom",
            label: `Computed focus styles of ${step.selector}`,
            data: { selector: step.selector, focused: step.focused, unfocused: step.unfocused },
          },
        ];
        if (reported.size <= 5) evidence.push(await ctx.screenshot(page, `Focus on ${step.name} (no visible indicator)`));
        findings.add({
          title: `No visible focus indicator on "${step.name}"`,
          severity: "high",
          meaning: `When someone moves to "${step.name}" with the Tab key, nothing on screen shows that it is focused, so keyboard users can't tell where they are.`,
          impact: "People who use a keyboard instead of a mouse (including many people with motor or vision impairments) get lost in the form and may type into the wrong field.",
          fix: `Don't remove the focus outline on "${step.name}" (${step.selector}) without a replacement. Add a clear :focus-visible style, for example outline: 3px solid <brand colour>; outline-offset: 2px (a visible border, background or ring change works too).`,
          location: step.name,
          evidence,
          spec: playwrightSpec(
            "focus-visible",
            findings.items.length + 1,
            `${step.name} shows a visible focus indicator`,
            ctx.targetUrl,
            `const el = page.locator(${JSON.stringify(step.selector)}).first();
const indicator = (e: Element) => {
  const s = getComputedStyle(e);
  return {
    outlineShown: s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0,
    style: [s.outlineStyle, s.outlineWidth, s.outlineColor, s.boxShadow, s.borderStyle, s.borderWidth, s.borderColor, s.backgroundColor, s.textDecorationLine].join(" | "),
  };
};
const resting = await el.evaluate(indicator);
for (let i = 0; i < ${MAX_TABS}; i++) {
  await page.keyboard.press("Tab");
  if (await el.evaluate((e) => e === document.activeElement)) break;
}
const focused = await el.evaluate(indicator);
// Focus must either draw an outline or change something visible about the control.
expect(focused.outlineShown || focused.style !== resting.style).toBe(true);`,
          ),
        });
      }
      return checkResult("focus-visible", scenario, startedAt, findings.items, `Tabbed through ${visited.size} focusable element(s)`);
    });
  },
};
