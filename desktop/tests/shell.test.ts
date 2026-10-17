import { describe, expect, it } from "vitest";
import { BRAND } from "../../app/src/core/brand.js";
import { STYLES } from "../../app/src/server/ui/styles.js";
import { appMenuTemplate, childWindowOptions, CHILD_STRIP_COLOR, DIALOG_SIZE, dialogWindowOptions, TITLE_BAR_HEIGHT, windowOptions } from "../src/shell.js";

const webPreferences = { sandbox: true, contextIsolation: true, preload: "/app/dist/preload.cjs" };
const iconPath = "/app/dist/icon.png";

describe("windowOptions", () => {
  it.each(["darwin", "win32", "linux"] as const)("%s: opens hidden, dark from the first frame, with the hardened preferences untouched", (platform) => {
    const options = windowOptions({ platform, webPreferences, iconPath });
    expect(options).toMatchObject({ width: 1280, height: 800, minWidth: 960, minHeight: 600, title: "Run Hound", show: false, backgroundColor: BRAND.bg });
    expect(options.webPreferences).toBe(webPreferences);
  });

  it("macOS: inset traffic lights centred in the strip, no overlay, no window icon", () => {
    const options = windowOptions({ platform: "darwin", webPreferences, iconPath });
    expect(options.titleBarStyle).toBe("hiddenInset");
    expect(options.trafficLightPosition).toEqual({ x: 14, y: 12 });
    expect(options.titleBarOverlay).toBeUndefined();
    expect(options.icon).toBeUndefined();
  });

  it.each(["win32", "linux"] as const)("%s: a hidden title bar with window controls in the strip's colours, and the icon", (platform) => {
    const options = windowOptions({ platform, webPreferences, iconPath });
    expect(options.titleBarStyle).toBe("hidden");
    expect(options.titleBarOverlay).toEqual({ color: BRAND.bg, symbolColor: BRAND.muted, height: TITLE_BAR_HEIGHT });
    expect(options.icon).toBe(iconPath);
    expect(options.trafficLightPosition).toBeUndefined();
  });

  it("uses the same strip height as the UI's stylesheet", () => {
    expect(TITLE_BAR_HEIGHT).toBe(36);
    expect(STYLES).toContain(`.desktop-titlebar { position:fixed; top:0; left:0; right:0; height:${TITLE_BAR_HEIGHT}px;`);
    expect(STYLES).toContain(`calc(1.5rem + ${TITLE_BAR_HEIGHT}px)`);
    expect(STYLES).toContain(`calc(${TITLE_BAR_HEIGHT}px + 1.75rem)`);
  });

  it("scopes every desktop rule under html[data-shell=\"desktop\"], so a browser renders none of them", () => {
    const start = STYLES.indexOf("/* Desktop app only.");
    const block = STYLES.slice(start, STYLES.indexOf("@media (prefers-reduced-motion")).replace(/\/\*[\s\S]*?\*\//g, "");
    const preludes = [...block.matchAll(/([^{}]+)\{/g)].map((match) => match[1]!.trim()).filter((prelude) => !prelude.startsWith("@media"));
    expect(preludes.length).toBeGreaterThan(5);
    // A selector list is scoped selector by selector.
    for (const selector of preludes.flatMap((prelude) => prelude.split(",").map((part) => part.trim()))) expect(selector).toMatch(/^html\[data-shell="desktop"\](\s|$)/);
  });
});

describe("childWindowOptions (report and engine pages)", () => {
  it.each(["darwin", "win32", "linux"] as const)("%s: the main window's look in a roomier window that shows at once, with its own preload", (platform) => {
    const childPreferences = { sandbox: true, contextIsolation: true, preload: "/app/dist/chrome-preload.cjs" };
    const main = windowOptions({ platform, webPreferences, iconPath });
    const child = childWindowOptions({ platform, webPreferences: childPreferences, iconPath });
    expect(child).toMatchObject({ width: 1100, height: 800, minWidth: 640, minHeight: 420, title: "Run Hound", show: true, backgroundColor: BRAND.bg });
    expect(child.webPreferences).toBe(childPreferences);
    expect(child.titleBarStyle).toBe(main.titleBarStyle);
    expect(child.trafficLightPosition).toEqual(main.trafficLightPosition);
    expect(child.icon).toBe(main.icon);
  });

  it.each(["win32", "linux"] as const)("%s: window controls drawn in the report's top bar colour", (platform) => {
    const child = childWindowOptions({ platform, webPreferences, iconPath });
    expect(CHILD_STRIP_COLOR).toBe(BRAND.bgDeep);
    expect(child.titleBarOverlay).toEqual({ color: BRAND.bgDeep, symbolColor: BRAND.muted, height: TITLE_BAR_HEIGHT });
  });
});

describe("dialogWindowOptions (the start-up error window)", () => {
  it.each(["darwin", "win32", "linux"] as const)("%s: 600 by 380 content pixels, fixed, with the same look", (platform) => {
    const dialog = dialogWindowOptions({ platform, webPreferences, iconPath });
    expect(DIALOG_SIZE).toEqual({ width: 600, height: 380 });
    expect(dialog).toMatchObject({ width: 600, height: 380, minWidth: 600, minHeight: 380, useContentSize: true, resizable: false, minimizable: false, maximizable: false, fullscreenable: false, show: true, title: "Run Hound", backgroundColor: BRAND.bg });
    expect(dialog.webPreferences).toBe(webPreferences);
    expect(dialog.titleBarStyle).toBe(platform === "darwin" ? "hiddenInset" : "hidden");
    if (platform !== "darwin") expect(dialog.titleBarOverlay).toMatchObject({ color: BRAND.bgDeep, height: TITLE_BAR_HEIGHT });
    expect(dialog.icon).toBe(platform === "darwin" ? undefined : iconPath);
  });
});

describe("appMenuTemplate", () => {
  const roles = (items: Electron.MenuItemConstructorOptions[] | undefined): (string | undefined)[] =>
    (items ?? []).filter((item) => item.type !== "separator").map((item) => item.role);

  it("has no menu on Windows and Linux", () => {
    expect(appMenuTemplate("win32", "Run Hound", false)).toBeNull();
    expect(appMenuTemplate("linux", "Run Hound", true)).toBeNull();
  });

  it("macOS: app menu, Edit and Window, and no developer tools in a packaged app", () => {
    const menu = appMenuTemplate("darwin", "Run Hound", true) ?? [];
    expect(menu.map((item) => item.label)).toEqual(["Run Hound", "Edit", "Window"]);
    expect(roles(menu[0]?.submenu as Electron.MenuItemConstructorOptions[])).toEqual(["about", "hide", "hideOthers", "unhide", "quit"]);
    expect(roles(menu[1]?.submenu as Electron.MenuItemConstructorOptions[])).toEqual(["undo", "redo", "cut", "copy", "paste", "selectAll"]);
    expect(roles(menu[2]?.submenu as Electron.MenuItemConstructorOptions[])).toEqual(["minimize", "close"]);
    expect(JSON.stringify(menu)).not.toContain("toggleDevTools");
  });

  it("macOS: developer tools appear only when running from source", () => {
    const menu = appMenuTemplate("darwin", "Run Hound", false) ?? [];
    expect(menu.map((item) => item.label)).toEqual(["Run Hound", "Edit", "Window", "Developer"]);
    expect(roles(menu[3]?.submenu as Electron.MenuItemConstructorOptions[])).toEqual(["reload", "toggleDevTools"]);
  });
});
