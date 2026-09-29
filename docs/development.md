# Development

This page covers working on Run Hound itself: the test suites, the test fixtures it is scored against, and where decisions are recorded.

## From source

To set up a clone for development, follow [From source (contributing)](install.md#from-source-contributing).

## Running the suites

```sh
pnpm --filter run-hound test                  # unit + browser tests for the engine and checks
pnpm --filter run-hound exec tsc --noEmit
pnpm --filter kennel test                     # Kennel's own tests (clean mode and every bug)
pnpm --filter fernway test                    # Fernway's own tests (builds it once; clean mode and every bug)
pnpm test:acceptance                          # Run Hound against Kennel, Fernway and the sample apps, clean and with every planted bug
```

The suites pick random free ports, so they don't collide with anything already running. CI ([.github/workflows/ci.yml](../.github/workflows/ci.yml)) runs on every pull request and every push to main, split into parallel jobs: the type-checks and every suite above, a build of the four Docker images with a smoke test in the compose test lab, and a lint and build of the website. A release reuses CI's already-passing run on main for the same commit when there is one, and otherwise runs CI itself; either way, it publishes no image unless CI passed.

## Test fixtures

Run Hound is developed and scored against deliberately broken apps with planted bugs behind toggles and a clean mode:

- **Kennel**: a single booking form (`/book`) on a small in-memory Node server with a mock analytics service ([fixtures/kennel/CONTRACT.md](../fixtures/kennel/CONTRACT.md), [bugs.json](../fixtures/kennel/bugs.json)). Its V0 and V1 bugs cover the form and page checks.
- **Fernway**: a Lovable-style SaaS app (Vite, React 19, Tailwind CSS, Radix/shadcn-style components, react-hook-form with zod, sonner) with a landing page, sign-up, sign-in, an onboarding wizard, and a dashboard and settings behind a real sign-in with two accounts ([fixtures/fernway/README.md](../fixtures/fernway/README.md), [CONTRACT.md](../fixtures/fernway/CONTRACT.md), [bugs.json](../fixtures/fernway/bugs.json)). W01-W10 are the bugs AI-built apps typically ship with; V01-V05 are the access bugs the V2 checks look for (`access-control`, `mass-assignment` and `deep-links`, 0.4.0), and V06-V09 the write bugs: writes to another account's task, writes without a session, CSRF, and an upgrade success page that grants Pro without a payment. `csrf` (0.5.0) catches V08, `write-access` (0.6.0) catches V06 and V07, and `paywall-trust` (0.6.0) catches V09.
- **Sample apps**: five well-built apps ([fixtures/samples/README.md](../fixtures/samples/README.md)) as the false-positive suite.

Fernway replaces, for 0.4.0, the multi-page Kennel on a local Supabase described in [docs/fixtures.md](fixtures.md); that stays planned as a Supabase variant. Scoring, in CI on every pull request, covers planted bugs found, false positives in clean mode and evidence on every finding; repeating runs to check that findings are stable is planned ([docs/fixtures.md](fixtures.md#scoring)).

## Releasing

A release is three things, moved together in one commit: `app/package.json`'s `version`, `site/src/lib/site.ts`'s `version`, `released` and `releasedIso`, and the root `CHANGELOG.md` — rename its `## Unreleased` heading to `## <version> (<one-line summary>), <date>` (the date `released` and `releasedIso` also carry). Nothing else in the repo is pinned to a release version any more ([2026-09-29](decisions/09-2026.md#2026-09-29-images-latest-no-version-pins)): `run-hound.compose.yml`'s published images always resolve `ghcr.io/rahul-bharati/<name>:${RUNHOUND_TAG:-latest}`, and `docker-compose.yml` (built from source) tags its own builds `:local`. `app/test/cli-version.test.ts` checks the three move together: it reads `app/package.json`'s version directly, checks `site.ts`'s `version` against it (a plain `X.Y.Z` release only; pre-releases are skipped) and checks `released`/`releasedIso` against the CHANGELOG heading. It also mirrors `release-images.yml`'s `check-version` job, which checks only the tag against `app/package.json` and the CHANGELOG section, and guards that neither compose file pins an image to a version — `site.ts` is not that job's concern, since a bad `site.ts` fails `pnpm test` (in CI, which the release depends on) rather than the release workflow itself.

Then tag and push (`git tag vX.Y.Z && git push origin vX.Y.Z`): [release-images.yml](../.github/workflows/release-images.yml) builds, tags (`X.Y.Z`, `X.Y` and, for a full release, `latest`) and publishes the four images, then creates the GitHub Release from the CHANGELOG section.

## Decisions

Record every decision in the append-only decision log. See [DECISIONS.md](../DECISIONS.md) for the index and how to add a decision.
