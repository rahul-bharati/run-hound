# Run Hound: local UI + API on port 4000, with Playwright Chromium included.
# Published as ghcr.io/rahul-bharati/run-hound:0.3.0 (linux/amd64, linux/arm64), so running it needs no clone; the
# commands below work from any folder. To build it yourself, from the repository root (the pnpm workspace and
# lockfile live there):
#   docker build -f app/Dockerfile -t ghcr.io/rahul-bharati/run-hound:0.3.0 .
# Web UI (open http://localhost:4000; the --add-host and allowed-hosts flags let it reach your machine as
# host.docker.internal on Linux too):
#   mkdir -p runs
#   docker run --rm --init -p 127.0.0.1:4000:4000 --add-host host.docker.internal:host-gateway \
#     -e RUNHOUND_ALLOWED_HOSTS=host.docker.internal -v "$PWD/runs:/repo/app/runs" ghcr.io/rahul-bharati/run-hound:0.3.0
# Command line against an app on your machine (Linux; the container shares the host's network):
#   docker run --rm --init --network host -v "$PWD/runs:/repo/app/runs" ghcr.io/rahul-bharati/run-hound:0.3.0 \
#     run http://localhost:5173/signup --approve all
# Run Hound only tests localhost, private addresses and hosts listed in RUNHOUND_ALLOWED_HOSTS
# (e.g. -e RUNHOUND_ALLOWED_HOSTS=kennel when the target is another compose service). See TESTING.md; the whole test
# lab from published images is run-hound.compose.yml at the repository root.

# The image tag must match the installed "playwright" version so the bundled browsers fit.
FROM mcr.microsoft.com/playwright:v1.63.0-noble

ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /repo

# pnpm comes from the root package.json "packageManager" field via corepack (install time only).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY app/package.json app/package.json
RUN corepack enable && pnpm install --frozen-lockfile --prod --filter run-hound...

# Only the sources; never the host's node_modules or runs.
COPY app/tsconfig.json app/tsconfig.json
COPY app/src app/src
COPY --chmod=755 app/docker-entrypoint.sh /usr/local/bin/run-hound-entrypoint

# Reports go to /repo/app/runs; mount a folder there to keep them. The entrypoint starts as root only to pick the
# user: the owner of a mounted runs folder (so the reports on your machine are yours), else pwuser, the non-root
# user that ships with the Playwright image. Running with --user skips that and uses the given user.
RUN mkdir -p /repo/app/runs && chown -R pwuser:pwuser /repo/app/runs
WORKDIR /repo/app

EXPOSE 4000
# --init in `docker run` (or init: true in compose) is recommended so Chromium child processes get reaped.
# serve binds 0.0.0.0 inside the container so a published port reaches it; publish it on 127.0.0.1 only.
# With --network host, pass `serve --host 127.0.0.1 --port <port>` instead so the UI isn't exposed to your network.
ENTRYPOINT ["/usr/local/bin/run-hound-entrypoint"]
CMD ["serve", "--host", "0.0.0.0", "--port", "4000"]
