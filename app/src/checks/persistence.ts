/**
 * persistence: submit unique canary values in every field, reload, and fail for every free-text canary that
 * is no longer visible (in the page text or a field). Passwords, dates and choice fields are not compared:
 * they are either never shown or not unique enough to prove anything.
 */
import type { Page } from "playwright";
import type { Check, Scenario } from "../core/types.js";
import { controlLocator, evidence, fillLines, findingFactory, guarded, requestSummary, result, specSource, tryScreenshot } from "./lib/functional-finding.js";
import { canaryValues, createRequests, fieldName, fillForm, settle, submitControl, submitForm, waitForCreates } from "./lib/functional-form.js";

const ID = "persistence" as const;

/** Everything a user can read after reload: page text plus the values of every field. */
const VISIBLE_TEXT_SCRIPT = `(() => {
  const values = Array.from(document.querySelectorAll("input:not([type=password]), textarea, select")).map((el) => el.value);
  return [document.body.innerText, ...values].join("\\n");
})()`;

async function visibleText(page: Page): Promise<string> {
  return String(await page.evaluate(VISIBLE_TEXT_SCRIPT));
}

export const check: Check = {
  id: ID,
  title: "Submitted data is saved",
  category: "broken-feature",

  plan(form): Scenario[] {
    return [
      {
        id: "canary-reload",
        checkId: ID,
        title: "Submit unique values, reload and look for them",
        description: `Fill every field of ${form.name ?? "the form"} with unique test values, submit, reload the page and check that each value is still shown (passwords excepted).`,
        kind: "golden",
        priority: "high",
        destructive: false,
        defaultSelected: true,
      },
    ];
  },

  run(ctx, scenario) {
    return guarded(ID, scenario, ctx, async (started) => {
      const { page, capture } = await ctx.openPage();
      const values = canaryValues(ctx.form, ctx.runToken, "keep");
      await fillForm(page, values);
      await submitForm(page, ctx.form);
      await waitForCreates(page, capture, ctx.targetUrl);

      const creates = createRequests(capture, ctx.targetUrl);
      const saved = creates.find((r) => r.status !== null && r.status >= 200 && r.status < 300);
      if (!saved) {
        const why = creates.length === 0 ? "no request was sent" : `the server answered ${creates.map((r) => r.status ?? r.failure).join(", ")}`;
        return { ...result(ID, scenario, started, []), status: "error", notes: `Could not save the test values (${why}), so persistence could not be checked.` };
      }

      await page.reload({ waitUntil: "load" });
      await settle(page);
      const text = await visibleText(page);
      const missing = values.filter((v) => v.canary && !text.includes(v.value));
      if (missing.length === 0) {
        return result(ID, scenario, started, [], `All ${values.filter((v) => v.canary).length} test values were visible after reload.`);
      }

      const shots = await tryScreenshot(ctx, page, "after reload");
      const make = findingFactory(ID, "broken-feature", scenario);
      const submit = submitControl(ctx.form);
      const findings = missing.map((m) => {
        const name = fieldName(m.field);
        return make({
          title: `"${name}" is not saved`,
          severity: "critical",
          location: `"${name}" field`,
          meaning: `The form accepted a value in "${name}" and reported success, but after reloading the page that value is nowhere to be found. It was never saved (or is saved and not shown).`,
          impact: `Anything people type into "${name}" is silently lost, so they rely on information that does not exist, for example care instructions a sitter never sees.`,
          fix: `Ask your AI or developer: "The ${name} field (${m.field.key}) is dropped between the form and the database. Make sure it is sent in the request, stored by the server and shown again after reload."`,
          evidence: [
            evidence("network", "Save request and response", requestSummary(saved, true)),
            evidence("dom", `"${name}" value missing after reload`, { field: m.field.key, submittedValue: m.value }),
            ...shots,
          ],
          spec: {
            name: `${name}-is-saved`,
            source: specSource(ctx.targetUrl, `"${name}" is still shown after saving and reloading`, [
              ...fillLines(values),
              submit ? `await ${controlLocator(submit)}.click();` : `await page.keyboard.press("Enter");`,
              `await page.waitForLoadState("networkidle");`,
              `await page.reload();`,
              `await expect(page.getByText(${JSON.stringify(m.value)}).first()).toBeVisible();`,
            ]),
          },
        });
      });
      return result(ID, scenario, started, findings);
    });
  },
};
