# Decisions

Why Run Hound is the way it is: one line per decision, each linking to its full entry. The entries live in [docs/decisions/](docs/decisions/), one file per month, named `MM-YYYY.md`.

**The log is append-only.** Add new entries and index lines at the end; never edit, reorder or delete one that has landed. To change a decision, add a new entry that says which one it supersedes. The only edits allowed to an existing entry are fixing a broken link, or a typo that changes no meaning.

## How to add a decision

Everyone working on Run Hound, people and AI agents alike, records each decision that changes what Run Hound does, how it is built, tested, released or documented, or what is planned, in the same change that carries it out.

1. Open `docs/decisions/MM-YYYY.md` for the month the decision was made (for example `09-2026.md`). When it doesn't exist yet, create it with the same two-line header as the other months, and add the month's heading at the end of the index below.
2. Append the entry at the end of that file, in this form:

   ```markdown
   <a id="2026-09-26-short-slug"></a>
   ## One sentence: what was decided

   - **Date:** 2026-09-26
   - **Decided by:** who made the call (a person, or "Claude, approved by <person>")
   - **Context:** what prompted it
   - **Decision:** what was decided, specifically
   - **Why:** the reasons
   - **Alternatives considered:** what was rejected, and why (leave the line out when none were)
   - **Consequences:** what it changes, and what follows from it
   - **Sources:** commits, pull requests, issues or docs
   - **Supersedes:** [the earlier entry](09-2026.md#2026-09-21-short-slug) (only when it does)
   ```

   The id is the date plus a short slug (lowercase letters, digits and hyphens) and is unique in the whole log. A decision written down after it was made adds `- **Recorded:** <date>, from <source>` under **Date**.
3. Append one line for it at the end of its month in the index: `- 2026-09-26: [One sentence](docs/decisions/09-2026.md#2026-09-26-short-slug)`, ending with `(supersedes <id>)` when it does.

## Index

### September 2026 ([09-2026.md](docs/decisions/09-2026.md))

- 2026-09-21: [Run Hound ships as a Docker image that runs on the user's own machine, with no hosted platform for now](docs/decisions/09-2026.md#2026-09-21-docker-local-no-hosted-platform)
- 2026-09-21: [Run Hound tests only targets the user owns: localhost and private addresses by default, other domains after ownership verification](docs/decisions/09-2026.md#2026-09-21-only-owned-targets)
- 2026-09-21: [Destructive actions stay off unless the user explicitly opts in](docs/decisions/09-2026.md#2026-09-21-destructive-actions-opt-in)
- 2026-09-21: [Pass or fail comes from deterministic checks with evidence, never from a model](docs/decisions/09-2026.md#2026-09-21-deterministic-checks-decide)
- 2026-09-21: [Every check stays in the open core; a possible paid tier, only after demand is validated, would cover things that run on our servers](docs/decisions/09-2026.md#2026-09-21-checks-never-paywalled)
- 2026-09-21: [Run Hound is developed and scored against deliberately broken test apps with planted bugs and a clean mode](docs/decisions/09-2026.md#2026-09-21-planted-bug-fixtures)
- 2026-09-22: [The pnpm workspace uses the hoisted node linker](docs/decisions/09-2026.md#2026-09-22-pnpm-hoisted-linker)
- 2026-09-22: [Until ownership verification exists, hosts listed in RUNHOUND_ALLOWED_HOSTS pass the safety gate without an ownership check](docs/decisions/09-2026.md#2026-09-22-allowed-hosts-unchecked)
- 2026-09-25: [AI is optional, off by default and bring-your-own-model, and a model never decides pass or fail](docs/decisions/09-2026.md#2026-09-25-ai-optional-off-by-default)
- 2026-09-25: [Each slice starts with a contract and failing tests, and the implementation comes after](docs/decisions/09-2026.md#2026-09-25-contracts-and-failing-tests-first)
- 2026-09-25: [The core is MIT-licensed, chosen at the public launch instead of the planned Apache-2.0](docs/decisions/09-2026.md#2026-09-25-mit-license)
- 2026-09-25: [Docker images are published to GHCR when a version tag is pushed, with an optional Docker Hub mirror](docs/decisions/09-2026.md#2026-09-25-images-on-ghcr)
- 2026-09-26: [Tests never read or write the developer's real Run Hound settings in ~/.config/run-hound](docs/decisions/09-2026.md#2026-09-26-tests-isolate-config)
- 2026-09-26: [Fernway, not the multi-page Kennel on a local Supabase, is the test app for the 0.4.0 V2 preview](docs/decisions/09-2026.md#2026-09-26-fernway-over-supabase-kennel)
- 2026-09-26: [The command line reads a test-account password from stdin, never from a flag, and passwords are kept out of reports, logs, evidence, specs and AI prompts](docs/decisions/09-2026.md#2026-09-26-account-passwords-stdin-only)
- 2026-09-26: [The Run Hound image ships only Chromium's headless shell](docs/decisions/09-2026.md#2026-09-26-chromium-headless-shell-image)
- 2026-09-26: [A release runs the whole CI first and publishes no image unless it passes](docs/decisions/09-2026.md#2026-09-26-releases-gated-on-ci)
- 2026-09-26: [Pull and run is the main way to start Run Hound](docs/decisions/09-2026.md#2026-09-26-pull-and-run-first)
- 2026-09-26: [Checks that write change only the run's own test record, decide from a re-read and put the record back](docs/decisions/09-2026.md#2026-09-26-write-side-safety-contract)
- 2026-09-26: [0.5.0 ships only the csrf check; write-access and paywall-trust stay planned](docs/decisions/09-2026.md#2026-09-26-0-5-0-csrf-only)
- 2026-09-26: [The README is a short front page; the guides live in docs/](docs/decisions/09-2026.md#2026-09-26-readme-split-into-docs)
- 2026-09-26: [Every decision goes in an append-only log, one file per month, indexed in DECISIONS.md](docs/decisions/09-2026.md#2026-09-26-append-only-decisions-log)
- 2026-09-26: [npx run-hound ships as 0.9.9, the last release before 1.0.0](docs/decisions/09-2026.md#2026-09-26-npx-release-is-0-9-9)
- 2026-09-21: [The roadmap's V0 to V4 are feature stages, not version numbers, and 1.0.0 is the release that completes V4](docs/decisions/09-2026.md#2026-09-21-stages-are-feature-sets)
- 2026-09-27: [Where the site shows a version it shows the release number, and it names V0 to V4 only as stages](docs/decisions/09-2026.md#2026-09-27-site-shows-release-not-stage)
- 2026-09-27: [0.6.0 finishes V2's write side, adds two-step and sessionStorage sign-in, and gets Run Hound ready for live alpha testers](docs/decisions/09-2026.md#2026-09-27-0-6-0-scope)
- 2026-09-27: [The site lets AI crawlers and answer engines read it, and publishes /llms.txt and /llms-full.txt](docs/decisions/09-2026.md#2026-09-27-ai-crawlers-allowed)
- 2026-09-27: [The site keeps Next's standalone output; tab images are preloaded and the image cache is warmed in the Docker build](docs/decisions/09-2026.md#2026-09-27-site-images-warm-and-preload)
- 2026-09-27: [The site describes Run Hound for search engines and AI assistants from its own data, and the build fails when that breaks](docs/decisions/09-2026.md#2026-09-27-site-seo-geo)
- 2026-09-27: [paywall-trust may change Account A's plan to test it, restores it through the app, and ships with the success-page probe only](docs/decisions/09-2026.md#2026-09-27-paywall-trust-changes-and-restores-the-plan)
- 2026-09-27: [write-access only replays the update and delete requests the app itself sent](docs/decisions/09-2026.md#2026-09-27-write-access-observed-requests-only)
- 2026-09-27: [Sign-in handles email-then-password pages and sessionStorage sessions, and Fernway gains modes for both](docs/decisions/09-2026.md#2026-09-27-two-step-and-sessionstorage-sign-in)
- 2026-09-27: [paywall-trust confirms only a gain, never any change to the plan](docs/decisions/09-2026.md#2026-09-27-paywall-trust-confirms-only-a-gain)
- 2026-09-27: [The write-side checks hold the form's own save in the page and stop one that would change a record Account A already had](docs/decisions/09-2026.md#2026-09-27-form-save-held-before-it-reaches-the-app)
- 2026-09-27: [paywall-trust confirms a credits-only gain with a quiet re-read, and a named trial of a paid tier is never a gain](docs/decisions/09-2026.md#2026-09-27-paywall-trust-quiet-reread-and-trials)
