# Trying Run Hound 0.5.0 (V2 preview)

Thanks for trying Run Hound. The repository is public and open source: anyone can try it (no clone needed with Docker), read the code and file issues. Run Hound is AI-assisted UI testing for AI-built apps: AI plans and explains, real checks decide. This preview ships the real checks; 0.4.0 adds signed-in runs with two test accounts and the first access checks, and handles the widgets and dialogs AI app builders generate; 0.5.0 adds the CSRF check (can another website change your data). Since 0.3.0 you can add your own model to review the plan, suggest extra flows and explain findings (optional, off by default). This guide covers what Run Hound does, how to run it on Kennel (the demo app) and then on your own app, signed-in runs, how to read the report, and what to send back.

**Contents:** [Who this is for](#who-this-is-for) · [What it does](#what-it-does-and-doesnt-do) · [Requirements](#requirements) · [Install](#install) · [Try it on Kennel first](#try-it-on-kennel-first-10-minutes) · [Test your own app](#test-your-own-app) · [Signed-in runs and access checks](#signed-in-runs-and-access-checks-v2-preview) · [Trying the AI features](#trying-the-ai-features) · [Reading the report](#reading-the-report) · [Known limitations](#known-limitations) · [Sending feedback](#sending-feedback)

## Who this is for

Developers who have a web app running on their own machine (a page with forms, buttons, an API behind it: sign-up, contact, booking, settings, a dashboard behind a sign-in) and who can spare 30 minutes. For the access checks you also need two test accounts on your app. You don't need to know Playwright or accessibility rules; the report explains each finding in plain language.

What we most want to learn: **is every finding real, and did it miss a bug you know about?** A wrong finding costs you time, so we treat each false positive as a bug in Run Hound.

## What it does and doesn't do

**It does:** open one page of your local app in a headless Chromium, find the forms on it (up to 5, the one with the most fields first, including forms in dialogs and sheets) and the buttons outside them, plan the form checks for each form plus the page-wide checks (usually 15 to 20 scenarios for a page with one form), let you pick which ones to run, run them, and write a report with evidence (annotated screenshots, short GIFs, request and response cards) and a Playwright test for each finding.

**New in 0.5.0:**

- **`csrf`** (signed in, unticked by default): can a page on another site make A's browser change A's data? It writes only the test record Run Hound just created as A, judges from a re-read as A, and puts back what it changed. See [The CSRF check](#the-csrf-check-050). `write-access` and `paywall-trust`, planned for 0.5.0 too, are not in this release.

**New in 0.4.0:**

- **Signed-in runs**: save two test accounts you own (A and B), and Run Hound signs in before it tests, so pages behind your sign-in can be tested. Three checks join the plan: `access-control` (can account B, or a visitor who isn't signed in, read account A's data?), `mass-assignment` (does the server accept `role` or `plan` fields the form never sends?) and `deep-links` (do the app's pages load when opened directly?). See [Signed-in runs and access checks](#signed-in-runs-and-access-checks-v2-preview).
- **Apps built by AI app builders**: Radix/shadcn, Headless UI, cmdk and MUI selects, comboboxes, checkboxes, switches, radio groups and sliders are filled like a person fills them; forms in dialogs and sheets are found (up to 3 opener buttons per page); forms validated only by their schema (react-hook-form with zod) are handled; multi-step forms are tested on their first step; toasts count as messages.

**Since 0.2.0 (V1, single page):** every form on the page instead of only the main one; buttons outside the forms; and page-wide checks for security headers, session cookie flags, CORS and public source maps. A page without a form gets the page-wide checks instead of an error.

**It doesn't:**

- follow links to other pages (one page per run: `deep-links` opens the page's own links to see that they load, but doesn't test those pages; whole features across pages are planned);
- sign in with verification codes, captchas, "Sign in with Google/GitHub", or a sign-in split over two pages (see [what sign-in can't do](#what-sign-in-cant-do));
- test rate limits or file uploads (planned), or `csrf` on a host name other than `localhost` or `127.0.0.1` (inconclusive there);
- test public websites: only your own machine and private network addresses (see [Safety rules](#safety-rules));
- use AI unless you turn it on: with AI off (the default) the plan comes from the built-in checks below, the explanations are written for each check, and nothing is sent to any AI provider. With AI on (see [Trying the AI features](#trying-the-ai-features)) your model reviews the plan, suggests flows and explains findings, but every pass or fail still comes from a real check in a real browser;
- delete the test records it creates (see [Test records](#test-records-it-creates)).

### The checks

| Check | What it does, in plain words | Creates test records |
|---|---|---|
| `console-network-errors` | Fills and sends the form with valid values and flags console errors and failed requests. | 1 |
| `dead-control` | Clicks every button except submit and flags buttons that do nothing at all. Buttons that look destructive ("Delete", "Remove") are left out unless you allow destructive scenarios. | 0, unless a button saves something (a draft) |
| `silent-failure` | Sends the form while Run Hound pretends the server failed (the request never reaches your server) and checks an error is shown, announced to screen readers, and your input is kept. | 0 |
| `persistence` | Sends unique values, reloads the page and checks they are still shown. | 1 |
| `double-submit` | Double-clicks submit and counts how many save requests reach the server. | up to 2 |
| `axe-states` | Runs the axe-core WCAG 2.2 AA rules on the form empty, after an empty submit, after a server error and after a successful send. | 2 |
| `keyboard-completion` | Fills and sends the form with only the keyboard (Tab, arrows, Space, Enter, typing). | 1 |
| `focus-visible` | Tabs through the page and checks every focused control shows a visible focus indicator. | 0 |
| `error-announcement` | Sends the form empty and checks each field the form refuses is marked invalid with a message screen readers announce (the empty submit is answered by Run Hound, so nothing is saved). | 0 |
| `credential-fields` | Pastes into password fields (nothing is sent) and checks paste works and autocomplete hints are set. | 0 |
| `bundle-secrets` | Searches every script the page loads for secret keys (publishable keys are fine). | 0 |
| `pii-leak` | Sends a test email and phone number and checks no request to another site carries them (or their hashes). | 1 |
| `verbose-errors` | Sends far too much text and a broken request body and looks for stack traces, file paths or error dumps. | up to 2, if your server accepts them |
| `reflow-320` | Opens the page 320 px wide (a small phone, or 400% zoom) and checks it doesn't scroll sideways. | 0 |
| `client-only-validation` | Captures the save request, then sends it straight to the server with one field invalid and checks the server rejects it. Localhost targets only; skipped otherwise, with a reason. | up to 1, if the server accepts it |
| `page-controls` (V1) | Clicks every button outside the forms (toolbars, list actions, toggles, `href="#"` links), each on a freshly loaded page, and flags the ones that do nothing. Destructive-looking ones are left out unless you allow them. | 0, unless a button saves something |
| `security-headers` (V1) | Reads the page's response headers: Content-Security-Policy, clickjacking protection (`frame-ancestors` or `X-Frame-Options`), `X-Content-Type-Options: nosniff`, a leaky `Referrer-Policy`, and on https `Strict-Transport-Security`. | 0 |
| `cookie-flags` (V1) | Reads the cookies the page sets; session-like cookies must be `HttpOnly`, not `SameSite=None`, and on https `Secure`. Values are never shown. | 0 |
| `cors` (V1) | Repeats up to 5 of the page's own GET requests from a sandboxed frame (`Origin: null`, which any website can produce) and flags answers other websites may read, especially with the visitor's cookies. | 0 |
| `source-maps` (V1) | Looks for public source maps of the page's own scripts (header, `sourceMappingURL` comment, or `<script>.map`) and flags maps anyone can download, especially with the original source code. Skipped on a dev server. | 0 |
| `ai-flow` (0.3.0, AI on) | Runs a flow your model suggested, built only from the fields and buttons Run Hound found, and checks its expectations (a save succeeds, text shown, no errors) in the browser. Unticked by default; its findings are advisory. | depends on the flow |
| `access-control` (0.4.0, signed in) | As account A, saves a test record (or finds responses naming A), then replays the read requests that returned A's data as account B and with no session. Any of A's data coming back is a finding. Read-only replays. | up to 1 per scenario, in account A |
| `mass-assignment` (0.4.0, signed in) | Saves the form as A, sends the same save with `role: "admin"`, `plan: "pro"`, `isAdmin: true` and similar fields added, reads the record back, then restores the original values. Unticked by default. | up to 2, in account A (a save that creates a record makes a second one; one it changes is restored) |
| `deep-links` (0.4.0) | Opens up to 10 of the page's own links directly, as a reload or a shared link would, and flags pages that answer with an error or a "not found" view. Never opens a link that acts (sign out, delete, unsubscribe). | 0 |
| `csrf` (0.5.0, signed in) | Saves a test record as A, then sends the same save with a new value from a page on another site (`127.0.0.1` for a `localhost` app, and the other way round) in A's own browser, and re-reads it as A. A stored forged value is a finding. Inconclusive on any other host name. Unticked by default. | up to 2, in account A (the forged save can create one) |

The checks are grouped as **Accessibility** (`axe-states`, `keyboard-completion`, `focus-visible`, `error-announcement`, `credential-fields`, `reflow-320`), **Features** (`console-network-errors`, `dead-control`, `silent-failure`, `persistence`, `double-submit`, `client-only-validation`, `page-controls`, `ai-flow`, `deep-links`) and **Security** (`bundle-secrets`, `pii-leak`, `verbose-errors`, `security-headers`, `cookie-flags`, `cors`, `source-maps`, `access-control`, `mass-assignment`, `csrf`). The plan, the run, the progress and the report all follow that order.

Form checks (and `mass-assignment` and `csrf`) run once per form; on a page with several forms their scenarios are named after the form ("… (Newsletter form)"). `page-controls`, `security-headers`, `cookie-flags`, `cors`, `source-maps`, `bundle-secrets`, `focus-visible`, `reflow-320`, `access-control` and `deep-links` run once for the whole page. A search form gets only the checks that make sense for it (it saves nothing), and a form that never shows what it saved (a newsletter signup) has its `persistence` scenario skipped with that reason rather than reported as lost data. Buttons that sign you out, cancel a subscription or empty a cart are never clicked unless you allow destructive scenarios (and never while signed in).

**Dev servers:** a dev server (Vite, Next.js dev, webpack dev server, …) doesn't send the headers, cookie flags and CORS settings of your production build, so on a dev server those findings are marked advisory and `source-maps` is skipped. Check them again on a production build (`vite preview`, `next start`).

Scenarios that don't apply to your page (no password field, no JSON save request, not signed in) are **skipped with a plain reason**, never silently dropped. Each scenario's description in the plan says whether it creates records.

### Test records it creates

A full run sends the form successfully several times (about 7 or 8 save requests), so it can create that many records in your app: bookings, sign-ups, messages. The values are obviously fake (emails at `example.test`, a run token in the text). The report and the command line say how many save requests your app accepted. Signed in, the records belong to account A, and `mass-assignment` changes one of A's records and then puts the old values back (its notes say anything it couldn't restore). **Run Hound never deletes them. Point it at a development database you can throw away.**

Scenarios that could change or delete existing data (clicking a "Delete" button, for example) are off unless you pass `--allow-destructive` or tick the option in the UI.

### Confirmed and advisory findings

- **Confirmed**: decided by a real check with evidence (a request was sent twice, axe found a rule violation, a value was missing after reload, account B got account A's record back). These should always be right. If one is wrong, please report it.
- **Advisory**: relies on judgement (for example a missing `autocomplete` hint), or on production settings a dev server doesn't have (headers, cookies, CORS on a dev server). Worth a look, not a failure.

The command line exits with **0** when there are no confirmed findings (advisory ones don't fail the run), **1** when there is at least one confirmed finding, and **2** on an error: a refused or unreachable target, an error page (such as a 404), a page with nothing to test, a bad option, `--ai` when AI can't be used, or `--as` with an account that isn't set up or can't sign in. It also exits **2** when **nothing was tested**: every approved scenario errored or was skipped (the report says why).

When the same problem affects several elements (no visible focus on 6 controls), you get one finding that lists every place, not six findings.

### Safety rules

- Run Hound only tests `localhost`, loopback, private network addresses (10.x, 172.16-31.x, 192.168.x, `fc00::/7`, link-local) and host names listed in `RUNHOUND_ALLOWED_HOSTS`. Public sites are refused. `0.0.0.0` is refused too: use `http://localhost:<port>` instead. A test account's sign-in page must pass the same rules.
- `RUNHOUND_ALLOWED_HOSTS` skips the address check entirely, with **no ownership check**. Only list host names you own.
- The browser is pinned to the address the safety check approved and is stopped if the page navigates somewhere else.
- The web UI answers only on loopback addresses. Don't expose it to your network: anyone who can reach it can start runs.
- Reports redact secret-looking text, but screenshots can't be redacted. A page that shows a secret shows it in the screenshots too. (Test-account names and session values are dotted out on the page before each screenshot.)

## Requirements

| | Docker or Podman (quickest, no clone) | From source |
|---|---|---|
| You need | Docker 24+ or Docker Desktop, or Podman. For the test lab, also Compose (or podman-compose) and curl. No git, no Node | Node 22.12 or newer (24 recommended), pnpm (via `corepack enable`, or any pnpm: it switches itself to 12.3.4), git |
| Download and disk | Run Hound's image: about 260 MB to download and 715 MB on disk. The whole test lab: about 0.5 GB to download and about 1 GB on disk | About 1 GB (dependencies and Chromium) |
| Works on | Linux, macOS, Windows (amd64 and arm64) | Linux and macOS. Windows: use WSL2 |
| Testing your own app | Enter `http://host.docker.internal:<port>/<page>`, with a few dev-server settings ([below](#docker-or-podman-any-os)). Linux: or `--network host`, same as local | Just enter `http://localhost:<port>/<page>` |
| Watching the browser in a window | No: a container has no display | Yes, on a desktop (`--headed`, or **Show the browser window**) |

**Docker or Podman is the quickest start**: pull one image and run it, nothing to clone or build. The test lab adds the demo apps with one more file. On Linux it tests your own app as simply as a local install (host network). On a Mac or Windows, **the install from source** tests your app exactly as your browser sees it, with no networking set-up.

## Install

### Docker or Podman (no clone)

Pull the image and run it, from any folder:

```sh
docker pull ghcr.io/rahul-bharati/run-hound
mkdir -p runs                    # reports land here; create it yourself so the files belong to you
docker run --rm --init -p 127.0.0.1:4000:4000 --add-host host.docker.internal:host-gateway \
  -v "$PWD/runs:/repo/app/runs" ghcr.io/rahul-bharati/run-hound
```

The log prints the address to open: <http://localhost:4000>. It also shows `listening on http://0.0.0.0:4000` and a warning about serving beyond localhost: that address is inside the container, and on your machine the port is bound to `127.0.0.1` only. In the UI, enter a page of an app on your machine as `http://host.docker.internal:<port>/<page>` (Docker Desktop defines that name itself; `--add-host` adds it on Linux). Your dev server must accept that host name: see [Test your own app](#docker-or-podman-any-os). Reports land in `./runs`, and the AI settings and test accounts you save in the UI in `./runs/.config`.

The image has these settings built in: `RUNHOUND_ALLOWED_HOSTS=host.docker.internal,host.containers.internal` and `RUNHOUND_CONFIG_DIR=/repo/app/runs/.config`. You can still override either with `-e`, for example `-e RUNHOUND_ALLOWED_HOSTS=host.docker.internal,myapp.internal`.

**Podman:** the same commands with `podman` (`podman pull …`, `podman run …`); `host.containers.internal` also works there.

**Windows PowerShell:** write each `docker run` on one line, since PowerShell doesn't continue lines with `\`, and use `mkdir runs` instead of `mkdir -p runs`. For the downloads in the test lab below, use `curl.exe` instead of `curl` (in Windows PowerShell 5.1, `curl` is an alias for `Invoke-WebRequest`, which rejects these options).

The images are public on GitHub's registry and need no login: `ghcr.io/rahul-bharati/run-hound:0.5.0`, `run-hound-kennel`, `run-hound-samples` and `run-hound-fernway` (also tagged `0.5` and `latest`; linux/amd64 and arm64). The commands here use `latest`; `docker pull` again to update.

Check it works: `docker run --rm ghcr.io/rahul-bharati/run-hound --version` prints `run-hound 0.5.0`.

### Try it on the demo apps: the test lab

One compose file starts Run Hound with every test app. In an empty folder:

```sh
curl -fsSLO https://raw.githubusercontent.com/rahul-bharati/run-hound/v0.5.0/run-hound.compose.yml
mkdir -p runs                                  # reports land here; create it yourself so the files belong to you
docker compose -f run-hound.compose.yml up     # or: podman compose -f run-hound.compose.yml up (podman-compose works too)
```

This starts Run Hound and every test app, each on its own port bound to `127.0.0.1`:

| Service | Enter this in the Run Hound UI | Open it in your browser | What it is |
|---|---|---|---|
| `run-hound` | | <http://localhost:4000> | The web UI |
| `kennel` | `http://kennel:3000/book` | <http://localhost:3000/book> | Kennel with the bugs in `KENNEL_BUGS` (default: all V0 and V1 bugs) |
| `kennel-clean` | `http://kennel-clean:3000/book` | <http://localhost:3100/book> | Kennel in clean mode: every check should pass |
| `fernway` | `http://fernway:4110/` | <http://localhost:4110/> | Fernway, a Lovable-style SaaS app, clean. Pages `/`, `/signup`, `/login`, `/onboarding`, and signed in `/app`, `/app/settings` and `/app/help` |
| `fernway-bugs` | `http://fernway-bugs:4110/` | <http://localhost:4111/> | Fernway with the bugs in `FERNWAY_BUGS` (default: all, W01-W10 and V01-V05) |
| `classic-post` | `http://classic-post:4101/signup` | <http://localhost:4101/signup> | Server-rendered sign-up form, no JavaScript |
| `spa-fetch` | `http://spa-fetch:4102/` | <http://localhost:4102/> | Contact form saving with `fetch` |
| `login` | `http://login:4103/` | <http://localhost:4103/> | Sign-in form (`demo@example.test` / `correct-horse`) |
| `cross-origin-api` | `http://cross-origin-api:4104/` | <http://localhost:4104/> | RSVP form whose API is on another origin (port 4105) |
| `multi-form` | `http://multi-form:4106/` | <http://localhost:4106/> | Three forms on one page (header search, contact, footer newsletter) and buttons outside them |

The sample apps and clean Fernway are well built on purpose: **any confirmed finding on them is a false positive**, please report it. Fernway's accounts and bugs are listed in [fixtures/fernway/README.md](fixtures/fernway/README.md).

The first start downloads about 0.5 GB of images (about 1 GB once unpacked). When the log prints `open http://localhost:4000`, open that address.

**Look after the lab:**

- `docker compose -f run-hound.compose.yml ps` lists every service with its health check: `healthy` once it answers.
- **Stop it** with Ctrl+C, then `docker compose -f run-hound.compose.yml down` (removes the containers; your reports in `./runs` stay). `up -d` starts it in the background instead.
- **Update** to a later release: download that release's compose file (the same `curl` with the new tag, such as `v0.5.0`, in the address) and run `docker compose -f run-hound.compose.yml up` again; it pulls the images the new file names. `docker compose -f run-hound.compose.yml pull` fetches them ahead of time.

**Settings.** Every setting (host ports, `KENNEL_BUGS`, `FERNWAY_BUGS`, the runs folder, `RUNHOUND_ALLOWED_HOSTS`, AI, test accounts) has a default. To change one, put it in a `.env` file next to the compose file; the documented example is [`.env.example`](.env.example):

```sh
curl -fsSL https://raw.githubusercontent.com/rahul-bharati/run-hound/v0.5.0/.env.example -o .env   # then edit it
```

Ports taken? Set them in `.env` (for example `RUNHOUND_HOST_PORT=4400`), or on the command line: `RUNHOUND_HOST_PORT=4400 KENNEL_HOST_PORT=5310 docker compose -f run-hound.compose.yml up`.

### From source

For contributors, anyone who would rather run it with Node, and anyone who wants to watch the browser in a window:

```sh
git clone https://github.com/rahul-bharati/run-hound.git
cd run-hound
corepack enable                     # once, if pnpm isn't installed
pnpm install
pnpm --filter run-hound exec playwright install chromium
pnpm --filter kennel build          # only needed for the Kennel demo
pnpm --filter fernway build         # only needed for the Fernway app
```

On Ubuntu or Debian, if Chromium complains about missing libraries, run `pnpm --filter run-hound exec playwright install --with-deps chromium` (it uses sudo). On other Linux distributions Playwright prints "BEWARE: your OS is not officially supported"; that is harmless as long as Chromium starts.

Check it works: `cd app && pnpm exec tsx src/cli.ts --version` prints `run-hound 0.5.0`. In the clone, `docker compose up --build` builds and starts the same containers as above from your working tree.

## Try it on Kennel first (10 minutes)

Kennel is a pet-sitting booking form with planted bugs you can switch on and off ([fixtures/kennel/bugs.json](fixtures/kennel/bugs.json) lists them). Trying it first shows you what findings, evidence and a clean run look like. Kennel has no sign-in, so the plan's note about signing in as a test account to run the access checks doesn't apply here.

### Docker or Podman

With the test lab running (`docker compose -f run-hound.compose.yml up`, see [the test lab](#try-it-on-the-demo-apps-the-test-lab)), open <http://localhost:4000> and enter `http://kennel:3000/book` (inside the containers Kennel is called `kennel`), then follow steps 2 to 4 below. Or from the command line, in the same folder:

```sh
docker compose -f run-hound.compose.yml run --rm run-hound run http://kennel:3000/book --approve all
```

For a clean Kennel, enter `http://kennel-clean:3000/book`: it runs next to the broken one. To change which bugs `kennel` has, set `KENNEL_BUGS` in `.env` (for example `KENNEL_BUGS=S05,S07`) and run `docker compose -f run-hound.compose.yml up -d kennel` again. In containers the target isn't `localhost`, so `client-only-validation` is skipped and the report says why.

### From source

Two terminals, from the root of your clone. The ports below are examples; any free ports work.

```sh
# terminal 1: Kennel with every bug on (the analytics port must differ from the app's)
KENNEL_BUGS=all PORT=5310 ANALYTICS_PORT=5311 pnpm kennel

# terminal 2: the web UI
pnpm serve --port 4310
```

1. Open <http://localhost:4310> (the **New Run** page), enter `http://localhost:5310/book` and press **Plan checks**.
2. Read the plan, shown under Accessibility, Features and Security headings (each has a "Select all" box). Each scenario says what it does and whether it creates test records. Keep them all ticked and press **Start run (20 scenarios)**.
3. Watch the running view: the numbered scenarios with their status and time (the current one opens to show its steps), the elapsed time, the browser, a live preview of the page under test and the activity log. A run takes about a minute. **Stop run** ends it early; what ran is still reported.
4. Read the report, which replaces the running view when the run ends. The first issue is selected: its evidence, reproduction steps, key facts, what to ask your AI and the generated Playwright test. **Open HTML report** opens the full `report.html`; **Re-run** runs the same scenarios again; every run stays listed under **Runs** (including past runs read back from the runs folder after a restart). **Settings** holds the defaults for "Allow destructive scenarios" and "Show the browser window" (saved in this browser), the test accounts and AI settings, and shows the runs folder, allowed hosts and version. You should see findings for most of Kennel's planted bugs: a button that does nothing, a double-submit, a secret key in the bundle, an email sent to the analytics service, missing focus outlines and more.
5. Stop Kennel, restart it with `KENNEL_BUGS=none` and press **Re-run** (or plan it again). **A clean Kennel should give zero confirmed findings.** If it doesn't, that's a bug worth reporting.

The same from the command line:

```sh
cd app
pnpm exec tsx src/cli.ts run http://localhost:5310/book --plan-only     # the plan, with scenario ids
pnpm exec tsx src/cli.ts run http://localhost:5310/book --approve all   # run everything
echo $?                                                                 # 1: confirmed findings
```

## Test your own app

1. Start your app the way you normally develop it, with a **throwaway database**.
2. Find the exact URL of the page you want tested, for example `http://localhost:5173/signup`. Use `localhost`, not `0.0.0.0`. For a page behind your sign-in, set up test accounts first ([Signed-in runs](#signed-in-runs-and-access-checks-v2-preview)).
3. Run Run Hound on it (below), then check each finding against your app.

### Docker or Podman (any OS)

This is the set-up of the pull-and-run container and the test lab. Inside the container `localhost` is the container itself, not your machine. If you enter `http://localhost:5173` you get "Nothing is answering at http://localhost:5173": your app is running, just not where the container looks. Use `host.docker.internal` instead (`host.containers.internal` also works on Podman), and make your dev server accept it:

1. **Listen on all interfaces**, not just localhost:
   - Vite: `vite --host` (or `server.host: true`)
   - Next.js: `next dev` already listens on all interfaces
   - Express, Fastify and similar: `listen(port, "0.0.0.0")`; Django: `runserver 0.0.0.0:8000`; Rails: `rails s -b 0.0.0.0`
2. **Allow the host name** (dev servers block unknown host names):
   - Vite: `server: { allowedHosts: ["host.docker.internal"] }` in `vite.config`. Without it Vite answers "Blocked request. This host is not allowed" and Run Hound reports "No form found".
   - Next.js: `allowedDevOrigins: ["host.docker.internal"]` in `next.config`. Without it the page never becomes interactive and you get false findings.
   - Django: add it to `ALLOWED_HOSTS`; Rails: `config.hosts << "host.docker.internal"`.
3. Enter `http://host.docker.internal:5173/signup` in the UI at <http://localhost:4000> (the container from [Install](#docker-or-podman-no-clone), or the test lab), or run it once from the command line:

   ```sh
   docker run --rm --init --add-host host.docker.internal:host-gateway -v "$PWD/runs:/repo/app/runs" \
     ghcr.io/rahul-bharati/run-hound run http://host.docker.internal:5173/signup --approve all
   ```

   The command prints `Report: /repo/app/runs/<runId>/report.html`; on your machine that's `./runs/<runId>/report.html`. With the test lab, the same run is `docker compose -f run-hound.compose.yml run --rm run-hound run http://host.docker.internal:5173/signup --approve all`, in the folder with `run-hound.compose.yml`.

The image already allows `host.docker.internal` and `host.containers.internal` through the safety check; `--add-host host.docker.internal:host-gateway` (and the compose file) adds `host.docker.internal` on Linux, where Docker doesn't define it. A test account's sign-in page then uses the same host name as the page (`http://host.docker.internal:5173/login`).

Limits of this set-up: a frontend that calls its API at `http://localhost:<apiPort>` will call the container instead and fail (use the host-network set-up or the install from source); `client-only-validation` is skipped for non-localhost targets; there is no visible browser window in a container (the live preview works).

### Docker on Linux (host network)

On Linux the container can share your machine's network instead, so `localhost` means your machine and nothing in your app needs to change:

```sh
mkdir -p runs
docker run --rm --init --network host -v "$PWD/runs:/repo/app/runs" ghcr.io/rahul-bharati/run-hound \
  run http://localhost:5173/signup --approve all
```

The command prints `Report: /repo/app/runs/<runId>/report.html`; on your machine that's `./runs/<runId>/report.html`. Podman works the same (`podman run ...`).

For the web UI on the host network, bind it to loopback so it isn't exposed to your network (open <http://localhost:4310>):

```sh
docker run --rm --init --network host -v "$PWD/runs:/repo/app/runs" ghcr.io/rahul-bharati/run-hound \
  serve --host 127.0.0.1 --port 4310
```

### From source

In your clone. Web UI: `pnpm serve --port 4310`, open <http://localhost:4310>, enter your page's URL.

Command line:

```sh
cd app
pnpm exec tsx src/cli.ts run http://localhost:5173/signup --plan-only
pnpm exec tsx src/cli.ts run http://localhost:5173/signup --approve all
```

Options: `--approve all|default|<id,id>` (default: the recommended scenarios; `all` also runs the ones unticked by default), `--plan-only`, `--allow-destructive`, `--as a|b` (sign in as a test account first), `--headed` (a visible browser window; needs a display), `--runs-dir <dir>`, `--json`, and the `--ai*` options ([Trying the AI features](#trying-the-ai-features)). `pnpm exec tsx src/cli.ts help` lists them, with the `ai` and `accounts` commands.

### Common problems

| You see | What it means |
|---|---|
| `Nothing is answering at http://localhost:<port>` | Your app isn't running on that port, or Run Hound is in a container (see above). |
| `No form found on …` | The page answered with an error (404 or 5xx), a dev server refused the host name ("Blocked request"), or nothing on the page can be tested. The message says which. Open the URL in your browser and check. (A page that simply has no form is not an error: it is planned with the page-wide checks and a warning.) |
| A plan for your sign-in page when you entered another page | The page sent you to sign in, so the sign-in page was tested (check **Pages tested** in the report). Set up a test account and plan the page signed in ([Signed-in runs](#signed-in-runs-and-access-checks-v2-preview)). |
| `Refusing to test …` | The host isn't local or private. Use `localhost`; list your own internal host names in `RUNHOUND_ALLOWED_HOSTS`. |
| `EADDRINUSE` | The port is taken. Pick another (`--port`, `PORT`, `RUNHOUND_HOST_PORT`). |
| `manifest unknown` or `denied` pulling `ghcr.io/rahul-bharati/run-hound…` | `manifest unknown`: the tag doesn't exist; check it (`0.5.0`, `0.5` or `latest`) and that the compose file came from a release tag. `denied`: usually an old `docker login ghcr.io`; run `docker logout ghcr.io` and try again (the images need no login). `no matching manifest`: your platform isn't linux/amd64 or linux/arm64, the only ones published. To build the images yourself instead: `docker compose up --build` in a clone. |
| `Invoke-WebRequest : A parameter cannot be found that matches parameter name 'fsSLO'` | Windows PowerShell's `curl` isn't curl. Use `curl.exe`. |
| `EACCES … mkdir '/repo/app/runs/…'` | The container can't write to your reports folder. Create it yourself first (`mkdir -p runs`); on Podman avoid `--user`. |
| `Error: executing /usr/bin/podman-compose run … exit status 1` | Podman's `docker compose` wrapper repeating Run Hound's exit code, not a crash: 1 means the run finished and found confirmed findings (the report was written), 2 an error or a run that tested nothing because every scenario errored or was skipped (the message above it says which). |
| `Nothing was tested` (exit 2) | Every approved scenario errored or was skipped, for example because the app stopped answering after the plan. The report's scenario notes say why for each one. |
| `--headed: There is no display on the machine running Run Hound…` | You asked for a visible browser window in a container or on a machine without a display. Run without `--headed`; in the web UI the option is greyed out there, and the live preview works either way. To watch a real window, install from source on a desktop. |
| `No sign-in form (a form with a password field) was found on …` | The account's sign-in page URL is wrong, or the page asks for the email first and the password on a second page (not supported). |
| `… sign-in asks for a verification code …` or `… has a captcha …` | Multi-factor codes and captchas aren't supported. Use a test account without them, or turn them off in your development setup. |
| `Signed in as Account A, but … still shows the sign-in page` | The session didn't carry over: the sign-in page and the page use different host names (`localhost` vs `127.0.0.1`), the app keeps its session in sessionStorage only, or the account's details are wrong. **Test sign-in** in Settings checks the account on its own. |

## Signed-in runs and access checks (V2 preview)

Run Hound can sign in as one of two test accounts you own on your app, A and B, before it tests. Every check then runs signed in, so pages behind your sign-in can be tested, and four checks join the plan: `access-control`, `mass-assignment` and `deep-links` (0.4.0), and `csrf` (0.5.0, unticked by default). They are a preview: tell us what they got right and wrong.

### Try it on Fernway first

Fernway is the test lab's SaaS app. It runs twice: `fernway` (clean) and `fernway-bugs` (with every planted bug, including the access bugs V01-V05 and the write bugs V06-V09; `csrf` catches V08, and V06, V07 and V09 wait for checks that are still planned). Its two accounts are Alex (`alex@fernway.test`, account A) and Sam (`sam@fernway.test`, account B), each with a workspace of their own; the passwords are in [fixtures/fernway/README.md](fixtures/fernway/README.md#accounts). To look around first, open <http://localhost:4111/login> and press **Use the demo account**.

1. With the test lab running, open <http://localhost:4000> → **Settings → Test accounts**.
2. **Account A**: sign-in page `http://fernway-bugs:4110/login`, username `alex@fernway.test`, Alex's password. Press **Save**, then **Test sign-in**: it says where it landed (the dashboard).
3. **Account B**: the same sign-in page, `sam@fernway.test` and Sam's password. **Save**, **Test sign-in**.
4. Leave **A and B must not see each other's data** ticked: Alex and Sam are different users with separate workspaces.
5. **New Run**: enter `http://fernway-bugs:4110/app`, set **Sign in as** to Account A, and press **Plan checks**. The plan says "Signed in as Account A". Under Security you find `access-control` (two scenarios: another account, and a signed-out visitor) and `mass-assignment` (one per form, unticked); under Features, `deep-links`. Start the run.
6. In the report, expect confirmed findings for Fernway's access bugs on that page: account B can read Alex's tasks (V02), the workspace API answers without a session (V03), and the help page the sidebar links to, `/app/help`, answers 404 when opened directly (V05, from `deep-links`; clicking **Help** in the sidebar still opens it). The page also has some of Fernway's other planted bugs ([the full list](fixtures/fernway/README.md#planted-bugs)).
7. Plan `http://fernway-bugs:4110/app/settings` as Account A next, tick `mass-assignment` (it is unticked by default) and run it. Expect account B reading Alex's profile (V01), the API answering without a session (V03), and the server storing the `role` and `plan` fields the form never sends (V04); `deep-links` reports `/app/help` again, because the sidebar is on every signed-in page. Read the `mass-assignment` notes: they say which values Run Hound put back.
8. The CSRF check: plan `http://fernway-bugs:4110/app` again, tick `csrf` (unticked by default) and run it. It is **inconclusive** in the test lab, because `fernway-bugs` is a container name with no cross-site twin; to see it catch V08, run Fernway from source and test `http://localhost:4111/app` (below).
9. Now the clean app: change both accounts' sign-in page to `http://fernway:4110/login`. **Enter the passwords again**: a saved password is only sent to the site it was saved for. Plan and run `http://fernway:4110/app` and `http://fernway:4110/app/settings` as Account A with every scenario ticked. **Clean Fernway should give zero confirmed findings**; any confirmed finding there is a false positive worth reporting.

Fernway keeps its data in memory: `docker compose -f run-hound.compose.yml restart fernway-bugs` puts the seed data back (the same for `fernway`), for example after a `mass-assignment` run that couldn't restore everything.

The same from the command line, in the folder with `run-hound.compose.yml` (each `accounts set` asks for the password and doesn't show it):

```sh
docker compose -f run-hound.compose.yml run --rm run-hound accounts set a --login-url http://fernway-bugs:4110/login --username alex@fernway.test --password-stdin
docker compose -f run-hound.compose.yml run --rm run-hound accounts set b --login-url http://fernway-bugs:4110/login --username sam@fernway.test --password-stdin
docker compose -f run-hound.compose.yml run --rm run-hound accounts test      # both accounts: where each landed, or why it failed
docker compose -f run-hound.compose.yml run --rm run-hound run http://fernway-bugs:4110/app --as a --approve all
```

`--approve all` includes `mass-assignment` and `csrf`. To pipe the password in instead of typing it (from a script or a password manager), add `-T` after `run` (`printf '%s\n' "$PASSWORD" | docker compose -f run-hound.compose.yml run --rm -T run-hound accounts set a --password-stdin`): without it, podman-compose gives the container a terminal, and that terminal prints the piped password. From source, run Fernway with `FERNWAY_BUGS=all PORT=4111 pnpm --filter fernway start` (after `pnpm --filter fernway build`), and use `pnpm exec tsx src/cli.ts accounts …` in `app/` with the sign-in page `http://localhost:4111/login`. The web UI and the command line share the saved accounts.

### On your own app

1. **Make two test accounts you own** on your development app: A and B, two different users (not teammates in one workspace or organisation), each signing in with an email or username and a password. Never use a real customer's account.
2. **Give account A some data**, or let Run Hound make it: `access-control` saves one test record as A through a form on the page, or recognises responses that name A's username. Without either, it is skipped with the reason.
3. **Save the accounts**: **Settings → Test accounts** (sign-in page URL, username, password, **Save**, **Test sign-in**), or `accounts set a --login-url <sign-in page> --username <email> --password-stdin` and the same for `b`, then `accounts test`. Use the same host name for the sign-in page as for the pages you test.
4. **Plan the page as account A**: New Run → **Sign in as** → Account A, or `run <url> --as a --plan-only`. Tick `mass-assignment` if you want it (below).
5. **Run it and read the findings.** A confirmed access finding lists the endpoints (method and path) that returned A's data, with a card per endpoint; the exported spec signs in with the accounts from `RUNHOUND_ACCOUNT_*` environment variables.

**"A and B must not see each other's data"** (on by default) means A and B are separate users. Only then is B reading A's data a bug, so the account B scenario is planned only when this is on and account B is set up. Turn it off (or set `RUNHOUND_ACCOUNTS_ISOLATED=false`) for two accounts that share data on purpose; the signed-out scenario still runs.

### What each check does, and what it never does

- **`access-control`** (ticked). As A, it opens the page, saves one test record when the page has a form that saves a record (never a form that sets a password or an email), reloads, and collects the read requests (GET) that returned A's data: the app's own API or HTML, never scripts. Then it replays up to 10 of them as account B and with no session. Any of A's data in a successful answer is a critical finding. It only ever replays GET requests A's page already made, and never a path that acts (`/logout`, `/unsubscribe`).
- **`mass-assignment`** (**unticked by default**, because it changes account A). It saves the form as A, captures the JSON save request, and sends it once more with fields the form never sends: `role: "admin"`, `isAdmin: true`, `plan: "pro"`, `credits`, `verified` and similar. It reads the record back: a field the server stored is a finding (critical for role and admin fields, high for plan, credits and verified). Then it saves the original values again, and its notes say what is back, what the server kept, and what it couldn't restore (a field that wasn't there before can't be removed: check account A by hand). A form that doesn't save JSON is skipped.
- **`deep-links`** (ticked, also when not signed in). It opens up to 10 of the page's own links directly, each in a fresh browser, and flags pages that answer with an error or show a "not found" view that the same link inside the app doesn't. It never opens a link that acts when loaded: sign out, delete, unsubscribe, disconnect, accept an invitation, or a query such as `?action=delete`.

While signed in, Run Hound never clicks a sign-out control (it would end the run's session) and never submits a form that sets a password (change password, sign up), even with `--allow-destructive`.

### The CSRF check (0.5.0)

`csrf` tests a **write**. It changes account A's data on purpose, so it is **unticked by default**, and it follows these rules:

- It writes **only the test record Run Hound created as A in the same scenario** (it carries the run's token). Never one of A's own records, never an id found by listing, guessing or counting up. A page with no form that creates such a record gets the scenario skipped with the reason.
- Requests go only to your app's own address or its local API, through the same safety gate as everything else. Never to sign-out, password, email, account-deletion, payment-provider, invitation or sharing endpoints, even with `--allow-destructive`.
- A write counts as working only when **a re-read as A** shows the change. The status code never decides: a `200 {"error": …}` or an ignored write is common.
- Afterwards it **puts it back** (the original values), re-reads it and compares. Whatever couldn't be undone is named in the notes ("… check Account A"), and the scenario isn't a pass while that note stands. A stop or the time limit can end a scenario between a write and its restore: the report then asks you to check account A.

How it works: as A, it creates the test record, then opens a page on **another site** in A's own browser (`127.0.0.1` when your app is on `localhost`, and the other way round; another port is the same site and doesn't count) and sends the form's save from there with a new value. Only requests any web page can send without a CORS preflight are forged (form-encoded or `text/plain` bodies, no custom headers, nothing added), and the browser attaches only the cookies it would for any website (a `SameSite=Lax` cookie stays home). A forged value that shows when A re-reads the record is a high finding; the notes say which defence was missing. On any other host name (`host.docker.internal`, a name from `RUNHOUND_ALLOWED_HOSTS`, a container name in the test lab) there is no cross-site address to use, and the scenario is **inconclusive**: never a pass, never a finding. A save sent only as JSON that the app doesn't also accept form-encoded or as text passes with "needs a preflight".

`write-access` (can account B, or a visitor who isn't signed in, change A's data) and `paywall-trust` (can A get a paid plan without paying) are specified in [docs/v2-spec.md](docs/v2-spec.md#050-write-side-checks) but not built yet; Fernway's V06, V07 and V09 are planted for them.

### Passwords and other secrets

- The password is **write-only**: typed in Settings or read from stdin with `--password-stdin` (never a command-line flag, so it stays out of your shell history), and never shown or sent back by the UI or the API. `accounts status` says only whether one is saved.
- Accounts are saved in `accounts.json` (file mode 0600, in a 0700 folder) next to the AI settings: `./runs/.config/accounts.json` in the test lab. `RUNHOUND_ACCOUNT_A_LOGIN_URL`, `…_USERNAME`, `…_PASSWORD`, `…_LABEL` (and `_B_`) and `RUNHOUND_ACCOUNTS_ISOLATED` override the saved values field by field.
- A saved password is sent only to the site (origin) it was saved for. Move the sign-in page to another site and you enter the password again.
- Passwords, session cookies and tokens never appear in reports, evidence, file names, specs, logs, progress or AI prompts, and neither does the username: reports name accounts by their label ("Account A", or yours). Before each screenshot, the account's name and session values on the page are replaced with dots. The live view isn't masked; it stays on your machine.
- A very common password ("password", "123456") gets a warning in the account's status: hiding it everywhere would give it away. Use a password made for the test account.
- **`runs/.config` holds your saved passwords and API keys. When you share results, share a single `runs/<runId>` folder, never the whole `runs/` folder.**

### What sign-in can't do

- Sign-in needs a form with a username (or email) field and a password field on one page. Verification codes (multi-factor), captchas, "Sign in with Google/GitHub" and two-step pages (the email on one page, the password on the next) aren't supported; **Test sign-in** says what it ran into.
- The session has to carry over to a new browser: cookies, localStorage and IndexedDB work (Supabase and Firebase keep their sessions there). A session kept only in sessionStorage doesn't, and the plan stops with "still shows the sign-in page".
- `csrf` needs your app on `localhost` or `127.0.0.1`, and the sign-in page on the same host name; elsewhere it is inconclusive. Rate limits and file upload are planned. Each run tests one page; a feature across several pages is planned too.

## Trying the AI features

Optional, and new in 0.3.0. You need a model: the easiest is [Ollama](https://ollama.com) on your machine (`ollama pull qwen3:8b`, or any model you like), or LM Studio, or an OpenAI-compatible / Amazon Bedrock endpoint you have access to.

1. In the web UI open **Settings → AI**, turn on **Use AI** and choose **Ollama**. **In a container** (pull-and-run or the test lab), change the **Base URL** from `http://127.0.0.1:11434/v1`, which is the container itself, to `http://host.docker.internal:11434/v1` (Podman: `http://host.containers.internal:11434/v1`), and start Ollama listening on all interfaces: `OLLAMA_HOST=0.0.0.0 ollama serve`. Pick the model from the dropdown, press **Save**, then **Test connection** (it tests the saved settings).
2. Plan a page with **Review with AI** ticked. Planning takes longer (a 9B model on a laptop: about a minute). Each scenario shows the model's reason; **Suggested by AI** scenarios show their steps and are unticked: tick the ones that look useful.
3. After the run, findings have an **AI explanation** panel below the built-in one.

From the command line, the `--ai*` flags apply only to the command they're given to, so test with the same flags you plan with (in the folder with `run-hound.compose.yml`):

```sh
docker compose -f run-hound.compose.yml run --rm run-hound ai test \
  --ai-provider ollama --ai-model qwen3:8b --ai-base-url http://host.docker.internal:11434/v1
docker compose -f run-hound.compose.yml run --rm run-hound run http://kennel:3000/book --approve all \
  --ai --ai-provider ollama --ai-model qwen3:8b --ai-base-url http://host.docker.internal:11434/v1
```

`ai test` prints `ok: … answered in …` (exit 0) or why it failed (exit 1). Without flags, `ai status` and `ai test` use what is saved in Settings or set in `.env`. To turn AI on for every run from `.env`, set `RUNHOUND_AI=1`, `RUNHOUND_AI_PROVIDER`, `RUNHOUND_AI_BASE_URL` and `RUNHOUND_AI_MODEL` (every provider needs `RUNHOUND_AI=1` and a model; a remote endpoint also `RUNHOUND_AI_ALLOW_REMOTE=1` and its key). From source, use `pnpm exec tsx src/cli.ts ai test --ai-provider ollama --ai-model qwen3:8b` in `app/`: Ollama is at its default address there.

In a container, Ollama on your machine is `http://127.0.0.1:11434/v1` with `--network host` on Linux; otherwise it is `http://host.docker.internal:11434/v1` (Docker) or `http://host.containers.internal:11434/v1` (Podman), and Ollama must listen on all interfaces. Settings you save in the UI are kept in `./runs/.config`: the image sets `RUNHOUND_CONFIG_DIR=/repo/app/runs/.config`, inside the runs folder you mount. **`runs/.config/ai.json` holds any API key you saved: share a single `runs/<runId>` folder, never the whole `runs/` folder.** A remote endpoint needs you to tick the consent box first; nothing is sent until then.

What we'd like to hear: were the reasons and suggested flows useful or noise, did a suggested flow report something that isn't a bug, and which model you used.

## Reading the report

Every run writes a folder: `./runs/<runId>/` for Docker, `app/runs/<runId>/` from source. In it:

- `report.html`: open this one in your browser. The UI's report has an **Open HTML report** button for it.
- `report.md`: the same report as text; the easiest thing to send us.
- `report.json`: everything, machine-readable (includes `runHoundVersion`).
- `artifacts/`: the evidence images and GIFs.
- `specs/`: a Playwright test per finding. To run one in your project: `npm i -D @playwright/test @axe-core/playwright`, then `npx playwright test <file>`. Specs for the access checks read the accounts from `RUNHOUND_ACCOUNT_A_LOGIN_URL`, `…_USERNAME` and `…_PASSWORD` (and `_B_`) in the environment.

The report has:

- **A summary**: how long the run took ("Finished in 38 s"), which account ran it when it was signed in ("Signed in as Account A"), findings by severity (critical, high, medium, low), confirmed versus advisory, scenarios passed, failed, errored and skipped, a table per group (Accessibility, Features, Security) with its results, findings and time, and how many test records the run may have created (and in which account).
- **Findings**, each with a title, its group, severity, confirmed or advisory, where on the page (every place, when there are several), *What this means*, *Why it matters*, *What to ask your AI (or developer) to fix*, and the evidence: frames (screenshots with the element boxed and the measured facts), GIFs of flows such as a double-click, and cards with the request, response or script line that proves it.
- **Scenarios**: every scenario that ran, under its group, with its result, how long it took and notes (why it was skipped or errored, what `mass-assignment` restored), the ones you didn't approve, and checks that had nothing to test on your page.
- **Pages tested**: every URL the run loaded. Check it: if your URL redirected somewhere (a sign-in page), the run tested that page instead.
- **What a browser can't see**: backups, webhook signatures and other things no browser test can check, so a clean report isn't mistaken for a clean app.

To judge a finding, look at its evidence first, then try it by hand in your browser. The exported spec reproduces it without Run Hound.

## Known limitations

- **One page per run.** Run Hound tests the forms (up to 5) and the buttons outside them (up to 20) on the page you give it; `deep-links` opens up to 10 of its links to see that they load, but the pages behind them aren't tested. Pages that redirect to a sign-in screen get the sign-in page tested instead, unless you plan them signed in (check **Pages tested**).
- **Signing in** needs a username and password on one page: no verification codes, captchas, "Sign in with …" providers, two-step sign-in pages or sessionStorage-only sessions ([details](#what-sign-in-cant-do)). The access checks only test reading.
- **AI-built apps**: only the first step of a multi-step form is tested; forms that appear only after other actions (a menu item, a tab, a hover, or more than 3 opener buttons) aren't found; file inputs are left empty; widgets from other libraries, custom date pickers and rich-text editors may not be recognised. Check the "found" strip above the plan: a field Run Hound couldn't set is named in the notes of the scenarios it skipped.
- **Destructive buttons**: buttons that sign you out, delete, pay or cancel something are only clicked with destructive scenarios allowed, and sign-out never while signed in.
- **Dev servers**: header, cookie and CORS findings are advisory and source maps are skipped on a dev server (Vite, Next.js, webpack, Nuxt, Astro). For those checks, run Run Hound against a production build.
- **Sign-in forms** tested signed out get made-up credentials, so anything past the first submit (persistence, double submit) is skipped there.
- **Unusual apps** may still produce false findings. We've tested classic HTML forms that post and redirect, fetch-based single-page apps, sign-in forms, forms whose API is on another origin, and a React app built the way Lovable builds them (Fernway), but not your stack. That's what your feedback is for.
- **Development overlays** (Next.js dev tools, Vite's error overlay) are part of the page in development; if a finding points at one, tell us.
- **Test records aren't deleted** (see above).
- **Docker**: `localhost` in the container isn't your machine except with `--network host` on Linux; no visible browser window (the image has Chromium's headless shell only).
- **Windows** is only supported through WSL2 or Docker.
- **AI**: output quality depends on the model; small models sometimes suggest flows that are rejected (they name a button the form doesn't have) or give generic reasons. Findings from AI-suggested flows are advisory: check them by hand.

## Sending feedback

Open an issue with the **Feedback** form: <https://github.com/rahul-bharati/run-hound/issues/new/choose>. If you'd rather not use GitHub, email the same details to contact@rahulbharati.dev.

Please include:

1. **The version**: `docker run --rm ghcr.io/rahul-bharati/run-hound:0.5.0 --version`, `pnpm exec tsx src/cli.ts --version` in `app/` from source, or `runHoundVersion` in `report.json`.
2. **Your OS and how you ran it**: Docker (pull-and-run or the test lab) or from source, web UI or command line, Node version, and whether the run was signed in as a test account.
3. **What you tested**: the framework, the dev server, and what the page does (not the URL, if it's private).
4. **The report**: `report.md`, or that one run folder zipped (`zip -r run.zip runs/<runId>`, or `app/runs/<runId>` from source). **Never send the whole `runs/` folder**: `runs/.config` holds your saved API keys and test-account passwords. **Look through the screenshots first**: they show whatever your page showed and can't be redacted.
5. **What was wrong**, one of:
   - *False positive*: which finding (its title) and why it's wrong;
   - *Missed bug*: a problem you know your page has that Run Hound didn't report, and how to see it by hand;
   - *Crash or error*: the command, the error text and the exit code (`echo $?`);
   - *Confusing*: which message or part of the report, and what you expected.

A clean run on a well-built app is useful feedback too: tell us it worked, and on what.
