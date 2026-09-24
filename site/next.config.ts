import type { NextConfig } from "next";

// The site is its own pnpm project inside the Run Hound repo. Pin the root here so the standalone build is laid
// out the same locally and in Docker (.next/standalone/server.js), not nested under the repo root's lockfile.
const root = __dirname;

const nextConfig: NextConfig = {
  // A small Node server (.next/standalone/server.js) that serves the prerendered pages and optimises images on
  // request. Every page is still prerendered at build time; see the Dockerfile for how it runs.
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
    // Up to 3840 so a 4K screen (or a 1920 px wide window at 2x) gets a full-resolution screenshot. 1440, 2560
    // and 3200 fill the gaps that laptops at 2x would otherwise round up to the next, much larger, size.
    deviceSizes: [640, 750, 828, 1080, 1200, 1440, 1920, 2048, 2560, 3200, 3840],
    // Every raster image is a static import (hashed, served from /_next/static/media/). Only those may be
    // optimised, so nobody can make the server resize arbitrary files.
    localPatterns: [{ pathname: "/_next/static/media/**", search: "" }],
    // Hashed static imports are cached for a year (immutable) anyway. This floor covers anything else.
    minimumCacheTTL: 2678400, // 31 days
  },
};

export default nextConfig;
