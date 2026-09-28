/**
 * What the header's client parts get from the Server Component (DESIGN.md §3.2, ES2): plain data read from the route
 * registry (lib/nav.ts) and lib/site.ts, so no client file imports either (src/boundaries.test.ts).
 */
import { headerLinks, href, resolveTarget, type NavLink } from "@/lib/nav";
import { site } from "@/lib/site";

export type HeaderProps = {
  /** The five hubs, in order. */
  links: NavLink[];
  /** The homepage, which the mark and wordmark link to. */
  home: string;
  /** The docs hub, which search's empty state points to. */
  docs: string;
  /** "Try it locally": the quick start's own page once it is registered, its section of /docs/ until then (V1). */
  cta: { href: string; label: string };
  github: string;
  changelog: string;
  /** The release, as the chip shows it ("v0.6.0"). */
  version: string;
};

export function headerProps(): HeaderProps {
  return {
    links: headerLinks(),
    home: href("home"),
    docs: href("docs"),
    cta: { href: resolveTarget({ to: "docs-quick-start", fallback: { to: "docs", hash: "quick-start" } }), label: site.cta },
    github: site.github,
    changelog: site.changelog,
    version: site.version,
  };
}
