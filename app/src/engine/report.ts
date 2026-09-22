import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { CheckResult, Evidence, Finding, Report, Severity } from "../core/types.js";
import { redactSecrets } from "./redact.js";

/** Always listed in reports: things a browser can't see. */
export const NOT_VISIBLE: string[] = [
  "Database backups and recovery",
  "Webhook signature verification",
  "Dependency and lockfile hygiene",
  "Server-side logging and monitoring",
  "Legal compliance (privacy policy, accessibility certification)",
];

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];

/** Returns a deep copy of any JSON-like value with secrets redacted from every string (keys included). */
function redactDeep<T>(value: T): T {
  if (typeof value === "string") return redactSecrets(value) as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[redactSecrets(k)] = redactDeep(v);
    return out as T;
  }
  return value;
}

/**
 * A spec filename that is safe to join under specs/: no directories, no leading dot, only [\w.-].
 * "../../x.spec.ts" becomes "x.spec.ts".
 */
export function safeSpecFilename(name: string): string {
  const base = basename(name.replace(/\\/g, "/")).replace(/[^\w.-]/g, "_").replace(/^\.+/, "");
  return base || "finding.spec.ts";
}

/** Passed/failed/... check ids, each listed once, in result order. */
function checksByStatus(results: CheckResult[], status: CheckResult["status"]): string[] {
  const byCheck = new Map<string, CheckResult["status"][]>();
  for (const r of results) byCheck.set(r.checkId, [...(byCheck.get(r.checkId) ?? []), r.status]);
  const overall = (s: CheckResult["status"][]) =>
    s.includes("fail") ? "fail" : s.includes("error") ? "error" : s.every((x) => x === "skipped") ? "skipped" : "pass";
  return [...byCheck].filter(([, s]) => overall(s) === status).map(([id]) => id);
}

function evidenceLine(e: Evidence): string {
  const parts = [`${e.kind}: ${e.label}`];
  if (e.path) parts.push(`(artifacts/${e.path})`);
  if (e.data !== undefined) {
    const json = JSON.stringify(e.data);
    parts.push(json.length > 300 ? `${json.slice(0, 300)}…` : json);
  }
  return parts.join(" ");
}

/** Markdown report: summary counts, findings by severity (meaning / impact / fix / evidence), passed checks, not-visible list. */
export function renderMarkdown(report: Report): string {
  const s = report.summary;
  const lines: string[] = [
    `# Run Hound report`,
    "",
    `- Target: ${report.target}`,
    `- Run: ${report.runId} (${report.startedAt} to ${report.finishedAt})`,
    `- Run Hound ${report.runHoundVersion}`,
    "",
    "## Summary",
    "",
    `| Critical | High | Medium | Low | Passed | Failed | Errored | Skipped |`,
    `|---|---|---|---|---|---|---|---|`,
    `| ${s.critical} | ${s.high} | ${s.medium} | ${s.low} | ${s.passed} | ${s.failed} | ${s.errored} | ${s.skipped} |`,
    "",
    "## Findings",
    "",
  ];
  if (report.findings.length === 0) lines.push("No findings in the scenarios that ran.", "");
  for (const severity of SEVERITIES) {
    const group = report.findings.filter((f) => f.severity === severity);
    if (group.length === 0) continue;
    lines.push(`### ${severity[0]!.toUpperCase()}${severity.slice(1)} (${group.length})`, "");
    for (const f of group) {
      lines.push(`#### ${f.title}`, "");
      lines.push(`- Check: ${f.checkId} · severity: ${f.severity} · confidence: ${f.confidence}`);
      if (f.location) lines.push(`- Where: ${f.location}`);
      lines.push(`- What it means: ${f.meaning}`, `- Impact: ${f.impact}`, `- Fix: ${f.fix}`);
      if (f.spec) lines.push(`- Reproduce: specs/${safeSpecFilename(f.spec.filename)}`);
      if (f.evidence.length > 0) {
        lines.push("- Evidence:");
        for (const e of f.evidence) lines.push(`  - ${evidenceLine(e)}`);
      }
      lines.push("");
    }
  }

  const section = (title: string, ids: string[]) => {
    if (ids.length === 0) return;
    lines.push(`## ${title}`, "", ...ids.map((id) => `- ${id}`), "");
  };
  section("Passed checks", checksByStatus(report.results, "pass"));
  section("Checks that errored", checksByStatus(report.results, "error"));
  section("Skipped checks", checksByStatus(report.results, "skipped"));

  lines.push("## What a browser can't see", "", ...report.notVisible.map((item) => `- ${item}`), "");
  return lines.join("\n");
}

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function findingHtml(f: Finding): string {
  const evidence = f.evidence
    .map((e) => {
      const link = e.path ? ` <a href="artifacts/${esc(encodeURI(e.path))}">${esc(e.path)}</a>` : "";
      const data = e.data !== undefined ? `<pre>${esc(JSON.stringify(e.data, null, 2))}</pre>` : "";
      return `<li><strong>${esc(e.kind)}</strong>: ${esc(e.label)}${link}${data}</li>`;
    })
    .join("");
  const spec = f.spec
    ? `<p>Reproduce: <a href="specs/${esc(encodeURIComponent(safeSpecFilename(f.spec.filename)))}">${esc(safeSpecFilename(f.spec.filename))}</a></p>`
    : "";
  return `<article class="finding sev-${esc(f.severity)}">
<h3>${esc(f.title)}</h3>
<p class="meta">${esc(f.checkId)} · <span class="sev">${esc(f.severity)}</span> · ${esc(f.confidence)}${f.location ? ` · ${esc(f.location)}` : ""}</p>
<dl><dt>What it means</dt><dd>${esc(f.meaning)}</dd><dt>Impact</dt><dd>${esc(f.impact)}</dd><dt>Fix</dt><dd>${esc(f.fix)}</dd></dl>
${spec}${evidence ? `<details><summary>Evidence (${f.evidence.length})</summary><ul>${evidence}</ul></details>` : ""}
</article>`;
}

/** Self-contained HTML report (inline CSS, no external requests), same content as markdown. All text HTML-escaped. */
export function renderHtml(report: Report): string {
  const s = report.summary;
  const list = (ids: string[]) => (ids.length ? `<ul>${ids.map((id) => `<li>${esc(id)}</li>`).join("")}</ul>` : "<p>None.</p>");
  const findings = SEVERITIES.map((severity) => {
    const group = report.findings.filter((f) => f.severity === severity);
    return group.length ? `<h2>${esc(severity)} (${group.length})</h2>${group.map(findingHtml).join("\n")}` : "";
  }).join("\n");
  const cell = (label: string, n: number) => `<div class="stat"><span class="n">${n}</span><span>${esc(label)}</span></div>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Run Hound report ${esc(report.runId)}</title>
<style>
:root { --bg:#0E1012; --surface:#171A1D; --text:#E8E6E1; --muted:#B4B8BC; --amber:#F5B642; --pass:#6FCF97; --fail:#FF7A6B; }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--text); font:16px/1.5 system-ui, sans-serif; }
main { max-width: 60rem; margin: 0 auto; padding: 1.5rem 1rem 4rem; }
h1 { color: var(--amber); margin-bottom: .25rem; }
h2 { text-transform: capitalize; border-bottom: 1px solid #2a2f34; padding-bottom: .25rem; }
.muted, .meta, dt { color: var(--muted); }
a { color: var(--amber); }
a:focus-visible, summary:focus-visible { outline: 2px solid var(--amber); outline-offset: 2px; }
.stats { display:flex; flex-wrap:wrap; gap:.5rem; }
.stat { background:var(--surface); padding:.5rem .75rem; border-radius:6px; min-width:6rem; display:flex; flex-direction:column; }
.stat .n { font-size:1.5rem; font-weight:700; }
.finding { background:var(--surface); border-left:4px solid var(--fail); border-radius:6px; padding:.75rem 1rem; margin:1rem 0; }
.finding.sev-medium, .finding.sev-low { border-left-color: var(--amber); }
.finding h3 { margin:.25rem 0; overflow-wrap:anywhere; }
dd { margin: 0 0 .5rem; overflow-wrap:anywhere; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; background: var(--bg); padding: .5rem; border-radius: 4px; font-size: .85rem; }
.pass { color: var(--pass); }
</style>
</head>
<body>
<main>
<h1>Run Hound report</h1>
<p class="muted">Target: ${esc(report.target)}<br>Run ${esc(report.runId)} · ${esc(report.startedAt)} to ${esc(report.finishedAt)} · Run Hound ${esc(report.runHoundVersion)}</p>
<section aria-labelledby="summary"><h2 id="summary">Summary</h2><div class="stats">
${cell("critical", s.critical)}${cell("high", s.high)}${cell("medium", s.medium)}${cell("low", s.low)}${cell("passed", s.passed)}${cell("failed", s.failed)}${cell("errored", s.errored)}${cell("skipped", s.skipped)}
</div></section>
<section aria-labelledby="findings"><h2 id="findings">Findings</h2>
${report.findings.length ? findings : '<p class="pass">No findings in the scenarios that ran.</p>'}
</section>
<section aria-labelledby="passed"><h2 id="passed">Passed checks</h2>${list(checksByStatus(report.results, "pass"))}</section>
<section aria-labelledby="errored"><h2 id="errored">Checks that errored</h2>${list(checksByStatus(report.results, "error"))}</section>
<section aria-labelledby="skipped"><h2 id="skipped">Skipped checks</h2>${list(checksByStatus(report.results, "skipped"))}</section>
<section aria-labelledby="not-visible"><h2 id="not-visible">What a browser can't see</h2>${list(report.notVisible)}</section>
</main>
</body>
</html>
`;
}

/** Deep copy of the report with secrets redacted and spec filenames made safe. The input is not modified. */
export function redactReport(report: Report): Report {
  const safe = redactDeep(report);
  for (const f of safe.findings) if (f.spec) f.spec.filename = safeSpecFilename(f.spec.filename);
  for (const r of safe.results) for (const f of r.findings) if (f.spec) f.spec.filename = safeSpecFilename(f.spec.filename);
  return safe;
}

/**
 * Writes report.json, report.md, report.html and specs/<finding.spec.filename> into dir. Secrets redacted everywhere.
 * Spec filenames are reduced to a safe base name, so nothing is written outside dir/specs.
 */
export async function writeReport(report: Report, dir: string): Promise<void> {
  const safe = redactReport(report);

  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "report.json"), `${JSON.stringify(safe, null, 2)}\n`);
  await writeFile(join(dir, "report.md"), renderMarkdown(safe));
  await writeFile(join(dir, "report.html"), renderHtml(safe));

  const specs = safe.findings.filter((f) => f.spec);
  if (specs.length === 0) return;
  await mkdir(join(dir, "specs"), { recursive: true });
  for (const f of specs) await writeFile(join(dir, "specs", f.spec!.filename), f.spec!.source);
}
