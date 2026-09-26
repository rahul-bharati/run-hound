/**
 * Test-account helpers shared by the web server (GET/PUT /api/accounts, POST /api/accounts/test, POST /api/plan
 * signInAs) and the CLI (`accounts …`, `run --as`). docs/v2-spec.md "Test accounts". Nothing here returns a password.
 */
import { chromium } from "playwright";
import { notReadyMessage } from "../accounts/config.js";
import { ACCOUNT_IDS, type AccountsConfig, type AccountsPatch, type AccountsStatus, type SignInCheck } from "../accounts/types.js";
import type { AccountId, AccountRef, Plan } from "../core/types.js";
import { signIn, SignInError } from "../engine/auth.js";
import { cleanErrorMessage, TargetNotAllowedError } from "../engine/errors.js";
import { redactSecrets, registerAccountUsernames, registerSecretLiterals } from "../engine/redact.js";
import { checkTarget, pinArgs, type SafetyOptions } from "../engine/safety.js";

/** True for "a" and "b". */
export function isAccountId(value: unknown): value is AccountId {
  return typeof value === "string" && (ACCOUNT_IDS as readonly string[]).includes(value);
}

/**
 * Registers the passwords of the given slots (every slot when none are named) as literal secrets, so redactSecrets
 * hides them wherever they would appear; returns the function that unregisters them. The engine registers them too
 * while it signs in; this covers what the CLI and the server print around it.
 */
export function registerPasswords(config: AccountsConfig, ids: readonly AccountId[] = ACCOUNT_IDS): () => void {
  const values = ids.map((id) => config.accounts[id].password).filter((p): p is string => typeof p === "string" && p !== "");
  return values.length > 0 ? registerSecretLiterals(values) : () => undefined;
}

/**
 * Refuses a login URL the safety gate refuses (a public address, a host that isn't allowed): throws an Error whose
 * message names the account and the reason, e.g. "Account A's sign-in page can't be used: 8.8.8.8 is not a private
 * address; …". URLs that aren't http(s) are left to saveAccounts, which says so in plainer words.
 */
export async function checkLoginUrls(patch: AccountsPatch, status: AccountsStatus, safety: SafetyOptions): Promise<void> {
  for (const id of ACCOUNT_IDS) {
    const url = patch.accounts?.[id]?.loginUrl?.trim();
    if (!url || !/^https?:\/\//i.test(url)) continue;
    const label = patch.accounts?.[id]?.label?.trim() || status.accounts[id].label;
    try {
      await checkTarget(url, safety);
    } catch (err) {
      if (err instanceof TargetNotAllowedError) throw new Error(`${label}'s sign-in page can't be used: ${err.reason}.`);
      throw err;
    }
  }
}

/** "/notes" for "http://127.0.0.1:5173/notes": where the browser landed, as a short redacted path. */
function landedPath(landedOn: string): string {
  try {
    const url = new URL(landedOn);
    return redactSecrets(`${url.pathname}${url.search}`);
  } catch {
    return redactSecrets(landedOn);
  }
}

/**
 * Signs one slot in (a fresh headless browser, closed afterwards) and says how it went: `ok` with the page it landed
 * on, or the plain reason it failed. A slot that isn't set up fails without contacting the app; a login URL the
 * safety gate refuses fails without opening a browser. Never throws, never names the password.
 */
export async function testSignIn(id: AccountId, resolved: { config: AccountsConfig; status: AccountsStatus }, safety: SafetyOptions): Promise<SignInCheck> {
  const status = resolved.status.accounts[id];
  const account = resolved.config.accounts[id];
  const notReady = notReadyMessage(status);
  if (notReady) return { id, ok: false, message: notReady };

  const unregister = registerPasswords(resolved.config, [id]);
  // The page it lands on may name the account ("/u/alex"): usernames are shown only in Settings and `accounts status`.
  const unregisterName = registerAccountUsernames([account.username]);
  try {
    let pinned: string[];
    try {
      pinned = pinArgs(await checkTarget(account.loginUrl, safety));
    } catch (err) {
      if (err instanceof TargetNotAllowedError) return { id, ok: false, message: redactSecrets(`${status.label}'s sign-in page can't be used: ${err.reason}.`) };
      throw err;
    }
    const browser = await chromium.launch({ headless: true, args: pinned });
    try {
      const signed = await signIn(browser, account, safety);
      const path = landedPath(signed.landedOn);
      return { id, ok: true, landedOn: redactSecrets(signed.landedOn), message: `Signed in as ${status.label}; landed on ${path}.` };
    } finally {
      await browser.close().catch(() => undefined);
    }
  } catch (err) {
    if (err instanceof SignInError) return { id, ok: false, message: redactSecrets(err.message) };
    const reason = redactSecrets(cleanErrorMessage(err instanceof Error ? err.message : String(err)));
    return { id, ok: false, message: `${status.label} could not be signed in: ${reason}` };
  } finally {
    unregister();
    unregisterName();
  }
}

/**
 * True for a failed sign-in: a SignInError, or discovery finding the sign-in page again while signed in ("Signed in
 * as Account A, but <target> still shows the sign-in page."). The server answers 400 and the CLI exits 2 with it.
 */
export function isSignInFailure(err: unknown): boolean {
  if (err instanceof SignInError) return true;
  return err instanceof Error && (err.name === "SignInError" || /^Signed in as .+ still shows the sign-in page/.test(err.message));
}

/** What a username is replaced with in everything but Settings and `accounts status`. */
export const USERNAME_MASK = "[REDACTED:account-username]";

/**
 * A function that replaces the configured usernames (usually emails; case-insensitive, 3+ characters) with
 * USERNAME_MASK: a last layer for what the server and the CLI send out of a signed-in plan or run (the page can show
 * "Signed in as alex@…" in a control that discovery records). The identity when no account is configured.
 */
export function usernameHider(config: AccountsConfig | undefined): (text: string) => string {
  const names = config ? ACCOUNT_IDS.map((id) => config.accounts[id].username).filter((n) => n.length >= 3) : [];
  if (names.length === 0) return (text) => text;
  const pattern = new RegExp(
    names
      .sort((a, b) => b.length - a.length)
      .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|"),
    "gi",
  );
  return (text) => text.replace(pattern, USERNAME_MASK);
}

/** A deep copy of a JSON value with `hide` applied to every string in it. */
export function hideInJson<T>(value: T, hide: (text: string) => string): T {
  return JSON.parse(JSON.stringify(value), (_key, v: unknown) => (typeof v === "string" ? hide(v) : v)) as T;
}

/** The account a plan (or a report's plan) was made as, checked and redacted: only { id, label } ever leave. */
export function planAccount(plan: Plan | undefined): AccountRef | undefined {
  const account: unknown = plan?.account;
  if (typeof account !== "object" || account === null) return undefined;
  const { id, label } = account as { id?: unknown; label?: unknown };
  if (!isAccountId(id) || typeof label !== "string") return undefined;
  return { id, label: redactSecrets(label) };
}
