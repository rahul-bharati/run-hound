import type { SecretProtection } from "../types/secrets.js";
import type { AccountId } from "../core/types.js";
import type { AccountSource } from "../types/accounts.js";

export interface AccountStatus {
  id: AccountId;
  label: string;
  loginUrl: string;
  username: string;
  hasPassword: boolean;
  ready: boolean;
  sources: { label: AccountSource; loginUrl: AccountSource; username: AccountSource; password: AccountSource };
  problem: string | null;
}

export interface AccountsStatus {
  isolated: boolean;
  isolatedSource: AccountSource;
  accounts: Record<AccountId, AccountStatus>;
  file: string;
  /** How saved passwords are kept here (operations/secret-store.ts). */
  secretProtection?: SecretProtection;
}

/** PUT /api/accounts and `accounts set`: omitted fields are kept; `password: ""` removes the saved password. */
export interface AccountsPatch {
  isolated?: boolean;
  accounts?: Partial<Record<AccountId, { label?: string; loginUrl?: string; username?: string; password?: string }>>;
}

/** What POST /api/accounts/test and `accounts test` report for one slot. */
export interface SignInCheck {
  id: AccountId;
  ok: boolean;
  landedOn?: string;
  message: string;
}

export interface AccountsConfig {
  isolated: boolean;
  accounts: Record<AccountId, TestAccount>;
}

export interface TestAccount {
  id: AccountId;
  label: string;
  loginUrl: string;
  username: string;
  password: string | null;
}

/** One slot as the saved accounts file holds it (only well-typed, non-empty values). config/accounts.ts. */
export interface SavedSlot {
  label?: string;
  loginUrl?: string;
  username?: string;
  password?: string;
  passwordOrigin?: string;
}

/** The saved accounts file: `isolated` when set, the slots by id. config/accounts.ts. */
export interface SavedFile {
  isolated?: boolean;
  accounts: Partial<Record<AccountId, SavedSlot>>;
}

/** The file as read: `problem` is set when it exists but can't be used. config/accounts.ts. */
export interface ReadResult {
  saved: SavedFile;
  problem: string | null;
}

/** The resolved accounts: the config that callers see and the status that explains it. config/accounts.ts. */
export interface AccountsResolution {
  config: AccountsConfig;
  status: AccountsStatus;
}

