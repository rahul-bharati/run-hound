# Run Hound

AI-assisted automated UI testing agent that hunts for the holes AI-generated apps ship with.

## Problem statement

- AI can build an app from a single-line prompt, but AI-generated apps often ship with holes: untested paths, unhandled edge cases, broken flows and weak error handling. Some of these, such as gaps in auth or payment handling, can lead to data breaches or privacy issues.
- A human tester might not be able to test all the paths, i.e. golden paths and danger paths.
- Defects need to be triaged by the feature they affect and assigned a priority, which takes time to do by hand.
- Testing needs to be scoped, so the most valuable paths get tested first.
- When something breaks, QA just says "xyz broke" without the error, the state of the app when it broke, or the steps to reproduce it.

## Who it's for

In priority order:

1. **Small dev teams and solo devs:** want reproducible tests and triaged defects they can drop into CI.
2. **QA testers:** want the agent to expand coverage and hand them evidence-rich reports.
3. **Vibe coders:** people building on Lovable, Bolt and similar tools, with no QA function. They need plain-language, actionable reports.

## What it hunts for

- **Broken flows:** dead buttons, forms that never submit, redirect loops, 404s.
- **Validation gaps:** empty, oversized or malformed input; only the client checks input, not the server.
- **Auth and access:** protected routes reachable while logged out, other users' data exposed (IDOR), sessions still valid after logout.
- **Error handling:** stack traces shown to users, silent failures, raw API errors on screen.
- **State bugs:** double-submit, back button after submit, refresh halfway through a flow.
- **Leaks:** secrets in the JS bundle, verbose console logs, API keys in network responses.

## Our solution to this

1. **Explore:** the agent drives a headless browser (Playwright). It reads the accessibility tree and DOM to understand what can be interacted with, and uses vision on screenshots for layout and visual checks.
2. **Plan:** it generates golden-path and danger-path test scenarios, grouped by feature and prioritized.
3. **Approve:** the plan is shown in a local web UI, where the user can review, edit, remove or add scenarios before anything runs.
4. **Execute:** the agent runs the approved scenarios and captures screenshots, console logs and network logs at every step.
5. **Report:** every defect comes with its feature, priority, steps to reproduce, evidence and an exported Playwright test.

## Output

- **Report:** HTML/Markdown, with defects triaged by feature and priority, plus screenshots, console and network logs, and reproduction steps.
- **Playwright tests:** a re-runnable `.spec.ts` for each scenario, so developers can reproduce the failure and add it to CI.

## Tech stack

- TypeScript + Playwright
- Local web UI for approving the plan, served from the container
- Docker for delivery

## Delivery

- Docker-based; no hosted platform for now.
- Users pull the Docker image and run it locally, with AI inference from a local LLM or a cloud provider such as AWS Bedrock.
- The initial scope is testing localhost; in the future, live websites as well, mostly targeting staging and dev.

## Roadmap

### V0: Single form

Point it at a form on localhost. The agent generates at least 10 scenarios (golden and danger paths), the user approves them in the web UI, the agent runs them, and it produces a report with evidence and exported Playwright tests.

### V1: Single page

Point it at a page and the agent finds every interactive element, then generates and runs test cases for them.

### V2: Single feature

Give it a feature (e.g. "signup" or "checkout") and it does end-to-end testing of that feature across pages.

### V3: Whole app

Point it at the app and let the agent do it. It discovers and prioritizes features, generates the test cases that give developers the most value in the least time, then runs e2e testing.

### V4: Public release

Open-source release, with support for testing live staging/dev sites behind ownership verification.

## Security

- Users must not be able to misuse Run Hound to scan websites/apps they don't own.
- localhost and private IPs are allowed by default.
- Any other domain requires ownership verification before it can be scanned: either a DNS TXT record or a nonce placed in a `<meta>` tag in the HTML header. The scan only runs where the nonce is found.
- No destructive actions (real payments, deleting data) unless the user explicitly opts in.

## Inference

- Local LLM via Ollama
- Cloud inference via AWS Bedrock or any OpenAI-compatible endpoint
