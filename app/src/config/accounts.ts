/**
 * Reusable declarations for the saved test accounts: defaults, the field list, env-variable names, and the
 * path of the saved file. The list of common passwords lives in `constants/accounts-constants.ts`; the check itself
 * is in `utils/validation/common-password.ts`; the file-persistence operations (read, save, clear) and the patch
 * validator live in `operations/accounts-storage.ts`. App consumers should import the storage layer from there
 * directly.
 */
import { join } from "node:path";
import { configDir } from "./ai.js";
import type { AccountId } from "../core/types.js";
import type { AccountStatus } from "../interfaces/accounts.js";
import type { AccountField } from "../types/accounts.js";

/** Path of the saved accounts: <configDir>/accounts.json. `env` defaults to process.env; `home` to os.homedir(). */
export function accountsFile(env: NodeJS.ProcessEnv = process.env, home?: string): string {
  return join(configDir(env, home), "accounts.json");
}

/** Labels used when the user gave none. */
export const DEFAULT_LABELS: Record<AccountId, string> = {
  a: "Account A",
  b: "Account B",
};

/** Longest label accepted: it is shown in plan headers, reports and the runs list. */
export const MAX_LABEL_LENGTH = 60;

/** Every field of a saved account slot. */
export const FIELDS: readonly AccountField[] = ["label", "loginUrl", "username", "password"];

/** The env variable behind a field of a slot, e.g. RUNHOUND_ACCOUNT_A_LOGIN_URL. */
export function accountEnvName(id: AccountId, field: AccountField): string {
  const suffix = {
    label: "LABEL",
    loginUrl: "LOGIN_URL",
    username: "USERNAME",
    password: "PASSWORD",
  }[field];
  return `RUNHOUND_ACCOUNT_${id.toUpperCase()}_${suffix}`;
}

/**
 * Why a slot can't be used yet, naming it by label and what is missing, e.g. "Account B isn't set up: it has no
 * sign-in page, username or password. Set it up in Settings → Test accounts, or with `run-hound accounts set b`."
 * Null when the slot is ready. Never holds the password or the username.
 */
export function notReadyMessage(status: AccountStatus): string | null {
  if (status.ready) return null;
  const missing = [
    status.loginUrl ? "" : "sign-in page",
    status.username ? "" : "username",
    status.hasPassword ? "" : "password",
  ].filter(Boolean);
  const list =
    missing.length <= 1
      ? missing.join("")
      : `${missing.slice(0, -1).join(", ")} or ${missing[missing.length - 1]!}`;
  const problem = status.problem ? ` ${status.problem}` : "";
  return `${status.label} isn't set up: it has no ${list}.${problem} Set it up in Settings → Test accounts, or with \`run-hound accounts set ${status.id}\`.`;
}
