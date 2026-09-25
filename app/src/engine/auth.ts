/**
 * Signing in as a test account (0.4.0, docs/v2-spec.md "Signing in"). Deterministic: find the sign-in form, fill the
 * identifier and the password, submit, and decide from the page whether it worked. No evidence is captured and the
 * session never touches the disk.
 */
import type { Browser } from "playwright";
import { notImplemented } from "../ai/not-implemented.js";
import type { TestAccount } from "../accounts/types.js";
import type { SafetyOptions } from "./safety.js";

/** A browser session as Playwright's storageState(): cookies plus localStorage per origin. In memory only. */
export type SessionState = Awaited<ReturnType<import("playwright").BrowserContext["storageState"]>>;

export interface SignedIn {
  state: SessionState;
  /** Where the browser landed after submitting (redacted). */
  landedOn: string;
  /**
   * Values that identify this session (cookie values, bearer tokens found in localStorage) for redaction: the
   * runner registers them as literal secrets together with the password.
   */
  secrets: string[];
}

/** Sign-in failed; the message is one or two plain sentences for the CLI, the API and the UI. Never holds the password. */
export class SignInError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignInError";
  }
}

/**
 * Signs `account` in with a fresh, guarded browser context (docs/v2-spec.md "Signing in", steps 1-7) and returns its
 * session. Throws SignInError when the slot isn't ready, the login URL fails the safety gate, no sign-in form is found,
 * the form is still shown after submitting (with the page's own error text, redacted), or the page asks for a code or
 * a captcha (not supported).
 */
export async function signIn(browser: Browser, account: TestAccount, safety: SafetyOptions = {}): Promise<SignedIn> {
  void browser;
  void account;
  void safety;
  return notImplemented("signIn");
}
