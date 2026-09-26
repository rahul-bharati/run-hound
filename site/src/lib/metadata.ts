import type { Metadata } from "next";
import { site } from "@/lib/site";

/**
 * The social preview image every page shares (og:image and twitter:image), rendered by scripts/og-image.mjs into
 * public/. metadataBase (site.url) makes the path absolute.
 */
export const socialImage = {
  url: "/social-preview.png",
  width: 1200,
  height: 630,
  type: "image/png",
  alt: "Run Hound, open source under MIT: find the bugs your AI forgot to test. AI-assisted UI testing for AI-built apps, with real checks in a real browser.",
};

/**
 * Metadata for one page: its title, a description short enough for a search snippet (about 155 characters at most),
 * and its canonical URL, also used as og:url. `path` ends with "/" like every URL on the site (trailingSlash in
 * next.config.ts); the layout's metadataBase (site.url) makes it absolute.
 *
 * A page's `openGraph` replaces the layout's whole object (Next.js merges metadata shallowly), so the shared fields and
 * the preview image are repeated here. twitter:image comes from the layout, which no page overrides.
 */
export function pageMetadata({
  path,
  title,
  description,
  absoluteTitle = false,
}: {
  path: string;
  title: string;
  description: string;
  /** Use the title as it is, without the " · Run Hound" suffix of the layout's title template. */
  absoluteTitle?: boolean;
}): Metadata {
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    alternates: { canonical: path },
    openGraph: {
      siteName: site.name,
      type: "website",
      locale: "en_US",
      url: path,
      title: absoluteTitle ? title : `${title} · ${site.name}`,
      description,
      images: [socialImage],
    },
  };
}
