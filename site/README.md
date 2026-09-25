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
pnpm build   # prerenders every page into a standalone server (.next/standalone/server.js)
```

## Configuration

Both are build-time variables (inlined into the pages):

| Variable | What it does |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Public URL, used for canonical links, `sitemap.xml` and `robots.txt`. Defaults to `http://localhost:3000`. |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | Optional Google Analytics 4 id (`G-...`). Without it there is no analytics and no consent banner. |

## Deploy

The `Dockerfile` builds the standalone server and serves it on port 8080. Pass the variables above as build
arguments:

```bash
docker build -t run-hound-site --build-arg NEXT_PUBLIC_SITE_URL=https://example.com .
docker run -p 8080:8080 run-hound-site
```

Content lives in `src/app` (one folder per page) and `src/components` (shared sections and data such as
`checks/data.ts`). Screenshots and evidence images are static imports from `src/assets/`, so `next/image` can resize them.
