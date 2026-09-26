// Accounts and sessions (/signup, /login, the app's session). All account and session code lives in this module.
// See CONTRACT.md "Accounts" and "API".
//
//   POST /api/signup      { name, email, password, company, terms } -> 201 { id, name, email } and a new session
//                         cookie: a new user with an empty workspace (named after the company, else "<first name>'s
//                         workspace"), signed in. Same email (any case, including a seeded account) -> 409 on `email`;
//                         password 8+ characters (not trimmed); the name "Crash" in `name` or `company` -> 500. The
//                         password is stored as a scrypt hash and never echoed.
//   POST /api/login       { email, password, remember } -> 200 { id, name, email } and a new session cookie (kept 30
//                         days with `remember`), or 401 { error: "Email or password is incorrect" } with no cookie.
//   POST /api/login/demo  {} -> 200 { id, name, email } and a new session cookie: signs in as Alex (the demo account)
//                         without anyone typing or seeing a password ("Use the demo account" on /login).
//   POST /api/logout      -> 204; ends the session (if any) and removes the cookie (Max-Age=0). Works signed out.
//   GET  /api/me          -> 200 { id, name, email, workspace } for the session user, else 401 { error: "Sign in to
//                         continue" }. Always honest: V03 never makes it answer without a session.
//
// Data: ctx.store.users, ctx.store.sessions (Map session id -> user id), ctx.store.workspaces; ctx.sessionUser().
// Cookie flags come from ctx.sessionCookie, given the request's Host (W09 drops HttpOnly; V08 sends it SameSite=None).

import { badRequest, conflict, crashIfNamed, created, noContent, ok, unauthorized, validator } from "../http.mjs";
import { hashPassword, verifyPassword } from "../passwords.mjs";
import { ACCOUNTS, emptyWorkspace } from "../seed.mjs";

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
  signInFirst: "Sign in to continue",
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
   * @param {import("../http.mjs").ApiRequest} request  Its Host header decides V08's cookie flags.
   */
  function startSession(userId, remember, request) {
    const sessionId = ctx.newId();
    ctx.store.sessions.set(sessionId, userId);
    const cookie = ctx.sessionCookie(sessionId, request.req?.headers.host);
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

  router.post("/api/signup", (request) => {
    const { body } = request;
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
    ctx.store.workspaces.set(user.id, emptyWorkspace(user));
    return created(publicUser(user), startSession(user.id, false, request));
  });

  // Signing in creates nothing, so it is not de-duplicated: a replayed answer would hand out an old session.
  router.post(
    "/api/login",
    (request) => {
      const { body } = request;
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
      return ok(publicUser(user), startSession(user.id, remember, request));
    },
    { idempotency: false },
  );

  // "Use the demo account": a session for Alex, so people can try the app without the password ever being shown.
  router.post(
    "/api/login/demo",
    (request) => {
      const user = ctx.store.users.find((u) => u.id === ACCOUNTS.alex.id);
      if (!user) throw new Error("the demo account is missing from the seed");
      return ok(publicUser(user), startSession(user.id, false, request));
    },
    { idempotency: false },
  );

  router.post(
    "/api/logout",
    ({ cookies, req }) => {
      const sid = cookies.fernway_session;
      if (sid) ctx.store.sessions.delete(sid);
      return { ...noContent(), headers: { "set-cookie": ctx.clearSessionCookie(req?.headers.host) } };
    },
    { idempotency: false },
  );

  router.get("/api/me", ({ cookies }) => {
    const user = ctx.sessionUser(cookies);
    if (!user) return unauthorized(AUTH_MESSAGES.signInFirst);
    return ok({ ...publicUser(user), workspace: ctx.workspaceOf(user.id)?.name ?? "" });
  });
}
