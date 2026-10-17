/**
 * The one message the desktop app shows about the one-time import of the command line's settings
 * (docs/decisions 2026-10-07-desktop-settings-import), as plain text. It reaches the user as an in-app banner
 * (main.ts queues it, the UI takes it over the notices channel, D8), not as a native dialog. Kept apart from main.ts so
 * the wording is tested.
 */

import type { DesktopNotice } from "./contract.js";

/** The part of the import's result the message needs (`SettingsImport` in app/src/operations/settings-import.ts). */
export interface ImportedSettings {
  /** The command line's folder the settings came from. */
  readonly from: string;
  /** Set when the saved keys could not be read, so they were not imported. Its text is for the log: it speaks of the command line. */
  readonly problem: string | null;
}

export type Notice = DesktopNotice;

/** Shown once when the window loads, when settings were imported. */
export function importedNotice(result: ImportedSettings): Notice {
  const message = `Imported your settings from ${result.from}.`;
  if (result.problem === null) return { type: "info", message };
  return {
    type: "info",
    message: `${message} Some of your saved keys couldn't be imported, so enter any that are missing again in Settings.`,
  };
}

/** Shown once when the window loads, when the import itself failed (the app still starts). */
export function importFailedNotice(cliDir: string, error: unknown): Notice {
  return {
    type: "warning",
    message: `Run Hound could not import your settings from ${cliDir}. They are unchanged there. Check that you can read that folder, or enter your settings again in Settings.`,
    detail: error instanceof Error ? error.message : String(error),
  };
}
