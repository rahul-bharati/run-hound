/**
 * The first-launch setup in the web UI (docs/onboarding-spec.md "Screens", O1), driven in real Chromium. The desktop's
 * preload marks <html data-shell="desktop"> before any script runs; an init script does the same here. Every /api/* call
 * is answered by a stub, so these tests pin the client's behaviour:
 * - Start-up: the bare address opens #/welcome when GET /api/onboarding says show; a deep link, a browser (not the
 *   desktop) and a failed check open the app as before.
 * - Five screens on #/welcome, each with "Step n of 5", the heading focused, Back (not on the first), one primary
 *   button and a Skip that leads to the skipped Ready screen; they pass axe and fit 320 px.
 * - Key: the guide and its link, a password field with Show / Hide, the consent box naming the host, Test connection
 *   (save, list, pick the recommended model, test), Next only after a passing test, Save without testing.
 * - Models: the recommended pair, "Use the main model for everything", one select for a local model, text fields when
 *   the models can't be listed; Finish saves both and enables AI.
 * - Ready: the outcome is posted; Settings gains the Helper model, "Run setup again" and "Delete all keys and data".
 */
import { AxeBuilder } from "@axe-core/playwright";
import { chromium, type Browser, type Page, type Request, type Route } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AccountStatus, AccountsStatus } from "../../../src/interfaces/accounts.js";
import type { AiModelList, AiStatus } from "../../../src/ai/types.js";
import { AI_KEY_URLS } from "../../../src/constants/ai-constants.js";
import { KEY_GUIDES } from "../../../src/constants/onboarding-constants.js";
import { renderUi } from "../../../src/server/ui/index.js";

const ORIGIN = "http://rh.test";
const HTML = renderUi({ version: "0.7.0", canShowBrowser: false });

const unsetSlot = (id: "a" | "b"): AccountStatus => ({ id, label: id === "a" ? "Account A" : "Account B", loginUrl: "", username: "", hasPassword: false, ready: false, sources: { label: "default", loginUrl: "default", username: "default", password: "default" }, problem: null });
const NO_ACCOUNTS: AccountsStatus = { isolated: true, isolatedSource: "default", accounts: { a: unsetSlot("a"), b: unsetSlot("b") }, file: "C:/Users/me/AppData/Roaming/run-hound/accounts.json" };

const AI_OFF: AiStatus = {
  enabled: false,
  provider: null,
  baseUrl: "",
  model: "",
  helperModel: "",
  region: null,
  allowRemote: false,
  features: { review: true, suggest: true, explain: true },
  timeoutMs: 120_000,
  hasKey: false,
  remote: false,
  host: "",
  problem: "AI is off",
  sources: { enabled: "default", provider: "default", baseUrl: "default", model: "default", helperModel: "default", apiKey: "default", region: "default", allowRemote: "default", features: "default", timeoutMs: "default" },
  file: "C:/Users/me/AppData/Roaming/run-hound/ai.json",
  savedKeys: [],
  secretProtection: "os-keychain",
};

const CLAUDE_MODELS: AiModelList = {
  models: [
    { id: "claude-haiku-5-5", details: "Claude Haiku 5.5", suitable: true },
    { id: "claude-opus-5-5", details: "Claude Opus 5.5", suitable: true },
    { id: "claude-sonnet-5-5", details: "Claude Sonnet 5.5", suitable: true },
  ],
  recommended: { main: "claude-opus-5-5", helper: "claude-sonnet-5-5" },
  error: null,
};
const OLLAMA_MODELS: AiModelList = {
  models: [
    { id: "qwen3:4b", details: null, suitable: null },
    { id: "nomic-embed-text", details: null, suitable: false },
  ],
  recommended: { main: "qwen3:4b", helper: "qwen3:4b" },
  error: null,
};

interface Stub {
  ai: AiStatus;
  /** What GET /api/onboarding answers: show, or "fail" for an error. */
  onboarding: boolean | "fail";
  /** The list GET /api/ai/models answers, by the saved provider. */
  models: (provider: string | null) => AiModelList;
  test: (model: string) => unknown;
  /** Makes the next PUT /api/ai answer with this error (once). */
  putError?: string;
  deleteError?: string;
}

interface Opened {
  page: Page;
  errors: string[];
  calls: { method: string; path: string; query: URLSearchParams; body: Record<string, unknown> | null }[];
  stub: Stub;
}

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
});

async function open(hash: string, over: Partial<Stub> = {}, options: { desktop?: boolean; width?: number; platform?: string } = {}): Promise<Opened> {
  const stub: Stub = {
    ai: AI_OFF,
    onboarding: true,
    models: (provider) => (provider === "ollama" || provider === "openai-compatible" ? OLLAMA_MODELS : provider === "bedrock" ? { models: [], error: null } : CLAUDE_MODELS),
    test: (model) => ({ ok: true, model, ms: 812 }),
    ...over,
  };
  // A page of its own context, which axe needs.
  const context = await browser.newContext({ viewport: { width: options.width ?? 1280, height: 900 } });
  const page = await context.newPage();
  page.on("close", () => void context.close().catch(() => undefined));
  const errors: string[] = [];
  const calls: Opened["calls"] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    // A failed onboarding check, a refused delete and the like answer with an error status on purpose.
    if (m.type() === "error" && !/status of (4|5)\d\d/.test(m.text())) errors.push(m.text());
  });
  if (options.desktop !== false) {
    const platform = options.platform ?? "win32";
    await page.addInitScript((os) => {
      const mark = () => {
        if (!document.documentElement) return false;
        document.documentElement.dataset.shell = "desktop";
        document.documentElement.dataset.platform = os;
        return true;
      };
      if (!mark()) new MutationObserver((_r, observer) => { if (mark()) observer.disconnect(); }).observe(document, { childList: true });
    }, platform);
  }
  await page.route(`${ORIGIN}/**`, async (route: Route, req: Request) => {
    const url = new URL(req.url());
    const json = (body: unknown, code = 200) => route.fulfill({ status: code, contentType: "application/json", body: JSON.stringify(body) });
    if (!url.pathname.startsWith("/api/")) return route.fulfill({ status: 200, contentType: "text/html", body: HTML });
    const body = req.postData() ? (JSON.parse(req.postData()!) as Record<string, unknown>) : null;
    calls.push({ method: req.method(), path: url.pathname, query: url.searchParams, body });
    if (url.pathname === "/api/onboarding" && req.method() === "GET") return stub.onboarding === "fail" ? json({ error: "Not found." }, 404) : json({ show: stub.onboarding });
    if (url.pathname === "/api/onboarding") return json({ version: 1, completedAt: new Date().toISOString(), outcome: body?.outcome });
    if (url.pathname === "/api/data/delete") return stub.deleteError ? json({ error: stub.deleteError }, 500) : json({ files: ["ai.json"], runs: 0 });
    if (url.pathname === "/api/ai" && req.method() === "GET") return json(stub.ai);
    if (url.pathname === "/api/ai" && req.method() === "PUT") {
      if (stub.putError) {
        const error = stub.putError;
        stub.putError = undefined;
        return json({ error }, 400);
      }
      const { apiKey, ...rest } = body ?? {};
      const provider = (rest.provider as AiStatus["provider"] | undefined) ?? stub.ai.provider;
      const savedKeys = [...new Set([...(stub.ai.savedKeys ?? []), ...(typeof apiKey === "string" && provider ? [provider] : [])])];
      stub.ai = { ...stub.ai, ...rest, provider, savedKeys, hasKey: typeof apiKey === "string" ? true : stub.ai.hasKey, problem: null } as AiStatus;
      return json(stub.ai);
    }
    if (url.pathname === "/api/ai/models") return json(stub.models(stub.ai.provider));
    if (url.pathname === "/api/ai/test") return json(stub.test(stub.ai.model));
    if (url.pathname === "/api/settings") return json({ version: "0.7.0", runsDir: "C:/Users/me/run-hound/runs", allowedHosts: [], serverHosts: [], ai: stub.ai });
    if (url.pathname === "/api/accounts") return json(NO_ACCOUNTS);
    if (url.pathname === "/api/runs") return json({ runs: [] });
    return json({ error: "not stubbed" }, 404);
  });
  await page.goto(`${ORIGIN}/${hash}`);
  return { page, errors, calls, stub };
}

const activeId = (page: Page) => page.evaluate(() => document.activeElement?.id ?? "");
const heading = (page: Page) => page.locator("#view h1");
const stepText = (page: Page) => page.locator(".ob-step").textContent();
const hash = (page: Page) => page.evaluate(() => location.hash);
const puts = (o: Opened) => o.calls.filter((c) => c.method === "PUT" && c.path === "/api/ai");
const posted = (o: Opened) => o.calls.filter((c) => c.method === "POST" && c.path === "/api/onboarding").map((c) => c.body);

const CHOICES = { "Anthropic (Claude)": "anthropic", OpenAI: "openai", "Google Gemini": "gemini", "Amazon Bedrock": "bedrock", "A model on this computer": "local" } as const;

async function toKey(o: Opened, provider: keyof typeof CHOICES = "Anthropic (Claude)") {
  await o.page.getByRole("button", { name: "Set up AI" }).click();
  await o.page.locator(`#ob-p-${CHOICES[provider]}`).check();
  await o.page.getByRole("button", { name: "Continue" }).click();
  await o.page.getByText("Step 3 of 5").waitFor();
}

describe("start-up", () => {
  it("opens the setup instead of New run when the engine says it is a first launch", async () => {
    const o = await open("", {});
    await heading(o.page).filter({ hasText: "Welcome to Run Hound" }).waitFor();
    expect(await hash(o.page)).toBe("#/welcome");
    expect(o.calls.filter((c) => c.path === "/api/onboarding")).toHaveLength(1);
    expect(o.errors).toEqual([]);
    await o.page.close();
  });

  it("opens New run when it is not, or when the check fails, and never asks outside the desktop app", async () => {
    for (const over of [{ onboarding: false }, { onboarding: "fail" as const }]) {
      const o = await open("", over);
      await o.page.getByRole("heading", { level: 1, name: "New run" }).waitFor();
      expect(["", "#/new"]).toContain(await hash(o.page));
      await o.page.close();
    }
    const browserOnly = await open("", {}, { desktop: false });
    await browserOnly.page.getByRole("heading", { level: 1, name: "New run" }).waitFor();
    expect(browserOnly.calls.some((c) => c.path === "/api/onboarding")).toBe(false);
    await browserOnly.page.close();
  });

  it("leaves a deep link alone, and can be opened again at #/welcome", async () => {
    const o = await open("#/settings", {});
    await o.page.getByRole("heading", { level: 1, name: "Settings" }).waitFor();
    expect(o.calls.some((c) => c.path === "/api/onboarding")).toBe(false);
    await o.page.evaluate(() => { location.hash = "#/welcome"; });
    await heading(o.page).filter({ hasText: "Welcome to Run Hound" }).waitFor();
    await o.page.close();
  });
});

describe("the five screens", () => {
  it("1. Welcome: three points, Set up AI and Skip for now; the heading has focus", async () => {
    const o = await open("#/welcome");
    const { page } = o;
    await heading(page).filter({ hasText: "Welcome to Run Hound" }).waitFor();
    expect(await stepText(page)).toBe("Step 1 of 5");
    expect(await activeId(page)).toBe("ob-h");
    expect(await page.locator(".ob-points li").count()).toBe(3);
    const text = await page.locator("#view").innerText();
    expect(text).toMatch(/in a real browser/);
    expect(text).toMatch(/plain code and need no AI/);
    expect(text).toMatch(/AI is optional/);
    expect(await page.getByRole("button", { name: "Back" }).count()).toBe(0);
    expect(await page.locator("#view .btn.primary").count()).toBe(1);
    expect(await page.getByRole("button", { name: "Set up AI" }).isVisible()).toBe(true);
    expect(await page.getByRole("button", { name: "Skip for now" }).isVisible()).toBe(true);
    expect(o.errors).toEqual([]);
    await page.close();
  });

  it("2. Provider: five radio cards with nothing preselected, and Continue only once one is chosen", async () => {
    const o = await open("#/welcome");
    const { page } = o;
    await page.getByRole("button", { name: "Set up AI" }).click();
    await heading(page).filter({ hasText: "Choose your AI provider" }).waitFor();
    expect(await stepText(page)).toBe("Step 2 of 5");
    expect(await activeId(page)).toBe("ob-h");
    const radios = page.getByRole("radio");
    expect(await radios.count()).toBe(5);
    const names = await page.locator(".radio-card-title").allTextContents();
    expect(names).toEqual(["Anthropic (Claude)", "OpenAI", "Google Gemini", "Amazon Bedrock", "A model on this computer"]);
    expect(await page.getByRole("radio", { checked: true }).count()).toBe(0);
    expect(await page.locator("#ob-local-note").textContent()).toMatch(/agent needs one of the four cloud providers/);
    expect(await page.getByRole("button", { name: "Continue" }).isDisabled()).toBe(true);
    await page.locator("#ob-p-openai").check();
    expect(await page.getByRole("button", { name: "Continue" }).isEnabled()).toBe(true);
    expect(await page.locator("#view .btn.primary").count()).toBe(1);
    await page.getByRole("button", { name: "Back" }).click();
    await heading(page).filter({ hasText: "Welcome to Run Hound" }).waitFor();
    expect(o.errors).toEqual([]);
    await page.close();
  });

  it("Skip setup leads from every screen to the skipped Ready screen, which posts 'skipped' and opens New run or Settings", async () => {
    for (const [stepsBefore, destination] of [[0, "New run"], [1, "Settings"], [2, "New run"], [3, "Settings"]] as const) {
      const o = await open("#/welcome");
      const { page } = o;
      if (stepsBefore >= 1) await page.getByRole("button", { name: "Set up AI" }).click();
      if (stepsBefore >= 2) {
        await page.getByRole("radio", { name: /Anthropic/ }).check();
        await page.getByRole("button", { name: "Continue" }).click();
      }
      if (stepsBefore >= 3) {
        // The key screen's Save without testing needs a key; Skip does not.
        await page.getByRole("heading", { level: 1, name: /Add your Anthropic key/ }).waitFor();
      }
      await page.locator("#ob-skip").click();
      await heading(page).filter({ hasText: "You're ready to test" }).waitFor();
      expect(await stepText(page)).toBe("Step 5 of 5");
      expect(await activeId(page)).toBe("ob-h");
      expect(await page.locator("#ob-later").textContent()).toBe("You can add a key later in Settings → AI. Run Hound's checks work without AI.");
      expect(await page.locator("#view .btn.primary").count()).toBe(1);
      await page.getByRole("button", { name: destination === "New run" ? "Test my app" : "Open Settings" }).click();
      await page.getByRole("heading", { level: 1, name: destination }).waitFor();
      expect(posted(o)).toEqual([{ outcome: "skipped" }]);
      expect(puts(o)).toHaveLength(0);
      expect(o.errors).toEqual([]);
      await page.close();
    }
  });

  it("the skipped screen from a later step says the key entered was kept with AI off", async () => {
    const o = await open("#/welcome");
    const { page } = o;
    await toKey(o);
    await page.locator("#ob-key").fill("sk-ant-test-key-0123456789abcdef");
    await page.locator("#ob-consent").check();
    await page.getByRole("button", { name: "Save without testing" }).click();
    await heading(page).filter({ hasText: "Choose your models" }).waitFor();
    await page.locator("#ob-skip").click();
    await heading(page).filter({ hasText: "You're ready to test" }).waitFor();
    expect(await page.locator("#ob-kept-off").textContent()).toMatch(/kept with AI off/);
    await page.close();
  });
});

describe("3. Key", () => {
  it("shows the guide with numbered steps, the key page from the shared list and the privacy line naming the host", async () => {
    const o = await open("#/welcome");
    const { page } = o;
    await toKey(o);
    expect(await stepText(page)).toBe("Step 3 of 5");
    expect(await activeId(page)).toBe("ob-h");
    const steps = await page.locator(".ob-steps li").allTextContents();
    expect(steps).toEqual([...KEY_GUIDES.anthropic.steps]);
    expect(steps.length).toBeGreaterThanOrEqual(3);
    expect(steps.length).toBeLessThanOrEqual(4);
    const link = page.locator(".ob-open a");
    expect(await link.getAttribute("href")).toBe(AI_KEY_URLS.anthropic);
    expect(await link.getAttribute("target")).toBe("_blank");
    expect(await link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(await link.innerText()).toContain("Open the Claude Console");
    expect(await page.locator(".ob-private").textContent()).toBe("Keep this key private. Run Hound keeps it encrypted on this computer and sends it only to api.anthropic.com.");
    expect(o.errors).toEqual([]);
    await page.close();
  });

  it("every cloud guide opens the page of the shared list; the key page for each provider is the one Settings links to", async () => {
    for (const [label, provider] of [["OpenAI", "openai"], ["Google Gemini", "gemini"], ["Amazon Bedrock", "bedrock"]] as const) {
      const o = await open("#/welcome");
      await toKey(o, label);
      expect(await o.page.locator(".ob-open a").getAttribute("href")).toBe(AI_KEY_URLS[provider]);
      const steps = await o.page.locator(".ob-steps li").count();
      expect(steps).toBeGreaterThanOrEqual(3);
      expect(steps).toBeLessThanOrEqual(4);
      await o.page.close();
    }
  });

  it("has a password field with Show and Hide that accepts a paste", async () => {
    const o = await open("#/welcome");
    const { page } = o;
    await toKey(o);
    const key = page.locator("#ob-key");
    expect(await key.getAttribute("type")).toBe("password");
    await key.focus();
    await page.evaluate(() => navigator.clipboard?.writeText?.("ignored").catch(() => undefined));
    await key.fill("sk-ant-pasted-0123456789abcdef");
    await page.getByRole("button", { name: "Show" }).click();
    expect(await key.getAttribute("type")).toBe("text");
    expect(await key.inputValue()).toBe("sk-ant-pasted-0123456789abcdef");
    await page.getByRole("button", { name: "Hide" }).click();
    expect(await key.getAttribute("type")).toBe("password");
    await page.close();
  });

  it("names the host in the consent box, which has to be ticked before anything is saved or tested", async () => {
    const o = await open("#/welcome");
    const { page } = o;
    await toKey(o);
    const consent = page.getByLabel(/Send redacted page structure/);
    expect(await consent.isChecked()).toBe(false);
    expect(await page.locator(".ai-consent").textContent()).toContain("api.anthropic.com");
    await page.locator("#ob-key").fill("sk-ant-test-key-0123456789abcdef");
    await page.getByRole("button", { name: "Test connection" }).click();
    expect(await page.locator("#ob-error").textContent()).toMatch(/Tick the box to allow sending .* to api\.anthropic\.com/);
    await page.getByRole("button", { name: "Save without testing" }).click();
    expect(await page.locator("#ob-error").textContent()).toMatch(/Tick the box/);
    expect(puts(o)).toHaveLength(0);
    await page.close();
  });

  it("asks for the key before it saves anything", async () => {
    const o = await open("#/welcome");
    const { page } = o;
    await toKey(o);
    await page.getByLabel(/Send redacted page structure/).check();
    await page.getByRole("button", { name: "Test connection" }).click();
    expect(await page.locator("#ob-error").textContent()).toBe("Paste your Anthropic API key.");
    expect(puts(o)).toHaveLength(0);
    await page.close();
  });

  it("enables Next only after a successful test: it saves with the consent, picks the recommended model and tests it", async () => {
    const o = await open("#/welcome");
    const { page } = o;
    await toKey(o);
    const next = page.locator("#ob-next");
    expect(await next.isDisabled()).toBe(true);
    await page.locator("#ob-key").fill("sk-ant-test-key-0123456789abcdef");
    await page.getByLabel(/Send redacted page structure/).check();
    expect(await next.isDisabled()).toBe(true);
    await page.getByRole("button", { name: "Test connection" }).click();
    await page.locator("#ob-test-result").filter({ hasText: "Connected: claude-opus-5-5 answered in" }).waitFor();
    expect(await next.isEnabled()).toBe(true);
    expect(puts(o)[0]!.body).toEqual({ provider: "anthropic", apiKey: "sk-ant-test-key-0123456789abcdef", allowRemote: true });
    expect(puts(o)[1]!.body).toEqual({ model: "claude-opus-5-5" });
    expect(o.calls.map((c) => `${c.method} ${c.path}`)).toEqual(expect.arrayContaining(["GET /api/ai/models", "POST /api/ai/test"]));
    // A change after a passing test needs a new test.
    await page.locator("#ob-key").fill("sk-ant-other-0123456789abcdef");
    expect(await next.isDisabled()).toBe(true);
    await page.close();
  });

  it("shows a failed test's error and still lets the user save without testing", async () => {
    const o = await open("#/welcome", { test: () => ({ ok: false, error: "Anthropic refused the credentials (HTTP 401); check the API key" }) });
    const { page } = o;
    await toKey(o);
    await page.locator("#ob-key").fill("sk-ant-test-key-0123456789abcdef");
    await page.getByLabel(/Send redacted page structure/).check();
    await page.getByRole("button", { name: "Test connection" }).click();
    const result = page.locator("#ob-test-result");
    await result.filter({ hasText: "Anthropic refused the credentials (HTTP 401)" }).waitFor();
    expect(await result.getAttribute("role")).toBe("status");
    expect(await page.locator("#ob-next").isDisabled()).toBe(true);
    await page.getByRole("button", { name: "Save without testing" }).click();
    await heading(page).filter({ hasText: "Choose your models" }).waitFor();
    expect(o.errors).toEqual([]);
    await page.close();
  });

  it("shows a refused key from the model list as the test's answer", async () => {
    const o = await open("#/welcome", { models: () => ({ models: [], error: "Anthropic refused the API key" }) });
    const { page } = o;
    await toKey(o);
    await page.locator("#ob-key").fill("sk-ant-bad-0123456789abcdef");
    await page.getByLabel(/Send redacted page structure/).check();
    await page.getByRole("button", { name: "Test connection" }).click();
    await page.locator("#ob-test-result").filter({ hasText: "Anthropic refused the API key" }).waitFor();
    expect(o.calls.some((c) => c.path === "/api/ai/test")).toBe(false);
    await page.close();
  });

  it("shows a save error where the user is, and keeps the screen", async () => {
    const o = await open("#/welcome", { putError: "provider is set by RUNHOUND_AI_PROVIDER and can't be changed here" });
    const { page } = o;
    await toKey(o);
    await page.locator("#ob-key").fill("sk-ant-test-key-0123456789abcdef");
    await page.getByLabel(/Send redacted page structure/).check();
    await page.getByRole("button", { name: "Save without testing" }).click();
    await page.locator("#ob-error").filter({ hasText: "can't be changed here" }).waitFor();
    expect(await stepText(page)).toBe("Step 3 of 5");
    await page.close();
  });

  it("Bedrock: the Region, a choice of API key or AWS profile, and a model to test with; the consent names the regional host", async () => {
    const o = await open("#/welcome");
    const { page } = o;
    await toKey(o, "Amazon Bedrock");
    expect(await page.locator("#ob-consent").count()).toBe(0);
    await page.getByLabel("AWS Region").fill("eu-west-1");
    expect(await page.locator(".ai-consent").textContent()).toContain("bedrock-runtime.eu-west-1.amazonaws.com");
    expect(await page.locator(".ob-private").textContent()).toContain("bedrock-runtime.eu-west-1.amazonaws.com");
    await page.getByLabel("Sign in with").selectOption("profile");
    expect(await page.locator("#ob-key").isVisible()).toBe(false);
    await page.getByLabel("AWS profile").fill("work");
    await page.getByLabel("Model to test with").fill("anthropic.claude-sonnet-5-5-v1:0");
    await page.getByLabel(/Send redacted page structure/).check();
    await page.getByRole("button", { name: "Test connection" }).click();
    await page.locator("#ob-test-result").filter({ hasText: "Connected" }).waitFor();
    expect(puts(o)[0]!.body).toEqual({ provider: "bedrock", region: "eu-west-1", awsProfile: "work", apiKey: null, allowRemote: true, model: "anthropic.claude-sonnet-5-5-v1:0" });
    // Changing the Region changes the host, so the consent is asked for again.
    await page.getByLabel("AWS Region").fill("us-west-2");
    expect(await page.getByLabel(/Send redacted page structure/).isChecked()).toBe(false);
    await page.close();
  });

  it("a local model: a server choice, its address and an optional key, no consent and no billing note", async () => {
    const o = await open("#/welcome");
    const { page } = o;
    await toKey(o, "A model on this computer");
    expect(await stepText(page)).toBe("Step 3 of 5");
    expect(await page.locator("#ob-base-url").inputValue()).toBe("http://127.0.0.1:11434/v1");
    expect(await page.locator("#ob-consent").count()).toBe(0);
    await page.getByLabel("Which server?").selectOption("lmstudio");
    expect(await page.locator("#ob-base-url").inputValue()).toBe("http://127.0.0.1:1234/v1");
    expect(await page.getByLabel(/API key \(optional\)/).count()).toBe(1);
    await page.getByRole("button", { name: "Test connection" }).click();
    await page.locator("#ob-test-result").filter({ hasText: "Connected: qwen3:4b" }).waitFor();
    expect(puts(o)[0]!.body).toEqual({ provider: "openai-compatible", baseUrl: "http://127.0.0.1:1234/v1" });
    expect(o.errors).toEqual([]);
    await page.close();
  });

  it("asks for a model ID when the server lists none, then tests with it", async () => {
    const o = await open("#/welcome", { models: () => ({ models: [], error: null }) });
    const { page } = o;
    await toKey(o, "A model on this computer");
    await page.getByRole("button", { name: "Test connection" }).click();
    const field = page.getByLabel("Model to test with");
    await field.waitFor();
    expect(await activeId(page)).toBe("ob-model");
    await field.fill("my-local-model");
    await page.getByRole("button", { name: "Test connection" }).click();
    await page.locator("#ob-test-result").filter({ hasText: "Connected: my-local-model" }).waitFor();
    await page.close();
  });
});

describe("4. Models", () => {
  async function toModels(o: Opened, provider: keyof typeof CHOICES = "Anthropic (Claude)") {
    await toKey(o, provider);
    await o.page.locator("#ob-key").fill("sk-ant-test-key-0123456789abcdef");
    await o.page.getByLabel(/Send redacted page structure/).check();
    await o.page.getByRole("button", { name: "Save without testing" }).click();
    await o.page.getByRole("heading", { level: 1, name: /Choose your models?/ }).waitFor();
  }

  it("preselects the recommended pair in two selects and says what each model does", async () => {
    const o = await open("#/welcome");
    const { page } = o;
    await toModels(o);
    expect(await stepText(page)).toBe("Step 4 of 5");
    expect(await activeId(page)).toBe("ob-h");
    await page.locator("#ob-models-msg").filter({ hasText: "3 models available" }).waitFor();
    expect(await page.locator("#ob-main").inputValue()).toBe("claude-opus-5-5");
    expect(await page.locator("#ob-helper").inputValue()).toBe("claude-sonnet-5-5");
    expect(await page.locator("#ob-main-hint").textContent()).toBe("Investigates as the agent and drafts testing briefs.");
    expect(await page.locator("#ob-helper-hint").textContent()).toBe("Reviews the plan, suggests extra flows and explains findings.");
    expect(await page.locator("#ob-cost").textContent()).toMatch(/once for every step the agent takes/);
    expect(await page.locator("#view .btn.primary").count()).toBe(1);
    expect(o.errors).toEqual([]);
    await page.close();
  });

  it("Finish saves both models and turns AI on; the Ready screen names them and where the key is kept", async () => {
    const o = await open("#/welcome");
    const { page } = o;
    await toModels(o);
    await page.locator("#ob-models-msg").filter({ hasText: "available" }).waitFor();
    await page.locator("#ob-helper").selectOption("claude-haiku-5-5");
    await page.getByRole("button", { name: "Finish setup" }).click();
    await heading(page).filter({ hasText: "AI is set up" }).waitFor();
    expect(puts(o).at(-1)!.body).toEqual({ model: "claude-opus-5-5", helperModel: "claude-haiku-5-5", enabled: true });
    expect(await stepText(page)).toBe("Step 5 of 5");
    expect(await activeId(page)).toBe("ob-h");
    const summary = await page.locator(".ob-summary").innerText();
    expect(summary).toContain("Anthropic");
    expect(summary).toContain("claude-opus-5-5");
    expect(summary).toContain("claude-haiku-5-5");
    expect(await page.locator("#ob-kept").textContent()).toBe(
      "Your key is encrypted with this computer's keychain in Run Hound's own folder, and only Run Hound opens it. Remove it any time in Settings → AI, or with Delete all keys and data. Uninstalling Run Hound on Windows deletes it; on macOS and Linux, use Delete all keys and data before you remove the app.",
    );
    await page.getByRole("button", { name: "Test my app" }).click();
    await page.getByRole("heading", { level: 1, name: "New run" }).waitFor();
    expect(posted(o)).toEqual([{ outcome: "configured" }]);
    expect(o.errors).toEqual([]);
    await page.close();
  });

  it("'Use the main model for everything' clears the helper", async () => {
    const o = await open("#/welcome");
    const { page } = o;
    await toModels(o);
    await page.locator("#ob-models-msg").filter({ hasText: "available" }).waitFor();
    await page.getByLabel("Use the main model for everything").check();
    expect(await page.locator("#ob-helper").isDisabled()).toBe(true);
    await page.getByRole("button", { name: "Finish setup" }).click();
    await heading(page).filter({ hasText: "AI is set up" }).waitFor();
    expect(puts(o).at(-1)!.body).toEqual({ model: "claude-opus-5-5", helperModel: "", enabled: true });
    expect(await page.locator(".ob-summary").innerText()).toContain("Same as the main model");
    await page.close();
  });

  it("a local model gets one select, since it runs only the helper's jobs, and no cost line", async () => {
    const o = await open("#/welcome");
    const { page } = o;
    await toKey(o, "A model on this computer");
    await page.getByRole("button", { name: "Save without testing" }).click();
    await heading(page).filter({ hasText: "Choose your model" }).waitFor();
    await page.locator("#ob-models-msg").filter({ hasText: "available" }).waitFor();
    expect(await page.getByLabel("Model", { exact: true }).inputValue()).toBe("qwen3:4b");
    expect(await page.locator("#ob-helper").isVisible()).toBe(false);
    expect(await page.locator("#ob-cost").isVisible()).toBe(false);
    // The embedding model is not offered.
    expect(await page.locator("#ob-main option").allTextContents()).toEqual(["qwen3:4b", "Other…"]);
    await page.getByRole("button", { name: "Finish setup" }).click();
    await heading(page).filter({ hasText: "AI is set up" }).waitFor();
    expect(puts(o).at(-1)!.body).toEqual({ model: "qwen3:4b", helperModel: "", enabled: true });
    await page.close();
  });

  it("takes model IDs in text fields where the models can't be listed (Bedrock)", async () => {
    const o = await open("#/welcome");
    const { page } = o;
    await toKey(o, "Amazon Bedrock");
    await page.getByLabel("AWS Region").fill("us-east-1");
    await page.locator("#ob-key").fill("bedrock-api-key-0123456789abcdef");
    await page.getByLabel("Model to test with").fill("anthropic.claude-opus-5-5-v1:0");
    await page.getByLabel(/Send redacted page structure/).check();
    await page.getByRole("button", { name: "Save without testing" }).click();
    await heading(page).filter({ hasText: "Choose your models" }).waitFor();
    await page.locator("#ob-models-msg").filter({ hasText: "aren't listed here" }).waitFor();
    expect(await page.locator("#ob-main-other").inputValue()).toBe("anthropic.claude-opus-5-5-v1:0");
    await page.locator("#ob-helper-other").fill("anthropic.claude-sonnet-5-5-v1:0");
    await page.getByRole("button", { name: "Finish setup" }).click();
    await heading(page).filter({ hasText: "AI is set up" }).waitFor();
    expect(puts(o).at(-1)!.body).toEqual({ model: "anthropic.claude-opus-5-5-v1:0", helperModel: "anthropic.claude-sonnet-5-5-v1:0", enabled: true });
    await page.close();
  });

  it("falls back to text fields, with the reason, when the list fails; Finish needs a main model", async () => {
    const o = await open("#/welcome");
    const { page } = o;
    await toModels(o);
    o.stub.models = () => ({ models: [], error: "Nothing is answering at https://api.anthropic.com" });
    await page.locator("#ob-models-msg").filter({ hasText: "available" }).waitFor();
    await page.getByRole("button", { name: "Refresh the list" }).click();
    await page.locator("#ob-models-msg").filter({ hasText: "Nothing is answering" }).waitFor();
    expect(await page.locator("#ob-main-other").isVisible()).toBe(true);
    await page.locator("#ob-main-other").fill("");
    expect(await page.locator("#ob-next").isDisabled()).toBe(true);
    await page.locator("#ob-main-other").fill("claude-opus-5-5");
    expect(await page.locator("#ob-next").isEnabled()).toBe(true);
    await page.close();
  });
});

describe("accessibility and layout", () => {
  it("every screen passes axe and fits 320 px without sideways scrolling", async () => {
    const o = await open("#/welcome", {}, { width: 320 });
    const { page } = o;
    const check = async (name: string) => {
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations.map((v) => `${name}: ${v.id} (${v.nodes.length})`)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${name} overflows`).toBe(true);
    };
    await check("welcome");
    await page.getByRole("button", { name: "Set up AI" }).click();
    await check("provider");
    await page.getByRole("radio", { name: /Anthropic/ }).check();
    await page.getByRole("button", { name: "Continue" }).click();
    await check("key");
    await page.locator("#ob-key").fill("sk-ant-test-key-0123456789abcdef");
    await page.getByLabel(/Send redacted page structure/).check();
    await page.getByRole("button", { name: "Test connection" }).click();
    await page.locator("#ob-test-result").filter({ hasText: "Connected" }).waitFor();
    await check("key tested");
    await page.locator("#ob-next").click();
    await page.locator("#ob-models-msg").filter({ hasText: "available" }).waitFor();
    await check("models");
    await page.getByRole("button", { name: "Finish setup" }).click();
    await heading(page).filter({ hasText: "AI is set up" }).waitFor();
    await check("ready");
    expect(o.errors).toEqual([]);
    await page.close();
  });

  it("Settings with the helper model and the delete confirmation open passes axe at 320 px", async () => {
    const o = await open("#/settings", { ai: { ...AI_OFF, enabled: true, provider: "anthropic", baseUrl: "https://api.anthropic.com/v1", model: "claude-opus-5-5", helperModel: "claude-sonnet-5-5", hasKey: true, remote: true, host: "api.anthropic.com", problem: null, savedKeys: ["anthropic"], sources: { ...AI_OFF.sources, apiKey: "file", provider: "file", model: "file" } } }, { width: 320 });
    const { page } = o;
    await page.locator("#delete-data").click();
    await page.locator("#delete-panel").waitFor();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.map((v) => `${v.id} (${v.nodes.length}): ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
    await page.close();
  });

  it("works with the keyboard alone: Tab reaches the radio cards and the buttons, Enter and Space act", async () => {
    const o = await open("#/welcome");
    const { page } = o;
    await page.locator("#ob-start").focus();
    await page.keyboard.press("Enter");
    await heading(page).filter({ hasText: "Choose your AI provider" }).waitFor();
    expect(await activeId(page)).toBe("ob-h");
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.getAttribute("name"))).toBe("ob-provider");
    await page.keyboard.press("Space");
    expect(await page.getByRole("radio", { checked: true }).count()).toBe(1);
    await page.keyboard.press("ArrowDown");
    expect(await page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.value)).toBe("openai");
    await page.close();
  });
});

describe("Settings", () => {
  const ANTHROPIC_SET: AiStatus = {
    ...AI_OFF,
    enabled: true,
    provider: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-opus-5-5",
    helperModel: "claude-sonnet-5-5",
    allowRemote: true,
    hasKey: true,
    remote: true,
    host: "api.anthropic.com",
    problem: null,
    savedKeys: ["anthropic"],
    sources: { ...AI_OFF.sources, enabled: "file", provider: "file", model: "file", helperModel: "file", apiKey: "file", allowRemote: "file", baseUrl: "file" },
  };

  it("shows the Helper model under the Model, and saves both; ticking 'Use the main model for everything' clears it", async () => {
    const o = await open("#/settings", { ai: ANTHROPIC_SET });
    const { page } = o;
    await page.locator("#ai-card #ai-save").waitFor();
    await page.getByLabel("Helper model", { exact: true }).waitFor();
    expect(await page.getByLabel("Model", { exact: true }).inputValue()).toBe("claude-opus-5-5");
    expect(await page.getByLabel("Helper model", { exact: true }).inputValue()).toBe("claude-sonnet-5-5");
    expect(await page.locator("#ai-helper-same").isChecked()).toBe(false);
    await page.locator("#ai-card #ai-save").click();
    await page.locator("#ai-saved").filter({ hasText: "Saved" }).waitFor();
    expect(puts(o).at(-1)!.body).toMatchObject({ model: "claude-opus-5-5", helperModel: "claude-sonnet-5-5" });
    await page.locator("#ai-helper-same").check();
    await page.locator("#ai-card #ai-save").click();
    await page.locator("#ai-saved").filter({ hasText: "Saved" }).waitFor();
    expect(puts(o).at(-1)!.body).toMatchObject({ model: "claude-opus-5-5", helperModel: "" });
    expect(o.errors).toEqual([]);
    await page.close();
  });

  it("starts the Helper model on 'Use the main model for everything' when there is none, and offers the recommended one when unticked", async () => {
    const o = await open("#/settings", { ai: { ...ANTHROPIC_SET, helperModel: "", sources: { ...ANTHROPIC_SET.sources, helperModel: "default" } } });
    const { page } = o;
    await page.locator("#ai-helper-same").waitFor();
    expect(await page.locator("#ai-helper-same").isChecked()).toBe(true);
    expect(await page.locator("#ai-helper-model").isDisabled()).toBe(true);
    await page.getByRole("button", { name: "Refresh the model list" }).click();
    await page.locator("#ai-models-msg").filter({ hasText: "3 models" }).waitFor();
    await page.locator("#ai-helper-same").uncheck();
    expect(await page.locator("#ai-helper-model").inputValue()).toBe("claude-sonnet-5-5");
    await page.close();
  });

  it("locks the Helper model when the environment sets it", async () => {
    const o = await open("#/settings", { ai: { ...ANTHROPIC_SET, sources: { ...ANTHROPIC_SET.sources, helperModel: "env" } } });
    await o.page.locator("#ai-helper-same").waitFor();
    expect(await o.page.locator("#ai-helper-same").isDisabled()).toBe(true);
    expect(await o.page.locator("#ai-helper-model").isDisabled()).toBe(true);
    expect(await o.page.locator(".ai-helper-field .locked").textContent()).toBe("Set by environment");
    await o.page.close();
  });

  it("'Run setup again' opens the setup on the desktop and is not in a browser", async () => {
    const o = await open("#/settings", { ai: ANTHROPIC_SET });
    await o.page.locator("#ai-run-setup").click();
    await heading(o.page).filter({ hasText: "Welcome to Run Hound" }).waitFor();
    expect(await hash(o.page)).toBe("#/welcome");
    await o.page.close();
    const browserOnly = await open("#/settings", { ai: ANTHROPIC_SET }, { desktop: false });
    await browserOnly.page.locator("#ai-save").waitFor();
    expect(await browserOnly.page.locator("#ai-run-setup").count()).toBe(0);
    expect(await browserOnly.page.locator("#delete-data").count()).toBe(0);
    await browserOnly.page.close();
  });

  it("asks before it deletes: the confirmation lists what goes, the reports are not ticked, and Cancel changes nothing", async () => {
    const o = await open("#/settings", { ai: ANTHROPIC_SET });
    const { page } = o;
    await page.locator("#delete-data").click();
    const panel = page.locator("#delete-panel");
    await panel.waitFor();
    expect(await activeId(page)).toBe("delete-h");
    const text = await panel.innerText();
    for (const line of [/saved AI keys and test-account passwords/i, /AI settings, test-account details and run defaults/i, /key Run Hound's store is locked with/i, /setup and the settings import were done/i]) expect(text).toMatch(line);
    expect(await page.getByLabel("Also delete my reports").isChecked()).toBe(false);
    expect(text).not.toMatch(/Safe Storage/);
    await page.getByRole("button", { name: "Cancel" }).click();
    expect(await panel.isVisible()).toBe(false);
    expect(await activeId(page)).toBe("delete-data");
    expect(o.calls.some((c) => c.path === "/api/data/delete")).toBe(false);
    await page.close();
  });

  it("deletes on confirmation, clears the run defaults and opens the setup", async () => {
    const o = await open("#/settings", { ai: ANTHROPIC_SET });
    const { page } = o;
    await page.evaluate(() => localStorage.setItem("run-hound.defaults", JSON.stringify({ allowDestructive: true })));
    await page.locator("#delete-data").click();
    await page.getByLabel("Also delete my reports").check();
    await page.getByRole("button", { name: "Delete everything" }).click();
    await heading(page).filter({ hasText: "Welcome to Run Hound" }).waitFor();
    expect(o.calls.find((c) => c.path === "/api/data/delete")!.body).toEqual({ includeRuns: true });
    expect(await page.evaluate(() => localStorage.getItem("run-hound.defaults"))).toBeNull();
    expect(o.errors).toEqual([]);
    await page.close();
  });

  it("deletes the reports only when asked", async () => {
    const o = await open("#/settings", { ai: ANTHROPIC_SET });
    await o.page.locator("#delete-data").click();
    await o.page.getByRole("button", { name: "Delete everything" }).click();
    await heading(o.page).filter({ hasText: "Welcome to Run Hound" }).waitFor();
    expect(o.calls.find((c) => c.path === "/api/data/delete")!.body).toEqual({ includeRuns: false });
    await o.page.close();
  });

  it("keeps the confirmation open and says why when the engine can't delete", async () => {
    const o = await open("#/settings", { ai: ANTHROPIC_SET, deleteError: "Run Hound could not delete everything (EBUSY). Deleted so far: nothing." });
    const { page } = o;
    await page.locator("#delete-data").click();
    await page.getByRole("button", { name: "Delete everything" }).click();
    await page.locator("#delete-error").filter({ hasText: "EBUSY" }).waitFor();
    expect(await page.locator("#delete-panel").isVisible()).toBe(true);
    expect(await page.getByRole("button", { name: "Delete everything" }).isEnabled()).toBe(true);
    expect(await hash(page)).toBe("#/settings");
    await page.close();
  });

  it("mentions the macOS keychain item only on macOS", async () => {
    const mac = await open("#/settings", { ai: ANTHROPIC_SET }, { platform: "darwin" });
    await mac.page.locator("#delete-data").click();
    expect(await mac.page.locator("#delete-mac-note").textContent()).toMatch(/Run Hound Safe Storage/);
    await mac.page.close();
  });
});
