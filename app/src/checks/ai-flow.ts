import type { Page } from "playwright";
import type { Capture, Check, CheckContext, CheckResult, Fact, FlowExpectation, FlowStep, FormControl, FormField, Highlight, Scenario } from "../core/types.js";
import { isAcceptedStatus } from "../core/saves.js";
import { redactSecrets } from "../engine/redact.js";
import { isDestructiveControl } from "./dead-control.js";
import { clip, controlLocator, endpointOf, errorResult, evidence, fieldLocator, fillLines, findingFactory, guarded, recordFlow, requestSummary, result, specSource, tryCapture } from "./lib/functional-finding.js";
import { controlName, createRequests, fieldName, fillForm, isSameOrigin, settle, sleep, waitFor, waitForCreates, type FieldValue } from "./lib/functional-form.js";

const ID = "ai-flow" as const;

/** How long a text or URL expectation may take to come true after the last step settled. */
const APPEAR_MS = 3_000;
/** Grace before deciding a "nothing bad happened" expectation, so late errors (a setTimeout throw) are counted. */
const QUIET_MS = 400;

/** A flow step resolved against the discovered form, ready to run. */
type Resolved =
  | { action: "fill" | "choose"; value: FieldValue; label: string }
  | { action: "click"; control: FormControl; label: string }
  | { action: "press"; key: string; label: string }
  | { action: "expect"; expect: FlowExpectation; text: string | null; label: string };

/** What was observed when an expectation was decided. */
interface Verdict {
  ok: boolean;
  /** Plain words: "POST /api/save answered 500". */
  observed: string;
  highlights?: Highlight[];
  data?: unknown;
}

const q = (s: string) => JSON.stringify(s);

/** What an expectation asks for, in plain words. */
function expectationText(expect: FlowExpectation, text: string | null): string {
  switch (expect) {
    case "request-ok":
      return "a save request reaches the app and succeeds";
    case "text-visible":
      return `"${text ?? ""}" is shown on the page`;
    case "text-absent":
      return `"${text ?? ""}" is not shown on the page`;
    case "url-changes":
      return "the page address changes";
    case "no-errors":
      return "no page errors, console errors or failed requests";
    case "field-kept":
      return "every typed value is still in its field";
  }
}

/** Resolves every step up front, so a flow that names something missing fails before anything is clicked. */
function resolve(flow: FlowStep[], fields: FormField[], controls: FormControl[]): Resolved[] | string {
  const steps: Resolved[] = [];
  for (const [i, step] of flow.entries()) {
    const n = i + 1;
    switch (step.action) {
      case "fill":
      case "choose": {
        const field = fields.find((f) => f.key === step.field);
        if (!field) return `Step ${n} names a field "${step.field}" that this form doesn't have.`;
        if (step.action === "fill") {
          steps.push({ action: "fill", value: { field, value: step.value, canary: false }, label: `Type "${clip(step.value, 40)}" into ${fieldName(field)}` });
          break;
        }
        const wanted = step.option.trim().toLowerCase();
        const option = field.options?.find((o) => o.label === step.option) ?? field.options?.find((o) => o.label.trim().toLowerCase() === wanted);
        if (!option) return `Step ${n} chooses "${step.option}", which is not an option of ${fieldName(field)}.`;
        steps.push({ action: "choose", value: { field, value: option.label, canary: false }, label: `Choose "${clip(option.label, 40)}" in ${fieldName(field)}` });
        break;
      }
      case "click": {
        const control = Number.isInteger(step.control) ? controls[step.control] : undefined;
        if (!control) return `Step ${n} clicks control ${step.control}, but this form has ${controls.length} control${controls.length === 1 ? "" : "s"}.`;
        steps.push({ action: "click", control, label: `Click ${controlName(control)}` });
        break;
      }
      case "press":
        steps.push({ action: "press", key: step.key, label: `Press ${step.key}` });
        break;
      case "expect":
        steps.push({ action: "expect", expect: step.expect, text: step.text, label: `Check: ${expectationText(step.expect, step.text)}` });
        break;
    }
  }
  return steps;
}

/** Visible elements whose text contains `text` (Playwright's getByText, case-insensitive substring). */
async function visibleMatches(page: Page, text: string): Promise<number> {
  return page.getByText(text).filter({ visible: true }).count().catch(() => 0);
}

/** "path?query" of a URL, the part of the address a flow can change. */
function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

/** Where each capture list stood when the flow started. */
type Marks = { requests: number; console: number; pageErrors: number };

/** Decides one expectation from the page and the capture since the flow started. Never asks a model. */
async function decide(
  ctx: CheckContext,
  page: Page,
  capture: Capture,
  marks: Marks,
  startUrl: string,
  filled: FieldValue[],
  step: Extract<Resolved, { action: "expect" }>,
): Promise<Verdict> {
  const requests = capture.requests.slice(marks.requests);
  const since: Capture = { requests, console: capture.console.slice(marks.console), pageErrors: capture.pageErrors.slice(marks.pageErrors) };
  const text = step.text ?? "";
  switch (step.expect) {
    case "request-ok": {
      const saves = createRequests(since, ctx.targetUrl, ctx.runToken);
      const answers = saves.map((r) => `${endpointOf(r.method, r.url)} → ${r.status ?? r.failure ?? "no answer"}`);
      if (saves.length === 0) return { ok: false, observed: "no save request reached the app" };
      const bad = saves.filter((r) => !isAcceptedStatus(r.status));
      if (bad.length === 0) return { ok: true, observed: `the app accepted the save (${answers.join(", ")})` };
      const b = bad[0]!;
      return {
        ok: false,
        observed: `the save request ${endpointOf(b.method, b.url)} ${b.status !== null ? `answered ${b.status}` : `failed (${b.failure ?? "no answer"})`}`,
        data: saves.map((r) => requestSummary(r, true)),
      };
    }
    case "text-visible": {
      const shown = await waitFor(async () => (await visibleMatches(page, text)) > 0, APPEAR_MS);
      return shown ? { ok: true, observed: `"${text}" is shown` } : { ok: false, observed: `"${text}" never appeared on the page` };
    }
    case "text-absent": {
      await sleep(QUIET_MS);
      const count = await visibleMatches(page, text);
      if (count === 0) return { ok: true, observed: `"${text}" is not shown` };
      const selector = await page
        .getByText(text)
        .filter({ visible: true })
        .first()
        .evaluate((el) => {
          el.setAttribute("data-rh-mark", "rh-flow-text");
          return '[data-rh-mark="rh-flow-text"]';
        })
        .catch(() => null);
      return {
        ok: false,
        observed: `"${text}" is shown on the page`,
        ...(selector ? { highlights: [{ selector, label: `"${clip(text, 40)}" is shown` }] } : {}),
      };
    }
    case "url-changes": {
      const start = pathOf(startUrl);
      const moved = await waitFor(() => pathOf(page.url()) !== start, APPEAR_MS);
      return moved
        ? { ok: true, observed: `the address changed from ${start} to ${pathOf(page.url())}` }
        : { ok: false, observed: `the address stayed ${start}` };
    }
    case "no-errors": {
      await sleep(QUIET_MS);
      await settle(page, 2_000);
      const pageErrors = capture.pageErrors.slice(marks.pageErrors);
      const consoleErrors = capture.console.slice(marks.console).filter((m) => m.type === "error");
      const failed = capture.requests
        .slice(marks.requests)
        .filter((r) => isSameOrigin(r.url, ctx.targetUrl) && ((r.status !== null && r.status >= 400) || r.failure !== null));
      const problems = [
        ...pageErrors.map((e) => `page error: ${clip(e.split("\n")[0]!, 140)}`),
        ...failed.map((r) => `${endpointOf(r.method, r.url)} → ${r.status ?? r.failure}`),
        ...consoleErrors.map((m) => `console error: ${clip(m.text, 140)}`),
      ];
      if (problems.length === 0) return { ok: true, observed: "no errors and no failed requests" };
      return {
        ok: false,
        observed: `${problems.length} error${problems.length === 1 ? "" : "s"} (${problems.slice(0, 2).join("; ")}${problems.length > 2 ? "; …" : ""})`,
        data: { pageErrors, consoleErrors: consoleErrors.map((m) => m.text), failedRequests: failed.map((r) => requestSummary(r)) },
      };
    }
    case "field-kept": {
      const typed = filled.filter((v) => !v.field.options?.length);
      const lost: { v: FieldValue; now: string }[] = [];
      for (const v of typed) {
        const now = await page.locator(v.field.selector).first().inputValue({ timeout: 2_000 }).catch(() => "(field is gone)");
        if (now !== v.value) lost.push({ v, now });
      }
      if (typed.length === 0) return { ok: true, observed: "the flow typed into no field" };
      if (lost.length === 0) return { ok: true, observed: `all ${typed.length} typed value${typed.length === 1 ? " is" : "s are"} still in place` };
      const names = lost.map((l) => fieldName(l.v.field)).join(", ");
      return {
        ok: false,
        observed: `${names} ${lost.length === 1 ? "no longer holds" : "no longer hold"} what was typed`,
        highlights: lost.map((l) => ({ selector: l.v.field.selector, label: `Now "${clip(l.now, 30)}"` })),
        data: lost.map((l) => ({ field: l.v.field.key, name: fieldName(l.v.field), typed: l.v.value, now: l.now })),
      };
    }
  }
}

/** Spec lines that check one expectation (listeners they need are set up by setupLines). */
function expectLines(step: Extract<Resolved, { action: "expect" }>, filled: FieldValue[]): string[] {
  const text = step.text ?? "";
  switch (step.expect) {
    case "request-ok":
      return [`await expect.poll(() => saves.length).toBeGreaterThan(0);`, `expect(saves.filter((s) => s.status >= 400), "failed save requests").toEqual([]);`];
    case "text-visible":
      return [`await expect(page.getByText(${q(text)}).first()).toBeVisible();`];
    case "text-absent":
      return [`await expect(page.getByText(${q(text)}).filter({ visible: true })).toHaveCount(0);`];
    case "url-changes":
      return [`await expect(page).not.toHaveURL(TARGET);`];
    case "no-errors":
      return [`expect(errors).toEqual([]);`];
    case "field-kept":
      return filled.filter((v) => !v.field.options?.length).map((v) => `await expect(${fieldLocator(v.field)}).toHaveValue(${q(v.value)});`);
  }
}

/** Listeners a spec needs before the steps run, for the expectations it checks. */
function setupLines(steps: Resolved[]): string[] {
  const kinds = new Set(steps.flatMap((s) => (s.action === "expect" ? [s.expect] : [])));
  const lines: string[] = [];
  if (kinds.has("request-ok")) {
    lines.push(
      `const saves: { url: string; status: number }[] = [];`,
      `page.on("response", (r) => {`,
      `  const req = r.request();`,
      `  if (!["GET", "HEAD", "OPTIONS"].includes(req.method()) && new URL(r.url()).origin === new URL(TARGET).origin) saves.push({ url: r.url(), status: r.status() });`,
      `});`,
    );
  }
  if (kinds.has("no-errors")) {
    lines.push(
      `const errors: string[] = [];`,
      `page.on("pageerror", (e) => errors.push(e.message));`,
      `page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });`,
    );
  }
  return lines;
}

/** Spec lines that repeat one action step. */
function actionLines(step: Resolved): string[] {
  switch (step.action) {
    case "fill":
    case "choose":
      return fillLines([step.value]);
    case "click":
      return [`await ${controlLocator(step.control)}.click();`, `await page.waitForLoadState("networkidle");`];
    case "press":
      return [`await page.keyboard.press(${q(step.key)});`, `await page.waitForLoadState("networkidle");`];
    case "expect":
      return [];
  }
}

export const check: Check = {
  id: ID,
  title: "AI-suggested flows",
  category: "broken-feature",
  scope: "form",
  plan(): Scenario[] {
    return [];
  },
  run(ctx: CheckContext, scenario: Scenario): Promise<CheckResult> {
    return guarded(ID, scenario, ctx, async (started) => {
      const flow = scenario.flow ?? [];
      if (flow.length === 0) return errorResult(ID, scenario, started, "This AI-suggested scenario has no steps to run.");
      const resolved = resolve(flow, ctx.form.fields, ctx.form.controls);
      if (typeof resolved === "string") return errorResult(ID, scenario, started, `Could not run this flow: ${resolved}`);
      if (!ctx.allowDestructive) {
        const risky = resolved.find((s): s is Extract<Resolved, { action: "click" }> => s.action === "click" && isDestructiveControl(s.control));
        if (risky) {
          return errorResult(
            ID,
            scenario,
            started,
            `Skipped: this flow clicks ${controlName(risky.control)}, which may change or delete data. Allow destructive scenarios to run it.`,
            "skipped",
          );
        }
        if (scenario.destructive) return errorResult(ID, scenario, started, "Skipped: this flow is marked destructive. Allow destructive scenarios to run it.", "skipped");
      }

      const { page, capture } = await ctx.openPage();
      const marks: Marks = { requests: capture.requests.length, console: capture.console.length, pageErrors: capture.pageErrors.length };
      const startUrl = page.url();
      const recording = recordFlow(ctx, page, scenario.title);
      // The engine only collects steps when it runs the check; kept here too so the result always carries them.
      const steps: NonNullable<CheckResult["steps"]> = [];
      const done: string[] = [];
      const filled: FieldValue[] = [];
      const verified: string[] = [];
      const record = async (label: string, highlights?: Highlight[]) => {
        steps.push({ label: redactSecrets(label), url: redactSecrets(page.url()), at: new Date().toISOString() });
        done.push(label);
        await recording.step(label, highlights ? { highlights } : {});
      };

      for (const step of resolved) {
        switch (step.action) {
          case "fill":
          case "choose":
            await fillForm(page, [step.value]);
            if (step.action === "fill") filled.push(step.value);
            await record(step.label, [{ selector: step.value.field.selector, label: clip(step.label, 50), tone: "info" }]);
            continue;
          case "click":
            await page.locator(step.control.selector).first().click();
            await waitForCreates(page, capture, ctx.targetUrl, undefined, ctx.runToken);
            await record(step.label);
            continue;
          case "press":
            await page.keyboard.press(step.key);
            await waitForCreates(page, capture, ctx.targetUrl, undefined, ctx.runToken);
            await record(step.label);
            continue;
          case "expect":
            break;
        }

        const verdict = await decide(ctx, page, capture, marks, startUrl, filled, step);
        if (verdict.ok) {
          verified.push(`${expectationText(step.expect, step.text)}: ${verdict.observed}`);
          await record(step.label);
          continue;
        }

        // The first failing expectation ends the flow with one finding.
        await record(step.label, verdict.highlights);
        const expected = expectationText(step.expect, step.text);
        const facts: Fact[] = [
          ...done.map((label, i) => ({ label: `Step ${i + 1}`, value: label })),
          { label: "Expected", value: expected },
          { label: "Observed", value: verdict.observed },
        ];
        const gif = await recording.finish(scenario.title);
        const frame = await tryCapture(ctx, page, "Page when the check failed", {
          highlights: verdict.highlights ?? [],
          caption: `Expected ${expected}, but ${verdict.observed}.`,
          facts,
        });
        const actions = resolved.slice(0, resolved.indexOf(step) + 1);
        const make = findingFactory(ID, "broken-feature", scenario);
        const finding = make({
          title: `AI-suggested flow failed: ${scenario.title}`,
          severity: "medium",
          meaning: `After ${done.length - 1} step${done.length === 2 ? "" : "s"} (${clip(done.slice(0, -1).join(", "), 300)}), the flow expected ${expected}, but ${verdict.observed}.`,
          impact: `${scenario.description} A person doing the same may not get the result they expect. This flow was suggested by an AI model; the check itself was decided by Run Hound from the page.`,
          fix: `Ask your AI or developer: "Run these steps on ${ctx.targetUrl}: ${done.slice(0, -1).join("; ")}. Afterwards ${expected}, but ${verdict.observed}. Find out why and fix it."`,
          evidence: [
            ...gif,
            ...frame,
            evidence("dom", "Flow steps and what was observed", { steps: done, expected, observed: verdict.observed, ...(verdict.data ? { details: verdict.data } : {}) }),
          ],
          spec: {
            name: scenario.title,
            source: specSource(ctx.targetUrl, scenario.title, [
              ...setupLines(actions),
              ...actions.flatMap((s) => (s.action === "expect" ? expectLines(s, filled) : actionLines(s))),
            ]),
          },
        });
        // Built on a model's suggestion, so advisory even though the expectation itself is deterministic.
        return { ...result(ID, scenario, started, [{ ...finding, confidence: "advisory" }]), steps };
      }

      const notes = verified.length
        ? `Ran ${done.length} steps. Verified: ${verified.join("; ")}.`
        : `Ran ${done.length} steps; the flow has no expectation to verify.`;
      return { ...result(ID, scenario, started, [], redactSecrets(notes)), steps };
    });
  },
};
