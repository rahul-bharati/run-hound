/**
 * Whether a header hub is the current one for a page: its own page and every page under it ("Docs" on every /docs/*,
 * "Checks" on every /checks/*; DESIGN.md §3.2). The client's copy of lib/nav.ts's isCurrentHub: a client component may
 * not import lib/nav (src/boundaries.test.ts), and header.test.ts holds the two to the same answers on every registry
 * page. Takes Next.js's usePathname(), with or without the trailing slash, or null outside a route.
 */
export function isCurrentHub(pathname: string | null, hubPath: string): boolean {
  if (!pathname) return false;
  const page = pathname.endsWith("/") ? pathname : `${pathname}/`;
  return hubPath !== "/" && page.startsWith(hubPath);
}
