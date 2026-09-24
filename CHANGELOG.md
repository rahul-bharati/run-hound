# Changelog

All notable changes to Run Hound. Versions follow [Semantic Versioning](https://semver.org/); while the version is 0.x, any release may change behaviour.

## Unreleased

### Added

- **Check groups**: every check belongs to **Accessibility**, **Features** or **Security**. The plan (web UI and `run --plan-only`) is shown under group headings, the web UI has a "Select all" checkbox per group, scenarios run group by group, the CLI prints a heading per group, and the live view shows the current group. `Plan.groups` and `Report.groups` (per-group counts, findings and duration) are in the JSON.
- **Run timing**: `Report.durationMs` for the whole run. The CLI ends each scenario line with its duration and starts the summary with "Finished in …"; the web UI shows an elapsed-time counter while running, per-scenario durations in the step log, and "Finished in …" when done; the HTML and Markdown reports show the run time, a per-group table with each group's time, and each scenario's duration. `GET /api/runs/:id` and `/live` include `startedAt`, `elapsedMs` (live) and `durationMs` (when done).

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
