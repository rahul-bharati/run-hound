# Kennel: the deliberately broken booking app Run Hound is tested against.
# Build from the repository root (the pnpm workspace and lockfile live there):
#   docker build -f fixtures/kennel/Dockerfile -t rahulrbharati/run-hound-kennel:0.2.0 .
#   docker run --rm -p 3000:3000 -p 3001:3001 -e KENNEL_BUGS=none rahulrbharati/run-hound-kennel:0.2.0
# Kennel is a local test target only: do not expose it to the internet.

# ---- build: install the workspace deps for kennel and run `vite build` ----
FROM docker.io/library/node:24-slim AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY fixtures/kennel/package.json fixtures/kennel/package.json
RUN pnpm install --frozen-lockfile --filter kennel...
COPY fixtures/kennel/ fixtures/kennel/
RUN pnpm --filter kennel build

# ---- run: plain Node, no dependencies (the server uses only node: built-ins) ----
FROM docker.io/library/node:24-slim
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
CMD ["node", "server/index.mjs"]
