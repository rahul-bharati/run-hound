/**
 * Which session signIn reads when nothing of sessionStorage was sent as a credential and the submit set or changed no
 * cookie (0.6.0 release close-out, the rest of round 2's cookie-name item; docs/v2-spec.md "Sign-in: two-step and
 * sessionStorage").
 *
 * What went wrong: a cookie session was found either by a cookie the submit set or changed, or by its cookie's name
 * (SESSION_NAME: sess, sid, auth, token …). An app whose session cookie is set when the sign-in page loads and kept by
 * the submit (express-session with a custom `name` and no regenerate, a PHP app with its own session_name), under a
 * name that says nothing of a session ("app_user", "acme"), was still taken for a sessionStorage session: its
 * pages' cached reads were seeded into every context, and access-control skipped the IDOR a cookie-session run catches
 * ("Account A has no data on this page that Run Hound can recognise").
 *
 * The contract now: an HttpOnly cookie with a token-like value on the app's own site (the site of the sign-in page's or
 * the landing page's host: the same last two labels, api.example.com beside app.example.com, or the same IP address or
 * one-label host) is a cookie session too, whatever its name: no page script can set or read one, so it is the
 * server's session. Never a CSRF, analytics or bot-check cookie, nor a load balancer's or a
 * bot manager's (ARRAffinity, AWSALB, ak_bmsc, visid_incap_ …: NOT_SESSION_COOKIE), nor another site's cookie (a
 * reCAPTCHA iframe's _GRECAPTCHA on www.google.com). A cookie a page script set (not HttpOnly) still counts only by its
 * name.
 *
 * Close-out review, round 1: Cloudflare's load balancer cookie (__cflb, HttpOnly) and ASP.NET's antiforgery cookies
 * (ASP.NET Core's ".AspNetCore.Antiforgery.<id>", HttpOnly by default; ASP.NET MVC's "__RequestVerificationToken", whose
 * name said token) were taken for the session, so a sessionStorage session next to one wasn't seeded and the plan
 * failed with "still shows the sign-in page". Neither is ever the session now (NOT_SESSION_COOKIE).
 *
 * Close-out review, round 2: the same for Heroku's router cookie (heroku-session-affinity, HttpOnly, a name that says
 * session) and AWS WAF's challenge token (aws-waf-token, not HttpOnly, a name that says token).
 */
import { randomBytes } from "node:crypto";
import type { ServerResponse } from "node:http";
import type { Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeBrowser, getBrowser } from "../../test-support/harness.js";
import { json, startFixtureServer, type FixtureServer, type RecordedRequest } from "../../test-support/server.js";
import type { TestAccount } from "../accounts/types.js";
import { sessionInStorage, signIn, type SessionState, type SignedIn } from "./auth.js";

const ALICE = { email: "alice@example.test", password: "alice-pass-7Q2x", id: "u1", name: "Alice Example", ws: "3f2b8c1e-4d5a-4b6c-8e9f-0a1b2c3d4e5f" };

let browser: Browser;

const shell = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body><main>${body}</main></body></html>`;

function sendHtml(res: ServerResponse, body: string, headers: Record<string, string | string[]> = {}): void {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", ...headers });
  res.end(body);
}

const FORM_LOGIN = shell(
  "Sign in",
  `<h1>Sign in</h1><form method="post" action="/login" aria-label="Sign in">
<label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email">
<label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password">
<button type="submit">Sign in</button></form>`,
);

/** A sign-in form that posts JSON to /api/login and keeps the token in sessionStorage["app-state"], then goes to /app. */
const SCRIPT_LOGIN = shell(
  "Sign in",
  `<h1>Sign in</h1><form id="f" aria-label="Sign in"><label for="email">Email</label><input id="email" type="email" autocomplete="username">
<label for="password">Password</label><input id="password" type="password" autocomplete="current-password"><button type="submit">Sign in</button></form>
<script>
document.getElementById("f").addEventListener("submit", function (e) {
  e.preventDefault();
  fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: document.getElementById("email").value, password: document.getElementById("password").value }) })
    .then(function (r) { return r.json(); })
    .then(function (d) { sessionStorage.setItem("app-state", JSON.stringify({ v: d.token })); location.assign("/app"); });
});
</script>`,
);

const cookieOf = (req: RecordedRequest, name: string) => new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(String(req.headers.cookie ?? ""))?.[1];

/**
 * A cookie-session app whose session cookie `name` (HttpOnly) is set when the sign-in page loads, not yet signed in,
 * and signed in by the submit without being renewed. Its landing page caches GET /api/session and GET /api/users/<id>
 * in sessionStorage (cache-first) and keeps the workspace id there.
 */
async function keptCookieApp(name: string, session: Map<string, string>): Promise<FixtureServer> {
  return startFixtureServer({
    routes: {
      "GET /login": (req, res) => {
        if (cookieOf(req, name)) return sendHtml(res, FORM_LOGIN);
        const value = randomBytes(16).toString("hex");
        session.set(value, "");
        sendHtml(res, FORM_LOGIN, { "set-cookie": `${name}=${value}; Path=/; HttpOnly; SameSite=Lax` });
      },
      "POST /login": (req, res) => {
        const form = new URLSearchParams(req.body);
        const value = cookieOf(req, name);
        if (form.get("email") !== ALICE.email || form.get("password") !== ALICE.password || !value || !session.has(value)) {
          return sendHtml(res, shell("Sign in", `<p role="alert">Wrong email or password</p>`));
        }
        session.set(value, ALICE.email);
        res.writeHead(303, { location: `/app?workspace=${ALICE.ws}` });
        res.end();
      },
      "GET /app": (req, res) => {
        if (!session.get(cookieOf(req, name) ?? "")) {
          res.writeHead(303, { location: "/login" });
          res.end();
          return;
        }
        sendHtml(
          res,
          shell(
            "Profile",
            `<h1>Your profile</h1><p id="name">…</p><p id="done" hidden>ready</p>
<script>
async function cached(key, url) {
  var hit = sessionStorage.getItem(key);
  if (hit) return JSON.parse(hit);
  var data = await (await fetch(url)).json();
  sessionStorage.setItem(key, JSON.stringify(data));
  return data;
}
(async function () {
  var s = await cached("session", "/api/session");
  var me = await cached("user:" + s.userId, "/api/users/" + s.userId);
  document.getElementById("name").textContent = me.name;
  sessionStorage.setItem("currentWorkspace", new URLSearchParams(location.search).get("workspace"));
  document.getElementById("done").hidden = false;
})();
</script>`,
          ),
        );
      },
      "GET /api/session": (req, res) => {
        if (!session.get(cookieOf(req, name) ?? "")) return json(res, 401, { error: "Sign in" });
        json(res, 200, { userId: ALICE.id, workspaceId: ALICE.ws });
      },
      "GET /favicon.ico": (_req, res) => {
        res.writeHead(204);
        res.end();
      },
    },
    fallback: (req, res) => {
      if (!session.get(cookieOf(req, name) ?? "")) return json(res, 401, { error: "Sign in" });
      if (/^\/api\/users\/[^/]+$/.test(new URL(req.url, "http://x").pathname)) return json(res, 200, { id: ALICE.id, email: ALICE.email, name: ALICE.name });
      json(res, 404, { error: "Not found" });
    },
  });
}

/**
 * A sessionStorage-session app that sends nothing with its token while signing in (its landing page reads nothing
 * until a click), whose sign-in page gets `cookie` (a Set-Cookie value) from the server as it loads.
 */
async function quietStorageApp(cookie: string, tokens: Map<string, string>): Promise<FixtureServer> {
  return startFixtureServer({
    routes: {
      "GET /login": (_req, res) => sendHtml(res, SCRIPT_LOGIN, { "set-cookie": cookie }),
      "POST /api/login": (req, res) => {
        const body = JSON.parse(req.body || "{}") as { email?: string; password?: string };
        if (body.email !== ALICE.email || body.password !== ALICE.password) return json(res, 401, { error: "Wrong email or password" });
        const token = `tk${randomBytes(20).toString("hex")}`;
        tokens.set(ALICE.email, token);
        json(res, 200, { token });
      },
      "GET /app": (_req, res) =>
        sendHtml(
          res,
          shell(
            "Home",
            `<h1 id="who">Home</h1><button type="button" id="load">Load my account</button>
<script>
var state = JSON.parse(sessionStorage.getItem("app-state") || "null");
if (!state) location.replace("/login");
</script>`,
          ),
        ),
      "GET /favicon.ico": (_req, res) => {
        res.writeHead(204);
        res.end();
      },
    },
  });
}

const account = (app: FixtureServer): TestAccount => ({ id: "a", label: "Account A", loginUrl: `${app.url}/login`, username: ALICE.email, password: ALICE.password });

/** Every string a SignedIn's sessionStorage holds: its whole values, and the strings of the JSON they hold. */
function storedStrings(entries: NonNullable<SignedIn["sessionStorage"]>): string[] {
  const out: string[] = [];
  for (const { value } of entries.flatMap((e) => e.items)) {
    out.push(value);
    try {
      JSON.parse(value, (_key, v: unknown) => {
        if (typeof v === "string") out.push(v);
        return v;
      });
    } catch {
      // Not JSON.
    }
  }
  return out;
}

const apps: FixtureServer[] = [];

beforeAll(async () => {
  browser = await getBrowser();
});

afterAll(async () => {
  await Promise.all(apps.map((app) => app.close()));
  await closeBrowser();
});

describe("signIn: an HttpOnly session cookie whose name says nothing, set when the sign-in page loads and kept by the submit", () => {
  for (const name of ["app_user", "acme"]) {
    it(`${name}: returns no sessionStorage (nothing is seeded), and registers the cookie, not the workspace id`, async () => {
      const session = new Map<string, string>();
      const app = await keptCookieApp(name, session);
      apps.push(app);
      const result = await signIn(browser, account(app));
      expect(new URL(result.landedOn).pathname).toBe("/app");
      expect(result.state.cookies.map((c) => c.name)).toEqual([name]);
      expect(result.sessionStorage, `SignedIn.sessionStorage of a cookie-session app (${name}, kept by the submit)`).toBeUndefined();
      const value = [...session.entries()].find(([, email]) => email === ALICE.email)?.[0];
      expect(value).toBeDefined();
      expect(result.secrets).toContain(value);
      expect(result.secrets).not.toContain(ALICE.ws);
    });
  }
});

describe("signIn: a sessionStorage session with nothing sent with it while signing in, next to a cookie that isn't a session", () => {
  const cases: [string, (value: string) => string][] = [
    ["Azure App Service's ARRAffinity (HttpOnly, a load balancer's)", (v) => `ARRAffinity=${v}${v}; Path=/; HttpOnly`],
    ["Cloudflare's load balancer cookie __cflb (HttpOnly)", (v) => `__cflb=${v}; Path=/; HttpOnly`],
    ["ASP.NET Core's antiforgery cookie (HttpOnly)", (v) => `.AspNetCore.Antiforgery.Xy12Ab=CfDJ8${v}; Path=/; HttpOnly; SameSite=Strict`],
    ["ASP.NET MVC's __RequestVerificationToken cookie (HttpOnly, a name that says token)", (v) => `__RequestVerificationToken=${v}; Path=/; HttpOnly`],
    ["Heroku's session-affinity cookie (HttpOnly, a name that says session)", (v) => `heroku-session-affinity=ACyDaANoA2gDZAAT${v}; Path=/; HttpOnly`],
    ["AWS WAF's challenge token (not HttpOnly, a name that says token)", (v) => `aws-waf-token=${v}:BgoAq${v}; Path=/`],
    ["a cookie with a random value a page script could have set (not HttpOnly)", (v) => `visitor=${v}; Path=/; SameSite=Lax`],
  ];
  for (const [what, cookie] of cases) {
    it(`${what}: returns the items and registers the token`, async () => {
      const tokens = new Map<string, string>();
      const app = await quietStorageApp(cookie(randomBytes(16).toString("hex")), tokens);
      apps.push(app);
      const result = await signIn(browser, account(app));
      expect(result.state.cookies).toHaveLength(1);
      expect(result.sessionStorage, "SignedIn.sessionStorage of a sessionStorage session").toBeDefined();
      const token = tokens.get(ALICE.email)!;
      expect(storedStrings(result.sessionStorage!)).toContain(token);
      expect(result.secrets).toContain(token);
    });
  }
});

describe("sessionInStorage: the fallback when nothing of sessionStorage was sent as a credential", () => {
  const HOSTS = ["app.example.com"];
  const kept: NonNullable<SignedIn["sessionStorage"]> = [{ origin: "https://app.example.com", items: [{ name: "app-state", value: JSON.stringify({ v: "tk0123456789abcdef0123456789" }) }] }];
  const cookie = (name: string, domain: string, httpOnly: boolean, value = "0123456789abcdef0123456789abcdef") => ({
    name,
    value,
    domain,
    path: "/",
    expires: -1,
    httpOnly,
    secure: true,
    sameSite: "Lax" as const,
  });
  const state = (...cookies: ReturnType<typeof cookie>[]): SessionState => ({ cookies, origins: [] });
  const none = new Set<string>();

  it("an HttpOnly token-like cookie of the app's own host or its parent domain, set before the password and kept: a cookie session", () => {
    const before = [cookie("acme", "app.example.com", true)];
    expect(sessionInStorage(state(...before), kept, none, before, HOSTS)).toBe(false);
    const parent = [cookie("acme", ".example.com", true)];
    expect(sessionInStorage(state(...parent), kept, none, parent, HOSTS)).toBe(false);
    // The app's API on a sibling host of the same site.
    const api = [cookie("acme", "api.example.com", true)];
    expect(sessionInStorage(state(...api), kept, none, api, HOSTS)).toBe(false);
  });

  it("another site's HttpOnly cookie (reCAPTCHA's _GRECAPTCHA on www.google.com): not a session", () => {
    const before = [cookie("_GRECAPTCHA", "www.google.com", true)];
    expect(sessionInStorage(state(...before), kept, none, before, HOSTS)).toBe(true);
  });

  it("a load balancer's or a bot manager's HttpOnly cookie on the app's host: not a session", () => {
    for (const name of ["ARRAffinity", "ARRAffinitySameSite", "AWSALB", "AWSALBCORS", "ak_bmsc", "visid_incap_123456", "incap_ses_123_456", "BIGipServerpool_web", "__cflb"]) {
      const before = [cookie(name, "app.example.com", true)];
      expect(sessionInStorage(state(...before), kept, none, before, HOSTS), name).toBe(true);
    }
  });

  it("Heroku's session-affinity cookie and AWS WAF's challenge token (names that say session or token): not a session, kept or set by the submit (close-out review, round 2)", () => {
    for (const [name, httpOnly] of [
      ["heroku-session-affinity", true],
      ["aws-waf-token", false],
    ] as const) {
      const before = [cookie(name, "app.example.com", httpOnly)];
      expect(sessionInStorage(state(...before), kept, none, before, HOSTS), `${name}, kept`).toBe(true);
      expect(sessionInStorage(state(...before), kept, none, [], HOSTS), `${name}, set by the submit`).toBe(true);
    }
  });

  it("an antiforgery cookie on the app's host (ASP.NET Core's, ASP.NET MVC's), set before the password or by the submit: not a session", () => {
    for (const name of [".AspNetCore.Antiforgery.Xy12Ab", "__RequestVerificationToken", "__RequestVerificationToken_L2FwcA2"]) {
      const before = [cookie(name, "app.example.com", true)];
      expect(sessionInStorage(state(...before), kept, none, before, HOSTS), `${name}, kept`).toBe(true);
      expect(sessionInStorage(state(...before), kept, none, [], HOSTS), `${name}, set by the submit`).toBe(true);
    }
  });

  it("a cookie a page script set (not HttpOnly) whose name says nothing: not a session; a value sent as a credential wins over any cookie", () => {
    const before = [cookie("visitor", "app.example.com", false)];
    expect(sessionInStorage(state(...before), kept, none, before, HOSTS)).toBe(true);
    const session = [cookie("acme", "app.example.com", true)];
    expect(sessionInStorage(state(...session), kept, new Set(["Bearer tk0123456789abcdef0123456789"]), session, HOSTS)).toBe(true);
  });
});
