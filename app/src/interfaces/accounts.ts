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

