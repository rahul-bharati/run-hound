/**
 * Sign-in error class and the "continued on another site" helper. Canonical home for the SignInError the engine
 * throws; the engine/auth subdir re-exports it so the existing `from "engine/auth.js"` imports keep working.
 */

/** Sign-in failed; the message is one or two plain sentences for the CLI, the API and the UI. Never holds the password. */
export class SignInError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignInError";
  }
}

/** True for a value that looks like an http(s) URL. */
function isWebUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/** The host of an http(s) URL in `url`, or the first non-empty whitespace-separated word (the URL the page moved to). */
function hostOf(url: string): string {
  const words = url.trim().split(/\s+/);
  const raw = words.find(isWebUrl) ?? words[0] ?? "";
  try {
    return new URL(raw).host;
  } catch {
    return raw.replace(/^[a-z]+:\/\//i, "").split(/[/?#]/)[0] ?? "";
  }
}

/**
 * The contract's message for a two-step sign-in whose password step is on another origin (0.6.0). Returns a
 * SignInError so callers propagate it unchanged.
 */
export function continuedElsewhere(url: string, redact: (text: string) => string): SignInError {
  return new SignInError(
    `The sign-in continued on another site (${redact(hostOf(url))}), so Run Hound won't type the password there.`,
  );
}