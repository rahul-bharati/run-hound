# V0 spec: single form on localhost

The build contract for V0. The engine, the check library and the Kennel fixture are built against this document; the acceptance tests enforce it.

## Layout

```
app/                    # Run Hound itself (package "run-hound")
  src/core/types.ts     # shared contract: checks, findings, reports
  src/checks/           # one file per check id
  src/engine/           # discovery, planning, runner, capture, safety gate + navigation guard, report writers, spec export
  src/server/           # local web UI + JSON API on port 4000
  src/cli.ts            # `run-hound serve` and `run-hound run <url>`
  Dockerfile
fixtures/kennel/        # the deliberately broken target app
  bugs.json             # ground truth: bug id -> check id that must catch it
  expected/             # accepted responses (golden files), generated and reviewed
  Dockerfile
tests/acceptance/       # runs Run Hound against Kennel for clean mode and every V0 bug
docker-compose.yml      # run-hound + kennel + mock analytics
```

pnpm workspace at the repo root: `app`, `fixtures/kennel`, `tests/acceptance`. The marketing site (`site/`) stays separate.

## Ports

| Service | Port | Notes |
|---|---|---|
| Run Hound UI and API | 4000 | `run-hound serve` |
| Kennel app | 3000 | form at `/book` |
| Mock analytics | 3001 | separate origin, so it counts as a third party |

These are defaults. `run-hound serve --port <n>` moves the UI; Kennel reads `PORT` and `ANALYTICS_PORT` (they must differ). Tests always use random free ports.

## Kennel

A pet-sitting booking form. Frontend: Vite + React (a real built JS bundle, so bundle scanning is realistic). Backend: a small Node HTTP server that serves the built frontend and the API. In-memory data; nothing leaves the machine.

### Bug toggles

`KENNEL_BUGS` is read at server start: `none` (default, clean mode), `all`, or a comma list such as `F01,A03`. The frontend reads the active set from `GET /api/__config` at runtime, so one build serves every mode. Bundle-level secrets (S01, S02) live in a separate script that the server includes in `index.html` only when those bugs are on.

### API

| Method and path | Clean behaviour |
|---|---|
| `GET /api/__config` | `{ "bugs": [...] }` |
| `POST /api/__reset` | clears all data (test harness only) |
| `GET /api/availability` | `{ "available": true }` (F05 breaks the URL the frontend calls) |
| `GET /api/bookings` | list of bookings |
| `POST /api/bookings` | JSON body; validates every field server-side; `201` with the booking, `400` with `{ "errors": { field: message } }` (no stack traces) |

A pet name of `Crash` makes the server return `500 { "error": "Something went wrong" }`. This is the deliberate server fault the silent-failure check can also trigger with request interception.

### Form (`/book`, heading "Book a sitter")

Fields: pet name (text, required, max 50), pet type (Dog / Cat / Other, required; native radio group in clean mode), start date and end date (required; end on or after start), owner email (required), phone (optional), special instructions (textarea, optional), and an optional "Create an account" section with password and confirm password. Buttons: **Book** (submit), **Save draft** (stores the draft in localStorage and shows "Draft saved"), an icon-only **clear** button beside the pet name, and small **remove** icon buttons in the "Your bookings" list.

Clean behaviour: every input has a visible label; errors use `aria-invalid`, `aria-describedby` and a polite live region; focus is visible; Book is disabled while the request is pending; server errors show a visible, announced message and keep the input; after booking, "Your bookings" (rendered from `GET /api/bookings`, so it survives reload) shows every saved field; the layout reflows at 320 px; paste works everywhere; no third-party requests contain personal data; the page loads with no console errors or failed requests.

Each V0 bug in `bugs.json` changes exactly one of those behaviours.

## Engine

1. **Safety gate:** the target must be `http(s)` and its host must be `localhost` (or `*.localhost`), an IP literal in a private range, a name that resolves **only** to private addresses (loopback, RFC 1918, RFC 4193, link-local), or a name listed in `RUNHOUND_ALLOWED_HOSTS`. Anything else is refused before a browser opens. A name approved through DNS is **pinned**: Chromium is launched with `--host-resolver-rules=MAP <host> <approved address>`, so a second lookup (DNS rebinding) can't move the run to another address. Every browser context also runs a **navigation guard**: a navigation (top level, iframe or popup) to a host the gate refuses is aborted before it is sent, and if a server redirect reaches a refused host anyway (redirect hops can't be intercepted), the context is closed, the scenario becomes `error` and its findings are dropped. Destructive scenarios are off unless `--allow-destructive`; so are controls whose name says they destroy, pay for or send something (see `dead-control`). Run Hound never follows a redirect when it replays a request or re-fetches a script, and it sends those requests from inside the page (`fetch` with `redirect: "manual"`), so they go through the pinned browser and the navigation guard like every other request, never through a separate HTTP client with its own DNS lookup.
2. **Discover:** open the URL in Chromium (Playwright), find the main form, build `DiscoveredForm` from the accessibility tree and DOM. A URL typed without a scheme (`localhost:5173/book`) is read as `http://`. Pages load to `load` plus at most 5 s of network idle (apps that poll or stream never go idle). A target that doesn't answer is reported in one plain sentence ("Nothing is answering at http://localhost:5173. Is the app running, and on that port?"), never with Playwright's call log.
3. **Plan:** each check's `plan(form)` returns scenarios; the plan is shown for approval. V0 planning is deterministic and has no model provider; a provider (Ollama, OpenAI-compatible) is planned for later and will only ever plan and explain, never decide pass or fail. A check that can't run on this target still plans its scenario and skips it with the reason (`client-only-validation` on a non-localhost target), so nothing drops out of the plan silently.
4. **Run:** approved scenarios run in `CHECK_IDS` order, each in a fresh browser context, with network and console capture. The approval must name at least one scenario, and only scenarios the plan has: an empty or unknown approval is refused (`NothingToRunError`; CLI exit 2, API 400), because an empty run would report "0 findings" and look like a clean pass.
5. **Report:** `report.json`, `report.md` and `report.html` plus evidence files (`artifacts/`, numbered in the order they were taken across the whole run) and exported `.spec.ts` files in `runs/<runId>/`. Finding ids and spec file names are unique within a run (later duplicates get `-2`, `-3`, …). Besides the findings, every report lists each scenario that ran with its result and notes (why it errored or was skipped, what a passing check verified), the planned scenarios that were not approved, the V0 checks that had nothing to test on the form, and the pages tested. Secrets are redacted in every artifact, in check log lines, in scenario notes, and in everything the API returns (including the plan and error messages); a captured response body is cut *before* a secret that straddles the size limit, so half a key never survives. Screenshots are pixels and cannot be redacted: a page that renders a secret will show it in its screenshot. Every report lists what a browser can't see.

**Save requests** (`app/src/core/saves.ts`, one definition for every check and the engine): a non-GET fetch, XHR or page form post to the target's origin, or to another origin when its body carries the run's test values (every test value contains the run token, which is the same for every scenario of a run). The app accepted a save when it answered 2xx or 3xx (a classic form post answers 303 and redirects to a thank-you page). An API on another origin of this machine or the local network that receives two or more of the typed values is the app's own API, not a third party (`pii-leak`); anything else on another origin is a third party. A sign-in form (one password field, `autocomplete="current-password"` or a short form named "sign in" / "log in") answering 400/401/403/422 is the app refusing made-up credentials, not an error. Checks that need a JavaScript save request (`silent-failure`, `client-only-validation`) skip a classic page post with the reason; checks that need a saved record (`persistence`, `double-submit`) skip a sign-in form.

The web UI walks through the same steps: target URL, plan with checkboxes (grouped under each check's title), approve, progress, report. The API refuses an empty approval, unknown scenario ids and non-boolean `allowDestructive` / `headed` (400), and more than two runs at a time (409). The UI keeps the run id in `#run=<id>`, so a reload returns to the run; finished runs are read back from `runs/<runId>/report.json` when the server no longer holds them (a restart), so report links keep working. A failed plan clears the previous plan. It answers only requests addressed to a loopback name or an IP literal (plus names listed in `RUNHOUND_SERVER_HOSTS`) and refuses any POST carrying a foreign `Origin`, so a web page cannot drive Run Hound through DNS rebinding or CSRF. POSTs must be `application/json`.

## Checks and accepted responses

Pass/fail is always decided by a deterministic assertion. On clean Kennel every check must **pass**. With a bug enabled, the check in `detectedBy` must **fail** with at least one finding; other checks must still pass unless the acceptance golden file records and justifies a side effect.

| Check id | Scenario (golden or danger) | Pass when | Fail when (finding) |
|---|---|---|---|
| `console-network-errors` | Load the form and complete the golden path | No console errors, page errors or failed/4xx/5xx requests (excluding deliberate test requests) | Any of those; evidence lists them |
| `dead-control` | Activate every non-submit button whose name doesn't look destructive (delete, remove, pay, …); those need `--allow-destructive` | Each causes a request, DOM change, navigation, storage change, value change or focus change | A control does nothing |
| `silent-failure` | Submit valid data while the submit request is answered with 500 (interception) | A visible error appears within 5 s, is announced (live region or alert role, or focus moves to it) and inputs keep their values | Spinner or nothing; or input lost |
| `persistence` | Submit unique canary values in every field, reload | Every submitted canary is visible after reload (passwords excepted) | A field's value is missing |
| `double-submit` | Double-click submit with valid data | No single endpoint gets the same create request twice (a disabled button or an in-flight guard achieves that); other same-origin writes the page makes on submit are counted separately | One endpoint received two or more create requests |
| `axe-states` | Run axe-core (WCAG 2.x A/AA + 2.2 AA tags) on initial, invalid-submit, server-error and success states | No violations | One finding per violated rule, with nodes |
| `keyboard-completion` | Fill and submit using only Tab, arrows, Space and Enter | Every required field is reachable and operable, and the booking is created | A required field can't be reached or set |
| `focus-visible` | Tab through every control | Each focused control shows a visible focus indicator: an outline, or a box-shadow, border, background or text-decoration that differs from its unfocused style, or at least 40 pixels (0.5 % of the area around it) that change between a focused and a blurred screenshot | A control has no visible focus |
| `error-announcement` | Submit empty required fields | Each invalid field gets `aria-invalid="true"` and an associated message (`aria-describedby` or live region / alert) | Error shown only visually |
| `credential-fields` | Paste into password/OTP fields; check autocomplete | Paste works and `autocomplete` tokens are present | Paste blocked, or autocomplete missing (advisory) |
| `bundle-secrets` | Scan every loaded script for secret patterns (same-origin scripts are re-fetched in full, redirects not followed) | No secret patterns (publishable/anon keys are allowed; a value must look random, so kebab-case identifiers starting with `sk-` are not secrets) | Secret-looking key or `service_role` JWT; value redacted |
| `pii-leak` | Submit a canary email and phone, watch all requests | No third-party request (other origin than the target) contains the canary or its SHA-256 | Canary in a third-party URL or body |
| `verbose-errors` | Submit oversized and malformed input; scan responses and DOM | No stack traces, file paths or framework error dumps | Stack trace or internal path visible |
| `reflow-320` | Load at 320x800 | No horizontal scrolling of the page (`scrollWidth <= clientWidth + 1`) | Horizontal overflow |
| `client-only-validation` | Replay the create request (the one carrying the typed values) with one field made invalid (e.g. end before start), from the page, following no redirects | Server rejects with 4xx (a 3xx also counts as "not accepted") | Server accepts (2xx, high), or answers 5xx instead of a 4xx rejection (medium). Localhost targets only, even when the host is in `RUNHOUND_ALLOWED_HOSTS`: on other targets the scenario is planned and skipped with the reason; creates at most one test record |

### Golden files

`fixtures/kennel/expected/` holds the accepted responses:

- `clean.json`: every check `pass`, zero findings.
- `<BUG>.json` for each V0 bug: the checks that must fail (always including `detectedBy`), expected finding titles and severities, and any justified side effects.

The acceptance suite (`tests/acceptance`) starts Kennel for each mode, runs Run Hound with every scenario approved, and compares statuses and finding sets against the golden file. It ignores timings, run ids and artifact paths. In every mode it also reads every text file the run wrote (report, markdown, HTML, exported specs) and fails if any of them contains a secret planted in Kennel's bundle.

## Evidence

A finding is only as credible as its evidence. Every finding carries at least one **visual** piece of evidence (`frame`, `gif` or `card`) that a person can check without rerunning anything, plus the structured data behind it (`facts`).

**Frame** (`CheckContext.capture`): an annotated PNG. A header strip shows the page URL, capture time, check id and scenario, and the current step. The screenshot shows each highlighted element boxed with a numbered callout. A caption sentence sits under it, and a facts panel on the right lists the data and a legend of the marks. A highlight whose element can't be found is listed as a fact ("Not found on page: …"), never silently dropped.

Layout rules, so a mark can't be misread:
- The first marked element is scrolled to the middle of the viewport when it isn't fully in view, so the frame shows what is around it.
- A badge sits on the top-left corner of a tall outline. On a short one (a list row, under 40 px), it sits to the left, level with the element, so it never lines up with the row above.
- Callouts stay clear of other outlines, badges and the page's own controls (fields, buttons, media). An empty field looks like plain background, but a callout on it would read as if it described that field.
- With more than 5 marks, or 3 or more packed together (a column of icons, rows of a list), only the numbered outlines are drawn. The legend in the facts panel says what each number means; the panel is shown even when there are no facts.

**Card** (`CheckContext.captureCard`): the same header over a monospace text card, for evidence that isn't visual: requests, responses, code excerpts, console lines. The proving line is marked. An excerpt of a file sets `EvidenceCard.firstLineNumber`, so the gutter shows the file's own line numbers and matches the "Line" fact.

**GIF** (`CheckContext.record` then `finish`): an animated, looping recording of a flow, one annotated frame per step, at most 12 frames and 1200 px wide (a 1280 px page plus the facts panel is scaled to about 73 %, and page text stays readable), with the last frame held for 2.5 s.

All text on frames, cards and GIFs goes through `redactSecrets` first. Pixels can't be redacted: a page that renders a secret shows it.

### Required evidence per check (on failure)

| Check | Visual evidence | Highlights | Facts (at least) |
|---|---|---|---|
| `console-network-errors` | card of the errors, each labelled "while loading" or "after submitting"; frame of the page | — | count of console errors, page errors, failed requests; the form's own save request and its status ("Form submitted") |
| `dead-control` | GIF: before click → after click | the control ("Clicked: nothing happened") | requests, DOM changes, storage changes, focus/value changes (all 0) |
| `silent-failure` | GIF: filled form → submit → 5 s later | form area ("No error shown after 5 s") | injected status, wait time, whether values were kept |
| `persistence` | GIF: typed value → submitted → after reload | the field ("Typed …") then the list ("Not found after reload") | canary value, field, where it was searched |
| `double-submit` | GIF: filled → double-click → result; card of the requests | the submit control ("Clicked twice") | each create request: method, path, status, time offset |
| `axe-states` | frame per violated rule | every violating node (up to 10) labelled with the rule id | rule, impact, WCAG criteria, state, node count, failure summary |
| `keyboard-completion` | GIF of the Tab sequence | the focused element each step; the unreachable field ("Never reached by Tab") | tab stops visited, field not reached |
| `focus-visible` | GIF of the Tab sequence; frame per failing control | the control ("No visible focus") | outline, box-shadow, border and background at rest vs focused; pixels that change around the control between a focused and a blurred screenshot (a control whose styles look unchanged but whose pixels change, such as a native date field highlighting its first segment, is not reported) |
| `error-announcement` | frame after the empty submit | each error message or invalid field ("Not announced") | aria-invalid, aria-describedby, live region text per field |
| `credential-fields` | frame after the paste | the field ("Paste blocked") | pasted length vs value length, autocomplete |
| `bundle-secrets` | card with the script excerpt around the key (redacted), numbered as the file is | — | script URL, line and column, key type; for a JWT, its decoded role claim (never the token) |
| `pii-leak` | card of the third-party request (canary marked; query parameters one per line, "?" then "&" as in the URL); frame of the page at submit | — | third-party origin, where the canary appeared (URL/body), hashed or not |
| `verbose-errors` | card of the request that triggered it (password-like fields masked) and the response excerpt; frame if the trace is on the page | the trace on the page, when visible | status, request, matched pattern |
| `reflow-320` | full-page frame at 320 px | the widest overflowing element ("W px wide: N px wider than the screen") | viewport width, page scroll width, the widest element's right edge (so the numbers add up to the overflow) |
| `client-only-validation` | card of the replayed request and the server's response | — | field changed, value sent, response status |

### Live view and pages tested

While a run is in progress, checks call `CheckContext.step()` at each meaningful action and the engine reports every page load. With `RunOptions.live`, a CDP screencast streams JPEG frames of the page under test. The web UI shows a live panel: the URL of the page being tested, the current scenario and step, the latest frame, the step log and the list of pages tested. `--headed` (CLI) or the UI's "Show the browser window" option opens a visible Chromium window instead. Every report lists `pagesVisited` (the field is optional in the type only so reports written before it existed can still be read).

The CLI prints each step and each page change on stderr. `run <url> --plan-only` lists the planned scenarios with the ids `--approve` takes and exits 0 without running anything; `run-hound help` / `--help` print the usage and `--version` the version; with `--json` the run folder is printed on stderr.

## Tester release (0.1.0)

Rules for the build shared with outside testers:

- **One finding per problem.** When the same problem affects several elements (no visible focus on 6 controls, errors not announced on 4 fields, the same axe rule on 3 nodes), the check reports **one** finding: its title states the count ("No visible focus on 6 controls"), `locations` lists every element, `location` is the first, and the evidence marks all of them (one frame marking every element, or one frame per element up to 6). Different problems stay separate findings.
- **Exit codes.** `run` exits 0 when there are no *confirmed* findings (advisory findings are reported but don't fail the run), 1 when there is at least one confirmed finding, and 2 on an error or a refused target.
- **Version.** `run-hound --version` (and `run --version`) prints the version from `app/package.json` (0.1.0); the report's `runHoundVersion` matches it, and the web UI shows it in its footer.
- **Safety stays strict.** Loopback, RFC 1918, RFC 4193 and link-local only, plus `RUNHOUND_ALLOWED_HOSTS`; `0.0.0.0` and 100.64/10 stay refused.
- **Test data is disclosed, not deleted.** Every scenario that creates records says so in its plan text, and the report states how many test records the run created.
- **Unfamiliar apps.** Run Hound must behave on apps it has never seen: a classic HTML form that posts and redirects, a well-built SPA, a login form, and a form whose API is on another origin. On well-built apps it must report **zero confirmed findings**; checks that don't apply (for example `client-only-validation` when there is no JSON save request) are planned as skipped with a plain reason, never failed or silently dropped. The sample apps in `fixtures/samples/` are the regression suite for this.

## Groups and timing

**Groups.** Checks are grouped as **Accessibility** (`accessibility`), **Features** (`broken-feature` and `validation`) and **Security** (`security`), in that order (`CHECK_GROUPS` in `core/types.ts`). Grouping applies everywhere:

- **Plan:** `Plan.scenarios` is in run order (group by group, `CHECK_IDS` order inside a group) and `Plan.groups` lists each non-empty group with its scenario ids. The web UI shows the plan under group headings with a count and a "select all in this group" checkbox (a real checkbox with a label, indeterminate when partly selected); `run --plan-only` prints the same headings.
- **Run:** scenarios run group by group. A `group-start` progress event precedes each group; `scenario-start` carries its group. The CLI prints a heading per group; the live view shows the current group ("Accessibility · 3 of 8").
- **Report:** `Report.groups` gives per-group passed, failed, errored and skipped counts, findings and duration. The HTML and Markdown reports show a per-group summary table, and the list of scenarios and results is grouped under the same headings. Findings stay ordered by severity, each labelled with its group.

**Timing.** `Report.durationMs` is the whole run (start of `runPlan` to the report being written; equal to `finishedAt − startedAt`). Durations are shown with `formatDuration` (`core/format.ts`): "4.2 s", "42 s", "1 min 12 s", "1 h 3 min".

- **CLI:** each scenario line ends with its duration; the summary starts with "Finished in <duration>".
- **Web UI:** while running, an elapsed-time counter (updated every second from the run's start time, not announced to screen readers every tick) and per-scenario durations in the step log; when done, "Finished in <duration>" plus the per-group table. `GET /api/runs/:id` and `/live` include `startedAt`, `elapsedMs` (live) and `durationMs` (when done).
- **Report:** the run duration in the header and summary, each scenario's duration next to its result, and each group's total.
