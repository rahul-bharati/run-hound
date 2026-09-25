# V2 spec (0.4.0 preview): signed-in runs and access checks

The build contract for the first V2 slice, shipped in 0.4.0. It extends [v0-spec.md](v0-spec.md) and
[v1-spec.md](v1-spec.md), which still hold for everything not changed here (safety gate, navigation guard, evidence,
groups, reports, tester-release rules). The acceptance suite enforces all three.

V2 is "single feature end to end" (README roadmap). 0.4.0 ships its foundation and its headline:

- **Test accounts**: two accounts the user owns on their app (A and B), and **signed-in runs**: every existing check
  runs as account A (or B), so pages behind a login can be tested.
- **Access checks** with the two accounts: can account B, or a signed-out visitor, read account A's data?
- **Mass assignment**: does the server accept fields the form never sends, such as `role` or `plan`?
- **Deep links**: do the app's own pages load when opened directly (a reload, a shared link)?

Not in 0.4.0 (planned): multi-page feature runs (a feature named by the user, tested across its pages), write-side
access checks (B changing A's records), rate limits, CSRF, file upload, prompt injection, paywall/success-page trust.

## Test accounts

- Two slots, `a` and `b`. Each has `loginUrl` (the app's sign-in page), `username` (what the sign-in form's
  identifier field takes: usually an email) and `password`, plus an optional `label` (default "Account A" /
  "Account B"). A shared setting `isolated` (default `true`) is the user's statement that **A and B must not see each
  other's data** (different users, not teammates in one workspace); the other-account check is planned only when it
  is true.
- Saved in `<configDir>/accounts.json` (the same folder as `ai.json`: `RUNHOUND_CONFIG_DIR`, else
  `$XDG_CONFIG_HOME/run-hound`, else `~/.config/run-hound`), file mode `0600` in a `0700` folder, written atomically.
  Shape: `{ "version": 1, "isolated": true, "accounts": { "a": { "loginUrl", "username", "password", "label" }, "b":
  {…} } }`.
- Environment variables override the file per field: `RUNHOUND_ACCOUNT_A_LOGIN_URL`, `RUNHOUND_ACCOUNT_A_USERNAME`,
  `RUNHOUND_ACCOUNT_A_PASSWORD`, `RUNHOUND_ACCOUNT_A_LABEL`, the same with `_B_`, and `RUNHOUND_ACCOUNTS_ISOLATED`
  (`true`/`false`). Compose files pass them through (empty by default).
- **A saved password is bound to the origin of its `loginUrl`**: when the login URL's origin changes (in Settings, an
  env var or a flag) the saved password is not sent there; saving a new login origin without a new password removes
  it (same rule as the AI key).
- A login URL must pass the safety gate (localhost, private addresses, `RUNHOUND_ALLOWED_HOSTS`), like any target.
- Passwords are **write-only**: never returned by the API, shown in the UI, written to reports, logs, step labels,
  evidence, specs or AI prompts. The engine registers each configured password (and the session cookie values and
  bearer tokens sign-in produces) as literal secrets, so `redactSecrets` replaces them wherever they appear
  (`[REDACTED:account-secret]`). Usernames appear only in Settings and `accounts status`; reports name accounts by
  label.

### CLI

- `run <url> --as a|b`: sign in as that account before discovery and run every scenario signed in. Without `--as`,
  runs are signed out (as before).
- `run-hound accounts status`: each slot's label, login URL, username, whether a password is saved, where each value
  comes from (file, env, default), and `isolated`.
- `run-hound accounts test [a|b]`: signs in (both when no slot is named) and prints the page it landed on, or the
  plain-language reason it failed. Exit 0 when every tested slot signed in, 2 otherwise.
- `run-hound accounts set a|b --login-url <url> --username <name> [--label <text>] [--password-stdin]`: saves a slot;
  the password is read from stdin (never a flag, so it stays out of shell history). `run-hound accounts clear a|b`.
- The Docker entrypoint accepts `accounts` like `ai`.

### API (all require the `X-Run-Hound` header, like `/api/ai`)

- `GET /api/accounts` → `{ isolated, accounts: { a: { label, loginUrl, username, hasPassword, sources }, b: … } }`
  (`sources` names file/env/default per field; no password field at all).
- `PUT /api/accounts` → patch (`{ isolated?, accounts?: { a?: { loginUrl?, username?, password?, label? } } }`;
  `password: ""` removes it; omitted fields are kept). Validates URLs through the safety gate. Returns the same shape
  as GET.
- `POST /api/accounts/test` `{ id: "a" | "b" }` → `{ ok, landedOn?, message }`.
- `POST /api/plan` takes `signInAs: "a" | "b" | null`. The plan records it (`Plan.account`); a run uses the account
  its plan was discovered with.

### Web UI

- Settings → **Test accounts**: two cards (label, sign-in page URL, username, password with "saved" state and a
  Remove link), the "A and B must not see each other's data" checkbox, **Test sign-in** per card, and a short note on
  what the access checks do and that the accounts must be ones the user owns.
- New Run → **Sign in as**: "Not signed in" (default), "Account A", "Account B" (an unconfigured slot is disabled with
  "Set it up in Settings"). The plan header says "Signed in as Account A". Report and runs list show it too.

## Signing in (`app/src/engine/auth.ts`)

`signIn(browser, account, safety) → { storageState, landedOn }` or throws `SignInError` (plain-language message):

1. A fresh, guarded browser context; open `loginUrl`; wait for load plus up to 5 s of network idle.
2. Discover the page; pick the form with exactly one `type="password"` field (else the first with any). None → "No
   sign-in form (a form with a password field) was found on <loginUrl>."
3. Identifier field: in that form, the field with `autocomplete` `username` or `email`, else `type="email"`, else a
   field whose name, label or placeholder matches e-mail/user/login/account, else the first text-like field before
   the password field.
4. Fill identifier and password; activate the form's submit control (else press Enter in the password field).
5. Wait up to 15 s for the URL to change or the password field to disappear, then up to 5 s of network idle.
6. Success: the password field is gone (detached or hidden). Otherwise fail with the visible `role="alert"`/error text
   near the form (redacted), or "The sign-in form was still shown after submitting." Multi-factor codes, captchas and
   third-party (OAuth) sign-in are not supported; the message says so when the page shows a code or captcha field.
7. `storageState` = the context's cookies and localStorage (Playwright `storageState()`), kept in memory only, never
   written to disk. No evidence is captured during sign-in.

`discoverAndPlan` signs in first when `RunOptions.signInAs` is set, so discovery sees the signed-in page. `runPlan`
signs in again at the start of the run (a fresh session per run) as the plan's account, and also as the other account
when a scenario needs it (below). A failed sign-in fails the plan or run with the `SignInError` message (CLI exit 2,
API 400), before any scenario runs.

## Signed-in runs

- `CheckContext.openPage()` opens its context with the run account's `storageState`, so **every existing check runs
  signed in** without changes. Scenarios still get a fresh context each.
- Session-ending controls ("Log out", "Sign out", …) are destructive already (v1-spec) and stay unclicked without
  `--allow-destructive`; because a server-side sign-out would end the run's session, a signed-in run keeps skipping
  them even with `--allow-destructive`, with the reason.
- `planWarnings`: a target that redirects to a sign-in page while signed out suggests "Sign in as a test account
  (Settings → Test accounts, or `--as a`)" instead of "pages behind a login aren't supported yet". When signed in and
  the page still lands on the sign-in form, the plan fails with "Signed in as Account A, but <target> still shows the
  sign-in page. Check the account in Settings → Test accounts."
- Test records created while signed in belong to account A; the report's test-record note says which account.

## Types (additions to `app/src/core/types.ts`)

```ts
type AccountId = "a" | "b";
interface AccountRef { id: AccountId; label: string }          // never a username or password
Plan.account?: AccountRef                                       // who discovered the page
Report.accounts?: { signedInAs: AccountRef | null; other: AccountRef | null } // who ran, and B when used
interface PlanEnv { signedIn: boolean; otherAccount: boolean }  // what the run can do
Check.plan(form, page?, env?: PlanEnv): Scenario[]              // env absent = signed out, no other account
CheckContext.accounts?: { self: AccountRef | null; other: AccountRef | null }
CheckContext.openPage(options?: { viewport?; as?: "self" | "other" | "signed-out" })  // default "self"
CheckContext.request(as: "self" | "other" | "signed-out", req: { method; url; headers?; body? })
  → Promise<{ status: number; headers: Record<string, string>; body: string }>
CheckContext.accountMarkers(): string[]  // strings that identify the run account's data (its username); match only, never print
```

`CheckContext.request` sends one HTTP request with that identity's cookies (Playwright's request context for the
identity's storage state) plus, for `self`/`other`, the credential headers the app itself sent from that identity
(`authorization`, `apikey`, `x-*-token`, `x-api-key` observed on requests to the same origin; never guessed). It checks
the URL against the safety gate first (refuses anything else), follows no redirects, times out after 10 s, and caps
the body at 1 MB. `signed-out` sends no cookies and no credential headers.

New check ids join `CHECK_IDS` after `ai-flow`: `access-control`, `mass-assignment`, `deep-links` (`V2_CHECK_IDS`).
Plans and reports written by 0.3.0 have no `account`/`accounts` and read as signed out.

## Checks

| Check id | Group | Scope | Planned when | Default |
|---|---|---|---|---|
| `access-control` | Security | page | signed in (scenario `signed-out`); signed in, account B configured and `isolated` (scenario `other-account`) | ticked |
| `mass-assignment` | Security | form | signed in, a form that saves (not a search form) | **unticked** (it changes account A and restores it) |
| `deep-links` | Features | page | the page has same-origin links to other pages | ticked |

When not signed in, the plan shows one hint instead of the access scenarios: "Sign in as a test account to run the
access checks (another account or a signed-out visitor reading your data)."

### `access-control`

Both scenarios first establish **account A's data** on this page:

1. As A (the run account), open the page. If the page has a form that saves (the main non-search form), fill it with
   valid test values carrying the run token and submit (the usual test record, counted in `testRecordsCreated`); then
   reload.
2. A's data requests: the GETs the page made (same origin or the app's API on another local origin; not third
   parties) that answered 2xx with a JSON or text body containing a **marker**: the run token's test value, else A's
   username (`accountMarkers()`). At most 10, de-duplicated by URL.
3. None → skipped: "Account A has no data on this page that Run Hound can recognise (no form saved a record, and no
   response names Account A)."

**`access-control:other-account`** ("Another account can't read Account A's data"):

- B opens the same page normally. Any 2xx response to B containing an A marker → finding.
- For each of A's data requests, `request("other", …)` replays it (same URL and method). A 2xx containing an A marker
  → finding.
- One finding for all of it, **critical**, confirmed: "Account B can read Account A's data (<n> endpoints)", locations =
  the endpoints (method + path). Evidence: a card per endpoint (the request as B, status, the body excerpt with the
  marker marked; values redacted, the marker shown only as "Account A's test record" / "Account A's email"), and a
  frame of B's page with the marker highlighted when it is visible. Spec: two `request.newContext` identities
  (credentials from environment variables, never inlined), the replay and the assertion.
- Pass notes: "Checked <n> of Account A's requests as Account B; none returned Account A's data."

**`access-control:signed-out`** ("Signed-out visitors can't read Account A's data"):

- For each of A's data requests, `request("signed-out", …)`. A 2xx containing an A marker → finding, **critical**:
  "Account A's data is readable without signing in (<n> endpoints)", same evidence shape. A `401`/`403`/`404` or a
  redirect is a pass.

Both are read-only (GET replays only; never a path that acts, such as `/logout` or `/unsubscribe`).

### `mass-assignment`

1. As A, fill the form with valid test values and submit; capture its save request (non-GET, JSON object body, same
   origin or the app's API). Not JSON → skipped ("This form doesn't send JSON, so extra fields can't be added").
2. Find the record: a GET after reload whose JSON contains the test value (the "record endpoint"); note the current
   values of the privilege fields in it.
3. Replay the save request as A with the same method, URL and body plus the privilege fields the form didn't send:
   `role: "admin"`, `isAdmin: true`, `is_admin: true`, `admin: true`, `plan: "pro"`, `tier: "pro"`, `credits: 999999`,
   `verified: true`, `emailVerified: true`.
4. Read the record endpoint again. An injected field now holding the injected value → finding, confirmed: **critical**
   for `role`/`admin` fields, **high** for plan/tier/credits/verified: "The server accepted `role: admin` from the
   browser (mass assignment)". Without a record endpoint, an echo of the injected value in the replay's response is an
   **advisory** finding.
5. Restore: replay once more with the fields' original values (when they were present) and say in the notes what
   could not be restored ("`isAdmin` was not there before; Run Hound can't remove it: check Account A").

### `deep-links`

- Links: `a[href]` on the page to the same origin, other paths than the page's own, not hash-only, not downloads,
  names and paths not matching the destructive words (log out, delete, unsubscribe, …); at most 10, by path.
- Each is opened **directly** in a fresh context (signed in as the run account when there is one): the document answer
  must be < 400, and the page must not render a not-found view (an `<h1>` or title saying "404"/"not found"/"page
  doesn't exist") when following the same link from the page does not.
- Finding (**high**, confirmed): "<n> pages show an error when opened directly (a reload or a shared link breaks)",
  locations = the paths with their status; evidence: a frame of the error page and a card of the document response.
  Typical cause named in `fix`: a single-page app hosted without a fallback to `index.html`.

## Fernway V2 (fixtures/fernway)

Fernway gains real accounts and the V2 planted bugs. It supersedes the Supabase-backed Kennel V2 described in
[fixtures.md](fixtures.md), which stays planned for later.

- Accounts: `alex@fernway.test` / `correct-horse-battery` (Alex Rivera, workspace "Rivera Studio", role `member`, plan
  `free`) and `sam@fernway.test` / `staple-lemon-orbit` (Sam Okafor, "Okafor & Co"). Each has its own seeded projects,
  tasks and profile. `GET /api/me` → `200 { id, name, email }` or `401`.
- `/app` and `/app/settings` need a session: signed out, the SPA redirects to `/login?next=<path>`. Every workspace API
  (`/api/projects`, `/api/tasks`, `/api/members`, `/api/users/:id/profile`, `/api/notifications`) answers `401`
  without a session and only ever returns or changes the session user's data (`404` for another user's ids).
- The Settings profile is loaded and saved by user id: `GET`/`PUT /api/users/:id/profile` (fields `displayName`,
  `email`, `bio`, `timeZone`; the stored record also has `role` and `plan`, which the API returns but never accepts
  from the client).

| Id | Bug | Caught by (page) |
|---|---|---|
| V01 | `GET /api/users/:id/profile` returns any user's profile to any signed-in user (no ownership check) | `access-control:other-account` (`/app/settings`) |
| V02 | `GET /api/tasks` returns every user's tasks | `access-control:other-account` (`/app`) |
| V03 | The workspace APIs answer without a session (only the SPA redirects) | `access-control:signed-out` (`/app`, `/app/settings`) |
| V04 | `PUT /api/users/:id/profile` stores any key it is sent, including `role` and `plan` | `mass-assignment` (`/app/settings`) |
| V05 | Opening `/app/settings` or `/onboarding` directly answers `404` (no SPA fallback for those paths) | `deep-links` (`/app`) |

Clean mode fixes each properly (ownership checks, session checks, a field allowlist, the SPA fallback), so the clean
runs exercise the same flows. `FERNWAY_BUGS=all` includes V01–V05.

## Acceptance (tests/acceptance)

- `fernway.acceptance.test.ts`, signed in as Alex (A) with Sam as B, clean mode: `/app` and `/app/settings` have zero
  confirmed findings with every scenario approved (including `mass-assignment`), and `access-control` passes both
  scenarios; signed out, `/` `/signup` `/login` `/onboarding` stay clean.
- Each of V01–V05 alone: the named check reports a confirmed finding on the named page, and nothing else changes.
- Every existing suite (Kennel, goldens, samples) is unchanged: signed-out runs behave exactly as in 0.3.0.
- No report, log line, evidence file or spec from any of these runs contains either password (a test greps the run
  folders).
