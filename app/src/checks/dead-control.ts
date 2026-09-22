/**
 * dead-control: click every non-submit control in the form (on a freshly loaded, filled-in page) and fail
 * when a click causes no request, DOM change, navigation, storage change, value change or focus change.
 */
import type { Page } from "playwright";
import type { Check, FormControl, Scenario } from "../core/types.js";
import { controlLocator, evidence, fillLines, findingFactory, guarded, result, specSource, tryScreenshot } from "./lib/functional-finding.js";
import { canaryValues, controlName, fillForm, settle, waitFor, type FieldValue } from "./lib/functional-form.js";

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
          `Click each of ${safe.map((c) => `"${controlName(c)}"`).join(", ")} and check that it causes a request, a page change, navigation, a storage change or a focus change. The submit button is never clicked.` +
          (risky.length > 0
            ? ` Left out unless you allow destructive scenarios: ${risky.map((c) => `"${controlName(c)}"`).join(", ")}.`
            : ""),
        kind: "golden",
        priority: "high",
        destructive: false,
        defaultSelected: true,
      },
    ];
  },

  run(ctx, scenario) {
    return guarded(ID, scenario, ctx, async (started) => {
      const controls = ctx.form.controls.filter((c) => !c.isSubmit);
      const values = canaryValues(ctx.form, ctx.runToken, "dead");
      const { page, capture } = await ctx.openPage();
      const make = findingFactory(ID, "broken-feature", scenario);
      const findings = [];
      const notes: string[] = [];

      for (const control of controls) {
        const name = controlName(control);
        if (isDestructiveControl(control) && !ctx.allowDestructive) {
          notes.push(`"${name}": skipped (looks destructive; run again with --allow-destructive to include it)`);
          continue;
        }
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
        const shots = await tryScreenshot(ctx, page, `after clicking ${name}`);
        const locator = controlLocator(control);
        findings.push(
          make({
            title: `"${name}" button does nothing`,
            severity: "high",
            location: `"${name}" button`,
            meaning: `Clicking "${name}" has no visible or hidden effect: nothing is saved, nothing changes on the page, no request is sent and focus does not move. The button looks like it works but is not connected to anything.`,
            impact: `People who click "${name}" think it worked (or keep clicking) and lose whatever they expected it to do for them.`,
            fix: `Ask your AI or developer: "The ${name} button (${control.selector}) has no working click handler. Connect it to the intended action and show a confirmation when it succeeds."`,
            evidence: [
              evidence("dom", `Clicked "${name}" and watched for ${REACTION_MS} ms`, {
                control: { name, role: control.role, tag: control.tag, selector: control.selector },
                observed: "no request, navigation, DOM change, storage change, value change or focus change",
              }),
              ...shots,
            ],
            spec: {
              name: `${name}-does-something`,
              source: specSource(ctx.targetUrl, `clicking "${name}" does something`, [
                ...fillLines(values),
                `const snapshot = () => page.evaluate(() => JSON.stringify([document.body.innerHTML, { ...localStorage }, { ...sessionStorage }, location.href]));`,
                `const requests: string[] = [];`,
                `page.on("request", (r) => requests.push(r.url()));`,
                `const before = await snapshot();`,
                `await ${locator}.click();`,
                `await page.waitForTimeout(${REACTION_MS});`,
                `const after = await snapshot();`,
                `expect(after !== before || requests.length > 0, ${JSON.stringify(`"${name}" should change something`)}).toBe(true);`,
              ]),
            },
          }),
        );
      }
      return result(ID, scenario, started, findings, notes.join("; "));
    });
  },
};
