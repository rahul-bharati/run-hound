import type { DiscoveredForm, FormControl, FormField, Plan, Scenario } from "../core/types.js";
import { fieldName, controlName } from "../checks/lib/functional-form.js";
import { isDestructiveControl } from "../checks/dead-control.js";
import { formLabel, WHOLE_PAGE } from "../engine/plan.js";
import { safeText } from "./schema.js";

/** What the model is told about the page. Built only from the plan; no selectors, values, cookies or bodies. */
export interface PagePayload {
  /**
   * Remote: the path only, never the query or hash (they can carry reset tokens, session ids or emails): "/book".
   * Local: origin, path and query, redacted; never the hash: "http://localhost:5310/book?step=1".
   */
  page: string;
  title: string | null;
  forms: {
    index: number;
    name: string;
    search: boolean;
    fields: {
      key: string;
      label: string | null;
      type: string;
      role: string;
      required: boolean;
      constraints: string | null; // "min 2026-01-01, maxLength 40"
      options: string[] | null; // option labels, at most 20
    }[];
    /** Index = position in DiscoveredForm.controls; FlowStep.control refers to it. */
    controls: { index: number; name: string; role: string; submit: boolean; destructive: boolean }[];
  }[];
  /** Controls outside the forms (names and roles only). */
  outsideControls: { name: string; role: string; destructive: boolean }[];
  /** Built-in scenarios, in plan order. */
  scenarios: { id: string; check: string; title: string; description: string; scope: string; destructive: boolean }[];
}

const MAX_TEXT = 200;
const MAX_FORMS = 5;
const MAX_FIELDS = 40;
const MAX_CONTROLS = 40;
const MAX_OPTIONS = 20;

const text = (value: string): string => safeText(value, MAX_TEXT);

/** The forms the plan tests: the page's forms (V1), else the single V0 form when it has anything in it. */
export function planForms(plan: Plan): DiscoveredForm[] {
  if (plan.page) return plan.page.forms;
  return plan.form.fields.length || plan.form.controls.length ? [plan.form] : [];
}

function pageText(url: string, remote: boolean): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return remote ? "/" : text(url.split("#")[0]!);
  }
  return remote ? text(parsed.pathname) : text(`${parsed.protocol}//${parsed.host}${parsed.pathname}${parsed.search}`);
}

function constraintsOf(field: FormField): string | null {
  const c = field.constraints;
  if (!c) return null;
  const parts: string[] = [];
  if (c.min !== undefined) parts.push(`min ${c.min}`);
  if (c.max !== undefined) parts.push(`max ${c.max}`);
  if (c.minLength !== undefined) parts.push(`minLength ${c.minLength}`);
  if (c.maxLength !== undefined) parts.push(`maxLength ${c.maxLength}`);
  if (c.pattern !== undefined) parts.push(`pattern ${c.pattern}`);
  return parts.length ? text(parts.join(", ")) : null;
}

function describeField(field: FormField): PagePayload["forms"][number]["fields"][number] {
  const name = fieldName(field);
  return {
    key: text(field.key),
    label: name === field.key ? null : text(name),
    type: text(field.type),
    role: text(field.role),
    required: field.required,
    constraints: constraintsOf(field),
    options: field.options ? field.options.slice(0, MAX_OPTIONS).map((o) => text(o.label)) : null,
  };
}

function describeControl(control: FormControl, index: number): PagePayload["forms"][number]["controls"][number] {
  return { index, name: text(controlName(control)), role: text(control.role), submit: control.isSubmit, destructive: isDestructiveControl(control) };
}

function scopeOf(scenario: Scenario): string {
  return text(scenario.scopeLabel ?? (scenario.scope === "page" ? WHOLE_PAGE : "form"));
}

/**
 * Builds the payload. `page` is the path only when `remote` (see PagePayload.page). Every string passes through redactSecrets (engine/redact.ts) and is cut to 200 characters;
 * field and control names use fieldName/controlName (checks/lib/functional-form.ts); `destructive` uses
 * isDestructiveControl (checks/dead-control.ts). At most 5 forms, 40 fields per form, 40 controls (per form and
 * outside the forms). A form's `index` is its position among the plan's forms (Plan.page.forms, or [Plan.form] for a
 * V0 plan); a field's `label` is null when its only name is its key. Suggested (ai-flow) scenarios are left out.
 */
export function describePage(plan: Plan, options: { remote: boolean }): PagePayload {
  const forms = planForms(plan)
    .slice(0, MAX_FORMS)
    .map((form, index) => ({
      index,
      name: text(formLabel(form, index)),
      search: form.search ?? false,
      fields: form.fields.slice(0, MAX_FIELDS).map(describeField),
      controls: form.controls.slice(0, MAX_CONTROLS).map(describeControl),
    }));
  const outside = plan.page?.controls ?? [];
  return {
    page: pageText(plan.page?.url ?? plan.target, options.remote),
    title: plan.page?.title ? text(plan.page.title) : null,
    forms,
    outsideControls: outside.slice(0, MAX_CONTROLS).map((c) => ({ name: text(controlName(c)), role: text(c.role), destructive: isDestructiveControl(c) })),
    scenarios: plan.scenarios
      .filter((s) => s.checkId !== "ai-flow")
      .map((s) => ({ id: text(s.id), check: s.checkId, title: text(s.title), description: text(s.description), scope: scopeOf(s), destructive: s.destructive })),
  };
}
