/**
 * The helper model (docs/ai-spec.md "Model roles", docs/onboarding-spec.md "Main and helper models"): `helperModel` in
 * ai.json, RUNHOUND_AI_HELPER_MODEL and the flag, shown in the status, and the session's two clients on the same
 * provider, endpoint, key and consent. Without a helper model the main model does the helper's jobs too.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startFakeLlm } from "../../support/fake-llm.js";
import { aiStatus, resolveAiConfig, saveAiConfig } from "../../../src/ai/config.js";
import { aiSession, boundSession } from "../../../src/ai/session.js";
import type { JsonRequest } from "../../../src/ai/types.js";
import { aiFlagsFrom } from "../../../src/cli/flags.js";

let tmp: string;
let env: NodeJS.ProcessEnv;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "rh-helper-model-"));
  env = { RUNHOUND_CONFIG_DIR: join(tmp, "config") };
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const save = (patch: Parameters<typeof saveAiConfig>[0]) => saveAiConfig(patch, { env, home: tmp });
const resolveWith = (extra: NodeJS.ProcessEnv = {}, flags = {}) => resolveAiConfig({ env: { ...env, ...extra }, flags, home: tmp });
const LOCAL = { enabled: true, provider: "ollama", baseUrl: "http://127.0.0.1:11434/v1", model: "main-model" } as const;

describe("helperModel in the config", () => {
  it("is empty by default and in the status", async () => {
    const resolved = await resolveWith();
    expect(resolved.config.helperModel).toBe("");
    expect(resolved.sources.helperModel).toBe("default");
    expect(aiStatus(resolved, env, tmp).helperModel).toBe("");
  });

  it("is saved to ai.json, read back and shown in the status; an empty one removes it", async () => {
    await save({ ...LOCAL, helperModel: "helper-model" });
    expect(JSON.parse(await readFile(join(tmp, "config", "ai.json"), "utf8"))).toMatchObject({ model: "main-model", helperModel: "helper-model" });
    const status = aiStatus(await resolveWith(), env, tmp);
    expect(status).toMatchObject({ model: "main-model", helperModel: "helper-model" });
    expect(status.sources.helperModel).toBe("file");

    await save({ helperModel: "" });
    expect(JSON.parse(await readFile(join(tmp, "config", "ai.json"), "utf8"))).not.toHaveProperty("helperModel");
    expect(aiStatus(await resolveWith(), env, tmp).helperModel).toBe("");
  });

  it("refuses a helper model that is not a string", async () => {
    await expect(save({ ...LOCAL, helperModel: 7 as unknown as string })).rejects.toThrow(/helperModel must be a string/);
  });

  it("comes from RUNHOUND_AI_HELPER_MODEL, over the file, and the environment's value can't be changed from Settings", async () => {
    await save({ ...LOCAL, helperModel: "file-helper" });
    const resolved = await resolveWith({ RUNHOUND_AI_HELPER_MODEL: "env-helper" });
    expect(resolved.config.helperModel).toBe("env-helper");
    expect(resolved.sources.helperModel).toBe("env");
    await expect(save({ helperModel: "other" })).resolves.toBeDefined(); // no variable here: the file wins
    process.env.RUNHOUND_AI_HELPER_MODEL = "env-helper";
    try {
      await expect(saveAiConfig({ helperModel: "other" }, { env: { ...env, RUNHOUND_AI_HELPER_MODEL: "env-helper" }, home: tmp })).rejects.toThrow(/helperModel is set by RUNHOUND_AI_HELPER_MODEL/);
    } finally {
      delete process.env.RUNHOUND_AI_HELPER_MODEL;
    }
  });

  it("comes from --ai-helper-model, over the environment", async () => {
    const flags = aiFlagsFrom({ "ai-helper-model": "flag-helper" });
    expect(flags).toEqual({ helperModel: "flag-helper" });
    const resolved = await resolveWith({ RUNHOUND_AI_HELPER_MODEL: "env-helper" }, flags);
    expect(resolved.config.helperModel).toBe("flag-helper");
    expect(resolved.sources.helperModel).toBe("flag");
  });
});

describe("the session's two clients", () => {
  const request: JsonRequest<unknown> = { name: "x", system: "s", user: "u", schema: {}, validate: (v) => v };

  it("share the provider and endpoint but ask for their own model", async () => {
    const fake = await startFakeLlm({ models: [{ id: "m" }] });
    try {
      await save({ enabled: true, provider: "ollama", baseUrl: fake.baseUrl, model: "main-model", helperModel: "helper-model" });
      const out = aiSession(await resolveWith(), env);
      if (!("session" in out)) throw new Error(out.problem);
      expect(out.session.client.model).toBe("main-model");
      expect(out.session.helper.model).toBe("helper-model");
      expect(out.session.helper.provider).toBe(out.session.client.provider);
      fake.reply({ ok: true });
      await out.session.client.generateJson(request);
      await out.session.helper.generateJson(request);
      expect(fake.calls.map((c) => c.body.model)).toEqual(["main-model", "helper-model"]);
    } finally {
      await fake.close();
    }
  });

  it("are one client when there is no helper model, or it is the main model", async () => {
    await save(LOCAL);
    const alone = aiSession(await resolveWith(), env);
    if (!("session" in alone)) throw new Error(alone.problem);
    expect(alone.session.helper).toBe(alone.session.client);

    await save({ helperModel: "main-model" });
    const same = aiSession(await resolveWith(), env);
    if (!("session" in same)) throw new Error(same.problem);
    expect(same.session.helper).toBe(same.session.client);
  });

  it("keep their own model through boundSession, which gives both one budget", async () => {
    await save({ ...LOCAL, helperModel: "helper-model" });
    const out = aiSession(await resolveWith(), env);
    if (!("session" in out)) throw new Error(out.problem);
    const bound = boundSession(out.session, { budgetMs: 1_000 });
    expect(bound.session.client.model).toBe("main-model");
    expect(bound.session.helper.model).toBe("helper-model");
    expect(bound.session.helper).not.toBe(bound.session.client);

    const alone = boundSession({ ...out.session, helper: out.session.client }, { budgetMs: 1_000 });
    expect(alone.session.helper).toBe(alone.session.client);
  });

  it("stop together when the budget is spent", async () => {
    const slow = (model: string) => ({
      provider: "ollama" as const,
      model,
      generateJson<T>(r: JsonRequest<T>): Promise<T> {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => resolve({ ok: true } as T), 150);
          r.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new Error("aborted"));
          });
        });
      },
    });
    const bound = boundSession({ client: slow("main"), helper: slow("helper"), remote: false, features: { review: true, suggest: true, explain: true } }, { budgetMs: 200 });
    await bound.session.client.generateJson(request);
    // 50 ms are left of the shared budget: the helper's call is cut short by it, not given a budget of its own.
    await expect(bound.session.helper.generateJson(request)).rejects.toThrow(/longer than/);
    expect(bound.timedOut()).toBe(true);
  });
});
