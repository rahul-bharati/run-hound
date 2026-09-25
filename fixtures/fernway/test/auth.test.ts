/**
 * Contract tests for /signup, /login and the 404 view (CONTRACT.md "/signup Create account", "/login Sign in",
 * "Page requirements", "API", W07 and W10): the account API (server/routes/auth.mjs) and the pages in a browser.
 */
import type { Locator, Page, Request } from "playwright";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../server/app.mjs";
import { verifyPassword } from "../server/passwords.mjs";
import { api, axeViolations, closeBrowser, DEMO_ACCOUNT, horizontalOverflow, openPage, STACK_RE, useFernway, type Fernway } from "./support.js";

afterAll(closeBrowser);

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID_RE = new RegExp(`^${UUID}$`);
const SESSION_RE = new RegExp(`^fernway_session=(${UUID}); Path=/; HttpOnly; SameSite=Lax$`);
const REMEMBER_RE = new RegExp(`^fernway_session=(${UUID}); Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000$`);

const NEW_USER = { name: "Maya Patel", email: "maya@juniper.test", password: "Tr0ub4dor&3-horse", company: "Juniper Studio", terms: true };

// ---- helpers ---------------------------------------------------------------------------------------

/** Holds every request to `path` until release() is called, so the pending state can be asserted. */
async function hold(page: Page, path: string) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route(`**${path}`, async (route) => {
    await gate;
    await route.continue();
  });
  return { release };
}

/** The visible text of every element the control's aria-describedby points at (each id must exist). */
async function describedBy(page: Page, control: Locator): Promise<string> {
  const ids = ((await control.getAttribute("aria-describedby")) ?? "").split(/\s+/).filter(Boolean);
  const texts: string[] = [];
  for (const id of ids) {
    const target = page.locator(`[id="${id}"]`);
    expect(await target.count(), `#${id} exists`).toBe(1);
    if (await target.isVisible()) texts.push(((await target.textContent()) ?? "").trim());
  }
  return texts.join(" | ");
}

/** Text of every live region / alert / status on the page, in document order. */
function liveTexts(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[aria-live]:not([aria-live="off"]),[role=alert],[role=status],[role=log]')].map((el) =>
      (el.textContent ?? "").replace(/\s+/g, " ").trim(),
    ),
  );
}

const toast = (page: Page, text: string) => page.locator("[data-sonner-toast]").filter({ hasText: text });

/** Focus styles of a control at rest and while focused (reduced motion, so no transition is half way). */
async function focusStyles(control: Locator) {
  const read = () =>
    control.evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        outline: `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}`,
        outlineStyle: s.outlineStyle,
        boxShadow: s.boxShadow,
        border: s.borderColor,
        background: s.backgroundColor,
        focusVisible: el.matches(":focus-visible"),
      };
    });
  await control.evaluate((el) => (el as HTMLElement).blur());
  const rest = await read();
  await control.focus();
  const focused = await read();
  return { rest, focused };
}

function visibleFocus({ rest, focused }: Awaited<ReturnType<typeof focusStyles>>): boolean {
  const outline = focused.outlineStyle !== "none" && focused.outline !== rest.outline;
  return outline || focused.boxShadow !== rest.boxShadow || focused.border !== rest.border || focused.background !== rest.background;
}

async function openSignup(fw: Fernway, options: Parameters<typeof openPage>[2] = {}) {
  const opened = await openPage(fw, "/signup", { reducedMotion: "reduce", ...options });
  await opened.page.getByRole("heading", { level: 1, name: "Create your account" }).waitFor();
  return opened;
}

async function openLogin(fw: Fernway, path = "/login", options: Parameters<typeof openPage>[2] = {}) {
  const opened = await openPage(fw, path, { reducedMotion: "reduce", ...options });
  await opened.page.getByRole("heading", { level: 1, name: "Welcome back" }).waitFor();
  return opened;
}

async function fillSignup(page: Page, values: Partial<typeof NEW_USER> = {}) {
  const v = { ...NEW_USER, ...values };
  await page.getByLabel("Full name", { exact: true }).fill(v.name);
  await page.getByLabel("Work email", { exact: true }).fill(v.email);
  await page.getByLabel("Password", { exact: true }).fill(v.password);
  await page.getByLabel("Company", { exact: true }).fill(v.company);
  const terms = page.getByRole("checkbox", { name: "I agree to the Terms and Privacy Policy" });
  if (v.terms && (await terms.getAttribute("aria-checked")) !== "true") await terms.click();
}

const signupButton = (page: Page) => page.getByRole("button", { name: "Create account", exact: true });
const signInButton = (page: Page) => page.getByRole("button", { name: "Sign in", exact: true });

// ---- the account API ---------------------------------------------------------------------------

describe("account API (clean mode)", () => {
  const ref = useFernway("none");

  it("POST /api/signup creates the account: 201 { id, name, email }, a fresh HttpOnly session cookie, no password", async () => {
    const res = await api(ref.fw, "/api/signup", { body: { ...NEW_USER, email: "  Maya@Juniper.TEST ", extra: "ignored" } });
    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual(["email", "id", "name"]);
    expect(res.body).toMatchObject({ name: "Maya Patel", email: "maya@juniper.test" });
    expect(res.body.id).toMatch(UUID_RE);
    expect(JSON.stringify(res.body)).not.toContain(NEW_USER.password);
    expect(res.headers.get("set-cookie")).toMatch(SESSION_RE);

    // The account survives: signing in with it works.
    const login = await api(ref.fw, "/api/login", { body: { email: NEW_USER.email, password: NEW_USER.password } });
    expect(login.status).toBe(200);
    expect(login.body).toEqual(res.body);
  });

  it("each sign-up and sign-in starts a new session id", async () => {
    const a = await api(ref.fw, "/api/signup", { body: NEW_USER });
    const b = await api(ref.fw, "/api/login", { body: { email: NEW_USER.email, password: NEW_USER.password } });
    const idA = SESSION_RE.exec(a.headers.get("set-cookie") ?? "")?.[1];
    const idB = SESSION_RE.exec(b.headers.get("set-cookie") ?? "")?.[1];
    expect(idA).toBeTruthy();
    expect(idB).toBeTruthy();
    expect(idA).not.toBe(idB);
  });

  it("validates sign-up: required fields, email format, password length, terms; company is optional", async () => {
    const empty = await api(ref.fw, "/api/signup", { body: {} });
    expect(empty.status).toBe(400);
    expect(Object.keys(empty.body.errors).sort()).toEqual(["email", "name", "password", "terms"]);
    expect(empty.body.errors).toMatchObject({
      name: "Enter your full name.",
      email: "Enter your work email.",
      password: "Create a password.",
      terms: "Agree to the Terms and Privacy Policy to continue.",
    });

    const bad = await api(ref.fw, "/api/signup", { body: { ...NEW_USER, email: "not-an-email", password: "short", terms: false } });
    expect(bad.status).toBe(400);
    expect(bad.body.errors).toEqual({
      email: "Enter an email address like name@studio.com.",
      password: "Use at least 8 characters.",
      terms: "Agree to the Terms and Privacy Policy to continue.",
    });

    const long = await api(ref.fw, "/api/signup", { body: { ...NEW_USER, name: "x".repeat(81), company: "y".repeat(101) } });
    expect(long.status).toBe(400);
    expect(long.body.errors).toEqual({ name: "Use 80 characters or fewer.", company: "Use 100 characters or fewer." });

    const noCompany = await api(ref.fw, "/api/signup", { body: { ...NEW_USER, company: "" } });
    expect(noCompany.status).toBe(201);
  });

  it("the password is not trimmed: 8 characters counting spaces", async () => {
    const res = await api(ref.fw, "/api/signup", { body: { ...NEW_USER, password: "  abc   " } });
    expect(res.status).toBe(201);
    expect((await api(ref.fw, "/api/login", { body: { email: NEW_USER.email, password: "abc" } })).status).toBe(401);
    expect((await api(ref.fw, "/api/login", { body: { email: NEW_USER.email, password: "  abc   " } })).status).toBe(200);
  });

  it("the same email twice (any case), or the demo account's email, answers 409 on the email field", async () => {
    expect((await api(ref.fw, "/api/signup", { body: NEW_USER })).status).toBe(201);
    for (const email of [NEW_USER.email, "MAYA@juniper.test", DEMO_ACCOUNT.email]) {
      const res = await api(ref.fw, "/api/signup", { body: { ...NEW_USER, email } });
      expect(res.status, email).toBe(409);
      expect(res.body).toEqual({ errors: { email: "An account with this email already exists" } });
    }
  });

  it("the name 'Crash' (full name or company) answers a bare 500 and stores nothing", async () => {
    for (const body of [{ ...NEW_USER, name: " Crash " }, { ...NEW_USER, company: "Crash" }]) {
      const res = await api(ref.fw, "/api/signup", { body });
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "Something went wrong" });
      expect(JSON.stringify(res.body)).not.toMatch(STACK_RE);
    }
    expect((await api(ref.fw, "/api/signup", { body: NEW_USER })).status).toBe(201);
  });

  it("a repeated Idempotency-Key replays the first sign-up instead of answering 409", async () => {
    const headers = { "idempotency-key": "signup-key-1" };
    const first = await api(ref.fw, "/api/signup", { body: NEW_USER, headers });
    const again = await api(ref.fw, "/api/signup", { body: NEW_USER, headers });
    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    expect(again.body).toEqual(first.body);
    expect(again.headers.get("idempotent-replayed")).toBe("true");
    const fresh = await api(ref.fw, "/api/signup", { body: NEW_USER, headers: { "idempotency-key": "signup-key-2" } });
    expect(fresh.status).toBe(409);
  });

  it("POST /api/login: the demo account signs in (email trimmed, any case); remember me keeps the cookie 30 days", async () => {
    const res = await api(ref.fw, "/api/login", { body: { email: " ALEX@fernway.test ", password: DEMO_ACCOUNT.password } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: "alex-rivera", name: "Alex Rivera", email: "alex@fernway.test" });
    expect(res.headers.get("set-cookie")).toMatch(SESSION_RE);

    const remembered = await api(ref.fw, "/api/login", { body: { ...DEMO_ACCOUNT, remember: true } });
    expect(remembered.status).toBe(200);
    expect(remembered.headers.get("set-cookie")).toMatch(REMEMBER_RE);
  });

  it("wrong or unknown credentials answer 401 with one message and no cookie; empty fields answer 400", async () => {
    for (const body of [
      { email: DEMO_ACCOUNT.email, password: "wrong-password" },
      { email: "nobody@fernway.test", password: DEMO_ACCOUNT.password },
      { email: DEMO_ACCOUNT.email, password: ` ${DEMO_ACCOUNT.password}` },
    ]) {
      const res = await api(ref.fw, "/api/login", { body });
      expect(res.status, JSON.stringify(body)).toBe(401);
      expect(res.body).toEqual({ error: "Email or password is incorrect" });
      expect(res.headers.get("set-cookie")).toBeNull();
    }
    const empty = await api(ref.fw, "/api/login", { body: {} });
    expect(empty.status).toBe(400);
    expect(empty.body.errors).toEqual({ email: "Enter your email address.", password: "Enter your password." });
    const badEmail = await api(ref.fw, "/api/login", { body: { email: "alex", password: "x" } });
    expect(badEmail.body.errors).toEqual({ email: "Enter an email address like name@studio.com." });
  });

  it("the session cookie names the signed-in user on the server", async () => {
    const app = createApp({ modules: undefined });
    const { store, ctx } = app;
    const route = app.router.match("POST", "/api/signup");
    expect(route).not.toBeNull();
    const result = await route!.route.handler({
      body: { ...NEW_USER },
      cookies: {},
      params: {},
      query: new URLSearchParams(),
      idempotencyKey: null,
    } as never);
    expect(result.status).toBe(201);
    const sid = SESSION_RE.exec(String(result.headers?.["set-cookie"]))?.[1];
    expect(ctx.sessionUser({ fernway_session: sid! })?.email).toBe(NEW_USER.email);

    // Stored hashed (scrypt), never in plain text.
    const user = store.users.find((u: { email: string }) => u.email === NEW_USER.email)!;
    expect(user).toBeTruthy();
    expect(JSON.stringify(user)).not.toContain(NEW_USER.password);
    expect(user.passwordHash).toMatch(/^scrypt\$/);
    expect(verifyPassword(NEW_USER.password, user.passwordHash)).toBe(true);
  });
});

describe("account API with W09", () => {
  const ref = useFernway("W09");

  it("sign-up and sign-in cookies lose HttpOnly under W09", async () => {
    const res = await api(ref.fw, "/api/signup", { body: NEW_USER });
    expect(res.headers.get("set-cookie")).toMatch(new RegExp(`^fernway_session=${UUID}; Path=/; SameSite=Lax$`));
  });
});

// ---- /signup in a browser --------------------------------------------------------------------

describe("/signup (clean mode)", () => {
  const ref = useFernway("none");

  it("renders the Create account form with labelled fields, autocomplete, the art and the links; no errors on load", async () => {
    const { page, events, close } = await openSignup(ref.fw);
    try {
      expect(await page.title()).toBe("Fernway: Create account");
      const name = page.getByLabel("Full name", { exact: true });
      const email = page.getByLabel("Work email", { exact: true });
      const password = page.getByLabel("Password", { exact: true });
      const company = page.getByLabel("Company", { exact: true });
      expect(await name.getAttribute("autocomplete")).toBe("name");
      expect(await email.getAttribute("autocomplete")).toBe("email");
      expect(await email.getAttribute("type")).toBe("email");
      expect(await password.getAttribute("autocomplete")).toBe("new-password");
      expect(await password.getAttribute("type")).toBe("password");
      expect(await company.getAttribute("autocomplete")).toBe("organization");
      for (const field of [name, email, password]) expect(await field.getAttribute("required")).not.toBeNull();
      expect(await company.getAttribute("required")).toBeNull();
      const terms = page.getByRole("checkbox", { name: "I agree to the Terms and Privacy Policy" });
      expect(await terms.getAttribute("aria-checked")).toBe("false");
      expect(await terms.getAttribute("aria-required")).toBe("true");

      const form = page.locator("form");
      expect(await form.count()).toBe(1);
      expect(await form.getAttribute("novalidate")).not.toBeNull();
      expect(await signupButton(page).getAttribute("type")).toBe("submit");
      expect(await page.getByRole("button", { name: "Continue with Google" }).getAttribute("type")).toBe("button");
      const signIn = page.getByRole("link", { name: "Already have an account? Sign in" });
      expect(await signIn.getAttribute("href")).toBe("/login");

      const art = page.locator('img[src="/images/auth-art.webp"]');
      expect(await art.isVisible()).toBe(true);
      expect(await art.getAttribute("alt")).toBeTruthy();

      await page.waitForLoadState("networkidle");
      expect(events.consoleErrors).toEqual([]);
      expect(events.pageErrors).toEqual([]);
      expect(events.failedRequests).toEqual([]);
      expect(events.badResponses).toEqual([]);
      expect(events.requests.every((r) => r.url().startsWith(ref.fw.url))).toBe(true);
    } finally {
      await close();
    }
  });

  it("an empty submit marks each required field invalid, links a visible message, focuses the first and announces the errors", async () => {
    const { page, close } = await openSignup(ref.fw);
    try {
      const before = await liveTexts(page);
      await signupButton(page).click();
      const name = page.getByLabel("Full name", { exact: true });
      await page.waitForFunction(() => document.activeElement?.getAttribute("name") === "name");
      const expected: [Locator, string][] = [
        [name, "Enter your full name."],
        [page.getByLabel("Work email", { exact: true }), "Enter your work email."],
        [page.getByLabel("Password", { exact: true }), "Create a password."],
        [page.getByRole("checkbox", { name: "I agree to the Terms and Privacy Policy" }), "Agree to the Terms and Privacy Policy to continue."],
      ];
      for (const [control, message] of expected) {
        expect(await control.getAttribute("aria-invalid")).toBe("true");
        expect(await describedBy(page, control)).toContain(message);
      }
      const company = page.getByLabel("Company", { exact: true });
      expect(await company.getAttribute("aria-invalid")).toBeNull();
      expect(await page.getByRole("alert").filter({ hasText: "There are 4 problems with this form" }).count()).toBe(1);
      expect(await liveTexts(page)).not.toEqual(before);

      // Then validation runs on change: fixing a field clears its error.
      await name.fill("Maya Patel");
      await page.waitForFunction(() => !document.querySelector('[name="name"]')?.hasAttribute("aria-invalid"));
      expect(await describedBy(page, name)).not.toContain("Enter your full name.");
      expect(await signupButton(page).isEnabled()).toBe(true);
    } finally {
      await close();
    }
  });

  it("checks the email format and the password length on the client", async () => {
    const { page, events, close } = await openSignup(ref.fw);
    try {
      await fillSignup(page, { email: "maya@", password: "short" });
      await signupButton(page).click();
      const email = page.getByLabel("Work email", { exact: true });
      await page.waitForFunction(() => document.activeElement?.getAttribute("name") === "email");
      expect(await describedBy(page, email)).toContain("Enter an email address like name@studio.com.");
      expect(await describedBy(page, page.getByLabel("Password", { exact: true }))).toContain("Use at least 8 characters.");
      expect(events.requests.some((r) => r.url().endsWith("/api/signup"))).toBe(false);
    } finally {
      await close();
    }
  });

  it("password show/hide button toggles the field and its aria-pressed; the strength meter reads Weak / Fair / Strong", async () => {
    const { page, close } = await openSignup(ref.fw);
    try {
      const password = page.getByLabel("Password", { exact: true });
      const show = page.getByRole("button", { name: "Show password" });
      expect(await show.getAttribute("aria-pressed")).toBe("false");
      await password.fill("abc");
      await show.click();
      expect(await password.getAttribute("type")).toBe("text");
      const hide = page.getByRole("button", { name: "Hide password" });
      expect(await hide.getAttribute("aria-pressed")).toBe("true");
      await hide.click();
      expect(await password.getAttribute("type")).toBe("password");

      const strength = page.getByRole("status").filter({ hasText: "Password strength" });
      expect(await strength.textContent()).toContain("Weak");
      await password.fill("password1");
      await strength.filter({ hasText: "Fair" }).waitFor();
      await password.fill("Tr0ub4dor&3-horse");
      await strength.filter({ hasText: "Strong" }).waitFor();
      // The meter is described to the field as well as announced.
      expect(await describedBy(page, password)).toContain("8 or more characters");
    } finally {
      await close();
    }
  });

  it("pasting into the password field is allowed", async () => {
    const { page, close } = await openSignup(ref.fw);
    try {
      const prevented = await page.getByLabel("Password", { exact: true }).evaluate((el) => {
        const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: new DataTransfer() });
        el.dispatchEvent(event);
        return event.defaultPrevented;
      });
      expect(prevented).toBe(false);
    } finally {
      await close();
    }
  });

  it("golden path: pending button is disabled + busy, the save carries an Idempotency-Key, then /onboarding greets the new account", async () => {
    const { page, events, close } = await openSignup(ref.fw);
    try {
      await fillSignup(page);
      const { release } = await hold(page, "/api/signup");
      const request = page.waitForRequest((r) => r.url().endsWith("/api/signup") && r.method() === "POST");
      await signupButton(page).click();
      const sent: Request = await request;
      expect(sent.headers()["idempotency-key"]).toMatch(UUID_RE);
      expect(JSON.parse(sent.postData() ?? "{}")).toEqual(NEW_USER);

      const busy = signupButton(page);
      await page.locator("button[type=submit][aria-busy=true]:disabled").waitFor();
      expect(await busy.isDisabled()).toBe(true);
      expect(await busy.getAttribute("aria-busy")).toBe("true");
      release();

      await page.waitForURL(`${ref.fw.url}/onboarding`);
      await page.getByRole("heading", { level: 1, name: "Set up your workspace" }).waitFor();
      await toast(page, "Welcome to Fernway, Maya!").waitFor();
      await page.getByRole("status").filter({ hasText: "Account created" }).waitFor();

      await page.goto(`${ref.fw.url}/app`, { waitUntil: "networkidle" });
      await page.getByText("Signed in as Maya Patel · Demo workspace").first().waitFor();
      await page.reload({ waitUntil: "networkidle" });
      await page.getByText("Signed in as Maya Patel · Demo workspace").first().waitFor();

      expect((await api(ref.fw, "/api/login", { body: { email: NEW_USER.email, password: NEW_USER.password } })).status).toBe(200);
      expect(events.consoleErrors).toEqual([]);
      expect(events.pageErrors).toEqual([]);
      expect(events.failedRequests).toEqual([]);
      expect(events.badResponses).toEqual([]);
    } finally {
      await close();
    }
  });

  it("keyboard only: Tab to the terms checkbox, Space checks it, Enter on Create account submits", async () => {
    const { page, close } = await openSignup(ref.fw);
    try {
      await fillSignup(page, { terms: false });
      await page.getByLabel("Company", { exact: true }).focus();
      await page.keyboard.press("Tab");
      const terms = page.getByRole("checkbox", { name: "I agree to the Terms and Privacy Policy" });
      expect(await terms.evaluate((el) => el === document.activeElement)).toBe(true);
      await page.keyboard.press("Space");
      expect(await terms.getAttribute("aria-checked")).toBe("true");
      await page.keyboard.press("Tab");
      expect(await signupButton(page).evaluate((el) => el === document.activeElement)).toBe(true);
      await page.keyboard.press("Enter");
      await page.waitForURL(`${ref.fw.url}/onboarding`);
    } finally {
      await close();
    }
  });

  it("an email that already has an account shows the 409 on the Work email field, keeps the values and re-enables the button", async () => {
    const { page, close } = await openSignup(ref.fw);
    try {
      await fillSignup(page, { email: DEMO_ACCOUNT.email });
      await signupButton(page).click();
      const email = page.getByLabel("Work email", { exact: true });
      await page.waitForFunction(() => document.querySelector('[name="email"]')?.getAttribute("aria-invalid") === "true");
      expect(await describedBy(page, email)).toContain("An account with this email already exists");
      expect(await email.evaluate((el) => el === document.activeElement)).toBe(true);
      await toast(page, "Couldn't create your account").waitFor();
      expect(await page.getByRole("alert").filter({ hasText: "There is 1 problem with this form" }).count()).toBe(1);
      expect(await page.getByLabel("Full name", { exact: true }).inputValue()).toBe(NEW_USER.name);
      expect(await email.inputValue()).toBe(DEMO_ACCOUNT.email);
      expect(await signupButton(page).isEnabled()).toBe(true);
      expect(page.url()).toBe(`${ref.fw.url}/signup`);
    } finally {
      await close();
    }
  });

  it("a server failure (name 'Crash') shows an inline alert and a toast, keeps the values and re-enables the button", async () => {
    const { page, close } = await openSignup(ref.fw);
    try {
      await fillSignup(page, { name: "Crash" });
      await signupButton(page).click();
      const alert = page.getByRole("alert").filter({ hasText: "Couldn't create your account" });
      await alert.waitFor();
      expect(await alert.textContent()).toContain("Something went wrong on our side. Please try again.");
      await toast(page, "Couldn't create your account").waitFor();
      expect(await page.getByLabel("Full name", { exact: true }).inputValue()).toBe("Crash");
      expect(await page.getByLabel("Work email", { exact: true }).inputValue()).toBe(NEW_USER.email);
      expect(await page.getByLabel("Password", { exact: true }).inputValue()).toBe(NEW_USER.password);
      expect(await page.getByRole("checkbox", { name: "I agree to the Terms and Privacy Policy" }).getAttribute("aria-checked")).toBe("true");
      expect(await signupButton(page).isEnabled()).toBe(true);
      expect(page.url()).toBe(`${ref.fw.url}/signup`);

      // Fixing the name and retrying succeeds, and the stale alert goes away.
      await page.getByLabel("Full name", { exact: true }).fill("Maya Patel");
      await signupButton(page).click();
      await page.waitForURL(`${ref.fw.url}/onboarding`);
    } finally {
      await close();
    }
  });

  it("a network failure shows the connection message", async () => {
    const { page, close } = await openSignup(ref.fw);
    try {
      await page.route("**/api/signup", (route) => route.abort("failed"));
      await fillSignup(page);
      await signupButton(page).click();
      await page.getByRole("alert").filter({ hasText: "We couldn't reach Fernway" }).waitFor();
      expect(await signupButton(page).isEnabled()).toBe(true);
    } finally {
      await close();
    }
  });

  it("Continue with Google shows a toast and an inline status note", async () => {
    const { page, close } = await openSignup(ref.fw);
    try {
      const note = page.getByRole("status").filter({ hasText: "Google sign-in isn't set up in this demo" });
      expect(await note.count()).toBe(0);
      await page.getByRole("button", { name: "Continue with Google" }).click();
      await toast(page, "Google sign-in isn't set up in this demo").waitFor();
      await note.waitFor();
      expect(await note.isVisible()).toBe(true);
    } finally {
      await close();
    }
  });

  it("the Sign in link navigates on the client", async () => {
    const { page, events, close } = await openSignup(ref.fw);
    try {
      await page.getByRole("link", { name: "Already have an account? Sign in" }).click();
      await page.getByRole("heading", { level: 1, name: "Welcome back" }).waitFor();
      expect(page.url()).toBe(`${ref.fw.url}/login`);
      expect(events.requests.filter((r) => r.resourceType() === "document")).toHaveLength(1);
    } finally {
      await close();
    }
  });

  it("text inputs show a visible focus ring (clean mode)", async () => {
    const { page, close } = await openSignup(ref.fw);
    try {
      for (const label of ["Full name", "Work email", "Password", "Company"]) {
        const styles = await focusStyles(page.getByLabel(label, { exact: true }));
        expect(styles.focused.focusVisible, label).toBe(true);
        expect(visibleFocus(styles), label).toBe(true);
      }
    } finally {
      await close();
    }
  });

  it.each(["light", "dark"] as const)("passes axe (Run Hound's tags) in %s mode, at rest, with errors and with the Google note", async (colorScheme) => {
    const { page, close } = await openSignup(ref.fw, { colorScheme });
    try {
      expect(await axeViolations(page), "rest").toEqual([]);
      await page.getByLabel("Password", { exact: true }).fill("abc");
      await signupButton(page).click();
      await page.getByRole("alert").filter({ hasText: "problems" }).waitFor();
      expect(await axeViolations(page), "errors").toEqual([]);
      await page.getByRole("button", { name: "Continue with Google" }).click();
      await page.getByRole("status").filter({ hasText: "Google sign-in" }).waitFor();
      expect(await axeViolations(page), "google note").toEqual([]);
    } finally {
      await close();
    }
  });

  it("reflows at 320px and 390px (no horizontal scroll); the art is hidden below md", async () => {
    for (const width of [320, 390]) {
      const { page, close } = await openSignup(ref.fw, { viewport: { width, height: 800 } });
      try {
        expect(await horizontalOverflow(page), `${width}px`).toBe(false);
        expect(await page.locator('img[src="/images/auth-art.webp"]').isVisible()).toBe(false);
        await signupButton(page).click();
        await page.getByRole("alert").filter({ hasText: "problems" }).waitFor();
        expect(await horizontalOverflow(page), `${width}px with errors`).toBe(false);
      } finally {
        await close();
      }
    }
  });

  it("every button, checkbox and link in the form is at least 24x24", async () => {
    const { page, close } = await openSignup(ref.fw);
    try {
      const small = await page.evaluate(() =>
        [...document.querySelectorAll("main button, main [role=checkbox], main a")]
          .map((el) => ({ el, r: el.getBoundingClientRect() }))
          .filter(({ r }) => r.width > 0 && (r.width < 24 || r.height < 24))
          .map(({ el }) => el.outerHTML.slice(0, 120)),
      );
      expect(small).toEqual([]);
    } finally {
      await close();
    }
  });
});

describe("/signup with W07 (focus ring removed on the inputs)", () => {
  const ref = useFernway("W07");

  it("the four text inputs show no focus indicator; the checkbox, buttons and /login keep theirs", async () => {
    const { page, close } = await openSignup(ref.fw);
    try {
      for (const label of ["Full name", "Work email", "Password", "Company"]) {
        const styles = await focusStyles(page.getByLabel(label, { exact: true }));
        expect(styles.focused.focusVisible, label).toBe(true);
        expect(styles.focused.outlineStyle, label).toBe("none");
        expect(visibleFocus(styles), label).toBe(false);
      }
      await page.getByLabel("Company", { exact: true }).focus();
      await page.keyboard.press("Tab");
      const terms = await page.evaluate(() => {
        const el = document.activeElement!;
        return { role: el.getAttribute("role"), shadow: getComputedStyle(el).boxShadow };
      });
      expect(terms.role).toBe("checkbox");
      expect(terms.shadow).not.toBe("none");

      // Everything else still works: the form submits.
      await fillSignup(page);
      await signupButton(page).click();
      await page.waitForURL(`${ref.fw.url}/onboarding`);

      await page.goto(`${ref.fw.url}/login`, { waitUntil: "networkidle" });
      expect(visibleFocus(await focusStyles(page.getByLabel("Email", { exact: true })))).toBe(true);
    } finally {
      await close();
    }
  });
});

// ---- /login in a browser ---------------------------------------------------------------------

describe("/login (clean mode)", () => {
  const ref = useFernway("none");

  it("renders the Sign in form: labelled fields, autocomplete, Remember me, Forgot password link; no errors on load", async () => {
    const { page, events, close } = await openLogin(ref.fw);
    try {
      expect(await page.title()).toBe("Fernway: Sign in");
      const email = page.getByLabel("Email", { exact: true });
      const password = page.getByLabel("Password", { exact: true });
      expect(await email.getAttribute("type")).toBe("email");
      expect(await email.getAttribute("autocomplete")).toBe("email");
      expect(await password.getAttribute("autocomplete")).toBe("current-password");
      expect(await email.getAttribute("required")).not.toBeNull();
      expect(await password.getAttribute("required")).not.toBeNull();
      expect(await page.getByRole("checkbox", { name: "Remember me" }).getAttribute("aria-checked")).toBe("false");
      expect(await page.getByRole("link", { name: "Forgot password?" }).getAttribute("href")).toBe("/login#forgot");
      expect(await page.getByRole("link", { name: "New to Fernway? Create an account" }).getAttribute("href")).toBe("/signup");
      expect(await signInButton(page).getAttribute("type")).toBe("submit");
      expect(await page.getByRole("button", { name: "Show password" }).getAttribute("aria-pressed")).toBe("false");
      expect(await page.locator("form").count()).toBe(1);
      await page.waitForLoadState("networkidle");
      expect(events.consoleErrors).toEqual([]);
      expect(events.pageErrors).toEqual([]);
      expect(events.failedRequests).toEqual([]);
      expect(events.badResponses).toEqual([]);
    } finally {
      await close();
    }
  });

  it("an empty submit marks both fields invalid with linked messages, focuses Email and announces the errors", async () => {
    const { page, events, close } = await openLogin(ref.fw);
    try {
      const before = await liveTexts(page);
      await signInButton(page).click();
      await page.waitForFunction(() => document.activeElement?.getAttribute("name") === "email");
      const email = page.getByLabel("Email", { exact: true });
      const password = page.getByLabel("Password", { exact: true });
      expect(await email.getAttribute("aria-invalid")).toBe("true");
      expect(await password.getAttribute("aria-invalid")).toBe("true");
      expect(await describedBy(page, email)).toContain("Enter your email address.");
      expect(await describedBy(page, password)).toContain("Enter your password.");
      expect(await page.getByRole("alert").filter({ hasText: "There are 2 problems with this form" }).count()).toBe(1);
      expect(await liveTexts(page)).not.toEqual(before);
      expect(events.requests.some((r) => r.url().endsWith("/api/login"))).toBe(false);
    } finally {
      await close();
    }
  });

  it("wrong credentials: 401 shown in a role=alert above the form (no toast), values kept, button enabled", async () => {
    const { page, events, close } = await openLogin(ref.fw);
    try {
      await page.getByLabel("Email", { exact: true }).fill(DEMO_ACCOUNT.email);
      await page.getByLabel("Password", { exact: true }).fill("not-the-password");
      await signInButton(page).click();
      const alert = page.getByRole("alert").filter({ hasText: "Email or password is incorrect" });
      await alert.waitFor();
      expect(await alert.evaluate((el) => !!(el.compareDocumentPosition(document.querySelector("form")!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
      expect(await page.getByLabel("Email", { exact: true }).inputValue()).toBe(DEMO_ACCOUNT.email);
      expect(await page.getByLabel("Password", { exact: true }).inputValue()).toBe("not-the-password");
      expect(await signInButton(page).isEnabled()).toBe(true);
      expect(await page.locator("[data-sonner-toast]").count()).toBe(0);
      expect(events.pageErrors).toEqual([]);
      expect(page.url()).toBe(`${ref.fw.url}/login`);
    } finally {
      await close();
    }
  });

  it("golden path: pending state, then /app shows the signed-in name; the alert from a failed try is gone", async () => {
    const { page, events, close } = await openLogin(ref.fw);
    try {
      await page.getByLabel("Email", { exact: true }).fill(DEMO_ACCOUNT.email);
      await page.getByLabel("Password", { exact: true }).fill(DEMO_ACCOUNT.password);
      await page.getByRole("checkbox", { name: "Remember me" }).click();
      const { release } = await hold(page, "/api/login");
      const request = page.waitForRequest((r) => r.url().endsWith("/api/login"));
      await signInButton(page).click();
      const sent = await request;
      expect(sent.headers()["idempotency-key"]).toMatch(UUID_RE);
      expect(JSON.parse(sent.postData() ?? "{}")).toEqual({ ...DEMO_ACCOUNT, remember: true });
      await page.locator("button[type=submit][aria-busy=true]:disabled").waitFor();
      expect(await signInButton(page).isDisabled()).toBe(true);
      release();
      await page.waitForURL(`${ref.fw.url}/app`);
      await page.getByRole("heading", { level: 1, name: "Dashboard" }).waitFor();
      await toast(page, "Welcome back, Alex!").waitFor();
      await page.getByText("Signed in as Alex Rivera · Demo workspace").first().waitFor();
      const cookie = (await page.context().cookies()).find((c) => c.name === "fernway_session");
      expect(cookie?.httpOnly).toBe(true);
      expect(cookie?.expires).toBeGreaterThan(Date.now() / 1000 + 29 * 86400);
      expect(events.consoleErrors).toEqual([]);
      expect(events.failedRequests).toEqual([]);
      expect(events.badResponses).toEqual([]);
    } finally {
      await close();
    }
  });

  it("?next= sends you back to a same-origin page after signing in; anything else goes to /app", async () => {
    for (const [next, landing] of [
      ["/app/settings", "/app/settings"],
      ["//evil.test/steal", "/app"],
      ["https://evil.test/", "/app"],
    ] as const) {
      const { page, close } = await openLogin(ref.fw, `/login?next=${encodeURIComponent(next)}`);
      try {
        await page.getByLabel("Email", { exact: true }).fill(DEMO_ACCOUNT.email);
        await page.getByLabel("Password", { exact: true }).fill(DEMO_ACCOUNT.password);
        await signInButton(page).click();
        await page.waitForURL(`${ref.fw.url}${landing}`);
      } finally {
        await close();
      }
    }
  });

  it("a server failure shows an inline alert and a toast; values kept, button enabled", async () => {
    const { page, close } = await openLogin(ref.fw);
    try {
      await page.route("**/api/login", (route) => route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"Something went wrong"}' }));
      await page.getByLabel("Email", { exact: true }).fill(DEMO_ACCOUNT.email);
      await page.getByLabel("Password", { exact: true }).fill(DEMO_ACCOUNT.password);
      await signInButton(page).click();
      const alert = page.getByRole("alert").filter({ hasText: "Couldn't sign you in" });
      await alert.waitFor();
      expect(await alert.textContent()).toContain("Something went wrong on our side. Please try again.");
      await toast(page, "Couldn't sign you in").waitFor();
      expect(await page.getByLabel("Password", { exact: true }).inputValue()).toBe(DEMO_ACCOUNT.password);
      expect(await signInButton(page).isEnabled()).toBe(true);
    } finally {
      await close();
    }
  });

  it("Forgot password? goes to /login#forgot and shows a short note in a status region (no second form)", async () => {
    const { page, close } = await openLogin(ref.fw);
    try {
      const note = page.getByRole("status").filter({ hasText: "Password resets aren't available in this demo" });
      expect(await note.count()).toBe(0);
      await page.getByRole("link", { name: "Forgot password?" }).click();
      await note.waitFor();
      expect(page.url()).toBe(`${ref.fw.url}/login#forgot`);
      expect(await page.locator("form").count()).toBe(1);
    } finally {
      await close();
    }
  });

  it("opening /login#forgot directly shows the note too", async () => {
    const { page, close } = await openLogin(ref.fw, "/login#forgot");
    try {
      await page.getByRole("status").filter({ hasText: "Password resets aren't available in this demo" }).waitFor();
    } finally {
      await close();
    }
  });

  it("keyboard only: type, Tab to Remember me, Space, Enter signs in; the page never shows the demo password", async () => {
    const { page, close } = await openLogin(ref.fw);
    try {
      expect(await page.locator("body").textContent()).not.toContain(DEMO_ACCOUNT.password);
      await page.getByLabel("Email", { exact: true }).focus();
      await page.keyboard.type(DEMO_ACCOUNT.email);
      await page.getByLabel("Password", { exact: true }).focus();
      await page.keyboard.type(DEMO_ACCOUNT.password);
      await page.keyboard.press("Tab"); // Show password
      await page.keyboard.press("Tab");
      const remember = page.getByRole("checkbox", { name: "Remember me" });
      expect(await remember.evaluate((el) => el === document.activeElement)).toBe(true);
      await page.keyboard.press("Space");
      expect(await remember.getAttribute("aria-checked")).toBe("true");
      await page.keyboard.press("Tab");
      expect(await signInButton(page).evaluate((el) => el === document.activeElement)).toBe(true);
      await page.keyboard.press("Enter");
      await page.waitForURL(`${ref.fw.url}/app`);
    } finally {
      await close();
    }
  });

  it("the demo workspace link opens /app without signing in", async () => {
    const { page, close } = await openLogin(ref.fw);
    try {
      await page.getByRole("link", { name: "Explore the demo workspace" }).click();
      await page.getByRole("heading", { level: 1, name: "Dashboard" }).waitFor();
      await page.getByText("Signed in as Alex Rivera · Demo workspace").first().waitFor();
    } finally {
      await close();
    }
  });

  it.each(["light", "dark"] as const)("passes axe in %s mode at rest, with field errors, after a 401 and with the forgot note", async (colorScheme) => {
    const { page, close } = await openLogin(ref.fw, "/login", { colorScheme });
    try {
      expect(await axeViolations(page), "rest").toEqual([]);
      await signInButton(page).click();
      await page.getByRole("alert").filter({ hasText: "problems" }).waitFor();
      expect(await axeViolations(page), "errors").toEqual([]);
      await page.getByLabel("Email", { exact: true }).fill(DEMO_ACCOUNT.email);
      await page.getByLabel("Password", { exact: true }).fill("nope-nope");
      await signInButton(page).click();
      await page.getByRole("alert").filter({ hasText: "Email or password is incorrect" }).waitFor();
      expect(await axeViolations(page), "401").toEqual([]);
      await page.getByRole("link", { name: "Forgot password?" }).click();
      await page.getByRole("status").filter({ hasText: "Password resets" }).waitFor();
      expect(await axeViolations(page), "forgot").toEqual([]);
    } finally {
      await close();
    }
  });

  it("reflows at 320px (no horizontal scroll), also with the 401 alert", async () => {
    const { page, close } = await openLogin(ref.fw, "/login", { viewport: { width: 320, height: 800 } });
    try {
      expect(await horizontalOverflow(page)).toBe(false);
      await page.getByLabel("Email", { exact: true }).fill(DEMO_ACCOUNT.email);
      await page.getByLabel("Password", { exact: true }).fill("nope-nope");
      await signInButton(page).click();
      await page.getByRole("alert").filter({ hasText: "Email or password is incorrect" }).waitFor();
      expect(await horizontalOverflow(page)).toBe(false);
    } finally {
      await close();
    }
  });
});

describe("/login with W10 (errors in red text only)", () => {
  const ref = useFernway("W10");

  it("an empty submit shows red text, but nothing is marked invalid, linked or announced", async () => {
    const { page, close } = await openLogin(ref.fw);
    try {
      const before = await liveTexts(page);
      await signInButton(page).click();
      await page.getByText("Enter your email address.").waitFor();
      await page.getByText("Enter your password.").waitFor();
      for (const label of ["Email", "Password"]) {
        const control = page.getByLabel(label, { exact: true });
        expect(await control.getAttribute("aria-invalid"), label).toBeNull();
        expect(await control.getAttribute("aria-describedby"), label).toBeNull();
      }
      expect(await liveTexts(page)).toEqual(before);
      const color = await page.getByText("Enter your email address.").evaluate((el) => getComputedStyle(el).color);
      expect(color).not.toBe(await page.getByLabel("Email", { exact: true }).evaluate((el) => getComputedStyle(el).color));
    } finally {
      await close();
    }
  });

  it("wrong credentials: the message is red text, not an alert and not in any live region", async () => {
    const { page, close } = await openLogin(ref.fw);
    try {
      await page.getByLabel("Email", { exact: true }).fill(DEMO_ACCOUNT.email);
      await page.getByLabel("Password", { exact: true }).fill("not-the-password");
      await signInButton(page).click();
      await page.getByText("Email or password is incorrect").waitFor();
      expect(await page.locator('[role=alert], [role=status], [aria-live]:not([aria-live="off"])').filter({ hasText: "Email or password is incorrect" }).count()).toBe(0);
      // The right password still signs in.
      await page.getByLabel("Password", { exact: true }).fill(DEMO_ACCOUNT.password);
      await signInButton(page).click();
      await page.waitForURL(`${ref.fw.url}/app`);
    } finally {
      await close();
    }
  });

  it("server failures are unchanged under W10: still an announced alert and a toast", async () => {
    const { page, close } = await openLogin(ref.fw);
    try {
      await page.route("**/api/login", (route) => route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"Something went wrong"}' }));
      await page.getByLabel("Email", { exact: true }).fill(DEMO_ACCOUNT.email);
      await page.getByLabel("Password", { exact: true }).fill(DEMO_ACCOUNT.password);
      await signInButton(page).click();
      await page.getByRole("alert").filter({ hasText: "Couldn't sign you in" }).waitFor();
      await toast(page, "Couldn't sign you in").waitFor();
    } finally {
      await close();
    }
  });

  it("W10 only touches /login: /signup still announces its errors", async () => {
    const { page, close } = await openSignup(ref.fw);
    try {
      await signupButton(page).click();
      await page.getByRole("alert").filter({ hasText: "There are 4 problems" }).waitFor();
      expect(await page.getByLabel("Full name", { exact: true }).getAttribute("aria-invalid")).toBe("true");
    } finally {
      await close();
    }
  });
});

// ---- the 404 view ------------------------------------------------------------------------------

describe("the Page not found view", () => {
  const ref = useFernway("none");

  it("answers 404 with the Page not found view, names the path and links home and to the dashboard", async () => {
    const { page, events, close } = await openPage(ref.fw, "/projects/archive", { reducedMotion: "reduce" });
    try {
      await page.getByRole("heading", { level: 1, name: "Page not found" }).waitFor();
      expect(await page.title()).toBe("Fernway: Page not found");
      expect(await page.locator("main").textContent()).toContain("/projects/archive");
      expect(events.badResponses).toEqual([`404 ${ref.fw.url}/projects/archive`]);
      expect(events.pageErrors).toEqual([]);
      expect(events.failedRequests).toEqual([]);
      await page.getByRole("link", { name: "Back to home" }).click();
      await page.waitForURL(`${ref.fw.url}/`);
      await page.goBack();
      await page.getByRole("link", { name: "Open the dashboard" }).click();
      await page.getByRole("heading", { level: 1, name: "Dashboard" }).waitFor();
    } finally {
      await close();
    }
  });

  it.each(["light", "dark"] as const)("passes axe in %s mode and reflows at 320px", async (colorScheme) => {
    const { page, close } = await openPage(ref.fw, "/a/very/long/path/that/does/not/exist/anywhere-at-all", {
      colorScheme,
      reducedMotion: "reduce",
      viewport: { width: 320, height: 800 },
    });
    try {
      await page.getByRole("heading", { level: 1, name: "Page not found" }).waitFor();
      expect(await axeViolations(page)).toEqual([]);
      expect(await horizontalOverflow(page)).toBe(false);
    } finally {
      await close();
    }
  });
});
