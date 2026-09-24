import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { isIP } from "node:net";
import { join, resolve } from "node:path";
import { Hono } from "hono";
import { CHECK_GROUPS, type Check, type CheckGroup, type CheckResult, type Plan, type Report } from "../core/types.js";
import { cleanErrorMessage, NoFormFoundError, TargetNotAllowedError, TargetUnreachableError } from "../engine/errors.js";
import { redactSecrets } from "../engine/redact.js";
import { BRAND, FONT_MONO, FONT_SANS, MARK_DATA_URI } from "../core/brand.js";
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
 *   GET  /                          HTML UI: target URL -> plan with checkboxes -> approve -> progress -> report
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
 * POST /api/runs also accepts {headed?: boolean} to open a visible browser window on the machine running Run Hound.
 * While a run is in progress the UI shows a live view: the page URL, the current scenario and step, the latest
 * frame (refreshed about twice a second), the step log and the list of pages being tested.
 * Plans and run states live in memory (the newest 50 of each); a finished run that is no longer in memory, or was
 * written before a restart, is read back from runsDir/<runId>/report.json, so report links keep working.
 * The UI keeps the run id in the page's #run=<id> fragment, so reloading the page shows the same run.
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
      const durationMs = report.durationMs ?? Date.parse(report.finishedAt) - Date.parse(report.startedAt);
      return { status: "done", completed: report.results.length, total: report.results.length, dir, startedAt: report.startedAt, durationMs, report, live };
    } catch {
      return undefined;
    }
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
  const uiHtml = headedAvailable
    ? UI_HTML.replace("__HEADED_ATTRS__", "").replace("__HEADED_DESC__", "Opens a visible Chromium window on the machine running Run Hound. The live view below works either way.")
    : UI_HTML.replace("__HEADED_ATTRS__", " disabled").replace("__HEADED_DESC__", "Not available here: the machine running Run Hound has no display (as in a container). The live view below shows the page under test.");
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
    const approvedSet = new Set(approved ?? plan.scenarios.filter((s) => s.defaultSelected).map((s) => s.id));
    // An empty run would report "0 findings" and look like a clean pass.
    if (approvedSet.size === 0) return c.json({ error: "Select at least one scenario to run." }, 400);
    const running = [...runs.values()].filter((r) => r.status === "running").length;
    if (running >= maxRuns) {
      return c.json({ error: `${running} run${running === 1 ? " is" : "s are"} already in progress. Wait for ${running === 1 ? "it" : "one"} to finish.` }, 409);
    }
    const runId = newRunId();
    const state: RunState = {
      status: "running",
      completed: 0,
      total: plan.scenarios.filter((s) => approvedSet.has(s.id)).length,
      dir: join(runsDir, runId),
      startedAt: new Date().toISOString(),
      live: newLiveState(runOrder(redactPlan(plan), approvedSet)),
    };
    runs.set(runId, state);
    prune();

    runPlan(plan, {
      checks: options.checks,
      allowedHosts: options.allowedHosts,
      runsDir,
      runId,
      approved,
      allowDestructive: body.allowDestructive === true,
      headed: body.headed === true,
      // The UI always shows the live view, so the server always asks for the screencast.
      live: true,
      onProgress: (e) => {
        if (e.type === "scenario-end") state.completed += 1;
        applyProgress(state.live, plan, e);
      },
    }).then(
      ({ report, dir }) => {
        const durationMs = report.durationMs ?? Date.parse(report.finishedAt) - Date.parse(report.startedAt);
        Object.assign(state, { status: "done", report, dir, durationMs });
        // The report is authoritative once written (it also covers pages seen before a frame or step).
        if (report.pagesVisited) state.live.pagesVisited = report.pagesVisited.map((p) => p.url);
        state.live.updatedAt = new Date().toISOString();
      },
      (err: unknown) => {
        Object.assign(state, {
          status: "error",
          durationMs: Date.now() - Date.parse(state.startedAt),
          error: redactSecrets(cleanErrorMessage(err instanceof Error ? err.message : String(err))),
        });
        state.live.updatedAt = new Date().toISOString();
      },
    );

    return c.json({ runId }, 202);
  });

  app.get("/api/runs/:runId", async (c) => {
    const state = await runState(c.req.param("runId"));
    if (!state) return c.json({ error: "Unknown run." }, 404);
    const { dir: _dir, live: _live, ...status } = state;
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

/** A plan with secrets redacted (its target URL may carry a token). */
function redactPlan(plan: Plan): Plan {
  return JSON.parse(redactSecrets(JSON.stringify(plan))) as Plan;
}

/**
 * The single-page UI. Server-rendered shell plus a small inline script that talks to the JSON API.
 * Run Hound brand (docs/brand.md, core/brand.ts); every control is labelled, focus is always visible, progress goes to a live region.
 * The script builds DOM with textContent only, so report text is never parsed as HTML.
 */
/** Version text for the UI, reduced to safe characters. */
const VERSION = RUN_HOUND_VERSION.replace(/[^\w.+-]/g, "");

const ICON = {
  clock: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  globe: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.7 5.7 3.7 9s-1.2 6.3-3.7 9c-2.5-2.7-3.7-5.7-3.7-9S9.5 5.7 12 3z"/></svg>',
  target: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/></svg>',
};

const UI_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>Run Hound</title>
<link rel="icon" href="${MARK_DATA_URI}">
<style>
:root { --bg:${BRAND.bg}; --bg-deep:${BRAND.bgDeep}; --surface:${BRAND.surface}; --surface-2:${BRAND.surface2}; --surface-3:${BRAND.surface3};
  --line:${BRAND.line}; --line-soft:${BRAND.lineSoft}; --line-strong:${BRAND.lineStrong}; --fg:${BRAND.fg}; --muted:${BRAND.muted}; --dim:${BRAND.dim};
  --accent:${BRAND.accent}; --accent-strong:${BRAND.accentStrong}; --accent-ink:${BRAND.accentInk}; --fail:${BRAND.fail}; --warn:${BRAND.warn};
  --sans:${FONT_SANS}; --mono:${FONT_MONO}; color-scheme: dark; }
* { box-sizing: border-box; }
html { background: var(--bg); }
body { margin:0; background:var(--bg); color:var(--fg); font:16px/1.5 var(--sans); -webkit-font-smoothing: antialiased; }
[hidden] { display: none !important; }
.visually-hidden { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; }
a { color: var(--accent); text-underline-offset: 3px; }
a:hover { color: var(--accent-strong); }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
input[type=url]:focus-visible { outline-offset: 0; }

/* Shell: a slim sidebar with the mark and the four run steps, then the page. On narrow screens the sidebar is a top bar. */
.shell { display:grid; grid-template-columns: 15rem minmax(0, 1fr); min-height:100vh; }
.sidebar { background:var(--bg-deep); border-right:1px solid var(--line); padding:1.4rem 1rem 1.25rem; display:flex; flex-direction:column; gap:1.75rem;
  position:sticky; top:0; height:100vh; overflow-y:auto; }
.brand { display:flex; align-items:center; gap:.6rem; padding:0 .4rem; font-weight:800; font-size:1.15rem; letter-spacing:-.02em; color:var(--fg); }
.brand img { display:block; width:40px; height:23px; flex:none; }
.steps ol { list-style:none; margin:0; padding:0; display:grid; gap:.3rem; }
.steps .step { display:flex; align-items:center; gap:.75rem; min-height:44px; padding:.45rem .65rem; border-radius:10px; color:var(--dim); text-decoration:none; font-weight:600; font-size:.95rem; }
.steps a.step:hover { color:var(--fg); background:var(--surface); }
.steps .num { flex:none; width:1.65rem; height:1.65rem; border-radius:50%; border:1.5px solid currentColor; display:grid; place-items:center; font:600 .75rem/1 var(--mono); }
.steps li.done .step { color:var(--muted); }
.steps li.done .num { background:var(--accent); border-color:var(--accent); color:var(--accent-ink); }
.steps li.current .step { color:var(--fg); background:var(--surface-3); box-shadow: inset 3px 0 0 var(--accent); }
.steps li.current .num { border-color:var(--accent); color:var(--accent); }
.side-foot { margin-top:auto; padding:0 .4rem; font:.72rem/1.6 var(--mono); color:var(--dim); letter-spacing:.02em; }
.side-foot b { display:block; color:var(--muted); font-weight:600; letter-spacing:.12em; text-transform:uppercase; }

main { min-width:0; padding: 2rem clamp(1rem, 3vw, 2.5rem) 2.5rem; max-width: 84rem; }
.eyebrow { display:flex; align-items:center; gap:.5rem; margin:0 0 .6rem; font:600 .72rem/1.4 var(--mono); letter-spacing:.16em; text-transform:uppercase; color:var(--dim); }
.eyebrow .dot { width:.5rem; height:.5rem; border-radius:50%; background:var(--accent); flex:none; }
h1 { margin:0; font-size:clamp(1.75rem, 4vw, 2.6rem); line-height:1.08; font-weight:800; letter-spacing:-.035em; }
h1 .accent { color:var(--accent); }
p.lead { color:var(--muted); max-width:44rem; margin:.75rem 0 0; font-size:1.05rem; }
h2 { font-size:1.3rem; line-height:1.2; margin:0 0 .9rem; font-weight:800; letter-spacing:-.02em; }
h3 { font-size:1rem; margin:0; }
.muted { color: var(--muted); }
section.card { background:var(--surface); border:1px solid var(--line); border-radius:16px; padding:1.25rem 1.5rem 1.4rem; margin-top:1.5rem; }
section.card > .eyebrow { margin-bottom:.35rem; }
label { display:block; font-weight:600; margin-bottom:.4rem; }
.row { display:flex; gap:.6rem; flex-wrap:wrap; }
input[type=url] { flex:1 1 16rem; min-width:0; min-height:48px; padding:.65rem .9rem; border-radius:10px; border:1px solid var(--line-strong); background:var(--bg-deep); color:var(--fg); font:.98rem/1.4 var(--mono); }
input[type=url]::placeholder { color: var(--dim); }
button { min-height:48px; padding:.65rem 1.3rem; border-radius:10px; border:0; background:var(--accent); color:var(--accent-ink); font:inherit; font-weight:700; cursor:pointer; }
button:hover { background: var(--accent-strong); }
button:disabled { opacity:.6; cursor:progress; }
.error { color: var(--fail); margin:.5rem 0 0; }
.error:empty { margin:0; }
.warning { border-left:3px solid var(--warn); background:var(--surface-2); border-radius:0 8px 8px 0; padding:.35rem .9rem; margin:0 0 1rem; }
.warning p { margin:.35rem 0; }
.pass { color: var(--accent); }
.fail { color: var(--fail); }

/* Plan grouped as Accessibility, Features and Security, each with a count and a select-all checkbox. */
.group { border:1px solid var(--line); border-radius:12px; padding:.9rem 1rem .6rem; margin-top:.9rem; background:var(--bg); }
.group:first-child { margin-top:0; }
.group-head { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:.25rem 1rem; margin-bottom:.3rem; }
.group-head h3 { font-size:1.05rem; font-weight:750; }
.count { font:600 .72rem/1 var(--mono); letter-spacing:.06em; color:var(--muted); margin-left:.5rem; padding:.25rem .5rem; border:1px solid var(--line-strong); border-radius:999px; vertical-align:.1rem; }
.select-all { display:flex; align-items:center; gap:.5rem; min-height:44px; }
.select-all input { width:1.15rem; height:1.15rem; margin:0; accent-color:var(--accent); flex:none; }
.select-all label { margin:0; font-weight:400; font-size:.9rem; color:var(--muted); cursor:pointer; }
fieldset { border:0; margin:0 0 .5rem; padding:0; min-width:0; }
legend { font:600 .7rem/1.4 var(--mono); letter-spacing:.14em; text-transform:uppercase; color:var(--dim); padding:.5rem 0 .3rem; }
.scenario { display:flex; gap:.7rem; align-items:flex-start; padding:.6rem .75rem; margin:.35rem 0; border-radius:10px; background:var(--surface-2); border:1px solid var(--line-soft); }
.scenario input { width:1.15rem; height:1.15rem; margin-top:.2rem; accent-color:var(--accent); flex:none; }
.scenario label { font-weight:500; margin:0; min-width:0; overflow-wrap:anywhere; }
.scenario .desc { display:block; color:var(--muted); font-size:.9rem; font-weight:400; margin-top:.1rem; }
.tag { font:600 .68rem/1 var(--mono); letter-spacing:.06em; text-transform:uppercase; border:1px solid var(--line-strong); border-radius:999px; padding:.2rem .45rem; margin-left:.45rem; color:var(--muted); vertical-align:.1rem; white-space:nowrap; }
.tag.danger { color:var(--fail); border-color:var(--fail); }
.options { margin:1rem 0 .5rem; border-top:1px solid var(--line); padding-top:.6rem; }
.options .scenario { background:transparent; border-color:transparent; padding-left:0; }

/* Run: progress, time and browser cards, the scenario list with status rings, the live browser and the activity log. */
#live { display:grid; gap:1rem; }
.run-head { display:flex; flex-wrap:wrap; align-items:baseline; justify-content:space-between; gap:.25rem 1rem; }
#status { margin:0; font-weight:650; font-size:1.05rem; flex:1 1 18rem; min-width:0; overflow-wrap:anywhere; }
.tally { margin:0; font:700 1.25rem/1 var(--mono); font-variant-numeric:tabular-nums; color:var(--fg); }
progress { -webkit-appearance:none; appearance:none; width:100%; height:.6rem; border:0; border-radius:999px; background:var(--surface-3); overflow:hidden; accent-color:var(--accent); }
progress::-webkit-progress-bar { background:var(--surface-3); border-radius:999px; }
progress::-webkit-progress-value { background:var(--accent); border-radius:999px; transition: width .3s ease; }
progress::-moz-progress-bar { background:var(--accent); border-radius:999px; }
.run-grid { display:grid; gap:1rem; grid-template-columns:minmax(0, 1fr); align-items:start; }
@media (min-width: 72rem) { .run-grid { grid-template-columns:minmax(19rem, 25rem) minmax(0, 1fr); } }
.run-col { display:grid; gap:1rem; min-width:0; align-content:start; }
.stats { display:grid; grid-template-columns:repeat(auto-fit, minmax(10.5rem, 1fr)); gap:.75rem; }
.stat { display:flex; align-items:center; gap:.75rem; background:var(--surface-2); border:1px solid var(--line); border-radius:12px; padding:.75rem .9rem; min-width:0; }
.stat svg { flex:none; color:var(--accent); }
.stat .label, .clock .label { display:block; font:600 .68rem/1.4 var(--mono); letter-spacing:.14em; text-transform:uppercase; color:var(--dim); }
.stat p { margin:0; min-width:0; }
.clock { margin:0; }
#live-elapsed { display:block; font:700 1.35rem/1.2 var(--mono); font-variant-numeric:tabular-nums; color:var(--fg); }
#live-browser { display:block; font-weight:600; overflow-wrap:anywhere; }
.box { background:var(--surface-2); border:1px solid var(--line); border-radius:12px; padding:.8rem .9rem; min-width:0; }
.box h3 { margin:0 0 .5rem; font:600 .7rem/1.4 var(--mono); letter-spacing:.14em; text-transform:uppercase; color:var(--dim); }
#live-list h4 { display:flex; justify-content:space-between; gap:.5rem; margin:.8rem 0 .3rem; font-size:.9rem; font-weight:700; }
#live-list h4:first-child { margin-top:0; }
#live-list h4 span { font:500 .75rem/1.6 var(--mono); color:var(--dim); }
ol.runlist { list-style:none; margin:0; padding:0; display:grid; gap:.25rem; }
ol.runlist li { display:grid; grid-template-columns:auto minmax(0, 1fr) auto; align-items:center; gap:.65rem; padding:.45rem .55rem; border-radius:8px; font-size:.92rem; }
ol.runlist li.queued { color:var(--muted); }
ol.runlist li.fail, ol.runlist li.error, ol.runlist li.pass { color:var(--fg); }
ol.runlist li.running { background:var(--surface-3); box-shadow:inset 0 0 0 1px var(--accent); color:var(--fg); }
ol.runlist .t { overflow-wrap:anywhere; }
ol.runlist .d { font:.78rem/1 var(--mono); color:var(--dim); font-variant-numeric:tabular-nums; }
.ring { position:relative; width:1.3rem; height:1.3rem; border-radius:50%; border:2px solid var(--dim); flex:none; display:grid; place-items:center; font:800 .72rem/1 var(--sans); }
.ring.pass { background:var(--accent); border-color:var(--accent); }
.ring.pass::after { content:""; width:.34rem; height:.6rem; border:solid var(--accent-ink); border-width:0 2px 2px 0; transform:translateY(-1px) rotate(45deg); }
.ring.fail { background:var(--fail); border-color:var(--fail); color:#1A0707; }
.ring.fail::after { content:"!"; }
.ring.error { border-color:var(--fail); color:var(--fail); }
.ring.error::after { content:"!"; }
.ring.skipped { border-style:dashed; }
.ring.running { border-color:var(--accent); border-right-color:transparent; animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.browser { margin:0; border:1px solid var(--line-strong); border-radius:14px; overflow:hidden; background:var(--bg-deep); box-shadow:0 18px 40px rgb(0 0 0 / .35); }
.chrome { display:flex; align-items:center; gap:.7rem; padding:.55rem .8rem; background:var(--surface-2); border-bottom:1px solid var(--line); }
.dots { display:flex; gap:.35rem; flex:none; }
.dots i { width:.65rem; height:.65rem; border-radius:50%; background:var(--line-strong); }
.address { flex:1; min-width:0; display:flex; align-items:center; gap:.5rem; background:var(--bg-deep); border:1px solid var(--line); border-radius:999px; padding:.35rem .85rem; }
.address .label { font:600 .66rem/1 var(--mono); letter-spacing:.12em; color:var(--dim); text-transform:uppercase; flex:none; }
#live-url { font:.85rem/1.3 var(--mono); color:var(--fg); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0; }
.pill { flex:none; display:inline-flex; align-items:center; gap:.4rem; font:700 .72rem/1 var(--mono); letter-spacing:.08em; border-radius:999px; padding:.35rem .6rem; border:1px solid var(--line-strong); color:var(--muted); background:var(--bg-deep); }
.pill.on { color:var(--accent); border-color:rgb(94 230 163 / .45); }
.pill.on::before { content:""; width:.45rem; height:.45rem; border-radius:50%; background:var(--accent); animation: blink 1.2s steps(2, start) infinite; }
@keyframes blink { to { visibility: hidden; } }
.viewport { position:relative; aspect-ratio:1280 / 800; background:var(--bg-deep); }
.viewport img { display:block; width:100%; height:100%; object-fit:contain; object-position:top center; }
.viewport .placeholder { position:absolute; inset:0; display:grid; place-items:center; margin:0; color:var(--muted); text-align:center; padding:1rem; }
.now { display:flex; gap:.7rem; align-items:baseline; padding:.6rem .85rem; background:var(--surface-2); border-top:1px solid var(--line); }
.now .label { color:var(--accent); font:700 .68rem/1.4 var(--mono); letter-spacing:.14em; text-transform:uppercase; flex:none; }
#live-step { overflow-wrap:anywhere; min-width:0; }
.side { display:grid; gap:1rem; grid-template-columns:minmax(0, 1fr); align-content:start; min-width:0; }
@media (min-width: 48rem) { .side { grid-template-columns:minmax(0, 1.6fr) minmax(0, 1fr); } .side .activity { grid-row: span 2; } }
#live-group { margin:0 0 .15rem; font:600 .7rem/1.4 var(--mono); letter-spacing:.1em; text-transform:uppercase; color:var(--accent); }
#live-scenario { margin:0; font-weight:650; overflow-wrap:anywhere; }
#live-scenario-id { margin:.15rem 0 0; font:.78rem var(--mono); color:var(--dim); overflow-wrap:anywhere; }
#live-pages { list-style:none; margin:0; padding:0; display:grid; gap:.35rem; }
#live-pages li { font:.82rem/1.4 var(--mono); overflow-wrap:anywhere; padding-left:1rem; position:relative; color:var(--muted); }
#live-pages li::before { content:""; position:absolute; left:.1rem; top:.42rem; width:.45rem; height:.45rem; border-radius:50%; border:1px solid var(--dim); }
#live-pages li.current { color:var(--fg); }
#live-pages li.current::before { background:var(--accent); border-color:var(--accent); }
#live-pages li.empty { padding-left:0; font-family:var(--sans); }
#live-pages li.empty::before { display:none; }
#live-pages .tag { color:var(--accent); border-color:rgb(94 230 163 / .45); }
.steps-scroll { max-height:22rem; overflow:auto; margin:0 -.9rem -.8rem; padding:0 .9rem .8rem; }
#live-steps { margin:0; padding:0; list-style:none; display:grid; font-size:.88rem; }
#live-steps li { display:grid; grid-template-columns:auto minmax(0, 1fr); gap:0 .75rem; padding:.3rem 0; border-bottom:1px solid var(--line-soft); }
#live-steps li:last-child { border-bottom:0; color:var(--accent); }
#live-steps time { font:.75rem/1.7 var(--mono); color:var(--dim); font-variant-numeric:tabular-nums; }
#live-steps .url { grid-column:2; font:.72rem var(--mono); color:var(--dim); overflow-wrap:anywhere; }
#live-steps .scn { grid-column:1 / -1; margin-top:.45rem; font:600 .7rem/1.5 var(--mono); color:var(--muted); letter-spacing:.06em; text-transform:uppercase; overflow-wrap:anywhere; min-width:0; }
#live-steps li > span { min-width:0; overflow-wrap:anywhere; }
#live-steps .scn .took { font-weight:400; text-transform:none; letter-spacing:0; margin-left:.4rem; color:var(--dim); }
.empty { color:var(--muted); font-size:.88rem; margin:0; }

/* Report: verdict, counts, links, the per-group table, scenarios and findings with their evidence. */
.verdict { display:flex; gap:1rem; align-items:center; margin-bottom:1rem; }
.verdict .ring { width:3rem; height:3rem; border-width:3px; font-size:1.3rem; }
.verdict .ring.pass::after { width:.6rem; height:1.1rem; border-width:0 3px 3px 0; }
.finished { font-size:1.35rem; font-weight:800; letter-spacing:-.02em; margin:0; }
.verdict p { margin:.1rem 0 0; }
.tiles { display:grid; grid-template-columns:repeat(auto-fill, minmax(7.5rem, 1fr)); gap:.5rem; margin:0 0 1rem; padding:0; list-style:none; }
.tiles li { background:var(--surface-2); border:1px solid var(--line); border-radius:10px; padding:.55rem .75rem; }
.tiles b { display:block; font-size:1.5rem; line-height:1.2; font-weight:800; font-variant-numeric:tabular-nums; }
.tiles span { font:600 .66rem/1.4 var(--mono); letter-spacing:.12em; text-transform:uppercase; color:var(--dim); }
.tiles .hot b { color:var(--fail); } .tiles .warm b { color:var(--warn); } .tiles .good b { color:var(--accent); }
ul.links { list-style:none; padding:0; margin:0 0 1rem; display:flex; flex-wrap:wrap; gap:.5rem; }
ul.links a { display:inline-flex; align-items:center; min-height:44px; padding:.55rem 1rem; border-radius:10px; border:1px solid var(--line-strong); color:var(--fg); text-decoration:none; font-weight:600; }
ul.links a:hover { border-color:var(--accent); color:var(--accent); }
ul.links li:first-child a { background:var(--accent); border-color:var(--accent); color:var(--accent-ink); }
ul.links li:first-child a:hover { background:var(--accent-strong); color:var(--accent-ink); }
.table-scroll { overflow-x:auto; margin:.75rem 0 1rem; }
table.groups { border-collapse:collapse; width:100%; font-size:.92rem; font-variant-numeric:tabular-nums; }
table.groups caption { text-align:left; font:600 .7rem/1.4 var(--mono); letter-spacing:.14em; text-transform:uppercase; color:var(--dim); padding-bottom:.45rem; }
table.groups th, table.groups td { padding:.45rem .6rem; border-bottom:1px solid var(--line); text-align:right; white-space:nowrap; }
table.groups th:first-child { text-align:left; }
table.groups thead th { color:var(--muted); font-weight:600; font-size:.8rem; }
table.groups tbody th { font-weight:650; }
table.groups td.bad { color:var(--fail); font-weight:700; }
#report details > summary { cursor:pointer; color:var(--accent); font-weight:600; min-height:32px; }
#report h4 { margin:.75rem 0 .25rem; }
#report > h3 { margin:1.25rem 0 .5rem; }
.finding { background:var(--surface-2); border:1px solid var(--line); border-left:4px solid var(--fail); border-radius:10px; padding:.8rem 1rem; margin:.85rem 0; }
.finding.sev-medium { border-left-color:var(--warn); }
.finding.sev-low { border-left-color:var(--dim); }
.finding h3 { margin:0 0 .2rem; font-size:1.02rem; overflow-wrap:anywhere; }
.finding p { margin:.3rem 0; overflow-wrap:anywhere; }
.sev { display:inline-block; font:700 .66rem/1 var(--mono); letter-spacing:.1em; text-transform:uppercase; padding:.25rem .45rem; border-radius:999px; border:1px solid currentColor; margin-right:.5rem; vertical-align:.12rem; color:var(--fail); }
.sev-medium .sev { color:var(--warn); }
.sev-low .sev { color:var(--muted); }
.group-tag { color: var(--accent); }
/* Evidence: each finding's frames, GIFs and cards inline, linked to the full-size file, with the data behind them. */
.evidence { display:grid; gap:.75rem; margin:.6rem 0; }
.evidence figure { margin:0; border:1px solid var(--line); border-radius:10px; background:var(--bg-deep); overflow:hidden; }
.evidence img { display:block; width:100%; height:auto; max-height:36rem; object-fit:contain; object-position:left top; background:var(--bg-deep); }
.evidence figcaption { padding:.45rem .65rem; font-size:.85rem; color:var(--muted); overflow-wrap:anywhere; }
.evidence figcaption b { color:var(--fg); font-weight:600; }
.evidence details { padding:0 .65rem .55rem; font-size:.85rem; }
.evidence summary { cursor:pointer; color:var(--accent); }
.evidence dl { display:grid; grid-template-columns:minmax(8rem, max-content) minmax(0, 1fr); gap:.15rem .75rem; margin:.4rem 0 0; }
.evidence dt { color:var(--muted); }
.evidence dd { margin:0; font-family:var(--mono); overflow-wrap:anywhere; white-space:pre-wrap; }
footer.site-footer { margin-top:2rem; padding-top:1rem; border-top:1px solid var(--line); color:var(--dim); font-size:.82rem; }
footer.site-footer p { margin:0; }

@media (prefers-reduced-motion: reduce) {
  .pill.on::before, .ring.running { animation: none; }
  progress::-webkit-progress-value { transition: none; }
}
@media (max-width: 56rem) {
  .shell { grid-template-columns: minmax(0, 1fr); }
  .sidebar { position:static; height:auto; flex-direction:column; gap:.75rem; padding:.8rem 1rem; border-right:0; border-bottom:1px solid var(--line); }
  .brand { padding:0; }
  .steps ol { grid-template-columns: repeat(4, minmax(0, 1fr)); gap:.25rem; }
  .steps .step { flex-direction:column; gap:.2rem; padding:.35rem .2rem; font-size:.78rem; text-align:center; }
  .steps li.current .step { box-shadow: inset 0 -2px 0 var(--accent); }
  .side-foot { display:none; }
  main { padding: 1.25rem 1rem 2rem; }
  section.card { padding:1rem 1rem 1.1rem; border-radius:14px; }
}
@media (max-width: 40rem) {
  .dots, .address .label { display:none; }
  #live-url { white-space:normal; overflow-wrap:anywhere; }
  .address { border-radius:8px; }
  .chrome { gap:.5rem; padding:.5rem; }
  .group { padding:.75rem .7rem .5rem; }
  .scenario { padding:.55rem .6rem; }
  table.groups th, table.groups td { padding:.4rem .45rem; }
}
</style>
</head>
<body>
<div class="shell">
<aside class="sidebar">
<span class="brand"><img src="${MARK_DATA_URI}" alt="Run Hound" width="40" height="23"><span aria-hidden="true">Run Hound</span></span>
<nav class="steps" aria-label="Run steps">
<ol id="steps">
<li class="current" data-step="1" data-target="target-section"><a class="step" href="#target-section" aria-current="step"><span class="num" aria-hidden="true">1</span>Target</a></li>
<li data-step="2" data-target="plan-section"><span class="step"><span class="num" aria-hidden="true">2</span>Plan</span></li>
<li data-step="3" data-target="progress-section"><span class="step"><span class="num" aria-hidden="true">3</span>Run</span></li>
<li data-step="4" data-target="report-section"><span class="step"><span class="num" aria-hidden="true">4</span>Report</span></li>
</ol>
</nav>
<p class="side-foot"><b>V0 tester preview</b>Run Hound ${VERSION}<br>Local and private addresses only</p>
</aside>
<main>
<header>
<p class="eyebrow"><span class="dot" aria-hidden="true"></span>V0 tester preview · ${VERSION}</p>
<h1>Test a form on your <span class="accent">local app.</span></h1>
<p class="lead">Point it at a page with a form. Run Hound plans a set of rule-based checks, you approve them, and it runs them in a real browser with evidence for every finding.</p>
</header>

<section class="card" id="target-section" aria-labelledby="step-target">
<p class="eyebrow">Step 1 of 4</p>
<h2 id="step-target">Target</h2>
<form id="target-form" novalidate>
<label for="target-url">Page URL (localhost or a private address)</label>
<div class="row">
<input id="target-url" name="url" type="url" required placeholder="http://localhost:5173/signup" autocomplete="url" aria-describedby="target-error">
<button id="plan-button" type="submit">Plan checks</button>
</div>
<p id="target-error" class="error" role="alert"></p>
</form>
</section>

<section class="card" id="plan-section" aria-labelledby="step-plan" hidden>
<p class="eyebrow">Step 2 of 4</p>
<h2 id="step-plan">Approve the plan</h2>
<p class="muted" id="plan-summary"></p>
<div id="plan-warnings" class="warning" role="status" hidden></div>
<form id="plan-form">
<div id="scenarios"></div>
<div class="options">
<div class="scenario">
<input id="allow-destructive" type="checkbox">
<label for="allow-destructive">Allow destructive scenarios<span class="desc">They may change or delete data beyond creating test records. Leave off unless this is a throwaway environment.</span></label>
</div>
<div class="scenario">
<input id="headed" type="checkbox"__HEADED_ATTRS__>
<label for="headed">Show the browser window<span class="desc">__HEADED_DESC__</span></label>
</div>
</div>
<p id="plan-error" class="error" role="alert"></p>
<button id="run-button" type="submit">Run approved checks</button>
</form>
</section>

<section class="card" id="progress-section" aria-labelledby="step-progress" hidden>
<p class="eyebrow">Step 3 of 4</p>
<h2 id="step-progress">Watch the run</h2>
<div id="live">
<div class="run-head">
<p id="status" role="status" aria-live="polite"></p>
<p class="tally" aria-hidden="true" id="live-tally">0 / 0</p>
</div>
<progress id="progress" max="1" value="0" aria-label="Scenarios completed"></progress>
<div class="run-grid">
<div class="run-col">
<div class="stats">
<div class="stat">${ICON.clock}<p class="clock"><span class="label" id="live-elapsed-label">Elapsed</span> <span id="live-elapsed">0 s</span></p></div>
<div class="stat">${ICON.globe}<p><span class="label">Browser</span> <span id="live-browser">Chromium</span></p></div>
</div>
<section class="box" aria-labelledby="live-list-h">
<h3 id="live-list-h">Scenarios</h3>
<div id="live-list"><p class="empty">Waiting for the run to start</p></div>
</section>
</div>
<div class="run-col">
<figure class="browser" aria-labelledby="live-caption">
<div class="chrome">
<span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>
<div class="address"><span class="label" id="live-url-label">Testing</span><span id="live-url">Waiting for the browser…</span></div>
<span id="live-badge" class="pill">Starting</span>
</div>
<div class="viewport">
<img id="live-frame" alt="Live view of the browser under test. No frame yet." hidden>
<p id="live-placeholder" class="placeholder">Starting the browser…</p>
</div>
<figcaption class="now" id="live-caption"><span class="label">Now</span><span id="live-step">Starting the run</span></figcaption>
</figure>
<div class="side">
<section class="box activity" aria-labelledby="live-steps-h">
<h3 id="live-steps-h">Live activity (latest last)</h3>
<div class="steps-scroll" id="live-steps-box" tabindex="0" role="region" aria-labelledby="live-steps-h"><ol id="live-steps"></ol></div>
</section>
<section class="box" aria-labelledby="live-scenario-h">
<h3 id="live-scenario-h">Scenario</h3>
<p id="live-group"></p>
<p id="live-scenario">Not started</p>
<p id="live-scenario-id"></p>
</section>
<section class="box" aria-labelledby="live-pages-h">
<h3 id="live-pages-h">Pages tested</h3>
<ul id="live-pages"><li class="empty">None yet</li></ul>
</section>
</div>
</div>
</div>
</div>
</section>

<section class="card" id="report-section" aria-labelledby="step-report" tabindex="-1" hidden>
<p class="eyebrow">Step 4 of 4</p>
<h2 id="step-report">Report</h2>
<div id="report"></div>
</section>
<footer class="site-footer"><p>Run Hound ${VERSION} · V0 tester preview · rule-based planning, no AI model yet · tests only local and private-network addresses · test records it creates are counted in the report, not deleted</p></footer>
</main>
</div>
<script>
(() => {
  const $ = (id) => document.getElementById(id);
  const el = (tag, props = {}, ...children) => {
    const node = Object.assign(document.createElement(tag), props);
    for (const c of children) node.append(c);
    return node;
  };
  let planId = null;
  let checkTitles = {};
  const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
  const GROUPS = ${JSON.stringify(CHECK_GROUPS)};
  const groupOfCategory = (category) => GROUPS.find((g) => g.categories.includes(category)) || null;
  const plural = (n, word) => n + " " + word + (n === 1 ? "" : "s");

  /** Marks the sidebar steps: earlier ones done, step n current. A reached step whose section is on screen is a link to it. */
  function setStep(n) {
    for (const li of document.querySelectorAll("#steps li")) {
      const k = Number(li.dataset.step);
      li.className = k < n ? "done" : k === n ? "current" : "";
      const section = $(li.dataset.target);
      const reachable = k <= n && section && !section.hidden;
      const old = li.firstElementChild;
      const node = document.createElement(reachable ? "a" : "span");
      node.className = "step";
      if (reachable) node.href = "#" + li.dataset.target;
      if (k === n) node.setAttribute("aria-current", "step");
      node.append(...[...old.childNodes].filter((c) => !(c.classList && c.classList.contains("visually-hidden"))));
      if (k < n) node.append(el("span", { className: "visually-hidden", textContent: " (done)" }));
      old.replaceWith(node);
    }
  }

  const STATUS_TEXT = { pass: "passed", fail: "failed", error: "errored", skipped: "skipped", running: "running", queued: "queued" };

  /** The approved scenarios under their groups, each with a status ring (queued, running, passed, failed…) and its time. */
  function renderList(scenarios, finished, current) {
    if (!scenarios || scenarios.length === 0) return;
    const done = new Map((finished || []).map((f) => [f.scenarioId, f]));
    const groups = [];
    for (const s of scenarios) {
      const label = s.groupLabel || "Scenarios";
      let g = groups.find((x) => x.label === label);
      if (!g) groups.push((g = { label, items: [] }));
      g.items.push(s);
    }
    const out = [];
    for (const g of groups) {
      const ended = g.items.filter((s) => done.has(s.id)).length;
      out.push(el("h4", {}, g.label, " ", el("span", { textContent: ended + " of " + g.items.length })));
      out.push(el("ol", { className: "runlist" }, ...g.items.map((s) => {
        const f = done.get(s.id);
        const st = f ? f.status : s.id === current ? "running" : "queued";
        return el("li", { className: st },
          el("span", { className: "ring " + st }, el("span", { className: "visually-hidden", textContent: (STATUS_TEXT[st] || st) + ": " })),
          el("span", { className: "t", textContent: s.title }),
          el("span", { className: "d", textContent: f ? formatDuration(f.durationMs) : st === "running" ? "running" : "–" }));
      })));
    }
    $("live-list").replaceChildren(...out);
  }

  /** Browser copy of formatDuration (core/format.ts), same contract: "4.2 s", "42 s", "1 min 12 s", "1 h 3 min". */
  function formatDuration(ms) {
    if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "";
    if (ms < 10000) return (Math.floor(ms / 100) / 10).toFixed(1) + " s";
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return sec + " s";
    if (sec < 3600) return Math.floor(sec / 60) + " min" + (sec % 60 ? " " + (sec % 60) + " s" : "");
    const min = Math.floor((sec % 3600) / 60);
    return Math.floor(sec / 3600) + " h" + (min ? " " + min + " min" : "");
  }

  async function api(path, body) {
    const res = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || ("Request failed (" + res.status + ")"));
    return json;
  }

  $("target-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const url = $("target-url").value.trim();
    $("target-error").textContent = "";
    $("target-url").removeAttribute("aria-invalid");
    if (!url) {
      $("target-url").setAttribute("aria-invalid", "true");
      $("target-error").textContent = "Enter the URL of the page with your form.";
      $("target-url").focus();
      return;
    }
    $("plan-button").disabled = true;
    $("plan-button").textContent = "Opening the page…";
    try {
      const { planId: id, plan, checks, warnings } = await api("/api/plan", { url });
      planId = id;
      checkTitles = checks || {};
      showPlan(plan);
      const warn = $("plan-warnings");
      warn.replaceChildren(...(warnings || []).map((w) => el("p", { textContent: w })));
      warn.hidden = !(warnings && warnings.length);
    } catch (err) {
      // A failed plan must not leave the previous target's plan on screen, ready to run.
      planId = null;
      $("plan-section").hidden = true;
      setStep(1);
      $("target-url").setAttribute("aria-invalid", "true");
      $("target-error").textContent = err.message;
    } finally {
      $("plan-button").disabled = false;
      $("plan-button").textContent = "Plan checks";
    }
  });

  function showPlan(plan) {
    const box = $("scenarios");
    box.replaceChildren();
    const fields = plan.form.fields.length;
    $("plan-summary").textContent = "Found " + (plan.form.name ? "“" + plan.form.name + "”" : "a form") + " with " + plural(fields, "field") + ". " + plural(plan.scenarios.length, "scenario") + " proposed, grouped as Accessibility, Features and Security; they run in that order.";
    const byId = new Map(plan.scenarios.map((s) => [s.id, s]));
    const groups = plan.groups && plan.groups.length > 0 ? plan.groups : [{ id: "all", label: "Scenarios", scenarioIds: plan.scenarios.map((s) => s.id) }];
    for (const g of groups) {
      const scenarios = g.scenarioIds.map((id) => byId.get(id)).filter(Boolean);
      if (scenarios.length === 0) continue;
      const headingId = "grp-h-" + g.id;
      const allId = "grp-all-" + g.id;
      const all = el("input", { type: "checkbox", id: allId, className: "group-all" });
      const group = el("div", { className: "group", role: "group" },
        el("div", { className: "group-head" },
          el("h3", { id: headingId }, g.label, " ", el("span", { className: "count", textContent: plural(scenarios.length, "scenario") })),
          el("div", { className: "select-all" }, all, el("label", { htmlFor: allId, textContent: "Select all in " + g.label }))));
      group.setAttribute("aria-labelledby", headingId);
      const inputs = [];
      const byCheck = new Map();
      for (const s of scenarios) byCheck.set(s.checkId, [...(byCheck.get(s.checkId) || []), s]);
      for (const [checkId, list] of byCheck) {
        const fs = el("fieldset", {}, el("legend", { textContent: checkTitles[checkId] || checkId }));
        for (const s of list) {
          const id = "sc-" + s.id.replace(/[^\\w-]/g, "_");
          const input = el("input", { type: "checkbox", id, name: "scenario", value: s.id, checked: s.defaultSelected });
          const label = el("label", { htmlFor: id }, s.title, el("span", { className: "tag" + (s.kind === "danger" ? " danger" : ""), textContent: s.kind }));
          if (s.destructive) label.append(el("span", { className: "tag danger", textContent: "destructive" }));
          label.append(el("span", { className: "desc", textContent: s.description }));
          fs.append(el("div", { className: "scenario" }, input, label));
          inputs.push(input);
        }
        group.append(fs);
      }
      // The group box is checked when all of its scenarios are, indeterminate when only some are.
      const sync = () => {
        const on = inputs.filter((i) => i.checked).length;
        all.checked = on === inputs.length;
        all.indeterminate = on > 0 && on < inputs.length;
      };
      all.addEventListener("change", () => {
        for (const i of inputs) i.checked = all.checked;
        sync();
      });
      for (const i of inputs) i.addEventListener("change", sync);
      sync();
      box.append(group);
    }
    $("plan-section").hidden = false;
    $("progress-section").hidden = true;
    $("report-section").hidden = true;
    setStep(2);
    $("step-plan").setAttribute("tabindex", "-1");
    $("step-plan").focus();
  }

  $("plan-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const approved = [...$("scenarios").querySelectorAll('input[name="scenario"]:checked')].map((i) => i.value);
    $("plan-error").textContent = "";
    if (!planId) {
      $("plan-error").textContent = "Plan the checks for a page first.";
      return;
    }
    if (approved.length === 0) {
      $("plan-error").textContent = "Select at least one scenario to run.";
      return;
    }
    $("run-button").disabled = true;
    $("progress-section").hidden = false;
    $("report-section").hidden = true;
    $("status").textContent = "Starting " + approved.length + " scenarios…";
    try {
      const { runId } = await api("/api/runs", { planId, approved, allowDestructive: $("allow-destructive").checked, headed: $("headed").checked });
      resetLive($("headed").checked);
      setStep(3);
      // Keeps the run in the address, so reloading the page comes back to it.
      history.replaceState(null, "", "#run=" + encodeURIComponent(runId));
      poll(runId);
    } catch (err) {
      $("status").textContent = "Could not start the run: " + err.message;
      $("run-button").disabled = false;
    }
  });

  const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });

  function resetLive(headed) {
    $("live-url").textContent = "Waiting for the browser…";
    $("live-url-label").textContent = "Testing";
    $("live-scenario-h").textContent = "Scenario";
    $("live-step").textContent = headed ? "Opening a browser window on this machine" : "Starting the browser";
    $("live-scenario").textContent = "Not started";
    $("live-scenario-id").textContent = "";
    $("live-group").textContent = "";
    stopClock();
    $("live-elapsed-label").textContent = "Elapsed";
    $("live-elapsed").textContent = "0 s";
    $("live-pages").replaceChildren(el("li", { className: "empty", textContent: "None yet" }));
    $("live-steps").replaceChildren();
    $("live-list").replaceChildren(el("p", { className: "empty", textContent: "Waiting for the run to start" }));
    $("live-tally").textContent = "0 / 0";
    $("live-browser").textContent = headed === undefined ? "Chromium" : headed ? "Chromium, visible window" : "Chromium, headless";
    $("live-frame").hidden = true;
    $("live-frame").removeAttribute("src");
    $("live-placeholder").hidden = false;
    $("live-placeholder").textContent = "Starting the browser…";
    setBadge("Starting", false);
  }

  /**
   * The elapsed-time counter. Each poll gives the server's elapsedMs; between polls it counts on from there, so it
   * ticks every second even if the two clocks disagree. It sits outside the status region: never announced per tick.
   */
  const clock = { base: 0, at: 0, timer: null };
  const tickText = (ms) => (ms < 10000 ? Math.floor(ms / 1000) + " s" : formatDuration(ms));
  function renderClock() {
    $("live-elapsed").textContent = tickText(clock.base + (performance.now() - clock.at));
  }
  function runClock(elapsedMs) {
    clock.base = elapsedMs;
    clock.at = performance.now();
    if (clock.timer === null) {
      renderClock();
      clock.timer = setInterval(renderClock, 1000);
    }
  }
  function stopClock() {
    if (clock.timer !== null) clearInterval(clock.timer);
    clock.timer = null;
  }

  function setBadge(text, on) {
    $("live-badge").textContent = text;
    $("live-badge").className = "pill" + (on ? " on" : "");
  }

  /** Swaps in a new frame only once it has loaded, so the view never flashes empty. */
  function showFrame(runId, seq, url) {
    const next = new Image();
    next.onload = () => {
      $("live-frame").src = next.src;
      $("live-frame").alt = "Live view of the browser under test, showing " + (url || "the page");
      $("live-frame").hidden = false;
      $("live-placeholder").hidden = true;
    };
    next.src = "/api/runs/" + encodeURIComponent(runId) + "/live.jpg?frame=" + seq;
  }

  function renderPages(pages, current) {
    if (pages.length === 0) return;
    $("live-pages").replaceChildren(...pages.map((u) => {
      const now = u === current;
      const li = el("li", { className: now ? "current" : "", textContent: u });
      if (now) li.append(el("span", { className: "tag", textContent: "now" }));
      return li;
    }));
  }

  function renderSteps(steps, finished) {
    const took = new Map((finished || []).map((f) => [f.scenarioId, f]));
    const box = $("live-steps-box");
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 24;
    const items = [];
    let scenario, url;
    for (const s of steps) {
      if (s.scenarioId !== scenario) {
        scenario = s.scenarioId;
        url = undefined;
        const done = scenario ? took.get(scenario) : undefined;
        items.push(el("li", {}, el("span", { className: "scn" }, scenario || "Run Hound",
          done ? el("span", { className: "took", textContent: done.status + " · " + formatDuration(done.durationMs) }) : "")));
      }
      const li = el("li", {}, el("time", { dateTime: s.at, textContent: time(s.at) }), el("span", { textContent: s.label }));
      if (s.url !== url) li.append(el("span", { className: "url", textContent: s.url }));
      url = s.url;
      items.push(li);
    }
    $("live-steps").replaceChildren(...items);
    if (atBottom) box.scrollTop = box.scrollHeight;
  }

  /**
   * Polls the run and its live view about twice a second. The status region only announces when the
   * scenario changes or the run ends; the step, URL and frame update silently.
   */
  async function poll(runId) {
    const base = "/api/runs/" + encodeURIComponent(runId);
    let scenario = null, frameSeq = 0, lastStep = "", pagesKey = "", listKey = "";
    for (;;) {
      let state, live;
      try {
        [state, live] = await Promise.all([api(base), api(base + "/live")]);
      } catch (err) {
        $("status").textContent = "Lost track of the run: " + err.message;
        break;
      }
      $("progress").max = Math.max(state.total, 1);
      $("progress").value = state.completed;
      $("live-tally").textContent = state.completed + " / " + state.total;
      if (live.url) $("live-url").textContent = live.url;
      if (live.frameSeq !== frameSeq) {
        frameSeq = live.frameSeq;
        showFrame(runId, frameSeq, live.url);
      }
      const last = live.steps[live.steps.length - 1];
      const finished = live.finished || [];
      const stepKey = (last ? last.at + last.label + live.steps.length : "") + "|" + finished.length;
      if (stepKey !== lastStep) {
        lastStep = stepKey;
        renderSteps(live.steps, finished);
      }
      // live.step is cleared when a scenario starts, so a previous scenario's step never lingers.
      $("live-step").textContent = live.step || (live.scenarioId ? "Starting “" + (live.scenarioTitle || live.scenarioId) + "”" : $("live-step").textContent);
      const nowId = state.status === "running" ? live.scenarioId : null;
      const lk = (live.finished || []).length + "|" + nowId + "|" + (live.scenarios || []).length;
      if (lk !== listKey) {
        listKey = lk;
        renderList(live.scenarios, live.finished, nowId);
      }
      const key = live.pagesVisited.join(" ") + "|" + live.url + "|" + state.status;
      if (key !== pagesKey) {
        pagesKey = key;
        renderPages(live.pagesVisited, state.status === "running" ? live.url : null);
      }
      if (state.status === "running") {
        if (typeof live.elapsedMs === "number") runClock(live.elapsedMs);
        if (live.scenarioId && live.scenarioId !== scenario) {
          scenario = live.scenarioId;
          const n = live.scenarioIndex || Math.min(state.completed + 1, state.total);
          const where = (live.groupLabel ? live.groupLabel + " · " : "") + n + " of " + state.total;
          $("status").textContent = (live.groupLabel ? live.groupLabel + ", scenario " : "Scenario ") + n + " of " + state.total + ": " + (live.scenarioTitle || live.scenarioId);
          $("live-group").textContent = where;
          $("live-scenario").textContent = live.scenarioTitle || live.scenarioId;
          $("live-scenario-id").textContent = live.scenarioId;
          setBadge("Live", true);
        } else if (!scenario) {
          $("status").textContent = "Starting " + state.total + " scenario" + (state.total === 1 ? "" : "s") + "…";
        }
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      stopClock();
      const ranFor = typeof state.durationMs === "number" ? state.durationMs : live.elapsedMs;
      $("live-elapsed-label").textContent = state.status === "done" ? "Finished in" : "Stopped after";
      $("live-elapsed").textContent = formatDuration(ranFor) || "–";
      setBadge(state.status === "done" ? "Finished" : "Stopped", false);
      $("live-url-label").textContent = "Last page";
      $("live-scenario-h").textContent = "Last scenario";
      const lastRun = (live.finished || [])[(live.finished || []).length - 1];
      if (!scenario && lastRun) {
        // Reopened after the run ended (#run=<id>): name the last scenario instead of "Not started".
        $("live-scenario").textContent = live.scenarioTitle || lastRun.scenarioId;
        $("live-scenario-id").textContent = lastRun.scenarioId;
        $("live-group").textContent = live.groupLabel || "";
      }
      if (frameSeq === 0) $("live-placeholder").textContent = "No frames were captured.";
      if (state.status === "error") {
        $("status").textContent = "The run failed: " + state.error;
        $("live-step").textContent = "The run failed";
      } else {
        const confirmed = state.report.findings.filter((f) => f.confidence === "confirmed").length;
        const total = state.report.findings.length;
        $("status").textContent = "Done in " + formatDuration(ranFor) + ". " + plural(total, "finding") + " (" + confirmed + " confirmed, " + (total - confirmed) + " advisory).";
        $("live-step").textContent = "Finished. The last frame is shown above.";
        showReport(runId, state.report);
      }
      break;
    }
    $("run-button").disabled = false;
  }

  const VISUAL_KINDS = ["frame", "gif", "card", "screenshot"];
  const KIND_NAMES = { frame: "Annotated screenshot", gif: "Recording", card: "Data card", screenshot: "Screenshot" };

  /** One piece of visual evidence: the image (linked to the full-size file), what it shows, and its facts. */
  function evidenceFigure(base, e) {
    const href = base + "artifacts/" + encodeURIComponent(e.path);
    const meta = [
      e.step ? "Step: " + e.step : "",
      e.url ? "Page: " + e.url : "",
      e.capturedAt ? "Captured: " + e.capturedAt : "",
      e.kind === "gif" && e.frames ? e.frames + " frames, " + (e.durationMs / 1000).toFixed(1) + " s" : "",
    ].filter(Boolean).join(" · ");
    const figure = el("figure", {},
      el("a", { href, target: "_blank", rel: "noopener" }, el("img", { src: href, alt: (KIND_NAMES[e.kind] || e.kind) + ": " + e.label, loading: "lazy" })),
      el("figcaption", {}, el("b", { textContent: (KIND_NAMES[e.kind] || e.kind) + ": " + e.label }), meta ? el("span", { textContent: " · " + meta }) : ""));
    const facts = e.facts || [];
    if (facts.length > 0) {
      const dl = el("dl", {});
      for (const x of facts) dl.append(el("dt", { textContent: x.label }), el("dd", { textContent: x.value }));
      figure.append(el("details", {}, el("summary", { textContent: "Data behind it (" + facts.length + ")" }), dl));
    }
    return figure;
  }

  /** Per-group summary: counts, findings and the time the group's scenarios took. */
  function groupTable(groups) {
    const cell = (n, bad) => el("td", { className: bad && n > 0 ? "bad" : "", textContent: String(n) });
    // Whitespace between cells, as in HTML source, so the row's text reads "Accessibility 2 1 …" and not "Accessibility21…".
    const row = (...cells) => el("tr", {}, ...cells.flatMap((c) => [c, " "]));
    const head = ["Group", "Scenarios", "Passed", "Failed", "Errored", "Skipped", "Findings", "Time"];
    return el("div", { className: "table-scroll" }, el("table", { className: "groups" },
      el("caption", { textContent: "Results by group" }),
      el("thead", {}, row(...head.map((h) => el("th", { scope: "col", textContent: h })))),
      el("tbody", {}, ...groups.map((g) => row(
        el("th", { scope: "row", textContent: g.label }),
        cell(g.scenarioIds.length), cell(g.passed), cell(g.failed, true), cell(g.errored, true), cell(g.skipped), cell(g.findings, true),
        el("td", { textContent: formatDuration(g.durationMs) }))))));
  }

  /** Every scenario that ran, under its group, with its result and how long it took. */
  function scenarioList(report) {
    const titles = new Map(((report.plan && report.plan.scenarios) || []).map((s) => [s.id, s.title]));
    const results = new Map(report.results.map((r) => [r.scenarioId, r]));
    const box = el("details", {}, el("summary", { textContent: "Scenarios by group (" + report.results.length + ")" }));
    for (const g of report.groups) {
      box.append(el("h4", { textContent: g.label }), el("ul", {}, ...g.scenarioIds.map((id) => {
        const r = results.get(id);
        const status = r ? r.status : "not run";
        return el("li", {}, el("span", { className: status === "pass" ? "pass" : status === "fail" || status === "error" ? "fail" : "muted", textContent: status }),
          " " + (titles.get(id) || id) + (r ? " · " + formatDuration(r.durationMs) : ""));
      })));
    }
    return box;
  }

  function showReport(runId, report) {
    const out = $("report");
    const s = report.summary;
    const base = "/api/runs/" + encodeURIComponent(runId) + "/";
    const ranFor = typeof report.durationMs === "number" ? report.durationMs : Date.parse(report.finishedAt) - Date.parse(report.startedAt);
    const clean = report.findings.length === 0 && s.failed === 0 && s.errored === 0;
    const ring = el("span", { className: "ring " + (clean ? "pass" : "fail") });
    ring.setAttribute("aria-hidden", "true");
    const tile = (label, n, tone) => el("li", { className: n > 0 && tone ? tone : "" }, el("b", { textContent: String(n) }), " ", el("span", { textContent: label }));
    out.replaceChildren(
      el("div", { className: "verdict" }, ring, el("div", {},
        el("p", { className: "finished", textContent: "Finished in " + formatDuration(ranFor) }),
        el("p", { className: "muted", textContent: s.passed + " passed, " + s.failed + " failed, " + s.errored + " errored, " + s.skipped + " skipped. Findings: " + s.critical + " critical, " + s.high + " high, " + s.medium + " medium, " + s.low + " low." }))),
      el("ul", { className: "tiles", ariaLabel: "Counts" },
        tile("Critical", s.critical, "hot"), tile("High", s.high, "hot"), tile("Medium", s.medium, "warm"), tile("Low", s.low),
        tile("Passed", s.passed, "good"), tile("Failed", s.failed, "hot"), tile("Errored", s.errored, "hot"), tile("Skipped", s.skipped)),
      ...(typeof report.testRecordsCreated === "number"
        ? [el("p", { textContent: report.testRecordsCreated === 0
            ? "Test data: this run created no test records."
            : "Test data: this run may have created " + report.testRecordsCreated + " test record" + (report.testRecordsCreated === 1 ? "" : "s") + " in your app. Run Hound does not delete them." })]
        : []),
      el("ul", { className: "links" },
        el("li", {}, el("a", { href: base + "report.html", textContent: "Open the full report (HTML)" })),
        el("li", {}, el("a", { href: base + "report.md", textContent: "Markdown report" })),
        el("li", {}, el("a", { href: base + "report.json", textContent: "JSON report" }))),
    );
    if (report.groups && report.groups.length > 0) out.append(groupTable(report.groups), scenarioList(report));
    if (report.findings.length === 0) out.append(el("p", { className: "pass", textContent: "No findings in the scenarios that ran." }));
    const sorted = [...report.findings].sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9));
    for (const f of sorted) {
      const item = el("article", { className: "finding sev-" + f.severity },
        el("h3", {}, el("span", { className: "sev", textContent: f.severity + (f.confidence === "advisory" ? " · advisory" : "") }), f.title),
        el("p", { className: "muted" }, groupOfCategory(f.category) ? el("span", { className: "group-tag", textContent: groupOfCategory(f.category).label + " · " }) : "", f.checkId + (f.location && !(f.locations && f.locations.length > 1) ? " · " + f.location : "")));
      if (f.locations && f.locations.length > 1) {
        item.append(el("p", { className: "muted", textContent: "Where (" + f.locations.length + " places):" }), el("ul", {}, ...f.locations.map((l) => el("li", { textContent: l }))));
      }
      item.append(
        el("p", { textContent: f.meaning }),
        el("p", { textContent: "Fix: " + f.fix }));
      const visual = (f.evidence || []).filter((e) => e.path && VISUAL_KINDS.includes(e.kind));
      if (visual.length > 0) item.append(el("div", { className: "evidence" }, ...visual.map((e) => evidenceFigure(base, e))));
      if (f.spec) item.append(el("p", {}, el("a", { href: base + "specs/" + encodeURIComponent(f.spec.filename), textContent: "Playwright spec: " + f.spec.filename })));
      out.append(item);
    }
    const errored = report.results.filter((r) => r.status === "error");
    for (const r of errored) out.append(el("p", { className: "error", textContent: r.scenarioId + " errored: " + (r.notes || "") }));
    out.append(el("h3", { textContent: "What a browser can't see" }), el("ul", {}, ...report.notVisible.map((t) => el("li", { textContent: t }))));
    $("report-section").hidden = false;
    setStep(4);
    $("report-section").focus();
  }

  // Reloading the page (or opening a link to #run=<id>) shows that run again: live while it runs, then its report.
  const resume = /^#run=([\\w-]+)$/.exec(location.hash);
  if (resume) {
    $("progress-section").hidden = false;
    resetLive(undefined);
    setStep(3);
    $("run-button").disabled = true;
    poll(resume[1]);
  }
})();
</script>
</body>
</html>
`;
