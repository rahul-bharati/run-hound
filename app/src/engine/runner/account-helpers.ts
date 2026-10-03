/** Account-config plumbing used by both plan-flow and run-flow: the "signing in" snapshot and the small predicates. The Signing interface is re-exported from the canonical home for back-compat. */

import type { AccountId, AccountRef } from "../../core/types.js";
import type { AccountsConfig, TestAccount } from "../../interfaces/accounts.js";
import { resolveAccounts } from "../../operations/accounts-storage.js";
import { accountLabel } from "../auth.js";
import type { RunOptions, Signing } from "../../interfaces/runner.js";

export type { Signing } from "../../interfaces/runner.js";

/** The slot that isn't `id`. */
export const otherSlot = (id: AccountId): AccountId => (id === "a" ? "b" : "a");

/** True when the slot has what signing in needs: a sign-in page, a username and a password. */
export function accountReady(account: TestAccount | undefined): account is TestAccount {
  return Boolean(account && account.loginUrl?.trim() && account.username?.trim() && account.password);
}

export function refOf(account: TestAccount): AccountRef {
  return { id: account.id, label: accountLabel(account) };
}

/** The run's accounts: the injected ones, else accounts.json and RUNHOUND_ACCOUNT_*. */
export async function accountsConfig(options: RunOptions): Promise<AccountsConfig> {
  return options.accounts ?? (await resolveAccounts()).config;
}

export async function signingIn(id: AccountId, options: RunOptions): Promise<Signing> {
  const config = await accountsConfig(options);
  const account = config.accounts[id] ?? { id, label: "", loginUrl: "", username: "", password: null };
  const other = config.accounts[otherSlot(id)];
  return { config, account, other: config.isolated && accountReady(other) ? other : null };
}
