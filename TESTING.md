# Trying Run Hound V1 (0.3.0)

Thanks for trying Run Hound. The repository is public and open source: anyone can try it (no clone needed with Docker), read the code and file issues. Run Hound is AI-assisted UI testing for AI-built apps: AI plans and explains, real checks decide. This preview ships the real checks, and since 0.3.0 you can add your own model to review the plan, suggest extra flows and explain findings (optional, off by default). This guide covers what V1 does, how to run it on Kennel (the demo app) and then on your own app, how to read the report, and what to send back.

**Contents:** [Who this is for](#who-this-is-for) · [What V1 does](#what-v1-does-and-doesnt-do) · [Requirements](#requirements) · [Install](#install) · [Try it on Kennel first](#try-it-on-kennel-first-10-minutes) · [Test your own app](#test-your-own-app) · [Trying the AI features](#trying-the-ai-features) · [Reading the report](#reading-the-report) · [Known limitations](#known-limitations) · [Sending feedback](#sending-feedback)

## Who this is for

Developers who have a web app running on their own machine (a page with forms, buttons, an API behind it: sign-up, contact, booking, settings) and who can spare 30 minutes. You don't need to know Playwright or accessibility rules; the report explains each finding in plain language.

What we most want to learn: **is every finding real, and did it miss a bug you know about?** A wrong finding costs you time, so we treat each false positive as a bug in Run Hound.

## What V1 does and doesn't do

**It does:** open one page of your local app in a headless Chromium, find every form on it (up to 5, the one with the most fields first) and the buttons outside them, plan the form checks for each form plus the page-wide checks (usually 15 to 20 scenarios for a page with one form), let you pick which ones to run, run them, and write a report with evidence (annotated screenshots, short GIFs, request and response cards) and a Playwright test for each finding.

**New in V1 (single page):** every form on the page instead of only the main one; buttons outside the forms; and page-wide checks for security headers, session cookie flags, CORS and public source maps. A page without a form now gets the page-wide checks instead of an error.

**It doesn't:**

- follow links to other pages (one page per run; whole features across pages are V2);
- log in: pages behind a login aren't supported, and a login form itself can only be partly tested (you'd need a real account);
- test public websites: only your own machine and private network addresses (see [Safety rules](#safety-rules));
- use AI unless you turn it on: with AI off (the default) the plan comes from the built-in checks below, the explanations are written for each check, and nothing is sent to any AI provider. With AI on (see [Trying the AI features](#trying-the-ai-features)) your model reviews the plan, suggests flows and explains findings, but every pass or fail still comes from a real check in a real browser;
- delete the test records it creates (see [Test records](#test-records-it-creates)).

### The 20 checks

| Check | What it does, in plain words | Creates test records |
|---|---|---|
| `console-network-errors` | Fills and sends the form with valid values and flags console errors and failed requests. | 1 |
| `dead-control` | Clicks every button except submit and flags buttons that do nothing at all. Buttons that look destructive ("Delete", "Remove") are left out unless you allow destructive scenarios. | 0 |
| `silent-failure` | Sends the form while Run Hound pretends the server failed (the request never reaches your server) and checks an error is shown, announced to screen readers, and your input is kept. | 0 |
| `persistence` | Sends unique values, reloads the page and checks they are still shown. | 1 |
| `double-submit` | Double-clicks submit and counts how many save requests reach the server. | up to 2 |
| `axe-states` | Runs the axe-core WCAG 2.2 AA rules on the form empty, after an empty submit, after a server error and after a successful send. | 2 |
| `keyboard-completion` | Fills and sends the form with only the keyboard (Tab, arrows, Space, Enter, typing). | 1 |
| `focus-visible` | Tabs through the page and checks every focused control shows a visible focus indicator. | 0 |
| `error-announcement` | Sends the form empty and checks each required field is marked invalid with a message screen readers announce. | 0 |
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

The checks are grouped as **Accessibility** (`axe-states`, `keyboard-completion`, `focus-visible`, `error-announcement`, `credential-fields`, `reflow-320`), **Features** (`console-network-errors`, `dead-control`, `silent-failure`, `persistence`, `double-submit`, `client-only-validation`, `page-controls`) and **Security** (`bundle-secrets`, `pii-leak`, `verbose-errors`, `security-headers`, `cookie-flags`, `cors`, `source-maps`).

Form checks run once per form; on a page with several forms their scenarios are named after the form ("… (Newsletter form)"). `page-controls`, `security-headers`, `cookie-flags`, `cors`, `source-maps`, `bundle-secrets`, `focus-visible` and `reflow-320` run once for the whole page. A search form gets only the checks that make sense for it (it saves nothing), and a form that never shows what it saved (a newsletter signup) has its `persistence` scenario skipped with that reason rather than reported as lost data. Buttons that sign you out, cancel a subscription or empty a cart are never clicked unless you allow destructive scenarios.

**Dev servers:** a dev server (Vite, Next.js dev, webpack dev server, …) doesn't send the headers, cookie flags and CORS settings of your production build, so on a dev server those findings are marked advisory and `source-maps` is skipped. Check them again on a production build (`vite preview`, `next start`). The plan, the run, the progress and the report all follow that order.

Scenarios that don't apply to your page (no password field, no JSON save request) are **skipped with a plain reason**, never silently dropped. Each scenario's description in the plan says whether it creates records.

### Test records it creates

A full run sends the form successfully several times (about 7 or 8 save requests), so it can create that many records in your app: bookings, sign-ups, messages. The values are obviously fake (emails at `example.test`, a run token in the text). The report and the command line say how many save requests your app accepted. **Run Hound never deletes them. Point it at a development database you can throw away.**

Scenarios that could change or delete existing data (clicking a "Delete" button, for example) are off unless you pass `--allow-destructive` or tick the option in the UI.

### Confirmed and advisory findings

- **Confirmed**: decided by a real check with evidence (a request was sent twice, axe found a rule violation, a value was missing after reload). These should always be right. If one is wrong, please report it.
- **Advisory**: relies on judgement (for example a missing `autocomplete` hint), or on production settings a dev server doesn't have (headers, cookies, CORS on a dev server). Worth a look, not a failure.

The command line exits with **0** when there are no confirmed findings (advisory ones don't fail the run), **1** when there is at least one confirmed finding, and **2** on an error: a refused or unreachable target, an error page (such as a 404), or a bad option.

When the same problem affects several elements (no visible focus on 6 controls), you get one finding that lists every place, not six findings.

### Safety rules

- Run Hound only tests `localhost`, loopback, private network addresses (10.x, 172.16-31.x, 192.168.x, `fc00::/7`, link-local) and host names listed in `RUNHOUND_ALLOWED_HOSTS`. Public sites are refused. `0.0.0.0` is refused too: use `http://localhost:<port>` instead.
- `RUNHOUND_ALLOWED_HOSTS` skips the address check entirely, with **no ownership check**. Only list host names you own.
- The browser is pinned to the address the safety check approved and is stopped if the page navigates somewhere else.
- The web UI answers only on loopback addresses. Don't expose it to your network: anyone who can reach it can start runs.
- Reports redact secret-looking text, but screenshots can't be redacted. A page that shows a secret shows it in the screenshots too.

## Requirements

| | Docker or Podman (quickest, no clone) | From source |
|---|---|---|
| You need | Docker 24+ with Compose, Docker Desktop, or Podman with podman-compose, and curl. No git, no Node | Node 22 or newer (24 recommended), pnpm (via `corepack enable`, or any pnpm: it switches itself to 12.3.4), git |
| Disk | About 2.7 GB (the image is built on Microsoft's Playwright image) | About 1 GB (dependencies and Chromium) |
| Works on | Linux, macOS, Windows (amd64 and arm64) | Linux and macOS. Windows: use WSL2 |
| Testing your own app | Linux: `--network host`, same as local. Mac/Windows: extra dev-server settings ([below](#docker-desktop-mac-windows-or-the-compose-ui)) | Just enter `http://localhost:<port>/<page>` |

**Docker or Podman is the quickest start**: one downloaded file, nothing to clone or build, the test apps included. On Linux it tests your own app as simply as a local install (host network). On a Mac or Windows, **the install from source** tests your app exactly as your browser sees it, with no networking set-up.

## Install

### Docker or Podman (no clone)

In an empty folder:

```sh
curl -fsSLO https://raw.githubusercontent.com/rahul-bharati/run-hound/main/run-hound.compose.yml
mkdir -p runs                                  # reports land here; create it yourself so the files belong to you
docker compose -f run-hound.compose.yml up     # or: podman compose -f run-hound.compose.yml up (podman-compose works too)
```

The images (`ghcr.io/rahul-bharati/run-hound:0.3.0`, `run-hound-kennel` and `run-hound-samples`) appear on GitHub's registry with the v0.3.0 release. Until then, clone the repository ([From source](#from-source)) and run `docker compose up --build` there: `docker-compose.yml` builds the same services from source.

This starts Run Hound and every test app, each on its own port bound to `127.0.0.1`:

| Service | Enter this in the Run Hound UI | Open it in your browser | What it is |
|---|---|---|---|
| `run-hound` | | <http://localhost:4000> | The web UI |
| `kennel` | `http://kennel:3000/book` | <http://localhost:3000/book> | Kennel with the bugs in `KENNEL_BUGS` (default: all V0 and V1 bugs) |
| `kennel-clean` | `http://kennel-clean:3000/book` | <http://localhost:3100/book> | Kennel in clean mode: every check should pass |
| `classic-post` | `http://classic-post:4101/signup` | <http://localhost:4101/signup> | Server-rendered sign-up form, no JavaScript |
| `spa-fetch` | `http://spa-fetch:4102/` | <http://localhost:4102/> | Contact form saving with `fetch` |
| `login` | `http://login:4103/` | <http://localhost:4103/> | Sign-in form (`demo@example.test` / `correct-horse`) |
| `cross-origin-api` | `http://cross-origin-api:4104/` | <http://localhost:4104/> | RSVP form whose API is on another origin (port 4105) |
| `multi-form` | `http://multi-form:4106/` | <http://localhost:4106/> | Three forms on one page (header search, contact, footer newsletter) and buttons outside them |

The sample apps are well built on purpose: **any confirmed finding on them is a false positive**, please report it.

The first start downloads about 2 GB of images. When you see `Run Hound UI: open http://localhost:4000`, open that address. The log also shows `listening on http://0.0.0.0:4000` and a warning about serving beyond localhost: that address is inside the container, and on your machine the port is bound to `127.0.0.1` only.

**Settings.** Every setting (host ports, `KENNEL_BUGS`, the runs folder, `RUNHOUND_ALLOWED_HOSTS`, AI) has a default. To change one, put it in a `.env` file next to the compose file; the documented example is [`.env.example`](.env.example):

```sh
curl -fsSL https://raw.githubusercontent.com/rahul-bharati/run-hound/main/.env.example -o .env   # then edit it
```

Ports taken? Set them in `.env` (for example `RUNHOUND_HOST_PORT=4400`), or on the command line: `RUNHOUND_HOST_PORT=4400 KENNEL_HOST_PORT=5310 docker compose -f run-hound.compose.yml up`.

**Only Run Hound, without the test apps**, in a single container (the web UI on <http://localhost:4000>):

```sh
mkdir -p runs
docker run --rm --init -p 127.0.0.1:4000:4000 \
  --add-host host.docker.internal:host-gateway -e RUNHOUND_ALLOWED_HOSTS=host.docker.internal \
  -e RUNHOUND_CONFIG_DIR=/repo/app/runs/.config \
  -v "$PWD/runs:/repo/app/runs" ghcr.io/rahul-bharati/run-hound:0.3.0
```

The `--add-host` and `RUNHOUND_ALLOWED_HOSTS` flags let it reach apps on your machine as `host.docker.internal` (Docker Desktop defines that name itself; the flag adds it on Linux); `RUNHOUND_CONFIG_DIR` keeps the AI settings you save in `./runs/.config`. Podman works the same (`podman run ...`).

Check it works: `docker run --rm ghcr.io/rahul-bharati/run-hound:0.3.0 --version` prints `run-hound 0.3.0`.

### From source

For contributors, and anyone who would rather run it with Node:

```sh
git clone https://github.com/rahul-bharati/run-hound.git
cd run-hound
corepack enable                     # once, if pnpm isn't installed
pnpm install
pnpm --filter run-hound exec playwright install chromium
pnpm --filter kennel build          # only needed for the Kennel demo
```

On Ubuntu or Debian, if Chromium complains about missing libraries, run `pnpm --filter run-hound exec playwright install --with-deps chromium` (it uses sudo). On other Linux distributions Playwright prints "BEWARE: your OS is not officially supported"; that is harmless as long as Chromium starts.

Check it works: `cd app && pnpm exec tsx src/cli.ts --version` prints `run-hound 0.3.0`. In the clone, `docker compose up --build` builds and starts the same containers as above from your working tree.

## Try it on Kennel first (10 minutes)

Kennel is a pet-sitting booking form with planted bugs you can switch on and off ([fixtures/kennel/bugs.json](fixtures/kennel/bugs.json) lists them). Trying it first shows you what findings, evidence and a clean run look like.

### Docker or Podman

With the test lab running (`docker compose -f run-hound.compose.yml up`, see [Install](#docker-or-podman-no-clone)), open <http://localhost:4000> and enter `http://kennel:3000/book` (inside the containers Kennel is called `kennel`), then follow steps 2 to 4 below. Or from the command line, in the same folder:

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
4. Read the report, which replaces the running view when the run ends. The first issue is selected: its evidence, reproduction steps, key facts, what to ask your AI and the generated Playwright test. **Open HTML report** opens the full `report.html`; **Re-run** runs the same scenarios again; every run stays listed under **Runs** (including past runs read back from the runs folder after a restart). **Settings** holds the defaults for "Allow destructive scenarios" and "Show the browser window" (saved in this browser) and shows the runs folder, allowed hosts and version. You should see findings for most of Kennel's planted bugs: a button that does nothing, a double-submit, a secret key in the bundle, an email sent to the analytics service, missing focus outlines and more.
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
2. Find the exact URL of the page that has the form, for example `http://localhost:5173/signup`. Use `localhost`, not `0.0.0.0`.
3. Run Run Hound on it (below), then check each finding against your app.

### Docker on Linux (host network)

On Linux the container can share your machine's network, so `localhost` means your machine and nothing in your app needs to change:

```sh
mkdir -p runs
docker run --rm --init --network host -v "$PWD/runs:/repo/app/runs" ghcr.io/rahul-bharati/run-hound:0.3.0 \
  run http://localhost:5173/signup --approve all
```

The command prints `Report: /repo/app/runs/<runId>/report.html`; on your machine that's `./runs/<runId>/report.html`. Podman works the same (`podman run ...`).

For the web UI on the host network, bind it to loopback so it isn't exposed to your network:

```sh
docker run --rm --init --network host -v "$PWD/runs:/repo/app/runs" ghcr.io/rahul-bharati/run-hound:0.3.0 \
  serve --host 127.0.0.1 --port 4310
```

### Docker Desktop (Mac, Windows) or the compose UI

Here `localhost` inside the container is the container itself, not your machine. If you enter `http://localhost:5173` you get "Nothing is answering at http://localhost:5173": your app is running, just not where the container looks. Use `host.docker.internal` instead (`host.containers.internal` also works on Podman), and make your dev server accept it:

1. **Listen on all interfaces**, not just localhost:
   - Vite: `vite --host` (or `server.host: true`)
   - Next.js: `next dev` already listens on all interfaces
   - Express, Fastify and similar: `listen(port, "0.0.0.0")`; Django: `runserver 0.0.0.0:8000`; Rails: `rails s -b 0.0.0.0`
2. **Allow the host name** (dev servers block unknown host names):
   - Vite: `server: { allowedHosts: ["host.docker.internal"] }` in `vite.config`. Without it Vite answers "Blocked request. This host is not allowed" and Run Hound reports "No form found".
   - Next.js: `allowedDevOrigins: ["host.docker.internal"]` in `next.config`. Without it the page never becomes interactive and you get false findings.
   - Django: add it to `ALLOWED_HOSTS`; Rails: `config.hosts << "host.docker.internal"`.
3. Enter `http://host.docker.internal:5173/signup` in the UI at <http://localhost:4000> (the test lab or the single container from [Install](#docker-or-podman-no-clone)), or run, in the folder with `run-hound.compose.yml`:

   ```sh
   docker compose -f run-hound.compose.yml run --rm run-hound run http://host.docker.internal:5173/signup --approve all
   ```

The compose file already allows `host.docker.internal` and `host.containers.internal` through the safety check and adds `host.docker.internal` on Linux too; the single-container command does the same with `--add-host` and `RUNHOUND_ALLOWED_HOSTS`.

Limits of this set-up: a frontend that calls its API at `http://localhost:<apiPort>` will call the container instead and fail (use the host-network set-up or the install from source); `client-only-validation` is skipped for non-localhost targets; **Show the browser window** doesn't work in a container (there is no display).

### From source

In your clone. Web UI: `pnpm serve --port 4310`, open <http://localhost:4310>, enter your form's URL.

Command line:

```sh
cd app
pnpm exec tsx src/cli.ts run http://localhost:5173/signup --plan-only
pnpm exec tsx src/cli.ts run http://localhost:5173/signup --approve all
```

Options: `--approve all|default|<id,id>` (default: the recommended scenarios), `--plan-only`, `--allow-destructive`, `--headed` (a visible browser window), `--runs-dir <dir>`, `--json`. `pnpm exec tsx src/cli.ts help` lists them.

### Common problems

| You see | What it means |
|---|---|
| `Nothing is answering at http://localhost:<port>` | Your app isn't running on that port, or Run Hound is in a container (see above). |
| `No form found on …` | The page has no `<form>` (or equivalent), the URL is wrong, the page returned an error (404, a dev server "Blocked request"), or it redirected to a login page. Open the URL in your browser and check. |
| `Refusing to test …` | The host isn't local or private. Use `localhost`; list your own internal host names in `RUNHOUND_ALLOWED_HOSTS`. |
| `EADDRINUSE` | The port is taken. Pick another (`--port`, `PORT`, `RUNHOUND_HOST_PORT`). |
| `manifest unknown` or `denied` pulling `ghcr.io/rahul-bharati/run-hound…` | The images aren't published yet (they appear with the v0.3.0 release). Until then, build them from a clone: `docker compose up --build` ([From source](#from-source)). |
| `EACCES … mkdir '/repo/app/runs/…'` | The container can't write to your reports folder. Create it yourself first (`mkdir -p runs`); on Podman avoid `--user`. |
| `Error: executing /usr/bin/podman-compose run … exit status 1` | Podman's `docker compose` wrapper repeating Run Hound's exit code, not a crash: 1 means the run finished and found confirmed findings (the report was written), 2 an error (the message above it says which). |
| "Looks like you launched a headed browser without having a XServer running" | You ticked **Show the browser window** in a container or on a machine without a display. Untick it. |

## Trying the AI features

Optional, and new in 0.3.0. You need a model: the easiest is [Ollama](https://ollama.com) on your machine (`ollama pull qwen3:8b`, or any model you like), or LM Studio, or an OpenAI-compatible / Amazon Bedrock endpoint you have access to.

1. In the web UI open **Settings → AI**, turn it on, choose **Ollama**, pick the model from the dropdown, press **Save**, then **Test connection** (it tests the saved settings). (Command line: add `--ai --ai-provider ollama --ai-model <model>` to `run`; `ai status` shows what's set.)
2. Plan a page with **Review with AI** ticked. Planning takes longer (a 9B model on a laptop: about a minute). Each scenario shows the model's reason; **Suggested by AI** scenarios show their steps and are unticked: tick the ones that look useful.
3. After the run, findings have an **AI explanation** panel below the built-in one.

In a container, Ollama on your machine is `http://127.0.0.1:11434/v1` with `--network host` on Linux; otherwise it is `http://host.docker.internal:11434/v1` (Docker) or `http://host.containers.internal:11434/v1` (Podman), and Ollama must listen on all interfaces (`OLLAMA_HOST=0.0.0.0 ollama serve`). Settings you save in the UI are kept in `./runs/.config` with the compose file (it sets `RUNHOUND_CONFIG_DIR=/repo/app/runs/.config`); with a plain `docker run`, add `-e RUNHOUND_CONFIG_DIR=/repo/app/runs/.config` or they are lost with the container. A remote endpoint needs you to tick the consent box first; nothing is sent until then.

What we'd like to hear: were the reasons and suggested flows useful or noise, did a suggested flow report something that isn't a bug, and which model you used.

## Reading the report

Every run writes a folder: `./runs/<runId>/` for Docker, `app/runs/<runId>/` from source. In it:

- `report.html`: open this one in your browser. The UI's report has an **Open HTML report** button for it.
- `report.md`: the same report as text; the easiest thing to send us.
- `report.json`: everything, machine-readable (includes `runHoundVersion`).
- `artifacts/`: the evidence images and GIFs.
- `specs/`: a Playwright test per finding. To run one in your project: `npm i -D @playwright/test @axe-core/playwright`, then `npx playwright test <file>`.

The report has:

- **A summary**: how long the run took ("Finished in 38 s"), findings by severity (critical, high, medium, low), confirmed versus advisory, scenarios passed, failed, errored and skipped, a table per group (Accessibility, Features, Security) with its results, findings and time, and how many test records the run may have created.
- **Findings**, each with a title, its group, severity, confirmed or advisory, where on the page (every place, when there are several), *What this means*, *Why it matters*, *What to ask your AI (or developer) to fix*, and the evidence: frames (screenshots with the element boxed and the measured facts), GIFs of flows such as a double-click, and cards with the request, response or script line that proves it.
- **Scenarios**: every scenario that ran, under its group, with its result, how long it took and notes (why it was skipped or errored), the ones you didn't approve, and checks that had nothing to test on your page.
- **Pages tested**: every URL the run loaded. Check it: if your URL redirected somewhere (a login page), the run tested that page instead.
- **What a browser can't see**: backups, webhook signatures and other things no browser test can check, so a clean report isn't mistaken for a clean app.

To judge a finding, look at its evidence first, then try it by hand in your browser. The exported spec reproduces it without Run Hound.

## Known limitations

- **One page, no login.** Run Hound tests every form (up to 5) and the buttons outside them on the page you give it, but doesn't follow links. Pages that redirect to a login screen get the login page tested instead (check **Pages tested**). Cookies that are only set after signing in aren't checked yet.
- **Limits per page**: up to 5 forms and 20 buttons outside them are tested; links are counted, not followed. Buttons that sign you out, delete, pay or cancel something are only clicked with destructive scenarios allowed.
- **Dev servers**: header, cookie and CORS findings are advisory and source maps are skipped on a dev server (Vite, Next.js, webpack, Nuxt, Astro). For those checks, run Run Hound against a production build.
- **Login forms** need a real account for anything past the first submit; expect those scenarios to be skipped or limited.
- **Unusual apps** may still produce false findings. We've tested classic HTML forms that post and redirect, fetch-based single-page apps, login forms and forms whose API is on another origin, but not your stack. That's what your feedback is for.
- **Development overlays** (Next.js dev tools, Vite's error overlay) are part of the page in development; if a finding points at one, tell us.
- **Test records aren't deleted** (see above).
- **Docker**: the image is large (about 2.7 GB); `localhost` in the container isn't your machine except with `--network host` on Linux; no visible browser window.
- **Windows** is only supported through WSL2 or Docker.
- **AI**: output quality depends on the model; small models sometimes suggest flows that are rejected (they name a button the form doesn't have) or give generic reasons. Findings from AI-suggested flows are advisory: check them by hand.

## Sending feedback

Open an issue with the **Feedback** form: <https://github.com/rahul-bharati/run-hound/issues/new/choose>. If you'd rather not use GitHub, email the same details to contact@rahulbharati.dev.

Please include:

1. **The version**: `docker run --rm ghcr.io/rahul-bharati/run-hound:0.3.0 --version`, `pnpm exec tsx src/cli.ts --version` in `app/` from source, or `runHoundVersion` in `report.json`.
2. **Your OS and how you ran it**: Docker (compose or single container) or from source, web UI or command line, Node version.
3. **What you tested**: the framework, the dev server, and what the form does (not the URL, if it's private).
4. **The report**: `report.md`, or the whole run folder zipped (`zip -r run.zip runs/<runId>`, or `app/runs/<runId>` from source). **Look through the screenshots first**: they show whatever your page showed and can't be redacted.
5. **What was wrong**, one of:
   - *False positive*: which finding (its title) and why it's wrong;
   - *Missed bug*: a problem you know your form has that Run Hound didn't report, and how to see it by hand;
   - *Crash or error*: the command, the error text and the exit code (`echo $?`);
   - *Confusing*: which message or part of the report, and what you expected.

A clean run on a well-built app is useful feedback too: tell us it worked, and on what.
