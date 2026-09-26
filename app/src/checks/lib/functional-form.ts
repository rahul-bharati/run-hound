/**
 * Shared helpers for the behaviour checks: canary values, filling and submitting the discovered form,
 * and recognising the create request. Everything works from the DiscoveredForm, never from app-specific names.
 */
import type { Page, Request } from "playwright";
import { isSameOrigin as sameOriginCore, isSaveRequest } from "../../core/saves.js";
import { SIMULATED_RESPONSE_HEADER, type Capture, type DiscoveredForm, type FormControl, type FormField } from "../../core/types.js";
import { fieldKind, firstChoice, isConsentCheckbox, meansYes, setField, showsLabel, type FieldSetting } from "./widgets.js";

/** What the checks put into one field. Choice fields record the option they picked. */
export interface FieldValue {
  field: FormField;
  /** Text typed into the field, or the chosen option's label for radios / selects / custom pickers. */
  value: string;
  /** True when `value` is a unique canary that should show up again (free-text fields only). */
  canary: boolean;
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

function fit(value: string, field: FormField): string {
  const max = field.constraints?.maxLength;
  return max && max > 0 && value.length > max ? value.slice(0, max) : value;
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
        } else {
          values.push({ field, value: fit(`${nameWord(field)} ${tag}`, field), canary: true });
        }
      }
    }
  }
  return values;
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
