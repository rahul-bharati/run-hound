import type { MetadataRoute } from "next";
import { site } from "@/lib/site";

// Prerendered at build time (metadata routes are static by default); force-static keeps it that way.
export const dynamic = "force-static";

const routes = [
  { path: "/", priority: 1 },
  { path: "/how-it-works", priority: 0.8 },
  { path: "/checks", priority: 0.8 },
  { path: "/demo", priority: 0.8 },
  { path: "/docs", priority: 0.8 },
  { path: "/open-source", priority: 0.7 },
  { path: "/security", priority: 0.4 },
  { path: "/privacy", priority: 0.3 },
  { path: "/terms", priority: 0.3 },
  { path: "/acceptable-use", priority: 0.3 },
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const base = site.url.replace(/\/$/, "");
  return routes.map(({ path, priority }) => ({
    // trailingSlash: true in next.config, so canonical URLs end with "/".
    url: path === "/" ? `${base}/` : `${base}${path}/`,
    changeFrequency: "monthly",
    priority,
  }));
}
