import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium, type Browser, type LaunchOptions, type Page } from "playwright";
import { groupOf } from "../core/format.js";
import { resolveAccounts } from "../accounts/config.js";
import type { AccountsConfig, TestAccount } from "../accounts/types.js";
import {
  CHECK_GROUPS,
  type AccountId,
  type AccountRef,
  type Check,
  type CheckGroup,
  type CheckResult,
  type DiscoveredForm,
  type DiscoveredPage,
  type Plan,
  type PlanEnv,
  type Report,
  type Scenario,
} from "../core/types.js";
import { accountLabel, samePage, signIn, SignInError, type SessionState } from "./auth.js";
import { BROWSER_LOCALE, createCheckContext, createCredentialHeaders, type CredentialHeaders } from "./context.js";
import { discoverPage, holdSocketWrites } from "./discover.js";
import {
  cleanErrorMessage,
  containerLocalhostHint,
  explainNavigationError,
  explainNoForm,
  inContainer,
  NoFormFoundError,
  splitTargetUrl,
  TargetNotAllowedError,
  TargetUnreachableError,
} from "./errors.js";
import { guardContext, guardSummary, rememberCredentials } from "./guard.js";
import { changesCredentials, credentialFormNote, NEVER_SUBMITS } from "../checks/lib/functional-form.js";
import { buildPlan, formOfScenario } from "./plan.js";
import { redactAccountSecrets, redactDeep, redactSecrets, registerAccountUsernames, registerSecretLiterals } from "./redact.js";
import { NOT_VISIBLE, redactReport, writeReport } from "./report.js";
import { checkTarget, pinArgs, type SafetyOptions } from "./safety.js";
import { explainFindings } from "../ai/explain.js";
import { reviewPlan } from "../ai/review.js";
import { modelLabel, type AiSession } from "../ai/session.js";
import { suggestScenarios } from "../ai/suggest.js";

export interface RunOptions {
  /**
   * Stops the run when aborted: the scenario in progress is abandoned (its browser context closed, status "skipped",
   * notes "Stopped by you"), remaining approved scenarios are "skipped" with the same note, and the report is still
   * written with stopped: true. runPlan resolves normally; it does not throw on abort.
   */
  signal?: AbortSignal;
  /** Defaults to the registered V0 checks. */
  checks?: Check[];
  /** Scenario ids to run. Defaults to every defaultSelected scenario. */
  approved?: string[];
  allowDestructive?: boolean;
  /** Where run folders go. Defaults to ./runs. */
  runsDir?: string;
  /** Defaults to the comma list in RUNHOUND_ALLOWED_HOSTS. */
  allowedHosts?: string[];
  /** DNS lookup used by the safety gate, injectable for tests. */
  lookup?: SafetyOptions["lookup"];
  /** Where a check's log lines go. Defaults to stderr. */
  log?: (line: string) => void;
  /**
   * How long one scenario may take before it is abandoned like a stopped one (its browser contexts closed) and ends
   * "error" with a note saying so; the run goes on with the next scenario. Defaults to SCENARIO_TIMEOUT_MS, or more for
   * a check that asks for it (Check.timeLimitMs, see scenarioLimitMs).
   */
  scenarioTimeoutMs?: number;
  onProgress?: (event: ProgressEvent) => void;
  /** Run id to use (letters, digits, "_" and "-"). Generated when omitted; the server passes its own. */
  runId?: string;
  /** Stream JPEG frames of the page under test as "frame" progress events (the web UI's live view). Default false. */
  live?: boolean;
  /** Open a visible browser window instead of headless Chromium, so a person can watch. Default false. */
  headed?: boolean;
  /**
   * The optional AI layer (docs/ai-spec.md). discoverAndPlan reviews (features.review) then suggests flows
   * (features.suggest) after building the plan; runPlan explains findings (features.explain) before writing the report.
   * AI failures never throw: they become Plan.ai.warnings / Report.ai.warnings. Absent = AI off, nothing is sent.
   */
  ai?: AiSession;
  /**
   * Sign in as this test account (0.4.0, docs/v2-spec.md) before discovery (discoverAndPlan) and for every scenario
   * (runPlan uses the plan's account; this option is for discoverAndPlan). A failed sign-in throws SignInError before
   * anything else runs. Absent = signed out, as before.
   */
  signInAs?: AccountId;
  /**
   * The resolved test accounts; defaults to resolveAccounts() (accounts.json + RUNHOUND_ACCOUNT_* env). Tests inject
   * their own. runPlan signs in the plan's account, and the other slot too when an approved scenario needs it.
   */
  accounts?: AccountsConfig;
}

export type ProgressEvent =
  | { type: "scenario-start"; scenarioId: string; index: number; total: number; group: CheckGroup }
  /** A group's first scenario is about to start; index/total count groups with approved scenarios. */
  | { type: "group-start"; group: CheckGroup; label: string; index: number; total: number; scenarios: number }
  | { type: "scenario-end"; scenarioId: string; result: CheckResult }
  /**
   * A check reported what it is doing (CheckContext.step) or the engine started a phase (discovery, report).
   * Engine steps outside any scenario carry ENGINE_STEP ("") as their scenarioId.
   */
  | { type: "step"; scenarioId: string; label: string; url: string; at: string }
  /** A page finished loading in the browser under test (main frame only). Feeds report.pagesVisited. */
  | { type: "page"; scenarioId: string; url: string; at: string }
  /** The browser was launched: its real name and version, e.g. "Chromium 153.0.8010.12". Once per run. */
  | { type: "browser"; name: string }
  /** Latest screencast frame of the page under test; only when RunOptions.live. Secrets can't be redacted from pixels. */
  | { type: "frame"; scenarioId: string; url: string; jpeg: Buffer; at: string };

/**
 * Whether a visible browser window (headed mode) can open here: always on macOS and Windows, and on Linux only with a
 * display server (DISPLAY or WAYLAND_DISPLAY). A container has none, and Chromium then fails with a long banner.
 */
export function canShowBrowser(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): boolean {
  if (platform === "darwin" || platform === "win32") return true;
  return Boolean(env.DISPLAY || env.WAYLAND_DISPLAY);
}

/** Why headed mode is unavailable, in plain words. */
export const NO_DISPLAY_MESSAGE =
  "There is no display on the machine running Run Hound (no DISPLAY or WAYLAND_DISPLAY, as in a container), so a browser window can't be shown. Run without it; the live view in the web UI works either way.";

/** scenarioId of step events the engine reports outside any scenario (discovery, launching, writing the report). */
export const ENGINE_STEP = "";

/** Run Hound's version, from app/package.json: printed by --version, stored in every report, shown in the web UI. */
export const RUN_HOUND_VERSION: string = (() => {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

function allowedHosts(options: RunOptions): string[] {
  return options.allowedHosts ?? (process.env.RUNHOUND_ALLOWED_HOSTS ?? "").split(",").map((h) => h.trim()).filter(Boolean);
}

/** Safety options the gate and the navigation guard share. */
function safetyOptions(options: RunOptions): SafetyOptions {
  return { allowedHosts: allowedHosts(options), lookup: options.lookup };
}

/** Launch options shared by discovery and the run: pinned host, and a visible window when headed. */
function launchOptions(target: Awaited<ReturnType<typeof checkTarget>>, options: RunOptions): LaunchOptions {
  return { args: pinArgs(target), headless: !options.headed };
}

/** Reports an engine phase (not tied to a scenario) to onProgress. */
function engineStep(options: RunOptions, label: string, url: string): void {
  options.onProgress?.({ type: "step", scenarioId: ENGINE_STEP, label, url: redactSecrets(url), at: new Date().toISOString() });
}

/** Loaded lazily so the engine does not pull in the whole check library when callers pass their own checks. */
async function resolveChecks(options: RunOptions): Promise<Check[]> {
  if (options.checks) return options.checks;
  const { checks } = await import("../checks/index.js");
  return checks;
}

/** Sortable, filesystem-safe run id, e.g. "20260922-101500-3f9a1c". */
export function newRunId(): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  return `${stamp}-${randomBytes(3).toString("hex")}`;
}

/** How long to wait for the network to go quiet after "load"; apps that poll or stream never go idle. */
export const NETWORK_IDLE_TIMEOUT_MS = 5_000;

/**
 * How long one scenario may take (RunOptions.scenarioTimeoutMs). Generous: the slowest checks (axe in four states on
 * a busy machine) take about a minute and a half. A scenario that takes longer is stuck, usually waiting for a
 * request the app never answers, and would otherwise hold the run (and a CI job) forever.
 */
export const SCENARIO_TIMEOUT_MS = 3 * 60_000;

/**
 * How long a scenario may take: RunOptions.scenarioTimeoutMs when given, else SCENARIO_TIMEOUT_MS or, for a check whose
 * work grows with the page (Check.timeLimitMs: one page load per control clicked), what it asks for when that is more.
 */
export function scenarioLimitMs(check: Check, scenario: Scenario, form: DiscoveredForm, page?: DiscoveredPage, options: Pick<RunOptions, "scenarioTimeoutMs"> = {}): number {
  if (options.scenarioTimeoutMs !== undefined) return options.scenarioTimeoutMs;
  return Math.max(SCENARIO_TIMEOUT_MS, check.timeLimitMs?.(scenario, form, page) ?? 0);
}

/** "3 minutes", "1 minute", "90 seconds", "1 second". */
function limitWords(ms: number): string {
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  return ms >= 60_000 && ms % 60_000 === 0 ? plural(ms / 60_000, "minute") : plural(Math.round(ms / 100) / 10, "second");
}

/** Notes of a scenario abandoned at its time limit. */
export function scenarioTimeoutNote(limitMs: number): string {
  return (
    `The scenario took longer than ${limitWords(limitMs)} and was stopped, so it has no result. ` +
    "Something it waited for never finished, often a request the app never answered."
  );
}

/**
 * Safety gate (host checked and pinned), open the target, discover the form, build the plan.
 * "localhost:3000/book" (no scheme) is read as http://localhost:3000/book. A target that doesn't answer is reported
 * as a TargetUnreachableError with one plain sentence, not Playwright's call log.
 * A user name and password in the URL (http://user:pass@host/) are taken out of it: the plan's target never has them,
 * and every browser context answers that origin's HTTP authentication with them (guard.ts rememberCredentials).
 */
export async function discoverAndPlan(rawUrl: string, options: RunOptions = {}): Promise<Plan> {
  const { url, credentials } = splitTargetUrl(rawUrl);
  const safety = safetyOptions(options);
  const target = await checkTarget(url, safety);
  if (credentials) rememberCredentials(url, credentials);
  const checks = await resolveChecks(options);
  const signing = options.signInAs ? await signingIn(options.signInAs, options) : null;
  const secrets = new SecretRegistrations();
  if (signing) secrets.addAccounts(signing.config);
  try {
    return await discoverSignedInOrOut(url, target, checks, signing, secrets, safety, options);
  } catch (err) {
    throw redactError(err);
  } finally {
    secrets.release();
  }
}

/** The run's accounts: the injected ones, else accounts.json and RUNHOUND_ACCOUNT_* (accounts/config.ts). */
async function accountsConfig(options: RunOptions): Promise<AccountsConfig> {
  return options.accounts ?? (await resolveAccounts()).config;
}

/** The slot that isn't `id`. */
const otherSlot = (id: AccountId): AccountId => (id === "a" ? "b" : "a");

/**
 * Marks the email fields that hold the signed-in account's own email (FormField.holdsAccountEmail), as read on the
 * loaded page: checks leave them as they are, so no save changes the email the account signs in with. Fields of forms
 * behind a trigger aren't on the page yet and are read when they are there (their values are then left as found only
 * if already marked; a dialog form holding the account's email is rare).
 */
async function markAccountEmail(page: Page, found: DiscoveredPage, username: string): Promise<void> {
  const own = username.trim().toLowerCase();
  if (!own.includes("@")) return;
  for (const form of found.forms) {
    for (const field of form.fields) {
      if (field.type !== "email" && !/e-?mail/i.test(`${field.key} ${field.accessibleName ?? ""} ${field.label ?? ""}`)) continue;
      const value = await page
        .locator(field.selector)
        .first()
        .inputValue({ timeout: 1_000 })
        .catch(() => null);
      if (value !== null && value.trim().toLowerCase() === own) field.holdsAccountEmail = true;
    }
  }
}

/** True when the slot has what signing in needs: a sign-in page, a username and a password. */
function accountReady(account: TestAccount | undefined): account is TestAccount {
  return Boolean(account && account.loginUrl?.trim() && account.username?.trim() && account.password);
}

function refOf(account: TestAccount): AccountRef {
  return { id: account.id, label: accountLabel(account) };
}

/**
 * What a signed-in plan or run registers while it is going: every password the configuration holds (literal secrets),
 * and every username of 3 characters or more (hidden in any letter case, like the server's usernameHider). Reports,
 * evidence, specs, logs, progress events and AI prompts name accounts by label only (docs/v2-spec.md "Test accounts").
 */
function accountSecretsOf(config: AccountsConfig): { passwords: string[]; usernames: string[] } {
  const accounts = Object.values(config.accounts).filter((a): a is TestAccount => Boolean(a));
  return {
    passwords: accounts.flatMap((a) => (a.password ? [a.password] : [])),
    usernames: accounts.map((a) => a.username?.trim() ?? "").filter((u) => u.length >= 3),
  };
}

/**
 * Plan fields that address the page (selectors, URLs, field keys, and option labels, which a select is set by): they
 * must keep working, so they keep their text. The CLI and the server hide usernames in what they print of a plan, and
 * a report is redacted whole when it is written.
 */
const PLAN_ADDRESS_KEYS = new Set(["selector", "nativeSelector", "url", "target", "key", "linkTargets", "options"]);

/**
 * A signed-in plan with the registered secrets redacted from its readable text (page title, form and field names,
 * control texts, scenario titles): a page shown signed in may print the account's email in a button. Address fields
 * (PLAN_ADDRESS_KEYS) lose only the passwords and session values (redactAccountSecrets): a link to "/help?session=…"
 * must never carry the discovery session into the plan or the report, and nothing needs that value to find a thing.
 */
function redactPlanText<T>(value: T, key = "", address = false): T {
  const inAddress = address || PLAN_ADDRESS_KEYS.has(key);
  if (typeof value === "string") return (inAddress ? redactAccountSecrets(value) : redactSecrets(value)) as T;
  if (Array.isArray(value)) return value.map((v) => redactPlanText(v, "", inAddress)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactPlanText(v, k, inAddress);
    return out as T;
  }
  return value;
}

interface Signing {
  config: AccountsConfig;
  account: TestAccount;
  /** The other slot, when it can be signed in and the user said A and B must not see each other's data. */
  other: TestAccount | null;
}

async function signingIn(id: AccountId, options: RunOptions): Promise<Signing> {
  const config = await accountsConfig(options);
  const account = config.accounts[id] ?? { id, label: "", loginUrl: "", username: "", password: null };
  const other = config.accounts[otherSlot(id)];
  return { config, account, other: config.isolated && accountReady(other) ? other : null };
}

/** Literal-secret and username registrations of one plan or run, released together at its end. */
class SecretRegistrations {
  private readonly held: (() => void)[] = [];
  constructor(values: string[] = []) {
    this.add(values);
  }
  add(values: string[]): void {
    if (values.length > 0) this.held.push(registerSecretLiterals(values));
  }
  /** Registers the accounts' passwords and usernames (accountSecretsOf). */
  addAccounts(config: AccountsConfig): void {
    const { passwords, usernames } = accountSecretsOf(config);
    this.add(passwords);
    if (usernames.length > 0) this.held.push(registerAccountUsernames(usernames));
  }
  release(): void {
    for (const unregister of this.held.splice(0)) unregister();
  }
}

/** The same error with its message redacted while the run's secrets are still registered (callers print it later). */
function redactError(err: unknown): unknown {
  if (err instanceof Error) {
    const message = redactSecrets(err.message);
    if (message !== err.message) {
      try {
        err.message = message;
      } catch {
        return new Error(message);
      }
    }
    if (err.stack) err.stack = redactSecrets(err.stack);
  }
  return err;
}

/** "Signed in as Account A, but <target> still shows the sign-in page. …" (docs/v2-spec.md "Signed-in runs"). */
export function stillSignedOutMessage(label: string, target: string, loginUrl?: string): string {
  return `Signed in as ${label}, but ${redactSecrets(target)} still shows the sign-in page. Check the account in Settings → Test accounts.${hostHint(target, loginUrl)}`;
}

/**
 * Why a session may not reach the target: the sign-in page is on another host name ("localhost" and "127.0.0.1" are
 * the same machine, but a browser keeps their cookies apart). "" when the hosts are the same.
 */
function hostHint(target: string, loginUrl: string | undefined): string {
  if (!loginUrl) return "";
  let a: URL;
  let b: URL;
  try {
    a = new URL(target);
    b = new URL(loginUrl);
  } catch {
    return "";
  }
  if (a.hostname === b.hostname) return "";
  return ` The sign-in page is on ${b.hostname} and the page on ${a.hostname}: a browser keeps their cookies apart, so the session doesn't carry over. Use the same host name in both.`;
}

/**
 * Runs in the page: true when it shows a sign-in form: a visible form with one visible password field that isn't a
 * new password, one or two fields for the username, and sign-in words in the form, its buttons or the page heading
 * (and not only sign-up words). A "Change email" form that asks for the current password is not one.
 */
const SHOWS_SIGN_IN_FORM = String.raw`(() => {
  const shown = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const signIn = /\b(sign|log)[\s-]?(in|on)\b|\blogin\b/i;
  const signUp = /\b(sign[\s-]?up|register|create\s+(an?\s+|your\s+|my\s+)?account|join)\b/i;
  const text = (el) => (el ? [el.getAttribute("aria-label"), el.getAttribute("name"), el.id, el.innerText].join(" ") : "");
  const heading = [document.title, text(document.querySelector("h1"))].join(" ");
  for (const pw of document.querySelectorAll("input[type=password]")) {
    if (!shown(pw) || /new-password/i.test(pw.getAttribute("autocomplete") || "")) continue;
    const form = pw.form || pw.closest("form, [role=form]") || (pw.parentElement && pw.parentElement.parentElement);
    if (!form) continue;
    if (Array.from(form.querySelectorAll("input[type=password]")).filter(shown).length !== 1) continue;
    const ids = Array.from(form.querySelectorAll("input")).filter((el) => shown(el) && ["text", "email", "tel", ""].includes((el.getAttribute("type") || "").toLowerCase()));
    if (ids.length === 0 || ids.length > 2) continue;
    const buttons = Array.from(form.querySelectorAll("button, input[type=submit], [role=button]")).map((b) => b.innerText || b.value || b.getAttribute("aria-label") || "").join(" ");
    const own = [form.getAttribute("aria-label"), form.getAttribute("name"), form.id, buttons, text(form.querySelector("h1, h2, legend"))].join(" ");
    if (signUp.test(own) && !signIn.test(own)) continue;
    if (signIn.test(own) || signIn.test(heading)) return true;
  }
  return false;
})()`;

/**
 * True when a page opened with the account's session landed on the sign-in page anyway: its URL is the account's
 * sign-in page (unless that is the page asked for), it was sent to a sign-in-looking path that shows a password
 * field, or it shows a sign-in form in place (an app that renders the form at the page's own address when the session
 * didn't reach it).
 */
async function landedOnSignIn(page: import("playwright").Page, target: string, account: TestAccount): Promise<boolean> {
  const now = page.url();
  if (samePage(target, account.loginUrl)) return false;
  if (samePage(now, account.loginUrl)) return true;
  let path = "";
  try {
    path = new URL(now).pathname;
  } catch {
    return false;
  }
  if (!samePage(now, target) && /log-?in|sign-?in|auth/i.test(path) && (await page.locator("input[type=password]:visible").count().catch(() => 0)) > 0) return true;
  return Boolean(await page.evaluate(SHOWS_SIGN_IN_FORM).catch(() => false));
}

async function discoverSignedInOrOut(
  url: string,
  target: Awaited<ReturnType<typeof checkTarget>>,
  checks: Check[],
  signing: Signing | null,
  secrets: SecretRegistrations,
  safety: SafetyOptions,
  options: RunOptions,
): Promise<Plan> {
  if (signing) engineStep(options, `Signing in as ${accountLabel(signing.account)}`, signing.account.loginUrl || url);
  else engineStep(options, "Opening the page to find its forms and controls", url);
  const browser = await chromium.launch(launchOptions(target, options));
  let closed = false;
  try {
    let session: SessionState | undefined;
    if (signing) {
      const signed = await signIn(browser, signing.account, safety);
      secrets.add(signed.secrets);
      session = signed.state;
      engineStep(options, "Opening the page to find its forms and controls", url);
    }
    const env: PlanEnv = { signedIn: Boolean(signing), otherAccount: Boolean(signing?.other) };
    // serviceWorkers: a service worker's own requests bypass context.route (discovery's write block, the guard).
    const context = await browser.newContext({ locale: BROWSER_LOCALE, serviceWorkers: "block", ...(session ? { storageState: session } : {}) });
    const guard = await guardContext(context, safety);
    const page = await context.newPage();
    // Discovery clicks to read a widget's options and to find forms in dialogs, with writes blocked: its sockets must
    // be routed before the page opens them.
    await holdSocketWrites(page);
    let status: number | null = null;
    try {
      status = (await page.goto(url, { waitUntil: "load" }))?.status() ?? null;
      await page.waitForLoadState("networkidle", { timeout: NETWORK_IDLE_TIMEOUT_MS }).catch(() => undefined);
    } catch (err) {
      if (guard.escaped.length > 0) throw new TargetNotAllowedError(url, guardSummary(guard)!);
      const explained = explainNavigationError(err, url);
      // In a container, "localhost" is the container: say so instead of only "nothing is answering".
      const hint = explained instanceof TargetUnreachableError && inContainer(existsSync) ? containerLocalhostHint(url) : undefined;
      throw hint ? new TargetUnreachableError(url, `${(explained as Error).message} ${hint}`) : explained;
    }
    if (guard.escaped.length > 0) throw new TargetNotAllowedError(url, guardSummary(guard)!);
    if (signing && (await landedOnSignIn(page, url, signing.account))) {
      throw new SignInError(stillSignedOutMessage(accountLabel(signing.account), url, signing.account.loginUrl));
    }
    engineStep(options, "Reading the page: forms, fields and controls", page.url());
    const found = await discoverPage(page, { openers: true });
    if (signing) await markAccountEmail(page, found, signing.account.username);
    if (found.forms.length === 0) {
      // A page without a form still gets the page-wide checks, unless it is an error page or a dev server refusing
      // the host name: testing that page would only test the error.
      const text = String(await page.evaluate("document.body ? document.body.innerText.slice(0, 400) : ''").catch(() => ""));
      const broken = (status !== null && status >= 400) || /Blocked request\. This host|Invalid Host header|Blocked cross-origin request/i.test(text);
      if (broken) throw new NoFormFoundError(url, explainNoForm({ requested: url, final: page.url(), status, text }));
    }
    const built = buildPlan(url, found, checks, env);
    const plan: Plan = signing ? { ...redactPlanText(built), account: refOf(signing.account) } : built;
    // Nothing applies (only form checks are registered, or none apply): an empty plan would look like a clean pass.
    if (found.forms.length === 0 && plan.scenarios.length === 0) {
      throw new NoFormFoundError(url, "none of the page-wide checks apply to it either");
    }
    if (!options.ai) return plan;
    // The model can take minutes: the browser is not needed while it thinks.
    const pageUrl = page.url();
    closed = true;
    await browser.close();
    return await planWithAi(plan, options.ai, options, pageUrl);
  } finally {
    if (!closed) await browser.close();
  }
}

/** A plain-language reason from an AI failure. */
function aiReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactSecrets(message.replace(/\.+$/, ""));
}

/**
 * The AI review, then the suggestions, on top of the built-in plan (docs/ai-spec.md "Features"). Each failure keeps
 * the plan as it was and adds a warning; nothing here throws. Sets Plan.ai when at least one of the two features is on.
 */
async function planWithAi(built: Plan, ai: AiSession, options: RunOptions, url: string): Promise<Plan> {
  if (!ai.features.review && !ai.features.suggest) return built;
  const label = modelLabel(ai.client);
  const warnings: string[] = [];
  let plan = built;
  let reviewed = false;
  let suggested = 0;
  if (ai.features.review) {
    engineStep(options, `Asking ${label} to review the plan`, url);
    try {
      plan = await reviewPlan(plan, ai.client, { remote: ai.remote, signal: options.signal });
      reviewed = true;
    } catch (error) {
      warnings.push(`${label} could not review the plan (${aiReason(error)}), so the built-in plan is shown.`);
    }
  }
  if (ai.features.suggest) {
    engineStep(options, `Asking ${label} to suggest flows`, url);
    try {
      const before = plan.scenarios.length;
      const out = await suggestScenarios(plan, ai.client, { remote: ai.remote, signal: options.signal });
      plan = out.plan;
      suggested = plan.scenarios.length - before;
      for (const rejected of out.rejected) warnings.push(`Left out a flow ${label} suggested: ${redactSecrets(rejected)}`);
    } catch (error) {
      warnings.push(`${label} could not suggest flows (${aiReason(error)}), so none were added.`);
    }
  }
  return {
    ...plan,
    ai: { provider: ai.client.provider, model: ai.client.model, remote: ai.remote, warnings, reviewedAt: new Date().toISOString(), reviewed, suggested },
  };
}

/**
 * Things a person should know before approving the plan: the page the form was found on is not the page they asked
 * for (a redirect, often to a sign-in page, so a different form would be tested).
 */
export function planWarnings(plan: Plan): string[] {
  const warnings: string[] = [];
  try {
    const asked = new URL(plan.target);
    const found = new URL(plan.form.url);
    if (asked.origin !== found.origin || asked.pathname !== found.pathname) {
      const signInPage = /log-?in|sign-?in|auth/i.test(found.pathname);
      const login = !signInPage
        ? ""
        : plan.account
          ? " It looks like a sign-in page."
          : " It looks like a sign-in page. Sign in as a test account (Settings → Test accounts, or --as a) to test the pages behind it.";
      warnings.push(`${plan.target} redirected to ${plan.form.url}, so that page is the one being tested.${login}`);
    }
  } catch {
    // An unparseable URL can't be compared; the safety gate has already judged it.
  }
  if (plan.page && plan.page.forms.length === 0) {
    warnings.push("No form was found on this page, so only the page-wide checks are planned (buttons outside forms, headers, cookies, CORS, source maps, scripts and layout).");
  }
  if (plan.signInHint && !plan.account) {
    warnings.push("Sign in as a test account to run the access checks (another account or a signed-out visitor reading your data).");
  }
  return warnings;
}

/** The approval is empty or names scenarios the plan doesn't have. The CLI and the API report it as a usage error. */
export class NothingToRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NothingToRunError";
  }
}

/**
 * Finding ids and spec file names must be unique across the run: checks number their findings per scenario, and
 * two scenarios of one check could otherwise produce the same id or overwrite each other's spec file.
 * Later duplicates get "-2", "-3", ... (ids) or "-2.spec.ts" (files). Mutates the findings in place.
 */
function makeUnique(findings: Report["findings"]): void {
  const ids = new Set<string>();
  const files = new Set<string>();
  for (const f of findings) {
    let id = f.id;
    for (let n = 2; ids.has(id); n++) id = `${f.id}-${n}`;
    ids.add(id);
    f.id = id;
    if (!f.spec) continue;
    const base = f.spec.filename.replace(/\.spec\.ts$/, "");
    let file = f.spec.filename;
    for (let n = 2; files.has(file.toLowerCase()); n++) file = `${base}-${n}.spec.ts`;
    files.add(file.toLowerCase());
    f.spec.filename = file;
  }
}

/** explainFindings explains at most this many findings (the rest get none). */
const MAX_EXPLAINED = 20;

/** Notes of a scenario that needs a second account the run doesn't have. */
function noOtherAccountNote(signing: Signing | null): string {
  if (!signing) return "Skipped: this scenario needs a run signed in as a test account, with a second test account to compare.";
  const other = signing.config.accounts[otherSlot(signing.account.id)];
  const label = other ? accountLabel(other) : "The other test account";
  if (!signing.config.isolated) {
    return `Skipped: the test accounts are not marked as unable to see each other's data (Settings → Test accounts), so ${label} was not used.`;
  }
  return `Skipped: ${label} isn't set up (Settings → Test accounts), so no other account could try to read ${accountLabel(signing.account)}'s data.`;
}

/** Notes of every scenario a stopped run did not finish (RunOptions.signal). */
export const STOPPED_NOTE = "Stopped by you";

function skipped(scenario: Scenario, notes: string): CheckResult {
  return { checkId: scenario.checkId, scenarioId: scenario.id, status: "skipped", findings: [], durationMs: 0, notes };
}

function summarize(results: CheckResult[], findings: Report["findings"]): Report["summary"] {
  const count = (status: CheckResult["status"]) => results.filter((r) => r.status === status).length;
  const severity = (s: string) => findings.filter((f) => f.severity === s).length;
  return {
    critical: severity("critical"),
    high: severity("high"),
    medium: severity("medium"),
    low: severity("low"),
    passed: count("pass"),
    failed: count("fail"),
    errored: count("error"),
    skipped: count("skipped"),
  };
}

/**
 * A scenario's group: its check's category, else the plan group that lists it (a check that is no longer registered),
 * else Features.
 */
function scenarioGroup(scenario: Scenario, checks: Check[], plan: Plan): CheckGroup {
  const check = checks.find((c) => c.id === scenario.checkId);
  if (check) return groupOf(check.category);
  return plan.groups?.find((g) => g.scenarioIds.includes(scenario.id))?.id ?? "features";
}

/** Per-group results for every group with at least one scenario in the run, in CHECK_GROUPS order. */
function groupResults(results: CheckResult[], groupOfScenario: Map<string, CheckGroup>): Report["groups"] {
  return CHECK_GROUPS.flatMap((g) => {
    const mine = results.filter((r) => groupOfScenario.get(r.scenarioId) === g.id);
    if (mine.length === 0) return [];
    const count = (status: CheckResult["status"]) => mine.filter((r) => r.status === status).length;
    return [
      {
        id: g.id,
        label: g.label,
        scenarioIds: mine.map((r) => r.scenarioId),
        passed: count("pass"),
        failed: count("fail"),
        errored: count("error"),
        skipped: count("skipped"),
        findings: mine.reduce((n, r) => n + r.findings.length, 0),
        durationMs: mine.reduce((n, r) => n + r.durationMs, 0),
      },
    ];
  });
}

/**
 * Runs approved scenarios group by group (CHECK_GROUPS order), plan order inside a group; a group-start event
 * precedes each group. A destructive scenario runs only with allowDestructive.
 * A scenario whose check throws gets status "error" (the run continues), and so does one that takes longer than
 * RunOptions.scenarioTimeoutMs (abandoned like a stopped one, with scenarioTimeoutNote as its notes). Writes the report
 * (see report.ts) into <runsDir>/<runId>/ and returns it. Re-checks the safety gate first.
 * Unapproved scenarios are left out of results; approved destructive ones without opt-in are "skipped".
 */
export async function runPlan(plan: Plan, options: RunOptions = {}): Promise<{ report: Report; dir: string }> {
  // Every password and session value of a signed-in run stays registered until the report is written.
  const secrets = new SecretRegistrations();
  try {
    return await runPlanWith(plan, options, secrets);
  } catch (err) {
    throw redactError(err);
  } finally {
    secrets.release();
  }
}

/**
 * True for a scenario that needs the other account signed in (docs/v2-spec.md "access-control"): the
 * other-account scenario of access-control, on any form.
 */
export function needsOtherAccount(scenario: Scenario): boolean {
  return scenario.checkId === "access-control" && /(?:^|:)other-account(?:@form-\d+)?(?:#\d+)?$/.test(scenario.id);
}

/**
 * Opens the target once as `identity`, so the credential headers the app sends from that session (Authorization,
 * apikey, x-*-token) are known to CheckContext.request before any scenario needs them. For the run's own account, a
 * page that still lands on the sign-in page fails the run (the session doesn't work).
 */
async function preHarvest(
  browser: Browser,
  plan: Plan,
  identity: "self" | "other",
  shared: { sessions: { self?: SessionState; other?: SessionState }; credentialHeaders: CredentialHeaders; artifactsDir: string; safety: SafetyOptions },
  account: TestAccount,
): Promise<void> {
  const ctx = createCheckContext({
    browser,
    form: plan.form,
    openForm: false,
    ...(plan.page ? { discoveredPage: plan.page } : {}),
    targetUrl: plan.target,
    artifactsDir: shared.artifactsDir,
    allowedHosts: shared.safety.allowedHosts,
    lookup: shared.safety.lookup,
    sessions: shared.sessions,
    credentialHeaders: shared.credentialHeaders,
  });
  try {
    const { page } = await ctx.openPage({ as: identity });
    if (await landedOnSignIn(page, plan.target, account)) throw new SignInError(stillSignedOutMessage(accountLabel(account), plan.target, account.loginUrl));
  } catch (err) {
    // A page that doesn't load is every scenario's to report; only a session that doesn't work stops the run here.
    if (err instanceof SignInError) throw err;
  } finally {
    await ctx.dispose();
  }
}

async function runPlanWith(plan: Plan, options: RunOptions, secrets: SecretRegistrations): Promise<{ report: Report; dir: string }> {
  const startedMs = Date.now();
  const safety = safetyOptions(options);
  const target = await checkTarget(plan.target, safety);
  const runId = options.runId ?? newRunId();
  if (!/^[\w-]+$/.test(runId)) throw new Error(`Invalid run id: ${runId}`);

  const checks = await resolveChecks(options);
  const allowDestructive = options.allowDestructive ?? false;
  const approvedIds = new Set(options.approved ?? plan.scenarios.filter((s) => s.defaultSelected).map((s) => s.id));
  const unknown = [...approvedIds].filter((id) => !plan.scenarios.some((s) => s.id === id));
  if (unknown.length > 0) throw new NothingToRunError(`Unknown scenario id(s): ${unknown.join(", ")}.`);
  const groupOfScenario = new Map(plan.scenarios.map((s) => [s.id, scenarioGroup(s, checks, plan)] as const));
  const groupIndex = (s: Scenario) => CHECK_GROUPS.findIndex((g) => g.id === groupOfScenario.get(s.id));
  // Stable sort: plan order is kept inside a group.
  const toRun = plan.scenarios.filter((s) => approvedIds.has(s.id)).sort((a, b) => groupIndex(a) - groupIndex(b));
  // A run with nothing in it would report "0 findings" and look like a clean pass.
  if (toRun.length === 0) throw new NothingToRunError("No scenarios were approved, so there is nothing to run. Approve at least one scenario.");

  // 0.4.0: the plan's account signs in again (a fresh session per run); the other one only when a scenario needs it.
  const signing = plan.account ? await signingIn(plan.account.id, options) : null;
  if (signing) secrets.addAccounts(signing.config);
  const selfRef = signing ? refOf(signing.account) : null;
  const wantsOther = toRun.some(needsOtherAccount);
  const sessions: { self?: SessionState; other?: SessionState } = {};
  const credentialHeaders = createCredentialHeaders();
  const markers = signing ? [signing.account.username] : [];

  const startedAt = new Date(startedMs).toISOString();
  const dir = join(resolve(options.runsDir ?? "runs"), runId);
  const artifactsDir = join(dir, "artifacts");
  await mkdir(artifactsDir, { recursive: true });

  const results: CheckResult[] = [];
  // One token for the whole run: every test value carries it, so any scenario can recognise test data an earlier
  // scenario left in the app (reflow-320 names it as the cause of an overflow instead of blaming the layout).
  const runToken = randomBytes(4).toString("hex");
  // Save requests the app accepted, summed over every scenario (report.testRecordsCreated).
  let testRecordsCreated = 0;
  // One evidence file counter for the whole run, so artifact numbers follow the order evidence was taken.
  const fileCounter = { value: 0 };
  // Every page any scenario loaded, in first-visit order (Map keeps insertion order).
  const pagesVisited = new Map<string, string[]>();
  const recordVisit = (url: string, scenarioId: string) => {
    const ids = pagesVisited.get(url) ?? [];
    if (!ids.includes(scenarioId)) ids.push(scenarioId);
    pagesVisited.set(url, ids);
  };

  const signal = options.signal;
  const stopped = () => signal?.aborted === true;
  // Settles (never rejects) when the run is stopped, so a scenario in progress can be abandoned.
  const whenStopped = new Promise<"stopped">((res) => {
    if (!signal) return;
    if (signal.aborted) res("stopped");
    else signal.addEventListener("abort", () => res("stopped"), { once: true });
  });
  // True once the stop cost the run a scenario; a stop after the last scenario ended changes nothing.
  let wasStopped = false;
  /** Every approved scenario without a result yet, "skipped" as stopped; each still gets its scenario-end. */
  const skipRest = () => {
    for (const scenario of toRun) {
      if (results.some((r) => r.scenarioId === scenario.id)) continue;
      const result = skipped(scenario, STOPPED_NOTE);
      wasStopped = true;
      results.push(result);
      options.onProgress?.({ type: "scenario-end", scenarioId: scenario.id, result: redactDeep(result) });
    }
  };

  let browserName: string | undefined;
  if (stopped()) skipRest();
  else {
    engineStep(options, options.headed ? "Opening a browser window" : "Starting the browser", plan.target);
    const browser = await chromium.launch(launchOptions(target, options));
    browserName = `Chromium ${browser.version()}`;
    options.onProgress?.({ type: "browser", name: browserName });
    try {
      if (signing) {
        try {
          engineStep(options, `Signing in as ${accountLabel(signing.account)}`, signing.account.loginUrl);
          const self = await signIn(browser, signing.account, safety);
          secrets.add(self.secrets);
          sessions.self = self.state;
          if (wantsOther && signing.other) {
            engineStep(options, `Signing in as ${accountLabel(signing.other)}`, signing.other.loginUrl);
            const other = await signIn(browser, signing.other, safety);
            secrets.add(other.secrets);
            sessions.other = other.state;
          }
          engineStep(options, "Opening the page signed in, to see how the app sends its session", plan.target);
          const shared = { sessions, credentialHeaders, artifactsDir, safety };
          await preHarvest(browser, plan, "self", shared, signing.account);
          if (sessions.other && signing.other) await preHarvest(browser, plan, "other", shared, signing.other);
        } catch (err) {
          // Nothing ran: leave no empty run folder behind.
          await rm(dir, { recursive: true, force: true }).catch(() => undefined);
          throw err;
        }
      }
      const runGroups = CHECK_GROUPS.filter((g) => toRun.some((s) => groupOfScenario.get(s.id) === g.id));
      let current: CheckGroup | undefined;
      for (const [index, scenario] of toRun.entries()) {
        if (stopped()) break;
        const group = groupOfScenario.get(scenario.id)!;
        if (group !== current) {
          current = group;
          const g = runGroups.find((x) => x.id === group)!;
          const scenarios = toRun.filter((s) => groupOfScenario.get(s.id) === group).length;
          options.onProgress?.({ type: "group-start", group, label: g.label, index: runGroups.indexOf(g), total: runGroups.length, scenarios });
        }
        options.onProgress?.({ type: "scenario-start", scenarioId: scenario.id, index, total: toRun.length, group });
        const result = await runScenario(scenario, browser);
        results.push(result);
        // Progress reaches the web UI: redacted like the report.
        options.onProgress?.({ type: "scenario-end", scenarioId: scenario.id, result: redactDeep(result) });
      }
      if (stopped()) skipRest();
    } finally {
      await browser.close();
    }
  }

  async function runScenario(scenario: Scenario, browser: Browser): Promise<CheckResult> {
    // Signed in, a form that sets a password is never submitted, even with allowDestructive: it could change the
    // account's password, and this run's session and the next run's sign-in depend on it.
    if (signing && scenario.scope !== "page" && !NEVER_SUBMITS.has(scenario.checkId) && changesCredentials(formOfScenario(plan, scenario))) {
      return skipped(scenario, credentialFormNote(accountLabel(signing.account)));
    }
    if (scenario.destructive && !allowDestructive) {
      return skipped(scenario, "Destructive scenario; run again with --allow-destructive to include it.");
    }
    const check = checks.find((c) => c.id === scenario.checkId);
    if (!check) return { ...skipped(scenario, `No check registered for ${scenario.checkId}.`), status: "error" };
    if (needsOtherAccount(scenario) && !sessions.other) return skipped(scenario, noOtherAccountNote(signing));

    // A fresh CheckContext per scenario, so every scenario gets its own browser contexts.
    const log = options.log ?? ((line: string) => process.stderr.write(`${line}\n`));
    const scenarioId = scenario.id;
    const progress = options.onProgress;
    const steps: NonNullable<CheckResult["steps"]> = [];
    const withSteps = (result: CheckResult): CheckResult => (steps.length > 0 ? { ...result, steps: [...steps] } : result);
    // Set once the scenario has its result: a check abandoned at a stop or its time limit may still take steps or
    // load pages before it notices, and those belong to no scenario any more.
    let ended = false;
    const ctx = createCheckContext({
      browser,
      form: formOfScenario(plan, scenario),
      // A page-wide scenario tests the page as it loads, never with the main form's dialog open.
      openForm: scenario.scope !== "page",
      discoveredPage: plan.page,
      targetUrl: plan.target,
      artifactsDir,
      allowDestructive,
      runToken,
      allowedHosts: safety.allowedHosts,
      lookup: safety.lookup,
      log: (message) => log(`[${scenario.id}] ${message}`),
      fileCounter,
      // 0.4.0: the run's sessions; a signed-out run has none, so every page opens signed out as before.
      sessions,
      accounts: { self: selfRef, other: sessions.other && signing?.other ? refOf(signing.other) : null },
      markers,
      credentialHeaders,
      checkId: scenario.checkId,
      scenarioTitle: scenario.title,
      // The context redacts step labels and URLs before these hooks see them. Steps are kept for the report
      // (CheckResult.steps) whether or not anyone is watching.
      onStep: (step) => {
        if (ended) return;
        steps.push(step);
        progress?.({ type: "step", scenarioId, ...step });
      },
      onPageLoad: (page) => {
        if (ended) return;
        recordVisit(page.url, scenarioId);
        progress?.({ type: "page", scenarioId, ...page });
      },
      onFrame:
        progress && options.live
          ? (frame) => {
              if (!ended) progress({ type: "frame", scenarioId, ...frame });
            }
          : undefined,
    });
    const started = Date.now();
    const base = { checkId: scenario.checkId, scenarioId: scenario.id };
    const limitMs = scenarioLimitMs(check, scenario, ctx.form, plan.page, options);
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<"timed-out">((res) => (timer = setTimeout(() => res("timed-out"), limitMs)));
    let abandoned: Promise<unknown> | undefined;
    try {
      const running = check.run(ctx, scenario);
      // An abandoned check keeps running until its contexts close under it (dispose below); its failure is moot.
      running.catch(() => undefined);
      const outcome = await Promise.race([running, whenStopped, timedOut]);
      if (outcome === "stopped" || outcome === "timed-out") abandoned = running;
      // A check abandoned mid-run had no chance to undo what it changed: its interruptedNote says what to check.
      const interrupted = (note: string) => (check.interruptedNote ? `${note.replace(/\.?$/, ".")} ${check.interruptedNote}` : note);
      if (outcome === "stopped") {
        wasStopped = true;
        return withSteps({ ...skipped(scenario, interrupted(STOPPED_NOTE)), durationMs: Date.now() - started });
      }
      if (outcome === "timed-out") {
        return withSteps({ ...base, status: "error", findings: [], durationMs: Date.now() - started, notes: interrupted(scenarioTimeoutNote(limitMs)) });
      }
      const result = outcome;
      // A scenario that left the allowed targets never produces findings: whatever it saw was not the target.
      if (ctx.escaped.length > 0) {
        return withSteps({ ...base, status: "error", findings: [], durationMs: Date.now() - started, notes: guardSummary(ctx)! });
      }
      const notes = [result.notes, ctx.blocked.length > 0 ? guardSummary(ctx) : null].filter(Boolean).join(" ");
      // Each finding says which form (or the whole page) it is about.
      const findings = scenario.scopeLabel ? result.findings.map((f) => ({ ...f, scope: scenario.scopeLabel })) : result.findings;
      return withSteps({ ...result, ...base, findings, ...(notes ? { notes } : {}) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const notes = ctx.escaped.length > 0 ? guardSummary(ctx)! : redactSecrets(cleanErrorMessage(message));
      return withSteps({ ...base, status: "error", findings: [], durationMs: Date.now() - started, notes });
    } finally {
      clearTimeout(timer);
      ended = true;
      testRecordsCreated += ctx.testRecordsCreated();
      await ctx.dispose();
      // The abandoned check may open another page before it notices its first one closed: close that when it ends.
      if (abandoned) void abandoned.catch(() => undefined).then(() => ctx.dispose());
    }
  }

  const findings = results.flatMap((r) => r.findings);
  makeUnique(findings);
  let raw: Report = {
    runId,
    target: plan.target,
    startedAt,
    finishedAt: startedAt,
    durationMs: 0,
    groups: groupResults(results, groupOfScenario),
    runHoundVersion: RUN_HOUND_VERSION,
    plan,
    approved: toRun.map((s) => s.id),
    results,
    findings,
    summary: summarize(results, findings),
    notVisible: [...NOT_VISIBLE],
    pagesVisited: [...pagesVisited].map(([url, scenarioIds]) => ({ url, scenarioIds })),
    testRecordsCreated,
    ...(wasStopped ? { stopped: true } : {}),
    options: { allowDestructive, headed: options.headed ?? false },
    ...(browserName ? { browser: browserName } : {}),
    accounts: { signedInAs: selfRef, other: sessions.other && signing?.other ? refOf(signing.other) : null },
  };
  // AI explanations (advisory) before the report is written; a stopped run is not explained.
  const ai = options.ai;
  if (ai?.features.explain && findings.length > 0 && !stopped()) {
    const n = Math.min(findings.length, MAX_EXPLAINED);
    engineStep(options, `Asking ${modelLabel(ai.client)} to explain ${n} ${n === 1 ? "finding" : "findings"}`, plan.target);
    try {
      raw = await explainFindings(raw, ai.client, { remote: ai.remote, runToken, signal });
    } catch {
      // Only a stop rejects: the report is written without explanations.
    }
  }
  engineStep(options, "Writing the report", plan.target);
  // Callers (CLI, server) get the same redacted report that was written to disk.
  const finishedMs = Date.now();
  const report: Report = redactReport({ ...raw, finishedAt: new Date(finishedMs).toISOString(), durationMs: finishedMs - startedMs });
  await writeReport(report, dir);
  return { report, dir };
}
