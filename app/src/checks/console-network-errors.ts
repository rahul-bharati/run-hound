/**
 * console-network-errors: load the form, complete the golden path with valid data, and fail on any console
 * error, uncaught page error or failed / 4xx / 5xx request.
 */
import type { Check, Scenario } from "../core/types.js";
import type { Fact } from "../core/types.js";
import { clip, controlLocator, endpointOf, evidence, fillLines, findingFactory, guarded, requestSummary, result, specSource, tryCapture, tryCard } from "./lib/functional-finding.js";
import {
  armFieldErrors,
  canaryValues,
  createRequests,
  fillForm,
  isRefusedSignIn,
  isSearchForm,
  settle,
  sleep,
  submitControl,
  submitForm,
  waitForCreates,
  watchNextStep,
  whyNothingSent,
} from "./lib/functional-form.js";

const ID = "console-network-errors" as const;

/** Failures the browser reports for requests it cancelled itself (navigation, page close): not app bugs. */
const IGNORED_FAILURES = /ERR_ABORTED|NS_BINDING_ABORTED|cancelled/i;

/**
 * A navigation Run Hound's own guard refused (engine/guard.ts aborts it with "blockedbyclient"): an iframe embed
 * (video, map, payment widget) or a form post to another site. The app did nothing wrong; the request never left.
 */
export function isBlockedByRunHound(r: { resourceType: string; failure: string | null }): boolean {
  return r.resourceType === "document" && r.failure !== null && /ERR_BLOCKED_BY_CLIENT/i.test(r.failure);
}

/**
 * Dev-server plumbing (hot reload sockets and pings of Next.js, Vite, webpack, Nuxt, Astro). A dev server can refuse
 * these for a host it doesn't expect (Run Hound in a container), which says nothing about the app itself.
 */
export const DEV_SERVER_NOISE = /\/_next\/webpack-hmr|\/_next\/hmr|__nextjs_original-stack-frame|\/@vite\/client|__vite_ping|\/__vite_hmr|webpack-hmr|sockjs-node|\/_nuxt\/hmr|__nuxt_devtools__|\/__astro_dev_toolbar|\[vite\] (failed to connect|server connection lost)|\[HMR\]|Blocked cross-origin request to Next\.js dev resource/i;

/** "Failed to load resource: the server responded with a status of 401 (Unauthorized)" for a given status. */
function isResourceStatusLine(text: string, status: number): boolean {
  return new RegExp(`Failed to load resource: the server responded with a status of ${status}\\b`).test(text);
}


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
        description: `Open ${form.name ?? "the form"}, fill every field with valid test values and submit it, watching the browser console and every network request for errors. Creates one test record.`,
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
      ctx.step("Loaded the form, watching the console and network", page);
      // Where the load ends in each list, so every error can say whether it came while loading or after submitting.
      const loaded = { requests: capture.requests.length, console: capture.console.length, pageErrors: capture.pageErrors.length };
      const phase = (index: number, end: number) => (index < end ? "while loading" : "after submitting");
      const values = canaryValues(ctx.form, ctx.runToken, "cne");
      ctx.step("Filling every field with valid test values", page);
      const unset = await fillForm(page, values);
      ctx.step("Submitting the form", page);
      const step = await watchNextStep(page, capture, ctx.targetUrl, ctx.runToken);
      const startUrl = page.url();
      await armFieldErrors(page);
      await submitForm(page, ctx.form);
      await waitForCreates(page, capture, ctx.targetUrl, undefined, ctx.runToken);
      // Follow-up requests (list refresh, analytics) start after the create response.
      await sleep(500);
      await settle(page);
      ctx.step("Counting console errors, page errors and failed requests", page);

      const creates = createRequests(capture, ctx.targetUrl, ctx.runToken);
      // A sign-in form answers Run Hound's made-up credentials with 401 (or 400/403/422): the app working, not an
      // error. Those answers, and the browser's matching "Failed to load resource" lines, are left out.
      const refusedSignIns = creates.filter((r) => isRefusedSignIn(ctx.form, r.status));
      const expectedStatusLines = refusedSignIns.map((r) => ({ status: r.status!, url: r.url }));
      // Navigations off the target that Run Hound blocked are not tested, not failures; the notes name them.
      const blocked = capture.requests.filter(isBlockedByRunHound);
      const failedAt = capture.requests.flatMap((r, i) =>
        !r.url.startsWith("data:") &&
        !refusedSignIns.includes(r) &&
        !blocked.includes(r) &&
        !DEV_SERVER_NOISE.test(r.url) &&
        ((r.status !== null && r.status >= 400) || (r.failure !== null && !IGNORED_FAILURES.test(r.failure)))
          ? [{ r, when: phase(i, loaded.requests) }]
          : [],
      );
      const consoleAt = capture.console.flatMap((m, i) => {
        if (m.type !== "error" || DEV_SERVER_NOISE.test(m.text) || (m.url && DEV_SERVER_NOISE.test(m.url))) return [];
        if (/ERR_BLOCKED_BY_CLIENT/.test(m.text) && (!m.url || blocked.some((r) => r.url === m.url))) return [];
        const expected = expectedStatusLines.findIndex((e) => isResourceStatusLine(m.text, e.status) && (!m.url || m.url === e.url));
        if (expected >= 0) {
          expectedStatusLines.splice(expected, 1);
          return [];
        }
        return [{ m, when: phase(i, loaded.console) }];
      });
      const pageErrorsAt = capture.pageErrors.map((e, i) => ({ e, when: phase(i, loaded.pageErrors) }));
      // Errors while loading belong to the page, not to a form: on a page with several forms they are reported once,
      // by the main form's scenario (the first form, or the only one in a V0 plan), and this form's scenario only
      // reports what went wrong after submitting it.
      const mainForm = (scenario.formIndex ?? 0) === 0;
      const loadErrors = [...failedAt, ...consoleAt, ...pageErrorsAt].filter((x) => x.when === "while loading").length;
      const ownPhase = <T extends { when: string }>(list: T[]) => (mainForm ? list : list.filter((x) => x.when !== "while loading"));
      const failed = ownPhase(failedAt).map((x) => x.r);
      const consoleErrors = ownPhase(consoleAt).map((x) => x.m);
      const pageErrors = ownPhase(pageErrorsAt).map((x) => x.e);
      const notes = [
        ...(blocked.length > 0
          ? [`Not tested: ${blocked.length} request${blocked.length === 1 ? "" : "s"} left the target and Run Hound blocked ${blocked.length === 1 ? "it" : "them"} (${blocked.slice(0, 3).map((r) => `${r.method} ${r.url}`).join(", ")}); not counted as errors.`]
          : []),
        ...(!mainForm && loadErrors > 0 ? [`${loadErrors} error${loadErrors === 1 ? "" : "s"} while loading the page ${loadErrors === 1 ? "is" : "are"} reported with the main form's scenario, not again here.`] : []),
      ];
      // The submit itself, so the frame shows the form really was sent (and what the server said).
      const saves = creates.map((r) => `${endpointOf(r.method, r.url)} → ${r.status ?? r.failure ?? "no answer"}`);
      if (failed.length === 0 && consoleErrors.length === 0 && pageErrors.length === 0) {
        const signIn = refusedSignIns.length > 0 ? ` The sign-in was refused (${refusedSignIns[0]!.status}), as expected for made-up credentials.` : "";
        // Never "submitted" when nothing was sent (RH-10): a search form sends itself by loading its results page.
        const sentSomething = creates.length > 0 || page.url() !== startUrl || isSearchForm(ctx.form);
        const what = sentSomething
          ? "Loaded and submitted the form"
          : (await step.moved())
            ? "Loaded the form and pressed submit, which showed the form's next step (a multi-step form sends nothing until its last step)"
            : `Loaded the form and pressed submit, but no save request was sent. ${(await whyNothingSent(page, ctx.form, values, unset)).replace(/\.$/, "")}`;
        return result(ID, scenario, started, [], [`${what}; ${capture.requests.length} requests, no errors.${signIn}`, ...notes].join(" "));
      }
      const failedLines = ownPhase(failedAt);
      const pageErrorLines = ownPhase(pageErrorsAt);
      const consoleLines = ownPhase(consoleAt);

      const counts: Fact[] = [
        { label: "Console errors", value: String(consoleErrors.length) },
        { label: "Page errors (uncaught)", value: String(pageErrors.length) },
        { label: "Failed requests", value: String(failed.length) },
        { label: "Requests watched", value: String(capture.requests.length) },
      ];
      const card = await tryCard(ctx, "errors while loading and submitting", {
        title: `${failed.length + pageErrors.length + consoleErrors.length} error${failed.length + pageErrors.length + consoleErrors.length === 1 ? "" : "s"} while loading and submitting the form`,
        subtitle: page.url(),
        lines: [
          ...(failed.length ? [{ text: `Failed requests (${failed.length})` }] : []),
          ...failedLines.map(({ r, when }) => ({ text: `  ${r.method} ${r.url} → ${r.status ?? r.failure}  (${when})`, mark: true })),
          ...(pageErrors.length ? [{ text: `Uncaught page errors (${pageErrors.length})` }] : []),
          ...pageErrorLines.map(({ e, when }) => ({ text: `  ${e.split("\n")[0]}  (${when})`, mark: true })),
          ...(consoleErrors.length ? [{ text: `Console errors (${consoleErrors.length})` }] : []),
          ...consoleLines.map(({ m, when }) => ({ text: `  console.error: ${m.text.split("\n")[0]}  (${when})`, mark: true })),
          ...(saves.length ? [{ text: "" }, { text: `Form submit: ${saves.join(", ")}` }] : []),
        ],
        facts: counts,
      });
      // The whole form from the top, not wherever submitting left the scroll position.
      await page.evaluate("window.scrollTo(0, 0)").catch(() => undefined);
      const frame = await tryCapture(ctx, page, "page after submitting", {
        step: "After loading and submitting the form",
        caption: `The page looks finished, but behind the scenes ${[
          failed.length ? `${failed.length} request${failed.length > 1 ? "s" : ""} failed (${failed.slice(0, 2).map((r) => `${endpointOf(r.method, r.url)} → ${r.status ?? r.failure}`).join(", ")})` : "",
          pageErrors.length ? `the code crashed ${pageErrors.length} time${pageErrors.length > 1 ? "s" : ""}` : "",
          consoleErrors.length ? `${consoleErrors.length} console error${consoleErrors.length > 1 ? "s were" : " was"} logged` : "",
        ]
          .filter(Boolean)
          .join(", ")}.`,
        facts: [
          ...(saves.length ? [{ label: "Form submitted", value: saves.slice(0, 2).join(", ") }] : [{ label: "Form submitted", value: "no save request was seen" }]),
          ...counts,
          ...failed.slice(0, 3).map((r, i) => ({ label: `Failed request ${i + 1}`, value: `${endpointOf(r.method, r.url)} → ${r.status ?? r.failure}` })),
          ...pageErrors.slice(0, 2).map((e, i) => ({ label: `Page error ${i + 1}`, value: clip(e.split("\n")[0]!, 140) })),
          ...consoleErrors.slice(0, 2).map((m, i) => ({ label: `Console error ${i + 1}`, value: clip(m.text.split("\n")[0]!, 140) })),
        ],
      });
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
        title: `The page has errors while the form is filled in and sent: ${parts.join(", ")}`,
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
          ...card,
          ...frame,
          ...failed.map((r) => evidence("network", `${r.method} ${r.url} → ${r.status ?? r.failure}`, requestSummary(r))),
          ...pageErrors.map((e) => evidence("console", "Uncaught page error", { type: "pageerror", text: e })),
          ...consoleErrors.map((m) => evidence("console", "Console error", m)),
        ],
        spec: { name: "no-errors-on-golden-path", source: specSource(ctx.targetUrl, "loads and submits the form without errors", body, ctx.form) },
      });
      return result(ID, scenario, started, [finding], notes.length > 0 ? notes.join(" ") : undefined);
    });
  },
};
