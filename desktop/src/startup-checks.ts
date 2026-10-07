/**
 * Start-up checks the Electron main runs after the Playwright environment is set and before the engine is imported
 * (Rule 4 of docs/desktop-architecture.md): is the browser there, and can the settings and results folders be written?
 *
 * Each failure becomes one plain message that says what happened and what to do, for a native dialog; the app then
 * exits instead of failing later, inside a run, with a stack trace. Nothing here imports Electron or Playwright: the
 * caller passes the path Playwright resolved for its Chromium, so the checks are plain functions of their input.
 */

import { randomBytes } from "node:crypto";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

/** Title of the dialog that reports the problems. */
export const STARTUP_PROBLEM_TITLE = "Run Hound can't start";

/** The command that installs the browser a development checkout needs (a packaged app never runs it). */
export const DEV_BROWSER_INSTALL_COMMAND = "pnpm --filter run-hound exec playwright install chromium";

export type StartupProblemKind = "browser-missing" | "folder-unwritable";

export interface StartupProblem {
  readonly kind: StartupProblemKind;
  /** What happened and what to do about it, in one or two sentences. */
  readonly message: string;
}

export interface StartupCheckInput {
  /** True for an installed app (Electron's `app.isPackaged`), false for a development checkout. */
  readonly packaged: boolean;
  /** The folder a packaged app ships its Chromium in (`resources/playwright-browsers`). */
  readonly bundledBrowsersDir: string;
  /**
   * The Chromium executable Playwright will launch, as it resolved it (`chromium.executablePath()`) with the browser
   * environment already applied; undefined when Playwright has no path for this platform.
   */
  readonly browserExecutable: string | undefined;
  /** The settings folder: AI and account settings and the encrypted store of keys and passwords. */
  readonly configDir: string;
  /** The folder reports and evidence are written to. */
  readonly runsDir: string;
}

/** The file system, swappable for a test. */
export interface StartupChecksDeps {
  /** True when `path` is an existing file. */
  fileExists?: (path: string) => Promise<boolean>;
  /** Creates `dir` if needed and proves a file can be written in it, then removes that file. Rejects with the fs error. */
  ensureWritableDir?: (dir: string, options: { private: boolean }) => Promise<void>;
}

async function fileExistsOnDisk(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** The settings folder holds keys, so it is created owner-only, as the secret store creates it. */
async function ensureWritableOnDisk(dir: string, options: { private: boolean }): Promise<void> {
  await mkdir(dir, { recursive: true, ...(options.private ? { mode: 0o700 } : {}) });
  const probe = join(dir, `.write-test-${process.pid}-${randomBytes(4).toString("hex")}`);
  try {
    await writeFile(probe, "", { flag: "wx" });
  } finally {
    await rm(probe, { force: true }).catch(() => undefined);
  }
}

/** True when `child` is `parent` or lies under it. */
function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function errorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}

/** What happened to a folder that could not be written, and what to do, from the fs error. */
export function folderProblemMessage(dir: string, purpose: "settings" | "results", error: unknown): string {
  const what = purpose === "settings" ? "your settings and saved keys" : "your run results";
  switch (errorCode(error)) {
    case "EACCES":
    case "EPERM":
      return `Run Hound can't write to ${dir}, where it keeps ${what}: it doesn't have permission. Check the permissions on that folder, then start Run Hound again.`;
    case "EROFS":
      return `Run Hound can't write to ${dir}, where it keeps ${what}: the disk is read-only. Make that disk writable, then start Run Hound again.`;
    case "ENOSPC":
      return `Run Hound can't write to ${dir}, where it keeps ${what}: the disk is full. Free some space, then start Run Hound again.`;
    case "ENOTDIR":
    case "EEXIST":
      return `Run Hound can't use ${dir} to keep ${what}: a file is in the way. Move or rename that file, then start Run Hound again.`;
    default: {
      const reason = error instanceof Error ? error.message : String(error);
      return `Run Hound can't write to ${dir}, where it keeps ${what} (${reason}). Check the permissions on that folder, then start Run Hound again.`;
    }
  }
}

function browserProblemMessage(input: StartupCheckInput): string {
  if (input.packaged) {
    return `Run Hound's browser is missing from this installation (expected in ${input.bundledBrowsersDir}). Reinstall Run Hound to restore it.`;
  }
  const where = input.browserExecutable ?? "(no browser path for this platform)";
  return `Playwright's Chromium isn't installed for this development checkout (expected at ${where}). Run: ${DEV_BROWSER_INSTALL_COMMAND}`;
}

/**
 * Runs every check and returns the problems found, browser first; an empty list means the app can start. A packaged
 * app must have the Chromium it ships (the resolved executable exists and lies inside its bundled folder); a
 * development checkout needs Playwright's per-user Chromium. The settings and results folders must be creatable and
 * writable. A failing check never throws.
 */
export async function runStartupChecks(input: StartupCheckInput, deps: StartupChecksDeps = {}): Promise<StartupProblem[]> {
  const fileExists = deps.fileExists ?? fileExistsOnDisk;
  const ensureWritableDir = deps.ensureWritableDir ?? ensureWritableOnDisk;
  const problems: StartupProblem[] = [];

  const executable = input.browserExecutable;
  const bundled = executable !== undefined && (!input.packaged || isInside(input.bundledBrowsersDir, executable));
  if (executable === undefined || !bundled || !(await fileExists(executable))) {
    problems.push({ kind: "browser-missing", message: browserProblemMessage(input) });
  }

  for (const [dir, purpose, isPrivate] of [
    [input.configDir, "settings", true],
    [input.runsDir, "results", false],
  ] as const) {
    try {
      await ensureWritableDir(dir, { private: isPrivate });
    } catch (error) {
      problems.push({ kind: "folder-unwritable", message: folderProblemMessage(dir, purpose, error) });
    }
  }
  return problems;
}

/** The dialog text for a list of problems: one paragraph each. */
export function describeStartupProblems(problems: readonly StartupProblem[]): string {
  return problems.map((problem) => problem.message).join("\n\n");
}
