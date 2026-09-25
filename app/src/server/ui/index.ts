import { MARK_DATA_URI } from "../../core/brand.js";
import { CHECK_GROUPS, V1_CHECK_IDS } from "../../core/types.js";
import { CLIENT } from "./client.js";
import { ICONS } from "./icons.js";
import { STYLES } from "./styles.js";

/**
 * The local web UI: one self-contained HTML document (inline CSS, inline JS, embedded hound mark; no network requests
 * besides Run Hound's own /api/* calls), following docs/app-ui-spec.md and the mockup shell.
 *
 * Structure the tests rely on:
 * - <aside id="sidebar"> with the mark, the "Run Hound" wordmark, and a <nav aria-label="Main"> holding links
 *   href="#/new" (New Run), "#/runs" (Runs) and "#/settings" (Settings); the current one has aria-current="page".
 *   A footer card shows "Local · this machine" and the version.
 * - <main id="view">, whose content is rendered by the client script for the current hash route:
 *     #/new           New Run: an <ol id="stepper"> with Target, Plan, Run, Report (current step aria-current="step"),
 *                      the URL form (#target-form, input #target-url labelled "Page URL", button #plan-button), then
 *                      #plan-section: the grouped plan in #scenarios (one heading per group with its count, a
 *                      "Select all <Group>" checkbox, scenario checkboxes whose value is the scenario id), options
 *                      #allow-destructive ("Allow destructive scenarios") and #headed ("Show the browser window"), and
 *                      #run-button "Start run (N scenarios)". #/new?from=<runId> plans that run's target again with its
 *                      scenarios selected ("Back to test plan").
 *     #/runs          Runs list (#runs-list): one link per run, href="#/runs/<id>", newest first.
 *     #/runs/<id>     Running view while running (#running: "Running tests…", #counter "3 / 15", #elapsed (mm:ss, not a
 *                      live region) in the elapsed card, #browser-card, <ol id="scenario-list"> numbered rows with
 *                      data-scenario-id and data-status, the running scenario expanded with its sub-steps, a "Stop run"
 *                      button, #browser-preview with #address and a Live badge, #activity with one <li> per step
 *                      starting hh:mm:ss and an "<n> steps" count); Report view when done (#report: "Test run complete"
 *                      / "Run stopped" / "Run failed", summary line, "Re-run", "Open HTML report", Download, tabs
 *                      All/Passed/Issues(/Skipped) as role="tab", rows in #results with data-scenario-id and
 *                      aria-current="true" on the selected one, #detail made of <section>s named by headings: evidence
 *                      viewer (main image + thumbnail strip, served from /api/runs/<id>/artifacts/), "Reproduction steps",
 *                      "Key facts", "Why it matters", "What to ask your AI", "Generated Playwright test" with a Copy button;
 *                      then a "Results by group" table, "Pages tested" and "Not visible from outside").
 *     #/settings      Defaults (saved in localStorage) and read-only settings from GET /api/settings.
 * - Unknown hashes fall back to #/new; the old "#run=<id>" links open #/runs/<id>. Everything works at 360 px (the
 *   sidebar becomes a top bar with a "Menu" button).
 * - One polite live region (#announcer) announces scenario and group changes and the end of a run; nothing else is live.
 */
export interface UiOptions {
  version: string;
  /** False when the machine has no display: "Show the browser window" is disabled with an explanation. */
  canShowBrowser: boolean;
}

const HEADED_DESC = {
  on: "Opens a visible Chromium window on the machine running Run Hound. The live preview works either way.",
  off: "Not available here: the machine running Run Hound has no display (as in a container). The live preview shows the page under test.",
};

/** JSON for an inline <script type="application/json">: "<" escaped so the text can never close the element. */
function inlineJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

export function renderUi(options: UiOptions): string {
  const version = options.version.replace(/[^\w.+-]/g, "");
  const headedAttrs = options.canShowBrowser ? "" : " disabled";
  const headedDesc = options.canShowBrowser ? HEADED_DESC.on : HEADED_DESC.off;
  const config = inlineJson({
    version,
    canShowBrowser: options.canShowBrowser,
    headedDesc,
    groups: CHECK_GROUPS.map((g) => ({ id: g.id, label: g.label, categories: g.categories })),
    v1Checks: V1_CHECK_IDS,
    icons: ICONS,
  });

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>Run Hound</title>
<link rel="icon" href="${MARK_DATA_URI}">
<style>${STYLES}</style>
</head>
<body>
<div class="shell">
<aside id="sidebar" aria-label="Sidebar">
<div class="side-top">
<div class="brand"><img src="${MARK_DATA_URI}" alt="Run Hound" width="44" height="25"><span aria-hidden="true">Run Hound</span></div>
<button id="menu-button" type="button" aria-expanded="false" aria-controls="main-nav"><span class="ic" aria-hidden="true">${ICONS.menu}</span><span>Menu</span></button>
</div>
<nav id="main-nav" aria-label="Main">
<ul>
<li><a href="#/new"><span class="ic" aria-hidden="true">${ICONS.play}</span><span>New Run</span></a></li>
<li><a href="#/runs"><span class="ic" aria-hidden="true">${ICONS.list}</span><span>Runs</span></a></li>
<li><a href="#/settings"><span class="ic" aria-hidden="true">${ICONS.gear}</span><span>Settings</span></a></li>
</ul>
</nav>
<footer class="side-foot"><span class="dot" aria-hidden="true"></span><div><b>Local · this machine</b><span>Run Hound ${version}</span><span>V1 tester preview</span></div></footer>
</aside>
<main id="view" tabindex="-1"></main>
</div>
<div id="announcer" class="visually-hidden" aria-live="polite" aria-atomic="true"></div>

<template id="tpl-new">
<div class="page">
<header class="page-head">
<h1>New run</h1>
<p>Point Run Hound at a page of an app running on this machine. It finds every form and control on the page, plans checks for each form and for the page as a whole, you choose which to run, and it runs them in a real browser with evidence for every finding.</p>
</header>
<ol id="stepper" aria-label="New run steps">
<li data-step="1"><span class="num" aria-hidden="true">1</span><span>Target</span></li>
<li data-step="2"><span class="num" aria-hidden="true">2</span><span>Plan</span></li>
<li data-step="3"><span class="num" aria-hidden="true">3</span><span>Run</span></li>
<li data-step="4"><span class="num" aria-hidden="true">4</span><span>Report</span></li>
</ol>
<section class="card" id="target-section" aria-labelledby="target-h">
<h2 id="target-h" class="card-title">Target</h2>
<form id="target-form" novalidate>
<label class="field-label" for="target-url">Page URL</label>
<div class="url-row">
<input class="input" id="target-url" name="url" type="url" required placeholder="http://localhost:5173/signup" autocomplete="url" spellcheck="false" aria-describedby="target-error target-hint">
<button class="btn primary" id="plan-button" type="submit">Plan checks</button>
</div>
<p class="error" id="target-error"></p>
<p class="field-hint" id="target-hint">Use localhost or a private network address. Add other hosts you own with RUNHOUND_ALLOWED_HOSTS.</p>
</form>
</section>
<section class="card" id="plan-section" aria-labelledby="plan-h" hidden>
<div class="plan-head"><h2 id="plan-h" tabindex="-1">Plan</h2><p id="plan-summary"></p></div>
<ul id="page-inventory" class="inventory" aria-label="What Run Hound found on the page" hidden></ul>
<div id="plan-warnings" class="warning" hidden></div>
<form id="plan-form" novalidate>
<div id="scenarios"></div>
<div class="options">
<div class="option">
<input id="allow-destructive" type="checkbox">
<label for="allow-destructive">Allow destructive scenarios<span class="desc">They may change or delete data beyond creating test records. Leave off unless this is a throwaway environment.</span></label>
</div>
<div class="option">
<input id="headed" type="checkbox"${headedAttrs}>
<label for="headed">Show the browser window<span class="desc">${headedDesc}</span></label>
</div>
</div>
<div class="plan-actions"><p class="error" id="plan-error"></p><button class="btn primary" id="run-button" type="submit">Start run</button></div>
</form>
</section>
</div>
</template>

<script type="application/json" id="rh-config">${config}</script>
<script>${CLIENT}</script>
</body>
</html>
`;
}
