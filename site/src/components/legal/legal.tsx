import type { ReactNode } from "react";
import { JsonLd } from "@/components/json-ld";
import { Breadcrumbs } from "@/components/primitives/breadcrumbs";
import { NavLink } from "@/components/primitives/nav-link";
import { StepTrail } from "@/components/primitives/step-trail";
import type { RouteId } from "@/content/routes";
import { legalJsonLd, type LegalPage } from "@/content/legal";
import { href } from "@/lib/nav";
import { site } from "@/lib/site";
import "./legal.css";

export type LegalTocItem = { id: string; label: string };

/**
 * The legal pages' shell (DESIGN.md §3.15): the breadcrumb from the registry (equal to the page's BreadcrumbList), the
 * h1 in Display L, an optional lede in Lead, the visible "Last updated" date, then the contents (a static StepTrail of
 * the sections, beside the text and sticky from 1024 px) and the policy in docs prose on the type scale (.prose-doc).
 * `page` (content/legal.ts) gives the h1, which is also the page's title, and the structured data. Nothing here moves,
 * the h1 is all fg (an inner page's h1 is not one of the accent budget's exempt uses, §2.3), and links to other pages
 * never prefetch (NavLink's policy for legal pages).
 */
export function LegalDoc({
  page,
  lede,
  toc,
  children,
}: {
  page: LegalPage;
  lede?: ReactNode;
  toc: readonly LegalTocItem[];
  children: ReactNode;
}) {
  return (
    <div className="container-page pb-16 pt-8 sm:pt-12 lg:pb-20 lg:pt-16">
      <Breadcrumbs id={page.id} />
      <div className="legal-intro">
        <h1 className="text-balance font-display text-display-l text-fg">{page.title}</h1>
        {lede ? <p className="text-pretty text-lead text-muted">{lede}</p> : null}
        <p className="font-mono text-mono text-dim" data-last-updated="">
          Last updated{" "}
          <time dateTime={site.legalUpdatedIso} className="text-muted">
            {site.legalUpdated}
          </time>
        </p>
      </div>

      <div className="legal-grid">
        <nav aria-labelledby="legal-contents" className="legal-contents">
          <p id="legal-contents" className="font-mono text-mono text-dim">
            Contents
          </p>
          <StepTrail steps={toc.map((item) => ({ label: item.label, href: `#${item.id}` }))} className="text-small" />
        </nav>
        <article className="prose-doc legal-prose min-w-0">{children}</article>
      </div>
      {/* Last, so the h1 and the policy arrive before the structured data; search engines read it anywhere. */}
      <JsonLd data={legalJsonLd(page)} />
    </div>
  );
}

/**
 * Section heading with a "#" link to itself, so any part of a policy can be linked to. The "#" is drawn by CSS
 * (legal.css), not written in the link, so the heading's text is only its title: search engines and AI answer engines
 * read "Who we are", not "Who we are#". The link's name for screen readers comes from its aria-label.
 */
export function LegalHeading({
  id,
  level = 2,
  children,
}: {
  id: string;
  level?: 2 | 3;
  children: ReactNode;
}) {
  const Tag = level === 3 ? "h3" : "h2";
  return (
    <Tag id={id}>
      {children}
      <a href={`#${id}`} className="heading-anchor" aria-label="Link to this section" />
    </Tag>
  );
}

/** A link from a policy to another page of the site, by its registry id: prose-styled, and never prefetched. */
export function LegalLink({ to, hash, children }: { to: RouteId; hash?: string; children: ReactNode }) {
  return (
    <NavLink href={href(to, hash)} prefetch="none">
      {children}
    </NavLink>
  );
}

/** Email address as a mailto link, or as plain text while it is still a [PLACEHOLDER]. */
export function MailLink({ address }: { address: string }) {
  if (address.startsWith("[")) {
    return <strong>{address}</strong>;
  }
  return <a href={`mailto:${address}`}>{address}</a>;
}

/** Short, plain-language summary box shown at the top of a policy. Not a substitute for the full text. */
export function Summary({ children }: { children: ReactNode }) {
  return (
    <aside aria-label="Summary" className="legal-summary">
      <p className="font-mono text-mono text-dim">In short</p>
      {children}
    </aside>
  );
}
