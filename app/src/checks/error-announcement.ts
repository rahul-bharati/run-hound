/**
 * error-announcement: submit the form with every field empty and check that each required field is
 * marked invalid (aria-invalid="true") and has an associated message: a new aria-describedby /
 * aria-errormessage target with text, or an announcement in a live region / alert. Native browser
 * validation bubbles (form without novalidate) count as announced.
 */
import type { Check, CheckContext, DiscoveredForm, Scenario } from "../core/types.js";
import { checkResult, evalIn, fieldName, FindingList, guarded, playwrightSpec, scenarioFor, submitControl } from "./lib/a11y-common.js";
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
      await page.locator(submit.selector).first().click();
      await settle(page, 1_000);
      const after = await evalIn<Snapshot>(page, READ, { selectors, before: beforeBySelector });

      const announced = after.live.filter((text, i) => text && text !== before.live[i]);
      const liveAnnounced = announced.length > 0;
      let shot: Awaited<ReturnType<CheckContext["screenshot"]>> | null = null;

      required.forEach((field, i) => {
        const state = after.fields[i]!;
        const message = state.describedBy.find((d) => d.isNew && d.visible && d.text);
        const marked = state.ariaInvalid || state.nativeInvalid;
        const associated = state.nativeInvalid || !!message || liveAnnounced;
        if (marked && associated) return;
        const name = fieldName(field);
        const problems = [
          marked ? null : `it is not marked invalid (no aria-invalid="true")`,
          associated ? null : "its error message is not linked to it (aria-describedby) and nothing is announced in a live region",
        ].filter(Boolean);
        findings.add({
          title: `Error on "${name}" is not announced to screen readers`,
          severity: "high",
          meaning: `After submitting the form with "${name}" empty, ${problems.join(" and ")}. The error may be visible on screen, but a screen reader user is not told the field has a problem or what it is.`,
          impact: "Blind and low-vision users submit the form, nothing seems to happen, and they can't find out what to fix, so they can't complete the booking.",
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
              },
            },
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
      });
      if (findings.items.length > 0) {
        shot = await ctx.screenshot(page, "Form after an empty submit");
        for (const f of findings.items) f.evidence.push(shot);
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
