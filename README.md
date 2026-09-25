# Run Hound

AI-assisted UI testing for AI-built apps: it hunts for the holes AI-generated apps ship with, and backs every verdict with a real check in a real browser and the evidence to prove it.

**AI plans and explains; real checks decide.** Since 0.3.0 you can bring your own model (Ollama, LM Studio, llama.cpp, vLLM, any OpenAI-compatible endpoint, or Amazon Bedrock) to review the plan, suggest extra flows and explain findings. AI is **off by default**; without it the plan comes from Run Hound's built-in checks and nothing is sent to any AI provider. See [AI (optional)](#ai-optional).

> **V1 open-source preview (0.3.0): single page, optional AI.** V1 tests a whole page of an app running on your own machine: every form on it, the buttons outside them, and page-wide checks for security headers, session cookies, CORS and public source maps; 0.3.0 adds optional AI planning and explanations with your own model. The repository is public: anyone can clone it, try it and [file an issue](https://github.com/rahul-bharati/run-hound/issues/new/choose). To try it, start with **[TESTING.md](TESTING.md)**: install, a 10-minute run on the Kennel demo, testing your own app (local or Docker), reading the report, and how to send feedback. Changes: [CHANGELOG.md](CHANGELOG.md).
>
> **Quickest start:** `cp .env.example .env && mkdir -p runs && docker compose up --build` (or `podman compose up --build`) starts Run Hound on <http://localhost:4000> together with every test app: Kennel (broken and clean) and four well-built sample apps. See [Containers](#containers).

## Running V1 locally

V1 tests one page of a local app: point it at the page, and Run Hound finds every form and control on it, plans the form checks for each form plus the page-wide checks, you approve the plan, watch the run, and get a report with annotated evidence. Needs Node 22+ (24 recommended), pnpm (`corepack enable`) and Chromium. The step-by-step guide, [TESTING.md](TESTING.md), covers the same steps with more detail and troubleshooting.

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

- **New Run**: enter `http://localhost:5310/book` (the `http://` is optional) and press **Plan checks**. A strip above the plan shows what was found: each form with its fields and buttons, the controls outside the forms, and the whole page. The plan is grouped as **Accessibility**, **Features** and **Security** (each with a "Select all" box), and the scenarios run in that order. Press **Start run (N scenarios)**.
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

The plan lists each scenario with what it tests (`[Book a sitter form]`, `[Whole page]`). Options: `--approve all|default|<id,id>`, `--plan-only`, `--allow-destructive`, `--headed`, `--runs-dir <dir>`, `--json` (report on stdout; progress and the run folder on stderr). Progress lines on stderr name each group (`== Accessibility (6 scenarios; group 1 of 3) ==`), each step and each page as it loads (`> page http://…`); each scenario's result line ends with its duration, and the summary starts with `Finished in <duration>` and a line per group. `run-hound help` prints the usage, `--version` the version. `run` exits 0 with no confirmed findings (advisory findings are reported but don't fail the run), 1 with at least one confirmed finding, and 2 on an error: a refused or unreachable target, an error page (such as a 404), or an approval that names no scenarios. A page without a form is planned with the page-wide checks only, with a warning.

### Reports and evidence

Reports land in `app/runs/<runId>/`: `report.html`, `report.md`, `report.json`, an `artifacts/` folder and a `specs/` folder of Playwright tests. Every finding carries evidence you can check without rerunning anything:

- **Frames** (`.png`): the screenshot with the element boxed and labelled, a header with the page URL, time, check and step, a caption, and a facts panel with the measured data.
- **GIFs** (`.gif`): flows such as a double-click, a Tab walk or a submit-and-reload, one annotated frame per step.
- **Cards** (`.png`): requests, responses, script excerpts and console lines, with the proving line marked.

The report says how long the run took, has a per-group table (Accessibility, Features, Security: results, findings and time) and labels each finding with its group. It also lists every scenario that ran, under its group, with its result, duration and notes (why it errored or was skipped), the planned scenarios you did not approve, checks that had nothing to test on the form, and the pages tested. Evidence text is redacted; pixels can't be, so a page that shows a secret shows it in its screenshots and in the live view.

The exported specs need `@playwright/test` in the project that runs them (`npm i -D @playwright/test`, plus `@axe-core/playwright` for the axe-states specs); run one with `npx playwright test <file>`. Runs create a few test records in the target app (each scenario's description says when); Run Hound doesn't delete them.

### AI (optional)

AI is off until you turn it on. A model **reviews the plan** (recommends and ranks each scenario with a one-line reason), **suggests up to 5 extra flows** (steps that only use the fields and buttons Run Hound found, checked by deterministic assertions; unticked by default, findings advisory) and **explains findings** in plain words. It never decides pass or fail, and if it fails or times out you get the built-in plan with a warning.

**Web UI:** open **Settings → AI**, pick a provider (Ollama, LM Studio, another OpenAI-compatible endpoint, or Amazon Bedrock), choose a model from the dropdown (it lists what the server has; **Other…** takes any id), press **Test connection**, then **Save**. New Run then shows **Review with AI**.

**Command line:**

```sh
cd app
pnpm exec tsx src/cli.ts ai status                                    # the effective settings and what's missing
pnpm exec tsx src/cli.ts run localhost:5310/book --ai --ai-provider ollama --ai-model qwen3:8b --plan-only
pnpm exec tsx src/cli.ts ai test                                      # one small call to check the model answers
```

Settings come from the Settings page (saved to `~/.config/run-hound/ai.json`, mode 0600), then `RUNHOUND_AI_*` environment variables, then `--ai*` flags; the full list is in [docs/ai-spec.md](docs/ai-spec.md) and `.env.example`.

**Privacy:** only redacted page structure is sent (the page title and path, field labels and types, option labels, button names, the scenario list; the full page address only to a local model), never typed values, cookies, response bodies or screenshots. A local endpoint (localhost or a private address) needs nothing more; a remote one (OpenAI, OpenRouter, Bedrock, …) is refused until you consent (the Settings checkbox, `--ai-allow-remote` or `RUNHOUND_AI_ALLOW_REMOTE=1`). API keys stay on the server and never appear in the UI or reports. Bedrock takes a Bedrock API key, AWS access keys, or an AWS profile from `~/.aws` (`RUNHOUND_AI_AWS_PROFILE` or `AWS_PROFILE`; static keys, `credential_process` or IAM Identity Center after `aws sso login`; assume-role profiles aren't supported yet).

**Models:** small local models work (tested with a 9B model on Ollama). Ollama is called through its native API with thinking turned off, so reasoning models answer without spending their output on thinking, and asked to keep the model loaded for 15 minutes so it is still there for the explanations after the run. An explanation that times out is retried once; after two timeouts in a row the rest are skipped with a warning (raise `RUNHOUND_AI_TIMEOUT_MS` for a slow model). With other servers, prefer a non-reasoning model or turn reasoning off.

### Containers

Run Hound and every test app in containers (host ports bound to `127.0.0.1`; Podman works with `podman compose` or `podman-compose`):

```sh
cp .env.example .env             # optional: host ports, KENNEL_BUGS, allowed hosts, runs folder (all have defaults)
mkdir -p runs                    # reports land in ./runs; create it first so the files belong to you
docker compose up --build        # UI on http://localhost:4000 (or `docker compose pull && docker compose up` for the published images)
docker compose run --rm run-hound run http://kennel:3000/book --approve all   # the CLI in a container
```

Targets to enter in the UI (inside the compose network, apps are reached by service name):

| Target | What it is |
|---|---|
| `http://kennel:3000/book` | Kennel with the bugs in `KENNEL_BUGS` (default: every V0 and V1 bug) |
| `http://kennel-clean:3000/book` | Kennel in clean mode: every check should pass |
| `http://classic-post:4101/signup` | Sample: server-rendered sign-up form, no JavaScript |
| `http://spa-fetch:4102/` | Sample: vanilla-JS contact form, same-origin JSON API |
| `http://login:4103/` | Sample: sign-in form (401 on wrong credentials) |
| `http://cross-origin-api:4104/` | Sample: RSVP form whose API is on another origin |
| `http://multi-form:4106/` | Sample: three forms on one page (search, contact, newsletter) and buttons outside them |

The samples are well built on purpose, so any confirmed finding on them is a false positive. [`.env.example`](.env.example) documents every setting.

Reports are written to `./runs/<runId>/` on your machine (the CLI prints the container path, `/repo/app/runs/<runId>`); the image runs as the owner of that folder, or as its non-root user when nothing is mounted. In the containers the target is `kennel`, not localhost, so the `client-only-validation` scenario (localhost only) is planned but skipped, and the report says why. **Show the browser window** needs a display, so it doesn't work in a container.

To test an app running on your machine from a container:

- **Linux**: share the host's network, so `localhost` is your machine and nothing in your app changes:
  ```sh
  docker pull ghcr.io/rahul-bharati/run-hound:0.3.0   # or build it here: docker compose build run-hound
  docker run --rm --init --network host -v "$PWD/runs:/repo/app/runs" ghcr.io/rahul-bharati/run-hound:0.3.0 run http://localhost:5173/signup --approve all
  ```
  For the UI this way, bind it to loopback: `... ghcr.io/rahul-bharati/run-hound:0.3.0 serve --host 127.0.0.1 --port 4310`.
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
3. **Vibe coders:** people building on Lovable, Bolt and similar tools, with no QA function. They need plain-language, actionable reports. They are the least likely to run Docker or a local model, so they are served later through hosted inference or a hosted runner (see [Business model](#license-and-business-model)).

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

1. **Explore:** the agent drives a headless browser (Playwright) and reads the accessibility tree and DOM. In V1 it finds every form on the page you give it (up to 5) and the buttons outside them. Using vision on screenshots for layout and visual checks is planned.
2. **Plan:** golden-path and danger-path test scenarios, grouped (Accessibility, Features, Security). The built-in checks that apply to each form and to the page propose the scenarios; with AI on, your model recommends and ranks them with a reason each and suggests up to 5 extra flows built only from the fields and buttons Run Hound found.
3. **Approve:** the plan is shown in a local web UI (or with `--plan-only` on the command line), where you pick the scenarios to run. Editing scenarios and adding your own is planned.
4. **Execute:** the approved scenarios run in a real browser while screenshots, console logs, network traffic and each step are captured.
5. **Report:** every finding comes with its group, severity, a plain-language explanation, reproduction steps, evidence and an exported Playwright test. With AI on, each finding also gets an **AI explanation** (labelled advisory) next to the built-in one.

### Design principles

- **AI plans and explains; real checks decide.** Pass/fail comes from Playwright assertions, axe-core rules and captured traffic in a real browser, never from a model guessing. Findings that depend on judgement (e.g. alt-text quality) are marked advisory.
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
- Inference (optional, bring your own model, since 0.3.0): local via Ollama, LM Studio, llama.cpp or vLLM, or cloud via Amazon Bedrock or any OpenAI-compatible endpoint. Off by default; with AI off nothing is sent to any AI provider, and with it on only redacted page structure goes to the endpoint you configure. See [AI (optional)](#ai-optional).

## Delivery

- Docker-based; no hosted platform for now.
- Users pull the Docker image (or install from source) and run it locally. AI features are optional and off by default: bring your own model, local or cloud (see [AI (optional)](#ai-optional)).
- The initial scope is testing localhost; later, live sites as well, mostly staging and dev, behind ownership verification.

## Roadmap

### V0: Single form (shipped, 0.1.0)

Point it at a form on localhost. Run Hound plans at least 10 scenarios from its built-in checks (golden and danger paths), the user approves them in the web UI, the agent runs them, and it produces a report with evidence and exported Playwright tests.

- Checks, in order: console/network error capture, dead controls, silent failures, persistence after reload, double submit, axe on every form state, keyboard-only completion, error announcement, paste/autofill on credential fields, bundle secret scan, PII leaks to third parties, 320 px reflow. Stretch: client-only validation (non-destructive values, localhost only). See [docs/research.md §6.1](docs/research.md).
- Destructive actions are off by default.
- **Done when** Run Hound finds the V0 bugs planted in the [Kennel fixture](docs/fixtures.md) and reports nothing in its clean mode.

### V1: Single page (current preview, 0.3.0)

Point it at a page and the agent finds every interactive element, then generates and runs test cases for them.

- **Built:** every form on the page (form checks per form) and the buttons outside them (`page-controls`); page-wide `security-headers`, `cookie-flags`, `cors` and `source-maps` checks, advisory (or skipped, for source maps) on dev servers, since dev servers don't show production values. Kennel has a planted bug for each (F07, S05 to S08). Contract: [docs/v1-spec.md](docs/v1-spec.md).
- **Built in 0.3.0:** bring-your-own-model plan review, AI-suggested flows (run by the deterministic `ai-flow` check, advisory) and AI explanations of findings. Contract: [docs/ai-spec.md](docs/ai-spec.md).
- Advisory checks that rely on model judgement (**planned**): alt-text quality, generic link text, placeholder/demo data.

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
- Status in V1: ownership verification isn't built yet. Other hosts are refused unless listed in `RUNHOUND_ALLOWED_HOSTS`, which is not checked for ownership, so list only hosts you own.
- No destructive actions (real payments, deleting data) unless the user explicitly opts in.
- Reports redact any secrets they find; keys are never used or tested.

## License and business model

- **License: [MIT](LICENSE)** for the core.
- The open core includes every check, the approval UI, reports, Playwright export, bring-your-own-model support and the Kennel fixture. **Checks are never paywalled.**
- A possible paid tier (later, only after demand is validated) would cover things that run on our servers: hosted inference, a hosted runner, team dashboards, CI integration and compliance exports. It would be unlocked with an API key passed to the Docker container; without a key, the core runs fully.

Details: [docs/business-model.md](docs/business-model.md).

## Docs

- [docs/research.md](docs/research.md): market need, competition, gap catalog and scope mapping
- [docs/research-data.json](docs/research-data.json): fact-checked research data behind the report
- [docs/fixtures.md](docs/fixtures.md): the Kennel test fixture and scoring
- [docs/v0-spec.md](docs/v0-spec.md) and [docs/v1-spec.md](docs/v1-spec.md): the build contracts for V0 (single form) and V1 (single page)
- [docs/business-model.md](docs/business-model.md): open core vs paid, licensing and API keys
