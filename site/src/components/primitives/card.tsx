import type { ReactNode } from "react";
import { SpriteIcon } from "@/components/sprite";
import { cx } from "./class-names";

/**
 * A card (DESIGN.md §2.4): surface, a 1 px line, radius 16, padding 24 (20 on phones). `interactive` for repeated
 * cards the reader picks from: on hover (where a pointer can hover) the border turns accent at 45%, colour only.
 * `as` sets the element (an <li> in a list, an <article>…). `id` lets a link land on the card, which then rings once
 * (:target, §3.4: the docs hub keeps every old /docs/#id on a card). `demoState` shows the hover at rest, for /_design/.
 */
export function Card({
  as: Element = "div",
  id,
  interactive = false,
  demoState,
  className,
  children,
}: {
  as?: "div" | "li" | "article" | "section";
  id?: string;
  interactive?: boolean;
  demoState?: "hover";
  className?: string;
  children: ReactNode;
}) {
  return (
    <Element id={id} className={cx("card", interactive && "card-hover", className)} data-demo-state={demoState}>
      {children}
    </Element>
  );
}

/** A 40 px surface-2 tile around a 20 px muted icon: `icon` names an icon of the page's sprite (<Sprite icons={{ … }} />). */
export function IconTile({ icon, className }: { icon: string; className?: string }) {
  return (
    <span className={cx("icon-tile", className)} aria-hidden="true">
      <SpriteIcon name={`icon-${icon}`} />
    </span>
  );
}
