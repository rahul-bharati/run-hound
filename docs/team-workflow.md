# Team workflow: objects, roles, and policy-based approval (T1)

The collaboration contract for Run Hound's team features. It extends [v2-spec.md](v2-spec.md) and [launch-spec.md](launch-spec.md); everything there still holds. The code contracts cited are `app/src/server/models/host-state.ts`, `app/src/server/models/run-flow.ts`, `app/src/operations/accounts-storage.ts`, and `app/src/engine/isolation.ts`, with the JSDoc of every server and operations module they sit beside. This ticket is **specification only**: no code change ships in T1, and every claim that depends on code not yet written is marked unverified.

The goal is one agreed model the maintainer can sign off before any team feature is built. Implementation tickets (T3, T4, G2, V1) and the hosted-sync contract (T2) build on this. Where a term is shared with T2, the wording here is what T2 is expected to reuse.

## Rules

1. **Local stays local, the hosted workspace only coordinates.** Run Hound's own process runs on each user's machine: the browser, the test accounts' passwords, the session values the sign-in produces, the model keys, the AI prompts, the evidence, and the test runs themselves never leave the machine that ran them. What the hosted workspace sees is the smallest set of objects needed to coordinate, and only those a goal author has chosen to share. The T2 ticket decides what is and is not uploaded; here we name the objects and their upload classes.
2. **The hosted workspace is not a source of truth for execution.** Plans are built locally (`app/src/server/models/run-flow.ts` re-plans for a rerun under the same account on the local machine); runs are executed locally; the workspace stores the immutable references to which plan, which approvals and which scenario versions a run was performed against. A reviewer approves a version, not a name; a run is later judged against that version.
3. **Identity is per-person, not per-role.** A person can hold more than one role (an owner can also be a QA/operator; a QA/operator can be a designated reviewer for a non-elevated environment). Authorisation is decided on the strongest capability the role grants for the action and the environment. Only the **designated reviewer** relation is environment-specific.
4. **One machine per signed-in run.** Test accounts A and B are bound to a single machine by the password origin the saved slot was created against (`app/src/operations/accounts-storage.ts`, `boundOrigin` and the `passwordOrigin` re-binding in `saveAccounts`): the saved password is never sent to a sign-in page from a different origin. A team goal that needs Account A on another machine must save A's password on that machine (or use the env override), and that is the user team's choice, not the workspace's. Sharing a password between teammates, including through the hosted workspace, is out of scope ([below](#6-out-of-scope)).
5. **The browser isolation is preserved end to end.** Every browser Run Hound launches gets an allowlisted environment and a per-launch home folder (`app/src/engine/isolation.ts`, `launchChromium` and `browserEnv`), and no context accepts a download (`ISOLATED_CONTEXT`, applied by the wrapped `newContext` and `newPage`). A team workflow that needs to drive the browser from a teammate's machine relies on the same isolation; nothing in this document weakens it.
6. **The safety gate stays per-run.** `host-state.ts` resolves `allowedHosts` from the per-instance configuration (explicit option, else `RUNHOUND_ALLOWED_HOSTS`); `engine/safety.ts` checks the target, and `engine/guard.ts` keeps a context on the address the gate approved. A team goal names the target it plans to run against; the run is refused on any machine whose host state does not list the target.
7. **Approvals are immutable and versioned.** The approved set of scenarios, the policy under which they were approved and the scenario versions of the plan they were approved against are frozen when the approval is recorded. A new plan version or a new policy version starts a new approval; an old approval cannot be edited in place. Re-plans during a run (T2's optimistic concurrency) reject conflicting updates instead of last-writer-wins.
8. **Everything the workspace sees is audit-logged.** The audit log lives in the workspace, alongside the object it audits (a per-goal event log), and is append-only. Viewer/commenter reads are not audited; administrative changes (role grants, environment designations, policy changes, break-glass invocations) are.

## Objects

Every object has a stable id (a workspace-issued identifier except where noted), an owning workspace, a creator and a creation timestamp. The names below are the contract T2's sync, T3's UI and T4's audit features will read.

| Object | Identity | Owns | Owned by | Notes |
|---|---|---|---|---|
| **Workspace** | issued by the platform; cannot be renamed (a renamed workspace is a new one, with the old one's runs and findings carried by reference) | projects, members, environments, audit log | platform | A workspace is the unit of billing, of role assignment and of audit. The hosted workspace coordinates; nothing it stores is required to plan or run a test. |
| **Project** | issued by the workspace; a short, changeable slug unique inside the workspace | features, goals, scenarios, runs (by reference), findings (by reference) | workspace | A project groups goals for one product area; it does not own the runs themselves. Two projects may share an environment. |
| **Environment** | issued by the workspace; named (e.g. `staging-eu`, `local-dev`, `prod-mirror`) | designated-reviewer assignments, target allow-list, policy bindings | workspace | An environment is the unit at which independent review and elevated policy are decided. "Designated" is a per-environment role relation, not a global one. |
| **Feature** | issued by the project; named | goals | project | A feature is what a user wants to verify (a checkout, a sign-in, an admin tool). It is the unit at which goals are listed; it is not a place where runs are stored. |
| **Goal** | issued by the project; a short slug unique inside the project | scenario versions (proposals and frozen ones), approvals, runs (by reference), findings (by reference) | feature, created by one member (the **author** of the goal) | A goal is one verifiable statement ("the checkout does not lose the cart on reload"). It owns its scenario versions and approvals; the runs and findings are stored on the machine that produced them and referenced from here. |
| **Scenario version** | issued by the project; monotonically increasing per goal | its plan, its policy version, the goals it was approved against | goal | A scenario version is the frozen result of one planning pass against a target: the discovered page, the planned scenarios, the policy and identity it was built under, and the SHA-256 of the plan's serialised form. Re-plans make new versions; the old version is kept for replay and audit. |
| **Run** | issued by the local Run Hound process; a UUIDv7; the canonical id is the local id, the workspace only ever stores it as an opaque reference | its findings, its evidence, its redacted summary | machine, by reference from one scenario version and one approval | A run is local. The workspace sees a redacted summary, the scenario version it ran against, the approval it was performed under, the redacted finding list and the ticket link, never the evidence. Evidence stays on the run's machine; sharing it is a separate, explicit action by the run's owner. |
| **Finding** | issued by the local run; a UUIDv7; one run owns many findings | its redacted fields (severity, category, confidence, scope, location, evidence facts with secrets redacted) | run, by reference from the workspace's goal | A finding's canonical store is the run that produced it. The workspace sees only the redacted view; a finding is never edited in the workspace, only annotated (a triage state, a comment, a ticket link). |

### Identity rules

- **Idempotent references.** A goal references a scenario version by id; a run references the scenario version and the approval it ran against. Replaying the same approval against a new scenario version starts a new run with a new local id; the old run keeps the old version reference.
- **No cross-workspace references.** A run, finding or approval cannot be referenced from another workspace. Cross-workspace sharing is by export and import, never by live link, and is out of scope for T1.
- **Goals own their approvals.** An approval is removed when its goal is deleted; a goal cannot be deleted while a run against it exists in any workspace, only archived.
- **Scenarios and scenario versions are distinct.** A scenario is the recipe a check runs (one of the built-in ids plus an `ai-flow:<n>` id when the AI suggests one); a scenario version is one plan's frozen list of those scenarios with their per-form settings, in one policy. Renaming a scenario (a stable public id, per the existing decision) does not change a scenario version's id.

## Roles

A workspace has four roles. Capabilities are the strongest action a role grants in the **base** environment; the policy may widen a capability for an elevated environment or narrow it for a designated one. Capabilities that are not listed are denied.

### Owner / admin

- Create, archive and delete projects; rename them when no external system depends on the name; transfer a project to another workspace (out of scope to implement here).
- Invite and remove members; grant and revoke roles per member; designate reviewers per environment.
- Create, edit and delete environments; bind a project to one or more environments; set the target allow-list per environment.
- Edit workspace-wide policy (the default elevated scopes, the default reviewer pool, the audit retention).
- Resolve break-glass invocations; close an open break-glass window; remove an audit entry (only by appending a redaction record, never by deleting the row).
- **Cannot approve a goal they authored in an elevated environment** (separation of author and approver); can approve ordinary-scope goals in any environment.

### QA / operator

- Create goals; propose scenario versions; run the planner locally; attach local runs to a scenario version.
- Approve ordinary-scope goals in any environment, including goals they authored (self-approval is the rule for the base case).
- Triage findings: set the triage state, add a comment, link a ticket.
- Start and stop a run they own; rerun a run they own; export a run's redacted summary.
- **Cannot** approve an elevated-scope goal (it must be routed to a designated reviewer) and **cannot** bind a project to an environment they did not create (the binding is a project-level decision).

### Designated reviewer

- Everything QA / operator can do, plus:
- Approve an elevated-scope goal in the environment they are designated for.
- Open and resolve a break-glass window for an elevated scope in their environment.
- **Independent of the author**: an approval of an elevated-scope goal is refused if the approver is also the goal's author, or if the approver has a run-role on the goal (a reviewer may not run the goal they review; the run role and the approval role are separate).
- The role is per-environment: a designated reviewer for `staging-eu` is not a reviewer for `prod-mirror`.

### Viewer / commenter

- Read access to projects, goals, scenario versions, approvals, redacted run summaries, redacted findings, comments and audit events.
- Comment on a goal, scenario version, approval or finding.
- **Cannot** create or edit goals, approvals, runs, findings, environments, role grants or policy; cannot triage; cannot export.
- Commenter is a workspace-level capability, not a separate role: a viewer / commenter is a member with the viewer permission set (read + comment) instead of the QA/operator permission set.

## Policy-based approval

A goal is approved by one of three paths. The path is decided by the policy bound to the goal's environment at the time the approval is requested, and by the goal's scope.

### Ordinary in-scope self-approval

- **What it is.** The goal's planned scenarios are entirely within the environment's base scope: no destructive action, no third-party account, no production data, no elevated environment. The author opens the plan, ticks the planned scenarios, and records the approval against the scenario version.
- **Who can approve.** The goal's author (default) or any other QA / operator in the workspace.
- **What it produces.** A frozen approval against the scenario version. The approval's auditor shows the author, the timestamp, the policy version and the SHA-256 of the approved scenario list.
- **Why it is the rule.** Most goals in a typical team are in scope for self-approval. The default policy in the workspace makes self-approval the cheap path so that day-to-day work is not blocked; the cost is on the cases the policy flags.

### Elevated scopes routed to reviewers

- **What it is.** A planned scenario, the goal's environment, or the target itself, is in the environment's elevated scope. The policy names the elevated scope and the reviewer pool for it; the policy version is recorded on the approval.
- **Examples of elevated scope** (the maintainer chooses the exact list, [below](#5-unresolved-decisions-for-the-maintainer)):
  - any scenario that needs `--allow-destructive` (a destructive control click, a session-ending control, an Enter in a form whose submit is destructive);
  - any goal on a `prod-mirror` or production-tagged environment;
  - any goal whose target is outside the workspace's default allow-list (the policy names a wider allow-list per environment, but a target outside the union needs review);
  - any goal that exercises a write-side V2 check (`write-access`, `paywall-trust`, `csrf`) on a non-test account.
- **Who can approve.** A designated reviewer for the goal's environment who is **not** the goal's author and has not run the goal in the current cycle.
- **What it produces.** A frozen approval against the scenario version, with the reviewer's id, the policy version, the elevated scope tag and the rationale the reviewer typed in (a short, required field).

### Independent review for designated environments

- **What it is.** The workspace maintainer marks certain environments as **designated**: environments that, by their data sensitivity or by their role in the team's release process, may not approve a goal without an independent reviewer on the team.
- **Default designated set.** Environments named `prod*`, `*prod-mirror*`, `*customer-data*` and any environment bound to a regulatory tag (`pci`, `hipaa`, `gdpr-special`) are designated by default. The maintainer can add or remove environments from the default set per workspace.
- **What it changes.** A goal in a designated environment is always routed to a designated reviewer, even when its scope is ordinary. A QA / operator may self-approve in a non-designated environment.
- **What it does not change.** The independence rule (reviewer ≠ author, reviewer ≠ current run-role) is the same as for elevated scopes; the only difference is the trigger.

### Break-glass with audit

- **What it is.** A QA / operator may start a run that would otherwise need reviewer approval when no reviewer is reachable, and they may record an approval they would otherwise need a reviewer to record, with an open break-glass window.
- **How it is invoked.** A command in the local Run Hound UI ("Approve with break-glass") asks for a reason (free text, 30 characters minimum), a contact for the reviewer who would have approved, and an expiry (the maximum is the workspace's `maxBreakGlassWindow`, default 4 hours).
- **What is recorded.** The approval carries `breakGlass: { reason, contact, openedAt, openedBy, expiresAt, resolvedBy?, resolvedAt?, resolution? }`. A reviewer may resolve the window with one of three states: **confirmed** (the reviewer ratifies the approval as if they had been there), **rolled back** (the run is treated as if the approval had not been given, and the run's findings are moved to a "not approved" view; the local run is not deleted), or **left open** (the window expires; the policy decides what happens to the run, [below](#5-unresolved-decisions-for-the-maintainer)).
- **What it cannot do.** Break-glass cannot grant a role or a permission; it cannot override the independence rule (the reviewer who resolves the window must still not be the goal's author); it cannot change the audit log. Every invocation is in the audit log with a stable id.

## Worked example

The following is the end-to-end story for one goal, showing the contracts above in use. The actors are the author (Sam, QA/operator), the reviewer (Pat, designated reviewer for `staging-eu`) and the platform (the hosted workspace). The target is a checkout flow on the team's staging environment.

1. **Sam assigns a goal.** Sam opens the team's hosted workspace, picks the `checkout` feature in the `web-store` project, and creates a goal: "The checkout does not lose the cart on reload." The goal's environment is `staging-eu`. The goal's id is issued by the workspace; Sam is recorded as the author.
2. **Sam explores locally.** Sam opens the local Run Hound UI on their machine, points it at the staging-eu sign-in page, and signs in as Account A (the saved password is local to Sam's machine, bound to the sign-in page's origin). The planner runs, the plan is built against the latest discovered page, and Sam reviews the scenarios. None of them is destructive; none touches a write-side V2 check; the environment is `staging-eu` but the policy for `staging-eu` does not mark it designated. The plan is in ordinary scope.
3. **Sam approves.** Sam ticks the planned scenarios and records the approval against the scenario version. The workspace records the approval: author Sam, timestamp, policy version, SHA-256 of the approved scenario list. The approval is frozen.
4. **Sam runs locally.** Sam starts the run on their own machine. The local process checks the host state (`app/src/server/models/host-state.ts`): `staging-eu` is in `allowedHosts`, so the safety gate passes (`app/src/engine/safety.ts`); the browser is launched through `launchChromium` (`app/src/engine/isolation.ts`), with the per-launch home folder, the allowlisted environment and the `ISOLATED_CONTEXT` rule. The run produces findings, redacts their secrets, and writes a redacted summary to the workspace against the goal and the scenario version.
5. **Sam shares redacted results.** Sam opens the goal in the workspace. The redacted summary, the finding list and the SHA-256 of the run are visible; the evidence is not. Sam adds a comment ("CSRF refused the cross-site forge — looks real") and links the team's ticket tracker: the workspace records the link as a comment annotation, not a finding edit.
6. **Sam triages.** Sam sets the triage state of the finding to "confirmed", assigns it back to themselves, and links the team's ticket (#4188) to the finding. The ticket is a comment annotation on the finding; the finding's redacted fields are not changed.
7. **Sam verifies the fix in a new run.** The team fixes the bug. Sam reruns the same goal locally. The local planner produces a new scenario version (the discovered page changed); Sam records a new self-approval against the new scenario version, because the change is still in ordinary scope. The new run references the new scenario version and the new approval; the old run and approval are kept for audit. Sam links the new run to the same ticket, and closes the loop in the workspace.

The example is what T1 promises. A goal with an elevated scope follows the same path with the reviewer step inserted between steps 3 and 4; a goal in a designated environment follows the same path with the reviewer step inserted for any scope.

## 5. Unresolved decisions for the maintainer

The contract above has three open questions. Each has two or three options, with a recommended default the worker chose on the principle of "the local machine is the source of truth; the workspace coordinates". The maintainer is asked to confirm or change the default; T2 onward use the answer.

### 5.1 Offline execution

When a team member runs a goal against a scenario version they have an approval for, but they are offline (no connection to the hosted workspace), what happens to the run's redacted summary, finding list and ticket link?

| Option | What it does | Trade-off |
|---|---|---|
| **Buffer locally, upload on reconnect (recommended).** | The local run records the redacted summary, the finding list, the approval reference and the ticket link in a per-goal outbound queue; on reconnect, the workspace's sync service applies them in order. The workspace shows a "pending sync" state for the goal until the queue drains. | Works without the workspace. Audit gap is the offline window. T2 should spec the queue's durability and conflict handling. |
| Refuse to run without workspace connectivity. | The local process refuses to start a team-goal run when the workspace is unreachable. | Predictable, but it blocks a team whose hosted workspace has a transient outage. The current single-user Run Hound keeps running. |
| Run locally, never upload. | The run is recorded only on the local machine; the workspace has no record of it. | The workspace loses the audit. Rejected: the workspace's value is the team-wide view. |

### 5.2 Revocation freshness

When a member's role is revoked, or a designated reviewer is removed from an environment, how long does a queued approval they made keep its authority?

| Option | What it does | Trade-off |
|---|---|---|
| **Revoke at upload (recommended).** | The approval is valid on the machine that produced it; when the local process next reaches the workspace, the workspace checks the approval against the current role and policy versions. A revoked approval is recorded as revoked, and the run is treated as if the approval had not been given; the run's findings move to a "not approved" view; the local run is not deleted. | Honest about what the workspace now allows; protects against a fired teammate's approval surviving their role. The local run keeps its evidence for the user. |
| Revoke at the next planner pass. | A new scenario version requires a fresh approval; an old approval against an old version is still usable for that one version. | Simpler, but a revoked role can still be exercised against an old version indefinitely. Rejected. |
| Revoke in real time. | The local process must confirm every approval with the workspace before starting a run. | Strongest, but a workspace outage blocks a run that was already approved. Rejected for ordinary scope; acceptable for elevated scope if the maintainer wants the asymmetry. |

### 5.3 Elevated independent-review rules

Which scenarios, environments and target classes count as elevated, and which need an independent reviewer (not the author)?

| Option | What it does | Trade-off |
|---|---|---|
| **Recommended default.** Destructive scenarios; any goal on a `prod*` or `prod-mirror*` environment; any goal whose target is outside the environment's default allow-list; any goal that exercises a write-side V2 check (`write-access`, `paywall-trust`, `csrf`) on a non-test account. Designated environments: `prod*`, `*prod-mirror*`, `*customer-data*` and any environment with a regulatory tag (`pci`, `hipaa`, `gdpr-special`). Independence: reviewer ≠ author and reviewer ≠ current run-role. | Matches the existing V0/V1/V2 destructive and V2 write-side rules already in the engine; the reviewer pool is per-environment, the independence rule is small and easy to state. | The default may be too narrow for some teams (an org that treats `staging-eu` as sensitive because it carries real customer data is not covered by the default designated set; they can add it). The default may be too wide for others (an org that runs an internal mock on `prod-mirror` does not need a reviewer for a non-destructive goal). The defaults are starting points. |
| A single binary: every goal in every environment needs an independent reviewer. | Strongest, simplest to explain. | Slows day-to-day work; rejected: the worker cannot recommend a rule that makes ordinary work wait on a reviewer. |
| Per-check elevation, decided by the check author. | Each check ships with an `elevated: true` flag, and the policy lists the checks it considers elevated. | Fine-grained, but it pushes the policy decision to every check author, and a check author can quietly raise the bar. Rejected. |

The maintainer's call on 5.3 is the one that needs a real answer before T3 and T4 are scoped. The T1 worker does not need to know it to finish this spec; the worker's recommendation is recorded as the recommended default above.

## 6. Out of scope

The following are explicitly not part of T1, and are recorded here so T2, T3, T4, G2 and V1 do not silently pick them up.

- **Hosted runners.** A goal runs on a teammate's machine, never on a Run Hound-managed host. The hosted workspace coordinates; it does not execute.
- **Credential sharing.** The workspace never sees a test account's password, a session value, a model key, an API key, a cookie or a token. The local machine owns them. The workspace only sees the references it needs to coordinate.
- **Live co-browsing.** A teammate cannot drive another teammate's browser, share their screen, or watch their live run. Sharing is by redacted summary, comment, ticket link and the explicit export of a single run (a separate, logged action).
- **Enterprise SSO.** Workspace sign-in is the platform's own authentication. SSO providers, SCIM, SAML and OIDC are out of scope; the hosted workspace's platform decides whether to add them.
- **Billing.** The workspace's billing model, seat licences, plan tiers and metering are out of scope; T1 does not constrain them.

## Cited contracts (current code)

- `app/src/server/models/host-state.ts` — `HostState.allowedHosts()` is the input to the safety gate, resolved from the per-instance option or `RUNHOUND_ALLOWED_HOSTS` (lines 33-38); the gate itself is `engine/safety.ts`. The team-workflow contract uses the same per-machine list to decide whether a teammate's run can reach a goal's target.
- `app/src/server/models/run-flow.ts` — `RunsFlow.start` validates `approved` as a list of scenario ids against the current plan, falls back to the plan's `defaultSelected` set when the body omits it (lines 66-75) and refuses to start with an empty approval set (lines 73-75). A re-run filters the prior approval by the re-planned scenario ids (lines 142-151). The team-workflow contract reuses this filtering: a re-plan against a new scenario version starts a new approval.
- `app/src/operations/accounts-storage.ts` — `boundOrigin` (line 130) and the `passwordOrigin` re-binding in `saveAccounts` (lines 419-447) keep a saved password bound to the sign-in page's origin, so the password is not sent to a different origin on the same machine. The team-workflow rule that one machine per signed-in run is the worker-readable consequence of this binding.
- `app/src/engine/isolation.ts` — `launchChromium` creates a per-launch folder under `os.tmpdir()`, builds the allowlisted environment with `browserEnv` and removes the folder on close, on crash, on failed launch and on process exit (lines 163-239); the wrapped `newContext` and `newPage` apply `ISOLATED_CONTEXT` (`acceptDownloads: false`) last, so no call site can opt a context back into downloads (lines 221-224). The team-workflow rule that the browser isolation is preserved end to end means a team run runs under the same module.

## Unverified claims

- The set of V2 write-side checks named as elevated by default in [5.3](#53-elevated-independent-review-rules) is the worker's reading of the V2 contract; T2 should confirm that "write-side" is the right axis.
- The default designated-environment list (`prod*`, `*prod-mirror*`, `*customer-data*`, regulatory tags) is the worker's; the maintainer chooses the actual list and the policy version that carries it.
- The `maxBreakGlassWindow` default (4 hours) is the worker's choice; the maintainer chooses it.
- The independence rule (reviewer ≠ author and reviewer ≠ current run-role) is the worker's reading of "independent review" for the cases listed in [5.3](#53-elevated-independent-review-rules); the maintainer's organisation may need a wider rule.
- The hosted workspace's authentication model and the platform that issues the workspace id are not named here; T1 does not depend on the platform choice, but T2 may.
