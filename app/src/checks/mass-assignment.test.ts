/**
 * mass-assignment (0.4.0, docs/v2-spec.md "mass-assignment"): does the server accept fields the form never sends,
 * such as `role` or `plan`? Driven against the shared accounts app (test-support/accounts-app.ts) signed in as alice,
 * through createCheckContext with her session from app.storageState(), plus two small fixture apps for the
 * not-JSON skip and the echo-only (advisory) case.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser } from "playwright";
import { startAccountsApp, type AccountsApp, type AccountsAppOptions } from "../../test-support/accounts-app.js";
import { closeBrowser, getBrowser } from "../../test-support/harness.js";
import { json, startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import { expectWellFormedFinding, findingText } from "../../test/fixtures/checks/assert-finding.js";
import type { AccountRef, CheckResult, DiscoveredForm, DiscoveredPage, Scenario } from "../core/types.js";
import type { SessionState } from "../engine/auth.js";
import { createCheckContext, type RunningCheckContext } from "../engine/context.js";
import { discoverPage } from "../engine/discover.js";
import { check } from "./mass-assignment.js";

const A: AccountRef = { id: "a", label: "Account A" };
/** Lowercase letters and digits, so canary values keep it as is. */
const RUN_TOKEN = "ma7e57a1";
/** The privilege fields step 3 adds to the form's own save, with the values it injects. */
const INJECTED = { role: "admin", isAdmin: true, is_admin: true, admin: true, plan: "pro", tier: "pro", credits: 999999, verified: true, emailVerified: true };
const NO_SESSION: SessionState = { cookies: [], origins: [] };

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

function sessionValue(state: SessionState): string {
  const value = state.cookies[0]?.value ?? state.origins[0]?.localStorage.find((e) => e.name === "token")?.value;
  if (!value) throw new Error("the storage state holds no session");
  return value;
}

async function discoverWith(url: string, state: SessionState, ready: string): Promise<DiscoveredPage> {
  const context = await browser.newContext({ storageState: state });
  try {
    const page = await context.newPage();
    await page.goto(url);
    await page.getByRole("heading", { level: 1, name: ready }).waitFor();
    await page.waitForLoadState("networkidle");
    return await discoverPage(page);
  } finally {
    await context.close();
  }
}

/** The scenario as the check plans it for `form` signed in, with the scope buildPlan adds to form-scoped checks. */
function scenarioFor(form: DiscoveredForm, page: DiscoveredPage): Scenario {
  const index = form.index ?? 0;
  const planned = check.plan(form, page, { signedIn: true, otherAccount: false })[0];
  const fallback: Scenario = {
    id: "mass-assignment",
    checkId: "mass-assignment",
    title: "The server ignores fields the form never sends (role, plan)",
    description: "",
    kind: "danger",
    priority: "high",
    destructive: false,
    defaultSelected: false,
  };
  return { ...(planned ?? fallback), scope: "form", formIndex: index, ...(index > 0 && planned ? { id: `${planned.id}@form-${index + 1}` } : {}) };
}

async function runOn(o: { targetUrl: string; page: DiscoveredPage; formIndex?: number; self: SessionState; markers?: string[] }): Promise<{ result: CheckResult; ctx: RunningCheckContext }> {
  const form = o.page.forms[o.formIndex ?? 0]!;
  const artifactsDir = await mkdtemp(join(tmpdir(), "rh-mass-assignment-"));
  dirs.push(artifactsDir);
  const ctx = createCheckContext({
    browser,
    form,
    discoveredPage: o.page,
    targetUrl: o.targetUrl,
    artifactsDir,
    runToken: RUN_TOKEN,
    checkId: "mass-assignment",
    sessions: { self: o.self },
    accounts: { self: A, other: null },
    markers: o.markers ?? [],
  });
  contexts.push(ctx);
  return { result: await check.run(ctx, scenarioFor(form, o.page)), ctx };
}

/** Runs the check on the accounts app's `path` (form `formIndex`) as alice. app.requests holds only the run's requests. */
async function runOnApp(app: AccountsApp, path: string, ready: string, formIndex = 0) {
  const page = await discoverWith(app.url + path, app.storageState("alice"), ready);
  app.reset();
  const self = app.storageState("alice");
  const ran = await runOn({ targetUrl: app.url + path, page, formIndex, self, markers: [app.users.alice.email] });
  return { ...ran, alice: sessionValue(self) };
}

/** Bodies of the PUTs alice's profile received, in order. */
function profilePuts(app: AccountsApp): Record<string, unknown>[] {
  return app.requests.filter((r) => r.method === "PUT" && r.url === "/api/users/u1/profile").map((r) => JSON.parse(r.body) as Record<string, unknown>);
}

describe("mass-assignment on the accounts app", () => {
  it("massAssign (V04): replays the form's own PUT plus the nine privilege fields; role is critical and confirmed", async () => {
    const app = await start({ massAssign: true });
    const { result, alice } = await runOnApp(app, "/profile", "Your profile");

    const puts = profilePuts(app);
    expect(puts.length).toBeGreaterThanOrEqual(2);
    // Step 1: the form's own save, filled with test values (only the two fields the form has).
    const own = puts[0]!;
    expect(Object.keys(own).sort()).toEqual(["bio", "displayName"]);
    expect(JSON.stringify(own)).toContain(RUN_TOKEN);
    // Step 3: the same method, URL and body plus the privilege fields, as alice.
    expect(puts).toContainEqual({ ...own, ...INJECTED });
    expect(app.requests.filter((r) => r.method === "PUT").every((r) => (r.headers.cookie ?? "").includes(alice))).toBe(true);

    expect(result.status).toBe("fail");
    expect(result.findings.length).toBeGreaterThanOrEqual(1);
    for (const f of result.findings) expectWellFormedFinding(f, { checkId: "mass-assignment", category: "security", confidence: "confirmed" });
    const critical = result.findings.find((f) => f.severity === "critical");
    expect(critical, "a critical finding for role/admin").toBeDefined();
    expect(critical!.title).toMatch(/role/);
    // plan (and tier, credits, verified) were accepted too: high, reported alongside.
    expect(result.findings.map(findingText).join(" ")).toMatch(/\bplan\b/);
    // Usernames and passwords never appear, even though the record holds alice's email.
    const text = JSON.stringify(result);
    for (const value of [app.users.alice.email, app.users.alice.password, alice]) expect(text).not.toContain(value);
  });

  it("massAssign: restores the fields that were there before (role, plan) and names what it could not restore", async () => {
    const app = await start({ massAssign: true });
    const { result } = await runOnApp(app, "/profile", "Your profile");

    const puts = profilePuts(app);
    const own = puts[0]!;
    // Step 5: one more replay with the original values of the privilege fields the record had (role, plan).
    expect(puts.at(-1)).toEqual({ ...own, role: "member", plan: "free" });
    expect(app.profile("alice")).toMatchObject({ role: "member", plan: "free" });
    // isAdmin & co. were not in the record before: Run Hound can't remove them, and says so.
    expect(result.notes).toMatch(/isAdmin/);
    expect(result.notes).toMatch(/not there before/);
  });

  it("clean: the server keeps only displayName and bio, so the injected replay changes nothing and the check passes", async () => {
    const app = await start();
    const { result } = await runOnApp(app, "/profile", "Your profile");

    const puts = profilePuts(app);
    expect(puts).toContainEqual({ ...puts[0]!, ...INJECTED });
    expect(result.status).toBe("pass");
    expect(result.findings).toEqual([]);
    const stored = app.profile("alice");
    expect(stored).toMatchObject({ role: "member", plan: "free" });
    for (const key of ["isAdmin", "is_admin", "admin", "tier", "credits", "verified", "emailVerified"]) expect(stored, key).not.toHaveProperty(key);
  });

  it("massAssign on /notes, New note form: POST /api/notes ignores extra keys, so that form passes", async () => {
    const app = await start({ massAssign: true });
    const { result } = await runOnApp(app, "/notes", "Your notes", 0);

    const posts = app.requests.filter((r) => r.method === "POST" && r.url === "/api/notes").map((r) => JSON.parse(r.body) as Record<string, unknown>);
    expect(posts).toContainEqual({ ...posts[0]!, ...INJECTED });
    expect(result.status).toBe("pass");
    expect(result.findings).toEqual([]);
  });
});

describe("mass-assignment on other apps", () => {
  it("skips a form that posts urlencoded (not JSON) without replaying anything", async () => {
    const server = await startFixtureServer({
      pages: {
        "/news": `<!doctype html><html><head><title>Newsletter</title></head><body><main><h1>Newsletter</h1>
<form method="post" action="/subscribe" aria-label="Subscribe">
<p><label for="name">Your name</label> <input id="name" name="name" required></p>
<p><label for="topic">Topic you like</label> <input id="topic" name="topic" required></p>
<button type="submit">Subscribe</button></form></main></body></html>`,
        "/thanks": `<!doctype html><html><head><title>Thanks</title></head><body><h1>Thanks</h1></body></html>`,
      },
      routes: {
        "POST /subscribe": (_req, res) => {
          res.writeHead(303, { location: "/thanks" });
          res.end();
        },
      },
    });
    servers.push(server);
    const page = await discoverWith(`${server.url}/news`, NO_SESSION, "Newsletter");
    server.requests.length = 0;
    const { result } = await runOn({ targetUrl: `${server.url}/news`, page, self: NO_SESSION });

    expect(result.status).toBe("skipped");
    expect(result.findings).toEqual([]);
    expect(result.notes).toMatch(/doesn't send JSON, so extra fields can't be added/);
    const posts = server.requests.filter((r) => r.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body).not.toMatch(/role|isAdmin/);
  });

  it("without a record endpoint, an echo of the injected fields in the replay's answer is an advisory finding", async () => {
    let next = 1;
    const server = await startFixtureServer({
      pages: {
        "/feedback": `<!doctype html><html><head><title>Feedback</title></head><body><main><h1>Feedback</h1>
<form id="feedback" aria-label="Send feedback">
<p><label for="name">Your name</label> <input id="name" name="name" required></p>
<p><label for="message">Message</label> <textarea id="message" name="message" required></textarea></p>
<button type="submit">Send</button><p role="status" id="status"></p></form></main>
<script>
document.getElementById('feedback').addEventListener('submit', function (e) {
  e.preventDefault();
  fetch('/api/feedback', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: document.getElementById('name').value, message: document.getElementById('message').value }) })
    .then(function (r) { return r.json(); })
    .then(function () { document.getElementById('status').textContent = 'Thanks!'; });
});
</script></body></html>`,
      },
      routes: {
        // Echoes whatever it was sent; nothing can read the feedback back.
        "POST /api/feedback": (req, res) => json(res, 201, { feedback: { id: next++, ...(JSON.parse(req.body) as object) } }),
      },
    });
    servers.push(server);
    const page = await discoverWith(`${server.url}/feedback`, NO_SESSION, "Feedback");
    server.requests.length = 0;
    const { result } = await runOn({ targetUrl: `${server.url}/feedback`, page, self: NO_SESSION });

    const posts = server.requests.filter((r) => r.method === "POST").map((r) => JSON.parse(r.body) as Record<string, unknown>);
    expect(posts).toContainEqual({ ...posts[0]!, ...INJECTED });
    expect(result.findings).toHaveLength(1);
    const f = result.findings[0]!;
    expectWellFormedFinding(f, { checkId: "mass-assignment", category: "security", confidence: "advisory" });
    expect(findingText(f)).toMatch(/role/);
  });
});
