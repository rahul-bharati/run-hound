# The five well-built sample apps (classic-post, spa-fetch, login, cross-origin-api, multi-form; see
# fixtures/samples/README.md) in one small image. Each compose service picks one with its command. They use only
# node: built-ins, so there is no install step.
# Published as ghcr.io/rahul-bharati/run-hound-samples:0.4.0. Build it yourself from the repository root:
#   docker build -f fixtures/samples/Dockerfile -t localhost/run-hound-samples:dev .
#   docker run --rm --init -p 127.0.0.1:4102:4102 -e PORT=4102 ghcr.io/rahul-bharati/run-hound-samples:0.4.0 \
#     node spa-fetch/server.mjs
# The samples are local test targets only: do not expose them to the internet.
# Pinned to an exact Node release, like app/Dockerfile, so a rebuild of a tag gets the same base.
FROM docker.io/library/node:24.21.0-bookworm-slim
WORKDIR /samples
ENV NODE_ENV=production \
    HOST=0.0.0.0
COPY fixtures/samples/ ./
USER node
# Healthy while the sample answers on PORT (any status below 500). Without PORT each sample uses its own default
# port, so any of them answering counts. No curl in the image, so Node's fetch does it.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "const ports = process.env.PORT ? [process.env.PORT] : [4101, 4102, 4103, 4104, 4106]; Promise.any(ports.map((p) => fetch('http://127.0.0.1:' + p + '/', { redirect: 'manual', signal: AbortSignal.timeout(4000) }).then((r) => { if (r.status >= 500) throw new Error(String(r.status)); }))).then(() => process.exit(0), () => process.exit(1))"]
CMD ["node", "spa-fetch/server.mjs"]
