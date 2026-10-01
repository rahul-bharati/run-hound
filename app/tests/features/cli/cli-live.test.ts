import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "../test-support/server.js";
import type { Report } from "../src/core/types.js";

const appDir = fileURLToPath(new URL("..", import.meta.url));

interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], timeoutMs = 240_000): Promise<CliResult> {
  const env = { ...process.env };
  delete env.RUNHOUND_ALLOWED_HOSTS;
  return new Promise((resolve) => {
    execFile(
      "pnpm",
      ["exec", "tsx", "src/cli.ts", ...args],
      { cwd: appDir, env, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === "number" ? error.code : null) : 0;
        resolve({ code, stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

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
    pages: { "/plain": PLAIN_PAGE, "/thanks": "<!doctype html><title>Thanks</title><p>Thanks</p>" },
  });
});

afterAll(async () => {
  await site?.close();
});

beforeEach(async () => {
  runsDir = await mkdtemp(join(tmpdir(), "rh-cli-live-"));
});

afterEach(async () => {
  await rm(runsDir, { recursive: true, force: true });
});

describe("run-hound run --headed", () => {
  it("documents --headed in the usage text", async () => {
    const res = await runCli(["--help"], 60_000);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("--headed");
  });

  it("accepts --headed (a refused target still exits 2 for the target, not for the flag)", async () => {
    // A public target is refused before any browser opens, so no window appears.
    const res = await runCli(["run", "http://8.8.8.8/", "--headed", "--json", "--runs-dir", runsDir], 60_000);
    expect(res.code).toBe(2);
    expect(res.stderr).not.toMatch(/unknown option|unexpected argument/i);
    expect(res.stderr).toMatch(/refus|not allowed/i);
    expect(await readdir(runsDir)).toEqual([]);
  });
});

describe("run-hound run progress", () => {
  it(
    "prints what each scenario is doing, with the page URL, to stderr and lists pagesVisited in the report",
    async () => {
      const target = `${site.url}/plain`;
      const res = await runCli(["run", target, "--approve", "golden-path", "--json", "--runs-dir", runsDir]);
      expect([0, 1], res.stderr).toContain(res.code);

      const lines = res.stderr.split("\n");
      const start = lines.findIndex((l) => /\[1\/1\]\s+golden-path/.test(l));
      expect(start, res.stderr).toBeGreaterThanOrEqual(0);
      // After the scenario starts, at least one progress line names the page being tested.
      const after = lines.slice(start + 1);
      expect(after.some((l) => l.includes(target)), res.stderr).toBe(true);

      // stdout stays exactly one JSON document.
      const report = JSON.parse(res.stdout) as Report;
      expect(report.pagesVisited?.map((p) => p.url)).toContain(target);
      expect(report.pagesVisited?.find((p) => p.url === target)?.scenarioIds).toContain("golden-path");
    },
    300_000,
  );
});
