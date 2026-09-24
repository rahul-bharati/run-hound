import Link from "next/link";
import { CookieSettingsButton } from "@/components/consent/consent";
import { LogoMark } from "@/components/logo";
import { legalNav, mainNav, site } from "@/lib/site";

const linkClass = "inline-flex min-h-11 items-center text-muted hover:text-accent";

const projectLinks = [
  { href: site.testingGuide, label: "Tester guide" },
  { href: site.github, label: "GitHub" },
  { href: site.changelog, label: "Changelog" },
  { href: site.feedback, label: "Send feedback" },
] as const;

export function SiteFooter() {
  return (
    <footer className="border-t border-line-soft bg-bg-deep">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:grid-cols-2 sm:px-6 md:grid-cols-[1.6fr_1fr_1fr_1fr] lg:px-[72px]">
        <div className="flex flex-col gap-4">
          <Link href="/" className="flex w-fit items-center gap-2.5 font-display text-xl font-extrabold tracking-[-0.02em]">
            <LogoMark size={24} />
            {site.name}
          </Link>
          <p className="max-w-xs text-sm leading-relaxed text-dim">
            Open-source UI testing for AI-built apps. Runs on your machine. V0 tester preview {site.version}; the
            repository is invite-only for now.
          </p>
          <p className="text-sm text-dim">
            Want access?{" "}
            <a
              href={`mailto:${site.contactEmail}?subject=Run%20Hound%20V0%20access`}
              className="text-muted underline underline-offset-4 hover:text-accent"
            >
              Ask for an invite
            </a>
          </p>
        </div>

        <nav aria-label="Product">
          <h2 className="font-mono text-xs tracking-widest text-dim">PRODUCT</h2>
          <ul className="mt-2 flex flex-col text-sm">
            {mainNav.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className={linkClass}>
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <nav aria-label="Project">
          <h2 className="font-mono text-xs tracking-widest text-dim">PROJECT</h2>
          <ul className="mt-2 flex flex-col text-sm">
            {projectLinks.map((item) => (
              <li key={item.href}>
                <a href={item.href} className={linkClass}>
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <nav aria-label="Legal">
          <h2 className="font-mono text-xs tracking-widest text-dim">LEGAL</h2>
          <ul className="mt-2 flex flex-col text-sm">
            {legalNav.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className={linkClass}>
                  {item.label}
                </Link>
              </li>
            ))}
            <li>
              <CookieSettingsButton className={linkClass} />
            </li>
          </ul>
        </nav>
      </div>
      <div className="border-t border-line-soft">
        <p className="mx-auto flex max-w-7xl flex-wrap gap-x-3 gap-y-1 px-4 py-6 font-mono text-xs text-dim sm:px-6 lg:px-[72px]">
          <span>{site.name}</span>
          <span aria-hidden="true">·</span>
          <span>V0 {site.version} tester preview</span>
          <span aria-hidden="true">·</span>
          <span>License planned: {site.license}</span>
        </p>
      </div>
    </footer>
  );
}
