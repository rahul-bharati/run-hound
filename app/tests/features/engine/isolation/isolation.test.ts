// Isolated by default (0.6.1, docs/launch-spec.md "0.6.1: isolated by default", items 1 and 2), unit level: browserEnv keeps only what Chromium needs and points HOME, the XDG folders, and TMPDIR/USERPROFILE/APPDATA/LOCALAPPDATA/TEMP/TMP into a per-launch folder; launchChromium creates that folder (run-hound-browser-*) and tears it down on close/disconnect/failure; ISOLATED_CONTEXT is { acceptDownloads: false }; engine/isolation.ts is the only module in app/src that imports a browser type or calls its launch, so no later launch site can skip isolation (tests are exempt).
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser, BrowserType, LaunchOptions } from "playwright";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BROWSER_FOLDER_PREFIX, browserEnv, ISOLATED_CONTEXT, launchChromium } from "../../../../src/engine/isolation.js";

const MARK = "rh-planted-4f1c9e";

/** What a developer's shell may hold besides what Chromium needs: none of it may reach the browser. */
const PLANTED: NodeJS.ProcessEnv = {
  AWS_ACCESS_KEY_ID: `AKIA${MARK}`,
  AWS_SECRET_ACCESS_KEY: `${MARK}-aws-secret`,
  AWS_SESSION_TOKEN: `${MARK}-aws-token`,
  AWS_PROFILE: `${MARK}-profile`,
  AWS_BEARER_TOKEN_BEDROCK: `${MARK}-bedrock`,
  RUNHOUND_AI_API_KEY: `${MARK}-ai-key`,
  RUNHOUND_ACCOUNT_A_PASSWORD: `${MARK}-password`,
  RUNHOUND_CONFIG_DIR: `/home/me/${MARK}/config`,
  HTTPS_PROXY: `http://${MARK}.invalid:3128`,
  https_proxy: `http://${MARK}.invalid:3128`,
  HTTP_PROXY: `http://${MARK}.invalid:3128`,
  ALL_PROXY: `socks5://${MARK}.invalid:1080`,
  NO_PROXY: `${MARK}.invalid`,
  NODE_OPTIONS: `--require /tmp/${MARK}.cjs`,
  LD_PRELOAD: `/tmp/${MARK}.so`,
  DBUS_SESSION_BUS_ADDRESS: `unix:path=/run/user/1000/${MARK}`,
  SSH_AUTH_SOCK: `/tmp/${MARK}/agent.sock`,
  GITHUB_TOKEN: `ghp_${MARK}`,
  OPENAI_API_KEY: `sk-${MARK}`,
  PLAYWRIGHT_BROWSERS_PATH: `/opt/${MARK}`,
  USER: MARK,
  LOGNAME: MARK,
};

const LINUX_SHELL: NodeJS.ProcessEnv = {
  PATH: "/usr/local/bin:/usr/bin:/bin",
  HOME: "/home/me",
  LANG: "en_GB.UTF-8",
  LANGUAGE: "en_GB:en",
  LC_ALL: "en_GB.UTF-8",
  LC_TIME: "en_GB.UTF-8",
  TZ: "Europe/London",
  FONTCONFIG_FILE: "/etc/fonts/fonts.conf",
  FONTCONFIG_PATH: "/etc/fonts",
  LD_LIBRARY_PATH: "/opt/lib",
  DISPLAY: ":0",
  WAYLAND_DISPLAY: "wayland-0",
  XAUTHORITY: "/run/user/1000/xauth_Abc123",
  XDG_RUNTIME_DIR: "/run/user/1000",
  XDG_CONFIG_HOME: "/home/me/.config",
  XDG_CACHE_HOME: "/home/me/.cache",
  XDG_DATA_HOME: "/home/me/.local/share",
  XDG_STATE_HOME: "/home/me/.local/state",
  TMPDIR: "/tmp",
  ...PLANTED,
};
const DIR = "/tmp/run-hound-browser-Abc123";

/** What every Linux launch gets, headless or headed. */
const LINUX_BASE = {
  PATH: "/usr/local/bin:/usr/bin:/bin",
  LANG: "en_GB.UTF-8",
  LANGUAGE: "en_GB:en",
  LC_ALL: "en_GB.UTF-8",
  LC_TIME: "en_GB.UTF-8",
  TZ: "Europe/London",
  FONTCONFIG_FILE: "/etc/fonts/fonts.conf",
  FONTCONFIG_PATH: "/etc/fonts",
  LD_LIBRARY_PATH: "/opt/lib",
  HOME: `${DIR}/home`,
  XDG_CONFIG_HOME: `${DIR}/config`,
  XDG_CACHE_HOME: `${DIR}/cache`,
  XDG_DATA_HOME: `${DIR}/data`,
  XDG_STATE_HOME: `${DIR}/state`,
  TMPDIR: `${DIR}/tmp`,
};

describe("browserEnv on Linux", () => {
  it("keeps only what Chromium needs, and points HOME, the XDG folders and TMPDIR into the per-launch folder", () => {
    expect(browserEnv(LINUX_SHELL, "linux", DIR)).toEqual(LINUX_BASE);
  });

  it("is the same for any other POSIX platform (the Linux rules)", () => {
    expect(browserEnv(LINUX_SHELL, "freebsd", DIR)).toEqual(LINUX_BASE);
  });

  it("adds the display variables only for a headed launch, XDG_RUNTIME_DIR only with WAYLAND_DISPLAY", () => {
    expect(browserEnv(LINUX_SHELL, "linux", DIR, { headed: false })).toEqual(LINUX_BASE);
    expect(browserEnv(LINUX_SHELL, "linux", DIR, { headed: true })).toEqual({
      ...LINUX_BASE,
      DISPLAY: ":0",
      WAYLAND_DISPLAY: "wayland-0",
      XAUTHORITY: "/run/user/1000/xauth_Abc123",
      XDG_RUNTIME_DIR: "/run/user/1000",
    });
    const x11 = { ...LINUX_SHELL, WAYLAND_DISPLAY: undefined };
    const headedX11 = browserEnv(x11, "linux", DIR, { headed: true });
    expect(headedX11.DISPLAY).toBe(":0");
    expect(headedX11).not.toHaveProperty("WAYLAND_DISPLAY");
    expect(headedX11).not.toHaveProperty("XDG_RUNTIME_DIR");
  });

  it("points an unset XAUTHORITY at the real home's .Xauthority, because HOME is moved (headed X11 only)", () => {
    const shell = { ...LINUX_SHELL, XAUTHORITY: undefined };
    expect(browserEnv(shell, "linux", DIR, { headed: true }).XAUTHORITY).toBe("/home/me/.Xauthority");
    expect(browserEnv({ ...shell, HOME: undefined }, "linux", DIR, { headed: true })).not.toHaveProperty("XAUTHORITY");
    expect(browserEnv({ ...shell, DISPLAY: undefined }, "linux", DIR, { headed: true })).not.toHaveProperty("XAUTHORITY");
    expect(browserEnv(shell, "linux", DIR)).not.toHaveProperty("XAUTHORITY");
  });

  it("leaves out allowlisted variables that are unset or empty", () => {
    const env = browserEnv({ PATH: "/usr/bin", LANG: "", TZ: undefined }, "linux", DIR);
    expect(env).toEqual({
      PATH: "/usr/bin",
      HOME: `${DIR}/home`,
      XDG_CONFIG_HOME: `${DIR}/config`,
      XDG_CACHE_HOME: `${DIR}/cache`,
      XDG_DATA_HOME: `${DIR}/data`,
      XDG_STATE_HOME: `${DIR}/state`,
      TMPDIR: `${DIR}/tmp`,
    });
  });

  it("never passes a planted value, whatever its name", () => {
    for (const headed of [false, true]) {
      expect(JSON.stringify(browserEnv(LINUX_SHELL, "linux", DIR, { headed }))).not.toContain(MARK);
    }
  });
});

describe("browserEnv on macOS", () => {
  const MAC_SHELL: NodeJS.ProcessEnv = {
    PATH: "/opt/homebrew/bin:/usr/bin:/bin",
    HOME: "/Users/me",
    LANG: "en_GB.UTF-8",
    LC_ALL: "en_GB.UTF-8",
    TZ: "Europe/London",
    TMPDIR: "/var/folders/xy/abc123/T/",
    DISPLAY: "/private/tmp/com.apple.launchd.x/org.xquartz:0",
    __CF_USER_TEXT_ENCODING: "0x1F5:0x0:0x2",
    ...PLANTED,
  };

  it("keeps TMPDIR as it is (a Unix socket path must stay under 104 bytes) and points HOME and the XDG folders into the per-launch folder", () => {
    const expected = {
      PATH: "/opt/homebrew/bin:/usr/bin:/bin",
      LANG: "en_GB.UTF-8",
      LC_ALL: "en_GB.UTF-8",
      TZ: "Europe/London",
      TMPDIR: "/var/folders/xy/abc123/T/",
      HOME: `${DIR}/home`,
      XDG_CONFIG_HOME: `${DIR}/config`,
      XDG_CACHE_HOME: `${DIR}/cache`,
      XDG_DATA_HOME: `${DIR}/data`,
      XDG_STATE_HOME: `${DIR}/state`,
      CFFIXED_USER_HOME: `${DIR}/home`,
    };
    expect(browserEnv(MAC_SHELL, "darwin", DIR)).toEqual(expected);
    // No display variables on macOS, headed or not.
    expect(browserEnv(MAC_SHELL, "darwin", DIR, { headed: true })).toEqual(expected);
  });

  it("points CFFIXED_USER_HOME at the same per-launch home as HOME: macOS's per-user folders (Library/Application Support, Caches, Saved Application State) are likely resolved through it, not HOME (not yet verified, no macOS CI)", () => {
    const env = browserEnv(MAC_SHELL, "darwin", DIR);
    expect(env.CFFIXED_USER_HOME).toBe(env.HOME);
  });
});

describe("browserEnv on Windows", () => {
  const WIN_DIR = "C:\\Users\\me\\AppData\\Local\\Temp\\run-hound-browser-Abc123";
  const WIN_KEPT = {
    Path: "C:\\Windows\\system32;C:\\Windows",
    PATHEXT: ".COM;.EXE;.BAT;.CMD",
    SystemRoot: "C:\\Windows",
    SystemDrive: "C:",
    windir: "C:\\Windows",
    ComSpec: "C:\\Windows\\system32\\cmd.exe",
    NUMBER_OF_PROCESSORS: "8",
    PROCESSOR_ARCHITECTURE: "AMD64",
    OS: "Windows_NT",
    ProgramData: "C:\\ProgramData",
    ProgramFiles: "C:\\Program Files",
    "ProgramFiles(x86)": "C:\\Program Files (x86)",
    ProgramW6432: "C:\\Program Files",
    CommonProgramFiles: "C:\\Program Files\\Common Files",
    "CommonProgramFiles(x86)": "C:\\Program Files (x86)\\Common Files",
    CommonProgramW6432: "C:\\Program Files\\Common Files",
    TZ: "GMT Standard Time",
  };
  const WIN_SHELL: NodeJS.ProcessEnv = {
    ...WIN_KEPT,
    USERPROFILE: "C:\\Users\\me",
    APPDATA: "C:\\Users\\me\\AppData\\Roaming",
    LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local",
    TEMP: "C:\\Users\\me\\AppData\\Local\\Temp",
    TMP: "C:\\Users\\me\\AppData\\Local\\Temp",
    HOMEDRIVE: "C:",
    HOMEPATH: "\\Users\\me",
    USERNAME: "me",
    ...PLANTED,
  };

  it("keeps what Chromium needs on Windows and points USERPROFILE, APPDATA, LOCALAPPDATA, TEMP and TMP into the per-launch folder", () => {
    expect(browserEnv(WIN_SHELL, "win32", WIN_DIR)).toEqual({
      ...WIN_KEPT,
      USERPROFILE: `${WIN_DIR}\\home`,
      APPDATA: `${WIN_DIR}\\config`,
      LOCALAPPDATA: `${WIN_DIR}\\cache`,
      TEMP: `${WIN_DIR}\\tmp`,
      TMP: `${WIN_DIR}\\tmp`,
    });
  });

  it("matches names case-insensitively and keeps each kept name as it was written", () => {
    const env = browserEnv({ SYSTEMROOT: "C:\\Windows", path: "C:\\bin", Temp: "C:\\T", aws_secret_access_key: MARK }, "win32", WIN_DIR);
    expect(env.SYSTEMROOT).toBe("C:\\Windows");
    expect(env.path).toBe("C:\\bin");
    expect(env).not.toHaveProperty("Temp");
    expect(env.TEMP).toBe(`${WIN_DIR}\\tmp`);
    expect(JSON.stringify(env)).not.toContain(MARK);
  });
});

describe("ISOLATED_CONTEXT", () => {
  it("is { acceptDownloads: false }: a browser context never saves a download", () => {
    expect(ISOLATED_CONTEXT).toEqual({ acceptDownloads: false });
  });
});

/** A launcher that records its options and returns a fake browser that emits "disconnected" when closed. */
function fakeLauncher(fail?: Error) {
  const calls: LaunchOptions[] = [];
  const contexts: (Record<string, unknown> | undefined)[] = [];
  const pages: (Record<string, unknown> | undefined)[] = [];
  const browser = Object.assign(new EventEmitter(), {
    closed: false,
    async close() {
      browser.closed = true;
      browser.emit("disconnected", browser);
    },
    isConnected: () => !browser.closed,
    version: () => "0.0.0.0",
    // Records what launchChromium's own wrapping actually passes through, once it wraps these (finding: every
    // newContext()/newPage() of an isolated launch's browser must refuse downloads, whatever the caller passes).
    async newContext(opts?: Record<string, unknown>) {
      contexts.push(opts);
      return {} as unknown;
    },
    async newPage(opts?: Record<string, unknown>) {
      pages.push(opts);
      return {} as unknown;
    },
  });
  const launcher: Pick<BrowserType, "launch"> = {
    launch: vi.fn(async (options?: LaunchOptions) => {
      calls.push(options ?? {});
      if (fail) throw fail;
      return browser as unknown as Browser;
    }),
  };
  return { launcher, calls, browser, contexts, pages };
}

describe("launchChromium", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "rh-isolation-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const SHELL: NodeJS.ProcessEnv = { PATH: "/usr/bin", HOME: "/home/me", LANG: "C.UTF-8", DISPLAY: ":0", ...PLANTED };

  /** The per-launch folder a launch used, from the HOME it was given. */
  const folderOf = (options: LaunchOptions) => dirname(options.env!.HOME!);

  it("creates run-hound-browser-* under the temp root with its subfolders and launches with browserEnv and an artifactsDir inside it", async () => {
    const { launcher, calls } = fakeLauncher();
    const browser = await launchChromium({ headless: true, args: ["--host-resolver-rules=MAP x 127.0.0.1"] }, { launcher, env: SHELL, platform: "linux", tmpRoot: root });
    expect(calls).toHaveLength(1);
    const options = calls[0]!;
    expect(options.env, "an explicit env, or Playwright passes process.env to Chromium").toBeDefined();
    const folder = folderOf(options);
    expect(dirname(folder)).toBe(root);
    expect(basename(folder).startsWith(BROWSER_FOLDER_PREFIX)).toBe(true);
    expect(BROWSER_FOLDER_PREFIX).toBe("run-hound-browser-");
    expect(options.env).toEqual(browserEnv(SHELL, "linux", folder, { headed: false }));
    expect(options.artifactsDir).toBe(join(folder, "artifacts"));
    expect(options.args).toEqual(["--host-resolver-rules=MAP x 127.0.0.1"]);
    expect(options.headless).toBe(true);
    for (const sub of ["home", "config", "cache", "data", "state", "tmp", "artifacts"]) {
      expect((await stat(join(folder, sub))).isDirectory(), sub).toBe(true);
    }
    await browser.close();
  });

  it("gives a headed launch (headless: false) the display variables", async () => {
    const { launcher, calls } = fakeLauncher();
    const browser = await launchChromium({ headless: false }, { launcher, env: SHELL, platform: "linux", tmpRoot: root });
    expect(calls[0]!.env).toEqual(browserEnv(SHELL, "linux", folderOf(calls[0]!), { headed: true }));
    expect(calls[0]!.env!.DISPLAY).toBe(":0");
    await browser.close();
  });

  it("removes the folder before close() resolves", async () => {
    const { launcher, calls } = fakeLauncher();
    const browser = await launchChromium({}, { launcher, env: SHELL, platform: "linux", tmpRoot: root });
    const folder = folderOf(calls[0]!);
    expect(existsSync(folder)).toBe(true);
    await browser.close();
    expect(existsSync(folder)).toBe(false);
    expect(await readdir(root)).toEqual([]);
  });

  it("removes the folder when the browser disconnects on its own (a crash)", async () => {
    const { launcher, calls, browser } = fakeLauncher();
    await launchChromium({}, { launcher, env: SHELL, platform: "linux", tmpRoot: root });
    const folder = folderOf(calls[0]!);
    browser.emit("disconnected", browser);
    await expect.poll(() => existsSync(folder)).toBe(false);
  });

  it("removes the folder when the launch fails, and rethrows the launch's error", async () => {
    const { launcher, calls } = fakeLauncher(new Error("Executable doesn't exist"));
    await expect(launchChromium({}, { launcher, env: SHELL, platform: "linux", tmpRoot: root })).rejects.toThrow("Executable doesn't exist");
    expect(calls).toHaveLength(1);
    expect(await readdir(root)).toEqual([]);
  });

  it("keeps the exit-time fallback removal registered when the async removal fails, instead of dropping Run Hound's last chance to clean up", async () => {
    const { launcher, calls, browser } = fakeLauncher();
    const before = new Set(process.listeners("exit"));
    // A failure like Windows EBUSY/EPERM: a Chromium child process still holds a handle into the folder.
    const remove = vi.fn(async () => {
      throw new Error("EBUSY: resource busy or locked");
    });
    try {
      await launchChromium({}, { launcher, env: SHELL, platform: "linux", tmpRoot: root, remove });
      const folder = folderOf(calls[0]!);
      // close() also fires "disconnected" (fakeLauncher), so this exercises cleanup() called twice (close()'s
      // finally, then the disconnected handler): cleanupPromise is memoized, so the second call must not throw even
      // though remove() keeps rejecting.
      await browser.close();
      expect(remove).toHaveBeenCalledWith(folder);
      expect(remove).toHaveBeenCalledTimes(1);
      const added = process.listeners("exit").filter((l) => !before.has(l));
      expect(added, "the exit listener is still registered: a failed async removal keeps the sync fallback").toHaveLength(1);
    } finally {
      // Don't leak a listener (and a stale rmSync of an already-removed folder) into the rest of the suite.
      for (const l of process.listeners("exit")) if (!before.has(l)) process.removeListener("exit", l as () => void);
    }
  });

  it("drops the exit-time fallback once the async removal succeeds", async () => {
    const { launcher, browser } = fakeLauncher();
    const before = new Set(process.listeners("exit"));
    await launchChromium({}, { launcher, env: SHELL, platform: "linux", tmpRoot: root });
    await browser.close();
    expect(process.listeners("exit").filter((l) => !before.has(l))).toHaveLength(0);
  });

  it("forces acceptDownloads: false on every newContext() and newPage() of the returned browser, whatever the caller passes", async () => {
    const { launcher, browser, contexts, pages } = fakeLauncher();
    const isolated = await launchChromium({}, { launcher, env: SHELL, platform: "linux", tmpRoot: root });
    await isolated.newContext({ acceptDownloads: true, viewport: { width: 1, height: 1 } });
    await isolated.newContext();
    await isolated.newPage({ acceptDownloads: true });
    expect(contexts).toEqual([{ acceptDownloads: false, viewport: { width: 1, height: 1 } }, { acceptDownloads: false }]);
    expect(pages).toEqual([{ acceptDownloads: false }]);
    await browser.close();
  });
});

describe("the only launch site", () => {
  /** app/src, from app/tests/features/engine/isolation/. */
  const SRC = fileURLToPath(new URL("../../../../src", import.meta.url));

  async function sourceFiles(): Promise<{ file: string; text: string }[]> {
    const files = (await readdir(SRC, { recursive: true })).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    return Promise.all(files.map(async (f) => ({ file: f.split(sep).join("/"), text: await readFile(join(SRC, f), "utf8") })));
  }

  it("is engine/isolation.ts: no other module in app/src imports chromium, firefox or webkit from playwright", async () => {
    const importers = (await sourceFiles())
      .filter(({ text }) => /import\s*\{[^}]*\b(?<!type\s)(?:chromium|firefox|webkit)\b[^}]*\}\s*from\s*["']playwright(?:-core)?["']/.test(text))
      .map(({ file }) => file);
    expect(importers).toEqual(["engine/isolation.ts"]);
  });

  it("is engine/isolation.ts: no other module calls launch, launchPersistentContext or launchServer on a browser type", async () => {
    const callers: string[] = [];
    for (const { file, text } of await sourceFiles()) {
      if (file === "engine/isolation.ts") continue;
      for (const line of text.split("\n")) {
        const code = line.trim();
        // Lines of a spec a check exports are string contents (they start with a quote or a backtick): not Run Hound's calls.
        if (/^["'`]/.test(code) || code.startsWith("*") || code.startsWith("//")) continue;
        if (/\b(?:chromium|firefox|webkit)\s*\.\s*(?:launch|launchPersistentContext|launchServer)\s*\(/.test(code)) callers.push(file);
      }
    }
    expect(callers).toEqual([]);
  });
});
