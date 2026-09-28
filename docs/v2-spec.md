# V2 spec (0.4.0 preview, 0.5.0, 0.6.0): signed-in runs, access checks and the write-side checks

Status: the V2 preview (the web UI and the HTML report say "V2 preview"). Its first slice shipped in 0.4.0, `csrf` in
0.5.0, and `write-access`, `paywall-trust` and two-step and sessionStorage sign-in in 0.6.0. This is its build
contract. It extends [v0-spec.md](v0-spec.md) and [v1-spec.md](v1-spec.md), which still hold for everything not changed
here (safety gate, navigation guard, evidence, groups, reports, tester-release rules), and
[ai-spec.md](ai-spec.md) for the optional AI layer. The acceptance suite enforces all of them.

V2 is "single feature end to end" ([roadmap](roadmap.md#v2-single-feature-preview-since-040)). 0.4.0 ships its foundation and its headline:

- **Test accounts**: two accounts the user owns on their app (A and B), and **signed-in runs**: every existing check
  runs as account A (or B), so pages behind a login can be tested.
- **Access checks** with the two accounts: can account B, or a signed-out visitor, read account A's data?
- **Mass assignment**: does the server accept fields the form never sends, such as `role` or `plan`?
- **Deep links**: do the app's own pages load when opened directly (a reload, a shared link)?

Not in 0.4.0: write-side access checks, CSRF and paywall/success-page trust. 0.5.0 ships `csrf`; 0.6.0 ships
`write-access` and `paywall-trust` (see [0.5.0: write-side checks](#050-write-side-checks) and its
[0.6.0 amendments](#060-write-side-checks-and-sign-in)). Still planned: multi-page feature runs (a feature named by the
user, tested across its pages), the two other `paywall-trust` probes, rate limits, file upload, prompt injection.

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
   "…sends the password in the page address (a GET form)…". One exception (0.6.0): a weak password (under 8
   characters, letters, digits and `_` only, such as "demo") is often one of the app's own words, so in a script's
   same-origin request (a fetch, an image, not a page navigation) it is stopped only under a query key that names a
   password (`password`, `pwd`, `pin` …); `?user=demo` goes through. In a navigation any query value is stopped.
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

**Status: 0.5.0 shipped `csrf` only.** `write-access` and `paywall-trust` are specified below and built in 0.6.0,
with the amendments in [0.6.0: write-side checks and sign-in](#060-write-side-checks-and-sign-in), which win where
they differ.

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
  the scenario is not "pass" while such a note stands. When the page left the allowed targets, the scenario is an
  error and its notes are the navigation guard's summary followed by the check's own notes, so the note is never lost
  (0.6.0; any other check's notes are the summary alone).
- **Credentials and evidence.** Account credentials come only from the configured accounts (env vars or
  `accounts.json`) and exported specs read them from environment variables. Evidence redacts cookies, bearer tokens,
  CSRF tokens and both passwords (`redactSecrets`, with the session values registered as in [Test accounts](#test-accounts)).
  Cookie values are never read into a page Run Hound serves and never written to the report.
- **Unticked by default**, like `mass-assignment`: these checks change account A. With a check unticked the plan says
  what it would do.

### Types and shared helpers (additions)

```ts
CHECK_IDS += "csrf"   // after "deep-links"; V2_CHECK_IDS gains it too. "write-access" and "paywall-trust" join when built
// app/src/checks/lib/record-state.ts (shared by the three checks; no CheckContext change):
findOwnRecord(ctx, capture, testValues): Promise<{ url: string; body: string } | null>  // mass-assignment's findRecord, moved here
snapshotRecord(ctx, url, testValues): Promise<RecordSnapshot | null>   // GET as A, JSON, the run-token record only
rereadRecord(ctx, snap): Promise<JsonObject[] | "gone" | null>         // null = the re-read itself failed
restoreRecord(ctx, snap, how: { save: Capture["requests"][number]; create?: Capture["requests"][number]; queryStamps?: ReadonlySet<string> }): Promise<{ restored: string[]; notRestored: string[] }>
// (create and queryStamps: 0.6.0; queryStamps, from recordQueryStamps, names the URL-query stamps the record showed)
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
| `write-access` (shipped in 0.6.0) | Security | form | signed in, a form that saves a record; scenario `other-account` also needs B and `isolated` | **unticked** |
| `csrf` (shipped in 0.5.0) | Security | form | signed in, a form that saves a record | **unticked** |
| `paywall-trust` (shipped in 0.6.0) | Security | page | signed in (0.6.0: planned on every signed-in page, and skipped at run time when no entitlement endpoint is found) | **unticked** |

### `write-access`

Shipped in 0.6.0, with the [`write-access` amendments](#write-access-amendments), which win where they differ.

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
  (no token, no credential header), and every anti-CSRF token Run Hound recognises is left out: by name (csrf or xsrf in
  it, `authenticity_token`, `__RequestVerificationToken`, `_token`, `token`, `nonce`, `_wpnonce`, `form_key`,
  `form_token`, also nested as `task[_token]`), or by value when Account A's page holds it in a csrf/xsrf `<meta>`, a
  csrf/xsrf cookie or a hidden input (a token's name, or a random-looking value Run Hound didn't type), read before the
  submit and again after it (a native form post leaves the page). A field left out by its value alone (a random value
  in a hidden input whose name doesn't say token and that no csrf/xsrf `<meta>` or cookie holds, UUIDs and ObjectIds
  included) is a value Run Hound **can't place**: it may be a token, or a reference such as an id. So is a query
  parameter of the save's URL left out only because its value equals such a hidden value, and a random query value
  found only in the URL. An unplaced value is never added back (a home-made token made with `crypto.randomUUID()`
  would then give a false finding), and it weighs on the verdict (below; close-out review, round 2). Known limit: a
  token the app's scripts keep in memory (fetched from an API) and send in a body field under another name is
  replayed, so a token-protected save can then be reported as a finding. A body that is a JSON array, a bare JSON
  value, a multipart body carrying a file, or a JSON object with no text field Run Hound can forge (the page encodes
  the typed value before sending it: `{"data": {"b64": "…"}}`) is not forged: the scenario is skipped and names the
  body type, never a pass or a finding (0.6.0 close-out; the exported spec rebuilds a body as an object of named
  fields).
- **JSON endpoints.** A save that the app sends as JSON can only be a finding when the same payload is accepted as
  `text/plain` or form-encoded (the scenario sends it that way), or when the app's CORS answer to a real preflight
  allows the attacker origin with credentials (the save is then also sent as JSON, and a stored forge is reported under
  this check and noted as a `cors` issue; see "Reading the answer" for a loopback-only allowlist). Otherwise the
  scenario passes with "needs a preflight".
- **Cookies.** A cookie without a SameSite attribute counts as `Lax` (Chromium's default). Chromium lets a new
  `Lax`-by-default cookie through on a cross-site POST during its first 2 minutes only when the POST is a top-level
  navigation. Every forge is a form posted into a frame of the attacker page, or a fetch, never a top-level navigation,
  so that window never applies and there is nothing to wait out: a `Lax` cookie stays home whatever the session's age.
  (Corrected in 0.6.0: this bullet used to say the forge waits out the window or records it; no release ever did,
  since no forge can open it.)
- **Verdict.** Re-read the record as A. Finding when the forged value is stored: **high**, confirmed, "A page on
  another site can change Account A's data (no CSRF protection)". The notes explain which defense was missing (no
  token, SameSite=None, no Origin check). When the stored forge carried no cookie at all, the save needs no session:
  the title ends "(the save needs no session)" instead, and the fix says to require Account A's session on the save
  first, then add a CSRF defence. That is claimed only when Run Hound saw the forge's answer and the request carried
  no cookie: the browser reports the Cookie header a request carried only with its answer, and every forge (form,
  multipart, `text/plain`, JSON) waits up to 30 seconds for one (`FORGE_WAIT_MS`; the close-out's first version waited
  5 seconds for the form and multipart forges). When Run Hound sees no answer to a forge (none within 30 seconds, or
  the connection closed), it can't tell which cookies rode on it: a stored forge is still a confirmed finding ("no CSRF
  protection"), and it says the cookies aren't known (0.6.0 close-out). Then restore. A rejected request, or no change
  on re-read, is a pass, except (close-out review, round 2):
  - **No answer.** A forge with no answer and nothing stored on re-read is inconclusive, never a pass, and says the
    app may still store it ("check Account A"); no further encoding is sent after it. A forge the browser couldn't
    send at all (the connection refused, a host name that doesn't resolve) is inconclusive and names the browser's
    error.
  - **An unplaced value in the body.** When a value Run Hound can't place was left out of the forged body and a forge
    that carried Account A's cookie (or may have: its answer wasn't seen) was answered `400`, `404`, `409`, `422`, a
    `5xx`, a 2xx that stored nothing or a 3xx that isn't a redirect to sign-in, the scenario is inconclusive: a
    missing value explains those answers as well as a CSRF defence does. A `403` is inconclusive too when a field left
    out looks like a reference: an id-like name (`list_id`, `list-id`, `listId`, `uuid`, `guid`, read on the last part
    of a nested name such as `task[list_id]`) or a UUID or 24-hex ObjectId value, since an authorization check (Pundit,
    CanCanCan, a Laravel Gate) answers a missing reference with `403`. A `419` (Laravel's CSRF answer), a `401`, a
    `415` or a redirect to sign-in keep the pass, and so does a `403` when nothing says the value is a reference; that
    pass names no defence, only that Run Hound left out a value it can't place and can't rule out that the app refused
    a missing value the save needs. The notes call such a field "a random value in a hidden input Run Hound can't
    place" or "a random value from the save's URL", never Account A's anti-CSRF token.
  - **An unplaced value in the URL.** A random query value Run Hound can't place (not id-named, not a UUID) makes any
    answer to a forge that carried A's cookie and stored nothing inconclusive, a `403` included. An ObjectId counts as
    a reference only for the body's `403` rule.

  Known limits: a random hidden value under a name that doesn't look like an id, with a value that is neither a UUID
  nor an ObjectId (a home-made `formToken`, Moodle's `sesskey`, DokuWiki's `_sectok`), refused with `403`, `419`, `401`
  or `415`, passes, so a reference under such a name on an app with no CSRF defence that answers `403` is a pass. The
  other way round, an app with a real defence (an Origin check, or a named token such as `authenticity_token`) that
  refuses with `403` while a reference-looking hidden value was also left out is inconclusive, not a pass. A 2xx such
  as `202 Accepted` that queues the forge and stores it after the re-read counts as answered with nothing stored, and
  passes without naming a defence. An
  app that never answers a forge costs one 30-second wait (plus up to 6 s for a fetch forge), inside the scenario's
  3-minute limit.
- **Reading the answer (0.6.0).** The `text/plain` forge is a `no-cors` fetch, so its status and the cookies it
  carried are seen like a form post's. Every run-token value is forged, at any depth of a JSON body, keeping the length
  of the value the app accepted; a multipart save is forged as a multipart form. A 3xx is an answer (a redirect to a
  sign-in page is a refusal); a `400` to a forge sent the save's own way that carried A's cookie, with nothing left out,
  is inconclusive (it refuses the value, not the request); a 2xx with nothing stored passes without naming a defence,
  unless a value Run Hound can't place was left out (then it is inconclusive: "Verdict").
  A new record carrying the run's values after an accepted forge is a stored forge, even when the app rewrote the
  forged value. CORS that allows the attacker page but not `http://run-hound-other-site.invalid` trusts loopback
  origins only: a stored JSON forge is then an **advisory** finding, never "any site". Known limit: only that `400`
  counts as refusing the value. A `409` or `422` counts as a refusal like a `403`, because Rails answers a missing CSRF
  token with `422` and the capture records no request headers to tell a header-token save apart, so an app that
  rejects the forged value itself with `422` or `409` passes when nothing was left out by its value alone (with an
  unplaced value left out it is inconclusive: "Verdict").

### `paywall-trust`

Shipped in 0.6.0 with the success-page probe only. The [`paywall-trust` amendments](#paywall-trust-amendments) win where
they differ: the exception that lets it change and restore Account A's plan, the entitlement endpoint (only the app's
own GETs), the candidate routes, the verdict, the restore through the app's own cancel control, and the two probes
below that are not in 0.6.0 (the client-sent price or plan, and the paid-feature API).

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
| V06 | `PATCH /api/tasks/:id` updates another user's task | `write-access:other-account` (`/app`, 0.6.0) |
| V07 | Writes to `/api/tasks/:id` work without a session | `write-access:signed-out` (`/app`, 0.6.0) |
| V08 | Session cookie set `SameSite=None; Secure` (Chromium accepts Secure on `http://localhost`), and the task save accepts a form-encoded body with no token or Origin check | `csrf` (`/app`) |
| V09 | `/app/upgraded` sets `plan: "pro"` on load (a fake local checkout, no provider) | `paywall-trust` (`/app/settings`, 0.6.0) |

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

- Clean Fernway, signed in as Alex with Sam as B, every built write-side check ticked (`csrf` in 0.5.0): no confirmed
  findings, and A's records and plan are unchanged afterwards (the test re-reads them).
- Each of V06–V09 alone: only the named scenario reports a confirmed finding, and A's state is restored afterwards.
  In 0.5.0 that is V08 (`csrf`); V06, V07 and V09 are listed and skipped until their checks are built.
- `csrf` on a target whose cross-site origin can't be set up reports inconclusive, never confirmed.
- Kennel and the samples: the new checks plan nothing, or skip with a reason. No existing golden file changes.
- The password grep covers the run folders of the new checks too: no report, log, evidence or spec holds either
  password, a session cookie value or a CSRF token.

## 0.6.0: write-side checks and sign-in

**Status: shipped in 0.6.0.** 0.6.0 builds `write-access` and `paywall-trust` as specified in
[0.5.0: write-side checks](#050-write-side-checks), with the amendments below, adds two sign-in forms that 0.5.0
refuses, and gets Run Hound ready for live alpha testers. Decisions: [scope](decisions/09-2026.md#2026-09-27-0-6-0-scope),
[paywall-trust](decisions/09-2026.md#2026-09-27-paywall-trust-changes-and-restores-the-plan),
[write-access](decisions/09-2026.md#2026-09-27-write-access-observed-requests-only),
[sign-in](decisions/09-2026.md#2026-09-27-two-step-and-sessionstorage-sign-in); from the release review's close-out:
[csrf](decisions/09-2026.md#2026-09-28-csrf-cookies-unknown-when-the-answer-is-unseen),
[write-access](decisions/09-2026.md#2026-09-28-write-access-stale-version-refusals-inconclusive),
[paywall-trust](decisions/09-2026.md#2026-09-28-paywall-trust-quiet-read-before-the-next-page),
[sessionStorage](decisions/09-2026.md#2026-09-28-sessionstorage-seeded-only-when-the-session-lives-there),
[code steps](decisions/09-2026.md#2026-09-28-code-step-by-heading-needs-a-code-field); from the close-out's review
rounds: [GraphQL reads](decisions/09-2026.md#2026-09-28-graphql-read-needs-a-graphql-query),
[persisted GraphQL reads](decisions/09-2026.md#2026-09-28-hold-learns-persisted-graphql-reads),
[anti-CSRF headers](decisions/09-2026.md#2026-09-28-write-access-token-refusals-400-422-and-header-pairing),
[csrf's 30-second wait and unplaced values](decisions/09-2026.md#2026-09-28-csrf-waits-30-s-and-weighs-values-it-cant-place),
[write-access's comparison as Account A](decisions/09-2026.md#2026-09-28-write-access-compares-a-stale-version-with-account-a),
[paywall-trust's first read and tab pages](decisions/09-2026.md#2026-09-28-paywall-trust-page-under-test-and-tab-pages-held),
[code steps by the field's own words](decisions/09-2026.md#2026-09-28-code-step-reads-the-fields-own-words),
[sessionStorage limits](decisions/09-2026.md#2026-09-28-sessionstorage-limits-both-ways).

### Registration (0.6.0)

```ts
CHECK_IDS += "write-access", "paywall-trust"   // after "csrf"; V2_CHECK_IDS gains both
// report.ts: the checks a report lists as "nothing to test on this page" depend on the release that wrote it:
// csrf from 0.5, write-access and paywall-trust from 0.6; all three only on a signed-in run.
// app/src/checks/lib/entitlement.ts (paywall-trust only): find, snapshot and re-read Account A's plan (below).
```

Both checks: group Security, `defaultSelected: false`, `destructive: false`, an `interruptedNote` asking the user to
check Account A. `write-access` has form scope; `paywall-trust` has page scope.

### `write-access` amendments

- **Observed requests only.** The update and delete requests are only those the app itself sent for the run's test
  record. The unfinished draft's fallback (a made-up `PATCH <save URL>/<id>`, "proven as A first") is not used. With no
  observed update and no observed DELETE the scenario is skipped: "The app showed no update or delete for its test
  record, so there is nothing to try as <identity>."
- **Distinct markers.** Each probe writes a fresh run-token value that can't be confused with the value the record was
  created with or with another scenario's marker (the lesson from `csrf`). A clean server that ignores the write
  passes.
- **Records Account A already had (`write-access` and `csrf`).** The form's own save as A is held in the page and judged
  before it reaches the app: a write that isn't a POST, or a POST whose path, id query or body names a record id the
  page read before the submit (unless it posts to a path the page read as a list), or that posts to a path the page read
  as one record, is stopped, and the scenario is skipped with "Skipped: this form changes a record Account A already
  had, …" and a note that the save was stopped, so nothing was changed. A save that went through and only then shows it
  changed such a record (its id was read before the save, its URL or body names the id, or the record endpoint reads one
  record at a URL without its id) is skipped before any write as another identity or from another site, and the record
  is put back as the page read it before the save, through the app's own update for its id; what can't be put back is
  named with the form's save and "check Account A". No note ever says nothing was written when the save went through.
  GraphQL (0.6.0 close-out round 1): a POST whose body is a GraphQL query (no mutation) is a read, never stopped, and
  the ids its answer holds count like a GET's; a GraphQL read's path (`/graphql`, which serves every operation) is
  neither a list nor a record the page read. A mutation that names such an id in its variables or as a literal
  argument in its query text is stopped. A body is a GraphQL query only when each of its operations holds nothing but
  `query`, `variables`, `operationName` and `extensions`, and its `query`, comments left out, starts a GraphQL document
  (a selection set, or `query`, `subscription` or `fragment` before one) that holds no mutation (close-out round 2): a
  REST save with a `query` field (a saved search's `{name, query}`, a default-search setting's `{query}`) is judged
  like any other save, and one that edits a record the page read is stopped. A POST the page sent that may read but
  isn't a GraphQL query by that test also teaches the hold the ids its answer holds (never its path), and is never
  sent again, since it may be a mutation (a re-read after a stopped save counts it as unknown): a persisted operation
  with no query text (Apollo's automatic persisted queries, `extensions.persistedQuery`; Relay's `doc_id` or GraphQL
  over HTTP's `documentId`, with `variables`; Hot Chocolate's and Strawberry Shake's `{id, variables}` with no key
  beside `id`, `variables`, `operationName` and `extensions`), or a query holding no mutation beside another key
  (Relay's `{id, query, variables}`). Such a POST is itself still judged as a write: it goes unless it names a record
  the page read. Such a body is a GraphQL operation, so a form's save sent that way with no operation name is stopped
  as "a persisted query". A GET is a GraphQL read like one with `?query=` when it carries `doc_id` or `documentId`
  together with `variables` and no parameter but `doc_id`, `documentId`, `variables`, `operationName` and
  `extensions`; a REST read at `GET /api/note?doc_id=n1` keeps its path, so a save to that same URL is stopped as a
  change to a record Account A already had (close-out, persisted queries). The form's GraphQL mutation whose root
  fields don't all read as a create (a create verb first, or create, add or insert last, no word that says it changes
  one, and a thing it makes that isn't the one record of its kind an account has: `createTask`, `taskCreate`,
  `insert_tasks_one`, `addComment` do; `updateProfile`, `saveSettings`, `upsertTask`, `likePost`, `submitProfile`,
  `sendSettings`, `accountCreate` don't; a persisted query by its operation name) is stopped too, with "Skipped: this
  form saves through a GraphQL mutation (<fields>) whose name doesn't say it creates a record, …": before any save has
  gone through, and after one unless it names the record that save created, an id the page hadn't read before the
  save that the save's answer held (close-out round 2: `updateTask(id: "t9")` for the task `createTask` just made
  goes; `updateProfile(name: …)` after it is stopped; a later mutation waits up to 2 s for the capture to read the
  save's answer). When no GET reads the
  saved record back (a GraphQL app), `write-access` is skipped like `csrf`, and the note names the form's save, says it
  reached the app and says "check Account A". Known limit: a REST body whose only fields are GraphQL's own keys and
  whose `query` text happens to be valid GraphQL shorthand (`{"query": "{status: open}"}`) is taken for a GraphQL read
  and goes through unjudged; text Run Hound types never looks like GraphQL, so the form's own typed save is always
  judged. Known limit: a persisted query sent as `{id: <hash>, variables}` with no query text, no `doc_id` or
  `documentId`, no `extensions.persistedQuery` and no `operationName` (Hot Chocolate's shape) is neither learned as a
  read nor judged as GraphQL, so on such an app a form that edits a record the page read that way can reach the app and
  change it: check Account A.
- **Versions and locks.** A stamp the app changes on every save (lock_version, version, __v, _rev, etag, updatedAt) goes
  in each attempt at its value in the re-read just before it. An attempt that left the record unchanged and was
  answered 409, 412 or 428, or 400, 422 or 5xx while it carried a stamp the re-read doesn't show, is inconclusive,
  never a pass. A 401 or 403 is judged as before, and a 400, 422 or 5xx still passes when every stamp could be
  refreshed (0.6.0 close-out) and no anti-CSRF token was left out or kept as A's (below). A version or lock in the
  update's URL query (`?lock_version=0`, `?task[lock_version]=0`, `?meta[version]=0`) is refreshed like one in the
  body, but only when its value is one the record showed before the app's update was sent (the save's answer, a read
  or answer of the record after it, or the snapshot); another parameter with a stamp's name (`?version=2`, an API
  version) is left as the app sent it, in the attempt and in the put-back, and counts as a stamp Run Hound couldn't
  refresh. Notes and findings name each request with its query as it was sent (close-out review, rounds 1 and 2).
- **Comparing with Account A (close-out review, rounds 1 and 2).** A `404`, or a 2xx that left the record unchanged,
  to an attempt that carried a stamp the re-read doesn't show may be the app's version check (`UPDATE … WHERE
  lock_version = $2` matched no row), not a refusal of the sender. Such an attempt is compared with the same attempt
  sent as Account A: the app's own update as A's page sent it (A's own anti-CSRF token, in its body or header, and A's
  URL credential), with the same stamps and a fresh run-token value of A's own in the same field. Besides the
  put-backs, that is the only write `write-access` sends as Account A after the save, and only to the run's own test
  record: never a `DELETE`, never
  a write that changes nothing; it is judged by a re-read as A, then put back and re-read like any attempt, and the
  summary names it ("… and <request> as Account A to compare"). B's attempt passes only when that re-read shows A's
  value, or the app answers A with `409`, `412` or `428`. A `404`, a 2xx that left the record unchanged, a `400`, `422`
  or `5xx`, or no answer to A's copy leaves the scenario inconclusive, never a pass. (A `400`, `422` or `5xx` to B's
  attempt with such a stamp stays inconclusive without a comparison.)
- **No answer.** An attempt that got no answer (the connection dropped, or it timed out) and left the record unchanged
  is inconclusive, never a pass; the verdict still comes from the re-read, so a change it made is a confirmed finding
  (close-out review, round 1).
- **Known limits (versions).** The replay carries the body of the app's own update and, of its headers, only an
  anti-CSRF token (below), so an update guarded by `If-Match` is refused for the missing header: inconclusive on 412 or
  428, a pass on another status (such as 422); Account A's comparison copy doesn't carry `If-Match` either, and runs
  only after a 404 or an unchanged 2xx. An app that answers 404 both for another account's record and for a stale
  version its reads don't show can't be told apart, so it is inconclusive, never a pass. An app whose reads don't show
  the version and that refuses a stale version with 400, 422 or 5xx is inconclusive even when it refuses Account B
  with 404 first (A's same write is then refused too, and a 422 can't show it is the version check). When the app
  applies A's comparison copy and its reads show a field it sets on every save (`updated_at`, `version`), the put-back
  leaves that field changed, so the scenario is inconclusive ("… changed while Run Hound sent … as Account A to compare
  … check Account A"), never a pass, even on a clean app. A body key named like a version (`version`, `updatedAt`,
  `etag`) is taken for the record's version (a query parameter only when the record showed its value).
- **Anti-CSRF tokens (0.6.0 close-out round 1).** A token in the body of the app's own update, or in a header it
  carried (the capture keeps a write's headers whose name has csrf or xsrf in it: `CapturedRequest.csrfHeaders`;
  Django's `X-CSRFToken`, axios' `X-XSRF-TOKEN`, Rails' `X-CSRF-Token`), goes as the identity's own: read where A's came
  from (the csrf/xsrf cookie or `<meta>` whose value, as it is or URL-decoded, is A's) on a page opened as B, decoded
  the same way. When no source on A's page holds the header's value any more (Laravel encrypts its `XSRF-TOKEN` cookie
  anew on every answer), the header is paired with its usual source by name (close-out round 2): `X-XSRF-TOKEN` with
  the `XSRF-TOKEN` cookie, URL-decoded; `X-CSRFToken` with the `csrftoken` cookie; `X-CSRF-Token` with
  `<meta name="csrf-token">`; and B's current value goes. `CheckContext.request` sends an anti-CSRF header the caller
  passes; every other credential header is still the identity's own. A's token is never sent in a header as someone
  else: with none of B's own to read (a token the app's scripts keep in memory), and always signed out, the header is
  left out (a body token that can't be swapped stays A's, as since 0.6.0 round 1), and a 400 (ASP.NET Core's
  antiforgery), 403, 419 or 422 (Rails' `InvalidAuthenticityToken`) to that attempt is inconclusive, never a pass
  (close-out round 2 added 400 and 422).
- Everything else as in `write-access` above: A creates the record, snapshot, each observed update as the scenario's
  identity, DELETE last and only when the app showed one, verdict from a re-read as A, restore, notes.

### `paywall-trust` amendments

- **Exception to "only the run's own test record".** `paywall-trust` may change **Account A's entitlement** (plan,
  role, credits, entitlements) and nothing else. It snapshots them before any probe and restores them after (below),
  and the scenario is never a pass while a restore note stands. Every other rule of the safety contract holds.
- **Entitlement endpoint.** A GET the app itself makes as A (while loading the page under test) whose JSON describes the
  signed-in account and holds a plan/entitlement field (`plan`, `tier`, `subscription`, `isPro`, `pro`, `credits`,
  `entitlements`, `features`, `role`). None → skipped ("No plan or entitlement data was found, so this can't be
  checked"). A already on a paid plan → skipped ("Account A already has a paid plan …").
- **0.6.0 probe: a success page that grants on load.** As A, in A's own browser context with the navigation guard on,
  open each candidate route and let the page run as it would for a visitor; then re-read the entitlement as A.
  Candidates, same origin only, at most 10: links on the page under test and the pages it links to whose path or text
  names a success or upgrade result (`upgraded`, `success`, `thank-you`, `thanks`, `welcome`, `activated`,
  `confirmed`, together with a billing word or under a billing, checkout, plan or upgrade path), then the conventional
  paths `/upgraded`, `/app/upgraded`, `/success`, `/checkout/success`, `/billing/success`, `/payment/success`,
  `/thank-you`, `/thanks`, `/app/billing/success`. A route that answers 404 or redirects to sign-in is skipped. Run
  Hound itself sends no request other than these page loads and the re-reads; whatever the page sends on load is the
  app's own behaviour, and requests to a payment provider are blocked by the guard and listed as "blocked (payment
  provider)". A page's own navigation to another page of the app whose path starts a checkout, a subscription or a
  billing portal session (and doesn't name the result, as `/checkout/success` does) is held, never sent. Known limit: a
  navigation to a page of the app whose path doesn't name such a start (`/go/manage`) is let through; a redirect from
  there to a payment provider is blocked, but the app's server may already have created the checkout or billing portal
  session.
- **Verdict.** Account A **gained** something after a probe: **critical**, confirmed, "Account A got a paid plan
  without paying", naming the route and the fields gained. A gain is a paid plan the snapshot didn't have (`isPaid`
  after and not before), `isPro`/`pro` turning true, a numeric `credits` value that went up, or `entitlements` or
  `features` that gained an entry (a list item, a flag turned on, a limit raised). A gain in credits, entitlements or
  features alone (no plan field changed) is read once more after a pause with nothing opened (the time since the
  snapshot, 5 to 30 s): a further change means the value moves on its own (a balance that refills on a timer), and the
  probing ends inconclusive, naming both changes, with nothing clicked or put back. Any other difference from the
  snapshot (credits spent, a free plan moved to a trial, a named trial of a paid tier such as `pro_trial` or a
  `trialing` subscription included, a role, an entry taken away) ends the probing
  **inconclusive**: skipped, never a pass, naming the fields, and put back as below where a cancel can do it, else
  "check Account A". So does a gain after a route that showed the page under test itself (the same fingerprint, or a
  route that went on to the page under test): that is the app's own page (a single-page app's catch-all), not a
  success page, so it is never credited with a grant. Page text alone ("Pro", "You're upgraded") with no entitlement
  change is at most **advisory**. The exported spec checks only the fields gained: it reads the plan after the route
  loads (and, for a tab, after the tab is chosen) until `SETTLE_MS` have passed, and fails on the first change.
  `SETTLE_MS` is how long the change took to show, from opening the credited route to the read that showed it, plus
  5 s, rounded up to whole seconds, at most 60 s, and `test.setTimeout` is 60 s plus `SETTLE_MS` (close-out review,
  round 1): a grant that took more than about 55 s to show is still reported, but its spec may pass. A run that
  stopped for time with routes left unopened (Run Hound opens no page once only 2 minutes of the 6-minute limit are
  left) is inconclusive, never a pass: the notes name the routes it didn't open (up to six, then "and N more") and say
  "check Account A, or run the check on a faster copy of the app". When no route answered at all, it is skipped ("ran
  out of time before it opened one").
- **Late changes (0.6.0 close-out).** After each route that loads as a page, or Billing tab chosen, and before the next
  one is opened or chosen, Run Hound waits until 5 s (`QUIET_MIN_MS`) have passed since that route's re-read, with
  nothing opened, and reads the entitlement once more, so a change that lands late (a queued job's) is put down to the
  route that caused it, never to the next one, even one that answers. Once per such route, and skipped when a later
  read already covered that span; it adds up to 5 s per route that loads, inside the scenario's 6-minute limit. Before
  an ending that saw no change, the entitlement is read once more after the same quiet pause since the last route's
  re-read. The quiet wait is never shortened or skipped to save time, not even near the probing deadline: a shorter
  wait would put a late change down to the next route. Its cost comes out of the 4 minutes of probing, and a run that
  runs out of time with routes unopened is inconclusive ("Verdict").
  - **The page under test's own load (close-out review, round 1)** is the first route. Nothing is opened until 5 s
    have passed since Run Hound first read the plan, and then the plan is read again (about 4 s more on every run). A
    change seen then is the page's own (a job its load queued, or a value that moves by itself): the scenario ends
    inconclusive before any success page is opened, nothing is put back and nothing is credited to a later route, and
    the notes say "… may keep the <fields> it gained: check Account A" when something was gained, plus "run the check
    on the billing or settings page that links to it instead" for a gained plan. A plan that already reads as paid at
    the first read is skipped ("already has a paid plan … Put Account A on the free plan").
  - **Billing tabs (close-out review, rounds 1 and 2).** The quiet wait and read after a Billing tab run under the
    tab's own hold: every navigation to the app, and every write (a fetch, XHR or beacon) to a checkout, subscription
    or billing portal start, is held and named as the tab's ("Choosing the "Billing" tab on /app sent a request to
    /api/billing/portal-session, which Run Hound stopped"). So are the final quiet read and the pause before a route
    is opened again while a tab's page is on screen. While the page on screen is one on which Billing tabs were
    chosen, the scenario's own hold also stops that page's writes to a start. Before Run Hound loads another page (the
    next route, a route opened again, the restore's pages) or ends, it leaves that page for `about:blank` under the
    tabs' hold, a beacon its `pagehide` sends included: a page stays alive until the next one commits, so without this a
    tab's late write could reach the app while the next page's server answers. When two or more tabs were chosen on
    the same page, a note about what was stopped names them all ("After Run Hound chose the "Billing" and "Plans" tabs
    on /app, the page sent a request to …").
  - **A route that loaded as a page** runs through its quiet wait as it would for a visitor who stays on it: its own
    requests, a write to a checkout or portal start sent on a timer included, reach the app; only its navigations to a
    start stay held (the scenario's hold). A change read after a route that didn't load as a page is put down to the
    last route before it that did, and the note lists the routes that didn't load in between (never "opened next" when
    one came between).
  - **Known limits.** A change that lands more than about 5 s after its route is put down to a later route, or, after
    the last route's quiet read, not seen at all, so the scenario can pass while A is on the paid plan. When the page
    under test is itself a success page that grants on load, a grant that lands before the first read makes the
    scenario skip as "already has a paid plan", one within about 5 s after it ends it inconclusive with nothing opened,
    and only a later one falls under the late-grant limit (test the billing or settings page that links to it
    instead). No finite wait closes these. On a slow app (pages that take about 8 s or more to answer, several
    billing and settings pages with Billing tabs, every conventional path answering), the quiet waits can use up the
    probing time, and the scenario then ends inconclusive where it might otherwise have reached a later success
    page.
- **A plan read only from a session endpoint.** When every GET that holds A's plan is an auth or session endpoint
  (NextAuth's `/api/auth/session` with the JWT strategy), its answer may keep the plan A signed in with: a gain it shows
  is still a grant, and otherwise the scenario ends inconclusive, never a pass, and the notes say "check Account A".
- **Restore.** When a probe changed the entitlement, go back through the app's own UI: on the page under test, or the
  app's billing or settings page among its links, click a control whose name says it cancels or downgrades the plan
  ("Cancel plan", "Cancel subscription", "Downgrade", "Switch to Free"), follow a confirmation the app asks for, then
  re-read. `paywall-trust` clicks such a control only to undo its own scenario's change (known limit: `page-controls`
  and `dead-control`, the buttons outside and inside a form, may also click a plan button whose name isn't on the
  destructive list, such as "Switch to Free", and with `--allow-destructive` a "Cancel subscription"), as A, with the guard on (a click that heads for a payment provider is
  blocked, and the restore counts as failed). When the entitlement still differs, the notes say "Account A's plan is still <value>: check Account A". Known limit: a cancel
  or downgrade control that opens a new window is never followed (a new window's first page is never loaded), so the
  restore counts as failed and the notes say "check Account A". The Billing tabs the restore chooses to find the plan's
  control are left for `about:blank` the same way before the next page and at the end, but for the few milliseconds
  between their hold and the control's click, and between the click and the leave, only the click's own hold (its
  writes to a portal or checkout) and the scenario's hold of navigations to a start apply (the restore doesn't use the
  scenario hold's writes rule, whose start words would also stop a real cancel write such as `/api/auth/session`); a
  page's `pagehide` beacon is held for 500 ms after the blank page commits.
- **Not in 0.6.0 (known limits):** the client-sent price/plan replay (it would start a checkout, which on a real app
  reaches the payment provider through the app's server, and no fixture bug proves it) and the paid-feature API probe (a
  free account never sees the paid-only requests to replay).

### Sign-in: two-step and sessionStorage (0.6.0)

Extends [Signing in](#signing-in-appsrcengineauthts). Every guarantee there holds: the password is typed only on the
sign-in page's origin, a request carrying it to another origin or in a URL is stopped, codes and captchas fail with
their messages, and session values are registered for redaction.

- **Two-step sign-in.** When the sign-in page has no form with a password field but has one with an identifier field
  and a submit or "Continue"/"Next" control (sign-in words, never a sign-up form), fill the identifier, submit, and
  wait for a password field: on the same page, or on the next page when it is on the sign-in origin (another origin
  fails: "The sign-in continued on another site (<host>), so Run Hound won't type the password there."). Then continue
  as a one-step sign-in. A code or captcha after the first step fails with the existing messages.
- **sessionStorage sessions.** After a successful sign-in, read `sessionStorage` for the sign-in origin and the
  landing origin. The items are returned (`SignedIn.sessionStorage`) and every new browser context for that identity
  seeds them before any page script runs (an init script per origin) only when the session lives there: the app sent
  one of their values in a credential header after the password was typed (Authorization, an API key, a session-named
  header; never a CSRF header), or the session is nowhere else. It is somewhere else when the submit set or changed a
  token-like cookie (whatever its name), a session-named cookie (sess, sid, auth, token …) or an HttpOnly cookie of the
  app's own site holds a token-like value, or localStorage or IndexedDB holds a token; a CSRF or antiforgery,
  analytics, bot-check, load-balancer, bot-manager or WAF cookie (XSRF-TOKEN, `.AspNetCore.Antiforgery.<id>`,
  `__RequestVerificationToken`, _ga, __cf_bm, __cflb, __cfwaitingroom, ARRAffinity, AWSALB, heroku-session-affinity,
  aws-waf-token …: `NOT_SESSION_COOKIE`) never counts. The app's own site
  is the last two labels of the sign-in page's or the landing page's host name (an IP address or a one-label host as it
  is), since there is no public-suffix list. When it lives there, token-like values are registered as session secrets
  (a whole value, and every string in the JSON a value holds, whatever its key: `{id: …}`, a storage wrapper's
  `{value: …, expires}`), except values the app's own requests carried as a path segment or a query value (under a key
  that doesn't name a session, token or key) and never in a credential header (ids, not secrets). Otherwise nothing is
  seeded, and sessionStorage values are registered by localStorage's rules (a value under a session-like key, a JWT, a
  JSON value's token fields). `CheckContext.request` keeps authenticating with the credential headers harvested from
  the app's own requests. Decision:
  [sessionStorage is seeded only when the session lives there](decisions/09-2026.md#2026-09-28-sessionstorage-seeded-only-when-the-session-lives-there).
- **Code steps.** A page after the password is a code step when it has `autocomplete=one-time-code`, or its only field
  to fill in has a sign-in code word in its own words. That field is an input, never a textarea or a list, or a code
  split over 4 to 8 one-character boxes. The code words are OTP, one-time, passcode, verification or verify, two-step
  or 2-step, two-factor, multi-factor, 2FA, MFA, TOTP, authenticator, or a security, sign-in, login, confirmation or
  n-digit code. Its own words are its name, id, label (an `aria-labelledby` label included), placeholder, `aria-label`
  or `autocomplete`, never promo, coupon, invite, zip, API or another code (close-out review, round 1). Names are read
  word by word through camel case (`verificationCode`), with `_ - . [ ]` read as spaces, but a code word only the
  camel-case reading finds (`verificationSearch`) counts only on a field that looks like a code's or is numeric
  (round 2). A field that can't hold a code is never one: `type=email`, or own words with no code word (code, OTP,
  PIN, passcode, token, digit, one-time, 2FA, MFA, TOTP, authenticator) that say name, or that say email, phone or
  mobile, unless they also say verify or verification ("Mobile verification") or the field is numeric, and never when
  they say send, resend, address or number ("Send the verification email to", "Verify your mobile number"). When
  only the page's headings or title name a code step, the field must look like a code's itself: code, OTP, PIN, token
  or digit in its own words, a `maxlength` of 4 to 8 or a `pattern` of 4 to 8 digits, or split boxes (0.6.0
  close-out). A numeric field (`type=number`, `inputmode` numeric or decimal, a digits-only `pattern`) with none of
  those counts only when a heading or the title names a code step outright: two-step or 2-step, two-factor,
  multi-factor, 2FA, MFA, TOTP, authenticator, one-time, OTP, passcode, or a verification, security, sign-in, login,
  confirmation or n-digit code. A bare verify or verification is never enough ("Please verify your email address" over
  a `type=number` "Hours worked today" field signs in; round 2). At the sign-in page's own address, a visible field
  whose name or label says code or verify counts, as it has since 0.4.0.
- **Types.** `SignedIn` gains `sessionStorage?: { origin: string; items: { name: string; value: string }[] }[]`.
- **Still not supported:** verification codes, captchas, "Sign in with …" providers, a password page on another site,
  and a sessionStorage session the app throws away on load.
- **Known limits (0.6.0 close-out and its review):**
  - A sessionStorage session that sends nothing with its token while signing in is taken for a cookie session when it
    sits next to a cookie of the app's own site that is HttpOnly or whose name says session or token, and isn't a
    known load-balancer, bot-manager or WAF cookie (`app_sess`, for example): its sessionStorage isn't seeded, and the
    plan fails with "still shows the sign-in page".
  - The other way round, a cookie session is taken for a sessionStorage session when the app keeps anything in
    sessionStorage and the cookie has a name that doesn't say session (sess, sid, auth, token …), was set by a page
    script or without HttpOnly when the sign-in page loaded, and was kept unchanged by the submit (PHP with
    `session.cookie_httponly` off, a custom `session_name` and no `session_regenerate_id` on sign-in). Its
    sessionStorage is then seeded in every browser, pages load their data from that copy, and `access-control` can
    skip with "Account A has no data on this page that Run Hound can recognise" instead of reporting the IDOR. Such a
    cookie can't be told apart from a visitor cookie the server sets on the sign-in page without the rejected
    cookie-only-tab check.
  - Some verification-code pages named a code step only by their heading or title aren't recognised: Test sign-in
    reports success, and the signed-in checks then run on that page. That covers a page whose only field has no code
    word in its own words, isn't code-sized (no `maxlength` of 4 to 8, no `pattern` of 4 to 8 digits) and isn't split
    into boxes, and either has no numeric hint (`type=number`, `inputmode` numeric or decimal, a digits-only
    `pattern`; `type=tel` isn't one) or has only a numeric hint under headings and a title that say just verify or
    verification ("Verify it's you"). It also covers a code field whose own words say a phone or mobile number or an
    address with no code word ("Enter the number we sent to your phone"), and one whose only code word is in text given
    by `aria-describedby`, which isn't read.
  - A signed-in landing page fails sign-in with "asks for a verification code" when its only field has a sign-in code
    word in its own label, placeholder or name as written, a field that says verify or verification beside email,
    phone or mobile without send, resend, address or number included ("Phone verification" lookup, a text-type
    "Verification email" field). So does one whose only field, with own words that say nothing of email, phone,
    mobile, name or API, is code-sized or says code, OTP, PIN, token or digit under a heading or title with a sign-in
    code word, a bare verify included (a `maxlength=6` "Quantity" field under "Please verify your email address"), or
    is numeric under one that names a code step outright (a `type=number` field under "Two-factor settings").
  - An app that shows its signed-in view at the sign-in page's own address, with a field whose name or label says code
    or verify ("Room code"), fails sign-in with "asks for a verification code" (unchanged since 0.4.0).

### Fernway (0.6.0)

- **`FERNWAY_LOGIN`** = `one-step` (default) | `two-step`: `/login` shows the email and **Continue**; the password field
  appears on the same page after Continue, for any email (the form doesn't reveal which emails have accounts).
- **`FERNWAY_SESSION`** = `cookie` (default) | `session-storage`: the SPA keeps the session token in `sessionStorage`
  and sends `Authorization: Bearer <token>`; the server accepts the bearer token and sets no session cookie. With no
  cookie there is nothing for a cross-site page to ride on, so `csrf` passes on V08 in this mode.
- Both work with clean mode and with `FERNWAY_BUGS`, and both compose files pass them through (defaults unchanged).
- The Billing tab's **Cancel plan** (`POST /api/billing/cancel`) is what `paywall-trust` uses to put Alex back on
  Free after V09.

### Acceptance (0.6.0)

- V06, V07 and V09 each alone: only the named scenario reports a confirmed finding (`write-access:other-account`,
  `write-access:signed-out`, `paywall-trust`), and Alex's and Sam's tasks and Alex's plan read the same afterwards.
- Clean Fernway with every write-side check ticked: no confirmed finding, and the same data unchanged afterwards.
- Signed in with `FERNWAY_LOGIN=two-step`, and separately with `FERNWAY_SESSION=session-storage`: sign-in succeeds,
  the signed-in plan for `/app` matches a cookie-session plan, and one read bug the access checks catch with a cookie
  session is caught the same way.
- The secret grep covers the new run folders, including sessionStorage token values.
- Kennel and the samples: no golden file changes.

### Alpha readiness (0.6.0)

- **TESTING.md** opens with a short section for alpha testers: what to try (their own app, signed out and signed in),
  what to send back and how, and the limits that matter; "What sign-in can't do" and "Known limitations" drop two-step
  and sessionStorage and add the deferred `paywall-trust` probes, the Supabase anon key dropped on signed-out replay,
  the unmasked live view of signed-in runs, and arm64 Chromium not being started in CI.
- **Issue forms** list `write-access` and `paywall-trust` wherever they list checks.
- **Web UI**: Settings → Test accounts says the three write-side checks change Account A's data and put it back; the
  plan shows the same for each unticked write-side scenario.
- **Release**: version 0.6.0 everywhere the release check looks, a CHANGELOG entry, and the site's checks data.

### Build plan (0.6.0, a graph)

Each node owns the files named and touches no others; a node starts when the nodes it depends on are green, and loops
(implement, run its suites, independent review, fix) until its tests pass and the review finds nothing new.

| Node | Owns | Depends on |
|---|---|---|
| N1 foundation (lead) | `core/types.ts`, `checks/index.ts`, stub `write-access.ts`, `paywall-trust.ts`, `lib/entitlement.ts`, `engine/report.ts` gate, `auth.ts` types, this section | none |
| N2 write-access tests | `checks/write-access*.test.ts` | N1 |
| N3 write-access | `checks/write-access.ts` | N2 |
| N4 paywall tests | `checks/paywall-trust*.test.ts`, `checks/lib/entitlement.test.ts` | N1 |
| N5 paywall | `checks/paywall-trust.ts`, `checks/lib/entitlement.ts` | N4 |
| N6 sign-in tests | `test-support/accounts-app.ts`, `engine/auth-twostep.test.ts`, `engine/auth-sessionstorage.test.ts`, `engine/context-sessionstorage.test.ts` | N1 |
| N7 sign-in | `engine/auth.ts`, `engine/context.ts` | N6 |
| N8 Fernway | `fixtures/fernway/**` | none |
| N9 engine wiring | `engine/runner.ts`, `engine/runner-signed-in.test.ts` | N3, N7 |
| N10 acceptance | `tests/acceptance/**` | N5, N8, N9 |
| N11 docs, UI and alpha readiness | `TESTING.md`, `docs/**` guides, `README.md`, `CHANGELOG.md`, `server/ui/client.ts`, `.github/ISSUE_TEMPLATE/*`, `site/src/components/checks/data.ts` | N5, N9 |
| N12 release | versions, compose and Dockerfile comments, `site/src/lib/site.ts` | N10, N11 |
