# Test fixture: Kennel

Kennel is a small, deliberately broken app that Run Hound is developed and scored against. It is a pet-sitting booking app with signup, a booking form, a profile page, and an admin page, backed by a **local Supabase** (`supabase start`) so every check runs against infrastructure we own.

It gives us a ground truth: we know exactly which bugs are planted, so we can measure what Run Hound finds, what it misses, and what it makes up.

## Why a fixture

- **Safe and legal.** Everything is owned and local, so two-account checks and writes can run freely.
- **Measurable.** Planted bugs give recall; the clean mode gives false positives. Hallucinated findings are the biggest product risk (see [research.md](research.md)), so this is the primary quality metric.
- **Reproducible.** `supabase db reset` plus seed data gives the same state on every run and in CI.

## Structure

```
fixtures/kennel/
  app/                 # frontend (stack chosen at build time; verify versions per AGENTS.md)
  supabase/
    migrations/        # schema + RLS policies, including the planted misconfigurations
    seed.sql           # two users (alice, bob) with their own pets, bookings and files
  mock-services/       # local stand-ins for analytics and payments; nothing leaves the machine
  bugs.json            # ground-truth manifest: id, toggle, expected finding, version
```

Every planted bug sits behind its own toggle (`KENNEL_BUGS=F01,A03,...` or `KENNEL_BUGS=all`). `KENNEL_BUGS=none` is the **clean mode**: every finding it gets counts as a false positive.

All planted "secrets" are fake values that only match key patterns, or local Supabase's default development keys. No real credentials.

## Planted bugs

### V0: booking form (single form, localhost)

These map to the V0 checklist in [research.md §6.1](research.md).

| ID | Category | Planted defect | Expected finding |
|---|---|---|---|
| F01 | Broken feature | "Save draft" button has no handler | Dead control: no request, DOM change or navigation |
| F02 | Broken feature | API returns 500 on a specific pet name; UI spins forever | Silent failure: no visible or announced error |
| F03 | Broken feature | "Special instructions" field shows a success toast but is never sent | Not persisted: value missing after reload |
| F04 | Broken feature | Submit button not disabled while pending | Double submit: two bookings created |
| F05 | Broken feature | Booking API URL built from an undefined env var (`undefined/api/...`) | Console/network error captured |
| F06 | Validation | End date before start date is blocked in the client only | Client-only validation: server accepts it |
| A01 | Accessibility | Phone input uses a placeholder as its only label | axe: missing label |
| A02 | Accessibility | Icon-only "clear" button with no accessible name | axe: button has no name |
| A03 | Accessibility | Pet-type picker is clickable `div`s | Keyboard completion fails; axe/role check |
| A04 | Accessibility | `outline-none` on inputs with no replacement | Focus not visible during keyboard traversal |
| A05 | Accessibility | Validation errors are red text only; no `aria-invalid`, `aria-describedby` or live region | Errors not announced |
| A06 | Accessibility | Muted gray helper text | axe: contrast |
| A07 | Accessibility | Paste blocked on the confirm-password field | Paste/autofill blocked (WCAG 3.3.8) |
| A08 | Accessibility | 16×16 px remove-pet icon buttons | Target size under 24×24 (WCAG 2.5.8) |
| A09 | Accessibility | Fixed-width form container | Reflow fails at 320 px |
| S01 | Security | Fake LLM-provider-shaped key inlined via a public env prefix | Bundle scan: third-party secret |
| S02 | Security | Local Supabase `service_role` key shipped in the bundle | Bundle scan: service_role claim |
| S03 | Security | User email sent to the mock analytics service in a query string | Canary PII leaked to a third party |
| S04 | Security | Server error returns a stack trace rendered in the UI | Verbose error leak |

### V2: needs two owned test accounts (alice, bob)

| ID | Category | Planted defect | Expected finding |
|---|---|---|---|
| D01 | Data access | `bookings` table has RLS disabled | Bob can read Alice's bookings |
| D02 | Data access | `pets` table policy is `USING (true)` | RLS exists but allows everyone |
| D03 | Data access | `profiles` update policy lets a user change their own `role` | Mass assignment: user promotes self |
| D04 | Auth | `/admin` guarded only by a client-side check | Admin data reachable as a normal user |
| D05 | Auth | Booking detail API uses the service key without an ownership check | IDOR across users |
| D06 | Data access | `vet-records` storage bucket is public | Other users' files reachable |
| D07 | Payments | Premium granted by the success page, not a verified webhook from the mock payment service | Premium without payment |

The clean mode must fix each of these properly (real policies, server-side checks), not just remove the feature, so false-positive runs exercise the same flows.

## Scoring

Run Hound is run against Kennel in CI for every change:

- **Recall:** planted bugs found / planted bugs enabled, per ID.
- **False positives:** findings in clean mode (target: zero confirmed-severity findings).
- **Stability:** the same run repeated 5 times gives the same findings; exported specs pass or fail consistently.
- **Evidence:** every finding has a screenshot and/or request/response and a replayable spec.

Results per bug ID are tracked over time so model or prompt changes show up as regressions.

## Later

- A Firebase variant using the Firebase Emulator Suite (open rules, public Storage).
- A static companion check: run Supabase's database lint/advisors on the local database next to the browser run, so a finding shows both the symptom (data leaked) and the cause (RLS disabled).
