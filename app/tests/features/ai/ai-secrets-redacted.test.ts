/**
 * The AI secrets are registered with the redactor (0.6.1, docs/launch-spec.md "Redaction"):
 * - resolveAiConfig (and so saveAiConfig, the server per request and the CLI) registers, with registerSecretLiterals,
 *   every AI secret it reads: the API key and the AWS secret access key and session token from ai.json, and
 *   RUNHOUND_AI_API_KEY, AWS_BEARER_TOKEN_BEDROCK, AWS_SECRET_ACCESS_KEY and AWS_SESSION_TOKEN from the environment
 *   (the last three for Bedrock), whether or not they apply. Each call replaces the previous call's registration, so a
 *   secret the config no longer holds is no longer registered.
 * - resolveAwsCredentials registers the secret access key and session token it resolves (a named profile, a
 *   credential_process helper, IAM Identity Center) for the life of the process.
 * - so a saved secret never reaches a run's report, log lines or exported specs, whatever its shape.
 */
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "../../support/server.js";
import type { Check, CheckResult } from "../../../src/core/types.js";
import { redactSecrets } from "../../../src/engine/redact.js";
import { discoverAndPlan, runPlan } from "../../../src/engine/runner.js";
import { clearAwsCredentialCache, resolveAwsCredentials } from "../../../src/ai/aws-credentials.js";
import { aiStatus, resolveAiConfig, saveAiConfig } from "../../../src/ai/config.js";

const MARK = "[REDACTED:account-secret]";
/** Shapes no pattern knows: only registration can hide them. */
const API_KEY = "bedrock-api-key-7f3a9c2d41";
const SECRET = "saved/aws+secret/0123456789abcdefghij";
const TOKEN = "saved-session-token-5e8b1a77c3";

let tmp: string;
let dir: string;
let env: NodeJS.ProcessEnv;

beforeEach(async () => {
  clearAwsCredentialCache();
  tmp = await mkdtemp(join(tmpdir(), "runhound-ai-secrets-"));
  dir = join(tmp, "config");
  env = { RUNHOUND_CONFIG_DIR: dir };
});
afterEach(async () => {
  // Leave no registration behind for the next test: resolve an empty config.
  await rm(dir, { recursive: true, force: true });
  await resolveAiConfig({ env, home: tmp });
  await rm(tmp, { recursive: true, force: true });
});

async function writeSaved(value: Record<string, unknown>): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "ai.json"), JSON.stringify(value));
}

describe("resolveAiConfig registers the AI secrets", () => {
  it("registers the API key, secret access key and session token saved in ai.json", async () => {
    await writeSaved({ enabled: true, provider: "bedrock", region: "us-east-1", model: "m", apiKey: API_KEY, apiKeyOrigin: "https://bedrock-runtime.us-east-1.amazonaws.com", awsAccessKeyId: "AKIAIOSFODNN7SAVED01", awsSecretAccessKey: SECRET, awsSessionToken: TOKEN });
    await resolveAiConfig({ env, home: tmp });
    expect(redactSecrets(`key=${API_KEY} secret=${SECRET} token=${TOKEN}`)).toBe(`key=${MARK} secret=${MARK} token=${MARK}`);
    // Also in the encodings a page or a request would carry it (registerSecretLiterals' forms).
    expect(redactSecrets(encodeURIComponent(SECRET))).toBe(MARK);
  });

  it("registers the secrets it reads from the encrypted store, where saving puts them", async () => {
    await saveAiConfig({ enabled: true, provider: "bedrock", region: "us-east-1", model: "m", apiKey: API_KEY, awsAccessKeyId: "AKIAIOSFODNN7SAVED01", awsSecretAccessKey: SECRET, awsSessionToken: TOKEN }, { env, home: tmp });
    expect(await readFile(join(dir, "ai.json"), "utf8")).not.toContain(SECRET);
    // Drop the registration (an empty config dir), so only what the next resolve reads from the store can register.
    await resolveAiConfig({ env: { RUNHOUND_CONFIG_DIR: join(tmp, "empty") }, home: tmp });
    expect(redactSecrets(`key=${API_KEY} secret=${SECRET} token=${TOKEN}`)).toBe(`key=${API_KEY} secret=${SECRET} token=${TOKEN}`);
    await resolveAiConfig({ env, home: tmp });
    expect(redactSecrets(`key=${API_KEY} secret=${SECRET} token=${TOKEN}`)).toBe(`key=${MARK} secret=${MARK} token=${MARK}`);
  });

  it("registers the secrets it reads from the environment", async () => {
    await writeSaved({ provider: "bedrock", region: "us-east-1" });
    const fromEnv = { ...env, RUNHOUND_AI_API_KEY: "env-ai-key-19c4e2", AWS_BEARER_TOKEN_BEDROCK: "env-bearer-66a0d1", AWS_ACCESS_KEY_ID: "AKIAIOSFODNN7ENVKEY1", AWS_SECRET_ACCESS_KEY: "env/secret+value/0011223344", AWS_SESSION_TOKEN: "env-session-token-8f2b" };
    await resolveAiConfig({ env: fromEnv, home: tmp });
    for (const value of ["env-ai-key-19c4e2", "env-bearer-66a0d1", "env/secret+value/0011223344", "env-session-token-8f2b"]) {
      expect(redactSecrets(`v=${value}`), value).toBe(`v=${MARK}`);
    }
  });

  it("registers a saved key even when it does not apply (the endpoint moved)", async () => {
    await writeSaved({ enabled: true, provider: "openai-compatible", baseUrl: "https://api.example.com/v1", model: "m", apiKey: API_KEY, apiKeyOrigin: "https://api.example.com" });
    const r = await resolveAiConfig({ env: { ...env, RUNHOUND_AI_BASE_URL: "https://other.example.com/v1" }, home: tmp });
    expect(r.config.apiKey).toBeNull();
    expect(redactSecrets(API_KEY)).toBe(MARK);
  });

  it("replaces the previous call's registration: a removed key is no longer registered", async () => {
    await saveAiConfig({ provider: "openai-compatible", baseUrl: "https://api.example.com/v1", apiKey: API_KEY }, { env, home: tmp });
    expect(redactSecrets(API_KEY)).toBe(MARK);
    await saveAiConfig({ apiKey: null }, { env, home: tmp });
    expect(redactSecrets(API_KEY)).toBe(API_KEY);
  });

  // A short, ordinary-looking API key (a local-server placeholder) is never registered: registering it would redact
  // that word everywhere in Run Hound's own output, not just where the key belongs (docs/decisions 09-2026.md
  // #2026-09-30-ai-secrets-redacted). A real-looking key of the same length, or a short key that still mixes case and
  // digits, is registered as usual.
  it.each(["test", "none", "ollama", "lm-studio"])("does not register a short placeholder API key %j", async (placeholder) => {
    const resolved = await resolveAiConfig({ env: { ...env, RUNHOUND_AI_API_KEY: placeholder }, home: tmp });
    const spec = `import { test, expect } from "@playwright/test";\ntest("latest", async ({ page }) => {});\n`;
    expect(redactSecrets(spec)).toBe(spec);
    const status = aiStatus(resolved, { ...env, RUNHOUND_AI_API_KEY: placeholder }, tmp);
    expect(redactSecrets(`Provider: ${status.provider}`)).toBe(`Provider: ${status.provider}`);
  });

  it("still registers a real-looking API key even when it is short", async () => {
    await resolveAiConfig({ env: { ...env, RUNHOUND_AI_API_KEY: "aB3xQ9" }, home: tmp });
    expect(redactSecrets("key=aB3xQ9")).toBe(`key=${MARK}`);
  });

  it("still registers RUNHOUND_AI_API_KEY at or above 16 characters, plain or not", async () => {
    await resolveAiConfig({ env: { ...env, RUNHOUND_AI_API_KEY: "sixteencharacter" }, home: tmp });
    expect(redactSecrets("key=sixteencharacter")).toBe(`key=${MARK}`);
  });
});

describe("resolveAwsCredentials registers what it resolves", () => {
  it("registers the secret access key and session token of a named profile", async () => {
    await mkdir(join(tmp, ".aws"), { recursive: true });
    await writeFile(join(tmp, ".aws", "credentials"), "[work]\naws_access_key_id = AKIAWORKPROFILE00001\naws_secret_access_key = work/profile+secret/42\naws_session_token = work-profile-token-77\n");
    await resolveAwsCredentials({ env: {}, home: tmp, profile: "work" });
    expect(redactSecrets("s=work/profile+secret/42 t=work-profile-token-77")).toBe(`s=${MARK} t=${MARK}`);
  });
});

describe("a saved secret never reaches a run's files or log lines", () => {
  let site: FixtureServer;
  let runsDir: string;
  beforeAll(async () => {
    site = await startFixtureServer({ pages: { "/": `<!doctype html><html lang="en"><head><title>Echo</title></head><body><main><h1>Echo</h1><p id="p">${SECRET}</p></main></body></html>` } });
    runsDir = await mkdtemp(join(tmpdir(), "runhound-ai-secrets-runs-"));
  });
  afterAll(async () => {
    await site?.close();
    await rm(runsDir, { recursive: true, force: true });
  });

  it("keeps the saved secret access key out of report.json, report.md, report.html, the spec files and the log", async () => {
    await writeSaved({ provider: "bedrock", region: "us-east-1", awsAccessKeyId: "AKIAIOSFODNN7SAVED01", awsSecretAccessKey: SECRET, awsSessionToken: TOKEN });
    await resolveAiConfig({ env, home: tmp });
    const echo: Check = {
      id: "verbose-errors",
      title: "Echo",
      category: "security",
      scope: "page",
      plan: () => [{ id: "echo:1", checkId: "verbose-errors", title: "Echo", description: "Echoes the page", kind: "golden", priority: "medium", destructive: false, defaultSelected: true, scope: "page" }],
      async run(ctx, s): Promise<CheckResult> {
        const { page } = await ctx.openPage();
        const text = await page.locator("#p").innerText();
        ctx.log(`page says ${text} and ${TOKEN}`);
        return {
          checkId: "verbose-errors",
          scenarioId: s.id,
          status: "fail",
          durationMs: 1,
          notes: `saw ${text}`,
          findings: [
            {
              checkId: "verbose-errors",
              id: "verbose-errors#1",
              title: `Page shows ${text}`,
              severity: "high",
              category: "security",
              confidence: "confirmed",
              meaning: `It shows ${text}.`,
              impact: "x",
              fix: "x",
              evidence: [{ kind: "network", label: "echo", data: { text, token: TOKEN } }],
              spec: { filename: "echo.spec.ts", source: `expect(await page.content()).not.toContain(${JSON.stringify(text)});\n// ${TOKEN}\n` },
            },
          ],
        };
      },
    };
    const lines: string[] = [];
    const plan = await discoverAndPlan(`${site.url}/`, { checks: [echo], runsDir, log: (l) => lines.push(l) });
    const { dir: runDir } = await runPlan(plan, { checks: [echo], runsDir, log: (l) => lines.push(l) });
    const files = (await readdir(runDir, { recursive: true })).map(String).filter((f) => /\.(json|md|html|ts)$/.test(f));
    expect(files).toEqual(expect.arrayContaining(["report.json", "report.md", "report.html"]));
    expect(files.some((f) => f.endsWith(".spec.ts"))).toBe(true);
    for (const file of files) {
      const text = await readFile(join(runDir, file), "utf8");
      expect(text, file).not.toContain(SECRET);
      expect(text, file).not.toContain(TOKEN);
    }
    expect(lines.join("\n")).not.toContain(SECRET);
    expect(lines.join("\n")).not.toContain(TOKEN);
    expect(lines.join("\n")).toContain(MARK);
  });
});
