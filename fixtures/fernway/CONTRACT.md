# Fernway runtime contract

Fernway is a second test app for Run Hound, built the way AI app builders (Lovable, Bolt, v0) build apps today:
Vite + React + TypeScript, Tailwind CSS v4, shadcn/ui-style components on Radix primitives, lucide icons, sonner
toasts, react-hook-form + zod, React Router. It is a small SaaS ("Fernway: project planning for small studios")
with a marketing page, sign-up and sign-in, an onboarding wizard, a dashboard and settings.

Kennel is one plain form with planted bugs. Fernway answers a different question: **does Run Hound work on the
kind of app people actually generate?** Custom selects, comboboxes, switches, dialogs, toasts, client-side routing,
animations, dark mode. So:

- **Clean mode (default) is well built on purpose.** Any confirmed finding Run Hound reports on it is either a real
  defect in Fernway (fix Fernway) or a Run Hound false positive or limitation (fix Run Hound; never bend Fernway to
  hide it). Triage every one.
- **Bug mode** (`FERNWAY_BUGS`) plants the bugs AI-built apps typically ship with, one per id, each caught by one
  existing Run Hound check (table below).

Anything named here (texts, labels, attribute values, field keys, routes, ids) is load-bearing: tests and Run Hound
checks rely on it. `docs/v0-spec.md` and `docs/v1-spec.md` win on any conflict about Run Hound's behaviour.

## Process

- Package `fernway` in the root pnpm workspace (`fixtures/fernway`). Build: `vite build` (output `dist/`, hidden
  source maps). Start: `node server/index.mjs`. The server uses Node built-ins only (no runtime dependencies), so the
  Docker image copies `dist/` and `server/` without `node_modules`.
- Env:
  - `PORT` (default `4110`): app and API.
  - `HOST` (default: all interfaces).
  - `FERNWAY_BUGS`: `none` (default), `all`, or a comma list such as `W01,W06` (case-insensitive, whitespace
    ignored; an unknown id exits with an error naming the known ids).
- When listening, the process writes a line containing `fernway listening`. Exits cleanly on `SIGTERM`/`SIGINT`.
- Data lives in memory, seeded on start (6 projects, 8 team members, 1 profile). `POST /api/__reset` restores the
  seed (`204`). `GET /api/__config` answers `200 { "bugs": [...] }` (sorted ids, `[]` in clean mode).
- No request ever leaves the app's origin: fonts (Inter via `@fontsource-variable/inter`), icons and images are
  bundled or served from `public/`. No analytics, no CDN.

## Routes (all serve the SPA's `index.html` with `200`, client-side routing with React Router)

| Route | Page | Forms on the page (in DOM on load) | Notable controls outside forms |
|---|---|---|---|
| `/` | Marketing landing | Waitlist (hero), Newsletter (footer) | Theme toggle, "Book a demo" (opens a dialog with a form), pricing billing Switch, FAQ accordion, testimonial carousel prev/next |
| `/signup` | Create account (split screen with art) | Create account | "Continue with Google", password show/hide |
| `/login` | Sign in | Sign in | password show/hide, "Forgot password?" link |
| `/onboarding` | 3-step wizard | Workspace (step 1 on load) | Back / Continue |
| `/app` | Dashboard | Quick add task | Sidebar collapse, command palette (⌘K), notifications, user menu, "New project" (opens a sheet with a form), status tabs, table row actions |
| `/app/settings` | Settings with tabs | Profile (Profile tab on load) | Tabs, notification Switches (auto-save) |

Any other path: the SPA's `index.html` with **`404`** status and a "Page not found" view. `/app` and
`/app/settings` work without signing in, as a demo workspace ("Signed in as Alex Rivera · Demo workspace"); signing
in only changes the name shown. (V2 will add real accounts; keep auth code in one module so it can grow.)

## Page requirements (clean mode)

Every page:

- One `<h1>`; a `<main>`; landmark `<header>`/`<nav>`/`<footer>` where they make sense; `<title>` per route
  (`Fernway: <page>`); `lang="en"`; a favicon (no 404 on load).
- Visible label for every field, programmatically associated (`<label for>`, or Radix `aria-labelledby`). Radix
  Select/Combobox triggers get their name from the visible label.
- Validation with react-hook-form + zod on submit (then on change): each invalid field gets `aria-invalid="true"`
  and `aria-describedby` pointing at a visible message; the first invalid field is focused; a polite live region or
  `role="alert"` announces that the form has errors.
- While a save request is pending, the submit button is `disabled` (with a spinner and unchanged accessible name
  plus `aria-busy`), and every save request carries an `Idempotency-Key` header the server de-duplicates.
- On a save error (any non-2xx or network failure): a visible, announced error (`role="alert"` inline message, and a
  sonner toast), inputs keep their values, the submit button is enabled again.
- On success: a sonner toast and an inline `role="status"` confirmation; the saved record is shown where the page
  lists records (and survives a reload).
- Keyboard: every control reachable and operable (Radix handles Select, Combobox, Tabs, Accordion, Switch, Dialog,
  DropdownMenu); visible focus ring on every focusable element (`focus-visible:ring-2` with offset, never
  `outline-none` without a ring).
- Contrast AA in light **and** dark mode; every button and toggle at least 24x24 px; no horizontal scroll at
  320x800; `prefers-reduced-motion` turns animations off.
- Paste never blocked; correct `autocomplete` (`email`, `name`, `new-password`, `current-password`,
  `organization`).
- No console errors, page errors, failed requests or 4xx/5xx on load or on the golden path.

### `/` Landing

- Sticky glass header: logo link "Fernway" (to `/`), nav links (Features, Pricing, FAQ as in-page anchors), a theme
  toggle button (accessible name "Switch to dark theme" / "Switch to light theme", `aria-pressed`), "Sign in" link
  (`/login`), "Get started" link styled as a button (`/signup`).
- Hero: headline, gradient mesh background, hero art image (`images.heroArt`, meaningful `alt`), and the
  **Waitlist form** (`aria-labelledby` a visible heading "Join the waitlist"): `Work email` (email, required),
  `Team size` (Radix Select: `1–5`, `6–20`, `21–50`, `51+`; required), submit `Join waitlist`. `POST /api/waitlist`
  `{ email, teamSize }` → `201 { id, email, teamSize, position }`; the page then shows "You're #<position> on the
  list" (`role="status"`). The same email twice → `409 { errors: { email: "This email is already on the list" } }`
  shown on the field. It does not list saved entries (Run Hound's persistence check should skip it, not fail).
- "Book a demo" button opens a Radix Dialog with the **Demo form**: `Full name`, `Work email`, `Company size`
  (Select), `Preferred date` (native date input, min today), `What would you like to see?` (textarea), `I agree to
  be contacted` (Radix Checkbox, required). `POST /api/demo-requests`. Esc and the close button (name "Close") close
  it and return focus to the trigger.
- Logo cloud (fictional logos as inline SVG, `aria-hidden`, with a visible caption), bento features grid (images),
  pricing (3 plans; a Radix Switch "Bill yearly" changes the prices shown), testimonials carousel (avatars; "Previous
  testimonial" / "Next testimonial" buttons; no auto-advance), FAQ Radix Accordion (5 items).
- Footer with the **Newsletter form** (`aria-labelledby` "Get product updates"): `Email address` (required),
  submit `Subscribe`. `POST /api/newsletter` → `201`; shows "Thanks! Check your inbox to confirm." (`role="status"`)
  and never shows the address again.

### `/signup` Create account

- Split screen: form card left, art (`images.authArt`) right (hidden below `md`).
- **Create account form**: `Full name`, `Work email`, `Password` (with a show/hide button "Show password" /
  "Hide password", `aria-pressed`; a strength meter with a `role="status"` text "Weak/Fair/Strong"), `Company`
  (optional), `I agree to the Terms and Privacy Policy` (Radix Checkbox, required), submit `Create account`.
  `POST /api/signup` → `201 { id, name, email }`, sets `fernway_session` (HttpOnly; SameSite=Lax; Path=/), then
  client-side navigation to `/onboarding`. Same email twice → `409` on the field. Password: 8+ chars.
- "Continue with Google" button (type button): shows a toast "Google sign-in isn't set up in this demo" and an inline
  `role="status"` note (so it visibly does something).
- Link "Already have an account? Sign in" (`/login`).

### `/login` Sign in

- **Sign in form**: `Email`, `Password` (show/hide), `Remember me` (Radix Checkbox), submit `Sign in`.
  `POST /api/login`: the only account is `alex@fernway.test` / `correct-horse-battery` → `200`, sets the session
  cookie, navigates to `/app`. Wrong credentials → `401 { error: "Email or password is incorrect" }` shown in a
  `role="alert"` above the form (a 401 is the app working, not an error).
- "Forgot password?" link (to `/login#forgot`, shows a short note; no second form).

### `/onboarding` Wizard

- A stepper (`<ol>` with `aria-current="step"`). Step 1 **Workspace form**: `Workspace name` (required), `Workspace
  URL` (prefix `fernway.app/`, slug; debounced `GET /api/slug-available?slug=` shows "Available"/"Taken" in a
  `role="status"`), `What will you use Fernway for?` (Radix RadioGroup of cards: Client projects, Internal work,
  Personal). `Continue` → step 2: `Invite teammates` (up to 3 email inputs, "Add another" / "Remove" buttons), `Skip`
  or `Continue` → step 3: review and `Finish setup` → `POST /api/onboarding` → success view with a link to `/app`.
- Back returns to the previous step with values kept. Each step is one `<form>`.

### `/app` Dashboard

- App shell: collapsible sidebar (collapse button "Collapse sidebar"/"Expand sidebar", `aria-expanded`), nav links
  (Dashboard, Projects, Settings), top bar with a search button "Search" (opens a cmdk command palette dialog; ⌘K /
  Ctrl+K), notifications button "Notifications" (Popover with 3 items), user menu button "Account menu"
  (DropdownMenu: Profile, Settings, Sign out). Every icon-only button has an accessible name.
- Stat cards (4), an area chart (inline SVG, with a text summary for screen readers), a "Projects" table
  (`<table>`, caption) from `GET /api/projects` with status Tabs (All, Active, Paused, Done) that filter it, and a
  row actions DropdownMenu per row ("Actions for <project>": Open, Duplicate, Archive).
- **Quick add task form** (card "Quick add"): `Task` (required), `Project` (Radix Select of project names), submit
  `Add task`. `POST /api/tasks` → `201`, the task appears in the "Today" list under the form (and after reload).
- "New project" button opens a Radix Dialog rendered as a right-side sheet with the **New project form**: `Project
  name` (required), `Description` (textarea), `Status` (Select: Active, Paused, Done), `Priority` (RadioGroup: Low,
  Medium, High), `Owner` (Combobox: Popover + cmdk list of the 8 members, filterable), `Due date` (date input),
  `Budget` (Radix Slider 0–50,000 step 500 with the value shown), `Notify the team` (Switch), submit `Create
  project`. `POST /api/projects` → `201`, closes the sheet, toast, the row appears in the table (and after reload).

### `/app/settings` Settings

- Radix Tabs: Profile, Notifications, Billing (Profile selected on load).
- **Profile form**: avatar (`images.avatars[0]`), `Display name`, `Email`, `Bio` (textarea, 160 chars with a live
  counter), `Time zone` (Select), submit `Save changes`. `PUT /api/profile` → `200`; shown values come from
  `GET /api/profile` (survive a reload).
- Notifications tab: 4 Switches, each saving on toggle (`PATCH /api/notifications`) with a toast.
- Billing tab: current plan card, "Change plan" (link to `/#pricing`), "Cancel subscription" (opens a Radix
  AlertDialog; destructive, so Run Hound must not click it by default).

## API

JSON in and out; unknown keys ignored; malformed JSON → `400 { errors: { body: "..." } }`; validation errors →
`400 { errors: { <field>: <message> } }`; any other `/api/*` → `404 { error: "Not found" }`; a server failure →
`500 { error: "Something went wrong" }` with no stack traces, paths or `node:internal` in any body. The name
`Crash` in any name field (after trim) makes that create request fail with `500` (a deterministic error path for
tests).

| Method and path | Body keys | Success |
|---|---|---|
| `POST /api/waitlist` | `email`, `teamSize` | `201` |
| `POST /api/demo-requests` | `name`, `email`, `companySize`, `date`, `message`, `consent` | `201` |
| `POST /api/newsletter` | `email` | `201` |
| `POST /api/signup` | `name`, `email`, `password`, `company`, `terms` | `201` (password never echoed or stored in plain text) |
| `POST /api/login` | `email`, `password`, `remember` | `200` / `401` |
| `GET /api/slug-available?slug=` | | `200 { available }` |
| `POST /api/onboarding` | `workspaceName`, `slug`, `useCase`, `invites[]` | `201` |
| `GET /api/projects`, `POST /api/projects` | `name`, `description`, `status`, `priority`, `ownerId`, `dueDate`, `budget`, `notify` | `200` list / `201` |
| `GET /api/members` | | `200` list |
| `GET /api/tasks`, `POST /api/tasks` | `title`, `projectId` | `200` list / `201` |
| `GET /api/profile`, `PUT /api/profile` | `displayName`, `email`, `bio`, `timeZone` | `200` |
| `PATCH /api/notifications` | `{ <key>: boolean }` | `200` |

Save requests with an `Idempotency-Key` header already seen answer the first response again (no second record).

## Response headers, cookies and source maps (clean mode)

- Every response: `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
  img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self';
  frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`.
- The first page load sets `fernway_session=<uuid>; Path=/; HttpOnly; SameSite=Lax`.
- No CORS headers on the API. Source maps are built hidden and `*.map` answers `404`.

## Planted bugs (`FERNWAY_BUGS`)

Each is typical of AI-built apps and is caught by one existing Run Hound check on the page named. `bugs.json` is the
ground truth; goldens live in `expected/`.

| Id | Page | Bug | Caught by |
|---|---|---|---|
| W01 | `/` | The waitlist "Team size" Select trigger has no accessible name (label not associated) | `axe-states` |
| W02 | `/` | Newsletter: a failed save is swallowed (`catch {}`), nothing is shown | `silent-failure` |
| W03 | `/app` | Quick add: "Add task" never disables and the server ignores the Idempotency-Key, so a double click adds 2 | `double-submit` |
| W04 | `/app/settings` | Profile: `Bio` shows as saved (toast) but is dropped by the client before sending | `persistence` |
| W05 | `/app` | Icon-only buttons (sidebar collapse, notifications) have no accessible name | `axe-states` |
| W06 | every page | A Stripe-style live secret key (`sk_live_…`, fake) is in the JS bundle | `bundle-secrets` |
| W07 | `/signup` | Focus ring removed (`outline-none`, no ring) on the inputs | `focus-visible` |
| W08 | every page | No security headers (no CSP, no clickjacking protection, no nosniff) | `security-headers` |
| W09 | every page | `fernway_session` set without HttpOnly | `cookie-flags` |
| W10 | `/login` | Sign-in errors are shown in red text only (no `role="alert"`, not linked to the fields) | `error-announcement` |

Bug ids never change clean-mode behaviour of anything else.

## Images

`src/lib/images.ts` is the only place image URLs are named (`images.heroArt`, `images.authArt`,
`images.features[3]`, `images.avatars[8]`, `images.onboarding`, `images.emptyState`). Files live in
`public/images/` (WebP, each under 150 KB). They are generated locally (see `public/images/README.md` for the model,
its license and the prompts) or drawn as SVG; either way they ship in the repo and are served by Fernway itself.
