import type { ReactNode } from "react";
import type { RouteId } from "@/content/routes";
import { Breadcrumbs } from "@/components/primitives/breadcrumbs";

/**
 * The top of a project page (open source, FAQ, compare; DESIGN.md §3.8-§3.10): the breadcrumb from the registry (so it
 * equals the page's BreadcrumbList), the h1 in Display L, the lede in Lead, and an optional meta line in mono ("For
 * release 0.6.0 · 27 September 2026") on pages whose answers are dated. The h1 is all fg: an inner page's h1 is not one
 * of the accent budget's exempt uses (§2.3). Nothing here moves.
 */
export function PageIntro({ id, title, lede, meta }: { id: RouteId; title: string; lede: string; meta?: ReactNode }) {
  return (
    <div className="container-page pb-10 pt-8 sm:pb-12 sm:pt-12 lg:pb-16 lg:pt-16">
      <Breadcrumbs id={id} />
      <h1 className="mt-6 max-w-heading text-balance font-display text-display-l text-fg">{title}</h1>
      <p className="mt-4 max-w-measure text-pretty text-lead text-muted">{lede}</p>
      {meta ? <p className="mt-4 font-mono text-mono text-dim">{meta}</p> : null}
    </div>
  );
}
