import { cx } from "./class-names";

/**
 * A tag (DESIGN.md §2.5): 22 px, a line-strong outline, muted mono 11 px. "Preview", "Signed in", "Added in 0.6.0";
 * never accent, never warn (a preview is not a warning).
 */
export function Tag({ children, className }: { children: string; className?: string }) {
  return <span className={cx("tag", className)}>{children}</span>;
}
