import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startFakeLlm, type FakeLlm } from "../test-support/fake-llm.js";
import { startFixtureServer, type FixtureServer } from "../test-support/server.js";
import type { Plan } from "../src/core/types.js";

/**
 * CLI surfaces of the AI layer (docs/ai-spec.md "Surfaces" → CLI).
 *
 * Interpretations pinned here:
 * - `run-hound ai status` prints the resolved status (provider, model, base URL/host, problem) on stdout, exit 0,
 *   never the key. `run-hound ai test` runs testConnection: exit 0 and "ok" on success, exit 1 on failure.
 * - `run … --ai` against a remote endpoint without --ai-allow-remote: exit 2 before anything is sent, stderr says
 *   consent is needed and names the host.
 * - `run … --plan-only --ai` prints each reviewed scenario's rationale and the "Suggested by AI" scenarios (ids
 *   ai-flow:<n>), and model warnings on stderr.
 * - The review call is made before the suggest call (the fake answers from a queue).
 */

const appDir = fileURLToPath(new URL("..", import.meta.url));

interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

let configDir: string;

function runCli(args: string[], extraEnv: NodeJS.ProcessEnv = {}, timeoutMs = 240_000): Promise<CliResult> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith("RUNHOUND_AI") || k.startsWith("AWS_")) delete env[k];
  delete env.RUNHOUND_ALLOWED_HOSTS;
  Object.assign(env, { RUNHOUND_CONFIG_DIR: configDir }, extraEnv);
  return new Promise((resolve) => {
    execFile("pnpm", ["exec", "tsx", "src/cli.ts", ...args], { cwd: appDir, env, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === "number" ? error.code : null) : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

const FORM_PAGE = `<!doctype html><html lang="en"><head><title>CLI AI</title></head><body>
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

const SECRET = "sk-cli-secret-0123456789abcdef";

let site: FixtureServer;
let fake: FakeLlm;

beforeAll(async () => {
  site = await startFixtureServer({ pages: { "/book": FORM_PAGE }, routes: { "POST /api/bookings": (_q, r) => { r.writeHead(201).end("{}"); } } });
  fake = await startFakeLlm({ models: [{ id: "fake-model:9b", capabilities: ["completion"] }] });
});

afterAll(async () => {
  await site?.close();
  await fake?.close();
});

beforeEach(async () => {
  configDir = await mkdtemp(join(tmpdir(), "rh-cli-ai-"));
  fake.calls.length = 0;
  fake.reply({ ok: true });
});

afterEach(async () => {
  await rm(configDir, { recursive: true, force: true });
});

const localEnv = (): NodeJS.ProcessEnv => ({
  RUNHOUND_AI: "1",
  RUNHOUND_AI_PROVIDER: "ollama",
  RUNHOUND_AI_BASE_URL: fake.baseUrl,
  RUNHOUND_AI_MODEL: "fake-model:9b",
  RUNHOUND_AI_API_KEY: SECRET,
});

describe("run-hound ai status", () => {
  it("says AI is off by default", async () => {
    const r = await runCli(["ai", "status"]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/AI is off/);
    expect(r.stdout).toMatch(/ollama/);
  });

  it("prints provider, model and endpoint, never the key", async () => {
    const r = await runCli(["ai", "status"], localEnv());
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain("ollama");
    expect(r.stdout).toContain("fake-model:9b");
    expect(r.stdout).toContain("127.0.0.1");
    expect(r.stdout).not.toMatch(/AI is off/);
    expect(`${r.stdout}${r.stderr}`).not.toContain(SECRET);
  });

  it("names the consent problem for a remote endpoint", async () => {
    const r = await runCli(["ai", "status"], {
      RUNHOUND_AI: "1",
      RUNHOUND_AI_PROVIDER: "openai-compatible",
      RUNHOUND_AI_BASE_URL: "https://api.example.com/v1",
      RUNHOUND_AI_MODEL: "m",
    });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/consent/i);
    expect(r.stdout).toContain("api.example.com");
  });
});

describe("run-hound ai test", () => {
  it("prints ok for a working local endpoint", async () => {
    const r = await runCli(["ai", "test"], localEnv());
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/\bok\b/i);
    expect(fake.calls.length).toBeGreaterThanOrEqual(1);
    expect(`${r.stdout}${r.stderr}`).not.toContain(SECRET);
  });

  it("fails with the reason when the endpoint refuses", async () => {
    fake.reply({ status: 401, body: '{"error":"bad key"}' });
    const r = await runCli(["ai", "test"], localEnv());
    expect(r.code).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).not.toBe("");
    expect(`${r.stdout}${r.stderr}`).not.toContain(SECRET);
  });
});

describe("run --ai", () => {
  it("refuses a remote endpoint without consent: exit 2, nothing sent", async () => {
    const r = await runCli([
      "run",
      `${site.url}/book`,
      "--ai",
      "--ai-provider",
      "openai-compatible",
      "--ai-base-url",
      "https://api.example.com/v1",
      "--ai-model",
      "m",
      "--plan-only",
    ]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/consent|--ai-allow-remote/i);
    expect(r.stderr).toContain("api.example.com");
  });

  it("--plan-only --ai shows the rationales and the suggested scenarios", async () => {
    // Learn the built-in scenario ids first (AI off: nothing is sent).
    const base = await runCli(["run", `${site.url}/book`, "--plan-only", "--json"]);
    expect(base.code, base.stderr).toBe(0);
    const plan = JSON.parse(base.stdout) as Plan;
    expect(plan.ai).toBeUndefined();
    expect(fake.calls).toHaveLength(0);
    const [first, second] = plan.scenarios;
    fake.reply(
      {
        scenarios: [
          { id: first!.id, recommended: true, priority: "high", rationale: "Rationale alpha: this matters most on a booking form." },
          { id: second!.id, recommended: false, priority: "low", rationale: "Rationale beta: less likely to matter here." },
        ],
      },
      {
        suggestions: [
          {
            title: "Book Rex the dog",
            rationale: "Booking is the main job.",
            form: 0,
            steps: [
              { action: "fill", field: "petName", value: "Rex" },
              { action: "fill", field: "email", value: "rex@example.com" },
              { action: "click", control: 0 },
              { action: "expect", expect: "request-ok", text: null },
            ],
          },
        ],
      },
    );

    const r = await runCli([
      "run",
      `${site.url}/book`,
      "--plan-only",
      "--ai",
      "--ai-provider",
      "ollama",
      "--ai-base-url",
      fake.baseUrl,
      "--ai-model",
      "fake-model:9b",
    ]);
    expect(r.code, r.stderr).toBe(0);
    expect(fake.calls.length).toBeGreaterThanOrEqual(2);
    const out = r.stdout;
    expect(out).toContain("Rationale alpha");
    expect(out).toContain("Rationale beta");
    expect(out).toContain("ai-flow:1");
    expect(out).toContain("Book Rex the dog");
    expect(`${out}${r.stderr}`).toMatch(/fake-model:9b/);
  });

  it("--plan-only --json --ai carries plan.ai", async () => {
    fake.reply({ raw: "not json" });
    const r = await runCli([
      "run",
      `${site.url}/book`,
      "--plan-only",
      "--json",
      "--ai",
      "--ai-provider",
      "ollama",
      "--ai-base-url",
      fake.baseUrl,
      "--ai-model",
      "fake-model:9b",
    ]);
    expect(r.code, r.stderr).toBe(0);
    const plan = JSON.parse(r.stdout) as Plan;
    expect(plan.ai?.model).toBe("fake-model:9b");
    expect(plan.ai?.warnings.length).toBeGreaterThan(0);
    // The warning is shown to the person too.
    expect(r.stderr).toMatch(/warning/i);
  });
});
