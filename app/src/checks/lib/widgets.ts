/**
 * Setting the value of any discovered field, native or not (0.4.0). Both fill paths (a11y-form.ts fillValid and
 * functional-form.ts fillForm) and the AI flow runner go through setField, so a Radix Select, a cmdk combobox, a
 * Radix Checkbox/Switch/RadioGroup or a slider is filled the same way everywhere.
 */
import type { Page } from "playwright";
import { notImplemented } from "../../ai/not-implemented.js";
import type { FormField } from "../../core/types.js";

/**
 * What to set: text for text-like fields and comboboxes; an option label for selects and radio groups ("first" = the
 * first real option); true/false for checkboxes and switches; a number for sliders (clamped to the slider's range).
 */
export type FieldSetting = { text: string } | { option: string | "first" } | { checked: boolean } | { number: number };

/**
 * Sets `field` to `setting` like a user would, and resolves once the widget shows the new value (a native control's
 * value, aria-checked, the select trigger's text, aria-valuenow). Widgets with a nativeSelector are set through it when
 * that is reliable, else by clicking/typing on the visible control. Throws an Error with a plain message naming the
 * field when the value can't be set within 5 s.
 */
export async function setField(page: Page, field: FormField, setting: FieldSetting): Promise<void> {
  void page;
  void field;
  void setting;
  return notImplemented("setField");
}

/**
 * Playwright source lines (for exported specs) that set the field the way setField does, using role/label locators
 * (never CSS), e.g. `await page.getByRole("combobox", { name: "Team size" }).click();` then
 * `await page.getByRole("option", { name: "6–20" }).click();`.
 */
export function setFieldSpec(field: FormField, setting: FieldSetting): string[] {
  void field;
  void setting;
  return notImplemented("setFieldSpec");
}
