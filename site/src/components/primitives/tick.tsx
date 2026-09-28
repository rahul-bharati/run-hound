import { cx } from "./class-names";

/** The tick's one shape, in a 16 × 16 box: the sprite's <symbol id="tick"> and a drawable tick share it. */
export const tickPath = "M3.5 8.5 6.5 11.5 12.5 4.5";

/**
 * A tick (DESIGN.md §2.5): accent ("pass") marks a pass or a check, dim ("bullet") marks a list item. It uses the
 * page sprite's one tick (<Sprite /> renders it). A tick the motion code draws in (the hero's plan rows, the check
 * cards) sets `draw`: DrawSVG can't draw through a <use>, so it gets its own path, marked data-part="tick".
 * Decorative: the text beside it carries the meaning.
 */
export function Tick({ tone = "pass", draw = false, className }: { tone?: "pass" | "bullet"; draw?: boolean; className?: string }) {
  return (
    <svg className={cx("tick", `tick-${tone}`, className)} aria-hidden="true" viewBox="0 0 16 16" focusable="false">
      {draw ? <path data-part="tick" d={tickPath} /> : <use href="#tick" />}
    </svg>
  );
}
