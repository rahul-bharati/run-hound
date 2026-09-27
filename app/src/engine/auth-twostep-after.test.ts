/**
 * signIn on two-step sign-in pages (0.6.0, docs/v2-spec.md "Sign-in: two-step and sessionStorage") that ask for more
 * after the password step: codes and captchas aren't supported, so signing in fails with their messages ("Signing in"
 * step 6) instead of being judged a success because the password field went away.
 * - a code on the next page, on the sign-in origin (autocomplete=one-time-code);
 * - a captcha challenge that replaces the password step at the same address (the password field is gone);
 * - a password step whose answer asks for a captcha, with the password field still shown and the page's message.
 * The password is typed and sent once, to the password step's own request, and nothing is typed into the code field.
 */
import type { Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeBrowser, getBrowser } from "../../test-support/harness.js";
import { json, startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import type { TestAccount } from "../accounts/types.js";
import { signIn, SignInError, type SignedIn } from "./auth.js";

const EMAIL = "someone@example.test";
const PASSWORD = "after-step(pw)~4821";

let browser: Browser;
let server: FixtureServer;

const shell = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body><main>${body}</main></body></html>`;

/**
 * A two-step sign-in form: the email and Continue; the first submit shows the password row, the second posts both to
 * `endpoint` as JSON and calls `then(response body)` in the page when it answers 2xx, or shows its error otherwise.
 */
function twoStep(endpoint: string, then: string): string {
  return shell(
    "Sign in",
    `<h1>Sign in</h1>
<form id="signin" aria-label="Sign in">
<label for="li-email">Email</label><input id="li-email" type="email" name="email" autocomplete="username">
<p id="li-pass-row" hidden><label for="li-pass">Password</label><input id="li-pass" type="password" name="password" autocomplete="current-password"></p>
<button type="submit">Continue</button><p role="alert" id="li-error" hidden></p></form>
<script>
var form = document.getElementById("signin"), first = true;
function typed(field) { fetch("/api/typed?field=" + field); }
document.getElementById("li-pass").addEventListener("input", function () { typed("li-pass"); });
form.addEventListener("submit", function (e) {
  e.preventDefault();
  if (first) { first = false; document.getElementById("li-pass-row").hidden = false; document.getElementById("li-pass").focus(); return; }
  fetch(${JSON.stringify(endpoint)}, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: document.getElementById("li-email").value, password: document.getElementById("li-pass").value }) })
    .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
    .then(function (a) {
      if (!a.ok) { var el = document.getElementById("li-error"); el.textContent = a.d.error; el.hidden = false; return; }
      (${then})(a.d);
    });
});
</script>`,
  );
}

/** A reCAPTCHA-style widget (what showsCaptcha recognises): its container, with a site key. */
const WIDGET = `var w = document.createElement("div"); w.className = "g-recaptcha"; w.setAttribute("data-sitekey", "test-site-key"); w.style.cssText = "width:304px;height:78px;border:1px solid #ccc";`;

beforeAll(async () => {
  browser = await getBrowser();
  server = await startFixtureServer({
    pages: {
      // The password step's POST answers { next: "/verify" }; the next page asks for a code.
      "/code-next": twoStep("/api/login-code", `function (d) { location.assign(d.next); }`),
      "/verify": shell(
        "Verify it's you",
        `<h1>Verify it's you</h1><form id="code" aria-label="Verification"><label for="otp">Verification code</label>
<input id="otp" name="code" inputmode="numeric" autocomplete="one-time-code"><button type="submit">Verify</button></form>
<script>document.getElementById("otp").addEventListener("input", function () { fetch("/api/typed?field=otp"); });</script>`,
      ),
      // The password step's POST answers { challenge: true }; the page swaps the form for a captcha challenge at the
      // same address: the password field is gone, and nobody is signed in.
      "/captcha-instead": twoStep(
        "/api/login-challenge",
        `function () { form.hidden = true; ${WIDGET} var p = document.createElement("p"); p.textContent = "Confirm you're not a robot to continue."; document.querySelector("main").append(p, w); }`,
      ),
      // The password step's POST answers 400 "Complete the captcha", and the page shows that beside the password.
      "/captcha-beside": twoStep("/api/login-captcha", `function () {}`),
      "/home": shell("Home", "<h1>Home</h1><p>Signed in.</p>"),
    },
    routes: {
      "POST /api/login-code": (req, res) => {
        const body = JSON.parse(req.body || "{}") as { email?: string; password?: string };
        if (body.email !== EMAIL || body.password !== PASSWORD) return json(res, 401, { error: "Email or password is incorrect" });
        json(res, 200, { next: "/verify" });
      },
      "POST /api/login-challenge": (req, res) => {
        const body = JSON.parse(req.body || "{}") as { email?: string; password?: string };
        if (body.email !== EMAIL || body.password !== PASSWORD) return json(res, 401, { error: "Email or password is incorrect" });
        json(res, 200, { challenge: true });
      },
      "POST /api/login-captcha": (_req, res) => json(res, 400, { error: "Complete the captcha" }),
      "GET /api/typed": (_req, res) => {
        res.writeHead(204);
        res.end();
      },
      "GET /favicon.ico": (_req, res) => {
        res.writeHead(204);
        res.end();
      },
    },
  });
});

afterAll(async () => {
  await closeBrowser();
  await server?.close();
});

const account = (path: string): TestAccount => ({ id: "a", label: "Account A", loginUrl: `${server.url}${path}`, username: EMAIL, password: PASSWORD });

/** The error signIn rejected with; fails the test when it resolved or threw anything but a SignInError. */
async function failure(promise: Promise<SignedIn>): Promise<SignInError> {
  const outcome = await promise.then(
    () => "resolved" as const,
    (err: unknown) => err,
  );
  expect(outcome, "signIn should have rejected with a SignInError").toBeInstanceOf(SignInError);
  return outcome as SignInError;
}

/** The fields the page reported typing into, in order. */
const typed = () => server.requests.filter((r) => r.url.startsWith("/api/typed?")).map((r) => new URL(r.url, "http://x").searchParams.get("field"));
/** Requests whose body carries the password, as "<method> <path>". */
const carrying = () => server.requests.filter((r) => r.body.includes(PASSWORD) || r.url.includes(encodeURIComponent(PASSWORD))).map((r) => `${r.method} ${r.url}`);

describe("the pages by hand (so the signIn tests below fail only for signIn's reasons)", () => {
  it("each page asks for the email, then the password, then shows what its test expects", async () => {
    const page = await browser.newPage();
    try {
      for (const path of ["/code-next", "/captcha-instead", "/captcha-beside"]) {
        await page.goto(`${server.url}${path}`);
        expect(await page.locator("input[type=password]:visible").count(), path).toBe(0);
        await page.locator("#li-email").fill(EMAIL);
        await page.getByRole("button", { name: "Continue" }).click();
        await page.locator("#li-pass:visible").fill(PASSWORD);
        await page.getByRole("button", { name: "Continue" }).click();
        if (path === "/code-next") {
          await page.waitForURL((url) => url.pathname === "/verify");
          await page.locator("#otp:visible").waitFor();
        } else if (path === "/captcha-instead") {
          await page.locator(".g-recaptcha").waitFor();
          expect(await page.locator("input[type=password]:visible").count()).toBe(0);
          expect(new URL(page.url()).pathname).toBe(path);
        } else {
          await page.getByText("Complete the captcha").waitFor();
          expect(await page.locator("#li-pass:visible").count()).toBe(1);
        }
      }
    } finally {
      await page.close();
    }
  });
});

describe("signIn: a two-step sign-in that asks for more after the password step", () => {
  it("a code on the next page: says codes aren't supported, and nothing is typed into the code field", async () => {
    server.requests.length = 0;
    const err = await failure(signIn(browser, account("/code-next")));
    expect(err.message).toMatch(/code/i);
    expect(err.message).toMatch(/support/i);
    expect(err.message).not.toContain(PASSWORD);
    expect(typed()).toContain("li-pass");
    expect(typed()).not.toContain("otp");
    expect(carrying()).toEqual(["POST /api/login-code"]);
  });

  it("a captcha challenge that replaces the password step at the same address: says captchas aren't supported", async () => {
    server.requests.length = 0;
    const err = await failure(signIn(browser, account("/captcha-instead")));
    expect(err.message).toMatch(/captcha/i);
    expect(err.message).toMatch(/support/i);
    expect(err.message).not.toContain(PASSWORD);
    expect(carrying()).toEqual(["POST /api/login-challenge"]);
  });

  it("a password step whose answer asks for a captcha (the password field stays): fails and quotes the page", async () => {
    server.requests.length = 0;
    const err = await failure(signIn(browser, account("/captcha-beside")));
    expect(err.message).not.toContain(PASSWORD);
    expect(err.message).toContain("Complete the captcha");
    expect(carrying()).toEqual(["POST /api/login-captcha"]);
  });
});
