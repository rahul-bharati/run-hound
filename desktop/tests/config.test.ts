import { platform as nodePlatform } from "node:process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveConfigDir, resolveRunsDir } from "../src/config.js";
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

  it("uses XDG_CONFIG_HOME on linux when set", () => {
    delete process.env.RUNHOUND_CONFIG_DIR;
    expect(resolveConfigDir("linux", { XDG_CONFIG_HOME: "/srv/cfg" }, isolatedHome)).toBe("/srv/cfg/run-hound");
  });

  it("falls back to ~/.config/run-hound on linux", () => {
    delete process.env.RUNHOUND_CONFIG_DIR;
    expect(resolveConfigDir("linux", {}, isolatedHome)).toBe(join(isolatedHome, ".config", "run-hound"));
  });
});

describe("resolveRunsDir", () => {
  const isolatedHome = join(tmpdir(), "run-hound-desktop-test-home");
  const configDir = join(isolatedHome, "config");
  beforeAll(() => {
    delete process.env.RUNHOUND_RUNS_DIR;
  });
  afterAll(() => {
    delete process.env.RUNHOUND_RUNS_DIR;
  });

  it("prefers an explicit runsDir option", () => {
    expect(resolveRunsDir("linux", { runsDir: "/explicit/runs", configDir }, {}, isolatedHome)).toBe("/explicit/runs");
  });

  it("uses RUNHOUND_RUNS_DIR when no option is given", () => {
    process.env.RUNHOUND_RUNS_DIR = "/env/runs";
    expect(resolveRunsDir("linux", { configDir }, process.env, isolatedHome)).toBe("/env/runs");
  });

  it("falls back to a platform-appropriate path on darwin, win32 and linux", () => {
    delete process.env.RUNHOUND_RUNS_DIR;
    expect(resolveRunsDir("darwin", { configDir }, {}, isolatedHome)).toBe(join(isolatedHome, "Library", "Application Support", "run-hound", "runs"));
    expect(resolveRunsDir("win32", { configDir }, { LOCALAPPDATA: "C:\\Users\\qa\\AppData\\Local" }, isolatedHome)).toBe("C:\\Users\\qa\\AppData\\Local\\run-hound\\runs");
    expect(resolveRunsDir("linux", { configDir }, {}, isolatedHome)).toBe(join(isolatedHome, ".local", "share", "run-hound", "runs"));
  });

  it("never returns a working-directory-relative path", () => {
    delete process.env.RUNHOUND_RUNS_DIR;
    const resolved = resolveRunsDir(hostPlatform, { configDir }, {}, isolatedHome);
    expect(resolved).not.toBe("runs");
    expect(resolved.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(resolved)).toBe(true);
  });
});
