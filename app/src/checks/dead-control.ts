/**
 * dead-control: click every non-submit control in the form (on a freshly loaded, filled-in page) and fail
 * when a click causes no request, DOM change, navigation, storage change, value change or focus change. A control an
 * invisible element covers (a leftover backdrop) can't be clicked at all, which is reported too; one a visible element
 * covers (a cookie banner) is skipped with the reason, and a scenario in which no control could be tried is skipped.
 */
import type { Page } from "playwright";
import type { Check, CheckContext, DiscoveredForm, Evidence, FormControl, Scenario } from "../core/types.js";
import { openForm } from "../engine/open-form.js";
import { clip, controlLocator, evidence, fillLines, findingFactory, guarded, recordFlow, result, specSource } from "./lib/functional-finding.js";
import { listOf } from "./lib/a11y-common.js";
import { canaryValues, controlName, fillForm, settle, sleep, waitFor, type FieldValue } from "./lib/functional-form.js";

const ID = "dead-control" as const;

/** How long a control gets to react (covers short animations and debounced handlers). */
const REACTION_MS = 1500;

/**
 * Time allowed per control clicked (Check.timeLimitMs): a fresh page load with up to 5 s of waiting for the network to
 * settle, the click and REACTION_MS of watching, and a recording (another load) when it does nothing. About 6.5 s, or
 * 14 s with a recording, on a page that never goes quiet; the rest is headroom for a busy machine.
 */
export const PER_CONTROL_MS = 15_000;

/** The time limit for clicking `count` controls one by one, each on a fresh page: a minute to start, then per control. */
export function clickingTimeLimitMs(count: number): number {
  return 60_000 + count * PER_CONTROL_MS;
}

/**
 * Controls whose name says they destroy, pay for, order or send something, or change an account for good. Clicking
 * those is not a golden-path action, so they are only activated with --allow-destructive. Single words are matched as
 * whole words; words that also name everyday controls ("order", "subscribe", "leave", "clear", "drop", "restart",
 * "block") only count with the object that makes them risky ("Place order", "Subscribe to Pro", "Leave team").
 */
const DESTRUCTIVE_NAME = new RegExp(
  "\\b(" +
    [
      "delete|remove|destroy|erase|wipe|purge|revoke|deactivate|unsubscribe|archive|discard|trash|void",
      "pay|payments?|payouts?|paypal|purchase|buy|check\\s?-?out|charge|refund|transfer|withdraw|donate|upgrade|downgrade",
      "invite|publish|deploy",
      "ban|kick|suspend|terminate|kill|reboot|truncate|shut\\s?-?down|power\\s?-?off|factory\\s+reset",
      "(place|submit|confirm|complete|finali[sz]e)\\s+(my\\s+|the\\s+|your\\s+)?order|order\\s+now",
      "move\\s+to\\s+(the\\s+)?(trash|bin)",
      "subscribe\\s+(to\\s+)?(the\\s+)?(pro|premium|plus|paid|business|team|enterprise|annual|monthly|yearly)",
      "clear\\s+(the\\s+|my\\s+)?(cart|basket|history|data|cache|messages|chat|conversation|database|storage|queue)",
      "leave\\s+(the\\s+|this\\s+)?(team|group|workspace|organi[sz]ation|org|project|channel|server|community|household|family)",
      "block\\s+(this\\s+)?(user|account|member|contact|sender|number|person)",
      "restart\\s+(the\\s+)?(server|instance|service|machine|database|db|container|cluster|node|vm)",
      "drop\\s+(the\\s+)?(table|database|db|collection|schema|index)",
      "(regenerate|rotate|reset)\\s+(the\\s+|your\\s+)?(api\\s+)?(keys?|secrets?|tokens?)",
    ].join("|") +
    ")\\b",
  "i",
);

/**
 * Controls that send something to someone (an e-mail, an invoice, a reminder). Destructive except on the form's own
 * submit button: "Send message" on a contact form is the save every functional check submits anyway, while a "Send"
 * next to an invoice e-mails a real customer.
 */
const SENDING_NAME = /\b(re-?send|send|notify|broadcast|e-?mail\s+(the\s+)?(invoices?|receipts?|reports?|customers?|clients?|quotes?|statements?))\b/i;

/**
 * Controls that end the session or undo account-level state. Clicking "Sign out" in a header would leave every later
 * scenario testing a signed-out page, so these are treated as destructive too.
 */
const SESSION_ENDING_NAME =
  /\b(log\s?-?out|sign\s?-?out|logoff|log\s+off|disconnect|unlink|clear\s+all|empty\s+(the\s+)?(cart|basket|trash|bin)|reset\s+(all|everything|data|account|settings)|cancel\s+(my\s+|the\s+)?(subscription|plan|order|booking|membership|account|reservation)|close\s+(my\s+)?account)\b/i;

/** Words in an unnamed icon button's own id, test id or icon that say what it does. */
const DESTRUCTIVE_HINT = /\b(delete|remove|trash|destroy|erase|discard|bin)\b/i;

/** "deleteRow", "trash-btn_3", "lucide-trash-2" → "delete row", "trash btn 3", "lucide trash 2". */
function hintWords(text: string): string {
  return text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([a-zA-Z])(\d)/g, "$1 $2")
    .replace(/[-_:./#"'=[\]]+/g, " ");
}

/**
 * The identifier in a selector that names the control itself (#id, a test id or name attribute), or null for a path
 * (anchored at an ancestor's id, it says nothing about the control).
 */
function ownIdentifier(selector: string): string | null {
  const own = /^#([\w-]+)$/.exec(selector) ?? /^\w*\[(?:data-testid|data-test|data-cy|data-qa|name)="([^"]+)"\]$/.exec(selector);
  return own ? own[1]! : null;
}

/**
 * True when clicking this control could change or destroy data beyond creating a test record, send something to
 * someone, or end the session. An unnamed control (an icon button) is judged by its own id or test id.
 */
export function isDestructiveControl(control: FormControl): boolean {
  const name = `${control.accessibleName ?? ""} ${control.text}`;
  if (DESTRUCTIVE_NAME.test(name) || SESSION_ENDING_NAME.test(name)) return true;
  if (!control.isSubmit && SENDING_NAME.test(name)) return true;
  if (name.trim() === "") {
    const id = ownIdentifier(control.selector);
    if (id && DESTRUCTIVE_HINT.test(hintWords(id))) return true;
  }
  return false;
}

/**
 * For an unnamed control: the word in its icon, id, test id or title that says it deletes something ("trash" from
 * lucide-trash-2, "delete" from MUI's DeleteIcon), or null. Discovery only knows the control's selector, so the icon
 * is read from the page just before clicking.
 */
const ICON_HINT_SCRIPT = `(sel) => {
  const el = document.querySelector(sel);
  if (!el) return "";
  const parts = [];
  for (const node of [el, ...Array.from(el.querySelectorAll("*")).slice(0, 30)]) {
    for (const attr of ["class", "id", "data-testid", "data-test", "data-icon", "data-lucide", "name", "title", "href", "xlink:href"]) {
      const v = node.getAttribute(attr);
      if (v) parts.push(v);
    }
    if (node.tagName.toLowerCase() === "title") parts.push(node.textContent || "");
  }
  return parts.join(" ");
}`;

export async function destructiveIconHint(page: Page, selector: string): Promise<string | null> {
  const text = String((await page.evaluate(`(${ICON_HINT_SCRIPT})(${JSON.stringify(selector)})`).catch(() => "")) ?? "");
  const hit = DESTRUCTIVE_HINT.exec(hintWords(text));
  return hit ? hit[1]!.toLowerCase() : null;
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

type Reaction = "request" | "navigation" | "new tab" | "DOM change" | "storage change" | "value change" | "focus change";

async function state(page: Page): Promise<PageState | null> {
  return (await page.evaluate(STATE_SCRIPT).catch(() => null)) as PageState | null;
}

/**
 * Facts about the control needed before clicking it: whether it is a radio, option or tab that is already selected
 * (choosing it again rightly changes nothing), and a selector for the label a user would click instead when the
 * control itself is hidden under it (shadcn "radio cards": an sr-only radio covered by its styled label).
 */
const BEFORE_CLICK_SCRIPT = `(sel) => {
  const el = document.querySelector(sel);
  if (!el) return { selected: false, label: null };
  const role = el.getAttribute("role") || (el.matches("input[type=radio]") ? "radio" : "");
  const selected = ["radio", "menuitemradio", "option", "tab"].includes(role) &&
    (el.getAttribute("aria-checked") === "true" || el.getAttribute("aria-selected") === "true" || el.checked === true);
  let label = null;
  if (el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]')) label = 'label[for="' + CSS.escape(el.id) + '"]';
  return { selected, label };
}`;

/** Plain words for why Playwright could not click a control, for the scenario's notes. */
function clickProblem(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const cover = /<(\w+)[^>]*>[^\n]*?intercepts pointer events/.exec(message);
  if (cover) return `could not be clicked: a <${cover[1]!.toLowerCase()}> is on top of it`;
  if (/outside of the viewport/i.test(message)) return "could not be clicked: it is outside the page";
  if (/not stable/i.test(message)) return "could not be clicked: it kept moving";
  return "could not be clicked within 5 s";
}

/**
 * Clicks the control like a user: the control itself, or, when something else (its own label) is on top of it, that
 * label. Returns null when clicked, else why it could not be clicked. Nothing is clicked when both fail, so the page
 * is unchanged.
 */
async function clickLikeAUser(page: Page, control: FormControl, label: string | null): Promise<string | null> {
  const locator = page.locator(control.selector).first();
  try {
    // A trial click checks that the control can take a click (visible, stable, not covered) without clicking it.
    await locator.click({ trial: true, timeout: 2000 });
  } catch (err) {
    if (!label) return clickProblem(err);
    try {
      await page.locator(label).first().click({ timeout: 2000 });
      return null;
    } catch {
      return clickProblem(err);
    }
  }
  try {
    await locator.click({ timeout: 5000 });
    return null;
  } catch (err) {
    return clickProblem(err);
  }
}

/**
 * What a click on the control's centre lands on when something other than the control (or its own label) is on top
 * there: that element, as "<div class="ghost">", and whether anything of it can be seen there (a background, a border,
 * a shadow, text or an image, not fully transparent) along the chain up to the nearest ancestor that also holds the
 * control. Null when nothing covers the centre, or the control is not on screen.
 */
const COVER_SCRIPT = `(sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  if (r.width === 0 || r.height === 0 || x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return null;
  const top = document.elementFromPoint(x, y);
  if (!top || el.contains(top) || top.contains(el)) return null;
  if (el.labels && Array.from(el.labels).some((l) => l.contains(top))) return null;
  // Alpha of a computed colour: rgb(), rgba(), and the "/ alpha" form of oklch(), color() and the like.
  const alpha = (c) => {
    if (!c || c === "transparent") return 0;
    const m = /\\((.*)\\)/.exec(c);
    if (!m) return 1;
    const slash = m[1].split("/");
    if (slash.length > 1) return parseFloat(slash[1]) * (slash[1].trim().endsWith("%") ? 0.01 : 1);
    const parts = m[1].split(",");
    return parts.length === 4 ? parseFloat(parts[3]) : 1;
  };
  const opacity = (n) => { let o = 1; for (let a = n; a; a = a.parentElement) o *= parseFloat(getComputedStyle(a).opacity) || 0; return o; };
  const painted = (n) => {
    const cs = getComputedStyle(n);
    if (alpha(cs.backgroundColor) > 0.02 || cs.backgroundImage !== "none" || cs.boxShadow !== "none") return true;
    if (cs.backdropFilter && cs.backdropFilter !== "none") return true;
    if (Array.from(n.childNodes).some((c) => c.nodeType === 3 && c.textContent.trim() !== "")) return true;
    if (n.matches("img, svg, video, canvas, iframe, input, textarea, select, button")) return true;
    return ["top", "right", "bottom", "left"].some((side) =>
      parseFloat(cs.getPropertyValue("border-" + side + "-width")) > 0 &&
      cs.getPropertyValue("border-" + side + "-style") !== "none" &&
      alpha(cs.getPropertyValue("border-" + side + "-color")) > 0.02);
  };
  let seen = false;
  for (let a = top; a && !a.contains(el); a = a.parentElement) {
    if (painted(a) && opacity(a) > 0.02) { seen = true; break; }
  }
  const cls = typeof top.className === "string" ? top.className.trim().split(/\\s+/)[0] : "";
  const what = "<" + top.tagName.toLowerCase() + (top.id ? ' id="' + top.id + '"' : cls ? ' class="' + cls + '"' : "") + ">";
  return { what, invisible: !seen };
}`;

/** The element covering the control, when it can't be seen: a click lands on it and nobody can tell why. */
async function invisibleCover(page: Page, selector: string): Promise<string | null> {
  const cover = (await page.evaluate(`(${COVER_SCRIPT})(${JSON.stringify(selector)})`).catch(() => null)) as { what: string; invisible: boolean } | null;
  return cover?.invisible ? cover.what : null;
}

/**
 * Clicks one control on a fresh page and reports what it did, or null when it did nothing. `form` is the form the
 * control belongs to: when it is in a dialog (an opener), the dialog is opened first on the fresh page. `covered`
 * names the invisible element on top of a control that could not be clicked.
 */
async function probe(
  page: Page,
  capture: { requests: unknown[] },
  target: string,
  control: FormControl,
  values: FieldValue[],
  allowDestructive: boolean,
  form?: DiscoveredForm,
): Promise<{ reaction: Reaction | null; skipped?: string; covered?: string }> {
  await page.goto(target, { waitUntil: "load" });
  await settle(page);
  if (form) await openForm(page, form);
  await fillForm(page, values);

  const locator = page.locator(control.selector).first();
  if (!(await locator.isVisible().catch(() => false))) return { reaction: null, skipped: "not visible" };
  if (await locator.isDisabled().catch(() => false)) return { reaction: null, skipped: "disabled" };
  if (!allowDestructive && `${control.accessibleName ?? ""}${control.text}`.trim() === "") {
    const hint = await destructiveIconHint(page, control.selector);
    if (hint) return { reaction: null, skipped: `looks destructive: its icon or id says "${hint}"; run again with --allow-destructive to include it` };
  }
  const facts = ((await page.evaluate(`(${BEFORE_CLICK_SCRIPT})(${JSON.stringify(control.selector)})`).catch(() => null)) ?? { selected: false, label: null }) as {
    selected: boolean;
    label: string | null;
  };
  if (facts.selected) return { reaction: null, skipped: "already selected, so choosing it again changes nothing" };

  let navigated = false;
  const onNav = (frame: { parentFrame(): unknown }) => {
    if (!frame.parentFrame()) navigated = true;
  };
  // A link with target=_blank or a window.open() button opens a new tab and leaves this page as it was.
  const opened: Page[] = [];
  const onPage = (p: Page) => void opened.push(p);
  page.on("framenavigated", onNav);
  page.context().on("page", onPage);
  try {
    await page.evaluate(ARM_SCRIPT.replace("__SELECTOR__", JSON.stringify(control.selector)));
    const before = await state(page);
    const requestsBefore = capture.requests.length;
    const urlBefore = page.url();
    const problem = await clickLikeAUser(page, control, facts.label);
    if (problem) {
      const covered = await invisibleCover(page, control.selector);
      return covered ? { reaction: null, covered } : { reaction: null, skipped: problem };
    }

    let reaction: Reaction | null = null;
    await waitFor(async () => {
      if (navigated || page.url() !== urlBefore) reaction = "navigation";
      else if (opened.length > 0) reaction = "new tab";
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
    page.context().off("page", onPage);
    await Promise.all(opened.map((p) => p.close().catch(() => undefined)));
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
  form?: DiscoveredForm,
): Promise<Evidence[]> {
  const name = controlName(control);
  await page.goto(ctx.targetUrl, { waitUntil: "load" });
  await settle(page);
  if (form) await openForm(page, form);
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
  const label = ((await page.evaluate(`(${BEFORE_CLICK_SCRIPT})(${JSON.stringify(control.selector)})`).catch(() => null)) as { label: string | null } | null)?.label ?? null;
  const problem = await clickLikeAUser(page, control, label);
  if (problem) throw new Error(problem);
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

/**
 * Shows a control an invisible element covers: the filled form with the control, then the element a click lands on.
 * Nothing is clicked.
 */
async function recordCoveredControl(
  ctx: CheckContext,
  page: Page,
  control: FormControl,
  values: FieldValue[],
  cover: string,
  form?: DiscoveredForm,
): Promise<Evidence[]> {
  const name = controlName(control);
  await page.goto(ctx.targetUrl, { waitUntil: "load" });
  await settle(page);
  if (form) await openForm(page, form);
  await fillForm(page, values);
  const flow = recordFlow(ctx, page, `${name} can't be clicked`);
  await flow.step(`"${name}" on the page`, {
    highlights: [{ selector: control.selector, label: `"${name}" looks ready to click`, tone: "info" }],
    caption: `"${name}" is visible and enabled.`,
    facts: [{ label: "Control", value: `"${name}" ${control.role === "button" ? "button" : `<${control.tag}>`}` }],
  });
  // Point at what is on top of the control's centre.
  const marked = (await page
    .evaluate(
      `((sel) => { const el = document.querySelector(sel); if (!el) return false; const r = el.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); if (!top || el.contains(top)) return false; top.setAttribute("data-rh-cover", ""); return true; })(${JSON.stringify(control.selector)})`,
    )
    .catch(() => false)) as boolean;
  await flow.step(`What a click on "${name}" lands on`, {
    highlights: [
      { selector: control.selector, label: `"${name}": clicks never reach it` },
      ...(marked ? [{ selector: "[data-rh-cover]", label: `Invisible ${cover} on top` }] : []),
    ],
    caption: `An invisible ${cover} lies on top of "${name}": a click lands on it, not on the button.`,
    facts: [
      { label: "On top of the control", value: cover },
      { label: "Visible", value: "no (nothing painted there: no background, border, shadow, text or image)" },
    ],
  });
  return flow.finish(`${name} can't be clicked`);
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
          " a request, a page change, navigation (or a new tab), a storage change or a focus change. The submit button is never clicked; a button that saves something (a draft, for example) may create test records." +
          (risky.length > 0 ? ` Left out unless you allow destructive scenarios: ${listOf(risky.map(controlName), Infinity)}.` : ""),
        kind: "golden",
        priority: "high",
        destructive: false,
        defaultSelected: true,
      },
    ];
  },

  timeLimitMs: (_scenario, form) => clickingTimeLimitMs(form.controls.filter((c) => !c.isSubmit).length),

  run(ctx, scenario) {
    return clickEach(ctx, scenario, {
      id: ID,
      controls: ctx.form.controls.filter((c) => !c.isSubmit),
      values: canaryValues(ctx.form, ctx.runToken, "dead"),
      form: ctx.form,
    });
  },
};

/**
 * Clicks each control on a freshly loaded page (with `values` typed in first) and reports the ones that do nothing as
 * one finding. Shared by dead-control (the controls in a form) and page-controls (the controls outside every form).
 * `form` is the form the controls belong to (dead-control): a form in a dialog is opened on every fresh page.
 */
export function clickEach(
  ctx: CheckContext,
  scenario: Scenario,
  options: { id: "dead-control" | "page-controls"; controls: FormControl[]; values: FieldValue[]; form?: DiscoveredForm },
) {
  const { id, controls, values, form } = options;
  return guarded(id, scenario, ctx, async (started) => {
      const { page, capture } = await ctx.openPage();
      const make = findingFactory(id, "broken-feature", scenario);
      const findings = [];
      const notes: string[] = [];
      const dead: { control: FormControl; name: string; shots: Evidence[] }[] = [];
      const covered: { control: FormControl; name: string; cover: string; shots: Evidence[] }[] = [];
      /** Controls clicked (or found covered): with none, the scenario tested nothing. */
      let tried = 0;

      for (const control of controls) {
        const name = controlName(control);
        if (isDestructiveControl(control) && !ctx.allowDestructive) {
          notes.push(`"${name}": skipped (looks destructive; run again with --allow-destructive to include it)`);
          continue;
        }
        ctx.step(`Clicking "${name}" and watching for a reaction`, page);
        // One control that can't be probed (a page error, a click Playwright refuses) never ends the scenario.
        const { reaction, skipped, covered: cover } = await probe(page, capture, ctx.targetUrl, control, values, ctx.allowDestructive, form).catch(
          (err: unknown): { reaction: null; skipped: string; covered?: string } => ({
            reaction: null,
            skipped: `could not be tested: ${clip(err instanceof Error ? err.message.split("\n")[0]! : String(err), 100)}`,
          }),
        );
        if (skipped) {
          notes.push(`"${name}": skipped (${skipped})`);
          continue;
        }
        tried++;
        if (cover) {
          notes.push(`"${name}": can't be clicked (an invisible ${cover} is on top of it)`);
          const record = dead.length + covered.length < 6;
          if (record) ctx.step(`"${name}" is covered; recording what a click lands on`, page);
          const shots = record ? await recordCoveredControl(ctx, page, control, values, cover, form).catch(() => []) : [];
          covered.push({ control, name, cover, shots });
          continue;
        }
        if (reaction) {
          notes.push(`"${name}": ${reaction}`);
          continue;
        }
        notes.push(`"${name}": no reaction`);
        // The findings show the first 6 recordings; recording more would only cost time.
        const record = dead.length + covered.length < 6;
        if (record) ctx.step(`"${name}" did nothing; recording the click as evidence`, page);
        const shots = record ? await recordDeadClick(ctx, page, capture, control, values, form).catch(() => []) : [];
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
          `  // Let the page finish loading first, so its own loading isn't mistaken for the click's effect.`,
          `  await page.waitForLoadState("networkidle");`,
          `  await control.waitFor();`,
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
              ], form),
            },
          }),
        );
      }
      if (covered.length > 0) {
        // One problem, however many controls it hides: one finding naming every covered control.
        const many = covered.length > 1;
        const first = covered[0]!;
        const quoted = covered.map((c) => `"${c.name}"`).join(", ");
        const covers = [...new Set(covered.map((c) => c.cover))];
        const coverWords = covers.length === 1 ? `An invisible ${covers[0]}` : "Invisible elements";
        findings.push(
          make({
            title: many ? `${covered.length} buttons can't be clicked (${clip(covered.map((c) => c.name).join(", "), 80)})` : `"${first.name}" button can't be clicked`,
            severity: "high",
            location: `"${first.name}" button`,
            locations: covered.map((c) => `"${c.name}" button`),
            meaning: `${coverWords} ${covers.length === 1 ? "lies" : "lie"} on top of ${quoted}, so a click or a tap lands on ${covers.length === 1 ? "it" : "them"} instead. ${many ? "The buttons look" : "The button looks"} ready to use, but nothing happens when people click, and nothing on screen shows why. This is often a backdrop or overlay left behind after a dialog, menu or toast closed.`,
            impact: many
              ? `People can't use what these buttons do with a mouse or a finger. Keyboard users may still reach them, so it is easy to miss when testing by hand.`
              : `People can't use what "${first.name}" does with a mouse or a finger. Keyboard users may still reach it, so it is easy to miss when testing by hand.`,
            fix: `Ask your AI or developer: "${covered.map((c) => `The ${c.name} button (${c.control.selector}) is covered by an invisible ${c.cover}`).join("; ")}. Clicks never reach ${many ? "them" : "it"}. Remove the leftover overlay, or give it pointer-events: none while it is not in use."`,
            evidence: [
              ...covered.slice(0, 6).flatMap((c) => c.shots),
              evidence(
                "dom",
                many ? `${covered.length} controls covered by an invisible element` : `"${first.name}" covered by an invisible element`,
                {
                  controls: covered.map((c) => ({ name: c.name, role: c.control.role, tag: c.control.tag, selector: c.control.selector, coveredBy: c.cover })),
                  observed: "Playwright could not click the control: another element receives the click at its centre, and nothing of that element is visible there",
                },
              ),
            ],
            spec: {
              name: many ? "every-button-can-be-clicked" : `${first.name}-can-be-clicked`,
              source: specSource(ctx.targetUrl, many ? "every button can be clicked" : `"${first.name}" can be clicked`, [
                ...fillLines(values),
                `// A trial click checks that the control would receive the click, without clicking it: it fails while something covers it.`,
                ...covered.map((c) => `await ${controlLocator(c.control)}.click({ trial: true, timeout: 5_000 });`),
              ], form),
            },
          }),
        );
      }
      if (findings.length === 0 && tried === 0 && controls.length > 0) {
        // Every control was left out or could not be clicked: a pass would claim something that was never tried.
        return { ...result(id, scenario, started, []), status: "skipped", notes: `Skipped: no control was clicked, so nothing was tested. ${notes.join("; ")}` };
      }
      return result(id, scenario, started, findings, notes.join("; "));
    });
}
