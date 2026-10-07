import { platform as nodePlatform } from "node:process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveCliConfigDir, resolveConfigDir, resolveRunsDir } from "../src/config.js";
import type { DesktopPlatform } from "../src/contract.js";

const hostPlatform: DesktopPlatform =
  nodePlatform === "darwin" || nodePlatform === "win32" || nodePlatform === "linux"
    ? nodePlatform
    : "linux";

describe("resolveConfigDir", () => {
  const isolatedHome = join(tmpdir(), "run-hound-desktop-test-home");
  beforeAll(() => {
    process.env.RUNHOUND_CONFIG_DIR = "";
  });
  afterAll(() => {
    delete process.env.RUNHOUND_CONFIG_DIR;
  });

  it("honours RUNHOUND_CONFIG_DIR when set", () => {
    process.env.RUNHOUND_CONFIG_DIR = "/custom/cfg";
    expect(resolveConfigDir(hostPlatform, process.env, isolatedHome)).toBe("/custom/cfg");
  });

  it("uses the macOS native location on darwin", () => {
    delete process.env.RUNHOUND_CONFIG_DIR;
    expect(resolveConfigDir("darwin", {}, isolatedHome)).toBe(join(isolatedHome, "Library", "Application Support", "run-hound"));
  });

  it("uses APPDATA on win32", () => {
    delete process.env.RUNHOUND_CONFIG_DIR;
    expect(resolveConfigDir("win32", { APPDATA: "C:\\Users\\qa\\AppData\\Roaming" }, isolatedHome)).toBe("C:\\Users\\qa\\AppData\\Roaming\\run-hound");
  });

  it("uses its own folder under XDG_CONFIG_HOME on linux when set", () => {
    delete process.env.RUNHOUND_CONFIG_DIR;
    expect(resolveConfigDir("linux", { XDG_CONFIG_HOME: "/srv/cfg" }, isolatedHome)).toBe("/srv/cfg/run-hound-desktop");
  });

  it("falls back to ~/.config/run-hound-desktop on linux, never the command line's folder", () => {
    delete process.env.RUNHOUND_CONFIG_DIR;
    const folder = resolveConfigDir("linux", {}, isolatedHome);
    expect(folder).toBe(join(isolatedHome, ".config", "run-hound-desktop"));
    expect(folder).not.toBe(resolveCliConfigDir({}, isolatedHome));
  });

  it("lets RUNHOUND_CONFIG_DIR win on every platform, and treats an empty value as unset", () => {
    for (const platform of ["linux", "darwin", "win32"] as const) {
      expect(resolveConfigDir(platform, { RUNHOUND_CONFIG_DIR: "/custom/cfg", XDG_CONFIG_HOME: "/srv/cfg" }, isolatedHome)).toBe("/custom/cfg");
    }
    expect(resolveConfigDir("linux", { RUNHOUND_CONFIG_DIR: "" }, isolatedHome)).toBe(join(isolatedHome, ".config", "run-hound-desktop"));
  });

  it("keeps the macOS and Windows folders it had before", () => {
    expect(resolveConfigDir("win32", {}, "C:\\Users\\qa")).toBe("C:\\Users\\qa\\AppData\\Roaming\\run-hound");
  });
});

describe("resolveCliConfigDir", () => {
  const isolatedHome = join(tmpdir(), "run-hound-desktop-test-home");

  it("mirrors the command line: RUNHOUND_CONFIG_DIR first", () => {
    expect(resolveCliConfigDir({ RUNHOUND_CONFIG_DIR: "/custom/cfg", XDG_CONFIG_HOME: "/srv/cfg" }, isolatedHome)).toBe("/custom/cfg");
  });

  it("then XDG_CONFIG_HOME/run-hound", () => {
    expect(resolveCliConfigDir({ XDG_CONFIG_HOME: "/srv/cfg" }, isolatedHome)).toBe(join("/srv/cfg", "run-hound"));
  });

  it("then ~/.config/run-hound, on every OS", () => {
    expect(resolveCliConfigDir({}, isolatedHome)).toBe(join(isolatedHome, ".config", "run-hound"));
  });

  it("counts an empty value as unset", () => {
    expect(resolveCliConfigDir({ RUNHOUND_CONFIG_DIR: "", XDG_CONFIG_HOME: "" }, isolatedHome)).toBe(join(isolatedHome, ".config", "run-hound"));
  });

  it("matches the engine's own rule (app/src/config/ai.ts)", async () => {
    const { configDir } = await import("../../app/src/config/ai.js");
    for (const env of [{}, { XDG_CONFIG_HOME: "/srv/cfg" }, { RUNHOUND_CONFIG_DIR: "/custom/cfg" }, { RUNHOUND_CONFIG_DIR: "", XDG_CONFIG_HOME: "/srv/cfg" }]) {
      expect(resolveCliConfigDir(env, isolatedHome)).toBe(configDir(env, isolatedHome));
    }
  });
});

describe("resolveRunsDir", () => {
  const isolatedHome = join(tmpdir(), "run-hound-desktop-test-home");
  beforeAll(() => {
    delete process.env.RUNHOUND_RUNS_DIR;
  });
  afterAll(() => {
    delete process.env.RUNHOUND_RUNS_DIR;
  });

  it("prefers an explicit runsDir option", () => {
    expect(resolveRunsDir("linux", { runsDir: "/explicit/runs" }, {}, isolatedHome)).toBe("/explicit/runs");
  });

  it("uses RUNHOUND_RUNS_DIR when no option is given", () => {
    process.env.RUNHOUND_RUNS_DIR = "/env/runs";
    expect(resolveRunsDir("linux", {}, process.env, isolatedHome)).toBe("/env/runs");
  });

  it("falls back to a platform-appropriate path on darwin, win32 and linux", () => {
    delete process.env.RUNHOUND_RUNS_DIR;
    expect(resolveRunsDir("darwin", {}, {}, isolatedHome)).toBe(join(isolatedHome, "Library", "Application Support", "run-hound", "runs"));
    expect(resolveRunsDir("win32", {}, { LOCALAPPDATA: "C:\\Users\\qa\\AppData\\Local" }, isolatedHome)).toBe("C:\\Users\\qa\\AppData\\Local\\run-hound\\runs");
    expect(resolveRunsDir("linux", {}, {}, isolatedHome)).toBe(join(isolatedHome, ".local", "share", "run-hound", "runs"));
  });

  it("never returns a working-directory-relative path", () => {
    delete process.env.RUNHOUND_RUNS_DIR;
    const resolved = resolveRunsDir(hostPlatform, {}, {}, isolatedHome);
    expect(resolved).not.toBe("runs");
    expect(resolved.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(resolved)).toBe(true);
  });
});
