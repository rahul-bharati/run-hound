import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowIcon, ButtonLink } from "@/components/button-link";
import { DocsToc } from "@/components/docs/toc";
import { faqGroups, faqItems, faqJsonLd, faqPage, type FaqLink } from "@/components/faq/data";
import { JsonLd } from "@/components/json-ld";
import { Container, PageHeader } from "@/components/layout";
import { pageMetadata } from "@/lib/metadata";
import { site } from "@/lib/site";

export const metadata = pageMetadata(faqPage);

/** An answer's text, with its `code` marks shown as code. */
function Inline({ text }: { text: string }) {
  const parts: ReactNode[] = text.split(/`([^`]*)`/).map((part, i) => (i % 2 === 1 ? <code key={i}>{part}</code> : part));
  return <>{parts}</>;
}

const linkClass =
  "inline-flex min-h-11 items-center gap-1.5 text-[15px] font-medium text-accent underline underline-offset-4 hover:text-accent-strong";

function MoreLink({ link }: { link: FaqLink }) {
  // Internal pages go through next/link (client navigation); sources on other sites are plain links.
  return link.href.startsWith("/") ? (
    <Link href={link.href} className={linkClass}>
      {link.label}
      <ArrowIcon size={14} />
    </Link>
  ) : (
    <a href={link.href} className={linkClass}>
      {link.label}
    </a>
  );
}

export default function FaqPage() {
  return (
    <>
      <PageHeader
        eyebrow="FAQ"
        title={
          <>
            Questions about testing <span className="text-accent">AI-built apps.</span>
          </>
        }
        lede="Each answer starts with the short version, then links to the details. They describe the release you can run today, and they say what Run Hound doesn't do as plainly as what it does."
      >
        <p className="font-mono text-xs uppercase tracking-widest text-dim">
          Answers for release {site.version} ·{" "}
          <time dateTime={site.releasedIso} className="whitespace-nowrap text-muted">
            {site.released}
          </time>
        </p>
      </PageHeader>

      <Container className="pb-24">
        <div className="grid gap-12 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-16">
          <DocsToc
            items={faqItems.map((item) => ({ id: item.id, label: item.q }))}
            headingId="faq-toc-heading"
            label="Questions"
          />

          <div className="flex min-w-0 max-w-3xl flex-col gap-16">
            {faqGroups.map((group) => (
              <section key={group.id} id={group.id} aria-labelledby={`${group.id}-heading`} className="scroll-mt-28">
                <h2
                  id={`${group.id}-heading`}
                  className="font-display text-3xl font-bold tracking-tight sm:text-4xl"
                >
                  {group.title}
                </h2>
                <div className="mt-6 flex flex-col divide-y divide-line-soft border-y border-line-soft">
                  {group.items.map((item) => (
                    <article
                      key={item.id}
                      id={item.id}
                      aria-labelledby={`${item.id}-q`}
                      className="flex scroll-mt-28 flex-col gap-4 py-8"
                    >
                      <h3 id={`${item.id}-q`} className="text-balance font-display text-2xl font-bold leading-snug">
                        {item.q}
                      </h3>
                      <div className="prose-night">
                        {item.a.map((paragraph) => (
                          <p key={paragraph}>
                            <Inline text={paragraph} />
                          </p>
                        ))}
                      </div>
                      <ul className="flex flex-wrap gap-x-6">
                        {item.links.map((link) => (
                          <li key={link.href}>
                            <MoreLink link={link} />
                          </li>
                        ))}
                      </ul>
                    </article>
                  ))}
                </div>
              </section>
            ))}

            <div className="flex flex-col items-start gap-5 rounded-2xl border border-line bg-surface p-6 sm:p-8">
              <h2 className="font-display text-2xl font-bold tracking-tight">Didn&apos;t find your question?</h2>
              <p className="leading-relaxed text-muted">
                The docs cover every step, from the first run to reading the report. Or ask on GitHub: the repository
                is public, and anyone can open an issue.
              </p>
              <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
                <ButtonLink href="/docs/">
                  Read the docs
                  <ArrowIcon />
                </ButtonLink>
                <ButtonLink href={site.feedback} variant="secondary">
                  Ask on GitHub
                </ButtonLink>
              </div>
            </div>
          </div>
        </div>
      </Container>
      {/* Last, so the h1 and the answers arrive before the structured data; search engines read it anywhere. */}
      <JsonLd data={faqJsonLd()} />
    </>
  );
}
