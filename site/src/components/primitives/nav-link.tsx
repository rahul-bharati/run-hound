import Link from "next/link";
import type { ComponentProps } from "react";
import { IntentLink } from "./intent-link";

/**
 * When a link's page is fetched ahead of a click (brief §8.2): "viewport" (Next.js's default: when the link scrolls
 * into view) for the header's brand and first hubs; "intent" (on hover, touch or focus) for the header's other hubs and
 * its call to action, and in sidebars, hub grids, breadcrumbs and related lists, which would otherwise fetch dozens of
 * pages at once; "none" in the footer and on legal pages. Next 16.3's segment cache makes 2 requests per route it
 * fetches, so a first viewport holds at most 4 "viewport" links to stay within 10 prefetch requests (DESIGN.md §5.2).
 */
export type Prefetch = "viewport" | "intent" | "none";

/** next/link's prefetch prop for a policy that needs no client code. */
export function prefetchProp(policy: Exclude<Prefetch, "intent">): null | false {
  return policy === "none" ? false : null;
}

export type NavLinkProps = Omit<ComponentProps<typeof Link>, "prefetch" | "href"> & { href: string; prefetch?: Prefetch };

/**
 * next/link with the prefetch policy. `href` is a path from lib/nav.ts's href(id, hash), so a mistyped page id fails
 * `tsc`. Usable from Server and Client Components alike (it imports nothing server-only).
 */
export function NavLink({ prefetch = "viewport", ...props }: NavLinkProps) {
  if (prefetch === "intent") return <IntentLink {...props} />;
  return <Link {...props} prefetch={prefetchProp(prefetch)} />;
}
