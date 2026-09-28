import type { RouteId } from "@/content/routes";
import { breadcrumbTrail } from "@/lib/nav";
import { cx } from "./class-names";
import { primitiveLabels } from "./labels";
import { NavLink } from "./nav-link";

/**
 * The visible breadcrumb (DESIGN.md §2.5, brief §3.6), from the registry like the page's BreadcrumbList, so the two
 * always agree. One line on phones: the middle items shorten with an ellipsis first. The current page is not a link.
 */
export function Breadcrumbs({ id, className }: { id: RouteId; className?: string }) {
  const trail = breadcrumbTrail(id);
  return (
    <nav aria-label={primitiveLabels.breadcrumb} className={cx("breadcrumbs", className)}>
      <ol>
        {trail.map((crumb, i) => (
          <li key={crumb.path}>
            {i > 0 ? (
              <span className="crumb-sep" aria-hidden="true">
                /
              </span>
            ) : null}
            {i === trail.length - 1 ? (
              <span className="crumb" aria-current="page">
                {crumb.name}
              </span>
            ) : (
              <NavLink className="crumb" href={crumb.path} prefetch="intent">
                {crumb.name}
              </NavLink>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
