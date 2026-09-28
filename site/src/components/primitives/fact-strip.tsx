import { cx, isExternal } from "./class-names";
import { NavLink, type Prefetch } from "./nav-link";
import { Tick } from "./tick";

/** A fact and the page that proves it: every fact links to its proof. */
export type Fact = { readonly label: string; readonly href: string };

/**
 * The proof strip and the facts line (DESIGN.md §2.5): 14 px items, each with a dim tick (a bullet, not a run result)
 * and each a link to its proof; a 2 × 2 grid on phones, a row from 640 px. Links prefetch on intent: the strip sits in
 * the first viewport, where viewport prefetching would fetch every proof page at once.
 */
export function FactStrip({ items, prefetch = "intent", className }: { items: readonly Fact[]; prefetch?: Prefetch; className?: string }) {
  return (
    <ul className={cx("fact-strip", className)}>
      {items.map((item) => (
        <li key={`${item.href} ${item.label}`} className="fact">
          <Tick tone="bullet" />
          {isExternal(item.href) ? (
            <a href={item.href}>{item.label}</a>
          ) : (
            <NavLink href={item.href} prefetch={prefetch}>
              {item.label}
            </NavLink>
          )}
        </li>
      ))}
    </ul>
  );
}
