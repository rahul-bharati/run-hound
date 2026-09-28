import type { ReactNode } from "react";
import { cx } from "./class-names";

/** A panel of facts (DESIGN.md §2.5): a <dl> on surface with mono keys, as a check page's facts and the FAQ's "At a glance". */
export function FactsList({ items, className }: { items: readonly { term: string; detail: ReactNode }[]; className?: string }) {
  return (
    <dl className={cx("facts-list", className)}>
      {items.map((item) => (
        <div key={item.term} className="facts-row">
          <dt>{item.term}</dt>
          <dd>{item.detail}</dd>
        </div>
      ))}
    </dl>
  );
}
