# V2 spec (0.4.0 preview, 0.5.0): signed-in runs, access checks and write-side checks

Status: the first V2 slice, shipped in 0.4.0 as a preview (the web UI and the HTML report say "V2 preview"). This
is its build contract. It extends [v0-spec.md](v0-spec.md) and [v1-spec.md](v1-spec.md), which still hold for
everything not changed here (safety gate, navigation guard, evidence, groups, reports, tester-release rules), and
[ai-spec.md](ai-spec.md) for the optional AI layer. The acceptance suite enforces all of them.

V2 is "single feature end to end" (README roadmap). 0.4.0 ships its foundation and its headline:

- **Test accounts**: two accounts the user owns on their app (A and B), and **signed-in runs**: every existing check
  runs as account A (or B), so pages behind a login can be tested.
- **Access checks** with the two accounts: can account B, or a signed-out visitor, read account A's data?
- **Mass assignment**: does the server accept fields the form never sends, such as `role` or `plan`?
- **Deep links**: do the app's own pages load when opened directly (a reload, a shared link)?

Not in 0.4.0: write-side access checks, CSRF and paywall/success-page trust (all three are in 0.5.0, see
[0.5.0: write-side checks](#050-write-side-checks)). Still planned: multi-page feature runs (a feature named by the
user, tested across its pages), rate limits, file upload, prompt injection.

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
  bearer tokens sign-in produces, IndexedDB included) as literal secrets, so `redactSecrets` replaces them wherever
  they appear (`[REDACTED:account-secret]`): as typed, URL-encoded, form-encoded (`!'()~` as `%21 %27 %28 %29 %7E`,
  either hex case), JSON-escaped or HTML-escaped. Usernames appear only in Settings and `accounts status`; reports name
  accounts by label. While a signed-in plan or run is going, every configured username of 3 characters or more is
  registered too (`registerAccountUsernames`) and hidden in any letter case (`[REDACTED:account-username]`, the same
  rule as the server's last layer). A plan's address fields (selectors, URLs, link targets) lose only the passwords
  and session values (`redactAccountSecrets`), so the plan still runs.
- Evidence images: while a frame, a screenshot or a recording step is taken, page text, field values and placeholders
  that hold a registered username or secret are replaced with dots of the same length and put back right after. The
  live view's screencast frames are not masked (pixels can't be redacted afterwards; the live view is local).
- A password that is a very common word or a plain number ("password", "admin123", "123456") gets a warning in the
  slot's status (Settings, `accounts status`): hiding it everywhere would give it away.

### CLI

- `run <url> --as a|b`: sign in as that account before discovery and run every scenario signed in. Without `--as`,
  runs are signed out (as before).
- `run-hound accounts status`: each slot's label, login URL, username, whether a password is saved, where each value
  comes from (file, env, default), and `isolated`.
- `run-hound accounts test [a|b]`: signs in (both when no slot is named) and prints the page it landed on, or the
  plain-language reason it failed. Exit 0 when every tested slot signed in, 2 otherwise.
- `run-hound accounts set a|b [--login-url <url>] [--username <name>] [--label <text>] [--password-stdin]`: saves the
  given fields of a slot (at least one; the others are kept). The login URL is checked against the safety gate before
  the password is asked for; the password is read from stdin (never a flag, so it stays out of shell history).
  `run-hound accounts clear a|b` removes a slot from `accounts.json`.
- The Docker entrypoint accepts `accounts` like `ai`.

### API (all require the `X-Run-Hound` header, like `/api/ai`)

- `GET /api/accounts` → `{ isolated, isolatedSource, file, accounts: { a: { id, label, loginUrl, username, hasPassword,
  ready, sources, problem }, b: … } }` (`sources` names file/env/default per field; `ready` is true when the sign-in
  page, username and password are all set; `problem` is a plain-language note or null; no password field at all).
- `PUT /api/accounts` → patch (`{ isolated?, accounts?: { a?: { loginUrl?, username?, password?, label? } } }`;
  `password: ""` removes it; omitted fields are kept). Validates URLs through the safety gate. Returns the same shape
  as GET.
- `POST /api/accounts/test` `{ id: "a" | "b" }` → `{ id, ok, landedOn?, message }`, signing in with a fresh browser (a
  slot that isn't set up answers `ok: false` without contacting the app); `409` when two sign-in tests are already
  running.
- `POST /api/plan` takes `signInAs: "a" | "b" | null`. The plan records it (`Plan.account`); a run uses the account
  its plan was discovered with.

### Web UI

- Settings → **Test accounts**: two cards (label, sign-in page URL, username, password with "saved" state and a
  Remove link), the "A and B must not see each other's data" checkbox, **Test sign-in** per card, and a short note on
  what the access checks do and that the accounts must be ones the user owns.
- New Run → **Sign in as**: "Not signed in" (default), "Account A", "Account B" (an unconfigured slot is disabled with
  "Set it up in Settings"). The plan header says "Signed in as Account A". The running view, the report and the runs
  list show it too. A signed-out plan's "Sign in as a test account…" hint carries a button that plans the page again
  signed in (or a link to Settings when no account is set up).
- The sidebar footer and the HTML report's footer say "V2 preview".

## Signing in (`app/src/engine/auth.ts`)

`signIn(browser, account, safety) → { storageState, landedOn }` or throws `SignInError` (plain-language message):

1. A fresh, guarded browser context; open `loginUrl`; wait for load plus up to 5 s of network idle.
2. Discover the page; pick the sign-in form among the forms with a `type="password"` field: never one that creates an
   account (its name or submit control says sign up / create account / register, or every password field is a
   `new-password`); then the best by a password with `autocomplete=current-password`, sign-in words, exactly one
   password field; the first wins a tie. None → "No sign-in form (a form with a password field) was found on
   <loginUrl>."
3. Identifier field: in that form, the field with `autocomplete` `username` or `email`, else `type="email"`, else a
   field whose name, label or placeholder matches e-mail/user/login/account, else the first text-like field before
   the password field.
4. Fill identifier and password; activate the form's submit control (else press Enter in the password field). A
   request whose query carries the password (a GET form) is stopped before it leaves the browser and sign-in fails:
   "…sends the password in the page address (a GET form)…".
5. Wait up to 15 s for the URL to change or the password field to disappear, then up to 5 s of network idle.
6. Success: the password field is gone (detached or hidden). Otherwise fail with the visible `role="alert"`/error text
   near the form (redacted), or "The sign-in form was still shown after submitting." Multi-factor codes, captchas and
   third-party (OAuth) sign-in are not supported; the message says so when the page shows a code or captcha field.
7. `storageState` = the context's cookies, localStorage and IndexedDB (Playwright `storageState({ indexedDB: true })`;
   Firebase Auth keeps its session there), kept in memory only, never written to disk. No evidence is captured during
   sign-in.

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
  sign-in page. Check the account in Settings → Test accounts." That includes an app that renders its sign-in form in
  place at the target's own address (a visible form with one password field that isn't a new password, one or two
  username fields and sign-in words). When the sign-in page is on another host name than the target (localhost vs
  127.0.0.1), the message says the browser keeps their cookies apart.
- A form that sets a password (a password field, and not a sign-in form: change password, sign up) would change the
  test account's password: signed in, its form scenarios are destructive in the plan (credential-fields, which never
  submits, excepted) and are skipped at run time even with `--allow-destructive`, with the reason.
- Test records created while signed in belong to account A; the report's test-record note says which account.

## Types (additions to `app/src/core/types.ts`)

```ts
type AccountId = "a" | "b";
interface AccountRef { id: AccountId; label: string }          // never a username or password
Plan.account?: AccountRef                                       // who discovered the page
Plan.signInHint?: boolean                                       // signed out, and the access checks would apply
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

1. As A (the run account), open the page. If the page has a form that saves a record (the scenario's form, else the
   page's first that does: fields and a submit control, not a search, no password or email field, a submit control
   that isn't destructive, a name that doesn't say it changes the account), fill it with valid test values carrying the
   run token and submit (the usual test record, counted in `testRecordsCreated`); then reload. When the page shows the
   sign-in form instead, the scenario ends "error" saying Account A's session has ended.
2. A's data requests: the GETs the page made (same origin or the app's API on another local origin, whose reads are
   read again as A since the capture keeps no body for them; not third parties; API reads and the page's HTML, never
   scripts or styles; never a path that acts) that answered 2xx with a body containing a **marker**: a test-record
   value (anywhere, any case), else A's username (`accountMarkers()`), which counts only in a JSON answer as a whole
   value, or a whole address inside one for an email (never inside another name, never in HTML or script text). At
   most 10, de-duplicated by endpoint.
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
- Pass notes: "Checked <n> of Account A's requests as Account B; none returned Account A's data." (one request: "Checked
  Account A's only data request as Account B; it didn't return Account A's data.")

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
4. Read the record endpoint again. An injected field that the record (the object holding the test values, and its
   parents; never a list of other records) did not hold with the injected value before and holds now → finding
   (a field it already held is named in the notes: the replay can't tell), confirmed: **critical**
   for `role`/`admin` fields, **high** for plan/tier/credits/verified: "The server accepted `role: admin` from the
   browser (mass assignment)". Without a record endpoint, an echo of the injected value in the replay's response is an
   **advisory** finding.
5. Restore: replay once more with the fields' original values (when they were present), re-read, and say in the notes
   what is back, what the server kept, and what could not be restored ("`isAdmin` was not there before; Run Hound
   can't remove it: check Account A"). A save that creates a record (the replay made a new one) is not replayed again:
   the injected fields are on that test record.

### `deep-links`

- Links: `a[href]` on the page to the same origin, other paths than the page's own, not hash-only, not downloads, and
  never a link that acts when loaded: its name, path or query words on the lists of controls Run Hound never clicks
  (log out / log off, disconnect, delete, unsubscribe, …), a path segment or query value that acts on its own
  (`/invites/7/accept`, `?action=delete`), or words that end a session (the same rule leaves them out of
  `DiscoveredPage.linkTargets`); at most 10, by path.
- Each is opened **directly** in a fresh context (signed in as the run account when there is one): the document answer
  must be < 400, and the page must not render a not-found view (an `<h1>` or title saying "404"/"not found"/"page
  doesn't exist") when following the same link from the page does not.
- Finding (**high**, confirmed): "<n> pages show an error when opened directly (a reload or a shared link breaks)",
  locations = the paths with their status; evidence: a frame of the error page and a card of the document response.
  Typical cause named in `fix`: a single-page app hosted without a fallback to `index.html`.

## Fernway V2 (fixtures/fernway)

Fernway gains real accounts and the V2 planted bugs. It supersedes the Supabase-backed Kennel V2 described in
[fixtures.md](fixtures.md#planned-kennel-on-supabase-v2), which stays planned for later (as a Supabase variant).

- Accounts: `alex@fernway.test` / `correct-horse-battery` (Alex Rivera, workspace "Rivera Studio", role `member`, plan
  `free`) and `sam@fernway.test` / `staple-lemon-orbit` (Sam Okafor, "Okafor & Co"). Each has its own seeded projects,
  tasks and profile. `GET /api/me` → `200 { id, name, email }` or `401`.
- `/app`, `/app/settings` and `/app/help` need a session: signed out, the SPA redirects to `/login?next=<path>`. Every
  workspace API (`/api/projects`, `/api/tasks`, `/api/members`, `/api/users/:id/profile`, `/api/notifications`)
  answers `401` without a session and only ever returns or changes the session user's data (`404` for another user's
  ids). `/app/help` (keyboard shortcuts, a FAQ, how to contact support; no form) is linked from the sidebar.
- The Settings profile is loaded and saved by user id: `GET`/`PUT /api/users/:id/profile` (fields `displayName`,
  `email`, `bio`, `timeZone`; the stored record also has `role` and `plan`, which the API returns but never accepts
  from the client).

| Id | Bug | Caught by (page) |
|---|---|---|
| V01 | `GET /api/users/:id/profile` returns any user's profile to any signed-in user (no ownership check) | `access-control:other-account` (`/app/settings`) |
| V02 | `GET /api/tasks` returns every user's tasks | `access-control:other-account` (`/app`) |
| V03 | The workspace APIs answer without a session (only the SPA redirects) | `access-control:signed-out` (`/app`, `/app/settings`) |
| V04 | `PUT /api/users/:id/profile` stores any key it is sent, including `role` and `plan` | `mass-assignment` (`/app/settings`) |
| V05 | Opening `/app/help` directly answers `404` (no SPA fallback for that path; the sidebar links to it) | `deep-links` (`/app`) |

Clean mode fixes each properly (ownership checks, session checks, a field allowlist, the SPA fallback), so the clean
runs exercise the same flows. `FERNWAY_BUGS=all` includes V01–V05; V05 breaks only `/app/help` (a page with no form),
so every page that carries another bug still loads directly and can be planned with every bug on.

## Acceptance (tests/acceptance)

- `fernway.acceptance.test.ts`, signed in as Alex (A) with Sam as B, clean mode: `/app`, `/app/settings` and
  `/app/help` have zero confirmed findings with every scenario approved (including `mass-assignment` where a form
  saves), and `access-control` passes both scenarios; signed out, `/` `/signup` `/login` `/onboarding` stay clean.
- Each of V01–V05 alone: only the named check's scenarios run on the named page (signed in as Alex), and the named
  scenario reports a confirmed finding while the check's other scenarios stay clean.
- Every existing suite (Kennel's golden files, the samples) passes unchanged, signed out. On Kennel the V2 checks plan
  nothing (no account, and no links to other pages).
- No report, log line, evidence file or spec from any of these runs contains either password (a test greps the run
  folders).

## 0.5.0: write-side checks

The second V2 slice adds three checks that use accounts A and B to test **writes**, not reads. Everything above still
holds. These three checks change data in account A, so each one follows the safety rules below. The acceptance suite
enforces them.

### Safety contract (all three checks)

- **Only the run's own test record.** A write, including a replayed or forged one, targets only a record that Run
  Hound created as A **in this scenario**, carrying the run token (the usual test record, counted in
  `testRecordsCreated`). A's pre-existing records are never written to. Neither are ids found by listing, guessing or
  incrementing. When the page has no form that creates such a record, the scenario is skipped and says why.
- **Allowed targets only.** Every request goes through the safety gate and the navigation guard (v0-spec). Requests
  go only to the target's origin or the app's local API (the same "app backend" rule as `pii-leak`). Nothing is sent to
  a third-party host.
- **Never these endpoints**, even with `--allow-destructive`: sign-out, password, email, account deletion,
  payment/checkout provider, invitation or sharing endpoints. The existing never-click word lists and the "path that
  acts" rule (`deep-links`) decide this, plus the password/email field rule from `access-control` step 1.
- **Verdict from a re-read, not a status code.** A write "worked" only when a re-read **as A** shows the change (the
  value changed, or the record is gone). The attempted request's status does not decide it (a `200 {error}`, a write
  that is ignored, or a `404` from an idempotent DELETE are all common).
- **Restore, then confirm.** After each attempt the scenario puts the test record back: it writes the original values
  back, or creates it again when it was deleted. It then re-reads as A and compares with the snapshot taken before the
  attempt. Anything that could not be restored is named in the notes ("… could not be undone: check Account A"), and
  the scenario is not "pass" while such a note stands.
- **Credentials and evidence.** Account credentials come only from the configured accounts (env vars or
  `accounts.json`) and exported specs read them from environment variables. Evidence redacts cookies, bearer tokens,
  CSRF tokens and both passwords (`redactSecrets`, with the session values registered as in [Test accounts](#test-accounts)).
  Cookie values are never read into a page Run Hound serves and never written to the report.
- **Unticked by default**, like `mass-assignment`: these checks change account A. With a check unticked the plan says
  what it would do.

### Types and shared helpers (additions)

```ts
CHECK_IDS += "write-access", "csrf", "paywall-trust"   // after "deep-links"; V2_CHECK_IDS gains them too
// app/src/checks/lib/record-state.ts (shared by the three checks; no CheckContext change):
findOwnRecord(ctx, capture, testValues): Promise<{ url: string; body: string } | null>  // mass-assignment's findRecord, moved here
snapshotRecord(ctx, url, testValues): Promise<RecordSnapshot | null>   // GET as A, JSON, the run-token record only
rereadRecord(ctx, snap): Promise<JsonObject[] | "gone" | null>         // null = the re-read itself failed
restoreRecord(ctx, snap, how: { save: Capture["requests"][number] }): Promise<{ restored: string[]; notRestored: string[] }>
// app/src/checks/lib/cross-site.ts (csrf only): crossSitePage(ctx, target): Promise<CrossSitePage | { inconclusive: string }>
```

The three checks set `destructive: false`, `defaultSelected: false` and an `interruptedNote` (0.4.1) that asks the user
to check Account A, since a stop or the time limit can end a scenario between a write and its restore.

`CheckContext.request` stays as in 0.4.0 and **must not** decide a CSRF verdict. It runs outside a browser, so it
sends A's cookies whatever their SameSite value, and it adds the app's credential headers. A real cross-site page can
do neither.

### Checks (0.5.0)

| Check id | Group | Scope | Planned when | Default |
|---|---|---|---|---|
| `write-access` | Security | form | signed in, a form that saves a record; scenario `other-account` also needs B and `isolated` | **unticked** |
| `csrf` | Security | form | signed in, a form that saves a record | **unticked** |
| `paywall-trust` | Security | page | signed in, and an entitlement endpoint was found (below) | **unticked** |

### `write-access`

Scenarios `other-account` (as B) and `signed-out`.

1. As A, create the test record through the form. Find its record endpoint (as in `mass-assignment` step 2) and the
   write requests the app itself uses for it: the save request, plus PUT/PATCH/DELETE/POST requests to a URL that
   contains the test record's id, **observed from the app** (never guessed). No record endpoint means the scenario is
   skipped.
2. Snapshot the record as A.
3. As the scenario's identity, send each observed update request (PUT/PATCH/POST-to-id) with one field changed to a
   new run-token value. **DELETE runs last**, and only when the app itself showed a DELETE for that id.
4. After each request, re-read as A. Finding when the value changed or the record is gone: **critical**, confirmed,
   "Account B can change Account A's records" / "… delete …" / "Signed-out visitors can …". Then restore (see the
   safety contract).
5. Pass notes name the requests tried and say that A's record was unchanged.

### `csrf`

A real browser page on a **different site** from the target submits the forged request, and A's own browser context
sends whatever cookies the browser would send.

- **Cross-site origin.** Run Hound serves a blank attacker page from a local origin that is a different *site* from
  the target. When the target is on `localhost`, the page is on `127.0.0.1`, and the other way round. It is added to the
  allowed targets for that scenario only. Other ports of the same host are **not** cross-site (same site, so SameSite
  cookies are sent). When no truly cross-site local origin can be set up (for example when the target host is a
  private name from `RUNHOUND_ALLOWED_HOSTS`), the scenario is **inconclusive/skipped** with the reason, never
  "confirmed" and never "pass".
- **What is forged.** Only the save request this form already makes for the run's test record, with a new run-token
  value, sent to the app's own origin or its local API. Only requests a cross-site page can send **without a CORS
  preflight** are sent: form-encoded, multipart or `text/plain` bodies with no custom headers. Nothing is added to them
  (no token, no credential header).
- **JSON endpoints.** A save that the app sends as JSON can only be a finding when the same payload is accepted as
  `text/plain` or form-encoded (the scenario sends it that way), or when CORS reflects the attacker origin with
  credentials (then it is reported under this check and noted as a `cors` issue). Otherwise the scenario passes with
  "needs a preflight".
- **Cookies.** A cookie without a SameSite attribute counts as `Lax` (Chromium's default). Chromium also lets a
  new `Lax`-by-default cookie through on a cross-site POST during its first 2 minutes. So the scenario runs the forged
  request only once A's session is more than 2 minutes old, or it records that window and does not count the result.
- **Verdict.** Re-read the record as A. Finding when the forged value is stored: **high**, confirmed, "A page on
  another site can change Account A's data (no CSRF protection)". The notes explain which defense was missing (no
  token, SameSite=None, no Origin check). Then restore. A rejected request, or no change on re-read, is a pass.

### `paywall-trust`

Run Hound never enters payment details, and never loads or calls a payment provider. The navigation guard blocks any
third-party checkout host. A request to one is listed in the notes as "blocked (payment provider)".

1. **Entitlement endpoint (required).** A GET as A whose JSON holds A's plan/role/credits/entitlement fields (`plan`,
   `tier`, `subscription`, `isPro`, `credits`, `entitlements`, `features`), found like the `mass-assignment` record
   endpoint. None found → skipped ("No plan or entitlement data was found, so this can't be checked").
2. Snapshot it as A. Unpaid is the starting state: if A already has a paid plan, the scenario is skipped.
3. Probes, each followed by a re-read of the entitlement endpoint as A:
   - **Success page granting on load**: open the app's own success/upgraded/thank-you routes that the page links to
     or that the app's checkout redirect names (same origin only). Loading them must not change the entitlement.
   - **Client-sent price or plan**: when the app itself sends a same-origin upgrade/checkout request, it is replayed
     to the app only, with a zero price or a paid plan id, and never forwarded to a provider.
   - **Paid-feature API**: a same-origin API that the app calls only in paid mode (seen in the discovered requests)
     is called as unpaid A.
4. Finding only on a **server-side** state change or data: the entitlement changed (**critical**, confirmed, "Account
   A got a paid plan without paying"), or the paid-feature API answered 2xx with data (**high**, confirmed). A
   `402`/`403` is a pass. Text in the page ("Pro", "Upgrade", a success message), or gating only in the UI, is at most
   **advisory** and never confirmed.
5. Restore the snapshot's plan/role/credits. Whatever can't be put back is named ("… check Account A").

### Fernway (0.5.0 planned bugs)

Fernway's cookie is already `SameSite=Lax`. Clean mode keeps it and adds a CSRF token or Origin check, ownership
checks on writes, and a server-side entitlement. New bugs (ids to be confirmed in `bugs.json`):

| Id | Bug | Caught by (page) |
|---|---|---|
| V06 | `PATCH /api/tasks/:id` updates another user's task | `write-access:other-account` (`/app`) |
| V07 | Writes to `/api/tasks/:id` work without a session | `write-access:signed-out` (`/app`) |
| V08 | Session cookie set `SameSite=None; Secure` (Chromium accepts Secure on `http://localhost`), and the task save accepts a form-encoded body with no token or Origin check | `csrf` (`/app`) |
| V09 | `/app/upgraded` sets `plan: "pro"` on load (a fake local checkout, no provider) | `paywall-trust` (`/app/settings`) |

### Build plan (0.5.0)

Built in this order; each step owns the files named and touches no others.

1. **Foundation** (one engineer, first): register the three ids in `app/src/core/types.ts` (`CHECK_IDS`,
   `V2_CHECK_IDS`) and `app/src/checks/index.ts` with stub checks that plan nothing; create
   `app/src/checks/lib/record-state.ts` (moving `findRecord`/`recordChains`/`nearest` out of `mass-assignment.ts`,
   which then imports them, behavior unchanged) with unit tests. Everything else keeps passing.
2. **In parallel**, each on its own files only:
   - `write-access`: `app/src/checks/write-access.ts`, `write-access*.test.ts`.
   - `csrf`: `app/src/checks/csrf.ts`, `app/src/checks/lib/cross-site.ts`, `csrf*.test.ts`.
   - `paywall-trust`: `app/src/checks/paywall-trust.ts`, `paywall-trust*.test.ts`.
   - Fernway: everything under `fixtures/fernway/` (server routes, `bugs.json`, `CONTRACT.md`, the SPA for
     `/app/upgraded`, its own tests) for V06–V09 and the clean-mode defenses.
   Check tests build their own small fixture servers in the test file (as `mass-assignment-robust.test.ts` does)
   and do not edit `test-support/accounts-app.ts`.
3. **Integration** (one engineer, last): `tests/acceptance` (bug → route → check rows, clean-mode re-reads, the
   inconclusive `csrf` case, the widened secret grep), the web UI and report where they list checks, the site's
   checks data, README, TESTING, CHANGELOG and the 0.5.0 version bump.

### Acceptance (0.5.0 additions)

- Clean Fernway, signed in as Alex with Sam as B, all three checks ticked: no confirmed findings, and A's records and
  plan are unchanged afterwards (the test re-reads them).
- Each of V06–V09 alone: only the named scenario reports a confirmed finding, and A's state is restored afterwards.
- `csrf` on a target whose cross-site origin can't be set up reports inconclusive, never confirmed.
- Kennel and the samples: the new checks plan nothing, or skip with a reason. No existing golden file changes.
- The password grep covers the run folders of the new checks too: no report, log, evidence or spec holds either
  password, a session cookie value or a CSRF token.
