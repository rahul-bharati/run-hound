/**
 * Secret registration and redaction for a single plan or run. The plan and the run both wrap themselves in a
 * `SecretRegistrations`: every password the configuration holds (literal secrets) and every username of 3 characters
 * or more (hidden in any letter case, like the server's usernameHider) is registered with the redactor for the
 * lifetime of the run, so a report, an evidence card, a spec, a log line, a progress event or an AI prompt never
 * name an account by anything but its label (docs/v2-spec.md "Test accounts"). `redactError` re-uses the same
 * redactor when an error is thrown: its message and stack are redacted in place (or rebuilt when the error is
 * frozen) so the caller that prints it later still gets a clean string.
 */
import { registerAccountUsernames, registerSecretLiterals, redactSecrets } from "../redact.js";
import type { AccountsConfig, TestAccount } from "../../interfaces/accounts.js";

/**
 * What a signed-in plan or run registers while it is going: every password the configuration holds (literal secrets),
 * and every username of 3 characters or more (hidden in any letter case, like the server's usernameHider). Reports,
 * evidence, specs, logs, progress events and AI prompts name accounts by label only (docs/v2-spec.md "Test accounts").
 */
export function accountSecretsOf(config: AccountsConfig): { passwords: string[]; usernames: string[] } {
  const accounts = Object.values(config.accounts).filter((a): a is TestAccount => Boolean(a));
  return {
    passwords: accounts.flatMap((a) => (a.password ? [a.password] : [])),
    usernames: accounts.map((a) => a.username?.trim() ?? "").filter((u) => u.length >= 3),
  };
}

/** Literal-secret and username registrations of one plan or run, released together at its end. */
export class SecretRegistrations {
  private readonly held: (() => void)[] = [];
  constructor(values: string[] = []) {
    this.add(values);
  }
  add(values: string[]): void {
    if (values.length > 0) this.held.push(registerSecretLiterals(values));
  }
  /** Registers the accounts' passwords and usernames (accountSecretsOf). */
  addAccounts(config: AccountsConfig): void {
    const { passwords, usernames } = accountSecretsOf(config);
    this.add(passwords);
    if (usernames.length > 0) this.held.push(registerAccountUsernames(usernames));
  }
  release(): void {
    for (const unregister of this.held.splice(0)) unregister();
  }
}

/** The same error with its message redacted while the run's secrets are still registered (callers print it later). */
export function redactError(err: unknown): unknown {
  if (err instanceof Error) {
    const message = redactSecrets(err.message);
    if (message !== err.message) {
      try {
        err.message = message;
      } catch {
        return new Error(message);
      }
    }
    if (err.stack) err.stack = redactSecrets(err.stack);
  }
  return err;
}
