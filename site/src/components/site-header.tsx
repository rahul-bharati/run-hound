"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { ArrowIcon, ButtonLink } from "@/components/button-link";
import { Logo } from "@/components/logo";
import { externalNav, mainNav, site } from "@/lib/site";

// Desktop keeps the reference's short bar; every page stays reachable from the menu and the footer.
const desktopNav = mainNav.filter((item) => ["/how-it-works", "/checks", "/docs"].includes(item.href));

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SiteHeader() {
  const pathname = usePathname();
  const menuRef = useRef<HTMLDetailsElement>(null);

  // Close the mobile menu after navigating.
  useEffect(() => {
    if (menuRef.current) menuRef.current.open = false;
  }, [pathname]);

  return (
    <header className="sticky top-0 z-40 border-b border-line-soft bg-bg/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-4 py-3.5 sm:px-6 lg:px-[72px]">
        <Logo />

        <div className="flex items-center gap-3 lg:gap-8">
          <nav aria-label="Main" className="hidden lg:block">
            <ul className="flex items-center gap-7 text-[15px]">
              {desktopNav.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={`inline-flex min-h-11 items-center ${active ? "text-accent" : "text-muted hover:text-fg"}`}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
              {externalNav.map((item) => (
                <li key={item.href}>
                  <a href={item.href} className="inline-flex min-h-11 items-center text-muted hover:text-fg">
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <ButtonLink href={site.testingGuide} className="!px-5 !py-2.5 text-[15px] max-sm:hidden">
            Try V0 Locally
          </ButtonLink>

          <details ref={menuRef} className="group relative lg:hidden">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-xl border border-line-strong px-4 text-[15px] font-medium hover:border-accent [&::-webkit-details-marker]:hidden">
              <span className="group-open:hidden">Menu</span>
              <span className="hidden group-open:inline">Close</span>
            </summary>
            <nav
              aria-label="Main"
              className="absolute right-0 top-14 w-[min(16rem,calc(100vw-2rem))] rounded-2xl border border-line bg-surface p-2 shadow-2xl shadow-black/50"
            >
              <ul className="flex flex-col">
                {mainNav.map((item) => {
                  const active = isActive(pathname, item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={`flex min-h-11 items-center rounded-xl px-4 ${active ? "bg-surface-3 text-accent" : "text-fg hover:bg-surface-2"}`}
                      >
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
                {externalNav.map((item, index) => (
                  <li key={item.href} className={index === 0 ? "mt-1 border-t border-line-soft pt-1" : ""}>
                    <a href={item.href} className="flex min-h-11 items-center rounded-xl px-4 text-fg hover:bg-surface-2">
                      {item.label}
                    </a>
                  </li>
                ))}
                <li className="p-2 sm:hidden">
                  <ButtonLink href={site.testingGuide} className="w-full">
                    Try V0 Locally
                    <ArrowIcon />
                  </ButtonLink>
                </li>
              </ul>
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}
