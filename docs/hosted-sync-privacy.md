# Hosted sync, privacy and conflict-resolution contract (T2)

The build contract for Run Hound's hosted workspace sync layer. This is a specification only; no runtime changes. It defines exactly what syncs from a local Run Hound instance to a hosted workspace, under which consent, who can see what, how approvals and versions are handled under concurrency, evidence defaults and lifecycle, and the explicit limits of any hosted service.

Current behavior (through 0.6.x): no hosted workspace, no sync, nothing leaves the local machine except optional AI egress under the rules in [ai-spec.md](ai-spec.md). All citations to `app/src/...` below describe the local-only implementation. Hosted claims are the proposed contract and are marked [UNVERIFIED] where no code yet exists to verify against.

This extends the local contracts ([launch-spec.md](launch-spec.md), [v2-spec.md](v2-spec.md), [ai-spec.md](ai-spec.md)) and records the decisions needed before T3/T4 implementation.

## Data classification

Every category of data is classified by its default upload policy to a hosted workspace, who (if anyone) on the hosted side can see it once uploaded, and the reason. "Default" means the policy in the absence of an explicit per-workspace or per-run override. Credentials, sessions and model keys are kept local by contract.

| Category              | Default upload policy                          | Who can see it (when present in workspace) | Reason |
|-----------------------|------------------------------------------------|--------------------------------------------|--------|
| goals                 | never (workspace metadata only; no automatic upload of local goals) | workspace owner and explicitly invited collaborators with read access | Goals describe the user's test intent for a target. They may contain private target details. No code path currently sends goals anywhere; local storage only ([UNVERIFIED] for hosted; see current local plan storage in engine/runner). |
| maps and URLs         | with explicit workspace sync consent (per workspace; never by default) | workspace owner + read collaborators | Maps/URLs are required to identify the tested target in the hosted view. URLs may be sensitive (internal paths, staging tokens in query). Current code keeps all addresses local; redaction applies only for AI ([app/src/engine/redact.ts:212](app/src/engine/redact.ts) `redactAccountSecrets` for plans; full URLs stay in local reports). |
| scenario versions     | with explicit workspace sync consent          | workspace owner + read collaborators | Versions capture the exact approved plan at a point in time. Needed for history and reproducibility in workspace. Current local versions are immutable once approved in the run record (see below for concurrency contract). |
| approvals             | with explicit workspace sync consent; only the act of approving a specific immutable version | workspace owner + read collaborators (the approver identity is recorded) | Approvals are deliberate user actions selecting what will run. They are not free-form edits. See immutable versions and optimistic concurrency below. No current hosted approval flow exists. |
| comments              | with explicit workspace sync consent          | workspace owner + read collaborators | User-added notes on scenarios, runs or findings for team context. May contain private observations. Local-only today. |
| run summaries         | with explicit workspace sync consent          | workspace owner + read collaborators | High-level metadata (start/end, scenario counts, high-level outcome, target, duration). Used for dashboard/history. Full details stay in evidence (below). Current run records are written only to local `runs/<id>/report.json`. |
| evidence artifacts    | never by default (opt-in per workspace or per-run via "upload evidence" consent) | workspace owner + read collaborators (if opted in) | Screenshots, GIFs, full request/response bodies, console logs and Playwright specs. These are the largest and most sensitive artifacts. See evidence section below. Current evidence never leaves the local runs mount ([UNVERIFIED] for upload path). |
| credentials/sessions  | never                                          | no one (never leaves local machine) | Target credentials and produced session values are secrets for the app under test. They must never be sent to any hosted service. See [ai-spec.md](ai-spec.md) rule 4 for signed-in runs. Real code: `registerSecretLiterals` and `redactSecrets` treat them as account-secret and replace on any export or log ([app/src/engine/redact.ts:283](app/src/engine/redact.ts) "Registers literal secrets (0.4.0: test-account passwords and the session values sign-in produced)"; `redactAccountSecrets` for addresses). Local accounts storage only. |
| model keys            | never                                          | no one (never leaves local machine) | API keys, AWS access keys, Bedrock credentials and profiles for AI providers. See separation section below. Real code keeps them encrypted in `secrets.json` ([app/src/operations/secret-store.ts](app/src/operations/secret-store.ts); non-secret settings like `apiKeyOrigin` and `awsProfile` in [app/src/config/ai.ts](app/src/config/ai.ts)). `isRemote` and `allowRemote` govern only egress, not workspace. |

Unverified claim: the exact names "goals", "maps" and the workspace membership model are taken from the ticket acceptance criteria; no production code for hosted workspace membership or "goals" object yet exists.

## Separation of model egress consent from workspace uploads

Model (AI) egress consent is completely independent of any workspace upload consent.

- `allowRemote` / `RUNHOUND_AI_ALLOW_REMOTE` / the Settings consent box names the AI endpoint host only. It permits sending redacted structure to a remote model (Bedrock always counts as remote). See [ai-spec.md](ai-spec.md) rule 3: "Local needs no consent; remote does."
- Workspace sync consent (a separate flag, saved per workspace or global "allow hosted sync") controls upload of the categories above to a Run Hound hosted workspace endpoint. It does not imply or inherit any AI remote consent.
- A user may:
  - Use a remote AI model (with its consent) while never uploading anything to a workspace.
  - Use a local-only AI model (or AI off) and still consent to workspace sync for run history/collaboration.
  - Have both, or neither.
- The two consents are stored and evaluated separately. Changing an AI endpoint does not affect workspace consent, and vice versa.
- Model keys never travel with a workspace upload (even when AI is used during a synced run); the hosted workspace never receives them and never performs inference itself unless the user later uses hosted inference (a distinct paid feature).

Real code (local only):
- `isRemote` decides per-endpoint ([app/src/config/ai.ts:76](app/src/config/ai.ts)): `if (config.provider === "bedrock") return true;` else hostname checks against localhost/private.
- `fromFile` and `fromEnv` load `allowRemote` and `allowRemoteHost` as a separate field ([app/src/operations/ai-storage.ts:59](app/src/operations/ai-storage.ts)).
- No workspace upload code path exists today that would carry AI config ([UNVERIFIED]).

Unresolved (flagged for T3): exact UI surface for the workspace consent (separate Settings card? per-workspace toggle on first sync?), and whether a global `RUNHOUND_WORKSPACE_ALLOW` env/flag will exist analogous to AI flags.

## Immutable approved versions and optimistic concurrency

Approved scenario sets are recorded as immutable versions.

- When a plan is approved for a run (or for a workspace target), the exact set of selected scenarios, their parameters and the plan content at approval time is snapshotted under a version identifier (e.g. content hash or monotonic version + approver + timestamp).
- The version is immutable: subsequent edits to the plan produce a new version. Approvals always name a specific version.
- Updates to the approval state (approve a version, un-approve, change selected scenarios for future runs) use optimistic concurrency.
  - The client sends the version/ETag it last observed.
  - The server accepts only if the current server version matches the client's "if-match".
  - On mismatch (another client or device approved something in between), the update is rejected with conflict (409 or equivalent). The client must re-fetch the current approved version and let the user re-approve.
- Conflicting approval updates are **rejected rather than merged** or last-writer-wins.

Why reject rather than merge:
- An approval is a deliberate human decision about *which exact scenarios* will execute on the next run. It is not a commutative data edit (e.g. a comment or a tag).
- Automatic merge could silently add scenarios the first approver had deliberately left out, or drop ones they had selected, producing a run that neither party intended.
- Last-writer-wins would lose the first user's explicit choice without notification.
- Rejection forces a conscious re-review, which is the safe default for a safety-sensitive tool. (Analogous to how current write-side checks refuse stale versions rather than force-merge; see decisions on write-access holds.)
- This matches the "optimistic concurrency" requirement in the ticket.

Current related local behavior (no hosted approval yet):
- Write-access and record holds already detect stale versions and refuse or hold ([app/src/server/models/host-state.ts](app/src/server/models/host-state.ts) only contains per-instance host allow-list today; the hold logic lives in checks but the pattern of "re-read and decide from current" is established).
- No approval-versioning code for hosted workspaces exists ([UNVERIFIED]).

Unresolved (flagged): exact wire format of the version token (hash of the scenario list? server-assigned sequence?), whether approvals can be "soft" (tentative) vs hard, and conflict resolution UX (does the client show a diff of the two approved sets?).

## Evidence upload defaults, retention and deletion, disconnected-run behavior, schema compatibility and migration

### Defaults
- Evidence artifacts (screenshots, GIFs, network bodies, specs) are **not uploaded by default**.
- A workspace may have an "upload evidence" setting (off by default). When off, only run summaries and approved scenario metadata travel.
- Per-run override is possible at approval time ("attach full evidence for this run only").
- Reason: evidence can contain PII from the target app, large binary data, and is the most privacy-sensitive payload. Users must make an active choice.

### Retention and deletion
- Default retention: 90 days from upload date for evidence artifacts; run summaries and metadata retained for the lifetime of the workspace or until explicit delete (user configurable per workspace).
- Deletion: explicit delete of a run in the workspace UI or API removes the hosted copy (and cascades to evidence if present). Local copies are unaffected. A "purge evidence" action can remove only artifacts while keeping the summary.
- No automatic server-side redaction on upload; redaction already happened locally before any potential upload.
- Hosted never requests re-upload of deleted items.

### Disconnected-run behavior
- A local instance may run while the workspace is unreachable (network loss, airplane mode, etc.).
- Completed runs are queued locally with their full evidence (subject to local disk).
- On reconnect, the client offers a "sync pending runs" action. Sync is not automatic (user must confirm, to avoid surprise uploads).
- If an approval was made locally against a now-stale hosted version, the sync presents the conflict using the same optimistic rules (rejection of the local approval unless user re-resolves).
- A run that was started from a hosted-approved plan but executed locally while disconnected carries the approved version id; on sync the hosted side can verify the version still matches or flag it.

### Schema compatibility and migration
- Every run record and evidence envelope carries a schema version (e.g. `reportSchema: "2.1"`).
- Hosted accepts uploads from older schema versions it understands (stores as-is or with a compatibility wrapper). It rejects uploads with a future schema version the hosted code does not yet understand (client must be upgraded first).
- Migration: the local client, before upload, may rewrite an old local record into the current schema if the hosted side has announced support for it. No in-place mutation of historical local records.
- Evidence file formats (PNG, GIF, JSON) are stable; new evidence kinds carry a type tag.
- Breaking changes to the hosted storage schema require a new decision entry and a migration plan (never silent).

Current local evidence and report behavior:
- `report.json` and evidence files are written only locally; redact is applied on any text export ([app/src/engine/redact.ts:206](app/src/engine/redact.ts) `redactSecrets`, `redactDeep`).
- No upload or schema negotiation code for workspaces exists today ([UNVERIFIED]).

Unresolved (flagged): concrete retention numbers (is 90 days right? user-configurable in days?), queue storage limits for disconnected runs, whether "schema version" is the same as the top-level report version, and the exact error surface for a schema-too-new rejection.

## Which existing public statements need updating

The following public statements (in committed docs and README) describe a purely local, "no hosted" world. They must be updated (via later PRs against the maintained brief) to acknowledge the existence of consented hosted workspace sync while preserving the "local by default, secrets never leave, checks never paywalled" guarantees. Quotes are verbatim; line numbers from the current tree.

**docs/business-model.md**
- Line 10: `4. **Local stays private.** No part of licensing or billing sends anything about the app being tested.`
  (Will need a follow-on sentence: "Consented workspace sync for history and collaboration is an explicit exception, governed by the contract in hosted-sync-privacy.md; target credentials, sessions and model keys are never sent.")
- Lines 16-21 (table rows for Paid column): `**Hosted inference:** runs without a GPU... **Hosted runner:** test a deployed app... **Team dashboard:**...`
  (The table will need a note that workspace sync / history is the on-ramp for the paid hosted features.)
- Line 23: `The paid column is mostly **server-side**: it runs on our infrastructure, so it has value that can't be patched out of an open-source image.`
  (Add: "Workspace sync is one such server-side service; the decision of what to sync is made locally under the privacy contract.")

**docs/security.md**
- Line 7 (Safety paragraph): `The target must be `localhost`, a private address, or listed in `RUNHOUND_ALLOWED_HOSTS` ... The UI and API answer only to loopback names...`
  (Stays true for the local executor and local UI; add: "When a run or its evidence is uploaded to a hosted workspace under consent, the hosted service stores only what was sent; it does not expand the local safety gate.")
- Line 33: `Reports redact any secrets they find; keys are never used or tested. Test-account passwords, session values and usernames are kept out of everything Run Hound writes.`
  (Extend to: "... and are never uploaded to any hosted workspace.")

**docs/overview.md**
- Line 66: `- **Delivery**
  - Docker-based; no hosted platform for now.
  - Users pull the Docker image (or install from source) and run it locally. AI features are optional and off by default: bring your own model, local or cloud (see [AI (optional)](ai.md)).`
  (Update the "no hosted platform for now" to "The core runs locally; optional consented sync to hosted workspaces for history and teams is available under the privacy contract (see hosted-sync-privacy.md).")
- Line 67 (in context): the sentence above.

**README.md**
- Lines 66-67 (in the documentation table and Delivery section): similar "Docker-based; no hosted platform for now." phrasing appears via the linked docs; the table entry for business-model will need the carve-out.
- Line 115: `- A possible paid tier (later, only after demand is validated) would cover things that run on our servers: hosted inference, a hosted runner, team dashboards, CI integration and compliance exports. It would be unlocked with an API key passed to the Docker container; without a key, the core runs fully.`
  (Add: "Consented workspace sync for run history is part of the paid offering and follows the data classification and consent rules in hosted-sync-privacy.md; the core itself never phones home without explicit user consent for a workspace.")

No other files were required by the ticket; these four are the ones named for citation. Updates must be made against the site brief (docs/site/) and must not weaken the "checks never paywalled" or "secrets never leave without consent" rules.

## Explicit limits

A hosted workspace **cannot verify what a local executor did**.

- The workspace receives only a self-reported bundle: the approved version id, run summary, and (if opted) the evidence artifacts the local client chose to include.
- There is no remote attestation, no signed execution proof, no trusted execution environment requirement on the client, and no ability for the hosted side to re-execute the exact same browser session.
- Therefore:
  - A malicious or compromised local client can upload fabricated screenshots, altered network logs, or a run summary that does not match the evidence.
  - The hosted workspace can only store, index and display what was uploaded. It can enforce schema and version rules, but it cannot attest "this evidence was produced by running the approved scenarios against the claimed target on an untampered Run Hound instance."
  - Users and teams must treat workspace history as "what the submitting machine claimed happened," not as independently verified truth. This is an explicit, documented limit.
- Local-only runs (the default) have the same trust boundary as today: the user trusts their own machine.
- This limit is why workspace sync is an *addition* for convenience/collaboration, not a replacement for local execution when strong guarantees are required.

Current code has no remote verification path at all (the server models only host allow-listing for the local UI/API):
- [app/src/server/models/host-state.ts:20](app/src/server/models/host-state.ts) `class HostState` only manages `runsDir`, `aiPlanBudgetMs`, `extraHosts` and `hostAllowed` for the local instance.
- Redaction and secret registration are client-side only ([app/src/engine/redact.ts](app/src/engine/redact.ts), [app/src/operations/ai-storage.ts](app/src/operations/ai-storage.ts)).
- No code exists that would let a hosted service challenge or re-verify a submitted run ([UNVERIFIED — none exists]).

Unresolved (flagged): whether future "hosted runner" (paid) will have different attestation properties, and whether any lightweight client-side signing of the run record (detached signature over the approved version + summary) will be added for basic tamper evidence. Those would be separate decisions.

## Sources and related decisions

- Ticket: #23 (T2)
- Related: [ai-spec.md](ai-spec.md) (consent and redaction rules), [business-model.md](business-model.md), [security.md](security.md), [overview.md](overview.md)
- Code examined for current local behavior: the four files listed in the ticket.
- Decision entry: see 10-2026.md (appended below the refactor entries).

This contract is append-only in spirit for its decisions; later changes supersede via new entries in the decision log.
