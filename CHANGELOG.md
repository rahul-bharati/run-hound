# Changelog

All notable changes to Run Hound. Versions follow [Semantic Versioning](https://semver.org/); while the version is 0.x, any release may change behaviour.

## Unreleased (0.4.0)

Work in progress on the 0.4.0 contract ([docs/v2-spec.md](docs/v2-spec.md)). So far: modern form stacks (React 19, Radix/shadcn, react-hook-form + zod, cmdk, sonner), and the fixes from the 0.3.0 audit.

### Added

- **Test accounts and signed-in runs**: two accounts you own on your app (A and B) in Settings → Test accounts or `run-hound accounts set|status|test|clear`; `run --as a|b` and New Run → **Sign in as** sign in first and run every check signed in. Passwords are write-only and bound to their sign-in site; passwords, session cookies and tokens are redacted from reports, evidence, specs, logs, progress and AI prompts, and accounts are named by label.
- **Access checks** (`access-control`): can account B, or a signed-out visitor, read account A's data? **Mass assignment** (`mass-assignment`, unticked by default): does the server store `role`, `plan` or `isAdmin` fields the form never sends? **Deep links** (`deep-links`): do the app's own pages load when opened directly?
- **Widgets**: Radix/shadcn, Headless UI, cmdk and MUI selects, comboboxes, checkboxes, switches, radio groups and sliders are discovered as fields (`FormField.widget`, with the hidden Radix input as `nativeSelector`) and set the way a person sets them (`setField`), in the checks and in exported specs. Fields marked required only in their label ("Email *", "(required)") count as required.
- **Forms in dialogs**: discovery tries up to 3 controls that look like they open a dialog or sheet ("Add member", `aria-haspopup="dialog"`, never a link to another page), with writes blocked (every request but GET, HEAD and OPTIONS, and every message the page sends over a WebSocket), and plans the form it shows (`DiscoveredForm.opener`). The form's scenarios open it after every page load, and exported specs open it too; page-wide scenarios see the page as it loads.
- **Multi-step forms**: when submitting shows the next step without saving, the checks that need a saved record skip with a plain "multi-step form" note instead of blaming the test values.
- **Stable selectors**: ids a framework numbers in mount order (React `useId`, `radix-`, `headlessui-`, `mui-`, UUIDs) are never used, so a selector finds the same field on every load.

### Fixed

- A scenario can take at most 3 minutes (the checks that click every control get a minute plus 15 s per control when that is more); one that hangs (often a request the app never answers) ends as an error with a note, and the run and its report finish. The replays and re-fetches sent from the page give up after 10 seconds.
- `run` exits 2 with "Nothing was tested" when every approved scenario errored or was skipped, instead of 0. `serve` on a port already in use prints one plain line and exits 2.
- A user name and password in the target URL are taken out of the plan, reports, specs, logs and UI, and only answer that origin's HTTP authentication.
- False findings on modern apps: sonner toasts count as announced; a toast is not a saved record; a move to a thank-you page is followed; uppercase and formatted phone lists match the typed values; a double click counts only the saves it sent (not GraphQL queries); a guarded button, a covered radio card, a new tab, fading-in text and Run Hound's own earlier test data are no longer reported; errors while loading are reported once per page, not once per form; blocked embeds are left out of console errors.
- The test-record count leaves out GraphQL queries and same-origin reads or analytics sent as POST.
- `persistence` still reports lost data when the app moves to another page after saving: a detail page or list that leaves out a field, and a list that showed the new record only until the page was loaded again. A greeting by name, or the signed-in user's name in the page header, is not taken for a list of records, and a list in a live region (`aria-live`) is not taken for a toast.
- `dead-control` and `page-controls` report a button an invisible element covers (a leftover backdrop) as one nobody can click, and a scenario in which no control could be clicked is skipped instead of passing.
- `dead-control` and `page-controls` leave out sending, paying, ordering and trash-icon controls unless `--allow-destructive`; a contact form's own "Send message" button still works with Enter in a suggested flow.
- `pii-leak` doesn't report the app's own hosted backend or form service (Supabase, Firebase, Formspree, …) as a third party. `verbose-errors` sends its malformed replay only where the safety gate allows. `bundle-secrets` keeps two different keys with the same preview apart.
- The AI review can tick a scenario but never untick one that is ticked by default. Provider error messages never echo the API key.

### Security

- The local server answers only loopback names and addresses, `RUNHOUND_SERVER_HOSTS`, the `RUNHOUND_PUBLIC_URL` host and the specific `serve --host` address; other IP literals get 403. Every response carries `nosniff`, `X-Frame-Options: DENY`, `no-referrer` and a Content-Security-Policy; `report.html` is sandboxed.
- The navigation guard closes a context whose navigation to a DNS-approved host answered from an address that isn't private (DNS rebinding on hosts that can't be pinned).
- Signed-in runs keep the test accounts out of everything they write: usernames (3 characters or more, in any letter case) are hidden in reports, evidence file names, specs, logs, progress and AI prompts; evidence images are taken with the account's name and session values dotted out on the page; a password is hidden form-encoded too; a session value in a link never reaches the plan. Sign-in never fills a sign-up form placed before the sign-in form, refuses a form that would send the password in the page address, and keeps a session held in IndexedDB. A page that shows its sign-in form in place fails the plan (and says when the sign-in page is on another host name, such as localhost vs 127.0.0.1). A form that sets a password is never submitted while signed in. A very common test-account password gets a warning in its status.
- `access-control` counts only the app's API answers and HTML (never scripts), matches a username as a whole value (not inside another one), reads the app's API on another local origin, and saves its test record only through a form that saves a record (never one that sets a password or an email). `mass-assignment` counts a field only when the record didn't already hold the injected value, looks only at the saved record, and says what it really restored. `deep-links` never opens a link that signs out, disconnects, accepts an invitation or carries `?action=delete`.
- Docker: on a rootful engine with a runs folder Docker created as root, the folder is handed to the image's user (uid 1001) with normal permissions (755/644) instead of being made world-writable; deleting reports then needs `sudo`, and the entrypoint says so.

### Changed

- Reports record how the run was started (`Report.options`: `allowDestructive`, `headed`), so a re-run of a report read back from disk runs the same way. A re-run of a target whose saved URL had a secret redacted out of it is refused with a plain message.

## 0.3.0 (optional AI: plan review, suggested flows, explanations)

Bring your own model. AI is off by default and never decides pass or fail. Contract: [docs/ai-spec.md](docs/ai-spec.md).

### The repository is public

- Run Hound is now open source in a public repository: <https://github.com/rahul-bharati/run-hound>, under the [MIT license](LICENSE). There is no invitation or access request any more; anyone can clone it, try it and file issues. The README, TESTING.md, the issue forms and the website say so, and the preview is called the "V1 preview" in reports and the web UI.
- **Docker images on GHCR**: a release workflow publishes `ghcr.io/rahul-bharati/run-hound`, `run-hound-kennel` and `run-hound-samples` (linux/amd64 and linux/arm64) when a version tag is pushed, with an optional Docker Hub mirror. The docs and the compose file use the GHCR names, with `docker compose build` as the fallback.

### Added

- **Providers**: Ollama (native API, thinking off, larger context), any OpenAI-compatible endpoint (LM Studio, llama.cpp, vLLM, OpenAI, OpenRouter, Groq, Together, …) with JSON-schema structured output, and Amazon Bedrock (Converse, with a Bedrock API key, AWS access keys, or an AWS profile: static keys, `credential_process` or IAM Identity Center/SSO after `aws sso login`). No new dependencies.
- **Plan review**: the model recommends and ranks each built-in scenario and gives a one-line reason (`Scenario.ai`); destructive scenarios are never ticked by it, and nothing is added, removed or reordered.
- **Suggested flows**: up to 5 flows of up to 8 steps that only name discovered fields and buttons, run by the new `ai-flow` check with deterministic expectations (a save succeeds, text is shown or gone, the URL changes, no errors, typed values kept). Unticked by default; a failed flow is one advisory finding with a GIF, a frame and a Playwright spec. A flow the model left without a final check gets a "no errors" check, and an over-long typed value is shortened, instead of the flow being dropped (a 9B local model went from 0 to 5 of 5 flows kept).
- **Explanations**: after the run, each finding (up to 20) gets an "AI explanation (advisory)" and an "Ask your AI" prompt beside the built-in text (`Finding.ai`, `Report.ai`).
- **Web UI**: Settings → AI (provider presets, a **model dropdown** filled from the server with Refresh and "Other…", write-only API key, feature toggles, remote consent naming the host, Test connection); "Review with AI" on New Run; AI chips, reasons and suggested steps in the plan; AI explanation panel in the report.
- **API**: `GET/PUT /api/ai`, `POST /api/ai/test`, `GET /api/ai/models`; `POST /api/plan` takes `ai`.
- **CLI**: `run --ai/--no-ai --ai-provider --ai-model --ai-base-url --ai-allow-remote`, `run-hound ai status`, `run-hound ai test`.
- **Config**: `~/.config/run-hound/ai.json` (0600, in a 0700 folder) or `RUNHOUND_CONFIG_DIR`, `RUNHOUND_AI_*` variables; compose passes them and keeps UI settings in `./runs/.config`.
- **Reliability with small local models**: Ollama keeps the model loaded between planning and explanations; a timed-out explanation is retried once, and after two timeouts in a row the rest are skipped with one warning; planning with AI is bounded at 4 minutes and follows the browser request (closing the page stops it).

### Privacy

- Only redacted page structure is sent (labels, field types, button names, the page path, scenario titles), plus the finding text and evidence facts for explanations, never typed values, selectors, cookies, bodies or screenshots.
- Remote endpoints (anything not on this machine or a private network, and Bedrock) need explicit consent; without it nothing is sent, not even a model list request.
- API keys are never returned by the API, shown in the UI or written to reports. A saved key is bound to the endpoint it was saved for: changing the endpoint (in Settings, a flag or an environment variable) never sends it elsewhere, and saving a new endpoint without a new key removes it.
- Consent for a remote endpoint is bound to its host; pointing Run Hound at another remote host asks again.
- Suggested flows can't activate destructive controls without `--allow-destructive`: they may press only Enter (in a form field, and not when the form's submit button is destructive) and Escape, and stop if focus lands on a destructive control.
- `/api/ai*` requires an `X-Run-Hound` header, so other websites can't drive the local server.

### Changed

- With AI off, plans, runs and reports are the same as 0.2.0.
- The web UI no longer prints "null" where an optional hint or notice is empty.

## 0.2.0 (V1 tester preview: single page)

Run Hound now tests a whole page instead of one form. How to run it: [TESTING.md](TESTING.md); the build contract: [docs/v1-spec.md](docs/v1-spec.md).

### Added

- **Every form on the page**: discovery finds up to 5 forms (the one with the most fields first) and runs the form checks on each. Scenarios of the second and later forms get `@form-<n>` ids and name their form. `Plan.page` describes the page; each scenario has a `scope` ("form" or "page") and a `scopeLabel`.
- **Buttons outside the forms**: the new `page-controls` check clicks every button, toggle and `href="#"` link outside the forms and reports the ones that do nothing.
- **Page-wide security checks**: `security-headers` (CSP, clickjacking protection, nosniff, referrer policy, HSTS on https), `cookie-flags` (session cookies without HttpOnly, SameSite=None, or Secure on https), `cors` (answers any website may read, especially with the visitor's cookies, probed with `Origin: null` from a sandboxed frame) and `source-maps` (public source maps, especially with the original source code). On a dev server their findings are advisory, and `source-maps` is skipped, because dev servers don't send production settings.
- **Search forms and forms that don't show what they save**: search forms are recognised and planned without the checks that need a saved record; `persistence` skips (with the reason) when a page never displays what it saved, such as a newsletter form, instead of reporting lost data. Each form gets its own test values, and `axe-states` reports a problem once, in the form it belongs to.
- **Each finding names its form** ("Newsletter form", "Whole page") in the web UI and in the HTML and Markdown reports (`Finding.scope`).
- **Sign-out and similar buttons are never clicked by default**: "Log out", "Sign out", "Cancel subscription", "Close account", "Empty cart" and similar count as destructive.
- **A page without a form** is planned with the page-wide checks and a warning, instead of failing. Error pages (4xx/5xx) are still refused.
- **Web UI**: the plan shows what was found (each form with its fields and buttons, the controls outside the forms, the whole page), a scope chip on each scenario and a "New in V1" tag on the new checks; the runs list names pages with several forms; a more compact "Results by group" table.
- **CLI**: the plan summary describes the page ("Found 2 forms (…) and 3 controls outside them"), and `--plan-only` shows each scenario's scope.
- **Kennel V1 bugs**: F07 (dead Refresh button outside the form), S05 (no security headers), S06 (session cookie without HttpOnly), S07 (CORS echoes any origin with credentials), S08 (public source maps), with golden files. Clean Kennel now sends security headers, sets an HttpOnly session cookie and builds hidden source maps.
- **One-command test lab**: `.env.example` and a compose file that starts Run Hound with Kennel (broken and clean) and the five sample apps (`fixtures/samples/Dockerfile`), all bound to `127.0.0.1`, for Docker and Podman.

### Changed

- `bundle-secrets`, `reflow-320` and `focus-visible` run once per page (they were already page-wide).
- The live view's browser card shows the Chromium the run really launched (a new `browser` progress event), not only the build Playwright expects.
- The marketing site shows V1: new screenshots and evidence from a 0.2.0 run on Kennel (captured with `app/scripts/capture-site-screens.ts`), with the CORS and security-header cards on the home and demo pages.
- The home page has a "Coming soon: AI" section: AI planning, AI explanations and bring-your-own-model (all opt-in, none in the preview), and where a model will fit in a run. A model proposes and explains; real checks still decide.
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
