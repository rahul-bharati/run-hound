import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { isIP } from "node:net";
import { dirname, join, resolve } from "node:path";
import { Hono } from "hono";
import { CHECK_GROUPS, type Check, type CheckGroup, type CheckResult, type Plan, type Report } from "../core/types.js";
import { cleanErrorMessage, NoFormFoundError, TargetNotAllowedError, TargetUnreachableError } from "../engine/errors.js";
import { redactSecrets } from "../engine/redact.js";
import { renderUi } from "./ui/index.js";
import { canShowBrowser, discoverAndPlan, newRunId, NO_DISPLAY_MESSAGE, planWarnings, RUN_HOUND_VERSION, runPlan, type ProgressEvent, type RunOptions } from "../engine/runner.js";

export interface ServerOptions extends Pick<RunOptions, "checks" | "runsDir" | "allowedHosts"> {
  /** Runs allowed at the same time (each one drives its own Chromium). Default 2; more are refused with 409. */
  maxConcurrentRuns?: number;
  /** Whether a visible browser window can open on this machine. Detected (canShowBrowser) when omitted. */
  canShowBrowser?: boolean;
  /**
   * Extra host names this server answers to, besides loopback ones (RUNHOUND_SERVER_HOSTS).
   * Everything else is refused, so a public domain that resolves to 127.0.0.1 (DNS rebinding) can't
   * drive Run Hound from a web page.
   */
  serverHosts?: string[];
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
  /** Aborts the run (POST /api/runs/:id/stop); absent for runs read back from disk. */
  controller?: AbortController;
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

/**
 * Hosts the UI and API answer to without being listed: loopback names and any IP literal (so reaching the
 * container or a LAN address by IP still works). A DNS rebinding attack always arrives under a NAME the
 * attacker controls, which lands here and is refused.
 */
function isDefaultHost(host: string): boolean {
  const name = host.replace(/^\[|\]$/g, "").toLowerCase();
  return name === "localhost" || name.endsWith(".localhost") || isIP(name) !== 0;
}

/** Errors caused by the user's input (bad or refused URL, no form, page won't load) rather than by Run Hound. */
function isUserError(err: unknown): boolean {
  return (
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

/** Check titles for the plan's fieldset legends, e.g. {"dead-control": "Every button does something"}. */
async function checkTitles(checks: Check[] | undefined): Promise<Record<string, string>> {
  const list = checks ?? (await import("../checks/index.js")).checks;
  return Object.fromEntries(list.map((c) => [c.id, c.title]));
}

/**
 * Local UI + JSON API (served on port 4000 by the CLI):
 *   GET  /                          HTML UI (ui/index.ts renderUi): the app shell with hash routes #/new (target -> plan),
 *                                   #/runs, #/runs/<id> (running view, then the report) and #/settings
 *   POST /api/plan  {url}           200 {planId, plan, checks: {checkId: title}} | 400 {error} (bad URL, not allowed,
 *                                   unreachable, no form). "localhost:3000/book" is read as http://localhost:3000/book.
 *   POST /api/runs  {planId, approved: string[], allowDestructive?: boolean, headed?: boolean}  202 {runId}
 *                                   | 404 unknown plan | 400 empty approval, unknown scenario ids or a non-boolean flag
 *                                   | 409 too many runs in progress (maxConcurrentRuns)
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
 *                                     completed, total}]}: runs in memory and finished runs in runsDir, newest first
 *   POST /api/runs/:runId/stop       202 {runId} (the run ends "done" with report.stopped) | 409 already ended or stopping | 404
 *   POST /api/runs/:runId/rerun      202 {runId}: plans the same target again and runs it approving the previous run's
 *                                   scenario ids that are still in the new plan | 400 none left or the target can't
 *                                   be planned | 404 | 409 busy
 *   GET  /api/settings               {version, runsDir, allowedHosts, serverHosts}
 * The live state also carries `browser` ("Chromium 153..."): null until the first scenario starts, then the Chromium
 * build Playwright launches (bundledChromium), replaced by report.browser (what the browser itself reported) at the end.
 * POST /api/runs also accepts {headed?: boolean} to open a visible browser window on the machine running Run Hound.
 * While a run is in progress the UI shows a live view: the numbered scenario list with the running scenario's steps,
 * the browser, the page URL, the latest frame (refreshed about twice a second) and the step log.
 * Plans and run states live in memory (the newest 50 of each); a finished run that is no longer in memory, or was
 * written before a restart, is read back from runsDir/<runId>/report.json, so report links keep working.
 * The UI keeps the run id in the page's #/runs/<id> fragment, so reloading the page shows the same run (old #run=<id>
 * links still open it).
 */
export function createApp(options: ServerOptions = {}): Hono {
  const app = new Hono();
  const plans = new Map<string, Plan>();
  const runs = new Map<string, RunState>();
  const runsDir = resolve(options.runsDir ?? "runs");
  const extraHosts = (options.serverHosts ?? (process.env.RUNHOUND_SERVER_HOSTS ?? "").split(","))
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  const hostAllowed = (host: string) => isDefaultHost(host) || extraHosts.includes(host.toLowerCase());
  const maxRuns = options.maxConcurrentRuns ?? 2;

  /** Drops the oldest entries (Maps keep insertion order); running runs are never dropped. */
  function prune(): void {
    for (const id of [...plans.keys()].slice(0, Math.max(0, plans.size - MAX_PLANS))) plans.delete(id);
    const finished = [...runs].filter(([, r]) => r.status !== "running").map(([id]) => id);
    for (const id of finished.slice(0, Math.max(0, runs.size - MAX_RUNS))) runs.delete(id);
  }

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
        plan: report.plan,
        approved,
        allowDestructive: false,
        headed: false,
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
      formName: (report?.plan ?? state.plan).form?.name ? redactSecrets((report?.plan ?? state.plan).form.name!) : null,
      status: state.status,
      startedAt: state.startedAt,
      completed: state.completed,
      total: state.total,
    };
    if (state.status !== "running") {
      out.finishedAt = report?.finishedAt ?? new Date(Date.parse(state.startedAt) + (state.durationMs ?? 0)).toISOString();
      if (state.durationMs !== undefined) out.durationMs = state.durationMs;
      if (report) out.summary = report.summary;
    }
    return out;
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
    const onDisk = await Promise.all(names.filter((id) => !runs.has(id)).map(async (id) => ({ id, state: await runState(id) })));
    for (const { id, state } of onDisk) if (state) out.push(summarize(id, state));
    return out.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt) || (a.runId < b.runId ? 1 : a.runId > b.runId ? -1 : 0));
  }

  /** Starts a run in the background; returns its id, or an error response body and status. */
  function startRun(
    plan: Plan,
    approved: string[],
    flags: { allowDestructive: boolean; headed: boolean },
  ): { runId: string } | { error: string; code: 409 } {
    const running = [...runs.values()].filter((r) => r.status === "running").length;
    if (running >= maxRuns) {
      return { error: `${running} run${running === 1 ? " is" : "s are"} already in progress. Wait for ${running === 1 ? "it" : "one"} to finish.`, code: 409 };
    }
    const approvedSet = new Set(approved);
    const runId = newRunId();
    const controller = new AbortController();
    const state: RunState = {
      status: "running",
      completed: 0,
      total: plan.scenarios.filter((s) => approvedSet.has(s.id)).length,
      dir: join(runsDir, runId),
      startedAt: new Date().toISOString(),
      live: newLiveState(runOrder(redactPlan(plan), approvedSet)),
      plan,
      approved: [...approvedSet],
      allowDestructive: flags.allowDestructive,
      headed: flags.headed,
      controller,
    };
    runs.set(runId, state);
    prune();

    runPlan(plan, {
      checks: options.checks,
      allowedHosts: options.allowedHosts,
      runsDir,
      runId,
      approved: state.approved,
      allowDestructive: flags.allowDestructive,
      headed: flags.headed,
      signal: controller.signal,
      // The UI always shows the live view, so the server always asks for the screencast.
      live: true,
      onProgress: (e) => {
        if (e.type === "scenario-end") state.completed += 1;
        // The runner names the browser only in the report; by the first scenario it has launched Playwright's own build.
        if (e.type === "scenario-start" && state.live.browser === null) state.live.browser = bundledChromium();
        applyProgress(state.live, plan, e);
      },
    }).then(
      ({ report, dir }) => {
        const durationMs = report.durationMs ?? Date.parse(report.finishedAt) - Date.parse(report.startedAt);
        Object.assign(state, { status: "done", report, dir, durationMs, controller: undefined });
        // The report is authoritative once written (it also covers pages seen before a frame or step).
        if (report.pagesVisited) state.live.pagesVisited = report.pagesVisited.map((p) => p.url);
        state.live.browser = report.browser ?? null;
        state.live.updatedAt = new Date().toISOString();
      },
      (err: unknown) => {
        Object.assign(state, {
          status: "error",
          controller: undefined,
          durationMs: Date.now() - Date.parse(state.startedAt),
          error: redactSecrets(cleanErrorMessage(err instanceof Error ? err.message : String(err))),
        });
        state.live.updatedAt = new Date().toISOString();
      },
    );
    return { runId };
  }

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
  app.get("/", (c) => c.html(uiHtml));

  // Only accept JSON posts: a cross-site page can send text/plain without a CORS preflight, but not application/json.
  app.use("/api/*", async (c, next) => {
    if (c.req.method === "POST" && !(c.req.header("content-type") ?? "").toLowerCase().startsWith("application/json")) {
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

    try {
      const plan = await discoverAndPlan(url.trim(), { checks: options.checks, allowedHosts: options.allowedHosts });
      const planId = randomUUID();
      plans.set(planId, plan);
      prune();
      // The stored plan keeps the real target; what leaves the process is redacted.
      const warnings = planWarnings(plan).map((w) => redactSecrets(w));
      return c.json({ planId, plan: redactPlan(plan), checks: await checkTitles(options.checks), warnings }, 200);
    } catch (err) {
      const message = redactSecrets(cleanErrorMessage(err instanceof Error ? err.message : String(err)));
      if (isUserError(err)) return c.json({ error: message }, 400);
      return c.json({ error: `Could not plan a run: ${message}` }, 500);
    }
  });

  app.post("/api/runs", async (c) => {
    let body: { planId?: unknown; approved?: unknown; allowDestructive?: unknown; headed?: unknown };
    try {
      body = ((await c.req.json()) ?? {}) as typeof body;
    } catch {
      return c.json({ error: "The request body must be JSON." }, 400);
    }
    const plan = typeof body.planId === "string" ? plans.get(body.planId) : undefined;
    if (!plan) return c.json({ error: "Unknown plan. Create a plan first." }, 404);
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
    const started = startRun(plan, approvedIds, { allowDestructive: body.allowDestructive === true, headed: body.headed === true });
    if ("error" in started) return c.json({ error: started.error }, started.code);
    return c.json({ runId: started.runId }, 202);
  });

  app.get("/api/runs", async (c) => c.json({ runs: await listRuns() }, 200, { "cache-control": "no-store" }));

  app.get("/api/settings", (c) =>
    c.json({
      version: RUN_HOUND_VERSION,
      runsDir,
      allowedHosts: options.allowedHosts ?? (process.env.RUNHOUND_ALLOWED_HOSTS ?? "").split(",").map((h) => h.trim()).filter(Boolean),
      serverHosts: extraHosts,
    }),
  );

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
    // Don't open a browser to plan when the run couldn't start anyway (startRun checks again after planning).
    const running = [...runs.values()].filter((r) => r.status === "running").length;
    if (running >= maxRuns) return c.json({ error: `${running} run${running === 1 ? " is" : "s are"} already in progress. Wait for ${running === 1 ? "it" : "one"} to finish.` }, 409);
    // Plan the target again: the page may have changed since, so scenario ids are matched against the new plan.
    let plan: Plan;
    try {
      plan = await discoverAndPlan(state.plan.target, { checks: options.checks, allowedHosts: options.allowedHosts });
    } catch (err) {
      const message = redactSecrets(cleanErrorMessage(err instanceof Error ? err.message : String(err)));
      if (isUserError(err)) return c.json({ error: message }, 400);
      return c.json({ error: `Could not plan the run again: ${message}` }, 500);
    }
    const known = new Set(plan.scenarios.map((s) => s.id));
    const approved = state.approved.filter((id) => known.has(id));
    if (approved.length === 0) {
      return c.json({ error: "None of this run's scenarios are in the new plan (the page has changed). Start a new run instead." }, 400);
    }
    const started = startRun(plan, approved, { allowDestructive: state.allowDestructive, headed: state.headed && headedAvailable });
    if ("error" in started) return c.json({ error: started.error }, started.code);
    return c.json({ runId: started.runId }, 202);
  });

  app.get("/api/runs/:runId", async (c) => {
    const state = await runState(c.req.param("runId"));
    if (!state) return c.json({ error: "Unknown run." }, 404);
    const { dir: _dir, live: _live, plan: _plan, approved: _approved, allowDestructive: _d, headed: _h, controller: _c, ...status } = state;
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
    return c.body(await readFile(join(state.dir, file), "utf8"), 200, { "content-type": type });
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
