# Kennel: the deliberately broken booking app Run Hound is tested against.
# Published as ghcr.io/rahul-bharati/run-hound-kennel:0.4.1. Build it yourself from the repository root (the pnpm
# workspace and lockfile live there):
#   docker build -f fixtures/kennel/Dockerfile -t localhost/run-hound-kennel:dev .
#   docker run --rm --init -p 127.0.0.1:3000:3000 -p 127.0.0.1:3001:3001 -e KENNEL_BUGS=none \
#     ghcr.io/rahul-bharati/run-hound-kennel:0.4.1
# Kennel is a local test target only (its planted bugs include public secret keys and a CORS hole): publish its
# ports on 127.0.0.1 as above and never expose it to your network or the internet.

# ---- build: install the workspace deps for kennel and run `vite build` ----
# Pinned to an exact Node release, like app/Dockerfile, so a rebuild of a tag gets the same base.
FROM docker.io/library/node:24.21.0-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY fixtures/kennel/package.json fixtures/kennel/package.json
RUN pnpm install --frozen-lockfile --filter kennel...
COPY fixtures/kennel/ fixtures/kennel/
RUN pnpm --filter kennel build

# ---- run: plain Node, no dependencies (the server uses only node: built-ins) ----
FROM docker.io/library/node:24.21.0-bookworm-slim
WORKDIR /kennel
ENV NODE_ENV=production \
    PORT=3000 \
    ANALYTICS_PORT=3001 \
    HOST=0.0.0.0 \
    KENNEL_BUGS=none
COPY --from=build /repo/fixtures/kennel/package.json ./package.json
COPY --from=build /repo/fixtures/kennel/server ./server
COPY --from=build /repo/fixtures/kennel/dist ./dist
COPY --from=build /repo/fixtures/kennel/bugs.json ./bugs.json
USER node
EXPOSE 3000 3001
# Healthy while the booking page's server answers (any status below 500; / redirects to /book). No curl in the
# image, so Node's fetch does it.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/', { redirect: 'manual', signal: AbortSignal.timeout(4000) }).then((r) => process.exit(r.status < 500 ? 0 : 1), () => process.exit(1))"]
CMD ["node", "server/index.mjs"]
