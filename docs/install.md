# Install and run

This page covers installing and starting Run Hound: the published image with Docker or Podman, the test lab with the demo apps, a source install, and testing an app on your machine from a container.

Point Run Hound at one page of a local app. It finds the forms and controls on it, plans the form checks for each form plus the page-wide checks, you approve the plan and watch the run, and you get a report with annotated evidence. Signed in as a test account, the same run covers a page behind your sign-in and adds the access checks and the opt-in write-side checks. The main way needs only Docker or Podman and no clone: pull the image and run it. The image has Run Hound's web UI, its command line and Chromium. To try it on the demo apps, start [the test lab](#try-it-on-the-demo-apps-the-test-lab). To contribute, or to watch the browser in a window, install it [from source](#from-source-contributing). The step-by-step guide, [TESTING.md](../TESTING.md), covers the same steps with more detail and troubleshooting.

The images are public on GitHub's registry, so no login is needed: `ghcr.io/rahul-bharati/run-hound`, `run-hound-kennel`, `run-hound-samples` and `run-hound-fernway` (tags `0.6.0`, `0.6` and `latest`; linux/amd64 and arm64). The commands below use `latest`; add a release tag (`ghcr.io/rahul-bharati/run-hound:<version>`) to stay on one release. Run Hound's image is Node 24 on Debian with Chromium's headless shell only: about 260 MB to download and 715 MB on disk. The whole test lab is about 0.5 GB to download and about 1 GB on disk. To build the images yourself, run `docker compose up --build` in a clone ([From source](#from-source-contributing)).

## With Docker or Podman

**Pull and run** (the web UI on <http://localhost:4000>). This works from any folder:

```sh
docker pull ghcr.io/rahul-bharati/run-hound
mkdir -p runs                    # reports land in ./runs; create it first so the files belong to you
docker run --rm --init -p 127.0.0.1:4000:4000 --add-host host.docker.internal:host-gateway \
  -v "$PWD/runs:/repo/app/runs" ghcr.io/rahul-bharati/run-hound
```

The log prints the address to open: <http://localhost:4000>. (It also shows `0.0.0.0:4000`: that address is inside the container; on your machine the port is published on `127.0.0.1` only.) Enter a page of an app on your machine as `http://host.docker.internal:<port>/<page>`: Docker Desktop defines that name itself, and `--add-host` adds it on Linux. Your dev server must accept that host name (see [Containers](#containers)). The AI settings and test accounts you save in the UI are kept in `./runs/.config`.

The image has these settings built in: `RUNHOUND_ALLOWED_HOSTS=host.docker.internal,host.containers.internal` and `RUNHOUND_CONFIG_DIR=/repo/app/runs/.config`. Override either with `-e`, for example `-e RUNHOUND_ALLOWED_HOSTS=host.docker.internal,myapp.internal`. Podman works the same (`podman pull …`, `podman run …`; `host.containers.internal` also works there). To update, `docker pull` again.

**Windows PowerShell:** write each `docker run` on one line (PowerShell doesn't continue lines with `\`), use `mkdir runs` instead of `mkdir -p runs`, and `curl.exe` instead of `curl` for the downloads below (in Windows PowerShell 5.1, `curl` is an alias for `Invoke-WebRequest`, which rejects these options).

**The command line in a container.** The image's entrypoint takes `serve`, `run`, `ai`, `accounts`, `help` and `--version`:

```sh
# one run against an app on your machine; the report lands in ./runs
docker run --rm --init --add-host host.docker.internal:host-gateway -v "$PWD/runs:/repo/app/runs" \
  ghcr.io/rahul-bharati/run-hound run http://host.docker.internal:5173/signup --approve all

# Linux: share the host's network, so localhost is your machine and nothing in your app changes
docker run --rm --init --network host -v "$PWD/runs:/repo/app/runs" ghcr.io/rahul-bharati/run-hound run http://localhost:5173/signup --approve all
docker run --rm --init --network host -v "$PWD/runs:/repo/app/runs" ghcr.io/rahul-bharati/run-hound serve --host 127.0.0.1 --port 4310   # the UI this way, on loopback only
```

Testing an app on your machine from a container has a few rules (the dev server must accept `host.docker.internal` except with `--network host`): see [Containers](#containers). A container has no display, so it can't show the browser in a window: `--headed` is refused there and **Show the browser window** is greyed out. The live preview in the web UI works either way; to watch a real window, install from source on a desktop.

## Try it on the demo apps: the test lab

One compose file starts Run Hound with every test app: Kennel (broken and clean), Fernway (a Lovable-style SaaS app, clean and with planted bugs) and five well-built sample apps. In an empty folder:

```sh
curl -fsSLO https://raw.githubusercontent.com/rahul-bharati/run-hound/v0.6.0/run-hound.compose.yml
mkdir -p runs                                  # reports land in ./runs; create it first so the files belong to you
docker compose -f run-hound.compose.yml up     # UI on http://localhost:4000 (Podman: podman compose -f run-hound.compose.yml up)
```

Open <http://localhost:4000> and enter `http://kennel:3000/book`; the other targets are listed under [Containers](#containers). The first start downloads about 0.5 GB. Every setting (host ports, `KENNEL_BUGS`, `FERNWAY_BUGS`, allowed hosts, the runs folder, AI, test accounts) has a default; to change one, put it in a `.env` next to the compose file, starting from the documented example:

```sh
curl -fsSL https://raw.githubusercontent.com/rahul-bharati/run-hound/v0.6.0/.env.example -o .env
```

- **Is it up?** `docker compose -f run-hound.compose.yml ps` lists every service with its health check: `healthy` once it answers.
- **Stop it:** Ctrl+C, then `docker compose -f run-hound.compose.yml down`. The reports in `./runs` stay. (`up -d` runs the lab in the background; `down` stops it.)
- **Update:** download the compose file of the new release (the same `curl`, with the new tag in the address) and run `up` again: it pulls the images that release names. `docker compose -f run-hound.compose.yml pull` fetches them ahead of time.
- **The command line in the lab:** `docker compose -f run-hound.compose.yml run --rm run-hound run http://kennel:3000/book --approve all`, in the folder with the compose file.

## From source (contributing)

Needs Node 22.12 or newer (24 recommended), pnpm (`corepack enable`), git and Chromium. The examples under [Ports](#ports) and the from-source commands in [Using Run Hound](usage.md), [AI (optional)](ai.md), [Signed-in runs](signed-in-runs.md) and [Development](development.md) use this install.

```sh
git clone https://github.com/rahul-bharati/run-hound.git
cd run-hound
pnpm install
pnpm --filter run-hound exec playwright install chromium   # once, and its system deps if prompted
pnpm --filter kennel build                                 # build the demo target (Vite bundle)
pnpm --filter fernway build                                # optional: the Fernway test app
```

In the clone, `docker compose up --build` builds and starts the same test lab from your working tree ([`docker-compose.yml`](../docker-compose.yml)).

### Ports

The defaults are Kennel on 3000 (its mock analytics service on 3001) and the Run Hound UI on 4000. Port 3000 is often taken by another dev server, so the examples below use free ports instead:

```sh
KENNEL_BUGS=all PORT=5310 ANALYTICS_PORT=5311 pnpm kennel   # Kennel on http://localhost:5310/book (KENNEL_BUGS=none for clean mode)
pnpm serve --port 4310                                      # web UI + API on http://127.0.0.1:4310
PORT=4110 pnpm --filter fernway start                       # optional: Fernway, clean, on http://localhost:4110/
```

`PORT` and `ANALYTICS_PORT` move Kennel (the analytics port must differ from the app's, so it counts as a third party); `serve --port` moves the UI. `EADDRINUSE` means the port is taken: choose another. The examples in [Using Run Hound](usage.md) use these ports; in the test lab the UI is <http://localhost:4000> and Kennel is `http://kennel:3000/book`.

## Containers

Two compose files start the same test lab, Run Hound and every test app (host ports bound to `127.0.0.1`; Podman works with `podman compose` or `podman-compose`):

- [`run-hound.compose.yml`](../run-hound.compose.yml) uses the published images: download it and run `docker compose -f run-hound.compose.yml up`, no clone needed ([the test lab](#try-it-on-the-demo-apps-the-test-lab)).
- [`docker-compose.yml`](../docker-compose.yml) builds the same services from source, for contributors: `docker compose up --build` in a clone (then `docker compose run --rm run-hound run …` for the CLI).

Targets to enter in the UI (inside the compose network, apps are reached by service name):

| Target | What it is | On your machine |
|---|---|---|
| `http://kennel:3000/book` | Kennel with the bugs in `KENNEL_BUGS` (default: every V0 and V1 bug) | <http://localhost:3000/book> |
| `http://kennel-clean:3000/book` | Kennel in clean mode: every check should pass | <http://localhost:3100/book> |
| `http://fernway:4110/` | Fernway, a Lovable-style SaaS app, clean: any confirmed finding is a false positive. Also `/signup`, `/login`, `/onboarding`, and signed in `/app`, `/app/settings` and `/app/help` | <http://localhost:4110/> |
| `http://fernway-bugs:4110/` | Fernway with the bugs in `FERNWAY_BUGS` (default: all, W01-W10 and the V2 bugs V01-V09) | <http://localhost:4111/> |
| `http://classic-post:4101/signup` | Sample: server-rendered sign-up form, no JavaScript | <http://localhost:4101/signup> |
| `http://spa-fetch:4102/` | Sample: vanilla-JS contact form, same-origin JSON API | <http://localhost:4102/> |
| `http://login:4103/` | Sample: sign-in form (401 on wrong credentials) | <http://localhost:4103/> |
| `http://cross-origin-api:4104/` | Sample: RSVP form whose API is on another origin | <http://localhost:4104/> |
| `http://multi-form:4106/` | Sample: three forms on one page (search, contact, newsletter) and buttons outside them | <http://localhost:4106/> |

The samples and clean Fernway are well built on purpose, so any confirmed finding on them is a false positive. Fernway's pages, accounts and planted bugs are in [fixtures/fernway/README.md](../fixtures/fernway/README.md). [`.env.example`](../.env.example) documents every setting; both compose files read it from a `.env` next to them.

Reports are written to `./runs/<runId>/` on your machine (the CLI prints the container path, `/repo/app/runs/<runId>`); the image runs as the owner of that folder, or as its non-root user when nothing is mounted. In the containers the target isn't localhost, so the `client-only-validation` scenario (localhost only) is planned but skipped, and `csrf` (it needs `localhost` or `127.0.0.1`) is inconclusive; the report says why.

To test an app running on your machine from a container:

- **The pull-and-run container or the test lab, on any OS** (Docker Desktop on a Mac or Windows): enter `http://host.docker.internal:<port>/<page>`. In a container `localhost` is the container itself. Your dev server must listen on all interfaces (`vite --host`) and accept that host name (Vite `server.allowedHosts`, Next.js `allowedDevOrigins`); a frontend that calls its API on `localhost:<apiPort>` won't work this way. The image allows `host.docker.internal` and `host.containers.internal` through the safety gate (its built-in `RUNHOUND_ALLOWED_HOSTS`); `--add-host host.docker.internal:host-gateway` in the commands above, and both compose files, add `host.docker.internal` on Linux. A test account's sign-in page then uses the same host name (`http://host.docker.internal:5173/login`). Details in [TESTING.md](../TESTING.md#test-your-own-app).
- **Linux, another way**: share the host's network, so `localhost` is your machine and nothing in your app changes:
  ```sh
  mkdir -p runs
  docker run --rm --init --network host -v "$PWD/runs:/repo/app/runs" ghcr.io/rahul-bharati/run-hound run http://localhost:5173/signup --approve all
  ```
  For the UI this way, bind it to loopback: `... ghcr.io/rahul-bharati/run-hound serve --host 127.0.0.1 --port 4310`.
