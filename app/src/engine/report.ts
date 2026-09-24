import { mkdir, writeFile } from "node:fs/promises";
import { basename, join, posix } from "node:path";
import { CHECK_IDS, type CheckResult, type Evidence, type Finding, type Report, type Severity } from "../core/types.js";
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

/** One line per scenario that ran: its status, check, title and the check's note (why it errored or was skipped, what it verified). */
interface ScenarioLine {
  id: string;
  checkId: string;
  title: string;
  status: CheckResult["status"];
  notes: string | undefined;
  findings: number;
}

function scenarioLines(report: Report): ScenarioLine[] {
  return report.results.map((r) => ({
    id: r.scenarioId,
    checkId: r.checkId,
    title: report.plan.scenarios.find((s) => s.id === r.scenarioId)?.title ?? r.scenarioId,
    status: r.status,
    notes: r.notes,
    findings: r.findings.length,
  }));
}

/** Planned scenarios the user did not approve, so a partial run never looks like a full one. */
function notApproved(report: Report): { id: string; checkId: string; title: string }[] {
  const approved = new Set(report.approved);
  return report.plan.scenarios.filter((s) => !approved.has(s.id)).map((s) => ({ id: s.id, checkId: s.checkId, title: s.title }));
}

/** V0 checks that proposed nothing for this form (e.g. no password field for credential-fields). */
function notPlanned(report: Report): string[] {
  const planned = new Set(report.plan.scenarios.map((s) => s.checkId));
  return CHECK_IDS.filter((id) => !planned.has(id));
}

/** "checkId: note (scenario id)" for each errored or skipped result of a check, so the reason is in every format. */
function reasons(report: Report, status: CheckResult["status"]): string[] {
  return report.results
    .filter((r) => r.status === status)
    .map((r) => `${r.checkId}: ${r.notes ? oneLine(r.notes) : "no reason recorded"} (${r.scenarioId})`);
}

const STATUS_WORD: Record<CheckResult["status"], string> = { pass: "passed", fail: "failed", error: "errored", skipped: "skipped" };

/** Passed/failed/... check ids, each listed once, in result order. */
function checksByStatus(results: CheckResult[], status: CheckResult["status"]): string[] {
  const byCheck = new Map<string, CheckResult["status"][]>();
  for (const r of results) byCheck.set(r.checkId, [...(byCheck.get(r.checkId) ?? []), r.status]);
  const overall = (s: CheckResult["status"][]) =>
    s.includes("fail") ? "fail" : s.includes("error") ? "error" : s.every((x) => x === "skipped") ? "skipped" : "pass";
  return [...byCheck].filter(([, s]) => overall(s) === status).map(([id]) => id);
}

/** Evidence a person can look at: shown inline as an image with its caption and facts. */
const VISUAL_KINDS = new Set<Evidence["kind"]>(["frame", "gif", "card", "screenshot"]);

function isVisual(e: Evidence): boolean {
  return VISUAL_KINDS.has(e.kind);
}

/**
 * The href/src for an evidence file under artifacts/, or undefined when the path is unsafe: absolute, a URL
 * (scheme), a Windows path, or one that leaves the artifacts folder after normalising "..". Each segment is URL-encoded.
 */
export function artifactHref(path: string | undefined): string | undefined {
  if (!path || path.includes("\\") || path.includes(":") || path.startsWith("/")) return undefined;
  const normal = posix.normalize(path);
  if (normal === "." || normal === ".." || normal.startsWith("../") || normal.startsWith("/")) return undefined;
  const encoded = normal
    .split("/")
    .map((segment) => encodeURIComponent(segment).replace(/\(/g, "%28").replace(/\)/g, "%29"))
    .join("/");
  return `artifacts/${encoded}`;
}

/** Alt text: the label plus the step, e.g. "Book button after double-click (step: Double-click Book)". */
function altText(e: Evidence): string {
  return e.step ? `${e.label} (step: ${e.step})` : e.label;
}

/** Step, page URL and capture time, in that order, skipping the ones the evidence doesn't have. */
function captionParts(e: Evidence): string[] {
  const parts: string[] = [];
  if (e.step) parts.push(`Step: ${e.step}`);
  if (e.url) parts.push(`Page: ${e.url}`);
  if (e.capturedAt) parts.push(`Captured: ${e.capturedAt}`);
  if (e.kind === "gif" && e.frames) parts.push(`${e.frames} frames${e.durationMs ? `, ${(e.durationMs / 1000).toFixed(1)} s` : ""}`);
  return parts;
}

/** Collapses whitespace so a value can't break a markdown list item. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function evidenceLine(e: Evidence): string {
  const parts = [`${e.kind}: ${oneLine(e.label)}`];
  const href = artifactHref(e.path);
  if (href) parts.push(`(${href})`);
  if (e.data !== undefined) {
    const json = JSON.stringify(e.data);
    parts.push(json.length > 300 ? `${json.slice(0, 300)}…` : json);
  }
  return parts.join(" ");
}

/** Markdown lines (indented under a list item) for a frame, GIF or card: the image link, caption and facts. */
function visualEvidenceMarkdown(e: Evidence): string[] {
  const lines = [`  - ${e.kind}: ${oneLine(e.label)}`];
  const href = artifactHref(e.path);
  if (href) lines.push(`    ![${oneLine(altText(e)).replace(/[[\]]/g, "\\$&")}](${href})`);
  const caption = captionParts(e);
  if (caption.length) lines.push(`    - ${oneLine(caption.join(" · "))}`);
  for (const fact of e.facts ?? []) lines.push(`    - ${oneLine(fact.label)}: ${oneLine(fact.value)}`);
  if (e.data !== undefined) {
    const json = JSON.stringify(e.data);
    lines.push(`    - Data: ${json.length > 300 ? `${json.slice(0, 300)}…` : json}`);
  }
  return lines;
}

/** Each visited page with how many scenarios loaded it; undefined when the report predates pagesVisited. */
function pagesTested(report: Report): { url: string; count: number }[] | undefined {
  return report.pagesVisited?.map((p) => ({ url: p.url, count: new Set(p.scenarioIds).size }));
}

/** Every place a finding is about: its locations, else its single location. */
export function findingPlaces(f: Finding): string[] {
  if (f.locations && f.locations.length > 0) return f.locations;
  return f.location ? [f.location] : [];
}

/**
 * One sentence on the test data the run left behind, e.g. "This run sent 2 save requests that your app accepted, so
 * it may have created 2 test records. Run Hound does not delete them." Null for reports written before the count existed.
 */
export function testDataSentence(report: Report): string | null {
  const n = report.testRecordsCreated;
  if (n === undefined) return null;
  if (n === 0) return "This run sent no save requests that your app accepted, so it created no test records.";
  return `This run sent ${n} save ${n === 1 ? "request" : "requests"} that your app accepted, so it may have created ${n} test ${
    n === 1 ? "record" : "records"
  } (fewer if your app merges repeats). Run Hound does not delete them; they hold made-up values (emails end in @example.test).`;
}

/** "3 findings (2 confirmed, 1 advisory)". */
export function findingCounts(findings: Finding[]): string {
  const confirmed = findings.filter((f) => f.confidence === "confirmed").length;
  const advisory = findings.length - confirmed;
  return `${findings.length} ${findings.length === 1 ? "finding" : "findings"} (${confirmed} confirmed, ${advisory} advisory)`;
}

function scenarioCount(n: number): string {
  return `${n} ${n === 1 ? "scenario" : "scenarios"}`;
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
    "Findings by severity, and scenarios by result.",
    "",
    `| Critical | High | Medium | Low | Scenarios passed | Scenarios failed | Scenarios errored | Scenarios skipped |`,
    `|---|---|---|---|---|---|---|---|`,
    `| ${s.critical} | ${s.high} | ${s.medium} | ${s.low} | ${s.passed} | ${s.failed} | ${s.errored} | ${s.skipped} |`,
    "",
    `${report.approved.length} of ${report.plan.scenarios.length} planned scenarios were approved and run. ${findingCounts(report.findings)}; advisory findings rely on judgement and don't fail the run.`,
    "",
    "## Test data",
    "",
    testDataSentence(report) ?? "Not recorded for this run.",
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
      const places = findingPlaces(f);
      if (places.length === 1) lines.push(`- Where: ${oneLine(places[0]!)}`);
      else if (places.length > 1) lines.push(`- Where (${places.length} places):`, ...places.map((p) => `  - ${oneLine(p)}`));
      lines.push(`- What it means: ${f.meaning}`, `- Impact: ${f.impact}`, `- Fix: ${f.fix}`);
      if (f.spec) lines.push(`- Reproduce: specs/${safeSpecFilename(f.spec.filename)}`);
      if (f.evidence.length > 0) {
        lines.push("- Evidence:");
        for (const e of f.evidence) {
          if (isVisual(e)) lines.push(...visualEvidenceMarkdown(e));
          else lines.push(`  - ${evidenceLine(e)}`);
        }
      }
      lines.push("");
    }
  }

  const section = (title: string, ids: string[]) => {
    if (ids.length === 0) return;
    lines.push(`## ${title}`, "", ...ids.map((id) => `- ${id}`), "");
  };
  const pages = pagesTested(report);
  lines.push("## Pages tested", "");
  if (!pages) lines.push("Not recorded for this run.", "");
  else if (pages.length === 0) lines.push("No pages were loaded.", "");
  else lines.push(...pages.map((p) => `- ${oneLine(p.url)} (${scenarioCount(p.count)})`), "");

  lines.push("## Scenarios run", "");
  const ran = scenarioLines(report);
  if (ran.length === 0) lines.push("None.", "");
  else {
    for (const r of ran) {
      const found = r.findings ? ` (${r.findings} ${r.findings === 1 ? "finding" : "findings"})` : "";
      lines.push(`- ${STATUS_WORD[r.status]}${found}: ${oneLine(r.title)} · ${r.checkId} · ${r.id}${r.notes ? `\n  - ${oneLine(r.notes)}` : ""}`);
    }
    lines.push("");
  }
  const skippedByUser = notApproved(report);
  if (skippedByUser.length) {
    lines.push("## Planned but not approved (not run)", "", ...skippedByUser.map((n) => `- ${oneLine(n.title)} · ${n.checkId} · ${n.id}`), "");
  }
  section("Checks with nothing to test on this form", notPlanned(report));

  section("Passed checks", checksByStatus(report.results, "pass"));
  section("Checks that errored", reasons(report, "error"));
  section("Skipped checks", reasons(report, "skipped"));

  lines.push("## What a browser can't see", "", ...report.notVisible.map((item) => `- ${item}`), "");
  return lines.join("\n");
}

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** A frame, GIF or card as a <figure>: the image (when its file is safe to reference), a caption and the facts. */
function figureHtml(e: Evidence): string {
  const href = artifactHref(e.path);
  const img = href
    ? `<a href="${esc(href)}"><img src="${esc(href)}" alt="${esc(altText(e))}" loading="lazy"></a>`
    : `<p class="muted">Image not available${e.path ? " (unsafe path withheld)" : ""}.</p>`;
  const caption = captionParts(e);
  const facts = e.facts?.length
    ? `<dl class="facts">${e.facts.map((fact) => `<dt>${esc(fact.label)}</dt><dd>${esc(fact.value)}</dd>`).join("")}</dl>`
    : "";
  return `<figure class="evidence ev-${esc(e.kind)}">${img}<figcaption><strong>${esc(e.label)}</strong>${
    caption.length ? `<br>${caption.map(esc).join(" · ")}` : ""
  }</figcaption>${facts}</figure>`;
}

/** Non-visual evidence (and any raw data behind visual evidence) as a list item for the <details> block. */
function evidenceItemHtml(e: Evidence): string {
  const href = artifactHref(e.path);
  const link = href && !isVisual(e) ? ` <a href="${esc(href)}">${esc(e.path!)}</a>` : "";
  const data = e.data !== undefined ? `<pre>${esc(JSON.stringify(e.data, null, 2))}</pre>` : "";
  return `<li><strong>${esc(e.kind)}</strong>: ${esc(e.label)}${link}${data}</li>`;
}

function findingHtml(f: Finding): string {
  const places = findingPlaces(f);
  const visual = f.evidence.filter(isVisual);
  const other = f.evidence.filter((e) => !isVisual(e) || e.data !== undefined);
  const figures = visual.length ? `<div class="figures">${visual.map(figureHtml).join("\n")}</div>` : "";
  const details = other.length
    ? `<details><summary>${visual.length ? "Data behind the evidence" : "Evidence"} (${other.length})</summary><ul>${other
        .map(evidenceItemHtml)
        .join("")}</ul></details>`
    : "";
  const spec = f.spec
    ? `<p>Reproduce: <a href="specs/${esc(encodeURIComponent(safeSpecFilename(f.spec.filename)))}">${esc(safeSpecFilename(f.spec.filename))}</a></p>`
    : "";
  return `<article class="finding sev-${esc(f.severity)}">
<h3>${esc(f.title)}</h3>
<p class="meta">${esc(f.checkId)} · <span class="sev">${esc(f.severity)}</span> · ${esc(f.confidence)}${places.length === 1 ? ` · ${esc(places[0]!)}` : ""}</p>
${places.length > 1 ? `<p class="where">Where (${places.length} places):</p><ul class="where">${places.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : ""}
<dl><dt>What it means</dt><dd>${esc(f.meaning)}</dd><dt>Impact</dt><dd>${esc(f.impact)}</dd><dt>Fix</dt><dd>${esc(f.fix)}</dd></dl>
${spec}${figures}${details}
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
  const pages = pagesTested(report);
  const pagesHtml = !pages
    ? '<p class="muted">Not recorded for this run.</p>'
    : pages.length === 0
      ? "<p>No pages were loaded.</p>"
      : `<ul>${pages.map((p) => `<li><code>${esc(p.url)}</code> · ${scenarioCount(p.count)}</li>`).join("")}</ul>`;
  const cell = (label: string, n: number) => `<div class="stat"><span class="n">${n}</span><span>${esc(label)}</span></div>`;
  const ran = scenarioLines(report);
  const scenariosHtml = ran.length
    ? `<ul class="scenarios">${ran
        .map(
          (r) =>
            `<li><span class="st st-${esc(r.status)}">${esc(STATUS_WORD[r.status])}</span> ${esc(r.title)}${r.findings ? ` (${r.findings} ${r.findings === 1 ? "finding" : "findings"})` : ""} <span class="muted">· ${esc(r.checkId)} · ${esc(r.id)}</span>${
              r.notes ? `<br><span class="muted">${esc(r.notes)}</span>` : ""
            }</li>`,
        )
        .join("")}</ul>`
    : "<p>None.</p>";
  const unapproved = notApproved(report);
  const unapprovedHtml = unapproved.length
    ? `<section aria-labelledby="not-approved"><h2 id="not-approved">Planned but not approved (not run)</h2><ul>${unapproved
        .map((n) => `<li>${esc(n.title)} <span class="muted">· ${esc(n.checkId)} · ${esc(n.id)}</span></li>`)
        .join("")}</ul></section>`
    : "";
  const unplanned = notPlanned(report);
  const unplannedHtml = unplanned.length
    ? `<section aria-labelledby="not-planned"><h2 id="not-planned">Checks with nothing to test on this form</h2>${list(unplanned)}</section>`
    : "";

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
ul.scenarios { padding-left: 1.2rem; }
ul.scenarios li { margin: .3rem 0; overflow-wrap: anywhere; }
.st { font-weight: 700; }
.st-pass { color: var(--pass); }
.st-fail, .st-error { color: var(--fail); }
.st-skipped { color: var(--amber); }
.figures { display:grid; gap:1rem; margin:.75rem 0; }
figure.evidence { margin:0; background:var(--bg); border-radius:6px; padding:.5rem; }
figure.evidence img { display:block; max-width:100%; height:auto; border-radius:4px; }
figcaption { color:var(--muted); font-size:.9rem; margin-top:.5rem; overflow-wrap:anywhere; }
figcaption strong { color:var(--text); }
dl.facts { display:grid; grid-template-columns:max-content 1fr; gap:.25rem .75rem; margin:.5rem 0 0; font-size:.9rem; }
dl.facts dd { margin:0; }
code { overflow-wrap:anywhere; }
p.where { margin:.25rem 0 0; color:var(--muted); }
ul.where { margin:.25rem 0 .5rem; padding-left:1.2rem; overflow-wrap:anywhere; }
</style>
</head>
<body>
<main>
<h1>Run Hound report</h1>
<p class="muted">Target: ${esc(report.target)}<br>Run ${esc(report.runId)} · ${esc(report.startedAt)} to ${esc(report.finishedAt)} · Run Hound ${esc(report.runHoundVersion)}</p>
<section aria-labelledby="summary"><h2 id="summary">Summary</h2><div class="stats">
${cell("critical", s.critical)}${cell("high", s.high)}${cell("medium", s.medium)}${cell("low", s.low)}${cell("scenarios passed", s.passed)}${cell("scenarios failed", s.failed)}${cell("scenarios errored", s.errored)}${cell("scenarios skipped", s.skipped)}
</div><p class="muted">${report.approved.length} of ${report.plan.scenarios.length} planned scenarios were approved and run. ${esc(findingCounts(report.findings))}; advisory findings rely on judgement and don't fail the run.</p></section>
<section aria-labelledby="test-data"><h2 id="test-data">Test data</h2><p>${esc(testDataSentence(report) ?? "Not recorded for this run.")}</p></section>
<section aria-labelledby="findings"><h2 id="findings">Findings</h2>
${report.findings.length ? findings : '<p class="pass">No findings in the scenarios that ran.</p>'}
</section>
<section aria-labelledby="pages"><h2 id="pages">Pages tested</h2>${pagesHtml}</section>
<section aria-labelledby="scenarios-run"><h2 id="scenarios-run">Scenarios run</h2>${scenariosHtml}</section>
${unapprovedHtml}${unplannedHtml}
<section aria-labelledby="passed"><h2 id="passed">Passed checks</h2>${list(checksByStatus(report.results, "pass"))}</section>
<section aria-labelledby="errored"><h2 id="errored">Checks that errored</h2>${list(reasons(report, "error"))}</section>
<section aria-labelledby="skipped"><h2 id="skipped">Skipped checks</h2>${list(reasons(report, "skipped"))}</section>
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
