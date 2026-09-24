/**
 * persistence: submit unique canary values in every field, reload, and fail for every free-text canary that
 * is no longer visible (in the page text or a field). Passwords, dates and choice fields are not compared:
 * they are either never shown or not unique enough to prove anything.
 */
import type { Page } from "playwright";
import type { Check, Evidence, Finding, Scenario } from "../core/types.js";
import { bodyLines, clip, controlLocator, endpointOf, evidence, fillLines, findingFactory, guarded, markText, recordFlow, requestSummary, result, specSource, tryCard } from "./lib/functional-finding.js";
import { isAcceptedStatus, isPagePost } from "../core/saves.js";
import { canaryValues, createRequests, fieldName, fillForm, isRefusedSignIn, isSignInForm, settle, SIGN_IN_NOTE, submitControl, submitForm, waitForCreates } from "./lib/functional-form.js";

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
        description: isSignInForm(form)
          ? `Will be skipped: ${form.name ?? "this form"} looks like a sign-in form, and signing in saves nothing to look for after a reload.`
          : `Fill every field of ${form.name ?? "the form"} with unique test values, submit, reload the page and check that each value is still shown (passwords excepted). Creates one test record.`,
        kind: "golden",
        priority: "high",
        destructive: false,
        defaultSelected: true,
      },
    ];
  },

  run(ctx, scenario) {
    return guarded(ID, scenario, ctx, async (started) => {
      if (isSignInForm(ctx.form)) return { ...result(ID, scenario, started, []), status: "skipped", notes: SIGN_IN_NOTE };
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
      await waitForCreates(page, capture, ctx.targetUrl, undefined, ctx.runToken);

      const creates = createRequests(capture, ctx.targetUrl, ctx.runToken);
      // 2xx, or a 3xx: a classic form post answers "303 See Other" and the browser loads the page it points to.
      const saved = creates.find((r) => isAcceptedStatus(r.status));
      if (!saved) {
        const statuses = creates.map((r) => r.status ?? r.failure).join(", ");
        const refused = creates.find((r) => r.status !== null && r.status >= 400 && r.status < 500);
        const skip = (notes: string) => ({ ...result(ID, scenario, started, []), status: "skipped" as const, notes });
        if (creates.length === 0) {
          return skip("Skipped: submitting the form sent nothing to the server (the page may have refused Run Hound's test values), so there was no saved record to look for.");
        }
        if (refused && isRefusedSignIn(ctx.form, refused.status)) return skip(SIGN_IN_NOTE);
        if (refused) {
          return skip(`Skipped: the app refused Run Hound's test values (it answered ${statuses}), so nothing was saved to look for. The made-up values may not meet one of this form's rules.`);
        }
        return skip(`Skipped: the app could not save Run Hound's test values (it answered ${statuses}), so there was no saved record to look for. The failed request is reported by the "No console errors or failed requests" check.`);
      }

      await flow.step("Submitted; the server saved it", {
        facts: [{ label: "Save request", value: `${endpointOf(saved.method, saved.url)} → ${saved.status}` }],
      });

      // A classic form post lands on the page the server redirected to (a thank-you or detail page): that page is
      // where the saved values should show, so it is the page reloaded.
      const landed = isPagePost(saved) && page.url() !== ctx.targetUrl ? ` (${new URL(page.url()).pathname}, where the form post led)` : "";
      ctx.step(`Reloading the page${landed} and looking for every test value`, page);
      await page.reload({ waitUntil: "load" });
      await settle(page);
      const text = await visibleText(page);
      const missing = canaries.filter((v) => !text.includes(v.value));
      if (missing.length === 0) {
        return result(ID, scenario, started, [], `All ${canaries.length} test values were visible after reload${landed}.`);
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
      // One problem, however many fields it drops: one finding naming every field, with a card per field (up to 6).
      const request = bodyLines(saved.postData);
      const response = bodyLines(saved.responseBody);
      const cards: Evidence[] = [];
      const perField = missing.map((m) => {
        const name = fieldName(m.field);
        const inRequest = request.some((l) => l.includes(m.value));
        const inResponse = response.some((l) => l.includes(m.value));
        return { m, name, inRequest, inResponse };
      });
      for (const { m, name, inRequest, inResponse } of perField.slice(0, 6)) {
        // The line that should carry the value: the value itself, else the field's key.
        const proves = (l: string) => l.includes(m.value) || l.includes(`"${m.field.key}"`);
        cards.push(
          ...(await tryCard(ctx, `${name} in the save request`, {
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
          })),
        );
      }
      const many = missing.length > 1;
      const first = perField[0]!;
      const quoted = perField.map((f) => `"${f.name}"`).join(", ");
      findings.push(
        make({
          title: many ? `${missing.length} fields are not saved (${clip(perField.map((f) => f.name).join(", "), 60)})` : `"${first.name}" is not saved`,
          severity: "critical",
          location: `"${first.name}" field`,
          locations: perField.map((f) => `"${f.name}" field`),
          meaning: many
            ? `The form accepted values in ${quoted} and reported success, but after reloading the page those values are nowhere to be found. They were never saved (or are saved and not shown).`
            : `The form accepted a value in "${first.name}" and reported success, but after reloading the page that value is nowhere to be found. It was never saved (or is saved and not shown).`,
          impact: many
            ? `Anything people type into ${quoted} is silently lost, so they rely on information that does not exist.`
            : `Anything people type into "${first.name}" is silently lost, so they rely on information that does not exist, for example a note or instruction that nobody ever sees.`,
          fix: many
            ? `Ask your AI or developer: "These fields are dropped between the form and the database: ${perField.map((f) => `${f.name} (${f.m.field.key})`).join(", ")}. Make sure each is sent in the request, stored by the server and shown again after reload."`
            : `Ask your AI or developer: "The ${first.name} field (${first.m.field.key}) is dropped between the form and the database. Make sure it is sent in the request, stored by the server and shown again after reload."`,
          evidence: [
            ...gif,
            ...cards,
            evidence("network", "Save request and response", requestSummary(saved, true)),
            evidence(
              "dom",
              many ? `${missing.length} values missing after reload` : `"${first.name}" value missing after reload`,
              perField.map((f) => ({ field: f.m.field.key, name: f.name, submittedValue: f.m.value, inRequest: f.inRequest, inResponse: f.inResponse, searched: where })),
            ),
          ],
          spec: {
            name: many ? "every-field-is-saved" : `${first.name}-is-saved`,
            source: specSource(ctx.targetUrl, many ? "every typed value is still shown after saving and reloading" : `"${first.name}" is still shown after saving and reloading`, [
              ...fillLines(values),
              submit ? `await ${controlLocator(submit)}.click();` : `await page.keyboard.press("Enter");`,
              `await page.waitForLoadState("networkidle");`,
              `await page.reload();`,
              ...missing.map((m) => `await expect(page.getByText(${JSON.stringify(m.value)}).first()).toBeVisible();`),
            ]),
          },
        }),
      );
      return result(ID, scenario, started, findings);
    });
  },
};
