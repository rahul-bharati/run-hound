import type { Page } from "playwright";
import type { Capture, Check, CheckContext, CheckResult, DiscoveredForm, Fact, FlowExpectation, FlowStep, FormControl, FormField, Highlight, Scenario } from "../core/types.js";
import { isAcceptedStatus } from "../core/saves.js";
import { redactSecrets } from "../engine/redact.js";
import { isDestructiveControl } from "./dead-control.js";
import { clip, controlLocator, endpointOf, errorResult, evidence, fieldLocator, findingFactory, guarded, recordFlow, requestSummary, result, specSource, tryCapture } from "./lib/functional-finding.js";
import { controlName, createRequests, fieldName, isSameOrigin, settle, sleep, submitControl, waitFor, waitForCreates, type FieldValue } from "./lib/functional-form.js";
import { fieldKind, setField, setFieldSpec, type FieldSetting } from "./lib/widgets.js";

const ID = "ai-flow" as const;

/** How long a text or URL expectation may take to come true after the last step settled. */
const APPEAR_MS = 3_000;
/** Grace before deciding a "nothing bad happened" expectation, so late errors (a setTimeout throw) are counted. */
const QUIET_MS = 400;

/**
 * A flow step resolved against the discovered form, ready to run. `label` is the full step (a fill quotes the typed
 * value); `plain` names only the field, control or expectation and is what the finding's meaning and fix use, so typed
 * values never reach an explanation prompt (Rule 4). They differ only for fill steps.
 */
type Resolved = (
  | { action: "fill" | "choose"; value: FieldValue }
  | { action: "click"; control: FormControl }
  | { action: "press"; key: string }
  | { action: "expect"; expect: FlowExpectation; text: string | null }
) & { label: string; plain: string };

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

/** What a fill or choose step sets: a fill's text (read as the field takes it: an option, yes/no, a number), a choice's option. */
function settingOf(step: Extract<Resolved, { action: "fill" | "choose" }>): FieldSetting {
  return step.action === "choose" ? { option: step.value.value } : { text: step.value.value };
}

/** Whether filling `field` types text into it (a text field or an autocomplete), rather than choosing or checking. */
function typesInto(field: FormField): boolean {
  const kind = fieldKind(field);
  return kind === "text" || kind === "combobox";
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
          // A fill on a picker, checkbox or slider sets it (Owner to "Sam Lee", Terms to "yes") rather than typing.
          const [label, plain] = typesInto(field)
            ? [`Type "${clip(step.value, 40)}" into ${fieldName(field)}`, `Type into ${fieldName(field)}`]
            : [`Set ${fieldName(field)} to "${clip(step.value, 40)}"`, `Set ${fieldName(field)}`];
          steps.push({ action: "fill", value: { field, value: step.value, canary: false }, label, plain });
          break;
        }
        const wanted = step.option.trim().toLowerCase();
        const option = field.options?.find((o) => o.label === step.option) ?? field.options?.find((o) => o.label.trim().toLowerCase() === wanted);
        if (!option) return `Step ${n} chooses "${step.option}", which is not an option of ${fieldName(field)}.`;
        const choose = `Choose "${clip(option.label, 40)}" in ${fieldName(field)}`;
        steps.push({ action: "choose", value: { field, value: option.label, canary: false }, label: choose, plain: choose });
        break;
      }
      case "click": {
        const control = Number.isInteger(step.control) ? controls[step.control] : undefined;
        if (!control) return `Step ${n} clicks control ${step.control}, but this form has ${controls.length} control${controls.length === 1 ? "" : "s"}.`;
        steps.push({ action: "click", control, label: `Click ${controlName(control)}`, plain: `Click ${controlName(control)}` });
        break;
      }
      case "press":
        steps.push({ action: "press", key: step.key, label: `Press ${step.key}`, plain: `Press ${step.key}` });
        break;
      case "expect":
        const check = `Check: ${expectationText(step.expect, step.text)}`;
        steps.push({ action: "expect", expect: step.expect, text: step.text, label: check, plain: check });
        break;
    }
  }
  return steps;
}

/**
 * The destructive control that Enter in a field of `form` would activate, or null. Enter in a field submits the form
 * through its submit control, so it is that control when it is destructive (a "Delete account" form with a
 * confirm-email field). When discovery found no submit control, the browser's default button is unknown, so any
 * destructive control of the form counts. Used by suggest.ts to mark such flows destructive and here to skip them.
 */
export function destructiveEnterTarget(form: DiscoveredForm): FormControl | null {
  const submit = submitControl(form);
  if (submit) return isDestructiveControl(submit) ? submit : null;
  return form.controls.find(isDestructiveControl) ?? null;
}

/** Keys a flow may never press: Tab moves focus to arbitrary controls and Space activates buttons (Rule 5). */
const REFUSED_KEYS = new Set(["Tab", "Space"]);

/** What has focus: whether it is a text-entry field of the scenario's form, and whether it is a destructive control. */
interface Focus {
  inFormField: boolean;
  /** Name of the focused control when it is destructive, else null. */
  destructive: string | null;
  /** Name of the default (submit) button of the focused field's form when it is destructive, else null. */
  submitsDestructive: string | null;
}

/**
 * Runs in the page (a string, so the bundler's helpers never leak in). `__ARGS__` is replaced with JSON of
 * {fields, formSelector, risky}: selectors of the form's fields, the form's selector, and [selector, name] of every
 * destructive control discovered. Returns whether focus is on a text-entry field of the form, the name of a matching
 * discovered destructive control, and the focused element's own name when it is button-like (checked in Node with
 * isDestructiveControl, so an undiscovered "Delete account" button is caught too), and the name of the default button
 * of the focused field's form (the first submit button among form.elements: what Enter in that field activates).
 */
const FOCUS_SCRIPT = `(() => {
  const args = __ARGS__;
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return { inFormField: false, risky: null, buttonName: null, defaultButton: null };
  const safe = (sel) => { try { return el.matches(sel); } catch { return false; } };
  const tag = el.tagName.toLowerCase();
  const type = (el.getAttribute("type") || "").toLowerCase();
  const buttonTypes = ["button", "submit", "reset", "image"];
  const textEntry = (tag === "input" && !buttonTypes.includes(type) && type !== "file") || tag === "textarea" || tag === "select";
  let inForm = args.fields.some(safe);
  if (!inForm && args.formSelector) { try { const form = document.querySelector(args.formSelector); inForm = !!form && form !== document.body && form.contains(el); } catch {} }
  const hit = args.risky.find((r) => safe(r[0]));
  const role = el.getAttribute("role") || "";
  const buttonLike = tag === "button" || tag === "a" || tag === "summary" || (tag === "input" && buttonTypes.includes(type)) || ["button", "link", "menuitem", "tab", "option"].includes(role);
  const nameOf = (b) => [b.getAttribute("aria-label"), b.textContent, b.getAttribute("value"), b.getAttribute("title")].filter(Boolean).join(" ").replace(/\\s+/g, " ").trim();
  const buttonName = buttonLike ? nameOf(el) : null;
  let defaultButton = null;
  try {
    const owner = el.form;
    const def = owner ? Array.from(owner.elements).find((b) => (b.tagName === "BUTTON" && b.type === "submit") || (b.tagName === "INPUT" && (b.type === "submit" || b.type === "image"))) : null;
    defaultButton = def ? nameOf(def) : null;
  } catch {}
  return { inFormField: textEntry && inForm, risky: hit ? hit[1] : null, buttonName, defaultButton };
})()`;

/** Where focus is now. An unreadable page counts as focus on no field and no destructive control. */
async function focusOf(page: Page, ctx: CheckContext): Promise<Focus> {
  const controls = [...ctx.form.controls, ...(ctx.discoveredPage?.controls ?? []), ...(ctx.discoveredPage?.forms.flatMap((f) => f.controls) ?? [])];
  const risky = controls.filter(isDestructiveControl).map((c) => [c.selector, controlName(c)]);
  const args = { fields: ctx.form.fields.map((f) => f.selector), formSelector: ctx.form.selector, risky };
  const raw = (await page.evaluate(FOCUS_SCRIPT.replace("__ARGS__", JSON.stringify(args))).catch(() => null)) as
    | { inFormField: boolean; risky: string | null; buttonName: string | null; defaultButton: string | null }
    | null;
  if (!raw) return { inFormField: false, destructive: null, submitsDestructive: null };
  // The default button is the form's own submit button: sending words ("Send message") are its normal job, as in
  // destructiveEnterTarget, so only deleting and session-ending words count there.
  const destructiveName = (found: string | null, isSubmit = false) => {
    const name = found ? clip(found, 60) : null;
    return name && isDestructiveControl({ accessibleName: name, text: name, role: "button", tag: "button", selector: "", isSubmit }) ? name : null;
  };
  return { inFormField: raw.inFormField, destructive: raw.risky ?? destructiveName(raw.buttonName), submitsDestructive: destructiveName(raw.defaultButton, true) };
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
      const typed = filled.filter((v) => typesInto(v.field));
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
      return filled.filter((v) => typesInto(v.field)).map((v) => `await expect(${fieldLocator(v.field)}).toHaveValue(${q(v.value)});`);
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
      return setFieldSpec(step.value.field, settingOf(step));
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
      // Refused whatever the plan says: an older saved plan may still hold them (suggest.ts rejects them now).
      const refused = resolved.find((s): s is Extract<Resolved, { action: "press" }> => s.action === "press" && REFUSED_KEYS.has(s.key));
      if (refused) {
        return errorResult(
          ID,
          scenario,
          started,
          `Skipped: this flow presses ${refused.key}, which could move focus to or activate a control that changes or deletes data. AI flows may press only Enter and Escape.`,
          "skipped",
        );
      }
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
        const submits = resolved.some((s) => s.action === "press" && s.key === "Enter") ? destructiveEnterTarget(ctx.form) : null;
        if (submits) {
          return errorResult(
            ID,
            scenario,
            started,
            `Skipped: this flow presses Enter in a field, which submits the form with ${controlName(submits)}, which may change or delete data. Allow destructive scenarios to run it.`,
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
      /** done without typed values (Resolved.plain), for the finding's meaning and fix. */
      const plainDone: string[] = [];
      /** Whether each done step typed a value, so its evidence fact is labelled "Step N (typed)". */
      const typedDone: boolean[] = [];
      const filled: FieldValue[] = [];
      const verified: string[] = [];
      const record = async (step: Resolved, highlights?: Highlight[]) => {
        const label = step.label;
        steps.push({ label: redactSecrets(label), url: redactSecrets(page.url()), at: new Date().toISOString() });
        done.push(label);
        plainDone.push(step.plain);
        typedDone.push(step.action === "fill");
        await recording.step(label, highlights ? { highlights } : {});
      };

      /** Ends the flow as "skipped" with what was done so far. */
      const stop = async (why: string): Promise<CheckResult> => {
        return { ...errorResult(ID, scenario, started, redactSecrets(`Skipped after ${done.length} step${done.length === 1 ? "" : "s"}: ${why}`), "skipped"), steps };
      };
      /** After an action: focus that landed on a destructive control (the page moved it, or a step did) stops the flow. */
      const focusGuard = async (): Promise<string | null> => {
        if (ctx.allowDestructive) return null;
        const focus = await focusOf(page, ctx);
        return focus.destructive
          ? `focus moved onto ${focus.destructive}, which may change or delete data, so no further step is taken. Allow destructive scenarios to run it.`
          : null;
      };

      for (const step of resolved) {
        switch (step.action) {
          case "fill":
          case "choose": {
            try {
              await setField(page, step.value.field, settingOf(step));
            } catch (err) {
              // The step can't be performed (a value the widget doesn't offer): an error, like a missing field.
              const why = err instanceof Error ? err.message : String(err);
              return { ...errorResult(ID, scenario, started, redactSecrets(`Could not run step ${done.length + 1}: ${why}`)), steps };
            }
            if (step.action === "fill") filled.push(step.value);
            await record(step, [{ selector: step.value.field.selector, label: clip(step.label, 50), tone: "info" }]);
            const moved = await focusGuard();
            if (moved) return stop(moved);
            continue;
          }
          case "click": {
            await page.locator(step.control.selector).first().click();
            await waitForCreates(page, capture, ctx.targetUrl, undefined, ctx.runToken);
            await record(step);
            const moved = await focusGuard();
            if (moved) return stop(moved);
            continue;
          }
          case "press": {
            // Escape anywhere; Enter only from a field of this form, where it submits the form (never a focused button).
            if (step.key !== "Escape") {
              const focus = await focusOf(page, ctx);
              if (step.key !== "Enter" || !focus.inFormField || (focus.destructive && !ctx.allowDestructive)) {
                return stop(`${step.label} was not done because focus is not on a field of this form, so the key could activate another control. Enter is pressed only in a form field.`);
              }
              if (focus.submitsDestructive && !ctx.allowDestructive) {
                return stop(`${step.label} was not done because Enter in this field submits the form with ${focus.submitsDestructive}, which may change or delete data. Allow destructive scenarios to run it.`);
              }
            }
            await page.keyboard.press(step.key);
            await waitForCreates(page, capture, ctx.targetUrl, undefined, ctx.runToken);
            await record(step);
            const moved = await focusGuard();
            if (moved) return stop(moved);
            continue;
          }
          case "expect":
            break;
        }

        const verdict = await decide(ctx, page, capture, marks, startUrl, filled, step);
        if (verdict.ok) {
          verified.push(`${expectationText(step.expect, step.text)}: ${verdict.observed}`);
          await record(step);
          continue;
        }

        // The first failing expectation ends the flow with one finding.
        await record(step, verdict.highlights);
        const expected = expectationText(step.expect, step.text);
        const facts: Fact[] = [
          // Full steps, typed values included, for the report; explain.ts never sends "Step…" facts.
          ...done.map((label, i) => ({ label: `Step ${i + 1}${typedDone[i] ? " (typed)" : ""}`, value: label })),
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
          meaning: `After ${done.length - 1} step${done.length === 2 ? "" : "s"} (${clip(plainDone.slice(0, -1).join(", "), 300)}), the flow expected ${expected}, but ${verdict.observed}.`,
          impact: `${scenario.description} A person doing the same may not get the result they expect. This flow was suggested by an AI model; the check itself was decided by Run Hound from the page.`,
          fix: `Ask your AI or developer: "Run these steps on ${ctx.targetUrl}: ${plainDone.slice(0, -1).join("; ")}. Afterwards ${expected}, but ${verdict.observed}. Find out why and fix it."`,
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
            ], ctx.form),
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
