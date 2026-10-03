import type { AccountId } from "../core/types.js";

export type { AccountId } from "../core/types.js";

export const ACCOUNT_IDS: readonly AccountId[] = ["a", "b"];

export type AccountSource = "file" | "env" | "default";

/** One field of a saved account slot (config/accounts.ts saveAccounts patch). */
export type AccountField = "label" | "loginUrl" | "username" | "password";
