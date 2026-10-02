/**
 * Boundaries of the server-side flow orchestrations: plan-flow, run-flow, account-flow, ai-models, redact-text.
 * Each describe constructs a flow with the narrow deps it needs and calls its methods directly, asserting on the
 * outcome and the unregister hook.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Plan, Scenario } from "../../../src/core/types.js";
import {
  PlanFlow,
  flowError,
  isAccountId,
  isRedactedTarget,
  isUserError,
  redactPlan,
} from "../../../src/server/models/plan-flow.js";
import { readyAccount } from "../../../src/server/models/account-flow.js";
import {
  RunsFlow,
  concurrentRunsMessage,
  countRunning,
  rerunPlanFor,
} from "../../../src/server/models/run-flow.js";
import { neutralRedactor, redactorFor } from "../../../src/server/models/redact-text.js";
import { resolveModelsList } from "../../../src/server/models/ai-models.js";
import { SignInError } from "../../../src/engine/auth.js";
import { NoFormFoundError, TargetNotAllowedError, TargetUnreachableError } from "../../../src/engine/errors.js";
import { registerSecretLiterals } from "../../../src/engine/redact.js";

let tmp: string;
let configDir: string;
let saved: NodeJS.ProcessEnv;

beforeEach(async () => {
  saved = {};
  for (const k of Object.keys(process.env)) if (k.startsWith("RUNHOUND_") || k === "XDG_CONFIG_HOME") saved[k] = process.env[k];
  for (const k of Object.keys(process.env)) if (k.startsWith("RUNHOUND_")) delete process.env[k];
  tmp = await mkdtemp(join(tmpdir(), "rh-flow-boundaries-"));
  configDir = join(tmp, "config");
  await mkdir(configDir, { recursive: true });
  process.env.RUNHOUND_CONFIG_DIR = configDir;
});

afterEach(async () => {
  for (const k of Object.keys(process.env)) if (k.startsWith("RUNHOUND_")) delete process.env[k];
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await rm(tmp, { recursive: true, force: true });
});

async function writeAccounts(accounts: Record<string, Record<string, string>>): Promise<void> {
  await writeFile(join(configDir, "accounts.json"), JSON.stringify({ version: 1, isolated: true, accounts }));
}

const scenario = (id: string): Scenario => ({
  id,
  checkId: "dead-control",
  title: `Fake ${id}`,
  description: "fake",
  kind: "golden",
  priority: "medium",
  destructive: false,
  defaultSelected: true,
});

const fakePlan: Plan = {
  target: "http://127.0.0.1:1/notes",
  form: { url: "http://127.0.0.1:1/notes", selector: "form", name: "Notes", fields: [], controls: [] },
  scenarios: [scenario("dc:1")],
  groups: [],
};

function buildPlanFlow(discover: (url: string, opts: unknown) => Promise<Plan> = async () => fakePlan) {
  const store = { set: vi.fn() };
  const flow = new PlanFlow({
    discoverAndPlan: discover as never,
    store,
    checks: [],
    allowedHosts: [],
    aiPlanBudgetMs: 1000,
  });
  return { flow, store };
}

describe("plan-flow / isAccountId", () => {
  it.each(["a", "b"] as const)("accepts %s", (id) => {
    expect(isAccountId(id)).toBe(true);
  });
  it.each(["c", "A", 1, null, undefined, {}])("rejects %s", (value) => {
    expect(isAccountId(value)).toBe(false);
  });
});

describe("plan-flow / isUserError", () => {
  it.each([
    ["SignInError", new SignInError("nope"), true],
    ["NoFormFoundError", new NoFormFoundError("http://x", "no form"), true],
    ["TargetNotAllowedError", new TargetNotAllowedError("http://x", "nope"), true],
    ["TargetUnreachableError", new TargetUnreachableError("http://x", "nope"), true],
    ["net::ERR_", new Error("net::ERR_NAME_NOT_RESOLVED"), true],
    ["Timeout exceeded", new Error("Navigation Timeout 30000ms exceeded"), true],
    ["Generic", new Error("anything else"), false],
    ["signed-in-but-page", new Error("Signed in as Account A, but /login still shows the sign-in page."), true],
  ])("classifies %s as user error = %s", (_name, err, expected) => {
    expect(isUserError(err)).toBe(expected);
  });
});

describe("plan-flow / flowError", () => {
  it("returns 400 with the cleaned message for a SignInError", () => {
    const redactor = neutralRedactor();
    const out = flowError(new SignInError("Wrong password."), redactor);
    expect(out.status).toBe(400);
    expect(out.message).toBe("Wrong password.");
  });
  it("returns 500 with the wrapped message for an unknown error", () => {
    const redactor = neutralRedactor();
    const out = flowError(new Error("disk gone"), redactor);
    expect(out.status).toBe(500);
    expect(out.message).toContain("Could not plan a run:");
    expect(out.message).toContain("disk gone");
  });
});

describe("plan-flow / redactPlan", () => {
  it("rewrites a token in the target and any other target", () => {
    const plan = { ...fakePlan, target: "http://x/?key=ghp_abc123def456ghi789jkl012mno345pqr678" };
    const out = redactPlan(plan);
    expect(out.target).toContain("[REDACTED:");
    expect(out.target).not.toContain("ghp_abc");
  });
});

describe("plan-flow / isRedactedTarget", () => {
  it.each([
    ["http://x/?t=ghp_abc", false],
    ["http://x/?t=[REDACTED:github-token]", true],
    ["http://x/[REDACTED:openai-key]/foo", true],
  ])("returns the right classification for %s", (target, expected) => {
    expect(isRedactedTarget(target)).toBe(expected);
  });
});

describe("PlanFlow.planForRequest", () => {
  it("stores the plan, returns its id, and unregisters nothing for a signed-out request", async () => {
    const { flow, store } = buildPlanFlow();
    const outcome = await flow.planForRequest({
      url: "http://127.0.0.1:1/notes",
      signal: new AbortController().signal,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(store.set).toHaveBeenCalledOnce();
    expect(outcome.planId).toEqual(expect.any(String));
    expect(outcome.warnings).toEqual([]);
    expect(() => outcome.unregister()).not.toThrow();
  });

  it("refuses a slot that isn't ready without contacting the engine", async () => {
    const discover = vi.fn();
    const { flow } = buildPlanFlow(discover);
    const outcome = await flow.planForRequest({
      url: "http://127.0.0.1:1/notes",
      signInAs: "a",
      signal: new AbortController().signal,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.status).toBe(400);
    expect(outcome.error.message).toContain("Account A");
    expect(discover).not.toHaveBeenCalled();
  });

  it("answers 400 when the engine throws a SignInError and the caller can still unregister", async () => {
    await writeAccounts({ a: { loginUrl: "http://127.0.0.1:1/login", username: "a@x.test", password: "very-long-password-1" } });
    const { flow } = buildPlanFlow(async () => {
      throw new SignInError("Wrong password.");
    });
    const outcome = await flow.planForRequest({
      url: "http://127.0.0.1:1/notes",
      signInAs: "a",
      signal: new AbortController().signal,
    });
    expect(() => outcome.unregister()).not.toThrow();
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.status).toBe(400);
    expect(outcome.error.message).toBe("Wrong password.");
  });

  it("redacts the notReadyMessage (the configured label is a user-controlled field)", async () => {
    const SECRET = "wiring-pass-secret-99";
    const unregister = registerSecretLiterals([SECRET]);
    try {
      // Slot a is unready (no password) and the configured label is the secret.
      await writeAccounts({ a: { label: SECRET, loginUrl: "http://127.0.0.1:1/login", username: "a@x.test" } });
      const { flow } = buildPlanFlow();
      const outcome = await flow.planForRequest({
        url: "http://127.0.0.1:1/notes",
        signInAs: "a",
        signal: new AbortController().signal,
      });
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.error.status).toBe(400);
      expect(outcome.error.message).not.toContain(SECRET);
    } finally {
      unregister();
    }
  });
});

describe("run-flow / countRunning and concurrentRunsMessage", () => {
  it("counts only running entries", () => {
    const runs = [
      { status: "running" } as never,
      { status: "running" } as never,
      { status: "done" } as never,
      { status: "error" } as never,
    ];
    expect(countRunning(runs)).toBe(2);
  });
  it.each([
    [1, "1 run is already in progress. Wait for it to finish."],
    [2, "2 runs are already in progress. Wait for one to finish."],
  ])("messages %i run(s)", (n, expected) => {
    expect(concurrentRunsMessage(n)).toBe(expected);
  });
});

describe("run-flow / rerunPlanFor", () => {
  it("proceeds past a redacted target when the caller has already checked (the controller does)", async () => {
    const state = {
      plan: { ...fakePlan, target: "http://x/[REDACTED:github-token]" },
      approved: ["dc:1"],
      allowDestructive: false,
      headed: false,
      ai: false,
    } as never;
    const out = await rerunPlanFor({
      state,
      signal: new AbortController().signal,
      discoverAndPlan: vi.fn(async () => fakePlan) as never,
      aiPlanBudgetMs: 1000,
      checks: [],
      allowedHosts: [],
    });
    expect(out.ok).toBe(true);
  });

  it("refuses an unconfigured slot before calling the engine", async () => {
    const state = {
      plan: { ...fakePlan, target: "http://127.0.0.1:1/notes", account: { id: "a", label: "Account A" } },
      approved: ["dc:1"],
      allowDestructive: false,
      headed: false,
      ai: false,
    } as never;
    const discover = vi.fn();
    const out = await rerunPlanFor({
      state,
      signal: new AbortController().signal,
      discoverAndPlan: discover as never,
      aiPlanBudgetMs: 1000,
      checks: [],
      allowedHosts: [],
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.status).toBe(400);
    expect(out.error.message).toContain("Account A");
    expect(discover).not.toHaveBeenCalled();
  });

  it("returns the plan and the AI session when planning succeeds", async () => {
    const state = {
      plan: fakePlan,
      approved: ["dc:1"],
      allowDestructive: false,
      headed: false,
      ai: false,
    } as never;
    const out = await rerunPlanFor({
      state,
      signal: new AbortController().signal,
      discoverAndPlan: vi.fn(async () => fakePlan) as never,
      aiPlanBudgetMs: 1000,
      checks: [],
      allowedHosts: [],
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.plan).toBe(fakePlan);
  });

  it("answers 500 with a wrapper when the engine throws an unknown error", async () => {
    const state = {
      plan: fakePlan,
      approved: ["dc:1"],
      allowDestructive: false,
      headed: false,
      ai: false,
    } as never;
    const out = await rerunPlanFor({
      state,
      signal: new AbortController().signal,
      discoverAndPlan: vi.fn(async () => {
        throw new Error("disk gone");
      }) as never,
      aiPlanBudgetMs: 1000,
      checks: [],
      allowedHosts: [],
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.status).toBe(500);
    expect(out.error.message).toContain("Could not plan the run again");
  });
});

describe("RunsFlow.specFile / artifactFile outcomes", () => {
  function buildRunsFlow(runs: { runState: (id: string) => Promise<unknown> }) {
    return new RunsFlow({
      discoverAndPlan: vi.fn(async () => fakePlan) as never,
      plans: { get: vi.fn() },
      runs: {
        startRun: vi.fn(),
        runState: runs.runState as never,
        listRuns: vi.fn(async () => []),
        isRedactedPlan: vi.fn(() => false),
        get map() { return new Map(); },
        maxConcurrentRuns: 2,
        runsDir: "/tmp",
      },
      options: { allowedHosts: [] },
      host: { aiPlanBudgetMs: () => 1000 },
      canShowBrowser: true,
    });
  }

  it("specFile returns notFound for an unknown run, invalidName for a bad filename, and notFound for a missing file", async () => {
    // Unknown run → notFound, regardless of filename.
    const flow = buildRunsFlow({ runState: async () => undefined });
    expect(await flow.specFile("nope", "ok.spec.ts")).toEqual({ notFound: true });

    // Run exists but isn't done → notFound, regardless of filename.
    const flowRunning = buildRunsFlow({ runState: async () => ({ status: "running", dir: tmp }) });
    expect(await flowRunning.specFile("run-x", "ok.spec.ts")).toEqual({ notFound: true });

    // Finished run, bad filename → invalidName.
    const flowDone = buildRunsFlow({ runState: async () => ({ status: "done", dir: tmp }) });
    expect(await flowDone.specFile("run-x", "../escape.ts")).toEqual({ invalidName: true });
    expect(await flowDone.specFile("run-x", "bad$name.spec.ts")).toEqual({ invalidName: true });

    // Finished run, safe name, file not on disk → notFound.
    expect(await flowDone.specFile("run-x", "missing.spec.ts")).toEqual({ notFound: true });

    // Finished run, safe name, file on disk → ok.
    const dir = join(tmp, "run-ok");
    await mkdir(join(dir, "specs"), { recursive: true });
    await writeFile(join(dir, "specs", "ok.spec.ts"), "// ok\n");
    const flowOk = buildRunsFlow({ runState: async () => ({ status: "done", dir }) });
    const ok = await flowOk.specFile("run-ok", "ok.spec.ts");
    expect(ok).toMatchObject({ ok: true, file: { body: "// ok\n" } });
  });

  it("artifactFile returns notFound for an unknown run, invalidName for an unsafe name or unsupported extension, and notFound for a missing file", async () => {
    // Unknown run → notFound, regardless of filename.
    const flow = buildRunsFlow({ runState: async () => undefined });
    expect(await flow.artifactFile("nope", "frame.png")).toEqual({ notFound: true });

    // Run exists but isn't done → notFound.
    const flowRunning = buildRunsFlow({ runState: async () => ({ status: "running", dir: tmp }) });
    expect(await flowRunning.artifactFile("run-x", "frame.png")).toEqual({ notFound: true });

    // Finished run, bad filename or unsupported extension → invalidName.
    const flowDone = buildRunsFlow({ runState: async () => ({ status: "done", dir: tmp }) });
    expect(await flowDone.artifactFile("run-x", "../escape.png")).toEqual({ invalidName: true });
    expect(await flowDone.artifactFile("run-x", "frame.txt")).toEqual({ invalidName: true });

    // Finished run, safe name + supported extension, file not on disk → notFound.
    expect(await flowDone.artifactFile("run-x", "frame.png")).toEqual({ notFound: true });

    // Finished run, safe name + supported extension, file on disk → ok.
    const dir = join(tmp, "run-art");
    await mkdir(join(dir, "artifacts"), { recursive: true });
    await writeFile(join(dir, "artifacts", "frame.png"), "PNG");
    const flowOk = buildRunsFlow({ runState: async () => ({ status: "done", dir }) });
    const ok = await flowOk.artifactFile("run-art", "frame.png");
    expect(ok).toMatchObject({ ok: true, file: { contentType: "image/png" } });
  });
});

describe("account-flow / readyAccount", () => {
  it("refuses an unset account with a 400-style message", async () => {
    const r = await readyAccount("a");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain("Account A");
  });

  it("yields the resolved accounts when the slot is configured", async () => {
    await writeAccounts({ a: { loginUrl: "http://127.0.0.1:1/login", username: "a@x.test", password: "very-long-password-1" } });
    const r = await readyAccount("a");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.account.id).toBe("a");
    expect(r.account.accounts.accounts.a.username).toBe("a@x.test");
  });

  it("redacts secrets in the notReadyMessage when a configured label is a secret", async () => {
    const SECRET = "readyaccount-secret-99";
    const unregister = registerSecretLiterals([SECRET]);
    try {
      await writeAccounts({ a: { label: SECRET, loginUrl: "http://127.0.0.1:1/login", username: "a@x.test", password: "very-long-password-1" }, b: {} });
      const r = await readyAccount("b");
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.message).not.toContain(SECRET);
    } finally {
      unregister();
    }
  });
});

describe("redact-text", () => {
  it("neutralRedactor does not hide anything but still redacts engine secrets", () => {
    const r = neutralRedactor();
    expect(r.redact("hello alice@example.test")).toBe("hello alice@example.test");
    expect(r.redact("token ghp_abc123def456ghi789jkl012mno345pqr678 leaked")).toContain("[REDACTED:");
  });

  it("redactorFor hides usernames in redact and hideJson", () => {
    const accounts = {
      isolated: true,
      accounts: {
        a: { id: "a", label: "Account A", loginUrl: "", username: "alice@example.test", password: null },
        b: { id: "b", label: "Account B", loginUrl: "", username: "bob@example.test", password: null },
      },
    } as never;
    const r = redactorFor(accounts);
    expect(r.redact("hello alice@example.test")).not.toContain("alice@example.test");
    const json = r.hideJson({ msg: "hello alice@example.test" });
    expect(JSON.stringify(json)).not.toContain("alice@example.test");
  });

  it("clearError hides the username and redacts secrets", () => {
    const accounts = {
      isolated: true,
      accounts: {
        a: { id: "a", label: "Account A", loginUrl: "", username: "alice@example.test", password: null },
        b: { id: "b", label: "Account B", loginUrl: "", username: "bob@example.test", password: null },
      },
    } as never;
    const r = redactorFor(accounts);
    expect(r.clearError(new Error("alice@example.test crashed"))).not.toContain("alice@example.test");
  });
});

describe("ai-models / resolveModelsList", () => {
  it("refuses an unknown provider with the asked value", async () => {
    const out = await resolveModelsList(
      { provider: "ollama", baseUrl: "http://127.0.0.1:11434/v1", region: null, apiKey: null, allowRemote: false },
      { provider: "ghost" },
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.raw).toBe("ghost");
    expect(out.message).toBe(`Unknown provider "ghost".`);
  });
});