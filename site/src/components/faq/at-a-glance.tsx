import { opensOn } from "@/components/oss/opens";
import { TextLink } from "@/components/primitives/links";
import type { FaqFact } from "@/content/faq";

/**
 * "At a glance" (DESIGN.md §3.9, moved from the homepage): the facts a visitor checks first, in the facts panel a check
 * page's FactsList uses (.facts-list: surface, mono keys), each fact followed by the link to its proof. The facts are
 * sentences, not short values, so each row is a two-column grid from 640 px (the key, then the fact) instead of
 * FactsList's key and value pushed to either end. A fork of FactsList until the primitive has that grid layout (a
 * `layout="grid"` variant, asked of G2); then this becomes <FactsList layout="grid" … />.
 */
export function AtAGlance({ facts }: { facts: readonly FaqFact[] }) {
  return (
    <dl className="facts-list max-w-heading">
      {facts.map((fact) => (
        <div key={fact.term} className="grid gap-1 border-t border-line-soft py-3 first:border-t-0 sm:grid-cols-12 sm:gap-4">
          <dt className="sm:col-span-3">{fact.term}</dt>
          <dd className="sm:col-span-9">
            {fact.text}{" "}
            <TextLink href={fact.link.href} prefetch="intent" opens={opensOn(fact.link.href)}>
              {fact.link.label}
            </TextLink>
          </dd>
        </div>
      ))}
    </dl>
  );
}
