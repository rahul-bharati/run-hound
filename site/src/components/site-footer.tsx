import Link from "next/link";
import { LogoMark } from "@/components/logo";
import { legalNav, mainNav, site } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="border-t border-line-soft">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.5fr_1fr_1fr] lg:px-[72px]">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2.5 font-display text-xl font-extrabold">
            <LogoMark size={24} />
            {site.name}
          </div>
          <p className="max-w-sm text-sm leading-relaxed text-dim">
            Open source, planned under {site.license}. Built to run on your machine, with your own model.
          </p>
        </div>

        <nav aria-label="Product">
          <h2 className="font-mono text-xs tracking-widest text-dim">PRODUCT</h2>
          <ul className="mt-2 flex flex-col text-sm">
            {mainNav.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="inline-flex min-h-11 items-center text-muted hover:text-amber">
                  {item.label}
                </Link>
              </li>
            ))}
            <li>
              <a href={site.github} className="inline-flex min-h-11 items-center text-muted hover:text-amber">
                GitHub
              </a>
            </li>
          </ul>
        </nav>

        <nav aria-label="Legal">
          <h2 className="font-mono text-xs tracking-widest text-dim">LEGAL</h2>
          <ul className="mt-2 flex flex-col text-sm">
            {legalNav.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="inline-flex min-h-11 items-center text-muted hover:text-amber">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className="border-t border-line-soft">
        <p className="mx-auto max-w-7xl px-4 py-6 font-mono text-xs text-dim sm:px-6 lg:px-[72px]">
          {site.name} · {site.license}
        </p>
      </div>
    </footer>
  );
}
