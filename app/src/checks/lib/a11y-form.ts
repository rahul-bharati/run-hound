/**
 * Filling and submitting the discovered form with valid test data (mouse/programmatic, not keyboard-only).
 * Used by axe-states (success and server-error states) and pii-leak.
 */
import { createHash } from "node:crypto";
import type { Page, Response } from "playwright";
import { isSaveRequest } from "../../core/saves.js";
import type { DiscoveredForm, FormField } from "../../core/types.js";
import { submitControl } from "./a11y-common.js";
import { controlLocator } from "./functional-finding.js";
import type { FillProblem } from "./functional-form.js";
import { fieldKind, hasEmptyChoice, isConsentCheckbox, setField, setFieldSpec, type FieldSetting } from "./widgets.js";

/** Test values that carry the run token, so they can be recognised in any request. */
export interface Canaries {
  email: string;
  phone: string;
  name: string;
  text: string;
  password: string;
}

/** Canary values for a run. The email is lowercase so its normalised SHA-256 matches what trackers send. */
export function canaries(runToken: string, variant = ""): Canaries {
  const token = runToken.toLowerCase().replace(/[^a-z0-9]/g, "") || "rh";
  const digits = String(parseInt(createHash("sha256").update(`${token}${variant}`).digest("hex").slice(0, 8), 16) % 10_000_000).padStart(7, "0");
  return {
    email: `runhound-${token}${variant}@example.com`,
    phone: `555${digits}`,
    name: `Rh ${token}${variant}`.slice(0, 40),
    text: `Run Hound test ${token}${variant}`,
    password: `Rh-${token}-Passw0rd!`,
  };
}

function isoDate(daysFromNow: number): string {
  const d = new Date(Date.now() + daysFromNow * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** True for a date field that looks like the end of a range ("End date", "checkout", "to"). */
function isEndDate(field: FormField): boolean {
  return /end|to\b|until|check-?out|return/i.test(`${field.key} ${field.label ?? ""} ${field.accessibleName ?? ""}`);
}

/**
 * A valid-looking value for a text-like field, or null when the field is not text-like. Widgets are never typed into,
 * except an autocomplete (aria-combobox), which takes text.
 */
export function textValueFor(field: FormField, values: Canaries): string | null {
  if (field.widget && field.widget !== "aria-combobox") return null;
  if (field.widget === "aria-combobox") return values.text;
  const max = field.constraints?.maxLength;
  const fit = (v: string) => (max && max > 0 ? v.slice(0, max) : v);
  switch (field.type) {
    case "email":
      return values.email;
    case "tel":
      return values.phone;
    case "date":
      return isEndDate(field) ? isoDate(33) : isoDate(30);
    case "number":
    case "range":
      return field.constraints?.min ?? "1";
    case "url":
      return "https://example.com";
    case "password":
      return values.password;
    case "text":
    case "search":
    case "textarea":
      if (/mail/i.test(field.key)) return values.email;
      if (/phone|tel/i.test(field.key)) return values.phone;
      return fit(/name/i.test(`${field.key} ${field.label ?? ""}`) ? values.name : values.text);
    default:
      return null;
  }
}

/**
 * Which fields fillValid fills: required ones (by attribute or by label), email/phone fields (canary carriers), custom
 * pickers, choices a form can't be sent without (a select or radio group, native or widget, that offers no empty
 * choice such as "None") and consent checkboxes (terms, privacy). Passwords only when one is required.
 */
function shouldFill(field: FormField): boolean {
  if (field.type === "password") return field.required;
  if (field.required || field.type === "email" || field.type === "tel" || field.type === "custom") return true;
  const kind = fieldKind(field);
  if (kind === "select" || kind === "radio") return !hasEmptyChoice(field);
  return isConsentCheckbox(field);
}

/** One step fillValid takes: set `field` with setField. */
export interface FillAction {
  field: FormField;
  setting: FieldSetting;
}

/** The setting fillValid gives a field it fills, or null when there is nothing to set (a slider keeps its value). */
function settingOf(field: FormField, values: Canaries): FieldSetting | null {
  switch (fieldKind(field)) {
    case "select":
    case "radio":
    case "custom":
    case "combobox":
      return { option: "first" };
    case "check":
      return { checked: true };
    case "slider":
    case "none":
      return null;
    case "text": {
      const value = textValueFor(field, values);
      return value === null ? null : { text: value };
    }
  }
}

/** The steps fillValid takes. Passwords are only filled when one is required (all with the same value). */
export function fillActions(form: DiscoveredForm, values: Canaries): FillAction[] {
  const anyPasswordRequired = form.fields.some((f) => f.type === "password" && f.required);
  const actions: FillAction[] = [];
  for (const field of form.fields) {
    if (!shouldFill(field) && !(anyPasswordRequired && field.type === "password")) continue;
    const setting = settingOf(field, values);
    if (setting) actions.push({ field, setting });
  }
  return actions;
}

/**
 * Fills the form with valid values (see fillActions) through setField. A field that can't be set doesn't stop the
 * fill; it is returned (an autocomplete that offers no suggestion gets typed text instead).
 */
export async function fillValid(page: Page, form: DiscoveredForm, values: Canaries): Promise<FillProblem[]> {
  const problems: FillProblem[] = [];
  for (const { field, setting } of fillActions(form, values)) {
    try {
      await setField(page, field, setting);
    } catch (err) {
      const text = fieldKind(field) === "combobox" ? textValueFor(field, values) : null;
      if (text !== null && (await setField(page, field, { text }).then(() => true, () => false))) continue;
      problems.push({ field, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return problems;
}

/**
 * Playwright source lines that fill the form like fillValid and click submit, for exported specs. Uses the same
 * role/label/placeholder locators as the behaviour checks' specs (never positional CSS), so a spec keeps working
 * after the developer fixes an unrelated bug that changes the page's structure.
 */
export function fillAndSubmitSpec(form: DiscoveredForm, values: Canaries): string {
  const lines = fillActions(form, values).flatMap((a) => setFieldSpec(a.field, a.setting));
  const submit = submitControl(form);
  if (submit) lines.push(`await ${controlLocator(submit)}.click();`);
  return lines.join("\n");
}

/** True when `url` is on the same origin as `base`. */
export function sameOrigin(url: string, base: string): boolean {
  try {
    return new URL(url).origin === new URL(base).origin;
  } catch {
    return false;
  }
}

/**
 * Clicks the submit control and waits for the form's save request to be answered (core/saves.ts: a non-GET request
 * to the target's origin, including a classic page post, or to another origin carrying the run's test values).
 * Returns its response, or null when no save request was answered within `timeoutMs`.
 * A page post answered with a redirect returns the 3xx response; the browser then loads the page it points to.
 */
export async function submitAndWait(
  page: Page,
  form: DiscoveredForm,
  options: { targetUrl?: string; runToken?: string; timeoutMs?: number } = {},
): Promise<Response | null> {
  const submit = submitControl(form);
  if (!submit) return null;
  const target = options.targetUrl ?? page.url();
  const response = page
    .waitForResponse(
      (r) => {
        const req = r.request();
        return isSaveRequest({ method: req.method(), resourceType: req.resourceType(), url: req.url(), postData: req.postData() }, target, options.runToken ?? "");
      },
      { timeout: options.timeoutMs ?? 10_000 },
    )
    .catch(() => null);
  await page.locator(submit.selector).first().click();
  const res = await response;
  await settle(page);
  return res;
}

/** Waits for network idle (bounded) plus a short pause for UI updates after a response. */
export async function settle(page: Page, pauseMs = 300): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
  await page.waitForTimeout(pauseMs);
}
