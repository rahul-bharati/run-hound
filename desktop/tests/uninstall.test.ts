/**
 * O1: keys are removed with the app on Windows, and not on an update (docs/onboarding-spec.md "Uninstall on Windows",
 * docs/decisions 2026-10-17-keys-removed-with-the-app), and the desktop engine has the routes onboarding and "Delete all
 * keys and data" use. Pinned here:
 * - the NSIS include script deletes exactly the settings folder (desktop/src/config.ts) and Electron's profile folder, only
 *   when the uninstall is not part of an update, and not the reports; electron-builder's own deleteAppDataOnUninstall is
 *   not used, because it names other folders; and the facts about the installed electron-builder that this relies on
 *   still hold (a newer one must be read again);
 * - the desktop and command line settings folders differ on every OS, which "Delete all keys and data" relies on;
 * - the first-run legs' checks: what they expect after an install over the top and after the uninstall.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, win32 } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { commandLineConfigDir } from "../../app/src/server/desktop-app.js";
import { resolveCliConfigDir, resolveConfigDir } from "../src/config.js";
import { createApp } from "../src/engine.js";
import { APP_NAME, SETTINGS_FILES, expectedDataDirs, parseArgs, settingsDigest, uninstallDataExpectations } from "../scripts/first-run-lib.mjs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { productName: string; build: Record<string, any> };
const require = createRequire(import.meta.url);
const builderTemplates = join(dirname(require.resolve("app-builder-lib/package.json")), "templates", "nsis");
const include = readFileSync(new URL("../assets/installer.nsh", import.meta.url), "utf8");
/** The script without its comment lines. */
const code = include
  .split(/\r?\n/)
  .filter((line) => !line.trim().startsWith(";"))
  .join("\n");

describe("the Windows uninstaller deletes the settings and the profile, not on an update", () => {
  it("is included from the electron-builder configuration, and the file is there", () => {
    expect(pkg.build.nsis.include).toBe("assets/installer.nsh");
    expect(readFileSync(new URL(`../${pkg.build.nsis.include}`, import.meta.url), "utf8")).toBe(include);
  });

  it("does not use deleteAppDataOnUninstall, which deletes 'Run Hound' and 'run-hound-desktop' and never the settings folder", () => {
    expect(pkg.build.nsis.deleteAppDataOnUninstall).toBeUndefined();
    expect(pkg.build.extraMetadata.name).toBe("run-hound-desktop");
    expect(pkg.productName).toBe("Run Hound");
  });

  it("defines customUnInstall, which does nothing when the uninstall is part of an update", () => {
    expect(code).toMatch(/!macro customUnInstall[\s\S]*!macroend/);
    const body = /!macro customUnInstall([\s\S]*)!macroend/.exec(code)![1]!;
    // Everything that deletes sits inside the ${ifNot} ${isUpdated} block.
    const guard = body.indexOf("${ifNot} ${isUpdated}");
    expect(guard).toBeGreaterThanOrEqual(0);
    expect(body.slice(0, guard)).not.toMatch(/RMDir|Delete/);
    expect(body.slice(guard)).toMatch(/\$\{endif\}\s*$/);
  });

  it("deletes exactly the desktop settings folder and Electron's profile folder, both under the roaming app data", () => {
    const deleted = [...code.matchAll(/RMDir\s+\/r\s+"([^"]+)"/g)].map((m) => m[1]);
    const settings = win32.basename(resolveConfigDir("win32", {}, "C:\\Users\\me"));
    expect(settings).toBe("run-hound");
    expect(win32.dirname(resolveConfigDir("win32", { APPDATA: "C:\\Users\\me\\AppData\\Roaming" }, "C:\\Users\\me"))).toBe("C:\\Users\\me\\AppData\\Roaming");
    expect(deleted).toEqual([`$APPDATA\\${settings}`, "$APPDATA\\${PRODUCT_FILENAME}"]);
    // Electron names its profile after the product; electron-builder's PRODUCT_FILENAME is that name.
    expect(pkg.productName).toBe(APP_NAME);
    expect(code).not.toMatch(/LOCALAPPDATA|runs/);
    // An all-users install still deletes the current user's folders.
    expect(code).toMatch(/\$installMode == "all"[\s\S]*SetShellVarContext current[\s\S]*RMDir[\s\S]*SetShellVarContext all/);
  });

  it("rests on electron-builder behaviour that the installed version still has", () => {
    // The old uninstaller of an install over the top is run with --updated, which ${isUpdated} reads.
    const installUtil = readFileSync(join(builderTemplates, "include", "installUtil.nsh"), "utf8");
    expect(installUtil).toMatch(/always pass --updated flag/);
    expect(installUtil).toContain('StrCpy $0 "$0 --updated"');
    // customUnInstall runs in the uninstall section, where the template itself tests ${isUpdated}.
    const uninstaller = readFileSync(join(builderTemplates, "uninstaller.nsh"), "utf8");
    expect(uninstaller).toContain("!insertmacro customUnInstall");
    expect(uninstaller).toContain("${if} ${isUpdated}");
    // What deleteAppDataOnUninstall would have deleted: not the settings folder.
    expect(uninstaller).toContain('RMDir /r "$APPDATA\\${APP_FILENAME}"');
    expect(uninstaller).toContain('RMDir /r "$APPDATA\\${APP_PACKAGE_NAME}"');
  });
});

describe("the desktop and command line settings folders differ on every OS", () => {
  const homes = { darwin: "/Users/me", win32: "C:\\Users\\me", linux: "/home/me" } as const;
  const envs = [{}, { XDG_CONFIG_HOME: "/xdg" }, { APPDATA: "C:\\Users\\me\\AppData\\Roaming", XDG_CONFIG_HOME: "/xdg" }];

  for (const platform of ["darwin", "win32", "linux"] as const) {
    it(`on ${platform}, with or without XDG_CONFIG_HOME`, () => {
      for (const env of envs) {
        const desktop = resolveConfigDir(platform, env, homes[platform]);
        const cli = resolveCliConfigDir(env, homes[platform]);
        const normal = (path: string) => path.replace(/\\/g, "/").toLowerCase();
        expect(normal(desktop), JSON.stringify(env)).not.toBe(normal(cli));
      }
    });
  }

  it("is the same folder only when RUNHOUND_CONFIG_DIR says so, for both", () => {
    const env = { RUNHOUND_CONFIG_DIR: "/one/folder" };
    expect(resolveConfigDir("linux", env, "/home/me")).toBe(resolveCliConfigDir(env, "/home/me"));
  });

  it("is what the engine takes for the command line's folder, without the variable the desktop sets", () => {
    for (const env of envs) {
      const home = "/home/me";
      expect(commandLineConfigDir({ ...env, RUNHOUND_CONFIG_DIR: "/desktop/own" }, home)).toBe(resolveCliConfigDir(env, home));
    }
  });
});

describe("the desktop's engine", () => {
  let dir = "";
  afterEach(() => {
    delete process.env.RUNHOUND_CONFIG_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it("answers GET /api/onboarding (the plain app doesn't), behind the header guard", async () => {
    dir = mkdtempSync(join(tmpdir(), "run-hound-desktop-engine-"));
    process.env.RUNHOUND_CONFIG_DIR = join(dir, "settings");
    const app = createApp({ runsDir: join(dir, "runs"), boundHost: "127.0.0.1" });
    const ask = (headers: Record<string, string>) => app.request("/api/onboarding", { headers });
    expect((await ask({})).status).toBe(403);
    const ok = await ask({ "x-run-hound": "1" });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ show: true });
  });
});

describe("the first-run legs check what the install and uninstall do to your data", () => {
  const dirs = { settings: "C:\\Users\\runner\\AppData\\Roaming\\run-hound", runs: "C:\\Users\\runner\\AppData\\Local\\run-hound\\runs" };

  it("expects Windows to delete the settings and the profile and keep the reports, and the other platforms to keep everything", () => {
    const userData = "C:\\Users\\runner\\AppData\\Roaming\\Run Hound";
    expect(uninstallDataExpectations("win32", dirs, userData)).toEqual({ gone: [dirs.settings, userData], kept: [dirs.runs] });
    expect(uninstallDataExpectations("win32", dirs, null)).toEqual({ gone: [dirs.settings], kept: [dirs.runs] });
    expect(uninstallDataExpectations("darwin", { settings: "/Users/r/Library/Application Support/run-hound", runs: "/Users/r/Library/Application Support/run-hound/runs" }, "/x")).toEqual({
      gone: [],
      kept: ["/Users/r/Library/Application Support/run-hound", "/Users/r/Library/Application Support/run-hound/runs"],
    });
    expect(uninstallDataExpectations("linux", { settings: "/home/r/.config/run-hound-desktop", runs: "/home/r/.local/share/run-hound/runs" }, "/x").gone).toEqual([]);
  });

  it("expects the Windows folders where the installer script deletes them", () => {
    const real = expectedDataDirs("win32", "C:\\Users\\runner", { APPDATA: "C:\\Users\\runner\\AppData\\Roaming", LOCALAPPDATA: "C:\\Users\\runner\\AppData\\Local" });
    expect(win32.basename(real.settings)).toBe("run-hound");
    expect(real.runs.startsWith("C:\\Users\\runner\\AppData\\Local\\")).toBe(true);
  });

  it("takes --after-reinstall like --after-uninstall: it needs the first run's home, and is not both", () => {
    expect(parseArgs(["--app", "a", "--evidence", "e", "--home", "h", "--after-reinstall"])).toMatchObject({ afterReinstall: true, afterUninstall: false });
    expect(parseArgs(["--app", "a", "--evidence", "e", "--real-home", "--after-reinstall"]).afterReinstall).toBe(true);
    expect(() => parseArgs(["--app", "a", "--evidence", "e", "--after-reinstall"])).toThrow(/--after-reinstall needs/);
    expect(() => parseArgs(["--app", "a", "--evidence", "e", "--home", "h", "--after-reinstall", "--after-uninstall"])).toThrow(/alternatives/);
  });

  it("notices a settings file that an install over the top deleted, changed or added", () => {
    const bytes = (text: string) => new TextEncoder().encode(text);
    const before = settingsDigest([["ai.json", bytes("{}")], ["secrets.json", bytes("s")]]);
    expect(before.files).toEqual(["ai.json", "secrets.json"]);
    expect(settingsDigest([["ai.json", bytes("{}")], ["secrets.json", bytes("s")]]).sha256).toBe(before.sha256);
    expect(settingsDigest([["ai.json", bytes("{}")]]).sha256).not.toBe(before.sha256);
    expect(settingsDigest([["ai.json", bytes("{}")], ["secrets.json", bytes("t")]]).sha256).not.toBe(before.sha256);
    expect(settingsDigest([["ai.json", bytes("{}")], ["secrets.json", bytes("s")], ["onboarding.json", bytes("{}")]]).sha256).not.toBe(before.sha256);
    // A name moved to another file's bytes shows too.
    expect(settingsDigest([["ai.json", bytes("s")], ["secrets.json", bytes("{}")]]).sha256).not.toBe(before.sha256);
    expect(SETTINGS_FILES).toEqual(expect.arrayContaining(["ai.json", "secrets.json", "secrets.key", "onboarding.json"]));
  });
});
