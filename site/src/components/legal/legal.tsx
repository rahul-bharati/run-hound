import type { ReactNode } from "react";
import { DocsToc } from "@/components/docs/toc";
import { Container, Eyebrow } from "@/components/layout";
import { site } from "@/lib/site";

export type LegalTocItem = { id: string; label: string };

/**
 * Long-form layout shared by the legal pages: a title block with the "Last updated" date, a table of contents
 * (inline on phones, sticky beside the text on wide screens) and a reading column capped near 70 characters.
 */
export function LegalDoc({
  title,
  lede,
  toc,
  children,
}: {
  title: ReactNode;
  lede?: ReactNode;
  toc: readonly LegalTocItem[];
  children: ReactNode;
}) {
  return (
    <Container className="pb-24 pt-12 sm:pt-20">
      <div className="flex flex-col gap-10 lg:gap-14">
        <header className="flex max-w-[70ch] flex-col gap-5">
          <Eyebrow>LEGAL</Eyebrow>
          <h1 className="text-balance font-display text-[2.5rem] font-extrabold leading-[1.02] tracking-[-0.03em] text-fg sm:text-6xl">
            {title}
          </h1>
          {lede ? <p className="text-pretty text-lg leading-relaxed text-muted">{lede}</p> : null}
          <p className="font-mono text-xs tracking-widest text-dim">
            LAST UPDATED{" "}
            <time dateTime={site.legalUpdatedIso} className="text-muted">
              {site.legalUpdated.toUpperCase()}
            </time>
          </p>
        </header>

        <div className="grid gap-10 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-16">
          <DocsToc items={toc} headingId="legal-toc-heading" label="Contents" />
          <article className="prose-night prose-legal min-w-0 break-words">{children}</article>
        </div>
      </div>
    </Container>
  );
}

/** Section heading with a visible "#" link to itself, so any part of a policy can be linked to. */
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
      <a href={`#${id}`} className="heading-anchor" aria-label="Link to this section">
        #
      </a>
    </Tag>
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
    <aside
      aria-label="Summary"
      className="rounded-2xl border border-line bg-surface px-5 py-5 text-[15px] leading-relaxed sm:px-6"
    >
      <p className="font-mono text-xs tracking-widest text-accent">IN SHORT</p>
      <div className="mt-3 text-muted [&_li+li]:mt-2 [&_strong]:font-semibold [&_strong]:text-fg [&_ul]:list-disc [&_ul]:pl-5">
        {children}
      </div>
    </aside>
  );
}

/** Callout inside prose for text that needs a lawyer's review before launch. */
export function ReviewNote({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-5 py-4 text-sm leading-relaxed">
      <p className="font-mono text-xs tracking-widest text-accent">FOR LEGAL REVIEW</p>
      <div className="mt-2 text-muted">{children}</div>
    </div>
  );
}
