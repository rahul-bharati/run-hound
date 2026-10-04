/**
 * Preload script. Exposes the small bridge surface from the contract
 * to the renderer through `contextBridge`. The renderer cannot reach
 * Node, the filesystem, or any channel not declared here.
 *
 * Wire protocol matches `desktop/src/contract.ts`. Adding a new channel
 * here must also add it to the contract and to the main process's
 * `ipcMain.handle` registrations.
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

const VERSION_CHECK = "desktop:version:check";
const ENGINE_READY = "desktop:engine:ready";
const RUNS_DIR_OPEN = "desktop:runs-dir:open";

interface VersionResponse {
  readonly latest: string | null;
  readonly current: string;
}

interface RunsDirOpenResponse {
  readonly ok: boolean;
  readonly error?: string;
}

contextBridge.exposeInMainWorld("runHoundDesktop", {
  version: {
    check: (): Promise<VersionResponse> => ipcRenderer.invoke(VERSION_CHECK),
  },
  runsDir: {
    open: (): Promise<RunsDirOpenResponse> => ipcRenderer.invoke(RUNS_DIR_OPEN),
  },
  engine: {
    onReady: (cb: (info: { readonly url: string; readonly runHoundVersion: string }) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, info: unknown): void => {
        if (typeof info === "object" && info !== null && "url" in info && "runHoundVersion" in info) {
          cb(info as { readonly url: string; readonly runHoundVersion: string });
        }
      };
      ipcRenderer.on(ENGINE_READY, listener);
      return () => ipcRenderer.removeListener(ENGINE_READY, listener);
    },
  },
});
