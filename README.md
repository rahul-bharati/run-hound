# Run Hound

AI-assisted automated UI testing agent that hunts for the holes AI-generated apps ship with.

> **V0 tester preview (0.1.0).** V0 tests one form on an app running on your own machine. If you've been asked to try it, start with **[TESTING.md](TESTING.md)**: install, a 10-minute run on the Kennel demo, testing your own app (local or Docker), reading the report, and how to send feedback. Changes: [CHANGELOG.md](CHANGELOG.md).

## Running V0 locally

V0 tests one form on a local app: point it at the form, approve the plan, watch the run, get a report with annotated evidence. Needs Node 22+ (24 recommended), pnpm (`corepack enable`) and Chromium. The tester guide, [TESTING.md](TESTING.md), covers the same steps with more detail and troubleshooting.

```sh
pnpm install
pnpm --filter run-hound exec playwright install chromium   # once, and its system deps if prompted
pnpm --filter kennel build                                 # build the demo target (Vite bundle)
```

### Ports

The defaults are Kennel on 3000 (its mock analytics service on 3001) and the Run Hound UI on 4000. Port 3000 is often taken by another dev server, so the examples below use free ports instead:

```sh
KENNEL_BUGS=all PORT=5310 ANALYTICS_PORT=5311 pnpm kennel   # Kennel on http://localhost:5310/book (KENNEL_BUGS=none for clean mode)
pnpm serve --port 4310                                      # web UI + API on http://127.0.0.1:4310
```

`PORT` and `ANALYTICS_PORT` move Kennel (the analytics port must differ from the app's, so it counts as a third party); `serve --port` moves the UI. `EADDRINUSE` means the port is taken: choose another. The examples below use these ports.

### Web UI

Open <http://localhost:4310>. The sidebar has three pages (on a narrow screen they're under **Menu**):

- **New Run**: enter `http://localhost:5310/book` (the `http://` is optional) and press **Plan checks**. The plan is grouped as **Accessibility**, **Features** and **Security** (each with a "Select all" box), and the scenarios run in that order. Press **Start run (N scenarios)**.
- **The running view** shows the numbered scenario list with each one's status and time (the current one expanded with its live steps), a counter and progress bar, the elapsed time, the browser (Chromium version), a live preview of the page under test with its address, and a timestamped activity log. **Stop run** stops it for real: the scenario in progress and the rest are marked skipped ("Stopped by you") and a report is still written. **Back to test plan** plans the same page again with the same scenarios ticked.
- **The report** (same address once the run ends): the verdict and counts, **Re-run** (runs the same scenarios on the same page again), **Open HTML report**, **Download** (report.md, report.json, specs), results you can filter (All, Passed, Issues, Skipped), and for the selected scenario its evidence, reproduction steps, key facts, what to ask your AI and the generated Playwright test.
- **Runs**: every run on this machine, newest first, including finished runs read back from the runs folder after a restart.
- **Settings**: defaults for "Allow destructive scenarios" and "Show the browser window" (saved in this browser), and the server's runs folder, allowed hosts and version.

**Show the browser window** also opens a visible Chromium window on the machine running Run Hound (it needs a display). Pages have their own addresses (`#/new`, `#/runs`, `#/runs/<id>`, `#/settings`), so reload and back work; old `#run=<id>` links still open the run. The UI refuses an empty selection, and runs at most two runs at a time.

### Command line

```sh
cd app
pnpm exec tsx src/cli.ts run http://localhost:5310/book --plan-only          # list the scenarios and their ids
pnpm exec tsx src/cli.ts run http://localhost:5310/book --approve all         # run everything
pnpm exec tsx src/cli.ts run localhost:5310/book --approve all --headed       # same, in a visible browser window
```

Options: `--approve all|default|<id,id>`, `--plan-only`, `--allow-destructive`, `--headed`, `--runs-dir <dir>`, `--json` (report on stdout; progress and the run folder on stderr). Progress lines on stderr name each group (`== Accessibility (6 scenarios; group 1 of 3) ==`), each step and each page as it loads (`> page http://…`); each scenario's result line ends with its duration, and the summary starts with `Finished in <duration>` and a line per group. `run-hound help` prints the usage, `--version` the version. `run` exits 0 with no confirmed findings (advisory findings are reported but don't fail the run), 1 with at least one confirmed finding, and 2 on an error: a refused or unreachable target, a page without a form, or an approval that names no scenarios.

### Reports and evidence

Reports land in `app/runs/<runId>/`: `report.html`, `report.md`, `report.json`, an `artifacts/` folder and a `specs/` folder of Playwright tests. Every finding carries evidence you can check without rerunning anything:

- **Frames** (`.png`): the screenshot with the element boxed and labelled, a header with the page URL, time, check and step, a caption, and a facts panel with the measured data.
- **GIFs** (`.gif`): flows such as a double-click, a Tab walk or a submit-and-reload, one annotated frame per step.
- **Cards** (`.png`): requests, responses, script excerpts and console lines, with the proving line marked.

The report says how long the run took, has a per-group table (Accessibility, Features, Security: results, findings and time) and labels each finding with its group. It also lists every scenario that ran, under its group, with its result, duration and notes (why it errored or was skipped), the planned scenarios you did not approve, checks that had nothing to test on the form, and the pages tested. Evidence text is redacted; pixels can't be, so a page that shows a secret shows it in its screenshots and in the live view.

The exported specs need `@playwright/test` in the project that runs them (`npm i -D @playwright/test`, plus `@axe-core/playwright` for the axe-states specs); run one with `npx playwright test <file>`. Runs create a few test records in the target app (each scenario's description says when); Run Hound doesn't delete them.

### Containers

Both services in containers (host ports bound to `127.0.0.1`; Podman works with `podman-compose`):

```sh
mkdir -p runs                    # reports land in ./runs; create it first so the files belong to you
docker compose up --build        # UI on http://localhost:4000, target http://kennel:3000/book
RUNHOUND_HOST_PORT=4400 KENNEL_HOST_PORT=5310 KENNEL_ANALYTICS_HOST_PORT=5311 docker compose up --build   # other host ports
docker compose run --rm run-hound run http://kennel:3000/book --approve all                          # the CLI in a container
```

Reports are written to `./runs/<runId>/` on your machine (the CLI prints the container path, `/repo/app/runs/<runId>`); the image runs as the owner of that folder, or as its non-root user when nothing is mounted. In the containers the target is `kennel`, not localhost, so the `client-only-validation` scenario (localhost only) is planned but skipped, and the report says why. **Show the browser window** needs a display, so it doesn't work in a container.

To test an app running on your machine from a container:

- **Linux**: share the host's network, so `localhost` is your machine and nothing in your app changes:
  ```sh
  docker run --rm --init --network host -v "$PWD/runs:/repo/app/runs" rahulrbharati/run-hound:0.1.0 run http://localhost:5173/signup --approve all
  ```
  For the UI this way, bind it to loopback: `... rahulrbharati/run-hound:0.1.0 serve --host 127.0.0.1 --port 4310`.
- **Docker Desktop (Mac, Windows) or the compose UI**: enter `http://host.docker.internal:<port>/<page>`. In a container `localhost` is the container itself. Your dev server must listen on all interfaces (`vite --host`) and accept that host name (Vite `server.allowedHosts`, Next.js `allowedDevOrigins`); a frontend that calls its API on `localhost:<apiPort>` won't work this way. The compose file allows `host.docker.internal` and `host.containers.internal` through the safety gate with `RUNHOUND_ALLOWED_HOSTS`. Details in [TESTING.md](TESTING.md#test-your-own-app).

### Safety

The target must be `localhost`, a private address, or listed in `RUNHOUND_ALLOWED_HOSTS` (which skips the address check with no ownership check, so list only hosts you own); the browser is pinned to the address the gate approved and is stopped if a page navigates off it; requests a check replays or re-fetches are sent from the page, so they get the same pinning. Destructive scenarios only run with `--allow-destructive`. The UI and API answer only on loopback names and IP addresses; add others with `RUNHOUND_SERVER_HOSTS`.

### Running the suites

```sh
pnpm --filter run-hound test                  # unit + browser tests for the engine and checks
pnpm --filter run-hound exec tsc --noEmit
pnpm --filter kennel test                     # Kennel's own tests (clean mode and every bug)
pnpm test:acceptance                          # Run Hound against Kennel, clean mode and every planted bug
```

The suites pick random free ports, so they don't collide with anything already running. CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs the type-check and all three suites on every push and pull request.

## Problem statement

- AI can build an app from a single-line prompt, but AI-generated apps often ship with holes: untested paths, unhandled edge cases, broken flows, weak error handling and inaccessible UI. Some of these, such as gaps in auth or payment handling, can lead to data breaches or privacy issues.
- A human tester might not be able to test all the paths, i.e. golden paths and danger paths.
- Defects need to be triaged by the feature they affect and assigned a priority, which takes time to do by hand.
- Testing needs to be scoped, so the most valuable paths get tested first.
- When something breaks, QA just says "xyz broke" without the error, the state of the app when it broke, or the steps to reproduce it.

The need is documented in [docs/research.md](docs/research.md): for example, 45% of AI-generated code samples fail security tests (Veracode 2025), and 95.9% of top home pages fail WCAG checks (WebAIM Million 2026).

## Who it's for

In priority order:

1. **Small dev teams and solo devs:** want reproducible tests and triaged defects they can drop into CI.
2. **QA testers:** want the agent to expand coverage and hand them evidence-rich reports.
3. **Vibe coders:** people building on Lovable, Bolt and similar tools, with no QA function. They need plain-language, actionable reports. They are the least likely to run Docker and a local LLM, so they are served later through hosted inference or a hosted runner (see [Business model](#license-and-business-model)).

## What it hunts for

- **Broken features:** dead buttons, forms that fail silently, data that looks saved but isn't, double submit, missing loading/error states, broken refresh/back/deep links, localhost URLs or undefined env vars in production builds.
- **Validation gaps:** empty, oversized or malformed input; checks enforced only in the client.
- **Accessibility:** unlabeled inputs, nameless icon buttons, clickable `div`s, removed focus outlines, broken modal focus, errors not announced, low contrast, small targets, layouts that break at 320 px, blocked paste on password fields.
- **Auth and access:** frontend-only auth, other users' data exposed (IDOR, Supabase RLS off, open Firebase rules), paid features unlocked without payment.
- **Leaks:** secret keys in the JS bundle, personal data sent to analytics or ad pixels, stack traces shown to users, public source maps.
- **Blind spots for non-technical builders:** tracking before cookie consent, missing security headers and cookie flags, SEO and social-preview gaps, slow pages.

Some holes can't be seen from the browser (backups, webhook signatures, dependency hygiene). Every report lists these in a **"Not visible from outside"** section as a checklist, so a clean report is never mistaken for a clean app.

Full catalog with severity and detectability: [docs/research.md §3](docs/research.md).

## How it works

1. **Explore:** the agent drives a headless browser (Playwright). It reads the accessibility tree and DOM first, and uses vision on screenshots only for layout and visual checks.
2. **Plan:** it generates golden-path and danger-path test scenarios, grouped by feature and prioritized.
3. **Approve:** the plan is shown in a local web UI, where the user can review, edit, remove or add scenarios before anything runs.
4. **Execute:** the approved scenarios run while screenshots, console logs and network logs are captured at every step.
5. **Report:** every defect comes with its feature, priority, plain-language explanation, steps to reproduce, evidence and an exported Playwright test.

### Design principles

- **The LLM plans and explains; deterministic checks decide.** Pass/fail comes from Playwright assertions, axe-core rules and captured traffic, never from model judgement. Findings that depend on judgement (e.g. alt-text quality) are marked advisory.
- **No evidence, no finding.** Every reported defect has a screenshot and/or request/response, plus a replayable spec. Made-up defects are the biggest product risk, especially for non-technical users.
- **Build on existing tools, don't reinvent them.** Playwright (including its test agents) and axe-core do the heavy lifting; Run Hound adds exploration, approval, triage and plain-language reporting.
- **Only owned targets, safe by default.** See [Security](#security).

## Output

- **Report:** HTML/Markdown, with defects triaged by feature and priority. Each finding has "What this means", "Why it matters" and "What to ask your AI to fix", plus screenshots, console and network logs, and reproduction steps.
- **Playwright tests:** a re-runnable `.spec.ts` for each scenario, using role- and label-based locators, with no agent needed at runtime, so developers can reproduce the failure and add it to CI.
- **Run recording:** a JSON record of the plan, steps, screenshots and findings, used for replay (including the landing-page demo).

## Tech stack

- TypeScript + Playwright, with `@axe-core/playwright` for accessibility rules
- Local web UI for approving the plan, served from the container
- Docker for delivery
- Inference: local LLM via Ollama, or cloud via AWS Bedrock or any OpenAI-compatible endpoint

## Delivery

- Docker-based; no hosted platform for now.
- Users pull the Docker image and run it locally, bringing their own model (local or cloud).
- The initial scope is testing localhost; later, live sites as well, mostly staging and dev, behind ownership verification.

## Roadmap

### V0: Single form

Point it at a form on localhost. The agent generates at least 10 scenarios (golden and danger paths), the user approves them in the web UI, the agent runs them, and it produces a report with evidence and exported Playwright tests.

- Checks, in order: console/network error capture, dead controls, silent failures, persistence after reload, double submit, axe on every form state, keyboard-only completion, error announcement, paste/autofill on credential fields, bundle secret scan, PII leaks to third parties, 320 px reflow. Stretch: client-only validation (non-destructive values, localhost only). See [docs/research.md §6.1](docs/research.md).
- Destructive actions are off by default.
- **Done when** Run Hound finds the V0 bugs planted in the [Kennel fixture](docs/fixtures.md) and reports nothing in its clean mode.

### V1: Single page

Point it at a page and the agent finds every interactive element, then generates and runs test cases for them.

- Adds: response headers and cookie flags, CORS and source-map checks (on production builds, since dev servers don't show production values).
- Advisory checks that rely on LLM judgement: alt-text quality, generic link text, placeholder/demo data.

### V2: Single feature

Give it a feature (e.g. "signup" or "checkout") and it does end-to-end testing of that feature across pages.

- **Headline:** access checks with two owned test accounts: cross-user reads, RLS off or `USING (true)`, frontend-only auth, IDOR, self-promotion via mass assignment, paid features without payment. Developed against Kennel's local Supabase.
- Adds: rate-limit checks, prompt injection in LLM features, file upload, all opt-in and throttled.

### V3: Whole app

Point it at the app and let the agent do it. It discovers and prioritizes features, generates the test cases that give developers the most value in the least time, then runs e2e testing.

- Adds whole-app checks: dead-link crawl, cross-browser runs, Core Web Vitals, SEO and social previews.

### V4: Public release

Open-source release, with support for testing live staging/dev sites behind ownership verification.

- Adds live-host checks: exposed dotfiles, staging wired to production, mixed content, email DNS (SPF/DKIM/DMARC).

### Later

- Firebase variant of the fixture (Firebase Emulator Suite).
- Static companion check: run Supabase's database lint/advisors next to the browser run, so a finding shows both the symptom and the cause.
- **Landing-page demo:** an interactive replay of a real recorded run against Kennel: the visitor approves the plan, watches the steps, browses the findings and copies the exported spec, with a broken/clean toggle. Not a live run, so it costs nothing per visitor and scans nothing.

## Test fixture

Run Hound is developed and scored against **Kennel**, a deliberately broken booking app with planted bugs behind toggles and a clean mode. The V0 Kennel is a single booking form (`/book`) on a small in-memory Node server with a mock analytics service ([fixtures/kennel/CONTRACT.md](fixtures/kennel/CONTRACT.md), [bugs.json](fixtures/kennel/bugs.json)); the multi-page version on a local Supabase described in [docs/fixtures.md](docs/fixtures.md) is planned for V2. Scoring covers planted bugs found, false positives in clean mode, stability across repeated runs, and evidence on every finding.

## Security

- Users must not be able to misuse Run Hound to scan websites/apps they don't own.
- localhost and private IPs are allowed by default.
- Any other domain requires ownership verification before it can be scanned: either a DNS TXT record or a nonce placed in a `<meta>` tag in the HTML header. The scan only runs where the nonce is found.
- Status in V0: ownership verification isn't built yet. Other hosts are refused unless listed in `RUNHOUND_ALLOWED_HOSTS`, which is not checked for ownership, so list only hosts you own.
- No destructive actions (real payments, deleting data) unless the user explicitly opts in.
- Reports redact any secrets they find; keys are never used or tested.

## License and business model

- **Planned license: Apache-2.0** for the core.
- The open core includes every check, the approval UI, reports, Playwright export, BYO-LLM support and the Kennel fixture. **Checks are never paywalled.**
- A possible paid tier (later, only after demand is validated) would cover things that run on our servers: hosted inference, a hosted runner, team dashboards, CI integration and compliance exports. It would be unlocked with an API key passed to the Docker container; without a key, the core runs fully.

Details: [docs/business-model.md](docs/business-model.md).

## Docs

- [docs/research.md](docs/research.md): market need, competition, gap catalog and scope mapping
- [docs/research-data.json](docs/research-data.json): fact-checked research data behind the report
- [docs/fixtures.md](docs/fixtures.md): the Kennel test fixture and scoring
- [docs/business-model.md](docs/business-model.md): open core vs paid, licensing and API keys
