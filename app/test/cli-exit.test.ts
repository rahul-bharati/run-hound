/**
 * Tester release (0.1.0) exit codes for `run-hound run` (docs/v0-spec.md, "Tester release"):
 *   0  no confirmed findings (advisory findings are reported but don't fail the run)
 *   1  at least one confirmed finding
 *   2  an error or a refused target
 *
 * The real CLI runs end to end. The check library is swapped for fake checks by a test-only preload
 * (test/fixtures/cli-exit/fake-checks-hook.mjs, loaded through NODE_OPTIONS=--import), so each case controls exactly
 * which findings the run produces. RH_FAKE_FINDINGS picks them: none | advisory | confirmed | mixed | skipped.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "../test-support/server.js";
import type { Report } from "../src/core/types.js";

const appDir = fileURLToPath(new URL("..", import.meta.url));
const HOOK = fileURLToPath(new URL("./fixtures/cli-exit/fake-checks-hook.mjs", import.meta.url));

type FakeMode = "none" | "advisory" | "confirmed" | "mixed" | "skipped";

interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], fake: FakeMode | null, timeoutMs = 120_000): Promise<CliResult> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.RUNHOUND_ALLOWED_HOSTS;
  if (fake) {
    env.RH_FAKE_FINDINGS = fake;
    env.NODE_OPTIONS = [process.env.NODE_OPTIONS, `--import ${HOOK}`].filter(Boolean).join(" ");
  }
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

const FORM_PAGE = `<!doctype html><html lang="en"><head><title>Exit codes</title></head><body>
<main><form id="booking">
  <h1>Book a sitter</h1>
  <label for="petName">Pet name</label><input id="petName" name="petName" required>
  <button type="submit">Book</button>
</form></main></body></html>`;

let site: FixtureServer;
let runsDir: string;

beforeAll(async () => {
  site = await startFixtureServer({ pages: { "/book": FORM_PAGE } });
});

afterAll(async () => {
  await site?.close();
});

beforeEach(async () => {
  runsDir = await mkdtemp(join(tmpdir(), "rh-cli-exit-"));
});

afterEach(async () => {
  await rm(runsDir, { recursive: true, force: true });
});

function parseJsonReport(stdout: string): Report {
  const parsed = JSON.parse(stdout) as Report | { report: Report };
  return "report" in parsed ? parsed.report : parsed;
}

async function run(fake: FakeMode, json = true) {
  const res = await runCli(["run", `${site.url}/book`, "--approve", "all", ...(json ? ["--json"] : []), "--runs-dir", runsDir], fake);
  return { res, report: json && res.stdout.trim() ? parseJsonReport(res.stdout) : null };
}

describe("run-hound run exit codes (tester release)", () => {
  it("the fake check library is in use (sanity check for the preload)", async () => {
    const { res, report } = await run("mixed");
    expect(res.code === 0 || res.code === 1, res.stderr).toBe(true);
    expect(report!.plan.scenarios.map((s) => s.id).sort()).toEqual(["dead-control:fake", "silent-failure:fake"]);
    expect(report!.findings.map((f) => f.confidence).sort()).toEqual(["advisory", "confirmed"]);
  }, 180_000);

  it("exits 0 when nothing is found", async () => {
    const { res, report } = await run("none");
    expect(res.code, res.stderr).toBe(0);
    expect(report!.findings).toEqual([]);
  }, 180_000);

  it("exits 0 when the only findings are advisory, and still reports them", async () => {
    const { res, report } = await run("advisory");
    expect(res.code, res.stderr).toBe(0);
    expect(report!.findings).toHaveLength(1);
    expect(report!.findings[0]!.confidence).toBe("advisory");
    // Reported, not hidden: the report on disk has it too.
    expect(await readdir(runsDir)).toEqual([report!.runId]);
  }, 180_000);

  it("exits 0 for advisory-only findings without --json too, and the text output still lists them", async () => {
    const { res } = await run("advisory", false);
    expect(res.code, res.stderr).toBe(0);
    expect(res.stdout).toMatch(/Fake advisory finding/);
  }, 180_000);

  it("exits 1 when there is a confirmed finding", async () => {
    const { res, report } = await run("confirmed");
    expect(res.code, res.stderr).toBe(1);
    expect(report!.findings.some((f) => f.confidence === "confirmed")).toBe(true);
  }, 180_000);

  it("exits 1 when confirmed and advisory findings are mixed", async () => {
    const { res } = await run("mixed");
    expect(res.code, res.stderr).toBe(1);
  }, 180_000);

  it("prints a skipped scenario's reason once, without repeating \"skipped\"", async () => {
    const { res } = await run("skipped", false);
    expect(res.code, res.stderr).toBe(0);
    // The result line ends with the scenario's duration (docs/v0-spec.md, "Groups and timing").
    expect(res.stderr).toMatch(/^ {2}skipped: the fake form has nothing to check\. · (?:\d+\.\d s|\d+ s|\d+ min(?: \d+ s)?|\d+ h(?: \d+ min)?)$/m);
    expect(res.stderr).not.toMatch(/skipped: Skipped/i);
    expect(res.stderr).toMatch(/with 1 field; 2 scenarios planned\./);
  }, 180_000);

  it.each([
    ["a public address", "http://8.8.8.8/"],
    ["0.0.0.0", "http://0.0.0.0:1/"],
    ["carrier-grade NAT (100.64/10)", "http://100.64.0.1/"],
  ])("exits 2 for a refused target (%s) and writes no run folder", async (_what, url) => {
    const res = await runCli(["run", url, "--approve", "all", "--json", "--runs-dir", runsDir], "confirmed");
    expect(res.code).toBe(2);
    expect(`${res.stderr}${res.stdout}`).toMatch(/refus|not allowed/i);
    expect(await readdir(runsDir)).toEqual([]);
  }, 120_000);

  it("exits 2 when the target doesn't answer", async () => {
    const dead = await startFixtureServer({ pages: {} });
    const url = `${dead.url}/book`;
    await dead.close();
    const res = await runCli(["run", url, "--approve", "all", "--runs-dir", runsDir], "confirmed");
    expect(res.code).toBe(2);
  }, 120_000);

  it("documents the exit codes in the usage text", async () => {
    const res = await runCli(["run", "--help"], null, 60_000);
    expect(res.code).toBe(0);
    expect(res.stdout).toMatch(/0[^\n]*no confirmed findings/i);
    expect(res.stdout).toMatch(/advisory/i);
  }, 60_000);
});
