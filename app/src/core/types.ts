/**
 * Shared contract for the Run Hound V0 engine and check library.
 * Checks only depend on this file; the engine only calls checks through it.
 */
import type { Browser, BrowserContext, Page } from "playwright";

export type Severity = "critical" | "high" | "medium" | "low";

export type Category = "broken-feature" | "validation" | "accessibility" | "security";

/** Stable ids for the V0 checks, in the order they run. */
export const CHECK_IDS = [
  "console-network-errors",
  "dead-control",
  "silent-failure",
  "persistence",
  "double-submit",
  "axe-states",
  "keyboard-completion",
  "focus-visible",
  "error-announcement",
  "credential-fields",
  "bundle-secrets",
  "pii-leak",
  "verbose-errors",
  "reflow-320",
  "client-only-validation",
] as const;

export type CheckId = (typeof CHECK_IDS)[number];

/** A form control found on the target page, described by how a user reaches it. */
export interface FormField {
  /** Stable key within the form: the name attribute, else id, else a generated key. */
  key: string;
  /** Accessible name as computed by the browser (label, aria-label, ...), or null if none. */
  accessibleName: string | null;
  /** Visible label text, if a <label> is associated. */
  label: string | null;
  placeholder: string | null;
  /** input type, "textarea", "select", or "custom" for non-native widgets (e.g. clickable divs). */
  type: string;
  /** ARIA role as exposed in the accessibility tree ("textbox", "combobox", "radio", "generic", ...). */
  role: string;
  required: boolean;
  /** CSS selector that uniquely finds the control on the page. */
  selector: string;
  /** For radio groups, selects and custom pickers: the options a user can choose. */
  options?: { label: string; selector: string }[];
  /** Native constraints, when present. */
  constraints?: { min?: string; max?: string; minLength?: number; maxLength?: number; pattern?: string };
}

export interface FormControl {
  /** Accessible name, or null if the control has none. */
  accessibleName: string | null;
  /** Visible text content, trimmed. */
  text: string;
  role: string;
  tag: string;
  selector: string;
  /** True for the control that submits the form. */
  isSubmit: boolean;
}

export interface DiscoveredForm {
  url: string;
  /** Selector of the <form> element (or the container acting as one). */
  selector: string;
  /** Heading or accessible name that identifies the form, e.g. "Book a sitter". */
  name: string | null;
  fields: FormField[];
  /** Buttons and clickable controls inside the form, including the submit control. */
  controls: FormControl[];
}

export type EvidenceKind = "screenshot" | "network" | "console" | "dom" | "axe" | "note";

export interface Evidence {
  kind: EvidenceKind;
  label: string;
  /** Path relative to the run's artifacts directory (screenshots, HAR slices, etc.). */
  path?: string;
  /** Small structured payload (request summary, axe node, console line). Secrets must already be redacted. */
  data?: unknown;
}

export interface Finding {
  checkId: CheckId;
  /** Unique within a run, e.g. "double-submit#1". */
  id: string;
  title: string;
  severity: Severity;
  category: Category;
  /** "confirmed" = decided by a deterministic assertion; "advisory" = relies on judgement. */
  confidence: "confirmed" | "advisory";
  /** Plain-language explanation for non-technical readers. */
  meaning: string;
  impact: string;
  /** What to ask your AI (or developer) to fix. */
  fix: string;
  /** Where on the page, as a user would describe it: "Pet type picker", "Book button". */
  location?: string;
  evidence: Evidence[];
  /** Playwright spec that reproduces the finding, as source text. */
  spec?: { filename: string; source: string };
}

export type ResultStatus = "pass" | "fail" | "error" | "skipped";

export interface CheckResult {
  checkId: CheckId;
  scenarioId: string;
  status: ResultStatus;
  findings: Finding[];
  durationMs: number;
  /** Why it was skipped or errored, or a short note on what was verified. */
  notes?: string;
}

/** One line of the test plan the user approves. */
export interface Scenario {
  id: string;
  checkId: CheckId;
  title: string;
  description: string;
  kind: "golden" | "danger";
  priority: "high" | "medium" | "low";
  /** Scenarios that could change or delete data beyond creating test records. Off unless the user opts in. */
  destructive: boolean;
  defaultSelected: boolean;
}

/** Network and console activity recorded for one page. */
export interface Capture {
  requests: {
    url: string;
    method: string;
    resourceType: string;
    postData: string | null;
    status: number | null;
    failure: string | null;
    /** Response body for same-origin JSON/text responses (truncated), else null. */
    responseBody: string | null;
  }[];
  console: { type: string; text: string }[];
  pageErrors: string[];
}

export interface CheckContext {
  browser: Browser;
  form: DiscoveredForm;
  targetUrl: string;
  /** Absolute directory for this check's artifacts. */
  artifactsDir: string;
  allowDestructive: boolean;
  /** Unique token for this run; use it in canary values so runs don't collide. */
  runToken: string;
  /** Opens a fresh context + page on the target with network/console capture attached. */
  openPage(options?: { viewport?: { width: number; height: number } }): Promise<{
    context: BrowserContext;
    page: Page;
    capture: Capture;
  }>;
  /** Saves a screenshot under artifactsDir and returns evidence pointing at it. */
  screenshot(page: Page, label: string): Promise<Evidence>;
  log(message: string): void;
}

export interface Check {
  id: CheckId;
  title: string;
  category: Category;
  /** Scenarios this check proposes for the given form; empty if it does not apply. */
  plan(form: DiscoveredForm): Scenario[];
  run(ctx: CheckContext, scenario: Scenario): Promise<CheckResult>;
}

export interface Plan {
  target: string;
  form: DiscoveredForm;
  scenarios: Scenario[];
}

export interface Report {
  runId: string;
  target: string;
  startedAt: string;
  finishedAt: string;
  runHoundVersion: string;
  plan: Plan;
  /** Ids of the scenarios the user approved. */
  approved: string[];
  results: CheckResult[];
  findings: Finding[];
  summary: { critical: number; high: number; medium: number; low: number; passed: number; failed: number; errored: number; skipped: number };
  /** Things a browser can't see; always listed so a clean report isn't mistaken for a clean app. */
  notVisible: string[];
}
