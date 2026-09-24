import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "../test-support/server.js";
import type { Report } from "../src/core/types.js";

const appDir = fileURLToPath(new URL("..", import.meta.url));

interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
  ms: number;
}

/** Runs `pnpm exec tsx src/cli.ts ...args` asynchronously (the fixture server lives in this process). */
function runCli(args: string[], timeoutMs = 240_000): Promise<CliResult> {
  const env = { ...process.env };
  delete env.RUNHOUND_ALLOWED_HOSTS;
  const started = Date.now();
  return new Promise((resolve) => {
    execFile(
      "pnpm",
      ["exec", "tsx", "src/cli.ts", ...args],
      { cwd: appDir, env, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === "number" ? error.code : null) : 0;
        resolve({ code, stdout: String(stdout), stderr: String(stderr), ms: Date.now() - started });
      },
    );
  });
}

/** A page with problems any reasonable check library reports: console error, failed request, horizontal overflow. */
const BROKEN_PAGE = `<!doctype html><html lang="en"><head><title>Broken</title>
<style>form { width: 900px; }</style></head><body>
<form id="booking">
  <h1>Book a sitter</h1>
  <label for="petName">Pet name</label><input id="petName" name="petName" required>
  <button type="submit">Book</button>
</form>
<script>console.error("broken on purpose"); fetch("/api/missing");</script>
</body></html>`;

const PLAIN_PAGE = `<!doctype html><html lang="en"><head><title>Plain</title></head><body>
<main><form id="booking" action="/thanks" method="get">
  <h1>Book a sitter</h1>
  <label for="petName">Pet name</label><input id="petName" name="petName">
  <button type="submit">Book</button>
</form></main></body></html>`;

let site: FixtureServer;
let runsDir: string;

beforeAll(async () => {
  site = await startFixtureServer({
    pages: {
      "/broken": BROKEN_PAGE,
      "/plain": PLAIN_PAGE,
      "/thanks": "<!doctype html><title>Thanks</title><p>Thanks</p>",
      "/empty": "<!doctype html><title>Empty</title><p>No form here.</p>",
    },
  });
});

afterAll(async () => {
  await site?.close();
});

beforeEach(async () => {
  runsDir = await mkdtemp(join(tmpdir(), "rh-cli-"));
});

afterEach(async () => {
  await rm(runsDir, { recursive: true, force: true });
});

function parseJsonReport(stdout: string): Report {
  const parsed = JSON.parse(stdout) as Report | { report: Report };
  return "report" in parsed ? parsed.report : parsed;
}

describe("run-hound run", () => {
  it("exits 2 for a public target without touching the network", async () => {
    const res = await runCli(["run", "http://8.8.8.8/", "--json", "--runs-dir", runsDir], 60_000);
    expect(res.code).toBe(2);
    expect(`${res.stderr}${res.stdout}`).toMatch(/refus|not allowed/i);
    expect(await readdir(runsDir)).toEqual([]);
  });

  it("exits 2 for a non-http target", async () => {
    const res = await runCli(["run", "file:///etc/passwd", "--json", "--runs-dir", runsDir], 60_000);
    expect(res.code).toBe(2);
    expect(await readdir(runsDir)).toEqual([]);
  });

  it("exits 2 without a URL", async () => {
    const res = await runCli(["run", "--runs-dir", runsDir], 60_000);
    expect(res.code).toBe(2);
  });

  it("exits 2 when the page has no form", async () => {
    const res = await runCli(["run", `${site.url}/empty`, "--json", "--runs-dir", runsDir], 120_000);
    expect(res.code).toBe(2);
    expect(`${res.stderr}${res.stdout}`).toMatch(/form/i);
  });

  it(
    "writes a report and exits 0 with no findings or 1 with findings (--json prints the report)",
    async () => {
      const res = await runCli(["run", `${site.url}/plain`, "--json", "--runs-dir", runsDir]);
      expect([0, 1], res.stderr).toContain(res.code);
      const report = parseJsonReport(res.stdout);
      expect(report.target).toBe(`${site.url}/plain`);
      expect(res.code).toBe(report.findings.length > 0 ? 1 : 0);
      expect(await readdir(runsDir)).toEqual([report.runId]);
      const onDisk = JSON.parse(await readFile(join(runsDir, report.runId, "report.json"), "utf8")) as Report;
      expect(onDisk.runId).toBe(report.runId);
      expect(onDisk.findings.length).toBe(report.findings.length);
    },
    300_000,
  );

  it(
    "exits 1 when the run has findings",
    async () => {
      const res = await runCli(["run", `${site.url}/broken`, "--approve", "all", "--json", "--runs-dir", runsDir]);
      expect(res.code, res.stderr).toBe(1);
      const report = parseJsonReport(res.stdout);
      expect(report.findings.length).toBeGreaterThan(0);
    },
    300_000,
  );
});

describe("run-hound help, version and bad input", () => {
  it("prints usage for help, --help and run --help, and exits 0", async () => {
    for (const args of [["help"], ["--help"], ["run", "--help"]]) {
      const res = await runCli(args, 60_000);
      expect(res.code, args.join(" ")).toBe(0);
      expect(res.stdout).toMatch(/Usage:/);
      expect(res.stdout).toMatch(/--plan-only/);
    }
  });

  it("prints the version", async () => {
    const res = await runCli(["--version"], 60_000);
    expect(res.code).toBe(0);
    expect(res.stdout).toMatch(/^run-hound \d+\.\d+\.\d+/);
  });

  it("exits 2 with usage for an unknown option", async () => {
    const res = await runCli(["run", "http://localhost:1/", "--nope"], 60_000);
    expect(res.code).toBe(2);
    expect(res.stderr).toMatch(/Usage:/);
  });

  it("explains an unreachable target in plain words (no Playwright call log)", async () => {
    const dead = await startFixtureServer({ pages: {} });
    const target = `${dead.url.replace(/^http:\/\//, "")}/book`;
    await dead.close();
    const res = await runCli(["run", target, "--runs-dir", runsDir], 120_000);
    expect(res.code).toBe(2);
    expect(res.stderr).toMatch(/Nothing is answering at http:\/\/127\.0\.0\.1:\d+/);
    expect(res.stderr).not.toMatch(/\u001b|Call log/);
  });
});

describe("run-hound run: what gets run", () => {
  it("--plan-only lists the scenario ids and runs nothing", async () => {
    const res = await runCli(["run", `${site.url}/plain`, "--plan-only", "--runs-dir", runsDir], 120_000);
    expect(res.code, res.stderr).toBe(0);
    expect(res.stdout).toMatch(/console-network-errors|golden|danger/);
    expect(await readdir(runsDir)).toEqual([]);
  });

  it("exits 2 for an approval that names no scenarios, instead of a clean-looking pass", async () => {
    const res = await runCli(["run", `${site.url}/plain`, "--approve", ",", "--runs-dir", runsDir], 120_000);
    expect(res.code).toBe(2);
    expect(res.stderr).toMatch(/no scenarios|nothing/i);
    expect(await readdir(runsDir)).toEqual([]);
  });
});
