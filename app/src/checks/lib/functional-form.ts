/**
 * Shared helpers for the behaviour checks: canary values, filling and submitting the discovered form,
 * and recognising the create request. Everything works from the DiscoveredForm, never from app-specific names.
 */
import type { Page, Request } from "playwright";
import type { Capture, DiscoveredForm, FormControl, FormField } from "../../core/types.js";

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
  const tag = `${token}${salt}`.toLowerCase().replace(/[^a-z0-9]/g, "");
  const dates = form.fields.filter((f) => f.type === "date");
  const start = isoDay(14);
  const values: FieldValue[] = [];
  let passwordValue: string | null = null;

  for (const field of form.fields) {
    const text = describe(field);
    if (field.options && field.options.length > 0) {
      values.push({ field, value: field.options[0]!.label, canary: false });
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
          // Capitalised words read like a name and satisfy most "letters only" rules.
          const word = (fieldName(field).split(/\s+/).pop() ?? "Value").replace(/[^A-Za-z]/g, "") || "Value";
          values.push({ field, value: fit(`${word} ${tag}`, field), canary: true });
        }
      }
    }
  }
  return values;
}

/** Fills every field. Choice fields get their chosen option clicked or checked; required checkboxes are checked. */
export async function fillForm(page: Page, values: FieldValue[]): Promise<void> {
  for (const { field, value } of values) {
    if (field.options && field.options.length > 0) {
      const option = field.options.find((o) => o.label === value) ?? field.options[0]!;
      if (field.type === "select" || field.role === "combobox" || field.role === "listbox") {
        await page.locator(field.selector).first().selectOption({ label: option.label }).catch(async () => {
          await page.locator(option.selector).first().click();
        });
      } else if (field.type === "radio") {
        await page.locator(option.selector).first().check({ force: true });
      } else {
        await page.locator(option.selector).first().click();
      }
      continue;
    }
    if (field.type === "checkbox") {
      if (field.required) await page.locator(field.selector).first().check();
      continue;
    }
    if (field.type === "radio" || field.type === "custom" || field.type === "file" || field.type === "hidden") continue;
    await page.locator(field.selector).first().fill(value);
  }
}

/** The form's submit control, if discovery found one. */
export function submitControl(form: DiscoveredForm): FormControl | undefined {
  return form.controls.find((c) => c.isSubmit);
}

/** Clicks the submit control, or presses Enter in the first text field when there is none. */
export async function submitForm(page: Page, form: DiscoveredForm, how: "click" | "dblclick" = "click"): Promise<void> {
  const submit = submitControl(form);
  if (submit) {
    const locator = page.locator(submit.selector).first();
    await (how === "dblclick" ? locator.dblclick() : locator.click());
    return;
  }
  const first = form.fields.find((f) => !f.options && f.type !== "checkbox");
  if (first) await page.locator(first.selector).first().press("Enter");
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** Same origin as the target page. */
export function isSameOrigin(url: string, pageUrl: string): boolean {
  const a = originOf(url);
  return a !== null && a !== "null" && a === originOf(pageUrl);
}

/**
 * A request that sends the form: a non-GET fetch/XHR (or form post) to the target's origin.
 * Third-party calls (analytics) never count.
 */
export function isCreateRequest(req: { method: string; resourceType: string; url: string }, pageUrl: string): boolean {
  return (
    !["GET", "HEAD", "OPTIONS"].includes(req.method.toUpperCase()) &&
    ["fetch", "xhr", "document"].includes(req.resourceType) &&
    isSameOrigin(req.url, pageUrl)
  );
}

/** Same as isCreateRequest, for a live Playwright request. */
export function isCreatePlaywrightRequest(req: Request, pageUrl: string): boolean {
  return isCreateRequest({ method: req.method(), resourceType: req.resourceType(), url: req.url() }, pageUrl);
}

/** Create requests recorded in the capture so far. */
export function createRequests(capture: Capture, pageUrl: string): Capture["requests"] {
  return capture.requests.filter((r) => isCreateRequest(r, pageUrl));
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

/** Waits until every create request so far has a response or failed, then for the page to settle. */
export async function waitForCreates(page: Page, capture: Capture, pageUrl: string, timeoutMs = 10_000): Promise<void> {
  await waitFor(() => createRequests(capture, pageUrl).every((r) => r.status !== null || r.failure !== null), timeoutMs);
  await settle(page);
}

export { sleep };
