/**
 * double-submit: fill valid data and double-click the submit button. Pass when no single endpoint receives
 * the same create request twice (a disabled button or an in-flight guard both achieve that); fail when one
 * does. Other same-origin writes the page makes on submit (telemetry, a second resource) are counted
 * separately, so they never look like a double booking.
 */
import type { Check, Scenario } from "../core/types.js";
import { RECORD_CREATES, controlLocator, evidence, fillLines, findingFactory, guarded, requestSummary, result, specSource, tryScreenshot } from "./lib/functional-finding.js";
import { canaryValues, createRequests, fillForm, sleep, submitControl, submitForm, waitForCreates } from "./lib/functional-form.js";

const ID = "double-submit" as const;

export const check: Check = {
  id: ID,
  title: "Double-clicking submit saves once",
  category: "broken-feature",

  plan(form): Scenario[] {
    const submit = submitControl(form);
    return [
      {
        id: "double-click-submit",
        checkId: ID,
        title: `Double-click ${submit ? `"${submit.accessibleName ?? submit.text}"` : "submit"} with valid data`,
        description: `Fill ${form.name ?? "the form"} with valid test values and double-click the submit button, counting how many save requests reach the server. Creates at most two test records.`,
        kind: "danger",
        priority: "high",
        destructive: false,
        defaultSelected: true,
      },
    ];
  },

  run(ctx, scenario) {
    return guarded(ID, scenario, ctx, async (started) => {
      const { page, capture } = await ctx.openPage();
      const values = canaryValues(ctx.form, ctx.runToken, "twice");
      await fillForm(page, values);
      await submitForm(page, ctx.form, "dblclick");
      // A slow second request can start a little after the first; wait, then let everything finish.
      await sleep(1000);
      await waitForCreates(page, capture, ctx.targetUrl);

      const creates = createRequests(capture, ctx.targetUrl);
      if (creates.length === 0) {
        return { ...result(ID, scenario, started, []), status: "error", notes: "Double-clicking submit sent no request to the server, so nothing could be counted." };
      }
      // Group by endpoint: two posts to the same method+path are a double submit, one post each to two
      // different endpoints is just what the page does on submit.
      const endpoint = (r: (typeof creates)[number]) => `${r.method} ${new URL(r.url).pathname}`;
      const groups = new Map<string, typeof creates>();
      for (const r of creates) groups.set(endpoint(r), [...(groups.get(endpoint(r)) ?? []), r]);
      const repeated = [...groups.values()].filter((g) => g.length > 1).sort((a, b) => b.length - a.length)[0];
      if (!repeated) {
        return result(
          ID,
          scenario,
          started,
          [],
          `${creates.length} save request(s), each to a different endpoint: ${[...groups.keys()].join(", ")}.`,
        );
      }
      const duplicates = repeated;

      const submit = submitControl(ctx.form);
      const name = submit ? (submit.accessibleName ?? submit.text) : "Submit";
      const shots = await tryScreenshot(ctx, page, "after double click");
      const make = findingFactory(ID, "broken-feature", scenario);
      const finding = make({
        title: `Double-clicking "${name}" saves ${duplicates.length} times`,
        severity: "high",
        location: `"${name}" button`,
        meaning: `The "${name}" button keeps working while the first save is still in progress, so a quick double click sends the same form ${duplicates.length} times.`,
        impact: "People who double-click (common on slow connections) get duplicate bookings or orders, and may be charged or contacted twice.",
        fix: `Ask your AI or developer: "Disable the ${name} button (or ignore clicks) while the save request is pending, and re-enable it when the request finishes."`,
        evidence: [...duplicates.map((r, i) => evidence("network", `Save request ${i + 1}: ${r.method} ${r.url} → ${r.status ?? r.failure}`, requestSummary(r))), ...shots],
        spec: {
          name: "double-click-saves-once",
          source: specSource(ctx.targetUrl, `double-clicking "${name}" sends one save request`, [
            ...RECORD_CREATES,
            ...fillLines(values),
            submit ? `await ${controlLocator(submit)}.dblclick();` : `await page.keyboard.press("Enter");`,
            `await page.waitForTimeout(3000);`,
            `expect(creates).toHaveLength(1);`,
          ]),
        },
      });
      return result(ID, scenario, started, [finding]);
    });
  },
};
