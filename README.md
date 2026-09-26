# Run Hound

AI-assisted UI testing for AI-built apps: it hunts for the holes AI-generated apps ship with, and backs every verdict with a real check in a real browser and the evidence to prove it.

**AI plans and explains; real checks decide.** Since 0.3.0 you can bring your own model (Ollama, LM Studio, llama.cpp, vLLM, any OpenAI-compatible endpoint, or Amazon Bedrock) to review the plan, suggest extra flows and explain findings. AI is **off by default**; without it the plan comes from Run Hound's built-in checks and nothing is sent to any AI provider. See [AI (optional)](#ai-optional).

> **V2 preview (0.4.0): signed-in runs and access checks; works on AI-built UIs.** Run Hound tests one page of an app running on your own machine: the forms on it (including forms in dialogs, and the Radix/shadcn-style widgets AI app builders use), the buttons outside them, and page-wide checks for security headers, session cookies, CORS and public source maps. New in 0.4.0: it can sign in as one of two test accounts you own, test pages behind the sign-in, and check that another account, or a visitor who isn't signed in, can't read the first account's data. The repository is public: anyone can try it, read the code and [file an issue](https://github.com/rahul-bharati/run-hound/issues/new/choose). To try it, start with **[TESTING.md](TESTING.md)**: install (Docker, no clone, or from source), a 10-minute run on the Kennel demo, testing your own app, signed-in runs, reading the report, and how to send feedback. Changes: [CHANGELOG.md](CHANGELOG.md).
>
> **Quickest start (no clone, just Docker or Podman):** in an empty folder,
>
> ```sh
> curl -fsSLO https://raw.githubusercontent.com/rahul-bharati/run-hound/v0.4.0/run-hound.compose.yml
> mkdir -p runs && docker compose -f run-hound.compose.yml up   # or: podman compose -f run-hound.compose.yml up
> ```
>
> starts Run Hound on <http://localhost:4000> from the published images, together with every test app: Kennel (broken and clean), Fernway (a Lovable-style SaaS app, clean and with planted bugs) and five well-built sample apps. The first start downloads about 0.5 GB. See [Running it locally](#running-it-locally).

## Running it locally

Point Run Hound at one page of a local app. It finds the forms and controls on it, plans the form checks for each form plus the page-wide checks, you approve the plan and watch the run, and you get a report with annotated evidence. Signed in as a test account, the same run covers a page behind your sign-in and adds the access checks. The quickest way needs only Docker or Podman and no clone: the image has Run Hound's web UI, its command line and Chromium. To contribute, or to watch the browser in a window, install it [from source](#from-source-contributing). The step-by-step guide, [TESTING.md](TESTING.md), covers the same steps with more detail and troubleshooting.

The images are public on GitHub's registry, so no login is needed: `ghcr.io/rahul-bharati/run-hound`, `run-hound-kennel`, `run-hound-samples` and `run-hound-fernway` (tags `0.4.0`, `0.4` and `latest`; linux/amd64 and arm64). Run Hound's image is Node 24 on Debian with Chromium's headless shell only: about 260 MB to download and 715 MB on disk. The whole test lab is about 0.5 GB to download and about 1 GB on disk. To build the images yourself, run `docker compose up --build` in a clone ([From source](#from-source-contributing)).

### With Docker or Podman

**The test lab: Run Hound and every test app.** Every command below works from an empty folder.

```sh
curl -fsSLO https://raw.githubusercontent.com/rahul-bharati/run-hound/v0.4.0/run-hound.compose.yml
mkdir -p runs                                  # reports land in ./runs; create it first so the files belong to you
docker compose -f run-hound.compose.yml up     # UI on http://localhost:4000 (Podman: podman compose -f run-hound.compose.yml up)
```

Open <http://localhost:4000> and enter `http://kennel:3000/book`; the other targets are listed under [Containers](#containers). Every setting (host ports, `KENNEL_BUGS`, `FERNWAY_BUGS`, allowed hosts, the runs folder, AI, test accounts) has a default; to change one, put it in a `.env` next to the compose file, starting from the documented example:

```sh
curl -fsSL https://raw.githubusercontent.com/rahul-bharati/run-hound/v0.4.0/.env.example -o .env
```

- **Is it up?** `docker compose -f run-hound.compose.yml ps` lists every service with its health check: `healthy` once it answers.
- **Stop it:** Ctrl+C, then `docker compose -f run-hound.compose.yml down`. The reports in `./runs` stay. (`up -d` runs the lab in the background; `down` stops it.)
- **Update:** download the compose file of the new release (the same `curl`, with the new tag in the address) and run `up` again: it pulls the images that release names. `docker compose -f run-hound.compose.yml pull` fetches them ahead of time.
- **Windows PowerShell:** use `curl.exe` instead of `curl` (in Windows PowerShell 5.1, `curl` is an alias for `Invoke-WebRequest`, which rejects these options), `mkdir runs` instead of `mkdir -p runs`, and write each `docker run` below on one line (PowerShell doesn't continue lines with `\`).

**Only Run Hound, in a single container** (the web UI on <http://localhost:4000>, no test apps):

```sh
mkdir -p runs
docker run --rm --init -p 127.0.0.1:4000:4000 \
  --add-host host.docker.internal:host-gateway -e RUNHOUND_ALLOWED_HOSTS=host.docker.internal \
  -e RUNHOUND_PUBLIC_URL=http://localhost:4000 -e RUNHOUND_CONFIG_DIR=/repo/app/runs/.config \
  -v "$PWD/runs:/repo/app/runs" ghcr.io/rahul-bharati/run-hound:0.4.0
```

`--add-host` and `RUNHOUND_ALLOWED_HOSTS` let it reach apps on your machine as `http://host.docker.internal:<port>` (Docker Desktop defines that name itself; the flag adds it on Linux). `RUNHOUND_PUBLIC_URL` makes the start-up log print the address to open (the `0.0.0.0` it listens on is inside the container; the port is published on `127.0.0.1` only). `RUNHOUND_CONFIG_DIR` keeps the AI settings and test accounts you save in the UI in `./runs/.config`; without it they are lost with the container. Podman works the same (`podman run …`; `host.containers.internal` also works there).

**The command line in a container.** The image's entrypoint takes `serve`, `run`, `ai`, `accounts`, `help` and `--version`:

```sh
# against the test lab (in the folder with run-hound.compose.yml)
docker compose -f run-hound.compose.yml run --rm run-hound run http://kennel:3000/book --approve all

# Linux: share the host's network, so localhost is your machine and nothing in your app changes
mkdir -p runs
docker run --rm --init --network host -v "$PWD/runs:/repo/app/runs" ghcr.io/rahul-bharati/run-hound:0.4.0 run http://localhost:5173/signup --approve all
docker run --rm --init --network host -v "$PWD/runs:/repo/app/runs" ghcr.io/rahul-bharati/run-hound:0.4.0 serve --host 127.0.0.1 --port 4310   # the UI this way, on loopback only
```

Testing an app on your machine from a container has a few rules (the dev server must accept `host.docker.internal` except with `--network host`): see [Containers](#containers). A container has no display, so it can't show the browser in a window: `--headed` is refused there and **Show the browser window** is greyed out. The live preview in the web UI works either way; to watch a real window, install from source on a desktop.

### From source (contributing)

Needs Node 22.12 or newer (24 recommended), pnpm (`corepack enable`), git and Chromium. The examples in the next sections use this install.

```sh
git clone https://github.com/rahul-bharati/run-hound.git
cd run-hound
pnpm install
pnpm --filter run-hound exec playwright install chromium   # once, and its system deps if prompted
pnpm --filter kennel build                                 # build the demo target (Vite bundle)
pnpm --filter fernway build                                # optional: the Fernway test app
```

In the clone, `docker compose up --build` builds and starts the same test lab from your working tree ([`docker-compose.yml`](docker-compose.yml)).

#### Ports

The defaults are Kennel on 3000 (its mock analytics service on 3001) and the Run Hound UI on 4000. Port 3000 is often taken by another dev server, so the examples below use free ports instead:

```sh
KENNEL_BUGS=all PORT=5310 ANALYTICS_PORT=5311 pnpm kennel   # Kennel on http://localhost:5310/book (KENNEL_BUGS=none for clean mode)
pnpm serve --port 4310                                      # web UI + API on http://127.0.0.1:4310
PORT=4110 pnpm --filter fernway start                       # optional: Fernway, clean, on http://localhost:4110/
```

`PORT` and `ANALYTICS_PORT` move Kennel (the analytics port must differ from the app's, so it counts as a third party); `serve --port` moves the UI. `EADDRINUSE` means the port is taken: choose another. The examples below use these ports; in the test lab the UI is <http://localhost:4000> and Kennel is `http://kennel:3000/book`.

### Web UI

Open the UI (<http://localhost:4000> in the test lab, <http://localhost:4310> with the ports above). The sidebar has three pages (on a narrow screen they're under **Menu**):

- **New Run**: enter `http://kennel:3000/book` in the test lab or `http://localhost:5310/book` from source (the `http://` is optional), choose **Sign in as** (Not signed in, or a test account) and press **Plan checks**. A strip above the plan shows what was found: each form with its fields and buttons, the controls outside the forms, and the whole page. The plan is grouped as **Accessibility**, **Features** and **Security** (each with a "Select all" box), and the scenarios run in that order. Press **Start run (N scenarios)**.
- **The running view** shows the numbered scenario list with each one's status and time (the current one expanded with its live steps), a counter and progress bar, the elapsed time, the browser (Chromium version), a live preview of the page under test with its address, and a timestamped activity log. **Stop run** stops it for real: the scenario in progress and the rest are marked skipped ("Stopped by you") and a report is still written. **Back to test plan** plans the same page again with the same scenarios ticked.
- **The report** (same address once the run ends): the verdict and counts, **Re-run** (runs the same scenarios on the same page again), **Open HTML report**, **Download** (report.md, report.json, specs), results you can filter (All, Passed, Issues, Skipped), and for the selected scenario its evidence, reproduction steps, key facts, what to ask your AI and the generated Playwright test.
- **Runs**: every run on this machine, newest first, including finished runs read back from the runs folder after a restart. A signed-in run says which account ran it.
- **Settings**: defaults for "Allow destructive scenarios" and "Show the browser window" (saved in this browser), **Test accounts**, **AI**, and this server's version, runs folder, allowed hosts and accepted server host names.

**Show the browser window** also opens a visible Chromium window on the machine running Run Hound; it needs a display, and it is greyed out where there is none (as in a container). Pages have their own addresses (`#/new`, `#/runs`, `#/runs/<id>`, `#/settings`), so reload and back work; old `#run=<id>` links still open the run. The UI refuses an empty selection, and runs at most two runs at a time.

### Command line

```sh
# in the folder with run-hound.compose.yml (the test lab)
docker compose -f run-hound.compose.yml run --rm run-hound run http://kennel:3000/book --plan-only    # list the scenarios and their ids
docker compose -f run-hound.compose.yml run --rm run-hound run http://kennel:3000/book --approve all   # run everything
```

From source, the same commands start with `pnpm exec tsx src/cli.ts` in `app/` instead (`pnpm exec tsx src/cli.ts run http://localhost:5310/book --approve all`). `run-hound help` prints the full usage.

| Command | What it does |
|---|---|
| `run <url> [options]` | Plans the checks for one page and runs them. |
| `serve [--port 4000] [--host 127.0.0.1] [--runs-dir <dir>]` | The web UI and its API. |
| `ai status` / `ai test [--ai-* flags]` | Shows the effective AI settings (never the key), or makes one small call to check the model answers. |
| `accounts status` | Both test accounts: label, sign-in page, username, whether a password is saved, where each value comes from, and whether A and B must not see each other's data. |
| `accounts set a\|b [--login-url <url>] [--username <name>] [--label <text>] [--password-stdin]` | Saves a test account; values you leave out are kept. The password is only read from stdin. |
| `accounts test [a\|b]` | Signs in (both accounts when you name none) and says the page it landed on, or why it failed. |
| `accounts clear a\|b` | Removes a test account. |
| `help`, `--version` | The usage, and the version. |

Options for `run`:

- `--approve all|default|<id,id>`: which scenarios to run (default: the recommended ones; `all` includes the ones that are unticked by default).
- `--plan-only`: list the planned scenarios and their ids, then stop.
- `--allow-destructive`: also run scenarios that may change or delete data.
- `--as a|b`: sign in as test account A or B first and run every check signed in ([Signed-in runs](#signed-in-runs-and-access-checks-v2-preview)).
- `--headed`: open a visible browser window (a source install with a display only).
- `--runs-dir <dir>`: where run folders go (default `./runs`).
- `--json`: the report (or the plan) as JSON on stdout; progress and the run folder go to stderr.
- `--ai` / `--no-ai`, `--ai-provider`, `--ai-model`, `--ai-base-url`, `--ai-allow-remote`: see [AI (optional)](#ai-optional).

The plan lists each scenario with what it tests (`[Book a sitter form]`, `[Whole page]`). Progress lines on stderr name each group (`== Accessibility (6 scenarios; group 1 of 3) ==`), each step and each page as it loads (`> page http://…`); each scenario's result line ends with its duration, and the summary starts with `Finished in <duration>` and a line per group. A page without a form is planned with the page-wide checks only, with a warning.

**Exit codes.** `run` exits:

- **0** with no confirmed findings (advisory findings are reported but don't fail the run);
- **1** with at least one confirmed finding;
- **2** on an error: a refused or unreachable target, an error page (such as a 404), a page with nothing to test, bad arguments or an approval that names no scenarios, `--ai` when AI can't be used, or `--as` with an account that isn't set up or can't sign in. It also exits 2 when **nothing was tested**: every approved scenario errored or was skipped (for example the app stopped answering after the plan; the report says why).

`accounts test` exits 0 when every account it tried signed in and 2 otherwise; `ai test` exits 0 when the model answered and 1 otherwise.

### Reports and evidence

Reports land in `./runs/<runId>/` with Docker (`app/runs/<runId>/` from source): `report.html`, `report.md`, `report.json`, an `artifacts/` folder and a `specs/` folder of Playwright tests. Every finding carries evidence you can check without rerunning anything:

- **Frames** (`.png`): the screenshot with the element boxed and labelled, a header with the page URL, time, check and step, a caption, and a facts panel with the measured data.
- **GIFs** (`.gif`): flows such as a double-click, a Tab walk or a submit-and-reload, one annotated frame per step.
- **Cards** (`.png`): requests, responses, script excerpts and console lines, with the proving line marked.

The report says how long the run took, has a per-group table (Accessibility, Features, Security: results, findings and time) and labels each finding with its group. It also lists every scenario that ran, under its group, with its result, duration and notes (why it errored or was skipped), the planned scenarios you did not approve, checks that had nothing to test on the form, and the pages tested. A signed-in run says which account ran it ("Signed in as Account A"). Evidence text is redacted; pixels can't be, so a page that shows a secret shows it in its screenshots and in the live view.

The exported specs need `@playwright/test` in the project that runs them (`npm i -D @playwright/test`, plus `@axe-core/playwright` for the axe-states specs); run one with `npx playwright test <file>`. Specs for the access checks read the accounts from `RUNHOUND_ACCOUNT_A_LOGIN_URL`, `…_USERNAME` and `…_PASSWORD` (and `_B_`) in the environment; no credential is written into a spec. Runs create a few test records in the target app (each scenario's description says when); Run Hound doesn't delete them.

### AI (optional)

AI is off until you turn it on. A model **reviews the plan** (recommends and ranks each scenario with a one-line reason), **suggests up to 5 extra flows** (steps that only use the fields and buttons Run Hound found, checked by deterministic assertions; unticked by default, findings advisory) and **explains findings** in plain words. It never decides pass or fail, and if it fails or times out you get the built-in plan with a warning.

**Web UI:** open **Settings → AI** and turn on **Use AI**. Pick a provider (Ollama, LM Studio, another OpenAI-compatible endpoint, or Amazon Bedrock). **In a container, change the Base URL**: the preset `http://127.0.0.1:11434/v1` is the container itself, so for Ollama on your machine enter `http://host.docker.internal:11434/v1` (Podman: `http://host.containers.internal:11434/v1`), and start Ollama listening on all interfaces (`OLLAMA_HOST=0.0.0.0 ollama serve`). Then choose a model from the dropdown (it lists what the server has; **Other…** takes any id), press **Save**, then **Test connection** (it tests the saved settings). New Run then shows **Review with AI**.

**Command line:** the `--ai*` flags apply only to the command they are given to, so pass the same ones to `ai test` and `run`:

```sh
# in the folder with run-hound.compose.yml; Ollama on your machine, listening on all interfaces
docker compose -f run-hound.compose.yml run --rm run-hound ai test \
  --ai-provider ollama --ai-model qwen3:8b --ai-base-url http://host.docker.internal:11434/v1   # one small call: "ok: … answered in …"
docker compose -f run-hound.compose.yml run --rm run-hound run http://kennel:3000/book --plan-only \
  --ai --ai-provider ollama --ai-model qwen3:8b --ai-base-url http://host.docker.internal:11434/v1
```

Without flags, `ai status` and `ai test` use what is saved in Settings or set in `.env`. From source, run the same commands as `pnpm exec tsx src/cli.ts ai test …` in `app/`; Ollama is then at its default address, so `--ai-base-url` isn't needed.

**In `.env`** (the compose files pass these to Run Hound). Every provider needs `RUNHOUND_AI=1` and `RUNHOUND_AI_MODEL`; a remote endpoint (OpenAI, OpenRouter, Bedrock, …) also needs `RUNHOUND_AI_ALLOW_REMOTE=1`, and a key (`RUNHOUND_AI_API_KEY`, or the AWS variables for Bedrock):

```sh
RUNHOUND_AI=1
RUNHOUND_AI_PROVIDER=ollama
RUNHOUND_AI_BASE_URL=http://host.docker.internal:11434/v1
RUNHOUND_AI_MODEL=qwen3:8b
```

**Ollama from a container:** with `--network host` on Linux it is `http://127.0.0.1:11434/v1`; otherwise `http://host.docker.internal:11434/v1` (Docker) or `http://host.containers.internal:11434/v1` (Podman), and Ollama must listen on all interfaces. Settings saved from the UI persist in `./runs/.config` when `RUNHOUND_CONFIG_DIR=/repo/app/runs/.config` (the compose files set it; add `-e RUNHOUND_CONFIG_DIR=/repo/app/runs/.config` to a plain `docker run`). **`runs/.config` holds any API key and test-account password you saved: share a single `runs/<runId>` folder, never the whole `runs/` folder.**

Settings come from the Settings page (saved to `~/.config/run-hound/ai.json`, mode 0600, or to `$RUNHOUND_CONFIG_DIR/ai.json` when it is set), then `RUNHOUND_AI_*` environment variables, then `--ai*` flags; the full list is in [docs/ai-spec.md](docs/ai-spec.md) and [`.env.example`](.env.example).

**Privacy:** only redacted page structure is sent (the page title and path, field labels and types, option labels, button names, the scenario list; the full page address only to a local model; for explanations, the finding text and its evidence facts), never typed values, cookies, response bodies or screenshots. A local endpoint (localhost or a private address) needs nothing more; a remote one (OpenAI, OpenRouter, Bedrock, …) is refused until you consent (the Settings checkbox, `--ai-allow-remote` or `RUNHOUND_AI_ALLOW_REMOTE=1`). API keys stay on the server and never appear in the UI or reports. Test-account passwords, usernames and session values are kept out of AI prompts. Bedrock takes a Bedrock API key, AWS access keys, or an AWS profile from `~/.aws` (`RUNHOUND_AI_AWS_PROFILE` or `AWS_PROFILE`; static keys, `credential_process` or IAM Identity Center after `aws sso login`; assume-role profiles aren't supported yet).

**Models:** small local models work (tested with a 9B model on Ollama). Ollama is called through its native API with thinking turned off, so reasoning models answer without spending their output on thinking, and asked to keep the model loaded for 15 minutes so it is still there for the explanations after the run. An explanation that times out is retried once; after two timeouts in a row the rest are skipped with a warning (raise `RUNHOUND_AI_TIMEOUT_MS` for a slow model). With other servers, prefer a non-reasoning model or turn reasoning off.

### Signed-in runs and access checks (V2 preview)

Pages behind a sign-in can be tested signed in, as one of two test accounts **you own** on your app: A and B. Run Hound signs in with a fresh session at the start of each plan and run, and every check then runs signed in. Three V2 checks join the plan:

| Check | What it asks | Planned |
|---|---|---|
| `access-control` | Signed in as A, Run Hound finds A's data on the page. Can account B read it? Can a visitor who isn't signed in? | Signed in. The account B scenario only when B is set up and "A and B must not see each other's data" is on. Ticked. |
| `mass-assignment` | Does the server store `role`, `isAdmin`, `plan`, `credits`, `verified` and similar fields that the form never sends? | Signed in, for each form that saves (it needs a JSON save request, and skips with the reason otherwise). **Unticked**: it changes account A, then restores it. |
| `deep-links` | Do the app's own pages load when opened directly (a reload, a shared link)? | When the page links to other pages of the app, signed in or not. Ticked. |

What they never do:

- `access-control` replays only the read requests (GET) that returned A's data on this page, as B and with no session. It never replays a path that acts (`/logout`, `/unsubscribe`), and each of its two scenarios saves at most one test record as A, through a form that saves a record, so it has data to look for. When it finds none, it is skipped with the reason.
- `mass-assignment` saves the form as A, sends the same save once more with the extra fields, reads the record back, then saves the original values again. Its notes say what came back, what the server kept, and what it couldn't restore (a field that wasn't there before can't be removed: check account A).
- `deep-links` opens at most 10 of the page's own links, each in a fresh browser, and never a link that acts when opened: sign out, delete, unsubscribe, disconnect, accept an invitation, `?action=delete`.

**"A and B must not see each other's data"** (on by default) is your statement that A and B are different users, not teammates in one workspace. Only then does B reading A's data count as a bug, so the account B scenario is planned only when it is on.

**Web UI:** **Settings → Test accounts**: for each account, the sign-in page URL, username and password, then **Save** and **Test sign-in**. New Run → **Sign in as**.

**Command line** (from source, in `app/`; in the test lab, start each line with `docker compose -f run-hound.compose.yml run --rm run-hound` instead of `pnpm exec tsx src/cli.ts`):

```sh
pnpm exec tsx src/cli.ts accounts set a --login-url http://localhost:5173/login --username alex@example.test --password-stdin
pnpm exec tsx src/cli.ts accounts set b --login-url http://localhost:5173/login --username sam@example.test --password-stdin
pnpm exec tsx src/cli.ts accounts test          # signs in as each account and says where it landed
pnpm exec tsx src/cli.ts accounts status        # what is set, and where each value comes from
pnpm exec tsx src/cli.ts run http://localhost:5173/app --as a --approve all
```

`--password-stdin` asks for the password without showing it, or reads it from a pipe (`printf '%s\n' "$PASSWORD" | … accounts set a --password-stdin`); a password is never taken from a flag, so it stays out of your shell history. To try it on the test lab's Fernway app: accounts `alex@fernway.test` (A) and `sam@fernway.test` (B), sign-in page `http://fernway-bugs:4110/login`, target `http://fernway-bugs:4110/app`; the passwords are in [fixtures/fernway/README.md](fixtures/fernway/README.md#accounts). [TESTING.md](TESTING.md#signed-in-runs-and-access-checks-v2-preview) walks through it.

**Secrets.** Accounts are saved next to the AI settings (`accounts.json`, mode 0600, in a 0700 folder; in the test lab that is `./runs/.config/accounts.json`); `RUNHOUND_ACCOUNT_A_LOGIN_URL`, `…_USERNAME`, `…_PASSWORD`, `…_LABEL` (and `_B_`) and `RUNHOUND_ACCOUNTS_ISOLATED` override them field by field. The API and the UI never send a saved password back. A saved password is only sent to the site (origin) it was saved for: move the sign-in page to another site and it has to be entered again. Passwords, session cookies and tokens never appear in reports, evidence, specs, logs, progress or AI prompts, and neither do usernames; reports name accounts by their label. Evidence screenshots are taken with the account's name and session values dotted out; the live view is not masked (it stays on your machine).

**What sign-in can't do (yet):**

- It needs a sign-in form with a username (or email) field and a password field on one page. Verification codes (multi-factor), captchas, "Sign in with Google/GitHub" and two-step pages that ask for the email first and the password on the next page aren't supported; **Test sign-in** and `accounts test` say what they ran into. Turn them off for test accounts in your development setup.
- The session must survive a new browser: cookies, localStorage and IndexedDB (Supabase and Firebase keep it there) work. A session kept only in sessionStorage doesn't, and the plan fails with "still shows the sign-in page".
- The sign-in page and the page under test must use the same host name (`localhost` and `127.0.0.1` keep their cookies apart).
- While signed in, Run Hound never clicks sign-out controls and never submits a form that sets a password (change password, sign up), even with `--allow-destructive`.
- The access checks only test reading. Account B changing A's records, rate limits, CSRF and file upload are planned.

Contract: [docs/v2-spec.md](docs/v2-spec.md).

### Works on AI-built apps

Apps from Lovable, Bolt, v0 and similar tools use React, Radix/shadcn components, react-hook-form with zod, sonner toasts and client-side routing. Since 0.4.0 Run Hound handles them:

- **Widgets:** Radix/shadcn, Headless UI, cmdk and MUI selects, comboboxes, checkboxes, switches, radio groups and sliders are found as fields and set the way a person sets them (open, pick an option), in the checks and in the exported specs.
- **Forms in dialogs and sheets:** discovery tries up to 3 buttons that look like they open one ("New project", "Add member", `aria-haspopup="dialog"`), with every write blocked while it looks, and plans the form that appears. Its scenarios open the dialog first after every page load.
- **Schema validation:** optional fields are filled too, and the fields a form refuses when it is sent empty count as required, even when nothing marks them (the empty submit is answered by Run Hound, so nothing is saved). A label such as "Email \*" also marks a field required.
- **Multi-step forms** are tested on their first step. When submitting shows the next step without saving, the checks that need a saved record skip with a "multi-step form" note instead of reporting lost data.
- Toasts count as shown and announced (and are not taken for a saved record), a move to another page after saving is followed, and ids that React or Radix number on each load are never used to find a field.

Limits: only the first step of a multi-step form is tested; forms that appear only after other actions (a menu item, a tab, a hover, or a 4th opener button) aren't found; file inputs are left empty; widgets from other libraries, custom date pickers and rich-text editors may not be recognised. Check the "found" strip above the plan: a field Run Hound couldn't set is named in the notes of the scenarios it skipped.

### Containers

Two compose files start the same test lab, Run Hound and every test app (host ports bound to `127.0.0.1`; Podman works with `podman compose` or `podman-compose`):

- [`run-hound.compose.yml`](run-hound.compose.yml) uses the published images: download it and run `docker compose -f run-hound.compose.yml up`, no clone needed ([With Docker or Podman](#with-docker-or-podman)).
- [`docker-compose.yml`](docker-compose.yml) builds the same services from source, for contributors: `docker compose up --build` in a clone (then `docker compose run --rm run-hound run …` for the CLI).

Targets to enter in the UI (inside the compose network, apps are reached by service name):

| Target | What it is | On your machine |
|---|---|---|
| `http://kennel:3000/book` | Kennel with the bugs in `KENNEL_BUGS` (default: every V0 and V1 bug) | <http://localhost:3000/book> |
| `http://kennel-clean:3000/book` | Kennel in clean mode: every check should pass | <http://localhost:3100/book> |
| `http://fernway:4110/` | Fernway, a Lovable-style SaaS app, clean: any confirmed finding is a false positive. Also `/signup`, `/login`, `/onboarding`, and signed in `/app` and `/app/settings` | <http://localhost:4110/> |
| `http://fernway-bugs:4110/` | Fernway with the bugs in `FERNWAY_BUGS` (default: all, W01-W10 and the access bugs V01-V05) | <http://localhost:4111/> |
| `http://classic-post:4101/signup` | Sample: server-rendered sign-up form, no JavaScript | <http://localhost:4101/signup> |
| `http://spa-fetch:4102/` | Sample: vanilla-JS contact form, same-origin JSON API | <http://localhost:4102/> |
| `http://login:4103/` | Sample: sign-in form (401 on wrong credentials) | <http://localhost:4103/> |
| `http://cross-origin-api:4104/` | Sample: RSVP form whose API is on another origin | <http://localhost:4104/> |
| `http://multi-form:4106/` | Sample: three forms on one page (search, contact, newsletter) and buttons outside them | <http://localhost:4106/> |

The samples and clean Fernway are well built on purpose, so any confirmed finding on them is a false positive. Fernway's pages, accounts and planted bugs are in [fixtures/fernway/README.md](fixtures/fernway/README.md). [`.env.example`](.env.example) documents every setting; both compose files read it from a `.env` next to them.

Reports are written to `./runs/<runId>/` on your machine (the CLI prints the container path, `/repo/app/runs/<runId>`); the image runs as the owner of that folder, or as its non-root user when nothing is mounted. In the containers the target isn't localhost, so the `client-only-validation` scenario (localhost only) is planned but skipped, and the report says why.

To test an app running on your machine from a container:

- **Linux**: share the host's network, so `localhost` is your machine and nothing in your app changes:
  ```sh
  mkdir -p runs
  docker run --rm --init --network host -v "$PWD/runs:/repo/app/runs" ghcr.io/rahul-bharati/run-hound:0.4.0 run http://localhost:5173/signup --approve all
  ```
  For the UI this way, bind it to loopback: `... ghcr.io/rahul-bharati/run-hound:0.4.0 serve --host 127.0.0.1 --port 4310`.
- **Docker Desktop (Mac, Windows), the test lab UI or the single container**: enter `http://host.docker.internal:<port>/<page>`. In a container `localhost` is the container itself. Your dev server must listen on all interfaces (`vite --host`) and accept that host name (Vite `server.allowedHosts`, Next.js `allowedDevOrigins`); a frontend that calls its API on `localhost:<apiPort>` won't work this way. Both compose files allow `host.docker.internal` and `host.containers.internal` through the safety gate with `RUNHOUND_ALLOWED_HOSTS` and add `host.docker.internal` on Linux (the single-container command above does the same with its flags). A test account's sign-in page then uses the same host name (`http://host.docker.internal:5173/login`). Details in [TESTING.md](TESTING.md#test-your-own-app).

### Safety

The target must be `localhost`, a private address, or listed in `RUNHOUND_ALLOWED_HOSTS` (which skips the address check with no ownership check, so list only hosts you own); a test account's sign-in page must pass the same gate. The browser is pinned to the address the gate approved and is stopped if a page navigates off it; requests a check replays or re-fetches are sent from the page, so they get the same pinning. Destructive scenarios only run with `--allow-destructive`. The UI and API answer only to loopback names and addresses (`localhost`, `127.0.0.1`, `::1`), the host of `RUNHOUND_PUBLIC_URL` and the address given to `serve --host` (not a wildcard such as `0.0.0.0`), so another container on the same network can't use them by the server's IP address; add other names or addresses with `RUNHOUND_SERVER_HOSTS`. They send a strict Content-Security-Policy, refuse to be framed, and serve `report.html` sandboxed with no scripts.

### Running the suites (from source)

```sh
pnpm --filter run-hound test                  # unit + browser tests for the engine and checks
pnpm --filter run-hound exec tsc --noEmit
pnpm --filter kennel test                     # Kennel's own tests (clean mode and every bug)
pnpm --filter fernway test                    # Fernway's own tests (builds it once; clean mode and every bug)
pnpm test:acceptance                          # Run Hound against Kennel, Fernway and the sample apps, clean and with every planted bug
```

The suites pick random free ports, so they don't collide with anything already running. CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs on every pull request and every push to main: the type-checks and every suite above, a build of the four Docker images with a smoke test in the compose test lab, and a lint and build of the website. A release runs all of CI first, and publishes no image unless it passes.

## Problem statement

- AI can build an app from a single-line prompt, but AI-generated apps often ship with holes: untested paths, unhandled edge cases, broken flows, weak error handling and inaccessible UI. Some of these, such as gaps in auth or payment handling, can lead to data breaches or privacy issues.
- A human tester might not be able to test all the paths, i.e. golden paths and danger paths.
- Defects need to be triaged by the feature they affect and assigned a priority, which takes time to do by hand.
- Testing needs to be scoped, so the most valuable paths get tested first.
- When something breaks, QA just says "xyz broke" without the error, the state of the app when it broke, or the steps to reproduce it.

The need is documented in [docs/research.md](docs/research.md): for example, 45% of AI-generated code samples fail security tests (Veracode 2025), and 95.9% of top home pages fail WCAG checks (WebAIM Million 2026).

## Who it's for

In priority order:

1. **Small dev teams and solo devs:** want reproducible tests and triaged defects they can drop into CI.
2. **QA testers:** want the agent to expand coverage and hand them evidence-rich reports.
3. **Vibe coders:** people building on Lovable, Bolt and similar tools, with no QA function. They need plain-language, actionable reports. They are the least likely to run Docker or a local model, so they are served later through hosted inference or a hosted runner (see [Business model](#license-and-business-model)). What Run Hound handles on these apps today, and what it doesn't: [Works on AI-built apps](#works-on-ai-built-apps).

## What it hunts for

- **Broken features:** dead buttons, forms that fail silently, data that looks saved but isn't, double submit, missing loading/error states, broken refresh/back/deep links, localhost URLs or undefined env vars in production builds.
- **Validation gaps:** empty, oversized or malformed input; checks enforced only in the client.
- **Accessibility:** unlabeled inputs, nameless icon buttons, clickable `div`s, removed focus outlines, broken modal focus, errors not announced, low contrast, small targets, layouts that break at 320 px, blocked paste on password fields.
- **Auth and access:** frontend-only auth, other users' data exposed (IDOR, Supabase RLS off, open Firebase rules), fields such as `role` or `plan` the server shouldn't accept, paid features unlocked without payment.
- **Leaks:** secret keys in the JS bundle, personal data sent to analytics or ad pixels, stack traces shown to users, public source maps.
- **Blind spots for non-technical builders:** tracking before cookie consent, missing security headers and cookie flags, SEO and social-preview gaps, slow pages.

Some holes can't be seen from the browser (backups, webhook signatures, dependency hygiene). Every report lists these in a **"What a browser can't see"** section ("Not visible from outside" in the web UI) as a checklist, so a clean report is never mistaken for a clean app.

Full catalog with severity and detectability: [docs/research.md §3](docs/research.md). The [roadmap](#roadmap) says which of these are checked today.

## How it works

1. **Explore:** the agent drives a headless browser (Playwright) and reads the accessibility tree and DOM, signed in as a test account when you choose one. It finds the forms on the page you give it (up to 5, including forms in dialogs behind up to 3 opener buttons), their fields (native ones and common Radix/shadcn-style widgets), the buttons outside them and the page's own links. Using vision on screenshots for layout and visual checks is planned.
2. **Plan:** golden-path and danger-path test scenarios, grouped (Accessibility, Features, Security). The built-in checks that apply to each form and to the page propose the scenarios; with AI on, your model recommends and ranks them with a reason each and suggests up to 5 extra flows built only from the fields and buttons Run Hound found.
3. **Approve:** the plan is shown in a local web UI (or with `--plan-only` on the command line), where you pick the scenarios to run. Editing scenarios and adding your own is planned.
4. **Execute:** the approved scenarios run in a real browser while screenshots, console logs, network traffic and each step are captured.
5. **Report:** every finding comes with its group, severity, a plain-language explanation, reproduction steps, evidence and an exported Playwright test. With AI on, each finding also gets an **AI explanation** (labelled advisory) next to the built-in one.

### Design principles

- **AI plans and explains; real checks decide.** Pass/fail comes from Playwright assertions, axe-core rules and captured traffic in a real browser, never from a model guessing. Findings that depend on judgement (e.g. alt-text quality) are marked advisory.
- **No evidence, no finding.** Every reported defect has a screenshot and/or request/response, plus a replayable spec. Made-up defects are the biggest product risk, especially for non-technical users.
- **Build on existing tools, don't reinvent them.** Playwright (including its test agents) and axe-core do the heavy lifting; Run Hound adds exploration, approval, triage and plain-language reporting.
- **Only owned targets, safe by default.** See [Security](#security).

## Output

- **Report:** HTML/Markdown, with defects triaged by feature and priority. Each finding has "What this means", "Why it matters" and "What to ask your AI to fix", plus screenshots, console and network logs, and reproduction steps.
- **Playwright tests:** a re-runnable `.spec.ts` for each scenario, using role- and label-based locators, with no agent needed at runtime, so developers can reproduce the failure and add it to CI.
- **Run record:** `report.json`, a JSON record of the plan, the steps, the evidence files and the findings. Replaying a run from it (for example for the landing-page demo) is planned.

## Tech stack

- TypeScript + Playwright, with `@axe-core/playwright` for accessibility rules
- Local web UI for approving the plan, served from the container
- Docker for delivery
- Inference (optional, bring your own model, since 0.3.0): local via Ollama, LM Studio, llama.cpp or vLLM, or cloud via Amazon Bedrock or any OpenAI-compatible endpoint. Off by default; with AI off nothing is sent to any AI provider, and with it on only redacted page structure and finding text go to the endpoint you configure. See [AI (optional)](#ai-optional).

## Delivery

- Docker-based; no hosted platform for now.
- Users pull the Docker image (or install from source) and run it locally. AI features are optional and off by default: bring your own model, local or cloud (see [AI (optional)](#ai-optional)).
- The initial scope is testing localhost; later, live sites as well, mostly staging and dev, behind ownership verification.

## Roadmap

### V0: Single form (shipped, 0.1.0)

Point it at a form on localhost. Run Hound plans at least 10 scenarios from its built-in checks (golden and danger paths), the user approves them in the web UI, the agent runs them, and it produces a report with evidence and exported Playwright tests.

- Checks, in order: console/network error capture, dead controls, silent failures, persistence after reload, double submit, axe on every form state, keyboard-only completion, error announcement, paste/autofill on credential fields, bundle secret scan, PII leaks to third parties, 320 px reflow. Stretch: client-only validation (non-destructive values, localhost only). See [docs/research.md §6.1](docs/research.md).
- Destructive actions are off by default.
- **Done when** Run Hound finds the V0 bugs planted in the [Kennel fixture](docs/fixtures.md) and reports nothing in its clean mode.

### V1: Single page (shipped: 0.2.0, AI in 0.3.0, AI-built UIs in 0.4.0)

Point it at a page and the agent finds the interactive elements on it, then generates and runs test cases for them.

- **Built:** every form on the page (form checks per form) and the buttons outside them (`page-controls`); page-wide `security-headers`, `cookie-flags`, `cors` and `source-maps` checks, advisory (or skipped, for source maps) on dev servers, since dev servers don't show production values. Kennel has a planted bug for each (F07, S05 to S08). Contract: [docs/v1-spec.md](docs/v1-spec.md).
- **Built in 0.3.0:** bring-your-own-model plan review, AI-suggested flows (run by the deterministic `ai-flow` check, advisory) and AI explanations of findings. Contract: [docs/ai-spec.md](docs/ai-spec.md).
- **Built in 0.4.0:** apps built the way Lovable, Bolt and v0 build them: Radix/shadcn-style widgets, forms in dialogs and sheets, schema-validated forms, toasts and client-side routing ([Works on AI-built apps](#works-on-ai-built-apps)). Fernway's W01-W10 bugs check it.
- Advisory checks that rely on model judgement (**planned**): alt-text quality, generic link text, placeholder/demo data.

### V2: Single feature (preview in 0.4.0)

Give it a feature (e.g. "signup" or "checkout") and it does end-to-end testing of that feature across pages.

- **Built in 0.4.0:** two test accounts you own and signed-in runs; `access-control` (can another account, or a visitor who isn't signed in, read account A's data: cross-user reads, IDOR, APIs that answer without a session behind a frontend-only sign-in); `mass-assignment` (self-promotion through `role`, `plan` or `isAdmin` fields the form never sends); `deep-links` (pages that break when opened directly). Developed against Fernway's planted bugs V01-V05. Contract: [docs/v2-spec.md](docs/v2-spec.md).
- **Planned:** multi-page feature runs (the feature tested across its pages), write-side access checks (account B changing A's records), paid features without payment (paywall and success-page trust), and opt-in, throttled checks for rate limits, CSRF, file upload and prompt injection in LLM features. A Supabase-backed variant of the fixture (RLS off, `USING (true)`), as described in [docs/fixtures.md](docs/fixtures.md), is planned for later.

### V3: Whole app

Point it at the app and let the agent do it. It discovers and prioritizes features, generates the test cases that give developers the most value in the least time, then runs e2e testing.

- Adds whole-app checks: dead-link crawl, cross-browser runs, Core Web Vitals, SEO and social previews.

### V4: Live staging

Support for testing live staging/dev sites behind ownership verification.

- Adds live-host checks: exposed dotfiles, staging wired to production, mixed content, email DNS (SPF/DKIM/DMARC).

### Later

- Firebase variant of the fixture (Firebase Emulator Suite).
- Static companion check: run Supabase's database lint/advisors next to the browser run, so a finding shows both the symptom and the cause.
- **Landing-page demo:** an interactive replay of a real recorded run against Kennel: the visitor approves the plan, watches the steps, browses the findings and copies the exported spec, with a broken/clean toggle. Not a live run, so it costs nothing per visitor and scans nothing.

## Test fixtures

Run Hound is developed and scored against deliberately broken apps with planted bugs behind toggles and a clean mode:

- **Kennel**: a single booking form (`/book`) on a small in-memory Node server with a mock analytics service ([fixtures/kennel/CONTRACT.md](fixtures/kennel/CONTRACT.md), [bugs.json](fixtures/kennel/bugs.json)). Its V0 and V1 bugs cover the form and page checks.
- **Fernway**: a Lovable-style SaaS app (Vite, React 19, Tailwind CSS, Radix/shadcn-style components, react-hook-form with zod, sonner) with a landing page, sign-up, sign-in, an onboarding wizard, and a dashboard and settings behind a real sign-in with two accounts ([fixtures/fernway/README.md](fixtures/fernway/README.md), [CONTRACT.md](fixtures/fernway/CONTRACT.md), [bugs.json](fixtures/fernway/bugs.json)). W01-W10 are the bugs AI-built apps typically ship with; V01-V05 are the access bugs the V2 checks look for.
- **Sample apps**: five well-built apps ([fixtures/samples/README.md](fixtures/samples/README.md)) as the false-positive suite.

Fernway replaces, for 0.4.0, the multi-page Kennel on a local Supabase described in [docs/fixtures.md](docs/fixtures.md); that stays planned as a Supabase variant. Scoring, in CI on every pull request, covers planted bugs found, false positives in clean mode and evidence on every finding; repeating runs to check that findings are stable is planned ([docs/fixtures.md](docs/fixtures.md#scoring)).

## Security

- Users must not be able to misuse Run Hound to scan websites/apps they don't own.
- localhost and private IPs are allowed by default.
- Any other domain requires ownership verification before it can be scanned: either a DNS TXT record or a nonce placed in a `<meta>` tag in the HTML header. The scan only runs where the nonce is found.
- Status in 0.4.0: ownership verification isn't built yet. Other hosts are refused unless listed in `RUNHOUND_ALLOWED_HOSTS`, which is not checked for ownership, so list only hosts you own.
- No destructive actions (real payments, deleting data) unless the user explicitly opts in.
- Reports redact any secrets they find; keys are never used or tested. Test-account passwords, session values and usernames are kept out of everything Run Hound writes.

## License and business model

- **License: [MIT](LICENSE)** for the core.
- The open core includes every check, the approval UI, reports, Playwright export, bring-your-own-model support and the test fixtures. **Checks are never paywalled.**
- A possible paid tier (later, only after demand is validated) would cover things that run on our servers: hosted inference, a hosted runner, team dashboards, CI integration and compliance exports. It would be unlocked with an API key passed to the Docker container; without a key, the core runs fully.

Details: [docs/business-model.md](docs/business-model.md).

## Docs

- [TESTING.md](TESTING.md): how to try it, step by step, and how to send feedback
- [CHANGELOG.md](CHANGELOG.md): what changed in each release
- [docs/v0-spec.md](docs/v0-spec.md), [docs/v1-spec.md](docs/v1-spec.md) and [docs/v2-spec.md](docs/v2-spec.md): the build contracts for V0 (single form), V1 (single page) and the V2 preview (signed-in runs and access checks)
- [docs/ai-spec.md](docs/ai-spec.md): optional AI (0.3.0): providers, settings, privacy and consent rules
- [docs/app-ui-spec.md](docs/app-ui-spec.md): the local web UI
- [docs/fixtures.md](docs/fixtures.md): the Kennel test fixture, its planned Supabase version, and scoring
- [fixtures/fernway/README.md](fixtures/fernway/README.md): the Fernway test app, its accounts and planted bugs
- [docs/research.md](docs/research.md): market need, competition, gap catalog and scope mapping
- [docs/research-data.json](docs/research-data.json): fact-checked research data behind the report
- [docs/brand.md](docs/brand.md): palette, type, logo and voice
- [docs/business-model.md](docs/business-model.md): open core vs paid, licensing and API keys
