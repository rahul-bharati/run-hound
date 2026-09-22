/**
 * silent-failure: submit valid data while the submit request is answered with a 500 by interception
 * (nothing reaches the server). Pass when an error message appears within 5 s, is announced (live region,
 * alert role, or focus moves to it) and the inputs keep their values.
 */
import type { Page } from "playwright";
import type { Check, Scenario } from "../core/types.js";
import { controlLocator, evidence, fillLines, findingFactory, guarded, result, specSource, tryScreenshot } from "./lib/functional-finding.js";
import { canaryValues, fieldName, fillForm, isCreatePlaywrightRequest, sleep, submitControl, submitForm, waitFor, type FieldValue } from "./lib/functional-form.js";

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
  const regions = document.querySelectorAll('[role=alert], [role=status], [role=log], [aria-live]:not([aria-live=off])');
  for (const el of regions) {
    if (isNew(el) && shown(el)) return { announced: true, how: "live region (" + (el.getAttribute("role") || "aria-live=" + el.getAttribute("aria-live")) + ")", text: el.innerText.trim().slice(0, 300) };
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

/** Fields whose typed value is gone after the error (radios and pickers compared by checked state). */
async function lostInputs(page: Page, values: FieldValue[]): Promise<string[]> {
  const lost: string[] = [];
  for (const { field, value } of values) {
    try {
      if (field.type === "radio" && field.options?.length) {
        const option = field.options.find((o) => o.label === value) ?? field.options[0]!;
        if (!(await page.locator(option.selector).first().isChecked())) lost.push(fieldName(field));
      } else if (!field.options && !["checkbox", "radio", "custom", "file", "hidden"].includes(field.type)) {
        if ((await page.locator(field.selector).first().inputValue()) !== value) lost.push(fieldName(field));
      }
    } catch {
      lost.push(fieldName(field));
    }
  }
  return lost;
}

export const check: Check = {
  id: ID,
  title: "Server errors are shown and announced",
  category: "broken-feature",

  plan(form): Scenario[] {
    return [
      {
        id: "server-error-500",
        checkId: ID,
        title: "Submit while the server answers with an error",
        description: `Fill ${form.name ?? "the form"} with valid data and submit it, answering the submit request with a simulated 500 error (the request never reaches your server). A visible, announced error must appear within 5 seconds and the typed values must stay.`,
        kind: "danger",
        priority: "high",
        destructive: false,
        defaultSelected: true,
      },
    ];
  },

  run(ctx, scenario) {
    return guarded(ID, scenario, ctx, async (started) => {
      const { page } = await ctx.openPage();
      const values = canaryValues(ctx.form, ctx.runToken, "silent");
      let intercepted: { method: string; url: string } | null = null;
      await page.route("**/*", async (route, request) => {
        if (!isCreatePlaywrightRequest(request, ctx.targetUrl) || request.resourceType() === "document") return route.fallback();
        intercepted ??= { method: request.method(), url: request.url() };
        await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Something went wrong" }) });
      });

      await fillForm(page, values);
      await page.evaluate(ARM_SCRIPT);
      await submitForm(page, ctx.form);
      const submittedAt = Date.now();

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
        return result(ID, scenario, started, [], "Submitting sent no request to the server (nothing to fail); nothing to check.");
      }
      const seenAfterMs = Date.now() - submittedAt;
      // Give a form reset that runs with the message a moment to land.
      await sleep(300);
      const lost = await lostInputs(page, values);

      const make = findingFactory(ID, "broken-feature", scenario);
      const submit = submitControl(ctx.form);
      const shots = !probe.announced || lost.length > 0 ? await tryScreenshot(ctx, page, "after simulated server error") : [];
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
              : `When the server fails to save the booking, nothing tells the user within ${BUDGET_MS / 1000} seconds. The form just sits there (often with a spinner), so it looks like it is still working or like it worked.`,
            impact: visible
              ? "Blind and low-vision users submit, hear nothing, and do not know their booking failed."
              : "People leave thinking their booking went through when it did not, or give up and never come back.",
            fix: visible
              ? `Ask your AI or developer: "Put the submit error message in an element with role=\\"alert\\" (or an aria-live region that exists from page load), or move focus to it."`
              : `Ask your AI or developer: "When the submit request fails (any non-2xx response or network error), stop the spinner, re-enable the button and show a clear error in an element with role=\\"alert\\" within a second or two."`,
            evidence: [
              interceptEvidence,
              evidence("dom", visible ? "Visible message with no announcement" : `No error message within ${BUDGET_MS / 1000} s`, {
                visibleMessage: visible,
                waitedMs: seenAfterMs,
              }),
              ...shots,
            ],
            spec: {
              name: "server-error-is-announced",
              source: specSource(ctx.targetUrl, "a server error shows an announced message", [
                ...baseSpec,
                `await expect(page.getByRole("alert").filter({ hasText: /${ERROR_WORDS}/i })).toBeVisible({ timeout: ${BUDGET_MS} });`,
              ]),
            },
          }),
        );
      }

      if (lost.length > 0) {
        findings.push(
          make({
            title: `A save error wipes what the user typed (${lost.slice(0, 3).join(", ")}${lost.length > 3 ? ", …" : ""})`,
            severity: "high",
            location: lost.map((l) => `"${l}" field`).join(", "),
            meaning: "When saving fails, the form clears the user's answers instead of keeping them for another try.",
            impact: "People have to type everything again after an error, and many give up instead.",
            fix: `Ask your AI or developer: "When the submit request fails, keep every field's value (${lost.join(", ")}) so the user can simply try again. Only reset the form after a successful save."`,
            evidence: [interceptEvidence, evidence("dom", "Fields emptied after the error", { lost }), ...shots],
            spec: {
              name: "server-error-keeps-input",
              source: specSource(ctx.targetUrl, "a server error keeps the typed values", [
                ...baseSpec,
                `await page.waitForTimeout(${BUDGET_MS});`,
                ...values
                  .filter((v) => lost.includes(fieldName(v.field)) && !v.field.options && v.field.type !== "radio")
                  .map((v) => `await expect(${`page.getByLabel(${JSON.stringify(fieldName(v.field))}, { exact: true })`}).toHaveValue(${JSON.stringify(v.value)});`),
              ]),
            },
          }),
        );
      }

      const notes = probe.announced ? `Error announced via ${probe.how} after ~${seenAfterMs} ms: "${probe.text}"` : undefined;
      return result(ID, scenario, started, findings, notes);
    });
  },
};
