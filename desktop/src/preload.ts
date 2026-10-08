/**
 * Preload script. Exposes exactly the contract's `DesktopPreloadBridge` to
 * the renderer through `contextBridge`; the renderer reaches no Node API,
 * no filesystem and no channel not declared in `channels.ts`.
 *
 * Besides the bridge, the only things it touches are two attributes on <html>
 * (data-shell, data-platform) and one <div class="desktop-titlebar">, the
 * strip the UI's styles turn into the window's title bar (chrome.ts, shared with
 * the child windows' chrome-preload.ts). Nothing is added to `window` beyond the bridge.
 *
 * Built as a single CommonJS file, since a sandboxed preload cannot load
 * ES modules or other local files.
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

import { CHANNELS } from "./channels.js";
import { installDesktopChrome } from "./chrome.js";
import type { DesktopEngineReady, DesktopPreloadBridge } from "./contract.js";

const bridge: DesktopPreloadBridge = {
  version: { check: () => ipcRenderer.invoke(CHANNELS.versionCheck) },
  runsDir: { open: () => ipcRenderer.invoke(CHANNELS.runsDirOpen) },
  notices: { take: () => ipcRenderer.invoke(CHANNELS.noticesTake) },
  engine: {
    onReady: (cb) => {
      const listener = (_event: IpcRendererEvent, info: DesktopEngineReady): void => cb(info);
      ipcRenderer.on(CHANNELS.engineReady, listener);
      return () => ipcRenderer.removeListener(CHANNELS.engineReady, listener);
    },
  },
};

contextBridge.exposeInMainWorld("runHoundDesktop", bridge);

installDesktopChrome({ stylesheet: false });
