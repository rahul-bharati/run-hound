/**
 * What the preloads do to a page before it is shown, shared by preload.ts (the main window) and chrome-preload.ts (the
 * child windows): mark <html data-shell="desktop" data-platform="…"> so the styles apply from the first paint, and add
 * the <div class="desktop-titlebar"> strip that becomes the window's title bar. Nothing is added to `window`.
 * Bundled into each preload by scripts/build.mjs, since a sandboxed preload cannot load other local files.
 */

import { webFrame } from "electron";

import { TITLE_BAR_CLASS, desktopChromeCss } from "./chrome-css.js";

export interface InstallOptions {
  /**
   * Inject the strip and scrollbar stylesheet (chrome-css.ts). The main window's page has these rules in its own
   * stylesheet; the report and other engine pages don't. Injected with webFrame.insertCSS (electron.d.ts, WebFrame),
   * not a <style> element: the engine's default policy is `default-src 'none'` (DEFAULT_CSP in
   * app/src/constants/server-constants.ts), which blocks a style element a script adds (checked in Electron 44.5.1),
   * while an injected stylesheet is not subject to the page's policy.
   */
  readonly stylesheet: boolean;
}

/** Tells the styles they are inside the desktop app. Safe to call again; does nothing while there is no <html> yet. */
function markDesktopShell(): void {
  const root: HTMLElement | null = document.documentElement;
  if (!root) return;
  root.dataset.shell = "desktop";
  root.dataset.platform = process.platform;
}

export function installDesktopChrome({ stylesheet }: InstallOptions): void {
  if (stylesheet) {
    try {
      webFrame.insertCSS(desktopChromeCss());
    } catch {
      // The page still works without its strip's styles; never let a styling problem stop it loading.
    }
  }

  // The preload runs before the document has an <html> element, and the styles should apply from the first paint, so
  // wait for the element itself rather than for the end of parsing.
  if (document.documentElement) {
    markDesktopShell();
  } else {
    new MutationObserver((_records, observer) => {
      if (!document.documentElement) return;
      markDesktopShell();
      observer.disconnect();
    }).observe(document, { childList: true });
  }

  document.addEventListener(
    "DOMContentLoaded",
    () => {
      markDesktopShell();
      if (!document.body || document.querySelector(`.${TITLE_BAR_CLASS}`)) return;
      const strip = document.createElement("div");
      strip.className = TITLE_BAR_CLASS;
      strip.setAttribute("aria-hidden", "true");
      document.body.prepend(strip);
    },
    { once: true },
  );
}
