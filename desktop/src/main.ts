/**
 * Electron main process entry. Wires the application lifecycle to the
 * desktop entry function from `src/entry.ts`.
 *
 * Lifecycle:
 *   1. Set the Playwright environment variables BEFORE any module that
 *      transitively imports the engine is loaded. Rule 4 of
 *      `docs/desktop-architecture.md`.
 *   2. Wait for `app.whenReady()`.
 *   3. Call `startDesktopEngine` to bring up the local server.
 *   4. Create the `BrowserWindow` with the hardened preload and the
 *      loopback URL.
 *   5. On all-windows-closed, stop the engine and quit.
 *
 * The renderer runs with no Node integration and context isolation on
 * (Rule 5). It reaches the local server only through the preload bridge.
 *
 * The engine factory is wired here so the desktop package does not
 * import the engine module directly; the engine is loaded by Electron's
 * Node runtime and handed to the desktop as a factory.
 */

import { applyPlaywrightEnv } from "./apply-env.js";
import { startDesktopEngine, type DesktopEngineFactory, type DesktopServerAdapter, type DesktopServerHandle } from "./entry.js";
import { resolveConfigDir, resolveRunsDir } from "./config.js";
import type { DesktopPlatform } from "./contract.js";
import { hostname, platform as osPlatform, userInfo } from "node:os";

const RUN_HOUND_VERSION = process.env.RUN_HOUND_VERSION ?? "0.0.0-desktop";

function hostPlatform(): DesktopPlatform {
  const p = osPlatform();
  if (p === "darwin" || p === "win32" || p === "linux") return p;
  return "linux";
}

// Step 1: set the Playwright environment variables at module top-level,
// before any import that transitively reaches `app/src/engine/isolation.ts`.
const platform = hostPlatform();
const configDir = resolveConfigDir(platform);
const runsDir = resolveRunsDir(platform);
applyPlaywrightEnv({
  browsersPath: `${runsDir}/.playwright-browsers`,
  skipBrowserGc: "1",
});

async function main(): Promise<void> {
  // Dynamic imports so the env above is definitely in place before the
  // engine module is evaluated.
  const { app, BrowserWindow, shell } = await import("electron");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");

  // Wire the engine factory by importing the engine's Hono factory
  // here in the Electron main process. The engine is exposed as the
  // `run-hound` workspace package; the subpaths are declared in
  // `app/package.json`'s `exports` field.
  const engineModule = (await import("run-hound/server/app" as string).catch(() => null)) as
    | { createApp?: (args: { runsDir: string; boundHost: string }) => { fetch: (r: Request) => Promise<Response> | Response } } | null;
  const createApp = engineModule?.createApp;
  if (typeof createApp !== "function") {
    process.stderr.write("[run-hound] desktop: could not load the engine's createApp from run-hound/server/app\n");
    app.exit(1);
    return;
  }
  const engineFactory: DesktopEngineFactory = (args) => createApp(args);

  // The desktop's server adapter wraps the engine's `startServerWithApp`.
  const serverModule = (await import("run-hound/cli/adapters/server" as string).catch(() => null)) as
    | { startServerWithApp?: (opts: { app: { fetch: (r: Request) => Promise<Response> | Response }; port: number; host: string; stdout: NodeJS.WritableStream }) => DesktopServerHandle } | null;
  const startServerWithApp = serverModule?.startServerWithApp;
  if (typeof startServerWithApp !== "function") {
    process.stderr.write("[run-hound] desktop: could not load the engine's startServerWithApp from run-hound/cli/adapters/server\n");
    app.exit(1);
    return;
  }
  const desktopServer: DesktopServerAdapter = {
    startServer(opts) {
      return startServerWithApp(opts);
    },
  };

  // Hard-block any window the app might open that is not the local
  // server. The renderer can navigate only inside the local server.
  app.on("web-contents-created", (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-navigate", (event, url) => {
      if (!url.startsWith("http://127.0.0.1:") && !url.startsWith("http://localhost:")) {
        event.preventDefault();
        void shell.openExternal(url).catch(() => undefined);
      }
    });
  });

  await app.whenReady();

  const { handle, info } = await startDesktopEngine(
    { configDir, runsDir, headedBrowser: true },
    engineFactory,
    desktopServer,
  );

  const preloadPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "preload.cjs");
  const indexUrl = `${info.url}?version=${encodeURIComponent(info.runHoundVersion)}`;

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: "Run Hound",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
    },
  });

  await win.loadURL(indexUrl);

  app.on("window-all-closed", () => {
    void handle.stop().finally(() => {
      if (process.platform !== "darwin") app.quit();
    });
  });

  // Surface a runtime error to the desktop UI as best we can.
  win.webContents.on("render-process-gone", (_event, details) => {
    process.stderr.write(`[run-hound] renderer gone: ${JSON.stringify(details)}\n`);
  });
}

void main().catch((err: unknown) => {
  process.stderr.write(`[run-hound] desktop main failed: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
