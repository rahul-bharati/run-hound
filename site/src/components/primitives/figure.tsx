import type { ReactNode } from "react";
import { cx } from "./class-names";

/**
 * A figure (DESIGN.md §2.5): the media, then a caption of at most 15 words in sentence case (dim, 14 px). `reveal`
 * marks the media for the below-the-fold reveal (§4.3, data-motion="reveal"): only the media ever moves, never the
 * caption. Figures stay out of the search index (§3.16: data-pagefind-ignore), caption included.
 */
export function Figure({ caption, reveal = false, className, children }: { caption: ReactNode; reveal?: boolean; className?: string; children: ReactNode }) {
  return (
    <figure className={cx("figure", className)} data-pagefind-ignore="">
      <div className="figure-media" data-motion={reveal ? "reveal" : undefined}>
        {children}
      </div>
      <figcaption className="figure-caption">{caption}</figcaption>
    </figure>
  );
}
