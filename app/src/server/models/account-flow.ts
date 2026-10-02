/**
 * Accounts flow: GET /api/accounts, PUT /api/accounts, POST /api/accounts/test. Reads the accounts file via the
 * config layer and runs the sign-in test through the engine; never returns a password.
 */
import { notReadyMessage, resolveAccounts } from "../../config/accounts.js";
import {
  checkAccountsPatch as configCheckAccountsPatch,
  saveAccounts as configSaveAccounts,
} from "../../config/accounts.js";
import { checkLoginUrls, isAccountId, testSignIn } from "../accounts.js";
import { redactSecrets } from "../../engine/redact.js";
import { MAX_SIGN_IN_TESTS } from "./sign-in-tests.js";
import type { AccountId } from "../../types/accounts.js";
import type {
  AccountsConfig,
  AccountsPatch,
  AccountsResolution,
  AccountsStatus,
  SignInCheck,
} from "../../interfaces/accounts.js";
import type {
  IAccountsFlow,
  SaveAccountsOutcome,
  TestSignInOutcome,
} from "../../interfaces/server.js";

/** The slots + ready check used by the planning and runs flows. */
export interface ReadyAccount {
  id: AccountId;
  accounts: AccountsConfig;
}

export type AccountReadiness =
  | { ok: true; account: ReadyAccount }
  | { ok: false; message: string };

/** Look up the resolved accounts and check the slot is configured. The readiness check uses the same notReadyMessage
 * the Status endpoint exposes, so the user gets the same reason. */
export async function readyAccount(id: AccountId): Promise<AccountReadiness> {
  const { config, status } = await resolveAccounts();
  const why = notReadyMessage(status.accounts[id]);
  if (why) return { ok: false, message: redactSecrets(why) };
  return { ok: true, account: { id, accounts: config } };
}

/** Re-export for callers. */
export { isAccountId };

/** Dependencies the accounts flow needs. */
export interface AccountsFlowDeps {
  allowedHosts(): string[];
  /** Counter the controller increments before each sign-in test and decrements after. */
  signInTests: { value: number; increment(): void; decrement(): void };
}

/** Accounts flow: every /api/accounts and /api/accounts/test operation. */
export class AccountsFlow implements IAccountsFlow {
  readonly #deps: AccountsFlowDeps;

  constructor(deps: AccountsFlowDeps) {
    this.#deps = deps;
  }

  async status(): Promise<AccountsStatus> {
    return (await resolveAccounts()).status;
  }

  async save(patch: unknown): Promise<SaveAccountsOutcome> {
    try {
      configCheckAccountsPatch(patch);
    } catch (err) {
      return {
        ok: false,
        message: redactSecrets(err instanceof Error ? err.message : String(err)),
        status: 400,
      };
    }
    const { status: currentStatus } = await resolveAccounts();
    try {
      await checkLoginUrls(patch as AccountsPatch, currentStatus, {
        allowedHosts: this.#deps.allowedHosts(),
      });
    } catch (err) {
      return {
        ok: false,
        message: redactSecrets(err instanceof Error ? err.message : String(err)),
        status: 400,
      };
    }
    try {
      const status = await configSaveAccounts(patch as AccountsPatch);
      return { ok: true, status };
    } catch (err) {
      const message = redactSecrets(err instanceof Error ? err.message : String(err));
      if ((err as NodeJS.ErrnoException).code) {
        return { ok: false, message: `Could not save the test accounts: ${message}`, status: 500 };
      }
      return { ok: false, message, status: 400 };
    }
  }

  async testSignIn(id: unknown): Promise<TestSignInOutcome> {
    if (!isAccountId(id)) {
      return { ok: false, message: 'id must be "a" (Account A) or "b" (Account B).', status: 400 };
    }
    if (this.#deps.signInTests.value >= MAX_SIGN_IN_TESTS) {
      return {
        ok: false,
        message: "Another sign-in test is still running. Wait for it to finish.",
        status: 409,
      };
    }
    this.#deps.signInTests.increment();
    try {
      const check: SignInCheck = await testSignIn(id, await resolveAccounts(), {
        allowedHosts: this.#deps.allowedHosts(),
      });
      return { ok: true, check };
    } finally {
      this.#deps.signInTests.decrement();
    }
  }
}

export type { AccountsResolution, AccountsConfig, AccountsStatus, AccountsPatch, SignInCheck };