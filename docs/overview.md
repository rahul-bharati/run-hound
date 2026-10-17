# Overview

This page covers the problem Run Hound addresses, who it's for, what it hunts for, how it works, what it produces, and how it's built and delivered.

## Problem statement

- AI can build an app from a single-line prompt, but AI-generated apps often ship with holes: untested paths, unhandled edge cases, broken flows, weak error handling and inaccessible UI. Some of these, such as gaps in auth or payment handling, can lead to data breaches or privacy issues.
- A human tester might not be able to test all the paths, i.e. golden paths and danger paths.
- Defects need to be triaged by the feature they affect and assigned a priority, which takes time to do by hand.
- Testing needs to be scoped, so the most valuable paths get tested first.
- When something breaks, QA just says "xyz broke" without the error, the state of the app when it broke, or the steps to reproduce it.

The need is documented in [docs/research.md](research.md): for example, 45% of AI-generated code samples fail security tests (Veracode 2025), and 95.9% of top home pages fail WCAG checks (WebAIM Million 2026).

## Who it's for

In priority order:

1. **Small dev teams and solo devs:** want reproducible tests and triaged defects they can drop into CI.
2. **QA testers:** want the agent to expand coverage and hand them evidence-rich reports.
3. **Vibe coders:** people building on Lovable, Bolt and similar tools, with no QA function. They need plain-language, actionable reports. They are the least likely to run Docker or a local model, so they are served later through hosted inference or a hosted runner (see [Business model](business-model.md)). What Run Hound handles on these apps today, and what it doesn't: [Works on AI-built apps](ai-built-apps.md).

## What it hunts for

- **Broken features:** dead buttons, forms that fail silently, data that looks saved but isn't, double submit, missing loading/error states, broken refresh/back/deep links, localhost URLs or undefined env vars in production builds.
- **Validation gaps:** empty, oversized or malformed input; checks enforced only in the client.
- **Accessibility:** unlabeled inputs, nameless icon buttons, clickable `div`s, removed focus outlines, broken modal focus, errors not announced, low contrast, small targets, layouts that break at 320 px, blocked paste on password fields.
- **Auth and access:** frontend-only auth, other users' data exposed (IDOR, Supabase RLS off, open Firebase rules), fields such as `role` or `plan` the server shouldn't accept, paid features unlocked without payment.
- **Leaks:** secret keys in the JS bundle, personal data sent to analytics or ad pixels, stack traces shown to users, public source maps.
- **Blind spots for non-technical builders:** tracking before cookie consent, missing security headers and cookie flags, SEO and social-preview gaps, slow pages.

Some holes can't be seen from the browser (backups, webhook signatures, dependency hygiene). Every report lists these in a **"What a browser can't see"** section ("Not visible from outside" in the web UI) as a checklist, so a clean report is never mistaken for a clean app.

Full catalog with severity and detectability: [docs/research.md §3](research.md). The [roadmap](roadmap.md#roadmap) says which of these are checked today.

## How it works

1. **Explore:** the agent drives a headless browser (Playwright) and reads the accessibility tree and DOM, signed in as a test account when you choose one. It finds the forms on the page you give it (up to 5, including forms in dialogs behind up to 3 opener buttons), their fields (native ones and common Radix/shadcn-style widgets), the buttons outside them and the page's own links. Using vision on screenshots for layout and visual checks is planned.
2. **Plan:** golden-path and danger-path test scenarios, grouped (Accessibility, Features, Security). The built-in checks that apply to each form and to the page propose the scenarios; with AI on, your model recommends and ranks them with a reason each and suggests up to 5 extra flows built only from the fields and buttons Run Hound found.
3. **Approve:** the plan is shown in a local web UI (or with `--plan-only` on the command line), where you pick the scenarios to run. Editing scenarios and adding your own is planned.
4. **Execute:** the approved scenarios run in a real browser while screenshots, console logs, network traffic and each step are captured.
5. **Report:** every finding comes with its group, severity, a plain-language explanation, reproduction steps, evidence and an exported Playwright test. With AI on, each finding also gets an **AI explanation** (labelled advisory) next to the built-in one.

### Design principles

- **AI plans and explains; real checks decide.** Pass/fail comes from Playwright assertions, axe-core rules and captured traffic in a real browser, never from a model guessing. Findings that depend on judgement (e.g. alt-text quality) are marked advisory.
- **No evidence, no finding.** Every reported defect has a screenshot and/or request/response, plus a replayable spec. Made-up defects are the biggest product risk, especially for non-technical users.
- **Build on existing tools, don't reinvent them.** Playwright (including its test agents) and axe-core do the heavy lifting; Run Hound adds exploration, approval, triage and plain-language reporting.
- **Only owned targets, safe by default.** See [Security](security.md#security).

## Output

- **Report:** HTML/Markdown, with defects triaged by feature and priority. Each finding has "What this means", "Why it matters" and "What to ask your AI to fix", plus screenshots, console and network logs, and reproduction steps.
- **Playwright tests:** a re-runnable `.spec.ts` for each scenario, using role- and label-based locators, with no agent needed at runtime, so developers can reproduce the failure and add it to CI.
- **Run record:** `report.json`, a JSON record of the plan, the steps, the evidence files and the findings. Replaying a run from it (for example for the landing-page demo) is planned.

## Tech stack

- TypeScript + Playwright, with `@axe-core/playwright` for accessibility rules
- Local web UI for approving the plan, served from the container
- Docker for delivery
- Inference (optional, bring your own model, since 0.3.0): Anthropic, OpenAI, Google Gemini, Amazon Bedrock, any OpenAI-compatible endpoint, or Ollama. Off by default; with AI off nothing is sent to any AI provider, and with it on only redacted page structure and finding text go to the endpoint you configure. See [AI (optional)](ai.md).

## Delivery

- Docker-based; no hosted platform for now.
- Users pull the Docker image (or install from source) and run it locally. AI features are optional and off by default: bring your own model, local or cloud (see [AI (optional)](ai.md)).
- The initial scope is testing localhost; later, live sites as well, mostly staging and dev, behind ownership verification.
