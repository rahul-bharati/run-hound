import { mkdtemp, rm, stat, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEV_BROWSER_INSTALL_COMMAND, describeStartupProblems, folderProblemMessage, runStartupChecks, type StartupCheckInput } from "../src/startup-checks.js";

let scratch: string;
beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "run-hound-startup-"));
});
afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

/** A packaged app whose Chromium is where the checks look; every path is under the scratch folder. */
async function input(overrides: Partial<StartupCheckInput> = {}): Promise<StartupCheckInput> {
  const bundled = join(scratch, "resources", "playwright-browsers");
  return {
    packaged: true,
    bundledBrowsersDir: bundled,
    browserExecutable: join(bundled, "chromium-1243", "chrome-linux64", "chrome"),
    configDir: join(scratch, "config"),
    runsDir: join(scratch, "runs"),
    ...overrides,
  };
}

const present = { fileExists: async () => true };

describe("runStartupChecks: the browser", () => {
  it("passes a packaged app whose bundled Chromium exists, and creates the folders", async () => {
    const checked = await input();
    expect(await runStartupChecks(checked, present)).toEqual([]);
    expect((await stat(checked.configDir)).isDirectory()).toBe(true);
    expect((await stat(checked.runsDir)).isDirectory()).toBe(true);
    // The write test leaves nothing behind.
    expect(await readdir(checked.configDir)).toEqual([]);
    expect(await readdir(checked.runsDir)).toEqual([]);
  });

  it("tells a packaged app with no browser file to reinstall, naming the folder", async () => {
    const checked = await input();
    const problems = await runStartupChecks(checked, { fileExists: async () => false });
    expect(problems).toHaveLength(1);
    expect(problems[0]?.kind).toBe("browser-missing");
    expect(problems[0]?.message).toContain("Reinstall Run Hound");
    expect(problems[0]?.message).toContain(checked.bundledBrowsersDir);
    expect(problems[0]?.message).not.toContain("playwright install");
  });

  it("treats a packaged app that resolves a browser outside its own folder as missing its bundled one", async () => {
    const checked = await input({ browserExecutable: join(scratch, "home", ".cache", "ms-playwright", "chromium-1243", "chrome") });
    const problems = await runStartupChecks(checked, present);
    expect(problems.map((p) => p.kind)).toEqual(["browser-missing"]);
    expect(problems[0]?.message).toContain("Reinstall Run Hound");
  });

  it("does not take a sibling folder with the same prefix for the bundled one", async () => {
    const checked = await input({ browserExecutable: join(scratch, "resources", "playwright-browsers-old", "chrome") });
    expect((await runStartupChecks(checked, present)).map((p) => p.kind)).toEqual(["browser-missing"]);
  });

  it("treats a platform with no browser path as missing", async () => {
    const problems = await runStartupChecks(await input({ browserExecutable: undefined }), present);
    expect(problems.map((p) => p.kind)).toEqual(["browser-missing"]);
  });

  it("tells a development checkout with no per-user browser to install it, with the command", async () => {
    const checked = await input({ packaged: false, browserExecutable: join(scratch, "cache", "chromium-1243", "chrome") });
    const problems = await runStartupChecks(checked, { fileExists: async () => false });
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain(DEV_BROWSER_INSTALL_COMMAND);
    expect(DEV_BROWSER_INSTALL_COMMAND).toBe("pnpm --filter run-hound exec playwright install chromium");
    expect(problems[0]?.message).not.toContain("Reinstall Run Hound");
  });

  it("accepts a development checkout's browser from anywhere (Playwright's own cache)", async () => {
    const checked = await input({ packaged: false, browserExecutable: join(scratch, "cache", "chromium-1243", "chrome") });
    expect(await runStartupChecks(checked, present)).toEqual([]);
  });

  it("checks the file on disk by default", async () => {
    const checked = await input();
    expect((await runStartupChecks(checked)).map((p) => p.kind)).toEqual(["browser-missing"]);
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(checked.bundledBrowsersDir, "chromium-1243", "chrome-linux64"), { recursive: true });
    await writeFile(checked.browserExecutable ?? "", "");
    expect(await runStartupChecks(checked)).toEqual([]);
  });
});

describe("runStartupChecks: the folders", () => {
  it("names the settings folder it cannot use, and says what to do", async () => {
    const checked = await input();
    const problems = await runStartupChecks(checked, {
      ...present,
      ensureWritableDir: async (dir) => {
        if (dir === checked.configDir) throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
      },
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]?.kind).toBe("folder-unwritable");
    expect(problems[0]?.message).toContain(checked.configDir);
    expect(problems[0]?.message).toContain("settings and saved keys");
    expect(problems[0]?.message).toContain("permission");
    expect(problems[0]?.message).toContain("start Run Hound again");
  });

  it("makes the settings folder private and the results folder ordinary", async () => {
    const checked = await input();
    const seen: Array<[string, boolean]> = [];
    await runStartupChecks(checked, { ...present, ensureWritableDir: async (dir, options) => void seen.push([dir, options.private]) });
    expect(seen).toEqual([
      [checked.configDir, true],
      [checked.runsDir, false],
    ]);
  });

  it("reports every problem at once, browser first", async () => {
    const checked = await input();
    const problems = await runStartupChecks(checked, {
      fileExists: async () => false,
      ensureWritableDir: async () => {
        throw Object.assign(new Error("EROFS"), { code: "EROFS" });
      },
    });
    expect(problems.map((p) => p.kind)).toEqual(["browser-missing", "folder-unwritable", "folder-unwritable"]);
    const text = describeStartupProblems(problems);
    expect(text).toContain(checked.configDir);
    expect(text).toContain(checked.runsDir);
    expect(text.split("\n\n")).toHaveLength(3);
  });

  it("finds a file where the folder should be (a real file system error, on every OS)", async () => {
    const blocker = join(scratch, "blocker");
    await writeFile(blocker, "not a folder");
    const checked = await input({ configDir: join(blocker, "config"), runsDir: blocker });
    const problems = await runStartupChecks(checked, present);
    expect(problems.map((p) => p.kind)).toEqual(["folder-unwritable", "folder-unwritable"]);
    for (const problem of problems) expect(problem.message).toContain("a file is in the way");
  });
});

describe("folderProblemMessage", () => {
  const dir = "/data/run-hound";
  const err = (code: string): Error => Object.assign(new Error(code), { code });

  it("says what happened for each common cause", () => {
    expect(folderProblemMessage(dir, "results", err("EACCES"))).toContain("doesn't have permission");
    expect(folderProblemMessage(dir, "results", err("EPERM"))).toContain("doesn't have permission");
    expect(folderProblemMessage(dir, "results", err("EROFS"))).toContain("read-only");
    expect(folderProblemMessage(dir, "results", err("ENOSPC"))).toContain("disk is full");
    expect(folderProblemMessage(dir, "results", err("ENOTDIR"))).toContain("a file is in the way");
  });

  it("falls back to the system's own reason, still naming the folder", () => {
    const message = folderProblemMessage(dir, "settings", new Error("something odd"));
    expect(message).toContain(dir);
    expect(message).toContain("something odd");
    expect(message).toContain("Check the permissions");
  });

  it("names what the folder holds", () => {
    expect(folderProblemMessage(dir, "settings", err("EACCES"))).toContain("your settings and saved keys");
    expect(folderProblemMessage(dir, "results", err("EACCES"))).toContain("your run results");
  });
});
