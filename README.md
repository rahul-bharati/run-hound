# Run Hound

AI-assisted automated UI testing agent that hunts for the holes AI-generated apps ship with.

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

Run Hound is developed and scored against **Kennel**, a deliberately broken booking app on a local Supabase with planted bugs behind toggles and a clean mode. Scoring covers planted bugs found, false positives in clean mode, stability across repeated runs, and evidence on every finding. See [docs/fixtures.md](docs/fixtures.md).

## Security

- Users must not be able to misuse Run Hound to scan websites/apps they don't own.
- localhost and private IPs are allowed by default.
- Any other domain requires ownership verification before it can be scanned: either a DNS TXT record or a nonce placed in a `<meta>` tag in the HTML header. The scan only runs where the nonce is found.
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
