import { describe, expect, it } from "vitest";
import { BRAND } from "../../app/src/core/brand.js";
import { STYLES } from "../../app/src/server/ui/styles.js";
import { appMenuTemplate, TITLE_BAR_HEIGHT, windowOptions } from "../src/shell.js";

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
    for (const prelude of preludes) expect(prelude).toMatch(/^html\[data-shell="desktop"\](\s|$)/);
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
