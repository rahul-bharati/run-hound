import { CookieSettingsButton } from "@/components/consent/consent";
import { LogoMark } from "@/components/logo";
import { NavLink } from "@/components/primitives/nav-link";
import { footerColumns, href } from "@/lib/nav";
import { site } from "@/lib/site";

/**
 * The footer doormat (DESIGN.md §3.3): the brand block, then four columns of 22 links from the route registry
 * (lib/nav.ts footerColumns), in the same order on every page (WCAG 3.2.6). Its links are never prefetched: every page
 * shows them and few visits follow them. Left out of the search index (data-pagefind-ignore).
 */
export function SiteFooter() {
  const columns = footerColumns();
  return (
    <footer className="site-footer" data-pagefind-ignore="">
      <div className="site-footer-grid container-page">
        <div className="site-footer-brand flex flex-col gap-3">
          <NavLink href={href("home")} prefetch="none" className="site-brand w-fit">
            <LogoMark size={23} />
            {site.name}
          </NavLink>
          <p className="max-w-xs text-small text-dim">
            Open-source, AI-assisted UI testing for AI-built apps. Made by{" "}
            <a href={site.maintainer.url} rel="author" className="text-muted underline underline-offset-4 hover:text-fg">
              {site.maintainer.name}
            </a>
            .
          </p>
          <p className="font-mono text-mono tracking-normal text-dim">
            Release {site.version} · <time dateTime={site.releasedIso}>{site.released}</time>
          </p>
        </div>

        {columns.map((column) => (
          <nav key={column.id} aria-labelledby={`footer-${column.id}`}>
            <h2 id={`footer-${column.id}`} className="font-mono text-mono uppercase text-dim">
              {column.label}
            </h2>
            <ul className="mt-2 flex flex-col">
              {column.links.map((link) => (
                <li key={`${link.label}-${link.href}`}>
                  {link.external ? (
                    <a href={link.href} className="footer-link has-ext">
                      {link.label}
                    </a>
                  ) : (
                    <NavLink href={link.href} prefetch="none" className="footer-link">
                      {link.label}
                    </NavLink>
                  )}
                </li>
              ))}
              {column.id === "legal" && site.gaMeasurementId ? (
                <li>
                  <CookieSettingsButton className="footer-link" />
                </li>
              ) : null}
            </ul>
          </nav>
        ))}
      </div>
    </footer>
  );
}
