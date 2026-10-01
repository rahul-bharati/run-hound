/**
 * Settings → AI card: Bedrock credentials (0.6.1, docs/launch-spec.md "Bedrock credentials", "Settings"), driven in
 * real Chromium against renderUi's document with every /api/* call answered by a stub (as ui-ai.test.ts does):
 * - for Amazon Bedrock only, a "Credentials" select (#ai-aws-auth) with the options "Bedrock API key" (api-key), "Access
 *   keys" (access-keys) and "AWS profile" (profile); only the chosen one's fields show. A select, not radios: radio
 *   labels would share words with the "API key" and "AWS profile" fields' labels;
 * - the first choice follows the status: a saved or env API key, else saved keys (hasAwsKeys), else a named profile,
 *   else "Bedrock API key";
 * - "Access keys" shows Access key ID (#ai-aws-key-id), Secret access key (#ai-aws-secret, a password field) and
 *   Session token (optional) (#ai-aws-session-token, a password field): never prefilled, "Saved" or "Not set" as
 *   placeholders, and "Remove keys" (#ai-aws-keys-remove) when keys are saved;
 * - Save sends the typed pair (and token), and null for the other methods' values saved in ai.json, so one method is
 *   saved at a time; fields set by the environment are disabled, say so, and are never sent;
 * - another provider shows no choice and sends none of the key fields.
 */
import { chromium, type Browser, type Page, type Request, type Route } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AccountStatus, AccountsStatus } from "../interfaces/accounts.js";
import type { AiStatus } from "../ai/types.js";
import { renderUi } from "./ui/index.js";

const ORIGIN = "http://rh.test";
const HTML = renderUi({ version: "0.6.1", canShowBrowser: false });

const unsetSlot = (id: "a" | "b"): AccountStatus => ({
  id,
  label: id === "a" ? "Account A" : "Account B",
  loginUrl: "",
  username: "",
  hasPassword: false,
  ready: false,
  sources: { label: "default", loginUrl: "default", username: "default", password: "default" },
  problem: null,
});
const NO_ACCOUNTS: AccountsStatus = { isolated: true, isolatedSource: "default", accounts: { a: unsetSlot("a"), b: unsetSlot("b") }, file: "/home/me/.config/run-hound/accounts.json" };

const SOURCES: AiStatus["sources"] = { enabled: "file", provider: "file", baseUrl: "default", model: "file", apiKey: "default", region: "file", allowRemote: "file", features: "default", timeoutMs: "default", awsProfile: "default", awsKeys: "default" };

function bedrock(extra: Partial<AiStatus> = {}, sources: Partial<AiStatus["sources"]> = {}): AiStatus {
  return {
    enabled: true,
    provider: "bedrock",
    baseUrl: "",
    model: "anthropic.claude-x-v1:0",
    region: "eu-west-1",
    awsProfile: null,
    allowRemote: true,
    features: { review: true, suggest: true, explain: true },
    timeoutMs: 120_000,
    hasKey: false,
    hasAwsKeys: false,
    hasAwsSessionToken: false,
    remote: true,
    host: "bedrock-runtime.eu-west-1.amazonaws.com",
    problem: null,
    sources: { ...SOURCES, ...sources },
    file: "/home/me/.config/run-hound/ai.json",
    ...extra,
  };
}

interface Opened {
  page: Page;
  errors: string[];
  puts: Record<string, unknown>[];
}

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
});

async function open(ai: AiStatus): Promise<Opened> {
  let current = ai;
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  // A stubbed, already rendered page: a missing control fails in 10 s, not the default 30.
  page.setDefaultTimeout(10_000);
  const errors: string[] = [];
  const puts: Record<string, unknown>[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route(`${ORIGIN}/**`, async (route: Route, req: Request) => {
    const url = new URL(req.url());
    const json = (body: unknown, code = 200) => route.fulfill({ status: code, contentType: "application/json", body: JSON.stringify(body) });
    if (!url.pathname.startsWith("/api/")) return route.fulfill({ status: 200, contentType: "text/html", body: HTML });
    if (url.pathname === "/api/ai" && req.method() === "GET") return json(current);
    if (url.pathname === "/api/ai" && req.method() === "PUT") {
      const body = JSON.parse(req.postData() ?? "{}") as Record<string, unknown>;
      puts.push(body);
      return json(current);
    }
    if (url.pathname === "/api/ai/models") return json({ models: [], error: null });
    if (url.pathname === "/api/settings") return json({ version: "0.6.1", runsDir: "/runs", allowedHosts: [], serverHosts: [], ai: current });
    if (url.pathname === "/api/accounts") return json(NO_ACCOUNTS);
    if (url.pathname === "/api/runs") return json({ runs: [] });
    return json({ error: "not stubbed" }, 404);
  });
  await page.goto(`${ORIGIN}/#/settings`);
  await page.locator("#ai-enabled").waitFor();
  current = ai;
  return { page, errors, puts };
}

const save = async (o: Opened) => {
  const before = o.puts.length;
  await o.page.locator("#ai-card").getByRole("button", { name: "Save" }).click();
  await expect.poll(() => o.puts.length).toBe(before + 1);
  return o.puts[o.puts.length - 1]!;
};
const visible = (page: Page, selector: string) => page.locator(selector).isVisible();
const KEY_FIELDS = ["awsAccessKeyId", "awsSecretAccessKey", "awsSessionToken"];

describe("Settings → AI card: the Bedrock credentials choice", () => {
  it("offers Bedrock API key, Access keys and AWS profile, and shows only the chosen one's fields", async () => {
    const o = await open(bedrock());
    const { page } = o;
    const choice = page.getByLabel("Credentials");
    await choice.waitFor();
    expect(await choice.getAttribute("id")).toBe("ai-aws-auth");
    expect(await choice.locator("option").evaluateAll((options) => options.map((e) => [(e as HTMLOptionElement).value, e.textContent]))).toEqual([
      ["api-key", "Bedrock API key"],
      ["access-keys", "Access keys"],
      ["profile", "AWS profile"],
    ]);
    expect(await choice.inputValue()).toBe("api-key");
    expect(await visible(page, "#ai-key")).toBe(true);
    expect(await visible(page, "#ai-aws-key-id")).toBe(false);
    expect(await visible(page, "#ai-aws-profile")).toBe(false);

    await choice.selectOption("access-keys");
    expect(await visible(page, "#ai-key")).toBe(false);
    for (const id of ["#ai-aws-key-id", "#ai-aws-secret", "#ai-aws-session-token"]) expect(await visible(page, id), id).toBe(true);
    expect(await visible(page, "#ai-aws-profile")).toBe(false);
    expect(await page.getByLabel("Access key ID").getAttribute("id")).toBe("ai-aws-key-id");
    expect(await page.getByLabel("Secret access key").getAttribute("type")).toBe("password");
    expect(await page.getByLabel("Session token (optional)").getAttribute("type")).toBe("password");

    await choice.selectOption("profile");
    expect(await visible(page, "#ai-aws-profile")).toBe(true);
    expect(await visible(page, "#ai-aws-key-id")).toBe(false);
    expect(await visible(page, "#ai-key")).toBe(false);
    expect(o.errors).toEqual([]);
    await page.close();
  });

  it("starts on the method the status says is set: saved keys, then a named profile", async () => {
    const first = async (status: AiStatus) => {
      const o = await open(status);
      await o.page.locator("#ai-aws-auth").waitFor();
      const value = await o.page.locator("#ai-aws-auth").inputValue();
      await o.page.close();
      return value;
    };
    expect(await first(bedrock({ hasKey: true, hasAwsKeys: true }, { awsKeys: "file" }))).toBe("access-keys");
    expect(await first(bedrock({ hasKey: true, awsProfile: "work" }, { awsProfile: "file" }))).toBe("profile");
    expect(await first(bedrock({ hasKey: true, hasAwsKeys: true }, { apiKey: "file", awsKeys: "file" }))).toBe("api-key");
    expect(await first(bedrock({ hasKey: true, hasAwsKeys: true }, { apiKey: "env", awsKeys: "file" }))).toBe("api-key");
    expect(await first(bedrock())).toBe("api-key");
  });

  it("never prefills the key fields, shows 'Saved' or 'Not set', and offers Remove keys only when keys are saved", async () => {
    let o = await open(bedrock({ hasKey: true, hasAwsKeys: true, hasAwsSessionToken: true }, { awsKeys: "file" }));
    const { page } = o;
    await page.locator("#ai-aws-key-id").waitFor();
    for (const id of ["#ai-aws-key-id", "#ai-aws-secret", "#ai-aws-session-token"]) {
      expect(await page.locator(id).inputValue(), id).toBe("");
      expect(await page.locator(id).getAttribute("placeholder"), id).toBe("Saved");
    }
    expect(await visible(page, "#ai-aws-keys-remove")).toBe(true);
    await page.close();
    o = await open(bedrock({ hasKey: true, hasAwsKeys: true, hasAwsSessionToken: false }, { awsKeys: "file" }));
    await o.page.locator("#ai-aws-session-token").waitFor();
    expect(await o.page.locator("#ai-aws-session-token").getAttribute("placeholder")).toBe("Not set");
    await o.page.close();
    o = await open(bedrock());
    await o.page.locator("#ai-aws-auth").selectOption("access-keys");
    expect(await o.page.locator("#ai-aws-secret").getAttribute("placeholder")).toBe("Not set");
    expect(await o.page.locator("#ai-aws-keys-remove").count()).toBe(0);
    await o.page.close();
  });

  it("saves the typed pair and token, and removes the API key and profile saved in ai.json", async () => {
    const o = await open(bedrock({ hasKey: true, awsProfile: "old" }, { apiKey: "file", awsProfile: "file" }));
    const { page } = o;
    await page.getByLabel("Credentials").selectOption("access-keys");
    await page.getByLabel("Access key ID").fill("AKIAIOSFODNN7EXAMPLE");
    await page.getByLabel("Secret access key").fill("typed-secret");
    await page.getByLabel("Session token (optional)").fill("typed-token");
    const body = await save(o);
    expect(body).toMatchObject({ provider: "bedrock", awsAccessKeyId: "AKIAIOSFODNN7EXAMPLE", awsSecretAccessKey: "typed-secret", awsSessionToken: "typed-token", apiKey: null, awsProfile: null });
    await page.close();
  });

  it("keeps saved keys when nothing is typed, and Remove keys sends awsAccessKeyId: null", async () => {
    const o = await open(bedrock({ hasKey: true, hasAwsKeys: true }, { awsKeys: "file" }));
    const { page } = o;
    await page.locator("#ai-aws-key-id").waitFor();
    let body = await save(o);
    for (const field of KEY_FIELDS) expect(body, field).not.toHaveProperty(field);
    await page.locator("#ai-aws-keys-remove").click();
    body = await save(o);
    expect(body.awsAccessKeyId).toBeNull();
    await page.close();
  });

  it("choosing the API key or a profile removes saved keys (awsAccessKeyId: null)", async () => {
    let o = await open(bedrock({ hasKey: true, hasAwsKeys: true }, { awsKeys: "file" }));
    await o.page.getByLabel("Credentials").selectOption("api-key");
    await o.page.locator("#ai-key").fill("typed-bedrock-key");
    let body = await save(o);
    expect(body).toMatchObject({ apiKey: "typed-bedrock-key", awsAccessKeyId: null });
    await o.page.close();
    o = await open(bedrock({ hasKey: true, hasAwsKeys: true }, { awsKeys: "file" }));
    await o.page.getByLabel("Credentials").selectOption("profile");
    await o.page.locator("#ai-aws-profile").fill("work");
    body = await save(o);
    expect(body).toMatchObject({ awsProfile: "work", awsAccessKeyId: null });
    await o.page.close();
  });

  it("locks keys set by the environment: disabled, 'Set by environment', never sent", async () => {
    const o = await open(bedrock({ hasKey: true, hasAwsKeys: true }, { awsKeys: "env" }));
    const { page } = o;
    await page.locator("#ai-aws-key-id").waitFor();
    for (const id of ["#ai-aws-key-id", "#ai-aws-secret", "#ai-aws-session-token"]) expect(await page.locator(id).isDisabled(), id).toBe(true);
    expect(await page.locator(".ai-aws-keys-field").first().innerText()).toContain("Set by environment");
    expect(await page.locator("#ai-aws-keys-remove").count()).toBe(0);
    const body = await save(o);
    for (const field of KEY_FIELDS) expect(body, field).not.toHaveProperty(field);
    await page.close();
  });

  it("shows no choice and sends no key field for another provider", async () => {
    const o = await open({ ...bedrock(), provider: "ollama", baseUrl: "http://127.0.0.1:11434/v1", model: "m", remote: false, host: "127.0.0.1:11434", allowRemote: false });
    const { page } = o;
    await page.locator("#ai-enabled").waitFor();
    expect(await visible(page, "#ai-aws-auth")).toBe(false);
    expect(await visible(page, "#ai-aws-key-id")).toBe(false);
    const body = await save(o);
    for (const field of KEY_FIELDS) expect(body, field).not.toHaveProperty(field);
    await page.close();
  });
});
