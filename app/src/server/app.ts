import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { BlockList, isIP } from "node:net";
import { dirname, join, resolve } from "node:path";
import { Hono, type Context, type Next } from "hono";
import { CHECK_GROUPS, type AccountId, type AccountRef, type Check, type CheckGroup, type CheckResult, type Plan, type Report } from "../core/types.js";
import { checkAccountsPatch, notReadyMessage, resolveAccounts, saveAccounts } from "../accounts/config.js";
import type { AccountsConfig } from "../accounts/types.js";
import { cleanErrorMessage, NoFormFoundError, TargetNotAllowedError, TargetUnreachableError } from "../engine/errors.js";
import { redactSecrets } from "../engine/redact.js";
import { renderUi } from "./ui/index.js";
import { testConnection } from "../ai/client.js";
import { aiStatus, DEFAULT_BASE_URLS, endpointHost, resolveAiConfig, saveAiConfig } from "../ai/config.js";
import { listModels } from "../ai/models.js";
import { AI_PLAN_BUDGET_MS, aiSession, boundSession, type AiSession } from "../ai/session.js";
import { AI_PROVIDERS, type AiConfigPatch, type AiProvider } from "../ai/types.js";
import { canShowBrowser, discoverAndPlan, newRunId, NO_DISPLAY_MESSAGE, planWarnings, RUN_HOUND_VERSION, runPlan, STOPPED_NOTE, type ProgressEvent, type RunOptions } from "../engine/runner.js";
import { checkLoginUrls, hideInJson, isAccountId, isSignInFailure, planAccount, registerPasswords, testSignIn, usernameHider } from "./accounts.js";

export interface ServerOptions extends Pick<RunOptions, "checks" | "runsDir" | "allowedHosts"> {
  /** Runs allowed at the same time (each one drives its own Chromium). Default 2; more are refused with 409. */
  maxConcurrentRuns?: number;
  /** Whether a visible browser window can open on this machine. Detected (canShowBrowser) when omitted. */
  canShowBrowser?: boolean;
  /**
   * Extra host names and addresses this server answers to, besides loopback ones (RUNHOUND_SERVER_HOSTS).
   * Everything else is refused: a public domain that resolves to 127.0.0.1 (DNS rebinding) can't drive Run Hound
   * from a web page, and another container on the same network can't reach it by the server's IP address.
   */
  serverHosts?: string[];
  /** The address people open (RUNHOUND_PUBLIC_URL, set by the compose files); its host is accepted too. */
  publicUrl?: string;
  /**
   * The address `serve --host` bound to. A specific address is accepted (you chose to serve on it); a wildcard
   * (0.0.0.0, ::) adds nothing, so binding to every interface in a container doesn't open the API to its network.
   */
  boundHost?: string;
  /** How long the AI part of planning (review + suggest) may take per plan. Default AI_PLAN_BUDGET_MS (4 minutes). */
  aiPlanBudgetMs?: number;
}

interface RunState {
  status: "running" | "done" | "error";
  completed: number;
  total: number;
  dir: string;
  /** When the run was accepted (ISO); the same value on every poll. The report's own startedAt is set by runPlan. */
  startedAt: string;
  /** The whole run, once it has ended: report.durationMs when done, time until the failure when it errored. */
  durationMs?: number;
  report?: Report;
  error?: string;
  live: LiveState;
  /** What the run was started with (the unredacted plan stays in memory only), so it can be re-run. */
  plan: Plan;
  approved: string[];
  allowDestructive: boolean;
  headed: boolean;
  /** Whether the run's plan was made with AI; its findings get AI explanations and a rerun uses AI again. */
  ai: boolean;
  /** Aborts the run (POST /api/runs/:id/stop); absent for runs read back from disk. */
  controller?: AbortController;
}

/**
 * What a run tested, for the runs list: the form's name (V0, or a V1 page with one named form), "2 forms" on a page
 * with several, or null. Redacted.
 */
function subjectOf(plan: Plan): string | null {
  const forms = plan.page?.forms;
  if (forms && forms.length > 1) return `${forms.length} forms${forms[0]!.name ? `, including "${redactSecrets(forms[0]!.name)}"` : ""}`;
  return plan.form?.name ? redactSecrets(plan.form.name) : null;
}

/** One row of GET /api/runs. */
interface RunSummary {
  runId: string;
  target: string;
  formName: string | null;
  status: RunState["status"];
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  summary?: Report["summary"];
  completed: number;
  total: number;
  /** The test account the run signed in as (0.4.0); absent for signed-out runs. Never a username. */
  account?: AccountRef;
}

/** What GET /api/runs/:id/live returns, plus the latest frame (served separately as live.jpg). */
interface LiveState {
  scenarioId: string | null;
  scenarioTitle: string | null;
  /** 1-based position of the current scenario among the approved ones (0 before the first). */
  scenarioIndex: number;
  /** The current group (CheckGroup id) and its label, from group-start/scenario-start; null before the first scenario. */
  group: CheckGroup | null;
  groupLabel: string | null;
  step: string | null;
  url: string | null;
  /** Counts frames received, so the UI only reloads live.jpg when there is a new one. */
  frameSeq: number;
  updatedAt: string;
  steps: { scenarioId: string; label: string; url: string; at: string }[];
  pagesVisited: string[];
  /** Scenarios that have ended, in run order, with how long each took (the UI's step log shows it). */
  finished: { scenarioId: string; status: CheckResult["status"]; durationMs: number }[];
  /** The approved scenarios in run order, with their group, so the UI can list what is queued, running and done. */
  scenarios: { id: string; title: string; group: CheckGroup | null; groupLabel: string | null }[];
  /** The browser the run uses, e.g. "Chromium 153.0.8010.12"; null until the report says. */
  browser: string | null;
  /** Only the latest frame is kept; it survives the end of the run so the UI can keep showing it. */
  frame?: Buffer;
}

/** How many steps the live log keeps (oldest dropped first). */
const LIVE_STEPS = 100;

function newLiveState(scenarios: LiveState["scenarios"] = []): LiveState {
  return {
    scenarioId: null,
    scenarioTitle: null,
    scenarioIndex: 0,
    group: null,
    groupLabel: null,
    step: null,
    url: null,
    frameSeq: 0,
    updatedAt: new Date().toISOString(),
    steps: [],
    pagesVisited: [],
    finished: [],
    scenarios,
    browser: null,
  };
}

/** The approved scenarios in the order the runner takes them: group by group (plan.groups), then any left over. */
function runOrder(plan: Plan, approved: Set<string>): LiveState["scenarios"] {
  const byId = new Map(plan.scenarios.map((s) => [s.id, s]));
  const out: LiveState["scenarios"] = [];
  const seen = new Set<string>();
  for (const g of plan.groups ?? []) {
    for (const id of g.scenarioIds) {
      const s = byId.get(id);
      if (!s || !approved.has(id) || seen.has(id)) continue;
      seen.add(id);
      out.push({ id, title: s.title, group: g.id, groupLabel: g.label });
    }
  }
  for (const s of plan.scenarios) {
    if (approved.has(s.id) && !seen.has(s.id)) out.push({ id: s.id, title: s.title, group: null, groupLabel: null });
  }
  return out;
}

const groupLabel = (id: CheckGroup): string => CHECK_GROUPS.find((g) => g.id === id)?.label ?? id;

/** Folds one runner progress event into the live state. URLs and labels arrive already redacted by the engine. */
function applyProgress(live: LiveState, plan: Plan, e: ProgressEvent): void {
  live.updatedAt = new Date().toISOString();
  switch (e.type) {
    case "group-start":
      live.group = e.group;
      live.groupLabel = e.label;
      break;
    case "scenario-start":
      live.scenarioId = e.scenarioId;
      live.scenarioTitle = plan.scenarios.find((s) => s.id === e.scenarioId)?.title ?? null;
      live.scenarioIndex = e.index + 1;
      if (e.group && e.group !== live.group) {
        live.group = e.group;
        live.groupLabel = groupLabel(e.group);
      }
      live.step = null;
      break;
    case "step":
      live.step = e.label;
      live.url = e.url;
      live.steps.push({ scenarioId: e.scenarioId, label: e.label, url: e.url, at: e.at });
      if (live.steps.length > LIVE_STEPS) live.steps.splice(0, live.steps.length - LIVE_STEPS);
      break;
    case "page":
      live.url = e.url;
      if (!live.pagesVisited.includes(e.url)) live.pagesVisited.push(e.url);
      break;
    case "frame":
      live.frame = e.jpeg;
      live.frameSeq += 1;
      break;
    case "scenario-end":
      live.finished.push({ scenarioId: e.scenarioId, status: e.result.status, durationMs: e.result.durationMs });
      break;
  }
}

/** Evidence files served next to report.html: annotated frames and cards (PNG) and recordings (GIF). */
const ARTIFACT_TYPES: Record<string, string> = { ".png": "image/png", ".gif": "image/gif" };

/** Spec and report file names we are willing to serve: a plain base name, never "." or ".." segments. */
const SAFE_FILE = /^[\w-][\w.-]*$/;

const REPORT_FILES: Record<string, string> = {
  "report.json": "application/json; charset=utf-8",
  "report.md": "text/markdown; charset=utf-8",
  "report.html": "text/html; charset=utf-8",
};

/** Addresses that only ever reach this machine: loopback (IPv4-mapped too) and the unspecified 0.0.0.0 / ::. */
const THIS_MACHINE = new BlockList();
THIS_MACHINE.addSubnet("127.0.0.0", 8, "ipv4");
THIS_MACHINE.addAddress("::1", "ipv6");
const UNSPECIFIED = new Set(["0.0.0.0", "::"]);

/** A host name or address as the URL parser writes it, without IPv6 brackets: "LOCALHOST" -> "localhost". */
function hostKey(host: string): string {
  const name = host.trim().replace(/^\[|\]$/g, "").toLowerCase();
  if (isIP(name) !== 6) return name;
  try {
    return new URL(`http://[${name}]/`).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return name;
  }
}

/**
 * Hosts the UI and API answer to without being listed: loopback names and addresses, and 0.0.0.0 / :: (the address
 * `serve --host 0.0.0.0` prints; connecting to it only ever reaches this machine). Any other IP address is refused,
 * so a container on the same network can't use the API by the server's address, and a DNS rebinding attack, which
 * always arrives under a NAME the attacker controls, is refused too.
 */
function isDefaultHost(host: string): boolean {
  const name = hostKey(host);
  if (name === "localhost" || name.endsWith(".localhost") || UNSPECIFIED.has(name)) return true;
  const family = isIP(name);
  return family !== 0 && THIS_MACHINE.check(name, family === 6 ? "ipv6" : "ipv4");
}

/** The host of a URL, or null when it doesn't parse. */
function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return hostKey(new URL(url).hostname) || null;
  } catch {
    return null;
  }
}

/**
 * Security headers on every response: never framed (clickjacking), never MIME-sniffed, no Referer to other sites.
 * The UI and report.html get their own CSP (below); everything else gets one that allows nothing.
 */
const BASE_HEADERS: Record<string, string> = { "x-content-type-options": "nosniff", "x-frame-options": "DENY", "referrer-policy": "no-referrer" };
const DEFAULT_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
/**
 * report.html is page-derived text with no script of its own: nothing runs in it (sandbox, no script-src), and it
 * gets an opaque origin, so even an escaping slip or a tampered file can't call the API. Inline styles and images
 * (its own artifacts and the data: URI mark) still load; allow-popups lets its links open in a new tab.
 */
const REPORT_CSP =
  "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; " +
  "sandbox allow-popups allow-popups-to-escape-sandbox";

/** 'sha256-…' sources for every inline <script> and <style> in the UI document. */
function inlineHashes(html: string, tag: "script" | "style"): string {
  const hashes = [...html.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g"))].map((m) => `'sha256-${createHash("sha256").update(m[1]!, "utf8").digest("base64")}'`);
  return hashes.join(" ") || "'none'";
}

/**
 * The UI's CSP: only its own inline script and stylesheet (by hash; no other inline code, no style attributes),
 * images from this server and data: URIs (the mark), requests only to this server.
 */
function uiCsp(html: string): string {
  return [
    "default-src 'none'",
    `script-src ${inlineHashes(html, "script")}`,
    `style-src ${inlineHashes(html, "style")}`,
    "img-src 'self' data:",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/**
 * Whether a run read back from disk was started with allowDestructive: report.options when the report records it,
 * else whether a destructive approved scenario really ran (it is skipped with "Destructive scenario; …" without the
 * opt-in; a scenario stopped before it started says nothing either way).
 */
function allowedDestructive(report: Report): boolean {
  const recorded: unknown = report.options?.allowDestructive;
  if (typeof recorded === "boolean") return recorded;
  const destructive = new Set(report.plan.scenarios.filter((s) => s.destructive).map((s) => s.id));
  return report.results.some((r) => destructive.has(r.scenarioId) && !(r.status === "skipped" && ((r.notes ?? "").startsWith(STOPPED_NOTE) || /^Destructive scenario\b/.test(r.notes ?? ""))));
}

/** A redacted secret in a URL, as redactSecrets writes it: "[REDACTED:github-token]". */
const REDACTED = /\[REDACTED:[\w-]*\]/;

/** Errors caused by the user's input (bad or refused URL, no form, page won't load) rather than by Run Hound. */
function isUserError(err: unknown): boolean {
  return (
    isSignInFailure(err) ||
    err instanceof TargetNotAllowedError ||
    err instanceof NoFormFoundError ||
    err instanceof TargetUnreachableError ||
    (err instanceof Error && /net::ERR_|Timeout .*exceeded/.test(err.message))
  );
}

/** Plans and finished runs kept in memory; the oldest are dropped first (finished runs stay readable from disk). */
const MAX_PLANS = 50;
const MAX_RUNS = 50;

/** Run ids are generated by newRunId(); anything else is never looked up on disk. */
const RUN_ID = /^[\w-]+$/;

/** A stored plan and whether it was made with AI (so the run explains its findings). */
interface StoredPlan {
  plan: Plan;
  ai: boolean;
}

/**
 * The AI session for one request, from the config as it is now (saved file + env). `wanted` undefined = use AI when
 * it is enabled and usable. When AI is wanted but can't be used, the reason comes back as a plan warning.
 */
async function aiForRequest(wanted: boolean | undefined): Promise<{ ai?: AiSession; warning?: string }> {
  if (wanted === false) return {};
  const out = aiSession(await resolveAiConfig());
  if ("session" in out) return { ai: out.session };
  return wanted ? { warning: `AI was not used: ${out.problem}.` } : {};
}

/** A request to sign in as a test account: the slot and the accounts resolved for it. */
interface SignedInAs {
  id: AccountId;
  accounts: AccountsConfig;
}

/**
 * The accounts as they are now (saved file + RUNHOUND_ACCOUNT_* env) for signing in as `id`, or why that can't be
 * done (the slot isn't set up), naming the account by its label. Nothing is sent to the app.
 */
async function accountsFor(id: AccountId): Promise<SignedInAs | { error: string }> {
  const { config, status } = await resolveAccounts();
  const why = notReadyMessage(status.accounts[id]);
  return why ? { error: redactSecrets(why) } : { id, accounts: config };
}

/** Sign-in tests (POST /api/accounts/test) allowed at the same time. */
const MAX_SIGN_IN_TESTS = 2;

/** Origin of a URL, or null when it doesn't parse. */
function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** Check titles for the plan's fieldset legends, e.g. {"dead-control": "Every button does something"}. */
async function checkTitles(checks: Check[] | undefined): Promise<Record<string, string>> {
  const list = checks ?? (await import("../checks/index.js")).checks;
  return Object.fromEntries(list.map((c) => [c.id, c.title]));
}

/**
 * Local UI + JSON API (served on port 4000 by the CLI):
 *   GET  /                          HTML UI (ui/index.ts renderUi): the app shell with hash routes #/new (target -> plan),
 *                                   #/runs, #/runs/<id> (running view, then the report) and #/settings
 *   POST /api/plan  {url, ai?: boolean, signInAs?: "a" | "b" | null}  200 {planId, plan, checks: {checkId: title},
 *                                   warnings: string[]} | 400 {error} (bad URL, not allowed, unreachable, no form,
 *                                   non-boolean ai, another signInAs, an account that isn't set up (named, before
 *                                   anything is sent to the app), a failed sign-in (the SignInError message)).
 *                                   signInAs signs in as that test account before discovery (docs/v2-spec.md) and the
 *                                   plan records it (plan.account = {id, label}). "localhost:3000/book"
 *                                   is read as http://localhost:3000/book. `ai` defaults to on when AI is enabled and
 *                                   usable (AiStatus.problem null); with AI the model reviews the plan (Scenario.ai) and
 *                                   suggests "ai-flow:<n>" scenarios (never ticked), and plan.ai says which model and
 *                                   lists its warnings. ai: true while AI can't be used still plans, and the reason is
 *                                   one of `warnings`. A plan made with AI gets AI explanations when it runs.
 *   POST /api/runs  {planId, approved: string[], allowDestructive?: boolean, headed?: boolean}  202 {runId}
 *                                   | 404 unknown plan | 400 empty approval, unknown scenario ids, a non-boolean flag or
 *                                   the plan's account no longer set up | 409 too many runs in progress
 *                                   (maxConcurrentRuns). A plan made signed in runs signed in again as that account
 *                                   (a fresh session), with the accounts as they are when the run starts.
 *   GET  /api/runs/:runId           {status: "running"|"done"|"error", completed, total, startedAt, durationMs? (once
 *                                   ended), report?, error?}
 *   GET  /api/runs/:runId/report.json | report.md | report.html
 *   GET  /api/runs/:runId/specs/:file
 *   GET  /api/runs/:runId/artifacts/:file   evidence images (PNG) and recordings (GIF) referenced by report.html
 *   GET  /api/runs/:runId/live       {status, startedAt, elapsedMs, scenarioId, scenarioTitle, scenarioIndex, group,
 *                                     groupLabel, step, url, frameSeq, updatedAt, steps: [{scenarioId, label, url, at}]
 *                                     (last 100), pagesVisited: string[], finished: [{scenarioId, status, durationMs}],
 *                                     scenarios: [{id, title, group, groupLabel}] (approved, in run order)}
 *   GET  /api/runs/:runId/live.jpg   latest frame of the browser under test (image/jpeg, no-store); 404 before the first frame
 *   GET  /api/runs                   {runs: [{runId, target, formName, status, startedAt, finishedAt?, durationMs?, summary?,
 *                                     completed, total, account?: {id, label}}]}: runs in memory and finished runs in
 *                                     runsDir, newest first
 *   POST /api/runs/:runId/stop       202 {runId} (the run ends "done" with report.stopped) | 409 already ended or stopping | 404
 *   POST /api/runs/:runId/rerun      202 {runId}: plans the same target again (with AI when the run used it) and runs it
 *                                   approving the previous run's scenario ids that are still in the new plan | 400 none
 *                                   left or the target can't be planned | 404 | 409 busy
 *   GET  /api/settings               {version, runsDir, allowedHosts, serverHosts, ai: AiStatus}
 *   GET  /api/ai                     AiStatus (ai/types.ts): the resolved AI config without the key (hasKey says whether
 *                                   one is set), where each value came from (sources; env/flag = locked), remote, host,
 *                                   problem ("AI is off", "Choose a model", "... needs your consent") or null
 *   PUT  /api/ai  AiConfigPatch      200 AiStatus (+ notice when the saved key was removed because the endpoint changed) | 400 {error} (invalid value, or a value set by an environment variable,
 *                                   named) | 403 cross-site | 415 not JSON. Saves <configDir>/ai.json (0600). apiKey:
 *                                   omitted or "" keeps the saved key, null removes it. The key is never sent back.
 *   POST /api/ai/test  {}            200 {ok: true, model, ms} | {ok: false, error}: one tiny call with the saved settings
 *                                   (even while AI is switched off, so it can be tried before turning it on)
 *   GET  /api/ai/models?provider=&baseUrl=&allowRemote=  200 AiModelList {models: [{id, details, suitable}], error}
 *                                   (error set, models [] when listing failed). provider/baseUrl default to the saved
 *                                   ones (another provider without baseUrl: its default URL). The saved key is sent only
 *                                   to the saved endpoint's origin. A remote endpoint is contacted only with consent:
 *                                   the saved allowRemote for the same host, or allowRemote=true (the unsaved consent box).
 *   GET  /api/accounts               AccountsStatus (accounts/types.ts): {isolated, isolatedSource, file, accounts: {a, b:
 *                                   {id, label, loginUrl, username, hasPassword, ready, sources, problem}}}. Never a password.
 *   PUT  /api/accounts  AccountsPatch 200 AccountsStatus | 400 {error} (not a patch, a login URL that isn't http(s) or that
 *                                   the safety gate refuses (the host named), a password with no sign-in page) | 403 |
 *                                   415. Omitted fields are kept; password "" removes the saved one. Saves
 *                                   <configDir>/accounts.json (0600).
 *   POST /api/accounts/test  {id: "a" | "b"}  200 SignInCheck {id, ok, landedOn?, message}: signs in with a fresh browser;
 *                                   a slot that isn't set up answers ok: false naming it, without contacting the app |
 *                                   400 another id | 409 two sign-in tests already running
 * The AI config and the test accounts are resolved per request ($RUNHOUND_CONFIG_DIR, else $XDG_CONFIG_HOME/run-hound, else
 * ~/.config/run-hound, plus RUNHOUND_AI_* and RUNHOUND_ACCOUNT* env). /api/ai and /api/accounts routes require the header
 * X-Run-Hound: 1 (403 without it) and refuse browser requests from other sites (Sec-Fetch-Site cross-site/same-site) as
 * well as cross-site Origins. Account passwords are registered as literal secrets (redactSecrets hides them) while a
 * signed-in plan is made and while a signed-in run runs.
 * POST /api/plan and rerun bound the AI steps by the request's abort signal and aiPlanBudgetMs (default 4 minutes).
 * The live state also carries `browser` ("Chromium 153..."): null until the first scenario starts, then the Chromium
 * build Playwright launches (bundledChromium), replaced by report.browser (what the browser itself reported) at the end.
 * POST /api/runs also accepts {headed?: boolean} to open a visible browser window on the machine running Run Hound.
 * While a run is in progress the UI shows a live view: the numbered scenario list with the running scenario's steps,
 * the browser, the page URL, the latest frame (refreshed about twice a second) and the step log.
 * Plans and run states live in memory (the newest 50 of each); a finished run that is no longer in memory, or was
 * written before a restart, is read back from runsDir/<runId>/report.json, so report links keep working. The runs
 * list parses such a report once per change of the file (mtime and size). A re-run of a run read back from disk keeps
 * allowDestructive (report.options, else whether a destructive scenario ran) and is refused (400) when the saved
 * target had a secret redacted out of it.
 * The UI keeps the run id in the page's #/runs/<id> fragment, so reloading the page shows the same run (old #run=<id>
 * links still open it).
 * Every request must be addressed to loopback (localhost, *.localhost, 127.0.0.0/8, ::1, or 0.0.0.0 / ::), a name or
 * address in serverHosts, the host of publicUrl or the specific boundHost; anything else, other IP addresses included,
 * is 403. Every response is nosniff, X-Frame-Options: DENY, Referrer-Policy: no-referrer and carries a CSP with
 * frame-ancestors 'none': the UI's allows only its own inline script and stylesheet (by hash), report.html's is
 * sandboxed with no scripts, and the rest allow nothing.
 */
export function createApp(options: ServerOptions = {}): Hono {
  const app = new Hono();
  const plans = new Map<string, StoredPlan>();
  const runs = new Map<string, RunState>();
  const runsDir = resolve(options.runsDir ?? "runs");
  // Accepted besides loopback: RUNHOUND_SERVER_HOSTS, the host of the address people open (RUNHOUND_PUBLIC_URL) and
  // the specific address `serve --host` bound to. Loopback ones and wildcards add nothing.
  const bound = options.boundHost ? hostKey(options.boundHost) : "";
  const extraHosts = [
    ...new Set(
      [
        ...(options.serverHosts ?? (process.env.RUNHOUND_SERVER_HOSTS ?? "").split(",")).map(hostKey),
        hostOf(options.publicUrl ?? process.env.RUNHOUND_PUBLIC_URL) ?? "",
        UNSPECIFIED.has(bound) ? "" : bound,
      ].filter((h) => h && !isDefaultHost(h)),
    ),
  ];
  const hostAllowed = (host: string) => isDefaultHost(host) || extraHosts.includes(hostKey(host));
  const maxRuns = options.maxConcurrentRuns ?? 2;
  const aiPlanBudgetMs = options.aiPlanBudgetMs ?? AI_PLAN_BUDGET_MS;
  const allowedHosts = (): string[] => options.allowedHosts ?? (process.env.RUNHOUND_ALLOWED_HOSTS ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  // Sign-in tests (POST /api/accounts/test) in progress: each drives its own Chromium.
  let signInTests = 0;

  /**
   * discoverAndPlan with the AI steps bounded: they stop when the HTTP request is aborted and after aiPlanBudgetMs in
   * all. Either way the built-in plan comes back with the runner's warnings; a spent budget adds `warning`.
   */
  async function planBounded(target: string, ai: AiSession | undefined, signal: AbortSignal, signedIn?: SignedInAs): Promise<{ plan: Plan; warning?: string }> {
    const bound = ai ? boundSession(ai, { signal, budgetMs: aiPlanBudgetMs }) : undefined;
    const plan = await discoverAndPlan(target, {
      checks: options.checks,
      allowedHosts: options.allowedHosts,
      ...(bound ? { ai: bound.session } : {}),
      ...(signedIn ? { signInAs: signedIn.id, accounts: signedIn.accounts } : {}),
    });
    if (!bound?.timedOut()) return { plan };
    const limit = aiPlanBudgetMs >= 60_000 ? `${Math.round(aiPlanBudgetMs / 60_000)} minutes` : `${Math.round(aiPlanBudgetMs / 100) / 10} s`;
    return { plan, warning: `AI planning was stopped after ${limit}, so the plan has only what the model finished in time.` };
  }

  /** Drops the oldest entries (Maps keep insertion order); running runs are never dropped. */
  function prune(): void {
    for (const id of [...plans.keys()].slice(0, Math.max(0, plans.size - MAX_PLANS))) plans.delete(id);
    const finished = [...runs].filter(([, r]) => r.status !== "running").map(([id]) => id);
    for (const id of finished.slice(0, Math.max(0, runs.size - MAX_RUNS))) runs.delete(id);
  }

  /** Summaries of finished runs read from disk, by run id, with the report.json mtime and size they were read at. */
  const diskSummaries = new Map<string, { mtimeMs: number; size: number; summary: RunSummary | null }>();

  /** The run's state from memory, or a finished run read back from disk (after a restart or pruning). */
  async function runState(runId: string): Promise<RunState | undefined> {
    const known = runs.get(runId);
    if (known || !RUN_ID.test(runId)) return known;
    const dir = join(runsDir, runId);
    try {
      if (!(await stat(dir)).isDirectory()) return undefined;
      const report = JSON.parse(await readFile(join(dir, "report.json"), "utf8")) as Report;
      if (report.runId !== runId) return undefined;
      const live = newLiveState(runOrder(report.plan, new Set(report.approved ?? report.results.map((r) => r.scenarioId))));
      live.pagesVisited = (report.pagesVisited ?? []).map((p) => p.url);
      live.finished = report.results.map((r) => ({ scenarioId: r.scenarioId, status: r.status, durationMs: r.durationMs }));
      live.browser = report.browser ?? null;
      const durationMs = report.durationMs ?? Date.parse(report.finishedAt) - Date.parse(report.startedAt);
      const approved = report.approved ?? report.results.map((r) => r.scenarioId);
      return {
        status: "done",
        completed: report.results.length,
        total: report.results.length,
        dir,
        startedAt: report.startedAt,
        durationMs,
        report,
        live,
        // The plan as written to disk: its target is redacted (the rerun refuses one with a redacted secret).
        plan: report.plan,
        approved,
        allowDestructive: allowedDestructive(report),
        headed: report.options?.headed === true,
        ai: Boolean(report.plan.ai ?? report.ai),
      };
    } catch {
      return undefined;
    }
  }

  function summarize(runId: string, state: RunState): RunSummary {
    const report = state.report;
    const out: RunSummary = {
      runId,
      target: redactSecrets(report?.target ?? state.plan.target),
      formName: subjectOf(report?.plan ?? state.plan),
      status: state.status,
      startedAt: state.startedAt,
      completed: state.completed,
      total: state.total,
    };
    const account = planAccount(report?.plan ?? state.plan);
    if (account) out.account = account;
    if (state.status !== "running") {
      out.finishedAt = report?.finishedAt ?? new Date(Date.parse(state.startedAt) + (state.durationMs ?? 0)).toISOString();
      if (state.durationMs !== undefined) out.durationMs = state.durationMs;
      if (report) out.summary = report.summary;
    }
    return out;
  }

  /**
   * A finished run's summary from runsDir/<id>/report.json, parsed once per change of the file (its mtime and size):
   * the UI polls the list every 2 s during a run, and reports can be hundreds of KB each.
   */
  async function diskSummary(runId: string): Promise<RunSummary | null> {
    let info;
    try {
      info = await stat(join(runsDir, runId, "report.json"));
    } catch {
      diskSummaries.delete(runId);
      return null;
    }
    const cached = diskSummaries.get(runId);
    if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) return cached.summary;
    const state = await runState(runId);
    const summary = state ? summarize(runId, state) : null;
    diskSummaries.set(runId, { mtimeMs: info.mtimeMs, size: info.size, summary });
    return summary;
  }

  /** Runs in memory plus finished runs on disk (runsDir/<id>/report.json), newest first. */
  async function listRuns(): Promise<RunSummary[]> {
    const out = [...runs].map(([id, state]) => summarize(id, state));
    let names: string[] = [];
    try {
      names = (await readdir(runsDir, { withFileTypes: true })).filter((d) => d.isDirectory() && RUN_ID.test(d.name)).map((d) => d.name);
    } catch {
      // No runs folder yet.
    }
    const present = new Set(names);
    for (const id of diskSummaries.keys()) if (!present.has(id)) diskSummaries.delete(id);
    const onDisk = await Promise.all(names.filter((id) => !runs.has(id)).map(diskSummary));
    for (const summary of onDisk) if (summary) out.push(summary);
    return out.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt) || (a.runId < b.runId ? 1 : a.runId > b.runId ? -1 : 0));
  }

  /** Starts a run in the background; returns its id, or an error response body and status. */
  function startRun(
    plan: Plan,
    approved: string[],
    flags: { allowDestructive: boolean; headed: boolean; ai: boolean; session?: AiSession; accounts?: AccountsConfig },
  ): { runId: string } | { error: string; code: 409 } {
    const running = [...runs.values()].filter((r) => r.status === "running").length;
    if (running >= maxRuns) {
      return { error: `${running} run${running === 1 ? " is" : "s are"} already in progress. Wait for ${running === 1 ? "it" : "one"} to finish.`, code: 409 };
    }
    const approvedSet = new Set(approved);
    const runId = newRunId();
    const controller = new AbortController();
    // What the live view shows of a signed-in run never names an account's username (nor any secret).
    const hide = usernameHider(flags.accounts);
    const shown = hideInJson(redactPlan(plan), hide);
    const state: RunState = {
      status: "running",
      completed: 0,
      total: plan.scenarios.filter((s) => approvedSet.has(s.id)).length,
      dir: join(runsDir, runId),
      startedAt: new Date().toISOString(),
      live: newLiveState(runOrder(shown, approvedSet)),
      plan,
      approved: [...approvedSet],
      allowDestructive: flags.allowDestructive,
      headed: flags.headed,
      ai: flags.ai,
      controller,
    };
    runs.set(runId, state);
    prune();

    // The accounts' passwords stay redacted from everything the run reports until it has ended.
    const unregister = flags.accounts ? registerPasswords(flags.accounts) : () => undefined;
    runPlan(plan, {
      checks: options.checks,
      allowedHosts: options.allowedHosts,
      runsDir,
      runId,
      approved: state.approved,
      allowDestructive: flags.allowDestructive,
      headed: flags.headed,
      signal: controller.signal,
      ...(flags.session ? { ai: flags.session } : {}),
      ...(flags.accounts ? { accounts: flags.accounts } : {}),
      // The UI always shows the live view, so the server always asks for the screencast.
      live: true,
      onProgress: (e) => {
        if (e.type === "scenario-end") state.completed += 1;
        // The runner reports the browser it really launched; until then (and for runners that don't), the build the
        // installed Playwright ships.
        if (e.type === "browser") state.live.browser = e.name;
        if (e.type === "scenario-start" && state.live.browser === null) state.live.browser = bundledChromium();
        const event = e.type === "step" ? { ...e, label: hide(e.label), url: hide(e.url) } : e.type === "page" ? { ...e, url: hide(e.url) } : e;
        applyProgress(state.live, shown, event);
      },
    }).then(
      ({ report: raw, dir }) => {
        const report = flags.accounts ? hideInJson(raw, hide) : raw;
        const durationMs = report.durationMs ?? Date.parse(report.finishedAt) - Date.parse(report.startedAt);
        Object.assign(state, { status: "done", report, dir, durationMs, controller: undefined });
        // The report is authoritative once written (it also covers pages seen before a frame or step).
        if (report.pagesVisited) state.live.pagesVisited = report.pagesVisited.map((p) => p.url);
        state.live.browser = report.browser ?? null;
        state.live.updatedAt = new Date().toISOString();
        unregister();
      },
      (err: unknown) => {
        Object.assign(state, {
          status: "error",
          controller: undefined,
          durationMs: Date.now() - Date.parse(state.startedAt),
          error: hide(redactSecrets(cleanErrorMessage(err instanceof Error ? err.message : String(err)))),
        });
        state.live.updatedAt = new Date().toISOString();
        unregister();
      },
    );
    return { runId };
  }

  // Security headers on every response, refusals included (see BASE_HEADERS); images need no CSP.
  app.use("*", async (c, next) => {
    await next();
    for (const [name, value] of Object.entries(BASE_HEADERS)) c.header(name, value);
    if (!c.res.headers.has("content-security-policy") && !(c.res.headers.get("content-type") ?? "").startsWith("image/")) {
      c.header("content-security-policy", DEFAULT_CSP);
    }
  });

  // Only answer requests addressed to this machine, and never act on a POST from another site.
  app.use("*", async (c, next) => {
    const { hostname, origin } = new URL(c.req.url);
    if (!hostAllowed(hostname)) {
      return c.json(
        { error: `Run Hound does not answer to the host name "${hostname}". Set RUNHOUND_SERVER_HOSTS=${hostname} if you meant to use it.` },
        403,
      );
    }
    const sent = c.req.header("origin");
    if (sent && sent !== origin && c.req.method !== "GET" && c.req.method !== "HEAD") {
      return c.json({ error: "Cross-site requests are not allowed." }, 403);
    }
    await next();
  });

  const headedAvailable = options.canShowBrowser ?? canShowBrowser();
  const uiHtml = renderUi({ version: RUN_HOUND_VERSION, canShowBrowser: headedAvailable });
  const uiPolicy = uiCsp(uiHtml);
  app.get("/", (c) => c.html(uiHtml, 200, { "content-security-policy": uiPolicy }));

  // Only accept JSON posts: a cross-site page can send text/plain without a CORS preflight, but not application/json.
  app.use("/api/*", async (c, next) => {
    if ((c.req.method === "POST" || c.req.method === "PUT") && !(c.req.header("content-type") ?? "").toLowerCase().startsWith("application/json")) {
      return c.json({ error: "Send the request body as application/json." }, 415);
    }
    await next();
  });

  app.post("/api/plan", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "The request body must be JSON like {\"url\": \"http://localhost:3000/\"}." }, 400);
    }
    const url = (body as { url?: unknown } | null)?.url;
    if (typeof url !== "string" || url.trim() === "") return c.json({ error: "Enter the URL of the page with your form." }, 400);
    const wantAi = (body as { ai?: unknown }).ai;
    if (wantAi !== undefined && typeof wantAi !== "boolean") return c.json({ error: "ai must be true or false." }, 400);
    const signInAs = (body as { signInAs?: unknown }).signInAs;
    if (signInAs !== undefined && signInAs !== null && !isAccountId(signInAs)) {
      return c.json({ error: 'signInAs must be "a" (Account A), "b" (Account B) or null (not signed in).' }, 400);
    }
    // An account that isn't set up is refused before anything is sent to the app.
    let signedIn: SignedInAs | undefined;
    if (isAccountId(signInAs)) {
      const found = await accountsFor(signInAs);
      if ("error" in found) return c.json({ error: found.error }, 400);
      signedIn = found;
    }

    const unregister = signedIn ? registerPasswords(signedIn.accounts, [signedIn.id]) : () => undefined;
    const hide = usernameHider(signedIn?.accounts);
    try {
      const { ai, warning } = await aiForRequest(wantAi);
      const { plan, warning: budgetWarning } = await planBounded(url.trim(), ai, c.req.raw.signal, signedIn);
      const planId = randomUUID();
      plans.set(planId, { plan, ai: ai !== undefined });
      prune();
      // The stored plan keeps the real target; what leaves the process is redacted (and names no username).
      const warnings = [...planWarnings(plan), ...(warning ? [warning] : []), ...(budgetWarning ? [budgetWarning] : [])].map((w) => hide(redactSecrets(w)));
      return c.json({ planId, plan: hideInJson(redactPlan(plan), hide), checks: await checkTitles(options.checks), warnings }, 200);
    } catch (err) {
      const message = hide(redactSecrets(cleanErrorMessage(err instanceof Error ? err.message : String(err))));
      if (isUserError(err)) return c.json({ error: message }, 400);
      return c.json({ error: `Could not plan a run: ${message}` }, 500);
    } finally {
      unregister();
    }
  });

  app.post("/api/runs", async (c) => {
    let body: { planId?: unknown; approved?: unknown; allowDestructive?: unknown; headed?: unknown };
    try {
      body = ((await c.req.json()) ?? {}) as typeof body;
    } catch {
      return c.json({ error: "The request body must be JSON." }, 400);
    }
    const stored = typeof body.planId === "string" ? plans.get(body.planId) : undefined;
    if (!stored) return c.json({ error: "Unknown plan. Create a plan first." }, 404);
    const plan = stored.plan;
    if (body.approved !== undefined && !(Array.isArray(body.approved) && body.approved.every((a) => typeof a === "string"))) {
      return c.json({ error: "approved must be a list of scenario ids." }, 400);
    }
    for (const flag of ["allowDestructive", "headed"] as const) {
      if (body[flag] !== undefined && typeof body[flag] !== "boolean") return c.json({ error: `${flag} must be true or false.` }, 400);
    }
    if (body.headed === true && !headedAvailable) return c.json({ error: NO_DISPLAY_MESSAGE }, 400);

    const approved = body.approved as string[] | undefined;
    const unknown = (approved ?? []).filter((id) => !plan.scenarios.some((s) => s.id === id));
    if (unknown.length > 0) return c.json({ error: `Unknown scenario id(s): ${redactSecrets(unknown.join(", "))}.` }, 400);
    const approvedIds = approved ?? plan.scenarios.filter((s) => s.defaultSelected).map((s) => s.id);
    // An empty run would report "0 findings" and look like a clean pass.
    if (approvedIds.length === 0) return c.json({ error: "Select at least one scenario to run." }, 400);
    // A run signs in again as the account its plan was made as, with the accounts as they are now.
    let accounts: AccountsConfig | undefined;
    if (plan.account) {
      const found = await accountsFor(plan.account.id);
      if ("error" in found) return c.json({ error: found.error }, 400);
      accounts = found.accounts;
    }
    const session = stored.ai ? (await aiForRequest(true)).ai : undefined;
    const started = startRun(plan, approvedIds, { allowDestructive: body.allowDestructive === true, headed: body.headed === true, ai: stored.ai, session, ...(accounts ? { accounts } : {}) });
    if ("error" in started) return c.json({ error: started.error }, started.code);
    return c.json({ runId: started.runId }, 202);
  });

  app.get("/api/runs", async (c) => c.json({ runs: await listRuns() }, 200, { "cache-control": "no-store" }));

  app.get("/api/settings", async (c) =>
    c.json({
      version: RUN_HOUND_VERSION,
      runsDir,
      allowedHosts: allowedHosts(),
      serverHosts: extraHosts,
      ai: aiStatus(await resolveAiConfig()),
    }),
  );

  // The AI settings hold a key and make the server call out: never let another site's page drive them, not even with
  // a GET. Every /api/ai* request must carry X-Run-Hound: 1: an <img>, <link> or form can't send a custom header, and
  // a cross-site fetch with one needs a CORS preflight this server never grants. Sec-Fetch-Site (browsers mark
  // cross-site GETs with it) and the Origin check above stay as further layers.
  // The test accounts hold passwords and make the server sign in to the app: the same guard.
  const headerGuard = (path: string) => async (c: Context, next: Next) => {
    const site = (c.req.header("sec-fetch-site") ?? "").toLowerCase();
    if (site === "cross-site" || site === "same-site") return c.json({ error: "Cross-site requests are not allowed." }, 403);
    if (c.req.header("x-run-hound") !== "1") return c.json({ error: `Requests to ${path} must send the header X-Run-Hound: 1.` }, 403);
    await next();
  };
  const aiGuard = headerGuard("/api/ai");
  app.use("/api/ai", aiGuard);
  app.use("/api/ai/*", aiGuard);
  const accountsGuard = headerGuard("/api/accounts");
  app.use("/api/accounts", accountsGuard);
  app.use("/api/accounts/*", accountsGuard);

  app.get("/api/ai", async (c) => c.json(aiStatus(await resolveAiConfig()), 200, { "cache-control": "no-store" }));

  app.put("/api/ai", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "The request body must be JSON." }, 400);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) return c.json({ error: "Send the AI settings as a JSON object." }, 400);
    const features = (body as { features?: unknown }).features;
    if (features !== undefined && (typeof features !== "object" || features === null || Array.isArray(features) || Object.values(features).some((v) => typeof v !== "boolean"))) {
      return c.json({ error: "features must be an object like {\"review\": true, \"suggest\": true, \"explain\": false}." }, 400);
    }
    try {
      const { notice, ...resolved } = await saveAiConfig(body as AiConfigPatch);
      return c.json({ ...aiStatus(resolved), ...(notice ? { notice } : {}) }, 200, { "cache-control": "no-store" });
    } catch (err) {
      return c.json({ error: redactSecrets(err instanceof Error ? err.message : String(err)) }, 400);
    }
  });

  app.post("/api/ai/test", async (c) => {
    const { config } = await resolveAiConfig();
    const result = await testConnection({ ...config, enabled: true });
    return c.json(result.ok ? result : { ok: false, error: redactSecrets(result.error) }, 200, { "cache-control": "no-store" });
  });

  app.get("/api/ai/models", async (c) => {
    const { config } = await resolveAiConfig();
    const asked = c.req.query("provider");
    if (asked && !(AI_PROVIDERS as readonly string[]).includes(asked)) return c.json({ error: `Unknown provider "${redactSecrets(asked)}".` }, 400);
    const provider = (asked || config.provider) as AiProvider;
    const baseUrl = c.req.query("baseUrl") || (provider === config.provider ? config.baseUrl : DEFAULT_BASE_URLS[provider]);
    const target = { provider, baseUrl, region: config.region };
    const savedOrigin = originOf(config.baseUrl);
    // The saved key only ever goes to the endpoint it was saved for.
    const apiKey = savedOrigin !== null && originOf(baseUrl) === savedOrigin ? config.apiKey : null;
    const consent = /^(1|true|on)$/i.test(c.req.query("allowRemote") ?? "") || (config.allowRemote && endpointHost(target) === endpointHost(config));
    const list = await listModels({ ...target, apiKey, allowRemote: consent });
    return c.json(list.error ? { ...list, error: redactSecrets(list.error) } : list, 200, { "cache-control": "no-store" });
  });

  app.get("/api/accounts", async (c) => c.json((await resolveAccounts()).status, 200, { "cache-control": "no-store" }));

  app.put("/api/accounts", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "The request body must be JSON." }, 400);
    }
    try {
      checkAccountsPatch(body);
      await checkLoginUrls(body, (await resolveAccounts()).status, { allowedHosts: allowedHosts() });
    } catch (err) {
      return c.json({ error: redactSecrets(err instanceof Error ? err.message : String(err)) }, 400);
    }
    try {
      return c.json(await saveAccounts(body), 200, { "cache-control": "no-store" });
    } catch (err) {
      const message = redactSecrets(err instanceof Error ? err.message : String(err));
      // A file system error (the folder can't be written) is Run Hound's problem, not the request's.
      if ((err as NodeJS.ErrnoException).code) return c.json({ error: `Could not save the test accounts: ${message}` }, 500);
      return c.json({ error: message }, 400);
    }
  });

  app.post("/api/accounts/test", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "The request body must be JSON like {\"id\": \"a\"}." }, 400);
    }
    const id = (body as { id?: unknown } | null)?.id;
    if (!isAccountId(id)) return c.json({ error: 'id must be "a" (Account A) or "b" (Account B).' }, 400);
    if (signInTests >= MAX_SIGN_IN_TESTS) return c.json({ error: "Another sign-in test is still running. Wait for it to finish." }, 409);
    signInTests += 1;
    try {
      return c.json(await testSignIn(id, await resolveAccounts(), { allowedHosts: allowedHosts() }), 200, { "cache-control": "no-store" });
    } finally {
      signInTests -= 1;
    }
  });

  app.post("/api/runs/:runId/stop", async (c) => {
    const state = await runState(c.req.param("runId"));
    if (!state) return c.json({ error: "Unknown run." }, 404);
    if (state.status !== "running" || !state.controller) return c.json({ error: "This run has already ended." }, 409);
    if (state.controller.signal.aborted) return c.json({ error: "This run is already stopping." }, 409);
    state.controller.abort();
    state.live.updatedAt = new Date().toISOString();
    return c.json({ runId: c.req.param("runId") }, 202);
  });

  app.post("/api/runs/:runId/rerun", async (c) => {
    const state = await runState(c.req.param("runId"));
    if (!state) return c.json({ error: "Unknown run." }, 404);
    // A run read back from disk has the redacted target: planning it would test the wrong address.
    if (REDACTED.test(state.plan.target)) {
      return c.json({ error: "This run's address had a secret in it (a token or key), which is hidden in saved reports, so the run can't be planned again from here. Start a new run with the full address." }, 400);
    }
    // Don't open a browser to plan when the run couldn't start anyway (startRun checks again after planning).
    const running = [...runs.values()].filter((r) => r.status === "running").length;
    if (running >= maxRuns) return c.json({ error: `${running} run${running === 1 ? " is" : "s are"} already in progress. Wait for ${running === 1 ? "it" : "one"} to finish.` }, 409);
    // Signed in as the same account as before, with the accounts as they are now.
    const account = planAccount(state.plan);
    let signedIn: SignedInAs | undefined;
    if (account) {
      const found = await accountsFor(account.id);
      if ("error" in found) return c.json({ error: found.error }, 400);
      signedIn = found;
    }
    // Plan the target again: the page may have changed since, so scenario ids are matched against the new plan.
    let plan: Plan;
    // Whether AI was used carries over; it can't be used now (turned off since) → the rerun goes without it.
    const { ai: session } = await aiForRequest(state.ai);
    const unregister = signedIn ? registerPasswords(signedIn.accounts, [signedIn.id]) : () => undefined;
    try {
      plan = (await planBounded(state.plan.target, session, c.req.raw.signal, signedIn)).plan;
    } catch (err) {
      const message = usernameHider(signedIn?.accounts)(redactSecrets(cleanErrorMessage(err instanceof Error ? err.message : String(err))));
      if (isUserError(err)) return c.json({ error: message }, 400);
      return c.json({ error: `Could not plan the run again: ${message}` }, 500);
    } finally {
      unregister();
    }
    const known = new Set(plan.scenarios.map((s) => s.id));
    const approved = state.approved.filter((id) => known.has(id));
    if (approved.length === 0) {
      return c.json({ error: "None of this run's scenarios are in the new plan (the page has changed). Start a new run instead." }, 400);
    }
    const started = startRun(plan, approved, {
      allowDestructive: state.allowDestructive,
      headed: state.headed && headedAvailable,
      ai: session !== undefined,
      session,
      ...(signedIn ? { accounts: signedIn.accounts } : {}),
    });
    if ("error" in started) return c.json({ error: started.error }, started.code);
    return c.json({ runId: started.runId }, 202);
  });

  app.get("/api/runs/:runId", async (c) => {
    const state = await runState(c.req.param("runId"));
    if (!state) return c.json({ error: "Unknown run." }, 404);
    const { dir: _dir, live: _live, plan: _plan, approved: _approved, allowDestructive: _d, headed: _h, ai: _ai, controller: _c, ...status } = state;
    return c.json(status);
  });

  app.get("/api/runs/:runId/live", async (c) => {
    const state = await runState(c.req.param("runId"));
    if (!state) return c.json({ error: "Unknown run." }, 404);
    const { frame: _frame, ...live } = state.live;
    const elapsedMs = state.durationMs ?? Math.max(0, Date.now() - Date.parse(state.startedAt));
    return c.json({ status: state.status, startedAt: state.startedAt, elapsedMs, ...live }, 200, { "cache-control": "no-store" });
  });

  // The latest screencast frame. Pixels can't be redacted, which is why this is only served on loopback-guarded hosts.
  app.get("/api/runs/:runId/live.jpg", (c) => {
    const frame = runs.get(c.req.param("runId"))?.live.frame;
    if (!frame) return c.json({ error: "No frame yet." }, 404);
    return c.body(new Uint8Array(frame), 200, { "content-type": "image/jpeg", "cache-control": "no-store" });
  });

  app.get("/api/runs/:runId/:file{report\\.(?:json|md|html)}", async (c) => {
    const state = await runState(c.req.param("runId"));
    const file = c.req.param("file");
    const type = REPORT_FILES[file];
    if (!state || state.status !== "done" || !type) return c.json({ error: "Not found." }, 404);
    return c.body(await readFile(join(state.dir, file), "utf8"), 200, { "content-type": type, ...(file === "report.html" ? { "content-security-policy": REPORT_CSP } : {}) });
  });

  app.get("/api/runs/:runId/specs/:file", async (c) => {
    const state = await runState(c.req.param("runId"));
    if (!state || state.status !== "done") return c.json({ error: "Not found." }, 404);
    const file = c.req.param("file");
    if (!SAFE_FILE.test(file)) return c.json({ error: "Invalid file name." }, 400);
    try {
      const source = await readFile(join(state.dir, "specs", file), "utf8");
      return c.body(source, 200, { "content-type": "text/plain; charset=utf-8" });
    } catch {
      return c.json({ error: "Not found." }, 404);
    }
  });

  // Evidence referenced from report.html (artifacts/<file>.png|.gif), served next to the report.
  app.get("/api/runs/:runId/artifacts/:file", async (c) => {
    const state = await runState(c.req.param("runId"));
    const file = c.req.param("file");
    if (!state || state.status !== "done") return c.json({ error: "Not found." }, 404);
    const type = ARTIFACT_TYPES[file.slice(file.lastIndexOf(".")).toLowerCase()];
    if (!SAFE_FILE.test(file) || !type) return c.json({ error: "Invalid file name." }, 400);
    try {
      const bytes = await readFile(join(state.dir, "artifacts", file));
      return c.body(new Uint8Array(bytes), 200, { "content-type": type });
    } catch {
      return c.json({ error: "Not found." }, 404);
    }
  });

  app.notFound((c) => c.json({ error: "Not found." }, 404));

  return app;
}

let bundledChromiumName: string | null | undefined;

/**
 * "Chromium 153.0.8010.12": the Chromium build the installed Playwright launches (runPlan uses chromium.launch with no
 * channel or executablePath), read from playwright-core's browsers.json. Null if that file can't be read.
 */
function bundledChromium(): string | null {
  if (bundledChromiumName !== undefined) return bundledChromiumName;
  bundledChromiumName = null;
  try {
    const require = createRequire(import.meta.url);
    const dir = dirname(require.resolve("playwright-core/package.json", { paths: [dirname(require.resolve("playwright"))] }));
    const data = JSON.parse(readFileSync(join(dir, "browsers.json"), "utf8")) as { browsers?: { name: string; browserVersion?: string }[] };
    const version = data.browsers?.find((b) => b.name === "chromium")?.browserVersion;
    if (version && /^[\d.]+$/.test(version)) bundledChromiumName = `Chromium ${version}`;
  } catch {
    // Unknown layout: the browser shows up when the report is written.
  }
  return bundledChromiumName;
}

/** A plan with secrets redacted (its target URL may carry a token). */
function redactPlan(plan: Plan): Plan {
  return JSON.parse(redactSecrets(JSON.stringify(plan))) as Plan;
}
