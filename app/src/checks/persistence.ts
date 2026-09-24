/**
 * persistence: submit unique canary values in every field, reload, and fail for every free-text canary that
 * is no longer visible (in the page text or a field). Passwords, dates and choice fields are not compared:
 * they are either never shown or not unique enough to prove anything.
 */
import type { Page } from "playwright";
import type { Check, Finding, Scenario } from "../core/types.js";
import { bodyLines, clip, controlLocator, endpointOf, evidence, fillLines, findingFactory, guarded, markText, recordFlow, requestSummary, result, specSource, tryCard } from "./lib/functional-finding.js";
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
        description: `Fill every field of ${form.name ?? "the form"} with unique test values, submit, reload the page and check that each value is still shown (passwords excepted). Creates one test record.`,
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
      const canaries = values.filter((v) => v.canary);
      ctx.step("Typing a unique test value into every field", page);
      await fillForm(page, values);
      const flow = recordFlow(ctx, page, "values after save and reload");
      await flow.step("Typed unique test values", {
        highlights: canaries.map((v) => ({ selector: v.field.selector, label: `Typed "${clip(v.value, 40)}"`, tone: "info" as const })),
        facts: [{ label: "Test values typed", value: String(canaries.length) }],
      });
      ctx.step("Submitting the form", page);
      await submitForm(page, ctx.form);
      await waitForCreates(page, capture, ctx.targetUrl);

      const creates = createRequests(capture, ctx.targetUrl);
      const saved = creates.find((r) => r.status !== null && r.status >= 200 && r.status < 300);
      if (!saved) {
        const why = creates.length === 0 ? "no request was sent" : `the server answered ${creates.map((r) => r.status ?? r.failure).join(", ")}`;
        return { ...result(ID, scenario, started, []), status: "error", notes: `Could not save the test values (${why}), so persistence could not be checked.` };
      }

      await flow.step("Submitted; the server saved it", {
        facts: [{ label: "Save request", value: `${endpointOf(saved.method, saved.url)} → ${saved.status}` }],
      });

      ctx.step("Reloading the page and looking for every test value", page);
      await page.reload({ waitUntil: "load" });
      await settle(page);
      const text = await visibleText(page);
      const missing = canaries.filter((v) => !text.includes(v.value));
      if (missing.length === 0) {
        return result(ID, scenario, started, [], `All ${canaries.length} test values were visible after reload.`);
      }

      // Point at the saved record: where the other test values show up is where the missing ones belong.
      const found = canaries.filter((v) => !missing.includes(v));
      const record = found.length ? (await markText(page, found[0]!.value, "rh-saved", 1))[0] : undefined;
      // The record's full text: CSS may cut it off on screen, so the data shows what is really there.
      const recordText = record ? await page.locator(record).innerText().catch(() => "") : "";
      const missingNames = missing.map((m) => fieldName(m.field)).join(", ");
      const where = "the page text and every field's value after reload";
      await flow.step("After reload", {
        highlights: [
          record
            ? { selector: record, label: `Not found after reload: ${missingNames}` }
            : { selector: ctx.form.selector, label: `Not found after reload: ${missingNames}` },
        ],
        caption: record
          ? `The saved record is back after reload, but ${missing.length === 1 ? `the ${missingNames} value is` : `${missingNames} are`} missing from it.`
          : `After reload, ${missingNames} ${missing.length === 1 ? "is" : "are"} nowhere on the page.`,
        facts: [
          ...missing.map((m) => ({ label: `Canary (${fieldName(m.field)})`, value: m.value })),
          { label: "Field", value: missingNames },
          { label: "Searched", value: where },
          { label: "Other test values found", value: `${found.length} of ${canaries.length}` },
          ...(recordText ? [{ label: "Saved record's full text", value: clip(recordText.replace(/\s+/g, " ").trim(), 240) }] : []),
        ],
      });
      const gif = await flow.finish("values after save and reload");
      const make = findingFactory(ID, "broken-feature", scenario);
      const submit = submitControl(ctx.form);
      const findings: Finding[] = [];
      for (const m of missing) {
        const name = fieldName(m.field);
        const request = bodyLines(saved.postData);
        const response = bodyLines(saved.responseBody);
        const inRequest = request.some((l) => l.includes(m.value));
        const inResponse = response.some((l) => l.includes(m.value));
        // The line that should carry the value: the value itself, else the field's key.
        const proves = (l: string) => l.includes(m.value) || l.includes(`"${m.field.key}"`);
        const card = await tryCard(ctx, `${name} in the save request`, {
          title: inRequest
            ? `"${name}" was sent${inResponse ? " and saved, but is not shown after reload" : ", but the server's response drops it"}`
            : `"${name}" was typed, but the save request does not carry it`,
          subtitle: `${endpointOf(saved.method, saved.url)} → ${saved.status}  ${saved.url}`,
          lines: [
            { text: "Request body" },
            ...request.map((l) => ({ text: `  ${clip(l)}`, mark: proves(l) })),
            { text: `Response ${saved.status}` },
            ...response.map((l) => ({ text: `  ${clip(l)}`, mark: inRequest && proves(l) })),
          ],
          facts: [
            { label: "Canary value", value: m.value },
            { label: "Field", value: name },
            { label: "In request", value: inRequest ? "yes" : "no" },
            { label: "In response", value: inResponse ? "yes" : "no" },
          ],
        });
        findings.push(
          make({
            title: `"${name}" is not saved`,
            severity: "critical",
            location: `"${name}" field`,
            meaning: `The form accepted a value in "${name}" and reported success, but after reloading the page that value is nowhere to be found. It was never saved (or is saved and not shown).`,
            impact: `Anything people type into "${name}" is silently lost, so they rely on information that does not exist, for example a note or instruction that nobody ever sees.`,
            fix: `Ask your AI or developer: "The ${name} field (${m.field.key}) is dropped between the form and the database. Make sure it is sent in the request, stored by the server and shown again after reload."`,
            evidence: [
              ...gif,
              ...card,
              evidence("network", "Save request and response", requestSummary(saved, true)),
              evidence("dom", `"${name}" value missing after reload`, { field: m.field.key, submittedValue: m.value, searched: where }),
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
          }),
        );
      }
      return result(ID, scenario, started, findings);
    });
  },
};
