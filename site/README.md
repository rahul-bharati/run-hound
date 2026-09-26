# Run Hound site

The marketing and documentation site for Run Hound: home, How it works, Checks, Demo, Docs, Open source and the
legal pages. It's a Next.js app, and its own pnpm project inside the Run Hound repo; it doesn't share the root
workspace.

## Develop

```bash
cd site
pnpm install
pnpm dev     # http://localhost:3000
pnpm lint
pnpm build   # prerenders every page into a standalone server (.next/standalone/server.js), then sets each page's CSP
```

CI (`.github/workflows/ci.yml`) runs `pnpm lint` and `pnpm build` with no variables set.

## Configuration

Both are build-time variables (inlined into the pages):

| Variable | What it does |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Public URL of the site, used for canonical links, `og:url`, the preview image's address, `sitemap.xml` and `robots.txt`. **Required for a deploy**: the Docker build stops without it. A plain `pnpm build` without it prints a warning and uses `http://localhost:3000`, which is fine for trying the site locally and for CI, never for a deploy. |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | Optional Google Analytics 4 id (`G-...`). Without it there is no analytics and no consent banner. |

## Version

`src/lib/site.ts` holds the Run Hound version the site describes. It must equal `app/package.json`: the release
workflow (`release-images.yml`, check-version) fails when they differ. The download links (`curl` of
`run-hound.compose.yml` and `.env.example`) are pinned to that release's tag, so publish the site after the tag is
pushed.

## Security headers

`pnpm build` runs `next build`, then `scripts/csp.mjs`. Next.js puts each page's data in inline scripts; the script
hashes them and writes a Content-Security-Policy that allows exactly those scripts (no `'unsafe-inline'`) into the
page's `.meta` file, whose headers the server sends with the page. `next.config.ts` adds `X-Content-Type-Options`,
`X-Frame-Options` and `Referrer-Policy` to every response and turns off `X-Powered-By`. Run Hound's own
security-headers check passes against the built site.

- Build with `pnpm build`, not `next build` alone, or the pages go out without a CSP.
- An inline `<script>` added at run time (for example `next/script` with inline code) is blocked; load code from a
  file or from a component instead, as the Google Analytics set-up in `components/consent` does.
- Anything that rewrites the HTML after the build (Cloudflare's Rocket Loader, for example) breaks the hashes. After a
  deploy, a page with no CSP errors in the browser console is working.

## Social preview

Every page shares one preview image, `public/social-preview.png` (1200 x 630), set with its alt text in
`src/lib/metadata.ts`, which also gives each page its canonical URL and `og:url`. The image is committed; to change
it, edit `scripts/og-image.mjs` and run `node site/scripts/og-image.mjs` from the repository root (it uses the root
install's Playwright).

## Deploy

The `Dockerfile` builds the standalone server and serves it on port 8080. Pass the variables above as build
arguments:

```bash
docker build -t run-hound-site --build-arg NEXT_PUBLIC_SITE_URL=https://example.com .
docker run -p 8080:8080 run-hound-site
```

Content lives in `src/app` (one folder per page) and `src/components` (shared sections and data such as
`checks/data.ts`). Screenshots and evidence images are static imports from `src/assets/`, so `next/image` can resize them.
