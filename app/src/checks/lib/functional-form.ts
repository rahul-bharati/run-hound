/**
 * Shared helpers for the behaviour checks: canary values, filling and submitting the discovered form,
 * and recognising the create request. Everything works from the DiscoveredForm, never from app-specific names.
 */
import type { Page, Request } from "playwright";
import { isPagePost, isSameOrigin as sameOriginCore, isSaveRequest } from "../../core/saves.js";
import { SIMULATED_RESPONSE_HEADER, type Capture, type CheckContext, type DiscoveredForm, type FormControl, type FormField } from "../../core/types.js";
import { fieldKind, firstChoice, isConsentCheckbox, meansYes, setField, showsLabel, type FieldSetting } from "./widgets.js";

/** What the checks put into one field. Choice fields record the option they picked. */
export interface FieldValue {
  field: FormField;
  /** Text typed into the field, or the chosen option's label for radios / selects / custom pickers. */
  value: string;
  /** True when `value` is a unique canary that should show up again (free-text fields only). */
  canary: boolean;
  /** Left as the page has it (FormField.holdsAccountEmail): fillForm doesn't touch it. */
  keep?: boolean;
}

const START_DATE = /start|from|begin|check.?in|arriv|depart/i;
const END_DATE = /end|until|to\b|check.?out|return|leav/i;

/** YYYY-MM-DD for a day `offset` days from today (UTC). Future dates pass "not in the past" rules. */
export function isoDay(offset: number, from = new Date()): string {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + offset));
  return d.toISOString().slice(0, 10);
}

/** Shifts a YYYY-MM-DD date by `days`. */
export function shiftDay(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return isoDay(days, new Date(Date.UTC(y ?? 2030, (m ?? 1) - 1, d ?? 1)));
}

function describe(field: FormField): string {
  return `${field.key} ${field.label ?? ""} ${field.accessibleName ?? ""} ${field.placeholder ?? ""}`;
}

/** The user-facing name of a field: its accessible name, label, placeholder or key. */
export function fieldName(field: FormField): string {
  return field.accessibleName ?? field.label ?? field.placeholder ?? field.key;
}

/** The user-facing name of a control. */
export function controlName(control: FormControl): string {
  // A CSS path ("#root > main > form > div > button") means nothing to a reader; the evidence frame marks the element.
  return control.accessibleName ?? (control.text || `unnamed ${control.role === "button" || control.tag === "button" ? "button" : control.tag}`);
}

/**
 * `value` made to fit the field's length limits: padded with "x" up to its minLength (a word apart, so the value
 * itself stays findable), then cut to its maxLength.
 */
export function fitLength(value: string, field: FormField): string {
  const { minLength: min, maxLength: max } = field.constraints ?? {};
  let fitted = min && min > value.length ? `${value} ${"x".repeat(Math.max(1, min - value.length - 1))}` : value;
  if (max && max > 0 && fitted.length > max) fitted = fitted.slice(0, max);
  return fitted;
}

const fit = (value: string, field: FormField) => fitLength(value, field);

/**
 * Whether `value` passes the field's pattern attribute (true without one, or when the pattern doesn't compile). Browsers
 * match the whole value with the "v" flag.
 */
export function fitsPattern(field: FormField, value: string): boolean {
  const pattern = field.constraints?.pattern;
  if (!pattern || value === "") return true;
  for (const flags of ["v", "u"]) {
    try {
      return new RegExp(`^(?:${pattern})$`, flags).test(value);
    } catch {
      // try the next flag
    }
  }
  return true;
}

/** A field that takes a handle rather than words: a slug (often labelled "Workspace URL"), a username, a handle. */
export function isHandleField(field: FormField): boolean {
  return /slug|handle|user-?name|subdomain/i.test(field.key) || /\b(?:slug|handle|user ?name|subdomain)\b/i.test(`${field.label ?? ""} ${field.accessibleName ?? ""}`);
}

/** A text field that takes a web address ("Website", "Homepage", "Link"), when it isn't a handle. */
export function isWebsiteField(field: FormField): boolean {
  return !isHandleField(field) && /\b(?:website|homepage|home page|url|link)\b/i.test(`${field.key} ${field.label ?? ""} ${field.accessibleName ?? ""}`);
}

/** Small stable number from a string, used to make phone canaries differ between checks. */
function hashDigits(text: string, digits: number): string {
  let h = 7;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) % 10 ** digits;
  return String(h).padStart(digits, "0");
}

/**
 * Valid, unique values for every field. `token` is the run token, `salt` a short word per check so two
 * checks in one run never write the same canary (earlier bookings stay on the page).
 * Canaries are lowercase where it matters (emails), contain the token, and fit maxLength.
 */
export function canaryValues(form: DiscoveredForm, token: string, salt: string): FieldValue[] {
  // Each form on a page gets its own values (V1), so one form's saved record never answers for another's.
  const tag = `${token}${salt}${form.index ? `f${form.index + 1}` : ""}`.toLowerCase().replace(/[^a-z0-9]/g, "");
  const dates = form.fields.filter((f) => f.type === "date");
  const start = isoDay(14);
  const values: FieldValue[] = [];
  let passwordValue: string | null = null;

  for (const field of form.fields) {
    // The signed-in account's own email (a profile form): kept, so a save can't change how the account signs in.
    if (field.holdsAccountEmail) {
      values.push({ field, value: "", canary: false, keep: true });
      continue;
    }
    const text = describe(field);
    const kind = fieldKind(field);
    // Choices get their first real option ("None" and "Select…" are skipped). A picker whose options only exist once
    // it is open gets "" (setField picks the first one it shows); a combobox also keeps a typed fallback.
    if (kind === "select" || kind === "radio" || kind === "custom" || (kind === "combobox" && firstChoice(field))) {
      values.push({ field, value: firstChoice(field)?.label ?? "", canary: false });
      continue;
    }
    if (kind === "combobox") {
      values.push({ field, value: fit(`${nameWord(field)} ${tag}`, field), canary: false });
      continue;
    }
    // Checkboxes and switches are decided by settingFor; sliders keep the value they start with.
    if (kind === "check" || kind === "slider" || kind === "none") {
      values.push({ field, value: "", canary: false });
      continue;
    }
    switch (field.type) {
      case "date": {
        const isEnd = END_DATE.test(text) && !START_DATE.test(text);
        const index = dates.indexOf(field);
        const value = isEnd ? shiftDay(start, 3) : index > 0 && !START_DATE.test(text) ? shiftDay(start, 3) : start;
        values.push({ field, value, canary: false });
        break;
      }
      case "email":
        values.push({ field, value: fit(`owner.${tag}@example.test`, field), canary: true });
        break;
      case "tel":
        values.push({ field, value: `+1 555 01${hashDigits(tag, 2)} ${hashDigits(salt, 3)}`, canary: true });
        break;
      case "password":
        // Confirm fields must match, so every password field gets the same (fake) value.
        passwordValue ??= `Fake-Passw0rd-${tag}!`;
        values.push({ field, value: passwordValue, canary: false });
        break;
      case "number":
      case "range":
        values.push({ field, value: field.constraints?.min ?? "1", canary: false });
        break;
      case "url":
        values.push({ field, value: `https://example.test/${tag}`, canary: true });
        break;
      case "checkbox":
      case "radio":
      case "custom":
        values.push({ field, value: "", canary: false });
        break;
      case "textarea":
        values.push({ field, value: fit(`Feed twice a day, note ${tag}`, field), canary: true });
        break;
      default: {
        if (/e-?mail/i.test(text)) {
          values.push({ field, value: fit(`owner.${tag}@example.test`, field), canary: true });
        } else if (/phone|mobile|tel/i.test(text)) {
          values.push({ field, value: `555 01${hashDigits(tag, 2)} ${hashDigits(salt, 3)}`, canary: true });
        } else if (isHandleField(field)) {
          values.push({ field, value: fit(`rh-${tag}`, field), canary: true });
        } else if (isWebsiteField(field)) {
          values.push({ field, value: `https://example.test/${tag}`, canary: true });
        } else {
          values.push({ field, value: fit(`${nameWord(field)} ${tag}`, field), canary: true });
        }
      }
    }
  }
  // An optional field whose own pattern the made-up value breaks is left empty: empty is valid there, the value isn't.
  return values.map((v) => (v.value && !v.field.required && fieldKind(v.field) === "text" && !fitsPattern(v.field, v.value) ? { ...v, value: "", canary: false } : v));
}

/**
 * The last word of the field's name ("name" for "Project name *"): canaries made of words read like a name and
 * satisfy most "letters only" rules. Required markers ("*", "(required)") are not words of the name.
 */
function nameWord(field: FormField): string {
  const words = fieldName(field).replace(/\(?\brequired\b\)?|\*/gi, " ").split(/\s+/).map((w) => w.replace(/[^A-Za-z]/g, ""));
  return words.filter(Boolean).pop() ?? "Value";
}

/**
 * How fillForm sets one value (the fill policy), or null to leave the field as the page made it:
 * - text-like fields get the value typed;
 * - selects, radio groups and pickers get the chosen option ("first" when the value is empty: the first one shown);
 * - a combobox with suggestions gets its first suggestion;
 * - a checkbox or switch is checked when it is required (by attribute or label) or asks for consent (terms, privacy),
 *   else left alone; a value of its own ("yes"/"no") wins;
 * - a slider keeps its value unless one is given; file and hidden inputs are never set.
 */
export function settingFor(v: FieldValue): FieldSetting | null {
  if (v.keep) return null;
  const { field, value } = v;
  switch (fieldKind(field)) {
    case "text":
      return { text: value };
    case "select":
      return { option: value || "first" };
    case "combobox":
      return { option: firstChoice(field) ? value || "first" : "first" };
    case "radio":
      return value ? { option: value } : field.widget === "aria-radio" ? { option: "first" } : null;
    case "custom":
      return value ? { option: value } : null;
    case "check":
      if (value) return { text: value };
      return field.required || isConsentCheckbox(field) ? { checked: true } : null;
    case "slider":
      return value ? { number: Number(value) } : null;
    case "none":
      return null;
  }
}

/** A field fillForm could not set, and why ("Couldn't set Owner: no options appeared after opening it."). */
export interface FillProblem {
  field: FormField;
  message: string;
}

/**
 * Fills every field through setField, following settingFor (widgets included: a Radix Select, cmdk combobox, Radix
 * Checkbox/Switch/RadioGroup or slider is set like a person would). A field that can't be set doesn't stop the fill:
 * it is returned, so a check can say which field it was (fillProblemsNote) when the form then refuses to submit.
 */
export async function fillForm(page: Page, values: FieldValue[]): Promise<FillProblem[]> {
  const problems: FillProblem[] = [];
  for (const v of values) {
    if (v.keep) continue;
    const setting = settingFor(v);
    if (!setting) continue;
    try {
      await setField(page, v.field, setting);
    } catch (err) {
      // A combobox that offered no suggestion may still take typed text (a free-text field with hints).
      if (fieldKind(v.field) === "combobox" && v.value && !("text" in setting)) {
        const typed = await setField(page, v.field, { text: v.value }).then(
          () => true,
          () => false,
        );
        if (typed) continue;
      }
      problems.push({ field: v.field, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return problems;
}

const flat = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Whether the value fillForm gave `v` is still in its field (after a failed save, say): the typed text, the chosen
 * option (a select's selected label, a widget trigger's text, the checked radio) or a checkbox's checked state. Null
 * for a field fillForm leaves alone (settingFor) and for a choice it can't name ("first" on a picker whose options
 * only show once open, a combobox suggestion). A field that is gone counts as not kept.
 */
export async function valueKept(page: Page, v: FieldValue): Promise<boolean | null> {
  if (v.keep) return null;
  const setting = settingFor(v);
  if (!setting) return null;
  const { field, value } = v;
  const el = page.locator(field.selector).first();
  const timeout = 2_000;
  try {
    switch (fieldKind(field)) {
      case "text":
        return (await el.inputValue({ timeout })) === value;
      case "select": {
        if (!value) return null;
        if (field.widget) return showsLabel(await el.innerText({ timeout }), value);
        const label = await el.evaluate((s) => {
          const o = (s as HTMLSelectElement).selectedOptions[0];
          return o ? o.label || o.text : "";
        }, undefined, { timeout });
        return flat(label) === flat(value);
      }
      case "radio": {
        const option = value ? field.options?.find((o) => o.label === value) : firstChoice(field);
        if (!option) return null;
        const state = await page.locator(option.selector).first().evaluate((r) => r.getAttribute("aria-checked") ?? String((r as HTMLInputElement).checked === true), undefined, { timeout });
        return state === "true";
      }
      case "check": {
        const want = "checked" in setting ? setting.checked : meansYes(value);
        const state = await el.evaluate((c) => c.getAttribute("aria-checked") ?? String((c as HTMLInputElement).checked === true), undefined, { timeout });
        return (state === "true") === want;
      }
      default:
        return null;
    }
  } catch {
    return false;
  }
}

/**
 * One sentence for a skipped scenario's note naming the fields fillForm could not set, e.g. "Run Hound could not set
 * Owner (no options appeared after opening it)." Empty when there are none.
 */
export function fillProblemsNote(problems: FillProblem[]): string {
  if (problems.length === 0) return "";
  const parts = problems.slice(0, 3).map((p) => {
    const why = p.message.replace(/^Couldn't set .*?: /, "").replace(/\.$/, "");
    return `${fieldName(p.field)} (${why})`;
  });
  const more = problems.length > 3 ? ` and ${problems.length - 3} more` : "";
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0]!;
  return `Run Hound could not set ${list}${more}.`;
}

/** The form's submit control, if discovery found one. */
export function submitControl(form: DiscoveredForm): FormControl | undefined {
  return form.controls.find((c) => c.isSubmit);
}

/** Clicks the submit control, or presses Enter in the first text field when there is none (never in a widget). */
export async function submitForm(page: Page, form: DiscoveredForm, how: "click" | "dblclick" = "click"): Promise<void> {
  const submit = submitControl(form);
  if (submit) {
    const locator = page.locator(submit.selector).first();
    await (how === "dblclick" ? locator.dblclick() : locator.click());
    return;
  }
  const first = form.fields.find((f) => fieldKind(f) === "text");
  if (first) await page.locator(first.selector).first().press("Enter");
}

// ---------- Multi-step forms (LOV-12) ----------

/** What a form shows at one moment: its visible fields ("tag|type|name|label" each) and its step indicator. */
export interface FormStep {
  fields: string[];
  /** Text of the step indicator ([aria-current=step], "Step 2 of 3"), or null when the page shows none. */
  step: string | null;
}

/** Runs in the page (a string, so the bundler's helpers never leak in). */
const STEP_SCRIPT = String.raw`(() => {
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
  const shown = (el) => !el.closest("[hidden], [aria-hidden=true], [inert]") && getComputedStyle(el).visibility !== "hidden" && el.getClientRects().length > 0;
  const skip = ["hidden", "submit", "button", "reset", "image"];
  const fields = [];
  for (const el of document.querySelectorAll("input, select, textarea, [role=combobox], [role=checkbox], [role=switch], [role=radio], [role=slider], [role=textbox], [contenteditable=true]")) {
    if (el.tagName === "INPUT" && skip.includes(el.type)) continue;
    if (!shown(el)) continue;
    const labelled = norm((el.getAttribute("aria-labelledby") || "").split(/\s+/).map((id) => document.getElementById(id)).filter(Boolean).map((n) => n.textContent).join(" "));
    const labels = el.labels ? norm(Array.from(el.labels).map((l) => l.textContent).join(" ")) : "";
    const name = norm(el.getAttribute("aria-label")) || labelled || labels || norm(el.getAttribute("placeholder"));
    // Framework ids (React's useId) change between renders, so they only count when nothing else names the field.
    fields.push([el.tagName.toLowerCase(), el.getAttribute("role") || el.type || "", el.getAttribute("name") || "", name || el.id].join("|"));
  }
  const current = Array.from(document.querySelectorAll('[aria-current="step"]')).filter(shown).map((el) => norm(el.textContent)).join(" / ");
  const counter = ((document.body && document.body.innerText) || "").match(/\bstep\s+\d+\s*(?:of|\/)\s*\d+\b/i);
  const step = [current, counter ? norm(counter[0]).toLowerCase() : ""].filter(Boolean).join(" / ");
  return { fields, step: step || null };
})()`;

/** What the page shows now (see FormStep). A page that can't be read shows nothing. */
export async function formStep(page: Page): Promise<FormStep> {
  return ((await page.evaluate(STEP_SCRIPT).catch(() => null)) as FormStep | null) ?? { fields: [], step: null };
}

/**
 * True when going from `before` to `after` looks like a multi-step form moving to its next step: no save request was
 * sent (`savesSent` is 0), and fields the page didn't show before appeared or the step indicator changed. A form
 * that only went away (a thank-you message) or showed an error is not a next step.
 */
export function isNextStep(before: FormStep, after: FormStep, savesSent: number): boolean {
  if (savesSent > 0) return false;
  const known = new Set(before.fields);
  if (after.fields.some((f) => !known.has(f))) return true;
  return after.step !== null && after.step !== before.step && after.fields.length > 0;
}

/**
 * Watches one submit of a possibly multi-step form. Call it right before submitting; after the submit (and
 * waitForCreates), moved() says whether the submit sent no save request and showed the form's next step (isNextStep),
 * waiting up to a second for the next step to render. A check that needs a saved record then skips with
 * MULTI_STEP_NOTE instead of blaming the test values.
 */
export async function watchNextStep(page: Page, capture: Capture, pageUrl: string, runToken = ""): Promise<{ moved(): Promise<boolean> }> {
  const before = await formStep(page);
  const saves = createRequests(capture, pageUrl, runToken).length;
  return {
    async moved() {
      const sent = createRequests(capture, pageUrl, runToken).length - saves;
      if (sent > 0) return false;
      return waitFor(async () => isNextStep(before, await formStep(page), createRequests(capture, pageUrl, runToken).length - saves), 1_000);
    },
  };
}

/** Why a check that needs a saved record skips a multi-step form's first step (a skipped scenario's note). */
export const MULTI_STEP_NOTE =
  "Skipped: this is a multi-step form. Submitting its first step showed the next step without saving anything, and Run Hound tests the first step only, so there was no saved record to check.";

// ---------- Field errors and the empty submit (LOV-6, RH-08, RH-10) ----------

/**
 * Wording that makes text next to a field a validation message ("Task is required", "Enter a valid email", "Choose a
 * plan"), and not a hint or a character count.
 */
const FIELD_ERROR_WORDS = String.raw`\b(?:required|invalid|must|please|enter|provide|missing|empty|at least|at most|too (?:short|long)|valid|choose|select|pick|agree|accept|can'?t|cannot|isn'?t|not allowed|should|needs?)\b`;

/** Whether text next to a field reads like a validation message (FIELD_ERROR_WORDS), not a hint or a counter. */
export function looksLikeFieldError(text: string | null | undefined): boolean {
  return !!text && new RegExp(FIELD_ERROR_WORDS, "i").test(text);
}

/** Remembers what every element shows before a submit, so a message that appears afterwards can be told apart. */
const ARM_FIELD_ERRORS = `(() => {
  const seen = new WeakMap();
  for (const el of document.querySelectorAll("body *")) seen.set(el, (el.textContent || "").replace(/\\s+/g, " ").trim());
  window.__rhFieldErrors = seen;
  return true;
})()`;

/**
 * For each field ({ sel, native }): whether it shows a validation error now. aria-invalid="true" on it, a control
 * inside it or its hidden native input; the browser's own validation failing (only in a form without novalidate,
 * where it blocks the submit); or a message with error wording that appeared (since ARM_FIELD_ERRORS) in the field's
 * own wrapper: up to three levels up, never a container that also holds another field, whose messages may be that
 * field's.
 */
const FIELD_ERRORS_SCRIPT = `(args) => {
  const words = new RegExp(args.words, "i");
  const seen = window.__rhFieldErrors;
  const fieldSel = "input:not([type=hidden]),select,textarea,[role=combobox],[role=checkbox],[role=switch],[role=radiogroup],[role=slider],[role=textbox],[contenteditable=true]";
  const flat = (t) => (t || "").replace(/\\s+/g, " ").trim();
  const own = (el) => flat(Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" "));
  const shown = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
  const isNew = (el) => !seen || seen.get(el) !== flat(el.textContent);
  return args.fields.map((f) => {
    const el = document.querySelector(f.sel);
    if (!el) return false;
    const native = f.native ? document.querySelector(f.native) : null;
    const controls = [el, ...el.querySelectorAll("input,select,textarea,[role=radio],[role=checkbox],[role=option]"), ...(native ? [native] : [])];
    if (controls.some((c) => c.getAttribute("aria-invalid") === "true")) return true;
    if (controls.some((c) => c.form && !c.form.noValidate && c.willValidate && c.validity && !c.validity.valid)) return true;
    // The field's own parts: its hidden native input, and a widget's aria-hidden "bubble" input next to it.
    const mine = (c) => c === el || el.contains(c) || c === native || (c.getAttribute("aria-hidden") === "true" && c.parentElement === el.parentElement);
    let node = el.parentElement;
    for (let depth = 0; node && depth < 3; depth++, node = node.parentElement) {
      if (Array.from(node.querySelectorAll(fieldSel)).some((c) => !mine(c))) break;
      const message = Array.from(node.querySelectorAll("*")).find((m) =>
        !el.contains(m) && !m.matches("input,select,textarea,option,label,button,script,style") && own(m) && words.test(own(m)) && isNew(m) && shown(m));
      if (message) return true;
    }
    return false;
  });
}`;

/** Remembers what the page shows now, so fieldsShowingErrors only counts messages that appear after it. */
export async function armFieldErrors(page: Page): Promise<void> {
  await page.evaluate(ARM_FIELD_ERRORS).catch(() => undefined);
}

/**
 * The form's fields that show a validation error now, in form order (see FIELD_ERRORS_SCRIPT). Call armFieldErrors
 * before the submit, or every message already on the page counts. A page that can't be read shows none.
 */
export async function fieldsShowingErrors(page: Page, form: DiscoveredForm): Promise<FormField[]> {
  const args = { words: FIELD_ERROR_WORDS, fields: form.fields.map((f) => ({ sel: f.selector, native: f.nativeSelector ?? null })) };
  const flags = ((await page.evaluate(`(${FIELD_ERRORS_SCRIPT})(${JSON.stringify(args)})`).catch(() => null)) as boolean[] | null) ?? [];
  return form.fields.filter((_, i) => flags[i] === true);
}

/** "\"Task\"", "\"Task\" and \"Email\"", "\"A\", \"B\" and 2 more". */
function quotedNames(fields: FormField[]): string {
  const names = fields.map((f) => `"${fieldName(f)}"`);
  const shown = names.slice(0, 4);
  const more = names.length - shown.length;
  if (more > 0) return `${shown.join(", ")} and ${more} more`;
  return shown.length > 1 ? `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}` : (shown[0] ?? "");
}

/**
 * Why a submit sent nothing, for a skipped scenario's note, never blaming the app for what Run Hound didn't do (RH-10):
 * the fields Run Hound could not set (`unset`), and the fields that showed a validation error (`flagged`), told apart
 * by whether Run Hound filled them in (`filled`) or left them empty. One or more full sentences.
 */
export function noSaveReason(filled: FormField[], unset: FillProblem[], flagged: FormField[]): string {
  const sentences: string[] = [];
  const unsetFields = new Set(unset.map((p) => p.field));
  if (unset.length > 0) {
    const note = fillProblemsNote(unset).replace(/\.$/, "");
    const shownOn = unset.filter((p) => flagged.includes(p.field)).map((p) => p.field);
    const one = unset.length === 1;
    if (shownOn.length === unset.length) sentences.push(`${note}, and the form showed an error on ${one ? "it" : "them"}.`);
    else if (shownOn.length > 0) sentences.push(`${note}; the form showed an error on ${quotedNames(shownOn)}.`);
    else sentences.push(`${note}; the form may need ${one ? "it" : "them"}.`);
  }
  const refused = flagged.filter((f) => !unsetFields.has(f) && filled.includes(f));
  if (refused.length > 0) {
    const one = refused.length === 1;
    sentences.push(`The form showed an error on ${quotedNames(refused)} after Run Hound filled ${one ? "it" : "them"} in, so one of its rules refused the test ${one ? "value" : "values"} there.`);
  }
  const leftEmpty = flagged.filter((f) => !unsetFields.has(f) && !filled.includes(f));
  if (leftEmpty.length > 0) {
    sentences.push(`The form showed an error on ${quotedNames(leftEmpty)}, which Run Hound left empty because nothing marks ${leftEmpty.length === 1 ? "it" : "them"} as required.`);
  }
  if (sentences.length === 0) sentences.push("No field showed an error, so Run Hound can't tell why the form sent nothing.");
  return sentences.join(" ");
}

/**
 * noSaveReason for a submit of `values` (fillForm) that sent nothing, reading the fields that show an error from the
 * page now. Call armFieldErrors before the submit.
 */
export async function whyNothingSent(page: Page, form: DiscoveredForm, values: FieldValue[], unset: FillProblem[]): Promise<string> {
  const filled = values.filter((v) => settingFor(v) !== null).map((v) => v.field);
  return noSaveReason(filled, unset, await fieldsShowingErrors(page, form));
}

/** The answer Run Hound gives a write it stops (stopWrites): a refusal, so the page shows no success state. */
const STOPPED_WRITE_BODY = JSON.stringify({ error: "Run Hound stopped this request, so nothing was saved." });

/**
 * Answers every write the page sends from now on (any method but GET, HEAD and OPTIONS, to any origin) itself, so
 * nothing reaches an app: a classic page post with a small stand-in page, anything else with a simulated 400.
 * `sent()` says whether one of them was the form's own save (core/saves.ts) or a page post.
 */
export async function stopWrites(page: Page, targetUrl: string, runToken = ""): Promise<{ sent(): boolean }> {
  let sent = false;
  await page.route("**/*", async (route, request) => {
    if (["GET", "HEAD", "OPTIONS"].includes(request.method())) return route.fallback();
    const pagePost = isPagePost({ resourceType: request.resourceType() });
    if (pagePost || isCreatePlaywrightRequest(request, targetUrl, runToken)) sent = true;
    if (pagePost) return route.fulfill(simulatedResponse(request, 200, STOPPED_PAGE_POST_HTML, "text/html; charset=utf-8"));
    return route.fulfill(simulatedResponse(request, 400, STOPPED_WRITE_BODY));
  });
  return { sent: () => sent };
}

/** A field a person can empty by deleting its text: a text-like input or text area (not a range, color or widget). */
export function isEmptiableText(field: FormField): boolean {
  return fieldKind(field) === "text" && !field.widget && !["range", "color"].includes(field.type);
}

/**
 * Empties every text field of `form` that holds a value (a settings form loads with the saved record in its fields),
 * so a submit that follows is really an empty one. Choices, checkboxes, sliders and widgets are left as they are.
 */
export async function emptyTextFields(page: Page, form: DiscoveredForm): Promise<void> {
  for (const field of form.fields) {
    if (!isEmptiableText(field)) continue;
    const input = page.locator(field.selector).first();
    const value = await input.inputValue({ timeout: 1_000 }).catch(() => "");
    if (value !== "") await input.fill("", { timeout: 2_000 }).catch(() => undefined);
  }
}

/** What an empty submit showed (probeEmptySubmit). */
export interface EmptySubmit {
  /** The fields that showed a validation error after the empty submit, in form order: the fields the app refuses empty. */
  refused: FormField[];
  /** True when the empty form was sent anyway (Run Hound answered it itself) or the page went elsewhere. */
  sent: boolean;
}

/** How long a probe waits after the empty submit for the page to show its errors (validation is often async). */
const EMPTY_SUBMIT_WAIT_MS = 800;

/**
 * Submits `form` empty on a fresh page (text fields that load with a value are emptied first), with every write
 * answered by Run Hound (stopWrites: nothing reaches the app), and returns the fields the page then marks as needing a
 * value (fieldsShowingErrors). Schema-validated forms (react-hook-form + zod) mark nothing in their markup; this is how
 * Run Hound learns which fields they require. A submit button that stays disabled while the form is empty refuses the
 * submit without naming a field: none.
 */
export async function probeEmptySubmit(ctx: CheckContext, form: DiscoveredForm = ctx.form): Promise<EmptySubmit> {
  const { page } = await ctx.openPage();
  try {
    const writes = await stopWrites(page, ctx.targetUrl, ctx.runToken);
    const startUrl = page.url();
    await emptyTextFields(page, form);
    await armFieldErrors(page);
    const submit = submitControl(form);
    const clicked = submit
      ? await page.locator(submit.selector).first().click({ timeout: 5_000 }).then(() => true, () => false)
      : await submitForm(page, form).then(() => true, () => false);
    if (!clicked) return { refused: [], sent: false };
    await sleep(EMPTY_SUBMIT_WAIT_MS);
    await settle(page, 2_000);
    const moved = page.url() !== startUrl;
    return { refused: moved ? [] : await fieldsShowingErrors(page, form), sent: writes.sent() || moved };
  } finally {
    await page.unrouteAll({ behavior: "ignoreErrors" }).catch(() => undefined);
  }
}

/** Same origin as the target page. */
export function isSameOrigin(url: string, pageUrl: string): boolean {
  return sameOriginCore(url, pageUrl);
}

/**
 * A request that sends the form (see core/saves.ts): a non-GET fetch/XHR or form post to the target's origin, or
 * to another origin when its body carries the run's test values (`runToken`), such as an API on another port.
 * Third-party calls without the test values (analytics) never count.
 */
export function isCreateRequest(req: { method: string; resourceType: string; url: string; postData?: string | null }, pageUrl: string, runToken = ""): boolean {
  return isSaveRequest(req, pageUrl, runToken);
}

/** Same as isCreateRequest, for a live Playwright request. */
export function isCreatePlaywrightRequest(req: Request, pageUrl: string, runToken = ""): boolean {
  return isCreateRequest({ method: req.method(), resourceType: req.resourceType(), url: req.url(), postData: req.postData() }, pageUrl, runToken);
}

/** Create requests recorded in the capture so far. */
export function createRequests(capture: Capture, pageUrl: string, runToken = ""): Capture["requests"] {
  return capture.requests.filter((r) => isCreateRequest(r, pageUrl, runToken));
}

/**
 * A sign-in form: exactly one password field, marked autocomplete="current-password" or, without that hint, a
 * short form whose name or submit button says "sign in" / "log in". Run Hound's made-up credentials are always
 * refused there, so a 400/401/403/422 answer is the app working, and nothing is saved.
 * A sign-up form (a "new-password" field, or password + confirm) is not a sign-in form.
 */
/**
 * A search form: it finds things and saves nothing (it usually loads a results page with GET). Checks that need a
 * saved record (persistence, double-submit, silent-failure, client-only-validation, verbose-errors) don't plan for it.
 */
export function isSearchForm(form: DiscoveredForm): boolean {
  return form.search === true;
}

export function isSignInForm(form: DiscoveredForm): boolean {
  const passwords = form.fields.filter((f) => f.type === "password");
  if (passwords.length !== 1) return false;
  const hint = passwords[0]!.autocomplete ?? "";
  if (/new-password/.test(hint)) return false;
  if (/current-password/.test(hint)) return true;
  const submit = submitControl(form);
  const words = `${form.name ?? ""} ${submit?.accessibleName ?? ""} ${submit?.text ?? ""}`;
  const others = form.fields.filter((f) => !["password", "checkbox", "hidden"].includes(f.type));
  return others.length <= 2 && /\b(sign|log)[\s-]?in\b|\blogin\b/i.test(words);
}

/**
 * A form that sets a password (change password, sign up, "confirm with your password"): not a sign-in form, but it has
 * a password field. On a signed-in run (0.4.0) submitting it could change the test account's password, which the run
 * and the next ones sign in with, so its submitting scenarios never run there.
 */
export function changesCredentials(form: DiscoveredForm): boolean {
  return form.fields.some((f) => f.type === "password") && !isSignInForm(form);
}

/** Form-scoped checks that never submit their form: they still run on a form that changes credentials. */
export const NEVER_SUBMITS: ReadonlySet<string> = new Set(["credential-fields"]);

/** Why a scenario on a form that sets a password is not run while signed in (its notes). */
export function credentialFormNote(label: string): string {
  return `Not run while signed in: this form sets a password, so submitting it could change ${label}'s password, which this run and the next ones sign in with.`;
}

/** Statuses a sign-in form answers made-up credentials with. */
export function isRefusedSignIn(form: DiscoveredForm, status: number | null | undefined): boolean {
  return isSignInForm(form) && typeof status === "number" && [400, 401, 403, 422].includes(status);
}

/** Why a check that needs a saved record does not run on a sign-in form (a skipped scenario's note). */
export const SIGN_IN_NOTE =
  "Skipped: this is a sign-in form. Run Hound only has made-up credentials, which the app rightly refuses, and signing in saves nothing, so there is no record to check.";

/** Why a check that intercepts a JavaScript save request does not run on a classic form post (a skipped scenario's note). */
export const PAGE_POST_NOTE =
  "Skipped: this form is sent as a regular page post (the browser loads the server's answer as a new page), not by JavaScript, so there is no save request for this check to work with.";

/** A small, valid HTML page Run Hound answers a stopped page post with, so nothing reaches the app. */
export const STOPPED_PAGE_POST_HTML =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Stopped by Run Hound</title></head><body><main><h1>Stopped by Run Hound</h1><p>Run Hound stopped this form post before it reached the app.</p></main></body></html>';

/**
 * route.fulfill() options for a response Run Hound makes up (a simulated 500, a captured save answered 201). It is
 * marked with SIMULATED_RESPONSE_HEADER, and a request to another origin (an API on another port) gets CORS headers
 * for the page's origin, or the browser would hide the answer from the page and report a network error instead.
 */
export function simulatedResponse(
  request: Request,
  status: number,
  body: string,
  contentType = "application/json",
): { status: number; contentType: string; headers: Record<string, string>; body: string } {
  const headers: Record<string, string> = { [SIMULATED_RESPONSE_HEADER]: "1" };
  const origin = request.headers()["origin"];
  if (origin && origin !== "null" && !isSameOrigin(request.url(), origin)) {
    headers["access-control-allow-origin"] = origin;
    headers["access-control-allow-credentials"] = "true";
    headers["vary"] = "Origin";
  }
  return { status, contentType, headers, body };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Polls `test` every 100 ms until it is true or `timeoutMs` passes. Returns whether it became true. */
export async function waitFor(test: () => boolean | Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    if (await test()) return true;
    if (Date.now() >= end) return false;
    await sleep(100);
  }
}

/** Waits for network idle without failing when the page never settles. */
export async function settle(page: Page, timeoutMs = 5000): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: timeoutMs }).catch(() => undefined);
}

/**
 * How long after a submit click a create request may take to show up. The click resolves before the page's
 * fetch() reaches the capture (the request event arrives asynchronously), and later still on a busy machine.
 */
export const CREATE_GRACE_MS = 2_000;

/**
 * Called right after a submit: waits until the create request has shown up and every create request so far
 * has a response or failed, then for the page to settle. Returns early when the page navigates (a GET form
 * or a full-page post) and gives up on seeing a request after CREATE_GRACE_MS (client-side validation
 * blocked the submit, or the form sends nothing).
 *
 * "No create request yet" is not "all create requests finished": the request event can arrive after the
 * click resolves, and settle() does not wait for it (network idle was already reached when the page loaded).
 */
export async function waitForCreates(page: Page, capture: Capture, pageUrl: string, timeoutMs = 10_000, runToken = ""): Promise<void> {
  const startUrl = page.url();
  const graceEnd = Date.now() + Math.min(CREATE_GRACE_MS, timeoutMs);
  await waitFor(() => {
    const creates = createRequests(capture, pageUrl, runToken);
    if (creates.length === 0) return page.url() !== startUrl || Date.now() >= graceEnd;
    return creates.every((r) => r.status !== null || r.failure !== null);
  }, timeoutMs);
  await settle(page);
}

export { sleep };
