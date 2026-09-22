import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
import { join, resolve } from "node:path";
import { Hono } from "hono";
import type { Plan, Report } from "../core/types.js";
import { NoFormFoundError, TargetNotAllowedError } from "../engine/errors.js";
import { redactSecrets } from "../engine/redact.js";
import { discoverAndPlan, newRunId, runPlan, type RunOptions } from "../engine/runner.js";

export interface ServerOptions extends Pick<RunOptions, "checks" | "runsDir" | "allowedHosts"> {
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
  report?: Report;
  error?: string;
}

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
    (err instanceof Error && /net::ERR_|Timeout .*exceeded/.test(err.message))
  );
}

/**
 * Local UI + JSON API (served on port 4000 by the CLI):
 *   GET  /                          HTML UI: target URL -> plan with checkboxes -> approve -> progress -> report
 *   POST /api/plan  {url}           200 {planId, plan} | 400 {error} (bad URL, not allowed, no form)
 *   POST /api/runs  {planId, approved: string[], allowDestructive?: boolean}  202 {runId} | 404 unknown plan
 *   GET  /api/runs/:runId           {status: "running"|"done"|"error", completed, total, report?, error?}
 *   GET  /api/runs/:runId/report.json | report.md | report.html
 *   GET  /api/runs/:runId/specs/:file
 * Plans and run states live in memory for the life of the process; reports are also on disk under runsDir.
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

  app.get("/", (c) => c.html(UI_HTML));

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
      // The stored plan keeps the real target; what leaves the process is redacted.
      return c.json({ planId, plan: redactPlan(plan) }, 200);
    } catch (err) {
      const message = redactSecrets(err instanceof Error ? err.message : String(err));
      if (isUserError(err)) return c.json({ error: message }, 400);
      return c.json({ error: `Could not plan a run: ${message}` }, 500);
    }
  });

  app.post("/api/runs", async (c) => {
    let body: { planId?: unknown; approved?: unknown; allowDestructive?: unknown };
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

    const approved = body.approved as string[] | undefined;
    const approvedSet = new Set(approved ?? plan.scenarios.filter((s) => s.defaultSelected).map((s) => s.id));
    const runId = newRunId();
    const state: RunState = {
      status: "running",
      completed: 0,
      total: plan.scenarios.filter((s) => approvedSet.has(s.id)).length,
      dir: join(runsDir, runId),
    };
    runs.set(runId, state);

    runPlan(plan, {
      checks: options.checks,
      allowedHosts: options.allowedHosts,
      runsDir,
      runId,
      approved,
      allowDestructive: body.allowDestructive === true,
      onProgress: (e) => {
        if (e.type === "scenario-end") state.completed += 1;
      },
    }).then(
      ({ report, dir }) => Object.assign(state, { status: "done", report, dir }),
      (err: unknown) => Object.assign(state, { status: "error", error: redactSecrets(err instanceof Error ? err.message : String(err)) }),
    );

    return c.json({ runId }, 202);
  });

  app.get("/api/runs/:runId", (c) => {
    const state = runs.get(c.req.param("runId"));
    if (!state) return c.json({ error: "Unknown run." }, 404);
    const { dir: _dir, ...status } = state;
    return c.json(status);
  });

  app.get("/api/runs/:runId/:file{report\\.(?:json|md|html)}", async (c) => {
    const state = runs.get(c.req.param("runId"));
    const file = c.req.param("file");
    const type = REPORT_FILES[file];
    if (!state || state.status !== "done" || !type) return c.json({ error: "Not found." }, 404);
    return c.body(await readFile(join(state.dir, file), "utf8"), 200, { "content-type": type });
  });

  app.get("/api/runs/:runId/specs/:file", async (c) => {
    const state = runs.get(c.req.param("runId"));
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

  // Screenshots referenced from report.html (artifacts/<file>.png), served next to the report.
  app.get("/api/runs/:runId/artifacts/:file", async (c) => {
    const state = runs.get(c.req.param("runId"));
    const file = c.req.param("file");
    if (!state || state.status !== "done") return c.json({ error: "Not found." }, 404);
    if (!SAFE_FILE.test(file) || !file.endsWith(".png")) return c.json({ error: "Invalid file name." }, 400);
    try {
      const png = await readFile(join(state.dir, "artifacts", file));
      return c.body(png, 200, { "content-type": "image/png" });
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
 * Night Shift palette; every control is labelled, focus is always visible, progress goes to a live region.
 * The script builds DOM with textContent only, so report text is never parsed as HTML.
 */
const UI_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Run Hound</title>
<style>
:root { --bg:#0E1012; --surface:#171A1D; --text:#E8E6E1; --muted:#B4B8BC; --amber:#F5B642; --pass:#6FCF97; --fail:#FF7A6B; --line:#2A2F34; }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--text); font:16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 52rem; margin: 0 auto; padding: 2rem 1rem 4rem; }
h1 { margin: 0; color: var(--amber); font-size: 1.75rem; }
h2 { font-size: 1.2rem; margin: 0 0 .75rem; }
p.lead, .muted { color: var(--muted); }
section.card { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 1rem 1.25rem; margin-top: 1.25rem; }
label { display: block; font-weight: 600; margin-bottom: .35rem; }
.row { display: flex; gap: .5rem; flex-wrap: wrap; }
input[type=url] { flex: 1 1 16rem; min-width: 0; padding: .6rem .75rem; border-radius: 6px; border: 1px solid #4A5057; background: var(--bg); color: var(--text); font: inherit; }
button { padding: .6rem 1.1rem; border-radius: 6px; border: 0; background: var(--amber); color: #0E1012; font: inherit; font-weight: 700; cursor: pointer; min-height: 44px; }
button:disabled { opacity: .6; cursor: progress; }
:focus-visible { outline: 3px solid var(--amber); outline-offset: 2px; }
input[type=url]:focus-visible { outline-offset: 0; }
fieldset { border: 1px solid var(--line); border-radius: 6px; margin: 0 0 .75rem; padding: .5rem .75rem; }
legend { color: var(--amber); font-weight: 600; padding: 0 .25rem; }
.scenario { display: flex; gap: .6rem; align-items: flex-start; padding: .35rem 0; }
.scenario input { width: 1.25rem; height: 1.25rem; margin-top: .2rem; accent-color: var(--amber); flex: none; }
.scenario label { font-weight: 400; margin: 0; }
.scenario .desc { display: block; color: var(--muted); font-size: .9rem; }
.tag { font-size: .75rem; border: 1px solid var(--line); border-radius: 999px; padding: 0 .45rem; margin-left: .35rem; color: var(--muted); }
.tag.danger { color: var(--fail); border-color: var(--fail); }
.error { color: var(--fail); }
.pass { color: var(--pass); }
.fail { color: var(--fail); }
progress { width: 100%; height: .75rem; accent-color: var(--amber); }
.finding { border-left: 4px solid var(--fail); padding: .25rem .75rem; margin: .75rem 0; }
.finding h3 { margin: 0; font-size: 1rem; overflow-wrap: anywhere; }
.finding p { margin: .25rem 0; }
a { color: var(--amber); }
ul.links { padding-left: 1.2rem; }
[hidden] { display: none !important; }
</style>
</head>
<body>
<main>
<header>
<h1>Run Hound</h1>
<p class="lead">Point it at a form on your own local app. It plans a set of checks, you approve them, it runs them in a real browser.</p>
</header>

<section class="card" aria-labelledby="step-target">
<h2 id="step-target">1. Target</h2>
<form id="target-form" novalidate>
<label for="target-url">Page URL (localhost or a private address)</label>
<div class="row">
<input id="target-url" name="url" type="url" required placeholder="http://localhost:3000/book" autocomplete="url" aria-describedby="target-error">
<button id="plan-button" type="submit">Plan checks</button>
</div>
<p id="target-error" class="error" role="alert"></p>
</form>
</section>

<section class="card" id="plan-section" aria-labelledby="step-plan" hidden>
<h2 id="step-plan">2. Approve the plan</h2>
<p class="muted" id="plan-summary"></p>
<form id="plan-form">
<div id="scenarios"></div>
<div class="scenario">
<input id="allow-destructive" type="checkbox">
<label for="allow-destructive">Allow destructive scenarios<span class="desc">They may change or delete data beyond creating test records. Leave off unless this is a throwaway environment.</span></label>
</div>
<button id="run-button" type="submit">Run approved checks</button>
</form>
</section>

<section class="card" id="progress-section" aria-labelledby="step-progress" hidden>
<h2 id="step-progress">3. Progress</h2>
<progress id="progress" max="1" value="0" aria-labelledby="step-progress"></progress>
<p id="status" role="status" aria-live="polite"></p>
</section>

<section class="card" id="report-section" aria-labelledby="step-report" tabindex="-1" hidden>
<h2 id="step-report">4. Report</h2>
<div id="report"></div>
</section>
</main>
<script>
(() => {
  const $ = (id) => document.getElementById(id);
  const el = (tag, props = {}, ...children) => {
    const node = Object.assign(document.createElement(tag), props);
    for (const c of children) node.append(c);
    return node;
  };
  let planId = null;

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
      const { planId: id, plan } = await api("/api/plan", { url });
      planId = id;
      showPlan(plan);
    } catch (err) {
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
    $("plan-summary").textContent = "Found " + (plan.form.name ? "“" + plan.form.name + "”" : "a form") + " with " + fields + " field" + (fields === 1 ? "" : "s") + ". " + plan.scenarios.length + " scenarios proposed.";
    const byCheck = new Map();
    for (const s of plan.scenarios) byCheck.set(s.checkId, [...(byCheck.get(s.checkId) || []), s]);
    for (const [checkId, scenarios] of byCheck) {
      const fs = el("fieldset", {}, el("legend", { textContent: checkId }));
      for (const s of scenarios) {
        const id = "sc-" + s.id.replace(/[^\\w-]/g, "_");
        const input = el("input", { type: "checkbox", id, value: s.id, checked: s.defaultSelected });
        const label = el("label", { htmlFor: id }, s.title, el("span", { className: "tag" + (s.kind === "danger" ? " danger" : ""), textContent: s.kind }));
        if (s.destructive) label.append(el("span", { className: "tag danger", textContent: "destructive" }));
        label.append(el("span", { className: "desc", textContent: s.description }));
        fs.append(el("div", { className: "scenario" }, input, label));
      }
      box.append(fs);
    }
    $("plan-section").hidden = false;
    $("progress-section").hidden = true;
    $("report-section").hidden = true;
    $("step-plan").setAttribute("tabindex", "-1");
    $("step-plan").focus();
  }

  $("plan-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const approved = [...$("scenarios").querySelectorAll("input:checked")].map((i) => i.value);
    $("run-button").disabled = true;
    $("progress-section").hidden = false;
    $("report-section").hidden = true;
    $("status").textContent = "Starting " + approved.length + " scenarios…";
    try {
      const { runId } = await api("/api/runs", { planId, approved, allowDestructive: $("allow-destructive").checked });
      poll(runId);
    } catch (err) {
      $("status").textContent = "Could not start the run: " + err.message;
      $("run-button").disabled = false;
    }
  });

  async function poll(runId) {
    let last = -1;
    for (;;) {
      let state;
      try {
        state = await api("/api/runs/" + encodeURIComponent(runId));
      } catch (err) {
        $("status").textContent = "Lost track of the run: " + err.message;
        break;
      }
      $("progress").max = Math.max(state.total, 1);
      $("progress").value = state.completed;
      if (state.status === "running") {
        if (state.completed !== last) $("status").textContent = "Completed " + state.completed + " of " + state.total + " scenarios.";
        last = state.completed;
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      if (state.status === "error") $("status").textContent = "The run failed: " + state.error;
      else {
        $("status").textContent = "Done. " + state.report.findings.length + " finding" + (state.report.findings.length === 1 ? "" : "s") + ".";
        showReport(runId, state.report);
      }
      break;
    }
    $("run-button").disabled = false;
  }

  function showReport(runId, report) {
    const out = $("report");
    const s = report.summary;
    const base = "/api/runs/" + encodeURIComponent(runId) + "/";
    out.replaceChildren(
      el("p", { textContent: s.passed + " passed, " + s.failed + " failed, " + s.errored + " errored, " + s.skipped + " skipped. Findings: " + s.critical + " critical, " + s.high + " high, " + s.medium + " medium, " + s.low + " low." }),
      el("ul", { className: "links" },
        el("li", {}, el("a", { href: base + "report.html", textContent: "Full report (HTML)" })),
        el("li", {}, el("a", { href: base + "report.md", textContent: "Markdown report" })),
        el("li", {}, el("a", { href: base + "report.json", textContent: "JSON report" }))),
    );
    if (report.findings.length === 0) out.append(el("p", { className: "pass", textContent: "No findings in the scenarios that ran." }));
    for (const f of report.findings) {
      const item = el("article", { className: "finding" },
        el("h3", { textContent: "[" + f.severity + "] " + f.title }),
        el("p", { className: "muted", textContent: f.checkId + (f.location ? " · " + f.location : "") }),
        el("p", { textContent: f.meaning }),
        el("p", { textContent: "Fix: " + f.fix }));
      if (f.spec) item.append(el("p", {}, el("a", { href: base + "specs/" + encodeURIComponent(f.spec.filename), textContent: "Playwright spec: " + f.spec.filename })));
      out.append(item);
    }
    const errored = report.results.filter((r) => r.status === "error");
    for (const r of errored) out.append(el("p", { className: "error", textContent: r.scenarioId + " errored: " + (r.notes || "") }));
    out.append(el("h3", { textContent: "What a browser can't see" }), el("ul", {}, ...report.notVisible.map((t) => el("li", { textContent: t }))));
    $("report-section").hidden = false;
    $("report-section").focus();
  }
})();
</script>
</body>
</html>
`;
