/**
 * Electron main process.
 *
 *   1. Point the engine at the desktop's config folder and, in a packaged
 *      app that ships its own Chromium, at that browser, BEFORE the engine
 *      is imported (Rule 4 of docs/desktop-architecture.md).
 *   2. Import the bundled engine (dist/engine.js) and bind it to loopback.
 *   3. Open one hardened window on the engine's URL (Rule 5): no Node, an
 *      isolated sandboxed preload, navigation pinned to the engine's origin.
 *
 * The engine runs in this process for now; moving it to a supervised
 * utilityProcess (Rule 6) is the next slice.
 */

import { app, BrowserWindow, dialog, ipcMain, safeStorage, session, shell, type IpcMainInvokeEvent, type WebPreferences } from "electron";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { applyPlaywrightEnv } from "./apply-env.js";
import { CHANNELS } from "./channels.js";
import { resolveConfigDir, resolveRunsDir } from "./config.js";
import type { DesktopEngineReady } from "./contract.js";
import { hostPlatform, startDesktopEngine } from "./entry.js";
import { osKeyProtector } from "./key-protector.js";

const here = dirname(fileURLToPath(import.meta.url));
const platform = hostPlatform();
const configDir = resolveConfigDir(platform);
const runsDir = resolveRunsDir(platform);

// Step 1, before the engine is imported. The engine reads RUNHOUND_CONFIG_DIR for its saved AI and account settings;
// an empty value counts as unset on both sides, so the engine and the reported configDir always agree.
if (!process.env.RUNHOUND_CONFIG_DIR) process.env.RUNHOUND_CONFIG_DIR = configDir;
// A packaged app looks for its own Chromium under resources/playwright-browsers (D3 puts it there). Without one,
// Playwright keeps its default per-user browser cache, which is what a development checkout uses.
const bundledBrowsers = join(process.resourcesPath, "playwright-browsers");
if (app.isPackaged && existsSync(bundledBrowsers)) applyPlaywrightEnv({ browsersPath: bundledBrowsers, skipBrowserGc: "1" });

/** Every window, including the report windows the UI opens, gets these. Only the main window gets the preload. */
const HARDENED: WebPreferences = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  webviewTag: false,
};

/** How long quitting waits for open requests to finish before the app exits anyway. */
const QUIT_GRACE_MS = 3_000;

/** The engine's origin, e.g. "http://127.0.0.1:53111". Empty until the engine is listening. */
let engineOrigin = "";

function isEngineUrl(raw: string): boolean {
  try {
    return engineOrigin !== "" && new URL(raw).origin === engineOrigin;
  } catch {
    return false;
  }
}

/** Hand an outside link to the default browser: web links only, never file:, custom schemes or anything else. */
function openOutside(raw: string): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return;
  }
  if (url.protocol === "https:" || url.protocol === "http:") void shell.openExternal(url.href).catch(() => undefined);
}

/** IPC is answered only for frames showing the engine's own pages. */
function fromEngine(event: IpcMainInvokeEvent): boolean {
  return isEngineUrl(event.senderFrame?.url ?? "");
}

function lockDownContents(): void {
  app.on("web-contents-created", (_event, contents) => {
    // Engine pages (the HTML report, evidence images) open in a hardened window without the bridge; anything else
    // goes to the default browser.
    contents.setWindowOpenHandler(({ url }) => {
      if (isEngineUrl(url)) return { action: "allow", overrideBrowserWindowOptions: { webPreferences: HARDENED } };
      openOutside(url);
      return { action: "deny" };
    });
    // A top-level move off the engine goes to the default browser instead. Subframes (the UI has none) are only
    // stopped, never opened outside, so an embedded page can't launch the browser.
    const pinToEngine = (event: { preventDefault(): void; isMainFrame: boolean; url: string }): void => {
      if (isEngineUrl(event.url)) return;
      event.preventDefault();
      if (event.isMainFrame) openOutside(event.url);
    };
    contents.on("will-navigate", pinToEngine);
    contents.on("will-frame-navigate", pinToEngine);
    contents.on("will-redirect", pinToEngine);
    contents.on("will-attach-webview", (event) => event.preventDefault());
  });
}

/** Needs a ready app: the default session doesn't exist before then. */
function lockDownPermissions(): void {
  // The UI's copy buttons write to the clipboard; no other permission is ever granted. Judged by the requesting
  // frame, not the window, so a foreign frame inside an engine page gets nothing.
  const allowed = (permission: string, origin: string): boolean => permission === "clipboard-sanitized-write" && isEngineUrl(origin);
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback, details) => callback(allowed(permission, details.requestingUrl)));
  session.defaultSession.setPermissionCheckHandler((_contents, permission, requestingOrigin) => allowed(permission, requestingOrigin));
}

async function start(): Promise<void> {
  lockDownContents();
  await app.whenReady();
  lockDownPermissions();

  const engine = await import("./engine.js");
  // Saved keys and passwords are wrapped by the OS keychain when it is a real one (safeStorage works only after ready).
  engine.useOsKeyProtector(osKeyProtector(safeStorage, process.platform));
  const { handle, info } = await startDesktopEngine(
    { configDir, runsDir, runHoundVersion: engine.RUN_HOUND_VERSION },
    (args) => engine.createApp(args),
    { startServer: (args) => engine.startServerWithApp(args) },
  );
  engineOrigin = new URL(info.url).origin;
  registerIpc(info);

  // Closing the server waits for open requests, and a plan or run request can stay open for minutes; quit after a
  // short grace period regardless. Playwright closes its browsers when the process exits.
  let stopping: Promise<void> | undefined;
  const stopEngine = (): Promise<void> =>
    (stopping ??= Promise.race([handle.stop(), new Promise<void>((resolve) => setTimeout(resolve, QUIT_GRACE_MS))]));
  app.on("before-quit", (event) => {
    if (stopping) return;
    event.preventDefault();
    void stopEngine().finally(() => app.quit());
  });
  app.on("window-all-closed", () => app.quit());

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: "Run Hound",
    show: false,
    webPreferences: { ...HARDENED, preload: join(here, "preload.cjs") },
  });
  win.once("ready-to-show", () => win.show());
  win.webContents.on("did-finish-load", () => win.webContents.send(CHANNELS.engineReady, info));
  win.webContents.on("render-process-gone", (_event, details) => {
    process.stderr.write(`[run-hound] renderer gone: ${details.reason}\n`);
  });
  await win.loadURL(info.url);
}

function registerIpc(info: DesktopEngineReady): void {
  // No release feed is wired yet (D4), so the latest version is unknown rather than guessed.
  ipcMain.handle(CHANNELS.versionCheck, (event) => (fromEngine(event) ? { latest: null, current: info.runHoundVersion } : null));
  ipcMain.handle(CHANNELS.runsDirOpen, async (event) => {
    if (!fromEngine(event)) return { ok: false, error: "refused" };
    await mkdir(info.runsDir, { recursive: true });
    const error = await shell.openPath(info.runsDir);
    return error ? { ok: false, error } : { ok: true };
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win?.isMinimized()) win.restore();
    win?.focus();
  });
  start().catch((err: unknown) => {
    const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
    process.stderr.write(`[run-hound] desktop failed to start: ${message}\n`);
    dialog.showErrorBox("Run Hound could not start", message);
    app.exit(1);
  });
}
