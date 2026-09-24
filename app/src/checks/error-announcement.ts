/**
 * error-announcement: submit the form with every field empty and check that each required field is
 * marked invalid (aria-invalid="true") and has an associated message: a new aria-describedby /
 * aria-errormessage target with text, or an announcement in a live region / alert. Native browser
 * validation bubbles (form without novalidate) count as announced.
 */
import type { Check, CheckContext, DiscoveredForm, Fact, Highlight, Scenario } from "../core/types.js";
import { checkResult, clip, evalIn, fieldName, FindingList, guarded, playwrightSpec, scenarioFor, submitControl } from "./lib/a11y-common.js";
import { settle } from "./lib/a11y-form.js";

interface FieldState {
  selector: string;
  ariaInvalid: boolean;
  nativeInvalid: boolean;
  describedBy: { id: string; text: string; visible: boolean; isNew: boolean }[];
}

interface Snapshot {
  fields: FieldState[];
  live: string[];
}

/** Reads ARIA error wiring for each field (selectors) plus the text of every live region. */
const READ = `(args) => {
  const controlsOf = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return [];
    if (el.matches("input,select,textarea")) return [el];
    return [el, ...el.querySelectorAll("input,select,textarea,[role=radio],[role=option],[role=checkbox]")];
  };
  const before = args.before || {};
  const fields = args.selectors.map((sel) => {
    const controls = controlsOf(sel);
    const ids = new Set();
    for (const c of controls) {
      for (const attr of ["aria-describedby", "aria-errormessage"]) {
        for (const id of (c.getAttribute(attr) || "").split(/\\s+/)) if (id) ids.add(id);
      }
    }
    const prior = before[sel] || [];
    const describedBy = [...ids].map((id) => {
      const t = document.getElementById(id);
      const text = t ? (t.textContent || "").replace(/\\s+/g, " ").trim() : "";
      const visible = !!t && !t.hidden && t.getClientRects().length > 0;
      const old = prior.find((p) => p.id === id);
      return { id, text, visible, isNew: !old || old.text !== text };
    });
    const form = controls[0] && controls[0].form;
    return {
      selector: sel,
      ariaInvalid: controls.some((c) => c.getAttribute("aria-invalid") === "true"),
      nativeInvalid: !!form && !form.noValidate && controls.some((c) => c.validity && !c.validity.valid),
      describedBy,
    };
  });
  const live = [...document.querySelectorAll('[aria-live]:not([aria-live="off"]),[role=alert],[role=status],[role=log]')]
    .map((el) => (el.textContent || "").replace(/\\s+/g, " ").trim());
  return { fields, live };
}`;

/** Remembers every element showing text before the submit, so messages that appear afterwards can be told apart. */
const REMEMBER_VISIBLE_TEXT = `() => {
  window.__rhShown = new WeakSet();
  for (const el of document.body.querySelectorAll("*")) {
    if (el.getClientRects().length > 0 && (el.textContent || "").trim()) window.__rhShown.add(el);
  }
}`;

/**
 * For each field, the nearest text that appeared after the submit (searching the field's container, up to three
 * levels up): the error a sighted user sees. Tags it so the evidence frame can mark it. null when there is none.
 */
const VISIBLE_ERRORS = `(selectors) => selectors.map((sel, i) => {
  const field = document.querySelector(sel);
  const shown = window.__rhShown || new WeakSet();
  let node = field && field.parentElement;
  for (let depth = 0; node && depth < 3; depth++, node = node.parentElement) {
    const found = [...node.querySelectorAll("*")].find((el) =>
      !shown.has(el) && el.children.length === 0 && !field.contains(el) && !el.matches("input,select,textarea,option,label,button") &&
      el.getClientRects().length > 0 && (el.textContent || "").trim());
    if (found) {
      found.setAttribute("data-rh-error", String(i));
      return { selector: '[data-rh-error="' + i + '"]', text: found.textContent.replace(/\\s+/g, " ").trim() };
    }
  }
  return null;
})`;

export const check: Check = {
  id: "error-announcement",
  title: "Form errors are announced to screen readers",
  category: "accessibility",

  plan(form: DiscoveredForm): Scenario[] {
    if (!submitControl(form) || !form.fields.some((f) => f.required)) return [];
    return [
      scenarioFor("error-announcement", "empty-submit", {
        title: "Submit the form empty and check errors are announced",
        description: "Presses the submit button with every field empty (nothing is created) and checks each required field is marked invalid with an announced message.",
        kind: "danger",
        priority: "high",
      }),
    ];
  },

  async run(ctx: CheckContext, scenario: Scenario) {
    return guarded("error-announcement", scenario, async (startedAt) => {
      const findings = new FindingList("error-announcement", "accessibility");
      const required = ctx.form.fields.filter((f) => f.required);
      const submit = submitControl(ctx.form)!;
      const { page } = await ctx.openPage();
      const selectors = required.map((f) => f.selector);

      const before = await evalIn<Snapshot>(page, READ, { selectors });
      const beforeBySelector = Object.fromEntries(before.fields.map((f) => [f.selector, f.describedBy]));
      await evalIn(page, REMEMBER_VISIBLE_TEXT);
      ctx.step("Submitting the form with every field empty", page);
      await page.locator(submit.selector).first().click();
      await settle(page, 1_000);
      ctx.step("Reading aria-invalid, aria-describedby and live regions", page);
      const after = await evalIn<Snapshot>(page, READ, { selectors, before: beforeBySelector });
      const visibleErrors = await evalIn<({ selector: string; text: string } | null)[]>(page, VISIBLE_ERRORS, selectors);

      const announced = after.live.filter((text, i) => text && text !== before.live[i]);
      const liveAnnounced = announced.length > 0;

      for (const [i, field] of required.entries()) {
        const state = after.fields[i]!;
        const message = state.describedBy.find((d) => d.isNew && d.visible && d.text);
        const marked = state.ariaInvalid || state.nativeInvalid;
        const associated = state.nativeInvalid || !!message || liveAnnounced;
        if (marked && associated) continue;
        const name = fieldName(field);
        const visible = visibleErrors[i] ?? null;
        const highlights: Highlight[] = [{ selector: field.selector, label: `Not announced: ${name}` }];
        if (visible) highlights.push({ selector: visible.selector, label: `Shown on screen only: "${clip(visible.text, 40)}"`, tone: "info" });
        const facts: Fact[] = [
          { label: "Field", value: name },
          { label: "aria-invalid", value: state.ariaInvalid ? '"true"' : "not set" },
          {
            label: "aria-describedby",
            value:
              state.describedBy.length === 0
                ? "none"
                : state.describedBy.map((d) => `#${d.id}: ${d.text ? `"${clip(d.text, 60)}"` : "(empty)"}${d.visible ? "" : " (hidden)"}`).join("; "),
          },
          { label: "Live region text", value: announced.length > 0 ? announced.map((t) => `"${clip(t, 60)}"`).join("; ") : "nothing announced" },
          { label: "Visible error text", value: visible ? `"${clip(visible.text, 80)}"` : "none found near the field" },
        ];
        ctx.step(`Marking "${name}" (error not announced)`, page);
        const frame = await ctx.capture(page, `Error on ${name} after an empty submit`, {
          step: "Submit the form empty",
          highlights,
          facts,
          caption: `After an empty submit, a screen reader gets no error for "${name}"${visible ? ", although one is shown on screen" : ""}.`,
        });
        const problems = [
          marked ? null : `it is not marked invalid (no aria-invalid="true")`,
          associated ? null : "its error message is not linked to it (aria-describedby) and nothing is announced in a live region",
        ].filter(Boolean);
        findings.add({
          title: `Error on "${name}" is not announced to screen readers`,
          severity: "high",
          meaning: `After submitting the form with "${name}" empty, ${problems.join(" and ")}. The error may be visible on screen, but a screen reader user is not told the field has a problem or what it is.`,
          impact: "Blind and low-vision users submit the form, nothing seems to happen, and they can't find out what to fix, so they can't complete the form.",
          fix: `When "${name}" fails validation, set aria-invalid="true" on it, point its aria-describedby at the error message element, and announce a summary in a polite live region (role="status") or move focus to the first invalid field.`,
          location: name,
          evidence: [
            {
              kind: "dom",
              label: `Error wiring on ${field.selector} after an empty submit`,
              data: {
                field: name,
                selector: field.selector,
                ariaInvalid: state.ariaInvalid,
                describedBy: state.describedBy,
                liveRegionAnnouncements: announced,
                visibleError: visible?.text ?? null,
              },
            },
            frame,
          ],
          spec: playwrightSpec(
            "error-announcement",
            findings.items.length + 1,
            `empty ${name} is announced as an error`,
            ctx.targetUrl,
            `await page.locator(${JSON.stringify(submit.selector)}).click();
const field = page.locator(${JSON.stringify(field.selector)});
const control = (await field.evaluate((e) => e.matches("input,select,textarea"))) ? field : field.locator("input,select,textarea").first();
await expect(control).toHaveAttribute("aria-invalid", "true");
const describedBy = (await control.getAttribute("aria-describedby")) ?? "";
const texts = await Promise.all(describedBy.split(/\\s+/).filter(Boolean).map((id) => page.locator("#" + id).textContent()));
expect(texts.join(" ").trim().length).toBeGreaterThan(0);`,
          ),
        });
      }
      return checkResult(
        "error-announcement",
        scenario,
        startedAt,
        findings.items,
        `Checked ${required.length} required field(s) after an empty submit`,
      );
    });
  },
};
