# The four well-built sample apps (fixtures/samples/README.md) in one small image. Each compose service picks one
# with its command. They use only node: built-ins, so there is no install step.
# Build from the repository root:
#   docker build -f fixtures/samples/Dockerfile -t rahulrbharati/run-hound-samples:0.2.0 .
#   docker run --rm -p 127.0.0.1:4102:4102 -e PORT=4102 rahulrbharati/run-hound-samples:0.2.0 node spa-fetch/server.mjs
# The samples are local test targets only: do not expose them to the internet.
FROM node:24-slim
WORKDIR /samples
ENV NODE_ENV=production \
    HOST=0.0.0.0
COPY fixtures/samples/ ./
USER node
CMD ["node", "spa-fetch/server.mjs"]
