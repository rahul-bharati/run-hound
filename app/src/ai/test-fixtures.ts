/**
 * Builders shared by the AI tests: forms, pages, plans, findings and reports shaped like the engine's, plus a fake
 * LlmClient that records requests and answers from a script (no network). Not a test file itself.
 */
import type {
  DiscoveredForm,
  DiscoveredPage,
  Finding,
  FormControl,
  FormField,
  Plan,
  PlanGroup,
  Report,
  Scenario,
} from "../core/types.js";
import { CHECK_GROUPS } from "../core/types.js";
import type { AiProvider, JsonRequest, JsonSchema, LlmClient } from "./types.js";

/** Shaped like an AWS access key id, which redactSecrets replaces with "[REDACTED:aws-access-key]". */
export const FAKE_AWS_KEY = "AKIAIOSFODNN7EXAMPLE";
export const REDACTED_AWS = "[REDACTED:aws-access-key]";

/** Every selector in the fixtures contains this marker, so a test can check none reach the model. */
export const SELECTOR_MARKER = "sel-marker";

let selectorCounter = 0;
function sel(hint: string): string {
  selectorCounter += 1;
  return `#${SELECTOR_MARKER}-${hint}-${selectorCounter}`;
}

export function field(overrides: Partial<FormField> & { key: string }): FormField {
  return {
    accessibleName: overrides.key,
    label: overrides.key,
    placeholder: null,
    type: "text",
    role: "textbox",
    required: false,
    selector: sel(overrides.key),
    ...overrides,
  };
}

export function control(name: string, overrides: Partial<FormControl> = {}): FormControl {
  return {
    accessibleName: name,
    text: name,
    role: "button",
    tag: "button",
    selector: sel("control"),
    isSubmit: false,
    ...overrides,
  };
}

export const PAGE_URL = "http://localhost:5310/book?step=1";

/** Main form: name (required text), date (constraints), pet (select Dog/Cat/Bird), notes (textarea, maxLength 40).
 *  Controls: 0 "Add pet", 1 "Delete account" (destructive), 2 "Book" (submit). */
export function bookingForm(overrides: Partial<DiscoveredForm> = {}): DiscoveredForm {
  return {
    url: PAGE_URL,
    index: 0,
    selector: sel("form"),
    name: "Book a sitter",
    search: false,
    fields: [
      field({ key: "name", accessibleName: "Your name", label: "Your name", required: true }),
      field({ key: "date", accessibleName: "Date", label: "Date", type: "date", constraints: { min: "2026-01-01", max: "2026-12-31" } }),
      field({
        key: "pet",
        accessibleName: "Pet type",
        label: "Pet type",
        type: "select",
        role: "combobox",
        options: [
          { label: "Dog", selector: sel("opt") },
          { label: "Cat", selector: sel("opt") },
          { label: "Bird", selector: sel("opt") },
        ],
      }),
      field({ key: "notes", accessibleName: "Notes", label: "Notes", type: "textarea", constraints: { maxLength: 40 } }),
    ],
    controls: [control("Add pet"), control("Delete account"), control("Book", { isSubmit: true })],
    ...overrides,
  };
}

/** Second form: email field; control 0 "Subscribe" (submit). */
export function newsletterForm(overrides: Partial<DiscoveredForm> = {}): DiscoveredForm {
  return {
    url: PAGE_URL,
    index: 1,
    selector: sel("form"),
    name: "Newsletter",
    search: false,
    fields: [field({ key: "email", accessibleName: "Email", label: "Email", type: "email", required: true })],
    controls: [control("Subscribe", { isSubmit: true })],
    ...overrides,
  };
}

export function discoveredPage(overrides: Partial<DiscoveredPage> = {}): DiscoveredPage {
  return {
    url: PAGE_URL,
    title: "Book a sitter",
    forms: [bookingForm(), newsletterForm()],
    controls: [control("Log out"), control("Toggle menu")],
    links: 3,
    ...overrides,
  };
}

export function scenario(overrides: Partial<Scenario> & Pick<Scenario, "id" | "checkId">): Scenario {
  return {
    title: `Scenario ${overrides.id}`,
    description: `Tests ${overrides.id}`,
    kind: "golden",
    priority: "medium",
    destructive: false,
    defaultSelected: true,
    scope: "form",
    formIndex: 0,
    scopeLabel: "Book a sitter form",
    ...overrides,
  };
}

/** Built-in scenarios in plan order: accessibility, features (one destructive), security. */
export function builtInScenarios(): Scenario[] {
  return [
    scenario({ id: "axe:1", checkId: "axe-states", title: "Accessibility of every state", priority: "high" }),
    scenario({ id: "dead-control:1", checkId: "dead-control", title: "Click every button", priority: "high" }),
    scenario({ id: "double-submit:1", checkId: "double-submit", title: "Double-click submit", priority: "medium" }),
    scenario({ id: "persistence:1", checkId: "persistence", title: "Saved data survives a reload", priority: "low", destructive: true, defaultSelected: false }),
    scenario({ id: "security-headers:1", checkId: "security-headers", title: "Security headers", priority: "low", scope: "page", formIndex: undefined, scopeLabel: "Whole page" }),
  ];
}

/** Groups for the given scenarios, derived from their check's group (in CHECK_GROUPS order). */
export function groupsFor(scenarios: Scenario[]): PlanGroup[] {
  const groupOf: Record<string, PlanGroup["id"]> = {
    "axe-states": "accessibility",
    "focus-visible": "accessibility",
    "reflow-320": "accessibility",
    "dead-control": "features",
    "double-submit": "features",
    persistence: "features",
    "silent-failure": "features",
    "ai-flow": "features",
    "security-headers": "security",
    "verbose-errors": "security",
  };
  return CHECK_GROUPS.map((g) => ({
    id: g.id,
    label: g.label,
    scenarioIds: scenarios.filter((s) => groupOf[s.checkId] === g.id).map((s) => s.id),
  })).filter((g) => g.scenarioIds.length > 0);
}

export function makePlan(overrides: { page?: DiscoveredPage; scenarios?: Scenario[] } = {}): Plan {
  const page = overrides.page ?? discoveredPage();
  const scenarios = overrides.scenarios ?? builtInScenarios();
  return {
    target: page.url,
    form: page.forms[0] ?? { url: page.url, selector: "body", name: null, fields: [], controls: [] },
    page,
    scenarios,
    groups: groupsFor(scenarios),
  };
}

export function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    checkId: "double-submit",
    id: "double-submit#1",
    title: "Double click books twice",
    severity: "high",
    category: "broken-feature",
    confidence: "confirmed",
    meaning: "Clicking Book twice quickly sends two bookings.",
    impact: "Customers get charged twice.",
    fix: "Disable the Book button while the request is pending.",
    location: "Book button",
    scope: "Book a sitter form",
    evidence: [
      {
        kind: "frame",
        label: "After the double-click",
        path: "double-submit/evidence-path-marker.png",
        data: { token: "evidence-data-marker" },
        facts: [{ label: "Requests sent", value: "2" }],
      },
    ],
    ...overrides,
  };
}

export function makeReport(findings: Finding[]): Report {
  const plan = makePlan();
  return {
    runId: "run-2026-09-25-abc",
    target: plan.target,
    startedAt: "2026-09-25T10:00:00.000Z",
    finishedAt: "2026-09-25T10:01:00.000Z",
    durationMs: 60_000,
    groups: [],
    runHoundVersion: "0.3.0",
    plan,
    approved: plan.scenarios.map((s) => s.id),
    results: [{ checkId: "double-submit", scenarioId: "double-submit:1", status: findings.length ? "fail" : "pass", findings, durationMs: 100 }],
    findings,
    summary: { critical: 0, high: findings.length, medium: 0, low: 0, passed: 0, failed: 1, errored: 0, skipped: 0 },
    notVisible: ["Server logs"],
  };
}

/** One scripted answer: a value (run through request.validate), an Error to reject with, or a function of the request. */
export type FakeAnswer = unknown | Error | ((request: JsonRequest<unknown>, call: number) => unknown);

/**
 * A fake LlmClient. Each call takes the next scripted answer (the last one repeats), waits a tick so overlapping
 * calls would show in `maxInFlight`, then returns request.validate(answer) so validation runs as in the real client.
 */
export class FakeClient implements LlmClient {
  readonly provider: AiProvider;
  readonly model: string;
  readonly requests: JsonRequest<unknown>[] = [];
  inFlight = 0;
  maxInFlight = 0;
  private readonly answers: FakeAnswer[];

  constructor(answers: FakeAnswer[], options: { provider?: AiProvider; model?: string } = {}) {
    this.answers = answers;
    this.provider = options.provider ?? "ollama";
    this.model = options.model ?? "ornith-1.5:9b";
  }

  async generateJson<T>(request: JsonRequest<T>): Promise<T> {
    const call = this.requests.length;
    this.requests.push(request as JsonRequest<unknown>);
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      await new Promise((resolve) => setTimeout(resolve, 2));
      const scripted = this.answers[Math.min(call, this.answers.length - 1)];
      const value = typeof scripted === "function" ? (scripted as (r: JsonRequest<unknown>, c: number) => unknown)(request as JsonRequest<unknown>, call) : scripted;
      if (value instanceof Error) throw value;
      return request.validate(value);
    } finally {
      this.inFlight -= 1;
    }
  }
}

/** Every string found anywhere in a JSON-like value. */
export function allStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(allStrings);
  if (value && typeof value === "object") return Object.values(value).flatMap(allStrings);
  return [];
}

/**
 * Problems that make a schema non-portable: an object without additionalProperties false, a property missing from
 * `required`, or a numeric/length limit. Empty when portable. Walks properties, items, anyOf/oneOf.
 */
export function schemaProblems(schema: JsonSchema, path = "$"): string[] {
  const problems: string[] = [];
  for (const limit of ["minLength", "maxLength", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minItems", "maxItems", "pattern", "multipleOf"]) {
    if (limit in schema) problems.push(`${path}: has ${limit}`);
  }
  const type = schema.type;
  const isObject = type === "object" || (Array.isArray(type) && type.includes("object"));
  if (isObject) {
    if (schema.additionalProperties !== false) problems.push(`${path}: additionalProperties is not false`);
    const props = (schema.properties ?? {}) as Record<string, JsonSchema>;
    const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
    for (const key of Object.keys(props)) {
      if (!required.includes(key)) problems.push(`${path}.${key}: not required`);
      problems.push(...schemaProblems(props[key]!, `${path}.${key}`));
    }
  }
  if (schema.items && typeof schema.items === "object") problems.push(...schemaProblems(schema.items as JsonSchema, `${path}[]`));
  for (const k of ["anyOf", "oneOf", "allOf"]) {
    const list = schema[k];
    if (Array.isArray(list)) list.forEach((s, i) => problems.push(...schemaProblems(s as JsonSchema, `${path}.${k}[${i}]`)));
  }
  return problems;
}
