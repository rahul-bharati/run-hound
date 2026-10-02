// signIn never hands the run a session that holds the password (0.6.0, round 2 of the release review; docs/v2-spec.md "Sign-in: two-step and sessionStorage": "a request carrying it to another origin or in a URL is stopped"). Before signIn returns, the session it would return (cookie values, localStorage and IndexedDB records, and the sessionStorage it keeps) is read for the password, raw and in its encoded forms, the way a request is. When it is there, the sign-in fails and says where, and nothing of that session reaches a check context. A weak password ("demo") counts only as a whole value under a key that names a password, and a password equal to the username never counts (an app keeps the username it signed in with).
import { mkdtemp, rm } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeBrowser, getBrowser } from "../../../../test-support/harness.js";
import { json, startFixtureServer, type FixtureServer } from "../../../../test-support/server.js";
import type { TestAccount } from "../../../../src/interfaces/accounts.js";
import { signIn, SignInError, type SignedIn } from "../../../../src/engine/auth.js";
import { createCheckContext } from "../../../../src/engine/context.js";
import { emptyForm } from "../../../../src/engine/discover.js";

const PASSWORD = "hunter2correcthorse91";
const USERS = [
  { username: "someone@example.test", password: PASSWORD },
  { username: "weak@example.test", password: "demo" },
  { username: "testuser1", password: "testuser1" },
];

let browser: Browser;
let site: FixtureServer;
let collector: FixtureServer;

const shell = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body><main>${body}</main></body></html>`;

function sendHtml(res: ServerResponse, body: string): void {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(body);
}

// A sign-in page whose script posts JSON to /api/login and, once signed in, runs `keep` (pw: the password) and goes to /home.
const loginPage = (keep: string) =>
  shell(
    "Sign in",
    `<h1>Sign in</h1><form id="f" aria-label="Sign in"><label for="u">Username</label><input id="u" name="username" type="text" autocomplete="username">
<label for="pw">Password</label><input id="pw" name="password" type="password" autocomplete="current-password"><button type="submit">Sign in</button></form>
<script>
document.getElementById("f").addEventListener("submit", function (e) {
  e.preventDefault();
  var user = document.getElementById("u").value, pw = document.getElementById("pw").value;
  fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: user, password: pw }) })
    .then(function (r) { if (!r.ok) return; ${keep} location.href = "/home"; });
});
</script>`,
  );

// What each sign-in page keeps once signed in.
const KEEP: Record<string, string> = {
  cookie: `document.cookie = "pw_hint=" + encodeURIComponent(pw) + "; path=/";`,
  base64: `document.cookie = "remember=" + btoa("v1:" + user + ":" + pw) + "; path=/";`,
  local: `localStorage.setItem("login_draft", JSON.stringify({ username: user, password: pw }));`,
  weak: `localStorage.setItem("prefs", JSON.stringify({ plan: "demo", theme: "demo" }));`,
  same: `localStorage.setItem("last_user", user);`,
};

beforeAll(async () => {
  browser = await getBrowser();
  collector = await startFixtureServer({
    fallback: (_req, res) => {
      res.writeHead(200, { "content-type": "image/gif", "access-control-allow-origin": "*" });
      res.end();
    },
  });
  const pages: Record<string, string> = {
    "/home": shell("Home", `<h1>Home</h1><a href="/app">Tasks</a>`),
    // The app's page: an image from another origin (the cookie goes with it), and a beacon of localStorage there.
    "/app": shell(
      "Tasks",
      `<h1>Your tasks</h1><img src="${collector.url.replace("127.0.0.1", "localhost")}/assets/logo.gif" alt="logo"><img src="${collector.url}/assets/logo.gif" alt="logo">
<script>navigator.sendBeacon(${JSON.stringify(`${collector.url}/analytics`)}, JSON.stringify(Object.assign({}, localStorage)));</script>`,
    ),
  };
  for (const [name, keep] of Object.entries(KEEP)) pages[`/login-${name}`] = loginPage(keep);
  site = await startFixtureServer({
    pages,
    routes: {
      "POST /api/login": (req, res) => {
        const body = JSON.parse(req.body || "{}") as { username?: string; password?: string };
        if (!USERS.some((u) => u.username === body.username && u.password === body.password)) return json(res, 401, { error: "Wrong username or password" });
        res.setHeader("set-cookie", "sid=s3ss10nT0kenValue1234567890; Path=/; HttpOnly");
        json(res, 200, {});
      },
      "GET /favicon.ico": (_req, res) => {
        res.writeHead(204);
        res.end();
      },
    },
  });
});

afterAll(async () => {
  await Promise.all([site?.close(), collector?.close()]);
  await closeBrowser();
});

const account = (path: string, user = USERS[0]!): TestAccount => ({ id: "a", label: "Account A", loginUrl: `${site.url}${path}`, ...user });

// Opens the app's page in a check context seeded with `signed`, as the runner opens every scenario.
async function openApp(signed: SignedIn): Promise<void> {
  const artifactsDir = await mkdtemp(join(tmpdir(), "rh-stored-password-"));
  const target = `${site.url}/app`;
  const ctx = createCheckContext({
    browser,
    form: emptyForm(target),
    targetUrl: target,
    artifactsDir,
    runToken: "t3st",
    sessions: { self: signed.state },
    ...(signed.sessionStorage ? { sessionStorage: { self: signed.sessionStorage } } : {}),
    accounts: { self: { id: "a", label: "Account A" }, other: null },
  });
  try {
    const { page } = await ctx.openPage();
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await page.waitForTimeout(300);
  } finally {
    await ctx.dispose();
    await rm(artifactsDir, { recursive: true, force: true });
  }
}

const carries = (text: string) => [PASSWORD, encodeURIComponent(PASSWORD), Buffer.from(PASSWORD).toString("base64").slice(0, 16)].some((p) => text.includes(p));

describe("signIn: a sign-in page that keeps the password in the session it leaves behind", () => {
  for (const [name, where] of [
    ["cookie", /keeps the password in a cookie \(pw_hint\)/],
    ["base64", /keeps the password in a cookie \(remember\)/],
    ["local", /keeps the password in localStorage \(login_draft\)/],
  ] as const) {
    it(`${name}: fails and says where; nothing of that session reaches a check context, or the other origin`, async () => {
      collector.requests.length = 0;
      const outcome = await signIn(browser, account(`/login-${name}`)).then(
        (signed: SignedIn) => signed,
        (err: unknown) => err,
      );
      if (!(outcome instanceof Error)) await openApp(outcome as SignedIn);
      const leaked = collector.requests.filter((r) => carries(`${r.url} ${r.body} ${String(r.headers.cookie ?? "")}`));
      expect(leaked.map((r) => r.url), "requests to the other origin that carry the password").toEqual([]);
      expect(outcome).toBeInstanceOf(SignInError);
      const message = (outcome as SignInError).message;
      expect(message).toMatch(where);
      expect(message).toContain("Run Hound won't carry it into the run");
      expect(message).not.toContain(PASSWORD);
    });
  }

  it("a weak password (demo) that is also one of the app's own values in localStorage: signs in", async () => {
    const result = await signIn(browser, account("/login-weak", USERS[1]));
    expect(new URL(result.landedOn).pathname).toBe("/home");
  });

  it("a password equal to the username, and the app keeps the username in localStorage: signs in", async () => {
    const result = await signIn(browser, account("/login-same", USERS[2]));
    expect(new URL(result.landedOn).pathname).toBe("/home");
  });
});
