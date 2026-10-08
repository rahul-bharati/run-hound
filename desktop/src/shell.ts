/**
 * The desktop windows' look: their options per platform and the application menu. Pure data, so the shape is unit
 * tested; main.ts applies it. Electron is imported for types only, so tests load this without the runtime.
 *
 * The title bar is the page's own (a 36 px strip drawn by the preload and styled by the UI's stylesheet, or by
 * chrome-css.ts in the child windows); the system draws only the window buttons on top of it. Every window the app
 * opens gets this look: the main window, the report and engine pages in child windows, and the start-up error window.
 */

import type { BrowserWindowConstructorOptions, MenuItemConstructorOptions, WebPreferences } from "electron";

import { BRAND } from "../../app/src/core/brand.js";
import type { DesktopPlatform } from "./contract.js";

/** Height of the title bar strip, in CSS pixels. The `.desktop-titlebar` rule in the UI's styles uses the same number. */
export const TITLE_BAR_HEIGHT = 36;

/** Colour of the strip in the child windows and the start-up error window: the report's own top bar. */
export const CHILD_STRIP_COLOR: string = BRAND.bgDeep;

export interface WindowOptionsInput {
  platform: DesktopPlatform;
  webPreferences: WebPreferences;
  /** The window icon, a PNG. Windows and Linux only: macOS takes it from the app bundle. */
  iconPath: string;
  /** The strip's colour under the window buttons (Windows and Linux). Defaults to the UI's page colour. */
  stripColor?: string;
}

/**
 * Options for the main window.
 *
 * - `backgroundColor` is the UI's page colour, so the window never flashes white before the page paints.
 * - macOS: a hidden, inset title bar whose traffic lights sit in the strip, over the sidebar's left edge.
 * - Windows and Linux: a hidden title bar plus the window controls overlay (`titleBarOverlay`, which electron.d.ts
 *   lists for both win32 and linux), drawn in the strip's colour with the muted symbol colour.
 */
export function windowOptions({ platform, webPreferences, iconPath, stripColor = BRAND.bg }: WindowOptionsInput): BrowserWindowConstructorOptions {
  const base: BrowserWindowConstructorOptions = {
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: "Run Hound",
    show: false,
    backgroundColor: BRAND.bg,
    webPreferences,
  };
  if (platform === "darwin") {
    // y centres the 12 px lights in the strip; x lines them up with the sidebar's own padding.
    return { ...base, titleBarStyle: "hiddenInset", trafficLightPosition: { x: 14, y: Math.floor((TITLE_BAR_HEIGHT - 12) / 2) } };
  }
  return {
    ...base,
    icon: iconPath,
    titleBarStyle: "hidden",
    titleBarOverlay: { color: stripColor, symbolColor: BRAND.muted, height: TITLE_BAR_HEIGHT },
  };
}

/**
 * The report and engine pages the UI opens in their own window: the same look as the main window (title bar strip,
 * icon, background), roomier than the dialog and shown at once. `webPreferences` carries the child windows' preload,
 * which draws the strip and exposes nothing.
 */
export function childWindowOptions(input: Omit<WindowOptionsInput, "stripColor">): BrowserWindowConstructorOptions {
  return { ...windowOptions({ ...input, stripColor: CHILD_STRIP_COLOR }), width: 1100, height: 800, minWidth: 640, minHeight: 420, show: true };
}

/** Size of the start-up error window, in content pixels. */
export const DIALOG_SIZE = { width: 600, height: 380 } as const;

/**
 * The start-up error window: the same look, small and fixed. It can't be resized, minimised, maximised or made full
 * screen, so on Windows and Linux its window controls are just the close button.
 */
export function dialogWindowOptions(input: Omit<WindowOptionsInput, "stripColor">): BrowserWindowConstructorOptions {
  const { width, height } = DIALOG_SIZE;
  return {
    ...windowOptions({ ...input, stripColor: CHILD_STRIP_COLOR }),
    width,
    height,
    minWidth: width,
    minHeight: height,
    useContentSize: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: true,
  };
}

/**
 * The application menu: a minimal one on macOS, where the menu bar always exists and the clipboard shortcuts work
 * only through the Edit menu; none elsewhere, where Chromium handles those shortcuts in text fields itself. Developer
 * tools are in the menu only while running from source.
 */
export function appMenuTemplate(platform: DesktopPlatform, appName: string, packaged: boolean): MenuItemConstructorOptions[] | null {
  if (platform !== "darwin") return null;
  return [
    {
      label: appName,
      submenu: [{ role: "about" }, { type: "separator" }, { role: "hide" }, { role: "hideOthers" }, { role: "unhide" }, { type: "separator" }, { role: "quit" }],
    },
    {
      label: "Edit",
      submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }],
    },
    { label: "Window", role: "window", submenu: [{ role: "minimize" }, { role: "close" }] },
    ...(packaged ? [] : [{ label: "Developer", submenu: [{ role: "reload" as const }, { role: "toggleDevTools" as const }] }]),
  ];
}
