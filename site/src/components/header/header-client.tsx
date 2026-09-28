"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink } from "@/components/primitives/nav-link";
import { SearchTrigger } from "@/components/search/search-trigger";
import { isCurrentHub } from "./current-hub";
import type { HeaderProps } from "./header-data";
import { leavesHeader, menuItems } from "./menu";

/**
 * How many hubs, in the header's order (Docs, Checks, Demo, AI-built apps, Open source), are fetched as soon as they
 * are in view; the rest wait for a hover, touch or focus (NavLink's "intent"). With the brand that is at most 4 routes
 * fetched on arrival: Next 16.3's segment cache makes 2 requests a route, plus 1 for the layout they share, so the
 * header costs at most 9 of the first viewport's 10 prefetch requests (DESIGN.md §5.2), and on / the brand isn't
 * fetched, which leaves room for the hero's "Try it locally".
 */
const VIEWPORT_HUBS = 3;

/**
 * The header's client part (DESIGN.md §3.2): the <header> itself, the current hub, the phone menu and Search. The
 * Server Component (components/site-header.tsx) reads the registry and passes plain props (ES2), with the brand (the
 * mark and the wordmark) and the call to action already rendered: `action` in the bar, `menuAction` as the menu's last
 * row (both the ButtonLink primitive).
 *
 * - ≥ 1280 px: the five hubs 28 px apart, then Search with "Ctrl K", the release chip, GitHub with its label, the CTA.
 * - 1024-1279 px: the hubs 20 px apart, Search and GitHub as 44 px icon buttons, no chip, the CTA.
 * - < 1024 px: the brand (the wordmark visually hidden below 360 px, by the brand itself), Search and Menu.
 *
 * The menu is a disclosure (the button keeps its name "Menu"; aria-expanded carries the state), rendered only while
 * open, and closed by Escape anywhere on the page (focus back on Menu), by following a link, by navigating, by a press
 * outside the header, and by focus leaving the header: one focusout handler, on <header>, that closes it only when
 * focus goes outside (E1). The bar is 64 px, sticky, and static at max-height 30rem (E3); it turns opaque after 8 px of
 * scroll in CSS alone (components/header/chrome.css).
 */
export function HeaderClient({
  links,
  home,
  docs,
  cta,
  github,
  changelog,
  version,
  brand,
  action,
  menuAction,
}: HeaderProps & { brand: ReactNode; action: ReactNode; menuAction: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);

  // Navigating closes the menu (following a link in it closes it at once, below). Adjusting state while rendering,
  // when the path changes, is React's pattern for state that follows a prop.
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    setOpen(false);
  }

  // While the menu is open: a press outside the header closes it, and so does Escape wherever focus is, since a click
  // on Menu moves no focus in Safari and macOS Firefox (focus stays on <body>). Escape in the search dialog is the
  // dialog's own.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!headerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || (event.target instanceof Element && event.target.closest("dialog"))) return;
      setOpen(false);
      menuButton.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const atHome = pathname === home;
  const items = menuItems({ links, github, changelog, version, cta });

  return (
    <header
      ref={headerRef}
      className="site-header"
      onBlur={(event) => {
        if (open && leavesHeader(event.currentTarget, event.relatedTarget)) setOpen(false);
      }}
    >
      <div className="site-header-bar container-page">
        {/* The homepage doesn't prefetch itself. */}
        <NavLink href={home} prefetch={atHome ? "none" : "viewport"} className="site-brand">
          {brand}
        </NavLink>

        <nav aria-label="Main" className="site-nav">
          <ul className="flex items-center gap-5 xl:gap-7">
            {links.map((link, index) => {
              const current = isCurrentHub(pathname, link.href);
              return (
                <li key={link.href}>
                  <NavLink
                    href={link.href}
                    // The first hubs prefetch when in view, the rest on intent (VIEWPORT_HUBS); the page already open
                    // isn't fetched again.
                    prefetch={current ? "none" : index < VIEWPORT_HUBS ? "viewport" : "intent"}
                    aria-current={current ? "page" : undefined}
                    className="nav-link whitespace-nowrap"
                  >
                    {link.label}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-2 xl:gap-3">
          <SearchTrigger docs={docs} />
          <a href={changelog} className="site-chip max-xl:hidden">
            v{version}
            <span className="sr-only"> changelog</span>
          </a>
          <a href={github} className="site-icon-link max-lg:hidden">
            {/* The GitHub mark is drawn by CSS (chrome.css), so its path isn't in every page's HTML and JS. */}
            <span className="max-xl:sr-only">GitHub</span>
          </a>
          <div className="max-lg:hidden">{action}</div>
          <button
            ref={menuButton}
            type="button"
            aria-expanded={open}
            aria-controls="site-menu"
            onClick={() => setOpen((was) => !was)}
            className="site-menu-button lg:hidden"
          >
            Menu
          </button>
        </div>

        {open ? (
          // tabIndex -1: a click on the panel's padding focuses the panel, not <body>, so focus stays in the header and
          // the focusout handler keeps the menu open.
          <div id="site-menu" className="site-menu lg:hidden" tabIndex={-1}>
            <nav aria-label="Main" className="container-page">
              {/* Following any link in the menu closes it, a same-page hash link too (the path doesn't change). */}
              <ul
                className="flex flex-col"
                onClick={(event) => {
                  if (event.target instanceof Element && event.target.closest("a")) setOpen(false);
                }}
              >
                {items.map((item) => {
                  if (item.kind === "cta") {
                    return (
                      <li key={item.href} className="pt-4 pb-2">
                        {menuAction}
                      </li>
                    );
                  }
                  if (item.kind === "external") {
                    return (
                      <li key={item.href}>
                        <a href={item.href} className="site-menu-link has-ext">
                          {item.label}
                        </a>
                      </li>
                    );
                  }
                  const current = isCurrentHub(pathname, item.href);
                  return (
                    <li key={item.href}>
                      {/* The open menu would fetch all five hubs at once on a phone: its rows don't prefetch. */}
                      <NavLink
                        href={item.href}
                        prefetch="none"
                        aria-current={current ? "page" : undefined}
                        className="site-menu-link"
                      >
                        {item.label}
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            </nav>
          </div>
        ) : null}
      </div>
    </header>
  );
}
