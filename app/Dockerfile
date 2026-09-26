# Run Hound: local UI + API on port 4000, with Playwright's Chromium (715 MB unpacked, about 260 MB to download).
# Published as ghcr.io/rahul-bharati/run-hound:0.5.0 (linux/amd64, linux/arm64), so running it needs no clone; the
# commands below work from any folder. To build it yourself, from the repository root (the pnpm workspace and
# lockfile live there):
#   docker build -f app/Dockerfile -t localhost/run-hound:dev .
# Web UI (open http://localhost:4000; apps on your machine are http://host.docker.internal:<port>, which --add-host
# defines on Linux; Docker Desktop defines it itself; settings saved in the UI go to ./runs/.config):
#   mkdir -p runs
#   docker run --rm --init -p 127.0.0.1:4000:4000 --add-host host.docker.internal:host-gateway \
#     -v "$PWD/runs:/repo/app/runs" ghcr.io/rahul-bharati/run-hound:0.5.0
# Command line against an app on your machine (Linux; the container shares the host's network):
#   docker run --rm --init --network host -v "$PWD/runs:/repo/app/runs" ghcr.io/rahul-bharati/run-hound:0.5.0 \
#     run http://localhost:5173/signup --approve all
# Run Hound only tests localhost, private addresses and hosts listed in RUNHOUND_ALLOWED_HOSTS
# (e.g. -e RUNHOUND_ALLOWED_HOSTS=kennel when the target is another compose service). See TESTING.md; the whole test
# lab from published images is run-hound.compose.yml at the repository root.
#
# Browser: only Chromium's headless shell (chromium_headless_shell), which is what Run Hound launches
# (chromium.launch with headless: true), plus Playwright's small ffmpeg. No Firefox, WebKit or full Chromium: headed
# mode (--headed, "Show the browser window" in the UI) needs the full Chromium and a display, and a container has no
# display, so Run Hound refuses it here anyway. Run Run Hound from a clone on your desktop to watch the browser.

# Debian 12 (bookworm), a platform Playwright supports for Chromium on amd64 and arm64. Pinned to an exact Node
# release so a rebuild of a tag gets the same base; bump it on purpose (and the other Dockerfiles with it).
FROM docker.io/library/node:24.21.0-bookworm-slim

ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# Defaults for a plain `docker run` (the compose files set their own; -e overrides either):
# - the names Docker and Podman give the machine running the container, so an app there is reachable as
#   http://host.docker.internal:<port>. They only ever point at that machine; nothing public is added.
# - settings saved in the UI (AI, test accounts) go to the reports folder, so a mounted ./runs keeps them.
ENV RUNHOUND_ALLOWED_HOSTS=host.docker.internal,host.containers.internal \
    RUNHOUND_CONFIG_DIR=/repo/app/runs/.config
WORKDIR /repo

# pnpm comes from the root package.json "packageManager" field via corepack (install time only). The image installs
# with pnpm's isolated linker, not the workspace's hoisted one: only Run Hound's own production dependencies land in
# it (the hoisted layout would also bring Kennel's and Fernway's React packages). The entrypoint starts the CLI as
# /repo/node_modules/.bin/tsx, so that path links to Run Hound's tsx.
# The browser is downloaded by the installed playwright package itself, so its build always matches that package:
# there is no separate browser version to keep in step. The build fails if the installed playwright isn't the exact
# version app/package.json pins, or if Chromium can't start (checked on native builds only: Chromium under QEMU, as in
# the release's arm64 build, is too unreliable to gate on).
# Fonts: Playwright's list (Liberation, Noto Color Emoji, WenQuanYi Zen Hei, IPA Gothic, ...) plus DejaVu, so
# sans-serif, serif and monospace text in screenshots and evidence cards gets a proper Latin font. xvfb, which
# Playwright's list also installs for headed runs, is removed again with the Mesa/LLVM libraries it pulls in.
# pwuser (uid 1001) is the non-root user the entrypoint switches to, as in Playwright's own image.
ARG TARGETARCH
ARG BUILDARCH
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY app/package.json app/package.json
RUN set -eux; \
    corepack enable; \
    pnpm install --frozen-lockfile --prod --filter run-hound... --config.node-linker=isolated; \
    mkdir -p node_modules/.bin; \
    ln -s ../../app/node_modules/.bin/tsx node_modules/.bin/tsx; \
    pinned=$(node -p "require('./app/package.json').dependencies.playwright"); \
    installed=$(node -p "require('./app/node_modules/playwright/package.json').version"); \
    if [ "$pinned" != "$installed" ]; then \
      echo "playwright $installed is installed but app/package.json pins $pinned" >&2; exit 1; \
    fi; \
    app/node_modules/.bin/playwright install --with-deps --only-shell chromium; \
    apt-get install -y --no-install-recommends fonts-dejavu-core fonts-liberation fonts-noto-color-emoji; \
    apt-get purge -y --auto-remove xvfb; \
    if [ "${TARGETARCH:-}" = "${BUILDARCH:-}" ]; then \
      node -e "require('/repo/app/node_modules/playwright').chromium.launch().then(async (b) => { console.log('Chromium', b.version()); await b.close(); })"; \
    fi; \
    useradd --create-home --uid 1001 --user-group --shell /bin/bash pwuser; \
    corepack disable; \
    rm -rf /var/lib/apt/lists/* /root/.cache /root/.local /root/.npm /tmp/*

# Only the sources; never the host's node_modules or runs.
COPY app/tsconfig.json app/tsconfig.json
COPY app/src app/src
COPY --chmod=755 app/docker-entrypoint.sh /usr/local/bin/run-hound-entrypoint

# Health check (also used by the compose files): healthy when `serve` answers on the port it was started with, or
# when the container isn't serving at all, so a one-shot `run` is never reported unhealthy.
COPY --chmod=755 <<'EOF' /usr/local/bin/run-hound-healthcheck
#!/usr/bin/env node
"use strict";
const { readdirSync, readFileSync } = require("node:fs");

// The arguments after `src/cli.ts serve` of the running server, or null when nothing in this container serves.
function serveArgs() {
  for (const pid of readdirSync("/proc")) {
    if (!/^\d+$/.test(pid)) continue;
    let argv;
    try {
      argv = readFileSync("/proc/" + pid + "/cmdline", "utf8").split("\0");
    } catch {
      continue;
    }
    const cli = argv.findIndex((a) => a.endsWith("src/cli.ts"));
    if (cli !== -1 && argv[cli + 1] === "serve") return argv.slice(cli + 2);
  }
  return null;
}

function option(args, name, fallback) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--" + name) return args[i + 1] || fallback;
    if (args[i].startsWith("--" + name + "=")) return args[i].slice(name.length + 3) || fallback;
  }
  return fallback;
}

const args = serveArgs();
if (!args) process.exit(0);
let host = option(args, "host", "127.0.0.1");
if (host === "0.0.0.0" || host === "::") host = "127.0.0.1";
if (host.includes(":")) host = "[" + host + "]";
const port = option(args, "port", "4000");
fetch("http://" + host + ":" + port + "/", { redirect: "manual", signal: AbortSignal.timeout(4000) }).then(
  (res) => process.exit(res.ok ? 0 : 1),
  () => process.exit(1),
);
EOF

# Reports go to /repo/app/runs; mount a folder there to keep them. The entrypoint starts as root only to pick the
# user: the owner of a mounted runs folder (so the reports on your machine are yours), else pwuser, the image's
# non-root user. Running with --user skips that and uses the given user.
RUN mkdir -p /repo/app/runs && chown -R pwuser:pwuser /repo/app/runs
WORKDIR /repo/app

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["node", "/usr/local/bin/run-hound-healthcheck"]
# --init in `docker run` (or init: true in compose) is recommended so Chromium child processes get reaped and
# `docker stop` is quick.
# serve binds 0.0.0.0 inside the container so a published port reaches it; publish it on 127.0.0.1 only.
# With --network host, pass `serve --host 127.0.0.1 --port <port>` instead so the UI isn't exposed to your network.
ENTRYPOINT ["/usr/local/bin/run-hound-entrypoint"]
CMD ["serve", "--host", "0.0.0.0", "--port", "4000"]
