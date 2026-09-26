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

The suites pick random free ports, so they don't collide with anything already running. CI ([.github/workflows/ci.yml](../.github/workflows/ci.yml)) runs on every pull request and every push to main: the type-checks and every suite above, a build of the four Docker images with a smoke test in the compose test lab, and a lint and build of the website. A release runs all of CI first, and publishes no image unless it passes.

## Test fixtures

Run Hound is developed and scored against deliberately broken apps with planted bugs behind toggles and a clean mode:

- **Kennel**: a single booking form (`/book`) on a small in-memory Node server with a mock analytics service ([fixtures/kennel/CONTRACT.md](../fixtures/kennel/CONTRACT.md), [bugs.json](../fixtures/kennel/bugs.json)). Its V0 and V1 bugs cover the form and page checks.
- **Fernway**: a Lovable-style SaaS app (Vite, React 19, Tailwind CSS, Radix/shadcn-style components, react-hook-form with zod, sonner) with a landing page, sign-up, sign-in, an onboarding wizard, and a dashboard and settings behind a real sign-in with two accounts ([fixtures/fernway/README.md](../fixtures/fernway/README.md), [CONTRACT.md](../fixtures/fernway/CONTRACT.md), [bugs.json](../fixtures/fernway/bugs.json)). W01-W10 are the bugs AI-built apps typically ship with; V01-V05 are the access bugs the V2 checks look for, and V06-V09 (0.5.0) the write bugs: writes to another account's task, writes without a session, CSRF, and an upgrade success page that grants Pro without a payment. `csrf` catches V08; V06, V07 and V09 are for checks that are still planned.
- **Sample apps**: five well-built apps ([fixtures/samples/README.md](../fixtures/samples/README.md)) as the false-positive suite.

Fernway replaces, for 0.4.0, the multi-page Kennel on a local Supabase described in [docs/fixtures.md](fixtures.md); that stays planned as a Supabase variant. Scoring, in CI on every pull request, covers planted bugs found, false positives in clean mode and evidence on every finding; repeating runs to check that findings are stable is planned ([docs/fixtures.md](fixtures.md#scoring)).

## Decisions

Record every decision in the append-only decision log. See [DECISIONS.md](../DECISIONS.md) for the index and how to add a decision.
