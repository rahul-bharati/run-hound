/**
 * Findings, evidence and exported Playwright specs for the behaviour checks.
 * Evidence is redacted here, so checks can pass raw captured data.
 */
import { cleanErrorMessage } from "../../engine/errors.js";
import { redactSecrets } from "../../engine/redact.js";
import type { Page } from "playwright";
import type { Capture, Category, CheckContext, CheckId, CheckResult, Evidence, EvidenceCard, Finding, FrameOptions, Scenario, Severity } from "../../core/types.js";
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
  /** Every place a grouped finding covers (more than one); the location is the first. */
  locations?: string[];
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
      ...(input.locations && input.locations.length > 1 ? { locations: input.locations } : {}),
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
    // One plain line in the report: never Playwright's call log.
    return errorResult(checkId, scenario, started, redactSecrets(cleanErrorMessage(message)));
  }
}

/** Screenshot evidence that never fails the check (a closed page just means no screenshot). */
export async function tryScreenshot(ctx: CheckContext, page: Page, label: string): Promise<Evidence[]> {
  try {
    return [await ctx.screenshot(page, label)];
  } catch {
    return [];
  }
}

// ---------- Visual evidence (frames, cards, GIFs) ----------
// Evidence must never fail the check: a page that closed or a render that broke just means one image less.

/** An annotated frame of `page`, or nothing if it could not be taken. */
export async function tryCapture(ctx: CheckContext, page: Page, label: string, options: FrameOptions = {}): Promise<Evidence[]> {
  try {
    return [await ctx.capture(page, label, options)];
  } catch (err) {
    ctx.log(`could not capture "${label}": ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

/** A text card, or nothing if it could not be rendered. */
export async function tryCard(ctx: CheckContext, label: string, card: EvidenceCard): Promise<Evidence[]> {
  try {
    return [await ctx.captureCard(label, card)];
  } catch (err) {
    ctx.log(`could not render card "${label}": ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

/** A recording whose steps also go to the live view, and that never throws. */
export interface FlowRecording {
  /** Reports the step to the live view and adds an annotated frame to the GIF. */
  step(label: string, options?: Omit<FrameOptions, "step" | "fullPage">): Promise<void>;
  /** The GIF evidence, or nothing when fewer than two frames were captured (one frame is not a flow). */
  finish(label?: string): Promise<Evidence[]>;
}

export function recordFlow(ctx: CheckContext, page: Page, label: string): FlowRecording {
  const recording = ctx.record(page, label);
  let frames = 0;
  return {
    async step(stepLabel, options) {
      ctx.step(stepLabel, page);
      try {
        await recording.step(stepLabel, options);
        frames += 1;
      } catch (err) {
        ctx.log(`could not record "${stepLabel}": ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    async finish(finishLabel) {
      if (frames < 2) return [];
      try {
        return [await recording.finish(finishLabel ? { label: finishLabel } : {})];
      } catch (err) {
        ctx.log(`could not encode "${label}": ${err instanceof Error ? err.message : String(err)}`);
        return [];
      }
    },
  };
}

/**
 * Marks up to `max` elements on the page whose visible text contains `needle` (the smallest element holding it,
 * widened to its list item / row / card when there is one) with data-rh-mark, and returns their selectors.
 * Used to point at things the check found by text: a saved record, a stack trace on the page.
 * Runs as a string so bundler helpers never leak into the page.
 */
export async function markText(page: Page, needle: string, mark: string, max = 3): Promise<string[]> {
  if (!needle) return [];
  const script = `(() => {
    const needle = ${JSON.stringify(needle)}, mark = ${JSON.stringify(mark)}, max = ${max};
    const shown = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const hits = [];
    for (const el of document.querySelectorAll("body *")) {
      if (["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"].includes(el.tagName)) continue;
      if (!(el.innerText || "").includes(needle) || !shown(el)) continue;
      // Smallest element: none of its children holds the whole needle.
      if (Array.from(el.children).some((c) => (c.innerText || "").includes(needle))) continue;
      hits.push(el.closest("li, tr, article, [role=listitem], [role=row], [role=alert], [role=status], pre") || el);
    }
    const unique = hits.filter((el, i) => hits.indexOf(el) === i).slice(0, max);
    return unique.map((el, i) => { el.setAttribute("data-rh-mark", mark + "-" + i); return '[data-rh-mark="' + mark + "-" + i + '"]'; });
  })()`;
  return ((await page.evaluate(script).catch(() => [])) as string[]) ?? [];
}

/** A request or response body as card lines: pretty JSON when it parses, else the raw text. */
export function bodyLines(body: string | null | undefined, maxLines = 30): string[] {
  if (!body) return ["(empty)"];
  let text = body;
  try {
    text = JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    // Form data reads best one field per line; anything else is shown as sent.
    if (/^[^\s=&]+=\S*$/.test(body)) text = body.split("&").join("\n");
  }
  const lines = text.replace(/\\n/g, "\n").split("\n");
  return lines.length > maxLines ? [...lines.slice(0, maxLines), `… ${lines.length - maxLines} more lines`] : lines;
}

/** Shortens long values (oversized test input) so a card line stays readable. */
export function clip(text: string, max = 160): string {
  return text.length > max ? `${text.slice(0, max)}… (${text.length} characters)` : text;
}

/** "POST /api/bookings" for a request URL on any origin. */
export function endpointOf(method: string, url: string): string {
  try {
    const u = new URL(url);
    return `${method} ${u.pathname}${u.search}`;
  } catch {
    return `${method} ${url}`;
  }
}

// ---------- Playwright spec export ----------

const q = (s: string) => JSON.stringify(s);

/** Roles getByRole can find a form field by; anything else (e.g. "generic") falls back to label or placeholder. */
const FIELD_ROLES = new Set(["textbox", "searchbox", "combobox", "listbox", "spinbutton", "slider", "checkbox", "radio", "switch", "radiogroup"]);

/**
 * A role/label locator a person would write for a field, falling back to its CSS selector.
 * getByLabel only matches <label>, aria-label and aria-labelledby, never a placeholder, so an accessible name that
 * came from the placeholder (a placeholder-only field) uses getByPlaceholder instead; otherwise the exported spec
 * would hang waiting for a label that does not exist.
 */
export function fieldLocator(field: FieldValue["field"]): string {
  if (field.label) return `page.getByLabel(${q(field.label)}, { exact: true })`;
  const name = field.accessibleName;
  if (name && name !== field.placeholder) {
    return FIELD_ROLES.has(field.role) ? `page.getByRole(${q(field.role)}, { name: ${q(name)}, exact: true })` : `page.getByLabel(${q(name)}, { exact: true })`;
  }
  // A placeholder-only field is usually fixed by adding a <label> with the same text (and dropping the placeholder),
  // so the spec also accepts that label; it keeps working once the accessibility bug is fixed.
  if (field.placeholder) return `page.getByPlaceholder(${q(field.placeholder)}, { exact: true }).or(page.getByLabel(${q(field.placeholder)}, { exact: true })).first()`;
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
      else lines.push(`await page.getByText(${q(option.label)}, { exact: true }).first().click(); // ${fieldName(field)}`);
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
