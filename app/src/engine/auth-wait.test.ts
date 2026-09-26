/**
 * signIn waits for a settled outcome after submitting (CI failure on PR #4): a page that briefly hides its form, or
 * changes its address, while the sign-in is still going must not end the wait early and be judged "still shown".
 * And when sign-in does fail with the form still shown, the message says what the page did: whether a request was
 * sent after submitting, and what it answered.
 */
import type { Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeBrowser, getBrowser } from "../../test-support/harness.js";
import { json, startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import type { TestAccount } from "../accounts/types.js";
import { signIn, SignInError } from "./auth.js";

const EMAIL = "someone@example.test";
const PASSWORD = "kettle-lantern-7";

let browser: Browser;
let server: FixtureServer;

const shell = (title: string, body: string) => `<!doctype html><html lang="en"><head><title>${title}</title></head><body><main>${body}</main></body></html>`;
const form = (id: string) => `<form id="${id}" aria-label="Sign in"><label for="${id}-email">Email</label><input id="${id}-email" type="email" name="email" autocomplete="username">
<label for="${id}-pass">Password</label><input id="${id}-pass" type="password" name="password" autocomplete="current-password"><button type="submit">Sign in</button></form>`;

beforeAll(async () => {
  browser = await getBrowser();
  server = await startFixtureServer({
    pages: {
      // Signs in, then hides the form for a moment (a session check with a spinner), shows it again, puts a hash on
      // the address, and only then goes to /home, 1.5 s after the click.
      "/flicker": shell(
        "Sign in",
        `${form("f")}<p id="busy" hidden>Checking your session…</p>
<script>
var f = document.getElementById("f");
f.addEventListener("submit", function (e) {
  e.preventDefault();
  fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: f.email.value, password: f.password.value }) })
    .then(function (r) {
      if (!r.ok) return;
      f.hidden = true; document.getElementById("busy").hidden = false;
      setTimeout(function () { f.hidden = false; document.getElementById("busy").hidden = true; location.hash = "checked"; }, 300);
      setTimeout(function () { location.assign("/home"); }, 1500);
    });
});
</script>`,
      ),
      // The sign-in request succeeds, but the page never moves on or hides its form.
      "/stuck": shell(
        "Sign in",
        `${form("s")}<script>
var s = document.getElementById("s");
s.addEventListener("submit", function (e) {
  e.preventDefault();
  fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: s.email.value, password: s.password.value }) });
});
</script>`,
      ),
      // Submitting does nothing at all: no request leaves the page.
      "/inert": shell("Sign in", `${form("n")}<script>document.getElementById("n").addEventListener("submit", function (e) { e.preventDefault(); });</script>`),
      "/home": shell("Home", `<h1>Home</h1><p>Signed in.</p>`),
    },
    routes: {
      "POST /api/login": (req, res) => {
        const body = JSON.parse(req.body || "{}") as { email?: string; password?: string };
        if (body.email === EMAIL && body.password === PASSWORD) {
          res.setHeader("set-cookie", "sid=s3ss10n-0f-7h3-t3st; Path=/; HttpOnly; SameSite=Lax");
          return json(res, 200, { ok: true });
        }
        return json(res, 401, { error: "Email or password is incorrect" });
      },
    },
  });
});

afterAll(async () => {
  await server?.close();
  await closeBrowser();
});

const account = (path: string): TestAccount => ({ id: "a", label: "Account A", loginUrl: `${server.url}${path}`, username: EMAIL, password: PASSWORD });

describe("signIn waits for a settled outcome", () => {
  it("a form that hides for a moment and an address that changes while signing in don't end the wait early", async () => {
    const signedIn = await signIn(browser, account("/flicker"));
    expect(signedIn.landedOn).toMatch(/\/home$/);
  });
});

describe("signIn says what the page did when the form is still shown", () => {
  it("names the sign-in request and its answer when the request succeeded but the page kept the form", async () => {
    const err = await signIn(browser, account("/stuck")).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(SignInError);
    const message = (err as Error).message;
    expect(message).toMatch(/still shown/i);
    expect(message).toMatch(/POST \/api\/login/);
    expect(message).toMatch(/\b200\b/);
    expect(message).not.toContain(PASSWORD);
  });

  it("says no request was sent when submitting did nothing", async () => {
    const err = await signIn(browser, account("/inert")).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(SignInError);
    expect((err as Error).message).toMatch(/no request/i);
  });
});
