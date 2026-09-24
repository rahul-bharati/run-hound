import { mkdir, writeFile } from "node:fs/promises";
import { basename, join, posix } from "node:path";
import { BRAND, FONT_MONO, FONT_SANS, MARK_DATA_URI } from "../core/brand.js";
import { formatDuration } from "../core/format.js";
import { CHECK_GROUPS, CHECK_IDS, type CheckResult, type Evidence, type Finding, type Report, type ReportGroup, type Severity } from "../core/types.js";
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
  durationMs: number;
}

function scenarioLines(report: Report): ScenarioLine[] {
  return report.results.map((r) => ({
    id: r.scenarioId,
    checkId: r.checkId,
    title: report.plan.scenarios.find((s) => s.id === r.scenarioId)?.title ?? r.scenarioId,
    status: r.status,
    notes: r.notes,
    findings: r.findings.length,
    durationMs: r.durationMs,
  }));
}

/** formatDuration that tolerates a missing or bad value (reports written before durations existed). */
function duration(ms: number | undefined): string | null {
  return typeof ms === "number" && Number.isFinite(ms) && ms >= 0 ? formatDuration(ms) : null;
}

/** "Finished in 1 min 12 s", or null for a report without a run duration. */
export function finishedIn(report: Report): string | null {
  const d = duration(report.durationMs);
  return d ? `Finished in ${d}` : null;
}

/** The label of the group a finding's category belongs to ("Accessibility"), or null for an unknown category. */
export function findingGroupLabel(f: Finding): string | null {
  return CHECK_GROUPS.find((g) => g.categories.includes(f.category))?.label ?? null;
}

/**
 * The scenarios that ran, under their groups (report.groups order). A report written before groups existed gets one
 * unlabelled group holding every result.
 */
function groupedLines(report: Report): { group: ReportGroup | null; lines: ScenarioLine[] }[] {
  const lines = scenarioLines(report);
  const groups = report.groups ?? [];
  if (groups.length === 0) return lines.length ? [{ group: null, lines }] : [];
  const out: { group: ReportGroup | null; lines: ScenarioLine[] }[] = groups.map((group) => ({ group, lines: group.scenarioIds.flatMap((id) => lines.filter((l) => l.id === id)) }));
  // Results no group lists (should not happen) still show up.
  const listed = new Set(groups.flatMap((g) => g.scenarioIds));
  const rest = lines.filter((l) => !listed.has(l.id));
  if (rest.length) out.push({ group: null, lines: rest });
  return out;
}

/** "2 scenarios · 1 finding · 3.7 s" for a group heading. */
function groupSummary(g: ReportGroup): string {
  return [scenarioCount(g.scenarioIds.length), `${g.findings} ${g.findings === 1 ? "finding" : "findings"}`, duration(g.durationMs)]
    .filter(Boolean)
    .join(" · ");
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
  const finished = finishedIn(report);
  const lines: string[] = [
    `# Run Hound report`,
    "",
    `- Target: ${report.target}`,
    `- Run: ${report.runId} (${report.startedAt} to ${report.finishedAt})${finished ? ` · ${finished}` : ""}`,
    `- Run Hound ${report.runHoundVersion}`,
    "",
    "## Summary",
    "",
    ...(finished ? [`${finished}.`, ""] : []),
    "Findings by severity, and scenarios by result.",
    "",
    `| Critical | High | Medium | Low | Scenarios passed | Scenarios failed | Scenarios errored | Scenarios skipped |`,
    `|---|---|---|---|---|---|---|---|`,
    `| ${s.critical} | ${s.high} | ${s.medium} | ${s.low} | ${s.passed} | ${s.failed} | ${s.errored} | ${s.skipped} |`,
    "",
    `${report.approved.length} of ${report.plan.scenarios.length} planned scenarios were approved and run. ${findingCounts(report.findings)}; advisory findings rely on judgement and don't fail the run.`,
    "",
    ...groupTableMarkdown(report),
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
      const label = findingGroupLabel(f);
      lines.push(`- ${label ? `Group: ${label} · ` : ""}Check: ${f.checkId} · severity: ${f.severity} · confidence: ${f.confidence}`);
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
  const grouped = groupedLines(report);
  if (grouped.length === 0) lines.push("None.", "");
  for (const { group, lines: ran } of grouped) {
    if (group) lines.push(`### ${group.label} (${groupSummary(group)})`, "");
    else if (grouped.length > 1) lines.push("### Other", "");
    for (const r of ran) {
      const found = r.findings ? ` (${r.findings} ${r.findings === 1 ? "finding" : "findings"})` : "";
      const took = duration(r.durationMs);
      lines.push(
        `- ${STATUS_WORD[r.status]}${found}: ${oneLine(r.title)}${took ? ` · ${took}` : ""} · ${r.checkId} · ${r.id}${r.notes ? `\n  - ${oneLine(r.notes)}` : ""}`,
      );
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

/** Per-group summary table (Markdown lines), or nothing for a report without groups. */
function groupTableMarkdown(report: Report): string[] {
  const groups = report.groups ?? [];
  if (groups.length === 0) return [];
  return [
    "By group:",
    "",
    "| Group | Scenarios | Passed | Failed | Errored | Skipped | Findings | Time |",
    "|---|---|---|---|---|---|---|---|",
    ...groups.map(
      (g) =>
        `| ${g.label} | ${g.scenarioIds.length} | ${g.passed} | ${g.failed} | ${g.errored} | ${g.skipped} | ${g.findings} | ${duration(g.durationMs) ?? "-"} |`,
    ),
    "",
  ];
}

/** Per-group summary table (HTML), or "" for a report without groups. */
function groupTableHtml(report: Report): string {
  const groups = report.groups ?? [];
  if (groups.length === 0) return "";
  const head = ["Group", "Scenarios", "Passed", "Failed", "Errored", "Skipped", "Findings", "Time"].map((h) => `<th scope="col">${h}</th>`).join("");
  const rows = groups
    .map(
      (g) =>
        `<tr><th scope="row">${esc(g.label)}</th><td>${g.scenarioIds.length}</td><td>${g.passed}</td><td>${g.failed}</td><td>${g.errored}</td><td>${g.skipped}</td><td>${g.findings}</td><td>${esc(duration(g.durationMs) ?? "-")}</td></tr>`,
    )
    .join("");
  return `<table class="groups"><caption>By group</caption><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
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
<p class="meta">${findingGroupLabel(f) ? `${esc(findingGroupLabel(f)!)} · ` : ""}${esc(f.checkId)} · <span class="sev">${esc(f.severity)}</span> · ${esc(f.confidence)}${places.length === 1 ? ` · ${esc(places[0]!)}` : ""}</p>
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
    return group.length ? `<h2>${esc(severity[0]!.toUpperCase() + severity.slice(1))} (${group.length})</h2>${group.map(findingHtml).join("\n")}` : "";
  }).join("\n");
  const pages = pagesTested(report);
  const pagesHtml = !pages
    ? '<p class="muted">Not recorded for this run.</p>'
    : pages.length === 0
      ? "<p>No pages were loaded.</p>"
      : `<ul>${pages.map((p) => `<li><code>${esc(p.url)}</code> · ${scenarioCount(p.count)}</li>`).join("")}</ul>`;
  const cell = (label: string, n: number, tone = "") => `<div class="stat${tone ? ` ${tone}` : ""}"><span class="n">${n}</span><span>${esc(label)}</span></div>`;
  const clean = report.findings.length === 0 && s.failed === 0 && s.errored === 0;
  const grouped = groupedLines(report);
  const scenarioList = (ran: ScenarioLine[]) =>
    `<ul class="scenarios">${ran
      .map((r) => {
        const took = duration(r.durationMs);
        return `<li><span class="st st-${esc(r.status)}">${esc(STATUS_WORD[r.status])}</span> ${esc(r.title)}${r.findings ? ` (${r.findings} ${r.findings === 1 ? "finding" : "findings"})` : ""}${
          took ? ` <span class="dur">· ${esc(took)}</span>` : ""
        } <span class="muted">· ${esc(r.checkId)} · ${esc(r.id)}</span>${r.notes ? `<br><span class="muted">${esc(r.notes)}</span>` : ""}</li>`;
      })
      .join("")}</ul>`;
  const scenariosHtml = grouped.length
    ? grouped
        .map(({ group, lines }) =>
          group
            ? `<h3>${esc(group.label)} <span class="muted">(${esc(groupSummary(group))})</span></h3>${scenarioList(lines)}`
            : `${grouped.length > 1 ? "<h3>Other</h3>" : ""}${scenarioList(lines)}`,
        )
        .join("\n")
    : "<p>None.</p>";
  const finished = finishedIn(report);
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
:root { --bg:${BRAND.bg}; --bg-deep:${BRAND.bgDeep}; --surface:${BRAND.surface}; --surface-2:${BRAND.surface2}; --surface-3:${BRAND.surface3};
  --line:${BRAND.line}; --line-soft:${BRAND.lineSoft}; --line-strong:${BRAND.lineStrong}; --fg:${BRAND.fg}; --muted:${BRAND.muted}; --dim:${BRAND.dim};
  --accent:${BRAND.accent}; --accent-strong:${BRAND.accentStrong}; --accent-ink:${BRAND.accentInk}; --fail:${BRAND.fail}; --warn:${BRAND.warn};
  --sans:${FONT_SANS}; --mono:${FONT_MONO}; color-scheme: dark; }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--fg); font:16px/1.55 var(--sans); -webkit-font-smoothing: antialiased; }
.topbar { background:var(--bg-deep); border-bottom:1px solid var(--line); }
.topbar-in { max-width: 64rem; margin:0 auto; padding:.75rem 1rem; display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:.5rem 1rem; }
.brand { display:inline-flex; align-items:center; gap:.6rem; font-weight:800; font-size:1.1rem; letter-spacing:-.02em; color:var(--fg); }
.brand img { display:block; width:40px; height:23px; }
.eyebrow { font:600 .72rem/1.4 var(--mono); letter-spacing:.14em; text-transform:uppercase; color:var(--dim); }
main { max-width: 64rem; margin: 0 auto; padding: 1.75rem 1rem 3rem; }
.hero { display:flex; gap:1rem; align-items:flex-start; margin-bottom:1.5rem; }
.ring-big { flex:none; width:3.25rem; height:3.25rem; border-radius:50%; display:grid; place-items:center; border:3px solid var(--accent); color:var(--accent); font:800 1.4rem/1 var(--sans); }
.ring-big.bad { border-color:var(--fail); color:var(--fail); }
h1 { margin:.1rem 0 .2rem; font-size:clamp(1.6rem, 4vw, 2.2rem); line-height:1.1; font-weight:800; letter-spacing:-.03em; }
h1 .accent { color:var(--accent); }
.target { margin:0; font:.9rem/1.5 var(--mono); color:var(--muted); overflow-wrap:anywhere; }
.runmeta { margin:.35rem 0 0; color:var(--muted); font-size:.95rem; }
section { background:var(--surface); border:1px solid var(--line); border-radius:14px; padding:1rem 1.25rem 1.1rem; margin:1rem 0; overflow-x:auto; }
h2 { margin:0 0 .75rem; font-size:1.15rem; font-weight:800; letter-spacing:-.02em; }
section[aria-labelledby="findings"] h2:not(#findings) { font:600 .75rem/1.4 var(--mono); letter-spacing:.14em; text-transform:uppercase; color:var(--dim); margin:1.25rem 0 .5rem; }
h3 { font-size:1rem; margin:1rem 0 .4rem; }
.muted, .meta, dt { color: var(--muted); }
a { color: var(--accent); text-underline-offset: 3px; }
a:hover { color: var(--accent-strong); }
a:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
.stats { display:grid; grid-template-columns:repeat(auto-fill, minmax(8.5rem, 1fr)); gap:.5rem; }
.stat { background:var(--surface-2); border:1px solid var(--line); padding:.6rem .8rem; border-radius:10px; display:flex; flex-direction:column; }
.stat .n { font:800 1.6rem/1.2 var(--sans); letter-spacing:-.02em; font-variant-numeric: tabular-nums; }
.stat > span:last-child { font:600 .7rem/1.4 var(--mono); letter-spacing:.1em; text-transform:uppercase; color:var(--dim); }
.stat.hot .n { color:var(--fail); }
.stat.warm .n { color:var(--warn); }
.stat.good .n { color:var(--accent); }
.finding { background:var(--surface-2); border:1px solid var(--line); border-left:4px solid var(--fail); border-radius:10px; padding:.85rem 1rem; margin:.75rem 0; }
.finding.sev-medium { border-left-color: var(--warn); }
.finding.sev-low { border-left-color: var(--dim); }
.finding h3 { margin:.1rem 0 .3rem; overflow-wrap:anywhere; }
.sev { font:700 .72rem/1 var(--mono); letter-spacing:.08em; text-transform:uppercase; padding:.2rem .45rem; border-radius:999px; border:1px solid currentColor; }
.sev-critical .sev, .sev-high .sev { color:var(--fail); }
.sev-medium .sev { color:var(--warn); }
.sev-low .sev { color:var(--muted); }
.finding dl { margin:.5rem 0 0; }
.finding dt { font:600 .7rem/1.4 var(--mono); letter-spacing:.1em; text-transform:uppercase; color:var(--dim); }
dd { margin: 0 0 .5rem; overflow-wrap:anywhere; }
pre, code { font-family: var(--mono); }
pre { white-space: pre-wrap; overflow-wrap: anywhere; background: var(--bg-deep); border:1px solid var(--line); padding: .6rem; border-radius: 8px; font-size: .85rem; }
summary { cursor:pointer; color:var(--accent); }
.pass { color: var(--accent); }
ul.scenarios { list-style:none; padding:0; margin:.25rem 0 .75rem; }
ul.scenarios li { margin: 0; padding:.45rem .1rem; border-bottom:1px solid var(--line-soft); overflow-wrap: anywhere; }
.st { display:inline-block; min-width:4.7rem; font:700 .72rem/1.6 var(--mono); letter-spacing:.06em; text-transform:uppercase; }
.st-pass { color: var(--accent); }
.st-fail, .st-error { color: var(--fail); }
.st-skipped { color: var(--muted); }
.figures { display:grid; gap:1rem; margin:.75rem 0; }
figure.evidence { margin:0; background:var(--bg-deep); border:1px solid var(--line); border-radius:10px; padding:.5rem; }
figure.evidence img { display:block; max-width:100%; height:auto; border-radius:6px; }
figcaption { color:var(--muted); font-size:.9rem; margin-top:.5rem; overflow-wrap:anywhere; }
figcaption strong { color:var(--fg); }
dl.facts { display:grid; grid-template-columns:max-content 1fr; gap:.25rem .75rem; margin:.5rem 0 0; font-size:.9rem; }
dl.facts dd { margin:0; font-family:var(--mono); }
code { overflow-wrap:anywhere; font-size:.9em; }
p.where { margin:.25rem 0 0; color:var(--muted); }
ul.where { margin:.25rem 0 .5rem; padding-left:1.2rem; overflow-wrap:anywhere; }
p.finished { font-weight:700; margin:0 0 .75rem; }
table.groups { border-collapse:collapse; margin:1rem 0 0; width:100%; font-variant-numeric:tabular-nums; }
table.groups caption { text-align:left; font:600 .72rem/1.4 var(--mono); letter-spacing:.14em; text-transform:uppercase; color:var(--dim); padding-bottom:.4rem; }
table.groups th, table.groups td { text-align:left; padding:.4rem .6rem; border-bottom:1px solid var(--line); white-space:nowrap; }
table.groups thead th { color:var(--muted); font-weight:600; font-size:.85rem; }
.dur { color:var(--muted); font-family:var(--mono); font-size:.9em; }
.visually-hidden { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; }
footer { max-width:64rem; margin:0 auto; padding:0 1rem 2.5rem; color:var(--dim); font-size:.85rem; }
@media (max-width: 30rem) { section { padding:.85rem .9rem; } .hero { gap:.75rem; } .ring-big { width:2.6rem; height:2.6rem; font-size:1.1rem; } }
</style>
</head>
<body>
<header class="topbar"><div class="topbar-in"><span class="brand"><img src="${MARK_DATA_URI}" alt="Run Hound" width="40" height="23"><span aria-hidden="true">Run Hound</span></span><span class="eyebrow">Run ${esc(report.runId)}</span></div></header>
<main>
<div class="hero"><span class="ring-big${clean ? "" : " bad"}" aria-hidden="true">${clean ? "✓" : "!"}</span><div>
<p class="eyebrow">Report · ${esc(report.startedAt)}</p>
<h1>Run Hound report</h1>
<p class="target"><span class="visually-hidden">Target: </span>${esc(report.target)}</p>
<p class="runmeta">${report.results.length} ${report.results.length === 1 ? "scenario" : "scenarios"} run · ${s.passed} passed · ${esc(findingCounts(report.findings))}</p>
</div></div>
<p class="muted">Run ${esc(report.runId)} · ${esc(report.startedAt)} to ${esc(report.finishedAt)}${finished ? ` · ${esc(finished)}` : ""} · Run Hound ${esc(report.runHoundVersion)}</p>
<section aria-labelledby="summary"><h2 id="summary">Summary</h2>${finished ? `<p class="finished">${esc(finished)}.</p>` : ""}<div class="stats">
${cell("critical", s.critical, s.critical ? "hot" : "")}${cell("high", s.high, s.high ? "hot" : "")}${cell("medium", s.medium, s.medium ? "warm" : "")}${cell("low", s.low)}${cell("scenarios passed", s.passed, s.passed ? "good" : "")}${cell("scenarios failed", s.failed, s.failed ? "hot" : "")}${cell("scenarios errored", s.errored, s.errored ? "hot" : "")}${cell("scenarios skipped", s.skipped)}
</div><p class="muted">${report.approved.length} of ${report.plan.scenarios.length} planned scenarios were approved and run. ${esc(findingCounts(report.findings))}; advisory findings rely on judgement and don't fail the run.</p>${groupTableHtml(report)}</section>
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
<footer>Run Hound ${esc(report.runHoundVersion)} · V0 tester preview · rule-based checks in a real browser, on local and private addresses only</footer>
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
