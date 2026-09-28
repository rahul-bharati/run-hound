"use client";

import type { FocusEvent, ReactNode } from "react";

/**
 * The compare table's scroll region (§3.10): focusable, so the keyboard can scroll it, and labelled by the table's
 * caption. Its scroll padding (the caller's scroll-pl-*) is the sticky capability column's width, so a link the browser
 * scrolls into view lands clear of the column. Chromium doesn't scroll a link that is already partly in view, though,
 * so one could stay almost entirely under the column (102 of 103 px at 1024 px in the lab before this handler). On
 * focus, this scrolls such a link clear too (WCAG 2.4.11). Without JavaScript the scroll padding alone applies.
 */
export function ScrollRegion({ labelledBy, className, children }: { labelledBy: string; className?: string; children: ReactNode }) {
  return (
    <div role="region" aria-labelledby={labelledBy} tabIndex={0} className={className} onFocus={keepClear}>
      {children}
    </div>
  );
}

/** Scrolls the focused element right of the region's scroll padding, if any of it is left of that edge. */
function keepClear(event: FocusEvent<HTMLDivElement>) {
  const region = event.currentTarget;
  if (event.target === region) return;
  const padding = Number.parseFloat(getComputedStyle(region).scrollPaddingLeft) || 0;
  const edge = region.getBoundingClientRect().left + region.clientLeft + padding;
  const hidden = edge - event.target.getBoundingClientRect().left;
  if (hidden > 0) region.scrollLeft -= hidden;
}
