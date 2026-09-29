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

CI (`.github/workflows/ci.yml`) runs `pnpm lint`, `pnpm test` and `pnpm build` with no variables set, and the lab
below in its `site-lab` job.

## Content and the build guards

Every word a contributor edits lives in `src/content/`: the route registry (`src/content/routes.ts` and
`src/content/routes/`) names every page, its title, description, promised anchors and place in the header, footer,
docs sidebar, breadcrumbs, sitemap and `llms.txt`; the docs pages are MDX in `src/content/docs/`. `pnpm build` runs,
after `next build` and `scripts/csp.mjs`: `check-seo.mjs --strict` (titles, descriptions, canonicals, JSON-LD),
`check-registry.mjs` (no broken internal link, missing `#fragment` or orphan page), `check-copy.mjs` (the homepage's
750 words), `check-security-txt.mjs`, `pagefind.mjs` (the search index, exactly the registry's searchable pages) and
`check-budgets.mjs` (JS, HTML and font bytes against `budgets.json`). Each fails the build.

To build next to another build of the same checkout, set `NEXT_DIST_DIR` (`NEXT_DIST_DIR=.next-lab pnpm build`): every
build, guard and lab script reads it.

## The lab

`pnpm lab` serves the standalone build the way the Docker image does (on port 4870, or `--port`; never 3000) and runs
the Playwright specs in `scripts/lab/specs/` against it with Chromium, one file at a time: words, screens, LCP and
CLS (throttled), the motion contract, axe-core on every page at two sizes with motion on and reduced, the keyboard,
reflow at 320 px, CSP violations, search, the release gate (`release-gate.spec.mjs`, every route) and a smoke set in
Firefox and WebKit (`cross-browser.spec.mjs`). Name specs to run only those (`pnpm lab home search`). The baseline
(`pnpm lab baseline`) and the external links (`pnpm lab external-links`, weekly in
`.github/workflows/site-links.yml`) run only when named. Output (JSON per spec, screenshots) goes to
`.lab-out/<build>/`, which is git-ignored; CI runs the lab as a matrix (`--shard`) and keeps each shard's output as
its own artefact, `site-lab-<n>`.

```bash
pnpm exec playwright install chromium firefox webkit   # once; WebKit also needs: sudo pnpm exec playwright install-deps webkit
pnpm build && pnpm lab
```

`node scripts/lab/five-second/capture.mjs` (with the lab's server running) saves the screenshot pack for the people
tests: the first screen of the homepage at 1440×900 and 390×844, and the hero run's frames.

## Configuration

Both are build-time variables (inlined into the pages):

| Variable | What it does |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Public URL of the site, used for canonical links, `og:url`, the preview image's address, `sitemap.xml` and `robots.txt`. **Required for a deploy**: the Docker build stops without it. A plain `pnpm build` without it prints a warning and uses `http://localhost:3000`, which is fine for trying the site locally and for CI, never for a deploy. |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | Optional Google Analytics 4 id (`G-...`). Without it there is no analytics and no consent banner. |

## Version

`src/lib/site.ts` holds the Run Hound version the site describes (`version`, `released`, `releasedIso`), set by hand
in the same commit as `app/package.json`'s version and the CHANGELOG section for it (docs/development.md
"Releasing"). The release workflow (`release-images.yml`, check-version) no longer checks it against the git tag
(docs/decisions/09-2026.md#2026-09-29-images-latest-no-version-pins); `app/test/cli-version.test.ts` still checks
`released` and `releasedIso` are the same day and match the CHANGELOG heading of `site.ts`'s own version. The
download links (`curl` of `run-hound.compose.yml` and the settings asset, `run-hound.env.example`) point at the
latest GitHub Release, which `release-images.yml` creates only once every image is pushed, so they never name images
GHCR doesn't have yet; the
site itself can be deployed any time, not only after a tag is pushed.

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
- Cloudflare's Bot Fight Mode injects an inline script into challenged pages; the CSP blocks it, since its hash can't
  be known at build time. Leave Bot Fight Mode, Rocket Loader and email obfuscation off for this site (they are
  dashboard settings, kept with the maintainer), or expect a `securitypolicyviolation` in the console where they act.

## Social preview

Every page shares one preview image, `public/social-preview.png` (1200 x 630), set with its alt text in
`src/lib/metadata.ts`, which also gives each page its canonical URL and `og:url`. The image is committed; to change
it, edit `scripts/og-image.mjs` and run `node site/scripts/og-image.mjs` from the repository root (it uses the root
install's Playwright).

## Motion and the GSAP licence

The site's motion (`src/motion/`) uses GSAP 3.15.0 with ScrollTrigger and DrawSVG, pinned, loaded only after the load
event plus idle and only when `prefers-reduced-motion` is `no-preference` and Save-Data is off; text never moves. GSAP
is free to use but not open source: it ships under GreenSock's standard "no charge" licence
(https://gsap.com/standard-license, as its `package.json` says), not an OSI licence like the rest of the site's
dependencies. If that licence stops fitting, the swap path is Motion (MIT) or the Web Animations API: the storyboards
in `src/motion/` are data, and only the builder and the islands import GSAP.

## Deploy

The `Dockerfile` builds the standalone server and serves it on port 8080. Pass the variables above as build
arguments:

```bash
docker build -t run-hound-site --build-arg NEXT_PUBLIC_SITE_URL=https://example.com .
docker run -p 8080:8080 run-hound-site
```

Pages live in `src/app` (one folder per page), their words and data in `src/content`, and the parts they share in
`src/components` (the primitives in `src/components/primitives/`, shown in every state at `/_design/`, which is
never indexed or linked). Screenshots and evidence images are static imports from `src/assets/`, so `next/image` can
resize them.
