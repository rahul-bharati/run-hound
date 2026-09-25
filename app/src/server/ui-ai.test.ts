/**
 * The AI features in the web UI (docs/ai-spec.md, "Surfaces" → Web UI), driven in real Chromium. The page is renderUi's
 * document and every /api/* call is answered by a stub (page.route), so these tests pin the client's behaviour:
 * - Settings → AI card: provider presets, the model dropdown filled from /api/ai/models (debounced, Refresh, "id —
 *   details", unsuitable models disabled, a saved model the server doesn't list kept and marked, the list's error
 *   inline, "Other…" with a text input, a text input for Bedrock), the key field that is never prefilled, locked
 *   fields, the consent box naming the host, Save (PUT) and Test connection.
 * - New Run: "Review with AI" sent as `ai`, the AI and "Suggested by AI" chips, rationales, suggested steps in plain
 *   words, plan.ai warnings and "Reviewed by <provider>/<model>".
 * - Report: the "AI explanation" panel after "What to ask your AI", and Report.ai warnings.
 */
import { chromium, type Browser, type Page, type Request, type Route } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AiModelList, AiStatus } from "../ai/types.js";
import type { Finding, Plan, Report } from "../core/types.js";
import { renderUi } from "./ui/index.js";

const ORIGIN = "http://rh.test";
const HTML = renderUi({ version: "0.3.0", canShowBrowser: false });
const OLLAMA_URL = "http://127.0.0.1:11434/v1";
const LMSTUDIO_URL = "http://127.0.0.1:1234/v1";

function status(extra: Partial<AiStatus> = {}): AiStatus {
  return {
    enabled: true,
    provider: "ollama",
    baseUrl: OLLAMA_URL,
    model: "ornith-1.5:9b",
    region: null,
    allowRemote: false,
    features: { review: true, suggest: true, explain: true },
    timeoutMs: 120_000,
    hasKey: false,
    remote: false,
    host: "127.0.0.1",
    problem: null,
    sources: { enabled: "file", provider: "file", baseUrl: "file", model: "file", apiKey: "default", region: "default", allowRemote: "default", features: "default", timeoutMs: "default" },
    file: "/home/me/.config/run-hound/ai.json",
    ...extra,
  };
}

const OLLAMA_MODELS: AiModelList = {
  models: [
    { id: "ornith-1.5:9b", details: "9.0B Q4_K_M", suitable: true },
    { id: "nomic-embed-text", details: "137M F16", suitable: false },
    { id: "qwen3:4b", details: null, suitable: null },
  ],
  error: null,
};
const LMSTUDIO_DOWN = "Nothing is answering at http://127.0.0.1:1234 — is LM Studio running?";

interface Stub {
  ai: AiStatus;
  models: (provider: string, baseUrl: string) => AiModelList;
  put: (body: Record<string, unknown>) => { status: number; body: unknown };
  test: () => unknown;
  plan: (body: Record<string, unknown>) => unknown;
  planDelayMs: number;
  report?: Report;
}

interface Opened {
  page: Page;
  errors: string[];
  calls: { method: string; path: string; query: URLSearchParams; body: Record<string, unknown> | null; headers: Record<string, string> }[];
}

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
});

async function open(hash: string, stub: Partial<Stub>, width = 1280): Promise<Opened> {
  const s: Stub = {
    ai: status(),
    models: () => OLLAMA_MODELS,
    put: (body) => ({ status: 200, body: { ...s.ai, ...body, hasKey: s.ai.hasKey } }),
    test: () => ({ ok: true, model: "ornith-1.5:9b", ms: 1234 }),
    plan: () => ({ planId: "p1", plan: aiPlan(), checks: {}, warnings: [] }),
    planDelayMs: 0,
    ...stub,
  };
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const errors: string[] = [];
  const calls: Opened["calls"] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.route(`${ORIGIN}/**`, async (route: Route, req: Request) => {
    const url = new URL(req.url());
    const json = (body: unknown, code = 200) => route.fulfill({ status: code, contentType: "application/json", body: JSON.stringify(body) });
    if (!url.pathname.startsWith("/api/")) return route.fulfill({ status: 200, contentType: "text/html", body: HTML });
    const body = req.postData() ? (JSON.parse(req.postData()!) as Record<string, unknown>) : null;
    calls.push({ method: req.method(), path: url.pathname, query: url.searchParams, body, headers: req.headers() });
    if (url.pathname === "/api/ai" && req.method() === "GET") return json(s.ai);
    if (url.pathname === "/api/ai" && req.method() === "PUT") {
      const r = s.put(body ?? {});
      if (r.status === 200) s.ai = r.body as AiStatus;
      return json(r.body, r.status);
    }
    if (url.pathname === "/api/ai/models") return json(s.models(url.searchParams.get("provider") ?? "", url.searchParams.get("baseUrl") ?? ""));
    if (url.pathname === "/api/ai/test") return json(s.test());
    if (url.pathname === "/api/settings") return json({ version: "0.3.0", runsDir: "/runs", allowedHosts: [], serverHosts: [], ai: s.ai });
    if (url.pathname === "/api/plan") {
      if (s.planDelayMs) await new Promise((r) => setTimeout(r, s.planDelayMs));
      return json(s.plan(body ?? {}));
    }
    if (url.pathname === "/api/runs") return json({ runs: [] });
    if (url.pathname === "/api/runs/r1") return json({ status: "done", report: s.report });
    return json({ error: "not stubbed" }, 404);
  });
  await page.goto(`${ORIGIN}/${hash}`);
  return { page, errors, calls };
}

const optionTexts = (page: Page) => page.locator("#ai-model option").allTextContents();
const modelCalls = (o: Opened) => o.calls.filter((c) => c.path === "/api/ai/models");

describe("no stray 'null' or 'undefined' text", () => {
  // Optional pieces (the problem hint, the save notice, AI lines) are null when there is nothing to show; they must
  // leave no trace. The DOM's own replaceChildren prints null as the text "null", which once reached the site's
  // screenshots.
  const stray = /\b(null|undefined)\b/i;

  it("on the Settings page with a working model and after Test connection", async () => {
    const o = await open("#/settings", { ai: status({ enabled: true, model: "ornith-1.5:9b", problem: null }) });
    const { page } = o;
    await expect.poll(() => optionTexts(page)).toContain("ornith-1.5:9b — 9.0B Q4_K_M");
    await page.getByRole("button", { name: "Test connection" }).click();
    await expect.poll(() => page.locator("#ai-test-result").textContent()).toMatch(/Connected/);
    expect(await page.locator("#view").innerText()).not.toMatch(stray);
    await page.getByRole("button", { name: "Save" }).click();
    await expect.poll(() => page.locator("#ai-saved").textContent()).toMatch(/Saved/);
    expect(await page.locator("#view").innerText()).not.toMatch(stray);
    expect(o.errors).toEqual([]);
    await page.close();
  });

  it("on New Run with an AI-reviewed plan", async () => {
    const o = await open("#/new", { ai: status({ enabled: true, model: "ornith-1.5:9b", problem: null }) });
    const { page } = o;
    await page.getByLabel("Page URL").fill("http://127.0.0.1:5173/signup");
    await page.getByRole("button", { name: "Plan checks" }).click();
    await page.locator("#plan-section").waitFor({ state: "visible" });
    await expect.poll(() => page.locator("#view").innerText()).toMatch(/Suggested by AI/i);
    expect(await page.locator("#view").innerText()).not.toMatch(stray);
    expect(o.errors).toEqual([]);
    await page.close();
  });
});

describe("Settings → AI card: the model dropdown", () => {
  it("lists the server's models as 'id — details', disables unsuitable ones and keeps the saved one selected", async () => {
    const o = await open("#/settings", {});
    const { page } = o;
    const select = page.getByLabel("Model", { exact: true });
    await expect.poll(() => optionTexts(page)).toEqual([
      "ornith-1.5:9b — 9.0B Q4_K_M",
      "nomic-embed-text — 137M F16 (not usable: can't generate text)",
      "qwen3:4b",
      "Other…",
    ]);
    expect(await select.inputValue()).toBe("ornith-1.5:9b");
    expect(await page.locator('#ai-model option[value="nomic-embed-text"]').isDisabled()).toBe(true);
    expect(modelCalls(o)[0]!.query.get("provider")).toBe("ollama");
    expect(modelCalls(o)[0]!.query.get("baseUrl")).toBe(OLLAMA_URL);
    expect(await page.locator("#ai-model-other").isVisible()).toBe(false);
    expect(o.errors).toEqual([]);
    await page.close();
  });

  it("keeps a saved model the server doesn't list, marked '(not found on server)'", async () => {
    const o = await open("#/settings", { ai: status({ model: "gone:1b" }) });
    await expect.poll(() => optionTexts(o.page)).toContain("gone:1b (not found on server)");
    expect((await optionTexts(o.page))[0]).toBe("gone:1b (not found on server)");
    expect(await o.page.locator("#ai-model").inputValue()).toBe("gone:1b");
    await o.page.close();
  });

  it("reloads the list (debounced) when the provider or base URL changes, shows the list's error, and Refresh asks again", async () => {
    const o = await open("#/settings", { models: (_p, url) => (url === OLLAMA_URL ? OLLAMA_MODELS : { models: [], error: LMSTUDIO_DOWN }) });
    const { page } = o;
    await expect.poll(() => optionTexts(page)).toHaveLength(4);
    await page.getByLabel("Provider").selectOption({ label: "LM Studio" });
    expect(await page.getByLabel("Base URL").inputValue()).toBe(LMSTUDIO_URL);
    await expect.poll(() => page.locator("#ai-models-msg").textContent()).toBe(LMSTUDIO_DOWN);
    const last = modelCalls(o).at(-1)!;
    expect(last.query.get("provider")).toBe("openai-compatible");
    expect(last.query.get("baseUrl")).toBe(LMSTUDIO_URL);
    // The saved model stays selected (not marked: the list failed), and "Other…" is always there.
    expect(await optionTexts(page)).toEqual(["ornith-1.5:9b", "Other…"]);

    // Typing a URL asks once, after the typing stops.
    const before = modelCalls(o).length;
    const base = page.getByLabel("Base URL");
    await base.fill("");
    await base.pressSequentially("http://127.0.0.1:8080/v1", { delay: 20 });
    await expect.poll(() => modelCalls(o).length).toBe(before + 1);
    await page.waitForTimeout(600);
    expect(modelCalls(o).length).toBe(before + 1);
    expect(modelCalls(o).at(-1)!.query.get("baseUrl")).toBe("http://127.0.0.1:8080/v1");

    await page.getByRole("button", { name: "Refresh" }).click();
    await expect.poll(() => modelCalls(o).length).toBe(before + 2);
    expect(o.errors).toEqual([]);
    await page.close();
  });

  it("'Other…' reveals a text input whose value is saved as the model", async () => {
    const o = await open("#/settings", {});
    const { page } = o;
    await expect.poll(() => optionTexts(page)).toHaveLength(4);
    await page.locator("#ai-model").selectOption({ label: "Other…" });
    const other = page.getByLabel("Other model id");
    expect(await other.isVisible()).toBe(true);
    await other.fill("my-finetune:7b");
    await page.getByRole("button", { name: "Save" }).click();
    await expect.poll(() => page.locator("#ai-saved").textContent()).toMatch(/^Saved at/);
    const put = o.calls.find((c) => c.method === "PUT")!;
    expect(put.body).toMatchObject({ enabled: true, provider: "ollama", baseUrl: OLLAMA_URL, model: "my-finetune:7b", features: { review: true, suggest: true, explain: true } });
    expect(put.body).not.toHaveProperty("apiKey");
    await page.close();
  });

  it("switches to a model id text input and a region field for Amazon Bedrock, without listing models", async () => {
    const o = await open("#/settings", {});
    const { page } = o;
    await expect.poll(() => optionTexts(page)).toHaveLength(4);
    const n = modelCalls(o).length;
    await page.getByLabel("Provider").selectOption({ label: "Amazon Bedrock" });
    expect(await page.locator("#ai-model").isVisible()).toBe(false);
    const model = page.getByLabel("Model", { exact: true });
    expect(await model.getAttribute("id")).toBe("ai-model-other");
    expect(await model.getAttribute("placeholder")).toMatch(/^anthropic\./);
    expect(await page.getByLabel("Region").isVisible()).toBe(true);
    await model.fill("anthropic.claude-x-v1:0");
    await page.getByLabel("Region").fill("eu-west-1");
    await page.waitForTimeout(600);
    expect(modelCalls(o).length).toBe(n);
    await page.getByRole("button", { name: "Save" }).click();
    await expect.poll(() => o.calls.some((c) => c.method === "PUT")).toBe(true);
    expect(o.calls.find((c) => c.method === "PUT")!.body).toMatchObject({ provider: "bedrock", baseUrl: "", model: "anthropic.claude-x-v1:0", region: "eu-west-1" });
    await page.close();
  });
});

describe("Settings → AI card: AWS profile for Bedrock", () => {
  const bedrock = (extra: Partial<AiStatus> = {}) =>
    status({ provider: "bedrock", baseUrl: "", model: "anthropic.claude-x-v1:0", region: "eu-west-1", remote: true, host: "bedrock-runtime.eu-west-1.amazonaws.com", allowRemote: true, ...extra });

  it("shows an AWS profile field only for Bedrock, with the ~/.aws hint, prefilled and saved (empty → null)", async () => {
    const o = await open("#/settings", { ai: bedrock({ awsProfile: "work-sso" }) });
    const { page } = o;
    const profile = page.getByLabel("AWS profile");
    await profile.waitFor();
    expect(await profile.inputValue()).toBe("work-sso");
    expect(await profile.isDisabled()).toBe(false);
    expect(await page.locator("#ai-card").innerText()).toContain(
      "Uses ~/.aws on the machine running Run Hound: static keys, credential_process or SSO (run `aws sso login` first)",
    );
    await profile.fill("dev");
    await page.getByRole("button", { name: "Save" }).click();
    await expect.poll(() => o.calls.some((c) => c.method === "PUT")).toBe(true);
    expect(o.calls.find((c) => c.method === "PUT")!.body).toMatchObject({ provider: "bedrock", awsProfile: "dev" });
    await expect.poll(() => page.locator("#ai-saved").textContent()).toMatch(/^Saved at/);
    await page.getByLabel("AWS profile").fill("");
    await page.getByRole("button", { name: "Save" }).click();
    await expect.poll(() => o.calls.filter((c) => c.method === "PUT").length).toBe(2);
    expect(o.calls.filter((c) => c.method === "PUT")[1]!.body).toMatchObject({ awsProfile: null });
    // Another provider hides the field and never sends it.
    await page.getByLabel("Provider").selectOption({ index: 0 });
    expect(await page.locator("#ai-aws-profile").isVisible()).toBe(false);
    await page.close();
  });

  it("locks the field when the profile comes from the environment and never sends it", async () => {
    const o = await open("#/settings", { ai: bedrock({ awsProfile: "env-profile", sources: { ...status().sources, awsProfile: "env" } }) });
    const { page } = o;
    const profile = page.getByLabel("AWS profile");
    await profile.waitFor();
    expect(await profile.isDisabled()).toBe(true);
    expect(await profile.inputValue()).toBe("env-profile");
    expect(await page.locator(".ai-aws-profile-field").innerText()).toContain("Set by environment");
    await page.getByRole("button", { name: "Save" }).click();
    await expect.poll(() => o.calls.some((c) => c.method === "PUT")).toBe(true);
    expect(o.calls.find((c) => c.method === "PUT")!.body).not.toHaveProperty("awsProfile");
    await page.close();
  });

  it("does not send awsProfile for a provider other than Bedrock", async () => {
    const o = await open("#/settings", {});
    await o.page.locator("#ai-enabled").waitFor();
    expect(await o.page.locator("#ai-aws-profile").isVisible()).toBe(false);
    await o.page.getByRole("button", { name: "Save" }).click();
    await expect.poll(() => o.calls.some((c) => c.method === "PUT")).toBe(true);
    expect(o.calls.find((c) => c.method === "PUT")!.body).not.toHaveProperty("awsProfile");
    await o.page.close();
  });
});

describe("Settings → AI card: key, locks, consent, save and test", () => {
  const remote = () =>
    status({
      provider: "openai-compatible",
      baseUrl: "https://api.example.com/v1",
      model: "gpt-x",
      remote: true,
      host: "api.example.com",
      hasKey: true,
      problem: "Sending to api.example.com needs your consent",
      sources: { ...status().sources, model: "env", apiKey: "file" },
    });

  it("never prefills the key, locks env fields, names the host in the consent box and shows the problem", async () => {
    const o = await open("#/settings", { ai: remote(), models: () => ({ models: [], error: null }) });
    const { page } = o;
    const key = page.getByLabel("API key");
    await key.waitFor();
    expect(await key.getAttribute("type")).toBe("password");
    expect(await key.inputValue()).toBe("");
    expect(await key.getAttribute("placeholder")).toBe("Saved");
    expect(await page.locator("#ai-model").isDisabled()).toBe(true);
    expect(await page.locator("#ai-model-field, .ai-model-field").innerText()).toContain("Set by environment");
    expect(await page.getByLabel("Base URL").isDisabled()).toBe(false);
    expect(await page.locator("#ai-problem").textContent()).toBe("Sending to api.example.com needs your consent");
    const consent = page.getByLabel(/Send redacted page structure/);
    expect(await consent.isChecked()).toBe(false);
    expect(await page.locator('label[for="ai-allow-remote"]').innerText()).toContain(
      "Send redacted page structure (labels, field types, button names — never values, cookies or screenshots) to api.example.com",
    );
    expect(await page.locator("#ai-card").innerText()).not.toContain("sk-");
    expect(o.errors).toEqual([]);
    await page.close();
  });

  it("shows no consent box for a local endpoint", async () => {
    const o = await open("#/settings", {});
    await o.page.locator("#ai-enabled").waitFor();
    expect(await o.page.locator("#ai-allow-remote").count()).toBe(0);
    await o.page.close();
  });

  it("saves consent and key removal (never the locked model), and shows a refused save's error", async () => {
    let refuse = true;
    const o = await open("#/settings", {
      ai: remote(),
      models: () => ({ models: [], error: null }),
      put: (body) => (refuse ? { status: 400, body: { error: "RUNHOUND_AI_MODEL is set in the environment" } } : { status: 200, body: { ...remote(), allowRemote: body.allowRemote === true, hasKey: false, problem: null } }),
    });
    const { page } = o;
    await page.getByLabel(/Send redacted page structure/).check();
    await page.getByRole("button", { name: "Remove key" }).click();
    expect(await page.locator(".key-note").textContent()).toMatch(/removed when you save/);
    await page.getByRole("button", { name: "Save" }).click();
    await expect.poll(() => page.locator("#ai-error").textContent()).toBe("RUNHOUND_AI_MODEL is set in the environment");
    const put = o.calls.find((c) => c.method === "PUT")!;
    expect(put.body).toMatchObject({ allowRemote: true, apiKey: null, provider: "openai-compatible" });
    expect(put.body).not.toHaveProperty("model");

    refuse = false;
    await page.getByRole("button", { name: "Save" }).click();
    await expect.poll(() => page.locator("#ai-saved").textContent()).toMatch(/^Saved at/);
    expect(await page.locator("#ai-problem").count()).toBe(0);
    expect(await page.getByLabel("API key").getAttribute("placeholder")).toBe("Not set");
    expect(await page.locator("#ai-key-remove").count()).toBe(0);
    await page.close();
  });

  it("Test connection shows the model and time, or the error", async () => {
    let ok = true;
    const o = await open("#/settings", { test: () => (ok ? { ok: true, model: "ornith-1.5:9b", ms: 1234 } : { ok: false, error: "Nothing is answering at http://127.0.0.1:11434 — is Ollama running?" }) });
    const { page } = o;
    await page.getByRole("button", { name: "Test connection" }).click();
    await expect.poll(() => page.locator("#ai-test-result").textContent()).toBe("Connected: ornith-1.5:9b answered in 1.2 s.");
    ok = false;
    await page.getByRole("button", { name: "Test connection" }).click();
    await expect.poll(() => page.locator("#ai-test-result").textContent()).toBe("Nothing is answering at http://127.0.0.1:11434 — is Ollama running?");
    expect(await page.locator("#ai-test-result").getAttribute("class")).toBe("error");
    await page.close();
  });

  it("sends X-Run-Hound: 1 on every /api/ai request (GET, PUT and POST)", async () => {
    const o = await open("#/settings", {});
    const { page } = o;
    await expect.poll(() => modelCalls(o).length).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Save" }).click();
    await expect.poll(() => page.locator("#ai-saved").textContent()).toMatch(/^Saved at/);
    await page.getByRole("button", { name: "Test connection" }).click();
    await expect.poll(() => o.calls.some((c) => c.path === "/api/ai/test")).toBe(true);
    const aiCalls = o.calls.filter((c) => c.path.startsWith("/api/ai"));
    expect(new Set(aiCalls.map((c) => c.method + " " + c.path))).toEqual(new Set(["GET /api/ai", "GET /api/ai/models", "PUT /api/ai", "POST /api/ai/test"]));
    for (const c of aiCalls) expect(c.headers["x-run-hound"], c.method + " " + c.path).toBe("1");
    await page.close();
  });

  it("re-draws the consent box when the endpoint changes: new host named, unticked unless it is the consented host", async () => {
    const consented = { ...remote(), allowRemote: true, problem: null };
    const o = await open("#/settings", { ai: consented, models: () => ({ models: [], error: null }) });
    const { page } = o;
    const label = () => page.locator('label[for="ai-allow-remote"]').innerText();
    const box = () => page.locator("#ai-allow-remote");
    await box().waitFor();
    expect(await box().isChecked()).toBe(true);
    expect(await label()).toContain("to api.example.com");

    await page.getByLabel("Base URL").fill("https://api.other.example/v1");
    await expect.poll(label).toContain("to api.other.example");
    expect(await label()).not.toContain("api.example.com");
    expect(await box().isChecked()).toBe(false);

    await page.getByLabel("Base URL").fill("https://api.example.com/v2");
    await expect.poll(label).toContain("to api.example.com");
    expect(await box().isChecked()).toBe(true);

    // A local endpoint needs no consent box at all.
    await page.getByLabel("Base URL").fill("http://127.0.0.1:1234/v1");
    await expect.poll(() => box().count()).toBe(0);
    await page.close();
  });

  it("offers the consent box when a local setup is pointed at a remote host, and follows the Bedrock region", async () => {
    const o = await open("#/settings", {});
    const { page } = o;
    await page.locator("#ai-enabled").waitFor();
    expect(await page.locator("#ai-allow-remote").count()).toBe(0);
    await page.locator("#ai-provider").selectOption("openai-compatible");
    await page.getByLabel("Base URL").fill("https://api.remote.example/v1");
    const label = () => page.locator('label[for="ai-allow-remote"]').innerText();
    await expect.poll(label).toContain("to api.remote.example");
    expect(await page.locator("#ai-allow-remote").isChecked()).toBe(false);

    await page.locator("#ai-provider").selectOption("bedrock");
    // The typed URL stays as Bedrock's endpoint override until cleared.
    await expect.poll(label).toContain("to api.remote.example");
    await page.getByLabel("Endpoint override (optional)").fill("");
    await expect.poll(() => page.locator("#ai-allow-remote").count()).toBe(0);
    await page.getByLabel("Region", { exact: true }).fill("eu-west-1");
    await expect.poll(label).toContain("to bedrock-runtime.eu-west-1.amazonaws.com");
    await page.locator("#ai-allow-remote").check();
    await page.getByLabel("Region", { exact: true }).fill("us-east-1");
    await expect.poll(label).toContain("to bedrock-runtime.us-east-1.amazonaws.com");
    expect(await page.locator("#ai-allow-remote").isChecked()).toBe(false);
    await page.close();
  });

  it("shows the server's notice after Save (the saved key was removed because the endpoint changed)", async () => {
    const notice = "The saved API key was removed because the endpoint changed.";
    const o = await open("#/settings", {
      ai: remote(),
      models: () => ({ models: [], error: null }),
      put: () => ({ status: 200, body: { ...remote(), hasKey: false, notice } }),
    });
    const { page } = o;
    await page.getByLabel("Base URL").fill("https://api.other.example/v1");
    await page.getByRole("button", { name: "Save" }).click();
    await expect.poll(() => page.locator("#ai-notice").textContent()).toBe(notice);
    expect(await page.getByLabel("API key").getAttribute("placeholder")).toBe("Not set");
    await page.close();
  });

  it("fits a 360 px screen", async () => {
    const o = await open("#/settings", { ai: remote(), models: () => OLLAMA_MODELS }, 360);
    await o.page.locator("#ai-model option").first().waitFor({ state: "attached" });
    expect(await o.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await o.page.close();
  });
});

function aiPlan(): Plan {
  const form = {
    url: "http://127.0.0.1:5173/signup",
    index: 0,
    selector: "#signup",
    name: "Sign up",
    fields: [
      { key: "email", accessibleName: "Email address", label: "Email address", placeholder: null, type: "email", role: "textbox", required: true, selector: "#email" },
      { key: "plan", accessibleName: "Plan", label: "Plan", placeholder: null, type: "select", role: "combobox", required: false, selector: "#plan", options: [{ label: "Pro", selector: "#plan option" }] },
    ],
    controls: [{ accessibleName: "Create account", text: "Create account", role: "button", tag: "button", selector: "#go", isSubmit: true }],
  };
  return {
    target: "http://127.0.0.1:5173/signup",
    form,
    page: { url: form.url, title: "Sign up", forms: [form], controls: [], links: 0 },
    scenarios: [
      { id: "required:s", checkId: "client-only-validation", title: "Required fields are enforced", description: "Submits the form empty.", kind: "danger", priority: "high", destructive: false, defaultSelected: true, scope: "form", formIndex: 0, ai: { rationale: "Sign-up is the page's main path.", recommended: true } },
      { id: "dead:s", checkId: "dead-control", title: "Every button does something", description: "Clicks each control.", kind: "golden", priority: "low", destructive: false, defaultSelected: false, scope: "form", formIndex: 0, ai: { rationale: "Only one button here.", recommended: false } },
      {
        id: "ai-flow:1",
        checkId: "ai-flow",
        title: "Sign up with the Pro plan",
        description: "A flow suggested by the model.",
        kind: "golden",
        priority: "medium",
        destructive: false,
        defaultSelected: false,
        scope: "form",
        formIndex: 0,
        ai: { rationale: "Plan choice changes the price.", recommended: false, suggested: true },
        flow: [
          { action: "fill", field: "email", value: "hound@example.test" },
          { action: "choose", field: "plan", option: "Pro" },
          { action: "click", control: 0 },
          { action: "press", key: "Enter" },
          { action: "expect", expect: "text-visible", text: "Welcome" },
        ],
      },
    ],
    groups: [{ id: "features", label: "Features", scenarioIds: ["required:s", "dead:s", "ai-flow:1"] }],
    ai: { provider: "ollama", model: "ornith-1.5:9b", remote: false, warnings: ["The model skipped 1 scenario; it keeps its built-in setting."], reviewedAt: "2026-09-25T10:00:00Z", reviewed: true, suggested: 1 },
  } as unknown as Plan;
}

describe("New Run with AI", () => {
  it("sends 'Review with AI', says the model can take a while, and shows chips, rationales, suggested steps and warnings", async () => {
    const o = await open("#/new", { planDelayMs: 800, plan: () => ({ planId: "p1", plan: aiPlan(), checks: {}, warnings: ["The page took 4 s to load."] }) });
    const { page } = o;
    const review = page.getByLabel("Review with AI");
    await review.waitFor();
    expect(await review.isChecked()).toBe(true);
    await page.getByLabel("Page URL").fill("http://127.0.0.1:5173/signup");
    await page.getByRole("button", { name: "Plan checks" }).click();
    await expect.poll(() => page.locator("#plan-progress").innerText()).toMatch(/ornith-1\.5:9b.*can take a while/);
    await page.locator("#plan-section").waitFor({ state: "visible" });
    expect(o.calls.find((c) => c.path === "/api/plan")!.body).toEqual({ url: "http://127.0.0.1:5173/signup", ai: true });
    expect(await page.locator("#plan-progress").isVisible()).toBe(false);

    expect(await page.locator("#plan-ai").innerText()).toContain("Reviewed by ollama/ornith-1.5:9b");
    const warnings = await page.locator("#plan-warnings p").allTextContents();
    expect(warnings).toEqual(["The page took 4 s to load.", "The model skipped 1 scenario; it keeps its built-in setting."]);

    const row = (id: string) => page.locator(`.scenario-row:has(input[value="${id}"])`);
    const tags = (id: string) => row(id).locator(".tag").allTextContents();
    expect(await tags("required:s")).toEqual(expect.arrayContaining(["AI", "Recommended"]));
    expect(await row("required:s").innerText()).toContain("Sign-up is the page's main path.");
    expect(await tags("dead:s")).toContain("AI");
    expect(await tags("dead:s")).not.toContain("Recommended");
    expect(await tags("ai-flow:1")).toContain("Suggested by AI");
    expect(await tags("ai-flow:1")).not.toContain("AI");
    expect(await row("ai-flow:1").locator("input").isChecked()).toBe(false);
    expect(await row("ai-flow:1").getByRole("list", { name: "Steps of Sign up with the Pro plan" }).getByRole("listitem").allTextContents()).toEqual([
      "Type “hound@example.test” into Email address",
      "Choose “Pro” in Plan",
      "Click Create account",
      "Press Enter",
      "Check: “Welcome” appears on the page",
    ]);
    expect(o.errors).toEqual([]);
    await page.close();
  });

  it("sends ai: false when 'Review with AI' is unticked", async () => {
    const o = await open("#/new", {});
    await o.page.getByLabel("Review with AI").uncheck();
    await o.page.getByLabel("Page URL").fill("http://127.0.0.1:5173/signup");
    await o.page.getByRole("button", { name: "Plan checks" }).click();
    await o.page.locator("#plan-section").waitFor({ state: "visible" });
    expect(o.calls.find((c) => c.path === "/api/plan")!.body).toEqual({ url: "http://127.0.0.1:5173/signup", ai: false });
    await o.page.close();
  });

  it("offers no AI toggle when AI is off or has a problem, and sends no ai flag", async () => {
    for (const ai of [status({ enabled: false }), status({ problem: "Choose a model", model: "" })]) {
      const plain = aiPlan();
      delete plain.ai;
      const o = await open("#/new", { ai, plan: () => ({ planId: "p1", plan: plain, checks: {}, warnings: [] }) });
      await o.page.getByLabel("Page URL").fill("http://127.0.0.1:5173/signup");
      await o.page.getByRole("button", { name: "Plan checks" }).click();
      await o.page.locator("#plan-section").waitFor({ state: "visible" });
      expect(await o.page.locator("#ai-review").count()).toBe(0);
      expect(o.calls.find((c) => c.path === "/api/plan")!.body).toEqual({ url: "http://127.0.0.1:5173/signup" });
      expect(await o.page.locator("#plan-ai").isVisible()).toBe(false);
      await o.page.close();
    }
  });
});

function aiReport(): Report {
  const plan = aiPlan();
  const finding: Finding = {
    checkId: "client-only-validation",
    id: "required-fields#1",
    title: "Email is not required",
    severity: "high",
    category: "broken-feature",
    confidence: "confirmed",
    meaning: "The form accepts an empty email.",
    impact: "Accounts without a way to reach them.",
    fix: "Make the email field required on the server.",
    evidence: [],
    ai: { summary: "People can sign up without an email, so you can't reach them.", askYourAi: "In the sign-up handler, reject requests without an email.", model: "ollama/ornith-1.5:9b" },
  };
  return {
    runId: "r1",
    target: plan.target,
    startedAt: "2026-09-25T10:00:00Z",
    finishedAt: "2026-09-25T10:01:00Z",
    durationMs: 60_000,
    groups: [{ id: "features", label: "Features", scenarioIds: ["required:s"], passed: 0, failed: 1, errored: 0, skipped: 0, findings: 1, durationMs: 1000 }],
    runHoundVersion: "0.3.0",
    plan,
    approved: ["required:s"],
    results: [{ checkId: "client-only-validation", scenarioId: "required:s", status: "fail", findings: [finding], durationMs: 1000, steps: [] }],
    findings: [finding],
    summary: { critical: 0, high: 1, medium: 0, low: 0, passed: 0, failed: 1, errored: 0, skipped: 0 },
    notVisible: [],
    ai: { provider: "ollama", model: "ornith-1.5:9b", remote: false, warnings: ["The model timed out on 1 finding; it has no explanation."], explained: 1 },
  };
}

describe("Report with AI explanations", () => {
  it("shows an advisory AI explanation panel after 'What to ask your AI', with a copyable prompt, and Report.ai warnings", async () => {
    const o = await open("#/runs/r1", { report: aiReport() });
    const { page } = o;
    const panel = page.getByRole("region", { name: /AI explanation/ });
    await panel.waitFor({ timeout: 15_000 });
    const headings = await page.locator("#detail section h3").allTextContents();
    const ask = headings.findIndex((t) => t.includes("What to ask your AI"));
    const ai = headings.findIndex((t) => t.includes("AI explanation"));
    expect(ask).toBeGreaterThanOrEqual(0);
    expect(ai).toBe(ask + 1);
    expect(await panel.locator("h3 .tag").textContent()).toBe("Advisory");
    const text = await panel.innerText();
    expect(text).toContain("People can sign up without an email, so you can't reach them.");
    expect(text).toContain("In the sign-up handler, reject requests without an email.");
    expect(text).toContain("ollama/ornith-1.5:9b");
    expect(await panel.getByRole("button", { name: "Copy" }).count()).toBe(1);
    expect(await page.locator("#report-ai-warnings").innerText()).toContain("The model timed out on 1 finding");
    expect(o.errors).toEqual([]);
    await page.close();
  });

  it("shows no AI panel for a finding without an explanation", async () => {
    const report = aiReport();
    delete report.findings[0]!.ai;
    delete report.ai;
    const o = await open("#/runs/r1", { report });
    await o.page.locator("#detail h3", { hasText: "What to ask your AI" }).waitFor({ timeout: 15_000 });
    expect(await o.page.locator(".ai-panel").count()).toBe(0);
    expect(await o.page.locator("#report-ai-warnings").count()).toBe(0);
    await o.page.close();
  });
});
