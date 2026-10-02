/**
 * Redaction orchestration for everything that leaves the server: a "redact this text" function that combines engine
 * secret redaction with the account-username hider and the engine's error-message cleaner, in the order controllers
 * already used (hide applied after redact, cleanErrorMessage before).
 */
import { cleanErrorMessage } from "../../engine/errors.js";
import { redactSecrets } from "../../engine/redact.js";
import { usernameHider } from "../accounts.js";
import type { AccountsConfig } from "../../interfaces/accounts.js";

export interface Redactor {
  /** Redact secrets, then hide any usernames the accounts own. */
  redact(text: string): string;
  /** Clean an error message and apply redact(). */
  clearError(err: unknown): string;
  /** Apply the hide transform (deep JSON) to a JSON-safe value. */
  hideJson<T>(value: T): T;
  /** The accounts this redactor was bound to, or undefined. */
  readonly accounts: AccountsConfig | undefined;
}

/** Build a no-op redactor (no accounts: nothing to hide). */
export function neutralRedactor(): Redactor {
  return {
    accounts: undefined,
    redact: (text) => redactSecrets(text),
    clearError: (err) =>
      redactSecrets(cleanErrorMessage(err instanceof Error ? err.message : String(err))),
    hideJson: (value) => value,
  };
}

/** Build a redactor bound to the given accounts. */
export function redactorFor(accounts: AccountsConfig | undefined): Redactor {
  const hide = usernameHider(accounts);
  return {
    accounts,
    redact: (text) => hide(redactSecrets(text)),
    clearError: (err) =>
      hide(redactSecrets(cleanErrorMessage(err instanceof Error ? err.message : String(err)))),
    hideJson: (value) => JSON.parse(JSON.stringify(value), (_key, v: unknown) =>
      typeof v === "string" ? hide(v) : v,
    ) as typeof value,
  };
}