/**
 * Setting the value of any discovered field, native or not (0.4.0). Both fill paths (a11y-form.ts fillValid and
 * functional-form.ts fillForm) and the AI flow runner go through setField, so a Radix Select, a cmdk combobox, a
 * Radix Checkbox/Switch/RadioGroup or a slider is filled the same way everywhere. setFieldSpec writes the same steps
 * as Playwright source for exported specs, and fieldLocator is the one role/label locator those specs use.
 *
 * The fill policy helpers (fieldKind, firstChoice, hasEmptyChoice, isConsentCheckbox) live here too, so every check
 * agrees on what a field is and which choice is a real one.
 */
import type { Locator, Page } from "playwright";
import type { FormField } from "../../core/types.js";

/**
 * What to set: text for text-like fields and comboboxes; an option label for selects and radio groups ("first" = the
 * first real option); true/false for checkboxes and switches; a number for sliders (clamped to the slider's range).
 */
export type FieldSetting = { text: string } | { option: string | "first" } | { checked: boolean } | { number: number };

/**
 * How a field is set: "text" (typed), "select" (a native <select> or a widget that opens a list), "combobox" (a text
 * input with suggestions), "radio" (one option of a group), "custom" (clickable options, no ARIA widget), "check"
 * (checkbox or switch), "slider", or "none" (file and hidden inputs, and option fields without options).
 */
export type FieldKind = "text" | "select" | "combobox" | "radio" | "custom" | "check" | "slider" | "none";

/** How long setField may take before it gives up on a field. */
export const SET_FIELD_TIMEOUT_MS = 5_000;

const q = (s: string) => JSON.stringify(s);
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const lower = (s: string | null | undefined) => norm(s).toLowerCase();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The user-facing name of a field, for messages. */
function nameOf(field: FormField): string {
  return field.accessibleName ?? field.label ?? field.placeholder ?? field.key;
}

export function fieldKind(field: FormField): FieldKind {
  switch (field.widget) {
    case "aria-select":
      return "select";
    case "aria-combobox":
      return "combobox";
    case "aria-radio":
      return "radio";
    case "aria-checkbox":
    case "aria-switch":
      return "check";
    case "aria-slider":
      return "slider";
    default:
      break;
  }
  const hasOptions = (field.options?.length ?? 0) > 0;
  if (field.type === "file" || field.type === "hidden") return "none";
  if (field.type === "checkbox") return "check";
  if (field.type === "radio") return hasOptions ? "radio" : "none";
  if (field.type === "select" || field.type === "select-one" || field.type === "select-multiple") return "select";
  if (field.type === "custom") return hasOptions ? "custom" : "none";
  if (hasOptions) return field.role === "combobox" || field.role === "listbox" ? "select" : "custom";
  return "text";
}

/** Option labels that mean "nothing chosen": a placeholder ("Select…", "Choose a plan") or an explicit "None". */
const EMPTY_CHOICE = /^(?:|none|no preference|any|anyone|n\/?a|not sure|unspecified|prefer not to say|[-–—]+|(?:select|choose|pick)\b.*)$/i;

/** True when one of the field's options means "nothing chosen", so the choice is optional unless marked required. */
export function hasEmptyChoice(field: FormField): boolean {
  return (field.options ?? []).some((o) => EMPTY_CHOICE.test(norm(o.label)));
}

/** The first real option: the first that doesn't mean "nothing chosen" (else the first). Undefined without options. */
export function firstChoice(field: FormField): { label: string; selector: string } | undefined {
  const options = field.options ?? [];
  return options.find((o) => !EMPTY_CHOICE.test(norm(o.label))) ?? options[0];
}

const CONSENT = /\b(?:terms|conditions|agree|accept|consent|privacy|policy|acknowledge|i (?:have read|understand|confirm)|gdpr|eula)\b/i;

/** A checkbox a form usually won't submit without: accepting terms, a privacy policy, giving consent. Never a switch. */
export function isConsentCheckbox(field: FormField): boolean {
  if (fieldKind(field) !== "check" || field.widget === "aria-switch" || field.role === "switch") return false;
  return CONSENT.test(`${field.accessibleName ?? ""} ${field.label ?? ""} ${field.key}`);
}

/**
 * `s` lower-cased with every space removed. An option drawn on two lines (a name over a role) reads as "Alex
 * RiveraStudio lead" in its text but "Alex Rivera Studio lead" on screen; both squash to the same key.
 */
const squash = (s: string | null | undefined) => lower(s).replace(/\s+/g, "");

/** The option of `field` whose label matches `wanted`: exactly, then ignoring case and spacing, then ignoring spaces. */
function matchOption(field: FormField, wanted: string): { label: string; selector: string } | undefined {
  const options = field.options ?? [];
  const exact = options.find((o) => o.label === wanted) ?? options.find((o) => lower(o.label) === lower(wanted));
  if (exact) return exact;
  const squashed = options.filter((o) => squash(o.label) === squash(wanted));
  return squashed.length === 1 ? squashed[0] : undefined;
}

/**
 * Index of the text that matches `wanted` (exact, then a unique prefix, then a unique substring, then a unique match
 * ignoring spaces), or -1.
 */
function pickIndex(texts: string[], wanted: string): number {
  const keys = texts.map(lower);
  const w = lower(wanted);
  const exact = keys.indexOf(w);
  if (exact >= 0 || !w) return exact;
  for (const test of [(k: string) => k.startsWith(w), (k: string) => k.includes(w)]) {
    const hits = keys.flatMap((k, i) => (test(k) ? [i] : []));
    if (hits.length === 1) return hits[0]!;
  }
  const hits = texts.flatMap((t, i) => (squash(t) === squash(wanted) ? [i] : []));
  return hits.length === 1 ? hits[0]! : -1;
}

/**
 * True when `text` (a trigger's or an input's visible text) shows `label` as a whole: equal, or standing on its own
 * ("Team size: 1–5"), never inside a longer value ("21–50" doesn't show "1–5"). Case and spacing are ignored.
 */
export function showsLabel(text: string, label: string): boolean {
  const t = lower(text);
  const l = lower(label);
  if (!l) return false;
  for (let at = t.indexOf(l); at >= 0; at = t.indexOf(l, at + 1)) {
    const before = t[at - 1] ?? "";
    const after = t[at + l.length] ?? "";
    if (!/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after)) return true;
  }
  return false;
}

/** Reads yes/no text: "no", "false", "off", "unchecked", "0" or nothing mean no; any other text means yes. */
export function meansYes(text: string): boolean {
  return !/^(?:false|no|n|off|unchecked|0|)$/i.test(text.trim());
}

/**
 * The setting in the form the field's kind takes: text on a picker is an option label, text on a checkbox is yes/no,
 * text on a slider is a number. Returns a plain reason ("it is a slider, …") when the setting can't apply.
 */
function adapt(field: FormField, kind: FieldKind, setting: FieldSetting): FieldSetting | string {
  const asText = "text" in setting ? setting.text : "option" in setting ? setting.option : "number" in setting ? String(setting.number) : null;
  switch (kind) {
    case "text":
      if ("checked" in setting) return "it is a text field, which can't be checked";
      if ("option" in setting && setting.option === "first") return "it is a text field, which has no options";
      return { text: asText ?? "" };
    case "combobox":
      if ("checked" in setting) return "it is a text field, which can't be checked";
      return "option" in setting ? setting : { text: asText ?? "" };
    case "select":
    case "radio":
    case "custom":
      if ("checked" in setting) return "it is a choice of options, which can't be checked";
      return "option" in setting ? setting : { option: asText ?? "" };
    case "check":
      if ("checked" in setting) return setting;
      if ("number" in setting) return { checked: setting.number !== 0 };
      return { checked: meansYes(asText ?? "") };
    case "slider": {
      if ("checked" in setting) return "it is a slider, which can't be checked";
      const n = "number" in setting ? setting.number : Number(asText);
      return Number.isFinite(n) && asText !== "" ? { number: n } : `it is a slider, and "${asText ?? ""}" is not a number`;
    }
    case "none":
      return `it is a ${field.type} field, which Run Hound doesn't set`;
  }
}

/** A plain error for a field that couldn't be set: "Couldn't set Team size: it has no option "500+"." */
function failure(field: FormField, why: string): Error {
  return new Error(`Couldn't set ${nameOf(field)}: ${why}.`);
}

/** Why a Playwright action failed, in plain words (never its call log). */
function reason(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/Timeout|timed out/i.test(message)) return "it was not on the page, not visible or not enabled in time";
  return norm(message.split("\n")[0]).replace(/^[\w.]+:\s*/, "") || "the browser refused the action";
}

/** Polls `test` every 100 ms until it is true or `ms` passes. A test that throws counts as false. */
async function until(test: () => Promise<boolean>, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  for (;;) {
    if (await test().catch(() => false)) return true;
    if (Date.now() >= end) return false;
    await sleep(100);
  }
}

/** Time left before `deadline`, at most `cap`, and never 0 (0 means "no timeout" to Playwright). */
function budget(deadline: number, cap = Infinity): number {
  return Math.max(1, Math.min(cap, deadline - Date.now()));
}

/**
 * Clicks a control like a person; when something covers it (a visually hidden radio under its styled label card) the
 * click event is sent to it directly, which is what clicking the covering label does.
 */
async function press(control: Locator, deadline: number): Promise<void> {
  // Something else is under the control's centre (a visually hidden radio under its label card): no point waiting.
  const covered = await control
    .evaluate((el) => {
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      if (r.width === 0 || r.height === 0 || x < 0 || y < 0 || x > innerWidth || y > innerHeight) return false;
      const hit = document.elementFromPoint(x, y);
      return !!hit && hit !== el && !el.contains(hit);
    }, undefined, { timeout: budget(deadline, 1_000) })
    .catch(() => false);
  if (covered) return control.dispatchEvent("click", undefined, { timeout: budget(deadline) });
  try {
    await control.click({ timeout: budget(deadline, 1_500) });
  } catch (err) {
    if ((await control.count().catch(() => 0)) === 0) throw err;
    await control.dispatchEvent("click", undefined, { timeout: budget(deadline) });
  }
}

/** "true", "false" or "mixed": aria-checked, or a native input's checked state. */
async function checkedState(control: Locator, deadline: number): Promise<string> {
  return control.evaluate((el) => el.getAttribute("aria-checked") ?? String((el as HTMLInputElement).checked === true), undefined, { timeout: budget(deadline, 1_000) });
}

const OPTION = '[role=option]:not([aria-disabled="true"])';

/**
 * The visible options of the list `opener` opened: inside the element its aria-controls names when that holds any,
 * else anywhere on the page (lists open in portals at the end of <body>). Waits up to `ms`; null when none showed.
 */
async function openOptions(page: Page, opener: Locator, ms: number): Promise<Locator | null> {
  const end = Date.now() + ms;
  for (;;) {
    const controls = await opener.getAttribute("aria-controls", { timeout: 500 }).catch(() => null);
    const scopes = controls ? [page.locator(`[id=${q(controls)}]`), page.locator(":root")] : [page.locator(":root")];
    for (const scope of scopes) {
      const options = scope.locator(OPTION).filter({ visible: true });
      if ((await options.count().catch(() => 0)) > 0) return options;
    }
    if (Date.now() >= end) return null;
    await sleep(100);
  }
}

/**
 * Closes a list or popover that is still open (Escape, as a person would): one showing options, or the one `opener`
 * says is expanded (a cmdk popover whose search matched nothing shows no option).
 */
async function dismiss(page: Page, opener: Locator): Promise<void> {
  const showing = (await page.locator(OPTION).filter({ visible: true }).count().catch(() => 0)) > 0;
  const expanded = (await opener.getAttribute("aria-expanded", { timeout: 500 }).catch(() => null)) === "true";
  if (showing || expanded) await page.keyboard.press("Escape").catch(() => undefined);
}

/**
 * Picks `wanted` ("first" = the first real one) among the options `opener` shows and clicks it. When the option is not
 * shown but focus moved into a search box (cmdk), the label is typed there first. Returns the clicked option's text.
 */
async function chooseShown(page: Page, field: FormField, opener: Locator, wanted: string, deadline: number): Promise<string> {
  let options = await openOptions(page, opener, budget(deadline, 2_500));
  if (!options) {
    // Many comboboxes and listboxes open with the down arrow rather than a click or typing.
    await opener.press("ArrowDown", { timeout: budget(deadline, 1_000) }).catch(() => undefined);
    options = await openOptions(page, opener, budget(deadline, 1_500));
  }
  if (!options) {
    await dismiss(page, opener);
    throw failure(field, "no options appeared after opening it");
  }
  let texts = (await options.allInnerTexts()).map(norm);
  let index = wanted === "first" ? Math.max(0, texts.findIndex((t) => !EMPTY_CHOICE.test(t))) : pickIndex(texts, wanted);
  if (index < 0) {
    // Only a box that takes typing: a trigger button can itself be a focused [role=combobox].
    const search = page.locator(":is(input, textarea):focus:is([role=combobox], [type=search], [cmdk-input])");
    if ((await search.count().catch(() => 0)) > 0) {
      const typed = await search.first().fill(wanted, { timeout: budget(deadline, 1_000) }).then(
        () => true,
        () => false,
      );
      const filtered = typed ? await openOptions(page, opener, budget(deadline, 1_000)) : null;
      if (filtered) {
        options = filtered;
        texts = (await options.allInnerTexts()).map(norm);
        index = pickIndex(texts, wanted);
      }
    }
  }
  if (index < 0) {
    await dismiss(page, opener);
    const offered = texts.slice(0, 6).map((t) => `"${t}"`).join(", ");
    throw failure(field, `it has no option "${norm(wanted)}" (it offers ${offered || "nothing"}${texts.length > 6 ? ", …" : ""})`);
  }
  await press(options.nth(index), deadline);
  return texts[index]!;
}

/** The label to pick for an option setting: the matching discovered option's own label, or what was asked for. */
function wantedLabel(field: FormField, option: string): string {
  if (option === "first") return firstChoice(field)?.label ?? "first";
  return matchOption(field, option)?.label ?? norm(option);
}

/** A widget that opens a list of options (Radix Select, a Popover + cmdk combobox, Headless UI Listbox). */
async function setAriaSelect(page: Page, field: FormField, option: string, deadline: number): Promise<void> {
  const trigger = page.locator(field.selector).first();
  const wanted = wantedLabel(field, option);
  const shows = async (label: string) => showsLabel(await trigger.innerText({ timeout: 500 }), label);

  // The hidden native <select> Radix keeps in sync (its "bubble" select): setting it updates the widget at once.
  if (field.nativeSelector) {
    const native = page.locator(field.nativeSelector).first();
    const pick = await native
      .evaluate(
        (el, w) => {
          const options = Array.from((el as HTMLSelectElement).options).filter((o) => o.value !== "" && !o.disabled);
          const k = w.replace(/\s+/g, " ").trim().toLowerCase();
          const key = (o: HTMLOptionElement) => (o.label || o.text).replace(/\s+/g, " ").trim().toLowerCase();
          const spaceless = options.filter((o) => key(o).replace(/ /g, "") === k.replace(/ /g, ""));
          const hit = w === "first" ? options[0] : (options.find((o) => key(o) === k) ?? (spaceless.length === 1 ? spaceless[0] : undefined));
          return hit ? { value: hit.value, label: (hit.label || hit.text).replace(/\s+/g, " ").trim() } : null;
        },
        wanted,
        { timeout: budget(deadline, 1_000) },
      )
      .catch(() => null);
    if (pick) {
      const set = await native.selectOption({ value: pick.value }, { force: true, timeout: budget(deadline, 1_500) }).then(
        () => true,
        () => false,
      );
      if (set && (await until(() => shows(pick.label), budget(deadline, 1_000)))) return;
    }
  }

  // Like a person: open it and click the option.
  let before: string;
  try {
    before = lower(await trigger.innerText({ timeout: budget(deadline) }));
    await trigger.click({ timeout: budget(deadline, 2_000) });
  } catch (err) {
    throw failure(field, reason(err));
  }
  const chosen = await chooseShown(page, field, trigger, wanted, deadline);
  const closedAndChanged = async () => (await openOptions(page, trigger, 0)) === null && lower(await trigger.innerText({ timeout: 500 })) !== before;
  if (!(await until(async () => (await shows(chosen)) || (await closedAndChanged()), budget(deadline, 2_000)))) {
    await dismiss(page, trigger);
    throw failure(field, `choosing "${chosen}" didn't show on it`);
  }
}

/** A text input with suggestions (cmdk, Downshift, Headless UI Combobox). */
async function setAriaCombobox(page: Page, field: FormField, setting: FieldSetting, deadline: number): Promise<void> {
  const input = page.locator(field.selector).first();
  const expanded = async () => (await input.getAttribute("aria-expanded", { timeout: 500 }).catch(() => null)) === "true";
  /**
   * Open suggestions can cover the next field. Leaving the box closes most of them; Escape is the fallback, but not
   * inside a dialog, where Escape could close the dialog and the form with it.
   */
  const closeSuggestions = async () => {
    if (!(await expanded())) return;
    await input.evaluate((el) => (el as HTMLElement).blur()).catch(() => undefined);
    if (await until(async () => !(await expanded()), 300)) return;
    const inDialog = await input.evaluate((el) => !!el.closest("[role=dialog], [role=alertdialog], dialog")).catch(() => true);
    if (!inDialog) await input.press("Escape", { timeout: budget(deadline, 1_000) }).catch(() => undefined);
  };
  if ("text" in setting) {
    await input.fill(setting.text, { timeout: budget(deadline) });
    await closeSuggestions();
    return;
  }
  if (!("option" in setting)) return;
  const wanted = wantedLabel(field, setting.option);
  // Typing the label narrows the suggestions to it; "first" clears the box so every suggestion shows.
  await input.fill(wanted === "first" ? "" : wanted, { timeout: budget(deadline) });
  const chosen = await chooseShown(page, field, input, wanted, deadline);
  const taken = await until(async () => {
    const value = await input.inputValue({ timeout: 500 }).catch(() => "");
    return showsLabel(value, chosen) || (await openOptions(page, input, 0)) === null;
  }, budget(deadline, 2_000));
  if (!taken) {
    await dismiss(page, input);
    throw failure(field, `choosing "${chosen}" didn't show in it`);
  }
  await closeSuggestions();
}

/** One option of a radio group: native radios are checked, ARIA radios clicked until aria-checked says so. */
async function setRadio(page: Page, field: FormField, option: string, deadline: number): Promise<void> {
  const known = option === "first" ? firstChoice(field) : matchOption(field, option);
  let target: Locator;
  if (known) target = page.locator(known.selector).first();
  else if ((field.options?.length ?? 0) === 0 && field.widget === "aria-radio") {
    const group = page.locator(field.selector).first();
    target = option === "first" ? group.locator("[role=radio]").first() : group.getByRole("radio", { name: norm(option), exact: true });
  } else {
    throw failure(field, `it has no option "${norm(option)}"`);
  }
  if (field.widget !== "aria-radio") {
    await target.check({ force: true, timeout: budget(deadline) });
    return;
  }
  await press(target, deadline);
  if (!(await until(async () => (await checkedState(target, deadline)) === "true", budget(deadline, 2_000)))) {
    throw failure(field, `clicking "${known?.label ?? norm(option)}" didn't select it`);
  }
}

/** A native <select>, by label; falls back to clicking the option for select-like custom controls. */
async function setNativeSelect(page: Page, field: FormField, option: string, deadline: number): Promise<void> {
  const select = page.locator(field.selector).first();
  let label = option === "first" ? firstChoice(field)?.label : (matchOption(field, option)?.label ?? norm(option));
  if (label === undefined) {
    const first = await select
      .evaluate((el) => {
        const hit = Array.from((el as HTMLSelectElement).options).find((o) => o.value !== "" && !o.disabled);
        return hit ? hit.label || hit.text : null;
      }, undefined, { timeout: budget(deadline, 1_000) })
      .catch(() => null);
    label = first ?? undefined;
  }
  if (!label) throw failure(field, "it has no option to choose");
  try {
    await select.selectOption({ label }, { timeout: budget(deadline, 2_000) });
  } catch (err) {
    const known = matchOption(field, label);
    if (!known) throw failure(field, `it has no option "${label}"`);
    await page.locator(known.selector).first().click({ timeout: budget(deadline) }).catch(() => Promise.reject(failure(field, reason(err))));
  }
}

/** Clickable options with no ARIA widget (a grid of cards acting as a picker). */
async function setCustom(page: Page, field: FormField, option: string, deadline: number): Promise<void> {
  const known = option === "first" ? firstChoice(field) : matchOption(field, option);
  if (!known) throw failure(field, `it has no option "${norm(option)}"`);
  await page.locator(known.selector).first().click({ timeout: budget(deadline) });
}

/** A checkbox or switch. ARIA ones are clicked (at most 3 times: tri-state ones cycle) until aria-checked matches. */
async function setChecked(page: Page, field: FormField, checked: boolean, deadline: number): Promise<void> {
  const box = page.locator(field.selector).first();
  if (!field.widget) {
    try {
      await box.setChecked(checked, { timeout: budget(deadline, 2_500) });
    } catch {
      // A visually hidden native checkbox under a styled label.
      await box.setChecked(checked, { force: true, timeout: budget(deadline) });
    }
    return;
  }
  for (let i = 0; i < 3; i++) {
    const state = await checkedState(box, deadline);
    if ((state === "true") === checked) return;
    await press(box, deadline);
    await until(async () => (await checkedState(box, deadline)) !== state, budget(deadline, 1_000));
  }
  if (((await checkedState(box, deadline)) === "true") !== checked) throw failure(field, `clicking it didn't ${checked ? "check" : "clear"} it`);
}

/**
 * An ARIA slider, with the keyboard: Home/End for the ends, else the arrow keys (and PageUp/PageDown for long
 * distances) until it reaches the value, or the nearer step when the value falls between two.
 */
async function setSlider(page: Page, field: FormField, target: number, deadline: number): Promise<void> {
  const thumb = page.locator(field.selector).first();
  const read = () =>
    thumb.evaluate(
      (el) => ({
        now: Number(el.getAttribute("aria-valuenow") ?? (el as HTMLInputElement).value),
        min: Number(el.getAttribute("aria-valuemin") ?? "0"),
        max: Number(el.getAttribute("aria-valuemax") ?? "100"),
      }),
      undefined,
      { timeout: budget(deadline, 1_000) },
    );
  const start = await read();
  const min = Number.isFinite(start.min) ? start.min : -Infinity;
  const max = Number.isFinite(start.max) ? start.max : Infinity;
  const goal = Math.min(max, Math.max(min, target));
  const key = (k: string) => thumb.press(k, { timeout: budget(deadline, 1_000) });
  await thumb.focus({ timeout: budget(deadline) });
  if (start.now === goal) return;
  /** What one arrow key press moves the slider by, once seen. */
  let step = 0;
  if (goal <= min || goal >= max) {
    await key(goal <= min ? "Home" : "End");
  } else {
    let bigStep = 0;
    for (let i = 0; i < 400 && Date.now() < deadline; i++) {
      const now = (await read()).now;
      if (now === goal) break;
      const up = goal > now;
      const far = Math.abs(goal - now);
      // PageUp/PageDown move 10 steps in most sliders; only used once the arrow step is known and it can't overshoot.
      const usePage = step > 0 && far >= (bigStep || step * 10);
      await key(usePage ? (up ? "PageUp" : "PageDown") : up ? "ArrowRight" : "ArrowLeft");
      const after = (await read()).now;
      if (after === now) break;
      if (usePage) {
        bigStep = Math.abs(after - now);
        continue;
      }
      step = Math.abs(after - now);
      if (up ? after > goal : after < goal) {
        // Between two steps: keep the nearer one.
        if (Math.abs(goal - now) < Math.abs(after - goal)) await key(up ? "ArrowLeft" : "ArrowRight");
        break;
      }
    }
  }
  // Done when it shows the value, or the nearest step to it (at most half a step away).
  const now = (await read()).now;
  if (now !== goal && !(step > 0 && Math.abs(now - goal) <= step / 2)) throw failure(field, `the slider stopped at ${now} instead of ${goal}`);
}

/**
 * Sets `field` to `setting` like a user would, and resolves once the widget shows the new value (a native control's
 * value, aria-checked, the select trigger's text, aria-valuenow). Widgets with a nativeSelector are set through it when
 * that is reliable, else by clicking/typing on the visible control. Throws an Error with a plain message naming the
 * field when the value can't be set within 5 s.
 *
 * A setting is read the way the field takes it: text on a picker is an option label, on a checkbox yes/no
 * ("no", "false", "off", "0" and "" clear it) and on a slider a number.
 */
export async function setField(page: Page, field: FormField, setting: FieldSetting): Promise<void> {
  const deadline = Date.now() + SET_FIELD_TIMEOUT_MS;
  const kind = fieldKind(field);
  const adapted = adapt(field, kind, setting);
  if (typeof adapted === "string") throw failure(field, adapted);
  try {
    switch (kind) {
      case "text":
        if ("text" in adapted) await page.locator(field.selector).first().fill(adapted.text, { timeout: budget(deadline) });
        return;
      case "combobox":
        return await setAriaCombobox(page, field, adapted, deadline);
      case "select":
        if (!("option" in adapted)) return;
        if (field.widget === "aria-select") return await setAriaSelect(page, field, adapted.option, deadline);
        return await setNativeSelect(page, field, adapted.option, deadline);
      case "radio":
        if ("option" in adapted) await setRadio(page, field, adapted.option, deadline);
        return;
      case "custom":
        if ("option" in adapted) await setCustom(page, field, adapted.option, deadline);
        return;
      case "check":
        if ("checked" in adapted) await setChecked(page, field, adapted.checked, deadline);
        return;
      case "slider":
        if (!("number" in adapted)) return;
        // A native range input takes its value directly.
        if (!field.widget) return await page.locator(field.selector).first().fill(String(adapted.number), { timeout: budget(deadline) });
        return await setSlider(page, field, adapted.number, deadline);
      case "none":
        return;
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Couldn't set ")) throw err;
    throw failure(field, reason(err));
  }
}

// ---------- Exported specs ----------

/** Roles getByRole can find a form field by; anything else (e.g. "generic") falls back to label or placeholder. */
const FIELD_ROLES = new Set(["textbox", "searchbox", "combobox", "listbox", "spinbutton", "slider", "checkbox", "radio", "switch", "radiogroup"]);

/** The role an exported spec finds a widget by when discovery reported none: a Radix Select trigger is a "combobox". */
const WIDGET_ROLES: Record<NonNullable<FormField["widget"]>, string> = {
  "aria-select": "combobox",
  "aria-combobox": "combobox",
  "aria-checkbox": "checkbox",
  "aria-switch": "switch",
  "aria-radio": "radiogroup",
  "aria-slider": "slider",
};

/** Roles a widget can really have (a Headless UI Listbox trigger is a plain "button"). */
const WIDGET_OWN_ROLES = new Set(["combobox", "button", "listbox", "checkbox", "switch", "radiogroup", "slider", "spinbutton", "textbox", "searchbox"]);

/** The role a widget is found by: its own when it has a real one, else the one its kind implies. */
function widgetRole(field: FormField & { widget: NonNullable<FormField["widget"]> }): string {
  return WIDGET_OWN_ROLES.has(field.role) ? field.role : WIDGET_ROLES[field.widget];
}

/**
 * A role/label locator a person would write for a field, falling back to its CSS selector.
 * A widget is found by its role and accessible name (its CSS selector when it has no name): a Radix Select trigger
 * is a "combobox", a Radix Checkbox a "checkbox", never a "button".
 * getByLabel only matches <label>, aria-label and aria-labelledby, never a placeholder, so an accessible name that
 * came from the placeholder (a placeholder-only field) uses getByPlaceholder instead; otherwise the exported spec
 * would hang waiting for a label that does not exist.
 */
export function fieldLocator(field: FormField): string {
  if (field.widget) {
    const name = field.accessibleName;
    return name ? `page.getByRole(${q(widgetRole({ ...field, widget: field.widget }))}, { name: ${q(name)}, exact: true })` : `page.locator(${q(field.selector)})`;
  }
  if (field.label) return `page.getByLabel(${q(field.label)}, { exact: true })`;
  const name = field.accessibleName;
  if (name && name !== field.placeholder) {
    return FIELD_ROLES.has(field.role) ? `page.getByRole(${q(field.role)}, { name: ${q(name)}, exact: true })` : `page.getByLabel(${q(name)}, { exact: true })`;
  }
  // A placeholder-only field is usually fixed by adding a <label> with the same text (and dropping the placeholder),
  // so the spec also accepts that label; it keeps working once the accessibility bug is fixed.
  if (field.placeholder) return `page.getByPlaceholder(${q(field.placeholder)}, { exact: true }).or(page.getByLabel(${q(field.placeholder)}, { exact: true })).first()`;
  return `page.locator(${q(field.selector)})`;
}

/**
 * Playwright source lines (for exported specs) that set the field the way setField does, using role/label locators
 * (never CSS), e.g. `await page.getByRole("combobox", { name: "Team size" }).click();` then
 * `await page.getByRole("option", { name: "6–20" }).click();`. A widget with no accessible name falls back to its
 * CSS selector; a setting that can't apply to the field becomes a comment saying so.
 */
export function setFieldSpec(field: FormField, setting: FieldSetting): string[] {
  const kind = fieldKind(field);
  const adapted = adapt(field, kind, setting);
  if (typeof adapted === "string") return [`// Not set: ${nameOf(field)} (${adapted}).`];
  const loc = fieldLocator(field);
  const label = "option" in adapted ? wantedLabel(field, adapted.option) : null;
  const named = label !== null && label !== "first";
  const optionClick = named ? `await page.getByRole("option", { name: ${q(label)}, exact: true }).click();` : `await page.getByRole("option").first().click();`;
  switch (kind) {
    case "text":
      return "text" in adapted ? [`await ${loc}.fill(${q(adapted.text)});`] : [];
    case "combobox":
      if ("text" in adapted) return [`await ${loc}.fill(${q(adapted.text)});`];
      return [named ? `await ${loc}.fill(${q(label)});` : `await ${loc}.click();`, optionClick];
    case "select":
      if (field.widget === "aria-select") return [`await ${loc}.click();`, optionClick];
      return named ? [`await ${loc}.selectOption({ label: ${q(label)} });`] : [`await ${loc}.selectOption({ index: 1 });`];
    case "radio":
      return named ? [`await page.getByRole("radio", { name: ${q(label)}, exact: true }).check();`] : [`await ${loc}.getByRole("radio").first().check();`];
    case "custom":
      // Clicking the option's text also works once the picker becomes a native radio group (the text is its label).
      return named ? [`await page.getByText(${q(label)}, { exact: true }).first().click(); // ${nameOf(field)}`] : [];
    case "check":
      return "checked" in adapted ? [`await ${loc}.${adapted.checked ? "check" : "uncheck"}();`] : [];
    case "slider": {
      if (!("number" in adapted)) return [];
      if (!field.widget) return [`await ${loc}.fill(${q(String(adapted.number))});`];
      const n = adapted.number;
      const { min, max } = field.constraints ?? {};
      const lines = [`await ${loc}.focus();`];
      if (min !== undefined && n <= Number(min)) return [...lines, `await page.keyboard.press("Home");`];
      if (max !== undefined && n >= Number(max)) return [...lines, `await page.keyboard.press("End");`];
      return [
        ...lines,
        `await page.keyboard.press("Home");`,
        `for (let i = 0; i < 400 && Number(await ${loc}.getAttribute("aria-valuenow")) < ${n}; i++) await page.keyboard.press("ArrowRight");`,
      ];
    }
    case "none":
      return [];
  }
}
