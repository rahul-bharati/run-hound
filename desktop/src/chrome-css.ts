/**
 * The stylesheet for pages that don't carry the app's own: the HTML report and the other engine pages (evidence images,
 * JSON) in a child window (D8). It draws the same 36 px title bar strip as the main window and thin brand scrollbars,
 * and moves the page's content below the strip. Colours come from BRAND, the one palette (docs/brand.md).
 *
 * The main window doesn't use this: its stylesheet (app/src/server/ui/styles.ts, under html[data-shell="desktop"])
 * has the same strip and scrollbar rules, so the app and the report look alike. Keep the two in step.
 */

import { BRAND } from "../../app/src/core/brand.js";
import { TITLE_BAR_HEIGHT } from "./shell.js";

/** Class of the strip the preload inserts as the first element of <body>. */
export const TITLE_BAR_CLASS = "desktop-titlebar";

export function desktopChromeCss(): string {
  const h = TITLE_BAR_HEIGHT;
  const scope = 'html[data-shell="desktop"]';
  return [
    // color-scheme: dark makes the page canvas, form controls and <select> popups dark even on a page that never says so (JSON).
    `${scope} { color-scheme: dark; scroll-padding-top: ${h}px; }`,
    `${scope}, ${scope} * { scrollbar-width: thin; scrollbar-color: ${BRAND.surface3} transparent; }`,
    `${scope} body { padding-top: ${h}px; }`,
    // Same colour as the report's own top bar, so the two read as one bar.
    `${scope} .${TITLE_BAR_CLASS} { position: fixed; top: 0; left: 0; right: 0; height: ${h}px; z-index: 2147483647; -webkit-app-region: drag; user-select: none; ` +
      `background: ${BRAND.bgDeep}; }`,
  ].join("\n");
}
