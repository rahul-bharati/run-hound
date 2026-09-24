# Run Hound marketing site: a static Next.js export served by nginx.
# Build context is this folder (in Coolify: Base Directory "/site", Build Pack "Dockerfile", Port 8080).

# ---- Build ----------------------------------------------------------------
FROM docker.io/library/node:24-alpine AS build
WORKDIR /site

# pnpm version comes from package.json "packageManager".
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

# Public URL of the site, used for canonical metadata, sitemap.xml and robots.txt.
# In Coolify, add NEXT_PUBLIC_SITE_URL as a build variable (e.g. https://runhound.dev).
ARG NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL}
# Google Analytics 4 measurement id ("G-..."). Optional: without it there is no analytics and no consent banner.
ARG NEXT_PUBLIC_GA_MEASUREMENT_ID
ENV NEXT_PUBLIC_GA_MEASUREMENT_ID=${NEXT_PUBLIC_GA_MEASUREMENT_ID}
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# ---- Serve ----------------------------------------------------------------
# nginx-unprivileged runs as a non-root user and listens on 8080.
FROM docker.io/nginxinc/nginx-unprivileged:alpine AS serve

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /site/out /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8080/ || exit 1
