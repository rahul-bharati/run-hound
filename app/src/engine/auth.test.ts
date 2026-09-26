/**
 * signIn (0.4.0, docs/v2-spec.md "Signing in"): signs a test account in with a fresh, guarded browser context and
 * returns the session (Playwright storageState, in memory only), where the browser landed (redacted) and the session
 * values to redact. Failures are SignInError with one or two plain sentences that never hold the password.
 *
 * Runs against the shared accounts app (test-support/accounts-app.ts) in every sign-in variant and token mode, plus a
 * few one-off sign-in pages served below.
 */
import type { Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startAccountsApp, type AccountsApp, type AccountsAppOptions } from "../../test-support/accounts-app.js";
import { closeBrowser, getBrowser } from "../../test-support/harness.js";
import { startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import type { TestAccount } from "../accounts/types.js";
import { signIn, SignInError, type SessionState, type SignedIn } from "./auth.js";

let browser: Browser;
let pages: FixtureServer;
const apps = new Map<string, AccountsApp>();

/** One accounts app per option set, started once for the file. */
async function app(options: AccountsAppOptions = {}): Promise<AccountsApp> {
  const key = JSON.stringify({ tokenMode: options.tokenMode ?? "cookie", loginVariant: options.loginVariant ?? "email" });
  let found = apps.get(key);
  if (!found) {
    found = await startAccountsApp(options);
    apps.set(key, found);
  }
  found.reset();
  found.signOutEveryone();
  return found;
}

/** A test account for a one-off page (not the accounts app). */
function accountFor(loginUrl: string, extra: Partial<TestAccount> = {}): TestAccount {
  return { id: "a", label: "Account A", loginUrl, username: "someone@example.test", password: "fixture-pass-2468", ...extra };
}

/** The error signIn rejected with; fails the test when it resolved or threw anything but a SignInError. */
async function failure(promise: Promise<SignedIn>): Promise<SignInError> {
  const outcome = await promise.then(
    () => "resolved" as const,
    (err: unknown) => err,
  );
  expect(outcome, "signIn should have rejected with a SignInError").toBeInstanceOf(SignInError);
  return outcome as SignInError;
}

/** Who the accounts app says is signed in when a new browser context opens /settings with `state`. */
async function signedInEmail(target: AccountsApp, state: SessionState): Promise<string | null> {
  const context = await browser.newContext({ storageState: state });
  try {
    const page = await context.newPage();
    await page.goto(`${target.url}/settings`);
    await page.locator("#me-email").waitFor({ timeout: 10_000 });
    return await page.locator("#me-email").textContent();
  } finally {
    await context.close();
  }
}

/** GET /api/me with a raw credential header, outside any browser. */
async function me(target: AccountsApp, headers: Record<string, string>): Promise<{ status: number; email?: string }> {
  const res = await fetch(`${target.url}/api/me`, { headers });
  const body = (await res.json().catch(() => ({}))) as { email?: string };
  return { status: res.status, email: body.email };
}

/** The session value signIn's state carries: the sid cookie (cookie mode) or the localStorage token (bearer). */
function sessionValue(target: AccountsApp, state: SessionState): string | undefined {
  if (target.options.tokenMode === "cookie") return state.cookies.find((c) => c.name === "sid")?.value;
  return state.origins.find((o) => o.origin === target.url)?.localStorage.find((i) => i.name === "token")?.value;
}

beforeAll(async () => {
  browser = await getBrowser();
  pages = await startFixtureServer({
    pages: {
      // A page with a form, but no password field anywhere.
      "/newsletter": `<!doctype html><html lang="en"><head><title>Newsletter</title></head><body><main><h1>Newsletter</h1>
        <form id="news"><label for="e">Email</label><input id="e" name="email" type="email"><button type="submit">Subscribe</button></form>
        </main></body></html>`,
      // A sign-in form that asks for a captcha too; its error text does not say "captcha".
      "/captcha-login": `<!doctype html><html lang="en"><head><title>Sign in</title></head><body><main><h1>Sign in</h1>
        <form id="f" aria-label="Sign in">
          <label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username">
          <label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password">
          <label for="captcha">Captcha: type the letters in the picture</label><input id="captcha" name="captcha" type="text">
          <button type="submit">Sign in</button>
          <div role="alert" id="err" hidden></div>
        </form>
        <script>document.getElementById("f").addEventListener("submit", (e) => { e.preventDefault(); const a = document.getElementById("err"); a.textContent = "Please try again."; a.hidden = false; });</script>
        </main></body></html>`,
      // A sign-in form that does nothing at all when submitted: no error text, no navigation.
      "/silent-login": `<!doctype html><html lang="en"><head><title>Sign in</title></head><body><main><h1>Sign in</h1>
        <form id="f" aria-label="Sign in">
          <label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username">
          <label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password">
          <button type="submit">Sign in</button>
        </form>
        <script>document.getElementById("f").addEventListener("submit", (e) => e.preventDefault());</script>
        </main></body></html>`,
    },
  });
});

afterAll(async () => {
  await Promise.all([...apps.values()].map((a) => a.stop()));
  await pages?.close();
  await closeBrowser();
});

const VARIANTS: { tokenMode: "cookie" | "bearer"; loginVariant: "email" | "username" | "two-password" }[] = [
  { tokenMode: "cookie", loginVariant: "email" },
  { tokenMode: "bearer", loginVariant: "email" },
  { tokenMode: "cookie", loginVariant: "username" },
  { tokenMode: "bearer", loginVariant: "username" },
  { tokenMode: "cookie", loginVariant: "two-password" },
  { tokenMode: "bearer", loginVariant: "two-password" },
];

describe.each(VARIANTS)("signIn: $loginVariant sign-in page, $tokenMode sessions", ({ tokenMode, loginVariant }) => {
  it("signs Account A in and returns a session that works in a new browser context", async () => {
    const target = await app({ tokenMode, loginVariant });
    const contextsBefore = browser.contexts().length;

    const result = await signIn(browser, target.account("a"));

    // One new session for alice on the app, and the state carries it.
    expect(target.activeSessions("alice")).toBe(1);
    expect(target.activeSessions("bob")).toBe(0);
    expect(await signedInEmail(target, result.state)).toBe(target.users.alice.email);
    // The client sends signed-in visitors from /login to /notes.
    expect(result.landedOn).toContain("/notes");
    expect(result.landedOn).not.toContain(target.users.alice.password);
    // The sign-in context is closed again: the session lives in `state` only.
    expect(browser.contexts().length).toBe(contextsBefore);
  });

  it(`returns the ${tokenMode === "cookie" ? "session cookie value" : "bearer token"} in secrets, so it can be redacted`, async () => {
    const target = await app({ tokenMode, loginVariant });
    const result = await signIn(browser, target.account("a"));

    const value = sessionValue(target, result.state);
    expect(value, tokenMode === "cookie" ? "the state holds the sid cookie" : "the state holds localStorage.token for the app's origin").toBeTruthy();
    expect(result.secrets).toContain(value);
    // It is the live session the app issued, not something else.
    const header: Record<string, string> = tokenMode === "cookie" ? { cookie: `sid=${value}` } : { authorization: `Bearer ${value}` };
    expect(await me(target, header)).toEqual({ status: 200, email: target.users.alice.email });
    if (tokenMode === "bearer") expect(result.state.cookies.find((c) => c.name === "sid")).toBeUndefined();
  });

  if (loginVariant === "two-password") {
    it("picks the sign-in form (one password field), not the sign-up form above it (two)", async () => {
      const target = await app({ tokenMode, loginVariant });
      await signIn(browser, target.account("a"));
      expect(target.requests.some((r) => r.url.startsWith("/api/signup"))).toBe(false);
      const logins = target.requests.filter((r) => r.method === "POST" && r.url === "/api/login");
      expect(logins).toHaveLength(1);
      expect(JSON.parse(logins[0]!.body)).toMatchObject({ email: target.users.alice.email, password: target.users.alice.password });
    });
  }
});

describe("signIn: which account, and where it lands", () => {
  it("signs Account B in as bob", async () => {
    const target = await app();
    const result = await signIn(browser, target.account("b"));
    expect(await signedInEmail(target, result.state)).toBe(target.users.bob.email);
    expect(target.activeSessions("bob")).toBe(1);
    expect(target.activeSessions("alice")).toBe(0);
  });

  it("follows the sign-in page's own ?next= and reports the landing page redacted", async () => {
    const target = await app();
    const stripe = "sk_live_FAKEFAKEFAKE1234567890abcdEFGH";
    const account = { ...target.account("a"), loginUrl: `${target.loginUrl}?next=${encodeURIComponent(`/help?key=${stripe}`)}` };
    const result = await signIn(browser, account);
    expect(result.landedOn).toContain("/help");
    expect(result.landedOn).not.toContain(stripe);
    expect(result.landedOn).toContain("[REDACTED:stripe-secret]");
    expect(target.activeSessions("alice")).toBe(1);
  });
});

describe("signIn: failures are plain SignInErrors without the password", () => {
  it("wrong password: the message carries the page's own error text", async () => {
    const target = await app();
    const wrong = "wrong-pass-0000";
    const err = await failure(signIn(browser, { ...target.account("a"), password: wrong }));
    expect(err.message).toContain("Email or password is incorrect");
    expect(err.message).not.toContain(wrong);
    expect(err.message).not.toContain(target.users.alice.password);
    expect(target.activeSessions()).toBe(0);
  });

  it("wrong password on a username sign-in page: that page's error text", async () => {
    const target = await app({ loginVariant: "username" });
    const wrong = "not-bobs-pass-1111";
    const err = await failure(signIn(browser, { ...target.account("b"), password: wrong }));
    expect(err.message).toContain("Username or password is incorrect");
    expect(err.message).not.toContain(wrong);
    expect(target.activeSessions()).toBe(0);
  });

  it("no password field on the page: names the URL", async () => {
    const loginUrl = `${pages.url}/newsletter`;
    const err = await failure(signIn(browser, accountFor(loginUrl)));
    expect(err.message).toContain("No sign-in form");
    expect(err.message).toContain(loginUrl);
    expect(err.message).not.toContain("fixture-pass-2468");
  });

  it("the form is still shown after submitting and the page says nothing: says so", async () => {
    const err = await failure(signIn(browser, accountFor(`${pages.url}/silent-login`)));
    expect(err.message).toContain("still shown after submitting");
    expect(err.message).not.toContain("fixture-pass-2468");
  });

  it("a verification code after the password: says codes aren't supported, and no session is created", async () => {
    const target = await app({ loginVariant: "otp" });
    const err = await failure(signIn(browser, target.account("a")));
    expect(err.message).toMatch(/code/i);
    expect(err.message).toMatch(/support/i);
    expect(err.message).not.toContain(target.users.alice.password);
    // The password step succeeded (a challenge was issued) but nothing signed in.
    expect(target.requests.some((r) => r.method === "POST" && r.url === "/api/login")).toBe(true);
    expect(target.requests.some((r) => r.url.startsWith("/api/login/verify"))).toBe(false);
    expect(target.activeSessions()).toBe(0);
  });

  it("a captcha on the sign-in form: says captchas aren't supported", async () => {
    const err = await failure(signIn(browser, accountFor(`${pages.url}/captcha-login`)));
    expect(err.message).toMatch(/captcha/i);
    expect(err.message).toMatch(/support/i);
    expect(err.message).not.toContain("fixture-pass-2468");
  });

  it("a login URL outside the safety gate is refused", async () => {
    const err = await failure(signIn(browser, accountFor("http://8.8.8.8/login")));
    expect(err.message).toContain("8.8.8.8");
    // A host name is judged by where it resolves (the injected lookup stands in for DNS).
    const lookup = async () => ["93.184.216.34"];
    const byName = await failure(signIn(browser, accountFor("http://intranet.example.test/login"), { lookup }));
    expect(byName.message).toContain("intranet.example.test");
  });

  it.each([
    { missing: "password", patch: { password: null } },
    { missing: "login URL", patch: { loginUrl: "" } },
    { missing: "username", patch: { username: "" } },
  ])("a slot without a $missing: a plain message, and the app is never contacted", async ({ missing, patch }) => {
    const target = await app();
    const account: TestAccount = { ...target.account("a"), ...patch };
    const err = await failure(signIn(browser, account));
    if (missing === "password") expect(err.message).toMatch(/password/i);
    expect(err.message).not.toContain(target.users.alice.password);
    expect(target.requests).toHaveLength(0);
  });
});
