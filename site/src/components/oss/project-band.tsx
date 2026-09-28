import type { ReactNode } from "react";
import { Band, SectionHeading } from "@/components/primitives/layout";

/**
 * A section of a project page: a Band (DESIGN.md §2.1) labelled by its h2, with the band index "02 ── 08" above the
 * heading from 640 px. The h2's id is `headingId` when other pages link the heading itself (/open-source/#how-to-help on
 * <section id="contributing">), `<id>-heading` otherwise.
 */
export function ProjectBand({
  id,
  headingId,
  title,
  intro,
  index,
  tone = "bg",
  children,
}: {
  id: string;
  headingId?: string;
  title: string;
  intro?: ReactNode;
  index?: { n: number; total: number };
  tone?: "bg" | "band";
  children: ReactNode;
}) {
  const heading = headingId ?? `${id}-heading`;
  return (
    <Band id={id} labelledBy={heading} index={index} tone={tone}>
      <SectionHeading id={heading} title={title} intro={intro} />
      {children}
    </Band>
  );
}
