/**
 * Signed-in runs, the parts runner-accounts.test.ts leaves open (0.4.0, docs/v2-spec.md, v2 decisions):
 * - progress events (scenario-end results) are redacted like the report, since the server streams them to the UI;
 * - the run's secrets (passwords, session values, distinctive usernames) are registered only while the plan or run is
 *   going;
 * - an approved other-account scenario is skipped, with a reason, when the other account can't be used;
 * - a run whose session still lands on the sign-in page fails before any scenario, and leaves no run folder;
 * - the plan summary names the account.
 *
 * 0.6.0 (docs/v2-spec.md "0.6.0: write-side checks and sign-in"):
 * - write-access's other-account scenario signs Account B in like access-control's, and says what it can't do without
 *   it ("read or change");
 * - a sessionStorage session (SignedIn.sessionStorage) reaches every browser context the plan and the run open for
 *   that identity (discovery, the credential-header harvest, every scenario, as A and as B), so it passes the "still
 *   shows the sign-in page" check; one the app throws away on load still fails it, and so does a session that lands on
 *   the first step of a two-step sign-in page.
 */
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startAccountsApp, type AccountsApp } from "../../test-support/accounts-app.js";
import { startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import type { AccountsConfig } from "../interfaces/accounts.js";
import type { AccountRef, Check, CheckId, CheckResult, Plan, Scenario } from "../core/types.js";
import { SignInError } from "./auth.js";
import { planSummary } from "./plan.js";
import { redactSecrets } from "./redact.js";
import { discoverAndPlan, needsOtherAccount, runPlan, type ProgressEvent } from "./runner.js";

const A: AccountRef = { id: "a", label: "Account A" };

function scenario(checkId: CheckId, id: string): Scenario {
  return { id, checkId, title: `Fake ${id}`, description: "fake", kind: "golden", priority: "medium", destructive: false, defaultSelected: true, scope: "page" };
}

/** A page check whose notes echo both passwords, and an access-control check whose other-account scenario records what it got. */
function checksFor(app: AccountsApp, seen: string[]): Check[] {
  return [
    {
      id: "verbose-errors",
      title: "Fake echo",
      category: "security",
      scope: "page",
      plan: () => [scenario("verbose-errors", "echo")],
      async run(ctx, s): Promise<CheckResult> {
        await ctx.openPage();
        return { checkId: "verbose-errors", scenarioId: s.id, status: "pass", findings: [], durationMs: 1, notes: `Saw ${app.users.alice.password} and ${app.users.bob.password} for ${app.users.alice.email}` };
      },
    },
    {
      id: "access-control",
      title: "Fake access-control",
      category: "security",
      scope: "page",
      plan: () => [scenario("access-control", "access-control:other-account")],
      async run(ctx, s): Promise<CheckResult> {
        seen.push(s.id);
        await ctx.request("other", { url: `${app.url}/api/me` });
        return { checkId: "access-control", scenarioId: s.id, status: "pass", findings: [], durationMs: 1 };
      },
    },
  ];
}

function withoutB(config: AccountsConfig): AccountsConfig {
  return { ...config, accounts: { ...config.accounts, b: { id: "b", label: "Account B", loginUrl: "", username: "", password: null } } };
}

let app: AccountsApp;
/** The accounts app in tokenMode "session-storage" (0.6.0): its session lives only in sessionStorage. */
let tabTokenApp: AccountsApp;
let tabApp: FixtureServer;
let runsDir: string;

/** A one-step sign-in page whose submit runs `onSubmit` (in the page) and then goes to `next`. */
function loginPage(onSubmit: string, next: string): string {
  return `<!doctype html><html lang="en"><head><title>Sign in</title></head><body><main><h1>Sign in</h1>
<form id="f" aria-label="Sign in">
  <label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username">
  <label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password">
  <button type="submit">Sign in</button>
</form>
<script>document.getElementById("f").addEventListener("submit", (e) => { e.preventDefault(); ${onSubmit}; location.assign(${JSON.stringify(next)}); });</script>
</main></body></html>`;
}

/** A signed-in page: "Welcome" and a note form when `signedIn` (an expression, in the page) holds, else it runs `otherwise`. */
function appPage(signedIn: string, otherwise: string): string {
  return `<!doctype html><html lang="en"><head><title>App</title></head><body><main><h1>Loading</h1>
<form id="note"><label for="t">Note</label><input id="t" name="t"><button type="submit">Save</button></form>
<script>if (!(${signedIn})) { ${otherwise}; } else document.querySelector("h1").textContent = "Welcome";</script>
</main></body></html>`;
}

/**
 * Signs in with sessionStorage only: a storageState carries nothing, so a new context lands on /login again unless
 * it gets the sessionStorage items the sign-in left (0.6.0).
 */
const TAB_LOGIN = loginPage(`sessionStorage.setItem("token", "tab-" + Math.random().toString(36).slice(2) + "-" + Date.now())`, "/app");
const TAB_APP = appPage(`sessionStorage.getItem("token")`, `location.replace("/login?next=/app")`);

/**
 * A sessionStorage session the app throws away on load (still not supported in 0.6.0): the token is only good in the
 * tab it was made in (window.name holds the tab's id), so a new tab clears sessionStorage and goes back to sign in,
 * whatever it was seeded with.
 */
const ONCE_LOGIN = loginPage(
  `const tab = "t" + Math.random().toString(36).slice(2); window.name = tab; sessionStorage.setItem("token", "once-" + Math.random().toString(36).slice(2) + "-" + Date.now()); sessionStorage.setItem("tab", tab)`,
  "/once/app",
);
const ONCE_APP = appPage(
  `sessionStorage.getItem("token") && sessionStorage.getItem("tab") === window.name`,
  `sessionStorage.clear(); location.replace("/once/login?next=/once/app")`,
);

/**
 * A session kept only in the tab's memory (window.name): no new context has it. Signed out, the app sends the visitor
 * to the first step of a two-step sign-in page ("/auth/identifier", an Auth0-style address that is not the account's
 * sign-in page): an email field and "Continue", no password field yet.
 */
const MEMORY_LOGIN = loginPage(`window.name = "signed-in"`, "/memory/app");
const MEMORY_APP = appPage(`window.name === "signed-in"`, `location.replace("/auth/identifier?next=/memory/app")`);
const FIRST_STEP = `<!doctype html><html lang="en"><head><title>Sign in</title></head><body><main><h1>Sign in</h1>
<form id="first" aria-label="Sign in">
  <label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username">
  <button type="submit">Continue</button>
</form>
</main></body></html>`;

/**
 * A signed-in app page on an address that looks like sign-in to a path test ("/authors/new" has "auth" in it): signed
 * in (TAB_LOGIN's sessionStorage token), "/authors" sends the visitor there, to a form with one Email field and "Add".
 * It says nothing about signing in, so it is not the first step of a two-step sign-in, whatever the account's sign-in
 * page is called.
 */
const AUTHORS = `<!doctype html><html lang="en"><head><title>Authors</title></head><body><main><h1>Authors</h1>
<script>if (sessionStorage.getItem("token")) location.replace("/authors/new"); else location.replace("/login?next=/authors");</script>
</main></body></html>`;
const AUTHORS_NEW = `<!doctype html><html lang="en"><head><title>Add an author</title></head><body><main><h1>Add an author</h1>
<form id="author" aria-label="New author">
  <label for="author-email">Email</label><input id="author-email" name="email" type="email" autocomplete="email">
  <button type="submit">Add</button>
</form>
</main></body></html>`;

beforeAll(async () => {
  app = await startAccountsApp();
  tabTokenApp = await startAccountsApp({ tokenMode: "session-storage" });
  tabApp = await startFixtureServer({
    pages: {
      "/login": TAB_LOGIN,
      "/app": TAB_APP,
      "/once/login": ONCE_LOGIN,
      "/once/app": ONCE_APP,
      "/memory/login": MEMORY_LOGIN,
      "/memory/app": MEMORY_APP,
      "/auth/identifier": FIRST_STEP,
      "/authors": AUTHORS,
      "/authors/new": AUTHORS_NEW,
    },
  });
});
afterAll(async () => {
  await Promise.all([app?.stop(), tabTokenApp?.stop(), tabApp?.close()]);
});
beforeEach(async () => {
  runsDir = await mkdtemp(join(tmpdir(), "rh-runs-signed-in-"));
  for (const a of [app, tabTokenApp]) {
    a.reset();
    a.signOutEveryone();
  }
});

/** A test account on the fixture server `tabApp`, signing in at `path`. */
function tabAccounts(path: string): AccountsConfig {
  return {
    isolated: true,
    accounts: {
      a: { id: "a", label: "Account A", loginUrl: `${tabApp.url}${path}`, username: "someone@example.test", password: "tab-pass-1357" },
      b: { id: "b", label: "Account B", loginUrl: "", username: "", password: null },
    },
  };
}

/** Who signed in to an accounts app, in order (the identifiers POST /api/login got). */
function loginsOf(on: AccountsApp): string[] {
  return on.requests.filter((r) => r.method === "POST" && r.url === "/api/login").map((r) => (JSON.parse(r.body) as { email: string }).email);
}

/** A page check with one scenario that records whether it ran. */
function probeCheck(ran: string[]): Check {
  return {
    id: "dead-control",
    title: "Fake",
    category: "broken-feature",
    scope: "page",
    plan: () => [scenario("dead-control", "probe")],
    async run(_ctx, s) {
      ran.push(s.id);
      return { checkId: "dead-control", scenarioId: s.id, status: "pass", findings: [], durationMs: 1 };
    },
  };
}

/** runPlan's rejection, or null when it resolved. */
async function runError(plan: Plan, options: Parameters<typeof runPlan>[1]): Promise<unknown> {
  return runPlan(plan, options).then(
    () => null,
    (e: unknown) => e,
  );
}
afterEach(async () => {
  await rm(runsDir, { recursive: true, force: true });
});

describe("needsOtherAccount", () => {
  it("is true only for the other-account scenario of access-control or write-access (0.6.0), on any form", () => {
    expect(needsOtherAccount(scenario("access-control", "access-control:other-account"))).toBe(true);
    expect(needsOtherAccount(scenario("access-control", "access-control:other-account@form-2"))).toBe(true);
    expect(needsOtherAccount(scenario("access-control", "access-control:signed-out"))).toBe(false);
    expect(needsOtherAccount(scenario("dead-control", "other-account"))).toBe(false);
    expect(needsOtherAccount(scenario("write-access", "write-access:other-account"))).toBe(true);
    expect(needsOtherAccount(scenario("write-access", "write-access:other-account@form-1"))).toBe(true);
    // The ids plan.ts actually gives later forms and id collisions (a "@form-<n>" suffix from form 2, a doubled prefix, "#<n>").
    expect(needsOtherAccount(scenario("write-access", "write-access:other-account@form-2"))).toBe(true);
    expect(needsOtherAccount(scenario("write-access", "write-access:write-access:other-account#2"))).toBe(true);
    expect(needsOtherAccount(scenario("write-access", "write-access:write-access:other-account@form-2#2"))).toBe(true);
    expect(needsOtherAccount(scenario("write-access", "write-access:signed-out"))).toBe(false);
    expect(needsOtherAccount(scenario("write-access", "write-access:signed-out@form-2"))).toBe(false);
    expect(needsOtherAccount(scenario("csrf", "csrf:cross-site"))).toBe(false);
    expect(needsOtherAccount(scenario("paywall-trust", "paywall-trust:success-page"))).toBe(false);
  });
});

describe("a signed-in run", () => {
  it("redacts scenario results in progress events, and unregisters the run's secrets when it ends", async () => {
    const seen: string[] = [];
    const checks = checksFor(app, seen);
    const accounts = app.accountsConfig();
    const plan = await discoverAndPlan(`${app.url}/notes`, { checks, signInAs: "a", accounts });
    const events: ProgressEvent[] = [];

    const { report } = await runPlan(plan, { checks, runsDir, accounts, approved: ["echo"], onProgress: (e) => events.push(e) });

    const ends = events.filter((e) => e.type === "scenario-end");
    expect(ends).toHaveLength(1);
    const streamed = JSON.stringify(ends);
    expect(streamed).not.toContain(app.users.alice.password);
    expect(streamed).not.toContain(app.users.bob.password);
    expect(streamed).toContain("[REDACTED:account-secret]");
    expect(report.results[0]!.notes).toContain("[REDACTED:account-secret]");
    // Usernames too: reports name accounts by label only. Checks still match them (accountMarkers is unredacted).
    expect(streamed).not.toContain(app.users.alice.email);
    expect(JSON.stringify(report)).not.toContain(app.users.alice.email);
    // Once the run is over nothing stays registered: other text is never redacted by an old run.
    expect(redactSecrets(app.users.alice.password)).toBe(app.users.alice.password);
    expect(redactSecrets(app.users.bob.password)).toBe(app.users.bob.password);
    expect(redactSecrets(app.users.alice.email)).toBe(app.users.alice.email);
  });

  it("skips an approved other-account scenario, with the reason, when account B isn't set up", async () => {
    const seen: string[] = [];
    const checks = checksFor(app, seen);
    const full = app.accountsConfig();
    const plan = await discoverAndPlan(`${app.url}/notes`, { checks, signInAs: "a", accounts: full });
    expect(plan.scenarios.map((s) => s.id)).toContain("access-control:other-account");
    app.reset();

    const { report } = await runPlan(plan, { checks, runsDir, accounts: withoutB(full), approved: ["access-control:other-account"] });

    expect(seen).toEqual([]);
    const result = report.results.find((r) => r.scenarioId === "access-control:other-account");
    expect(result?.status).toBe("skipped");
    expect(result?.notes).toContain("Account B");
    expect(result?.notes).toContain("Settings → Test accounts");
    expect(report.accounts).toEqual({ signedInAs: A, other: null });
    // Only A signed in.
    const logins = app.requests.filter((r) => r.method === "POST" && r.url === "/api/login").map((r) => (JSON.parse(r.body) as { email: string }).email);
    expect(logins).toEqual([app.users.alice.email]);
  });

  it("fails before any scenario, and leaves no run folder, when its session still lands on the sign-in page", async () => {
    // 0.6.0 carries a sessionStorage session over (below), so this is one the app throws away on load: it is only good
    // in the tab that signed in, and a new tab clears it and goes back to /once/login.
    const accounts = tabAccounts("/once/login");
    const ran: string[] = [];
    const checks: Check[] = [probeCheck(ran)];
    const signedOut = await discoverAndPlan(`${tabApp.url}/once/app`, { checks });
    const plan: Plan = { ...signedOut, account: A };

    const err = await runError(plan, { checks, runsDir, accounts });

    expect(err).toBeInstanceOf(SignInError);
    expect((err as Error).message).toContain("Signed in as Account A, but");
    expect((err as Error).message).toContain("still shows the sign-in page");
    expect((err as Error).message).not.toContain("tab-pass-1357");
    expect(ran).toEqual([]);
    expect(await readdir(runsDir)).toEqual([]);

    // Discovery signed in fails the same way, although its context was seeded with the items the sign-in kept.
    const target = `${tabApp.url}/once/app`;
    const planned = await discoverAndPlan(target, { checks, signInAs: "a", accounts }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(planned).toBeInstanceOf(SignInError);
    expect((planned as Error).message).toContain("Signed in as Account A, but");
    expect((planned as Error).message).toContain(target);
    expect((planned as Error).message).toContain("still shows the sign-in page");
    expect((planned as Error).message).not.toContain("tab-pass-1357");
  });

  it("fails the same way when its session lands on the first step of a two-step sign-in page (0.6.0)", async () => {
    // The session lives in the tab's memory only; a new tab is sent to /auth/identifier: an email field and
    // "Continue", no password field yet, and not the account's sign-in page.
    const accounts = tabAccounts("/memory/login");
    const ran: string[] = [];
    const checks: Check[] = [probeCheck(ran)];
    const signedOut = await discoverAndPlan(`${tabApp.url}/memory/app`, { checks });
    const plan: Plan = { ...signedOut, account: A };

    const err = await runError(plan, { checks, runsDir, accounts });

    expect(err).toBeInstanceOf(SignInError);
    expect((err as Error).message).toContain("Signed in as Account A, but");
    expect((err as Error).message).toContain("still shows the sign-in page");
    expect(ran).toEqual([]);
    expect(await readdir(runsDir)).toEqual([]);

    // Discovery signed in stops the same way, before a plan of the sign-in page is made.
    const planned = await discoverAndPlan(`${tabApp.url}/memory/app`, { checks, signInAs: "a", accounts }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(planned).toBeInstanceOf(SignInError);
    expect((planned as Error).message).toContain("still shows the sign-in page");
  });

  it("doesn't take an app page it was sent to, on an address with \"auth\" in it, for the first step of a two-step sign-in (0.6.0)", async () => {
    // Signed in, /authors sends the visitor to /authors/new: one Email field and "Add", no sign-in words on the page.
    // The account's sign-in page is /login, but its address is not the page's own words.
    const accounts = tabAccounts("/login");
    const ran: string[] = [];
    const checks: Check[] = [probeCheck(ran)];
    const plan = await discoverAndPlan(`${tabApp.url}/authors`, { checks, signInAs: "a", accounts });

    expect(new URL(plan.form.url).pathname).toBe("/authors/new");
    expect(plan.page?.forms.map((f) => f.name)).toContain("New author");
    expect(plan.account).toEqual(A);

    const { report } = await runPlan(plan, { checks, runsDir, accounts });

    expect(report.results.map((r) => r.status)).toEqual(["pass"]);
    expect(ran).toEqual(["probe"]);
  });

  it("the plan summary says who the page was discovered as", async () => {
    const checks = checksFor(app, []);
    const plan = await discoverAndPlan(`${app.url}/notes`, { checks, signInAs: "a", accounts: app.accountsConfig() });
    expect(planSummary(plan)).toMatch(/^Signed in as Account A\. Found /);
    expect(planSummary({ ...plan, account: undefined })).toMatch(/^Found /);
  });
});

/** A fake write-access check (0.6.0) whose scenarios record who they got and what the app says B is. */
function writeAccessCheck(on: AccountsApp, seen: { scenarioId: string; other: AccountRef | null; otherMe: number | null }[]): Check {
  return {
    id: "write-access",
    title: "Fake write-access",
    category: "security",
    scope: "page",
    plan: () => [scenario("write-access", "write-access:other-account"), scenario("write-access", "write-access:signed-out")],
    async run(ctx, s): Promise<CheckResult> {
      const other = ctx.accounts?.other ?? null;
      const otherMe = other ? (await ctx.request("other", { url: `${on.url}/api/me` })).status : null;
      seen.push({ scenarioId: s.id, other, otherMe });
      return { checkId: "write-access", scenarioId: s.id, status: "pass", findings: [], durationMs: 1 };
    },
  };
}

describe("write-access in a signed-in run (0.6.0)", () => {
  const B: AccountRef = { id: "b", label: "Account B" };

  it("signs Account B in for an approved write-access:other-account scenario, and gives the check B", async () => {
    const seen: { scenarioId: string; other: AccountRef | null; otherMe: number | null }[] = [];
    const checks = [writeAccessCheck(app, seen)];
    const accounts = app.accountsConfig();
    const plan = await discoverAndPlan(`${app.url}/notes`, { checks, signInAs: "a", accounts });
    app.reset();

    const { report } = await runPlan(plan, { checks, runsDir, accounts, approved: ["write-access:other-account"] });

    expect(loginsOf(app)).toEqual([app.users.alice.email, app.users.bob.email]);
    expect(seen).toEqual([{ scenarioId: "write-access:other-account", other: B, otherMe: 200 }]);
    expect(report.results.find((r) => r.scenarioId === "write-access:other-account")?.status).toBe("pass");
    expect(report.accounts).toEqual({ signedInAs: A, other: B });
  });

  it("doesn't sign Account B in for write-access:signed-out alone", async () => {
    const seen: { scenarioId: string; other: AccountRef | null; otherMe: number | null }[] = [];
    const checks = [writeAccessCheck(app, seen)];
    const accounts = app.accountsConfig();
    const plan = await discoverAndPlan(`${app.url}/notes`, { checks, signInAs: "a", accounts });
    app.reset();

    const { report } = await runPlan(plan, { checks, runsDir, accounts, approved: ["write-access:signed-out"] });

    expect(loginsOf(app)).toEqual([app.users.alice.email]);
    expect(seen).toEqual([{ scenarioId: "write-access:signed-out", other: null, otherMe: null }]);
    expect(report.accounts).toEqual({ signedInAs: A, other: null });
  });

  it("skips write-access:other-account, saying no other account could read or change Account A's data, when Account B isn't set up", async () => {
    const seen: { scenarioId: string; other: AccountRef | null; otherMe: number | null }[] = [];
    const checks = [writeAccessCheck(app, seen)];
    const full = app.accountsConfig();
    const plan = await discoverAndPlan(`${app.url}/notes`, { checks, signInAs: "a", accounts: full });
    app.reset();

    const { report } = await runPlan(plan, { checks, runsDir, accounts: withoutB(full), approved: ["write-access:other-account"] });

    expect(seen).toEqual([]);
    const result = report.results.find((r) => r.scenarioId === "write-access:other-account");
    expect(result?.status).toBe("skipped");
    expect(result?.notes).toBe("Skipped: Account B isn't set up (Settings → Test accounts), so no other account could try to read or change Account A's data.");
    expect(loginsOf(app)).toEqual([app.users.alice.email]);
  });

  it("skips it with the isolation reason when the accounts aren't marked as unable to see each other's data", async () => {
    const seen: { scenarioId: string; other: AccountRef | null; otherMe: number | null }[] = [];
    const checks = [writeAccessCheck(app, seen)];
    const plan = await discoverAndPlan(`${app.url}/notes`, { checks, signInAs: "a", accounts: app.accountsConfig() });
    app.reset();

    const { report } = await runPlan(plan, { checks, runsDir, accounts: app.accountsConfig({ isolated: false }), approved: ["write-access:other-account"] });

    expect(seen).toEqual([]);
    const result = report.results.find((r) => r.scenarioId === "write-access:other-account");
    expect(result?.status).toBe("skipped");
    expect(result?.notes).toContain("not marked as unable to see each other's data");
    expect(loginsOf(app)).toEqual([app.users.alice.email]);
  });
});

/** What a sessionStorage run's fake checks saw, as each identity. */
interface TabSeen {
  heading: Record<string, string>;
  email: Record<string, string>;
  tokens: string[];
}

/** Waits for the accounts app's client to settle: the notes page (signed in) or the sign-in form. */
async function headingOf(page: import("playwright").Page): Promise<string> {
  await page.locator("h1:text-is('Your notes'), #signin-form").first().waitFor({ timeout: 10_000 });
  return (await page.locator("h1").first().textContent()) ?? "";
}

/**
 * A page check that opens the page as A, and an access-control one that opens it as B: each records the heading its
 * page shows, who /api/me says it is through CheckContext.request, and the token its tab holds (echoed in its notes).
 */
function tabChecks(on: AccountsApp, seen: TabSeen): Check[] {
  const probe = (identity: "self" | "other", checkId: CheckId, id: string): Check => ({
    id: checkId,
    title: `Fake ${id}`,
    category: "security",
    scope: "page",
    plan: () => [scenario(checkId, id)],
    async run(ctx, s): Promise<CheckResult> {
      const { page } = await ctx.openPage({ as: identity });
      seen.heading[identity] = await headingOf(page);
      const token = String((await page.evaluate("sessionStorage.getItem('token')")) ?? "");
      if (token) seen.tokens.push(token);
      const me = await ctx.request(identity, { url: `${on.url}/api/me` });
      seen.email[identity] = me.status === 200 ? String((JSON.parse(me.body) as { email?: string }).email) : `status ${me.status}`;
      return { checkId, scenarioId: s.id, status: "pass", findings: [], durationMs: 1, notes: `Tab token ${token}` };
    },
  });
  return [probe("self", "verbose-errors", "as-a"), probe("other", "access-control", "access-control:other-account")];
}

describe("a sessionStorage session (0.6.0)", () => {
  it("is discovered signed in: the discovery context gets the session's sessionStorage", async () => {
    const checks = tabChecks(tabTokenApp, { heading: {}, email: {}, tokens: [] });
    const plan = await discoverAndPlan(`${tabTokenApp.url}/notes`, { checks, signInAs: "a", accounts: tabTokenApp.accountsConfig() });

    expect(new URL(plan.form.url).pathname).toBe("/notes");
    expect(plan.account).toEqual(A);
    // The notes page's own form, not the sign-in form.
    expect(plan.page?.forms.some((f) => f.fields.some((field) => field.type === "password"))).toBe(false);
    expect(plan.page?.forms.some((f) => f.fields.some((field) => field.selector.includes("title")))).toBe(true);
  });

  it("reaches every scenario's contexts as A and as B, request() uses the app's own Authorization header, and its tokens are redacted", async () => {
    const seen: TabSeen = { heading: {}, email: {}, tokens: [] };
    const checks = tabChecks(tabTokenApp, seen);
    const accounts = tabTokenApp.accountsConfig();
    const plan = await discoverAndPlan(`${tabTokenApp.url}/notes`, { checks, signInAs: "a", accounts });
    tabTokenApp.reset();
    const events: ProgressEvent[] = [];

    const { report } = await runPlan(plan, { checks, runsDir, accounts, approved: ["as-a", "access-control:other-account"], onProgress: (e) => events.push(e) });

    expect(Object.fromEntries(report.results.map((r) => [r.scenarioId, r.status]))).toEqual({ "as-a": "pass", "access-control:other-account": "pass" });
    expect(seen.heading).toEqual({ self: "Your notes", other: "Your notes" });
    expect(seen.email).toEqual({ self: tabTokenApp.users.alice.email, other: tabTokenApp.users.bob.email });
    expect(loginsOf(tabTokenApp)).toEqual([tabTokenApp.users.alice.email, tabTokenApp.users.bob.email]);
    expect(report.accounts).toEqual({ signedInAs: A, other: { id: "b", label: "Account B" } });
    // Two different sessions, one per identity; neither reaches the report or the progress events.
    expect(seen.tokens).toHaveLength(2);
    expect(new Set(seen.tokens).size).toBe(2);
    const written = JSON.stringify(report);
    const streamed = JSON.stringify(events);
    for (const token of seen.tokens) {
      expect(written).not.toContain(token);
      expect(streamed).not.toContain(token);
    }
    for (const r of report.results) expect(r.notes).toMatch(/^Tab token \[REDACTED:[a-z-]+\]$/);
    // Once the run is over nothing stays registered.
    for (const token of seen.tokens) expect(redactSecrets(`x ${token} x`)).not.toContain("[REDACTED:account-secret]");
  });

  it("carries a sessionStorage-only session into the run's new tabs, so it passes the \"still shows the sign-in page\" check", async () => {
    const accounts = tabAccounts("/login");
    const headings: string[] = [];
    const checks: Check[] = [
      {
        id: "dead-control",
        title: "Fake",
        category: "broken-feature",
        scope: "page",
        plan: () => [scenario("dead-control", "probe")],
        async run(ctx, s) {
          const { page } = await ctx.openPage();
          headings.push((await page.locator("h1").first().textContent()) ?? "");
          return { checkId: "dead-control", scenarioId: s.id, status: "pass", findings: [], durationMs: 1 };
        },
      },
    ];
    const plan = await discoverAndPlan(`${tabApp.url}/app`, { checks, signInAs: "a", accounts });
    expect(new URL(plan.form.url).pathname).toBe("/app");

    const { report } = await runPlan(plan, { checks, runsDir, accounts });

    expect(report.results.map((r) => r.status)).toEqual(["pass"]);
    expect(headings).toEqual(["Welcome"]);
  });
});
