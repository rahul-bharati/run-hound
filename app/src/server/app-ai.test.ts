import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hono } from "hono";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startFakeLlm, type FakeLlm } from "../../test-support/fake-llm.js";
import { startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import { saveAiConfig } from "../ai/config.js";
import type { AiModelList, AiStatus } from "../ai/types.js";
import type { Check, CheckId, Plan, Scenario } from "../core/types.js";
import { createApp } from "./app.js";

/**
 * AI endpoints of the web server (docs/ai-spec.md "Surfaces" → API).
 *
 * Contract these tests pin down (interpretations marked *):
 * - GET /api/ai → AiStatus. Never an `apiKey` field, never the key itself.
 * - PUT /api/ai (application/json, same-origin only) with an AiConfigPatch → 200 AiStatus. A cross-site Origin → 403;
 *   another content type → 415 (* 400 accepted too). A patch touching an env-sourced field → 400, error naming the
 *   variable. An invalid patch (bad provider) → 400.
 * - GET /api/ai/models?provider=&baseUrl= → AiModelList (200 even when listing failed; the reason is in `error`).
 *   * Other config fields (key, consent) come from the saved config.
 * - POST /api/ai/test (body {} *) → 200 with testConnection's result for the saved config.
 * - GET /api/settings → adds `ai: AiStatus`.
 * - POST /api/plan {url, ai?: boolean} → when AI runs, plan.ai is set, reviewed scenarios carry `ai`, suggested
 *   "ai-flow:<n>" scenarios are appended (defaultSelected false). A failed AI call still answers 200 with the
 *   built-in plan and plan.ai.warnings. ai: false sends nothing to the model.
 * - * The server resolves the AI config per request (RUNHOUND_CONFIG_DIR + env), so tests can change it between calls.
 * - * Review is asked before suggest (the fake answers from a queue in call order).
 */

const FORM_PAGE = `<!doctype html><html lang="en"><head><title>AI plan fixture</title></head><body>
<main><form id="booking">
  <h1>Book a sitter</h1>
  <label for="petName">Pet name</label><input id="petName" name="petName" required>
  <label for="email">Owner email</label><input id="email" name="email" type="email" required>
  <button type="submit">Book</button>
</form></main>
<script>
  document.getElementById("booking").addEventListener("submit", function (e) {
    e.preventDefault();
    fetch("/api/bookings", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  });
</script>
</body></html>`;

function scenario(checkId: CheckId, id: string, extra: Partial<Scenario> = {}): Scenario {
  return { id, checkId, title: `Fake ${id}`, description: "fake", kind: "golden", priority: "medium", destructive: false, defaultSelected: true, ...extra };
}

function fakeCheck(id: CheckId, category: Check["category"], scenarioId: string): Check {
  return {
    id,
    title: `Fake ${id}`,
    category,
    plan: () => [scenario(id, scenarioId)],
    async run(_ctx, s) {
      return { checkId: id, scenarioId: s.id, status: "pass", findings: [], durationMs: 1 };
    },
  };
}

const checks: Check[] = [fakeCheck("focus-visible", "accessibility", "fv:1"), fakeCheck("dead-control", "broken-feature", "dc:1")];

const SECRET = "sk-test-secret-1234567890abcdef";
const AI_ENV = ["RUNHOUND_CONFIG_DIR", "XDG_CONFIG_HOME"];

let site: FixtureServer;
let fake: FakeLlm;
let configDir: string;
let saved: NodeJS.ProcessEnv;
let app: Hono;

beforeAll(async () => {
  site = await startFixtureServer({ pages: { "/book": FORM_PAGE }, routes: { "POST /api/bookings": (_q, r) => { r.writeHead(201).end("{}"); } } });
  fake = await startFakeLlm({ models: [{ id: "fake-model:9b", parameterSize: "9.0B", quantization: "Q4_K_M", capabilities: ["completion"] }, { id: "embed-model", capabilities: ["embedding"] }] });
});

afterAll(async () => {
  await site?.close();
  await fake?.close();
});

beforeEach(async () => {
  saved = {};
  for (const k of [...AI_ENV, ...Object.keys(process.env).filter((x) => x.startsWith("RUNHOUND_AI"))]) saved[k] = process.env[k];
  for (const k of Object.keys(process.env)) if (k.startsWith("RUNHOUND_AI")) delete process.env[k];
  configDir = await mkdtemp(join(tmpdir(), "rh-ai-config-"));
  process.env.RUNHOUND_CONFIG_DIR = configDir;
  fake.calls.length = 0;
  fake.reply({ ok: true });
  app = createApp({ checks, canShowBrowser: false, maxConcurrentRuns: 10 });
});

afterEach(async () => {
  for (const k of Object.keys(process.env)) if (k.startsWith("RUNHOUND_AI")) delete process.env[k];
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await rm(configDir, { recursive: true, force: true });
});

/** Saves a usable local config pointing at the fake. */
async function enableLocalAi(extra: Record<string, unknown> = {}) {
  await saveAiConfig({ enabled: true, provider: "ollama", baseUrl: fake.baseUrl, model: "fake-model:9b", ...extra });
}

/** The header the web UI sends on every /api/ai* request (a cross-site page can't send it without a preflight). */
const RH = { "x-run-hound": "1" };

function send(method: string, path: string, body: unknown = {}, headers: Record<string, string> = {}) {
  return app.request(path, { method, headers: { "content-type": "application/json", ...RH, ...headers }, body: JSON.stringify(body) });
}

function get(path: string, headers: Record<string, string> = RH) {
  return app.request(path, { headers });
}

describe("GET /api/ai", () => {
  it("returns the status with defaults: AI off, no key", async () => {
    const res = await get("/api/ai");
    expect(res.status).toBe(200);
    const status = (await res.json()) as AiStatus;
    expect(status.enabled).toBe(false);
    expect(status.provider).toBe("ollama");
    expect(status.hasKey).toBe(false);
    expect(status.problem).toBe("AI is off");
    expect(status.file).toBe(join(configDir, "ai.json"));
    expect(status).not.toHaveProperty("apiKey");
  });

  it("never returns the saved key, only hasKey", async () => {
    await saveAiConfig({ enabled: true, provider: "openai-compatible", baseUrl: fake.baseUrl, model: "m", apiKey: SECRET });
    const res = await get("/api/ai");
    const text = await res.text();
    expect(text).not.toContain(SECRET);
    const status = JSON.parse(text) as AiStatus;
    // Only sources.apiKey (where the key came from) may carry the name; no field anywhere holds a key value.
    expect(status).not.toHaveProperty("apiKey");
    expect(Object.keys(status.sources)).toContain("apiKey");
    expect(status.hasKey).toBe(true);
    expect(status.sources.apiKey).toBe("file");
  });
});

describe("PUT /api/ai", () => {
  it("saves a patch and returns the new status without the key", async () => {
    const res = await send("PUT", "/api/ai", { enabled: true, provider: "ollama", baseUrl: fake.baseUrl, model: "fake-model:9b", apiKey: SECRET });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(SECRET);
    const status = JSON.parse(text) as AiStatus;
    expect(status.enabled).toBe(true);
    expect(status.model).toBe("fake-model:9b");
    expect(status.hasKey).toBe(true);
    expect(status.remote).toBe(false);
    expect(status.problem).toBeNull();
    // It persisted: a fresh GET sees it.
    const again = (await (await get("/api/ai")).json()) as AiStatus;
    expect(again.model).toBe("fake-model:9b");
    expect(again.sources.model).toBe("file");
  });

  it("refuses a cross-site request", async () => {
    const res = await send("PUT", "/api/ai", { enabled: true }, { origin: "https://evil.example" });
    expect(res.status).toBe(403);
    const status = (await (await get("/api/ai")).json()) as AiStatus;
    expect(status.enabled).toBe(false);
  });

  it("refuses a body that is not JSON", async () => {
    const res = await app.request("/api/ai", { method: "PUT", headers: { "content-type": "text/plain", ...RH }, body: JSON.stringify({ enabled: true }) });
    expect([400, 415]).toContain(res.status);
    const status = (await (await get("/api/ai")).json()) as AiStatus;
    expect(status.enabled).toBe(false);
  });

  it("refuses to change a value set by an environment variable, naming it", async () => {
    process.env.RUNHOUND_AI_MODEL = "env-model";
    const res = await send("PUT", "/api/ai", { model: "other-model" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("RUNHOUND_AI_MODEL");
    const status = (await (await get("/api/ai")).json()) as AiStatus;
    expect(status.model).toBe("env-model");
    expect(status.sources.model).toBe("env");
  });

  it("saves and clears the Bedrock AWS profile, and refuses to change one set by RUNHOUND_AI_AWS_PROFILE", async () => {
    let res = await send("PUT", "/api/ai", { provider: "bedrock", region: "us-east-1", awsProfile: "work-sso" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as AiStatus).awsProfile).toBe("work-sso");
    expect(((await (await get("/api/ai")).json()) as AiStatus).sources.awsProfile).toBe("file");
    res = await send("PUT", "/api/ai", { awsProfile: null });
    expect(((await res.json()) as AiStatus).sources.awsProfile).not.toBe("file");
    process.env.RUNHOUND_AI_AWS_PROFILE = "env-profile";
    res = await send("PUT", "/api/ai", { awsProfile: "other" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("RUNHOUND_AI_AWS_PROFILE");
  });

  it("refuses an invalid patch", async () => {
    const res = await send("PUT", "/api/ai", { provider: "skynet" });
    expect(res.status).toBe(400);
  });
});

describe("the X-Run-Hound header", () => {
  it("is required on GET /api/ai", async () => {
    expect((await get("/api/ai", {})).status).toBe(403);
    expect((await get("/api/ai", { "x-run-hound": "0" })).status).toBe(403);
    expect((await get("/api/ai")).status).toBe(200);
  });

  it("is required on GET /api/ai/models, so a cross-site <img> can't make the server call out", async () => {
    const before = fake.requests.length;
    const res = await get(`/api/ai/models?provider=ollama&baseUrl=${encodeURIComponent(fake.baseUrl)}`, {});
    expect(res.status).toBe(403);
    expect(fake.requests).toHaveLength(before);
  });

  it("is required on PUT /api/ai and POST /api/ai/test", async () => {
    await enableLocalAi();
    const put = await app.request("/api/ai", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: false }) });
    expect(put.status).toBe(403);
    expect(((await (await get("/api/ai")).json()) as AiStatus).enabled).toBe(true);
    const test = await app.request("/api/ai/test", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(test.status).toBe(403);
    expect(fake.calls).toHaveLength(0);
  });

  it("does not replace the Sec-Fetch-Site check", async () => {
    expect((await get("/api/ai", { ...RH, "sec-fetch-site": "cross-site" })).status).toBe(403);
  });
});

describe("PUT /api/ai when the endpoint changes", () => {
  it("removes the saved key and says so in a notice", async () => {
    await saveAiConfig({ enabled: true, provider: "openai-compatible", baseUrl: fake.baseUrl, model: "m", apiKey: SECRET });
    const res = await send("PUT", "/api/ai", { baseUrl: "http://127.0.0.2:9/v1" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as AiStatus & { notice?: string };
    expect(body.hasKey).toBe(false);
    expect(body.notice).toBe("The saved API key was removed because the endpoint changed.");
  });

  it("has no notice when the key stays", async () => {
    const res = await send("PUT", "/api/ai", { model: "m" });
    expect(((await res.json()) as { notice?: string }).notice).toBeUndefined();
  });

  it("drops consent given for another host", async () => {
    await send("PUT", "/api/ai", { enabled: true, provider: "openai-compatible", baseUrl: "https://api.a.example/v1", model: "m", allowRemote: true });
    const res = await send("PUT", "/api/ai", { baseUrl: "https://api.b.example/v1" });
    const body = (await res.json()) as AiStatus;
    expect(body.allowRemote).toBe(false);
    expect(body.problem).toContain("api.b.example");
  });
});

describe("GET /api/ai/models", () => {
  it("lists the models of a local Ollama-style server", async () => {
    const res = await get(`/api/ai/models?provider=ollama&baseUrl=${encodeURIComponent(fake.baseUrl)}`);
    expect(res.status).toBe(200);
    const list = (await res.json()) as AiModelList;
    expect(list.error).toBeNull();
    expect(list.models.map((m) => m.id)).toEqual(["embed-model", "fake-model:9b"]);
    expect(list.models.find((m) => m.id === "fake-model:9b")?.suitable).toBe(true);
    expect(list.models.find((m) => m.id === "embed-model")?.suitable).toBe(false);
  });

  it("does not contact a remote endpoint without consent", async () => {
    const res = await get(`/api/ai/models?provider=openai-compatible&baseUrl=${encodeURIComponent("https://api.example.com/v1")}`);
    expect(res.status).toBe(200);
    const list = (await res.json()) as AiModelList;
    expect(list.models).toEqual([]);
    expect(list.error).toContain("api.example.com");
  });
});

describe("POST /api/ai/test", () => {
  it("reports ok for a working endpoint", async () => {
    await enableLocalAi();
    const res = await send("POST", "/api/ai/test", {});
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; model?: string };
    expect(body.ok).toBe(true);
    expect(body.model).toContain("fake-model:9b");
    expect(fake.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("reports the error in plain words when the endpoint refuses", async () => {
    await enableLocalAi({ apiKey: SECRET });
    fake.reply({ status: 401, body: '{"error":"bad key"}' });
    const res = await send("POST", "/api/ai/test", {});
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(SECRET);
    const body = JSON.parse(text) as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error ?? "").not.toBe("");
  });
});

describe("GET /api/settings", () => {
  it("includes the AI status without the key", async () => {
    await enableLocalAi({ apiKey: SECRET });
    const res = await app.request("/api/settings");
    const text = await res.text();
    expect(text).not.toContain(SECRET);
    const body = JSON.parse(text) as { ai: AiStatus };
    expect(body.ai.enabled).toBe(true);
    expect(body.ai.hasKey).toBe(true);
    expect(body.ai).not.toHaveProperty("apiKey");
  });
});

interface PlanResponse {
  planId: string;
  plan: Plan;
  warnings: string[];
}

describe("POST /api/plan with AI", () => {
  const review = {
    scenarios: [
      { id: "fv:1", recommended: true, priority: "high", rationale: "Keyboard users must see where they are on the booking form." },
      { id: "dc:1", recommended: false, priority: "low", rationale: "The form has one button, so dead controls are unlikely." },
      { id: "nope:9", recommended: true, priority: "high", rationale: "Unknown id, ignored." },
    ],
  };
  const suggest = {
    suggestions: [
      {
        title: "Book with a pet name",
        rationale: "Booking is the main job of this page.",
        form: 0,
        steps: [
          { action: "fill", field: "petName", value: "Rex" },
          { action: "fill", field: "email", value: "rex@example.com" },
          { action: "click", control: 0 },
          { action: "expect", expect: "request-ok", text: null },
        ],
      },
      {
        title: "Uses a field that does not exist",
        rationale: "Invalid on purpose.",
        form: 0,
        steps: [
          { action: "fill", field: "ghost", value: "boo" },
          { action: "expect", expect: "no-errors", text: null },
        ],
      },
    ],
  };

  it("reviews the plan and appends suggested scenarios, never ticked", async () => {
    await enableLocalAi();
    fake.reply(review, suggest);
    const res = await send("POST", "/api/plan", { url: `${site.url}/book`, ai: true });
    expect(res.status).toBe(200);
    const { plan } = (await res.json()) as PlanResponse;
    expect(fake.calls.length).toBeGreaterThanOrEqual(2);

    expect(plan.ai).toBeDefined();
    expect(plan.ai!.provider).toBe("ollama");
    expect(plan.ai!.model).toBe("fake-model:9b");
    expect(plan.ai!.remote).toBe(false);
    expect(plan.ai!.reviewed).toBe(true);
    expect(plan.ai!.suggested).toBe(1);

    const fv = plan.scenarios.find((s) => s.id === "fv:1")!;
    expect(fv.ai?.rationale).toContain("Keyboard users");
    expect(fv.ai?.recommended).toBe(true);
    expect(fv.priority).toBe("high");
    expect(fv.defaultSelected).toBe(true);
    const dc = plan.scenarios.find((s) => s.id === "dc:1")!;
    expect(dc.ai?.recommended).toBe(false);
    expect(dc.defaultSelected).toBe(false);
    expect(plan.scenarios.some((s) => s.id === "nope:9")).toBe(false);

    const suggested = plan.scenarios.filter((s) => s.id.startsWith("ai-flow:"));
    expect(suggested).toHaveLength(1);
    const flow = suggested[0]!;
    expect(flow.checkId).toBe("ai-flow");
    expect(flow.defaultSelected).toBe(false);
    expect(flow.ai?.suggested).toBe(true);
    expect(flow.title).toBe("Book with a pet name");
    expect(flow.flow).toHaveLength(4);
    // After the built-in Features scenarios, in the Features group.
    const features = plan.groups.find((g) => g.id === "features")!;
    expect(features.scenarioIds.at(-1)).toBe(flow.id);
    expect(plan.scenarios.at(-1)?.id).toBe(flow.id);
  });

  it("uses AI by default when it is enabled and usable", async () => {
    await enableLocalAi();
    fake.reply(review, suggest);
    const res = await send("POST", "/api/plan", { url: `${site.url}/book` });
    expect(res.status).toBe(200);
    const { plan } = (await res.json()) as PlanResponse;
    expect(plan.ai).toBeDefined();
    expect(fake.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("falls back to the built-in plan with a warning when the model answers garbage", async () => {
    await enableLocalAi();
    fake.reply({ raw: "I am not JSON, sorry" });
    const res = await send("POST", "/api/plan", { url: `${site.url}/book`, ai: true });
    expect(res.status).toBe(200);
    const { plan } = (await res.json()) as PlanResponse;
    expect(plan.ai).toBeDefined();
    expect(plan.ai!.reviewed).toBe(false);
    expect(plan.ai!.suggested).toBe(0);
    expect(plan.ai!.warnings.length).toBeGreaterThan(0);
    expect(plan.scenarios.map((s) => s.id).sort()).toEqual(["dc:1", "fv:1"]);
    expect(plan.scenarios.every((s) => s.ai === undefined)).toBe(true);
    expect(plan.scenarios.every((s) => s.defaultSelected)).toBe(true);
  });

  it("sends nothing to the model with ai: false", async () => {
    await enableLocalAi();
    fake.reply(review, suggest);
    const res = await send("POST", "/api/plan", { url: `${site.url}/book`, ai: false });
    expect(res.status).toBe(200);
    const { plan } = (await res.json()) as PlanResponse;
    expect(fake.calls).toHaveLength(0);
    expect(plan.ai).toBeUndefined();
    expect(plan.scenarios.every((s) => s.ai === undefined)).toBe(true);
  });

  it("caps the AI part of planning and still returns the plan with a warning", async () => {
    const slow = await startFakeLlm({ delayMs: 5_000 });
    try {
      await saveAiConfig({ enabled: true, provider: "ollama", baseUrl: slow.baseUrl, model: "fake-model:9b" });
      const capped = createApp({ checks, canShowBrowser: false, maxConcurrentRuns: 10, aiPlanBudgetMs: 300 });
      const started = Date.now();
      const res = await capped.request("/api/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: `${site.url}/book`, ai: true }) });
      expect(Date.now() - started).toBeLessThan(4_000);
      expect(res.status).toBe(200);
      const { plan, warnings } = (await res.json()) as PlanResponse;
      expect(plan.ai?.reviewed).toBe(false);
      expect(plan.ai?.suggested).toBe(0);
      expect(plan.ai!.warnings.join(" ")).toMatch(/took longer than/);
      expect(warnings.join(" ")).toMatch(/AI planning was stopped after/);
      expect(plan.scenarios.map((s) => s.id).sort()).toEqual(["dc:1", "fv:1"]);
    } finally {
      await slow.close();
    }
  });

  it("sends nothing when AI is off", async () => {
    const res = await send("POST", "/api/plan", { url: `${site.url}/book` });
    expect(res.status).toBe(200);
    const { plan } = (await res.json()) as PlanResponse;
    expect(fake.calls).toHaveLength(0);
    expect(plan.ai).toBeUndefined();
  });
});
