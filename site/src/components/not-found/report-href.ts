/**
 * The 404's bug-report link (DESIGN.md §3.13): the bug form with the missing page's path as the issue title, and
 * nothing else. Only the pathname is passed in (never the query or the hash, which may hold a token or an address),
 * and the form URL comes from the server (lib/nav.ts bugFormUrl), so this file imports nothing a client component
 * may not. Without a path (the server's HTML, or no JavaScript) the link is the form itself.
 */
export function reportHref(formUrl: string, pathname: string | null): string {
  return pathname ? `${formUrl}&title=${encodeURIComponent(pathname)}` : formUrl;
}
