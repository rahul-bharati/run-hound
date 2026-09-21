"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { ButtonLink } from "@/components/button-link";
import { Logo } from "@/components/logo";
import { mainNav, site } from "@/lib/site";

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
    <header className="sticky top-0 z-40 border-b border-line-soft bg-bg/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-4 py-4 sm:px-6 lg:px-[72px]">
        <Logo />

        <nav aria-label="Main" className="hidden lg:block">
          <ul className="flex items-center gap-8 text-[15px]">
            {mainNav.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`inline-flex min-h-11 items-center ${active ? "text-amber" : "text-muted hover:text-fg"}`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
            <li>
              <a href={site.github} className="inline-flex min-h-11 items-center text-muted hover:text-fg">
                GitHub
              </a>
            </li>
          </ul>
        </nav>

        <div className="flex items-center gap-3">
          <ButtonLink href="/docs" className="!px-5 !py-2.5 text-[15px] max-sm:hidden" comingSoon>
            Get started
          </ButtonLink>

          <details ref={menuRef} className="group relative lg:hidden">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-full border border-line-strong px-4 text-[15px] font-medium [&::-webkit-details-marker]:hidden">
              <span className="group-open:hidden">Menu</span>
              <span className="hidden group-open:inline">Close</span>
            </summary>
            <nav
              aria-label="Main"
              className="absolute right-0 top-14 w-64 rounded-2xl border border-line bg-surface p-2 shadow-2xl shadow-black/50"
            >
              <ul className="flex flex-col">
                {mainNav.map((item) => {
                  const active = isActive(pathname, item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={`flex min-h-11 items-center rounded-xl px-4 ${active ? "bg-surface-3 text-amber" : "text-fg hover:bg-surface-2"}`}
                      >
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
                <li>
                  <a href={site.github} className="flex min-h-11 items-center rounded-xl px-4 text-fg hover:bg-surface-2">
                    GitHub
                  </a>
                </li>
                <li className="p-2 sm:hidden">
                  <ButtonLink href="/docs" className="w-full" comingSoon>
                    Get started
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
