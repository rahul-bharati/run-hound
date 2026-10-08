/**
 * Preload script. Exposes exactly the contract's `DesktopPreloadBridge` to
 * the renderer through `contextBridge`; the renderer reaches no Node API,
 * no filesystem and no channel not declared in `channels.ts`.
 *
 * Besides the bridge, the only things it touches are two attributes on <html>
 * (data-shell, data-platform) and one <div class="desktop-titlebar">, the
 * strip the UI's styles turn into the window's title bar. Nothing is added
 * to `window` beyond the bridge.
 *
 * Built as a single CommonJS file, since a sandboxed preload cannot load
 * ES modules or other local files.
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

import { CHANNELS } from "./channels.js";
import type { DesktopEngineReady, DesktopPreloadBridge } from "./contract.js";

const bridge: DesktopPreloadBridge = {
  version: { check: () => ipcRenderer.invoke(CHANNELS.versionCheck) },
  runsDir: { open: () => ipcRenderer.invoke(CHANNELS.runsDirOpen) },
  engine: {
    onReady: (cb) => {
      const listener = (_event: IpcRendererEvent, info: DesktopEngineReady): void => cb(info);
      ipcRenderer.on(CHANNELS.engineReady, listener);
      return () => ipcRenderer.removeListener(CHANNELS.engineReady, listener);
    },
  },
};

contextBridge.exposeInMainWorld("runHoundDesktop", bridge);

/** Tells the UI's styles it is inside the desktop app. Safe to call again; does nothing while there is no <html> yet. */
function markDesktopShell(): void {
  const root: HTMLElement | null = document.documentElement;
  if (!root) return;
  root.dataset.shell = "desktop";
  root.dataset.platform = process.platform;
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
    if (document.querySelector(".desktop-titlebar")) return;
    const strip = document.createElement("div");
    strip.className = "desktop-titlebar";
    strip.setAttribute("aria-hidden", "true");
    document.body.prepend(strip);
  },
  { once: true },
);
