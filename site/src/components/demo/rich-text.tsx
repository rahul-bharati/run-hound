import type { Rich } from "@/content/how-it-works";
import { TextLink } from "@/components/primitives/links";
import { resolveTarget } from "@/lib/nav";

/**
 * Shared by all three product pages; it sits in components/demo/ because F2 owns that folder (a later pass may move it
 * to components/product/).
 *
 * A run of text from a content module (content/how-it-works.ts Rich) with its inline code and links: the product pages'
 * sentences that name a flag, an address or another page. Code keeps the text's size; a short one never breaks inside
 * (a flag such as --plan-only), a long one (an address) may break anywhere, so nothing overflows at 320 px. A link to a
 * page resolves through the registry (its fallback until the page exists) and is fetched on intent, so a page full of
 * links doesn't fetch them all as they scroll into view.
 */
export function RichText({ text }: { text: Rich }) {
  return (
    <>
      {text.map((segment, i) => {
        if (typeof segment === "string") return segment;
        if ("code" in segment) {
          return (
            <code key={i} className={`font-mono text-fg ${segment.code.length <= 24 ? "whitespace-nowrap" : "wrap-anywhere"}`}>
              {segment.code}
            </code>
          );
        }
        if ("link" in segment) {
          return (
            <TextLink key={i} href={resolveTarget(segment.link)} prefetch="intent">
              {segment.text}
            </TextLink>
          );
        }
        return (
          <TextLink key={i} href={segment.href} opens={segment.opens}>
            {segment.text}
          </TextLink>
        );
      })}
    </>
  );
}
