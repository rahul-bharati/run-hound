import { CodeText } from "@/components/oss/code-text";
import { opensOn } from "@/components/oss/opens";
import { ArrowLink } from "@/components/primitives/links";
import type { FaqItem } from "@/content/faq";

/**
 * One question and its answer (DESIGN.md §3.9): the question as an h3, every paragraph visible (no accordion), then the
 * links to the details, each an arrow link on its own 36 px row. The article carries the question's id, so
 * /faq/#is-it-free lands on it, below the sticky header (the one anchor offset).
 */
export function FaqEntry({ item }: { item: FaqItem }) {
  return (
    <article id={item.id} aria-labelledby={`${item.id}-q`} className="flex flex-col gap-3 border-t border-line-soft py-8 first:border-t-0 first:pt-0">
      <h3 id={`${item.id}-q`} className="text-balance font-display text-title font-bold text-fg">
        {item.q}
      </h3>
      <div className="flex max-w-measure flex-col gap-3 text-body text-muted">
        {item.a.map((paragraph) => (
          <p key={paragraph}>
            <CodeText text={paragraph} />
          </p>
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-6">
        {item.links.map((link) => (
          <li key={link.href}>
            <ArrowLink
              href={link.href}
              prefetch="intent"
              opens={opensOn(link.href)}
              className="inline-flex min-h-target-row items-center"
            >
              {link.label}
            </ArrowLink>
          </li>
        ))}
      </ul>
    </article>
  );
}
