# Run Hound: local UI + API on port 4000, with Playwright Chromium included.
# Build from the repository root (the pnpm workspace and lockfile live there):
#   docker build -f app/Dockerfile -t run-hound .
#   docker run --rm -p 127.0.0.1:4000:4000 run-hound
# Run Hound only tests localhost, private addresses and hosts listed in RUNHOUND_ALLOWED_HOSTS
# (e.g. -e RUNHOUND_ALLOWED_HOSTS=kennel when the target is another compose service).

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

# pwuser is the non-root user that ships with the Playwright image; runs/ is where reports go.
RUN mkdir -p /repo/app/runs && chown -R pwuser:pwuser /repo/app/runs
USER pwuser
WORKDIR /repo/app

EXPOSE 4000
# --init in `docker run` (or init: true in compose) is recommended so Chromium child processes get reaped.
# With nodeLinker: hoisted the binaries live in the workspace root, not app/node_modules.
CMD ["/repo/node_modules/.bin/tsx", "src/cli.ts", "serve", "--host", "0.0.0.0", "--port", "4000"]
