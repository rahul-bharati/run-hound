# Fernway: a polished, AI-builder-style SaaS app (Vite + React + Tailwind v4 + shadcn/ui-style components) that
# Run Hound is tested against. Clean by default; FERNWAY_BUGS plants bugs (see CONTRACT.md).
# Build from the repository root (the pnpm workspace and lockfile live there):
#   docker build -f fixtures/fernway/Dockerfile -t ghcr.io/rahul-bharati/run-hound-fernway:0.5.0 .
#   docker run --rm -p 127.0.0.1:4110:4110 -e FERNWAY_BUGS=none ghcr.io/rahul-bharati/run-hound-fernway:0.5.0
# Fernway is a local test target only: do not expose it to the internet.

# ---- build: install the workspace deps for fernway and run `vite build` ----
FROM docker.io/library/node:24.21.0-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY fixtures/fernway/package.json fixtures/fernway/package.json
RUN pnpm install --frozen-lockfile --filter fernway...
COPY fixtures/fernway/ fixtures/fernway/
RUN pnpm --filter fernway build

# ---- run: plain Node, no dependencies (the server uses only node: built-ins) ----
FROM docker.io/library/node:24.21.0-bookworm-slim
WORKDIR /fernway
ENV NODE_ENV=production \
    PORT=4110 \
    HOST=0.0.0.0 \
    FERNWAY_BUGS=none
COPY --from=build /repo/fixtures/fernway/package.json ./package.json
COPY --from=build /repo/fixtures/fernway/server ./server
COPY --from=build /repo/fixtures/fernway/dist ./dist
USER node
EXPOSE 4110
# Healthy while the app's server answers (any status below 500). No curl in the image, so Node's fetch does it.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 4110) + '/', { redirect: 'manual', signal: AbortSignal.timeout(4000) }).then((r) => process.exit(r.status < 500 ? 0 : 1), () => process.exit(1))"]
CMD ["node", "server/index.mjs"]
