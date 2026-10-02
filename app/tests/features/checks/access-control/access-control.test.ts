/**
 * access-control (0.4.0, docs/v2-spec.md "access-control"): can account B, or a signed-out visitor, read account A's
 * data? Driven against the shared accounts app (test-support/accounts-app.ts) signed in as alice (A) with bob (B),
 * through createCheckContext with sessions from app.storageState(), plus one run through discoverAndPlan/runPlan.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser } from "playwright";
import { startAccountsApp, type AccountsApp, type AccountsAppOptions } from "../../test-support/accounts-app.js";
import { closeBrowser, getBrowser } from "../../test-support/harness.js";
import { json, startFixtureServer, type FixtureServer, type RecordedRequest } from "../../test-support/server.js";
import { expectWellFormedFinding } from "../../test/fixtures/checks/assert-finding.js";
import type { AccountRef, CheckResult, DiscoveredPage, Finding, Scenario } from "../core/types.js";
import type { SessionState } from "../engine/auth.js";
import { createCheckContext, type RunningCheckContext } from "../engine/context.js";
import { discoverPage, emptyForm } from "../engine/discover.js";
import { discoverAndPlan, runPlan } from "../engine/runner.js";
import { check } from "./access-control.js";

const A: AccountRef = { id: "a", label: "Account A" };
const B: AccountRef = { id: "b", label: "Account B" };
/** Lowercase letters and digits, so canary values keep it as is. */
const RUN_TOKEN = "ac7e57a1";

type Which = "other-account" | "signed-out";

let browser: Browser;
const apps: AccountsApp[] = [];
const servers: FixtureServer[] = [];
const contexts: RunningCheckContext[] = [];
const dirs: string[] = [];

beforeAll(async () => {
  browser = await getBrowser();
});
afterEach(async () => {
  await Promise.all(contexts.splice(0).map((c) => c.dispose()));
  await Promise.all(apps.splice(0).map((a) => a.stop()));
  await Promise.all(servers.splice(0).map((s) => s.close()));
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
afterAll(closeBrowser);

async function start(options: AccountsAppOptions = {}): Promise<AccountsApp> {
  const app = await startAccountsApp(options);
  apps.push(app);
  return app;
}

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** The cookie value or bearer token a storage state holds (what identifies that session to the app). */
function sessionValue(state: SessionState): string {
  const value = state.cookies[0]?.value ?? state.origins[0]?.localStorage.find((e) => e.name === "token")?.value;
  if (!value) throw new Error("the storage state holds no session");
  return value;
}

/** Discovers `path` signed in with `state` (the page renders after GET /api/me). */
async function discoverWith(url: string, state: SessionState): Promise<DiscoveredPage> {
  const context = await browser.newContext({ storageState: state });
  try {
    const page = await context.newPage();
    await page.goto(url);
    await page.getByRole("heading", { level: 1 }).waitFor();
    await page.waitForLoadState("networkidle");
    return await discoverPage(page);
  } finally {
    await context.close();
  }
}

/** The scenario as the check plans it signed in (spec ids), with the scope buildPlan adds to page-scoped checks. */
function scenarioFor(which: Which, page: DiscoveredPage): Scenario {
  const id = `access-control:${which}`;
  const planned = check.plan(page.forms[0] ?? emptyForm(page.url), page, { signedIn: true, otherAccount: which === "other-account" }).find((s) => s.id === id);
  const fallback: Scenario = {
    id,
    checkId: "access-control",
    title: which === "other-account" ? "Another account can't read Account A's data" : "Signed-out visitors can't read Account A's data",
    description: "",
    kind: "danger",
    priority: "high",
    destructive: false,
    defaultSelected: true,
  };
  return { ...(planned ?? fallback), scope: "page", scopeLabel: "Whole page" };
}

interface Ran {
  result: CheckResult;
  ctx: RunningCheckContext;
  /** Session values (sid cookie or bearer token) of the two identities. */
  alice: string;
  bob: string | null;
}

/**
 * Runs one access-control scenario on `path` of the accounts app as the runner would: A = alice (the run account),
 * B = bob only for other-account, A's marker = her username (the email). app.requests holds only the run's requests.
 */
async function runScenario(app: AccountsApp, which: Which, options: { path?: string; markers?: string[] } = {}): Promise<Ran> {
  const path = options.path ?? "/notes";
  const targetUrl = app.url + path;
  const discovered = await discoverWith(targetUrl, app.storageState("alice"));
  app.reset();
  const self = app.storageState("alice");
  const other = which === "other-account" ? app.storageState("bob") : undefined;
  const ctx = createCheckContext({
    browser,
    form: discovered.forms[0] ?? emptyForm(targetUrl),
    discoveredPage: discovered,
    targetUrl,
    artifactsDir: await tempDir("rh-access-control-"),
    runToken: RUN_TOKEN,
    checkId: "access-control",
    sessions: other ? { self, other } : { self },
    accounts: { self: A, other: other ? B : null },
    markers: options.markers ?? [app.users.alice.email],
  });
  contexts.push(ctx);
  const result = await check.run(ctx, scenarioFor(which, discovered));
  return { result, ctx, alice: sessionValue(self), bob: other ? sessionValue(other) : null };
}

const gets = (app: AccountsApp, url: string) => app.requests.filter((r) => r.method === "GET" && r.url === url);
const carries = (r: RecordedRequest, session: string) => (r.headers.cookie ?? "").includes(session) || r.headers.authorization === `Bearer ${session}`;
const credentialless = (r: RecordedRequest) => r.headers.cookie === undefined && r.headers.authorization === undefined;
const writes = (app: AccountsApp) => app.requests.filter((r) => r.method !== "GET" && r.method !== "HEAD").map((r) => `${r.method} ${r.url}`);

/** Usernames, passwords and session values never appear in a result (findings, evidence, notes, spec). */
function expectNoAccountValues(result: CheckResult, app: AccountsApp, sessions: (string | null)[]) {
  const text = JSON.stringify(result);
  const { alice, bob } = app.users;
  for (const value of [alice.email, alice.password, bob.email, bob.password, ...sessions]) {
    if (value) expect(text, "a username, password or session value was printed").not.toContain(value);
  }
}

function onlyFinding(result: CheckResult): Finding {
  expect(result.status).toBe("fail");
  expect(result.findings).toHaveLength(1);
  const f = result.findings[0]!;
  expectWellFormedFinding(f, { checkId: "access-control", category: "security", severity: "critical", confidence: "confirmed" });
  return f;
}

/** The finding's reproduction spec: two request.newContext identities whose credentials come from the environment. */
function expectReplaySpec(f: Finding) {
  expect(f.spec!.source).toContain("request.newContext");
  expect(f.spec!.source).toContain("process.env");
}

describe("access-control:other-account", () => {
  it("clean: passes after checking A's three data requests as B; B opened the page, then replayed each GET", async () => {
    const app = await start();
    const { result, ctx, bob } = await runScenario(app, "other-account");

    expect(result.status).toBe("pass");
    expect(result.findings).toEqual([]);
    // A's data on /notes: GET /api/me and GET /api/users/u1/profile (her email), GET /api/notes (the test record).
    expect(result.notes).toMatch(/Checked 3 of Account A's requests as Account B; none returned Account A's data/);

    // Step 1: A saved a test record through the main form ("New note"), carrying the run token.
    expect(app.notes().some((n) => n.ownerId === "u1" && `${n.title} ${n.body}`.includes(RUN_TOKEN))).toBe(true);
    expect(ctx.testRecordsCreated()).toBeGreaterThanOrEqual(1);
    // B opened the page with B's session, and replayed A's requests with it.
    expect(gets(app, "/api/me").some((r) => carries(r, bob!))).toBe(true);
    expect(gets(app, "/api/users/u1/profile").some((r) => carries(r, bob!))).toBe(true);
    // Read-only: the only write is A's test record; nobody was signed out.
    expect(writes(app)).toEqual(["POST /api/notes"]);
    expectNoAccountValues(result, app, [bob]);
  });

  it("listLeak (V02): one critical, confirmed finding naming GET /api/notes; A's record is described, never printed", async () => {
    const app = await start({ listLeak: true });
    const { result, alice, bob } = await runScenario(app, "other-account");

    const f = onlyFinding(result);
    expect(f.title).toMatch(/Account B can read Account A's data \(1 endpoint/);
    expect(f.locations).toEqual([expect.stringMatching(/^GET \/api\/notes\b/)]);
    const kinds = f.evidence.map((e) => e.kind);
    expect(kinds).toContain("card");
    // A's test record is on B's own notes list, so a frame of B's page shows it.
    expect(kinds).toContain("frame");
    expect(JSON.stringify(f.evidence)).toContain("Account A's test record");
    expectReplaySpec(f);
    expectNoAccountValues(result, app, [alice, bob]);
    expect(writes(app)).toEqual(["POST /api/notes"]);
  });

  it("idor (V01): names GET /api/users/u1/profile; A's email is shown only as \"Account A's email\"", async () => {
    const app = await start({ idor: true });
    const { result, alice, bob } = await runScenario(app, "other-account");

    const f = onlyFinding(result);
    expect(f.title).toMatch(/Account B can read Account A's data/);
    expect(f.locations).toEqual([expect.stringMatching(/^GET \/api\/users\/u1\/profile\b/)]);
    expect(f.evidence.some((e) => e.kind === "card")).toBe(true);
    expect(JSON.stringify(f.evidence)).toContain("Account A's email");
    expectReplaySpec(f);
    expectNoAccountValues(result, app, [alice, bob]);
  });

  it("bearer tokens: B's replays carry the Authorization header B's own page sent (idor is still found)", async () => {
    const app = await start({ tokenMode: "bearer", idor: true });
    const { result, alice, bob } = await runScenario(app, "other-account");

    const f = onlyFinding(result);
    expect(f.locations).toEqual([expect.stringMatching(/^GET \/api\/users\/u1\/profile\b/)]);
    expect(gets(app, "/api/users/u1/profile").some((r) => r.headers.authorization === `Bearer ${bob}`)).toBe(true);
    expectNoAccountValues(result, app, [alice, bob]);
  });

  it("noAuth doesn't change it: B has a session of its own, so B only sees B's data", async () => {
    const app = await start({ noAuth: true });
    const { result } = await runScenario(app, "other-account");
    expect(result.status).toBe("pass");
    expect(result.findings).toEqual([]);
  });
});

describe("access-control:signed-out", () => {
  it("clean: passes; A's data requests were replayed with no cookie and no Authorization header", async () => {
    const app = await start();
    const { result, alice } = await runScenario(app, "signed-out");

    expect(result.status).toBe("pass");
    expect(result.findings).toEqual([]);
    expect(result.notes).toMatch(/\b3\b/);
    for (const url of ["/api/me", "/api/notes", "/api/users/u1/profile"]) {
      expect(gets(app, url).some(credentialless), `signed-out replay of ${url}`).toBe(true);
    }
    expect(writes(app)).toEqual(["POST /api/notes"]);
    expectNoAccountValues(result, app, [alice]);
  });

  it("noAuth (V03): critical, confirmed, the two data endpoints (not /api/me, which stays honest)", async () => {
    const app = await start({ noAuth: true });
    const { result, alice } = await runScenario(app, "signed-out");

    const f = onlyFinding(result);
    expect(f.title).toMatch(/Account A's data is readable without signing in \(2 endpoints\)/);
    expect([...(f.locations ?? [])].sort()).toEqual([expect.stringMatching(/^GET \/api\/notes\b/), expect.stringMatching(/^GET \/api\/users\/u1\/profile\b/)]);
    expect(f.evidence.filter((e) => e.kind === "card").length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(f.evidence)).toMatch(/Account A's (test record|email)/);
    expectNoAccountValues(result, app, [alice]);
  });

  it("listLeak and idor need a session, so a signed-out visitor still reads nothing", async () => {
    const app = await start({ listLeak: true, idor: true });
    const { result } = await runScenario(app, "signed-out");
    expect(result.status).toBe("pass");
    expect(result.findings).toEqual([]);
  });

  it("never replays a GET whose path acts (/api/unsubscribe), even when its answer names Account A", async () => {
    const EMAIL = "alice@example.test";
    const who = (r: RecordedRequest) => (/(?:^|;\s*)sid=a-session\b/.test(r.headers.cookie ?? "") ? "a" : null);
    const server = await startFixtureServer({
      pages: {
        "/dash": `<!doctype html><html><head><title>Dashboard</title></head><body><main><h1>Dashboard</h1><p id="me"></p></main>
<script>
fetch('/api/me').then(function (r) { return r.json(); }).then(function (d) { document.getElementById('me').textContent = d.email ? 'Hello' : ''; });
fetch('/api/unsubscribe?list=news').then(function (r) { return r.text(); });
</script></body></html>`,
      },
      routes: {
        "GET /api/me": (req, res) => (who(req) ? json(res, 200, { email: EMAIL }) : json(res, 401, { error: "Sign in first" })),
        "GET /api/unsubscribe": (req, res) => json(res, 200, { unsubscribed: true, email: who(req) ? EMAIL : null }),
        "GET /favicon.ico": (_req, res) => {
          res.writeHead(204);
          res.end();
        },
      },
    });
    servers.push(server);
    const self: SessionState = {
      cookies: [{ name: "sid", value: "a-session", domain: "127.0.0.1", path: "/", expires: -1, httpOnly: true, secure: false, sameSite: "Lax" }],
      origins: [],
    };
    const targetUrl = `${server.url}/dash`;
    const discovered = await discoverWith(targetUrl, self);
    server.requests.length = 0;
    const ctx = createCheckContext({
      browser,
      form: discovered.forms[0] ?? emptyForm(targetUrl),
      discoveredPage: discovered,
      targetUrl,
      artifactsDir: await tempDir("rh-access-control-"),
      runToken: RUN_TOKEN,
      sessions: { self },
      accounts: { self: A, other: null },
      markers: [EMAIL],
    });
    contexts.push(ctx);
    const result = await check.run(ctx, scenarioFor("signed-out", discovered));

    expect(result.status).toBe("pass");
    const signedOut = (path: string) => server.requests.filter((r) => r.method === "GET" && new URL(r.url, "http://x").pathname === path && r.headers.cookie === undefined);
    expect(signedOut("/api/me").length, "the signed-out replay of /api/me").toBeGreaterThanOrEqual(1);
    expect(signedOut("/api/unsubscribe"), "a path that acts was replayed").toEqual([]);
  });
});

describe("access-control: nothing to compare", () => {
  it("skips when no form saved a record and no response names Account A, before B opens anything", async () => {
    const app = await start();
    // /help has no form, and its only data (GET /api/me) doesn't hold this marker.
    const { result, bob } = await runScenario(app, "other-account", { path: "/help", markers: ["nobody@example.test"] });
    expect(result.status).toBe("skipped");
    expect(result.findings).toEqual([]);
    expect(result.notes).toMatch(/Account A has no data on this page that Run Hound can recognise/);
    expect(app.requests.filter((r) => carries(r, bob!)), "B opened the page or replayed a request").toEqual([]);
  });
});

async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries.filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name));
}

describe("access-control through discoverAndPlan and runPlan", () => {
  it("signed in as A with B (listLeak): other-account fails, signed-out passes, and the run folder holds no password or username", async () => {
    const app = await start({ listLeak: true });
    const accounts = app.accountsConfig();
    const runsDir = await tempDir("rh-access-control-runs-");
    const plan = await discoverAndPlan(`${app.url}/notes`, { signInAs: "a", accounts, checks: [check] });
    expect(plan.account).toEqual(A);
    expect(plan.scenarios.map((s) => s.id).sort()).toEqual(["access-control:other-account", "access-control:signed-out"]);

    const { report, dir } = await runPlan(plan, { accounts, checks: [check], runsDir, approved: plan.scenarios.map((s) => s.id) });
    expect(report.accounts).toEqual({ signedInAs: A, other: B });
    const status = (id: string) => report.results.find((r) => r.scenarioId === id)?.status;
    expect(status("access-control:other-account")).toBe("fail");
    expect(status("access-control:signed-out")).toBe("pass");
    expect(report.findings.map((f) => f.checkId)).toEqual(["access-control"]);

    const { alice, bob } = app.users;
    for (const file of await filesUnder(dir)) {
      const content = await readFile(file, "latin1");
      for (const value of [alice.password, bob.password, alice.email, bob.email]) {
        expect(content.includes(value), `${file} contains a password or username`).toBe(false);
      }
    }
  });
});
