import type { MetadataRoute } from "next";
import { site } from "@/lib/site";

// Route handlers must be marked static to be prerendered with output: "export".
export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  const base = site.url.replace(/\/$/, "");
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
