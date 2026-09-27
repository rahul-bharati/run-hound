// Fernway's sign-in and session modes (CONTRACT.md "Process" and "Sign-in and session modes"; docs/v2-spec.md
// "Fernway (0.6.0)"). They change how signing in looks and where the session lives, never what the app does, and work
// with clean mode and with any FERNWAY_BUGS. Node built-ins only.
//
//   FERNWAY_LOGIN    one-step (default): /login asks for the email and the password in one form.
//                    two-step: /login asks for the email first ("Continue"), then shows the password field on the same
//                    page, for any email (the first step never asks the server, so it doesn't reveal who has an account).
//   FERNWAY_SESSION  cookie (default): the session is the fernway_session cookie.
//                    session-storage: signing in answers a token that the SPA keeps in sessionStorage and sends as
//                    "Authorization: Bearer <token>"; the server sets no session cookie at all (not even a visitor's).

/** FERNWAY_LOGIN values; the first is the default. */
export const LOGIN_MODES = Object.freeze(["one-step", "two-step"]);

/** FERNWAY_SESSION values; the first is the default. */
export const SESSION_MODES = Object.freeze(["cookie", "session-storage"]);

/** Thrown by parseLoginMode / parseSessionMode for an unknown value; the message names the known values. */
export class ModeConfigError extends Error {}

/**
 * @template {string} T
 * @param {string} name  The environment variable, for the message.
 * @param {string | undefined} raw
 * @param {readonly T[]} modes
 * @returns {T}
 */
function parseMode(name, raw, modes) {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "") return /** @type {T} */ (modes[0]);
  if (!modes.includes(/** @type {T} */ (value))) {
    throw new ModeConfigError(`unknown ${name} value "${String(raw).trim()}" (known: ${modes.join(", ")})`);
  }
  return /** @type {T} */ (value);
}

/**
 * Parses FERNWAY_LOGIN: "one-step" (default, also for an unset or empty value) or "two-step" (case-insensitive,
 * surrounding whitespace ignored). Throws ModeConfigError for anything else.
 * @param {string | undefined} [raw]
 * @returns {"one-step" | "two-step"}
 */
export const parseLoginMode = (raw) => parseMode("FERNWAY_LOGIN", raw, /** @type {readonly ("one-step" | "two-step")[]} */ (LOGIN_MODES));

/**
 * Parses FERNWAY_SESSION: "cookie" (default, also for an unset or empty value) or "session-storage" (case-insensitive,
 * surrounding whitespace ignored). Throws ModeConfigError for anything else.
 * @param {string | undefined} [raw]
 * @returns {"cookie" | "session-storage"}
 */
export const parseSessionMode = (raw) =>
  parseMode("FERNWAY_SESSION", raw, /** @type {readonly ("cookie" | "session-storage")[]} */ (SESSION_MODES));
