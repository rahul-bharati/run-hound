# Changelog

All notable changes to Run Hound. Versions follow [Semantic Versioning](https://semver.org/); while the version is 0.x, any release may change behaviour.

## 0.2.0 (V1 tester preview: single page)

Run Hound now tests a whole page instead of one form. How to run it: [TESTING.md](TESTING.md); the build contract: [docs/v1-spec.md](docs/v1-spec.md).

### Added

- **Every form on the page**: discovery finds up to 5 forms (the one with the most fields first) and runs the form checks on each. Scenarios of the second and later forms get `@form-<n>` ids and name their form. `Plan.page` describes the page; each scenario has a `scope` ("form" or "page") and a `scopeLabel`.
- **Buttons outside the forms**: the new `page-controls` check clicks every button, toggle and `href="#"` link outside the forms and reports the ones that do nothing.
- **Page-wide security checks**: `security-headers` (CSP, clickjacking protection, nosniff, referrer policy, HSTS on https), `cookie-flags` (session cookies without HttpOnly, SameSite=None, or Secure on https), `cors` (answers any website may read, especially with the visitor's cookies, probed with `Origin: null` from a sandboxed frame) and `source-maps` (public source maps, especially with the original source code). On a dev server their findings are advisory, and `source-maps` is skipped, because dev servers don't send production settings.
- **Search forms and forms that don't show what they save**: search forms are recognised and planned without the checks that need a saved record; `persistence` skips (with the reason) when a page never displays what it saved, such as a newsletter form, instead of reporting lost data. Each form gets its own test values, and `axe-states` reports a problem once, in the form it belongs to.
- **Sign-out and similar buttons are never clicked by default**: "Log out", "Sign out", "Cancel subscription", "Close account", "Empty cart" and similar count as destructive.
- **A page without a form** is planned with the page-wide checks and a warning, instead of failing. Error pages (4xx/5xx) are still refused.
- **Web UI**: the plan shows what was found (each form with its fields and buttons, the controls outside the forms, the whole page), a scope chip on each scenario and a "New in V1" tag on the new checks; the runs list names pages with several forms; a more compact "Results by group" table.
- **CLI**: the plan summary describes the page ("Found 2 forms (…) and 3 controls outside them"), and `--plan-only` shows each scenario's scope.
- **Kennel V1 bugs**: F07 (dead Refresh button outside the form), S05 (no security headers), S06 (session cookie without HttpOnly), S07 (CORS echoes any origin with credentials), S08 (public source maps), with golden files. Clean Kennel now sends security headers, sets an HttpOnly session cookie and builds hidden source maps.
- **One-command test lab**: `.env.example` and a compose file that starts Run Hound with Kennel (broken and clean) and the five sample apps (`fixtures/samples/Dockerfile`), all bound to `127.0.0.1`, for Docker and Podman.

### Changed

- `bundle-secrets`, `reflow-320` and `focus-visible` run once per page (they were already page-wide).
- A new sample app, `multi-form` (search, contact and newsletter forms on one page), joins the false-positive suite.
- The browser's locale is set from the machine's locale, so pages that format dates work when `LANG` is unset (as in many containers), where Chromium otherwise reports the invalid `en-US@posix`.
- Reports say "Checks with nothing to test on this page" and "V1 tester preview".

## Unreleased (before 0.2.0)

### Added

- **Check groups**: every check belongs to **Accessibility**, **Features** or **Security**. The plan (web UI and `run --plan-only`) is shown under group headings, the web UI has a "Select all" checkbox per group, scenarios run group by group, the CLI prints a heading per group, and the live view shows the current group. `Plan.groups` and `Report.groups` (per-group counts, findings and duration) are in the JSON.
- **Run timing**: `Report.durationMs` for the whole run. The CLI ends each scenario line with its duration and starts the summary with "Finished in …"; the web UI shows an elapsed-time counter while running, per-scenario durations in the step log, and "Finished in …" when done; the HTML and Markdown reports show the run time, a per-group table with each group's time, and each scenario's duration. `GET /api/runs/:id` and `/live` include `startedAt`, `elapsedMs` (live) and `durationMs` (when done).

- **Web UI app shell** in the Run Hound brand: a sidebar with **New Run**, **Runs** and **Settings** (a menu on narrow screens), and pages with their own addresses (`#/new`, `#/runs`, `#/runs/<id>`, `#/settings`) so reload and back work; old `#run=<id>` links still open the run.
  - **New Run**: a Target → Plan → Run → Report step indicator, the grouped plan and "Start run (N scenarios)".
  - **Running view**: numbered scenarios with status and time (the current one expanded with its live steps), a counter and progress bar, elapsed time, the browser and its version, a live preview with the page address, and a timestamped activity log. **Stop run** stops for real: the scenario in progress and the rest are skipped ("Stopped by you") and a report is still written (`Report.stopped`). **Back to test plan** plans the same page again with the same scenarios ticked.
  - **Report view**: verdict and counts, **Re-run** (the same scenarios on the same page), **Open HTML report**, **Download**, results filtered by All, Passed, Issues and Skipped, and for the selected scenario its evidence, reproduction steps, key facts, what to ask your AI and the generated Playwright test.
  - **Runs**: every run on this machine, newest first, including finished runs read back from the runs folder after a restart.
  - **Settings**: defaults for "Allow destructive scenarios" and "Show the browser window" (saved in this browser), plus the runs folder, allowed hosts, server host names and version.
- API: `GET /api/runs`, `POST /api/runs/:id/stop`, `POST /api/runs/:id/rerun` and `GET /api/settings`; `GET /api/runs/:id` also serves runs found only on disk. `Report.browser` records the browser version and each scenario's recorded steps are kept (`CheckResult.steps`).

### Changed

- The report lists scenarios under their group, and each finding is labelled with its group. Reports written by 0.1.0 (without groups or a duration) still render.

## 0.1.0 (V0 tester preview)

The first build shared with outside testers. It tests one form on an app running on your own machine. How to run it and send feedback: [TESTING.md](TESTING.md).

### Added

- **Plan, approve, run, report** for one form: `run-hound run <url>` on the command line, and a local web UI (`run-hound serve`) where you review the plan, pick scenarios and watch the run.
- **15 checks**: console and network errors, dead controls, silent failures, persistence after reload, double submit, axe-core in every form state, keyboard-only completion, visible focus, error announcement, paste and autofill on credential fields, secret keys in the JavaScript bundle, personal data sent to third parties, verbose server errors, 320 px reflow, and client-only validation (localhost only).
- **Live view** in the web UI: the page under test refreshed about twice a second, the current scenario and step, a step log and every page loaded. Optionally a visible browser window (`--headed`).
- **Reports** in HTML, Markdown and JSON with evidence for every finding: annotated screenshots, GIFs of flows, request, response and script cards, plus a list of every scenario with its result and notes, the pages tested, and what a browser can't see.
- **Exported Playwright specs** that reproduce each finding without Run Hound.
- **One finding per problem**: when the same problem affects several elements, one finding lists every place.
- **Confirmed and advisory findings**. `run` exits 0 with no confirmed findings (advisory ones don't fail the run), 1 with at least one confirmed finding, and 2 on an error or a refused target.
- **Test data disclosure**: each scenario says whether it creates records, and the report states how many save requests the app accepted. Run Hound doesn't delete them.
- **Safety gate**: only `localhost`, loopback, private and link-local addresses, or hosts listed in `RUNHOUND_ALLOWED_HOSTS`; the browser is pinned to the approved address and stopped if a page navigates elsewhere; destructive scenarios need `--allow-destructive`; the UI answers only on loopback.
- `run-hound --version` and the report's `runHoundVersion`.
- **Kennel**, a deliberately broken booking app with planted bugs behind `KENNEL_BUGS`, and an acceptance suite that runs Run Hound against it in clean mode and with every bug.
- **Sample apps** (`fixtures/samples/`): a classic post-and-redirect form, a fetch-based SPA, a login form and a form whose API is on another origin, as a false-positive regression suite.
- **Docker and Podman**: `docker compose up` runs Run Hound and Kennel; reports are written to `./runs` on your machine and owned by you; `host.docker.internal` is set up for testing an app on your machine, and `--network host` works on Linux.
- CI on GitHub Actions (type-check, unit, Kennel and acceptance suites) and issue forms for tester feedback and bugs.

### Works on apps it has never seen

- **Classic form posts**: a `<form method="post">` answered with a redirect (303) counts as saved; persistence looks for the values on the page the redirect leads to, and the navigation is never mistaken for leaving the target.
- **Sign-in forms**: a 401 (or 400/403/422) answer to Run Hound's made-up credentials is the app working. It is not reported as an error, keyboard-only completion counts it as sent, and persistence and double-submit are planned and skipped with the reason.
- **An API on another origin** (another port, with CORS): its save requests are recognised by every check, simulated server answers carry CORS headers, and `pii-leak` doesn't count the app's own API as a third party.
- **Checks that don't apply skip with a plain reason** instead of erroring: `silent-failure` and `client-only-validation` on a classic form post, and scenarios where the app sent nothing or refused the test values.
- `error-announcement` leaves out required fields that already hold a value (a default of "1"); `reflow-320` names the element that overflows and marks it advisory when only Run Hound's own long test values spill; `focus-visible` and `console-network-errors` ignore dev-server overlays and hot-reload connections (Next.js, Vite, webpack, Nuxt, Astro).
- Clearer messages: "No form found" says what the page was instead (a 404, a dev server refusing the host name, a redirect to a sign-in page); an unreachable `localhost` inside a container explains that localhost is the container; `0.0.0.0` suggests `localhost`; a port Chromium blocks (such as 6000) is named, with advice to pick another; a plan found on a redirected page shows a warning; `--plan-only` prints each scenario's description (including the test records it creates); `--headed` and the UI's browser-window option say plainly when there is no display; piping the CLI into `head` no longer crashes.
