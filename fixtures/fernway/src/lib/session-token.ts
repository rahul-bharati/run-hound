/**
 * The session token in FERNWAY_SESSION=session-storage mode (CONTRACT.md "Sign-in and session modes"): signing in (or
 * up) answers `token`, which the SPA keeps in sessionStorage under "fernway_session" (so it lasts as long as the tab, a
 * reload included, and a new tab starts signed out) and sends on every API call as "Authorization: Bearer <token>".
 * Nothing is kept in localStorage. Every access is guarded: storage can be unavailable (a sandboxed frame, a browser
 * setting), and then the app simply behaves as signed out.
 */
import { sessionMode } from "./bugs";

/** The sessionStorage key (the cookie mode's cookie has the same name). */
export const SESSION_TOKEN_KEY = "fernway_session";

/** The kept token, or null (none, cookie mode, or no sessionStorage). */
export function readSessionToken(): string | null {
  if (sessionMode() !== "session-storage") return null;
  try {
    return sessionStorage.getItem(SESSION_TOKEN_KEY) || null;
  } catch {
    return null;
  }
}

/** Keeps the token a sign-in or sign-up answered (only in session-storage mode). */
export function saveSessionToken(token: string): void {
  if (sessionMode() !== "session-storage") return;
  try {
    sessionStorage.setItem(SESSION_TOKEN_KEY, token);
  } catch {
    // No sessionStorage: the next page load is signed out.
  }
}

/** Forgets the token (after signing out, or when the server no longer knows it). */
export function clearSessionToken(): void {
  try {
    sessionStorage.removeItem(SESSION_TOKEN_KEY);
  } catch {
    // Nothing to clear.
  }
}

/** The Authorization header for an API call: the bearer token in session-storage mode, else nothing. */
export function sessionHeaders(): Record<string, string> {
  const token = readSessionToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}
