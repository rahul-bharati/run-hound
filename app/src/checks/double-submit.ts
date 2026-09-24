/**
 * double-submit: fill valid data and double-click the submit button. Pass when no single endpoint receives
 * the same create request twice (a disabled button or an in-flight guard both achieve that); fail when one
 * does. Other same-origin writes the page makes on submit (telemetry, a second resource) are counted
 * separately, so they never look like a double booking.
 */
import type { Check, Scenario } from "../core/types.js";
import { RECORD_CREATES, bodyLines, clip, controlLocator, endpointOf, evidence, fillLines, findingFactory, guarded, markText, recordFlow, requestSummary, result, specSource, tryCard } from "./lib/functional-finding.js";
import { canaryValues, createRequests, fillForm, isCreatePlaywrightRequest, isSignInForm, SIGN_IN_NOTE, sleep, submitControl, submitForm, waitForCreates } from "./lib/functional-form.js";

const ID = "double-submit" as const;

/** The id of the record a create response returned ({ id }, { _id }, { data: { id } }), if any. */
function recordId(body: string | null): string | null {
  try {
    const parsed = JSON.parse(body ?? "") as Record<string, unknown>;
    const inner = (parsed.data && typeof parsed.data === "object" ? parsed.data : parsed) as Record<string, unknown>;
    const id = inner.id ?? inner._id ?? inner.uuid;
    return typeof id === "string" || typeof id === "number" ? String(id) : null;
  } catch {
    return null;
  }
}

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
        description: isSignInForm(form)
          ? `Will be skipped: ${form.name ?? "this form"} looks like a sign-in form, and signing in twice creates no duplicate records.`
          : `Fill ${form.name ?? "the form"} with valid test values and double-click the submit button, counting how many save requests reach the server. Creates at most two test records.`,
        kind: "danger",
        priority: "high",
        destructive: false,
        defaultSelected: true,
      },
    ];
  },

  run(ctx, scenario) {
    return guarded(ID, scenario, ctx, async (started) => {
      if (isSignInForm(ctx.form)) {
        return { ...result(ID, scenario, started, []), status: "skipped", notes: SIGN_IN_NOTE.replace("so there is no record to check", "so a double click can't create duplicate records") };
      }
      const { page, capture } = await ctx.openPage();
      const values = canaryValues(ctx.form, ctx.runToken, "twice");
      const submit = submitControl(ctx.form);
      const name = submit ? (submit.accessibleName ?? submit.text) : "Submit";
      // When each create request started, relative to the double click (Capture has no timings).
      const startedAt = new Map<string, number[]>();
      let clickedAt = 0;
      // Where each redirected save sent the browser (a classic form post answers 303 with the saved record's page).
      const redirects: string[] = [];
      page.on("response", (response) => {
        const status = response.status();
        if (status >= 300 && status < 400 && isCreatePlaywrightRequest(response.request(), ctx.targetUrl, ctx.runToken)) {
          redirects.push(response.headers()["location"] ?? "");
        }
      });
      page.on("request", (request) => {
        if (!isCreatePlaywrightRequest(request, ctx.targetUrl, ctx.runToken)) return;
        const key = `${request.method()} ${request.url()}`;
        startedAt.set(key, [...(startedAt.get(key) ?? []), performance.now() - clickedAt]);
      });

      ctx.step("Filling the form with valid test values", page);
      await fillForm(page, values);
      const flow = recordFlow(ctx, page, `double-click ${name}`);
      await flow.step("Form filled with valid data", {
        highlights: submit ? [{ selector: submit.selector, label: "Double-clicking next", tone: "info" }] : [],
        facts: [{ label: "Save requests so far", value: "0" }],
      });
      clickedAt = performance.now();
      await submitForm(page, ctx.form, "dblclick");
      await flow.step(`Double-clicked "${name}"`, {
        highlights: submit ? [{ selector: submit.selector, label: "Clicked twice" }] : [],
        facts: [{ label: "Save requests so far", value: String(createRequests(capture, ctx.targetUrl, ctx.runToken).length) }],
      });
      // A slow second request can start a little after the first; wait, then let everything finish.
      await sleep(1000);
      ctx.step("Waiting for the save requests to finish", page);
      await waitForCreates(page, capture, ctx.targetUrl, undefined, ctx.runToken);

      const creates = createRequests(capture, ctx.targetUrl, ctx.runToken);
      if (creates.length === 0) {
        return {
          ...result(ID, scenario, started, []),
          status: "skipped",
          notes: "Skipped: double-clicking submit sent nothing to the server (the page may have refused Run Hound's test values), so there were no save requests to count.",
        };
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
      // The server may turn a repeated post into the same record (an idempotency key or a one-time form token): every
      // answer names the same record id, or every redirect leads to the same page. That is the double click handled.
      const sameIds = duplicates.map((r) => recordId(r.responseBody));
      const sameRecord =
        (sameIds.every((id) => id !== null) && new Set(sameIds).size === 1) ||
        (redirects.length >= duplicates.length && redirects.every((l) => l !== "") && new Set(redirects).size === 1);
      if (sameRecord) {
        return result(
          ID,
          scenario,
          started,
          [],
          `${duplicates.length} save requests reached ${endpoint(duplicates[0]!)}, but the server answered each with the same record (${sameIds[0] ?? redirects[0]}), so only one was saved.`,
        );
      }

      // Offsets are matched to requests in the order they were sent, per method + URL.
      const used = new Map<string, number>();
      const offsetOf = (r: (typeof creates)[number]) => {
        const key = `${r.method} ${r.url}`;
        const i = used.get(key) ?? 0;
        used.set(key, i + 1);
        return startedAt.get(key)?.[i];
      };
      const ms = (offset: number | undefined) => (offset === undefined ? "?" : offset.toFixed(1));
      const timed = duplicates.map((r) => ({ r, offset: offsetOf(r), id: recordId(r.responseBody) }));
      const requestFacts = timed.map(({ r, offset, id }, i) => ({
        label: `Save request ${i + 1}`,
        value: `${endpointOf(r.method, r.url)} → ${r.status ?? r.failure} at +${ms(offset)} ms${id ? `, record ${id}` : ""}`,
      }));
      const ids = timed.map((t) => t.id).filter((id): id is string => Boolean(id));

      // The page's own list, when it shows one, holds a copy of the record per request.
      const canary = values.find((v) => v.canary);
      const copies = canary ? await markText(page, canary.value, "rh-copy", duplicates.length) : [];
      await flow.step(`After the double click: ${duplicates.length} save requests`, {
        highlights: copies.length
          ? copies.map((selector, i) => ({ selector, label: `Saved copy ${i + 1}` }))
          : submit
            ? [{ selector: submit.selector, label: "Clicked twice" }]
            : [],
        caption: `One double click on "${name}" sent ${duplicates.length} identical save requests, and the server accepted ${duplicates.filter((r) => (r.status ?? 0) < 300 && r.status !== null).length}.`,
        facts: requestFacts,
      });
      const gif = await flow.finish(`double-click ${name}`);
      const card = await tryCard(ctx, "save requests from one double click", {
        title: `${endpointOf(duplicates[0]!.method, duplicates[0]!.url)} sent ${duplicates.length} times by one double click`,
        subtitle: duplicates[0]!.url,
        lines: timed.flatMap(({ r, offset, id }, i) => [
          { text: `#${i + 1}  +${ms(offset)} ms after the double click started  ${r.method} ${r.url}`, mark: true },
          ...bodyLines(r.postData, 12).map((l) => ({ text: `      ${clip(l, 120)}` })),
          { text: `    ← ${r.status ?? r.failure}${id ? `  created record ${id}` : ""}`, mark: true },
        ]),
        facts: [
          { label: "Requests to one endpoint", value: String(duplicates.length) },
          ...(new Set(ids).size > 1 ? [{ label: "Distinct records created", value: String(new Set(ids).size) }] : []),
          ...requestFacts,
        ],
      });
      const make = findingFactory(ID, "broken-feature", scenario);
      const finding = make({
        title: `Double-clicking "${name}" saves ${duplicates.length} times`,
        severity: "high",
        location: `"${name}" button`,
        meaning: `The "${name}" button keeps working while the first save is still in progress, so a quick double click sends the same form ${duplicates.length} times.`,
        impact: "People who double-click (common on slow connections) get duplicate records (bookings, orders, sign-ups), and may be charged or contacted twice.",
        fix: `Ask your AI or developer: "Disable the ${name} button (or ignore clicks) while the save request is pending, and re-enable it when the request finishes."`,
        evidence: [
          ...gif,
          ...card,
          ...duplicates.map((r, i) => evidence("network", `Save request ${i + 1}: ${r.method} ${r.url} → ${r.status ?? r.failure}`, requestSummary(r))),
        ],
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
