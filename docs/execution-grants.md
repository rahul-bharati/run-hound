# Execution grants (G1)

Specification only for scoped execution grants and engine enforcement boundaries. This is the G1 contract (see issue #21). No runtime behavior changes; implementation is G2/G3. The grant is the single authorization contract for desktop, agent-driven runs and (future) shared team policy.

It extends the V2 write-side contracts (docs/v2-spec.md), the AI layer (docs/ai-spec.md) and the safety/guard foundations (v0/v1). Everything stated in those specs still holds. Acceptance criteria for this ticket are met by the specification and negative-fixture definitions below; the acceptance suite will enforce them once controls land.

## Grant structure

A grant binds a run's authority to an actor, an approver, exact versions of the plan and policy, identity references (never secrets), permitted origins and action scopes, mutation permissions, an expiry and resource budgets. Grants are produced after explicit approval of a plan (with its scenarios, destructive flags and AI suggestions) against the active policy.

Fields (the contract shape; serialized form and storage details are future work):

- `id`: opaque unique identifier for this grant (string). Used for audit and (future) reuse/invalidation by id.
- `actor`: reference to the performer (e.g. `{ type: "local-user" | "team", id: string }`). Never contains credentials or secrets.
- `approver`: reference to who (or what policy engine) granted it (e.g. user id, "policy:<version>", "self" for local desktop approval).
- `project` / `environment`: scoping labels (strings or structured) for team environments; absent or "default" for single-user desktop.
- `planVersion`: exact binding to the plan (e.g. content hash of the serialized Plan or a stable planId+timestamp from the store at approval time). A changed plan (different scenarios, different target, added AI flow, etc.) invalidates the grant.
- `policyVersion`: exact binding to the approval policy in force at grant time.
- `identityRefs`: references only (e.g. `["a"]` or `["self"]`), never the passwords, session values or tokens themselves. Those remain in accounts storage and are redacted (engine/redact.ts, v2-spec.md).
- `allowedTargetOrigins`: list of origins (scheme+host+port) or host patterns the run may act on. Subset of what the safety gate would allow.
- `allowedDependencyOrigins`: origins permitted for non-target resources (CDNs, auth providers, analytics that the app under test contacts). Background requests and includes are in scope.
- `permittedActionClasses`: array of classes the grant authorizes (see taxonomy below). Example: `["observation", "test-data-creation"]`.
- `mutationPermissions`: finer-grained booleans or enums, e.g. `{ createTestRecords: true, modifyExisting: false, delete: false, changeCredentials: false, externalWrite: false }`.
- `expiry`: absolute or relative time (ISO or seconds). After expiry the grant is invalid even if plan/policy versions still match.
- `budgets`: resource caps for the grant, e.g. `{ maxDurationMs: 300000, maxRequests: 500, maxTestRecordsCreated: 10, maxPages: 20 }`.

Grants never carry secrets. A grant is invalid if any binding (planVersion, policyVersion, actor scope, expiry) fails, or if the attempted action is outside the permitted classes/mutations/origins.

## Enforcement points

Grants must be validated (presence, bindings, scope, permissions, not expired, budget headroom) before any privileged action. The modules below already perform related validation or gating. Their observed behavior is described with file:line citations; the gap column records what a grant check would add (currently absent because this ticket is spec-only).

| Module | Observed behavior (with citations) | Gap vs. grant contract |
|--------|------------------------------------|------------------------|
| `app/src/engine/safety.ts` | `checkTarget` (line 90) and `assertAllowedTarget` (line 149) implement the safety gate: only http(s) to localhost/*.localhost, private addresses (isPrivateAddress lines 52-65), or hosts in allowedHosts (line 109). Returns `TargetCheck` or throws `TargetNotAllowedError`. Used for both navigation and direct requests. `pinArgs` (line 167) for DNS pinning. | No grant consulted. Any run (or any caller) that reaches a target passing safety proceeds. No actor/approver binding, no planVersion/policyVersion match, no action-class or mutation restriction, no per-grant expiry or budgets. |
| `app/src/engine/guard.ts` | Three-layer navigation guard (comment lines 1-18): (1) `context.route` aborts non-allowed navigation requests before send (lines 90-95: `if (!request.isNavigationRequest()) return route.fallback(); if (await decide...)`), (2) watches `request` for redirects that already escaped and closes context (lines 98-102), (3) watches `response` for DNS-rebind answers from public addresses and closes (lines 108-118). `rememberCredentials` and `guardSummary`. Non-nav requests explicitly not guarded: "Requests that are not navigations (fetch, scripts, images) are not guarded." (line 14). | Background (non-navigation) requests bypass entirely. No grant scope: a granted "observation only" run can still have its page perform off-scope background fetches within the broad safety set. Redirect and rebinding coverage is nav-only; direct-HTTP and background have no equivalent. No version or actor check. |
| `app/src/engine/context.ts` | `request()` always calls `await checkTarget(request.url...)` first (line 547) before `api.fetch` (maxRedirects:0, line 564; 10s timeout, line 565). `openPage` installs the guard (line 611) and seeds sessions. `allowDestructive` is stored (line 528) and exposed. `isAcceptedSave` (lines 386-394) defines test-data creation (non-GET, non-GraphQL-read save requests to target or carrying runToken that get 2xx/3xx; counted on page responses line 624 and request answers line 582). Credential headers harvested only from app's own requests (lines 153-168); `request()` sends only the identity's harvested ones (line 555). | Direct-HTTP is safety-gated but not grant-validated (no permittedActionClasses, no identityRef match to grant, no budget). Background page activity is captured for save counting but not gated or classified against a grant. No planVersion binding; allowDestructive is a bare boolean, not derived from a validated mutationPermissions grant. |
| `app/src/engine/runner/run-flow.ts` | `runPlan` resolves target (line 181), computes `approvedIds` from options or `defaultSelected` (lines 187-188), filters `toRun` (line 192), errors if none or unknown (lines 189,193). Destructive check: `if (scenario.destructive && !allowDestructive)` skip (lines 295-296). Then `check.run(ctx, scenario)` (line 352) inside per-scenario wrapper that also checks other-account needs. `preHarvest` for signed-in. | Scenario approval list is the only "grant" (coarse, id-based, not bound to planVersion/policyVersion/actor/expiry). No grant object is passed or checked before `runScenario`. Destructive flag and approved list are not derived from a grant's mutationPermissions + permittedActionClasses. Budgets and identity scope are not enforced here. |
| `app/src/server/models/run-flow.ts` | `start` validates `approved` is string[] (lines 52-57), rejects unknown ids vs current plan (lines 67-70), requires at least one (lines 73-75), then calls `runs.startRun(plan, approvedIds, {allowDestructive, ...})` (line 84). `rerun` re-plans and filters `state.approved` to those still present in new plan (line 143), passes the filtered list (line 152). Concurrent-run count (line 124). | No grant struct; the approved list travels without version/actor/approver bindings or expiry. Rerun re-uses the id list without re-validating against a grant or detecting meaningful change. No enforcement point for budgets or permitted classes before the run is started. |
| `app/src/ai/suggest.ts` | Produces flows using fixed action vocabulary (lines 18,62-78: fill/choose/click/press/expect). Refuses Tab/Space keys that could reach destructive controls without a visible click step (lines 165-166, comment line 22). `flowIsDestructive` (line 206) returns true for click on `isDestructiveControl` or Enter when `destructiveEnterTarget` (from checks/ai-flow). Marks resulting scenarios `destructive: flowIsDestructive(...)` (line 265) and `defaultSelected: false`. Prompt tells model "Do not click controls marked \"destructive\": true." (line 127). | Model output contributes to the plan that later receives an approval list. No grant is produced or consulted inside suggest; authority never flows from model (see limits below). No allowed-origins or dependency checks inside the suggester. |
| `app/src/checks/ai-flow.ts` | Destructive gate before executing steps: if a resolved click is destructive or Enter would submit destructive, and `!ctx.allowDestructive`, returns skipped (lines 384-401, 405). Mid-flow, if focus lands on destructive and not allowed, stops (lines 436-439). Also refuses Enter on submitsDestructive (lines 472-476). Uses `destructiveEnterTarget` (lines 118-121). | The `allowDestructive` boolean (passed from runner) is not a grant-derived permission. An AI flow can still be proposed and (if approved at scenario level) executed for off-scope actions unless the check itself refuses. No per-grant identity or version check inside the flow runner. |

These are the pre-existing enforcement points cited in the ticket. Future grant validation will be inserted at the call sites above (and at the server start/run entry points) before the existing gates run. "Observed versus gap" is recorded so that negative fixtures can target the gaps.

## Action taxonomy

Privileged actions are separated so grants can be narrow. The taxonomy used by `permittedActionClasses` and `mutationPermissions`:

- **Observation**: pure reads and inspection. Examples: `openPage` (for view only), GET `request`, `screenshot`/`capture`/`record` without subsequent writes, reading console/network for errors, most built-in checks that only assert presence/absence. Never mutates app state.
- **Test-data creation**: creation of records under test control (the "test records" counted by `ctx.testRecordsCreated()` and `isAcceptedSave` in context.ts:386). Includes form posts, non-GET fetches and XHR that the app accepts and that carry the run token or are page posts (not GraphQL reads). Distinct from modification of pre-existing data.
- **Modification**: updates to existing records or state (edit profile, change quantity, toggle setting). Requires explicit `mutationPermissions.modifyExisting`.
- **Deletion**: removal of records or accounts (delete booking, remove user). Separate high-privilege class.
- **Credential change**: any action that alters passwords, sessions, API keys or auth material on the target app. (Distinct from Run Hound's own account secrets, which are never sent to the model and are redacted.)
- **External communication**: any request or navigation whose origin is not the primary target but is listed in `allowedDependencyOrigins` (or the target's own sub-resources). Covers background fetches, images, scripts, redirects that land on dependency hosts, and `request()` calls to other allowed origins.

A grant for a read-only audit run would list only `["observation"]`. A normal test run might list `["observation", "test-data-creation"]` with `mutationPermissions` limited to test-record creation. Destructive controls (dead-control.ts, ai-flow.ts) are further gated by the allow-destructive flag today; under grants they map to the modification/deletion/credential classes.

## Background-request, redirect and direct-HTTP coverage

All three must be covered by the grant before they are allowed:

- Background requests: non-navigation requests (fetch, XHR, images, scripts, service workers) issued by the page under test. Guard only installs a route for `isNavigationRequest()` (guard.ts:91) and falls back for everything else. Page response listeners still run for save detection (context.ts:614). A grant's `allowedDependencyOrigins` + permitted classes must be checked (or the whole background surface refused) for any run that is not observation-only.
- Redirects: top-level and in-frame redirects. Guard catches them after the hop (guard.ts:99-101 for the request event, 110 for response) and closes the context. `request()` uses `maxRedirects: 0` (context.ts:564). The landed URL must still be within the grant's allowed origins for the action class being performed; a redirect that would take an observation-only run into a modification endpoint must be refused (or the context closed) exactly as an escape is today.
- Direct-HTTP: calls to `ctx.request(as, { method, url, ... })`. Already does a safety `checkTarget` (context.ts:547) and harvests/sends only the identity's own credential headers. Must additionally validate that the grant permits the requested method+origin for the action class, that the identityRef matches a grant identity, and that budgets have headroom. Redirects are not followed.

Coverage is required at the engine boundary (context + guard + safety) and at the runner/server entry points. Page-injected actions (a script on the target that performs a privileged fetch) are still subject to the same gates; the grant is never trusted from page content.

## Batched approval and meaningful-change invalidation

Approval is batched: a single grant (or approval list today) covers multiple scenarios or action classes for a plan. This avoids prompting on every click or every background request (see current `--approve all|default|<ids>` and the UI plan review flow).

Meaningful change invalidates the grant:
- Any difference in the plan that would change its `planVersion` (added/removed scenario, changed target, different AI-suggested flow steps, different discovered controls that affect a write check, etc.).
- Policy version bump.
- Target origin change.
- Expiry reached.

Current rerun re-plans and re-filters the approved id list (server/models/run-flow.ts:142-143) but does not require fresh approval or detect "meaningful" vs. cosmetic change. Under the grant contract the filtered list would be rejected if the new plan's version does not match the original grant's `planVersion`; a fresh grant (or a "no meaningful change" attestation) would be required.

Batching is therefore at the granularity of "this grant authorizes the following action classes for this exact plan version."

## Negative test fixtures

The following negative cases must be specified (and later exercised by fixtures) before any grant control is implemented. They ensure the boundaries are drawn correctly:

- CLI/API bypass: a direct invocation of `runPlan` (runner/run-flow.ts), `start` (server/models/run-flow.ts) or the underlying check runner that supplies a forged or absent grant (or an approved list that bypasses the grant path) must be refused at the first enforcement point it reaches. CLI flags (`--approve`, `--allow-destructive`) and raw API bodies must not short-circuit grant validation.
- Stale approval reuse by id: supplying a previously issued grant `id` (or its approved scenario list) after the plan has changed (different `planVersion`), after the policy version advanced, or after the grant's expiry. Must be rejected even if the ids still exist in the new plan.
- Off-scope action: a grant limited to `["observation"]` (or `mutationPermissions.createTestRecords` only) that then attempts a modification, deletion, credential change or external write. Must be blocked at the site that would perform it (ai-flow destructive gate, write-access check, context.request for a mutating method, etc.), with a clear "grant does not permit" error. Covers both built-in checks and AI flows.
- Page-injected escalation: the page under test (or a compromised script) attempts to cause a privileged action (form submit that is a modification, fetch that writes, navigation that would be off-scope) or to smuggle/escalate a grant. The engine boundaries (guard, context.request, check run) must still enforce the grant that was issued to the runner, never trust page state or injected values for authority.

Fixtures will be negative (they assert refusal) and will be placed under the app test tree once G2 begins. They are defined here so that the contract can be reviewed independently of any implementation.

## Explicit limits

- Local hash chains (or any local grant-integrity mechanism) are not tamper-proof. A user or process with access to the machine's filesystem can edit stored grants, hashes, or the code paths that would validate them. Grants provide scoping, auditability and least-privilege for the Run Hound process and for future team sharing; they are not a cryptographic security boundary against the local machine owner.
- Model output never grants authority. Suggestions (`ai/suggest.ts`), reviews and explanations (`ai/review.ts`, `ai/explain.ts`) and AI flows (`checks/ai-flow.ts`) are advisory only. The resulting plan may contain AI-authored scenarios, but execution authority is granted only by an explicit approver (user or policy) that produces a grant after reviewing the plan. This extends ai-spec.md Rule 1 ("The model never decides pass or fail") to "model output never grants authority."
- Grants contain only references for identities; the actual secrets remain outside the grant and are redacted everywhere else.
- Budgets and expiry are enforced at the start of a run and (for budgets) during execution; they are not a hard guarantee against all resource exhaustion.
- The specification is closed for G1: no new research or modules are invented here.

All claims about current code are backed by the cited lines in the files listed in the ticket. Lines were verified by direct reading of the modules in the worktree. Unverified claims are marked as such in the text above (none remain after verification).

## Sources

- Ticket: gh issue 21 (G1)
- Acceptance criteria in the issue text.
- Code contracts cited inline.
- Style and decision process per AGENTS.md and DECISIONS.md.

This document is the deliverable for G1.