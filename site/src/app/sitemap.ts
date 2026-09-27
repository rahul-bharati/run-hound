import type { MetadataRoute } from "next";
import { aiBuiltPage } from "@/components/ai-built/data";
import { comparePage } from "@/components/compare/data";
import { faqPage } from "@/components/faq/data";
import { legalNav, mainNav, site } from "@/lib/site";

// Prerendered at build time (metadata routes are static by default); force-static keeps it that way.
export const dynamic = "force-static";

/**
 * Every page of the site, from the same lists and page data the header and footer link, so a new page in a nav can't
 * be missed (scripts/check-seo.mjs also fails the build when an indexable page is missing here).
 * The pages about the product change with each release: their lastmod is the release date (site.releasedIso). The
 * legal pages change when their "Last updated" date says (site.legalUpdatedIso). Never the build time: a date that
 * moves on every deploy tells search engines nothing. (git history isn't available in the Docker build: its context is
 * site/ alone.)
 */
const productPaths = [
  "/",
  ...mainNav.map((item) => item.href),
  // Not in the header; the footer and the pages link them. Their paths end with "/", the nav's don't.
  ...[aiBuiltPage, faqPage, comparePage].map((page) => page.path.replace(/\/$/, "")),
];
const legalPaths = legalNav.map((item) => item.href);

// Search engines mostly ignore priority; it only ranks the pages against each other.
const priorities: Record<string, number> = {
  "/": 1,
  "/how-it-works": 0.8,
  "/checks": 0.8,
  "/demo": 0.8,
  "/docs": 0.8,
  "/ai-built-apps": 0.8,
  "/open-source": 0.7,
  "/faq": 0.7,
  "/compare": 0.7,
  "/security": 0.4,
};

export default function sitemap(): MetadataRoute.Sitemap {
  const base = site.url.replace(/\/$/, "");
  const entry = (path: string, lastModified: string): MetadataRoute.Sitemap[number] => ({
    // trailingSlash: true in next.config, so canonical URLs end with "/".
    url: path === "/" ? `${base}/` : `${base}${path}/`,
    lastModified,
    changeFrequency: "monthly",
    priority: priorities[path] ?? 0.3,
  });
  return [
    ...productPaths.map((path) => entry(path, site.releasedIso)),
    ...legalPaths.map((path) => entry(path, site.legalUpdatedIso)),
  ];
}
