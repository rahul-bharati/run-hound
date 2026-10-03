# Code maintenance

How Run Hound's app code is arranged, why, and how to change it without breaking the product. This is a maintainer guide for working inside `app/`. For setup, suites and releases see [development.md](development.md); for what the product does see [overview.md](overview.md).

The architecture here was settled during the 1.0.0 maintainability refactor. Each rule below points at the decision that established it, in the [decision log](decisions/10-2026.md).

## The shape of the code

```
app/src/
  cli.ts              entry point: argument parsing and dispatch only
  cli/                command handlers, one responsibility each
  config/             tunable values: time limits, limits, defaults
  constants/          fixed values: regexes, host lists, id strings
  errors/             error classes, one per failure the caller can act on
  interfaces/         object shapes with behaviour (what something is)
  types/              type aliases and unions (how something is spelled)
  operations/         storage: reading and writing saved settings
  utils/              small pure helpers with no domain knowledge
  core/               domain types and rules the checks share
  engine/             the runner: browser, planning, execution, reporting
  checks/             one module per check, plus checks/lib for shared logic
  server/             the local web server (MVC)
  ai/                 model providers and AI configuration
```

Feature code lives with its feature. A check that needs its own concepts gets its own directory rather than growing a shared file:

| Feature | Implementation | Public entry |
|---|---|---|
| `csrf` | `checks/csrf/` | `checks/csrf.ts` |
| `write-access` | `checks/write-access/` | `checks/write-access.ts` |
| `paywall-trust` | `checks/paywall-trust/` | `checks/paywall-trust.ts` |
| `record-state` (shared by three checks) | `checks/lib/record-state/` | `checks/lib/record-state.ts` |
| sign-in | `engine/auth/` | `engine/auth.ts` |
| the runner | `engine/runner/` | `engine/runner.ts` |

## Where a declaration goes

One canonical home per kind of value. Check this table before adding a new one, and reuse what already exists — most of what a change seems to need is already declared somewhere.

| You are adding | It goes in | Not in |
|---|---|---|
| A timeout, a limit, a default | `config/<feature>.ts` | the module that reads it |
| A regex, a host list, an id string | `constants/<feature>-constants.ts` | a module's private scope, if another module needs it |
| An object shape with behaviour | `interfaces/<feature>.ts` | `types/` |
| A union or alias | `types/<feature>.ts` | `interfaces/` |
| An error the caller distinguishes | `errors/<file>.ts` | thrown inline as a bare `Error` |
| Reading or writing saved settings | `operations/<feature>-storage.ts` | `config/` |

Three rules that were violated often enough to be worth stating:

- **`config/` and `constants/` hold data, not behaviour.** A predicate, a formatter or a resolver is a function, so it belongs in the focused module that owns it. `config/` may hold a function that reads configuration from the environment, provided it does its I/O when called, not at import.
- **No duplicate declarations.** If a second module needs a value, it imports the first. Two copies of a security regex drift apart, and one of them ends up enforcing the old rule.
- **No re-export cycles.** If `config/accounts.ts` re-exports something that imports `config/accounts.ts`, the module graph has a loop. Import the operation directly instead.

## Facades

A feature that was split keeps a thin facade at its original path — `checks/csrf.ts`, `engine/runner.ts`, `checks/lib/record-state.ts`. The facade re-exports the **original public surface only**, so the check registry, the CLI, the acceptance suite and existing tests keep their import paths.

- New code imports from the canonical home directly, not the facade.
- A facade may gain an export only when a real consumer needs it. Exporting a helper "just in case" turns a focused module back into a bag.
- A facade is not a compatibility layer for modules inside the app. The refactor that created it was allowed to break internal import paths; the next one should too.

## Dependencies

**The composition root wires concrete dependencies; nothing else looks them up.** `server/app.ts` is the only place that imports the account, AI and password functions, and passes them to the flow classes. Flows take them as required fields.

- No optional dependency with a silent fallback to a concrete import. A flow that can construct itself without its dependencies is not testable, and the wiring reads as if it is.
- Controllers depend on a narrow per-feature interface (`IPlanFlow`, `IRunsFlow`), never on a bag of models.
- Pure functions — parsers, classifiers, formatters — are imported directly. They need no injection.

**Cycles are judged by dependency and initialisation behavior, not by folklore.** `verbatimModuleSyntax` does not detect import cycles, and neither does `TS2306` (which means "this file is not a module"). A cyclic graph usually works; what fails is reading a binding before it is initialised. Before adding a callback or a dynamic import to break a cycle, confirm the cycle exists and name the ordering that would break it.

## Tests

All 216 test files live under `app/tests/`, and `vitest.config.ts` discovers only `tests/**/*.test.ts`. Nothing is tested from inside `src/`.

```
app/tests/
  features/<area>/    unit and browser tests for that area
  integration/        tests that drive the app end to end
  config/             tests that validate repository configuration
```

Fixtures (`app/test/fixtures/`) and the shared browser harness (`app/test-support/`) are helpers, not tests, and stay where they are.

A test must exercise production code. Copying a helper into the test file to assert on the copy proves nothing: the refactor that introduced this rule had a suite of tests that passed against local reimplementations while the real function was wrong. When you need to pin a rule, import the function that owns it.

## Verification

Run once, at the end of a coherent piece of work — not between mechanical steps.

```sh
pnpm --filter run-hound exec tsc --noEmit       # typecheck
pnpm --filter run-hound test                    # app suite
pnpm --filter kennel test
pnpm --filter fernway test
pnpm test:acceptance                            # Run Hound against Kennel, Fernway, samples
```

The browser suites are heavy. Running several at once produces timing failures that look like regressions; run them sequentially and re-read a failure before believing it.

## Traps

Every item here is a real defect that reached a passing test suite during the refactor. They are the most likely things to reintroduce.

**A browser script that is serialized into the page cannot reference module scope.** Init scripts, `page.evaluate` payloads and `String.raw` browser sources run in the browser with no access to the module. Anything they need is inlined as a value. `SIGN_IN_HARDENING` documents this at its definition.

**A syntax error inside a serialized script is silent.** The browser throws before any guard is installed, and every hardened path quietly stops being hardened while tests that assert on user-visible behavior still pass. Parse the script in a test and run it in a sandbox — `tests/features/engine/auth/auth-hardening-script.test.ts` exists for this.

**Iterate a snapshot, not a live array, across an `await`.** In `record-state`, the read loop awaits a re-read while the capture is still being appended to. Iterating the live array lets requests that arrive mid-loop leak into the current snapshot. Snapshot first with `.slice()`.

**`URLSearchParams.get` returns the first value of a repeated key.** Replacing a token field by iterating distinct keys and calling `get` misses every later value: a body of `guard=placeholder&guard=real-token` looks like it needs no swap, is reported as swapped anyway, and a CSRF refusal is judged instead of called inconclusive. Iterate the entries.

**Redaction is a pipeline, not a final step.** Notes pass through `redactSecrets` and then an account-name mask. Moving, dropping or reordering either step leaks a secret or a test account's name into a report, an evidence card or a generated spec.

**Verdicts depend on precedence.** Paywall-trust decides restore endpoints, tab confirmation and route classification in a specific order; a "cleaner" reimplementation that looks equivalent per call can pick a different endpoint. Move code; do not rewrite it.

**A check's public shape is a contract.** The id, title, category, scope and interrupted note are what reports, check pages and the UI read. Keep them exactly.

## Comments

Explain what the code cannot say: why a security rule exists, what a magic value is calibrated against, what invariant a serialized script must not break. Do not narrate structure, restate a name, or record a change's history — the decision log is where history goes.

## Decisions

Record every decision that changes how Run Hound is built, tested, released or documented, in the same change that carries it. The log is append-only: add entries, never edit or remove one, and supersede a decision with a new entry that names the old id. See [DECISIONS.md](../DECISIONS.md).

## Known debt

- **331 lint findings** remain, down from 338 before the refactor. All pre-date it and none are in refactored code; they are mostly unused imports in older tests.
- **Large orchestrators.** `checks/paywall-trust/check.ts` (1,199 lines), `checks/lib/record-state/hold.ts` (930) and `engine/discover.ts` (1,118) each hold one long decision flow. Splitting them further is a fresh task with its own review, not a cleanup.
- **Dependency-injection coverage is uneven.** The server flows and the runner are fully injected; the checks call their collaborators directly, which suits a single process driving one browser but leaves them harder to test in isolation.
