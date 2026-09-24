/**
 * error-announcement: submit the form with every field empty and check that each required field is
 * marked invalid (aria-invalid="true") and has an associated message: a new aria-describedby /
 * aria-errormessage target with text, or an announcement in a live region / alert. Native browser
 * validation bubbles (form without novalidate) count as announced.
 */
import type { Check, CheckContext, DiscoveredForm, Evidence, Fact, FormField, Highlight, Scenario } from "../core/types.js";
import { checkResult, clip, evalIn, fieldName, FindingList, guarded, listOf, playwrightSpec, scenarioFor, submitControl, uniquePlaces } from "./lib/a11y-common.js";

/** At most this many fields get their own evidence frame (the finding still lists every field). */
const MAX_FRAMES = 6;
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

/**
 * For each selector: whether the field already holds a value (a default such as "1 guest", a preselected option).
 * Submitting "empty" leaves such a field as it is, so it is valid and rightly shows no error.
 */
const HAS_VALUE = `(selectors) => selectors.map((sel) => {
  const el = document.querySelector(sel);
  if (!el) return false;
  const controls = el.matches("input,select,textarea") ? [el] : [...el.querySelectorAll("input,select,textarea")];
  return controls.some((c) => (c.type === "radio" || c.type === "checkbox" ? c.checked : c.type !== "hidden" && c.value !== ""));
})`;

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
  const controls = "input:not([type=hidden]),select,textarea";
  let node = field && field.parentElement;
  for (let depth = 0; node && depth < 3; depth++, node = node.parentElement) {
    // A container that also holds another field is the form (or a group), not this field's own wrapper: a message
    // found there may belong to that other field.
    if ([...node.querySelectorAll(controls)].some((c) => !field.contains(c) && c !== field)) break;
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
      const submit = submitControl(ctx.form)!;
      const { page } = await ctx.openPage();
      // Only required fields that are empty when the form is submitted must show an error.
      const allRequired = ctx.form.fields.filter((f) => f.required);
      const prefilled = await evalIn<boolean[]>(page, HAS_VALUE, allRequired.map((f) => f.selector));
      const required = allRequired.filter((_, i) => !prefilled[i]);
      const skippedNames = allRequired.filter((_, i) => prefilled[i]).map(fieldName);
      const selectors = required.map((f) => f.selector);
      if (required.length === 0) {
        return {
          ...checkResult("error-announcement", scenario, startedAt, []),
          status: "skipped",
          notes: `Skipped: every required field (${listOf(skippedNames)}) already has a value when the page loads, so submitting the form empty can't trigger an error.`,
        };
      }

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

      interface Unannounced {
        field: FormField;
        name: string;
        state: FieldState;
        marked: boolean;
        associated: boolean;
        visible: { selector: string; text: string } | null;
      }
      const failing: Unannounced[] = [];
      for (const [i, field] of required.entries()) {
        const state = after.fields[i]!;
        const message = state.describedBy.find((d) => d.isNew && d.visible && d.text);
        const marked = state.ariaInvalid || state.nativeInvalid;
        const associated = state.nativeInvalid || !!message || liveAnnounced;
        if (marked && associated) continue;
        failing.push({ field, name: fieldName(field), state, marked, associated, visible: visibleErrors[i] ?? null });
      }

      if (failing.length > 0) {
        // One problem, however many fields it affects: one finding naming every field, with a frame per field (up to 6).
        const frames: Evidence[] = [];
        for (const f of failing.slice(0, MAX_FRAMES)) {
          const { name, state, visible } = f;
          const highlights: Highlight[] = [{ selector: f.field.selector, label: `Not announced: ${name}` }];
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
            ...(failing.length > 1 ? [{ label: "Fields with this problem", value: clip(failing.map((x) => x.name).join(", "), 200) }] : []),
          ];
          ctx.step(`Marking "${name}" (error not announced)`, page);
          frames.push(
            await ctx.capture(page, `Error on ${name} after an empty submit`, {
              step: "Submit the form empty",
              highlights,
              facts,
              caption: `After an empty submit, a screen reader gets no error for "${name}"${visible ? ", although one is shown on screen" : ""}.`,
            }),
          );
        }
        const many = failing.length > 1;
        const places = uniquePlaces(failing.map((f) => ({ name: f.name, selector: f.field.selector })));
        const problemsOf = (f: Unannounced) =>
          [
            f.marked ? null : `not marked invalid (no aria-invalid="true")`,
            f.associated ? null : "its error message is not linked to it (aria-describedby) and nothing is announced in a live region",
          ].filter(Boolean).join(" and ");
        const meaning = many
          ? `After submitting the form with its required fields empty, ${failing.length} fields give a screen reader no error: ${failing
              .map((f) => `"${f.name}" (${problemsOf(f)})`)
              .join("; ")}. The errors may be visible on screen, but a screen reader user is not told which fields have a problem or what it is.`
          : `After submitting the form with "${failing[0]!.name}" empty, it is ${problemsOf(failing[0]!)}. The error may be visible on screen, but a screen reader user is not told the field has a problem or what it is.`;
        findings.add({
          title: many ? `Errors on ${failing.length} fields are not announced to screen readers` : `Error on "${failing[0]!.name}" is not announced to screen readers`,
          severity: "high",
          meaning,
          impact: "Blind and low-vision users submit the form, nothing seems to happen, and they can't find out what to fix, so they can't complete the form.",
          fix: `When ${listOf(failing.map((f) => f.name))} ${many ? "fail" : "fails"} validation, set aria-invalid="true" on ${many ? "each field" : "it"}, point ${many ? "its" : "its"} aria-describedby at the error message element, and announce a summary in a polite live region (role="status") or move focus to the first invalid field.`,
          location: places[0]!,
          ...(many ? { locations: places } : {}),
          evidence: [
            {
              kind: "dom",
              label: many ? `Error wiring on ${failing.length} fields after an empty submit` : `Error wiring on ${failing[0]!.field.selector} after an empty submit`,
              data: failing.map((f) => ({
                field: f.name,
                selector: f.field.selector,
                ariaInvalid: f.state.ariaInvalid,
                describedBy: f.state.describedBy,
                liveRegionAnnouncements: announced,
                visibleError: f.visible?.text ?? null,
              })),
            },
            ...frames,
          ],
          spec: playwrightSpec(
            "error-announcement",
            findings.items.length + 1,
            many ? "empty required fields are announced as errors" : `empty ${failing[0]!.name} is announced as an error`,
            ctx.targetUrl,
            `await page.locator(${JSON.stringify(submit.selector)}).click();
for (const selector of ${JSON.stringify(failing.map((f) => f.field.selector))}) {
  const field = page.locator(selector);
  const control = (await field.evaluate((e) => e.matches("input,select,textarea"))) ? field : field.locator("input,select,textarea").first();
  await expect(control, selector).toHaveAttribute("aria-invalid", "true");
  const describedBy = (await control.getAttribute("aria-describedby")) ?? "";
  const texts = await Promise.all(describedBy.split(/\\s+/).filter(Boolean).map((id) => page.locator("#" + id).textContent()));
  expect(texts.join(" ").trim().length, selector).toBeGreaterThan(0);
}`,
          ),
        });
      }
      const prefilledNote = skippedNames.length > 0 ? `; left out ${listOf(skippedNames)}, which already had a value` : "";
      return checkResult("error-announcement", scenario, startedAt, findings.items, `Checked ${required.length} required field(s) after an empty submit${prefilledNote}`);
    });
  },
};
