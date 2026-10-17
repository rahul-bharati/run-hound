/**
 * The desktop app's one-time import of what the command line saved (docs/decisions 2026-10-07-desktop-settings-import):
 * the AI and test-account settings files, and the keys and passwords in its encrypted store, re-sealed in the desktop
 * app's own store (wrapped by the OS keychain when there is one). It runs once, at the first launch whose folder holds
 * nothing saved yet, and leaves the command line's folder untouched. This module is the only place that writes the
 * import marker.
 */
import { randomBytes } from "node:crypto";
import { access, chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { KEY_FILE, SECRETS_FILE, readSecrets, writeSecrets } from "./secret-store.js";

/** The settings files copied as they are; any plain text left in them moves into the store on first read. */
const SETTINGS_FILES = ["ai.json", "accounts.json"] as const;
/** Written to the desktop folder once the first launch has looked, so the import never runs twice. */
export const IMPORT_MARKER = "imported-from-cli.json";
/** Secrets that belong to the command line only: the live provider test keys (pnpm live-keys). */
const NOT_IMPORTED = /^live\./;

export interface SettingsImport {
  /** The command line's folder it imported from. */
  from: string;
  /** The settings files copied. */
  files: string[];
  /** How many keys and passwords were re-sealed. */
  secrets: number;
  /** Set when the command line's saved keys or passwords could not be read, so they were not imported. */
  problem: string | null;
}

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  );

/** Writes `text` to `file` (0600) through a temp file renamed over it; the folder is created 0700. */
async function writePrivate(dir: string, name: string, text: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700).catch(() => undefined);
  const temp = join(dir, `.${name}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    await writeFile(temp, text, { mode: 0o600, flag: "wx" });
    await rename(temp, join(dir, name));
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

/**
 * Imports the command line's saved settings from `cliDir` into `desktopDir`, once. Returns what was imported, or null
 * when nothing was: the folders are the same, the import already ran, the desktop folder already holds settings, or
 * the command line saved nothing. Every outcome but a failure writes the marker, so the next launch doesn't look again.
 * A failure (a folder that can't be read or written) removes what this import wrote, which is safe because it only
 * imports into a folder that held nothing, then throws; the next launch finds the folder empty and tries again.
 *
 * Call it after the desktop app has handed the engine its OS key protector (useOsKeyProtector), so the imported
 * secrets are sealed under the keychain. The command line's store is read without upgrading its key, so the command
 * line keeps working with its own copy.
 */
export async function importCliSettingsOnce(cliDir: string, desktopDir: string, options: { env?: NodeJS.ProcessEnv; now?: Date } = {}): Promise<SettingsImport | null> {
  if (resolve(cliDir) === resolve(desktopDir)) return null;
  if (await exists(join(desktopDir, IMPORT_MARKER))) return null;
  const mark = (result: SettingsImport | null): Promise<void> =>
    writePrivate(
      desktopDir,
      IMPORT_MARKER,
      `${JSON.stringify({ version: 1, at: (options.now ?? new Date()).toISOString(), from: result ? result.from : null, files: result?.files ?? [], secrets: result?.secrets ?? 0 }, null, 2)}\n`,
    );

  const desktopHasSettings = (await Promise.all([...SETTINGS_FILES, SECRETS_FILE, KEY_FILE].map((name) => exists(join(desktopDir, name))))).some(Boolean);
  if (desktopHasSettings) {
    await mark(null);
    return null;
  }
  const files: string[] = [];
  for (const name of SETTINGS_FILES) if (await exists(join(cliDir, name))) files.push(name);
  const store = await readSecrets(cliDir, { ...(options.env ? { env: options.env } : {}), upgrade: false });
  const secrets = Object.fromEntries(Object.entries(store.values).filter(([name]) => !NOT_IMPORTED.test(name)));
  if (files.length === 0 && Object.keys(secrets).length === 0) {
    await mark(null);
    return null;
  }

  // Secrets first: a settings file that names a key is never copied without it.
  try {
    if (Object.keys(secrets).length > 0) await writeSecrets(desktopDir, secrets, options.env ? { env: options.env } : {});
    for (const name of files) await writePrivate(desktopDir, name, await readFile(join(cliDir, name), "utf8"));
    const result: SettingsImport = { from: cliDir, files, secrets: Object.keys(secrets).length, problem: store.problem };
    await mark(result);
    return result;
  } catch (error) {
    await Promise.all([...SETTINGS_FILES, SECRETS_FILE, KEY_FILE, IMPORT_MARKER].map((name) => rm(join(desktopDir, name), { force: true })));
    throw error;
  }
}
