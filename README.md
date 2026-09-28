# Run Hound

Open-source, AI-assisted UI testing for AI-built apps. Real checks in a real browser, with evidence and a Playwright test for every finding.

**Site and docs: [run-hound.rahulbharati.com](https://run-hound.rahulbharati.com/)**: the [quick start](https://run-hound.rahulbharati.com/docs/quick-start/), [every check](https://run-hound.rahulbharati.com/checks/) and the [docs](https://run-hound.rahulbharati.com/docs/).

**AI plans and explains; real checks decide.** Since 0.3.0 you can bring your own model (Ollama, LM Studio, llama.cpp, vLLM, any OpenAI-compatible endpoint, or Amazon Bedrock) to review the plan, suggest extra flows and explain findings. See [Optional AI](https://run-hound.rahulbharati.com/docs/ai/).

> **V2 preview (0.6.0): signed-in runs, access checks and write-side checks; works on AI-built UIs.** Run Hound tests one page of an app running on your own machine. New in 0.4.0: it can sign in as one of two test accounts you own, test pages behind the sign-in, and check that another account, or a visitor who isn't signed in, can't read the first account's data. New in 0.5.0: an opt-in check that another website can't change it (CSRF). New in 0.6.0: opt-in checks that another account or a signed-out visitor can't change or delete it, and that a paid plan needs a real payment; and sign-in to apps that ask for the email first or keep their session in sessionStorage.
>
> The repository is public: anyone can try it, read the code and [file an issue](https://github.com/rahul-bharati/run-hound/issues/new/choose). To try it, start with **[TESTING.md](TESTING.md)**: the short version for alpha testers, install (Docker, no clone, or from source), a 10-minute run on the Kennel demo, testing your own app, signed-in runs, reading the report, and how to send feedback. Changes: [CHANGELOG.md](CHANGELOG.md).

## Quick start

The main way needs only Docker or Podman and no clone: pull the image and run it. The image has Run Hound's web UI, its command line and Chromium. In any folder:

```sh
docker pull ghcr.io/rahul-bharati/run-hound
mkdir -p runs                    # reports land in ./runs; create it first so the files belong to you
docker run --rm --init -p 127.0.0.1:4000:4000 --add-host host.docker.internal:host-gateway \
  -v "$PWD/runs:/repo/app/runs" ghcr.io/rahul-bharati/run-hound
```

Then open <http://localhost:4000> and enter a page of an app on your machine as `http://host.docker.internal:<port>/<page>`. Your dev server must accept that host name (see [Test your app](https://run-hound.rahulbharati.com/docs/your-app/)). Podman: the same with `podman`. Reports land in `./runs`.

The Windows PowerShell notes and installing from source are in [Install](https://run-hound.rahulbharati.com/docs/install/), and the command line in a container in [CLI and CI](https://run-hound.rahulbharati.com/docs/cli/).

## Try it on the demo apps

One compose file starts Run Hound with every test app: Kennel (broken and clean), Fernway (a Lovable-style SaaS app, clean and with planted bugs) and five well-built sample apps. In an empty folder:

```sh
curl -fsSLO https://raw.githubusercontent.com/rahul-bharati/run-hound/v0.6.0/run-hound.compose.yml
mkdir -p runs                                  # reports land in ./runs; create it first so the files belong to you
docker compose -f run-hound.compose.yml up     # UI on http://localhost:4000 (Podman: podman compose -f run-hound.compose.yml up)
```

Open <http://localhost:4000> and enter `http://kennel:3000/book`; the other targets are listed in [the test lab](https://run-hound.rahulbharati.com/docs/test-lab/#apps). The first start downloads about 0.5 GB. Settings, stopping, updating and the command line in the lab: [the test lab](https://run-hound.rahulbharati.com/docs/test-lab/).

## What it checks

- **Forms and the controls outside them:** every form on the page (up to 5, including forms in dialogs and sheets) and the buttons outside them: dead buttons, forms that fail silently, data that looks saved but isn't, double submit, console errors and failed requests, checks enforced only in the client.
- **Accessibility:** the axe-core WCAG 2.2 AA rules on every form state, keyboard-only completion, removed focus outlines, errors not announced, blocked paste on password fields, layouts that break at 320 px.
- **Page-wide security:** security headers, session cookie flags, CORS and public source maps, advisory (or skipped, for source maps) on dev servers, since dev servers don't show production values.
- **Leaks:** secret keys in the JS bundle, personal data sent to analytics or ad pixels, stack traces shown to users.
- **Signed in, as test accounts you own:** can another account, or a visitor who isn't signed in, read account A's data (`access-control`); does the server store `role`, `plan` or `isAdmin` fields the form never sends (`mass-assignment`); do the app's own pages load when opened directly (`deep-links`, signed in or not); and three opt-in write-side checks, which change A's data and put it back: can another account or a signed-out visitor change or delete A's records (`write-access`), can another website change them (`csrf`), and can A get a paid plan without paying (`paywall-trust`). See [Signed-in runs](https://run-hound.rahulbharati.com/docs/signed-in-runs/).
- **AI-built UIs:** apps from Lovable, Bolt, v0 and similar tools: Radix/shadcn, Headless UI, cmdk and MUI widgets, forms in dialogs and sheets, schema-validated forms, toasts and client-side routing. See [Works on AI-built apps](docs/ai-built-apps.md).

Some holes can't be seen from the browser (backups, webhook signatures, dependency hygiene). Every report lists these in a **"What a browser can't see"** section ("Not visible from outside" in the web UI) as a checklist, so a clean report is never mistaken for a clean app.

Every check, in plain words: [TESTING.md](TESTING.md#the-checks). The full catalog, including what is planned: [What it hunts for](docs/overview.md#what-it-hunts-for).

## How it works

1. **Explore:** the agent drives a headless browser (Playwright) and reads the accessibility tree and DOM, signed in as a test account when you choose one.
2. **Plan:** golden-path and danger-path test scenarios, grouped (Accessibility, Features, Security).
3. **Approve:** the plan is shown in a local web UI (or with `--plan-only` on the command line), where you pick the scenarios to run.
4. **Execute:** the approved scenarios run in a real browser while screenshots, console logs, network traffic and each step are captured.
5. **Report:** every finding comes with its group, severity, a plain-language explanation, reproduction steps, evidence and an exported Playwright test.

**No evidence, no finding.** Every reported defect has a screenshot and/or request/response, plus a replayable spec. More: [How it works](docs/overview.md#how-it-works).

## Documentation

| Document | What it covers |
|---|---|
| [TESTING.md](TESTING.md) | How to try it, step by step, and how to send feedback |
| [Docs](https://run-hound.rahulbharati.com/docs/) on the site | The quick start, installing (Docker, Podman, from source), the test lab, testing your own app, signed-in runs, optional AI, reading the report, the command line and CI, safety, known limitations, a glossary and troubleshooting |
| [Checks](https://run-hound.rahulbharati.com/checks/) on the site | Every built-in check: what it tests, why it matters, and a real finding with its Playwright test |
| [docs/ai-built-apps.md](docs/ai-built-apps.md) | What Run Hound handles on apps from Lovable, Bolt, v0 and similar tools, and its limits |
| [docs/security.md](docs/security.md) | Safety (the target gate, destructive scenarios, the UI and API) and security rules |
| [docs/overview.md](docs/overview.md) | Problem statement, who it's for, what it hunts for, how it works, output, tech stack and delivery |
| [docs/roadmap.md](docs/roadmap.md) | V0 to V4, later, and the road to 1.0 |
| [docs/development.md](docs/development.md) | Running the test suites, the test fixtures, and recording decisions |
| [CHANGELOG.md](CHANGELOG.md) | What changed in each release |
| [DECISIONS.md](DECISIONS.md) | The append-only decision log: why Run Hound is the way it is |
| [docs/v0-spec.md](docs/v0-spec.md), [docs/v1-spec.md](docs/v1-spec.md), [docs/v2-spec.md](docs/v2-spec.md) | The build contracts for V0 (single form), V1 (single page) and the V2 preview (signed-in runs, access checks and the write-side checks) |
| [docs/ai-spec.md](docs/ai-spec.md) | Optional AI (0.3.0): providers, settings, privacy and consent rules |
| [docs/app-ui-spec.md](docs/app-ui-spec.md) | The local web UI |
| [docs/fixtures.md](docs/fixtures.md) | The Kennel test fixture, its planned Supabase variant, and scoring |
| [fixtures/fernway/README.md](fixtures/fernway/README.md) | The Fernway test app, its accounts and planted bugs |
| [docs/research.md](docs/research.md) | Market need, competition, gap catalog and scope mapping |
| [docs/research-data.json](docs/research-data.json) | Fact-checked research data behind the report |
| [docs/brand.md](docs/brand.md) | Palette, type, logo and voice |
| [docs/business-model.md](docs/business-model.md) | Open core vs paid, licensing and API keys |

## Roadmap

V0 to V4 are stages of what Run Hound can test, not version numbers: releases stay 0.x while they are built, and 1.0.0 is the release that completes V4 ([decision](docs/decisions/09-2026.md#2026-09-21-stages-are-feature-sets)).

- **V0: Single form** (shipped, 0.1.0) and **V1: Single page** (shipped: 0.2.0, AI in 0.3.0, AI-built UIs in 0.4.0).
- **V2: Single feature** (preview since 0.4.0): signed-in runs and the access checks in 0.4.0, `csrf` in 0.5.0, and `write-access`, `paywall-trust` and two-step and sessionStorage sign-in in 0.6.0; feature testing across pages, the rest of V2, is planned.
- **V3: Whole app** (planned) and **V4: Live staging**, behind ownership verification (planned: 1.0.0).
- 0.9.9, right before 1.0.0, will be the `npx run-hound` release, with no Docker ([Road to 1.0](docs/roadmap.md#road-to-10); [decision](docs/decisions/09-2026.md#2026-09-26-npx-release-is-0-9-9)). Details: [Roadmap](docs/roadmap.md).

## Contributing

To contribute, or to watch the browser in a window, install it [from source](https://run-hound.rahulbharati.com/docs/install/#from-source). The test suites and the test fixtures are in [Development](docs/development.md). Every decision goes in the append-only decision log, [DECISIONS.md](DECISIONS.md).

## Security

The target must be `localhost`, a private address, or listed in `RUNHOUND_ALLOWED_HOSTS` (which skips the address check with no ownership check, so list only hosts you own). No destructive actions (real payments, deleting data) unless the user explicitly opts in. Reports redact any secrets they find; keys are never used or tested.

Details: [Safety and security](docs/security.md).

## Feedback

Open an issue: <https://github.com/rahul-bharati/run-hound/issues/new/choose>. What to include, and how to share a report safely: [Sending feedback](TESTING.md#sending-feedback).

## License

- **License: [MIT](LICENSE)** for the core.
- The open core includes every check, the approval UI, reports, Playwright export, bring-your-own-model support and the test fixtures. **Checks are never paywalled.**
- A possible paid tier (later, only after demand is validated) would cover things that run on our servers: hosted inference, a hosted runner, team dashboards, CI integration and compliance exports. It would be unlocked with an API key passed to the Docker container; without a key, the core runs fully.

Details: [docs/business-model.md](docs/business-model.md).
