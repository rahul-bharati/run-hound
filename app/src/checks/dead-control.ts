/**
 * dead-control: click every non-submit control in the form (on a freshly loaded, filled-in page) and fail
 * when a click causes no request, DOM change, navigation, storage change, value change or focus change.
 */
import type { Page } from "playwright";
import type { Check, CheckContext, Evidence, FormControl, Scenario } from "../core/types.js";
import { clip, controlLocator, evidence, fillLines, findingFactory, guarded, recordFlow, result, specSource } from "./lib/functional-finding.js";
import { listOf } from "./lib/a11y-common.js";
import { canaryValues, controlName, fillForm, settle, sleep, waitFor, type FieldValue } from "./lib/functional-form.js";

const ID = "dead-control" as const;

/** How long a control gets to react (covers short animations and debounced handlers). */
const REACTION_MS = 1500;

/**
 * Controls whose name says they destroy, pay for or send something. Clicking those is not a golden-path
 * action, so they are only activated with --allow-destructive.
 */
const DESTRUCTIVE_NAME =
  /\b(delete|remove|destroy|erase|wipe|purge|revoke|deactivate|unsubscribe|archive|discard|pay|purchase|buy|checkout|charge|refund|transfer|invite|publish|deploy)\b/i;

/** True when clicking this control could change or destroy data beyond creating a test record. */
export function isDestructiveControl(control: FormControl): boolean {
  return DESTRUCTIVE_NAME.test(`${control.accessibleName ?? ""} ${control.text}`);
}

/**
 * Page state the check compares before and after a click. Runs in the page as a string (not a function) so
 * the bundler's name helpers never leak into the browser. `__SELECTOR__` is replaced with the control's selector.
 */
const ARM_SCRIPT = `(() => {
  const w = window;
  if (w.__rhObserver) w.__rhObserver.disconnect();
  w.__rhMutations = 0;
  w.__rhObserver = new MutationObserver((list) => { w.__rhMutations += list.length; });
  w.__rhObserver.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  w.__rhFocusBefore = document.activeElement;
  w.__rhTarget = document.querySelector(__SELECTOR__);
  return true;
})()`;

const STATE_SCRIPT = `(() => {
  const w = window;
  const read = (s) => { try { return JSON.stringify(Object.entries(s).sort()); } catch { return ""; } };
  const values = Array.from(document.querySelectorAll("input, textarea, select")).map((el) =>
    el.type === "checkbox" || el.type === "radio" ? String(el.checked) : el.value);
  const active = document.activeElement;
  return {
    mutations: w.__rhMutations || 0,
    focusMoved: !!active && active !== w.__rhFocusBefore && active !== w.__rhTarget && active !== document.body,
    local: read(localStorage),
    session: read(sessionStorage),
    values: JSON.stringify(values),
  };
})()`;

interface PageState {
  mutations: number;
  focusMoved: boolean;
  local: string;
  session: string;
  values: string;
}

type Reaction = "request" | "navigation" | "DOM change" | "storage change" | "value change" | "focus change";

async function state(page: Page): Promise<PageState | null> {
  return (await page.evaluate(STATE_SCRIPT).catch(() => null)) as PageState | null;
}

/** Clicks one control on a fresh page and reports what it did, or null when it did nothing. */
async function probe(
  page: Page,
  capture: { requests: unknown[] },
  target: string,
  control: FormControl,
  values: FieldValue[],
): Promise<{ reaction: Reaction | null; skipped?: string }> {
  await page.goto(target, { waitUntil: "load" });
  await settle(page);
  await fillForm(page, values);

  const locator = page.locator(control.selector).first();
  if (!(await locator.isVisible().catch(() => false))) return { reaction: null, skipped: "not visible" };
  if (await locator.isDisabled().catch(() => false)) return { reaction: null, skipped: "disabled" };

  let navigated = false;
  const onNav = (frame: { parentFrame(): unknown }) => {
    if (!frame.parentFrame()) navigated = true;
  };
  page.on("framenavigated", onNav);
  try {
    await page.evaluate(ARM_SCRIPT.replace("__SELECTOR__", JSON.stringify(control.selector)));
    const before = await state(page);
    const requestsBefore = capture.requests.length;
    const urlBefore = page.url();
    await locator.click({ timeout: 5000 });

    let reaction: Reaction | null = null;
    await waitFor(async () => {
      if (navigated || page.url() !== urlBefore) reaction = "navigation";
      else if (capture.requests.length > requestsBefore) reaction = "request";
      else {
        const after = await state(page);
        if (!after || !before) reaction = "navigation";
        else if (after.mutations > 0) reaction = "DOM change";
        else if (after.local !== before.local || after.session !== before.session) reaction = "storage change";
        else if (after.values !== before.values) reaction = "value change";
        else if (after.focusMoved) reaction = "focus change";
      }
      return reaction !== null;
    }, REACTION_MS);
    return { reaction };
  } finally {
    page.off("framenavigated", onNav);
  }
}

/**
 * Replays the click on a dead control with a recording: filled form, the click, and the page after the
 * reaction window, with what was measured as facts. The control did nothing the first time, so this is safe.
 */
async function recordDeadClick(
  ctx: CheckContext,
  page: Page,
  capture: { requests: unknown[] },
  control: FormControl,
  values: FieldValue[],
): Promise<Evidence[]> {
  const name = controlName(control);
  await page.goto(ctx.targetUrl, { waitUntil: "load" });
  await settle(page);
  await fillForm(page, values);
  const flow = recordFlow(ctx, page, `clicking ${name} does nothing`);
  const watched = { label: "Watched for", value: `${REACTION_MS} ms after the click` };
  const target = { label: "Control", value: `"${name}" ${control.role === "button" ? "button" : `<${control.tag}>`}, visible and enabled` };
  await flow.step(`Before clicking "${name}"`, {
    highlights: [{ selector: control.selector, label: `About to click "${name}"`, tone: "info" }],
    caption: `The form is filled in. Next: one click on "${name}", then ${(REACTION_MS / 1000).toFixed(1)} s of watching for any reaction.`,
    facts: [target, watched],
  });
  await page.evaluate(ARM_SCRIPT.replace("__SELECTOR__", JSON.stringify(control.selector))).catch(() => undefined);
  const before = await state(page);
  const requestsBefore = capture.requests.length;
  const urlBefore = page.url();
  const clickedAt = Date.now();
  await page.locator(control.selector).first().click({ timeout: 5000 });
  // No frame inside the watch window: taking a screenshot changes the DOM (Playwright hides the caret with a style).
  await sleep(Math.max(0, REACTION_MS - (Date.now() - clickedAt)));
  const after = await state(page);
  const changed = (a?: string, b?: string) => (a === b ? 0 : 1);
  const facts = [
    { label: "Requests sent", value: String(capture.requests.length - requestsBefore) },
    { label: "DOM changes", value: String(after?.mutations ?? 0) },
    { label: "Storage changes", value: String(changed(before?.local, after?.local) + changed(before?.session, after?.session)) },
    { label: "Focus or value changes", value: String((after?.focusMoved ? 1 : 0) + changed(before?.values, after?.values)) },
    { label: "Navigation", value: page.url() === urlBefore ? "none" : page.url() },
    watched,
  ];
  await flow.step(`${(REACTION_MS / 1000).toFixed(1)} s after clicking "${name}"`, {
    highlights: [{ selector: control.selector, label: "Clicked: nothing happened" }],
    caption: `Clicked "${name}" and watched for ${(REACTION_MS / 1000).toFixed(1)} s: no request, no page change, no storage change, focus did not move.`,
    facts,
  });
  return flow.finish(`clicking ${name} does nothing`);
}

export const check: Check = {
  id: ID,
  title: "Every button does something",
  category: "broken-feature",

  plan(form): Scenario[] {
    const controls = form.controls.filter((c) => !c.isSubmit);
    if (controls.length === 0) return [];
    const safe = controls.filter((c) => !isDestructiveControl(c));
    const risky = controls.filter(isDestructiveControl);
    if (safe.length === 0) return [];
    return [
      {
        id: "activate-controls",
        checkId: ID,
        title: "Click every button except the submit button",
        description:
          (safe.length === 1
            ? `Click ${listOf(safe.map(controlName))} and check that it causes`
            : `Click ${listOf(safe.map(controlName), Infinity)} one at a time and check that each causes`) +
          " a request, a page change, navigation, a storage change or a focus change. The submit button is never clicked; a button that saves something (a draft, for example) may create test records." +
          (risky.length > 0 ? ` Left out unless you allow destructive scenarios: ${listOf(risky.map(controlName), Infinity)}.` : ""),
        kind: "golden",
        priority: "high",
        destructive: false,
        defaultSelected: true,
      },
    ];
  },

  run(ctx, scenario) {
    return clickEach(ctx, scenario, {
      id: ID,
      controls: ctx.form.controls.filter((c) => !c.isSubmit),
      values: canaryValues(ctx.form, ctx.runToken, "dead"),
    });
  },
};

/**
 * Clicks each control on a freshly loaded page (with `values` typed in first) and reports the ones that do nothing as
 * one finding. Shared by dead-control (the controls in a form) and page-controls (the controls outside every form).
 */
export function clickEach(
  ctx: CheckContext,
  scenario: Scenario,
  options: { id: "dead-control" | "page-controls"; controls: FormControl[]; values: FieldValue[] },
) {
  const { id, controls, values } = options;
  return guarded(id, scenario, ctx, async (started) => {
      const { page, capture } = await ctx.openPage();
      const make = findingFactory(id, "broken-feature", scenario);
      const findings = [];
      const notes: string[] = [];
      const dead: { control: FormControl; name: string; shots: Evidence[] }[] = [];

      for (const control of controls) {
        const name = controlName(control);
        if (isDestructiveControl(control) && !ctx.allowDestructive) {
          notes.push(`"${name}": skipped (looks destructive; run again with --allow-destructive to include it)`);
          continue;
        }
        ctx.step(`Clicking "${name}" and watching for a reaction`, page);
        const { reaction, skipped } = await probe(page, capture, ctx.targetUrl, control, values);
        if (skipped) {
          notes.push(`"${name}": skipped (${skipped})`);
          continue;
        }
        if (reaction) {
          notes.push(`"${name}": ${reaction}`);
          continue;
        }
        notes.push(`"${name}": no reaction`);
        ctx.step(`"${name}" did nothing; recording the click as evidence`, page);
        const shots = await recordDeadClick(ctx, page, capture, control, values).catch(() => []);
        dead.push({ control, name, shots });
      }

      if (dead.length > 0) {
        // One problem, however many buttons it affects: one finding naming every dead control.
        const many = dead.length > 1;
        const first = dead[0]!;
        const quoted = dead.map((d) => `"${d.name}"`).join(", ");
        /** Spec lines that click one control and expect some reaction. */
        const probeLines = (control: FormControl, name: string) => [
          `{`,
          `  const control = ${controlLocator(control)};`,
          `  const requests: string[] = [];`,
          `  page.on("request", (r) => requests.push(r.url()));`,
          `  const before = await snapshot();`,
          `  await page.evaluate(() => { (window as unknown as { focusBefore: Element | null }).focusBefore = document.activeElement; });`,
          `  await control.click();`,
          `  await page.waitForTimeout(${REACTION_MS});`,
          `  const after = await snapshot();`,
          `  const focusMoved = await control.evaluate((c) => { const a = document.activeElement; return !!a && a !== c && a !== document.body && a !== (window as unknown as { focusBefore: Element | null }).focusBefore; });`,
          `  expect(after !== before || requests.length > 0 || focusMoved, ${JSON.stringify(`"${name}" should change something`)}).toBe(true);`,
          `}`,
        ];
        findings.push(
          make({
            title: many ? `${dead.length} buttons do nothing (${clip(dead.map((d) => d.name).join(", "), 80)})` : `"${first.name}" button does nothing`,
            severity: "high",
            location: `"${first.name}" button`,
            locations: dead.map((d) => `"${d.name}" button`),
            meaning: many
              ? `Clicking ${quoted} has no visible or hidden effect: nothing is saved, nothing changes on the page, no request is sent and focus does not move. The buttons look like they work but are not connected to anything.`
              : `Clicking "${first.name}" has no visible or hidden effect: nothing is saved, nothing changes on the page, no request is sent and focus does not move. The button looks like it works but is not connected to anything.`,
            impact: many
              ? `People who click these buttons think it worked (or keep clicking) and lose whatever they expected the buttons to do for them.`
              : `People who click "${first.name}" think it worked (or keep clicking) and lose whatever they expected it to do for them.`,
            fix: many
              ? `Ask your AI or developer: "These buttons have no working click handler: ${dead.map((d) => `${d.name} (${d.control.selector})`).join(", ")}. Connect each to its intended action and show a confirmation when it succeeds."`
              : `Ask your AI or developer: "The ${first.name} button (${first.control.selector}) has no working click handler. Connect it to the intended action and show a confirmation when it succeeds."`,
            evidence: [
              ...dead.slice(0, 6).flatMap((d) => d.shots),
              evidence(
                "dom",
                many ? `Clicked ${dead.length} controls and watched each for ${REACTION_MS} ms` : `Clicked "${first.name}" and watched for ${REACTION_MS} ms`,
                {
                  controls: dead.map((d) => ({ name: d.name, role: d.control.role, tag: d.control.tag, selector: d.control.selector })),
                  observed: "no request, navigation, DOM change, storage change, value change or focus change",
                },
              ),
            ],
            spec: {
              name: many ? "every-button-does-something" : `${first.name}-does-something`,
              source: specSource(ctx.targetUrl, many ? "every button does something" : `clicking "${first.name}" does something`, [
                ...fillLines(values),
                `// The same reactions Run Hound looks for: DOM, storage, URL, field values, a request, or focus moving elsewhere.`,
                `const snapshot = () =>`,
                `  page.evaluate(() =>`,
                `    JSON.stringify([`,
                `      document.body.innerHTML,`,
                `      { ...localStorage },`,
                `      { ...sessionStorage },`,
                `      location.href,`,
                `      [...document.querySelectorAll("input, select, textarea")].map((e) => { const i = e as HTMLInputElement; return i.type === "checkbox" || i.type === "radio" ? i.checked : i.value; }),`,
                `    ]),`,
                `  );`,
                ...dead.flatMap((d) => probeLines(d.control, d.name)),
              ]),
            },
          }),
        );
      }
      return result(id, scenario, started, findings, notes.join("; "));
    });
}
