/**
 * Fernway's sign-in and session modes (docs/v2-spec.md "Fernway (0.6.0)", CONTRACT.md "Sign-in and session modes"):
 * FERNWAY_LOGIN=two-step (/login asks for the email and Continue, then shows the password on the same page, for any
 * email) and FERNWAY_SESSION=session-storage (the SPA keeps a token in sessionStorage and sends it as
 * "Authorization: Bearer <token>"; the server sets no session cookie). Both work in clean mode and with the planted bugs;
 * the session-dependent bugs are checked here in session-storage mode (V02, V03, V06, V07, V08, V09, W09).
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import type { BrowserContext, Page, Request } from "playwright";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../server/app.mjs";
import { LOGIN_MODES, ModeConfigError, parseLoginMode, parseSessionMode, SESSION_MODES } from "../server/modes.mjs";
import {
  ACCOUNTS,
  api,
  axeViolations,
  closeBrowser,
  FERNWAY_ROOT,
  freePort,
  getBrowser,
  openPage,
  profileUrl,
  seedSessionToken,
  SESSION_TOKEN_KEY,
  signInToken,
  startFernway,
  useFernway,
  type Fernway,
} from "./support.js";

afterAll(closeBrowser);

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const SIGN_IN_FIRST = { error: "Sign in to continue" };
const NEW_USER = { name: "Maya Patel", email: "maya@juniper.test", password: "Tr0ub4dor&3-horse", company: "Juniper Studio", terms: true };

interface Task {
  id: string;
  title: string;
  projectId: string;
  done: boolean;
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const toast = (page: Page, text: string) => page.locator("[data-sonner-toast]").filter({ hasText: text });

/** Runs `node server/index.mjs` with `env` until it exits (or 10 s pass) and returns what it printed. */
function runServer(env: Record<string, string>): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["server/index.mjs"], { cwd: FERNWAY_ROOT, env: { ...process.env, HOST: "127.0.0.1", ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
    child.once("error", reject);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

/** The /api/* paths a page asked for, apart from the runtime config every page loads first. */
const apiCalls = (requests: Request[]) =>
  requests.map((r) => `${r.method()} ${new URL(r.url()).pathname}`).filter((p) => p.includes(" /api/") && !p.endsWith(" /api/__config"));

/** The labels of the sign-in form's fields and the names of its buttons, as a screen reader would list them. */
async function formShape(page: Page) {
  const form = page.locator("form");
  return {
    fields: await form.locator("input:not([type=hidden]), button[role=checkbox]").evaluateAll((els) =>
      els.map((el) => `${el.getAttribute("type") ?? el.getAttribute("role")}:${(el as HTMLInputElement).labels?.[0]?.textContent?.trim() ?? el.getAttribute("aria-labelledby") ?? ""}`),
    ),
    buttons: (await form.locator("button[type=submit]").allTextContents()).map((t) => t.trim()),
    passwords: await page.locator("input[type=password]").count(),
  };
}

async function openLogin(fw: Fernway, path = "/login") {
  const opened = await openPage(fw, path, { reducedMotion: "reduce" });
  await opened.page.getByRole("heading", { level: 1, name: "Welcome back" }).waitFor();
  return opened;
}

/** Signs Alex in on /login through both steps of the two-step form (email, Continue, then the password). */
async function twoStepSignIn(page: Page, email: string, password: string) {
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const field = page.getByLabel("Password", { exact: true });
  await field.waitFor();
  await field.fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

/**
 * From a blank page on another site (localhost, while Fernway is 127.0.0.1), in `context`, submits a plain HTML form
 * (form-encoded, no preflight) to POST /api/tasks, the way Run Hound's csrf check forges the Quick add save.
 */
async function forgeTaskFromAnotherSite(fw: Fernway, context: BrowserContext, title: string): Promise<void> {
  const attacker = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end('<!doctype html><html lang="en"><head><title>Another site</title></head><body></body></html>');
  });
  await new Promise<void>((resolve) => attacker.listen(0, "127.0.0.1", resolve));
  const page = await context.newPage();
  try {
    await page.goto(`http://localhost:${(attacker.address() as { port: number }).port}/`, { waitUntil: "load" });
    const answered = new Promise<void>((resolve) => {
      const done = (req: Request) => {
        if (req.url() === `${fw.url}/api/tasks` && req.method() === "POST") resolve();
      };
      page.on("requestfinished", done);
      page.on("requestfailed", done);
    });
    await page.evaluate(
      ({ action, title }) => {
        const frame = document.createElement("iframe");
        frame.name = "sink";
        document.body.appendChild(frame);
        const form = document.createElement("form");
        form.method = "POST";
        form.action = action;
        form.target = "sink";
        for (const [name, value] of [
          ["title", title],
          ["projectId", ""],
        ]) {
          const input = document.createElement("input");
          input.type = "hidden";
          input.name = name!;
          input.value = value!;
          form.appendChild(input);
        }
        document.body.appendChild(form);
        form.submit();
      },
      { action: `${fw.url}/api/tasks`, title },
    );
    await answered;
  } finally {
    await page.close();
    attacker.close();
  }
}

// ---- configuration --------------------------------------------------------------------------------

describe("FERNWAY_LOGIN and FERNWAY_SESSION", () => {
  it("unset or empty means one-step and cookie; values are case-insensitive and trimmed", () => {
    expect(LOGIN_MODES).toEqual(["one-step", "two-step"]);
    expect(SESSION_MODES).toEqual(["cookie", "session-storage"]);
    expect([parseLoginMode(), parseLoginMode(""), parseLoginMode(" One-Step "), parseLoginMode("TWO-STEP")]).toEqual(["one-step", "one-step", "one-step", "two-step"]);
    expect([parseSessionMode(), parseSessionMode("  "), parseSessionMode("Cookie"), parseSessionMode(" session-storage ")]).toEqual(["cookie", "cookie", "cookie", "session-storage"]);
  });

  it("an unknown value throws, naming the known ones; createApp refuses one too", () => {
    expect(() => parseLoginMode("magic-link")).toThrow(ModeConfigError);
    expect(() => parseLoginMode("magic-link")).toThrow('unknown FERNWAY_LOGIN value "magic-link" (known: one-step, two-step)');
    expect(() => parseSessionMode("localStorage")).toThrow('unknown FERNWAY_SESSION value "localStorage" (known: cookie, session-storage)');
    expect(() => createApp({ modules: [], login: "magic-link" as never })).toThrow(ModeConfigError);
    expect(() => createApp({ modules: [], session: "jwt" as never })).toThrow(ModeConfigError);
    expect(createApp({ modules: [] }).ctx.modes).toEqual({ login: "one-step", session: "cookie" });
    expect(createApp({ modules: [], login: "two-step", session: "session-storage" }).ctx.modes).toEqual({ login: "two-step", session: "session-storage" });
  });

  it("the server exits 1 on an unknown value and names the known ones", async () => {
    const login = await runServer({ PORT: String(await freePort()), FERNWAY_LOGIN: "sso" });
    expect(login.code).toBe(1);
    expect(login.stderr).toContain('fernway: unknown FERNWAY_LOGIN value "sso" (known: one-step, two-step)');
    expect(login.stdout).not.toContain("fernway listening");
    const session = await runServer({ PORT: String(await freePort()), FERNWAY_SESSION: "local-storage" });
    expect(session.code).toBe(1);
    expect(session.stderr).toContain('fernway: unknown FERNWAY_SESSION value "local-storage" (known: cookie, session-storage)');
  });

  it("the listening line and GET /api/__config name the modes (defaults and both set), with any bugs", async () => {
    const fw = await startFernway("V02,W09", { login: "two-step", session: "session-storage" });
    try {
      expect(fw.output()).toMatch(/fernway listening on http:\/\/127\.0\.0\.1:\d+\/ \(bugs: V02,W09\) \(login: two-step, session: session-storage\)/);
      expect((await api(fw, "/api/__config")).body).toEqual({ bugs: ["V02", "W09"], login: "two-step", session: "session-storage" });
    } finally {
      await fw.stop();
    }
    const plain = await startFernway("none", { env: { FERNWAY_LOGIN: "", FERNWAY_SESSION: "" } });
    try {
      expect(plain.output()).toMatch(/\(bugs: none\) \(login: one-step, session: cookie\)/);
      expect((await api(plain, "/api/__config")).body).toEqual({ bugs: [], login: "one-step", session: "cookie" });
    } finally {
      await plain.stop();
    }
  });
});

// ---- two-step sign-in -----------------------------------------------------------------------------

describe("FERNWAY_LOGIN=two-step: /login (clean mode)", () => {
  const ref = useFernway("none", { login: "two-step" });

  it("step one is one form with Email and Continue, named \"Welcome back\" as in one-step mode, and no password field anywhere; no errors on load", async () => {
    const { page, events, close } = await openLogin(ref.fw);
    try {
      expect(await page.title()).toBe("Fernway: Sign in");
      expect(await page.locator("form").count()).toBe(1);
      // Named by the heading only, as real identifier-first pages are: the sign-in words are in the title, the
      // subtitle and the path, not in the form's name or its button.
      expect(await page.getByRole("form", { name: "Welcome back", exact: true }).count()).toBe(1);
      expect(await page.getByText("Sign in to plan, track and ship your studio's work.").count()).toBe(1);
      const email = page.getByLabel("Email", { exact: true });
      expect(await email.getAttribute("type")).toBe("email");
      expect(await email.getAttribute("autocomplete")).toBe("email");
      expect(await email.getAttribute("required")).not.toBeNull();
      expect(await formShape(page)).toEqual({ fields: [expect.stringMatching(/^email:Email$/)], buttons: ["Continue"], passwords: 0 });
      expect(await page.getByRole("button", { name: "Continue", exact: true }).getAttribute("type")).toBe("submit");
      expect(await page.getByRole("button", { name: "Sign in", exact: true }).count()).toBe(0);
      expect(await page.getByRole("checkbox", { name: "Remember me" }).count()).toBe(0);
      // Outside the form, as in one-step mode.
      expect(await page.getByRole("button", { name: "Use the demo account" }).count()).toBe(1);
      expect(await page.getByRole("link", { name: "New to Fernway? Create an account" }).getAttribute("href")).toBe("/signup");
      await page.waitForLoadState("networkidle");
      expect(apiCalls(events.requests)).toEqual([]);
      expect(events.consoleErrors).toEqual([]);
      expect(events.pageErrors).toEqual([]);
      expect(events.badResponses).toEqual([]);
    } finally {
      await close();
    }
  });

  it("an empty or malformed email stays on step one with the field's message, and nothing is sent", async () => {
    const { page, events, close } = await openLogin(ref.fw);
    try {
      const email = page.getByLabel("Email", { exact: true });
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await expect.poll(() => email.getAttribute("aria-invalid")).toBe("true");
      expect(await page.getByText("Enter your email address.").isVisible()).toBe(true);
      await page.waitForFunction(() => document.activeElement?.getAttribute("name") === "email");
      expect(await page.getByRole("alert").filter({ hasText: "There is 1 problem with this form" }).count()).toBe(1);
      await email.fill("alex");
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await page.getByText("Enter an email address like name@studio.com.").waitFor();
      expect(await page.locator("input[type=password]").count()).toBe(0);
      expect(apiCalls(events.requests)).toEqual([]);
      expect(page.url()).toBe(`${ref.fw.url}/login`);
    } finally {
      await close();
    }
  });

  it("Continue shows the password on the same page for any email, the same way, without asking the server", async () => {
    const shapes: unknown[] = [];
    for (const email of ["nobody@nowhere.test", ACCOUNTS.alex.email]) {
      const { page, events, close } = await openLogin(ref.fw);
      try {
        await page.getByLabel("Email", { exact: true }).fill(email);
        await page.getByRole("button", { name: "Continue", exact: true }).click();
        const password = page.getByLabel("Password", { exact: true });
        await password.waitFor();
        await page.waitForFunction(() => document.activeElement?.getAttribute("type") === "password");
        expect(await password.getAttribute("autocomplete"), email).toBe("current-password");
        expect(await password.getAttribute("required"), email).not.toBeNull();
        // The email stays in the form (and can still be changed); the form now signs in.
        expect(await page.getByLabel("Email", { exact: true }).inputValue(), email).toBe(email);
        expect(await page.getByLabel("Email", { exact: true }).isEditable(), email).toBe(true);
        expect(await page.getByRole("checkbox", { name: "Remember me" }).getAttribute("aria-checked"), email).toBe("false");
        expect(await page.getByRole("link", { name: "Forgot password?" }).getAttribute("href"), email).toBe("/login#forgot");
        expect(await page.getByRole("button", { name: "Continue", exact: true }).count(), email).toBe(0);
        expect(await page.getByRole("button", { name: "Sign in", exact: true }).getAttribute("type"), email).toBe("submit");
        expect(await page.locator("form").count(), email).toBe(1);
        expect(page.url(), email).toBe(`${ref.fw.url}/login`);
        expect(apiCalls(events.requests), email).toEqual([]);
        expect(events.pageErrors, email).toEqual([]);
        shapes.push(await formShape(page));
      } finally {
        await close();
      }
    }
    expect(shapes[0]).toEqual(shapes[1]);
    expect(shapes[0]).toMatchObject({ buttons: ["Sign in"], passwords: 1 });
  });

  it("an unknown email, then any password, answers the usual 401 in a role=alert", async () => {
    const { page, events, close } = await openLogin(ref.fw);
    try {
      await twoStepSignIn(page, "nobody@nowhere.test", "whatever-password");
      await page.getByRole("alert").filter({ hasText: "Email or password is incorrect" }).waitFor();
      expect(await page.getByLabel("Password", { exact: true }).inputValue()).toBe("whatever-password");
      expect(apiCalls(events.requests)).toEqual(["POST /api/login"]);
      expect(page.url()).toBe(`${ref.fw.url}/login`);
    } finally {
      await close();
    }
  });

  it("an empty password on step two marks it invalid and sends nothing", async () => {
    const { page, events, close } = await openLogin(ref.fw);
    try {
      await page.getByLabel("Email", { exact: true }).fill(ACCOUNTS.alex.email);
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await page.getByLabel("Password", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect.poll(() => page.getByLabel("Password", { exact: true }).getAttribute("aria-invalid")).toBe("true");
      expect(await page.getByText("Enter your password.").isVisible()).toBe(true);
      expect(apiCalls(events.requests)).toEqual([]);
    } finally {
      await close();
    }
  });

  it("keyboard only: Enter continues, Enter signs in, and ?next= is honoured; the password never reaches the page's HTML", async () => {
    const { page, events, close } = await openLogin(ref.fw, "/login?next=/app/settings");
    try {
      await page.getByLabel("Email", { exact: true }).focus();
      await page.keyboard.type(ACCOUNTS.alex.email);
      await page.keyboard.press("Enter");
      await page.waitForFunction(() => document.activeElement?.getAttribute("type") === "password");
      await page.keyboard.type(ACCOUNTS.alex.password);
      expect(await page.content()).not.toContain(ACCOUNTS.alex.password);
      const request = page.waitForRequest((r) => r.url().endsWith("/api/login"));
      await page.keyboard.press("Enter");
      expect(JSON.parse((await request).postData() ?? "{}")).toEqual({ email: ACCOUNTS.alex.email, password: ACCOUNTS.alex.password, remember: false });
      await page.waitForURL(`${ref.fw.url}/app/settings`);
      await page.getByText("Signed in as Alex Rivera · Rivera Studio").first().waitFor();
      await toast(page, "Welcome back, Alex!").waitFor();
      expect((await page.context().cookies()).find((c) => c.name === "fernway_session")?.httpOnly).toBe(true);
      expect(await page.content()).not.toContain(ACCOUNTS.alex.password);
      expect(events.consoleErrors).toEqual([]);
      expect(events.badResponses).toEqual([]);
    } finally {
      await close();
    }
  });

  it("signed out, /app still sends you to /login?next=/app, and both steps bring you back", async () => {
    const { page, close } = await openPage(ref.fw, "/app", { reducedMotion: "reduce" });
    try {
      await page.waitForURL(`${ref.fw.url}/login?next=/app`);
      await twoStepSignIn(page, ACCOUNTS.sam.email, ACCOUNTS.sam.password);
      await page.waitForURL(`${ref.fw.url}/app`);
      await page.getByText("Signed in as Sam Okafor · Okafor & Co").first().waitFor();
    } finally {
      await close();
    }
  });

  it("Use the demo account works the same way", async () => {
    const { page, close } = await openLogin(ref.fw);
    try {
      await page.getByRole("button", { name: "Use the demo account" }).click();
      await page.waitForURL(`${ref.fw.url}/app`);
      await page.getByText("Signed in as Alex Rivera · Rivera Studio").first().waitFor();
    } finally {
      await close();
    }
  });

  for (const colorScheme of ["light", "dark"] as const) {
    it(`axe finds nothing on either step, with or without their errors (${colorScheme})`, async () => {
      const { page, close } = await openPage(ref.fw, "/login", { reducedMotion: "reduce", colorScheme });
      try {
        await page.getByRole("heading", { level: 1, name: "Welcome back" }).waitFor();
        expect(await axeViolations(page), "step one").toEqual([]);
        await page.getByRole("button", { name: "Continue", exact: true }).click();
        await expect.poll(() => page.getByLabel("Email", { exact: true }).getAttribute("aria-invalid")).toBe("true");
        expect(await axeViolations(page), "step one, empty email").toEqual([]);
        await page.getByLabel("Email", { exact: true }).fill(ACCOUNTS.alex.email);
        await page.getByRole("button", { name: "Continue", exact: true }).click();
        await page.getByLabel("Password", { exact: true }).waitFor();
        expect(await axeViolations(page), "step two").toEqual([]);
        await page.getByRole("button", { name: "Sign in", exact: true }).click();
        await expect.poll(() => page.getByLabel("Password", { exact: true }).getAttribute("aria-invalid")).toBe("true");
        expect(await axeViolations(page), "step two, empty password").toEqual([]);
        await page.getByLabel("Password", { exact: true }).fill("not-the-password");
        await page.getByRole("button", { name: "Sign in", exact: true }).click();
        await page.getByRole("alert").filter({ hasText: "Email or password is incorrect" }).waitFor();
        expect(await axeViolations(page), "step two, refused").toEqual([]);
      } finally {
        await close();
      }
    });
  }
});

describe("FERNWAY_LOGIN=two-step with W10 (errors in red text only)", () => {
  const ref = useFernway("W10", { login: "two-step" });

  it("an empty Continue shows red text, but nothing is marked invalid or announced", async () => {
    const { page, close } = await openLogin(ref.fw);
    try {
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await page.getByText("Enter your email address.").waitFor();
      expect(await page.getByLabel("Email", { exact: true }).getAttribute("aria-invalid")).toBeNull();
      expect(await page.getByRole("alert").count()).toBe(0);
    } finally {
      await close();
    }
  });
});

// ---- sessionStorage sessions: the API --------------------------------------------------------------

describe("FERNWAY_SESSION=session-storage: the API (clean mode)", () => {
  const ref = useFernway("none", { session: "session-storage" });

  it("signing in, the demo sign-in and sign-up answer a token and set no cookie; page loads set none either", async () => {
    const login = await api(ref.fw, "/api/login", { body: { email: ACCOUNTS.alex.email, password: ACCOUNTS.alex.password, remember: true } });
    expect(login.status).toBe(200);
    expect(login.body).toEqual({ id: "alex-rivera", name: "Alex Rivera", email: "alex@fernway.test", token: expect.stringMatching(TOKEN_RE) });
    expect(login.headers.get("set-cookie")).toBeNull();
    const demo = await api(ref.fw, "/api/login/demo", { method: "POST" });
    expect(demo.body).toEqual({ id: "alex-rivera", name: "Alex Rivera", email: "alex@fernway.test", token: expect.stringMatching(TOKEN_RE) });
    expect(demo.headers.get("set-cookie")).toBeNull();
    expect(demo.body.token).not.toBe(login.body.token);
    const signup = await api(ref.fw, "/api/signup", { body: NEW_USER });
    expect(signup.status).toBe(201);
    expect(signup.body).toEqual({ id: expect.any(String), name: NEW_USER.name, email: NEW_USER.email, token: expect.stringMatching(TOKEN_RE) });
    expect(signup.headers.get("set-cookie")).toBeNull();
    expect((await api(ref.fw, "/api/me", { headers: bearer(signup.body.token) })).body).toMatchObject({ email: NEW_USER.email, workspace: "Juniper Studio" });
    for (const path of ["/", "/login", "/app", "/app/settings", "/nope"]) {
      expect((await fetch(`${ref.fw.url}${path}`)).headers.get("set-cookie"), path).toBeNull();
    }
    const wrong = await api(ref.fw, "/api/login", { body: { email: ACCOUNTS.alex.email, password: "not-it" } });
    expect(wrong.status).toBe(401);
    expect(wrong.body).toEqual({ error: "Email or password is incorrect" });
  });

  it("the bearer token is the session; the same value as a cookie, a malformed header or an unknown token is signed out", async () => {
    const token = await signInToken(ref.fw, "alex");
    expect((await api(ref.fw, "/api/me", { headers: bearer(token) })).body).toEqual({ id: "alex-rivera", name: "Alex Rivera", email: "alex@fernway.test", workspace: "Rivera Studio" });
    expect((await api(ref.fw, "/api/me", { headers: { authorization: `bearer ${token}` } })).status).toBe(200);
    for (const headers of [{ cookie: `fernway_session=${token}` }, { authorization: token }, { authorization: "Bearer" }, { authorization: `Basic ${token}` }, bearer("not-a-real-token-at-all-000000000000000000")]) {
      const res = await api(ref.fw, "/api/me", { headers });
      expect(res.status, JSON.stringify(headers)).toBe(401);
      expect(res.body).toEqual(SIGN_IN_FIRST);
    }
    // The workspace API and the billing API take it too.
    expect((await api<Task[]>(ref.fw, "/api/tasks", { headers: bearer(token) })).body.map((t) => t.id)).toEqual(["task-wireframes", "task-sprint-notes", "task-palette"]);
    expect((await api(ref.fw, profileUrl("alex"), { headers: bearer(token) })).body).toMatchObject({ email: "alex@fernway.test", plan: "free", role: "member" });
    expect((await api(ref.fw, "/api/billing/cancel", { method: "POST", headers: bearer(token) })).body).toEqual({ plan: "free" });
    expect((await api(ref.fw, "/api/tasks", { headers: { cookie: `fernway_session=${token}` } })).status).toBe(401);
  });

  it("each account's token only reaches its own workspace (Sam's token gets 404 for Alex's task)", async () => {
    expect((await api<Task[]>(ref.fw, "/api/tasks", { as: "sam" })).body.map((t) => t.id)).toEqual(["task-bramble-sketches", "task-offline-mode", "task-print-proofs"]);
    const res = await api(ref.fw, "/api/tasks/task-wireframes", { method: "PATCH", body: { done: true }, as: "sam" });
    expect(res.status).toBe(404);
    expect((await api(ref.fw, profileUrl("alex"), { as: "sam" })).status).toBe(404);
    expect((await api(ref.fw, "/api/tasks/task-wireframes", { method: "PATCH", body: { done: true } })).status).toBe(401);
    expect((await api<Task[]>(ref.fw, "/api/tasks", { as: "alex" })).body.find((t) => t.id === "task-wireframes")?.done).toBe(false);
  });

  it("POST /api/logout ends that token (204, no cookie to clear); other tokens keep working", async () => {
    const one = await signInToken(ref.fw, "alex");
    const two = await signInToken(ref.fw, "alex");
    const out = await api(ref.fw, "/api/logout", { method: "POST", headers: bearer(one) });
    expect(out.status).toBe(204);
    expect(out.headers.get("set-cookie")).toBeNull();
    expect((await api(ref.fw, "/api/me", { headers: bearer(one) })).status).toBe(401);
    expect((await api(ref.fw, "/api/me", { headers: bearer(two) })).status).toBe(200);
    expect((await api(ref.fw, "/api/logout", { method: "POST" })).status).toBe(204);
  });

  it("an Idempotency-Key replays per token: the same token gets the first answer, another token of the same user doesn't", async () => {
    const one = await signInToken(ref.fw, "alex");
    const two = await signInToken(ref.fw, "alex");
    const send = (token: string) => api(ref.fw, "/api/tasks", { body: { title: "Keyed task" }, headers: { ...bearer(token), "idempotency-key": "key-1" } });
    const first = await send(one);
    const again = await send(one);
    const other = await send(two);
    expect(first.status).toBe(201);
    expect(again.body.id).toBe(first.body.id);
    expect(again.headers.get("idempotent-replayed")).toBe("true");
    expect(other.body.id).not.toBe(first.body.id);
    expect(other.headers.get("idempotent-replayed")).toBeNull();
  });

  it("the Origin check still refuses a write from another site, token or not", async () => {
    const token = await signInToken(ref.fw, "alex");
    const res = await fetch(`${ref.fw.url}/api/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://evil.example", ...bearer(token) },
      body: JSON.stringify({ title: "Forged" }),
    });
    expect(res.status).toBe(403);
    expect((await api<Task[]>(ref.fw, "/api/tasks", { as: "alex" })).body.map((t) => t.title)).not.toContain("Forged");
  });
});

// ---- sessionStorage sessions: the SPA --------------------------------------------------------------

describe("FERNWAY_SESSION=session-storage: the SPA (clean mode)", () => {
  const ref = useFernway("none", { session: "session-storage" });

  it("signing in on /login keeps the token in sessionStorage, sends it as Authorization: Bearer, and sets no cookie", async () => {
    const { page, context, events, close } = await openLogin(ref.fw);
    try {
      await page.getByLabel("Email", { exact: true }).fill(ACCOUNTS.alex.email);
      await page.getByLabel("Password", { exact: true }).fill(ACCOUNTS.alex.password);
      const answer = page.waitForResponse((r) => r.url().endsWith("/api/login"));
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      const token = ((await (await answer).json()) as { token: string }).token;
      expect(token).toMatch(TOKEN_RE);
      await page.waitForURL(`${ref.fw.url}/app`);
      await page.getByText("Signed in as Alex Rivera · Rivera Studio").first().waitFor();
      await page.locator("#projects tbody tr").first().waitFor();
      expect(await page.evaluate((key) => sessionStorage.getItem(key), SESSION_TOKEN_KEY)).toBe(token);
      expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => /session|token/i.test(k)))).toEqual([]);
      expect(await context.cookies()).toEqual([]);
      // Every workspace request after signing in carries the token; none before it did.
      const signedIn = events.requests.filter((r) => ["/api/me", "/api/projects", "/api/members", "/api/tasks"].includes(new URL(r.url()).pathname));
      expect(signedIn.length).toBeGreaterThanOrEqual(4);
      for (const r of signedIn) expect(r.headers().authorization, r.url()).toBe(`Bearer ${token}`);
      expect(events.requests.find((r) => r.url().endsWith("/api/login"))?.headers().authorization).toBeUndefined();
      expect(events.badResponses).toEqual([]);
      expect(events.consoleErrors).toEqual([]);

      // A reload keeps the session (sessionStorage lives as long as the tab).
      await page.reload({ waitUntil: "networkidle" });
      await page.getByText("Signed in as Alex Rivera · Rivera Studio").first().waitFor();
      expect(page.url()).toBe(`${ref.fw.url}/app`);
    } finally {
      await close();
    }
  });

  it("a new tab without the token is signed out (sessionStorage is per tab); seeded before the page loads, it is signed in", async () => {
    const { page, context, close } = await openPage(ref.fw, "/app", { as: "alex" });
    try {
      await page.getByText("Signed in as Alex Rivera · Rivera Studio").first().waitFor();
      const token = await page.evaluate((key) => sessionStorage.getItem(key), SESSION_TOKEN_KEY);
      expect(token).toMatch(TOKEN_RE);
      // A second context with no seed: nothing (no cookie, no storage) carries the session over.
      const fresh = await (await getBrowser()).newContext({ storageState: await context.storageState() });
      try {
        const other = await fresh.newPage();
        await other.goto(`${ref.fw.url}/app`, { waitUntil: "networkidle" });
        await other.waitForURL(`${ref.fw.url}/login?next=/app`);
        // Seeding the token before any page script runs (what Run Hound does) signs the next page in.
        await seedSessionToken(ref.fw, fresh, token!);
        const seeded = await fresh.newPage();
        await seeded.goto(`${ref.fw.url}/app/settings`, { waitUntil: "networkidle" });
        await seeded.getByText("Signed in as Alex Rivera · Rivera Studio").first().waitFor();
        expect(seeded.url()).toBe(`${ref.fw.url}/app/settings`);
      } finally {
        await fresh.close();
      }
    } finally {
      await close();
    }
  });

  it("Sign out ends the token on the server, removes it from sessionStorage and sends you to /login", async () => {
    const { page, close } = await openPage(ref.fw, "/app", { as: "alex" });
    try {
      await page.getByRole("heading", { level: 1, name: "Dashboard" }).waitFor();
      const token = (await page.evaluate((key) => sessionStorage.getItem(key), SESSION_TOKEN_KEY))!;
      await page.getByRole("button", { name: "Account menu" }).click();
      const logout = page.waitForRequest((r) => r.url().endsWith("/api/logout") && r.method() === "POST");
      await page.getByRole("menuitem", { name: "Sign out" }).click();
      expect((await logout).headers().authorization).toBe(`Bearer ${token}`);
      await page.waitForURL(`${ref.fw.url}/login?next=/app`);
      await toast(page, "You're signed out").waitFor();
      expect(await page.evaluate((key) => sessionStorage.getItem(key), SESSION_TOKEN_KEY)).toBeNull();
      expect((await api(ref.fw, "/api/me", { headers: bearer(token) })).status).toBe(401);
    } finally {
      await close();
    }
  });

  it("a token the server no longer knows is dropped: /app sends you to /login", async () => {
    const context = await (await getBrowser()).newContext();
    try {
      await seedSessionToken(ref.fw, context, "an-old-token-from-yesterday-000000000000000");
      const page = await context.newPage();
      await page.goto(`${ref.fw.url}/app`, { waitUntil: "networkidle" });
      await page.waitForURL(`${ref.fw.url}/login?next=/app`);
      expect(await page.evaluate((key) => sessionStorage.getItem(key), SESSION_TOKEN_KEY)).toBeNull();
    } finally {
      await context.close();
    }
  });

  it("sign-up keeps the new account's token too, and onboarding renames that account's workspace", async () => {
    const { page, context, events, close } = await openPage(ref.fw, "/signup", { reducedMotion: "reduce" });
    try {
      await page.getByLabel("Full name", { exact: true }).fill(NEW_USER.name);
      await page.getByLabel("Work email", { exact: true }).fill(NEW_USER.email);
      await page.getByLabel("Password", { exact: true }).fill(NEW_USER.password);
      await page.getByRole("checkbox", { name: "I agree to the Terms and Privacy Policy" }).click();
      await page.getByRole("button", { name: "Create account", exact: true }).click();
      await page.waitForURL(`${ref.fw.url}/onboarding`);
      const token = (await page.evaluate((key) => sessionStorage.getItem(key), SESSION_TOKEN_KEY))!;
      expect(token).toMatch(TOKEN_RE);
      expect(await context.cookies()).toEqual([]);
      const before = (await api(ref.fw, "/api/me", { headers: bearer(token) })).body;
      expect(before).toMatchObject({ name: NEW_USER.name, email: NEW_USER.email });
      expect(before.workspace).not.toBe("Lantern Works");

      // The wizard, finished: POST /api/onboarding carries the token and renames the new account's workspace.
      await page.getByRole("heading", { level: 1, name: "Set up your workspace" }).waitFor();
      await page.getByLabel("Workspace name", { exact: true }).fill("Lantern Works");
      await page.locator("#workspace-url-status").filter({ hasText: "Available" }).waitFor();
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await page.getByRole("heading", { level: 2, name: "Invite teammates" }).waitFor();
      await page.getByRole("button", { name: "Skip", exact: true }).click();
      await page.getByRole("heading", { level: 2, name: "Review and finish" }).waitFor();
      const onboarding = page.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/onboarding");
      await page.getByRole("button", { name: "Finish setup", exact: true }).click();
      expect((await onboarding).headers().authorization).toBe(`Bearer ${token}`);
      await page.getByRole("heading", { level: 2, name: "Your workspace is ready" }).waitFor();
      expect((await api(ref.fw, "/api/me", { headers: bearer(token) })).body).toMatchObject({ email: NEW_USER.email, workspace: "Lantern Works" });
      // Nobody else's workspace was renamed.
      expect((await api(ref.fw, "/api/me", { as: "alex" })).body.workspace).toBe("Rivera Studio");
      expect(await context.cookies()).toEqual([]);
      await page.getByRole("link", { name: "Go to your dashboard" }).click();
      await page.waitForURL(`${ref.fw.url}/app`);
      await page.getByText(`Signed in as ${NEW_USER.name} · Lantern Works`).first().waitFor();
      expect(events.badResponses).toEqual([]);
    } finally {
      await close();
    }
  });

  it("/app/settings loads Alex's profile (with the plan) through the token", async () => {
    const { page, events, close } = await openPage(ref.fw, "/app/settings", { as: "alex" });
    try {
      const form = page.getByRole("form", { name: "Profile" });
      await expect.poll(() => form.getByRole("textbox", { name: "Display name", exact: true }).inputValue()).toBe("Alex Rivera");
      const profile = events.requests.find((r) => r.method() === "GET" && new URL(r.url()).pathname === profileUrl("alex"))!;
      expect(profile.headers().authorization).toMatch(/^Bearer [A-Za-z0-9_-]{43}$/);
      expect(await (await profile.response())!.json()).toMatchObject({ email: "alex@fernway.test", plan: "free", role: "member" });
      expect(events.badResponses).toEqual([]);
    } finally {
      await close();
    }
  });
});

describe("FERNWAY_LOGIN=two-step with FERNWAY_SESSION=session-storage", () => {
  const ref = useFernway("none", { login: "two-step", session: "session-storage" });

  it("both steps sign in, the token lands in sessionStorage, and no cookie is set", async () => {
    const { page, context, close } = await openLogin(ref.fw, "/login?next=/app/settings");
    try {
      await twoStepSignIn(page, ACCOUNTS.alex.email, ACCOUNTS.alex.password);
      await page.waitForURL(`${ref.fw.url}/app/settings`);
      await page.getByText("Signed in as Alex Rivera · Rivera Studio").first().waitFor();
      expect(await page.evaluate((key) => sessionStorage.getItem(key), SESSION_TOKEN_KEY)).toMatch(TOKEN_RE);
      expect(await context.cookies()).toEqual([]);
    } finally {
      await close();
    }
  });
});

// ---- the session-dependent bugs in session-storage mode --------------------------------------------

describe("FERNWAY_SESSION=session-storage with V02 and V03 (the read bugs the access checks catch)", () => {
  const ref = useFernway("V02,V03", { session: "session-storage" });

  it("V02: Sam's token lists Alex's tasks; V03: no token at all answers as Alex; /api/me stays honest", async () => {
    expect((await api<Task[]>(ref.fw, "/api/tasks", { as: "sam" })).body.map((t) => t.id)).toContain("task-wireframes");
    const signedOut = await api<Task[]>(ref.fw, "/api/tasks");
    expect(signedOut.status).toBe(200);
    expect(signedOut.body.map((t) => t.id)).toContain("task-wireframes");
    expect((await api(ref.fw, profileUrl("alex"))).body).toMatchObject({ email: "alex@fernway.test" });
    expect((await api(ref.fw, "/api/me")).status).toBe(401);
  });
});

describe("FERNWAY_SESSION=session-storage with V06", () => {
  const ref = useFernway("V06", { session: "session-storage" });

  it("Sam's token changes Alex's task; Alex's re-read shows it; Alex's own update puts it back", async () => {
    const before = (await api<Task[]>(ref.fw, "/api/tasks", { as: "alex" })).body.find((t) => t.id === "task-wireframes")!;
    const res = await api(ref.fw, "/api/tasks/task-wireframes", { method: "PATCH", body: { title: "Changed by Sam rh5678", projectId: before.projectId, done: true }, as: "sam" });
    expect(res.status).toBe(200);
    expect((await api<Task[]>(ref.fw, "/api/tasks", { as: "alex" })).body.find((t) => t.id === "task-wireframes")).toMatchObject({ title: "Changed by Sam rh5678", done: true });
    await api(ref.fw, "/api/tasks/task-wireframes", { method: "PATCH", body: { title: before.title, projectId: before.projectId, done: before.done }, as: "alex" });
    expect((await api<Task[]>(ref.fw, "/api/tasks", { as: "alex" })).body.find((t) => t.id === "task-wireframes")).toEqual(before);
    // Still no write without a token.
    expect((await api(ref.fw, "/api/tasks/task-wireframes", { method: "PATCH", body: { done: true } })).status).toBe(401);
  });
});

describe("FERNWAY_SESSION=session-storage with V07", () => {
  const ref = useFernway("V07", { session: "session-storage" });

  it("a request with no token changes Alex's task; Sam's token still gets 404", async () => {
    const res = await api(ref.fw, "/api/tasks/task-wireframes", { method: "PATCH", body: { title: "Changed by nobody rh5678" } });
    expect(res.status).toBe(200);
    expect((await api<Task[]>(ref.fw, "/api/tasks", { as: "alex" })).body.find((t) => t.id === "task-wireframes")?.title).toBe("Changed by nobody rh5678");
    expect((await api(ref.fw, "/api/tasks/task-wireframes", { method: "PATCH", body: { done: true }, as: "sam" })).status).toBe(404);
  });
});

describe("FERNWAY_SESSION=session-storage with V08 and W09 (the cookie bugs have no cookie to ride on)", () => {
  const ref = useFernway("V08,W09", { session: "session-storage" });

  it("no cookie is ever set, so a page on another site, in Alex's signed-in browser, creates nothing", async () => {
    for (const path of ["/", "/app"]) expect((await fetch(`${ref.fw.url}${path}`)).headers.get("set-cookie"), path).toBeNull();
    const login = await api(ref.fw, "/api/login", { body: { email: ACCOUNTS.alex.email, password: ACCOUNTS.alex.password } });
    expect(login.headers.get("set-cookie")).toBeNull();
    const { page, context, close } = await openPage(ref.fw, "/app", { as: "alex" });
    try {
      await page.getByText("Signed in as Alex Rivera · Rivera Studio").first().waitFor();
      expect(await context.cookies()).toEqual([]);
      await forgeTaskFromAnotherSite(ref.fw, context, "Forged from another site rh5678");
      expect((await api<Task[]>(ref.fw, "/api/tasks", { as: "alex" })).body.map((t) => t.title)).not.toContain("Forged from another site rh5678");
    } finally {
      await close();
    }
  });

  it("V08 is still planted on the server: with the token (which no other site has), a form-encoded save from another origin is stored", async () => {
    const token = await signInToken(ref.fw, "alex");
    const forged = await fetch(`${ref.fw.url}/api/tasks`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: "http://evil.example", ...bearer(token) },
      body: "title=Form+rh5678&projectId=",
    });
    expect(forged.status).toBe(201);
    const anonymous = await fetch(`${ref.fw.url}/api/tasks`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: "http://evil.example" },
      body: "title=Nobody&projectId=",
    });
    expect(anonymous.status).toBe(401);
  });
});

describe("FERNWAY_SESSION=session-storage with V09", () => {
  const ref = useFernway("V09", { session: "session-storage" });

  it("opening /app/upgraded as Alex makes Alex Pro; Cancel plan on the Billing tab puts Alex back on Free", async () => {
    const plan = async () => (await api(ref.fw, profileUrl("alex"), { as: "alex" })).body.plan;
    expect(await plan()).toBe("free");
    const upgraded = await openPage(ref.fw, "/app/upgraded", { as: "alex" });
    try {
      await upgraded.page.getByRole("heading", { level: 2, name: "Pro is active" }).waitFor();
      expect(upgraded.events.badResponses).toEqual([]);
    } finally {
      await upgraded.close();
    }
    expect(await plan()).toBe("pro");
    const { page, events, close } = await openPage(ref.fw, "/app/settings#billing", { as: "alex", reducedMotion: "reduce" });
    try {
      const billing = page.getByRole("tabpanel", { name: "Billing" });
      await billing.getByRole("heading", { level: 2, name: /Pro plan/ }).waitFor();
      await billing.getByRole("button", { name: "Cancel plan", exact: true }).click();
      await billing.getByRole("status").filter({ hasText: "back on the Free plan" }).waitFor();
      expect(await plan()).toBe("free");
      expect(events.badResponses).toEqual([]);
    } finally {
      await close();
    }
  });
});
