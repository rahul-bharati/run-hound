# Test fixtures: Kennel and Fernway

> **Status (0.4.0):** two fixtures are built.
>
> - **Kennel** (`fixtures/kennel`) is a single booking page (`/book`) on a small in-memory Node server with a mock
>   analytics service. It has no Supabase, sign-up, profile or admin pages. Its bugs are the `V0` and `V1` entries in
>   [bugs.json](../fixtures/kennel/bugs.json); its contract is [CONTRACT.md](../fixtures/kennel/CONTRACT.md).
> - **Fernway** (`fixtures/fernway`) is a Lovable-style SaaS app with real sign-in and two accounts. It is the fixture
>   for the V1 checks on a modern UI (W01-W10) and for the V2 preview's access checks (V01-V05). See its
>   [README](../fixtures/fernway/README.md) and [CONTRACT.md](../fixtures/fernway/CONTRACT.md).
> - The Supabase-backed Kennel described under [Planned: Kennel on Supabase](#planned-kennel-on-supabase-v2) is not
>   built. Fernway covers the checks 0.4.0 ships; a Supabase variant stays planned for the checks that need a real
>   backend (row-level security, storage rules, payments).

Run Hound is developed and scored against small, deliberately broken apps. Each bug is planted on purpose, so we know
exactly what Run Hound should find, what it misses and what it makes up.

## Why fixtures

- **Safe and legal.** Everything is owned and local, so two-account checks and writes can run freely.
- **Measurable.** Planted bugs give recall; the clean mode gives false positives. Invented findings are the biggest
  product risk (see [research.md](research.md)), so this is the primary quality metric.
- **Reproducible.** Data lives in memory and is seeded on start, so every run and every CI job starts from the same
  state.

Every planted bug sits behind its own toggle (`KENNEL_BUGS=F01,A03`, `FERNWAY_BUGS=W01,V02`, or `all`). `none` (the
default when you start a fixture yourself) is the **clean mode**: every confirmed finding it gets is a false positive or
a real defect in the fixture, never something to hide. The compose files start each fixture twice: `kennel` (bugs on,
`KENNEL_BUGS` default `all`) beside `kennel-clean`, and `fernway` (clean) beside `fernway-bugs` (`FERNWAY_BUGS` default
`all`).

All planted "secrets" are fake values that only match key patterns. No real credentials.

## Kennel

A pet-sitting booking page: Vite + React frontend (a real built bundle, so bundle scanning is realistic) and a Node
server with the API and a mock analytics service on a second port, so it counts as a third party.

```
fixtures/kennel/
  src/                 # the booking page (React)
  server/index.mjs     # API, mock analytics, bug toggles (Node built-ins only)
  bugs.json            # ground truth: id, version, severity, the check that must catch it
  expected/            # accepted responses (golden files) for clean mode and every V0 and V1 bug
  CONTRACT.md          # routes, labels, texts, API and every bug; load-bearing
```

### V0: the booking form

These map to the V0 checklist in [research.md §6.1](research.md).

| ID | Category | Planted defect | Expected finding |
|---|---|---|---|
| F01 | Broken feature | "Save draft" button has no handler | Dead control: no request, DOM change or navigation |
| F02 | Broken feature | API returns 500 on a specific pet name; UI spins forever | Silent failure: no visible or announced error |
| F03 | Broken feature | "Special instructions" field shows a success toast but is never sent | Not persisted: value missing after reload |
| F04 | Broken feature | Submit button not disabled while pending | Double submit: two bookings created |
| F05 | Broken feature | Booking API URL built from an undefined env var (`undefined/api/...`) | Console/network error captured |
| F06 | Validation | End date before start date is blocked in the client only | Client-only validation: server accepts it |
| A01 | Accessibility | Phone input uses a placeholder as its only label | Missing label |
| A02 | Accessibility | Icon-only "clear" button with no accessible name | axe: button has no name |
| A03 | Accessibility | Pet-type picker is clickable `div`s | Keyboard completion fails; errors not announced |
| A04 | Accessibility | `outline-none` on inputs with no replacement | Focus not visible during keyboard traversal |
| A05 | Accessibility | Validation errors are red text only; no `aria-invalid`, `aria-describedby` or live region | Errors not announced |
| A06 | Accessibility | Muted gray helper text | axe: contrast |
| A07 | Accessibility | Paste blocked on the confirm-password field | Paste/autofill blocked (WCAG 3.3.8) |
| A08 | Accessibility | 16×16 px remove-booking icon buttons | Target size under 24×24 (WCAG 2.5.8) |
| A09 | Accessibility | Fixed-width form container | Reflow fails at 320 px |
| S01 | Security | Fake LLM-provider-shaped key in a script the page loads | Bundle scan: third-party secret |
| S02 | Security | A JWT with a `service_role` claim in a script the page loads | Bundle scan: service_role claim |
| S03 | Security | Owner email sent to the mock analytics service in a query string | Canary PII leaked to a third party |
| S04 | Security | Server error returns a stack trace rendered in the UI | Verbose error leak |

### V1: the page

| ID | Category | Planted defect | Caught by |
|---|---|---|---|
| F07 | Broken feature | The `Refresh` button beside "Your bookings" (outside the form) has no click handler | `page-controls` |
| S05 | Security | No security headers (no CSP, clickjacking protection or nosniff) | `security-headers` |
| S06 | Security | The session cookie is set without HttpOnly | `cookie-flags` |
| S07 | Security | The API echoes any `Origin` (including `null`) with credentials | `cors` |
| S08 | Security | Source maps with the original source code are public | `source-maps` |

`KENNEL_BUGS=all` turns on every V0 and V1 bug. Kennel has a modern look since 0.4.0; its contract and bugs did not
change.

## Fernway

A small SaaS app ("project planning for small studios") built the way AI app builders build apps today: Vite, React 19,
Tailwind CSS, shadcn/ui-style components on Radix, react-hook-form with zod, sonner toasts and React Router. It asks
whether Run Hound works on the kind of app people actually generate: custom selects, switches and radio cards, forms in
dialogs and sheets, toasts, client-side routing and dark mode.

Pages: `/`, `/signup`, `/login`, `/onboarding`, and, behind a real sign-in, `/app`, `/app/settings` and `/app/help`.
Two accounts (`alex@fernway.test` and `sam@fernway.test`, passwords in the
[README](../fixtures/fernway/README.md#accounts)) each have a workspace of their own. Clean mode is well built on
purpose; any confirmed finding on it must be triaged.

### W01-W10: V1-style bugs on a modern UI

| ID | Page | Planted defect | Caught by |
|---|---|---|---|
| W01 | `/` | The waitlist "Team size" select has no accessible name | `axe-states` |
| W02 | `/` | Newsletter: a failed save is swallowed and nothing is shown | `silent-failure` |
| W03 | `/app` | Quick add: the button never disables and the server ignores the idempotency key | `double-submit` |
| W04 | `/app/settings` | Profile: Bio shows as saved but is dropped before sending | `persistence` |
| W05 | `/app` | Icon-only buttons have no accessible name | `axe-states` |
| W06 | every page | A fake live secret key is in the JavaScript bundle | `bundle-secrets` |
| W07 | `/signup` | Focus ring removed on the inputs | `focus-visible` |
| W08 | every page | No security headers | `security-headers` |
| W09 | every page | The session cookie is set without HttpOnly | `cookie-flags` |
| W10 | `/login` | Sign-in errors are red text only | `error-announcement` |

### V01-V05: the V2 preview's access bugs

Caught with Run Hound signed in as Alex (account A), with Sam as account B.

| ID | Page | Planted defect | Caught by |
|---|---|---|---|
| V01 | `/app/settings` | Any signed-in user can read any user's profile (no ownership check) | `access-control` (other account) |
| V02 | `/app` | The task list returns every user's tasks | `access-control` (other account) |
| V03 | `/app`, `/app/settings` | The workspace APIs answer without a session; only the page redirects | `access-control` (signed out) |
| V04 | `/app/settings` | Saving the profile stores any field it is sent, including `role` and `plan` | `mass-assignment` |
| V05 | `/app` | `/app/help` (linked from the sidebar) answers 404 when opened directly | `deep-links` |

### V06-V09: the write bugs (0.5.0)

0.5.0 ships only `csrf`, which catches V08 the same way, with `csrf` ticked (it is unticked by default). V06, V07 and
V09 are planted for `write-access` and `paywall-trust`, which are still planned; the acceptance suite lists them and
skips them until their checks are built.

| ID | Page | Planted defect | Caught by |
|---|---|---|---|
| V06 | `/app` | `PATCH /api/tasks/:id` updates another user's task | `write-access` (other account, planned) |
| V07 | `/app` | Writes to `/api/tasks/:id` work without a session | `write-access` (signed out, planned) |
| V08 | `/app` | The session cookie is `SameSite=None; Secure`, and the task save takes a form-encoded body with no token or Origin check | `csrf` (target on `localhost`) |
| V09 | `/app/settings` | `/app/upgraded` grants Pro on load, with no payment | `paywall-trust` (planned) |

`FERNWAY_BUGS=all` turns on W01-W10 and V01-V09. The full tables, with what each bug changes, are in
[CONTRACT.md](../fixtures/fernway/CONTRACT.md); the ground truth is [bugs.json](../fixtures/fernway/bugs.json).

## Scoring

The acceptance suite (`tests/acceptance`) runs Run Hound against both fixtures and the
[sample apps](../fixtures/samples/README.md) in CI, on every pull request and every push to `main`:

- **Recall:** with each planted bug on alone, the check that must catch it reports it (Kennel: the golden file in
  `fixtures/kennel/expected/`; Fernway: the `detectedBy` check on the bug's page).
- **False positives:** clean Kennel, clean Fernway (every route, the signed-in pages as Alex with Sam as account B) and
  the sample apps give zero confirmed findings with every scenario approved.
- **Evidence and secrets:** every finding on Kennel with every bug on carries visual evidence that exists on disk (a
  real PNG or GIF), and no file a run writes holds a planted secret or a test account's password.

Planned: repeating the same run to check that findings are stable, and tracking results per bug id over time so model
or prompt changes show up as regressions.

## Planned: Kennel on Supabase (V2)

Not built. A fuller Kennel with sign-up, a booking form, a profile page and an admin page, backed by a **local
Supabase** (`supabase start`), so the checks that need a real backend run against infrastructure we own. It would add
`supabase/migrations/` (schema and RLS policies, including the planted misconfigurations), `seed.sql` (two users,
alice and bob, with their own pets, bookings and files) and a mock payment service, and `supabase db reset` would give
the same state on every run. Its bugs are listed in [bugs.json](../fixtures/kennel/bugs.json) as `V2`, with no
`detectedBy` yet:

| ID | Category | Planted defect | Expected finding |
|---|---|---|---|
| D01 | Data access | `bookings` table has RLS disabled | Bob can read Alice's bookings |
| D02 | Data access | `pets` table policy is `USING (true)` | RLS exists but allows everyone |
| D03 | Data access | `profiles` update policy lets a user change their own `role` | Mass assignment: user promotes self |
| D04 | Auth | `/admin` guarded only by a client-side check | Admin data reachable as a normal user |
| D05 | Auth | Booking detail API uses the service key without an ownership check | IDOR across users |
| D06 | Data access | `vet-records` storage bucket is public | Other users' files reachable |
| D07 | Payments | Premium granted by the success page, not a verified webhook from the mock payment service | Premium without payment |

The clean mode must fix each of these properly (real policies, server-side checks), not just remove the feature, so
false-positive runs exercise the same flows. Some need checks that are still planned (`write-access`,
storage, `paywall-trust`).

## Later

- A Firebase variant using the Firebase Emulator Suite (open rules, public Storage).
- A static companion check: run Supabase's database lint/advisors on the local database next to the browser run, so a
  finding shows both the symptom (data leaked) and the cause (RLS disabled).
