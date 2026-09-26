/**
 * Signed-in plans and runs on pages that are harder than the accounts app (round-2 review):
 * - a target that renders the sign-in form in place (no redirect) fails the plan like a redirect does, and when the
 *   sign-in page is on another host name (localhost vs 127.0.0.1) the message says why the session didn't carry over;
 *   a signed-in page with a password field that is not a sign-in form (change email) still plans;
 * - usernames reach no file of the run folder, however short and in whatever letter case the page shows them (report,
 *   evidence file names, spec file names and contents);
 * - the discovery session never reaches the plan (a link that carries the session value) or the report;
 * - a form that sets a password (change password) is never submitted on a signed-in run: its scenarios are
 *   destructive in the plan, and skipped at run time even with allowDestructive, with the reason.
 */
import { randomBytes } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer, type RecordedRequest } from "../../test-support/server.js";
import type { AccountsConfig } from "../accounts/types.js";
import { check as credentialFields } from "../checks/credential-fields.js";
import { check as deepLinks } from "../checks/deep-links.js";
import { check as pageControls } from "../checks/page-controls.js";
import { check as persistence } from "../checks/persistence.js";
import type { DiscoveredForm, DiscoveredPage, FormField } from "../core/types.js";
import { buildPlan } from "./plan.js";
import { discoverAndPlan, runPlan } from "./runner.js";

const USERNAME = "Alice";
const PASSWORD = "fixture-pw-2468";

let server: FixtureServer;
let runsDir: string;
/** Every session the app handed out. */
const sessions = new Set<string>();
const passwordChanges: string[] = [];

const shell = (title: string, body: string) => `<!doctype html><html lang="en"><head><title>${title}</title></head><body>${body}</body></html>`;

function sidOf(req: RecordedRequest): string | null {
  const m = /(?:^|;\s*)sid=([0-9a-f]+)/.exec(req.headers.cookie ?? "");
  return m && sessions.has(m[1]!) ? m[1]! : null;
}

/** The sign-in form, as the login page and (signed out) the dashboard itself show it. */
const SIGN_IN = `<main><h1>Sign in</h1><form id="signin" aria-label="Sign in">
<label for="u">Username</label><input id="u" name="username" autocomplete="username">
<label for="p">Password</label><input id="p" name="password" type="password" autocomplete="current-password">
<button type="submit">Sign in</button><p role="alert" id="err"></p></form></main>
<script>
document.getElementById("signin").addEventListener("submit", function (e) {
  e.preventDefault();
  fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: document.getElementById("u").value, password: document.getElementById("p").value }) })
    .then(function (r) { if (r.ok) location.assign("/home"); else document.getElementById("err").textContent = "Wrong username or password"; });
});
</script>`;

function dashboard(sid: string): string {
  return shell(
    "Dashboard",
    `<header><nav aria-label="Main"><a href="/home">Home</a> <a href="/help?session=${sid}">Printable help</a></nav>
<button type="button" id="acct">${USERNAME.toUpperCase()}</button></header>
<main><h1>Dashboard</h1><p>Signed in as ${USERNAME.toLowerCase()}</p>
<form id="pw" aria-label="Change password"><label for="np">New password</label><input id="np" type="password" autocomplete="new-password">
<label for="cp">Confirm new password</label><input id="cp" type="password" autocomplete="new-password"><button type="submit">Update password</button></form>
<form id="em" aria-label="Change email"><label for="ne">New email</label><input id="ne" type="email">
<label for="cur">Current password</label><input id="cur" type="password" autocomplete="current-password"><button type="submit">Change email</button></form>
<p role="status" id="status"></p></main>
<script>
document.getElementById("pw").addEventListener("submit", function (e) {
  e.preventDefault();
  fetch("/api/password", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: document.getElementById("np").value }) })
    .then(function () { document.getElementById("status").textContent = "Password updated"; });
});
document.getElementById("em").addEventListener("submit", function (e) {
  e.preventDefault();
  document.getElementById("status").textContent = "Check your inbox";
});
</script>`,
  );
}

beforeAll(async () => {
  runsDir = await mkdtemp(join(tmpdir(), "rh-runner-hardening-"));
  server = await startFixtureServer({
    pages: {
      "/login": shell("Sign in", SIGN_IN),
      "/help": shell("Help", "<main><h1>Help</h1><p>Ask us.</p></main>"),
    },
    routes: {
      "GET /home": (req, res) => {
        const sid = sidOf(req);
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        // Signed out, the page shows the sign-in form in place: no redirect.
        res.end(sid ? dashboard(sid) : shell("Dashboard", SIGN_IN));
      },
      "POST /api/login": (req, res) => {
        const body = JSON.parse(req.body) as { username?: string; password?: string };
        if (body.username !== USERNAME || body.password !== PASSWORD) {
          res.writeHead(401, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "Wrong username or password" }));
          return;
        }
        const sid = randomBytes(16).toString("hex");
        sessions.add(sid);
        res.writeHead(200, { "content-type": "application/json", "set-cookie": `sid=${sid}; Path=/; HttpOnly; SameSite=Lax` });
        res.end(JSON.stringify({ ok: true }));
      },
      "PUT /api/password": (req, res) => {
        if (sidOf(req)) passwordChanges.push(req.body);
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
      },
      "GET /favicon.ico": (_req, res) => {
        res.writeHead(204);
        res.end();
      },
    },
  });
});

afterEach(() => {
  passwordChanges.length = 0;
});

afterAll(async () => {
  await server?.close();
  await rm(runsDir, { recursive: true, force: true });
});

function accounts(loginUrl = `${server.url}/login`): AccountsConfig {
  return {
    isolated: true,
    accounts: {
      a: { id: "a", label: "Account A", loginUrl, username: USERNAME, password: PASSWORD },
      b: { id: "b", label: "Account B", loginUrl: "", username: "", password: null },
    },
  };
}

async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries.filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name));
}

describe("a target that shows the sign-in form in place", () => {
  it("fails the plan when the session didn't reach it, and names the host mismatch", async () => {
    const loginUrl = `${server.url.replace("127.0.0.1", "localhost")}/login`;
    const err = await discoverAndPlan(`${server.url}/home`, { checks: [pageControls], signInAs: "a", accounts: accounts(loginUrl), allowedHosts: [] }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err, "discoverAndPlan should fail").toBeInstanceOf(Error);
    const message = (err as Error).message;
    expect(message).toContain("Signed in as Account A, but");
    expect(message).toContain("still shows the sign-in page");
    expect(message).toMatch(/localhost/);
    expect(message).toMatch(/127\.0\.0\.1/);
    expect(message).not.toContain(PASSWORD);
  });

  it("plans a signed-in page whose only other password field changes the email", async () => {
    const plan = await discoverAndPlan(`${server.url}/home`, { checks: [pageControls], signInAs: "a", accounts: accounts() });
    expect(plan.account).toEqual({ id: "a", label: "Account A" });
    expect(plan.page?.forms.map((f) => f.name)).toEqual(["Change password", "Change email"]);
  });
});

describe("account values in the plan and the run folder", () => {
  it("never writes the username, in any case, nor any session value, into the plan or the run folder", async () => {
    const plan = await discoverAndPlan(`${server.url}/home`, { checks: [pageControls, deepLinks], signInAs: "a", accounts: accounts() });
    const planText = JSON.stringify(plan);
    expect(planText.toLowerCase()).not.toContain(USERNAME.toLowerCase());
    for (const sid of sessions) expect(planText, "a session value in the plan").not.toContain(sid);
    // The link is still there, only without the session value.
    expect(plan.page?.linkTargets?.some((t) => t.includes("/help"))).toBe(true);

    const { report, dir } = await runPlan(plan, { checks: [pageControls, deepLinks], accounts: accounts(), runsDir, approved: plan.scenarios.map((s) => s.id) });
    expect(report.findings.length, "the account button does nothing: a finding that would name it").toBeGreaterThan(0);
    for (const file of await filesUnder(dir)) {
      expect(file.toLowerCase(), "a file name holds the username").not.toContain(USERNAME.toLowerCase());
      const content = (await readFile(file, "latin1")).toLowerCase();
      expect(content.includes(USERNAME.toLowerCase()), `${file} holds the username`).toBe(false);
      expect(content.includes(PASSWORD), `${file} holds the password`).toBe(false);
      for (const sid of sessions) expect(content.includes(sid), `${file} holds a session value`).toBe(false);
    }
  });
});

describe("a form that sets a password, on a signed-in run", () => {
  it("is destructive in the plan (credential-fields, which never submits, stays), and never submitted even with allowDestructive", async () => {
    const checks = [persistence, credentialFields];
    const plan = await discoverAndPlan(`${server.url}/home`, { checks, signInAs: "a", accounts: accounts() });
    const onPasswordForm = plan.scenarios.filter((s) => (s.formIndex ?? 0) === 0);
    const persist = onPasswordForm.find((s) => s.checkId === "persistence");
    expect(persist, "persistence is planned for the Change password form").toBeDefined();
    expect(persist!.destructive).toBe(true);
    expect(persist!.defaultSelected).toBe(false);
    const paste = onPasswordForm.find((s) => s.checkId === "credential-fields");
    expect(paste?.destructive).toBe(false);

    const { report } = await runPlan(plan, { checks, accounts: accounts(), runsDir, allowDestructive: true, approved: onPasswordForm.map((s) => s.id) });
    const skipped = report.results.find((r) => r.scenarioId === persist!.id);
    expect(skipped?.status).toBe("skipped");
    expect(skipped?.notes).toMatch(/password/i);
    expect(skipped?.notes).toMatch(/signed in|Account A/);
    expect(passwordChanges, "the account's password was changed").toEqual([]);
  });

  it("buildPlan marks it only when signed in: signed out, the same form plans as before", () => {
    const field = (key: string, extra: Partial<FormField> = {}): FormField => ({ key, accessibleName: key, label: key, placeholder: null, type: "password", role: "textbox", required: false, selector: `#${key}`, ...extra });
    const form: DiscoveredForm = {
      url: `${server.url}/home`,
      selector: "#pw",
      name: "Change password",
      index: 0,
      fields: [field("np", { autocomplete: "new-password" }), field("cp", { autocomplete: "new-password" })],
      controls: [{ role: "button", tag: "button", text: "Update password", accessibleName: "Update password", selector: "#pw button", isSubmit: true }],
    };
    const page: DiscoveredPage = { url: form.url, title: "Dashboard", forms: [form], controls: [], links: 0 };
    const signedOut = buildPlan(page.url, page, [persistence]);
    const signedIn = buildPlan(page.url, page, [persistence], { signedIn: true, otherAccount: false });
    expect(signedOut.scenarios.length).toBeGreaterThan(0);
    expect(signedOut.scenarios.some((s) => s.destructive)).toBe(false);
    expect(signedIn.scenarios.map((s) => s.id)).toEqual(signedOut.scenarios.map((s) => s.id));
    expect(signedIn.scenarios.every((s) => s.destructive && !s.defaultSelected)).toBe(true);
  });
});
