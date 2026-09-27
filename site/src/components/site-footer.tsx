import Link from "next/link";
import { aiBuiltPage } from "@/components/ai-built/data";
import { comparePage } from "@/components/compare/data";
import { CookieSettingsButton } from "@/components/consent/consent";
import { faqPage } from "@/components/faq/data";
import { LogoMark } from "@/components/logo";
import { legalNav, mainNav, site } from "@/lib/site";

const linkClass = "inline-flex min-h-11 items-center text-muted hover:text-accent";

// Written in normal case and shown in capitals by CSS, so search snippets and screen readers get "Product", not
// "PRODUCT".
const headingClass = "font-mono text-xs uppercase tracking-widest text-dim";

const projectLinks = [
  { href: site.testingGuide, label: "Getting-started guide" },
  { href: site.github, label: "GitHub" },
  { href: site.changelog, label: "Changelog" },
  { href: site.feedback, label: "Send feedback" },
] as const;

/**
 * The pages that answer what people ask before they try it: the path each page's own data gives. These and the legal
 * links aren't prefetched (neither in view nor on hover): every page shows them, and few visits follow them.
 */
const resourceLinks = [
  { href: aiBuiltPage.path, label: "Testing AI-built apps" },
  { href: comparePage.path, label: "How it compares" },
  { href: faqPage.path, label: "FAQ" },
] as const;

export function SiteFooter() {
  return (
    <footer className="border-t border-line-soft bg-bg-deep">
      {/* The blurb spans the row until xl, where it becomes the first of five columns. */}
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:grid-cols-2 sm:px-6 md:grid-cols-4 lg:px-[72px] xl:grid-cols-[1.6fr_1fr_1fr_1fr_1fr]">
        <div className="flex flex-col gap-4 sm:col-span-2 md:col-span-4 xl:col-span-1">
          {/* Not prefetched: on the home page it is the page already open, and elsewhere the header's logo has
              prefetched it already. */}
          <Link
            href="/"
            prefetch={false}
            className="flex w-fit items-center gap-2.5 font-display text-xl font-extrabold tracking-[-0.02em]"
          >
            <LogoMark size={24} />
            {site.name}
          </Link>
          <p className="max-w-xs text-sm leading-relaxed text-dim">
            AI-assisted UI testing for AI-built apps, open source under the MIT license. Runs on your machine.{" "}
            Release {site.version} tests one page, with signed-in runs ({site.preview}) and optional AI; the repository
            is public.
          </p>
          <p className="text-sm text-dim">
            Made by{" "}
            <a
              href={site.maintainer.url}
              rel="author"
              className="text-muted underline underline-offset-4 hover:text-accent"
            >
              {site.maintainer.name}
            </a>
            . Found a bug?{" "}
            <a
              href={site.issues}
              className="text-muted underline underline-offset-4 hover:text-accent"
            >
              File an issue on GitHub
            </a>
          </p>
        </div>

        <nav aria-label="Product">
          <h2 className={headingClass}>Product</h2>
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

        <nav aria-label="Resources">
          <h2 className={headingClass}>Resources</h2>
          <ul className="mt-2 flex flex-col text-sm">
            {resourceLinks.map((item) => (
              <li key={item.href}>
                <Link href={item.href} prefetch={false} className={linkClass}>
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <nav aria-label="Project">
          <h2 className={headingClass}>Project</h2>
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
          <h2 className={headingClass}>Legal</h2>
          <ul className="mt-2 flex flex-col text-sm">
            {legalNav.map((item) => (
              <li key={item.href}>
                <Link href={item.href} prefetch={false} className={linkClass}>
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
        {/* Stacked on a phone (no separator left at a line end), one wrapping row from sm up. */}
        <p className="mx-auto flex max-w-7xl flex-col items-start gap-y-1 px-4 py-6 font-mono text-xs text-dim sm:flex-row sm:flex-wrap sm:gap-x-3 sm:px-6 lg:px-[72px]">
          <span>{site.name}</span>
          <span aria-hidden="true" className="max-sm:hidden">
            ·
          </span>
          <span>
            Release {site.version} · <time dateTime={site.releasedIso}>{site.released}</time>
          </span>
          <span aria-hidden="true" className="max-sm:hidden">
            ·
          </span>
          <span>Single page · {site.preview}</span>
          <span aria-hidden="true" className="max-sm:hidden">
            ·
          </span>
          <a href={site.licenseUrl} className="underline underline-offset-4 hover:text-accent">
            {site.license} license
          </a>
        </p>
      </div>
    </footer>
  );
}
