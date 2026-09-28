import { writeFileSync } from "node:fs";
import { join } from "node:path";
import createMDX from "@next/mdx";
import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";

// The site is its own pnpm project inside the Run Hound repo. Pin the root here so the standalone build is laid
// out the same locally and in Docker (.next/standalone/server.js), not nested under the repo root's lockfile.
const root = __dirname;

// The build folder: .next, or NEXT_DIST_DIR (for example .next-lab) so several builds of one checkout can run side by
// side. Every build, guard and lab script reads the same variable (scripts/lib/build-output.mjs). Docker and CI leave
// it unset.
const distDir = process.env.NEXT_DIST_DIR || ".next";

// A build in another folder type-checks with a tsconfig of its own, written here at the site's root
// (tsconfig.next-lab.json for .next-lab; git- and docker-ignored). It extends tsconfig.json, so Next.js leaves both
// files alone (it only adds its type folders to a tsconfig that extends nothing), and adds this folder's types, so the
// side build checks what the default build checks through tsconfig.json's ".next/types/**/*.ts": among them
// <folder>/types/validator.ts, where Next.js checks each page's and route handler's exports (a dynamic route whose
// params aren't a Promise fails there). tsconfig.json's own "**/*.ts" skips folders whose names start with a dot, so no
// other build's stale types come in. One file stays shared: next-env.d.ts, which every build points at its own
// folder's route types; while two builds run at once, one can type-check against the other's, which is harmless while
// both build the same tree (the types come from src/app/). scripts/dist-dir.test.mjs checks all of this.
const tsconfigPath = distDir === ".next" ? undefined : `tsconfig.${distDir.replace(/^\./, "").replace(/[^\w.-]+/g, "-")}.json`;
if (tsconfigPath) {
  const tsconfig = {
    extends: "./tsconfig.json",
    include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", "**/*.mts", `${distDir}/types/**/*.ts`],
    exclude: ["node_modules"],
  };
  writeFileSync(join(root, tsconfigPath), `${JSON.stringify(tsconfig, null, 2)}\n`);
}

// Security headers (Run Hound's own security-headers check runs against this site). The Content-Security-Policy is
// set per page after the build by scripts/csp.mjs (pnpm build runs it): it allows each page's own inline scripts by
// hash instead of 'unsafe-inline', and frame-ancestors 'none'. The headers below go on every response. HSTS comes from
// Cloudflare in front of the site. No X-Powered-By (poweredByHeader below).
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

const nextConfig: NextConfig = {
  distDir,
  // The docs pages are MDX (src/content/docs/<slug>.mdx, imported by app/docs/[slug]/page.tsx; DESIGN.md §3.5). An .mdx
  // file under app/ could be a page too; none is.
  pageExtensions: ["tsx", "ts", "jsx", "js", "mdx"],
  ...(tsconfigPath ? { typescript: { tsconfigPath } } : {}),
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
  // A small Node server (.next/standalone/server.js) that serves the prerendered pages and optimises images on
  // request. Every page is still prerendered at build time; see the Dockerfile for how it runs and how the build
  // fills the image cache. (A static export would drop the image optimiser, headers() and the per-page CSP.)
  output: "standalone",
  trailingSlash: true,
  outputFileTracingRoot: root,
  turbopack: { root },
  images: {
    // AVIF first (smallest), WebP for browsers without AVIF. Next picks from the request's Accept header.
    formats: ["image/avif", "image/webp"],
    // Required since Next 16. 75 is the default for photos and small marks; 90 keeps the small UI text in
    // product screenshots and evidence frames crisp.
    qualities: [75, 90],
    // Up to 3840 so a 4K screen (or a 1920 px wide window at 2x) gets a full-resolution screenshot. 1440, 1536,
    // 2560 and 3200 fill the gaps that laptops at 2x would otherwise round up to the next, much larger, size (1536:
    // the 768 px docs screenshots at 2x). Every width here is one more file per image in the image cache, which the
    // Docker build fills (scripts/warm-images.mjs).
    deviceSizes: [640, 750, 828, 1080, 1200, 1440, 1536, 1920, 2048, 2560, 3200, 3840],
    // Every raster image is a static import (hashed, served from /_next/static/media/). Only those may be
    // optimised, so nobody can make the server resize arbitrary files.
    localPatterns: [{ pathname: "/_next/static/media/**", search: "" }],
    // Hashed static imports are cached for a year (immutable) anyway. This floor covers anything else.
    minimumCacheTTL: 2678400, // 31 days
  },
};

// MDX through @next/mdx 16.3.5 (node_modules/next/dist/docs/01-app/02-guides/mdx.md). Turbopack takes plugins named as
// strings, which the loader resolves from the MDX file's folder (@next/mdx mdx-js-loader.js), so the one plugin is named
// by its absolute path: components/docs-shell/remark-docs.mjs pins heading ids (`## Title \{#id\}`), passes a
// fence's label to the CodeBlock and places the inline "On this page" after the opening paragraph. No other plugin: the docs are CommonMark (tables are JSX), so nothing else is needed.
const withMDX = createMDX({
  options: {
    remarkPlugins: [join(root, "src", "components", "docs-shell", "remark-docs.mjs")],
  },
});

export default function config(phase: string): NextConfig {
  // The public URL is inlined into canonical links, og:url, sitemap.xml and robots.txt at build time (lib/site.ts).
  // A build without it is fine for trying the site locally and for CI, but not for a deploy: say so loudly. The
  // Dockerfile refuses to build without it.
  if (phase === PHASE_PRODUCTION_BUILD && !process.env.NEXT_PUBLIC_SITE_URL) {
    const line = "!".repeat(100);
    console.warn(
      `\n${line}\n! NEXT_PUBLIC_SITE_URL is not set: canonical links, og:url, sitemap.xml and robots.txt will point at\n` +
        `! http://localhost:3000. Fine for a local build or CI; never deploy this build. Set it, e.g.\n` +
        `! NEXT_PUBLIC_SITE_URL=https://example.com pnpm build\n${line}\n`,
    );
  }
  return withMDX(nextConfig);
}
