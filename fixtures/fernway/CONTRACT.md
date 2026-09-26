# Fernway runtime contract

Fernway is a second test app for Run Hound, built the way AI app builders (Lovable, Bolt, v0) build apps today:
Vite + React + TypeScript, Tailwind CSS v4, shadcn/ui-style components on Radix primitives, lucide icons, sonner
toasts, react-hook-form + zod, React Router. It is a small SaaS ("Fernway: project planning for small studios")
with a marketing page, sign-up and sign-in, an onboarding wizard, and a dashboard, settings, a help page and an upgrade
page behind a real sign-in (two seeded accounts, each with a workspace and a plan of its own).

Kennel is one plain form with planted bugs. Fernway answers a different question: **does Run Hound work on the
kind of app people actually generate?** Custom selects, comboboxes, switches, dialogs, toasts, client-side routing,
animations, dark mode. So:

- **Clean mode (default) is well built on purpose.** Any confirmed finding Run Hound reports on it is either a real
  defect in Fernway (fix Fernway) or a Run Hound false positive or limitation (fix Run Hound; never bend Fernway to
  hide it). Triage every one.
- **Bug mode** (`FERNWAY_BUGS`) plants the bugs AI-built apps typically ship with, one per id, each caught by one
  Run Hound check: W01-W10 by V0/V1 checks, V01-V09 by the V2 checks run signed in (`docs/v2-spec.md` "Fernway
  V2" for V01-V05, "Fernway (0.5.0 planned bugs)" for V06-V09). Tables below.

Anything named here (texts, labels, attribute values, field keys, routes, ids) is load-bearing: tests and Run Hound
checks rely on it. `docs/v0-spec.md`, `docs/v1-spec.md` and `docs/v2-spec.md` win on any conflict about Run Hound's
behaviour.

## Process

- Package `fernway` in the root pnpm workspace (`fixtures/fernway`). Build: `vite build` (output `dist/`, hidden
  source maps). Start: `node server/index.mjs`. The server uses Node built-ins only (no runtime dependencies), so the
  Docker image copies `dist/` and `server/` without `node_modules`.
- Env:
  - `PORT` (default `4110`): app and API.
  - `HOST` (default: all interfaces).
  - `FERNWAY_BUGS`: `none` (default), `all` (W01-W10 and V01-V09), or a comma list such as `W01,V02`
    (case-insensitive, whitespace ignored; an unknown id exits with an error naming the known ids).
- When listening, the process writes a line containing `fernway listening`. Exits cleanly on `SIGTERM`/`SIGINT`.
- Data lives in memory, seeded on start: two users (see "Accounts"), each with a workspace (Alex's: 6 projects, 8
  team members, 3 tasks, a profile, 4 notification settings; Sam's: 6 projects, 5 members, 3 tasks, a profile, 4
  settings; both on the Free plan; no checkouts). `POST /api/__reset` restores the seed and clears the Idempotency-Key
  cache (`204`); sessions survive it
  (a session of a user signed up after the seed no longer resolves). `GET /api/__config` answers
  `200 { "bugs": [...] }` (sorted ids, `[]` in clean mode).
- No request ever leaves the app's origin: fonts (Inter via `@fontsource-variable/inter`), icons and images are
  bundled or served from `public/`. No analytics, no CDN.

## Routes (all serve the SPA's `index.html` with `200`, client-side routing with React Router)

`/app`, `/app/settings`, `/app/help` and `/app/upgraded` need a session (see "Accounts"); the other four are public.

| Route | Page | Forms on the page (in DOM on load) | Notable controls outside forms |
|---|---|---|---|
| `/` | Marketing landing | Waitlist (hero), Newsletter (footer) | Theme toggle, "Book a demo" (opens a dialog with a form), pricing billing Switch, FAQ accordion, testimonial carousel prev/next |
| `/signup` | Create account (split screen with art) | Create account | "Continue with Google", password show/hide |
| `/login` | Sign in | Sign in | password show/hide, "Forgot password?" link, "Use the demo account" |
| `/onboarding` | 3-step wizard | Workspace (step 1 on load) | Back / Continue |
| `/app` (signed in) | Dashboard | Quick add task | Sidebar collapse, command palette (⌘K), notifications, user menu (with Sign out), "New project" (opens a sheet with a form), status tabs, table row actions |
| `/app/settings` (signed in) | Settings with tabs | Profile (Profile tab on load) | Tabs, notification Switches (auto-save) |
| `/app/help` (signed in) | Help & shortcuts | none | Keyboard shortcuts list, FAQ, "Contact support" text (the app shell's controls only) |
| `/app/upgraded` (signed in) | Your upgrade (the test checkout's success page) | none | "Back to billing" (the app shell's controls) |

Any other path: the SPA's `index.html` with **`404`** status and a "Page not found" view. (V05 breaks `/app/help` on
purpose, and only that route; see "V2 planted bugs".)

## Accounts (V2)

Two seeded accounts (`server/seed.mjs` `ACCOUNTS`), each with its own workspace, projects, tasks, members, profile and
notification settings. Nothing in one workspace names the other account. Account code lives in
`server/routes/auth.mjs` (server) and `src/lib/session.ts` (client).

| Account | Email | Password | Name | Workspace | Profile `role` / `plan` |
|---|---|---|---|---|---|
| Alex (the demo account; Run Hound's account A) | `alex@fernway.test` | `correct-horse-battery` | Alex Rivera | Rivera Studio | `member` / `free` |
| Sam (Run Hound's account B) | `sam@fernway.test` | `staple-lemon-orbit` | Sam Okafor | Okafor & Co | `member` / `free` |

- **Sessions**: signing in (or up) sets a new `fernway_session` cookie (same flags as the visitor cookie, below; a
  new id every time, so a visitor's id is never promoted). The server keeps session id -> user id in memory. A
  visitor's cookie (the one the first page load sets) signs nobody in.
- **`GET /api/me`** answers `200 { id, name, email, workspace }` for the session user (`workspace` is the workspace
  name), else `401 { error: "Sign in to continue" }`. Only the signed-in pages ask it (never a public page, so a
  signed-out visit to a public page makes no failing request). V03 never changes it.
- **Signed-in pages**: `/app`, `/app/settings`, `/app/help` and `/app/upgraded` render after `GET /api/me` answers `200` (a short
  "Opening your workspace…" status while it asks). Signed out, the SPA replaces the URL with `/login?next=<path>` (the
  path readable, e.g. `/login?next=/app/settings`; a query or hash in it is escaped, e.g.
  `/login?next=/app/settings%23billing`).
  The server still answers the document with `200` (only the SPA redirects). Signing in there lands on `<path>`.
- **The session user is shown from `GET /api/me`** (nothing about the session is kept in `localStorage`): the app
  shell reads "Signed in as <name> · <workspace>" (e.g. "Signed in as Alex Rivera · Rivera Studio"), the Settings
  and Help headers show the workspace name, the dashboard greets the first name.
- **Every workspace API** (`/api/projects`, `/api/tasks`, `/api/members`, `/api/users/:id/profile`,
  `/api/notifications`, every method) answers `401 { error: "Sign in to continue" }` without a session and only ever
  returns or changes the session user's own data. Another user's ids answer `404 { error: "Not found" }` (a profile,
  a project or a task, for reads and writes alike); another workspace's projects and members are not valid choices
  (`400` on `projectId` / `ownerId`). The billing API (see "Billing") needs a session too.
- **The profile** is loaded and saved by user id: `GET`/`PUT /api/users/:id/profile`, where the Settings page uses
  the id from `GET /api/me`. The stored record is `{ id, displayName, email, bio, timeZone, avatar, role, plan }`;
  `PUT` takes only `displayName`, `email`, `bio` and `timeZone` (the field allowlist): `role`, `plan`, `avatar`, `id`
  and any other key sent are ignored, while `GET` and `PUT` answer the whole record. The profile's `email` is a
  contact address: changing it does not change the sign-in email. (`/api/profile` no longer exists: `404`.) `plan`
  (`"free"` or `"pro"`) is the account's entitlement: both seeded accounts start on `"free"`, and only the billing API
  changes it (see "Billing"; V04 aside).
- **Sign-up** (`POST /api/signup`) creates a new user with an empty workspace (named after the company, else
  "<first name>'s workspace"; the user as its only member, role "Owner"; no projects or tasks; a profile from the
  sign-up fields, time zone `UTC`, no photo, `role: "member"`, `plan: "free"`) and signs them in.
  `POST /api/onboarding` signed in renames the session user's workspace to `workspaceName`.
- **Sign out**: the account menu's "Sign out" item (and the command palette's "Sign out") sends `POST /api/logout`
  (`204`; the session ends on the server and the response removes the cookie with `Max-Age=0`), shows a "You're signed
  out" toast, and the SPA goes to `/login?next=<page>`.
- **Demo sign-in**: `/login` has a "Use the demo account" button (outside the sign-in form) that signs in as Alex on
  the server (`POST /api/login/demo`), so people can try the app without a password. No page ever shows either
  password (Run Hound's tests grep run folders for them), and neither password nor Alex's email is in the client
  bundle. The passwords are only in `server/seed.mjs`, the tests and these docs.

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
- No console errors, page errors, failed requests or 4xx/5xx on load or on the golden path (for `/app`,
  `/app/settings` and `/app/help`: signed in. Signed out, their `GET /api/me` answers `401` and the page goes to
  `/login`).

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
  `POST /api/signup` → `201 { id, name, email }`, sets `fernway_session` (HttpOnly; SameSite=Lax; Path=/): a new user
  with an empty workspace, signed in (see "Accounts"); then client-side navigation to `/onboarding`. Same email twice
  (including a seeded account's) → `409` on the field. Password: 8+ chars.
- "Continue with Google" button (type button): shows a toast "Google sign-in isn't set up in this demo" and an inline
  `role="status"` note (so it visibly does something).
- Link "Already have an account? Sign in" (`/login`).

### `/login` Sign in

- **Sign in form**: `Email`, `Password` (show/hide), `Remember me` (Radix Checkbox), submit `Sign in`.
  `POST /api/login` with either account (or one made by sign-up) → `200 { id, name, email }`, sets the session
  cookie (`Max-Age` 30 days with Remember me), a "Welcome back, <first name>!" toast, then navigates to `?next=` (a
  same-origin path only) or `/app`. Wrong credentials → `401 { error: "Email or password is incorrect" }` shown in a
  `role="alert"` above the form (a 401 is the app working, not an error).
- "Forgot password?" link (to `/login#forgot`, shows a short note; no second form).
- Below the card: "New to Fernway? Create an account" (`/signup`) and a **"Use the demo account"** button
  (`type="button"`, outside the form): `POST /api/login/demo`, a "Welcome, Alex!" toast, then `?next=` or `/app`. A
  failure shows a "Couldn't open the demo account" alert and toast. The page never shows a password or an account's
  email.

### `/onboarding` Wizard

- A stepper (`<ol>` with `aria-current="step"`). Step 1 **Workspace form**: `Workspace name` (required), `Workspace
  URL` (prefix `fernway.app/`, slug; debounced `GET /api/slug-available?slug=` shows "Available"/"Taken" in a
  `role="status"`), `What will you use Fernway for?` (Radix RadioGroup of cards: Client projects, Internal work,
  Personal). `Continue` → step 2: `Invite teammates` (up to 3 email inputs, "Add another" / "Remove" buttons), `Skip`
  or `Continue` → step 3: review and `Finish setup` → `POST /api/onboarding` → success view with a link to `/app`.
- Back returns to the previous step with values kept. Each step is one `<form>`.

### `/app` Dashboard

- App shell: collapsible sidebar (collapse button "Collapse sidebar"/"Expand sidebar", `aria-expanded`), nav links
  (Dashboard, Projects, Settings, Help; the palette's "Go to" group has the same four), top bar with a search button
  "Search" (opens a cmdk command palette dialog; ⌘K / Ctrl+K), notifications button "Notifications" (Popover with 3
  items), user menu button "Account menu" (DropdownMenu: a label with the user's name and email, then Profile,
  Settings, Sign out). Every icon-only button has an accessible name. The sidebar footer reads "Signed in as <name> ·
  <workspace>" (from `GET /api/me`). The Notifications popover's 3 items are static demo content.
- Stat cards (4), an area chart (inline SVG, with a text summary for screen readers), a "Projects" table
  (`<table>`, caption) from `GET /api/projects` with status Tabs (All, Active, Paused, Done) that filter it, and a
  row actions DropdownMenu per row ("Actions for <project>": Open, Duplicate, Archive). Archive asks in an
  AlertDialog, then sends `PATCH /api/projects/:id { archived: true }` and removes the row (for good).
- **Quick add task form** (card "Quick add"): `Task` (required), `Project` (Radix Select of project names), submit
  `Add task`. Adding is two requests: `POST /api/tasks { title, projectId }` → `201` creates the task, then
  `PATCH /api/tasks/<new id> { title, projectId, done }` saves the whole task (the one update call every task change
  uses, so the app itself shows the update request for the new record); the task appears in the "Today" list under
  the form (and after reload). The Today list (outside the form) has a checkbox per task that sends
  `PATCH /api/tasks/:id { title, projectId, done }` with the new `done`.
- "New project" button opens a Radix Dialog rendered as a right-side sheet with the **New project form**: `Project
  name` (required), `Description` (textarea), `Status` (Select: Active, Paused, Done), `Priority` (RadioGroup: Low,
  Medium, High), `Owner` (Combobox: Popover + cmdk list of the 8 members, filterable), `Due date` (date input),
  `Budget` (Radix Slider 0–50,000 step 500 with the value shown), `Notify the team` (Switch), submit `Create
  project`. `POST /api/projects` → `201`, closes the sheet, toast, the row appears in the table (and after reload).
  The Owner list is the workspace's members (8 for Alex) and starts on the signed-in user.

### `/app/settings` Settings

- Radix Tabs: Profile, Notifications, Billing (Profile selected on load).
- **Profile form**: the profile photo (`images.avatars[profile.avatar]`, e.g. "Portrait of Alex Rivera"; initials
  when the profile has none, as for Sam), `Display name`, `Email`, `Bio` (textarea, 160 chars with a live counter),
  `Time zone` (Select), submit `Save changes`. `PUT /api/users/<me.id>/profile` with exactly those 4 fields → `200`;
  shown values come from `GET /api/users/<me.id>/profile` (survive a reload); `<me.id>` is `GET /api/me`'s `id`.
- Notifications tab: 4 Switches loaded from `GET /api/notifications`, each saving on toggle
  (`PATCH /api/notifications`) with a toast.
- Billing tab (mounted, hidden until chosen, like every panel): first the **account's plan** card (`plan` from
  `GET /api/users/<me.id>/profile`): on Free, "Free plan" with an **"Upgrade to Pro"** button (starts the local test
  checkout, see "Billing"; its name is on Run Hound's never-click list) and a link **"Already paid? Refresh your
  plan"** to `/app/upgraded` (in the page on load, so Run Hound's `paywall-trust` finds the success route); on Pro,
  "Pro plan" with **"Switch back to Free"** (`POST /api/billing/cancel`). Then the workspace's Studio plan card
  (client-side, as before): "Change plan" (link to `/#pricing`), "Cancel subscription" (opens a Radix AlertDialog;
  destructive, so Run Hound must not click it by default).

### `/app/help` Help & shortcuts

- The app shell (the sidebar's "Help" link is the current page), the workspace name over the `<h1>` "Help &
  shortcuts", and three sections, each a region named by its `<h2>`:
  - **Keyboard shortcuts**: a `<dl>` of at least 5 actions (`<dt>`) with their keys in `<kbd>` (`<dd>`), among them
    "Open search and commands" (`Ctrl` + `K`, "⌘ K on a Mac") and "Close a dialog, menu or popover" (`Esc`). Every
    shortcut listed works.
  - **Frequently asked questions**: at least 3 questions (`<h3>`), each with its answer.
  - **Contact support**: plain text naming `support@fernway.test` and the signed-in workspace; no `mailto:` link.
- No form and no text field. The page asks the server only `GET /api/me` (plus `/api/__config`); no workspace API.

### `/app/upgraded` Your upgrade

- The success page of the local test checkout: the app shell, the workspace name over the `<h1>` "Your upgrade"
  (`<title>` "Fernway: Upgrade"). No form.
- On load it sends `POST /api/billing/confirm { checkout }` once, with the `?checkout=` id (`null` without one), and
  shows the answer in a card: "Pro is active" when `confirmed`, else "No payment to confirm" and the current plan
  (`role="status"`), plus a "Back to billing" link to `/app/settings#billing`. The answer is `200` either way, so a
  visit by hand makes no failing request.
- The page itself grants nothing: the server decides (see "Billing"). V09 breaks that on the server.

## API

JSON in and out; unknown keys ignored; malformed JSON → `400 { errors: { body: "..." } }`; validation errors →
`400 { errors: { <field>: <message> } }`; any other `/api/*` → `404 { error: "Not found" }`; a server failure →
`500 { error: "Something went wrong" }` with no stack traces, paths or `node:internal` in any body. The name
`Crash` in any name field (after trim) makes that create request fail with `500` (a deterministic error path for
tests); so does renaming a task to `Crash`. A write from another site answers `403`, and a task write that isn't JSON
`415` (see "Cross-site requests"). "Workspace" below means the session user's own workspace: without a session those endpoints answer
`401 { error: "Sign in to continue" }`, and another user's ids answer `404` (see "Accounts").

| Method and path | Body keys | Success |
|---|---|---|
| `POST /api/waitlist` | `email`, `teamSize` | `201 { id, email, teamSize, position }`; the same email again `409` |
| `POST /api/demo-requests` | `name`, `email`, `companySize`, `date`, `message`, `consent` | `201`; the server accepts a `date` from yesterday in UTC on (the page's minimum is the visitor's local today, which can be a day behind UTC) |
| `POST /api/newsletter` | `email` | `201 { id, createdAt }`, never echoing the address; the same address again answers `201` with the **first** subscription's id (it does not reveal who is subscribed) |
| `POST /api/signup` | `name`, `email`, `password`, `company`, `terms` | `201 { id, name, email }` + session (password never echoed or stored in plain text) |
| `POST /api/login` | `email`, `password`, `remember` | `200 { id, name, email }` + session / `401` |
| `POST /api/login/demo` | | `200 { id, name, email }` + session (as Alex) |
| `POST /api/logout` | | `204`, session ended, cookie removed (works signed out) |
| `GET /api/me` | | `200 { id, name, email, workspace }` / `401` |
| `GET /api/slug-available?slug=` | | `200 { slug, available }` |
| `POST /api/onboarding` | `workspaceName`, `slug`, `useCase`, `invites[]` | `201` (public; signed in, it also renames the workspace) |
| `GET /api/projects`, `POST /api/projects` (workspace) | `name`, `description`, `status`, `priority`, `ownerId`, `dueDate`, `budget`, `notify` | `200` list (archived left out) / `201`; `dueDate` from yesterday in UTC on |
| `PATCH /api/projects/:id` (workspace) | `archived` (boolean, required) | `200` the project; other keys ignored |
| `GET /api/members` (workspace) | | `200` list |
| `GET /api/tasks`, `POST /api/tasks` (workspace) | `title`, `projectId` | `200` list / `201` |
| `PATCH /api/tasks/:id` (workspace) | `title`, `projectId`, `done` (boolean): any of them, at least one (none → `400` on `done`); the project must be one of the task's own workspace | `200` the task |
| `GET /api/users/:id/profile`, `PUT /api/users/:id/profile` (workspace, own id only) | `displayName`, `email`, `bio`, `timeZone` (nothing else is taken) | `200` the record `{ id, displayName, email, bio, timeZone, avatar, role, plan }` |
| `GET /api/notifications`, `PATCH /api/notifications` (workspace) | `{ <key>: boolean }` for `productUpdates`, `weeklyDigest`, `mentions`, `taskReminders` | `200` all 4 settings |
| `POST /api/billing/checkout` (session) | `plan` (`"pro"`) | `201 { id, plan, amount, currency, status }` (see "Billing") |
| `POST /api/billing/checkout/:id/pay` (session, own checkout) | | `200` the checkout, `status: "paid"` |
| `POST /api/billing/confirm` (session) | `checkout` (an id or `null`) | `200 { confirmed, plan }` |
| `POST /api/billing/cancel` (session) | | `200 { plan: "free" }` |

Save requests that repeat an `Idempotency-Key` with the same body, from the same session, answer the first response
again (no second record; the replay carries `Idempotent-Replayed: true`), also while the first is still running. The
same key with a different body is a new request. The replay cache is keyed per session (the `fernway_session` cookie
and the user it signs in), so a key never replays one caller's answer to another: not to another user, another
visitor, another session of the same user, or the same cookie after it was signed out (a sign-up's answer carries its
new session cookie). Requests without any session cookie share one anonymous slot. Server failures (5xx) are not
cached. `POST /api/login`, `/api/login/demo` and `/api/logout` are never replayed.

## Billing (the plan and the local test checkout)

The account's plan is `plan` on its profile record: `"free"` (both seeded accounts, and every sign-up) or `"pro"`. It
is kept on the server only; no page or client value decides it. Upgrading needs no payment provider: Fernway fakes
one locally, so nothing leaves the app and nothing is charged. Code: `server/routes/billing.mjs`,
`src/pages/app/settings/ProPlanCard.tsx`, `src/pages/Upgraded.tsx`.

1. **"Upgrade to Pro"** → `POST /api/billing/checkout { plan: "pro" }` → `201 { id: "chk_<uuid>", plan, amount: 1200,
   currency: "usd", status: "open" }`. The server sets the price: an `amount`, `price` or `currency` in the body is
   ignored; another plan answers `400`.
2. A "Test checkout" dialog shows "Fernway Pro, monthly $12.00" and **"Pay $12.00"** →
   `POST /api/billing/checkout/:id/pay` → `200` (status `"paid"`). This endpoint stands in for the payment provider: it
   is the only thing that records a payment. Another user's checkout id answers `404`.
3. The SPA opens `/app/upgraded?checkout=<id>`, which sends `POST /api/billing/confirm { checkout }` →
   `200 { confirmed, plan }`. The plan is granted only for a checkout of the session user that the server recorded as
   paid, and only once (the checkout becomes `"fulfilled"`; confirming it again answers `confirmed: true` and grants
   nothing new, also after a switch back to Free). No checkout, an unknown or unpaid one, or another user's paid one
   answer `{ confirmed: false, plan }` and change nothing.
4. **"Switch back to Free"** → `POST /api/billing/cancel` → `200 { plan: "free" }`, straight away.

Every billing endpoint needs a signed-in session (`401` without one; V03 does not apply to them).

## Cross-site requests (clean mode)

A page on another site can't make a signed-in browser change anything:

- The session cookie is `SameSite=Lax`, so a browser leaves it out of another site's POST.
- **Origin check**: every write (`POST`/`PUT`/`PATCH`/`DELETE` to an existing `/api/*` route) whose `Origin` header
  names another origin than the `Host` it was sent to (`Origin: null` included), or, without an `Origin`, whose
  `Sec-Fetch-Site` is `cross-site`, answers `403 { error: "This request came from another site, so Fernway refused
  it." }` before the route runs. A request without either header (curl, a server, Run Hound's own API replays) is
  not a browser's cross-site request and is let through (the session rules still apply). Reads are never checked.
  An unknown route still answers `404`.
- **The task writes take JSON only**: `POST /api/tasks` and `PATCH /api/tasks/:id` with a non-empty body whose
  `Content-Type` isn't `application/json` answer `415 { errors: { body } }`, so the no-preflight bodies a cross-site
  page can send (form-encoded, `text/plain`) are refused even from the app's own origin. (Every other endpoint still
  parses its body as JSON whatever the `Content-Type`, as before.)

V08 removes the last two for the task writes and sends the cookie cross-site (see "V2 planted bugs").

## Response headers, cookies and source maps (clean mode)

- Every response: `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
  img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self';
  frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`.
- The first page load sets `fernway_session=<uuid>; Path=/; HttpOnly; SameSite=Lax` (a visitor's session: signed
  out). Signing in or up sets a new one with the same flags (plus `Max-Age=2592000` with Remember me);
  `POST /api/logout` answers `fernway_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`. W09 drops `HttpOnly`
  from all of them; V08 turns `SameSite=Lax` into `SameSite=None; Secure` in all of them (on a loopback host).
- No CORS headers on the API. Source maps are built hidden and `*.map` answers `404`.

## Planted bugs (`FERNWAY_BUGS`)

Each is typical of AI-built apps and is caught by one existing Run Hound check on the page named. `bugs.json` is the
ground truth, and `tests/acceptance/src/fernway.acceptance.test.ts` asserts that each bug's `detectedBy` check reports
a confirmed finding on its page (pages under `/app` run signed in as Alex).

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

## V2 planted bugs (`FERNWAY_BUGS`, docs/v2-spec.md "Fernway V2" and "Fernway (0.5.0 planned bugs)")

Caught by the V2 checks with Run Hound signed in as Alex (account A) and Sam as account B (`isolated: true`): V01-V05
by the 0.4.0 checks, V06-V09 by the 0.5.0 write-side checks (`write-access`, `csrf`, `paywall-trust`), which write
only to the test record they create and re-read it as Alex.

| Id | Bug | Caught by (page) |
|---|---|---|
| V01 | `GET /api/users/:id/profile` returns any user's profile to any signed-in user (no ownership check) | `access-control:other-account` (`/app/settings`) |
| V02 | `GET /api/tasks` returns every user's tasks | `access-control:other-account` (`/app`) |
| V03 | The workspace APIs answer without a session (only the SPA redirects) | `access-control:signed-out` (`/app`, `/app/settings`) |
| V04 | `PUT /api/users/:id/profile` stores any key it is sent, including `role` and `plan` | `mass-assignment` (`/app/settings`) |
| V05 | Opening `/app/help` directly answers `404` (no SPA fallback for that path) | `deep-links` (`/app`) |
| V06 | `PATCH /api/tasks/:id` updates another user's task | `write-access:other-account` (`/app`) |
| V07 | Writes to `/api/tasks/:id` work without a session | `write-access:signed-out` (`/app`) |
| V08 | Session cookie set `SameSite=None; Secure` (Chromium accepts Secure on `http://localhost` and `http://127.0.0.1`), and the task save accepts a form-encoded body with no CSRF token or Origin check | `csrf` (`/app`) |
| V09 | `/app/upgraded` sets `plan: "pro"` on load (a fake local checkout, no provider) | `paywall-trust` (`/app/settings`) |

Details (each changes only what it names):

- **V01**: the profile `GET` skips the ownership check for any existing user id (an unknown id is still `404`); `PUT`
  stays owner-only, and signed out it is still `401`.
- **V02**: `GET /api/tasks` answers the tasks of every workspace (a task Alex adds shows up for Sam); `PATCH` of
  another user's task is still `404`.
- **V03**: without a signed-in session, every workspace endpoint acts as Alex (reads and writes). `GET /api/me` stays
  honest (`401`), so the SPA still sends signed-out visitors to `/login`; a signed-in user still only sees their own.
- **V04**: after validating the 4 fields, every other key in the body except `id` is stored on the profile record
  (`role`, `plan`, `isAdmin`, `credits`, ...) and `GET` returns it; sending the old values back restores them.
- **V05**: a direct `GET` of `/app/help` (with or without a trailing slash) answers `404` with a bare HTML page
  (`<title>404 Not Found</title>`, `<h1>Not Found</h1>`), like a static host with no fallback to `index.html`. Every
  other route still serves the SPA (so `/app/settings`, which carries W04, V01 and V04, and `/onboarding` load
  directly with `FERNWAY_BUGS=all`), and in-app navigation (the sidebar's "Help" link, the palette's "Go to Help")
  still renders the page. `/app` links to it from the sidebar, which is where `deep-links` finds it.

- **V06**: `PATCH /api/tasks/:id` from any signed-in user finds the task in whichever workspace holds it and updates it
  (the project is checked against that task's own workspace, so the whole task the client sends is accepted). Reads
  stay scoped (Sam's `GET /api/tasks` never lists Alex's task), and without a session the write is still `401`.
- **V07**: `PATCH /api/tasks/:id` without a signed-in session (no cookie, or a visitor's) updates any user's task by id.
  A signed-in user still only writes their own (`404` for another's), and every other endpoint, reads and
  `POST /api/tasks` included, still needs a session.
- **V08**: the session cookie (the visitor's, the sign-in's and the sign-out's) is `SameSite=None; Secure` when the
  request's `Host` is a loopback name (`localhost`, `*.localhost`, `127.x.x.x`, `[::1]`); on any other host name it
  stays `SameSite=Lax`, since a browser drops a `Secure` cookie sent over plain http there, which would break sign-in.
  The task writes (`POST /api/tasks`, `PATCH /api/tasks/:id`) skip the Origin check and take a form-encoded body
  (`title=…&projectId=…`; `true`/`false` become booleans) or JSON sent as `text/plain`. So a plain HTML form on
  another site, in Alex's browser, creates a task in Alex's workspace (Run Hound's `csrf` check forges the Quick add
  save that way; `GET /api/tasks` as Alex then holds the forged title). Every other write keeps the Origin check.
- **V09**: `POST /api/billing/confirm` grants `"pro"` to whoever calls it, with no checkout and no payment: the server
  trusts the success page, so opening `/app/upgraded` (linked from the Billing tab) as Alex makes Alex Pro. The
  profile's `plan` shows it (`GET /api/users/<id>/profile`, the entitlement Run Hound re-reads). "Switch back to Free"
  (`POST /api/billing/cancel`) or `POST /api/__reset` undoes it; the profile `PUT` still never takes `plan` (V04's
  business). With `FERNWAY_BUGS=all`, any check that opens `/app/upgraded` (deep-links follows the Billing tab's link)
  moves Alex to Pro.

Clean mode fixes each properly (ownership checks, session checks, a field allowlist, the SPA fallback, ownership and
session checks on writes, the Origin check with JSON-only task writes and the `SameSite=Lax` cookie, and a plan granted
only for a payment the server recorded), so the clean runs exercise the same flows.

## Images

`src/lib/images.ts` is the only place image URLs are named (`images.heroArt`, `images.authArt`,
`images.features[3]`, `images.avatars[8]`, `images.onboarding`, `images.emptyState`). Files live in
`public/images/` (WebP, each under 150 KB). They are generated locally (see `public/images/README.md` for the model,
its license and the prompts) or drawn as SVG; either way they ship in the repo and are served by Fernway itself.
