import type { Metadata } from "next";
import { notFoundMetadata } from "@/components/not-found/copy";
import { NotFoundBody } from "@/components/not-found/not-found-body";
import { bugFormUrl, href } from "@/lib/nav";

// No canonical and no robots of its own: Next.js serves the page with status 404 and adds noindex (lib/metadata.ts).
// No social card either: a missing page is never shared, and the layout's Open Graph and Twitter tags (with their
// image and its alt text) would otherwise be in the 404's HTML twice (the tags and the RSC payload). Null removes the
// inherited field, as routeMetadata does for internal routes.
export const metadata: Metadata = {
  title: notFoundMetadata.title,
  description: notFoundMetadata.description,
  openGraph: null,
  twitter: null,
};

/**
 * The 404 (DESIGN.md §3.13). Its body is one client component with three plain strings, because Next.js puts this
 * tree in every page's payload (components/not-found/not-found-body.tsx says why). The page is in no registry list, so
 * nothing links to it or prefetches it.
 */
export default function NotFound() {
  return <NotFoundBody home={href("home")} docs={href("docs")} formUrl={bugFormUrl} />;
}
