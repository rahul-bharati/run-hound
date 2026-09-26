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
  // V2 (0.3.0): runs the flows an AI model suggested. It plans nothing itself; suggestions come from ai/suggest.ts.
  "ai-flow",
  // V2 (0.4.0): signed-in runs with test accounts (docs/v2-spec.md).
  "access-control",
  "mass-assignment",
  "deep-links",
  // V2 (0.5.0): write-side checks, which change Account A's own test record and restore it (docs/v2-spec.md).
  "write-access",
  "csrf",
  "paywall-trust",
] as const;

/** Checks added in V1 (single page). Everything else in CHECK_IDS shipped in V0. */
export const V1_CHECK_IDS: readonly CheckId[] = ["page-controls", "security-headers", "cookie-flags", "cors", "source-maps"];

export type CheckId = (typeof CHECK_IDS)[number];

/**
 * Checks added in V2: 0.4.0 (the first slice: test accounts, access checks, deep links) and 0.5.0 (the write-side
 * checks). docs/v2-spec.md.
 */
export const V2_CHECK_IDS: readonly CheckId[] = ["access-control", "mass-assignment", "deep-links", "write-access", "csrf", "paywall-trust"];

/** The two test-account slots (docs/v2-spec.md "Test accounts"). */
export type AccountId = "a" | "b";

/** How plans, reports and checks name a test account: never its username or password. */
export interface AccountRef {
  id: AccountId;
  /** "Account A" unless the user gave it a label. */
  label: string;
}

/**
 * What the run can do, passed to Check.plan (0.4.0). Absent means signed out with no other account, as in 0.3.0.
 * `signedIn`: the plan was discovered, and the run will run, as a test account. `otherAccount`: a second account is
 * configured, can be signed in, and the user said the two must not see each other's data (accounts.json "isolated").
 */
export interface PlanEnv {
  signedIn: boolean;
  otherAccount: boolean;
}

/** Whose session a check opens a page or sends a request with: the run's account, the other account, or nobody. */
export type Identity = "self" | "other" | "signed-out";

/** A request CheckContext.request sends (docs/v2-spec.md "Types"). GET unless `method` says otherwise. */
export interface IdentityRequest {
  method?: string;
  url: string;
  /** Extra headers. Credential headers (cookie, authorization, apikey, x-*-token, x-api-key) are dropped and replaced by the identity's own. */
  headers?: Record<string, string>;
  /** Request body, sent as is (JSON callers pass JSON.stringify(...) and a content-type header). */
  body?: string;
}

/** The answer to an IdentityRequest: body capped at 1 MB, header names lower-case. Redirects are not followed. */
export interface IdentityResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** Checks that only run scenarios an AI model suggested; never listed as "nothing to test on this page". */
export const AI_CHECK_IDS: readonly CheckId[] = ["ai-flow"];

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
  /**
   * A non-native widget (0.4.0), as Radix/shadcn, Headless UI or cmdk render them, and how to set its value:
   * - "aria-select": a button[role=combobox] (Radix Select) whose listbox opens in a portal; `options` are its choices.
   * - "aria-combobox": a text input[role=combobox] with a listbox of suggestions (cmdk, Downshift).
   * - "aria-checkbox" / "aria-switch": a button[role=checkbox|switch] with aria-checked.
   * - "aria-radio": a [role=radiogroup] of [role=radio] items; `options` are the items.
   * - "aria-slider": a [role=slider] set with the arrow keys.
   * `selector` is always the visible, focusable control. Absent for native controls.
   */
  widget?: "aria-select" | "aria-combobox" | "aria-checkbox" | "aria-switch" | "aria-radio" | "aria-slider";
  /**
   * The hidden native input a widget mirrors its value into (Radix "bubble" inputs: an aria-hidden <select> or
   * <input type=checkbox|radio> inside the form), when it has one. Setting that input is the fastest reliable way to
   * set the widget; the visible control is still the one focused and clicked.
   */
  nativeSelector?: string;
  /**
   * Why `required` is true (0.4.0): "attribute" (required / aria-required) or "label" (the label or its marker says so:
   * "*", "(required)", "required"). Schema-validated forms (react-hook-form + zod) usually have only the label.
   */
  requiredBy?: "attribute" | "label";
  /**
   * Signed-in runs (0.4.1): the field held the signed-in account's own email when the page was read (a profile form).
   * Checks leave it as it is: typing a test address there and saving would change the email the account signs in with.
   */
  holdsAccountEmail?: boolean;
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
  /**
   * The control that shows this form (0.4.0): a form inside a dialog, sheet or popover that only exists after a click
   * ("New project", "Book a demo"). CheckContext.openPage clicks it after every page load (engine/open-form.ts), so a
   * check always finds the form on screen. Absent for forms that are on the page when it loads.
   */
  opener?: { selector: string; name: string | null };
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
  /**
   * Where the page's own links go (0.4.0, for deep-links): absolute URLs of a[href] links to the page's origin, without
   * the hash, one per path and query, in page order, at most 50. Never an in-page anchor ("#…"), a download, or a link
   * whose name or path says it acts (log out, delete, unsubscribe…: isDestructiveControl). Absent in older plans.
   */
  linkTargets?: string[];
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
  /**
   * What the finding's scenario tested (V1): its form ("Newsletter form") or "Whole page". Set by the runner from
   * Scenario.scopeLabel, so a finding says which form it is about on a page with several.
   */
  scope?: string;
  /** Playwright spec that reproduces the finding, as source text. */
  spec?: { filename: string; source: string };
  /**
   * An AI model's plain-language explanation (0.3.0), added after the run when AI explanations are on. Advisory text
   * only: it never changes the verdict, severity or the built-in meaning/impact/fix. Absent when AI is off or failed.
   */
  ai?: FindingExplanation;
}

/** What an AI model wrote about one finding. */
export interface FindingExplanation {
  /** Two or three sentences for a non-technical reader. */
  summary: string;
  /** A prompt the user can paste into their coding AI to fix it. */
  askYourAi: string;
  /** "<provider>/<model>", e.g. "ollama/ornith-1.5:9b". */
  model: string;
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
  /**
   * What an AI plan review said about this scenario (0.3.0). `suggested` is true for scenarios the model proposed
   * (checkId "ai-flow"); those are never defaultSelected. Absent when AI is off.
   */
  ai?: ScenarioAi;
  /** The steps of an AI-suggested scenario (checkId "ai-flow" only), validated against the discovered form. */
  flow?: FlowStep[];
}

export interface ScenarioAi {
  /** One sentence on why this scenario matters on this page (at most 200 characters). */
  rationale: string;
  /** Whether the model recommends running it. Applied to defaultSelected, except destructive scenarios stay off. */
  recommended: boolean;
  /** True for a scenario the model proposed rather than a built-in check. */
  suggested?: boolean;
}

/**
 * One step of an AI-suggested flow. Steps name discovered things only: `field` is a FormField.key and `control` an
 * index into the scenario's form controls (form scope), never a selector or script the model wrote.
 */
export type FlowStep =
  | { action: "fill"; field: string; value: string }
  | { action: "choose"; field: string; option: string }
  | { action: "click"; control: number }
  | { action: "press"; key: FlowKey }
  | { action: "expect"; expect: FlowExpectation; text: string | null };

/** Keys a flow may press. */
export type FlowKey = "Enter" | "Tab" | "Escape" | "Space";

/**
 * Deterministic assertions a flow may end with (checked since the flow's first step):
 * - "request-ok": at least one save request reached the app and got a 2xx/3xx answer, and none got 4xx/5xx.
 * - "text-visible": `text` is visible on the page.
 * - "text-absent": `text` is not visible on the page.
 * - "url-changes": the page URL (path or query) changed.
 * - "no-errors": no page errors, console errors or failed same-origin requests.
 * - "field-kept": every field filled by the flow still holds its value (e.g. after a failed submit).
 */
export type FlowExpectation = "request-ok" | "text-visible" | "text-absent" | "url-changes" | "no-errors" | "field-kept";

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
  /**
   * The run's test account and the other account (0.4.0), by label only. Absent or null = signed out / not available.
   */
  accounts?: { self: AccountRef | null; other: AccountRef | null };
  /**
   * Opens a fresh context + page on the target with network/console capture attached. `as` (0.4.0) picks the session:
   * "self" (default) = the run's account when the run is signed in, else signed out; "other" = the second account
   * (throws when there is none); "signed-out" = no session.
   */
  openPage(options?: { viewport?: { width: number; height: number }; as?: Identity }): Promise<{
    context: BrowserContext;
    page: Page;
    capture: Capture;
  }>;
  /**
   * Sends one HTTP request as `as` (0.4.0): that identity's cookies plus the credential headers the app itself sent
   * from that identity to the same origin (never guessed); "signed-out" sends neither. The URL must pass the safety
   * gate (else it rejects), redirects are not followed, 10 s timeout, body capped at 1 MB. Not recorded as page
   * activity; a non-GET request that the app accepts counts as a test record.
   */
  request(as: Identity, request: IdentityRequest): Promise<IdentityResponse>;
  /**
   * Strings that identify the run account's own data (its username), for matching responses only: never print them,
   * put them in evidence or send them to a model. Empty when signed out.
   */
  accountMarkers(): string[];
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
  /**
   * Scenarios this check proposes for the given form (and page, in V1); empty if it does not apply. `env` (0.4.0) says
   * whether the run is signed in and has a second account; absent = signed out, no other account.
   */
  plan(form: DiscoveredForm, page?: DiscoveredPage, env?: PlanEnv): Scenario[];
  run(ctx: CheckContext, scenario: Scenario): Promise<CheckResult>;
  /**
   * How long one of this check's scenarios may take, when its work grows with the page (a check that loads the page
   * once for every control it clicks). The runner allows the larger of this and its default limit (3 minutes);
   * RunOptions.scenarioTimeoutMs, when given, applies as it is. Absent = the default limit.
   */
  timeLimitMs?(scenario: Scenario, form: DiscoveredForm, page?: DiscoveredPage): number;
  /**
   * Added to the notes of a scenario the runner abandoned mid-run (stopped, or over its time limit): what the check may
   * have left changed on the target, since it had no chance to put it back. Absent = nothing to say.
   */
  interruptedNote?: string;
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
  /** Set when an AI model reviewed the plan or suggested scenarios (0.3.0). */
  ai?: PlanAi;
  /** The test account the page was discovered as (0.4.0); a run of this plan signs in as the same account. Absent = signed out. */
  account?: AccountRef;
  /**
   * True when the plan was made signed out on a page with a form that saves, and the access checks were among the
   * checks (0.4.0): they plan nothing signed out, so planWarnings shows one hint to sign in as a test account instead.
   */
  signInHint?: boolean;
}

/** Which model looked at a plan or report, and what went wrong. */
export interface AiUsage {
  provider: string;
  model: string;
  /** True when the endpoint is not on this machine or a private network (the user consented to sending). */
  remote: boolean;
  /** Plain-language problems, e.g. "The model's answer was not valid JSON; the built-in plan is shown." */
  warnings: string[];
}

export interface PlanAi extends AiUsage {
  reviewedAt: string;
  /** Whether the review ran (and succeeded) and how many scenarios the model suggested and passed validation. */
  reviewed: boolean;
  suggested: number;
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
   * a 2xx or 3xx status, and that are page posts, have no body or carry the run's test values (GraphQL queries and
   * same-origin reads or analytics sent as POST don't count; engine/context.ts isAcceptedSave). Run Hound never
   * deletes them; the report says so. Optional only for older reports.
   */
  testRecordsCreated?: number;
  /** True when the user stopped the run: remaining scenarios are "skipped" with notes "Stopped by you". */
  stopped?: boolean;
  /**
   * How the run was started, so a re-run of a report read back from disk runs the same way. The runner always sets
   * it; it is optional only so reports written before 0.4.0 can still be read.
   */
  options?: { allowDestructive: boolean; headed: boolean };
  /** Browser the run used, e.g. "Chromium 153.0.8010.12". */
  browser?: string;
  /** Set when AI explanations were requested (0.3.0): the model and how many findings it explained. */
  ai?: AiUsage & { explained: number };
  /**
   * Who the run signed in as and, when a scenario used it, the other account (0.4.0). Absent in reports written
   * before 0.4.0, which read as signed out.
   */
  accounts?: { signedInAs: AccountRef | null; other: AccountRef | null };
}
