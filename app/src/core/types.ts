/**
 * Shared contract for the Run Hound engine and check library (V0: one form; V1: every form and control on a page).
 * Checks only depend on this file; the engine only calls checks through it.
 */
import type { Browser, BrowserContext, Page } from "playwright";

export type Severity = "critical" | "high" | "medium" | "low";

export type Category = "broken-feature" | "validation" | "accessibility" | "security";

/** How checks are grouped in plans, progress and reports. */
export type CheckGroup = "accessibility" | "features" | "security";

/**
 * The groups in display and run order. Scenarios run group by group (in this order), keeping CHECK_IDS order
 * inside a group. "Features" covers broken features and validation.
 */
export const CHECK_GROUPS: readonly { id: CheckGroup; label: string; categories: readonly Category[] }[] = [
  { id: "accessibility", label: "Accessibility", categories: ["accessibility"] },
  { id: "features", label: "Features", categories: ["broken-feature", "validation"] },
  { id: "security", label: "Security", categories: ["security"] },
];

/** Stable ids for the checks, in the order they run (V0 checks first, then the checks added in V1). */
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
  // V1: page-wide checks.
  "page-controls",
  "security-headers",
  "cookie-flags",
  "cors",
  "source-maps",
] as const;

/** Checks added in V1 (single page). Everything else in CHECK_IDS shipped in V0. */
export const V1_CHECK_IDS: readonly CheckId[] = ["page-controls", "security-headers", "cookie-flags", "cors", "source-maps"];

export type CheckId = (typeof CHECK_IDS)[number];

/**
 * Response header a check sets when it answers a request itself (route.fulfill) instead of letting it reach the app,
 * so the engine never counts that answer as a test record the app created.
 */
export const SIMULATED_RESPONSE_HEADER = "x-run-hound-simulated";

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
  /** The field's autocomplete hint, lowercased ("email", "current-password"), when it has one. */
  autocomplete?: string;
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
  /** Position among DiscoveredPage.forms (0 = the main form, the one with the most fields). Absent in V0 plans. */
  index?: number;
  /** Selector of the <form> element (or the container acting as one). */
  selector: string;
  /** Heading or accessible name that identifies the form, e.g. "Book a sitter". */
  name: string | null;
  /**
   * True for a search form (role="search", inside <search>, only search fields, or a GET form with an action and
   * one or two short fields): it saves nothing, so checks that need a saved record leave it out. V1.
   */
  search?: boolean;
  fields: FormField[];
  /** Buttons and clickable controls inside the form, including the submit control. */
  controls: FormControl[];
}

/**
 * Everything testable on one page (V1): every form, main form first, and the interactive controls outside any form.
 */
export interface DiscoveredPage {
  url: string;
  /** The document title, trimmed; null when empty. */
  title: string | null;
  /** Every form (or form-like container) with at least one usable field, the main one (most fields) first; at most 5. */
  forms: DiscoveredForm[];
  /**
   * Buttons and button-like controls outside every form (toolbars, list actions, toggles, links that act as buttons:
   * href="#" or javascript:). Real links are left out: they navigate by definition.
   */
  controls: FormControl[];
  /** How many links with a real href the page has (not tested one by one in V1; a crawl is V3). */
  links: number;
}

/**
 * "frame": an annotated screenshot (see CheckContext.capture). "gif": an animated recording of a flow.
 * "card": a rendered text card (request, response, code excerpt, console lines).
 * "screenshot": a plain screenshot (legacy; new evidence should use "frame").
 */
export type EvidenceKind = "frame" | "gif" | "card" | "screenshot" | "network" | "console" | "dom" | "axe" | "note";

/** A rectangle in CSS pixels. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Something to mark on an evidence image: the element or area the finding is about. */
export interface Highlight {
  /** Element to mark, resolved when the frame is captured. Missing or hidden elements are listed in the frame's facts instead. */
  selector?: string;
  /** Page coordinates (CSS px) to mark when there is no selector. */
  box?: Box;
  /** Short callout printed next to the mark, e.g. "No focus ring", "Clicked twice". */
  label: string;
  /** "fail" (default) marks the problem; "pass" and "info" mark context. */
  tone?: "fail" | "pass" | "info";
}

/** A labelled piece of data behind a finding, printed on the frame and in the report, e.g. { label: "Requests sent", value: "2" }. */
export interface Fact {
  label: string;
  value: string;
}

export interface Evidence {
  kind: EvidenceKind;
  label: string;
  /** Path relative to the run's artifacts directory (PNG for frame/card/screenshot, GIF for gif). */
  path?: string;
  /** Small structured payload (request summary, axe node, console line). Secrets must already be redacted. */
  data?: unknown;
  /** Page URL when the evidence was captured (frames and GIFs). */
  url?: string;
  /** ISO 8601 time of capture (the first frame, for GIFs). */
  capturedAt?: string;
  /** What the check was doing, e.g. "Double-click Book". */
  step?: string;
  /** Browser viewport at capture time. */
  viewport?: { width: number; height: number };
  /** Marks drawn on the image, with boxes in the saved image's pixel coordinates. */
  highlights?: (Highlight & { box: Box })[];
  /** The data behind the finding; also printed on the image. Redacted. */
  facts?: Fact[];
  /** GIF only: number of frames and total play time of one loop. */
  frames?: number;
  durationMs?: number;
}

/** Options for an annotated evidence frame. */
export interface FrameOptions {
  highlights?: Highlight[];
  facts?: Fact[];
  /** One sentence printed under the screenshot, e.g. "Two save requests reached the server from one double-click." */
  caption?: string;
  /** What the check is doing, printed in the header ("Double-click Book"). */
  step?: string;
  /** Capture the whole page instead of the viewport. Default false: the viewport, scrolled so the first highlight is visible. */
  fullPage?: boolean;
}

/** A text card rendered as an image, for evidence that isn't visual (requests, responses, code, console lines). */
export interface EvidenceCard {
  /** e.g. "POST /api/bookings (sent twice)". */
  title: string;
  /** e.g. the script or request URL. */
  subtitle?: string;
  /** Monospace lines; `mark` highlights the line that proves the finding. Long lines are wrapped; at most 40 lines are shown. */
  lines: { text: string; mark?: boolean }[];
  /** Number printed next to the first line (default 1), so an excerpt of a file shows the file's own line numbers. */
  firstLineNumber?: number;
  facts?: Fact[];
}

/** A step-by-step recording that becomes an animated GIF. */
export interface Recording {
  /** Captures an annotated frame now (same annotations as capture()). Frames are shown in order. */
  step(label: string, options?: Omit<FrameOptions, "step" | "fullPage">): Promise<void>;
  /** Encodes the frames as a looping GIF under artifactsDir and returns its evidence. Rejects if no frames were captured. */
  finish(options?: { label?: string }): Promise<Evidence>;
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
  /**
   * Every place the same problem was found, when there is more than one (e.g. the 6 controls with no visible focus).
   * A check reports one finding per distinct problem, never one finding per element; the title states the count.
   */
  locations?: string[];
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
  /** What the check did, in order (from CheckContext.step), for "Reproduction steps". Secrets redacted. */
  steps?: { label: string; url: string; at: string }[];
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
  /**
   * What the scenario tests (V1): "form" scenarios test Plan.page.forms[formIndex] (0 when absent), "page" scenarios
   * test the page as a whole. Absent in V0 plans, which read as "form" on the only form.
   */
  scope?: "form" | "page";
  formIndex?: number;
  /** Human label of what is tested, e.g. "Book a sitter form" or "Whole page". Set by the planner. */
  scopeLabel?: string;
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
    /**
     * Response headers, lower-case names, for responses from the page's origin and other local origins (the app's
     * API on another port); multiple values of one header (set-cookie) joined with "\n". Absent for other responses
     * and until the response arrives.
     */
    responseHeaders?: Record<string, string>;
  }[];
  /** Console messages; `url` is where the message came from (for "Failed to load resource", the resource's URL). */
  console: { type: string; text: string; url?: string }[];
  pageErrors: string[];
}

export interface CheckContext {
  browser: Browser;
  /** The form this scenario tests. For page-scoped scenarios, the main form (or an empty form when there is none). */
  form: DiscoveredForm;
  /** The whole page as discovered (V1). Absent when a V0 plan is run. */
  discoveredPage?: DiscoveredPage;
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
  /** Saves a plain screenshot under artifactsDir. Legacy: prefer capture(). */
  screenshot(page: Page, label: string): Promise<Evidence>;
  /**
   * Saves an annotated evidence frame: a header with the page URL, capture time, check and step; the screenshot with
   * each highlight boxed and labelled; the caption; and a facts panel. Text on the frame is redacted.
   */
  capture(page: Page, label: string, options?: FrameOptions): Promise<Evidence>;
  /** Saves a text card (request, response, code excerpt) as an image with the same header. Text is redacted. */
  captureCard(label: string, card: EvidenceCard): Promise<Evidence>;
  /** Starts a step-by-step recording of `page` that finish() turns into an animated GIF. */
  record(page: Page, label: string): Recording;
  /** Tells the live view what the check is doing now ("Double-clicking Book"). Cheap; call it at every meaningful step. */
  step(label: string, page?: Page): void;
  log(message: string): void;
}

export interface Check {
  id: CheckId;
  title: string;
  category: Category;
  /**
   * "form" (default): planned once per form on the page, and run against that form. "page": planned once for the
   * page (with the main form, or an empty form when the page has none) and run against the page as a whole.
   */
  scope?: "form" | "page";
  /** Scenarios this check proposes for the given form (and page, in V1); empty if it does not apply. */
  plan(form: DiscoveredForm, page?: DiscoveredPage): Scenario[];
  run(ctx: CheckContext, scenario: Scenario): Promise<CheckResult>;
}

/** A group's scenarios within a plan, in run order. */
export interface PlanGroup {
  id: CheckGroup;
  label: string;
  scenarioIds: string[];
}

export interface Plan {
  target: string;
  /** The main form (Plan.page.forms[0]); an empty form (no fields, no controls) when the page has none. */
  form: DiscoveredForm;
  /** Every form and control on the page (V1). Absent in plans and reports written by V0. */
  page?: DiscoveredPage;
  /** In run order: grouped by CHECK_GROUPS order, CHECK_IDS order inside a group. */
  scenarios: Scenario[];
  /** Every group that has at least one scenario, in CHECK_GROUPS order. Empty groups are left out. */
  groups: PlanGroup[];
}

/** Results of one group in a report. */
export interface ReportGroup {
  id: CheckGroup;
  label: string;
  /** Approved scenarios of this group, in run order. */
  scenarioIds: string[];
  passed: number;
  failed: number;
  errored: number;
  skipped: number;
  /** Findings from this group's checks. */
  findings: number;
  /** Sum of the group's scenario durations. */
  durationMs: number;
}

export interface Report {
  runId: string;
  target: string;
  startedAt: string;
  finishedAt: string;
  /** Whole run, from the start of runPlan to the report being written: finishedAt minus startedAt, in ms. */
  durationMs: number;
  /** Per-group results for every group with at least one approved scenario, in CHECK_GROUPS order. */
  groups: ReportGroup[];
  runHoundVersion: string;
  plan: Plan;
  /** Ids of the scenarios the user approved. */
  approved: string[];
  results: CheckResult[];
  findings: Finding[];
  summary: { critical: number; high: number; medium: number; low: number; passed: number; failed: number; errored: number; skipped: number };
  /** Things a browser can't see; always listed so a clean report isn't mistaken for a clean app. */
  notVisible: string[];
  /**
   * Every page URL the run loaded, in first-visit order, with the scenarios that loaded it. The runner always sets it;
   * it is optional only so reports written before it existed can still be read.
   */
  pagesVisited?: { url: string; scenarioIds: string[] }[];
  /**
   * How many records the run may have created in the app under test: save requests (non-GET fetch, XHR or form
   * posts to the target's origin, or carrying the run's test values to another origin) that the app accepted with
   * a 2xx or 3xx status. Run Hound never deletes them; the report says so. Optional only for older reports.
   */
  testRecordsCreated?: number;
  /** True when the user stopped the run: remaining scenarios are "skipped" with notes "Stopped by you". */
  stopped?: boolean;
  /** Browser the run used, e.g. "Chromium 153.0.8010.12". */
  browser?: string;
}
