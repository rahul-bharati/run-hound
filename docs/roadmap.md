# Roadmap

V0 to V4 are stages of what Run Hound can test, not version numbers. Releases stay 0.x while the stages are built; 1.0.0 is the release that completes V4, and 0.9.9, right before it, is the `npx run-hound` release. Each stage heading gives its status and names the releases that built it (for V4, the release that will).

## V0: Single form (shipped, 0.1.0)

Point it at a form on localhost. Run Hound plans at least 10 scenarios from its built-in checks (golden and danger paths), the user approves them in the web UI, the agent runs them, and it produces a report with evidence and exported Playwright tests.

- Checks, in order: console/network error capture, dead controls, silent failures, persistence after reload, double submit, axe on every form state, keyboard-only completion, error announcement, paste/autofill on credential fields, bundle secret scan, PII leaks to third parties, 320 px reflow. Stretch: client-only validation (non-destructive values, localhost only). See [docs/research.md §6.1](research.md).
- Destructive actions are off by default.
- **Done when** Run Hound finds the V0 bugs planted in the [Kennel fixture](fixtures.md) and reports nothing in its clean mode.

## V1: Single page (shipped: 0.2.0, AI in 0.3.0, AI-built UIs in 0.4.0)

Point it at a page and the agent finds the interactive elements on it, then generates and runs test cases for them.

- **Built:** every form on the page (form checks per form) and the buttons outside them (`page-controls`); page-wide `security-headers`, `cookie-flags`, `cors` and `source-maps` checks, advisory (or skipped, for source maps) on dev servers, since dev servers don't show production values. Kennel has a planted bug for each (F07, S05 to S08). Contract: [docs/v1-spec.md](v1-spec.md).
- **Built in 0.3.0:** bring-your-own-model plan review, AI-suggested flows (run by the deterministic `ai-flow` check, advisory) and AI explanations of findings. Contract: [docs/ai-spec.md](ai-spec.md).
- **Built in 0.4.0:** apps built the way Lovable, Bolt and v0 build them: Radix/shadcn-style widgets, forms in dialogs and sheets, schema-validated forms, toasts and client-side routing ([Works on AI-built apps](ai-built-apps.md)). Fernway's W01-W10 bugs check it.
- Advisory checks that rely on model judgement (**planned**): alt-text quality, generic link text, placeholder/demo data.

## V2: Single feature (preview since 0.4.0)

Give it a feature (e.g. "signup" or "checkout") and it does end-to-end testing of that feature across pages.

- **Built in 0.4.0:** two test accounts you own and signed-in runs; `access-control` (can another account, or a visitor who isn't signed in, read account A's data: cross-user reads, IDOR, APIs that answer without a session behind a frontend-only sign-in); `mass-assignment` (self-promotion through `role`, `plan` or `isAdmin` fields the form never sends); `deep-links` (pages that break when opened directly). Developed against Fernway's planted bugs V01-V05. Contract: [docs/v2-spec.md](v2-spec.md).
- **Built in 0.5.0:** `csrf` (can a page on another site make A's browser change A's data), which changes only the run's own test record in account A and puts it back. Developed against Fernway's planted bug V08.
- **Built in 0.6.0:** `write-access` (can account B, or a visitor who isn't signed in, change or delete A's records, with the update and delete requests the app itself sends) and `paywall-trust` (can A get a paid plan without paying: a success page that grants it on load; the only write-side check that may change A's plan, which it puts back through the app's own cancel control); sign-in that asks for the email first and the password next, and sessions kept in sessionStorage. Developed against Fernway's planted bugs V06, V07 and V09 and its two-step and sessionStorage sign-in modes. Contract: [docs/v2-spec.md](v2-spec.md#060-write-side-checks-and-sign-in).
- **Planned:** feature testing across pages (a feature named by the user, such as "signup" or "checkout", tested end to end across its pages), the rest of the V2 stage; the two other `paywall-trust` probes (a checkout replayed with a changed price or plan, and the APIs only paid accounts use); and opt-in, throttled checks for rate limits, file upload and prompt injection in LLM features. A Supabase-backed variant of the fixture (RLS off, `USING (true)`), as described in [docs/fixtures.md](fixtures.md), is planned for later.

## V3: Whole app (planned)

Point it at the app and let the agent do it. It discovers and prioritizes features, generates the test cases that give developers the most value in the least time, then runs e2e testing.

- Adds whole-app checks: dead-link crawl, cross-browser runs, Core Web Vitals, SEO and social previews.

## V4: Live staging (planned: 1.0.0)

Support for testing live staging/dev sites behind ownership verification. Completing V4 is the 1.0.0 release.

- Adds live-host checks: exposed dotfiles, staging wired to production, mixed content, email DNS (SPF/DKIM/DMARC).

## Later

Ideas not tied to a stage or a release:

- Firebase variant of the fixture (Firebase Emulator Suite).
- Static companion check: run Supabase's database lint/advisors next to the browser run, so a finding shows both the symptom and the cause.
- **Landing-page demo:** an interactive replay of a real recorded run against Kennel: the visitor approves the plan, watches the steps, browses the findings and copies the exported spec, with a broken/clean toggle. Not a live run, so it costs nothing per visitor and scans nothing.

## Road to 1.0

Releases stay 0.x while the stages are built: V0 and V1 have shipped, V2 is in preview and V3 is planned for a 0.x release ([decision: stages are feature sets](decisions/09-2026.md#2026-09-21-stages-are-feature-sets)).

- **0.9.9** will be the `npx run-hound` release: Run Hound published as an npm package, so it starts with `npx run-hound` on your own machine, with no Docker. It is the last release before 1.0.0 ([decision: the npx release is 0.9.9](decisions/09-2026.md#2026-09-26-npx-release-is-0-9-9)).
- **1.0.0**, right after it, is the release that completes V4 (live staging).
