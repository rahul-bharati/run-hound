import type { ReactNode } from "react";
import { cx } from "./class-names";

/** The page column (DESIGN.md §2.1): at most 1280 px, gutters of 16 px, 24 from 640 and 72 from 1024. */
export function Container({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("container-page", className)}>{children}</div>;
}

const twoDigits = (n: number) => String(n).padStart(2, "0");

/**
 * A band of a page (DESIGN.md §2.1): a section with a line-soft hairline on top and 40 / 48 / 80 px of padding, in
 * the page column. `tone` "band" puts it on the tinted bg-band (How it works and Trust on the homepage). `index`
 * draws "02 ── 07" above the heading from 640 px, aria-hidden (the headings carry the structure). Anchors land below the
 * sticky header through the one anchor offset (no scroll-margin here).
 */
export function Band({
  id,
  index,
  tone = "bg",
  labelledBy,
  className,
  children,
}: {
  id?: string;
  index?: { n: number; total: number };
  tone?: "bg" | "band";
  labelledBy?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className={cx("band", tone === "band" && "band-tinted", className)} aria-labelledby={labelledBy}>
      <div className="container-page">
        {index ? (
          <p className="band-index" aria-hidden="true">
            <span className="band-index-n">{twoDigits(index.n)}</span>
            <span className="band-index-rule" />
            <span className="band-index-total">{twoDigits(index.total)}</span>
          </p>
        ) : null}
        {children}
      </div>
    </section>
  );
}

/**
 * A band's heading (DESIGN.md §2.5): the h2 in Display M and an optional intro in Lead (at most 25 words, brand.md's
 * copy rules), in a block at most 48 rem wide. The body follows 24 / 32 / 48 px below.
 */
export function SectionHeading({ id, title, intro, className }: { id?: string; title: ReactNode; intro?: ReactNode; className?: string }) {
  return (
    <div className={cx("section-heading", className)}>
      <h2 id={id} className="section-title">
        {title}
      </h2>
      {intro ? <p className="section-intro">{intro}</p> : null}
    </div>
  );
}
