import type { ReactNode } from "react";
import { cx, isExternal } from "./class-names";
import { primitiveLabels } from "./labels";
import { NavLink, type Prefetch } from "./nav-link";

type LinkProps = {
  href: string;
  children: ReactNode;
  /** For a link off the site: where it opens, said to screen readers after the text ("GitHub" → " (opens GitHub)"). */
  opens?: string;
  prefetch?: Prefetch;
  className?: string;
};

function AnyLink({ href, children, opens, prefetch, className }: LinkProps) {
  if (isExternal(href)) {
    return (
      <a className={className} href={href}>
        {children}
        {opens ? <span className="sr-only">{primitiveLabels.opens(opens)}</span> : null}
      </a>
    );
  }
  return (
    <NavLink className={className} href={href} prefetch={prefetch}>
      {children}
    </NavLink>
  );
}

/**
 * A link inside text: accent, and underlined at rest, because a link in a sentence can't be told apart by colour alone
 * (WCAG 1.4.1; axe link-in-text-block). A link off the site ends in ↗.
 */
export function TextLink({ className, ...props }: LinkProps) {
  return <AnyLink {...props} className={cx("text-link", isExternal(props.href) && "has-ext", className)} />;
}

/** A standalone link that ends in an arrow ("See all 26 checks →"): accent, underlined on hover and focus. Off the site it ends in ↗. */
export function ArrowLink({ className, ...props }: LinkProps) {
  return <AnyLink {...props} className={cx("arrow-link", isExternal(props.href) ? "has-ext" : "has-arrow", className)} />;
}
