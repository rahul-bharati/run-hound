/**
 * Shared helpers for the behaviour checks: canary values, filling and submitting the discovered form,
 * and recognising the create request. Everything works from the DiscoveredForm, never from app-specific names.
 */
import type { Page, Request } from "playwright";
import { isSameOrigin as sameOriginCore, isSaveRequest } from "../../core/saves.js";
import { SIMULATED_RESPONSE_HEADER, type Capture, type DiscoveredForm, type FormControl, type FormField } from "../../core/types.js";

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
