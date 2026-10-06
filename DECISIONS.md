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
- 2026-09-27: [The site redesign ships in 0.6.0: an evidence-first homepage of at most 750 words, every hub in the header, and a doormat footer](docs/decisions/09-2026.md#2026-09-27-site-redesign-evidence-first)
- 2026-09-27: [Site motion uses GSAP with ScrollTrigger and DrawSVG, loads only after the page has loaded and only when motion is allowed, and never animates text](docs/decisions/09-2026.md#2026-09-27-site-motion-gsap-scrolltrigger)
- 2026-09-27: [The docs are split into MDX pages in site/, and the repository guides become pointers to them](docs/decisions/09-2026.md#2026-09-27-docs-as-mdx-pages)
- 2026-09-27: [Every built-in check has a page at `/checks/<id>/`, and reports and the web UI link each finding to it](docs/decisions/09-2026.md#2026-09-27-check-pages-linked-from-findings)
- 2026-09-27: [Site search is Pagefind behind the site's own dialog, indexed at build time](docs/decisions/09-2026.md#2026-09-27-site-search-pagefind)
- 2026-09-27: [One route registry and one content folder drive the site, and build guards fail on word, link, anchor and size budgets](docs/decisions/09-2026.md#2026-09-27-site-route-registry-and-guards)
- 2026-09-27: [A root SECURITY.md points to the disclosure policy, and contribution files wait until contributions open](docs/decisions/09-2026.md#2026-09-27-security-md-pointer-no-contributions)
- 2026-09-27: [Check ids are stable public names: a renamed check keeps its old page as a permanent redirect](docs/decisions/09-2026.md#2026-09-27-check-ids-are-stable)
- 2026-09-27: [The brand guide gains copy rules, an accent budget, a line-hound rule and a Motion section for the site, the local UI and reports](docs/decisions/09-2026.md#2026-09-27-brand-copy-and-motion-rules)
- 2026-09-28: [The site is built from a committed project brief, research is closed, and work is verified once at the end](docs/decisions/09-2026.md#2026-09-28-site-project-brief-and-verify-at-end)
- 2026-09-28: [Motion draws strokes without DrawSVG and its gate loads at hydration; the header prefetches four links; long-spec check pages keep their measured HTML budget](docs/decisions/09-2026.md#2026-09-28-site-finish-motion-prefetch-budgets)
- 2026-09-28: [The verbose-errors evidence is captured again from Kennel in a container, and paywall-trust's page uses its focused run](docs/decisions/09-2026.md#2026-09-28-site-evidence-recaptured-without-home-path)
- 2026-09-28: [After the page leaves the allowed targets, only the checks that change Account A keep their own notes](docs/decisions/09-2026.md#2026-09-28-escape-notes-only-for-checks-that-change-account-a)
- 2026-09-28: [A test holds the docs that list Fernway's bugs to fixtures/fernway/bugs.json](docs/decisions/09-2026.md#2026-09-28-fernway-docs-follow-bugs-json)
- 2026-09-28: [csrf reads the answer to every forge and forges every run-token value](docs/decisions/09-2026.md#2026-09-28-csrf-reads-the-forges-answer)
- 2026-09-28: [csrf says which cookies rode on a forge only when it saw the answer, and never forges a body it can't rebuild as named fields](docs/decisions/09-2026.md#2026-09-28-csrf-cookies-unknown-when-the-answer-is-unseen)
- 2026-09-28: [write-access treats a refusal of a version it couldn't refresh as inconclusive, and the save is found in a form-encoded body](docs/decisions/09-2026.md#2026-09-28-write-access-stale-version-refusals-inconclusive)
- 2026-09-28: [paywall-trust reads the plan once more, after a quiet wait, before it opens the next page, and the docs say page-controls may click a plan button](docs/decisions/09-2026.md#2026-09-28-paywall-trust-quiet-read-before-the-next-page) (supersedes, in part, 2026-09-27-paywall-trust-changes-and-restores-the-plan)
- 2026-09-28: [sessionStorage is seeded only when the session lives there](docs/decisions/09-2026.md#2026-09-28-sessionstorage-seeded-only-when-the-session-lives-there)
- 2026-09-28: [A code step named only by the page's heading needs a field that looks like a code's, and the app's own site is read without a public-suffix list](docs/decisions/09-2026.md#2026-09-28-code-step-by-heading-needs-a-code-field)
- 2026-09-28: [The existing-record hold learns ids from GraphQL reads sent as POSTs, and stops a GraphQL save that doesn't say it creates a record](docs/decisions/09-2026.md#2026-09-28-hold-learns-graphql-reads)
- 2026-09-28: [write-access sends the identity's own anti-CSRF token in a header the app's update carried](docs/decisions/09-2026.md#2026-09-28-write-access-header-csrf-tokens)
- 2026-09-28: [The other-account line says what Account B was used for from the scenarios that ran, on every surface](docs/decisions/09-2026.md#2026-09-28-other-account-line-from-what-ran)
- 2026-09-28: [The existing-record hold takes a POST for a GraphQL read only when its body is a GraphQL query, and judges a GraphQL mutation by its name after the form's create too](docs/decisions/09-2026.md#2026-09-28-graphql-read-needs-a-graphql-query) (supersedes, in part, 2026-09-28-hold-learns-graphql-reads)
- 2026-09-28: [write-access counts a 400 or 422 to a replay without the app's anti-CSRF token as a possible CSRF refusal, and pairs a header with its usual source when A's value has changed](docs/decisions/09-2026.md#2026-09-28-write-access-token-refusals-400-422-and-header-pairing) (supersedes, in part, 2026-09-28-write-access-header-csrf-tokens)
- 2026-09-28: [The record of which checks click a plan button names page-controls and dead-control](docs/decisions/09-2026.md#2026-09-28-plan-buttons-page-controls-and-dead-control) (supersedes the wording of 2026-09-28-paywall-trust-quiet-read-before-the-next-page)
- 2026-09-28: [csrf waits 30 seconds for a forge's answer, never passes a forge it saw no answer to, and never passes a refusal a value it couldn't place explains](docs/decisions/09-2026.md#2026-09-28-csrf-waits-30-s-and-weighs-values-it-cant-place) (supersedes, in part, 2026-09-28-csrf-cookies-unknown-when-the-answer-is-unseen and 2026-09-28-csrf-reads-the-forges-answer)
- 2026-09-28: [write-access compares a 404 or a silent 2xx to a stale version with the same write sent as Account A, refreshes a version in the URL only when the record showed it, and never passes a write that got no answer](docs/decisions/09-2026.md#2026-09-28-write-access-compares-a-stale-version-with-account-a) (supersedes, in part, 2026-09-28-write-access-stale-version-refusals-inconclusive)
- 2026-09-28: [paywall-trust gives the page under test its own quiet read, never passes a run that ran out of time, and holds a Billing tab's page until it is left](docs/decisions/09-2026.md#2026-09-28-paywall-trust-page-under-test-and-tab-pages-held) (supersedes, in part, 2026-09-28-paywall-trust-quiet-read-before-the-next-page)
- 2026-09-28: [A code step is decided by the field's own words read through camel case and aria-labelledby, a field that can't hold a code is never one, and a bare "verify" heading never makes a numeric field a code](docs/decisions/09-2026.md#2026-09-28-code-step-reads-the-fields-own-words) (supersedes, in part, 2026-09-28-code-step-by-heading-needs-a-code-field)
- 2026-09-28: [sessionStorage seeding is recorded as conditional, and its limits are written down both ways](docs/decisions/09-2026.md#2026-09-28-sessionstorage-limits-both-ways) (supersedes, in part, 2026-09-27-two-step-and-sessionstorage-sign-in and 2026-09-28-sessionstorage-seeded-only-when-the-session-lives-there)
- 2026-09-28: [The existing-record hold learns ids from persisted GraphQL reads and Relay queries, never sends one again, and holds a Relay save with no name](docs/decisions/09-2026.md#2026-09-28-hold-learns-persisted-graphql-reads) (supersedes, in part, 2026-09-28-graphql-read-needs-a-graphql-query)
- 2026-09-28: [Subagent work is matched to cost: haiku for mechanical edits, sonnet for contained fixes and test runs, opus for planning and tricky work](docs/decisions/09-2026.md#2026-09-28-subagent-work-matched-to-cost)
- 2026-09-29: [The site lab's throttled LCP limit on the homepage is 1,100 ms, not 1,000 ms](docs/decisions/09-2026.md#2026-09-29-lab-lcp-limit-1100-on-home)
- 2026-09-29: [The rotated EVIDENCE stamp is removed from the site's figures; it read oddly to users](docs/decisions/09-2026.md#2026-09-29-no-evidence-stamp) (supersedes, in part, 2026-09-27-site-motion-gsap-scrolltrigger)
- 2026-09-29: [CI splits into parallel jobs, and the site lab into 4 shards, instead of two ~50-minute serial jobs](docs/decisions/09-2026.md#2026-09-29-ci-parallel-jobs)
- 2026-09-29: [The one-line install command downloads the compose file from the latest GitHub Release, not a tag-pinned link](docs/decisions/09-2026.md#2026-09-29-install-from-latest-github-release)
- 2026-09-29: [Releases build arm64 natively, merge per-platform digests, reuse main's passing CI and publish a GitHub Release after the images, instead of paying for bigger runners](docs/decisions/09-2026.md#2026-09-29-releases-native-arm64-reuse-ci-github-release) (supersedes, in part, 2026-09-26-releases-gated-on-ci)
- 2026-09-29: [`package:latest` always means the latest release, and nothing else in the repo pins a version](docs/decisions/09-2026.md#2026-09-29-images-latest-no-version-pins) (supersedes, in part, 2026-09-29-install-from-latest-github-release and 2026-09-26-releases-gated-on-ci)
- 2026-09-30: [Run Hound launches publicly at 0.6.5 to gather feedback, 1.0.0 is the refactor that makes the app code maintainable, and native desktop packages come after](docs/decisions/09-2026.md#2026-09-30-launch-at-0-6-5) (supersedes 2026-09-26-npx-release-is-0-9-9, and in part 2026-09-21-stages-are-feature-sets)
- 2026-09-30: [Every Chromium Run Hound launches gets an allowlisted environment and a home folder of its own, and no browser context accepts a download](docs/decisions/09-2026.md#2026-09-30-browser-env-allowlist-no-downloads)
- 2026-09-30: [Bedrock reads `~/.aws` only when a profile is named, and an access key pair can be saved in Settings, write-only, in `ai.json`](docs/decisions/09-2026.md#2026-09-30-aws-only-when-a-profile-is-named)
- 2026-09-30: [Every AI secret Run Hound reads is registered with the redactor, and a labelled AWS secret access key is a pattern of its own](docs/decisions/09-2026.md#2026-09-30-ai-secrets-redacted)
- 2026-09-30: [The tested page's requests to other sites stay allowed and are documented; a strict mode comes after the launch](docs/decisions/09-2026.md#2026-09-30-third-party-requests-allowed)
- 2026-09-30: [0.6.2 gets a per-launch UI token and a sandboxed browser with a warning fallback; 0.6.3 moves host state into the project](docs/decisions/09-2026.md#2026-09-30-host-state-and-clean-window)

### October 2026 ([10-2026.md](docs/decisions/10-2026.md))

- 2026-10-01: [MiniMax M3 handles the app CLI regression fix when Sonnet is unavailable](docs/decisions/10-2026.md#2026-10-01-minimax-cli-fix-delegation)
- 2026-10-01: [Delegate according to the maintainer's OpenCode configuration](docs/decisions/10-2026.md#2026-10-01-opencode-config-delegation-policy) (supersedes 2026-09-28-subagent-work-matched-to-cost and the policy framing of 2026-10-01-minimax-cli-fix-delegation)
- 2026-10-01: [Complete account imports against the refactor's new types and interfaces modules](docs/decisions/10-2026.md#2026-10-01-account-import-migration)
- 2026-10-01: [Refactor one app feature at a time into feature-named config, interfaces and types modules](docs/decisions/10-2026.md#2026-10-01-feature-config-interfaces-types)
- 2026-10-01: [Refactor the CLI around command responsibilities and explicit dependencies before server MVC](docs/decisions/10-2026.md#2026-10-01-cli-solid-refactor)
- 2026-10-02: [Keep CLI error classes in errors and retain only necessary one-line comments](docs/decisions/10-2026.md#2026-10-02-cli-comments-and-errors)
- 2026-10-02: [Bind each CLI command's dependencies at composition and preserve terminal lifecycle behavior](docs/decisions/10-2026.md#2026-10-02-cli-command-boundaries)
- 2026-10-02: [Use Oxlint as the app's lint runner](docs/decisions/10-2026.md#2026-10-02-app-oxlint)
- 2026-10-02: [Server MVC: thin controllers, narrow orchestrations, composition in app.ts](docs/decisions/10-2026.md#2026-10-02-server-flow-boundaries)
- 2026-10-02: [Server: replace Services bag with per-controller flow ports](docs/decisions/10-2026.md#2026-10-02-server-narrow-ports)
- 2026-10-02: [Server: route shared limits through config/ and constants/; types/ holds types only](docs/decisions/10-2026.md#2026-10-02-server-config-constants)
- 2026-10-03: [Server: lift inline flow types and inject accounts/AI/password deps into plan/rerun flows](docs/decisions/10-2026.md#2026-10-03-server-flow-types-and-injection)
- 2026-10-03: [Accounts/AI config: split storage operations from reusable declarations](docs/decisions/10-2026.md#2026-10-03-accounts-ai-config-separation)
- 2026-10-03: [Auth engine: extract session-value detection into a focused, pure module](docs/decisions/10-2026.md#2026-10-03-auth-session-detection)
- 2026-10-03: [Server: make plan/rerun flow deps mandatory, lift inline deps, split config/operations re-export](docs/decisions/10-2026.md#2026-10-03-flow-deps-mandatory-and-canonical-homes) (supersedes, in part, 2026-10-03-server-flow-types-and-injection, 2026-10-02-server-narrow-ports, 2026-10-03-accounts-ai-config-separation, 2026-10-03-auth-session-detection)
- 2026-10-03: [Auth engine: complete the staged split and move SignInError to errors/](docs/decisions/10-2026.md#2026-10-03-auth-stage-completion)
- 2026-10-03: [Paywall-trust: split into feature config/constants/types/interfaces and focused cohesive modules](docs/decisions/10-2026.md#2026-10-03-paywall-trust-focused-split)
- 2026-10-03: [Paywall-trust: revised focused split after review found regressions](docs/decisions/10-2026.md#2026-10-03-paywall-trust-focused-split-revised) (supersedes, in part, 2026-10-03-paywall-trust-focused-split)
- 2026-10-03: [TypeScript verbatimModuleSyntax does NOT detect circular imports; prior decision claim was wrong](docs/decisions/10-2026.md#2026-10-03-paywall-trust-cycles-and-claimed-detection) (supersedes, in part, 2026-10-03-paywall-trust-focused-split-revised)
- 2026-10-03: [Split the inline UI client into readable feature modules](docs/decisions/10-2026.md#2026-10-03-ui-client-section-split)
- 2026-10-03: [Preserve sign-in error contracts and test the browser-hardening script](docs/decisions/10-2026.md#2026-10-03-auth-review-contracts)
- 2026-10-03: [Judge module cycles by dependency and initialization behavior](docs/decisions/10-2026.md#2026-10-03-module-cycle-clarification) (supersedes, in part, 2026-10-03-paywall-trust-cycles-and-claimed-detection)
- 2026-10-03: [Separate record parsing, snapshots, GraphQL classification and write holds](docs/decisions/10-2026.md#2026-10-03-record-state-responsibilities)
- 2026-10-03: [Separate CSRF request construction, transport, restoration and findings](docs/decisions/10-2026.md#2026-10-03-csrf-responsibilities)
- 2026-10-03: [Discover all app tests under the tests folder](docs/decisions/10-2026.md#2026-10-03-app-test-root)
- 2026-10-03: [Separate runner options, secrets, sign-in detection, planning and execution](docs/decisions/10-2026.md#2026-10-03-runner-responsibilities)
- 2026-10-03: [Separate write-access record matching, token replay, restoration and findings](docs/decisions/10-2026.md#2026-10-03-write-access-responsibilities)
- 2026-10-03: [Keep the app refactor PR to app code and its docs](docs/decisions/10-2026.md#2026-10-03-refactor-final-review)
- 2026-10-03: [Site tests read a refactored check's implementation folder, not only its facade](docs/decisions/10-2026.md#2026-10-03-site-tests-follow-app-split)
- 2026-10-03: [Put the app's fixtures and test helpers under tests/, beside the tests](docs/decisions/10-2026.md#2026-10-03-app-single-test-root)
- 2026-10-04: [Track desktop-first and AI-native QA development in GitHub Project 4](docs/decisions/10-2026.md#2026-10-04-development-project-board)
- 2026-10-04: [Target all three desktop OS families and hosted coordination with local execution](docs/decisions/10-2026.md#2026-10-04-desktop-team-planning-boundary)
- 2026-10-04: [Use ticket branches, PRs to main and bounded project-scoped development agents](docs/decisions/10-2026.md#2026-10-04-ticket-branches-and-agent-routing)
- 2026-10-04: [Use direct xAI for scouting while GLM routes are unavailable](docs/decisions/10-2026.md#2026-10-04-scout-available-provider)
- 2026-10-04: [Scope agent read denials to data stores and deny worker merge/release commands](docs/decisions/10-2026.md#2026-10-04-agent-permission-review-fixes)
- 2026-10-04: [T1 team-workflow contract: objects, roles and policy-based approval (specification only); three policy questions await the maintainer](docs/decisions/10-2026.md#2026-10-04-t1-team-workflow-contract)
- 2026-10-04: [Grant contract specified for execution authority (G1)](docs/decisions/10-2026.md#2026-10-04-g1-execution-grants-spec)
- 2026-10-04: [Define the hosted sync, privacy, data-classification and conflict-resolution contract](docs/decisions/10-2026.md#2026-10-04-hosted-sync-privacy-contract)
- 2026-10-04: [Desktop shell is Electron on a Playwright-defined support matrix, with updates deferred](docs/decisions/10-2026.md#2026-10-04-desktop-architecture-electron)
- 2026-10-04: [The scout profile runs on the MiniMax flash preview; Grok stays a subscription-billed trial route](docs/decisions/10-2026.md#2026-10-04-scout-routes-to-minimax-flash) (supersedes 2026-10-04-scout-available-provider)
- 2026-10-04: [D2 first slice: the desktop entry contract and its tests, no Electron yet](docs/decisions/10-2026.md#2026-10-04-d2a-desktop-entry-contract)
- 2026-10-04: [CI type-checks and tests the desktop package; its runs-folder variable is desktop-only](docs/decisions/10-2026.md#2026-10-04-desktop-package-in-ci)
- 2026-10-05: [The Electron shell loads a bundled engine, pins its window to the engine, and is launch-checked in CI](docs/decisions/10-2026.md#2026-10-05-d2b-electron-shell)
- 2026-10-05: [Track ticket owners in a board field, and send scoped tickets to the OpenCode agents with Claude Code as the gate](docs/decisions/10-2026.md#2026-10-05-board-owner-and-agent-dispatch)
- 2026-10-05: [The automated Claude review may read the pull request and run its review subagents](docs/decisions/10-2026.md#2026-10-05-claude-review-tools)
- 2026-10-06: [Saved keys and test-account passwords are encrypted: the OS keychain on the desktop, Run Hound's own store elsewhere, environment variables only in Docker](docs/decisions/10-2026.md#2026-10-06-encrypted-secret-store) (supersedes the `ai.json` storage in 2026-09-30-aws-only-when-a-profile-is-named)
