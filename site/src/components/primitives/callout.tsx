import type { ReactNode } from "react";
import { cx } from "./class-names";

/**
 * A callout (DESIGN.md §2.5): a note (line-strong rule) or a warning (warn rule), muted text, an optional title. A
 * role="note", not an <aside>: an aside inside <main> would be a complementary landmark.
 */
export function Callout({ tone = "note", title, className, children }: { tone?: "note" | "warn"; title?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <div className={cx("callout", className)} role="note" data-tone={tone}>
      {title ? <p className="callout-title">{title}</p> : null}
      <div className="callout-body">{children}</div>
    </div>
  );
}
