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
 *
 * Close-out of round 3: a heading or title alone (verify, verification, two-factor) no longer makes any single field a
 * code step (an unconfirmed account's "Please verify your email address" banner over a "New task" field failed the
 * sign-in): when only the page's words name a sign-in code, the field must look like a code's itself (it says code,
 * OTP, PIN, token or digit, has inputmode=numeric, a maxlength of 4 to 8, or is one of split one-character boxes).
 *
 * Close-out review, round 1: the field's own words were read as they are written, so a camel-case name
 * ("verificationCode", "otpCode") and a label given by aria-labelledby said nothing, and a type=number field or one whose
 * pattern allows digits only didn't look like a code's: real code pages signed in. A camel-case name is now read word by
 * word, the text of the elements aria-labelledby names is the field's label too, and type=number or a digits-only
 * pattern ("[0-9]*", "\d{6}") looks like a code's, as inputmode=numeric does. The other way round, a field that can't
 * hold a sign-in code is never one: type=email, or own words that say email, phone, mobile or name without a code word
 * (an unconfirmed account's "Send the verification email to" field, a maxlength=8 "Team short name"), or say API (a
 * "Paste your API token" field under "Please verify your email address").
 *
 * Close-out review, round 2: that rule read "Mobile verification", "Phone verification" and "Email verification" as
 * fields that can't hold a code (verification wasn't a code word to it), so real code steps signed in, one of them with
 * inputmode=numeric and maxlength=6. Own words that say email, phone or mobile beside verify or verification hold a code
 * now unless they also say send, resend, address or number (an address field), and so does a numeric one (it goes on
 * to the heading's test). The other way round, type=number, a digits-only pattern or inputmode=numeric alone no longer
 * make a field under a heading that only says verify look like a code's: the heading or title must name a code step
 * outright (two-step, two-factor, 2FA, MFA, authenticator, one-time, OTP, passcode, a verification or security code),
 * or the field must say code itself, be split boxes, or be code-sized (a maxlength of 4 to 8, a pattern of 4 to 8
 * digits). A code word that only a camel-case split finds in a name or id ("verificationSearch") needs a field that
 * looks like a code's too.
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
  // Close-out of round 3: a heading or title that says verify, verification or two-factor names no code by itself. A
  // test account that never confirmed its email lands on a dashboard whose banner heading asks for that, and whose one
  // field adds a task; a KYC product's dashboard is titled "Identity verification" and finds a customer; a 2FA set-up
  // page asks for a phone number. None of those fields is a code's.
  verifybanner: shell(
    "Tasks",
    `<h1>Your tasks</h1><h2>Please verify your email address</h2><p>We sent a link to your inbox.</p><form method="post" action="/app/tasks"><label for="t">New task</label><input id="t" name="title"><button type="submit">Add</button></form>`,
  ),
  kyc: shell(
    "Identity verification",
    `<h1>Identity verification</h1><form method="get" action="/app/customers"><label for="q">Find a customer</label><input id="q" name="q"><button type="submit">Find</button></form>`,
  ),
  twofasetup: shell(
    "Settings",
    `<h1>Set up two-factor authentication</h1><form method="post" action="/app/2fa"><label for="ph">Phone number</label><input id="ph" name="phone" type="tel" maxlength="15"><button type="submit">Send</button></form>`,
  ),
  // Close-out review, round 1: code steps whose field says so only in a camel-case name, a label given by
  // aria-labelledby, or by being numeric (type=number, a digits-only pattern), under a heading that names a code step.
  camel: shell(
    "Sign in",
    `<h1>Two-step verification</h1><p>Enter the code from your authenticator app.</p><form method="post" action="/verify"><input name="verificationCode" id="verificationCode" type="text" autocomplete="off"><button type="submit">Verify</button></form>`,
  ),
  otpcamel: shell(
    "Sign in",
    `<h1>Two-factor authentication</h1><p>Open your authenticator app.</p><form method="post" action="/verify"><input name="otpCode" id="otpCode" type="text" autocomplete="off"><button type="submit">Verify</button></form>`,
  ),
  labelledby: shell(
    "Sign in",
    `<h1>Verify it's you</h1><form method="post" action="/verify"><span id="lbl">Enter the code we sent to your phone</span><input aria-labelledby="lbl" name="c" id="c" type="text" autocomplete="off"><button type="submit">Verify</button></form>`,
  ),
  number: shell(
    "Verification",
    `<h1>Two-step verification</h1><p>Enter the 6-digit code.</p><form method="post" action="/verify"><input name="value" id="value" type="number" autocomplete="off"><button type="submit">Verify</button></form>`,
  ),
  pattern: shell(
    "Verification",
    `<h1>Two-step verification</h1><form method="post" action="/verify"><input name="answer" id="answer" type="text" pattern="[0-9]*" autocomplete="off"><button type="submit">Verify</button></form>`,
  ),
  patternd: shell(
    "Verification",
    `<h1>Two-step verification</h1><form method="post" action="/verify"><input name="answer" id="answer" type="text" pattern="\\d{6}" autocomplete="off"><button type="submit">Verify</button></form>`,
  ),
  emailcode: shell(
    "Verify",
    `<h1>Check your inbox</h1><form method="post" action="/verify"><label for="c">Enter the verification code we sent to your email</label><input id="c" name="emailCode" type="text"><button type="submit">Verify</button></form>`,
  ),
  // Close-out review, round 1: an unconfirmed test account's landing pages, whose one field can't hold a sign-in code.
  resend: shell(
    "Tasks",
    `<h1>Your tasks</h1><h2>Confirm your account</h2><form method="post" action="/app/resend"><label for="re">Send the verification email to</label><input id="re" name="email" type="email"><button type="submit">Resend</button></form>`,
  ),
  resendtext: shell(
    "Tasks",
    `<h1>Your tasks</h1><h2>Please verify your email address</h2><form method="post" action="/app/resend"><label for="re">Send the verification email to</label><input id="re" name="to" type="text"><button type="submit">Resend</button></form>`,
  ),
  bannertoken: shell(
    "Tasks",
    `<h1>Dashboard</h1><h2>Please verify your email address</h2><form method="post" action="/app/keys"><label for="k">Paste your API token</label><input id="k" name="key"><button type="submit">Save</button></form>`,
  ),
  bannershort: shell(
    "Tasks",
    `<h1>Dashboard</h1><h2>Please verify your email address</h2><form method="post" action="/app/team"><label for="n">Team short name</label><input id="n" name="short" maxlength="8"><button type="submit">Save</button></form>`,
  ),
  // Close-out review, round 2: code steps whose field's own words say mobile, phone or email beside "verification", or
  // whose only hint is numeric under a heading that names a code step outright.
  mobileverif: shell(
    "Sign in",
    `<h1>Two-step verification</h1><p>We texted a 6-digit code to your phone.</p><form method="post" action="/verify"><label for="v">Mobile verification</label><input id="v" name="mobileVerification" inputmode="numeric" maxlength="6" autocomplete="off"><button type="submit">Verify</button></form>`,
  ),
  phoneverif: shell(
    "Sign in",
    `<h1>Verify it's you</h1><form method="post" action="/verify"><label for="v">Phone verification</label><input id="v" name="phone_verification" autocomplete="off"><button type="submit">Verify</button></form>`,
  ),
  emailverif: shell(
    "Sign in",
    `<h1>Check your inbox</h1><form method="post" action="/verify"><label for="v">Email verification</label><input id="v" name="ev" autocomplete="off" maxlength="6"><button type="submit">Verify</button></form>`,
  ),
  mobiletexted: shell(
    "Sign in",
    `<h1>Two-step verification</h1><form method="post" action="/verify"><label for="v">Enter what we texted to your mobile</label><input id="v" name="mobile" inputmode="numeric" autocomplete="off"><button type="submit">Verify</button></form>`,
  ),
  google: shell(
    "2-Step Verification",
    `<h1>2-Step Verification</h1><p>A text message with a verification code was just sent.</p><form method="post" action="/verify"><input id="v" name="answer" type="number" autocomplete="off" aria-label="Enter"><button type="submit">Next</button></form>`,
  ),
  // Close-out review, round 2: signed-in landing pages whose one field is only numeric (type=number, a digits-only
  // pattern, inputmode=numeric) under a heading that says verify but names no code, a camel-case id that says
  // verification on a search field, and a 2FA set-up page's numeric mobile number field.
  bannernumber: shell(
    "Tasks",
    `<h1>Dashboard</h1><h2>Please verify your email address</h2><form method="post" action="/app/hours"><label for="h">Hours worked today</label><input id="h" name="hours" type="number"><button type="submit">Log</button></form>`,
  ),
  bannerpattern: shell(
    "Tasks",
    `<h1>Dashboard</h1><h2>Please verify your email address</h2><form method="post" action="/app/emp"><label for="e">Employee number</label><input id="e" name="employee" pattern="[0-9]*"><button type="submit">Save</button></form>`,
  ),
  bannerinputmode: shell(
    "Tasks",
    `<h1>Dashboard</h1><h2>Please verify your email address</h2><form method="post" action="/app/hours"><label for="h">Hours worked today</label><input id="h" name="hours" inputmode="numeric"><button type="submit">Log</button></form>`,
  ),
  kyccamel: shell(
    "Customers",
    `<h1>Customers</h1><form method="get" action="/app/customers"><input id="verificationSearch" name="verificationSearch" placeholder="Search customers"><button type="submit">Find</button></form>`,
  ),
  twofamobile: shell(
    "Settings",
    `<h1>Set up two-factor authentication</h1><form method="post" action="/app/2fa"><label for="m">Verify your mobile number</label><input id="m" name="mobile" type="tel" inputmode="numeric"><button type="submit">Send</button></form>`,
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
  camel: "mfa_pending=pend1ngT0ken1234567890abc",
  otpcamel: "mfa_pending=pend1ngT0ken1234567890abc",
  labelledby: "mfa_pending=pend1ngT0ken1234567890abc",
  number: "mfa_pending=pend1ngT0ken1234567890abc",
  pattern: "mfa_pending=pend1ngT0ken1234567890abc",
  patternd: "mfa_pending=pend1ngT0ken1234567890abc",
  emailcode: "mfa_pending=pend1ngT0ken1234567890abc",
  resend: "sid=s3ss10nT0kenValue1234567890",
  resendtext: "sid=s3ss10nT0kenValue1234567890",
  bannertoken: "sid=s3ss10nT0kenValue1234567890",
  bannershort: "sid=s3ss10nT0kenValue1234567890",
  mobileverif: "mfa_pending=pend1ngT0ken1234567890abc",
  phoneverif: "mfa_pending=pend1ngT0ken1234567890abc",
  emailverif: "mfa_pending=pend1ngT0ken1234567890abc",
  mobiletexted: "mfa_pending=pend1ngT0ken1234567890abc",
  google: "mfa_pending=pend1ngT0ken1234567890abc",
  bannernumber: "sid=s3ss10nT0kenValue1234567890",
  bannerpattern: "sid=s3ss10nT0kenValue1234567890",
  bannerinputmode: "sid=s3ss10nT0kenValue1234567890",
  kyccamel: "sid=s3ss10nT0kenValue1234567890",
  twofamobile: "sid=s3ss10nT0kenValue1234567890",
  split: "mfa_pending=pend1ngT0ken1234567890abc",
  human: "mfa_pending=pend1ngT0ken1234567890abc",
  explain: "sid=s3ss10nT0kenValue1234567890",
  room: "sid=s3ss10nT0kenValue1234567890",
  credits: "sid=s3ss10nT0kenValue1234567890",
  verifybanner: "sid=s3ss10nT0kenValue1234567890",
  kyc: "sid=s3ss10nT0kenValue1234567890",
  twofasetup: "sid=s3ss10nT0kenValue1234567890",
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

describe("signIn: a code step whose field says so in a camel-case name, an aria-labelledby label, or by being numeric (close-out review, round 1)", () => {
  for (const [name, what] of [
    ["camel", 'a field named "verificationCode" under "Two-step verification"'],
    ["otpcamel", 'a field named "otpCode" under "Two-factor authentication"'],
    ["labelledby", 'a field labelled by aria-labelledby "Enter the code we sent to your phone" under "Verify it\'s you"'],
    ["number", 'a type=number field under "Two-step verification"'],
    ["pattern", 'a field with pattern="[0-9]*" under "Two-step verification"'],
    ["patternd", 'a field with pattern="\\d{6}" under "Two-step verification"'],
    ["emailcode", 'a field named "emailCode" labelled "Enter the verification code we sent to your email" (a code word beside "email")'],
  ] as const) {
    it(`${what}: says codes aren't supported`, async () => {
      expect((await signInError(`/login-${name}`)).message).toContain(CODE_MESSAGE);
    });
  }
});

describe("signIn: a code step whose field's own words say mobile, phone or email beside verification, or that is numeric under a heading naming a code step (close-out review, round 2)", () => {
  for (const [name, what] of [
    ["mobileverif", 'a "Mobile verification" field (mobileVerification, inputmode=numeric, maxlength=6) under "Two-step verification"'],
    ["phoneverif", 'a "Phone verification" field (phone_verification, no numeric hint, no maxlength) under "Verify it\'s you"'],
    ["emailverif", 'an "Email verification" field (maxlength=6) under "Check your inbox"'],
    ["mobiletexted", 'an inputmode=numeric "Enter what we texted to your mobile" field under "Two-step verification"'],
    ["google", 'a type=number field under "2-Step Verification"'],
  ] as const) {
    it(`${what}: says codes aren't supported`, async () => {
      expect((await signInError(`/login-${name}`)).message).toContain(CODE_MESSAGE);
    });
  }
});

describe("signIn: landing pages whose one field is only numeric, or says verification only in a camel-case id, are a success (close-out review, round 2)", () => {
  for (const [name, what] of [
    ["bannernumber", 'a type=number "Hours worked today" field under "Please verify your email address"'],
    ["bannerpattern", 'a pattern="[0-9]*" "Employee number" field under "Please verify your email address"'],
    ["bannerinputmode", 'an inputmode=numeric "Hours worked today" field under "Please verify your email address"'],
    ["kyccamel", 'a "verificationSearch" field with the placeholder "Search customers" under "Customers"'],
    ["twofamobile", 'an inputmode=numeric "Verify your mobile number" field under "Set up two-factor authentication"'],
  ] as const) {
    it(`${what}: signs in`, async () => {
      const result = await signIn(browser, account(`/login-${name}`));
      expect(new URL(result.landedOn).pathname).toBe(`/next/${name}`);
    });
  }
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
    ["verifybanner", 'a "New task" field under a "Please verify your email address" heading (close-out)'],
    ["kyc", 'a "Find a customer" field on a page titled "Identity verification" (close-out)'],
    ["twofasetup", 'a "Phone number" field under "Set up two-factor authentication" (close-out)'],
    ["resend", 'a type=email "Send the verification email to" field under "Confirm your account" (close-out review, round 1)'],
    ["resendtext", 'a text "Send the verification email to" field under "Please verify your email address" (close-out review, round 1)'],
    ["bannertoken", 'a "Paste your API token" field under "Please verify your email address" (close-out review, round 1)'],
    ["bannershort", 'a maxlength=8 "Team short name" field under "Please verify your email address" (close-out review, round 1)'],
  ] as const) {
    it(`${what}: signs in`, async () => {
      const result = await signIn(browser, account(`/login-${name}`));
      expect(new URL(result.landedOn).pathname).toBe(`/next/${name}`);
    });
  }
});
