/**
 * Signed-in runs, the parts runner-accounts.test.ts leaves open (0.4.0, docs/v2-spec.md, v2 decisions):
 * - progress events (scenario-end results) are redacted like the report, since the server streams them to the UI;
 * - the run's secrets (passwords, session values, distinctive usernames) are registered only while the plan or run is
 *   going;
 * - an approved other-account scenario is skipped, with a reason, when the other account can't be used;
 * - a run whose session still lands on the sign-in page fails before any scenario, and leaves no run folder;
 * - the plan summary names the account.
 */
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startAccountsApp, type AccountsApp } from "../../test-support/accounts-app.js";
import { startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import type { AccountsConfig } from "../accounts/types.js";
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
let tabApp: FixtureServer;
let runsDir: string;

/** Signs in with sessionStorage only: a storageState carries nothing, so every new context lands on /login again. */
const TAB_LOGIN = `<!doctype html><html lang="en"><head><title>Sign in</title></head><body><main><h1>Sign in</h1>
<form id="f" aria-label="Sign in">
  <label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username">
  <label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password">
  <button type="submit">Sign in</button>
</form>
<script>document.getElementById("f").addEventListener("submit", (e) => { e.preventDefault(); sessionStorage.setItem("token", "tab-" + Math.random()); location.assign("/app"); });</script>
</main></body></html>`;
const TAB_APP = `<!doctype html><html lang="en"><head><title>App</title></head><body><main><h1>Loading</h1>
<form id="note"><label for="t">Note</label><input id="t" name="t"><button type="submit">Save</button></form>
<script>if (!sessionStorage.getItem("token")) location.replace("/login?next=/app"); else document.querySelector("h1").textContent = "Welcome";</script>
</main></body></html>`;

beforeAll(async () => {
  app = await startAccountsApp();
  tabApp = await startFixtureServer({ pages: { "/login": TAB_LOGIN, "/app": TAB_APP } });
});
afterAll(async () => {
  await Promise.all([app?.stop(), tabApp?.close()]);
});
beforeEach(async () => {
  runsDir = await mkdtemp(join(tmpdir(), "rh-runs-signed-in-"));
  app.reset();
  app.signOutEveryone();
});
afterEach(async () => {
  await rm(runsDir, { recursive: true, force: true });
});

describe("needsOtherAccount", () => {
  it("is true only for access-control's other-account scenario, on any form", () => {
    expect(needsOtherAccount(scenario("access-control", "access-control:other-account"))).toBe(true);
    expect(needsOtherAccount(scenario("access-control", "access-control:other-account@form-2"))).toBe(true);
    expect(needsOtherAccount(scenario("access-control", "access-control:signed-out"))).toBe(false);
    expect(needsOtherAccount(scenario("dead-control", "other-account"))).toBe(false);
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
    const accounts: AccountsConfig = {
      isolated: true,
      accounts: {
        a: { id: "a", label: "Account A", loginUrl: `${tabApp.url}/login`, username: "someone@example.test", password: "tab-pass-1357" },
        b: { id: "b", label: "Account B", loginUrl: "", username: "", password: null },
      },
    };
    const ran: string[] = [];
    const checks: Check[] = [
      {
        id: "dead-control",
        title: "Fake",
        category: "broken-feature",
        scope: "page",
        plan: () => [scenario("dead-control", "probe")],
        async run(_ctx, s) {
          ran.push(s.id);
          return { checkId: "dead-control", scenarioId: s.id, status: "pass", findings: [], durationMs: 1 };
        },
      },
    ];
    const signedOut = await discoverAndPlan(`${tabApp.url}/app`, { checks });
    const plan: Plan = { ...signedOut, account: A };

    const err = await runPlan(plan, { checks, runsDir, accounts }).then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(SignInError);
    expect((err as Error).message).toContain("Signed in as Account A, but");
    expect((err as Error).message).toContain("still shows the sign-in page");
    expect((err as Error).message).not.toContain("tab-pass-1357");
    expect(ran).toEqual([]);
    expect(await readdir(runsDir)).toEqual([]);
  });

  it("the plan summary says who the page was discovered as", async () => {
    const checks = checksFor(app, []);
    const plan = await discoverAndPlan(`${app.url}/notes`, { checks, signInAs: "a", accounts: app.accountsConfig() });
    expect(planSummary(plan)).toMatch(/^Signed in as Account A\. Found /);
    expect(planSummary({ ...plan, account: undefined })).toMatch(/^Found /);
  });
});
