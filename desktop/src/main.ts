/**
 * Electron main process.
 *
 *   1. Point the engine at the desktop's config folder and, in a packaged
 *      app that ships its own Chromium, at that browser, BEFORE the engine
 *      is imported (Rule 4 of docs/desktop-architecture.md).
 *   2. Check that the browser is there and the settings and results folders
 *      can be written; if not, say what to do in a branded start-up error
 *      window (static/startup-error.html) and exit.
 *   3. Import the bundled engine (dist/engine.js), import the command line's
 *      settings once, and bind the engine to loopback.
 *   4. Open one hardened window on the engine's URL (Rule 5): no Node, an
 *      isolated sandboxed preload, navigation pinned to the engine's origin.
 *      The window is dark and has the UI's own title bar (shell.ts). The report
 *      and engine pages it opens get the same look in their own windows, and
 *      every window has the same small right-click menu. Messages for the user
 *      (the settings import) are queued here and shown by the UI as in-app
 *      banners; the app opens no native message box.
 *   5. After start-up, problems appear in Run Hound's own windows too (D11): an error in the main process in a small
 *      window of its own, a page that fails to load or a renderer that crashes in the window itself, both on
 *      static/problem.html. The app never shows Electron's own error box or Chromium's error page.
 *
 * The engine runs in this process for now; moving it to a supervised
 * utilityProcess (Rule 6) is the next slice.
 */

import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, net, safeStorage, session, shell, type IpcMainInvokeEvent, type WebContents, type WebPreferences } from "electron";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { applyPlaywrightEnv } from "./apply-env.js";
import { CHANNELS } from "./channels.js";
import { resolveCliConfigDir, resolveConfigDir, resolveRunsDir } from "./config.js";
import { contextMenuTemplate } from "./context-menu.js";
import type { DesktopEngineReady, DesktopVersionCheckChannel } from "./contract.js";
import { hostPlatform, startDesktopEngine } from "./entry.js";
import { createErrorReporter } from "./error-reporter.js";
import { importFailedNotice, importedNotice, type Notice } from "./import-notice.js";
import { osKeyProtector } from "./key-protector.js";
import { createNoticeQueue, type NoticeQueue } from "./notices.js";
import { PROBLEM_PAGE, problemAction, problemQuery, type Problem, type ProblemAction } from "./problem-page.js";
import { ERR_ABORTED, crashProblem, loadFailureProblem, pathOf } from "./problem-text.js";
import { appMenuTemplate, childWindowOptions, dialogWindowOptions, windowOptions } from "./shell.js";
import { STARTUP_PROBLEM_TITLE, describeStartupProblems, runStartupChecks } from "./startup-checks.js";
import { STARTUP_ERROR_PAGE, startupErrorQuery } from "./startup-error.js";
import { createUpdateChecker, updateCheckDisabled } from "./update-check.js";

const here = dirname(fileURLToPath(import.meta.url));
const platform = hostPlatform();
// The command line's settings folder, read from the environment as it is now: once RUNHOUND_CONFIG_DIR is set below
// it would name the desktop's own folder.
const cliConfigDir = resolveCliConfigDir();
const configDir = resolveConfigDir(platform);
const runsDir = resolveRunsDir(platform);
/** The mark on a rounded square, copied next to this file by scripts/build.mjs. */
const iconPath = join(here, "icon.png");

// After start-up, an error in this process is shown in a Run Hound window, never in Electron's own error box (which a
// listener of ours on uncaughtException replaces). Registered first, so an error in the rest of this file is covered.
/** The engine's redactSecrets once the engine is loaded (start()); before that there is nothing of it to hide. */
let redactText: ((text: string) => string) | null = null;
const errors = createErrorReporter({
  log: (text) => void process.stderr.write(text),
  show: (problem) => showErrorWindow(problem),
  fallback: (title, text) => dialog.showErrorBox(title, text),
  redact: (text) => (redactText ? redactText(text) : text),
});
process.on("uncaughtException", (err, origin) => errors.report(err, origin));
process.on("unhandledRejection", (reason) => errors.report(reason, "unhandledRejection"));

// Step 1, before the engine is imported. The engine reads RUNHOUND_CONFIG_DIR for its saved AI and account settings;
// an empty value counts as unset on both sides, so the engine and the reported configDir always agree.
if (!process.env.RUNHOUND_CONFIG_DIR) process.env.RUNHOUND_CONFIG_DIR = configDir;
// The desktop ships only the full Chromium (manual sign-in needs a visible browser, Rule 3), so the engine's headless
// launches use that build too instead of Playwright's separate headless shell (app/src/engine/isolation.ts).
process.env.RUNHOUND_FULL_CHROMIUM = "1";
// A packaged app ships its own Chromium under resources/playwright-browsers (scripts/fetch-browsers.mjs, copied by
// electron-builder's extraResources). A development checkout keeps Playwright's default per-user browser cache.
const bundledBrowsers = join(process.resourcesPath, "playwright-browsers");
if (app.isPackaged && existsSync(bundledBrowsers)) applyPlaywrightEnv({ browsersPath: bundledBrowsers, skipBrowserGc: "1" });

/** Every window, including the report windows the UI opens, gets these. Each window kind adds its own preload, or none. */
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
    // Engine pages (the HTML report, evidence images) open in a hardened window with the Run Hound look and without the
    // bridge: its preload only draws the title bar strip (chrome-preload.ts). Anything else goes to the default browser.
    contents.setWindowOpenHandler(({ url }) => {
      if (isEngineUrl(url)) {
        return { action: "allow", overrideBrowserWindowOptions: childWindowOptions({ platform, webPreferences: { ...HARDENED, preload: join(here, "chrome-preload.cjs") }, iconPath }) };
      }
      openOutside(url);
      return { action: "deny" };
    });
    // The same small right-click menu in every window (context-menu.ts); nothing pops up when it has nothing to offer.
    contents.on("context-menu", (_event, params) => {
      const template = contextMenuTemplate(params, {
        copyText: (text) => void clipboard.writeText(text).catch(() => undefined),
        // Developer tools only when run from source, like the Developer menu on macOS (shell.ts).
        ...(app.isPackaged ? {} : { inspect: () => contents.inspectElement(params.x, params.y) }),
      });
      if (template.length === 0) return;
      Menu.buildFromTemplate(template).popup({
        window: BrowserWindow.fromWebContents(contents) ?? undefined,
        ...(params.frame ? { frame: params.frame } : {}),
        sourceType: params.menuSourceType,
      });
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

/** Each window's problem page while it shows one: the buttons it offers and what each does. Read by watchWindowProblems. */
const problemPages = new WeakMap<WebContents, { offered: readonly ProblemAction[]; run(action: ProblemAction): void }>();

/** The main window's page: the only window whose problem page offers Quit (a child window is closed like any other). */
let mainContents: WebContents | undefined;

/** True while the start-up error window is open: it is the problem on screen, so an error meanwhile is only logged. */
let startupFailureOpen = false;

/** True once closing the last window no longer quits by itself (see showErrorWindow). */
let keptAlive = false;

/**
 * Loads static/problem.html into `contents` with these buttons. A button press reaches `run` through the page's own
 * address (problem-page.ts), heard by watchWindowProblems. Rejects when the page can't be loaded.
 */
async function loadProblemPage(contents: WebContents, problem: Problem, actions: readonly ProblemAction[], run: (action: ProblemAction) => void): Promise<void> {
  problemPages.set(contents, { offered: actions, run });
  try {
    await contents.loadFile(join(here, PROBLEM_PAGE), { query: problemQuery(problem, actions) });
  } catch (err) {
    problemPages.delete(contents);
    throw err;
  }
}

/**
 * Shows `problem` in the window of `contents`, in place of the page that failed. `again` loads `target` anew: "retry"
 * for a page that would not load, "reload" for one whose renderer crashed. The main window can also quit the app.
 */
function showWindowProblem(contents: WebContents, problem: Problem, target: string, again: "retry" | "reload"): void {
  if (contents.isDestroyed()) return;
  const run = (action: ProblemAction): void => {
    if (action === "quit") return app.quit();
    problemPages.delete(contents);
    // A load that fails again shows this page again (did-fail-load), so a rejection needs no handling here.
    contents.loadURL(target).catch(() => undefined);
  };
  loadProblemPage(contents, problem, contents === mainContents ? [again, "quit"] : [again], run).catch((err: unknown) => {
    if (!contents.isDestroyed()) process.stderr.write(`[run-hound] could not show the problem page: ${err instanceof Error ? err.message : String(err)}\n`);
  });
}

/**
 * For every app window: a page that fails to load, or a renderer that crashes, shows the problem page (D11) instead of
 * Chromium's own error page; and the problem page's buttons are heard. A failure of a subframe is ignored, as is
 * ERR_ABORTED, which is a navigation another one replaced. Only the engine's pages are handled: Run Hound's own files
 * (the problem page itself, the start-up error window) cannot fail into themselves, so nothing can loop.
 */
function watchWindowProblems(): void {
  app.on("web-contents-created", (_event, contents) => {
    if (contents.getType() !== "window") return;
    contents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
      if (!isMainFrame || code === ERR_ABORTED || !isEngineUrl(url)) return;
      // The path only: the address can carry a token in its query.
      process.stderr.write(`[run-hound] a window could not load ${pathOf(url)}: ${description} (${code})\n`);
      showWindowProblem(contents, loadFailureProblem({ code, description, url }), url, "retry");
    });
    contents.on("render-process-gone", (_event, details) => {
      process.stderr.write(`[run-hound] renderer gone: ${details.reason}\n`);
      const url = contents.getURL();
      if (details.reason !== "clean-exit" && isEngineUrl(url)) showWindowProblem(contents, crashProblem(details.reason, url), url, "reload");
    });
    // The problem page changes its own address to press a button; a navigation within a page doesn't reach will-navigate.
    contents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
      const page = problemPages.get(contents);
      const action = page && isMainFrame ? problemAction(url, page.offered) : null;
      if (action) page?.run(action);
    });
  });
}

/**
 * The window for an error in the main process (error-reporter.ts): Run Hound's look, the problem in plain words, and
 * two choices, keep using Run Hound (closes the window) or quit. Resolves when it is closed; rejects if it can't be shown.
 */
async function showErrorWindow(problem: Problem): Promise<void> {
  if (startupFailureOpen) return;
  // An error can come before the app is ready (windows need it) or before the main window exists.
  await app.whenReady();
  if (!keptAlive) {
    // With no listener, closing the last window would quit the app, and this window may be the only one while the
    // app is still starting; start() adds the listener that quits once the main window exists.
    keptAlive = true;
    app.on("window-all-closed", () => undefined);
  }
  const win = new BrowserWindow(dialogWindowOptions({ platform, webPreferences: { ...HARDENED }, iconPath }));
  const closed = new Promise<void>((resolve) => win.once("closed", resolve));
  try {
    await loadProblemPage(win.webContents, problem, ["dismiss", "quit"], (action) => (action === "quit" ? app.quit() : win.close()));
  } catch (err) {
    // Closed before the page finished loading: the user has seen enough.
    if (win.isDestroyed()) return;
    win.destroy();
    throw err;
  }
  await closed;
}

/** Dark native chrome, the application menu and, when run from source on macOS, the dock icon. Needs a ready app. */
function applyLook(): void {
  nativeTheme.themeSource = "dark";
  const template = appMenuTemplate(platform, "Run Hound", app.isPackaged);
  Menu.setApplicationMenu(template ? Menu.buildFromTemplate(template) : null);
  // A packaged macOS app takes its icon from the bundle; only a development run needs it set.
  if (!app.isPackaged) app.dock?.setIcon(iconPath);
}

/**
 * Says what is wrong in the branded start-up error window and resolves when the user has closed it (the Quit button
 * closes it too). If that window can't be made, falls back to the native error box, so the user is never left with
 * nothing. The caller exits the app afterwards.
 */
async function showStartupFailure(problems: readonly string[], details?: string): Promise<void> {
  startupFailureOpen = true;
  // With no window-all-closed listener yet, closing the last window would start Electron's own quit (exit code 0). The
  // caller exits with 1 right after, so the listener is never removed.
  app.on("window-all-closed", () => undefined);
  let win: BrowserWindow | undefined;
  try {
    win = new BrowserWindow(dialogWindowOptions({ platform, webPreferences: { ...HARDENED }, iconPath }));
    const closed = new Promise<void>((resolve) => win?.once("closed", resolve));
    await win.loadFile(join(here, STARTUP_ERROR_PAGE), { query: startupErrorQuery(STARTUP_PROBLEM_TITLE, problems, details) });
    await closed;
  } catch (err) {
    // Closed before the page finished loading: the user has seen enough, so don't show a second message.
    if (win?.isDestroyed()) return;
    process.stderr.write(`[run-hound] could not show the start-up error window: ${err instanceof Error ? err.message : String(err)}\n`);
    win?.destroy();
    dialog.showErrorBox(STARTUP_PROBLEM_TITLE, [...problems, ...(details ? [details] : [])].join("\n\n"));
  }
}

/** Step 2. Before the engine is imported, so a problem is reported here and not as a failure inside a run. */
async function checkStartup(): Promise<boolean> {
  // The environment is applied above, so Playwright resolves the same browser the engine will launch.
  const { chromium } = await import("playwright");
  const browserExecutable = ((): string | undefined => {
    try {
      return chromium.executablePath() || undefined;
    } catch {
      return undefined;
    }
  })();
  const problems = await runStartupChecks({ packaged: app.isPackaged, bundledBrowsersDir: bundledBrowsers, browserExecutable, configDir, runsDir });
  if (problems.length === 0) return true;
  process.stderr.write(`[run-hound] ${STARTUP_PROBLEM_TITLE}:\n${describeStartupProblems(problems)}\n`);
  await showStartupFailure(problems.map((problem) => problem.message));
  return false;
}

/** Imports the command line's settings once (nothing happens on later launches). Never throws: the app starts either way. */
async function importCliSettings(engine: typeof import("./engine.js")): Promise<Notice | null> {
  try {
    const imported = await engine.importCliSettingsOnce(cliConfigDir, configDir);
    if (imported === null) return null;
    process.stderr.write(`[run-hound] imported settings from ${imported.from}: ${imported.files.join(", ") || "no files"}, ${imported.secrets} saved key(s)\n`);
    if (imported.problem) process.stderr.write(`[run-hound] saved keys were not imported: ${imported.problem}\n`);
    return importedNotice(imported);
  } catch (err) {
    process.stderr.write(`[run-hound] could not import settings from ${cliConfigDir}: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
    return importFailedNotice(cliConfigDir, err);
  }
}

async function start(): Promise<void> {
  lockDownContents();
  watchWindowProblems();
  await app.whenReady();
  lockDownPermissions();
  // Before any window exists, so none is created in the light theme.
  applyLook();

  if (!(await checkStartup())) {
    app.exit(1);
    return;
  }

  const engine = await import("./engine.js");
  redactText = engine.redactSecrets;
  app.setAboutPanelOptions({ applicationName: "Run Hound", applicationVersion: engine.RUN_HOUND_VERSION });
  // Saved keys and passwords are wrapped by the OS keychain when it is a real one (safeStorage works only after ready).
  engine.useOsKeyProtector(osKeyProtector(safeStorage, process.platform));
  // After the protector, so imported keys are sealed under the keychain; before the engine serves its first request.
  // Queued for the UI to take once it loads (the notices channel), not shown in a native message box.
  const notices = createNoticeQueue();
  const imported = await importCliSettings(engine);
  if (imported) notices.add(imported);
  const { handle, info } = await startDesktopEngine(
    { configDir, runsDir, runHoundVersion: engine.RUN_HOUND_VERSION },
    (args) => engine.createApp(args),
    { startServer: (args) => engine.startServerWithApp(args) },
  );
  engineOrigin = new URL(info.url).origin;
  // One version check per launch (docs/desktop-architecture.md Rule 8): started once the window shows, answered from
  // the same result whenever the UI asks, and off with RUNHOUND_NO_UPDATE_CHECK=1.
  // Electron's net.fetch goes through Chromium's network stack, so the check honours the system's proxy settings.
  const checkForUpdate = createUpdateChecker({ fetch: (url, init) => net.fetch(url, init), current: info.runHoundVersion, disabled: updateCheckDisabled() });
  registerIpc(info, checkForUpdate, notices);

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

  const win = new BrowserWindow(windowOptions({ platform, webPreferences: { ...HARDENED, preload: join(here, "preload.cjs") }, iconPath }));
  mainContents = win.webContents;
  win.once("ready-to-show", () => {
    win.show();
    // In the background, after the window is up: never awaited, so a slow or blocked network can't delay startup.
    void checkForUpdate();
  });
  // Only the engine's page is told the engine is ready, not the problem page that can replace it.
  win.webContents.on("did-finish-load", () => {
    if (isEngineUrl(win.webContents.getURL())) win.webContents.send(CHANNELS.engineReady, info);
  });
  // A load that fails is logged and shown by the window itself, with Try again and Quit (watchWindowProblems), and the
  // app stays up; the rejection here is the same failure (or the load that replaced it), so there is nothing to add.
  await win.loadURL(info.url).catch(() => undefined);
}

function registerIpc(info: DesktopEngineReady, checkForUpdate: () => Promise<DesktopVersionCheckChannel["response"]>, notices: NoticeQueue): void {
  // The cached result of the launch's one check; it never rejects, and a failed check answers "nothing newer".
  ipcMain.handle(CHANNELS.versionCheck, (event) => (fromEngine(event) ? checkForUpdate() : null));
  // The UI takes the waiting notices once, when it loads; asked by anything else, nothing is handed over or cleared.
  ipcMain.handle(CHANNELS.noticesTake, (event) => (fromEngine(event) ? notices.take() : []));
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
    const firstLine = err instanceof Error ? err.message : String(err);
    void showStartupFailure([firstLine], message === firstLine ? undefined : message).finally(() => app.exit(1));
  });
}
