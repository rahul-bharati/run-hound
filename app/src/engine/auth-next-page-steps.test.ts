/**
 * signIn fails with the contract's messages when the page the password led to asks for a verification code or a
 * captcha (0.6.0, round 2 of the release review; docs/v2-spec.md "Signing in" step 6: "the message says so when the
 * page shows a code or captcha field", and "Sign-in: two-step and sessionStorage": "a code or captcha after either step
 * fails with the existing messages").
 *
 * What went wrong: off the sign-in page's own address, a code step was recognised only by autocomplete=one-time-code,
 * and a captcha only at the same address. A code step at /verify with a field named "code", Devise's
 * user[otp_attempt] (autocomplete=off), an authenticator code after a two-step sign-in, and a Turnstile challenge page
 * each set only a pre-session cookie, had no password field, and were taken for a successful sign-in: the run went on
 * as a signed-in Account A that wasn't signed in.
 *
 * The contract now, on the page the password submit led to:
 * - a code step: its only field to fill in (a search box aside) says code, one-time, verification, two-factor, 2FA or
 *   authenticator in its name, id, label, placeholder or aria-label (a promo, coupon, gift, referral, invite, zip or
 *   postal code doesn't count);
 * - a captcha: a captcha widget shows (a reCAPTCHA v3 badge doesn't count) and the page has no other field to fill
 *   in: the challenge is all the page asks for.
 * A landing page with a promo-code field, or a captcha widget in a form next to other fields, is still a success.
 *
 * Round 3: a bare "code" no longer says it's a sign-in's code (a code explainer's "Code" textarea and a "Room code"
 * field on a signed-in page failed the sign-in): the field (an input, never a textarea) or the page's heading or title
 * must say one-time, verification, two-step, authenticator … A split code step swapped in at the sign-in page's own
 * address once the password field is gone fails too. A captcha widget alone counts only in a form whose submit moves
 * on, or under a heading or title that says it is a check (a signed-in page's widget outside any form is a success).
 */
import type { ServerResponse } from "node:http";
import type { Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeBrowser, getBrowser } from "../../test-support/harness.js";
import { startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import type { TestAccount } from "../accounts/types.js";
import { signIn, SignInError, type SignedIn } from "./auth.js";

const EMAIL = "someone@example.test";
const PASSWORD = "hunter2correcthorse91";

let browser: Browser;
let site: FixtureServer;

const shell = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body><main>${body}</main></body></html>`;

function sendHtml(res: ServerResponse, body: string): void {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(body);
}

/** A one-step sign-in form posting to `action`. */
const oneStep = (action: string) =>
  shell(
    "Sign in",
    `<h1>Sign in</h1><form method="post" action="${action}"><label for="e">Email</label><input id="e" name="email" type="email" autocomplete="username">
<label for="p">Password</label><input id="p" name="password" type="password" autocomplete="current-password"><button type="submit">Sign in</button></form>`,
  );

/** A code step split over six one-character boxes, swapped in at the sign-in page's own address (round 3). */
const SPLIT_STEP = `<h1>Two-step verification</h1><p>Enter the 6-digit code from your authenticator app.</p>
<form id="code" aria-label="Verify">${[1, 2, 3, 4, 5, 6].map((i) => `<input inputmode="numeric" maxlength="1" aria-label="Digit ${i}" style="width:2em">`).join("")}
<button type="submit">Verify</button></form>`;

/** The page each sign-in lands on (after `POST /session/<name>`), with a pre-session (or a session) cookie. */
const NEXT: Record<string, string> = {
  code: shell(
    "Verify",
    `<h1>Check your email</h1><p>We sent a 6-digit code to your email.</p><form method="post" action="/verify"><label for="c">Verification code</label><input id="c" name="code" inputmode="numeric"><button type="submit">Verify</button></form>`,
  ),
  devise: shell(
    "Two-factor authentication",
    `<h1>Two-factor authentication</h1><form method="post" action="/verify"><label for="otp">Two-factor authentication code</label><input id="otp" name="user[otp_attempt]" autocomplete="off" inputmode="numeric" maxlength="6"><button type="submit">Verify code</button></form>`,
  ),
  authenticator: shell(
    "Verify",
    `<h1>Two-factor authentication</h1><form method="post" action="/verify"><label for="c">Enter the code from your authenticator app</label><input id="c" name="token" inputmode="numeric"><button type="submit">Verify</button></form>`,
  ),
  turnstile: shell(
    "Verify",
    `<h1>One more step</h1><p>Please confirm you are human.</p><form method="post" action="/verify"><div class="cf-turnstile" data-sitekey="1x00000000000000000000AA" style="width:300px;height:65px"></div><button type="submit">Continue</button></form>`,
  ),
  // Round 3: a plain "Code" field is a code step when the page's heading says what code it is.
  plaincode: shell(
    "Sign in",
    `<h1>Two-step verification</h1><form method="post" action="/verify"><label for="c">Code</label><input id="c" name="code" inputmode="numeric"><button type="submit">Verify</button></form>`,
  ),
  // Round 3: a code split over six one-character boxes on the next page ("Digit 1" … "Digit 6").
  split: shell(
    "Verify",
    `<h1>Two-step verification</h1><p>Enter the 6-digit code from your authenticator app.</p><form method="post" action="/verify" aria-label="Verify">${[1, 2, 3, 4, 5, 6]
      .map((i) => `<input inputmode="numeric" maxlength="1" aria-label="Digit ${i}" style="width:2em">`)
      .join("")}<button type="submit">Verify</button></form>`,
  ),
  // Round 3: a challenge page with the widget outside any form, whose heading says so.
  human: shell(
    "Just a moment...",
    `<h1>Verify you are human</h1><p>This check keeps bots out.</p><div class="cf-turnstile" data-sitekey="1x00000000000000000000AA" style="width:300px;height:65px"></div>`,
  ),
  // Landing pages that are a success.
  // Round 3: a signed-in page whose only field is a "Code" textarea (a code explainer).
  explain: shell(
    "Explain code",
    `<h1>Explain some code</h1><form method="post" action="/app/explain"><label for="code">Code</label><textarea id="code" name="code"></textarea><button type="submit">Explain</button></form>`,
  ),
  // Round 3: a signed-in page whose only field is a "Room code" input.
  room: shell(
    "Rooms",
    `<h1>Join a room</h1><form method="post" action="/app/join"><label for="room">Room code</label><input id="room" name="room"><button type="submit">Join</button></form>`,
  ),
  // Round 3: a signed-in page with a Turnstile widget outside any form, and no field to fill in.
  credits: shell(
    "Credits",
    `<h1>Daily credits</h1><p>Claim today's free credits.</p><div class="cf-turnstile" data-sitekey="1x00000000000000000000AA" style="width:300px;height:65px;border:1px solid #ccc"></div><button type="button">Claim credits</button>`,
  ),
  promo: shell(
    "Billing",
    `<h1>Your plan</h1><p>Free plan, 3 projects.</p><form method="post" action="/redeem"><label for="pc">Promo code</label><input id="pc" name="code"><button type="submit">Apply</button></form>`,
  ),
  feedback: shell(
    "Your notes",
    `<h1>Your notes</h1><ul><li>First note</li></ul><form aria-label="Send feedback"><label for="fb">Feedback</label><textarea id="fb" name="fb"></textarea><div class="cf-turnstile" data-sitekey="0x4AAAAAAAexample" style="width:300px;height:65px"></div><button type="submit">Send</button></form>`,
  ),
  badge: shell(
    "Dashboard",
    `<h1>Dashboard</h1><p>3 open tasks.</p><div class="grecaptcha-badge" style="width:256px;height:60px;position:fixed;right:0;bottom:14px"><iframe title="reCAPTCHA" src="about:blank#recaptcha-anchor-size=invisible" width="256" height="60"></iframe></div>`,
  ),
  search: shell(
    "Dashboard",
    `<h1>Dashboard</h1><form role="search" action="/search"><label for="q">Search</label><input id="q" name="q" type="search"></form><p>3 open tasks. Verify your email address to invite teammates.</p>`,
  ),
};

/** The pre-session cookie a code or captcha step sets, and the session cookie a landing page's sign-in sets. */
const COOKIE: Record<string, string> = {
  code: "mfa_pending=pend1ngT0ken1234567890abc",
  devise: "_app_session=r0tatedPreSess10n1234567890",
  authenticator: "mfa_pending=pend1ngT0ken1234567890abc",
  turnstile: "mfa_pending=pend1ngT0ken1234567890abc",
  plaincode: "mfa_pending=pend1ngT0ken1234567890abc",
  split: "mfa_pending=pend1ngT0ken1234567890abc",
  human: "mfa_pending=pend1ngT0ken1234567890abc",
  explain: "sid=s3ss10nT0kenValue1234567890",
  room: "sid=s3ss10nT0kenValue1234567890",
  credits: "sid=s3ss10nT0kenValue1234567890",
  promo: "sid=s3ss10nT0kenValue1234567890",
  feedback: "sid=s3ss10nT0kenValue1234567890",
  badge: "sid=s3ss10nT0kenValue1234567890",
  search: "sid=s3ss10nT0kenValue1234567890",
};

beforeAll(async () => {
  browser = await getBrowser();
  const pages: Record<string, string> = {
    // Two-step: the email first, then the password page; its submit goes on to the authenticator code.
    "/login-twostep": shell(
      "Sign in",
      `<h1>Sign in</h1><form method="post" action="/login/identifier"><label for="e">Email</label><input id="e" name="email" type="email" autocomplete="username"><button type="submit">Continue</button></form>`,
    ),
    "/login/password": shell(
      "Sign in",
      `<h1>Sign in</h1><form method="post" action="/session/authenticator"><input type="hidden" name="email" value="${EMAIL}">
<label for="p">Password</label><input id="p" name="password" type="password" autocomplete="current-password"><button type="submit">Sign in</button></form>`,
    ),
  };
  // Round 3: a single-page sign-in that swaps a split code step in at its own address after the password.
  pages["/login-spa"] = shell(
    "Sign in",
    `<div id="root"><h1>Sign in</h1>
<form id="f" aria-label="Sign in"><label for="e">Email</label><input id="e" type="email" autocomplete="username">
<label for="p">Password</label><input id="p" type="password" autocomplete="current-password"><button type="submit">Sign in</button><p role="alert" id="err"></p></form></div>
<script>
document.getElementById("f").addEventListener("submit", function (e) {
  e.preventDefault();
  fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: document.getElementById("e").value, password: document.getElementById("p").value }) })
    .then(function (r) { return r.json().then(function (b) {
      if (!r.ok) { document.getElementById("err").textContent = b.error; return; }
      if (b.mfa) document.getElementById("root").innerHTML = ${JSON.stringify(SPLIT_STEP)};
    }); });
});
</script>`,
  );
  for (const name of Object.keys(NEXT)) {
    pages[`/login-${name}`] = oneStep(`/session/${name}`);
    pages[`/next/${name}`] = NEXT[name]!;
  }
  site = await startFixtureServer({
    pages,
    routes: {
      "POST /login/identifier": (_req, res) => {
        res.writeHead(303, { location: "/login/password" });
        res.end();
      },
      "POST /api/login": (req, res) => {
        const body = JSON.parse(req.body || "{}") as { email?: string; password?: string };
        const ok = body.email === EMAIL && body.password === PASSWORD;
        res.writeHead(ok ? 200 : 401, { "content-type": "application/json", ...(ok ? { "set-cookie": "mfa_pending=pend1ngT0ken1234567890abc; Path=/; HttpOnly" } : {}) });
        res.end(JSON.stringify(ok ? { mfa: true } : { error: "Wrong email or password" }));
      },
      "GET /favicon.ico": (_req, res) => {
        res.writeHead(204);
        res.end();
      },
    },
    fallback: (req, res) => {
      const name = /^\/session\/([a-z]+)$/.exec(new URL(req.url, "http://x").pathname)?.[1];
      if (req.method === "POST" && name && NEXT[name]) {
        const form = new URLSearchParams(req.body);
        if (form.get("password") !== PASSWORD) return sendHtml(res, shell("Sign in", `<p role="alert">Wrong email or password</p>`));
        res.writeHead(303, { location: `/next/${name}`, "set-cookie": `${COOKIE[name]}; Path=/; HttpOnly` });
        res.end();
        return;
      }
      res.writeHead(404);
      res.end();
    },
  });
});

afterAll(async () => {
  await site?.close();
  await closeBrowser();
});

const account = (path: string): TestAccount => ({ id: "a", label: "Account A", loginUrl: `${site.url}${path}`, username: EMAIL, password: PASSWORD });

async function signInError(path: string): Promise<SignInError> {
  const outcome = await signIn(browser, account(path)).then(
    (signed: SignedIn) => signed,
    (err: unknown) => err,
  );
  expect(outcome, `signIn at ${path} must fail`).toBeInstanceOf(SignInError);
  const err = outcome as SignInError;
  expect(err.message).not.toContain(PASSWORD);
  return err;
}

const CODE_MESSAGE = "Account A's sign-in asks for a verification code after the password. Codes (multi-factor sign-in) aren't supported";
const CAPTCHA_MESSAGE = "captchas aren't supported";

describe("signIn: a code step on the page after the password (no autocomplete=one-time-code)", () => {
  it("a Verification code field named code at /verify: says codes aren't supported, and nothing is typed or sent there", async () => {
    site.requests.length = 0;
    expect((await signInError("/login-code")).message).toContain(CODE_MESSAGE);
    expect(site.requests.some((r) => r.url.startsWith("/verify"))).toBe(false);
  });

  it("Devise's user[otp_attempt] (autocomplete=off): says codes aren't supported", async () => {
    expect((await signInError("/login-devise")).message).toContain(CODE_MESSAGE);
  });

  it("a two-step sign-in whose password step goes on to an authenticator code (a field named token): says codes aren't supported", async () => {
    site.requests.length = 0;
    expect((await signInError("/login-twostep")).message).toContain(CODE_MESSAGE);
    expect(site.requests.filter((r) => r.method === "POST").map((r) => r.url)).toEqual(["/login/identifier", "/session/authenticator"]);
  });
});

describe("signIn: a code step the page's heading names (round 3)", () => {
  it('a plain "Code" field under a "Two-step verification" heading: says codes aren\'t supported', async () => {
    expect((await signInError("/login-plaincode")).message).toContain(CODE_MESSAGE);
  });

  it("a code split over six one-character boxes on the next page: says codes aren't supported", async () => {
    expect((await signInError("/login-split")).message).toContain(CODE_MESSAGE);
  });

  it("a split code step swapped in at the sign-in page's own address (a single-page app): says codes aren't supported", async () => {
    site.requests.length = 0;
    expect((await signInError("/login-spa")).message).toContain(CODE_MESSAGE);
    expect(site.requests.filter((r) => r.method === "POST").map((r) => r.url)).toEqual(["/api/login"]);
  });
});

describe("signIn: a captcha challenge on the page after the password", () => {
  it("a Turnstile challenge is all the page asks for: says captchas aren't supported, and nothing is submitted there", async () => {
    site.requests.length = 0;
    expect((await signInError("/login-turnstile")).message).toContain(CAPTCHA_MESSAGE);
    expect(site.requests.some((r) => r.method === "POST" && r.url.startsWith("/verify"))).toBe(false);
  });

  it('a widget outside any form under a "Verify you are human" heading: says captchas aren\'t supported', async () => {
    expect((await signInError("/login-human")).message).toContain(CAPTCHA_MESSAGE);
  });
});

describe("signIn: landing pages that only look like a code or a captcha step are a success", () => {
  for (const [name, what] of [
    ["promo", "a promo-code field on the billing page"],
    ["feedback", "a Turnstile widget in a feedback form next to its text field"],
    ["badge", "a reCAPTCHA v3 badge on a dashboard"],
    ["search", "a search box on a dashboard that says verify your email"],
    ["explain", 'a "Code" textarea, the signed-in page\'s only field (round 3)'],
    ["room", 'a "Room code" field, the signed-in page\'s only field (round 3)'],
    ["credits", "a Turnstile widget outside any form on a signed-in page with no field to fill in (round 3)"],
  ] as const) {
    it(`${what}: signs in`, async () => {
      const result = await signIn(browser, account(`/login-${name}`));
      expect(new URL(result.landedOn).pathname).toBe(`/next/${name}`);
    });
  }
});
