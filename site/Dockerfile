# Run Hound marketing site: Next.js "standalone" server. Pages are prerendered at build time; images are resized
# and converted to AVIF/WebP on request by next/image (sharp), then cached on disk.
#
# Coolify: Base Directory "/site", Build Pack "Dockerfile", Port 8080.
# Build variables: NEXT_PUBLIC_SITE_URL (e.g. https://runhound.dev) and, optionally, NEXT_PUBLIC_GA_MEASUREMENT_ID.
# Cloudflare sits in front and sets the security headers and compression; this container adds none of its own.

# ---- Build ----------------------------------------------------------------
# Alpine (musl): sharp ships prebuilt linuxmusl binaries with libvips bundled, and musl avoids the glibc
# memory-allocator issue the Next.js self-hosting guide warns about for image optimisation.
FROM docker.io/library/node:24-alpine AS build
WORKDIR /site

# pnpm version comes from package.json "packageManager".
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

# sharp comes in as Next's optional dependency; pnpm picks the linuxmusl build for this platform.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

# Public URL of the site, used for canonical metadata, sitemap.xml and robots.txt. Inlined at build time.
ARG NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL}
# Google Analytics 4 measurement id ("G-..."). Optional: without it there is no analytics and no consent banner.
ARG NEXT_PUBLIC_GA_MEASUREMENT_ID
ENV NEXT_PUBLIC_GA_MEASUREMENT_ID=${NEXT_PUBLIC_GA_MEASUREMENT_ID}
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# ---- Run ------------------------------------------------------------------
FROM docker.io/library/node:24-alpine AS run
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8080 \
    HOSTNAME=0.0.0.0

# The standalone server with only the files it needs (sharp included), plus the static assets and public/,
# which server.js serves itself when they sit next to it. Owned by "node" so the image cache
# (.next/cache/images) is writable.
COPY --from=build --chown=node:node /site/.next/standalone ./
COPY --from=build --chown=node:node /site/.next/static ./.next/static
COPY --from=build --chown=node:node /site/public ./public

# The official node image's unprivileged user (uid 1000).
USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8080/ || exit 1

CMD ["node", "server.js"]
