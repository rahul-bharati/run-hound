/**
 * "Delete all keys and data" (docs/onboarding-spec.md "Delete all keys and data"): removes what the desktop app saved
 * in its settings folder, and the finished reports in its runs folder when asked. It deletes named files and
 * report folders only, never a folder wholesale, never anything outside the two folders it is given, and nothing at all
 * when the settings folder is the command line's.
 */
import { readdir, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ACCOUNTS_SETTINGS_FILE, AI_SETTINGS_FILE, ONBOARDING_FILE, SHARED_FOLDER_REFUSAL } from "../constants/onboarding-constants.js";
import { RUN_ID } from "../constants/server-constants.js";
import type { DataDeleteOutcome } from "../interfaces/onboarding.js";
import { IMPORT_MARKER } from "./settings-import.js";
import { KEY_FILE, SECRETS_FILE } from "./secret-store.js";

/**
 * What lives in the desktop settings folder: the AI and test-account settings, the encrypted store and its key, and the
 * onboarding and import markers. Secrets first, then the key that opens them, then the rest.
 */
export const DATA_FILES: readonly string[] = [SECRETS_FILE, KEY_FILE, AI_SETTINGS_FILE, ACCOUNTS_SETTINGS_FILE, IMPORT_MARKER, ONBOARDING_FILE];

/** A temp file a write of one of DATA_FILES left behind when it was interrupted (`.<name>.<pid>.<hex>.tmp`). */
const LEFTOVER = new RegExp(`^\\.(?:${DATA_FILES.map((name) => name.replace(/\./g, "\\.")).join("|")})\\.\\d+\\.[0-9a-f]+\\.tmp$`);

export interface DataDeleteOptions {
  /** The desktop's settings folder (RUNHOUND_CONFIG_DIR, set by the desktop app). */
  configDir: string;
  /** The command line's settings folder, which is never touched. */
  cliConfigDir: string;
  /** The folder reports are written to. */
  runsDir: string;
  /** Also delete the finished reports in `runsDir`. */
  includeRuns: boolean;
  /** Drops the secret store's data key from memory (operations/secret-store.ts), so a deleted key can't be used again. */
  forgetStoreKey(dir: string): void;
}

async function isFile(path: string): Promise<boolean> {
  return stat(path).then(
    (info) => info.isFile(),
    () => false,
  );
}

/** Deletes each finished run folder (runsDir/<id>/ with a report.json) and returns how many. Leaves any other entry alone. */
async function deleteRuns(runsDir: string): Promise<number> {
  let entries;
  try {
    entries = await readdir(runsDir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let deleted = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || !RUN_ID.test(entry.name)) continue;
    const dir = join(runsDir, entry.name);
    if (!(await isFile(join(dir, "report.json")))) continue;
    await rm(dir, { recursive: true, force: true });
    deleted += 1;
  }
  return deleted;
}

/**
 * Deletes the files in DATA_FILES (and temp files left by interrupted writes of them) from `configDir`, and, with
 * `includeRuns`, the finished report folders in `runsDir`. Refuses (409, nothing deleted) when `configDir` is the same
 * folder as `cliConfigDir`. A failure to delete a file stops there with 500 and says which; what was removed stays removed.
 */
export async function deleteAllKeysAndData(options: DataDeleteOptions): Promise<DataDeleteOutcome> {
  const dir = resolve(options.configDir);
  if (dir === resolve(options.cliConfigDir)) return { ok: false, status: 409, message: SHARED_FOLDER_REFUSAL };
  const files: string[] = [];
  try {
    let names: string[] = [];
    try {
      names = await readdir(dir);
    } catch {
      names = [];
    }
    const leftovers = names.filter((name) => LEFTOVER.test(name));
    for (const name of [...DATA_FILES, ...leftovers]) {
      if (!(await isFile(join(dir, name)))) continue;
      await rm(join(dir, name), { force: true });
      files.push(name);
    }
    options.forgetStoreKey(dir);
    const runs = options.includeRuns ? await deleteRuns(resolve(options.runsDir)) : 0;
    return { ok: true, result: { files, runs } };
  } catch (error) {
    options.forgetStoreKey(dir);
    const why = error instanceof Error ? error.message : String(error);
    return { ok: false, status: 500, message: `Run Hound could not delete everything (${why}). Deleted so far: ${files.length === 0 ? "nothing" : files.join(", ")}.` };
  }
}
