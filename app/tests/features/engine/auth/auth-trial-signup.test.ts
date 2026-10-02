/**
 * signIn never types the account's password into a sign-up form beside a two-step sign-in's first step (0.6.0, round 2
 * of the release review; docs/v2-spec.md "Signing in" step 2: "never one that creates an account", and "Sign-in:
 * two-step and sessionStorage": "sign-in words, never a sign-up form").
 *
 * What went wrong: a sign-in page with an email-first sign-in form ("Sign in", Continue) and, beside it, a free-trial
 * sign-up form (Full name, Work email, Password, "Start free trial"). The one-step search ran first and took any form
 * with a password field whose words didn't say sign up, and "Start free trial" didn't: the account's email and
 * password were typed into the trial form and submitted, a new trial account was created on the user's app, and the
 * run went on as that account.
 *
 * The contract now:
 * - Trial wording (free trial, start your trial, try it free) says sign up, and a password form with a field for the
 *   person's name (Name, Full name, First name) is a sign-up form.
 * - When the page has a first step with sign-in words of its own, a password form is taken for the sign-in only when
 *   it gives a sign-in signal of its own (autocomplete=current-password, or sign-in words in its name or its submit
 *   control); otherwise the sign-in goes through the first step.
 *
 * Round 3: the rule above was still a word list. A sign-up form saying "Start for free" or "Create workspace" beside a
 * "Welcome back" first step (only the page's title said Log in) got the email and password. Now any first step
 * (firstStepForm: sign-in words of its own, before it, in the page's title or its address) beside a password form
 * without a sign-in signal of its own takes the sign-in. And a name field is a sign-up signal only beside another
 * identifier field: an admin panel's Name, Password, "Submit" is a sign-in form. When every password form on the page
 * is a sign-up form, the message says so.
 */
import type { ServerResponse } from "node:http";
import type { Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeBrowser, getBrowser } from "../../test-support/harness.js";
import { startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import type { TestAccount } from "../interfaces/accounts.js";
import { signIn, SignInError } from "./auth.js";

const EMAIL = "someone@example.test";
const PASSWORD = "hunter2correcthorse91";
const SID = "s3ss10nT0kenValue1234567890";

let browser: Browser;
let site: FixtureServer;

const shell = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body><main>${body}</main></body></html>`;

function sendHtml(res: ServerResponse, body: string): void {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(body);
}

/** The email-first sign-in step (it says Sign in), posting to /login/identifier. */
const FIRST_STEP = `<section><h2>Sign in</h2>
<form method="post" action="/login/identifier" aria-label="Sign in"><label for="e">Email</label><input id="e" name="email" type="email" autocomplete="username"><button type="submit">Continue</button></form></section>`;

/**
 * An email-first step whose own words don't say sign in (round 3 of the release review): a "Welcome back" heading and
 * "Continue"; only the page's title ("Log in") says it.
 */
const PLAIN_FIRST_STEP = `<section><h1>Welcome back</h1>
<form method="post" action="/login/identifier"><label for="e">Email</label><input id="e" name="email" type="email" autocomplete="username"><button type="submit">Continue</button></form></section>`;

/** A page with the first step and, beside it, `signup` (a form with a password field that posts to /trial). */
const page = (signup: string, before = false, plain = false) =>
  plain
    ? shell("Log in – Acme", before ? signup + PLAIN_FIRST_STEP : PLAIN_FIRST_STEP + signup)
    : shell("Sign in · Acme", `<h1>Welcome to Acme</h1>${before ? signup + FIRST_STEP : FIRST_STEP + signup}`);

/** A sign-up form with a password field and no name field, saying `cta` (words no sign-up word list knows). */
const plainSignup = (cta: string) => `<section><h2>New to Acme?</h2>
<form method="post" action="/trial"><label for="te">Work email</label><input id="te" name="email" type="email">
<label for="tp">Password</label><input id="tp" name="password" type="password">
<button type="submit">${cta}</button></form></section>`;

/** The sign-up forms beside the first step (`plain`: beside PLAIN_FIRST_STEP, on a page titled "Log in"). */
const SIGNUPS: Record<string, { what: string; html: string; before?: boolean; plain?: boolean }> = {
  "/login-start-free": {
    what: 'a "Start for free" form (Work email, Password) beside a "Welcome back" first step whose own words don\'t say sign in',
    plain: true,
    html: plainSignup("Start for free"),
  },
  "/login-workspace": {
    what: 'a "Create workspace" form (Work email, Password) beside a "Welcome back" first step whose own words don\'t say sign in',
    plain: true,
    html: plainSignup("Create workspace"),
  },
  "/login-workspace-first": {
    what: 'a "Create workspace" form placed before a "Welcome back" first step whose own words don\'t say sign in',
    plain: true,
    before: true,
    html: plainSignup("Create workspace"),
  },
  "/login-trial": {
    what: 'a free-trial form (Full name, Work email, Password, "Start free trial") after it',
    html: `<section><h2>New here? Start your 14-day free trial</h2>
<form method="post" action="/trial"><label for="n">Full name</label><input id="n" name="name" type="text">
<label for="te">Work email</label><input id="te" name="email" type="email">
<label for="tp">Password</label><input id="tp" name="password" type="password">
<button type="submit">Start free trial</button></form></section>`,
  },
  "/login-trial-first": {
    what: 'a free-trial form ("Try it free", no name field) before it',
    before: true,
    html: `<section><form method="post" action="/trial"><label for="te">Work email</label><input id="te" name="email" type="email">
<label for="tp">Password</label><input id="tp" name="password" type="password">
<button type="submit">Try it free</button></form></section>`,
  },
  "/login-name": {
    what: 'a form with a name field and "Continue" (no sign-up words) before it',
    before: true,
    html: `<section><form method="post" action="/trial"><label for="fn">First name</label><input id="fn" name="first_name" type="text">
<label for="te">Email</label><input id="te" name="email" type="email">
<label for="tp">Password</label><input id="tp" name="password" type="password">
<button type="submit">Continue</button></form></section>`,
  },
  "/login-plain": {
    what: 'an unnamed email and password form saying "Request access" (no sign-in signal) after it',
    html: `<section><form method="post" action="/trial"><label for="te">Email</label><input id="te" name="email" type="email">
<label for="tp">Password</label><input id="tp" name="password" type="password">
<button type="submit">Request access</button></form></section>`,
  },
};

beforeAll(async () => {
  browser = await getBrowser();
  const pages: Record<string, string> = {
    "/login/password": shell(
      "Sign in · Acme",
      `<h1>Sign in</h1><form method="post" action="/session"><input type="hidden" name="email" value="${EMAIL}">
<label for="p">Password</label><input id="p" name="password" type="password" autocomplete="current-password"><button type="submit">Sign in</button></form>`,
    ),
    // A one-step sign-in page whose form gives no sign-in signal of its own, and no first step beside it.
    "/login-one-step": shell(
      "Sign in · Acme",
      `<h1>Welcome back</h1><form method="post" action="/session"><label for="e">Email</label><input id="e" name="email" type="email">
<label for="p">Password</label><input id="p" name="password" type="password"><button type="submit">Continue</button></form>`,
    ),
  };
  for (const [path, signup] of Object.entries(SIGNUPS)) pages[path] = page(signup.html, signup.before, signup.plain);
  // A sign-in form whose username field is labelled "Name" (round 3): no other identifier field, so not a sign-up.
  pages["/login-admin"] = shell(
    "Admin",
    `<h1>Admin panel</h1><form method="post" action="/session"><label for="e">Name</label><input id="e" name="email">
<label for="p">Password</label><input id="p" name="password" type="password"><button type="submit">Submit</button></form>`,
  );
  // A page whose only password form is a sign-up form (a name and an email field, "Continue").
  pages["/login-signup-only"] = shell(
    "Log in – Acme",
    `<h1>Welcome</h1><form method="post" action="/trial"><label for="n">Full name</label><input id="n" name="name">
<label for="te">Email</label><input id="te" name="email" type="email">
<label for="tp">Password</label><input id="tp" name="password" type="password"><button type="submit">Continue</button></form>`,
  );
  site = await startFixtureServer({
    pages,
    routes: {
      "POST /login/identifier": (_req, res) => {
        res.writeHead(303, { location: "/login/password" });
        res.end();
      },
      "POST /trial": (_req, res) => {
        res.writeHead(303, { location: "/welcome", "set-cookie": "sid=trialSess10nT0ken1234567890; Path=/; HttpOnly" });
        res.end();
      },
      "POST /session": (req, res) => {
        const form = new URLSearchParams(req.body);
        if (form.get("email") !== EMAIL || form.get("password") !== PASSWORD) return sendHtml(res, shell("Sign in", `<p role="alert">Wrong email or password</p>`));
        res.writeHead(303, { location: "/app", "set-cookie": `sid=${SID}; Path=/; HttpOnly` });
        res.end();
      },
      "GET /welcome": (_req, res) => sendHtml(res, shell("Welcome", "<h1>Welcome to your trial</h1><p>Your new account is ready.</p>")),
      "GET /app": (_req, res) => sendHtml(res, shell("Acme", "<h1>Your projects</h1>")),
      "GET /favicon.ico": (_req, res) => {
        res.writeHead(204);
        res.end();
      },
    },
  });
});

afterAll(async () => {
  await site?.close();
  await closeBrowser();
});

const account = (path: string): TestAccount => ({ id: "a", label: "Account A", loginUrl: `${site.url}${path}`, username: EMAIL, password: PASSWORD });
const posts = () => site.requests.filter((r) => r.method === "POST").map((r) => new URL(r.url, "http://x").pathname);

describe("signIn: a two-step sign-in page with a sign-up form beside the first step", () => {
  for (const [path, { what }] of Object.entries(SIGNUPS)) {
    it(`${what}: signs in through the first step; nothing is typed into the sign-up form or sent to it`, async () => {
      site.requests.length = 0;
      const result = await signIn(browser, account(path));
      expect(posts()).not.toContain("/trial");
      expect(posts()).toEqual(["/login/identifier", "/session"]);
      expect(new URL(result.landedOn).pathname).toBe("/app");
      expect(result.state.cookies.find((c) => c.name === "sid")?.value).toBe(SID);
      const carrying = site.requests.filter((r) => r.body.includes(encodeURIComponent(PASSWORD)) || r.body.includes(PASSWORD));
      expect(carrying.map((r) => new URL(r.url, "http://x").pathname)).toEqual(["/session"]);
    });
  }

  it("a one-step sign-in form without a sign-in signal of its own, and no first step beside it: still signs in in one step", async () => {
    site.requests.length = 0;
    const result = await signIn(browser, account("/login-one-step"));
    expect(posts()).toEqual(["/session"]);
    expect(new URL(result.landedOn).pathname).toBe("/app");
  });
});

describe("signIn: a name field is a sign-up signal only beside another identifier field (round 3)", () => {
  it('a sign-in form whose only text field is labelled "Name" (Name, Password, "Submit"): signs in with it', async () => {
    site.requests.length = 0;
    const result = await signIn(browser, account("/login-admin"));
    expect(posts()).toEqual(["/session"]);
    expect(new URL(result.landedOn).pathname).toBe("/app");
    expect(result.state.cookies.find((c) => c.name === "sid")?.value).toBe(SID);
  });

  it("a page whose only password form is a sign-up form (Full name, Email): says it looks like a sign-up form; nothing is typed or sent", async () => {
    site.requests.length = 0;
    const outcome = await signIn(browser, account("/login-signup-only")).then(
      () => null,
      (err: unknown) => err as Error,
    );
    expect(outcome).toBeInstanceOf(SignInError);
    expect(outcome!.message).toContain("No sign-in form");
    expect(outcome!.message).toMatch(/sign-up form/);
    expect(outcome!.message).not.toContain(PASSWORD);
    expect(posts()).toEqual([]);
  });
});
