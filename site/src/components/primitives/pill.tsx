import { cx, isExternal } from "./class-names";
import { NavLink, type Prefetch } from "./nav-link";

/**
 * The release pill (DESIGN.md §2.5): 32 px, a line-strong outline, muted sans 13 px, one line; only its arrow moves. On
 * hover and focus its words turn fg over an accent underline (§4.3), so they sit in their own span. `demoState` shows the
 * hover at rest, for /_design/.
 */
export function Pill({
  href,
  children,
  prefetch,
  demoState,
  className,
}: {
  href: string;
  children: string;
  prefetch?: Prefetch;
  demoState?: "hover";
  className?: string;
}) {
  const classes = cx("pill", "has-arrow", className);
  const text = <span className="pill-text">{children}</span>;
  if (isExternal(href)) {
    return (
      <a className={classes} href={href} data-demo-state={demoState}>
        {text}
      </a>
    );
  }
  return (
    <NavLink className={classes} href={href} prefetch={prefetch} data-demo-state={demoState}>
      {text}
    </NavLink>
  );
}
