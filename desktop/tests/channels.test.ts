import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CHANNELS } from "../src/channels.js";

const read = (name: string): string => readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8");

describe("CHANNELS", () => {
  it("names exactly the contract's channels", () => {
    expect(Object.values(CHANNELS).sort()).toEqual(["desktop:engine:ready", "desktop:notices:take", "desktop:runs-dir:open", "desktop:version:check"]);
  });

  it("every renderer-to-main channel is invoked by the preload and answered by the main process, behind the engine-origin check", () => {
    const preload = read("preload.ts");
    const main = read("main.ts");
    for (const key of ["versionCheck", "runsDirOpen", "noticesTake"] as const) {
      expect(preload, key).toContain(`ipcRenderer.invoke(CHANNELS.${key})`);
      expect(main, key).toContain(`ipcMain.handle(CHANNELS.${key}`);
    }
    // The notices are cleared by taking them, so a frame that isn't the engine's must not be able to take them.
    expect(main).toMatch(/CHANNELS\.noticesTake, \(event\) => \(fromEngine\(event\) \? notices\.take\(\) : \[\]\)/);
  });

  it("the child windows' preload exposes nothing: no contextBridge, no ipcRenderer, no channels", () => {
    for (const file of ["chrome-preload.ts", "chrome.ts", "chrome-css.ts"]) {
      const source = read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(source, file).not.toMatch(/contextBridge|ipcRenderer|CHANNELS|exposeInMainWorld/);
    }
  });
});
