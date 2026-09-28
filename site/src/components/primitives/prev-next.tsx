import type { NavLink as Target } from "@/lib/nav";
import { primitiveLabels } from "./labels";
import { NavLink } from "./nav-link";

/**
 * Two cards, "Previous" and "Next" (DESIGN.md §2.5), in the registry's docs order: pass lib/nav.ts's prevNext(id).
 * Nothing when there is neither. Prefetched on intent, like the sidebar.
 */
export function PrevNext({ prev, next }: { prev?: Target; next?: Target }) {
  if (!prev && !next) return null;
  return (
    <nav aria-label={primitiveLabels.pager} className="prev-next">
      {prev ? (
        <NavLink href={prev.href} prefetch="intent" className="card card-hover prev-next-link" data-dir="prev">
          <span className="prev-next-dir">{primitiveLabels.previous}</span>
          <span className="prev-next-label">{prev.label}</span>
        </NavLink>
      ) : null}
      {next ? (
        <NavLink href={next.href} prefetch="intent" className="card card-hover prev-next-link" data-dir="next">
          <span className="prev-next-dir">{primitiveLabels.next}</span>
          <span className="prev-next-label">{next.label}</span>
        </NavLink>
      ) : null}
    </nav>
  );
}
