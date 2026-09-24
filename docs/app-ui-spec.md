# App UI spec: the mockup shell

The local web UI (`run-hound serve`, `app/src/server/app.ts`) follows the app shell in `site/assets/mockups/mockup-1.png` (a run in progress) and `mockup-2.png` (a finished run), in the brand from `docs/brand.md`. The goal is a clean, simple UI where the flow reads as clear steps.

**Rule:** every element on screen is real. Mockup elements V0 can't back with real data are either built for real (when small) or left out. Nothing is decorative data.

## Shell

- **Left sidebar** (`bg-deep`, full height): the hound mark and "RUN HOUND" wordmark; nav items **New Run**, **Runs**, **Settings**, with the active item highlighted as in the mockups (accent border and tint). At the bottom, instead of a user workspace: a small card "Local · this machine" with the version (`0.1.0`) and "Tester preview".
- **Main area:** the current view. Routing is client-side by URL hash (`#/new`, `#/runs`, `#/runs/<id>`, `#/settings`), so reload and back/forward work and links can be shared on the same machine.
- **Mockup items not built:** "Test Plans" (V0 doesn't save plans), user avatar and workspace (no accounts), Python export (TypeScript only).
- **Responsive:** at 900 px and below, the sidebar collapses to a top bar with the mark and a menu; everything works at 360 px without sideways scrolling.

## New Run (`#/new`)

A step indicator across the top: **1 Target → 2 Plan → 3 Run → 4 Report**, with the current step marked.

1. **Target:** a card with the page URL input and "Plan checks". Errors appear inline under the input.
2. **Plan:** "Found "Book a sitter" · 9 fields · 15 scenarios". Scenarios are grouped (Accessibility, Features, Security) with counts, a "Select all" checkbox per group, and one row per scenario (checkbox, title, golden/danger tag, one-line description, "creates N test records" when it does). Options: "Allow destructive scenarios" and "Show the browser window", whose defaults come from Settings. Primary button: "Start run (N scenarios)".

## Running (`#/runs/<id>` while running): mockup 1

- **Left column:**
  - "← Back to test plan" (returns to the plan of this run; disabled while running if the plan can't be edited);
  - title "Running tests…", with the target URL and form name underneath;
  - a counter "3 / 15" and a progress bar;
  - two cards: **Elapsed time** (mm:ss, ticking; not a live region) and **Browser** (the real browser name and version, e.g. "Chromium 153.0");
  - the **numbered scenario list**, grouped by Accessibility, Features and Security. Each row shows a status ring (done: accent check; failed: red "!"; running: accent ring; skipped: dim dash; queued: empty circle), the title and the duration.
  - The running scenario is **expanded**: a bordered accent card listing its live sub-steps (from `step` events) with check/ring icons, like mockup 1's "Fill full name / Fill email address / Fill password". Finished scenarios can be expanded to show their steps.
  - **Stop run** (danger outline button) at the bottom: stops for real (see API). Remaining scenarios become "skipped: stopped by you" and a report is still written.
- **Right column:**
  - **Browser preview:** an address bar with the current URL, a reload-style icon, a "Live" badge while frames arrive, and the latest screencast frame.
  - **Live activity:** a timestamped log (hh:mm:ss) of steps with a check (done) or ring (current), the step text and its duration, plus a count such as "8 steps".
  - Scenario and group changes are announced politely; individual frames and log lines are not.

## Report (`#/runs/<id>` when finished): mockup 2

- **Header:**
  - breadcrumb "Runs › <target host+path> › Run <id>", with the date and time on the right;
  - a large status ring: accent check when there are no confirmed findings, red "!" otherwise;
  - the title "Test run complete" (or "Run stopped" / "Run failed");
  - the summary line "15 scenarios run · 11 passed · 4 with issues · 38 s", counting skipped and errored when present.
- **Header buttons:** **Re-run** (accent outline: plans the same target again and pre-selects the same scenarios, then starts), **Open HTML report** (opens `report.html`), and **Download** (report.md / report.json / specs).
- **Left panel, "Test results":**
  - filter tabs **All (n)**, **Passed (n)**, **Issues (n)**, and **Skipped (n)** when any were skipped;
  - rows grouped by Accessibility, Features and Security, each with a status icon, title, duration, a thumbnail of the first evidence image when there is one, and a chevron;
  - the selected row is highlighted, and the first issue is selected by default.
- **Right panel, detail of the selected scenario:**
  - **Title row:** severity icon and the finding title (or the scenario title when it passed), tags (severity, group, check id, confirmed/advisory) and the duration. When one scenario has several findings, a small switcher lists them.
  - **Description:** the finding's "What this means".
  - **Evidence viewer:** the main image (frame, card or GIF), with a thumbnail strip of every evidence image for this finding. Click opens the full-size file.
  - **Two cards side by side:**
    - "Reproduction steps": the recorded steps of this scenario, numbered;
    - "Key facts": page URL, element/location, then the finding's facts, with copy buttons on URL and element.
  - **"Why it matters"** and **"What to ask your AI"**, the latter with a copy button.
  - **"Generated Playwright test":** the exported spec with line numbers and a Copy button (TypeScript only).
  - **Passed scenarios** show what was checked (the scenario description and its notes) and its steps, with no evidence section.
- **Also on the report:** the per-group table from "Groups and timing" (as a compact strip), "Pages tested" and "Not visible from outside".

## Runs (`#/runs`)

A list of runs, newest first: status icon, target, form name, date and time, duration, counts. It includes finished runs found on disk in the runs folder, so history survives a server restart. A running run shows "Running · 3 / 15". Clicking a row opens its Running or Report view.

## Settings (`#/settings`)

- **Defaults** (saved in this browser): "Allow destructive scenarios" and "Show the browser window".
- **Read-only:** allowed extra hosts (`RUNHOUND_ALLOWED_HOSTS`), accepted server host names, the runs folder path, the version, and links to TESTING.md and the feedback form.

## API additions

| Endpoint | Behaviour |
|---|---|
| `GET /api/runs` | List of runs (in memory plus `runsDir/*/report.json` on disk), newest first: `{runId, target, formName, status, startedAt, finishedAt?, durationMs?, summary?, completed, total}` |
| `GET /api/runs/:id` | Also works for runs only on disk (after a restart) |
| `POST /api/runs/:id/stop` | Stops a running run: the current scenario is aborted, remaining ones are skipped with "Stopped by you", the report is written with `stopped: true`; `409` if not running |
| `POST /api/runs/:id/rerun` | Plans the same target again and starts a run with the same approved scenario ids (those still in the new plan); `202 {runId}` |
| `GET /api/settings` | `{version, runsDir, allowedHosts, serverHosts}` (read-only) |

## Contract changes

- `RunOptions.signal?: AbortSignal`: stops the run as above.
- `CheckResult.steps?: {label, url, at}[]`: the scenario's recorded steps, for "Reproduction steps".
- `Report.stopped?: boolean` and `Report.browser?: string` (e.g. "Chromium 153.0.8010.12").
- The runner records the browser version and each scenario's steps; the server exposes `browser` in live status.
