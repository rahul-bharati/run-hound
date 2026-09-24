# Testing Run Hound V0 (0.1.0)

Thanks for trying Run Hound before anyone else does. This guide covers what V0 does, how to run it on Kennel (the demo app) and then on your own app, how to read the report, and what to send back.

**Contents:** [Who this is for](#who-this-is-for) · [What V0 does](#what-v0-does-and-doesnt-do) · [Requirements](#requirements) · [Install](#install) · [Try it on Kennel first](#try-it-on-kennel-first-10-minutes) · [Test your own app](#test-your-own-app) · [Reading the report](#reading-the-report) · [Known limitations](#known-limitations) · [Sending feedback](#sending-feedback)

## Who this is for

Developers who have a web app running on their own machine with a form in it (sign-up, contact, booking, checkout details, settings) and who can spare 30 minutes. You don't need to know Playwright or accessibility rules; the report explains each finding in plain language.

What we most want to learn: **is every finding real, and did it miss a bug you know about?** A wrong finding costs you time, so we treat each false positive as a bug in Run Hound.

## What V0 does and doesn't do

**It does:** open one page of your local app in a headless Chromium, find the main form on it, plan 13 to 15 test scenarios, let you pick which ones to run, run them, and write a report with evidence (annotated screenshots, short GIFs, request and response cards) and a Playwright test for each finding.

**It doesn't:**

- test more than one form per page (it picks the main one), or follow links to other pages;
- log in: pages behind a login aren't supported, and a login form itself can only be partly tested (you'd need a real account);
- test public websites: only your own machine and private network addresses (see [Safety rules](#safety-rules));
- use an AI model yet: planning and every pass/fail decision are deterministic in V0;
- delete the test records it creates (see [Test records](#test-records-it-creates)).

### The 15 checks

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
| `client-only-validation` | Captures the save request, then sends it straight to the server with one field invalid and checks the server rejects it. Localhost targets only; skipped otherwise, with a reason. | 0 |

Scenarios that don't apply to your form (no password field, no JSON save request) are **skipped with a plain reason**, never silently dropped. Each scenario's description in the plan says whether it creates records.

### Test records it creates

A full run sends the form successfully several times (about 7 or 8 save requests), so it can create that many records in your app: bookings, sign-ups, messages. The values are obviously fake (emails at `example.test`, a run token in the text). The report and the command line say how many save requests your app accepted. **Run Hound never deletes them. Point it at a development database you can throw away.**

Scenarios that could change or delete existing data (clicking a "Delete" button, for example) are off unless you pass `--allow-destructive` or tick the option in the UI.

### Confirmed and advisory findings

- **Confirmed**: decided by a deterministic check (a request was sent twice, axe found a rule violation, a value was missing after reload). These should always be right. If one is wrong, please report it.
- **Advisory**: relies on judgement (for example a missing `autocomplete` hint). Worth a look, not a failure.

The command line exits with **0** when there are no confirmed findings (advisory ones don't fail the run), **1** when there is at least one confirmed finding, and **2** on an error: a refused or unreachable target, a page without a form, or a bad option.

When the same problem affects several elements (no visible focus on 6 controls), you get one finding that lists every place, not six findings.

### Safety rules

- Run Hound only tests `localhost`, loopback, private network addresses (10.x, 172.16-31.x, 192.168.x, `fc00::/7`, link-local) and host names listed in `RUNHOUND_ALLOWED_HOSTS`. Public sites are refused. `0.0.0.0` is refused too: use `http://localhost:<port>` instead.
- `RUNHOUND_ALLOWED_HOSTS` skips the address check entirely, with **no ownership check**. Only list host names you own.
- The browser is pinned to the address the safety check approved and is stopped if the page navigates somewhere else.
- The web UI answers only on loopback addresses. Don't expose it to your network: anyone who can reach it can start runs.
- Reports redact secret-looking text, but screenshots can't be redacted. A page that shows a secret shows it in the screenshots too.

## Requirements

| | Local install (recommended) | Docker or Podman |
|---|---|---|
| You need | Node 22 or newer (24 recommended), pnpm (via `corepack enable`, or any pnpm: it switches itself to 12.3.4), git | Docker 24+ with Compose, Docker Desktop, or Podman with podman-compose |
| Disk | About 1 GB (dependencies and Chromium) | About 2.7 GB (the image is built on Microsoft's Playwright image) |
| Works on | Linux and macOS. Windows: use WSL2 | Linux, macOS, Windows |
| Testing your own app | Just enter `http://localhost:<port>/<page>` | Linux: `--network host`, same as local. Mac/Windows: extra dev-server settings ([below](#docker-desktop-mac-windows-or-the-compose-ui)) |

**Use the local install if you can.** It tests your app exactly as your browser sees it, with no networking set-up.

## Install

If `git clone` asks for a username or says the repository isn't found, your GitHub account hasn't been given access yet: accept the invitation GitHub emailed you, or ask the person who invited you.

### Local install

```sh
git clone https://github.com/rahul-bharati/run-hound.git
cd run-hound
git checkout v0                     # the V0 tester branch, until it is merged
corepack enable                     # once, if pnpm isn't installed
pnpm install
pnpm --filter run-hound exec playwright install chromium
pnpm --filter kennel build          # only needed for the Kennel demo
```

On Ubuntu or Debian, if Chromium complains about missing libraries, run `pnpm --filter run-hound exec playwright install --with-deps chromium` (it uses sudo). On other Linux distributions Playwright prints "BEWARE: your OS is not officially supported"; that is harmless as long as Chromium starts.

Check it works: `cd app && pnpm exec tsx src/cli.ts --version` prints `run-hound 0.1.0`.

### Docker or Podman

```sh
git clone https://github.com/rahul-bharati/run-hound.git
cd run-hound
git checkout v0
mkdir -p runs                       # reports land here; create it yourself so the files belong to you
docker compose up --build           # or: podman-compose up --build
```

The first build downloads about 2 GB. When you see `Run Hound UI: open http://localhost:4000`, open that address. The log also shows `listening on http://0.0.0.0:4000` and a warning about serving beyond localhost: that address is inside the container, and on your machine the port is bound to `127.0.0.1` only.

Ports taken? `RUNHOUND_HOST_PORT=4400 KENNEL_HOST_PORT=5310 KENNEL_ANALYTICS_HOST_PORT=5311 docker compose up --build`.

## Try it on Kennel first (10 minutes)

Kennel is a pet-sitting booking form with planted bugs you can switch on and off ([fixtures/kennel/bugs.json](fixtures/kennel/bugs.json) lists them). Trying it first shows you what findings, evidence and a clean run look like.

### Local install

Two terminals, from the repository root. The ports below are examples; any free ports work.

```sh
# terminal 1: Kennel with every bug on (the analytics port must differ from the app's)
KENNEL_BUGS=all PORT=5310 ANALYTICS_PORT=5311 pnpm kennel

# terminal 2: the web UI
pnpm serve --port 4310
```

1. Open <http://localhost:4310> and enter `http://localhost:5310/book`.
2. Read the plan. Each scenario says what it does and whether it creates test records. Keep them all ticked and press **Run approved checks**.
3. Watch the live view: the page under test, the current step and every page loaded. A run takes about a minute.
4. Open the report. You should see findings for most of Kennel's planted bugs: a button that does nothing, a double-submit, a secret key in the bundle, an email sent to the analytics service, missing focus outlines and more.
5. Stop Kennel, restart it with `KENNEL_BUGS=none` and run again. **A clean Kennel should give zero confirmed findings.** If it doesn't, that's a bug worth reporting.

The same from the command line:

```sh
cd app
pnpm exec tsx src/cli.ts run http://localhost:5310/book --plan-only     # the plan, with scenario ids
pnpm exec tsx src/cli.ts run http://localhost:5310/book --approve all   # run everything
echo $?                                                                 # 1: confirmed findings
```

### Docker or Podman

With `docker compose up` running, open <http://localhost:4000> and enter `http://kennel:3000/book` (inside the containers Kennel is called `kennel`). Or from the command line:

```sh
docker compose run --rm run-hound run http://kennel:3000/book --approve all
```

For a clean Kennel: `KENNEL_BUGS=none docker compose up`. In containers the target isn't `localhost`, so `client-only-validation` is skipped and the report says why.

## Test your own app

1. Start your app the way you normally develop it, with a **throwaway database**.
2. Find the exact URL of the page that has the form, for example `http://localhost:5173/signup`. Use `localhost`, not `0.0.0.0`.
3. Run Run Hound on it (below), then check each finding against your app.

### Local install

Web UI: `pnpm serve --port 4310`, open <http://localhost:4310>, enter your form's URL.

Command line:

```sh
cd app
pnpm exec tsx src/cli.ts run http://localhost:5173/signup --plan-only
pnpm exec tsx src/cli.ts run http://localhost:5173/signup --approve all
```

Options: `--approve all|default|<id,id>` (default: the recommended scenarios), `--plan-only`, `--allow-destructive`, `--headed` (a visible browser window), `--runs-dir <dir>`, `--json`. `pnpm exec tsx src/cli.ts help` lists them.

### Docker on Linux (host network)

On Linux the container can share your machine's network, so `localhost` means your machine and nothing in your app needs to change:

```sh
docker compose build run-hound      # once (or reuse the image from docker compose up --build)
mkdir -p runs
docker run --rm --init --network host -v "$PWD/runs:/repo/app/runs" localhost/run-hound:dev \
  run http://localhost:5173/signup --approve all
```

The command prints `Report: /repo/app/runs/<runId>/report.html`; on your machine that's `./runs/<runId>/report.html`. Podman works the same (`podman run ...`).

For the web UI on the host network, bind it to loopback so it isn't exposed to your network:

```sh
docker run --rm --init --network host -v "$PWD/runs:/repo/app/runs" localhost/run-hound:dev \
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
3. Enter `http://host.docker.internal:5173/signup` in the UI at <http://localhost:4000>, or run:

   ```sh
   docker compose run --rm run-hound run http://host.docker.internal:5173/signup --approve all
   ```

The compose file already allows `host.docker.internal` and `host.containers.internal` through the safety check and adds `host.docker.internal` on Linux too.

Limits of this set-up: a frontend that calls its API at `http://localhost:<apiPort>` will call the container instead and fail (use the host-network set-up or the local install); `client-only-validation` is skipped for non-localhost targets; **Show the browser window** doesn't work in a container (there is no display).

### Common problems

| You see | What it means |
|---|---|
| `Nothing is answering at http://localhost:<port>` | Your app isn't running on that port, or Run Hound is in a container (see above). |
| `No form found on …` | The page has no `<form>` (or equivalent), the URL is wrong, the page returned an error (404, a dev server "Blocked request"), or it redirected to a login page. Open the URL in your browser and check. |
| `Refusing to test …` | The host isn't local or private. Use `localhost`; list your own internal host names in `RUNHOUND_ALLOWED_HOSTS`. |
| `EADDRINUSE` | The port is taken. Pick another (`--port`, `PORT`, `RUNHOUND_HOST_PORT`). |
| `EACCES … mkdir '/repo/app/runs/…'` | The container can't write to your reports folder. Create it yourself first (`mkdir -p runs`); on Podman avoid `--user`. |
| `Error: executing /usr/bin/podman-compose run … exit status 1` | Podman's `docker compose` wrapper repeating Run Hound's exit code, not a crash: 1 means the run finished and found confirmed findings (the report was written), 2 an error (the message above it says which). |
| "Looks like you launched a headed browser without having a XServer running" | You ticked **Show the browser window** in a container or on a machine without a display. Untick it. |

## Reading the report

Every run writes a folder: `app/runs/<runId>/` for the local install, `./runs/<runId>/` for Docker. In it:

- `report.html`: open this one in your browser. The UI links to it when the run ends.
- `report.md`: the same report as text; the easiest thing to send us.
- `report.json`: everything, machine-readable (includes `runHoundVersion`).
- `artifacts/`: the evidence images and GIFs.
- `specs/`: a Playwright test per finding. To run one in your project: `npm i -D @playwright/test @axe-core/playwright`, then `npx playwright test <file>`.

The report has:

- **A summary**: findings by severity (critical, high, medium, low), confirmed versus advisory, scenarios passed, failed, errored and skipped, and how many test records the run may have created.
- **Findings**, each with a title, severity, confirmed or advisory, where on the page (every place, when there are several), *What this means*, *Why it matters*, *What to ask your AI (or developer) to fix*, and the evidence: frames (screenshots with the element boxed and the measured facts), GIFs of flows such as a double-click, and cards with the request, response or script line that proves it.
- **Scenarios**: every scenario that ran with its result and notes (why it was skipped or errored), the ones you didn't approve, and checks that had nothing to test on your form.
- **Pages tested**: every URL the run loaded. Check it: if your URL redirected somewhere (a login page), the run tested that page instead.
- **What a browser can't see**: backups, webhook signatures and other things no browser test can check, so a clean report isn't mistaken for a clean app.

To judge a finding, look at its evidence first, then try it by hand in your browser. The exported spec reproduces it without Run Hound.

## Known limitations

- **One form, one page, no login.** Run Hound tests the main form on the page you give it. Pages that redirect to a login screen get the login form tested instead (check **Pages tested**).
- **Login forms** need a real account for anything past the first submit; expect those scenarios to be skipped or limited.
- **Unusual apps** may still produce false findings. We've tested classic HTML forms that post and redirect, fetch-based single-page apps, login forms and forms whose API is on another origin, but not your stack. That's what this test round is for.
- **Development overlays** (Next.js dev tools, Vite's error overlay) are part of the page in development; if a finding points at one, tell us.
- **Test records aren't deleted** (see above).
- **Docker**: the image is large (about 2.7 GB); `localhost` in the container isn't your machine except with `--network host` on Linux; no visible browser window.
- **Windows** is only supported through WSL2 or Docker.

## Sending feedback

Open an issue with the **V0 tester feedback** form: <https://github.com/rahul-bharati/run-hound/issues/new/choose>. If you'd rather not use GitHub, email the same details to the person who invited you.

Please include:

1. **The version**: `pnpm exec tsx src/cli.ts --version` in `app/`, or `runHoundVersion` in `report.json`.
2. **Your OS and how you ran it**: local install or Docker, web UI or command line, Node version.
3. **What you tested**: the framework, the dev server, and what the form does (not the URL, if it's private).
4. **The report**: `report.md`, or the whole run folder zipped (`zip -r run.zip app/runs/<runId>`). **Look through the screenshots first**: they show whatever your page showed and can't be redacted.
5. **What was wrong**, one of:
   - *False positive*: which finding (its title) and why it's wrong;
   - *Missed bug*: a problem you know your form has that Run Hound didn't report, and how to see it by hand;
   - *Crash or error*: the command, the error text and the exit code (`echo $?`);
   - *Confusing*: which message or part of the report, and what you expected.

A clean run on a well-built app is useful feedback too: tell us it worked, and on what.
