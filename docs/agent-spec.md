# Agent spec: goal-driven investigation (E2)

The contract for Run Hound's goal-driven agent: the user states a goal ("make sure my tasks and profile changes save correctly"), and an agent works through the target app with typed browser tools, runs the built-in checks on the pages it reaches, and reports. This is ticket A1. It changes no runtime behaviour: it adds this spec and the types in `app/src/types/agent.ts`, `app/src/interfaces/agent.ts`, `app/src/types/grant.ts`, `app/src/interfaces/grant.ts`, `app/src/config/agent.ts` and `app/src/constants/agent-constants.ts`, which nothing imports yet. A2 builds the brief, A3 the tools, A4 the loop ([Tickets](#tickets)).

Everything in [ai-spec.md](ai-spec.md), [execution-grants.md](execution-grants.md) (G1), [team-workflow.md](team-workflow.md) (T1) and [hosted-sync-privacy.md](hosted-sync-privacy.md) (T2) still holds, except where [Decisions this needs](#decisions-this-needs) says a rule must be superseded first.

## Rules

1. **Checks decide; the agent investigates.** A confirmed finding comes only from a built-in deterministic check, run by the agent on a page it reached. What the model suspects is a *suspicion*: advisory, kept in the report's agent section, never a `Finding`, never part of the exit code. The [2026-09-21](decisions/09-2026.md#2026-09-21-deterministic-checks-decide) and [2026-09-25](decisions/09-2026.md#2026-09-25-ai-optional-off-by-default) decisions stand (maintainer, 2026-10-06).
2. **Model output never grants authority.** The agent acts only through the engine's tools. Each call is validated when it runs: against the run's grant, its budgets, the safety gate and the navigation guard. Page text, a model's reasoning and a tool result can't widen any of them ([G1](execution-grants.md#explicit-limits), "Model output never grants authority").
3. **The engine stops the run, not the model.** The engine counts browser actions, time, model calls and test records, and it handles cancellation. It ends the run when a budget runs out, whether or not the model cooperates.
4. **No model, no agent.** An agent run needs the user's own key for Amazon Bedrock, Anthropic, OpenAI or Google Gemini ([K1](https://github.com/rahul-bharati/run-hound/issues/39)). Local models are not offered to the agent for now ([A5](#tickets) is deferred). With AI off, Run Hound behaves exactly as it does today.
5. **Local stays local.** The journal, evidence and checkpoints stay in the run's folder on the user's machine ([T1 rule 1](team-workflow.md#rules)). What goes to the model follows the AI rules: remote consent, redaction and length limits. Passwords, session values, cookies, headers, request and response bodies, selectors and screenshots are never sent.

## What the agent reuses

The engine already plans, runs, checks and reports. The agent reuses each piece and adds only what is missing. References are to `main` at A1.

| Area | Reused as is | Where | What the agent adds |
|---|---|---|---|
| Model client | `LlmClient.generateJson`: one schema-checked call, retried once on a validation error | `app/src/ai/types.ts:144`, `app/src/ai/client.ts:59` | One call per turn; usage reporting ([Model interface](#model-interface)) |
| Consent, keys, redaction | `createLlmClient` refusals, `redactSecrets`, `describePage`'s caps | `app/src/ai/client.ts:29-40`, `app/src/ai/payload.ts:37-120` | Observation caps of its own (`AGENT_OBSERVATION_LIMITS`) |
| Time-boxed AI | `boundSession`'s shared abort signal | `app/src/ai/session.ts:43-65` | A run-length budget instead of the 240 s plan budget |
| Page discovery | `discoverPage` (forms, controls, up to 50 same-origin links) | `app/src/engine/discover.ts:947` | Runs again on each page a check is asked for |
| Planning a check | `Check.plan(form, page, env)` and `buildPlan` | `app/src/core/types.ts:531-557`, `app/src/engine/plan.ts:32` | A one-check plan for the current page |
| Running a check | `runPlan` → `createCheckContext` → `check.run`, with stop and per-scenario time limits | `app/src/engine/runner/run-flow.ts:167,347-354` | Called by the `run-check` tool, with the current page's URL as the target |
| Sign-in | `signIn`, `openPage({as})`, credential pre-harvest, secret registration | `app/src/engine/auth/sign-in.ts:304`, `app/src/engine/context.ts:589-610`, `app/src/engine/runner/secrets.ts:27-44` | Nothing for the pilot (S1 adds manual login) |
| Safety | `checkTarget`, `guardContext`, `isDestructiveControl`, isolated Chromium | `app/src/engine/safety.ts:90`, `app/src/engine/guard.ts:56`, `app/src/checks/dead-control.ts:106`, `app/src/engine/isolation.ts:33` | Grant checks at each tool, and a route for non-navigation writes ([Grants](#grants-for-agent-runs)) |
| Evidence | `capture`, `captureCard`, `record`, `step` | `app/src/core/types.ts:477-529` | One frame per browser action, named after its step |
| Reports | `Report`, `writeReport`, the run folder, redaction on write | `app/src/core/types.ts:620-667`, `app/src/engine/report.ts:828-851` | `Report.agent` ([AgentReport](#persistence)) |
| Scoring | Fernway's `bugs.json` (`detectedBy`, `page`), clean mode, samples; only confirmed findings count | `fixtures/fernway/bugs.json:6,7,18`, `tests/acceptance/src/fernway.acceptance.test.ts:466-615` | The pilot suite ([Pilot](#pilot)) |

What doesn't exist yet, and so is built by the agent tickets:

- a loop that calls a model, acts on the answer, observes, and calls the model again (`generateJson` is called only by review, suggest, explain and the connection test);
- observation after an action: discovery runs once, at plan time;
- navigation and element tools: `FlowStep` is tied to one form's fields and control indexes (`app/src/core/types.ts:426`);
- run-wide budgets: only per-scenario time limits exist (`app/src/config/runner.ts:3`);
- grants: today approval is a list of scenario ids plus `allowDestructive` (`app/src/server/models/run-flow.ts:66-84`), and the ids are positional, so a re-plan can give an id different content;
- resume, and any structured action log: step labels are text only.

## The loop

One orchestrator per run, in the engine. Each turn:

1. **Observe.** The engine snapshots the page ([Observations](#observations)). After every browser action this happens on its own, so the model rarely needs `observe`.
2. **Decide.** One model call returns one `AgentDecision`: a short thought and one tool call.
3. **Validate.** The engine checks the call against the schema and limits, the latest observation's refs, the grant, the budgets and the repeat rule. A refusal is a tool error, and it is returned to the model.
4. **Act.** The engine performs the call through the existing boundaries: the safety gate, the guard, `CheckContext`, and the runner for checks.
5. **Record.** The engine appends the step to the journal, saves evidence, replaces the checkpoint and emits a progress event (the thought and the step label), then goes back to 1.

The run ends when the model calls `finish`, a budget runs out, the user cancels, the model fails (`AGENT_MAX_INVALID_DECISIONS` invalid decisions in a row, or a call that fails after its retry), or the engine errors.

### Model interface

The decision is one `generateJson<AgentDecision>` call per turn, with a JSON schema. It is not a provider's native tool calling. The K1 clients all ask for a JSON schema: Anthropic's `output_config.format`, Gemini's `responseJsonSchema`, OpenAI's `json_schema` response format, and Bedrock's single forced tool. Two of them have fallbacks: `json_object` on a server that rejects `json_schema`, and `toolChoice: auto` on a Bedrock model that rejects a forced tool. The engine validates every answer anyway, as `generateJson` does today. This keeps one validation path, needs no new dependency, and lets the engine validate the call exactly as it validates AI flows today.

Each turn's prompt holds:

- the approved brief, redacted;
- what the grant permits, in words;
- what is left of each budget;
- the latest observation;
- the last `AGENT_HISTORY_STEPS` steps, one line each (the tool, its target's name and the result code);
- the suspicions so far;
- the checks already run.

The prompt says page text is data ([ai-spec rule 5](ai-spec.md#rules)).

`generateJson` doesn't report usage today. A4 adds an optional usage callback to `JsonRequest`, filled in by each provider client, so a run can sum calls and tokens per provider and model (`AgentUsage`).

## Observations

`PageObservation` (`app/src/interfaces/agent.ts`) is built from Playwright's AI-mode aria snapshot: `page.ariaSnapshotJSON({ mode: "ai" })` in Playwright 1.63. That call returns roles, accessible names, the text a node holds, and a ref per element (`e7`). The engine then makes it safe to send:

- **Text.** Every name and text is redacted and cut to `AGENT_OBSERVATION_LIMITS`.
- **Links.** A link shows its path on the target's origin. A link elsewhere shows its origin only.
- **Field values.** Only whether a field is filled (`filled`), never the value.
- **Destructive controls.** Marked `destructive` by the same rules as today: `isDestructiveControl`, sign-out controls while signed in, and credential forms.
- **Problems.** Console errors, page errors and failed requests appear as counts since the last observation, never as messages or bodies.
- **Dialogs.** A dialog the page opens is dismissed, and reported by type and redacted message.
- **Size.** The tree is cut at 400 nodes or 24,000 characters and marked `truncated`.

A ref is valid only until the next observation. The engine resolves it with Playwright's `aria-ref=<ref>` selector, which works in 1.63 but isn't in its public types. A3 pins it with a test, so a Playwright upgrade that drops it fails loudly. The model never sees or sends a selector.

## Tools

Every tool is an `AgentToolCall` variant (`app/src/types/agent.ts`). A *browser action* counts against `browserActions`.

| Tool | Input | Action class (before the grant check) | Browser action | Result |
|---|---|---|---|---|
| `observe` | none | observation | no | observation |
| `navigate` | `path` on the target's origin | observation | yes | observation |
| `back` | none | observation | yes | observation |
| `click` | `ref` | from the control, then from the requests it causes | yes | observation |
| `fill` | `ref`, `value` (at most 200 characters; `{canary}` becomes a run-token value) | observation (nothing is sent until a submit) | yes | observation |
| `choose` | `ref`, `option` (one of the listed options) | observation | yes | observation |
| `press` | `ref`, `Enter` or `Escape` | as `click` on the control Enter submits through | yes | observation |
| `run-check` | `check` (one of `AGENT_CHECK_CLASSES`), optional `form` ref | the check's classes in `AGENT_CHECK_CLASSES` | yes, one per call | `AgentCheckOutcome` and observation |
| `note-suspicion` | `summary`, `expectation` index, `refs` | none | no | none |
| `finish` | `outcome`, `summary` | none | no | ends the run |

`run-check` is how confirmation happens:

1. The engine runs `discoverPage` on the current URL as the run's account.
2. It builds a plan holding just that check, for the chosen form or for every form on the page.
3. It runs that plan through `runPlan`, with the current URL as the target.

The check therefore runs exactly as it does in a normal run, with its own fresh page, time limit, evidence and finding rules. Its scenarios and findings join the run's report like any others. A state the agent reached only through in-page clicks, with no URL of its own, is reproduced only as far as discovery's openers reach it (up to 3 clicks, with writes blocked). That is enough for the pilot's three bugs, which live on `/app` and `/app/settings`.

The security checks that act as a second account or a visitor (`access-control`, `write-access`, `csrf`, `mass-assignment` and `paywall-trust`) are not agent tools yet.

### Tool failures

A failed call returns `{ ok: false, error: { code, message } }` with an observation when one is useful. The codes are `AgentToolErrorCode`: `invalid-input`, `stale-ref`, `not-actionable`, `off-target`, `not-permitted`, `destructive`, `repeated`, `check-not-applicable`, `budget-exhausted`, `page-error`, `cancelled`. The message is one redacted line, with no stack trace. Failed calls count against `modelCalls`. A failed browser action still counts against `browserActions`, so a model can't loop on refusals for free.

The repeat rule: the same call on a page whose observation hasn't changed since that call last ran is refused as `repeated`. This is the bound on navigation loops. Retries of a different call are the model's choice, within the budgets.

## Run states

| Status (`AgentRunStatus`) | Stop reasons (`AgentStopReason`) | Who decides |
|---|---|---|
| completed | `goal-complete` | the model, through `finish` |
| blocked | `ambiguous`, `missing-access`, `outside-grant` | the model, through `finish`. A2 turns `ambiguous` into a question, and S1 turns `missing-access` into a manual login. |
| cancelled | `cancelled` | the user (the run's abort signal, as Stop works today) |
| incomplete | `budget-exhausted` (with the budget named), `model-failure` | the engine |
| error | `engine-error` | the engine |

A model failure in an agent run ends the run as incomplete, and the run keeps every confirmed finding so far. Runs without the agent keep [ai-spec rule 6](ai-spec.md#rules): AI failure never blocks.

## Budgets

The engine enforces these whether or not the model cooperates (`AgentBudgetUse`, `AGENT_PILOT_BUDGETS`). They are carried in the grant's `budgets`.

| Budget | Pilot value | Counted |
|---|---|---|
| `browserActions` | 60 (maintainer) | each `navigate`, `back`, `click`, `fill`, `choose`, `press` and `run-check`, refused or not |
| `durationMs` | 20 minutes (maintainer) | wall clock from the first turn, including check runs and model calls; time spent stopped between a stop and a resume is not counted |
| `modelCalls` | 120 (A1) | each decision call, valid or not |
| `testRecords` | 20 (A1) | `ctx.testRecordsCreated()` across the agent's own actions and its checks |

A check that is running when a budget runs out is stopped as Stop stops it today. Its unrun scenarios are skipped, with the check's `interruptedNote`.

## Grants for agent runs

An agent run carries an `ExecutionGrant` (`app/src/interfaces/grant.ts`, the G1 shape), issued when the user approves the brief:

- **`planVersion`** is the SHA-256 of the approved brief, so an edited brief needs a new approval.
- **`identityRefs`** holds the one account the brief names.
- **`allowedTargetOrigins`** holds the brief's origin.
- **`allowedDependencyOrigins`** starts empty.
- **`permittedActionClasses`, `mutationPermissions` and `budgets`** come from the brief and the pilot defaults.
- **`expiry`** is the end of the run's time budget plus one hour, so a resume must happen within that.

A3 enforces the grant at the tools and at the network:

- each tool's action class must be permitted;
- a page request that would delete (`DELETE`), modify (`PUT` or `PATCH`), or change credentials (the credential-form rules) is aborted when its class isn't permitted;
- a request to a dependency origin is aborted for writes unless `externalWrite` is set;
- `--allow-destructive` does not widen an agent grant.

The checks keep their own rules, unchanged.

G2 and G3 later persist, audit and generalise grants for every run. Until then, the grant lives in the agent's run folder and is checked in memory.

## Evidence and suspicions

- Each browser action saves one evidence frame (`capture`), named after its step. The frame carries the step label and the path.
- A suspicion (`AgentSuspicion`) keeps the frame of the step that raised it. When the agent runs a check on the same page afterwards, the suspicion records which check ran and whether it confirmed anything (`followedBy`).
- Suspicions appear in the report's agent section and in the UI as "Suspected, not confirmed". They never appear among the findings.
- Confirmed findings from the agent's checks are ordinary findings, with evidence and an exported spec. The exit code stays as it is: 1 only for a confirmed finding.

## Persistence

| What | Where | Notes |
|---|---|---|
| Report, specs and evidence | `<runsDir>/<runId>/` as today | `Report.agent` (`AgentReport`) added by A4; absent on runs without the agent |
| The approved brief | `<runsDir>/<runId>/agent/brief.json` | redacted; its hash is the grant's `planVersion` |
| The grant | `<runsDir>/<runId>/agent/grant.json` | references only |
| The journal | `<runsDir>/<runId>/agent/journal.jsonl` | one `AgentStep` per line, append-only, redacted on write; it holds the thought, the call (typed values redacted), the result code, the class and the usage |
| The checkpoint | `<runsDir>/<runId>/agent/checkpoint.json` | `AgentCheckpoint`, replaced atomically after each step |

Never written by the agent: passwords, session values (Playwright storage state stays in memory, as today), model keys, raw prompts or raw model responses beyond the decision itself, and screenshots of anything the model was shown (it is shown none). Settings stay where they are (`ai.json`, `accounts.json`, the encrypted store).

### Continuation

A stopped, crashed or budget-exhausted run can be continued as a new run that names the old one. The new run:

1. reads the old run's checkpoint and journal;
2. refuses when the grant has expired, the brief's hash or the target differs, or the policy version changed (G1, "meaningful change");
3. signs in again with the saved account (session state isn't persisted until S2);
4. carries over the budgets already used (they are not reset);
5. shows the model a summary of the earlier steps, the checks already run with their outcomes, and the suspicions so far;
6. starts on the old run's last path.

Its report lists the earlier run in `resumedFrom`. Continuation doesn't replay actions. It continues the investigation from what is known.

## Pilot

The maintainer set this on 2026-10-06.

- **Fixture.** Fernway in bug mode with `FERNWAY_BUGS=W03,W04,V05`, signed in as account A, starting at the app's root.
- **Goal.** "make sure my tasks and profile changes save correctly."
- **Targets.** W03, a double add on `/app` (`double-submit`). W04, a bio dropped on `/app/settings` (`persistence`). V05, the help page answering 404 when opened directly (`deep-links`, from `/app`).
- **Grant.** Observation, test-data creation, and modification of the test account's own records. No deletion and no credential change.
- **Model.** The user's own key, with the pass bar checked separately on each of Bedrock, Anthropic, OpenAI and Gemini.

How the pass bar is measured:

| Criterion | Measured as |
|---|---|
| At least 2 of the 3 targeted bugs confirmed | a confirmed finding from the bug's `detectedBy` check on the bug's `page`, in one run |
| 0 confirmed false positives | 0 confirmed findings in a run against clean Fernway (`FERNWAY_BUGS=none`) with the same goal, and against each of the 5 sample apps with a goal written for it in the pilot suite |
| At most 60 browser actions and 20 minutes | `AgentReport.used`, as counted in [Budgets](#budgets) |
| A resumed run reaches the same outcome | a run stopped after its 20th browser action, then continued, confirms the same set of targeted bugs as the run's uninterrupted repeats |
| At least 2 of 3 repeated runs pass | three bug-mode runs per provider; a run passes when it meets the first and third rows |
| Cost | model calls and tokens per run, from `AgentUsage`; recorded, not a pass criterion |

For comparison: Run Hound already confirms all three bugs without the agent, when it is pointed at `/app` and `/app/settings` while signed in (Fernway's acceptance recall test). What the pilot measures is that the agent gets there from the goal alone, within the budgets, with nothing made up.

## Decisions this needs

The maintainer's 2026-10-06 decisions keep the findings decisions as they are. Three AI rules, all from the [2026-09-25 decision](decisions/09-2026.md#2026-09-25-ai-optional-off-by-default), don't fit an agent as written. Each needs an explicit superseding decision, limited to agent runs, before the work it blocks lands:

1. **Only redacted page structure is sent** ([ai-spec rule 4](ai-spec.md#rules)). An observation carries accessible names and the visible text of nodes (a task's title in a list, a status message), because a goal about what saves can't be followed from field labels alone. The proposal: allow this in agent runs only, redacted and capped as above. Everything rule 4 rules out stays ruled out (selectors, typed values, cookies, headers, bodies and screenshots), and remote consent is unchanged. **This blocks A3a.**
2. **A fixed step vocabulary, and a bound on prompt injection** ([ai-spec rules 1 and 5](ai-spec.md#rules)). Today the model composes form flows that are validated before a run. The agent chooses each action during the run. The proposal: in agent runs, the vocabulary is the typed tool set. Prompt injection can do no more than the grant permits, within the budgets, and it can never confirm a finding. **This blocks A3b.**
3. **AI failure never blocks** ([ai-spec rule 6](ai-spec.md#rules)). A model failure ends an agent run as incomplete, and the run keeps the findings so far. Runs without the agent are unchanged. **This blocks A4a.**

Nothing else is superseded:

- Destructive actions stay opt-in, and an agent grant isn't widened by `--allow-destructive`.
- Local stays local (T1).
- Model consent stays separate from workspace sync (T2).

## Tickets

A2 stays as it is: it builds and edits the `TestingBrief`. A3 and A4 are each several pieces of work that can be reviewed separately, so A1 proposes splitting them. A6 is new.

| Ticket | Scope | Depends on |
|---|---|---|
| A3a: Observe and navigate | AI-mode snapshots, redacted and capped observations, ref resolution (pinned by a test), `observe`, `navigate`, `back`, tool results and errors, the journal writer | A1, decision 1 |
| A3b: Interact under the grant | `click`, `fill`, `choose`, `press`; the agent grant checked at each tool and on page requests (`DELETE`, `PUT` and `PATCH`, credential forms, destructive controls, dependency writes); negative fixtures (CLI and API bypass, stale brief, off-scope action, page-injected escalation, from [G1](execution-grants.md#negative-test-fixtures)) | A3a, decision 2 |
| A3c: Checks and evidence as tools | `run-check` through `runPlan` on the current page, the per-check classes, `note-suspicion`, evidence per step | A3a |
| A4a: The loop | one validated decision per turn on the four providers, usage reporting in `generateJson`, budgets and cancellation independent of the model, stop states, progress events, `Report.agent` | A2, A3b, A3c, decision 3, K1 on `main` (D7) or a base on `integration/desktop` |
| A4b: Continuation and recovery | checkpoint, resume with grant revalidation, the repeat rule, bounded retries | A4a |
| A6: Pilot suite | the [pass bar](#pilot) as an opt-in acceptance suite: bug mode, clean mode and the 5 samples, 3 repeats and a resume per provider, using the live keys from the encrypted store or CI secrets | A4b |

Notes on the split:

- **S1 (manual login)** is not needed for the pilot, which signs in with account A's saved password. A4's dependency on S1 moves to V1.
- **K1's provider clients** are on `integration/desktop` until D7 merges it into `main`. A4a needs them.

## Sources

- Tickets: A1 and E2 on the project board; [K1, issue 39](https://github.com/rahul-bharati/run-hound/issues/39).
- The maintainer's decisions of 2026-10-06, recorded in [the decision log](decisions/10-2026.md#2026-10-06-agent-findings-and-models).
- Playwright 1.63's `ariaSnapshotJSON` options (`mode: "ai"`), and the `aria-ref` selector, as verified locally.
- The code references above, read on `main` at A1.
