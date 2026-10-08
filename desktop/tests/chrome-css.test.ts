import { describe, expect, it } from "vitest";
import { BRAND } from "../../app/src/core/brand.js";
import { STYLES } from "../../app/src/server/ui/styles.js";
import { TITLE_BAR_CLASS, desktopChromeCss } from "../src/chrome-css.js";
import { TITLE_BAR_HEIGHT } from "../src/shell.js";

describe("desktopChromeCss (the child windows' stylesheet)", () => {
  const css = desktopChromeCss();

  it("scopes every rule under html[data-shell=\"desktop\"]", () => {
    const preludes = [...css.matchAll(/([^{}]+)\{/g)].map((m) => m[1]!.trim());
    expect(preludes.length).toBeGreaterThanOrEqual(4);
    for (const prelude of preludes) expect(prelude).toMatch(/^html\[data-shell="desktop"\]/);
  });

  it("draws the same 36 px draggable strip as the app, and moves the page below it", () => {
    expect(TITLE_BAR_CLASS).toBe("desktop-titlebar");
    expect(css).toContain(`.${TITLE_BAR_CLASS} { position: fixed; top: 0; left: 0; right: 0; height: ${TITLE_BAR_HEIGHT}px;`);
    expect(css).toContain("-webkit-app-region: drag");
    expect(css).toContain(`body { padding-top: ${TITLE_BAR_HEIGHT}px; }`);
    expect(css).toContain(`scroll-padding-top: ${TITLE_BAR_HEIGHT}px`);
  });

  it("uses BRAND for the strip and the scrollbars: --surface-3 thumb on a transparent track, dark controls", () => {
    expect(css).toContain(`background: ${BRAND.bgDeep}`);
    expect(css).toContain(`scrollbar-color: ${BRAND.surface3} transparent`);
    expect(css).toContain("scrollbar-width: thin");
    expect(css).toContain("color-scheme: dark");
  });

  it("matches the app's own scrollbar rule, so the main window and a report scroll alike", () => {
    expect(STYLES).toContain("scrollbar-width: thin; scrollbar-color: var(--surface-3) transparent;");
    expect(STYLES).toContain("color-scheme: dark");
  });
});
