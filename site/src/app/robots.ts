import type { MetadataRoute } from "next";
import { site } from "@/lib/site";

// Prerendered at build time (metadata routes are static by default); force-static keeps it that way.
export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  const base = site.url.replace(/\/$/, "");
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
