import type { MetadataRoute } from "next";
import { sitemapEntries } from "@/lib/nav";
import { site } from "@/lib/site";

// Prerendered at build time (metadata routes are static by default); force-static keeps it that way.
export const dynamic = "force-static";

/**
 * Every indexable page of the site, from the route registry (content/routes.ts, through lib/nav.ts), so a new page
 * can't be missed and an internal route such as /_design/ is never listed (scripts/check-seo.mjs also fails the build
 * when an indexable page is missing here).
 * The pages about the product change with each release: their lastmod is the release date (site.releasedIso). The
 * legal pages change when their "Last updated" date says (site.legalUpdatedIso). Never the build time: a date that
 * moves on every deploy tells search engines nothing. (git history isn't available in the Docker build: its context is
 * site/ alone.) Search engines mostly ignore priority; it only ranks the pages against each other.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = site.url.replace(/\/$/, "");
  return sitemapEntries().map(({ path, lastModified, priority }) => ({
    // trailingSlash: true in next.config, so canonical URLs end with "/".
    url: `${base}${path}`,
    lastModified,
    changeFrequency: "monthly",
    priority,
  }));
}
