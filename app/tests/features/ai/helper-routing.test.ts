/**
 * Which model does which job (docs/ai-spec.md "Model roles"), through the real call sites: drafting a testing brief and the
 * agent's turns use the main model; the plan review and suggested flows (and, in runner-ai.test.ts, the explanations) use
 * the helper model. Everything goes to one fake server and the model of each request is read from what it received.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hono } from "hono";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startFakeLlm, type FakeLlm } from "../../support/fake-llm.js";
import { startFixtureServer, type FixtureServer } from "../../support/server.js";
import { resolveAiConfig, saveAiConfig } from "../../../src/ai/config.js";
import type { Check } from "../../../src/core/types.js";
import { createApp } from "../../../src/server/app.js";

const PAGE = `<!doctype html><html lang="en"><head><title>Routing fixture</title></head><body><main><form id="booking">
<h1>Book a sitter</h1><label for="petName">Pet name</label><input id="petName" name="petName" required><button type="submit">Book</button>
</form></main></body></html>`;

const checks: Check[] = [
  {
    id: "dead-control",
    title: "Fake dead-control",
    category: "broken-feature",
    plan: () => [{ id: "dc:1", checkId: "dead-control", title: "Fake", description: "fake", kind: "golden", priority: "medium", destructive: false, defaultSelected: true }],
    async run(_ctx, s) {
      return { checkId: "dead-control", scenarioId: s.id, status: "pass", findings: [], durationMs: 1 };
    },
  },
];

const RH = { "x-run-hound": "1" };
let site: FixtureServer;
let fake: FakeLlm;
let tmp: string;
let saved: NodeJS.ProcessEnv;
let app: Hono;

beforeAll(async () => {
  site = await startFixtureServer({ pages: { "/book": PAGE } });
  fake = await startFakeLlm({ models: [{ id: "main-model" }, { id: "helper-model" }] });
});
afterAll(async () => {
  await site?.close();
  await fake?.close();
});
beforeEach(async () => {
  saved = { ...process.env };
  for (const k of Object.keys(process.env)) if (k.startsWith("RUNHOUND_AI") || k.startsWith("RUNHOUND_ACCOUNT")) delete process.env[k];
  tmp = await mkdtemp(join(tmpdir(), "rh-routing-"));
  process.env.RUNHOUND_CONFIG_DIR = join(tmp, "config");
  fake.calls.length = 0;
  // Nothing the model says is valid, which is enough: the model of each request is what is under test.
  fake.reply({});
  app = createApp({ checks, canShowBrowser: false, agent: true, runsDir: join(tmp, "runs"), allowedHosts: [] });
});
afterEach(async () => {
  await resolveAiConfig();
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
  await rm(tmp, { recursive: true, force: true });
});

const models = () => fake.calls.map((c) => c.body.model as string);
const enable = (extra: Record<string, unknown> = {}) => saveAiConfig({ enabled: true, provider: "ollama", baseUrl: fake.baseUrl, model: "main-model", helperModel: "helper-model", ...extra });
const post = (path: string, body: unknown) => app.request(path, { method: "POST", headers: { "content-type": "application/json", ...RH }, body: JSON.stringify(body) });

describe("model roles", () => {
  it("plan review and suggested flows use the helper model, never the main one", async () => {
    await enable();
    const res = await post("/api/plan", { url: `${site.url}/book`, ai: true });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { plan: { ai?: { model: string } } };
    expect(models().length).toBeGreaterThan(0);
    expect(new Set(models())).toEqual(new Set(["helper-model"]));
    expect(body.plan.ai?.model).toBe("helper-model");
  });

  it("drafting a testing brief uses the main model, never the helper", async () => {
    await enable();
    const res = await post("/api/briefs", { goal: "Check that booking a sitter saves", url: `${site.url}/book` });
    expect(res.status).toBe(201);
    expect(models().length).toBeGreaterThan(0);
    expect(new Set(models())).toEqual(new Set(["main-model"]));
  });

  it("everything uses the main model when no helper model is set, or when it is the main model", async () => {
    await enable({ helperModel: "" });
    await post("/api/plan", { url: `${site.url}/book`, ai: true });
    await post("/api/briefs", { goal: "Check that booking a sitter saves", url: `${site.url}/book` });
    expect(new Set(models())).toEqual(new Set(["main-model"]));

    fake.calls.length = 0;
    await saveAiConfig({ helperModel: "main-model" });
    await post("/api/plan", { url: `${site.url}/book`, ai: true });
    expect(new Set(models())).toEqual(new Set(["main-model"]));
  });

  it("the connection test tests the main model", async () => {
    await enable();
    fake.reply({ ok: true });
    const res = await post("/api/ai/test", {});
    expect(((await res.json()) as { ok: boolean; model: string }).model).toBe("main-model");
    expect(models()).toEqual(["main-model"]);
  });
});
