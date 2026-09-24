/**
 * Filling and submitting the discovered form with valid test data (mouse/programmatic, not keyboard-only).
 * Used by axe-states (success and server-error states) and pii-leak.
 */
import { createHash } from "node:crypto";
import type { Page, Response } from "playwright";
import type { DiscoveredForm, FormField } from "../../core/types.js";
import { submitControl } from "./a11y-common.js";
import { controlLocator, fieldLocator } from "./functional-finding.js";

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

/** A valid-looking value for a text-like field, or null when the field is not text-like. */
export function textValueFor(field: FormField, values: Canaries): string | null {
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

/** Which fields fillValid fills: required ones, plus email/phone fields (canary carriers) and custom pickers. */
function shouldFill(field: FormField): boolean {
  if (field.type === "password") return field.required;
  return field.required || field.type === "email" || field.type === "tel" || field.type === "custom";
}

type FillAction =
  | { op: "click"; selector: string }
  | { op: "check"; selector: string }
  | { op: "select"; selector: string; label: string }
  | { op: "fill"; selector: string; value: string };

/** The steps fillValid takes. Passwords are only filled when one is required (all with the same value). */
export function fillActions(form: DiscoveredForm, values: Canaries): FillAction[] {
  const anyPasswordRequired = form.fields.some((f) => f.type === "password" && f.required);
  const actions: FillAction[] = [];
  for (const field of form.fields) {
    if (!shouldFill(field) && !(anyPasswordRequired && field.type === "password")) continue;
    const first = field.options?.[0];
    if (field.type === "radio" || field.type === "custom") {
      if (first) actions.push({ op: "click", selector: first.selector });
    } else if (field.type === "checkbox") {
      actions.push({ op: "check", selector: field.selector });
    } else if (field.type === "select" || field.type === "select-one") {
      if (first) actions.push({ op: "select", selector: field.selector, label: first.label });
    } else {
      const value = textValueFor(field, values);
      if (value !== null) actions.push({ op: "fill", selector: field.selector, value });
    }
  }
  return actions;
}

/** Fills the form with valid values (see fillActions). */
export async function fillValid(page: Page, form: DiscoveredForm, values: Canaries): Promise<void> {
  for (const a of fillActions(form, values)) {
    const target = page.locator(a.selector).first();
    if (a.op === "click") await target.click();
    else if (a.op === "check") await target.check();
    else if (a.op === "select") await target.selectOption({ label: a.label });
    else await target.fill(a.value);
  }
}

/**
 * Playwright source lines that fill the form like fillValid and click submit, for exported specs. Uses the same
 * role/label/placeholder locators as the behaviour checks' specs (never positional CSS), so a spec keeps working
 * after the developer fixes an unrelated bug that changes the page's structure.
 */
export function fillAndSubmitSpec(form: DiscoveredForm, values: Canaries): string {
  const q = (v: string) => JSON.stringify(v);
  const anyPasswordRequired = form.fields.some((f) => f.type === "password" && f.required);
  const lines: string[] = [];
  for (const field of form.fields) {
    if (!shouldFill(field) && !(anyPasswordRequired && field.type === "password")) continue;
    const first = field.options?.[0];
    if (field.type === "radio") {
      if (first) lines.push(`await page.getByRole("radio", { name: ${q(first.label)}, exact: true }).check();`);
    } else if (field.type === "custom") {
      // Clicking the option's text also works once the picker becomes a native radio group (the text is its label).
      if (first) lines.push(`await page.getByText(${q(first.label)}, { exact: true }).first().click();`);
    } else if (field.type === "checkbox") {
      lines.push(`await ${fieldLocator(field)}.check();`);
    } else if (field.type === "select" || field.type === "select-one") {
      if (first) lines.push(`await ${fieldLocator(field)}.selectOption({ label: ${q(first.label)} });`);
    } else {
      const value = textValueFor(field, values);
      if (value !== null) lines.push(`await ${fieldLocator(field)}.fill(${q(value)});`);
    }
  }
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
 * Clicks the submit control and waits for the first same-origin non-GET response (the create request).
 * Returns null when no such request happened within `timeoutMs`.
 */
export async function submitAndWait(page: Page, form: DiscoveredForm, timeoutMs = 10_000): Promise<Response | null> {
  const submit = submitControl(form);
  if (!submit) return null;
  const response = page
    .waitForResponse((r) => r.request().method() !== "GET" && sameOrigin(r.url(), page.url()), { timeout: timeoutMs })
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
