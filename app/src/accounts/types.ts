/**
 * Contract for test accounts (0.4.0, docs/v2-spec.md "Test accounts"): two accounts the user owns on the app under
 * test, used to run checks signed in and to check that one account (or a signed-out visitor) can't read the other's
 * data. Passwords are write-only: nothing here that leaves the process carries one.
 */
import type { AccountId } from "../core/types.js";

export type { AccountId } from "../core/types.js";

export const ACCOUNT_IDS: readonly AccountId[] = ["a", "b"];

/** One slot as saved and resolved. `password` stays in this process: never serialise a TestAccount to a client. */
export interface TestAccount {
  id: AccountId;
  /** "Account A" / "Account B" unless the user gave a label. */
  label: string;
  /** The app's sign-in page. Empty = not configured. */
  loginUrl: string;
  /** What the sign-in form's identifier field takes (usually an email). Empty = not configured. */
  username: string;
  /** null = none saved (or dropped because the login origin changed). */
  password: string | null;
}

/** The whole resolved configuration. */
export interface AccountsConfig {
  /** The user says A and B must not see each other's data. Default true. */
  isolated: boolean;
  accounts: Record<AccountId, TestAccount>;
}

/** Where a resolved value came from. */
export type AccountSource = "file" | "env" | "default";

/** What GET /api/accounts and `run-hound accounts status` show for one slot: no password, only whether one is saved. */
export interface AccountStatus {
  id: AccountId;
  label: string;
  loginUrl: string;
  username: string;
  hasPassword: boolean;
  /** True when loginUrl, username and password are all set. */
  ready: boolean;
  sources: { label: AccountSource; loginUrl: AccountSource; username: AccountSource; password: AccountSource };
  /** Plain-language problem, e.g. "The saved password was for http://localhost:5173, so it was not used." null when fine. */
  problem: string | null;
}

export interface AccountsStatus {
  isolated: boolean;
  isolatedSource: AccountSource;
  accounts: Record<AccountId, AccountStatus>;
  /** Absolute path of accounts.json. */
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
  /** The page the browser landed on after signing in (redacted), when ok. */
  landedOn?: string;
  /** "Signed in; landed on /app." or the plain-language SignInError message. */
  message: string;
}
