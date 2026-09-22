/**
 * Findings, evidence and exported Playwright specs for the behaviour checks.
 * Evidence is redacted here, so checks can pass raw captured data.
 */
import { redactSecrets } from "../../engine/redact.js";
import type { Capture, Category, CheckContext, CheckId, CheckResult, Evidence, Finding, Scenario, Severity } from "../../core/types.js";
import { fieldName, type FieldValue } from "./functional-form.js";

/** Deep-copies `data` with every string passed through redactSecrets and cut to a readable length. */
export function redactData(data: unknown, maxString = 2000): unknown {
  if (typeof data === "string") {
    const clean = redactSecrets(data);
    return clean.length > maxString ? `${clean.slice(0, maxString)}…[truncated]` : clean;
  }
  if (Array.isArray(data)) return data.map((d) => redactData(d, maxString));
  if (data && typeof data === "object") {
    return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, redactData(v, maxString)]));
  }
  return data;
}

export function evidence(kind: Evidence["kind"], label: string, data: unknown): Evidence {
  return { kind, label, data: redactData(data) };
}

/** A captured request as a small, redacted evidence payload. */
export function requestSummary(r: Capture["requests"][number], withBody = false) {
  return {
    method: r.method,
    url: r.url,
    status: r.status,
    failure: r.failure,
    ...(withBody ? { requestBody: r.postData, responseBody: r.responseBody } : {}),
  };
}

export interface FindingInput {
  title: string;
  severity: Severity;
  meaning: string;
  impact: string;
  fix: string;
  location?: string;
  evidence: Evidence[];
  spec: { name: string; source: string };
}

/** Builds findings with ids "<checkId>#<scenarioId>-<n>" so they stay unique across scenarios. */
export function findingFactory(checkId: CheckId, category: Category, scenario: Scenario) {
  let n = 0;
  return (input: FindingInput): Finding => {
    n += 1;
    const slug = input.spec.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "finding";
    return {
      checkId,
      id: `${checkId}#${scenario.id}-${n}`,
      title: input.title,
      severity: input.severity,
      category,
      confidence: "confirmed",
      meaning: input.meaning,
      impact: input.impact,
      fix: input.fix,
      ...(input.location ? { location: input.location } : {}),
      evidence: input.evidence,
      spec: { filename: `${checkId}-${slug}-${n}.spec.ts`, source: redactSecrets(input.spec.source) },
    };
  };
}

/** Result from findings: "fail" when there are any, else "pass". */
export function result(
  checkId: CheckId,
  scenario: Scenario,
  started: number,
  findings: Finding[],
  notes?: string,
): CheckResult {
  return {
    checkId,
    scenarioId: scenario.id,
    status: findings.length > 0 ? "fail" : "pass",
    findings,
    durationMs: Date.now() - started,
    ...(notes ? { notes } : {}),
  };
}

export function errorResult(checkId: CheckId, scenario: Scenario, started: number, notes: string, status: "error" | "skipped" = "error"): CheckResult {
  return { checkId, scenarioId: scenario.id, status, findings: [], durationMs: Date.now() - started, notes };
}

/** Runs `body`, turning a thrown error into an "error" result instead of crashing the run. */
export async function guarded(
  checkId: CheckId,
  scenario: Scenario,
  ctx: CheckContext,
  body: (started: number) => Promise<CheckResult>,
): Promise<CheckResult> {
  const started = Date.now();
  try {
    return await body(started);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.log(`${checkId}: ${message}`);
    return errorResult(checkId, scenario, started, redactSecrets(message));
  }
}

/** Screenshot evidence that never fails the check (a closed page just means no screenshot). */
export async function tryScreenshot(ctx: CheckContext, page: import("playwright").Page, label: string): Promise<Evidence[]> {
  try {
    return [await ctx.screenshot(page, label)];
  } catch {
    return [];
  }
}

// ---------- Playwright spec export ----------

const q = (s: string) => JSON.stringify(s);

/** A role/label locator a person would write for a field, falling back to its CSS selector. */
export function fieldLocator(field: FieldValue["field"]): string {
  const name = field.accessibleName ?? field.label;
  if (name) return `page.getByLabel(${q(name)}, { exact: true })`;
  if (field.placeholder) return `page.getByPlaceholder(${q(field.placeholder)})`;
  return `page.locator(${q(field.selector)})`;
}

/** A role locator for a control, falling back to its CSS selector when it has no name. */
export function controlLocator(control: { accessibleName: string | null; role: string; selector: string; text?: string }): string {
  const role = ["button", "link", "checkbox", "tab", "menuitem", "switch"].includes(control.role) ? control.role : "button";
  if (control.accessibleName) return `page.getByRole(${q(role)}, { name: ${q(control.accessibleName)}, exact: true })`;
  return `page.locator(${q(control.selector)})`;
}

/** Spec lines that fill the form the way the check did. */
export function fillLines(values: FieldValue[]): string[] {
  const lines: string[] = [];
  for (const { field, value } of values) {
    if (field.options && field.options.length > 0) {
      const option = field.options.find((o) => o.label === value) ?? field.options[0]!;
      if (field.type === "select") lines.push(`await ${fieldLocator(field)}.selectOption({ label: ${q(option.label)} });`);
      else if (field.type === "radio") lines.push(`await page.getByRole("radio", { name: ${q(option.label)}, exact: true }).check();`);
      else lines.push(`await page.getByText(${q(option.label)}, { exact: true }).click(); // ${fieldName(field)}`);
      continue;
    }
    if (field.type === "checkbox") {
      if (field.required) lines.push(`await ${fieldLocator(field)}.check();`);
      continue;
    }
    if (["radio", "custom", "file", "hidden"].includes(field.type)) continue;
    lines.push(`await ${fieldLocator(field)}.fill(${q(value)});`);
  }
  return lines;
}

/** A complete @playwright/test file. The body lines run inside one test after page.goto(target). */
export function specSource(target: string, testName: string, body: string[]): string {
  return [
    `import { test, expect } from "@playwright/test";`,
    ``,
    `// Exported by Run Hound. Runs on its own: npx playwright test <this file>`,
    `const TARGET = ${q(target)};`,
    ``,
    `test(${q(testName)}, async ({ page }) => {`,
    `  await page.goto(TARGET);`,
    ...body.map((line) => (line ? `  ${line}` : "")),
    `});`,
    ``,
  ].join("\n");
}

/** Spec lines that record same-origin non-GET requests into `creates`. */
export const RECORD_CREATES = [
  `const creates: string[] = [];`,
  `page.on("request", (r) => {`,
  `  if (!["GET", "HEAD", "OPTIONS"].includes(r.method()) && new URL(r.url()).origin === new URL(TARGET).origin) creates.push(r.method() + " " + r.url());`,
  `});`,
];
