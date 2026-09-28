import type { ReactNode } from "react";
import type { RouteId } from "@/content/routes";
import { Breadcrumbs } from "@/components/primitives/breadcrumbs";

/**
 * Shared by all three product pages; it sits in components/demo/ because F2 owns that folder (a later pass may move it
 * to components/product/).
 *
 * The top of a product page (How it works, Demo, AI-built apps; DESIGN.md §3.11-§3.12): the breadcrumb from the
 * registry (so it equals the page's BreadcrumbList), the h1 in Display L, the lede in Lead, and an optional meta line
 * in mono. The h1 is all fg, as on the other inner pages: its words aren't one of the accent budget's exempt uses there
 * (§2.3). `children` go below (buttons). Nothing here moves.
 */
export function ProductIntro({
  id,
  title,
  lede,
  meta,
  children,
}: {
  id: RouteId;
  title: string;
  lede: string;
  meta?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="container-page pb-10 pt-8 sm:pb-12 sm:pt-12 lg:pb-16 lg:pt-16">
      <Breadcrumbs id={id} />
      <h1 className="mt-6 max-w-heading text-balance font-display text-display-l text-fg">{title}</h1>
      <p className="mt-4 max-w-measure text-pretty text-lead text-muted">{lede}</p>
      {meta ? <p className="mt-4 max-w-measure font-mono text-mono text-dim">{meta}</p> : null}
      {children ? <div className="mt-8">{children}</div> : null}
    </div>
  );
}
