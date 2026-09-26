# App UI spec: the local web UI

The local web UI (`run-hound serve`) lives in `app/src/server/ui/` (`index.ts` renders the page and the sidebar,
`client.ts` the views, plus `styles.ts` and `icons.ts`) and is served by `app/src/server/app.ts`. It follows the app
shell in `site/assets/mockups/mockup-1.png` (a run in progress) and `mockup-2.png` (a finished run), in the brand from
`docs/brand.md`. The goal is a clean, simple UI where the flow reads as clear steps.

Built: the shell and the four views (0.2.0), the AI screens (0.3.0, [ai-spec.md](ai-spec.md)) and test accounts with
**Sign in as** (0.4.0, [v2-spec.md](v2-spec.md)). The page is one self-contained HTML document: inline CSS and script,
the hound mark embedded, and no requests besides Run Hound's own `/api/*`.

**Rule:** every element on screen is real. Mockup elements Run Hound can't back with real data are either built for
real (when small) or left out. Nothing is decorative data.

## Shell

- **Left sidebar** (`bg-deep`, full height): the hound mark and "RUN HOUND" wordmark; nav items **New Run**, **Runs**,
  **Settings**, with the active item highlighted as in the mockups (accent border and tint). At the bottom, instead of
  a user workspace: a small card "Local · this machine" with "Run Hound <version>" and "V2 preview".
- **Main area:** the current view. Routing is client-side by URL hash (`#/new`, `#/runs`, `#/runs/<id>`,
  `#/settings`), so reload and back/forward work and links can be shared on the same machine. Unknown hashes open
  New Run; old `#run=<id>` links open the run.
- **Mockup items not built:** "Test Plans" (plans aren't saved), a user avatar and workspace (Run Hound has no user
  accounts of its own; the test accounts in Settings are accounts on the app under test), Python export (TypeScript
  only).
- **Responsive:** at 900 px and below, the sidebar collapses to a top bar with the mark and a "Menu" button;
  everything works at 360 px without sideways scrolling.
- **Announcements:** one polite live region announces scenario and group changes, the end of a run, and on Settings
  each save, sign-in test and connection test. Nothing else is live.

## New Run (`#/new`)

A step indicator across the top: **1 Target → 2 Plan → 3 Run → 4 Report**, with the current step marked.

1. **Target:** a card with the "Page URL" input and "Plan checks". Errors appear inline under the input; a hint says
   to use localhost or a private address and to add other hosts with `RUNHOUND_ALLOWED_HOSTS`. Under it:
   - **Sign in as** (0.4.0): "Not signed in" (default), then Account A and Account B by their labels. A slot that
     isn't set up is listed but disabled ("Set it up in Settings"). A hint under the select says what the choice does,
     or links to Settings when no account is set up.
   - **Review with AI** (0.3.0), shown only while AI is on and usable: names the model and says only redacted page
     structure is sent. While the model works, a note says it can take a minute or more.
2. **Plan:** the summary "Found "Book a sitter" · 15 scenarios" ("Found 2 forms", "Found no form" on other pages).
   Then:
   - what was found: one chip per form (its name, fields and buttons), "Outside the forms" (controls and links) and
     "Whole page";
   - "Signed in as <label>" when the plan was made signed in;
   - a line naming the model that reviewed the plan or suggested flows ("Advisory: the checks still decide pass or
     fail."), when AI was used;
   - the plan's warnings. On the "Sign in as a test account…" hint, a button plans the page again signed in as the
     first account that is set up, or a link says "Set up test accounts".

   Scenarios are grouped (Accessibility, Features, Security) with counts and a "Select all" checkbox per group, and one
   row per scenario: checkbox, title, tags (golden/danger, destructive, a scope chip ("Whole page", or the form's label
   on a page with several forms), "New in V1" on the V1 checks, "AI" on reviewed scenarios (plus "Recommended"
   when the model recommends one), "Suggested by AI" on suggested flows), the description (which says when it creates test records), the model's
   rationale, and a suggested flow's steps. Options: "Allow destructive scenarios" and "Show the browser window",
   whose defaults come from Settings; the second is greyed out, with the reason, when the machine running Run Hound
   has no display (as in a container). Primary button: "Start run (N scenarios)".

## Running (`#/runs/<id>` while running): mockup 1

- **Left column:**
  - "← Back to test plan": New Run with this run's page planned again (as the same account) and its scenarios
    selected;
  - title "Running tests…", with "Testing "<form>"" (or "Testing this page"), the target URL and "Signed in as
    <label>" underneath;
  - a counter "3 / 15" and a progress bar;
  - two cards: **Elapsed time** (mm:ss, ticking; not a live region) and **Browser** (the real browser name and
    version, e.g. "Chromium 153.0");
  - the **numbered scenario list**, grouped by Accessibility, Features and Security. Each row shows a status ring
    (done: accent check; failed: red "!"; running: accent ring; skipped: dim dash; queued: empty circle), the title and
    the duration.
  - The running scenario is **expanded**: a bordered accent card listing its live sub-steps (from `step` events) with
    check/ring icons, like mockup 1's "Fill full name / Fill email address / Fill password". Finished scenarios can be
    expanded to show their steps.
  - **Stop run** (danger outline button) at the bottom: stops for real (see API). Remaining scenarios become
    "skipped: stopped by you" and a report is still written.
- **Right column:**
  - **Browser preview:** an address bar with the current URL, a reload-style icon, a "Live" badge while frames arrive,
    and the latest screencast frame.
  - **Live activity:** a timestamped log (hh:mm:ss) of steps with a check (done) or ring (current), the step text and
    its duration, plus a count such as "8 steps".

## Report (`#/runs/<id>` when finished): mockup 2

- **Header:**
  - breadcrumb "Runs › <target host+path> › Run <id>", with the date and time on the right;
  - a large status ring: accent check when there are no confirmed findings, red "!" otherwise, and a neutral mark when
    nothing was checked (every scenario skipped);
  - the title "Test run complete" (or "Run stopped" / "Run failed");
  - the summary line "15 scenarios run · 11 passed · 4 with issues · 38 s", counting skipped and errored when present;
  - "Signed in as <label>" for a signed-in run, and the other account when a scenario used it;
  - with AI explanations, "Findings explained by <model> (n of m findings). Advisory text only." and the model's
    warnings.
- **Header buttons:** **Re-run** (accent outline: plans the same target again and starts a run with the same
  scenarios), **Open HTML report** (opens `report.html`), and **Download** (report.md / report.json / specs).
- **Left panel, "Test results":**
  - filter tabs **All (n)**, **Passed (n)**, **Issues (n)**, and **Skipped (n)** when any were skipped;
  - rows grouped by Accessibility, Features and Security, each with a status icon, title, duration, a thumbnail of the
    first evidence image when there is one, and a chevron;
  - the selected row is highlighted, and the first issue is selected by default.
- **Right panel, detail of the selected scenario:**
  - **Title row:** severity icon and the finding title (or the scenario title when it passed), the finding's "What this
    means" under it, tags (severity, group, the form or "Whole page", check id, Confirmed/Advisory) and the duration.
    When one scenario has several findings, a small switcher lists them.
  - **Evidence viewer:** the main image (frame, card or GIF), with a thumbnail strip of every evidence image for this
    finding. Click opens the full-size file.
  - **Two cards side by side:**
    - "Reproduction steps": the recorded steps of this scenario, numbered;
    - "Key facts": page URL, element/location, then the finding's facts, with copy buttons on URL and element.
  - **"Why it matters"** and **"What to ask your AI"**, the latter with a copy button.
  - **"AI explanation"** (0.3.0, tagged Advisory) when the model explained the finding: its summary, an "Ask your AI"
    prompt with a copy button, and which model wrote it.
  - **"Generated Playwright test":** the exported spec with line numbers and a Copy button (TypeScript only).
  - **Passed and skipped scenarios** show "What was checked" (the scenario description and its notes) and the steps,
    with no evidence section.
- **Also on the report:** the "Results by group" table from "Groups and timing" (v0-spec), "Pages tested" (with how
  many test records the run may have created, and as which account, plus the browser and Run Hound version), and "Not
  visible from outside" (the same list the HTML and Markdown reports call "What a browser can't see").

## Runs (`#/runs`)

A list of runs, newest first: status icon, target, form name (or "Page without a form name"), "Signed in as <label>"
for a signed-in run, date and time, duration, counts. It includes finished runs found on disk in the runs folder, so
history survives a server restart. A running run shows "Running · 3 / 15", and the list refreshes while one is
running. Clicking a row opens its Running or Report view.

## Settings (`#/settings`)

Five cards, in this order:

- **Defaults** (saved in this browser): "Allow destructive scenarios" and "Show the browser window" (greyed out
  without a display).
- **Test accounts** (0.4.0): what the accounts are for and what the access checks do (use accounts you own, made for
  testing). One card per account (A and B): label, sign-in page URL, username and a write-only password ("Password
  saved", with Remove), a warning when a new sign-in page on another site would drop the saved password, **Save** and
  **Test sign-in** with its result. The "A and B must not see each other's data" checkbox saves at once. Values set by
  environment variables are locked ("Set by environment"). The card names the file the accounts are saved to.
- **AI** (0.3.0): the **Use AI** switch, provider presets, base URL, a model dropdown with Refresh and "Other…", a
  write-only API key (with Remove key), region and AWS profile for Bedrock, "What the model does" (review, suggest,
  explain), a consent box naming the host for a remote endpoint, **Save** and **Test connection**. Details in
  [ai-spec.md](ai-spec.md) "Surfaces".
- **This server** (read-only): the version, the runs folder, allowed extra hosts (`RUNHOUND_ALLOWED_HOSTS`) and
  accepted server host names (`RUNHOUND_SERVER_HOSTS`).
- **Help and feedback:** links to TESTING.md and the feedback form.

## API used by the UI

The full list, with every status code, is the comment above `createApp` in `app/src/server/app.ts`.

| Endpoint | Behaviour |
|---|---|
| `POST /api/plan` | `{url, ai?, signInAs?}` → `{planId, plan, checks, warnings}`: discovers the page (signed in as the account when `signInAs` is set) and plans it |
| `POST /api/runs` | `{planId, approved, allowDestructive?, headed?}` → `202 {runId}`; `409` when two runs are already going |
| `GET /api/runs/:id/live` and `live.jpg` | The running view's state (scenario, step, pages, finished scenarios) and the latest screencast frame |
| `GET /api/runs/:id/report.{json,md,html}`, `specs/:file`, `artifacts/:file` | The run's files |
| `GET /api/runs` | List of runs (in memory plus `runsDir/*/report.json` on disk), newest first: `{runId, target, formName, status, startedAt, finishedAt?, durationMs?, summary?, completed, total, account?}` (`account` is `{id, label}`, never a username) |
| `GET /api/runs/:id` | Also works for runs only on disk (after a restart) |
| `POST /api/runs/:id/stop` | Stops a running run: the current scenario is aborted, remaining ones are skipped with "Stopped by you", the report is written with `stopped: true`; `409` if not running |
| `POST /api/runs/:id/rerun` | Plans the same target again (with AI when the run used it) and starts a run with the same approved scenario ids (those still in the new plan); `202 {runId}` |
| `GET /api/settings` | `{version, runsDir, allowedHosts, serverHosts, ai}` (read-only; `ai` is the AI status without the key) |
| `/api/ai*` | AI settings, test and model list ([ai-spec.md](ai-spec.md) "Surfaces") |
| `/api/accounts*` | Test accounts and sign-in test ([v2-spec.md](v2-spec.md) "API") |

`/api/ai*` and `/api/accounts*` need the `X-Run-Hound: 1` header, which the UI sends.

## Contract changes (0.2.0)

- `RunOptions.signal?: AbortSignal`: stops the run as above.
- `CheckResult.steps?: {label, url, at}[]`: the scenario's recorded steps, for "Reproduction steps".
- `Report.stopped?: boolean` and `Report.browser?: string` (e.g. "Chromium 153.0.8010.12").
- The runner records the browser version and each scenario's steps; the server exposes `browser` in live status.
