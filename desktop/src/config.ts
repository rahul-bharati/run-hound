import { homedir } from "node:os";
import { posix, win32 } from "node:path";
import type { DesktopPlatform } from "./contract.js";

/**
 * Pick the right `path.join` for the target platform. The host machine
 * that runs this function may be Linux while the test (or a build) is
 * asking about Windows; using the host's join produces wrong separators.
 */
function join(platform: DesktopPlatform, ...parts: string[]): string {
  return (platform === "win32" ? win32.join : posix.join)(...parts);
}

/**
 * Resolve a platform-appropriate configuration directory for the desktop
 * app. The XDG default in `app/src/config/ai.ts` is fine on Linux; on
 * macOS the native location is `Library/Application Support`; on Windows
 * it is `%APPDATA%`. The desktop package must call this so the engine
 * reads and writes its config in the right place without the user
 * setting `RUNHOUND_CONFIG_DIR`.
 */
export function resolveConfigDir(platform: DesktopPlatform, env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  if (env.RUNHOUND_CONFIG_DIR) return env.RUNHOUND_CONFIG_DIR;
  if (platform === "darwin") return join(platform, home, "Library", "Application Support", "run-hound");
  if (platform === "win32") {
    const appData = env.APPDATA;
    if (appData) return join(platform, appData, "run-hound");
    return join(platform, home, "AppData", "Roaming", "run-hound");
  }
  if (env.XDG_CONFIG_HOME) return join(platform, env.XDG_CONFIG_HOME, "run-hound");
  return join(platform, home, ".config", "run-hound");
}

/**
 * Resolve the runs directory. A desktop app launched from a GUI has no
 * meaningful working directory, so the default `"runs"` of the engine
 * would scatter reports. The desktop package must pass an explicit
 * absolute path.
 *
 * `RUNHOUND_RUNS_DIR` is read by the desktop app only: the engine and the
 * CLI do not read it, and keep their working-directory-relative `runs`.
 */
export function resolveRunsDir(platform: DesktopPlatform, options: { runsDir?: string } = {}, env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  if (options.runsDir) return options.runsDir;
  if (env.RUNHOUND_RUNS_DIR) return env.RUNHOUND_RUNS_DIR;
  if (platform === "darwin") return join(platform, home, "Library", "Application Support", "run-hound", "runs");
  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA ?? join(platform, home, "AppData", "Local");
    return join(platform, localAppData, "run-hound", "runs");
  }
  if (env.XDG_DATA_HOME) return join(platform, env.XDG_DATA_HOME, "run-hound", "runs");
  return join(platform, home, ".local", "share", "run-hound", "runs");
}
