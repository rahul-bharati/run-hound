/**
 * silent-failure: submit valid data while the submit request is answered with a 500 by interception
 * (nothing reaches the server). Pass when an error message appears within 5 s, is announced (live region,
 * alert role, or focus moves to it) and the inputs keep their values.
 */
import type { Page } from "playwright";
import { isPagePost } from "../core/saves.js";
import type { Check, Fact, FormField, Highlight, Scenario } from "../core/types.js";
import { controlLocator, endpointOf, fieldLocator, evidence, fillLines, findingFactory, guarded, markText, recordFlow, result, specSource } from "./lib/functional-finding.js";
import {
  armFieldErrors,
  canaryValues,
  fieldName,
  fillForm,
  isCreatePlaywrightRequest,
  MULTI_STEP_NOTE,
  PAGE_POST_NOTE,
  simulatedResponse,
  sleep,
  STOPPED_PAGE_POST_HTML,
  submitControl,
  submitForm,
  waitFor,
  watchNextStep,
  whyNothingSent,
  type FieldValue, isSearchForm } from "./lib/functional-form.js";

const ID = "silent-failure" as const;
const BUDGET_MS = 5000;

/** Wording that marks a message as an error, not "Sending…" or a success toast. */
const ERROR_WORDS = "error|wrong|fail|could not|couldn't|can't|cannot|unable|problem|try again|sorry|unavailable";

/** Remembers every live region's and focusable element's text before submitting. */
const ARM_SCRIPT = `(() => {
  const w = window;
  w.__rhBefore = new WeakMap();
  for (const el of document.querySelectorAll("body *")) w.__rhBefore.set(el, (el.innerText || "").trim());
  w.__rhFocusBefore = document.activeElement;
  return true;
})()`;

/**
 * Looks for a new, visible error message. "announced" = inside a live region / alert / status, or focused.
 * "visible" = any new visible text with error wording (reported when nothing announced it).
 */
const PROBE_SCRIPT = `(() => {
  const w = window;
  const re = new RegExp(${JSON.stringify(ERROR_WORDS)}, "i");
  const shown = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const isNew = (el) => { const t = (el.innerText || "").trim(); return t && re.test(t) && w.__rhBefore && w.__rhBefore.get(el) !== t; };
  // A live region is often a container with no size of its own: sonner's <section aria-live> holds a fixed <ol> whose
  // toasts are absolutely positioned, so the region measures 0 px high while the toast is plainly on screen. What
  // counts is whether the error text inside it is visible.
  const contentShown = (el) => shown(el) || Array.from(el.querySelectorAll("*")).some((d) => re.test((d.innerText || "").trim()) && shown(d));
  const regions = document.querySelectorAll('[role=alert], [role=status], [role=log], [aria-live]:not([aria-live=off])');
  for (const el of regions) {
    if (isNew(el) && contentShown(el)) return { announced: true, how: "live region (" + (el.getAttribute("role") || "aria-live=" + el.getAttribute("aria-live")) + ")", text: el.innerText.trim().slice(0, 300) };
  }
  const active = document.activeElement;
  if (active && active !== w.__rhFocusBefore && active !== document.body && !active.matches("input, select, textarea, button") && isNew(active) && shown(active)) {
    return { announced: true, how: "focus moved to the message", text: active.innerText.trim().slice(0, 300) };
  }
  let visible = null;
  for (const el of document.querySelectorAll("body *")) {
    if (el.children.length > 0 && Array.from(el.children).some((c) => (c.innerText || "").trim())) continue;
    if (isNew(el) && shown(el)) { visible = el.innerText.trim().slice(0, 300); break; }
  }
  return { announced: false, how: null, text: visible };
})()`;

interface Probe {
  announced: boolean;
  how: string | null;
  text: string | null;
}

/**
 * What a field shows now, whatever kind it is: a text field's or select's value, the checked radio of a group, a
 * checkbox's or switch widget's aria-checked, a slider's aria-valuenow, a widget's hidden native input (a radio group
 * has one per item: the checked one's value), else the control's text (a select widget's trigger shows the chosen
 * option). Null when the field isn't on the page.
 *
 * The field is found by the mark snapshot() put on it (`i`) before the submit, else by its selector: a message the page
 * inserts above the fields shifts every position, and a positional selector (#f > div:nth-of-type(2) > button) would
 * then point at another field, or at none, and a kept value would read as wiped.
 */
const READ_SCRIPT = `(args) => {
  const mark = args.mark === null ? [] : [document.querySelector('[data-rh-field="' + args.mark + '"]')];
  const el = mark[0] || document.querySelector(args.sel);
  if (!el) return null;
  if (args.mark !== null && !mark[0]) el.setAttribute("data-rh-field", String(args.mark));
  if (el.getAttribute("role") === "slider") return el.getAttribute("aria-valuenow");
  if (el.hasAttribute("aria-checked")) return el.getAttribute("aria-checked");
  // A widget's hidden native inputs are marked the same way (their selector is often positional too).
  let natives = args.mark === null ? [] : Array.from(document.querySelectorAll('[data-rh-native="' + args.mark + '"]'));
  if (natives.length === 0 && args.native) {
    natives = Array.from(document.querySelectorAll(args.native));
    if (args.mark !== null) for (const n of natives) n.setAttribute("data-rh-native", String(args.mark));
  }
  if (natives.length > 0) {
    const native = natives[0];
    if (native.matches("input[type=radio]")) { const on = natives.find((n) => n.checked); return on ? on.value : ""; }
    return native.matches("input[type=checkbox]") ? String(native.checked) : native.value;
  }
  if (el.matches("input[type=radio]")) {
    const on = el.form ? Array.from(el.form.elements).find((i) => i.type === "radio" && i.name === el.name && i.checked) : el.checked ? el : null;
    return on ? on.value : "";
  }
  if (el.matches("input[type=checkbox]")) return String(el.checked);
  if (el.matches("input, textarea, select")) return el.value;
  const checked = el.querySelector('input:checked, [aria-checked="true"]');
  if (el.querySelector("input[type=radio], [role=radio]")) return checked ? checked.value || checked.getAttribute("value") || checked.textContent || "checked" : "";
  return (el.textContent || "").trim();
}`;

/** What `field` shows now (READ_SCRIPT); `mark` is its index in the snapshot, or null to find it by selector only. */
async function readField(page: Page, field: FormField, mark: number | null = null): Promise<string | null> {
  const args = { sel: field.selector, native: field.nativeSelector ?? null, mark };
  return (await page.evaluate(`(${READ_SCRIPT})(${JSON.stringify(args)})`).catch(() => null)) as string | null;
}

/** What every filled field shows, just before submitting; each field found is marked, so lostInputs reads the same one. */
async function snapshot(page: Page, values: FieldValue[]): Promise<(string | null)[]> {
  const shown: (string | null)[] = [];
  for (const [i, { field }] of values.entries()) shown.push(["file", "hidden"].includes(field.type) ? null : await readField(page, field, i));
  return shown;
}

/**
 * Fields that no longer show what they showed before submitting (the form was cleared after the error). A field that
 * can't be found any more (its mark and its selector both gone) is not counted: whether it was emptied is unknown.
 */
async function lostInputs(page: Page, values: FieldValue[], before: (string | null)[]): Promise<string[]> {
  const lost: string[] = [];
  for (const [i, { field }] of values.entries()) {
    const was = before[i];
    // Nothing to lose in a field that was empty (or unreadable) before the submit.
    if (was === null || was === undefined || was === "" || was === "false") continue;
    const now = await readField(page, field, i);
    if (now !== null && now !== was) lost.push(fieldName(field));
  }
  return lost;
}

export const check: Check = {
  id: ID,
  title: "Server errors are shown and announced",
  category: "broken-feature",

  plan(form): Scenario[] {
    // A search form saves nothing, so there is no saved record to test (V1: every form on the page is planned).
    if (isSearchForm(form)) return [];
    return [
      {
        id: "server-error-500",
        checkId: ID,
        title: "Submit while the server answers with an error",
        description: `Fill ${form.name ?? "the form"} with valid data and submit it, answering the submit request with a simulated 500 error (the request never reaches your server, so no test records are created). A visible, announced error must appear within 5 seconds and the typed values must stay.`,
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
      const values = canaryValues(ctx.form, ctx.runToken, "silent");
      let intercepted: { method: string; url: string } | null = null;
      let pagePost = false;
      await page.route("**/*", async (route, request) => {
        if (!isCreatePlaywrightRequest(request, ctx.targetUrl, ctx.runToken)) return route.fallback();
        if (isPagePost({ resourceType: request.resourceType() })) {
          // A classic form post: after a server error the browser shows whatever page the server sends, which Run
          // Hound can't judge. Stopped here (nothing is saved) and the scenario is skipped.
          pagePost = true;
          return route.fulfill(simulatedResponse(request, 200, STOPPED_PAGE_POST_HTML, "text/html; charset=utf-8"));
        }
        intercepted ??= { method: request.method(), url: request.url() };
        await route.fulfill(simulatedResponse(request, 500, JSON.stringify({ error: "Something went wrong" })));
      });

      ctx.step("Filling the form with valid test values", page);
      const unset = await fillForm(page, values);
      const submit = submitControl(ctx.form);
      const flow = recordFlow(ctx, page, "submit while the server fails");
      await flow.step("Form filled with valid data", {
        highlights: submit ? [{ selector: submit.selector, label: "Submitting next", tone: "info" }] : [],
        facts: [
          { label: "Fields filled", value: String(values.length) },
          { label: "Server answer", value: "500, simulated by Run Hound (nothing is saved)" },
        ],
      });
      const typed = await snapshot(page, values);
      await page.evaluate(ARM_SCRIPT);
      const step = await watchNextStep(page, capture, ctx.targetUrl, ctx.runToken);
      await armFieldErrors(page);
      await submitForm(page, ctx.form);
      const submittedAt = Date.now();
      await waitFor(() => (intercepted as unknown) !== null || pagePost, 2000);
      if (pagePost && !intercepted) return { ...result(ID, scenario, started, []), status: "skipped", notes: PAGE_POST_NOTE };
      const firstHit = intercepted as { method: string; url: string } | null;
      await flow.step("Submitted; the save request was answered with 500", {
        facts: [
          { label: "Injected status", value: "500 (simulated; the request never reached the server)" },
          { label: "Request", value: firstHit ? endpointOf(firstHit.method, firstHit.url) : "waiting for the save request" },
        ],
      });
      ctx.step(`Waiting up to ${BUDGET_MS / 1000} s for an error message`, page);

      let probe: Probe = { announced: false, how: null, text: null };
      let lastVisible: string | null = null;
      await waitFor(async () => {
        probe = ((await page.evaluate(PROBE_SCRIPT).catch(() => null)) as Probe | null) ?? probe;
        if (probe.text) lastVisible = probe.text;
        return probe.announced;
      }, BUDGET_MS - (Date.now() - submittedAt));

      // Assigned inside the route handler, which TypeScript's narrowing can't see.
      const hit = intercepted as { method: string; url: string } | null;
      if (!hit) {
        // The first step of a wizard saves nothing: it shows the next step. That is not a refusal.
        return {
          ...result(ID, scenario, started, []),
          status: "skipped",
          notes: (await step.moved())
            ? MULTI_STEP_NOTE
            : `Skipped: submitting the form sent no save request, so there was no server answer to turn into an error. ${await whyNothingSent(page, ctx.form, values, unset)}`,
        };
      }
      const seenAfterMs = Date.now() - submittedAt;
      // Give a form reset that runs with the message a moment to land.
      await sleep(300);
      ctx.step("Checking the typed values are still there", page);
      const lost = await lostInputs(page, values, typed);

      const make = findingFactory(ID, "broken-feature", scenario);
      const failed = !probe.announced || lost.length > 0;
      const visibleText = lastVisible ?? probe.text;
      const waited = `${(seenAfterMs / 1000).toFixed(1)} s after submitting`;
      const highlights: Highlight[] = [];
      if (!probe.announced) {
        const message = visibleText ? (await markText(page, visibleText.split("\n")[0]!.slice(0, 80), "rh-silent", 1))[0] : undefined;
        if (message) highlights.push({ selector: message, label: "Shown, but not announced to screen readers" });
        else highlights.push({ selector: ctx.form.selector, label: `No error shown after ${(seenAfterMs / 1000).toFixed(0)} s` });
      }
      for (const { field } of values.filter((v) => lost.includes(fieldName(v.field))).slice(0, 4)) {
        highlights.push({ selector: field.selector, label: "Emptied after the error" });
      }
      const facts: Fact[] = [
        { label: "Injected status", value: "500 (simulated; the request never reached the server)" },
        { label: "Request", value: endpointOf(hit.method, hit.url) },
        { label: "Waited for an error", value: waited },
        {
          label: "Error message",
          value: probe.announced ? `"${probe.text}" (announced via ${probe.how})` : visibleText ? `"${visibleText}" (visible, not announced)` : "none",
        },
        { label: "Values kept", value: lost.length ? `no: ${lost.join(", ")} emptied` : `yes, all ${values.length} fields` },
      ];
      await flow.step(`${(seenAfterMs / 1000).toFixed(1)} s after the failed save`, {
        highlights,
        caption: !probe.announced
          ? visibleText
            ? "The save failed and a message appeared, but it is not in an alert or live region, so screen readers say nothing."
            : `The save failed with a 500, and ${(seenAfterMs / 1000).toFixed(0)} s later the page still shows no error.`
          : `The save failed and the form cleared ${lost.join(", ")}.`,
        facts,
      });
      const shots = failed ? await flow.finish("submit while the server fails") : [];
      const baseSpec = [
        `await page.route(${JSON.stringify(hit.url)}, (route) =>`,
        `  route.request().method() === ${JSON.stringify(hit.method)} ? route.fulfill({ status: 500, json: { error: "Something went wrong" } }) : route.fallback());`,
        ...fillLines(values),
        submit ? `await ${controlLocator(submit)}.click();` : `await page.keyboard.press("Enter");`,
      ];
      const interceptEvidence = evidence("network", `Simulated 500 for ${hit.method} ${hit.url}`, { ...hit, simulatedStatus: 500 });
      const findings = [];

      if (!probe.announced) {
        const visible = lastVisible ?? probe.text;
        findings.push(
          make({
            title: visible ? "Save errors are shown but never announced" : "When saving fails, no error message appears",
            severity: visible ? "medium" : "high",
            location: submit ? `"${submit.accessibleName ?? submit.text}" button` : "Form submit",
            meaning: visible
              ? "When the server fails, the page shows a message, but screen readers are not told about it: it is not in an alert or live region and focus does not move to it."
              : `When the server fails to save the form, nothing tells the user within ${BUDGET_MS / 1000} seconds. The form just sits there (often with a spinner), so it looks like it is still working or like it worked.`,
            impact: visible
              ? "Blind and low-vision users submit, hear nothing, and do not know their submission failed."
              : "People leave thinking their submission went through when it did not, or give up and never come back.",
            fix: visible
              ? `Ask your AI or developer: "Put the submit error message in an element with role=\\"alert\\" (or an aria-live region that exists from page load), or move focus to it."`
              : `Ask your AI or developer: "When the submit request fails (any non-2xx response or network error), stop the spinner, re-enable the button and show a clear error in an element with role=\\"alert\\" within a second or two."`,
            evidence: [
              ...shots,
              interceptEvidence,
              evidence("dom", visible ? "Visible message with no announcement" : `No error message within ${BUDGET_MS / 1000} s`, {
                visibleMessage: visible,
                waitedMs: seenAfterMs,
              }),
            ],
            spec: {
              name: "server-error-is-announced",
              source: specSource(ctx.targetUrl, "a server error shows an announced message", [
                ...baseSpec,
                `await expect(page.getByRole("alert").filter({ hasText: /${ERROR_WORDS}/i })).toBeVisible({ timeout: ${BUDGET_MS} });`,
              ], ctx.form),
            },
          }),
        );
      }

      if (lost.length > 0) {
        findings.push(
          make({
            title:
              lost.length > 1
                ? `A save error wipes what the user typed in ${lost.length} fields (${lost.slice(0, 3).join(", ")}${lost.length > 3 ? ", …" : ""})`
                : `A save error wipes what the user typed (${lost[0]})`,
            severity: "high",
            location: `"${lost[0]}" field`,
            locations: lost.map((l) => `"${l}" field`),
            meaning: "When saving fails, the form clears the user's answers instead of keeping them for another try.",
            impact: "People have to type everything again after an error, and many give up instead.",
            fix: `Ask your AI or developer: "When the submit request fails, keep every field's value (${lost.join(", ")}) so the user can simply try again. Only reset the form after a successful save."`,
            evidence: [...shots, interceptEvidence, evidence("dom", "Fields emptied after the error", { lost })],
            spec: {
              name: "server-error-keeps-input",
              source: specSource(ctx.targetUrl, "a server error keeps the typed values", [
                ...baseSpec,
                `await page.waitForTimeout(${BUDGET_MS});`,
                ...values
                  .filter((v) => lost.includes(fieldName(v.field)) && !v.field.options && !v.field.widget && !["radio", "checkbox"].includes(v.field.type))
                  .map((v) => `await expect(${fieldLocator(v.field)}).toHaveValue(${JSON.stringify(v.value)});`),
              ], ctx.form),
            },
          }),
        );
      }

      const notes = probe.announced ? `Error announced via ${probe.how} after ~${seenAfterMs} ms: "${probe.text}"` : undefined;
      return result(ID, scenario, started, findings, notes);
    });
  },
};
