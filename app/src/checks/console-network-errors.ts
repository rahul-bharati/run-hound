/**
 * console-network-errors: load the form, complete the golden path with valid data, and fail on any console
 * error, uncaught page error or failed / 4xx / 5xx request.
 */
import type { Check, Scenario } from "../core/types.js";
import { evidence, fillLines, findingFactory, guarded, requestSummary, result, specSource, tryScreenshot, controlLocator } from "./lib/functional-finding.js";
import { canaryValues, fillForm, settle, sleep, submitControl, submitForm, waitForCreates } from "./lib/functional-form.js";

const ID = "console-network-errors" as const;

/** Failures the browser reports for requests it cancelled itself (navigation, page close): not app bugs. */
const IGNORED_FAILURES = /ERR_ABORTED|NS_BINDING_ABORTED|cancelled/i;


export const check: Check = {
  id: ID,
  title: "No console errors or failed requests",
  category: "broken-feature",

  plan(form): Scenario[] {
    return [
      {
        id: "golden-path",
        checkId: ID,
        title: "Load the form and complete it with valid data",
        description: `Open ${form.name ?? "the form"}, fill every field with valid test values and submit it, watching the browser console and every network request for errors.`,
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
      const values = canaryValues(ctx.form, ctx.runToken, "cne");
      await fillForm(page, values);
      await submitForm(page, ctx.form);
      await waitForCreates(page, capture, ctx.targetUrl);
      // Follow-up requests (list refresh, analytics) start after the create response.
      await sleep(500);
      await settle(page);

      const failed = capture.requests.filter(
        (r) => !r.url.startsWith("data:") && ((r.status !== null && r.status >= 400) || (r.failure !== null && !IGNORED_FAILURES.test(r.failure))),
      );
      const consoleErrors = capture.console.filter((m) => m.type === "error");
      const pageErrors = [...capture.pageErrors];
      if (failed.length === 0 && consoleErrors.length === 0 && pageErrors.length === 0) {
        return result(ID, scenario, started, [], `Loaded and submitted the form; ${capture.requests.length} requests, no errors.`);
      }

      const shots = await tryScreenshot(ctx, page, "after golden path");
      const make = findingFactory(ID, "broken-feature", scenario);
      const submit = submitControl(ctx.form);
      const body = [
        `const errors: string[] = [];`,
        `page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });`,
        `page.on("pageerror", (e) => errors.push(e.message));`,
        `page.on("requestfailed", (r) => errors.push("failed: " + r.url()));`,
        `page.on("response", (r) => { if (r.status() >= 400) errors.push(r.status() + " " + r.url()); });`,
        ...fillLines(values),
        submit ? `await ${controlLocator(submit)}.click();` : `await page.keyboard.press("Enter");`,
        `await page.waitForLoadState("networkidle");`,
        `expect(errors).toEqual([]);`,
      ];
      const parts: string[] = [];
      if (failed.length) parts.push(`${failed.length} failed request${failed.length > 1 ? "s" : ""}`);
      if (pageErrors.length) parts.push(`${pageErrors.length} crash${pageErrors.length > 1 ? "es" : ""}`);
      if (consoleErrors.length) parts.push(`${consoleErrors.length} console error${consoleErrors.length > 1 ? "s" : ""}`);
      const serverSide = failed.some((r) => (r.status ?? 0) >= 500);

      const finding = make({
        title: `The page has errors while booking: ${parts.join(", ")}`,
        severity: "medium",
        location: ctx.form.name ? `${ctx.form.name} page` : "Form page",
        meaning:
          "While loading and submitting the form, something behind the scenes went wrong: the page asked the server for something that failed, or the code hit an error. Users may not notice right away, but part of the page is not working as built.",
        impact: serverSide
          ? "A server request failed, so some information may be missing or not saved, and users may see stale or empty sections."
          : "A feature that depends on the failing request or code (for example, showing availability) silently does not work.",
        fix: `Ask your AI or developer: "Open the page, complete the form and fix every error in the browser console and every failed network request. Failing items: ${failed
          .slice(0, 3)
          .map((r) => `${r.method} ${r.url} (${r.status ?? r.failure})`)
          .concat(pageErrors.slice(0, 2), consoleErrors.slice(0, 2).map((m) => m.text))
          .join("; ")
          .slice(0, 400)}."`,
        evidence: [
          ...failed.map((r) => evidence("network", `${r.method} ${r.url} → ${r.status ?? r.failure}`, requestSummary(r))),
          ...pageErrors.map((e) => evidence("console", "Uncaught page error", { type: "pageerror", text: e })),
          ...consoleErrors.map((m) => evidence("console", "Console error", m)),
          ...shots,
        ],
        spec: { name: "no-errors-on-golden-path", source: specSource(ctx.targetUrl, "loads and submits the form without errors", body) },
      });
      return result(ID, scenario, started, [finding]);
    });
  },
};
