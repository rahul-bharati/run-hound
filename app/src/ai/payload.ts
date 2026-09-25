import type { Plan } from "../core/types.js";
import { notImplemented } from "./not-implemented.js";

/** What the model is told about the page. Built only from the plan; no selectors, values, cookies or bodies. */
export interface PagePayload {
  /** Path and query of the page, plus the origin only when `remote` is false ("http://localhost:5310/book" vs "/book"). */
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

/**
 * Builds the payload. Every string passes through redactSecrets (engine/redact.ts) and is cut to 200 characters;
 * field and control names use fieldName/controlName (checks/lib/functional-form.ts); `destructive` uses
 * isDestructiveControl (checks/dead-control.ts). At most 5 forms, 40 fields per form, 40 controls.
 */
export function describePage(plan: Plan, options: { remote: boolean }): PagePayload {
  return notImplemented("describePage");
}
