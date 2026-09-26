/**
 * ACCOUNTS APP: the shared test app for 0.4.0 (V2) tests: two users with their own data behind a sign-in page, plus
 * toggles that plant the V2 bugs. HTTP on 127.0.0.1, a random free port, one independent in-memory state per start().
 * Its own behaviour is pinned by test/accounts-app.test.ts.
 *
 *   import { startAccountsApp } from "../test-support/accounts-app.js";   // (from src/<dir>/: "../../test-support/…")
 *   const app = await startAccountsApp({ idor: true });  // every option is optional
 *   ...
 *   await app.stop();
 *
 * OPTIONS (AccountsAppOptions)
 *   tokenMode    "cookie" (default) | "bearer"
 *   loginVariant "email" (default) | "username" | "two-password" | "otp"
 *   idor         GET /api/users/:id/profile returns ANY existing user's profile to any signed-in user (PUT is still
 *                owner-only).                                                 (Fernway V01)
 *   listLeak     GET /api/notes returns EVERY user's notes to any signed-in user.                        (V02)
 *   noAuth       the data endpoints (/api/notes, /api/users/:id/profile) answer without a session, as alice. /api/me
 *                stays honest (401 without a session), so the client still redirects signed-out visitors
 *                ("only the SPA redirects").                                                               (V03)
 *   massAssign   PUT /api/users/:id/profile stores EVERY key it is sent except `id` (role, plan, isAdmin, credits…),
 *                and GET returns them.                                                                     (V04)
 *   deepLink404  a direct GET of /settings answers 404 (HTML: <title>404 Not Found</title>, <h1>Not Found</h1>), while
 *                in-app navigation (clicking the Settings link: history.pushState) still renders Settings.     (V05)
 *   Clean (no toggles): every data endpoint answers 401 without a session, only returns the session user's data,
 *   404 for another user's id, and PUT profile keeps only `displayName` and `bio` (string values; other keys ignored).
 *
 * USERS (app.users.alice / app.users.bob; AppUser)
 *   alice: id "u1", email "alice@example.test", username "alice", password "alice-pass-1234", name "Alice Archer",
 *          displayName "Alice", bio "Keeps careful lists.", role "member", plan "free"
 *   bob:   id "u2", email "bob@example.test", username "bob", password "bob-pass-5678", name "Bob Baker",
 *          displayName "Bob", bio "Reads on the train.", role "member", plan "free"
 *   Seeded notes ({ id, ownerId, title, body }): n1 (u1) "Groceries" / "Eggs, flour, oat milk"; n2 (u1) "Trip ideas" /
 *   "Lisbon in spring"; n3 (u2) "Reading list" / "Piranesi, then Dune". New notes get n4, n5, …
 *   None of bob's data contains "alice" (any case), and none of alice's notes contain her email or username, so an A
 *   marker (email, or "alice" in the username variant) in B's data only comes from a leak of A's identity endpoints
 *   (/api/me, profile) or of a record the test created as alice.
 *
 * SESSIONS
 *   cookie mode: POST /api/login success sets `sid=<random hex>; Path=/; HttpOnly; SameSite=Lax` (no token in the body).
 *                Only the `sid` cookie is read; an Authorization header is ignored.
 *   bearer mode: POST /api/login success returns { token, user } and sets NO cookie. The client stores the token in
 *                localStorage["token"] (same origin as app.url) and sends `Authorization: Bearer <token>` on every
 *                /api call. Only that header is read; cookies are ignored.
 *   Sessions live in memory until POST /api/logout (or signOutEveryone()); reset() does NOT end them.
 *
 * HTTP API (JSON bodies; responses are application/json)
 *   POST /api/login         { email, password } (username variant: { username, password }; either key is read as the
 *                           identifier, matched against the email, or against the username in the username variant)
 *                           → 200 { user: { id, name, email } } (+ token in bearer mode)
 *                           → 401 { error: "Email or password is incorrect" }
 *                                 (username variant: "Username or password is incorrect")
 *                           → 400 { error } for a body that isn't a JSON object
 *                           otp variant, right password → 200 { verify: true, challenge } and NO session yet
 *   POST /api/login/verify  { challenge, code } → code "123456" signs in exactly like /api/login's 200;
 *                           anything else → 401 { error: "That code is not right" }
 *   POST /api/signup        → always 403 { error: "New accounts are closed. Sign in instead." }
 *   POST /api/logout        → 204, ends the current session (cookie mode also clears `sid`). Works without a session.
 *   GET  /api/me            → 200 { id, name, email, username } | 401 { error: "Sign in first" }. Never affected by noAuth.
 *   GET  /api/notes         → 200 { notes: Note[] } (the session user's; listLeak: all) | 401
 *   POST /api/notes         { title, body } → 201 { note } (stores only title and body, as strings; other keys ignored)
 *                           | 400 { error: "Title is required" } for an empty title | 401
 *   GET  /api/users/:id/profile → 200 profile record | 404 { error: "Not found" } (another user's id, or unknown) | 401
 *                           profile record = { id, email, username, displayName, bio, role, plan } (+ stored extras
 *                           under massAssign)
 *   PUT  /api/users/:id/profile { displayName?, bio? } → 200 the stored profile record | 404 | 401 | 400 (not an object)
 *   Any other /api method or path → 404 { error: "Not found" }.
 *   "401" bodies are { error: "Sign in first" }. The noAuth fallback user is alice (u1): without a session,
 *   /api/users/u2/profile is still 404 unless idor is on.
 *
 * PAGES (one client-rendered HTML shell; <title> is "<page> · Notes")
 *   GET /                  → 302 to /notes
 *   GET /login             sign-in page, h1 "Sign in", a form named "Sign in" with:
 *                            email variant:    "Email" input#email type=email name=email autocomplete=username
 *                            username variant: "Username" input#username type=text name=username autocomplete=username
 *                            "Password" input#password type=password autocomplete=current-password, button "Sign in",
 *                            and a hidden role=alert (#signin-error) that shows the API's error text on failure.
 *                          two-password variant: BEFORE the sign-in form, a sign-up form named "New here? Create an
 *                            account" with "Your email", "Choose a password" and "Confirm password" (two
 *                            type=password fields) and button "Create account" (POST /api/signup, error in its alert).
 *                          otp variant: after a correct password, the sign-in form gets `hidden` (its password field is
 *                            no longer visible, the URL stays /login) and a new form named "Verification" appears with
 *                            "Verification code" (input#code, autocomplete=one-time-code) and button "Verify".
 *                          On success the client stores the token (bearer) and does location.assign(next): the ?next=
 *                          path when it is a local path ("/…"), else /notes.
 *   GET /notes, /settings, /help, /profile   signed-in pages: the client first GETs /api/me; on non-200 it does
 *                          location.replace("/login?next=<path>") (e.g. /login?next=/notes). Signed in, each page has a
 *                          header with nav "Main" (links "Notes" /notes, "Settings" /settings, "Help" /help) and a
 *                          button "Log out" (POST /api/logout, then /login). The links are handled in-app
 *                          (history.pushState + client render); back/forward work.
 *     /notes:    h1 "Your notes"; form "New note" (Title input#title required, Body textarea#body, button "Save note"
 *                → POST /api/notes { title, body }, then "Note saved" in role=status and the list reloads); a list
 *                ul#notes-list under h2 "Saved notes" loaded from GET /api/notes (each note: <strong>title</strong>
 *                <p>body</p>); form "Profile" (Display name input#displayName, Bio textarea#bio, button "Save profile")
 *                loaded from GET /api/users/<me.id>/profile and saved with PUT /api/users/<me.id>/profile
 *                { displayName, bio } (only those two keys), then "Profile saved" in role=status. Discovery order: the
 *                "New note" form comes first (forms[0]), "Profile" second (form scenarios "@form-2").
 *     /profile:  (not linked from the nav) h1 "Your profile" and the same "Profile" form alone, so it is the main form.
 *     /settings: h1 "Settings", "Signed in as <email>" (from /api/me). deepLink404: a direct GET answers 404.
 *     /help:     h1 "Help" and a sentence of text.
 *   GET /favicon.ico → 204. Any other path → 404 HTML "Not Found"; a non-GET/HEAD on a page path → 405. Page GETs never
 *   need a session (the client decides).
 *   Console: signed-in pages load with no console errors and no 4xx/5xx responses (cookie and bearer). A signed-out
 *   load of a signed-in page logs Chromium's "Failed to load resource … 401" for /api/me, then redirects to /login.
 *
 * THE HANDLE (AccountsApp)
 *   url                 "http://127.0.0.1:<port>" (no trailing slash); loginUrl = url + "/login"; port
 *   options             the resolved options
 *   users               { alice, bob } (seed values; never mutated)
 *   requests            every request received, in order (RecordedRequest: method, url = path + query, headers, body)
 *   stop()              closes the server
 *   reset()             restores the seeded notes and profiles, forgets pending OTP challenges and empties `requests`
 *                       (in place). Sessions survive.
 *   authHeaders(user)   starts a new session for "alice" | "bob" and returns the header the current tokenMode needs:
 *                       { cookie: "sid=…" } or { authorization: "Bearer …" }
 *   storageState(user)  starts a new session and returns it as a Playwright storageState (SessionState): cookie mode →
 *                       the `sid` cookie for 127.0.0.1 (httpOnly, Lax); bearer mode → localStorage "token" for app.url.
 *                       Use it for browser.newContext({ storageState }) or ContextOptions.sessions without signIn().
 *   account(id, user?)  a TestAccount for slot "a" | "b" (default user: a → alice, b → bob): label "Account A"/"Account
 *                       B", loginUrl, username (the email; "alice"/"bob" in the username variant), password
 *   accountsConfig({ isolated? })  { isolated (default true), accounts: { a: account("a"), b: account("b") } }
 *   notes()             a copy of every stored note (all users)
 *   profile(user)       a copy of that user's stored profile record (see massAssign)
 *   activeSessions(user?) how many sessions are open (for that user, or in total)
 *   signOutEveryone()   ends every session
 */
import { randomBytes } from "node:crypto";
import type { ServerResponse } from "node:http";
import type { AccountsConfig, TestAccount } from "../src/accounts/types.js";
import type { AccountId } from "../src/core/types.js";
import type { SessionState } from "../src/engine/auth.js";
import { startFixtureServer, type RecordedRequest } from "./server.js";

export type UserKey = "alice" | "bob";

export interface AccountsAppOptions {
  tokenMode?: "cookie" | "bearer";
  loginVariant?: "email" | "username" | "two-password" | "otp";
  idor?: boolean;
  listLeak?: boolean;
  noAuth?: boolean;
  massAssign?: boolean;
  deepLink404?: boolean;
}

export interface AppUser {
  key: UserKey;
  id: string;
  name: string;
  email: string;
  username: string;
  password: string;
  displayName: string;
  bio: string;
  role: string;
  plan: string;
}

export interface Note {
  id: string;
  ownerId: string;
  title: string;
  body: string;
}

/** The stored profile: { id, email, username, displayName, bio, role, plan } plus whatever massAssign stored. */
export type ProfileRecord = Record<string, unknown> & { id: string; email: string; displayName: string; bio: string; role: string; plan: string };

export interface AccountsApp {
  url: string;
  loginUrl: string;
  port: number;
  options: Required<AccountsAppOptions>;
  users: { alice: AppUser; bob: AppUser };
  requests: RecordedRequest[];
  stop(): Promise<void>;
  reset(): void;
  authHeaders(user: UserKey): Record<string, string>;
  storageState(user: UserKey): SessionState;
  account(id: AccountId, user?: UserKey): TestAccount;
  accountsConfig(options?: { isolated?: boolean }): AccountsConfig;
  notes(): Note[];
  profile(user: UserKey): ProfileRecord;
  activeSessions(user?: UserKey): number;
  signOutEveryone(): void;
}

const USERS: { alice: AppUser; bob: AppUser } = {
  alice: {
    key: "alice",
    id: "u1",
    name: "Alice Archer",
    email: "alice@example.test",
    username: "alice",
    password: "alice-pass-1234",
    displayName: "Alice",
    bio: "Keeps careful lists.",
    role: "member",
    plan: "free",
  },
  bob: {
    key: "bob",
    id: "u2",
    name: "Bob Baker",
    email: "bob@example.test",
    username: "bob",
    password: "bob-pass-5678",
    displayName: "Bob",
    bio: "Reads on the train.",
    role: "member",
    plan: "free",
  },
};

const SEED_NOTES: Note[] = [
  { id: "n1", ownerId: "u1", title: "Groceries", body: "Eggs, flour, oat milk" },
  { id: "n2", ownerId: "u1", title: "Trip ideas", body: "Lisbon in spring" },
  { id: "n3", ownerId: "u2", title: "Reading list", body: "Piranesi, then Dune" },
];

const OTP_CODE = "123456";
const SIGNED_IN_PAGES = new Set(["/notes", "/settings", "/help", "/profile"]);

function seedProfile(user: AppUser): ProfileRecord {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.displayName,
    bio: user.bio,
    role: user.role,
    plan: user.plan,
  };
}

function send(res: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

function html(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(body);
}

function parseObject(body: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(body);
    return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function cookieValue(header: string | undefined, name: string): string | null {
  for (const part of (header ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

const NOT_FOUND_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>404 Not Found</title></head>
<body><h1>Not Found</h1><p>The requested URL was not found on this server.</p></body></html>`;

/**
 * The browser client: a tiny router over one shell. Written as a plain string (no template interpolation inside), so it
 * runs as is in the page. Reads its mode from window.__APP__.
 */
const CLIENT = String.raw`(function () {
  'use strict';
  var CONFIG = window.__APP__ || { tokenMode: 'cookie', loginVariant: 'email' };
  var app = document.getElementById('app');

  function el(id) { return document.getElementById(id); }
  function showError(node, message) { node.textContent = message; node.hidden = false; }
  function clearError(node) { node.textContent = ''; node.hidden = true; }
  function storedToken() { try { return localStorage.getItem('token'); } catch (e) { return null; } }

  function api(method, path, body) {
    var headers = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (CONFIG.tokenMode === 'bearer') {
      var token = storedToken();
      if (token) headers.authorization = 'Bearer ' + token;
    }
    return fetch(path, {
      method: method,
      headers: headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin'
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
        return { status: res.status, data: data };
      });
    });
  }

  function nextPath() {
    var next = new URLSearchParams(location.search).get('next');
    return next && next.charAt(0) === '/' && next.charAt(1) !== '/' ? next : '/notes';
  }

  function signedIn(data) {
    if (CONFIG.tokenMode === 'bearer' && data && data.token) {
      try { localStorage.setItem('token', data.token); } catch (e) {}
    }
    location.assign(nextPath());
  }

  var IDENTIFIER = CONFIG.loginVariant === 'username'
    ? '<p><label for="username">Username</label> <input id="username" name="username" type="text" autocomplete="username" required></p>'
    : '<p><label for="email">Email</label> <input id="email" name="email" type="email" autocomplete="username" required></p>';

  var SIGN_UP =
    '<section aria-labelledby="signup-heading"><h2 id="signup-heading">New here? Create an account</h2>' +
    '<form id="signup-form" aria-labelledby="signup-heading">' +
    '<p><label for="signup-email">Your email</label> <input id="signup-email" name="email" type="email" autocomplete="email"></p>' +
    '<p><label for="signup-password">Choose a password</label> <input id="signup-password" name="password" type="password" autocomplete="new-password"></p>' +
    '<p><label for="signup-confirm">Confirm password</label> <input id="signup-confirm" name="confirm" type="password" autocomplete="new-password"></p>' +
    '<button type="submit">Create account</button>' +
    '<div role="alert" id="signup-error" hidden></div>' +
    '</form></section>';

  function renderLogin() {
    document.title = 'Sign in · Notes';
    app.innerHTML = '<main><h1>Sign in</h1>' +
      (CONFIG.loginVariant === 'two-password' ? SIGN_UP : '') +
      '<form id="signin-form" aria-label="Sign in">' + IDENTIFIER +
      '<p><label for="password">Password</label> <input id="password" name="password" type="password" autocomplete="current-password" required></p>' +
      '<button type="submit">Sign in</button>' +
      '<div role="alert" id="signin-error" hidden></div>' +
      '</form></main>';

    var form = el('signin-form');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var error = el('signin-error');
      clearError(error);
      var identifier = form.querySelector('[autocomplete=username]');
      var body = { password: el('password').value };
      body[identifier.name] = identifier.value;
      api('POST', '/api/login', body).then(function (r) {
        if (r.status === 200 && r.data && r.data.verify) return showVerify(form, r.data.challenge);
        if (r.status === 200) return signedIn(r.data);
        showError(error, (r.data && r.data.error) || 'Sign-in failed');
      }, function () { showError(error, 'Could not reach the server'); });
    });

    var signup = el('signup-form');
    if (signup) {
      signup.addEventListener('submit', function (e) {
        e.preventDefault();
        api('POST', '/api/signup', { email: el('signup-email').value }).then(function (r) {
          showError(el('signup-error'), (r.data && r.data.error) || 'Sign-up failed');
        });
      });
    }
  }

  function showVerify(form, challenge) {
    form.hidden = true;
    var verify = document.createElement('form');
    verify.id = 'verify-form';
    verify.setAttribute('aria-label', 'Verification');
    verify.innerHTML = '<p>We sent a 6-digit code to your email.</p>' +
      '<p><label for="code">Verification code</label> <input id="code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" required></p>' +
      '<button type="submit">Verify</button>' +
      '<div role="alert" id="verify-error" hidden></div>';
    form.parentNode.appendChild(verify);
    verify.addEventListener('submit', function (e) {
      e.preventDefault();
      clearError(el('verify-error'));
      api('POST', '/api/login/verify', { challenge: challenge, code: el('code').value }).then(function (r) {
        if (r.status === 200) return signedIn(r.data);
        showError(el('verify-error'), (r.data && r.data.error) || 'Verification failed');
      });
    });
    el('code').focus();
  }

  var HEADER =
    '<header><nav aria-label="Main"><a href="/notes">Notes</a> <a href="/settings">Settings</a> <a href="/help">Help</a></nav> ' +
    '<button type="button" id="logout">Log out</button></header>';

  function renderShell(title, inner) {
    document.title = title + ' · Notes';
    app.innerHTML = HEADER + '<main>' + inner + '</main>';
    el('logout').addEventListener('click', function () {
      api('POST', '/api/logout').then(function () {
        try { localStorage.removeItem('token'); } catch (e) {}
        location.assign('/login');
      });
    });
  }

  var NOTE_FORM =
    '<section aria-labelledby="note-heading"><h2 id="note-heading">New note</h2>' +
    '<form id="note-form" aria-labelledby="note-heading">' +
    '<p><label for="title">Title</label> <input id="title" name="title" required></p>' +
    '<p><label for="body">Body</label> <textarea id="body" name="body"></textarea></p>' +
    '<button type="submit">Save note</button>' +
    '<p role="status" id="note-status"></p>' +
    '<p role="alert" id="note-error" hidden></p>' +
    '</form></section>';

  var NOTE_LIST = '<section aria-labelledby="list-heading"><h2 id="list-heading">Saved notes</h2><ul id="notes-list"></ul></section>';

  var PROFILE_FORM =
    '<section aria-labelledby="profile-heading"><h2 id="profile-heading">Profile</h2>' +
    '<form id="profile-form" aria-labelledby="profile-heading">' +
    '<p><label for="displayName">Display name</label> <input id="displayName" name="displayName"></p>' +
    '<p><label for="bio">Bio</label> <textarea id="bio" name="bio"></textarea></p>' +
    '<button type="submit">Save profile</button>' +
    '<p role="status" id="profile-status"></p>' +
    '<p role="alert" id="profile-error" hidden></p>' +
    '</form></section>';

  function loadNotes() {
    return api('GET', '/api/notes').then(function (r) {
      var list = el('notes-list');
      if (!list) return;
      list.textContent = '';
      var notes = (r.status === 200 && r.data && r.data.notes) || [];
      if (!notes.length) {
        var empty = document.createElement('li');
        empty.textContent = 'No notes yet';
        list.appendChild(empty);
        return;
      }
      notes.forEach(function (note) {
        var li = document.createElement('li');
        var title = document.createElement('strong');
        title.textContent = note.title;
        var body = document.createElement('p');
        body.textContent = note.body;
        li.appendChild(title);
        li.appendChild(body);
        list.appendChild(li);
      });
    });
  }

  function wireNoteForm() {
    var form = el('note-form');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      el('note-status').textContent = '';
      clearError(el('note-error'));
      api('POST', '/api/notes', { title: el('title').value, body: el('body').value }).then(function (r) {
        if (r.status === 201) {
          form.reset();
          el('note-status').textContent = 'Note saved';
          return loadNotes();
        }
        showError(el('note-error'), 'Could not save the note: ' + ((r.data && r.data.error) || r.status));
      });
    });
  }

  function wireProfile(me) {
    var path = '/api/users/' + encodeURIComponent(me.id) + '/profile';
    api('GET', path).then(function (r) {
      if (r.status !== 200 || !r.data) return;
      el('displayName').value = r.data.displayName || '';
      el('bio').value = r.data.bio || '';
    });
    el('profile-form').addEventListener('submit', function (e) {
      e.preventDefault();
      el('profile-status').textContent = '';
      clearError(el('profile-error'));
      api('PUT', path, { displayName: el('displayName').value, bio: el('bio').value }).then(function (r) {
        if (r.status === 200) { el('profile-status').textContent = 'Profile saved'; return; }
        showError(el('profile-error'), 'Could not save the profile: ' + ((r.data && r.data.error) || r.status));
      });
    });
  }

  var VIEWS = {
    '/notes': function (me) {
      renderShell('Your notes', '<h1>Your notes</h1>' + NOTE_FORM + NOTE_LIST + PROFILE_FORM);
      wireNoteForm();
      loadNotes();
      wireProfile(me);
    },
    '/profile': function (me) {
      renderShell('Profile', '<h1>Your profile</h1>' + PROFILE_FORM);
      wireProfile(me);
    },
    '/settings': function (me) {
      renderShell('Settings', '<h1>Settings</h1><p>Signed in as <span id="me-email"></span></p>');
      el('me-email').textContent = me.email;
    },
    '/help': function () {
      renderShell('Help', '<h1>Help</h1><p>Write a note on the Notes page; it is saved to your account.</p>');
    }
  };

  function route() {
    var path = location.pathname;
    if (path === '/login') return renderLogin();
    var view = VIEWS[path];
    if (!view) {
      document.title = 'Page not found · Notes';
      app.innerHTML = '<main><h1>Page not found</h1></main>';
      return;
    }
    api('GET', '/api/me').then(function (r) {
      if (r.status !== 200 || !r.data) { location.replace('/login?next=' + path); return; }
      view(r.data);
    });
  }

  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var link = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!link || link.target || link.hasAttribute('download')) return;
    var dest = new URL(link.href, location.href);
    if (dest.origin !== location.origin) return;
    e.preventDefault();
    if (dest.pathname + dest.search !== location.pathname + location.search) {
      history.pushState(null, '', dest.pathname + dest.search + dest.hash);
    }
    route();
  });
  window.addEventListener('popstate', route);
  route();
})();`;

function shell(options: Required<AccountsAppOptions>): string {
  const config = JSON.stringify({ tokenMode: options.tokenMode, loginVariant: options.loginVariant });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Notes</title></head>
<body><div id="app"></div>
<script>window.__APP__ = ${config};</script>
<script>${CLIENT}</script>
</body></html>`;
}

/** Starts one accounts app on a free port. See the header comment for the whole contract. */
export async function startAccountsApp(input: AccountsAppOptions = {}): Promise<AccountsApp> {
  const options: Required<AccountsAppOptions> = {
    tokenMode: input.tokenMode ?? "cookie",
    loginVariant: input.loginVariant ?? "email",
    idor: input.idor ?? false,
    listLeak: input.listLeak ?? false,
    noAuth: input.noAuth ?? false,
    massAssign: input.massAssign ?? false,
    deepLink404: input.deepLink404 ?? false,
  };
  const users = { alice: { ...USERS.alice }, bob: { ...USERS.bob } };
  const byId = new Map<string, AppUser>([
    [users.alice.id, users.alice],
    [users.bob.id, users.bob],
  ]);
  const page = shell(options);

  // Mutable state (reset() restores notes, profiles and challenges).
  let notes: Note[] = [];
  let profiles = new Map<string, ProfileRecord>();
  let nextNote = 0;
  const challenges = new Map<string, string>();
  const sessions = new Map<string, string>(); // token -> user id

  const restore = () => {
    notes = SEED_NOTES.map((n) => ({ ...n }));
    profiles = new Map([
      [users.alice.id, seedProfile(users.alice)],
      [users.bob.id, seedProfile(users.bob)],
    ]);
    nextNote = SEED_NOTES.length + 1;
    challenges.clear();
  };
  restore();

  const newSession = (user: AppUser): string => {
    const token = randomBytes(24).toString("hex");
    sessions.set(token, user.id);
    return token;
  };

  const tokenOf = (req: RecordedRequest): string | null => {
    if (options.tokenMode === "cookie") {
      const cookie = req.headers.cookie;
      return cookieValue(Array.isArray(cookie) ? cookie.join("; ") : cookie, "sid");
    }
    const auth = req.headers.authorization;
    const match = typeof auth === "string" ? /^Bearer\s+(\S+)$/i.exec(auth.trim()) : null;
    return match?.[1] ?? null;
  };

  const sessionUser = (req: RecordedRequest): AppUser | null => {
    const token = tokenOf(req);
    const id = token ? sessions.get(token) : undefined;
    return (id && byId.get(id)) || null;
  };

  /** The user a data endpoint serves: the session's, else alice under noAuth. */
  const dataUser = (req: RecordedRequest): AppUser | null => sessionUser(req) ?? (options.noAuth ? users.alice : null);

  const signInResponse = (res: ServerResponse, user: AppUser) => {
    const token = newSession(user);
    const summary = { id: user.id, name: user.name, email: user.email };
    if (options.tokenMode === "bearer") return send(res, 200, { token, user: summary });
    return send(res, 200, { user: summary }, { "set-cookie": `sid=${token}; Path=/; HttpOnly; SameSite=Lax` });
  };

  const unauthorized = (res: ServerResponse) => send(res, 401, { error: "Sign in first" });
  const notFound = (res: ServerResponse) => send(res, 404, { error: "Not found" });

  const handleApi = (req: RecordedRequest, res: ServerResponse, path: string): void => {
    const method = req.method.toUpperCase();

    if (path === "/api/login" && method === "POST") {
      const body = parseObject(req.body);
      if (!body) return send(res, 400, { error: "Send JSON: { email, password }" });
      const identifier = typeof body.email === "string" ? body.email : typeof body.username === "string" ? body.username : "";
      const password = typeof body.password === "string" ? body.password : "";
      const byUsername = options.loginVariant === "username";
      const user = [users.alice, users.bob].find((u) => (byUsername ? u.username : u.email) === identifier.trim());
      if (!user || user.password !== password) {
        return send(res, 401, { error: byUsername ? "Username or password is incorrect" : "Email or password is incorrect" });
      }
      if (options.loginVariant === "otp") {
        const challenge = randomBytes(12).toString("hex");
        challenges.set(challenge, user.id);
        return send(res, 200, { verify: true, challenge });
      }
      return signInResponse(res, user);
    }

    if (path === "/api/login/verify" && method === "POST") {
      const body = parseObject(req.body) ?? {};
      const userId = typeof body.challenge === "string" ? challenges.get(body.challenge) : undefined;
      const user = userId ? byId.get(userId) : undefined;
      if (!user || body.code !== OTP_CODE) return send(res, 401, { error: "That code is not right" });
      challenges.delete(body.challenge as string);
      return signInResponse(res, user);
    }

    if (path === "/api/signup" && method === "POST") {
      return send(res, 403, { error: "New accounts are closed. Sign in instead." });
    }

    if (path === "/api/logout" && method === "POST") {
      const token = tokenOf(req);
      if (token) sessions.delete(token);
      res.writeHead(204, options.tokenMode === "cookie" ? { "set-cookie": "sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0" } : {});
      return void res.end();
    }

    if (path === "/api/me" && method === "GET") {
      const user = sessionUser(req);
      if (!user) return unauthorized(res);
      return send(res, 200, { id: user.id, name: user.name, email: user.email, username: user.username });
    }

    if (path === "/api/notes" && (method === "GET" || method === "POST")) {
      const user = dataUser(req);
      if (!user) return unauthorized(res);
      if (method === "GET") {
        const visible = options.listLeak ? notes : notes.filter((n) => n.ownerId === user.id);
        return send(res, 200, { notes: visible.map((n) => ({ ...n })) });
      }
      const body = parseObject(req.body);
      if (!body) return send(res, 400, { error: "Send JSON: { title, body }" });
      const title = typeof body.title === "string" ? body.title.trim() : "";
      if (!title) return send(res, 400, { error: "Title is required" });
      const note: Note = { id: `n${nextNote++}`, ownerId: user.id, title, body: typeof body.body === "string" ? body.body : "" };
      notes.push(note);
      return send(res, 201, { note: { ...note } });
    }

    const profileMatch = /^\/api\/users\/([^/]+)\/profile$/.exec(path);
    if (profileMatch && (method === "GET" || method === "PUT")) {
      const user = dataUser(req);
      if (!user) return unauthorized(res);
      const id = decodeURIComponent(profileMatch[1]!);
      const record = profiles.get(id);
      const allowed = id === user.id || (method === "GET" && options.idor);
      if (!record || !allowed) return notFound(res);
      if (method === "GET") return send(res, 200, { ...record });
      const body = parseObject(req.body);
      if (!body) return send(res, 400, { error: "Send JSON: { displayName, bio }" });
      if (options.massAssign) {
        for (const [key, value] of Object.entries(body)) if (key !== "id") record[key] = value;
      } else {
        if (typeof body.displayName === "string") record.displayName = body.displayName;
        if (typeof body.bio === "string") record.bio = body.bio;
      }
      return send(res, 200, { ...record });
    }

    return notFound(res);
  };

  const server = await startFixtureServer({
    fallback: (req, res) => {
      const path = new URL(req.url, "http://x").pathname;
      if (path.startsWith("/api/")) return handleApi(req, res, path);
      const method = req.method.toUpperCase();
      if (method !== "GET" && method !== "HEAD") return html(res, 405, NOT_FOUND_PAGE.replace("404 Not Found", "405 Method Not Allowed"));
      if (path === "/") {
        res.writeHead(302, { location: "/notes" });
        return void res.end();
      }
      if (path === "/favicon.ico") {
        res.writeHead(204);
        return void res.end();
      }
      if (path === "/settings" && options.deepLink404) return html(res, 404, NOT_FOUND_PAGE);
      if (path === "/login" || SIGNED_IN_PAGES.has(path)) return html(res, 200, page);
      return html(res, 404, NOT_FOUND_PAGE);
    },
  });

  const url = server.url;
  const port = Number(new URL(url).port);
  const userOf = (key: UserKey): AppUser => users[key];

  const account = (id: AccountId, user?: UserKey): TestAccount => {
    const u = userOf(user ?? (id === "a" ? "alice" : "bob"));
    return {
      id,
      label: id === "a" ? "Account A" : "Account B",
      loginUrl: `${url}/login`,
      username: options.loginVariant === "username" ? u.username : u.email,
      password: u.password,
    };
  };

  return {
    url,
    loginUrl: `${url}/login`,
    port,
    options,
    users,
    requests: server.requests,
    stop: () => server.close(),
    reset: () => {
      restore();
      server.requests.length = 0;
    },
    authHeaders: (user): Record<string, string> => {
      const token = newSession(userOf(user));
      if (options.tokenMode === "cookie") return { cookie: `sid=${token}` };
      return { authorization: `Bearer ${token}` };
    },
    storageState: (user) => {
      const token = newSession(userOf(user));
      if (options.tokenMode === "bearer") {
        return { cookies: [], origins: [{ origin: url, localStorage: [{ name: "token", value: token }] }] };
      }
      return {
        cookies: [{ name: "sid", value: token, domain: "127.0.0.1", path: "/", expires: -1, httpOnly: true, secure: false, sameSite: "Lax" }],
        origins: [],
      };
    },
    account,
    accountsConfig: (opts = {}) => ({ isolated: opts.isolated ?? true, accounts: { a: account("a"), b: account("b") } }),
    notes: () => notes.map((n) => ({ ...n })),
    profile: (user) => ({ ...profiles.get(userOf(user).id)! }),
    activeSessions: (user) => {
      const id = user ? userOf(user).id : null;
      let n = 0;
      for (const owner of sessions.values()) if (id === null || owner === id) n++;
      return n;
    },
    signOutEveryone: () => sessions.clear(),
  };
}
