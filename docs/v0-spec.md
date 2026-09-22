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

1. **Safety gate:** the target must be `http(s)` and its host must be `localhost` (or `*.localhost`), an IP literal in a private range, a name that resolves **only** to private addresses (loopback, RFC 1918, RFC 4193, link-local), or a name listed in `RUNHOUND_ALLOWED_HOSTS`. Anything else is refused before a browser opens. A name approved through DNS is **pinned**: Chromium is launched with `--host-resolver-rules=MAP <host> <approved address>`, so a second lookup (DNS rebinding) can't move the run to another address. Every browser context also runs a **navigation guard**: a navigation (top level, iframe or popup) to a host the gate refuses is aborted before it is sent, and if a server redirect reaches a refused host anyway (redirect hops can't be intercepted), the context is closed, the scenario becomes `error` and its findings are dropped. Destructive scenarios are off unless `--allow-destructive`; so are controls whose name says they destroy, pay for or send something (see `dead-control`). Run Hound never follows a redirect when it replays a request or re-fetches a script.
2. **Discover:** open the URL in Chromium (Playwright), find the main form, build `DiscoveredForm` from the accessibility tree and DOM.
3. **Plan:** each check's `plan(form)` returns scenarios; the plan is shown for approval. V0 planning is deterministic. A model provider interface exists (`none` by default; Ollama and OpenAI-compatible later) and is only ever used to plan and explain, never to decide pass or fail.
4. **Run:** approved scenarios run in `CHECK_IDS` order, each in a fresh browser context, with network and console capture.
5. **Report:** `report.json`, `report.md` and `report.html` plus screenshots and exported `.spec.ts` files in `runs/<runId>/`. Secrets are redacted in every artifact, in check log lines, in scenario notes, and in everything the API returns (including the plan and error messages); a captured response body is cut *before* a secret that straddles the size limit, so half a key never survives. Screenshots are pixels and cannot be redacted: a page that renders a secret will show it in its screenshot. Every report lists what a browser can't see.

V0 assumes the form's own API is on the page's origin: same-origin non-GET requests are "save requests", and every other origin counts as a third party (`pii-leak`). A frontend that posts to an API on another origin is out of scope for V0.

The web UI walks through the same steps: target URL, plan with checkboxes, approve, progress, report. It answers only requests addressed to a loopback name or an IP literal (plus names listed in `RUNHOUND_SERVER_HOSTS`) and refuses any POST carrying a foreign `Origin`, so a web page cannot drive Run Hound through DNS rebinding or CSRF. POSTs must be `application/json`.

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
| `focus-visible` | Tab through every control | Each focused control shows a visible focus indicator: an outline, or a box-shadow, border, background or text-decoration that differs from its unfocused style | A control has no visible focus |
| `error-announcement` | Submit empty required fields | Each invalid field gets `aria-invalid="true"` and an associated message (`aria-describedby` or live region / alert) | Error shown only visually |
| `credential-fields` | Paste into password/OTP fields; check autocomplete | Paste works and `autocomplete` tokens are present | Paste blocked, or autocomplete missing (advisory) |
| `bundle-secrets` | Scan every loaded script for secret patterns (same-origin scripts are re-fetched in full, redirects not followed) | No secret patterns (publishable/anon keys are allowed; a value must look random, so kebab-case identifiers starting with `sk-` are not secrets) | Secret-looking key or `service_role` JWT; value redacted |
| `pii-leak` | Submit a canary email and phone, watch all requests | No third-party request (other origin than the target) contains the canary or its SHA-256 | Canary in a third-party URL or body |
| `verbose-errors` | Submit oversized and malformed input; scan responses and DOM | No stack traces, file paths or framework error dumps | Stack trace or internal path visible |
| `reflow-320` | Load at 320x800 | No horizontal scrolling of the page (`scrollWidth <= clientWidth + 1`) | Horizontal overflow |
| `client-only-validation` | Replay the create request (the one carrying the typed values) with one field made invalid (e.g. end before start), following no redirects | Server rejects with 4xx (a 3xx also counts as "not accepted") | Server accepts (2xx). Localhost targets only, even when the host is in `RUNHOUND_ALLOWED_HOSTS`; creates at most one test record |

### Golden files

`fixtures/kennel/expected/` holds the accepted responses:

- `clean.json`: every check `pass`, zero findings.
- `<BUG>.json` for each V0 bug: the checks that must fail (always including `detectedBy`), expected finding titles and severities, and any justified side effects.

The acceptance suite (`tests/acceptance`) starts Kennel for each mode, runs Run Hound with every scenario approved, and compares statuses and finding sets against the golden file. It ignores timings, run ids and artifact paths. In every mode it also reads every text file the run wrote (report, markdown, HTML, exported specs) and fails if any of them contains a secret planted in Kennel's bundle.
