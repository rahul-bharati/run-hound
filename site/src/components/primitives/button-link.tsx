import { SpriteIcon } from "@/components/sprite";
import { cx, isExternal } from "./class-names";
import { NavLink, type Prefetch } from "./nav-link";

/**
 * A link that looks like a button (DESIGN.md §2.5). Primary: accent fill, accent-ink text, an arrow that nudges 2 px;
 * it is one of the accent budget's exempt uses (data-accent-exempt, which the lab's brand audit reads). Secondary:
 * a line-strong outline and fg text. 48 px tall, or 44 in the header (size "header"); :active scales to 0.97.
 *
 * `shortLabel` is what phones show below 640 px (the hero's two buttons share a row there): the full label stays the
 * accessible name, and contains the short one (WCAG 2.5.3). `icon` names a symbol of the page's sprite ("github").
 * `demoState` shows hover, focus or active at rest, for /_design/.
 */
export function ButtonLink({
  href,
  children,
  variant = "primary",
  size = "default",
  icon,
  shortLabel,
  prefetch,
  demoState,
  className,
}: {
  href: string;
  children: string;
  variant?: "primary" | "secondary";
  size?: "default" | "header";
  icon?: string;
  shortLabel?: string;
  prefetch?: Prefetch;
  demoState?: "hover" | "focus" | "active";
  className?: string;
}) {
  const primary = variant === "primary";
  const attributes = {
    className: cx("btn", `btn-${variant}`, size === "header" && "btn-sm", primary && "has-arrow", className),
    "aria-label": shortLabel ? children : undefined,
    "data-accent-exempt": primary ? "" : undefined,
    "data-demo-state": demoState,
  };
  const content = (
    <>
      {icon ? <SpriteIcon name={icon} /> : null}
      {shortLabel ? (
        <>
          <span className="sm:hidden">{shortLabel}</span>
          <span className="max-sm:hidden">{children}</span>
        </>
      ) : (
        children
      )}
    </>
  );
  if (isExternal(href)) {
    return (
      <a href={href} {...attributes}>
        {content}
      </a>
    );
  }
  return (
    <NavLink href={href} prefetch={prefetch} {...attributes}>
      {content}
    </NavLink>
  );
}
