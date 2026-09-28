import type { Metadata } from "next";
import { route, type RouteId } from "@/content/routes";
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
 * Fields every page carries: its author (meta name="author" and link rel="author", plus meta name="creator"), and
 * permission for search engines to show a large image preview (meta name="robots" content="max-image-preview:large";
 * indexing and following stay at their defaults). Every page gets these through pageMetadata; the root layout sets no
 * robots, so the 404 page carries only the noindex Next.js adds.
 */
export const sharedMetadata = {
  authors: [{ name: site.maintainer.name, url: site.maintainer.url }],
  creator: site.maintainer.name,
  robots: { "max-image-preview": "large" },
} satisfies Metadata;

/** The page's title as the browser shows it: the layout's title template adds " · Run Hound" unless it's absolute. */
export function pageTitle({ title, absoluteTitle = false }: { title: string; absoluteTitle?: boolean }): string {
  return absoluteTitle ? title : `${title} · ${site.name}`;
}

/**
 * Metadata for one page: its title, a description short enough for a search snippet (about 155 characters at most),
 * and its canonical URL, also used as og:url. `path` ends with "/" like every URL on the site (trailingSlash in
 * next.config.ts); the layout's metadataBase (site.url) makes it absolute.
 *
 * A page's `openGraph` replaces the layout's whole object (Next.js merges metadata shallowly), so the shared fields and
 * the preview image are repeated here. twitter:image comes from the layout, which no page overrides.
 *
 * Keep the same path, title and description for the page's structured data (webPageNode in lib/structured-data.ts,
 * with `name: pageTitle(page)`): scripts/check-seo.mjs fails the build when its WebPage url and the canonical differ.
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
    ...sharedMetadata,
    openGraph: {
      siteName: site.name,
      type: "website",
      locale: "en_US",
      url: path,
      title: pageTitle({ title, absoluteTitle }),
      description,
      images: [socialImage],
    },
  };
}

/**
 * A registered page's metadata (content/routes.ts): its title, description and canonical path from the registry, so
 * the page, its structured data (routeGraph in lib/structured-data.ts), the sitemap and the build guards agree. An
 * internal route (indexable: false, such as /_design/) is noindex and nofollow, with no canonical or social card: Next.js
 * merges metadata one field at a time, so openGraph and twitter are null, or the page would inherit the layout's.
 */
export function routeMetadata(id: RouteId): Metadata {
  const { path, title, description, absoluteTitle, indexable } = route(id);
  if (!indexable) {
    return {
      title: absoluteTitle ? { absolute: title } : title,
      description,
      robots: { index: false, follow: false },
      openGraph: null,
      twitter: null,
    };
  }
  return pageMetadata({ path, title, description, absoluteTitle });
}
