import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Check, Plan, Report, Scenario } from "../core/types.js";
import type { RunOptions } from "../engine/runner.js";

/**
 * How the server hands test accounts to the engine (docs/v2-spec.md "Test accounts" → API), with the engine replaced:
 * discoverAndPlan / runPlan record the options they get, signIn answers as told, and registerSecretLiterals records
 * what it is given. The end-to-end behaviour against a real app is app-accounts.test.ts; this pins the plumbing:
 * - POST /api/plan signInAs → discoverAndPlan({ signInAs, accounts }) with the accounts as they are now; the account's
 *   password is registered as a literal secret for the request and unregistered after it.
 * - a SignInError, or "Signed in as …, but … still shows the sign-in page", is a 400 with that message.
 * - POST /api/runs of a signed-in plan → runPlan({ accounts }) resolved at run time (every password registered until
 *   the run ends); the plan's account no longer set up → 400 naming it, and nothing runs.
 * - the runs list names the account ({ id, label } only), also for runs read back from disk.
 * - a rerun of a signed-in run plans signed in as the same account.
 * - POST /api/accounts/test: signIn's answer as { ok, landedOn, message }; a SignInError as ok: false; a login URL the
 *   safety gate refuses fails without signing in.
 */

const calls = vi.hoisted(() => ({
  discover: [] as { url: string; options: RunOptions }[],
  run: [] as { plan: Plan; options: RunOptions }[],
  registered: [] as string[][],
  unregistered: 0,
  signIn: vi.fn(),
  discoverImpl: null as null | ((url: string, options: RunOptions) => Promise<Plan>),
}));

vi.mock(import("../engine/runner.js"), async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    discoverAndPlan: vi.fn(async (url: string, options: RunOptions = {}) => {
      calls.discover.push({ url, options });
      return calls.discoverImpl!(url, options);
    }),
    runPlan: vi.fn(async (plan: Plan, options: RunOptions = {}) => {
      calls.run.push({ plan, options });
      const now = new Date().toISOString();
      const account = plan.account ?? null;
      const report = {
        runId: String(options.runId),
        target: plan.target,
        startedAt: now,
        finishedAt: now,
        durationMs: 1,
        plan,
        results: [{ checkId: "focus-visible", scenarioId: "fv:1", status: "pass", findings: [], durationMs: 1 }],
        findings: [],
        summary: { critical: 0, high: 0, medium: 0, low: 0, passed: 1, failed: 0, errored: 0, skipped: 0 },
        groups: [],
        ...(account ? { accounts: { signedInAs: account, other: null } } : {}),
      } as unknown as Report;
      return { report, dir: join(String(options.runsDir), String(options.runId)) };
    }),
  };
});

vi.mock(import("../engine/auth.js"), async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, signIn: calls.signIn };
});

vi.mock(import("../engine/redact.js"), async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    registerSecretLiterals: vi.fn((values: string[]) => {
      calls.registered.push([...values]);
      return () => {
        calls.unregistered += 1;
      };
    }),
  };
});

const { createApp } = await import("./app.js");
const { SignInError } = await import("../engine/auth.js");

const PASSWORD_A = "wiring-pass-A-1234";
const PASSWORD_B = "wiring-pass-B-5678";
const LOGIN = "http://127.0.0.1:5999/login";
const TARGET = "http://127.0.0.1:5999/notes";

const scenario: Scenario = { id: "fv:1", checkId: "focus-visible", title: "Fake", description: "fake", kind: "golden", priority: "medium", destructive: false, defaultSelected: true };
const fakeCheck: Check = {
  id: "focus-visible",
  title: "Fake focus-visible",
  category: "accessibility",
  scope: "page",
  plan: () => [scenario],
  async run(_ctx, s) {
    return { checkId: "focus-visible", scenarioId: s.id, status: "pass", findings: [], durationMs: 1 };
  },
};

/** The plan the fake discovery returns: the account it was asked to sign in as, by label. */
function planFor(url: string, options: RunOptions): Plan {
  const id = options.signInAs;
  const accounts = options.accounts;
  return {
    target: url,
    form: { url, selector: "form", name: "New note", fields: [], controls: [] },
    scenarios: [scenario],
    groups: [{ id: "accessibility", label: "Accessibility", scenarioIds: ["fv:1"] }],
    ...(id && accounts ? { account: { id, label: accounts.accounts[id].label } } : {}),
  } as unknown as Plan;
}

let tmp: string;
let configDir: string;
let runsDir: string;
let saved: NodeJS.ProcessEnv;
let app: Hono;

const RH = { "x-run-hound": "1", "content-type": "application/json" };
const send = (method: string, path: string, body: unknown = {}) => app.request(path, { method, headers: RH, body: JSON.stringify(body) });
const getJson = async <T>(path: string) => (await (await app.request(path, { headers: RH })).json()) as T;

async function writeAccounts(accounts: Record<string, Record<string, string>>): Promise<void> {
  await mkdir(configDir, { recursive: true });
  await writeFile(join(configDir, "accounts.json"), JSON.stringify({ version: 1, isolated: true, accounts }));
}

const slotA = { loginUrl: LOGIN, username: "a@example.test", password: PASSWORD_A };
const slotB = { loginUrl: LOGIN, username: "b@example.test", password: PASSWORD_B, label: "Tester" };

beforeEach(async () => {
  saved = {};
  for (const k of Object.keys(process.env)) if (k.startsWith("RUNHOUND_ACCOUNT") || k === "RUNHOUND_CONFIG_DIR") saved[k] = process.env[k];
  for (const k of Object.keys(process.env)) if (k.startsWith("RUNHOUND_ACCOUNT")) delete process.env[k];
  tmp = await mkdtemp(join(tmpdir(), "rh-accounts-wiring-"));
  configDir = join(tmp, "config");
  runsDir = join(tmp, "runs");
  process.env.RUNHOUND_CONFIG_DIR = configDir;
  calls.discover.length = 0;
  calls.run.length = 0;
  calls.registered.length = 0;
  calls.unregistered = 0;
  calls.signIn.mockReset();
  calls.discoverImpl = async (url, options) => planFor(url, options);
  app = createApp({ checks: [fakeCheck], canShowBrowser: false, maxConcurrentRuns: 10, runsDir });
});

afterEach(async () => {
  for (const k of Object.keys(process.env)) if (k.startsWith("RUNHOUND_ACCOUNT")) delete process.env[k];
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await rm(tmp, { recursive: true, force: true });
});

interface PlanResponse {
  planId: string;
  plan: Plan;
  error?: string;
}

async function waitForRun(runId: string): Promise<{ status: string; report?: Report; error?: string }> {
  let state: { status: string; report?: Report; error?: string } = { status: "running" };
  await expect
    .poll(async () => {
      state = await getJson<typeof state>(`/api/runs/${runId}`);
      return state.status;
    })
    .not.toBe("running");
  return state;
}

describe("POST /api/plan signInAs", () => {
  it("passes the slot and the accounts as they are now to discovery, with the password registered for the request", async () => {
    await writeAccounts({ a: slotA, b: slotB });
    const res = await send("POST", "/api/plan", { url: TARGET, signInAs: "b" });
    const body = (await res.json()) as PlanResponse;
    expect(res.status, body.error).toBe(200);
    expect(calls.discover).toHaveLength(1);
    const options = calls.discover[0]!.options;
    expect(options.signInAs).toBe("b");
    const accounts = options.accounts!;
    expect(accounts.accounts.b).toMatchObject({ label: "Tester", loginUrl: LOGIN, password: PASSWORD_B });
    expect(body.plan.account).toEqual({ id: "b", label: "Tester" });
    expect(calls.registered).toEqual([[PASSWORD_B]]);
    expect(calls.unregistered).toBe(1);
  });

  it("plans signed out without signInAs, registering nothing", async () => {
    await writeAccounts({ a: slotA });
    const res = await send("POST", "/api/plan", { url: TARGET });
    expect(res.status).toBe(200);
    expect(calls.discover[0]!.options.signInAs).toBeUndefined();
    expect(calls.registered).toEqual([]);
  });

  it("answers 400 with a SignInError's message, and still unregisters", async () => {
    await writeAccounts({ a: slotA });
    calls.discoverImpl = async () => {
      throw new SignInError("Account A could not sign in: Email or password is incorrect");
    };
    const res = await send("POST", "/api/plan", { url: TARGET, signInAs: "a" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("Email or password is incorrect");
    expect(calls.unregistered).toBe(calls.registered.length);
  });

  it("answers 400 when the page still shows the sign-in form while signed in", async () => {
    await writeAccounts({ a: slotA });
    calls.discoverImpl = async () => {
      throw new Error(`Signed in as Account A, but ${TARGET} still shows the sign-in page. Check the account in Settings → Test accounts.`);
    };
    const res = await send("POST", "/api/plan", { url: TARGET, signInAs: "a" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("still shows the sign-in page");
  });

  it("never answers with an account's username, even when the page showed it", async () => {
    await writeAccounts({ a: slotA, b: slotB });
    calls.discoverImpl = async (url, options) => {
      const plan = planFor(url, options);
      return { ...plan, form: { ...plan.form, name: "Signed in as A@Example.test" }, scenarios: [{ ...scenario, title: "Menu of b@example.test" }] };
    };
    const res = await send("POST", "/api/plan", { url: TARGET, signInAs: "a" });
    const text = await res.text();
    expect(res.status, text).toBe(200);
    expect(text.toLowerCase()).not.toContain("a@example.test");
    expect(text).not.toContain("b@example.test");
    expect(text).toContain("[REDACTED:account-username]");
    // The stored plan keeps what the page said, so the run tests the real page.
    const { planId } = JSON.parse(text) as PlanResponse;
    const { runId } = (await (await send("POST", "/api/runs", { planId, approved: ["fv:1"] })).json()) as { runId: string };
    expect((await waitForRun(runId)).status).toBe("done");
    expect(calls.run[0]!.plan.form.name).toBe("Signed in as A@Example.test");
    const live = await (await app.request(`/api/runs/${runId}/live`, { headers: RH })).text();
    expect(live).not.toContain("b@example.test");
  });

  it("hides the username in a sign-in failure's message", async () => {
    await writeAccounts({ a: slotA });
    calls.discoverImpl = async () => {
      throw new SignInError("No account is registered for a@example.test.");
    };
    const res = await send("POST", "/api/plan", { url: TARGET, signInAs: "a" });
    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain("a@example.test");
  });

  it("names what a slot is missing, without discovering anything", async () => {
    await writeAccounts({ b: { loginUrl: LOGIN, username: "b@example.test" } });
    const res = await send("POST", "/api/plan", { url: TARGET, signInAs: "b" });
    expect(res.status).toBe(400);
    const { error } = (await res.json()) as { error: string };
    expect(error).toContain("Account B");
    expect(error).toMatch(/password/);
    expect(error).not.toContain("b@example.test");
    expect(calls.discover).toHaveLength(0);
  });
});

describe("runs of a signed-in plan", () => {
  it("run with the accounts resolved when the run starts, and the runs list names the account", async () => {
    await writeAccounts({ a: slotA });
    const { planId } = (await (await send("POST", "/api/plan", { url: TARGET, signInAs: "a" })).json()) as PlanResponse;
    // Changed between planning and running: the run uses the new label and password.
    await writeAccounts({ a: { ...slotA, label: "Owner", password: "wiring-pass-A-new-99" }, b: slotB });
    const started = await send("POST", "/api/runs", { planId, approved: ["fv:1"] });
    expect(started.status).toBe(202);
    const { runId } = (await started.json()) as { runId: string };
    const state = await waitForRun(runId);
    expect(state.status, state.error).toBe("done");
    const accounts = calls.run[0]!.options.accounts!;
    expect(accounts.accounts.a.password).toBe("wiring-pass-A-new-99");
    expect(calls.run[0]!.plan.account).toEqual({ id: "a", label: "Account A" });
    // Every configured password stays registered for the run, and is unregistered once it has ended.
    expect(calls.registered).toContainEqual(["wiring-pass-A-new-99", PASSWORD_B]);
    expect(calls.unregistered).toBe(calls.registered.length);

    const { runs } = await getJson<{ runs: { runId: string; account?: unknown }[] }>("/api/runs");
    expect(runs.find((r) => r.runId === runId)!.account).toEqual({ id: "a", label: "Account A" });
  });

  it("refuses to run when the plan's account is no longer set up, naming it", async () => {
    await writeAccounts({ a: slotA });
    const { planId } = (await (await send("POST", "/api/plan", { url: TARGET, signInAs: "a" })).json()) as PlanResponse;
    await writeAccounts({});
    const res = await send("POST", "/api/runs", { planId, approved: ["fv:1"] });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("Account A");
    expect(calls.run).toHaveLength(0);
  });

  it("runs a signed-out plan without accounts, and the runs list names none", async () => {
    await writeAccounts({ a: slotA });
    const { planId } = (await (await send("POST", "/api/plan", { url: TARGET })).json()) as PlanResponse;
    const { runId } = (await (await send("POST", "/api/runs", { planId, approved: ["fv:1"] })).json()) as { runId: string };
    expect((await waitForRun(runId)).status).toBe("done");
    expect(calls.run[0]!.options.accounts).toBeUndefined();
    const { runs } = await getJson<{ runs: { runId: string; account?: unknown }[] }>("/api/runs");
    expect(runs.find((r) => r.runId === runId)).not.toHaveProperty("account");
  });

  it("reruns signed in as the same account", async () => {
    await writeAccounts({ a: slotA });
    const { planId } = (await (await send("POST", "/api/plan", { url: TARGET, signInAs: "a" })).json()) as PlanResponse;
    const { runId } = (await (await send("POST", "/api/runs", { planId, approved: ["fv:1"] })).json()) as { runId: string };
    await waitForRun(runId);
    const rerun = await send("POST", `/api/runs/${runId}/rerun`, {});
    expect(rerun.status).toBe(202);
    expect(calls.discover).toHaveLength(2);
    expect(calls.discover[1]!.options.signInAs).toBe("a");
    const second = (await rerun.json()) as { runId: string };
    await waitForRun(second.runId);
    expect(calls.run[1]!.options.accounts).toBeDefined();
  });

  it("lists the account of a run read back from disk, and only its id and label", async () => {
    const dir = join(runsDir, "20260101-000000-disk");
    await mkdir(dir, { recursive: true });
    const plan = { ...planFor(TARGET, {}), account: { id: "b", label: "Tester", username: "b@example.test" } };
    const report = {
      runId: "20260101-000000-disk",
      target: TARGET,
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:00:01.000Z",
      plan,
      results: [],
      findings: [],
      summary: { critical: 0, high: 0, medium: 0, low: 0, passed: 0, failed: 0, errored: 0, skipped: 0 },
    };
    await writeFile(join(dir, "report.json"), JSON.stringify(report));
    const tampered = join(runsDir, "20260101-000001-bad");
    await mkdir(tampered, { recursive: true });
    await writeFile(join(tampered, "report.json"), JSON.stringify({ ...report, runId: "20260101-000001-bad", plan: { ...plan, account: { id: "c", label: "x" } } }));
    const { runs } = await getJson<{ runs: { runId: string; account?: unknown }[] }>("/api/runs");
    expect(runs.find((r) => r.runId === "20260101-000000-disk")!.account).toEqual({ id: "b", label: "Tester" });
    expect(runs.find((r) => r.runId === "20260101-000001-bad")).not.toHaveProperty("account");
  });
});

describe("POST /api/accounts/test", () => {
  it("answers with where signIn landed, the password registered while it ran", async () => {
    await writeAccounts({ a: slotA });
    calls.signIn.mockResolvedValue({ state: { cookies: [], origins: [] }, landedOn: "http://127.0.0.1:5999/notes?tab=all", secrets: [] });
    const res = await send("POST", "/api/accounts/test", { id: "a" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; landedOn?: string; message: string };
    expect(body).toMatchObject({ ok: true, landedOn: "http://127.0.0.1:5999/notes?tab=all" });
    expect(body.message).toContain("/notes?tab=all");
    expect(calls.signIn).toHaveBeenCalledTimes(1);
    expect(calls.signIn.mock.calls[0]![1]).toMatchObject({ id: "a", loginUrl: LOGIN, password: PASSWORD_A });
    expect(calls.registered).toEqual([[PASSWORD_A]]);
    expect(calls.unregistered).toBe(1);
  });

  it("answers ok: false with a SignInError's message", async () => {
    await writeAccounts({ a: slotA });
    calls.signIn.mockRejectedValue(new SignInError("The sign-in form was still shown after submitting."));
    const body = (await (await send("POST", "/api/accounts/test", { id: "a" })).json()) as { ok: boolean; message: string };
    expect(body).toEqual({ id: "a", ok: false, message: "The sign-in form was still shown after submitting." });
    expect(calls.unregistered).toBe(1);
  });

  it("refuses a login URL the safety gate refuses (set by env) without signing in", async () => {
    process.env.RUNHOUND_ACCOUNT_A_LOGIN_URL = "http://8.8.8.8/login";
    process.env.RUNHOUND_ACCOUNT_A_USERNAME = "a@example.test";
    process.env.RUNHOUND_ACCOUNT_A_PASSWORD = PASSWORD_A;
    const body = (await (await send("POST", "/api/accounts/test", { id: "a" })).json()) as { ok: boolean; message: string };
    expect(body.ok).toBe(false);
    expect(body.message).toContain("Account A");
    expect(body.message).toContain("8.8.8.8");
    expect(calls.signIn).not.toHaveBeenCalled();
  });
});
