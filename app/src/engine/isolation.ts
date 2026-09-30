/**
 * Isolated by default (0.6.1, docs/launch-spec.md "0.6.1: isolated by default"): the only module in app/src that
 * imports a browser type (chromium, firefox, webkit) from playwright, and the only one that calls launch,
 * launchPersistentContext or launchServer on one. Tests are exempt.
 *
 * - browserEnv: the whole environment a Chromium that Run Hound launches gets. A pure allowlist per platform (never
 *   the user's whole environment), with HOME and the XDG folders (and TMPDIR on Linux; USERPROFILE, APPDATA,
 *   LOCALAPPDATA, TEMP and TMP on Windows) pointed into a per-launch folder Run Hound owns.
 * - launchChromium: creates the per-launch folder, launches with browserEnv's environment and an artifactsDir inside
 *   it, and removes the folder when the browser closes, crashes or fails to start. It also wraps the returned
 *   browser's newContext and newPage so every context it opens gets ISOLATED_CONTEXT last (after the caller's own
 *   options), whatever the caller passes: no call site can opt a context back into accepting downloads.
 * - ISOLATED_CONTEXT: `{ acceptDownloads: false }`, applied by every launchChromium browser automatically. Call sites
 *   still spread it explicitly too, as documentation of the rule, and because a test's own browser (not from
 *   launchChromium) gets no automatic wrapping.
 */
import { rmSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join as joinPath, posix, win32 } from "node:path";
import { chromium, type Browser, type BrowserType, type LaunchOptions } from "playwright";

/** Name prefix of the per-launch folder, created with mkdtemp under os.tmpdir(): "run-hound-browser-XXXXXX". */
export const BROWSER_FOLDER_PREFIX = "run-hound-browser-";

/**
 * Context options every browser context Run Hound opens must include (runner discovery, CheckContext.openPage, sign-in,
 * the evidence renderer): `{ acceptDownloads: false }`, which Playwright 1.63 sends to Chromium as "deny" (the public
 * type is boolean; a truthy string such as "deny" would be sent as "accept"). launchChromium also applies it to every
 * newContext()/newPage() of the browser it returns, overriding whatever the caller passes, so this is enforced even
 * where a call site forgets to spread it.
 */
export const ISOLATED_CONTEXT: Readonly<{ acceptDownloads?: boolean }> = { acceptDownloads: false };

/** Variables kept on every platform, when set and not empty (docs/launch-spec.md "1.2 browserEnv"). */
const COMMON_VARS = ["PATH", "LANG", "LANGUAGE", "LC_ALL", "TZ"];
/** Linux-only (and any other POSIX platform) variables kept, besides COMMON_VARS. */
const LINUX_VARS = ["FONTCONFIG_FILE", "FONTCONFIG_PATH", "LD_LIBRARY_PATH"];
/** macOS-only variables kept, besides COMMON_VARS. */
const MAC_VARS = ["TMPDIR"];
/** Windows-only variables kept, besides COMMON_VARS (matched case-insensitively). */
const WINDOWS_VARS = [
  "PATHEXT",
  "SystemRoot",
  "SystemDrive",
  "windir",
  "ComSpec",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
  "OS",
  "ProgramData",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "ProgramW6432",
  "CommonProgramFiles",
  "CommonProgramFiles(x86)",
  "CommonProgramW6432",
];

type Os = "linux" | "darwin" | "win32";

/** Any platform other than darwin and win32 follows the Linux rules. */
function osOf(platform: NodeJS.Platform): Os {
  if (platform === "darwin") return "darwin";
  if (platform === "win32") return "win32";
  return "linux";
}

function isSet(value: string | undefined): value is string {
  return value !== undefined && value !== "";
}

/**
 * A pure function: it reads nothing and writes nothing. Returns the allowlisted variables of `env` that are set and
 * not empty, plus the pointed variables, and nothing else (docs/launch-spec.md "1.2 browserEnv"). Pointed paths are
 * joined with path.win32 for "win32" and path.posix otherwise, so the result doesn't depend on the machine running it.
 */
export function browserEnv(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, dir: string, options: { headed?: boolean } = {}): Record<string, string> {
  const os = osOf(platform);
  const out: Record<string, string> = {};

  if (os === "win32") {
    const allowed = new Set([...COMMON_VARS, ...WINDOWS_VARS].map((n) => n.toLowerCase()));
    for (const [name, value] of Object.entries(env)) {
      if (!isSet(value)) continue;
      if (allowed.has(name.toLowerCase()) || /^LC_/i.test(name)) out[name] = value;
    }
    const join = win32.join;
    out.USERPROFILE = join(dir, "home");
    out.APPDATA = join(dir, "config");
    out.LOCALAPPDATA = join(dir, "cache");
    out.TEMP = join(dir, "tmp");
    out.TMP = join(dir, "tmp");
    return out;
  }

  const allowed = new Set([...COMMON_VARS, ...(os === "darwin" ? MAC_VARS : LINUX_VARS)]);
  for (const [name, value] of Object.entries(env)) {
    if (!isSet(value)) continue;
    if (allowed.has(name) || /^LC_/.test(name)) out[name] = value;
  }

  // Display variables: Linux (and other POSIX) only, and only for a headed launch. macOS never gets them.
  if (os === "linux" && options.headed) {
    if (isSet(env.DISPLAY)) out.DISPLAY = env.DISPLAY;
    if (isSet(env.WAYLAND_DISPLAY)) {
      out.WAYLAND_DISPLAY = env.WAYLAND_DISPLAY;
      // Also leads to the desktop session bus ($XDG_RUNTIME_DIR/bus), which the browser has no use for otherwise.
      if (isSet(env.XDG_RUNTIME_DIR)) out.XDG_RUNTIME_DIR = env.XDG_RUNTIME_DIR;
    }
    if (isSet(env.XAUTHORITY)) out.XAUTHORITY = env.XAUTHORITY;
    // Moving HOME would hide ~/.Xauthority, so it defaults to the real home's, not the per-launch folder's.
    else if (isSet(env.DISPLAY) && isSet(env.HOME)) out.XAUTHORITY = posix.join(env.HOME, ".Xauthority");
  }

  const join = posix.join;
  out.HOME = join(dir, "home");
  out.XDG_CONFIG_HOME = join(dir, "config");
  out.XDG_CACHE_HOME = join(dir, "cache");
  out.XDG_DATA_HOME = join(dir, "data");
  out.XDG_STATE_HOME = join(dir, "state");
  // macOS keeps its own TMPDIR (a longer path under the per-launch folder could push a headed Chromium's Unix socket
  // past macOS's 104-byte limit).
  if (os === "linux") out.TMPDIR = join(dir, "tmp");
  // macOS likely resolves its per-user folders (Library/Application Support, Library/Caches, Library/Saved
  // Application State) through NSSearchPathForDirectoriesInDomains and NSHomeDirectory, not through HOME; those
  // honour CFFIXED_USER_HOME instead, so it is pointed at the same per-launch home. Not yet verified on macOS
  // (docs/launch-spec.md "1.2 browserEnv"): the footprint test only checks the env-driven folders above.
  if (os === "darwin") out.CFFIXED_USER_HOME = out.HOME;

  return out;
}

export interface LaunchDeps {
  /** Defaults to Playwright's chromium. Tests pass a fake. */
  launcher?: Pick<BrowserType, "launch">;
  /** Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  /** Defaults to process.platform. */
  platform?: NodeJS.Platform;
  /** Where the per-launch folder is created. Defaults to os.tmpdir(). */
  tmpRoot?: string;
  /**
   * Removes the per-launch folder. Defaults to `rm(folder, { recursive: true, force: true, maxRetries: 3 })`. Tests
   * inject a failing one to prove the exit-time fallback (onExit, below) survives a failed async removal.
   */
  remove?: (folder: string) => Promise<void>;
}

const LAUNCH_SUBFOLDERS = ["home", "config", "cache", "data", "state", "tmp", "artifacts"];

/**
 * Launches Chromium isolated: mkdtemp(<tmpRoot>/run-hound-browser-), its subfolders home, config, cache, data, state,
 * tmp and artifacts, then launcher.launch({ ...options, env: browserEnv(env, platform, folder, { headed:
 * options.headless === false }), artifactsDir: <folder>/artifacts }). The folder is removed before browser.close()
 * resolves, when the browser disconnects on its own, and when the launch fails, including a failed subfolder mkdir
 * (docs/launch-spec.md "1.3 The per-launch folder"). A last-resort synchronous removal runs on the process's "exit"
 * event for any folder still open; it is registered right after mkdtemp (before the subfolders exist), and it is
 * dropped only once the async removal actually succeeds — a failed async removal (e.g. Windows EBUSY/EPERM while a
 * Chromium child still holds a handle) keeps the exit hook as Run Hound's last chance to clean up, rather than
 * silently leaving the folder (with the tested site's profile artifacts) behind.
 */
export async function launchChromium(options: LaunchOptions = {}, deps: LaunchDeps = {}): Promise<Browser> {
  const launcher = deps.launcher ?? chromium;
  const env = deps.env ?? process.env;
  const platform = deps.platform ?? process.platform;
  const root = deps.tmpRoot ?? tmpdir();
  const remove = deps.remove ?? ((folder: string) => rm(folder, { recursive: true, force: true, maxRetries: 3 }));
  // The folder is created on the real filesystem, so it is always joined in the running OS's own style, whatever
  // `platform` says (browserEnv uses `platform` only to compute what the string would look like for a simulated OS).
  const folder = await mkdtemp(joinPath(root, BROWSER_FOLDER_PREFIX));

  // Registered before the subfolders (or the browser) exist, so a failure right after mkdtemp still gets a fallback.
  const onExit = (): void => {
    try {
      rmSync(folder, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // Best effort: the process is exiting.
    }
  };
  process.once("exit", onExit);

  let cleanupPromise: Promise<void> | undefined;
  const cleanup = (): Promise<void> => {
    cleanupPromise ??= remove(folder).then(
      // Success: the exit hook is no longer needed. Failure: keep it registered (resolve, not reject) rather than
      // removing Run Hound's last chance to clean up the folder on process exit. (process.removeListener returns
      // the process object, not void, so its call is in a block body to discard that return value.)
      () => {
        process.removeListener("exit", onExit);
      },
      () => undefined,
    );
    return cleanupPromise;
  };

  try {
    await Promise.all(LAUNCH_SUBFOLDERS.map((sub) => mkdir(joinPath(folder, sub))));
  } catch (err) {
    await cleanup();
    throw err;
  }

  let browser: Browser;
  try {
    browser = await launcher.launch({
      ...options,
      env: browserEnv(env, platform, folder, { headed: options.headless === false }),
      artifactsDir: joinPath(folder, "artifacts"),
    });
  } catch (err) {
    await cleanup();
    throw err;
  }

  // Belt and braces (0.6.1, docs/launch-spec.md item 2): every context this browser opens refuses downloads, whatever
  // the caller passes for acceptDownloads — ISOLATED_CONTEXT is spread last, after the caller's own options, at every
  // call site that remembers to (documentation of the rule), but a future newContext() without the spread, or any
  // newPage() (which opens its own context), must not silently accept downloads again. Enforced once here, the same
  // way close() is already wrapped, so no call site can opt back in.
  const originalNewContext = browser.newContext.bind(browser);
  browser.newContext = (async (opts?: Parameters<Browser["newContext"]>[0]) => originalNewContext({ ...opts, ...ISOLATED_CONTEXT })) as Browser["newContext"];
  const originalNewPage = browser.newPage.bind(browser);
  browser.newPage = (async (opts?: Parameters<Browser["newPage"]>[0]) => originalNewPage({ ...opts, ...ISOLATED_CONTEXT })) as Browser["newPage"];

  const originalClose = browser.close.bind(browser);
  browser.close = (async (...args: Parameters<Browser["close"]>) => {
    try {
      return await originalClose(...args);
    } finally {
      await cleanup();
    }
  }) as Browser["close"];
  // A crash: the browser disconnects on its own, without close() ever being called.
  browser.on("disconnected", () => {
    void cleanup();
  });

  return browser;
}
