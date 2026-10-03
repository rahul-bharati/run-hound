/**
 * Accounts flow: GET /api/accounts, PUT /api/accounts, POST /api/accounts/test. Reads the accounts file via the
 * storage layer and runs the sign-in test through the engine; never returns a password. The mandatory deps are wired
 * in the composition root; the flow never reaches for module-level fallbacks.
 */
import { notReadyMessage } from "../../config/accounts.js";
import { checkLoginUrls, isAccountId, testSignIn } from "../accounts.js";
import { redactSecrets } from "../../engine/redact.js";
import { MAX_SIGN_IN_TESTS } from "../../config/server.js";
import { resolveAccounts } from "../../operations/accounts-storage.js";
import type { AccountId } from "../../types/accounts.js";
import type {
  AccountsPatch,
  AccountsStatus,
  SignInCheck,
} from "../../interfaces/accounts.js";
import type {
  AccountsFlowDeps,
  IAccountsFlow,
  SaveAccountsOutcome,
  TestSignInOutcome,
} from "../../interfaces/server.js";
import type { AccountReadiness, ReadyAccount } from "../../interfaces/server.js";

export type { AccountReadiness, AccountsFlowDeps, ReadyAccount };

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

/** Accounts flow: every /api/accounts and /api/accounts/test operation. */
export class AccountsFlow implements IAccountsFlow {
  readonly #deps: AccountsFlowDeps;

  constructor(deps: AccountsFlowDeps) {
    this.#deps = deps;
  }

  async status(): Promise<AccountsStatus> {
    return (await this.#deps.resolveAccounts()).status;
  }

  async save(patch: unknown): Promise<SaveAccountsOutcome> {
    try {
      this.#deps.checkAccountsPatch(patch);
    } catch (err) {
      return {
        ok: false,
        message: redactSecrets(err instanceof Error ? err.message : String(err)),
        status: 400,
      };
    }
    const { status: currentStatus } = await this.#deps.resolveAccounts();
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
      const status = await this.#deps.saveAccounts(patch as AccountsPatch);
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
      const check: SignInCheck = await testSignIn(id, await this.#deps.resolveAccounts(), {
        allowedHosts: this.#deps.allowedHosts(),
      });
      return { ok: true, check };
    } finally {
      this.#deps.signInTests.decrement();
    }
  }
}
