import type { ReactNode } from "react";
import { headerProps } from "@/components/header/header-data";
import { menuItems } from "@/components/header/menu";

/**
 * The header's three looks for /_design/ (DESIGN.md §3.14): transparent over the top of a page, opaque once the page has
 * scrolled 8 px, and on phones with the menu open (§3.2). The page's own header can show only one of them at a time, so
 * these are pictures of it: the header's own classes (components/header/chrome.css, globals.css) on the header's own
 * data (header-data.ts, menu.ts), with every link and button drawn as a plain span. Each is aria-hidden, holds nothing
 * focusable and no landmark, so it never repeats the page's navigation for a keyboard or a screen reader, and each has
 * a caption. The lab (scripts/lab/specs/design.spec.mjs) checks that the transparent and opaque specimens paint what
 * the live header paints at the top of the page and once scrolled.
 *
 * `brand` is the mark and the wordmark, rendered by the page (the mark is a static image import, as in
 * components/site-header.tsx).
 */
export const headerStates = ["transparent", "opaque", "menu"] as const;
export type HeaderState = (typeof headerStates)[number];

const captions: Record<HeaderState, string> = {
  transparent: "Transparent: the top of every page, before any scroll.",
  opaque: "Opaque: once the page scrolls 8 px, in CSS alone.",
  menu: "Below 1024 px, menu open: the hubs, GitHub, the changelog and the call to action.",
};

/**
 * The search trigger's look (components/search/search-trigger.tsx), without the button: from 1280 px its label and
 * "Ctrl K", below an icon. The phone specimen is phone-width at any viewport, so it always draws the icon.
 */
function SearchLook({ phone }: { phone: boolean }) {
  return (
    <span className="search-trigger">
      <svg width="20" height="20" viewBox="0 0 24 24" focusable="false" className="shrink-0">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-4-4" />
      </svg>
      {phone ? (
        <span className="sr-only">Search</span>
      ) : (
        <>
          <span className="max-xl:sr-only">Search</span> <kbd className="search-trigger-hint max-xl:hidden">Ctrl K</kbd>
        </>
      )}
    </span>
  );
}

/** The call to action's look (ButtonLink, primary: exempt from the accent budget, as the real one is). */
function ActionLook({ label, className }: { label: string; className?: string }) {
  return (
    <span className={`btn btn-primary has-arrow ${className ?? ""}`.trim()} data-accent-exempt="">
      {label}
    </span>
  );
}

/** The bar as components/header/header-client.tsx lays it out, one hub marked current (Docs, the first). */
function Bar({ brand, phone = false }: { brand: ReactNode; phone?: boolean }) {
  const { links, cta, version } = headerProps();
  return (
    <div className="site-header-bar container-page">
      <span className="site-brand">{brand}</span>
      {phone ? null : (
        <div className="site-nav">
          <ul className="flex items-center gap-5 xl:gap-7">
            {links.map((link, i) => (
              <li key={link.href}>
                <span className="nav-link whitespace-nowrap" aria-current={i === 0 ? "page" : undefined}>
                  {link.label}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="ml-auto flex items-center gap-2 xl:gap-3">
        <SearchLook phone={phone} />
        {phone ? null : (
          <>
            <span className="site-chip max-xl:hidden">v{version}</span>
            <span className="site-icon-link max-lg:hidden">
              <span className="max-xl:sr-only">GitHub</span>
            </span>
            <span className="max-lg:hidden">
              <ActionLook label={cta.label} className="btn-sm" />
            </span>
          </>
        )}
        <span className={phone ? "site-menu-button" : "site-menu-button lg:hidden"} data-open={phone ? "" : undefined}>
          Menu
        </span>
      </div>
    </div>
  );
}

/** The open menu's panel, its rows as menu.ts orders them. */
function MenuPanel() {
  const props = headerProps();
  return (
    <div className="site-menu">
      <div className="container-page">
        <ul className="flex flex-col">
          {menuItems(props).map((item, i) =>
            item.kind === "cta" ? (
              <li key={item.href} className="pt-4 pb-2">
                <ActionLook label={item.label} className="w-full" />
              </li>
            ) : (
              <li key={item.href}>
                <span className={item.kind === "external" ? "site-menu-link has-ext" : "site-menu-link"} aria-current={i === 0 ? "page" : undefined}>
                  {item.label}
                </span>
              </li>
            ),
          )}
        </ul>
      </div>
    </div>
  );
}

export function HeaderSpecimens({ brand }: { brand?: ReactNode }) {
  return (
    <ul className="dz-headers">
      {headerStates.map((state) => (
        <li key={state}>
          <figure className="dz-header-figure">
            {/* A page scrolling under the bar, so transparent and opaque look different. */}
            <div className={state === "menu" ? "dz-stage dz-stage-phone" : "dz-stage"} aria-hidden="true">
              <div className="site-header dz-header" data-header-specimen={state} aria-hidden="true">
                <Bar brand={brand} phone={state === "menu"} />
                {state === "menu" ? <MenuPanel /> : null}
              </div>
              <p className="dz-stage-text">Find the bugs your AI forgot to test.</p>
            </div>
            <figcaption className="figure-caption">{captions[state]}</figcaption>
          </figure>
        </li>
      ))}
    </ul>
  );
}
