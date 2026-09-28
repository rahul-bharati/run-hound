import type { ReactNode } from "react";
import { Band, SectionHeading } from "@/components/primitives/layout";

/**
 * Shared by all three product pages; it sits in components/demo/ because F2 owns that folder (a later pass may move it
 * to components/product/).
 *
 * A section of a product page: a Band (DESIGN.md §2.1) labelled by its h2 (`<id>-heading`, or visually hidden with
 * `hideTitle` where the content says it on screen), with an optional intro and the band index from 640 px.
 */
export function ProductBand({
  id,
  title,
  intro,
  index,
  tone = "bg",
  hideTitle = false,
  children,
}: {
  id: string;
  title: string;
  intro?: ReactNode;
  index?: { n: number; total: number };
  tone?: "bg" | "band";
  hideTitle?: boolean;
  children: ReactNode;
}) {
  const heading = `${id}-heading`;
  return (
    <Band id={id} labelledBy={heading} index={index} tone={tone}>
      {hideTitle ? (
        <h2 id={heading} className="sr-only">
          {title}
        </h2>
      ) : (
        <SectionHeading id={heading} title={title} intro={intro} />
      )}
      {children}
    </Band>
  );
}
