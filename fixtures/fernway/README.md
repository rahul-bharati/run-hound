# Fernway

Fernway ("project planning for small studios") is a small, fictional SaaS app that Run Hound is tested against. It is
built the way AI app builders such as Lovable, Bolt and v0 build apps today: Vite, React 19, TypeScript, Tailwind CSS
v4, shadcn/ui-style components on Radix primitives, lucide icons, sonner toasts, react-hook-form with zod, and React
Router. It has a marketing page, sign-up and sign-in, an onboarding wizard, a dashboard and settings, in light and dark
mode.

## Why it exists

[Kennel](../kennel/CONTRACT.md) is one plain form with planted bugs. Fernway answers a different question: **does Run
Hound work on the kind of app people actually generate?** That means custom selects and comboboxes, switches,
checkboxes and radio cards that are buttons rather than native inputs, forms inside dialogs and sheets, toasts,
client-side routing, animations and dark mode.

- **Clean mode (the default) is well built on purpose.** It is accessible (labels, AA contrast in both themes, visible
  focus, 24 px targets, 320 px reflow), validates on the server, disables its buttons while saving and de-duplicates
  saves by `Idempotency-Key`. **Any confirmed finding Run Hound reports on clean Fernway is either a real defect in
  Fernway or a Run Hound false positive.** Triage every one, and never change Fernway just to hide a Run Hound mistake.
- **Bug mode** (`FERNWAY_BUGS`) plants the bugs AI-built apps typically ship with, one per id. Each one is caught by
  one existing Run Hound check (table below).

[CONTRACT.md](CONTRACT.md) is the full contract: routes, labels, texts, the API, response headers and every bug. The
names in it are load-bearing: Fernway's tests and Run Hound's acceptance suite rely on them.

## Pages

| Route | Page | Forms on load | Also on the page | Run Hound target (local / compose) |
|---|---|---|---|---|
| `/` | Marketing landing | Waitlist (hero), Newsletter (footer) | "Book a demo" dialog with a form, pricing Switch, FAQ accordion, testimonial carousel, theme toggle | `http://localhost:4110/` / `http://fernway:4110/` |
| `/signup` | Create account | Create account | "Continue with Google", password show/hide | `http://localhost:4110/signup` / `http://fernway:4110/signup` |
| `/login` | Sign in | Sign in | password show/hide, "Forgot password?" | `http://localhost:4110/login` / `http://fernway:4110/login` |
| `/onboarding` | 3-step wizard | Workspace (step 1) | Back / Continue, slug availability check | `http://localhost:4110/onboarding` / `http://fernway:4110/onboarding` |
| `/app` | Dashboard | Quick add task | "New project" sheet with a form, command palette (Ctrl+K), sidebar, status tabs, row menus | `http://localhost:4110/app` / `http://fernway:4110/app` |
| `/app/settings` | Settings | Profile | Notifications tab (auto-saving Switches), Billing tab | `http://localhost:4110/app/settings` / `http://fernway:4110/app/settings` |

Any other path answers `404` with a "Page not found" view. `/app` and `/app/settings` work without signing in, as a demo
workspace. The one account is `alex@fernway.test` / `correct-horse-battery`. Data lives in memory and is seeded on
start; `POST /api/__reset` restores the seed.

## Start it

From the repository root:

```sh
pnpm install
pnpm --filter fernway build                           # vite build -> fixtures/fernway/dist
PORT=4110 pnpm --filter fernway start                 # clean mode: http://localhost:4110/
FERNWAY_BUGS=all PORT=4111 pnpm --filter fernway start   # every planted bug
```

The server (`server/index.mjs`) uses Node built-ins only. It reads `PORT` (default `4110`), `HOST` (default: all
interfaces) and `FERNWAY_BUGS`, and prints `fernway listening` once it accepts connections.

With Docker or Podman, from the repository root:

```sh
docker build -f fixtures/fernway/Dockerfile -t ghcr.io/rahul-bharati/run-hound-fernway:0.4.0 .
docker run --rm -p 127.0.0.1:4110:4110 ghcr.io/rahul-bharati/run-hound-fernway:0.4.0                       # clean
docker run --rm -p 127.0.0.1:4111:4110 -e FERNWAY_BUGS=all ghcr.io/rahul-bharati/run-hound-fernway:0.4.0   # bugs
```

Both compose files at the repository root start it next to Run Hound as two services: `fernway` (clean,
`http://fernway:4110/`, published on `127.0.0.1:${FERNWAY_HOST_PORT:-4110}`) and `fernway-bugs` (`FERNWAY_BUGS`,
default `all`, `http://fernway-bugs:4110/`, published on `127.0.0.1:${FERNWAY_BUGS_HOST_PORT:-4111}`).

Fernway is a local test target only: do not expose it to the internet.

## Run Hound against it

```sh
PORT=4110 pnpm --filter fernway start &
cd app && pnpm exec tsx src/cli.ts run http://localhost:4110/app --approve all --runs-dir /tmp/rh-runs
```

## Planted bugs

`FERNWAY_BUGS` is `none` (default), `all`, or a comma list such as `W01,W06` (case-insensitive; an unknown id stops
the server with an error naming the known ids). `GET /api/__config` answers the active ids. One build serves every
mode. [bugs.json](bugs.json) is the ground truth.

| Id | Page | Bug | Caught by |
|---|---|---|---|
| W01 | `/` | The waitlist "Team size" Select trigger has no accessible name (label not associated) | `axe-states` |
| W02 | `/` | Newsletter: a failed save is swallowed (`catch {}`), nothing is shown | `silent-failure` |
| W03 | `/app` | Quick add: "Add task" never disables and the server ignores the Idempotency-Key, so a double click adds 2 | `double-submit` |
| W04 | `/app/settings` | Profile: Bio shows as saved (toast) but the client drops it before sending | `persistence` |
| W05 | `/app` | Icon-only buttons (sidebar collapse, notifications) have no accessible name | `axe-states` |
| W06 | every page | A Stripe-style live secret key (`sk_live_…`, fake) is in the JS bundle | `bundle-secrets` |
| W07 | `/signup` | Focus ring removed (`outline-none`, no ring) on the inputs | `focus-visible` |
| W08 | every page | No security headers (no CSP, no clickjacking protection, no nosniff) | `security-headers` |
| W09 | every page | `fernway_session` set without HttpOnly | `cookie-flags` |
| W10 | `/login` | Sign-in errors are shown in red text only (no `role="alert"`, not linked to the fields) | `error-announcement` |

A bug id never changes the clean-mode behaviour of anything else.

## Tests

```sh
pnpm --filter fernway test          # builds dist/ once, then the API, every page (Playwright + axe) and every bug
pnpm --filter fernway typecheck
```

`FERNWAY_SKIP_BUILD=1` reuses an existing `dist/`. The acceptance suite runs Run Hound itself against Fernway: every
route in clean mode (zero confirmed findings, every form discovered) and each bug on its page.

```sh
cd tests/acceptance
pnpm exec vitest run src/fernway.acceptance.test.ts
ACCEPTANCE_FERNWAY=/app,W03 KEEP_RUNS=1 pnpm exec vitest run src/fernway.acceptance.test.ts   # a subset, keep reports
```

## Images

Every image in `public/images/` was generated locally with an Apache-2.0 model, or drawn as SVG, and ships in the repo;
Fernway never requests anything from another origin. The portraits are of fictional people. Model, settings, seeds
and prompts: [public/images/README.md](public/images/README.md). `src/lib/images.ts` is the only place image URLs and
their alt text are named.
