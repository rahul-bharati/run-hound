import type { MetadataRoute } from "next";
import { site } from "@/lib/site";

// Prerendered at build time (metadata routes are static by default); force-static keeps it that way.
export const dynamic = "force-static";

/**
 * The web app manifest (/manifest.webmanifest; Next.js links it from every page): the name, colours and icons a
 * browser uses when the site is bookmarked or added to a home screen. It is a website, not an installable app, so it
 * opens in the browser. The colours are the brand's page background (docs/brand.md, `bg`), as in the layout's
 * theme-color. The icons are the files Next.js serves from src/app: icon.png and apple-icon.png (the mark on a
 * #0A1014 rounded square) and favicon.ico (16, 32 and 48 px, made from icon.png).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: site.name,
    short_name: site.name,
    description: site.description,
    lang: "en",
    start_url: "/",
    scope: "/",
    display: "browser",
    background_color: "#0a1014",
    theme_color: "#0a1014",
    icons: [
      { src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png", purpose: "any" },
      { src: "/favicon.ico", sizes: "48x48 32x32 16x16", type: "image/x-icon" },
    ],
  };
}
