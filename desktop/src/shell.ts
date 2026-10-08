/**
 * The desktop window's look: its options per platform and the application menu. Pure data, so the shape is unit
 * tested; main.ts applies it. Electron is imported for types only, so tests load this without the runtime.
 *
 * The title bar is the engine UI's own (a 36 px strip drawn by the preload and styled in app/src/server/ui/styles.ts
 * under html[data-shell="desktop"]); the system draws only the window buttons on top of it.
 */

import type { BrowserWindowConstructorOptions, MenuItemConstructorOptions, WebPreferences } from "electron";

import { BRAND } from "../../app/src/core/brand.js";
import type { DesktopPlatform } from "./contract.js";

/** Height of the title bar strip, in CSS pixels. The `.desktop-titlebar` rule in the UI's styles uses the same number. */
export const TITLE_BAR_HEIGHT = 36;

export interface WindowOptionsInput {
  platform: DesktopPlatform;
  webPreferences: WebPreferences;
  /** The window icon, a PNG. Windows and Linux only: macOS takes it from the app bundle. */
  iconPath: string;
}

/**
 * Options for the main window.
 *
 * - `backgroundColor` is the UI's page colour, so the window never flashes white before the page paints.
 * - macOS: a hidden, inset title bar whose traffic lights sit in the strip, over the sidebar's left edge.
 * - Windows and Linux: a hidden title bar plus the window controls overlay (`titleBarOverlay`, which electron.d.ts
 *   lists for both win32 and linux), drawn in the strip's colour with the muted symbol colour.
 */
export function windowOptions({ platform, webPreferences, iconPath }: WindowOptionsInput): BrowserWindowConstructorOptions {
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
    titleBarOverlay: { color: BRAND.bg, symbolColor: BRAND.muted, height: TITLE_BAR_HEIGHT },
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
