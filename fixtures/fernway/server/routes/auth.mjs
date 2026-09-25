// Account endpoints (/signup and /login). All account and session code lives in this module so V2's real accounts
// can grow here. See CONTRACT.md "API".
//
//   POST /api/signup  { name, email, password, company, terms } -> 201 { id, name, email } and a new session cookie;
//                     same email (any case, including the demo account) -> 409 on `email`; password 8+ characters
//                     (not trimmed); the name "Crash" in `name` or `company` -> 500. The password is stored as a
//                     scrypt hash and never echoed.
//   POST /api/login   { email, password, remember } -> 200 { id, name, email } and a new session cookie (kept 30 days
//                     with `remember`), or 401 { error: "Email or password is incorrect" } with no cookie.
//
// Data: ctx.store.users, ctx.store.sessions (Map session id -> user id); ctx.sessionUser(cookies).

import { badRequest, conflict, crashIfNamed, created, ok, unauthorized, validator } from "../http.mjs";
import { hashPassword, verifyPassword } from "../passwords.mjs";

/** Messages the client shows on the fields (src/pages/auth/schemas.ts uses the same wording). */
export const AUTH_MESSAGES = Object.freeze({
  nameRequired: "Enter your full name.",
  workEmailRequired: "Enter your work email.",
  emailRequired: "Enter your email address.",
  emailInvalid: "Enter an email address like name@studio.com.",
  passwordNew: "Create a password.",
  passwordShort: "Use at least 8 characters.",
  passwordLong: "Use 128 characters or fewer.",
  passwordRequired: "Enter your password.",
  terms: "Agree to the Terms and Privacy Policy to continue.",
  emailTaken: "An account with this email already exists",
  badCredentials: "Email or password is incorrect",
});

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
/** "Remember me": the session cookie is kept for 30 days instead of the browser session. */
export const REMEMBER_MAX_AGE = 60 * 60 * 24 * 30;

/** @param {import("../seed.mjs").User} user */
const publicUser = (user) => ({ id: user.id, name: user.name, email: user.email });

/** Compared against when the email is unknown, so a wrong email costs the same scrypt work as a wrong password. */
let dummyHash = "";

/**
 * @param {import("../http.mjs").Router} router
 * @param {import("../app.mjs").AppContext} ctx
 */
export function register(router, ctx) {
  /**
   * Starts a new session for the user (a new id every time, so a session id from before signing in is never
   * promoted) and returns the Set-Cookie header.
   * @param {string} userId
   * @param {boolean} remember
   */
  function startSession(userId, remember) {
    const sessionId = ctx.newId();
    ctx.store.sessions.set(sessionId, userId);
    const cookie = ctx.sessionCookie(sessionId);
    return { "set-cookie": remember ? `${cookie}; Max-Age=${REMEMBER_MAX_AGE}` : cookie };
  }

  /**
   * The raw password field: a string, never trimmed. Records the error (if any) on the validator.
   * @param {ReturnType<typeof validator>} v
   * @param {unknown} value
   * @param {{ required: string, min?: number }} opts
   */
  function readPassword(v, value, opts) {
    if (value !== undefined && value !== null && typeof value !== "string") {
      v.fail("password", "Must be text.");
      return "";
    }
    const password = typeof value === "string" ? value : "";
    if (password === "") v.fail("password", opts.required);
    else if (opts.min !== undefined && password.length < opts.min) v.fail("password", AUTH_MESSAGES.passwordShort);
    else if (password.length > PASSWORD_MAX) v.fail("password", AUTH_MESSAGES.passwordLong);
    return password;
  }

  router.post("/api/signup", ({ body }) => {
    const v = validator(body);
    const name = v.text("name", { required: AUTH_MESSAGES.nameRequired, max: 80 });
    const email = v.email("email", { required: AUTH_MESSAGES.workEmailRequired, invalid: AUTH_MESSAGES.emailInvalid });
    const password = readPassword(v, body.password, { required: AUTH_MESSAGES.passwordNew, min: PASSWORD_MIN });
    const company = v.text("company", { max: 100 });
    v.boolean("terms", { mustBeTrue: AUTH_MESSAGES.terms });
    if (!v.ok) return badRequest(v.errors);

    crashIfNamed(name, company);
    if (ctx.store.users.some((u) => u.email === email)) return conflict({ email: AUTH_MESSAGES.emailTaken });

    /** @type {import("../seed.mjs").User} */
    const user = { id: ctx.newId(), name, email, company, passwordHash: hashPassword(password), createdAt: ctx.now() };
    ctx.store.users.push(user);
    return created(publicUser(user), startSession(user.id, false));
  });

  // Signing in creates nothing, so it is not de-duplicated: a replayed answer would hand out an old session.
  router.post(
    "/api/login",
    ({ body }) => {
      const v = validator(body);
      const email = v.email("email", { required: AUTH_MESSAGES.emailRequired, invalid: AUTH_MESSAGES.emailInvalid });
      const password = readPassword(v, body.password, { required: AUTH_MESSAGES.passwordRequired });
      const remember = v.boolean("remember");
      if (!v.ok) return badRequest(v.errors);

      const user = ctx.store.users.find((u) => u.email === email);
      if (!user) {
        dummyHash ||= hashPassword("fernway-no-such-user");
        verifyPassword(password, dummyHash);
        return unauthorized(AUTH_MESSAGES.badCredentials);
      }
      if (!verifyPassword(password, user.passwordHash)) return unauthorized(AUTH_MESSAGES.badCredentials);
      return ok(publicUser(user), startSession(user.id, remember));
    },
    { idempotency: false },
  );
}
