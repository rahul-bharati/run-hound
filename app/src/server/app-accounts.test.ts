import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hono } from "hono";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startAccountsApp, type AccountsApp } from "../../test-support/accounts-app.js";
import type { Check, CheckId, Plan, Report, Scenario } from "../core/types.js";
import { createApp } from "./app.js";

/**
 * Test-account endpoints of the web server (docs/v2-spec.md "Test accounts" → API), against the shared accounts app.
 *
 * Contract these tests pin down (interpretations marked *):
 * - GET /api/accounts → { isolated, accounts: { a: { label, loginUrl, username, hasPassword, sources }, b } } (the
 *   AccountsStatus shape; extra fields allowed). No `password` field anywhere, never a password value
 *   (`sources.password` only names where it came from).
 * - PUT /api/accounts with an AccountsPatch → 200, the same shape. Omitted fields are kept, `password: ""` removes it.
 *   Login URLs go through the safety gate with the server's allowedHosts: a public address → 400 naming the host, and
 *   nothing is saved. * A body that isn't a patch (not an object, `isolated` not a boolean, an unknown slot, a
 *   non-string field) → 400.
 * - POST /api/accounts/test { id } → 200 { ok, landedOn?, message }: the page's own error text on failure. * An id
 *   other than "a"/"b" → 400. * A slot that isn't set up answers ok: false (or 400) naming it, without opening the app.
 * - All /api/accounts* routes require X-Run-Hound: 1 (403 without it) and refuse Sec-Fetch-Site cross-site, like
 *   /api/ai. * POST /api/plan is sent with the header here too, so the tests hold whichever way that route goes.
 * - POST /api/plan { url, signInAs: "a" | "b" | null } signs in before discovery: plan.account = { id, label }, the
 *   plan is the signed-in page. A failed sign-in → 400 with the SignInError message (the page's own error text). An
 *   unconfigured slot → 400 naming the account, * before anything is sent to the app. Any other signInAs → 400.
 * - * A run of that plan signs in again and its report says who: report.accounts = { signedInAs, other: null }.
 * - * The server resolves the accounts per request (RUNHOUND_CONFIG_DIR + RUNHOUND_ACCOUNT_* env), like the AI config.
 */

function scenario(checkId: CheckId, id: string): Scenario {
  return { id, checkId, title: `Fake ${id}`, description: "fake", kind: "golden", priority: "medium", destructive: false, defaultSelected: true };
}

/** A page-scoped check that plans one scenario and passes without touching the page: fast plans and runs. */
const fakeCheck: Check = {
  id: "focus-visible",
  title: "Fake focus-visible",
  category: "accessibility",
  scope: "page",
  plan: () => [scenario("focus-visible", "fv:1")],
  async run(_ctx, s) {
    return { checkId: "focus-visible", scenarioId: s.id, status: "pass", findings: [], durationMs: 1 };
  },
};

const ENV_KEYS = ["RUNHOUND_CONFIG_DIR", "XDG_CONFIG_HOME", "RUNHOUND_ALLOWED_HOSTS"];
const accountEnvKeys = () => Object.keys(process.env).filter((k) => k.startsWith("RUNHOUND_ACCOUNT"));

let site: AccountsApp;
let tmp: string;
let configDir: string;
let runsDir: string;
let saved: NodeJS.ProcessEnv;
let app: Hono;

beforeAll(async () => {
  site = await startAccountsApp();
});

afterAll(async () => {
  await site?.stop();
});

beforeEach(async () => {
  saved = {};
  for (const k of [...ENV_KEYS, ...accountEnvKeys()]) saved[k] = process.env[k];
  for (const k of accountEnvKeys()) delete process.env[k];
  delete process.env.RUNHOUND_ALLOWED_HOSTS;
  tmp = await mkdtemp(join(tmpdir(), "rh-accounts-api-"));
  configDir = join(tmp, "config");
  runsDir = join(tmp, "runs");
  process.env.RUNHOUND_CONFIG_DIR = configDir;
  site.reset();
  app = createApp({ checks: [fakeCheck], canShowBrowser: false, maxConcurrentRuns: 10, runsDir });
});

afterEach(async () => {
  for (const k of accountEnvKeys()) delete process.env[k];
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await rm(tmp, { recursive: true, force: true });
});

const RH = { "x-run-hound": "1" };
const accountsJson = () => join(configDir, "accounts.json");

function send(method: string, path: string, body: unknown = {}, headers: Record<string, string> = RH, target: Hono = app) {
  return target.request(path, { method, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}

function get(path: string, headers: Record<string, string> = RH) {
  return app.request(path, { headers });
}

/** Writes accounts.json in the spec's shape (what `accounts set` or Settings would have saved). */
async function writeAccounts(accounts: Record<string, Record<string, string>>, isolated = true): Promise<void> {
  await mkdir(configDir, { recursive: true });
  await writeFile(accountsJson(), JSON.stringify({ version: 1, isolated, accounts }));
}

const alice = () => ({ loginUrl: site.loginUrl, username: site.users.alice.email, password: site.users.alice.password });
const bob = () => ({ loginUrl: site.loginUrl, username: site.users.bob.email, password: site.users.bob.password });
const logins = () => site.requests.filter((r) => r.method === "POST" && r.url.startsWith("/api/login")).length;

interface SlotView {
  label: string;
  loginUrl: string;
  username: string;
  hasPassword: boolean;
  sources: Record<string, string>;
}
interface AccountsView {
  isolated: boolean;
  accounts: { a: SlotView; b: SlotView };
}

const DEFAULT_SOURCES = { label: "default", loginUrl: "default", username: "default", password: "default" };

describe("the X-Run-Hound header", () => {
  it("is required on GET /api/accounts", async () => {
    expect((await get("/api/accounts", {})).status).toBe(403);
    expect((await get("/api/accounts", { "x-run-hound": "0" })).status).toBe(403);
    expect((await get("/api/accounts")).status).toBe(200);
  });

  it("is required on PUT /api/accounts: nothing is saved without it", async () => {
    const res = await send("PUT", "/api/accounts", { accounts: { a: alice() } }, {});
    expect(res.status).toBe(403);
    await expect(stat(accountsJson())).rejects.toThrow();
    expect((await get("/api/accounts")).status).toBe(200);
  });

  it("is required on POST /api/accounts/test: the app is not contacted without it", async () => {
    await writeAccounts({ a: alice() });
    const res = await send("POST", "/api/accounts/test", { id: "a" }, {});
    expect(res.status).toBe(403);
    expect(site.requests).toHaveLength(0);
  });

  it("does not replace the Sec-Fetch-Site check", async () => {
    expect((await get("/api/accounts", { ...RH, "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await get("/api/accounts")).status).toBe(200);
  });
});

describe("GET /api/accounts", () => {
  it("returns two empty slots with the default labels, isolated on", async () => {
    const res = await get("/api/accounts");
    expect(res.status).toBe(200);
    const body = (await res.json()) as AccountsView;
    expect(body.isolated).toBe(true);
    expect(body.accounts.a).toMatchObject({ label: "Account A", loginUrl: "", username: "", hasPassword: false, sources: DEFAULT_SOURCES });
    expect(body.accounts.b).toMatchObject({ label: "Account B", loginUrl: "", username: "", hasPassword: false, sources: DEFAULT_SOURCES });
  });

  it("shows usernames and whether a password is saved, never a password", async () => {
    await writeAccounts({ a: { ...alice(), label: "Owner" } }, false);
    process.env.RUNHOUND_ACCOUNT_B_LOGIN_URL = site.loginUrl;
    process.env.RUNHOUND_ACCOUNT_B_USERNAME = site.users.bob.email;
    process.env.RUNHOUND_ACCOUNT_B_PASSWORD = site.users.bob.password;
    const res = await get("/api/accounts");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(site.users.alice.password);
    expect(text).not.toContain(site.users.bob.password);
    const body = JSON.parse(text) as AccountsView;
    expect(body.isolated).toBe(false);
    expect(body.accounts.a).toMatchObject({ label: "Owner", loginUrl: site.loginUrl, username: site.users.alice.email, hasPassword: true });
    expect(body.accounts.a.sources).toMatchObject({ label: "file", loginUrl: "file", username: "file", password: "file" });
    expect(body.accounts.b).toMatchObject({ label: "Account B", username: site.users.bob.email, hasPassword: true });
    expect(body.accounts.b.sources).toMatchObject({ loginUrl: "env", username: "env", password: "env" });
    for (const slot of [body.accounts.a, body.accounts.b]) expect(slot).not.toHaveProperty("password");
  });
});

describe("PUT /api/accounts", () => {
  it("saves a patch and answers with the new state, without the password", async () => {
    const res = await send("PUT", "/api/accounts", { isolated: false, accounts: { a: { ...alice(), label: "Owner" } } });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(site.users.alice.password);
    const body = JSON.parse(text) as AccountsView;
    expect(body.isolated).toBe(false);
    expect(body.accounts.a).toMatchObject({ label: "Owner", loginUrl: site.loginUrl, username: site.users.alice.email, hasPassword: true });
    expect(body.accounts.a).not.toHaveProperty("password");
    expect(body.accounts.b).toMatchObject({ label: "Account B", hasPassword: false });
    // It persisted, privately.
    const again = (await (await get("/api/accounts")).json()) as AccountsView;
    expect(again.accounts.a.sources).toMatchObject({ loginUrl: "file", password: "file" });
    expect((await stat(accountsJson())).mode & 0o777).toBe(0o600);
    expect(await readFile(accountsJson(), "utf8")).toContain(site.users.alice.password);
  });

  it("keeps omitted fields and removes the password on password: \"\"", async () => {
    expect((await send("PUT", "/api/accounts", { accounts: { a: alice(), b: bob() } })).status).toBe(200);
    let body = (await (await send("PUT", "/api/accounts", { accounts: { a: { label: "Owner" } } })).json()) as AccountsView;
    expect(body.accounts.a).toMatchObject({ label: "Owner", loginUrl: site.loginUrl, username: site.users.alice.email, hasPassword: true });
    expect(body.accounts.b).toMatchObject({ username: site.users.bob.email, hasPassword: true });
    body = (await (await send("PUT", "/api/accounts", { accounts: { a: { password: "" } } })).json()) as AccountsView;
    expect(body.accounts.a).toMatchObject({ label: "Owner", loginUrl: site.loginUrl, hasPassword: false });
    expect(body.accounts.b.hasPassword).toBe(true);
    expect(await readFile(accountsJson(), "utf8")).not.toContain(site.users.alice.password);
  });

  it("refuses a public login URL, naming the host, and saves nothing", async () => {
    const res = await send("PUT", "/api/accounts", { accounts: { a: { loginUrl: "http://8.8.8.8/login", username: "x@example.test", password: "public-secret-123" } } });
    expect(res.status).toBe(400);
    const text = await res.text();
    expect((JSON.parse(text) as { error: string }).error).toContain("8.8.8.8");
    expect(text).not.toContain("public-secret-123");
    const body = (await (await get("/api/accounts")).json()) as AccountsView;
    expect(body.accounts.a).toMatchObject({ loginUrl: "", hasPassword: false });
  });

  it("accepts a host the server allows (allowedHosts)", async () => {
    const allowing = createApp({ checks: [fakeCheck], canShowBrowser: false, runsDir, allowedHosts: ["app.internal.test"] });
    const res = await send("PUT", "/api/accounts", { accounts: { a: { loginUrl: "http://app.internal.test/login", username: "x@example.test" } } }, RH, allowing);
    expect(res.status).toBe(200);
    expect(((await res.json()) as AccountsView).accounts.a.loginUrl).toBe("http://app.internal.test/login");
    // The default server refuses the same host.
    const refused = await send("PUT", "/api/accounts", { accounts: { b: { loginUrl: "http://app.internal.test/login", username: "y@example.test" } } });
    expect(refused.status).toBe(400);
  });

  it("refuses a login URL that isn't http(s)", async () => {
    const res = await send("PUT", "/api/accounts", { accounts: { a: { loginUrl: "javascript:alert(1)", username: "x@example.test" } } });
    expect(res.status).toBe(400);
    await expect(stat(accountsJson())).rejects.toThrow();
  });

  it.each([
    ["an array", []],
    ["isolated that isn't a boolean", { isolated: "yes" }],
    ["an unknown slot", { accounts: { c: { username: "x@example.test" } } }],
    ["a password that isn't a string", { accounts: { a: { password: 1234 } } }],
    ["accounts that isn't an object", { accounts: "a" }],
  ])("refuses %s", async (_what, body) => {
    const res = await send("PUT", "/api/accounts", body);
    expect(res.status).toBe(400);
    await expect(stat(accountsJson())).rejects.toThrow();
  });

  it("refuses a cross-site request", async () => {
    const res = await send("PUT", "/api/accounts", { accounts: { a: alice() } }, { ...RH, origin: "https://evil.example" });
    expect(res.status).toBe(403);
    await expect(stat(accountsJson())).rejects.toThrow();
  });
});

describe("POST /api/accounts/test", () => {
  it("signs in and says where it landed", async () => {
    await writeAccounts({ a: alice() });
    const res = await send("POST", "/api/accounts/test", { id: "a" });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(site.users.alice.password);
    const body = JSON.parse(text) as { ok: boolean; landedOn?: string; message: string };
    expect(body.ok).toBe(true);
    expect(body.landedOn).toContain("/notes");
    expect(body.message).not.toBe("");
    expect(logins()).toBeGreaterThanOrEqual(1);
  });

  it("reports the page's own reason when the password is wrong", async () => {
    await writeAccounts({ b: { ...bob(), password: "wrong-password-999" } });
    const res = await send("POST", "/api/accounts/test", { id: "b" });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("wrong-password-999");
    const body = JSON.parse(text) as { ok: boolean; landedOn?: string; message: string };
    expect(body.ok).toBe(false);
    expect(body.message).toContain("Email or password is incorrect");
  });

  it("says a slot isn't set up without opening the app", async () => {
    const res = await send("POST", "/api/accounts/test", { id: "b" });
    expect([200, 400]).toContain(res.status);
    const body = (await res.json()) as { ok?: boolean; message?: string; error?: string };
    expect(body.ok ?? false).toBe(false);
    expect(`${body.message ?? ""}${body.error ?? ""}`).toContain("Account B");
    expect(site.requests).toHaveLength(0);
  });

  it.each([{}, { id: "c" }, { id: 1 }])("refuses %j", async (body) => {
    expect((await send("POST", "/api/accounts/test", body)).status).toBe(400);
    expect(site.requests).toHaveLength(0);
  });
});

interface PlanResponse {
  planId: string;
  plan: Plan;
  warnings: string[];
}

describe("POST /api/plan with signInAs", () => {
  it("signs in first: the plan is the signed-in page and records the account", async () => {
    await writeAccounts({ a: alice() });
    const res = await send("POST", "/api/plan", { url: `${site.url}/notes`, signInAs: "a" });
    const text = await res.text();
    expect(res.status, text).toBe(200);
    expect(text).not.toContain(site.users.alice.password);
    expect(text).not.toContain(site.users.alice.email);
    const { plan } = JSON.parse(text) as PlanResponse;
    expect(plan.account).toEqual({ id: "a", label: "Account A" });
    expect(new URL(plan.page!.url).pathname).toBe("/notes");
    expect(plan.page!.forms.map((f) => f.name)).toContain("New note");
    expect(logins()).toBeGreaterThanOrEqual(1);
  });

  it("uses the account's own label", async () => {
    await writeAccounts({ b: { ...bob(), label: "Tester" } });
    const res = await send("POST", "/api/plan", { url: `${site.url}/notes`, signInAs: "b" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as PlanResponse).plan.account).toEqual({ id: "b", label: "Tester" });
  });

  it("plans signed out with signInAs: null, as before", async () => {
    await writeAccounts({ a: alice() });
    const res = await send("POST", "/api/plan", { url: `${site.url}/notes`, signInAs: null });
    expect(res.status).toBe(200);
    const { plan } = (await res.json()) as PlanResponse;
    expect(plan.account).toBeUndefined();
    expect(new URL(plan.form.url).pathname).toBe("/login");
    expect(logins()).toBe(0);
  });

  it("answers 400 with the page's reason when the sign-in fails", async () => {
    await writeAccounts({ a: { ...alice(), password: "wrong-password-998" } });
    const res = await send("POST", "/api/plan", { url: `${site.url}/notes`, signInAs: "a" });
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).not.toContain("wrong-password-998");
    expect((JSON.parse(text) as { error: string }).error).toContain("Email or password is incorrect");
  });

  it("answers 400 naming an account that isn't set up, before anything is sent to the app", async () => {
    await writeAccounts({ a: alice() });
    const res = await send("POST", "/api/plan", { url: `${site.url}/notes`, signInAs: "b" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("Account B");
    expect(site.requests).toHaveLength(0);
  });

  it.each(["c", 1, true])("refuses signInAs %j", async (signInAs) => {
    await writeAccounts({ a: alice() });
    const res = await send("POST", "/api/plan", { url: `${site.url}/notes`, signInAs });
    expect(res.status).toBe(400);
    expect(site.requests).toHaveLength(0);
  });

  it("runs the plan as the same account and the report says so", async () => {
    await writeAccounts({ a: alice() });
    const planned = await send("POST", "/api/plan", { url: `${site.url}/notes`, signInAs: "a" });
    expect(planned.status).toBe(200);
    const { planId } = (await planned.json()) as PlanResponse;
    const before = logins();
    const started = await send("POST", "/api/runs", { planId, approved: ["fv:1"] });
    expect(started.status).toBe(202);
    const { runId } = (await started.json()) as { runId: string };
    let state: { status: string; report?: Report; error?: string } = { status: "running" };
    await expect
      .poll(
        async () => {
          state = (await (await get(`/api/runs/${runId}`)).json()) as typeof state;
          return state.status;
        },
        { timeout: 30_000 },
      )
      .not.toBe("running");
    expect(state.status, state.error).toBe("done");
    expect(state.report!.accounts).toEqual({ signedInAs: { id: "a", label: "Account A" }, other: null });
    expect(state.report!.plan.account).toEqual({ id: "a", label: "Account A" });
    // A fresh session for the run.
    expect(logins()).toBeGreaterThan(before);
    // Nothing written for the run holds the password.
    const dir = join(runsDir, runId);
    for (const name of await readdir(dir)) {
      if (!(await stat(join(dir, name))).isFile()) continue;
      expect(await readFile(join(dir, name), "utf8")).not.toContain(site.users.alice.password);
    }
  });
});
