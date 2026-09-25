/**
 * Saved test accounts (0.4.0, docs/v2-spec.md "Test accounts"): <configDir>/accounts.json (0600 in a 0700 folder,
 * written atomically), overridden per field by RUNHOUND_ACCOUNT_{A,B}_{LOGIN_URL,USERNAME,PASSWORD,LABEL} and
 * RUNHOUND_ACCOUNTS_ISOLATED. The folder is the AI config's (configDir in ai/config.ts).
 *
 * A saved password is bound to the origin of the loginUrl it was saved with: when the effective loginUrl has another
 * origin (changed in the file, by an env var or a flag), the password is not used (AccountStatus.problem says so), and
 * saving a new login origin without a new password removes the stored one.
 */
import { notImplemented } from "../ai/not-implemented.js";
import type { AccountsConfig, AccountsPatch, AccountsStatus, AccountId, TestAccount } from "./types.js";

/** Path of the saved accounts: <configDir>/accounts.json. `env` defaults to process.env; `home` to os.homedir(). */
export function accountsFile(env: NodeJS.ProcessEnv = process.env, home?: string): string {
  void env;
  void home;
  return notImplemented("accountsFile");
}

/** Labels used when the user gave none. */
export const DEFAULT_LABELS: Record<AccountId, string> = { a: "Account A", b: "Account B" };

/**
 * Reads the file (missing or unreadable = nothing saved) and applies the env overrides. Never throws on a bad file: a
 * malformed file reads as nothing saved, with a problem on each slot.
 */
export async function resolveAccounts(options: { env?: NodeJS.ProcessEnv; home?: string } = {}): Promise<{ config: AccountsConfig; status: AccountsStatus }> {
  void options;
  return notImplemented("resolveAccounts");
}

/**
 * Applies a patch to the saved file (not to env overrides, which keep winning) and returns the new status. Rejects
 * with a plain message when a loginUrl is not an http(s) URL. The caller checks loginUrl against the safety gate.
 */
export async function saveAccounts(patch: AccountsPatch, options: { env?: NodeJS.ProcessEnv; home?: string } = {}): Promise<AccountsStatus> {
  void patch;
  void options;
  return notImplemented("saveAccounts");
}

/** Removes one slot from the saved file (`accounts clear a`). */
export async function clearAccount(id: AccountId, options: { env?: NodeJS.ProcessEnv; home?: string } = {}): Promise<AccountsStatus> {
  void id;
  void options;
  return notImplemented("clearAccount");
}

/** True when the slot has a loginUrl, a username and a usable password. */
export function isReady(account: TestAccount): boolean {
  void account;
  return notImplemented("isReady");
}
