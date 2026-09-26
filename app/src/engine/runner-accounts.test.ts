/**
 * Signed-in runs in the runner (0.4.0, docs/v2-spec.md "Signing in" and "Signed-in runs"):
 *
 * - discoverAndPlan(url, { signInAs, accounts }) signs in first, so discovery sees the signed-in page; the plan records
 *   the account by label only (Plan.account) and every check's plan() gets a PlanEnv.
 * - runPlan(plan, { accounts }) signs in again as the plan's account (a fresh session per run), and as the other
 *   account only when an approved scenario needs it; every scenario runs signed in; Report.accounts says who ran.
 * - A failed sign-in throws SignInError before discovery / before any scenario.
 * - planWarnings: signed out, a redirect to a sign-in page suggests signing in as a test account; signed in, a page
 *   that still shows the sign-in form fails the plan.
 * - A signed-in run never clicks session-ending controls, even with allowDestructive.
 * - Neither password nor the run's session value is written anywhere in the run folder.
 *
 * The app under test is the shared accounts app (test-support/accounts-app.ts); accounts are injected, never read
 * from the machine's config.
 */
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startAccountsApp, type AccountsApp } from "../../test-support/accounts-app.js";
import { startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import type { AccountsConfig } from "../accounts/types.js";
import { check as pageControls } from "../checks/page-controls.js";
import { check as persistence } from "../checks/persistence.js";
import type { AccountRef, Check, CheckContext, CheckId, CheckResult, Finding, Identity, Plan, PlanEnv, Report, Scenario } from "../core/types.js";
import { SignInError } from "./auth.js";
import { testDataSentence } from "./report.js";
import { discoverAndPlan, planWarnings, runPlan, type ProgressEvent } from "./runner.js";

const A: AccountRef = { id: "a", label: "Account A" };
const B: AccountRef = { id: "b", label: "Account B" };

function scenario(checkId: CheckId, id: string, extra: Partial<Scenario> = {}): Scenario {
  return { id, checkId, title: `Fake ${id}`, description: "fake", kind: "golden", priority: "medium", destructive: false, defaultSelected: true, ...extra };
}

const pass = (s: Scenario): CheckResult => ({ checkId: s.checkId, scenarioId: s.id, status: "pass", findings: [], durationMs: 1 });

/** What a fake check saw from inside a scenario. */
interface Seen {
  scenarioId: string;
  /** Path of the page openPage() landed on. */
  path: string;
  heading: string | null;
  /** Email /api/me answered for request("self"), else "status <n>" or "error: …". */
  me: string;
  /** The same for request("other"), when asked. */
  other?: string;
  accounts: CheckContext["accounts"];
  markers: string[];
}

async function observe(ctx: CheckContext, scenarioId: string, withOther = false): Promise<Seen> {
  const origin = new URL(ctx.targetUrl).origin;
  const { page } = await ctx.openPage();
  const heading = await page.locator("h1").first().textContent({ timeout: 5_000 }).catch(() => null);
  const whoAmI = (as: Identity) =>
    ctx.request(as, { url: `${origin}/api/me` }).then(
      (r) => (r.status === 200 ? String((JSON.parse(r.body) as { email?: string }).email) : `status ${r.status}`),
      (err: unknown) => `error: ${err instanceof Error ? err.message : String(err)}`,
    );
  return {
    scenarioId,
    path: new URL(page.url()).pathname,
    heading,
    me: await whoAmI("self"),
    ...(withOther ? { other: await whoAmI("other") } : {}),
    accounts: ctx.accounts,
    markers: ctx.accountMarkers(),
  };
}

/** A page-scoped fake check with two scenarios that records what each saw, and the PlanEnv each plan() got. */
function probeCheck(seen: Seen[], envs: (PlanEnv | undefined)[] = []): Check {
  return {
    id: "dead-control",
    title: "Fake probe",
    category: "broken-feature",
    scope: "page",
    plan(_form, _page, env) {
      envs.push(env);
      return [scenario("dead-control", "probe:one"), scenario("dead-control", "probe:two")];
    },
    async run(ctx, s) {
      seen.push(await observe(ctx, s.id));
      return pass(s);
    },
  };
}

/** A fake access-control check whose one scenario needs the other account. */
function otherAccountCheck(seen: Seen[]): Check {
  return {
    id: "access-control",
    title: "Fake access-control",
    category: "security",
    scope: "page",
    plan: () => [scenario("access-control", "access-control:other-account")],
    async run(ctx, s) {
      seen.push(await observe(ctx, s.id, true));
      return pass(s);
    },
  };
}

/**
 * A check that writes both passwords and the session value it can see into everything a check can write: step
 * labels, log lines, a card, a frame, a finding (every text field, a location, evidence data, a spec and its file
 * name) and the notes. As if the page echoed them back.
 */
function leakCheck(app: AccountsApp, saw: { session?: string }): Check {
  const pwA = app.users.alice.password;
  const pwB = app.users.bob.password;
  return {
    id: "verbose-errors",
    title: "Fake leak",
    category: "security",
    scope: "page",
    plan: () => [scenario("verbose-errors", "leak:echo")],
    async run(ctx, s) {
      const { page, context } = await ctx.openPage();
      const session =
        app.options.tokenMode === "cookie"
          ? (await context.cookies()).find((c) => c.name === "sid")?.value
          : ((await page.evaluate(() => localStorage.getItem("token"))) ?? undefined);
      saw.session = session;
      const value = session ?? "no-session-in-this-context";
      const all = `${pwA} ${pwB} ${value}`;
      ctx.step(`Reading ${all}`, page);
      ctx.log(`Saw ${all}`);
      const card = await ctx.captureCard(`Response with ${pwA}`, {
        title: `GET /api/me with ${value}`,
        subtitle: pwB,
        lines: [{ text: `cookie: sid=${value}` }, { text: `password=${pwA}&other=${pwB}`, mark: true }],
        facts: [{ label: "Password", value: pwA }],
      });
      const frame = await ctx.capture(page, `Frame ${pwB}`, { caption: `Session ${value}`, step: `Step ${pwA}`, facts: [{ label: "Token", value }] });
      const finding: Finding = {
        checkId: "verbose-errors",
        id: "verbose-errors#1",
        title: `The page shows ${pwA}`,
        severity: "high",
        category: "security",
        confidence: "confirmed",
        meaning: all,
        impact: all,
        fix: `Stop echoing ${all}`,
        location: pwA,
        locations: [pwA, value],
        evidence: [card, frame, { kind: "note", label: `Note ${pwB}`, data: { session: value, password: pwA } }],
        spec: { filename: `leak-${pwA}.spec.ts`, source: `// ${all}\n` },
      };
      return { checkId: "verbose-errors", scenarioId: s.id, status: "fail", findings: [finding], durationMs: 1, notes: `Saw ${all}` };
    },
  };
}

/** Emails of every POST /api/login the app received (in order). */
function logins(app: AccountsApp): string[] {
  return app.requests
    .filter((r) => r.method === "POST" && r.url === "/api/login")
    .map((r) => String((JSON.parse(r.body || "{}") as { email?: string }).email ?? ""));
}

/** Every session value (sid cookie or bearer token) the app received. */
function sessionValuesSent(app: AccountsApp): string[] {
  const out = new Set<string>();
  for (const r of app.requests) {
    for (const m of String(r.headers.cookie ?? "").matchAll(/(?:^|;\s*)sid=([^;]+)/g)) if (m[1]) out.add(m[1]);
    const bearer = /^Bearer\s+(\S+)$/i.exec(String(r.headers.authorization ?? ""));
    if (bearer?.[1]) out.add(bearer[1]);
  }
  return [...out];
}

async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries.filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name));
}

/** The error a promise rejected with, or null when it resolved. */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (err: unknown) => err,
  );
}

function withAccount(config: AccountsConfig, id: "a" | "b", patch: Partial<AccountsConfig["accounts"]["a"]>): AccountsConfig {
  return { ...config, accounts: { ...config.accounts, [id]: { ...config.accounts[id], ...patch } } };
}

/**
 * An app that keeps its session in sessionStorage: signing in works in the sign-in tab, but a storageState (cookies
 * and localStorage) carries nothing, so every new context lands on the sign-in page again.
 */
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

let app: AccountsApp;
let bearerApp: AccountsApp;
let tabApp: FixtureServer;
let runsDir: string;
const notes = () => `${app.url}/notes`;

beforeAll(async () => {
  [app, bearerApp] = await Promise.all([startAccountsApp(), startAccountsApp({ tokenMode: "bearer" })]);
  tabApp = await startFixtureServer({ pages: { "/login": TAB_LOGIN, "/app": TAB_APP } });
});

afterAll(async () => {
  await Promise.all([app?.stop(), bearerApp?.stop(), tabApp?.close()]);
});

beforeEach(async () => {
  runsDir = await mkdtemp(join(tmpdir(), "rh-runs-accounts-"));
  for (const a of [app, bearerApp]) {
    a.reset();
    a.signOutEveryone();
  }
});

afterEach(async () => {
  await rm(runsDir, { recursive: true, force: true });
});

describe("discoverAndPlan with signInAs", () => {
  it("signs in first, so discovery sees the signed-in page; Plan.account names the account by label only", async () => {
    const plan = await discoverAndPlan(notes(), { checks: [probeCheck([])], signInAs: "a", accounts: app.accountsConfig() });

    expect(new URL(plan.form.url).pathname).toBe("/notes");
    expect(plan.page?.forms.map((f) => f.name)).toEqual(["New note", "Profile"]);
    expect(plan.account).toStrictEqual(A);
    expect(planWarnings(plan)).toEqual([]);
    expect(logins(app)).toContain(app.users.alice.email);
    const json = JSON.stringify(plan);
    expect(json).not.toContain(app.users.alice.password);
    expect(json).not.toContain(app.users.bob.password);
  });

  it("tells every check whether the run is signed in and has another account (PlanEnv)", async () => {
    const envs: (PlanEnv | undefined)[] = [];
    const checks = [probeCheck([], envs)];

    await discoverAndPlan(notes(), { checks, signInAs: "a", accounts: app.accountsConfig() });
    expect(envs.at(-1)).toEqual({ signedIn: true, otherAccount: true });

    // The user did not say A and B must not see each other's data: no other-account checks.
    await discoverAndPlan(notes(), { checks, signInAs: "a", accounts: app.accountsConfig({ isolated: false }) });
    expect(envs.at(-1)).toEqual({ signedIn: true, otherAccount: false });

    // Account B has no password, so it can't be signed in.
    await discoverAndPlan(notes(), { checks, signInAs: "a", accounts: withAccount(app.accountsConfig(), "b", { password: null }) });
    expect(envs.at(-1)).toEqual({ signedIn: true, otherAccount: false });

    // Signed out: no env, or one that says so.
    await discoverAndPlan(notes(), { checks, accounts: app.accountsConfig() });
    expect(envs.at(-1)?.signedIn ?? false).toBe(false);
    expect(envs.at(-1)?.otherAccount ?? false).toBe(false);
  });

  it("a failed sign-in throws SignInError with the page's error text, before anything is discovered", async () => {
    const envs: (PlanEnv | undefined)[] = [];
    const accounts = withAccount(app.accountsConfig(), "a", { password: "wrong-pass-0000" });
    const err = await rejection(discoverAndPlan(notes(), { checks: [probeCheck([], envs)], signInAs: "a", accounts }));

    expect(err).toBeInstanceOf(SignInError);
    const message = (err as Error).message;
    expect(message).toContain("Email or password is incorrect");
    expect(message).not.toContain("wrong-pass-0000");
    expect(envs).toEqual([]);
    expect(app.requests.some((r) => r.method === "GET" && r.url === "/notes")).toBe(false);
  });
});

describe("planWarnings and the sign-in page", () => {
  it("signed out, a redirect to a sign-in page suggests signing in as a test account", async () => {
    const plan = await discoverAndPlan(notes(), { checks: [probeCheck([])] });
    expect(plan.account).toBeUndefined();

    const warnings = planWarnings(plan);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/\/notes redirected to .*\/login\?next=\/notes/);
    expect(warnings[0]).toContain("Sign in as a test account");
    expect(warnings[0]).toContain("Settings → Test accounts");
    expect(warnings[0]).toContain("--as a");
    expect(warnings[0]).not.toContain("aren't supported yet");
  });

  it("signed in, a page that still shows the sign-in form fails the plan", async () => {
    const accounts: AccountsConfig = {
      isolated: true,
      accounts: {
        a: { id: "a", label: "Account A", loginUrl: `${tabApp.url}/login`, username: "someone@example.test", password: "tab-pass-1357" },
        b: { id: "b", label: "Account B", loginUrl: "", username: "", password: null },
      },
    };
    const target = `${tabApp.url}/app`;
    const err = await rejection(discoverAndPlan(target, { checks: [probeCheck([])], signInAs: "a", accounts }));

    expect(err, "discoverAndPlan should fail").toBeInstanceOf(Error);
    const message = (err as Error).message;
    expect(message).toContain("Signed in as Account A, but");
    expect(message).toContain(target);
    expect(message).toContain("still shows the sign-in page");
    expect(message).toContain("Settings → Test accounts");
    expect(message).not.toContain("tab-pass-1357");
  });
});

describe("runPlan signed in", () => {
  it("signs in again at the start of the run and runs every scenario signed in, as the plan's account", async () => {
    const seen: Seen[] = [];
    const checks = [probeCheck(seen)];
    const accounts = app.accountsConfig();
    const plan = await discoverAndPlan(notes(), { checks, signInAs: "a", accounts });
    // The discovery session is gone: only a new sign-in can make the run work.
    app.signOutEveryone();
    app.reset();

    const { report, dir } = await runPlan(plan, { checks, runsDir, accounts });

    expect(seen.map((s) => s.scenarioId)).toEqual(["probe:one", "probe:two"]);
    for (const s of seen) {
      expect(s.path).toBe("/notes");
      expect(s.heading).toBe("Your notes");
      expect(s.me).toBe(app.users.alice.email);
      expect(s.accounts).toStrictEqual({ self: A, other: null });
      expect(s.markers).toContain(app.users.alice.email);
    }
    // One sign-in, as A. No scenario needed B, so B was never signed in.
    expect(logins(app)).toEqual([app.users.alice.email]);
    expect(report.accounts).toStrictEqual({ signedInAs: A, other: null });
    const onDisk = JSON.parse(await readFile(join(dir, "report.json"), "utf8")) as Report;
    expect(onDisk.accounts).toStrictEqual({ signedInAs: A, other: null });
    expect(onDisk.plan.account).toStrictEqual(A);
  });

  it("a plan discovered as Account B (with its own label) runs as Account B", async () => {
    const seen: Seen[] = [];
    const checks = [probeCheck(seen)];
    const accounts = withAccount(app.accountsConfig(), "b", { label: "Bob's test user" });
    const plan = await discoverAndPlan(notes(), { checks, signInAs: "b", accounts });
    expect(plan.account).toStrictEqual({ id: "b", label: "Bob's test user" });
    app.reset();

    const { report } = await runPlan(plan, { checks, runsDir, accounts });

    expect(seen.map((s) => s.me)).toEqual([app.users.bob.email, app.users.bob.email]);
    expect(logins(app)).toEqual([app.users.bob.email]);
    expect(report.accounts).toStrictEqual({ signedInAs: { id: "b", label: "Bob's test user" }, other: null });
  });

  it("signs the other account in when an approved scenario needs it, and the report says so", async () => {
    const seen: Seen[] = [];
    const checks = [probeCheck(seen), otherAccountCheck(seen)];
    const accounts = app.accountsConfig();
    const plan = await discoverAndPlan(notes(), { checks, signInAs: "a", accounts });
    app.reset();

    const { report } = await runPlan(plan, { checks, runsDir, accounts, approved: ["access-control:other-account"] });

    const other = seen.find((s) => s.scenarioId === "access-control:other-account");
    expect(other?.me).toBe(app.users.alice.email);
    expect(other?.other).toBe(app.users.bob.email);
    expect(other?.accounts).toStrictEqual({ self: A, other: B });
    expect([...logins(app)].sort()).toEqual([app.users.alice.email, app.users.bob.email].sort());
    expect(report.accounts).toStrictEqual({ signedInAs: A, other: B });
  });

  it("real checks run signed in: persistence passes on /notes, and its test record belongs to Account A", async () => {
    const accounts = app.accountsConfig();
    const plan = await discoverAndPlan(notes(), { checks: [persistence], signInAs: "a", accounts });
    expect(plan.scenarios.map((s) => s.id)).toContain("canary-reload");
    app.reset();

    const { report } = await runPlan(plan, { checks: [persistence], runsDir, accounts, approved: ["canary-reload"] });

    const result = report.results.find((r) => r.scenarioId === "canary-reload");
    expect(result?.status, result?.notes).toBe("pass");
    const created = app.notes().filter((n) => !["n1", "n2", "n3"].includes(n.id));
    expect(created.length).toBeGreaterThan(0);
    expect(created.map((n) => n.ownerId)).toEqual(created.map(() => app.users.alice.id));
    expect(report.testRecordsCreated).toBeGreaterThanOrEqual(1);
    expect(testDataSentence(report)).toContain("Account A");
  });

  it("a failed sign-in fails the run with SignInError before any scenario", async () => {
    const seen: Seen[] = [];
    const checks = [probeCheck(seen)];
    const signedOut = await discoverAndPlan(notes(), { checks });
    // A plan discovered as Account A, whose password has changed since.
    const plan: Plan = { ...signedOut, account: A };
    const accounts = withAccount(app.accountsConfig(), "a", { password: "wrong-pass-0000" });
    const events: ProgressEvent[] = [];

    const err = await rejection(runPlan(plan, { checks, runsDir, accounts, onProgress: (e) => events.push(e) }));

    expect(err).toBeInstanceOf(SignInError);
    const message = (err as Error).message;
    expect(message).toContain("Email or password is incorrect");
    expect(message).not.toContain("wrong-pass-0000");
    expect(seen).toEqual([]);
    expect(events.filter((e) => e.type === "scenario-start")).toEqual([]);
  });

  it("never clicks Log out in a signed-in run, even with allowDestructive, and says why", async () => {
    const accounts = app.accountsConfig();
    const plan = await discoverAndPlan(notes(), { checks: [pageControls], signInAs: "a", accounts });
    const logout = plan.page?.controls.find((c) => /log out/i.test(`${c.accessibleName ?? ""} ${c.text}`));
    expect(logout, "the signed-in page has a Log out button outside its forms").toBeDefined();
    // page-controls plans nothing when a page's only control ends the session; add its scenario as a user could.
    const id = "page-controls:click-outside-forms";
    const withScenario: Plan = {
      ...plan,
      scenarios: [
        ...plan.scenarios,
        scenario("page-controls", id, { title: "Click every button outside the forms", priority: "high", scope: "page", scopeLabel: "Whole page" }),
      ],
    };
    app.reset();

    const { report } = await runPlan(withScenario, { checks: [pageControls], runsDir, accounts, approved: [id], allowDestructive: true });

    const resultNotes = report.results.find((r) => r.scenarioId === id)?.notes ?? "";
    expect(resultNotes).toContain("Log out");
    expect(resultNotes).toMatch(/sign|session/i);
    expect(resultNotes).not.toMatch(/"Log out": (?:request|navigation|DOM change|storage change|value change|focus change|no reaction)/);
    // Give a click that did happen time to reach the app.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(app.requests.some((r) => r.url.startsWith("/api/logout"))).toBe(false);
  });
});

describe("secrets stay out of the run folder", () => {
  it.each(["cookie", "bearer"] as const)("%s sessions: neither password nor the session value is written anywhere", async (mode) => {
    const target = mode === "cookie" ? app : bearerApp;
    const saw: { session?: string } = {};
    const checks = [leakCheck(target, saw)];
    const accounts = target.accountsConfig();
    const plan = await discoverAndPlan(`${target.url}/notes`, { checks, signInAs: "a", accounts });
    target.reset();
    const lines: string[] = [];
    const steps: string[] = [];

    const { report, dir } = await runPlan(plan, {
      checks,
      runsDir,
      accounts,
      log: (line) => lines.push(line),
      onProgress: (e) => {
        if (e.type === "step") steps.push(`${e.label} ${e.url}`);
      },
    });

    expect(saw.session, "the check's page had the run's session").toBeTruthy();
    const secrets: [string, string][] = [
      ["Account A's password", target.users.alice.password],
      ["Account B's password", target.users.bob.password],
      ...[...new Set([saw.session!, ...sessionValuesSent(target)])].map((v): [string, string] => ["a session value", v]),
    ];

    // The run wrote its usual files, and the leaky finding (redacted) is in them.
    const files = await filesUnder(dir);
    const names = files.map((f) => relative(dir, f));
    expect(names).toEqual(expect.arrayContaining(["report.json", "report.md", "report.html"]));
    expect(names.some((n) => n.startsWith(`specs${sep}`))).toBe(true);
    expect(names.filter((n) => n.endsWith(".png")).length).toBeGreaterThanOrEqual(2);
    expect(report.findings).toHaveLength(1);
    expect(await readFile(join(dir, "report.json"), "utf8")).toContain("[REDACTED:account-secret]");

    for (const file of files) {
      const name = relative(dir, file);
      const content = await readFile(file);
      for (const [what, value] of secrets) {
        expect(name.includes(value), `${what} in the file name ${name}`).toBe(false);
        expect(content.includes(value), `${what} inside ${name}`).toBe(false);
      }
    }
    for (const [what, value] of secrets) {
      expect(JSON.stringify(report).includes(value), `${what} in the report runPlan returned`).toBe(false);
      expect(lines.some((l) => l.includes(value)), `${what} in a log line`).toBe(false);
      expect(steps.some((l) => l.includes(value)), `${what} in a step`).toBe(false);
    }
  });
});
