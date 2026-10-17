import { homedir } from "node:os";
import { join as hostJoin, posix, win32 } from "node:path";
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
 * app. The desktop app has a settings folder of its own on every OS, so
 * the command line and the app never share one (docs/decisions
 * 2026-10-07-desktop-settings-import):
 *
 * - `RUNHOUND_CONFIG_DIR` wins, as it does for the command line.
 * - macOS: `~/Library/Application Support/run-hound`.
 * - Windows: `%APPDATA%\run-hound`.
 * - Linux: `$XDG_CONFIG_HOME/run-hound-desktop`, else
 *   `~/.config/run-hound-desktop`. The command line keeps
 *   `~/.config/run-hound`, which the desktop app imports from once.
 *
 * The desktop package must call this so the engine reads and writes its
 * config in the right place without the user setting `RUNHOUND_CONFIG_DIR`.
 */
export function resolveConfigDir(platform: DesktopPlatform, env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  if (env.RUNHOUND_CONFIG_DIR) return env.RUNHOUND_CONFIG_DIR;
  if (platform === "darwin") return join(platform, home, "Library", "Application Support", "run-hound");
  if (platform === "win32") {
    const appData = env.APPDATA;
    if (appData) return join(platform, appData, "run-hound");
    return join(platform, home, "AppData", "Roaming", "run-hound");
  }
  if (env.XDG_CONFIG_HOME) return join(platform, env.XDG_CONFIG_HOME, "run-hound-desktop");
  return join(platform, home, ".config", "run-hound-desktop");
}

/**
 * The folder the command line saves its settings in, which the desktop app
 * imports from once. It mirrors `configDir()` in `app/src/config/ai.ts`
 * (main.ts must not import the engine before the environment is set):
 * `$RUNHOUND_CONFIG_DIR`, else `$XDG_CONFIG_HOME/run-hound`, else
 * `~/.config/run-hound`, on every OS and joined in the host's own style.
 *
 * Evaluate it with the environment as it is BEFORE the desktop main sets
 * `RUNHOUND_CONFIG_DIR` to its own folder; afterwards it would name the
 * desktop folder. An empty value counts as unset, as it does for the
 * command line.
 */
export function resolveCliConfigDir(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  if (env.RUNHOUND_CONFIG_DIR) return env.RUNHOUND_CONFIG_DIR;
  if (env.XDG_CONFIG_HOME) return hostJoin(env.XDG_CONFIG_HOME, "run-hound");
  return hostJoin(home, ".config", "run-hound");
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
