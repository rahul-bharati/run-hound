import type { DiscoveredForm, FlowExpectation, FlowStep, FormControl, FormField } from "../core/types.js";

const fieldName = (field: FormField): string => field.accessibleName ?? field.label ?? field.placeholder ?? field.key;

const controlName = (control: FormControl): string =>
  control.accessibleName ?? (control.text || `unnamed ${control.role === "button" || control.tag === "button" ? "button" : control.tag}`);

const clip = (text: string, max = 60): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** What an expectation asks for, in plain words (the same wording the ai-flow check uses). */
export function expectationWords(expect: FlowExpectation, text: string | null): string {
  switch (expect) {
    case "request-ok":
      return "a save request reaches the app and succeeds";
    case "text-visible":
      return `"${text ?? ""}" is shown on the page`;
    case "text-absent":
      return `"${text ?? ""}" is not shown on the page`;
    case "url-changes":
      return "the page address changes";
    case "no-errors":
      return "no page errors, console errors or failed requests";
    case "field-kept":
      return "every typed value is still in its field";
  }
}

/**
 * One step of an AI-suggested flow in human words, naming fields and controls as a user sees them:
 * 'Type "Rex" into Pet name', 'Click Book', 'Press Enter', 'Check that a save request reaches the app and succeeds'.
 * Falls back to the raw key or index when the form does not have it (an old or edited plan).
 */
export function flowStepWords(step: FlowStep, form: DiscoveredForm | undefined): string {
  switch (step.action) {
    case "fill": {
      const field = form?.fields.find((f) => f.key === step.field);
      return `Type "${clip(step.value)}" into ${field ? fieldName(field) : step.field}`;
    }
    case "choose": {
      const field = form?.fields.find((f) => f.key === step.field);
      return `Choose "${clip(step.option)}" in ${field ? fieldName(field) : step.field}`;
    }
    case "click": {
      const control = form?.controls[step.control];
      return `Click ${control ? controlName(control) : `control ${step.control + 1}`}`;
    }
    case "press":
      return `Press ${step.key}`;
    case "expect":
      return `Check that ${expectationWords(step.expect, step.text)}`;
  }
}
