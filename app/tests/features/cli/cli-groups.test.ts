/**
 * Groups and timing in the CLI (docs/v0-spec.md, "Groups and timing"). The real CLI runs end to end with the check
 * library swapped for fake checks by a test-only preload (test/fixtures/cli-groups/fake-checks-hook.mjs).
 */
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "../test-support/server.js";
import type { Report } from "../src/core/types.js";

const appDir = fileURLToPath(new URL("..", import.meta.url));
const HOOK = fileURLToPath(new URL("./fixtures/cli-groups/fake-checks-hook.mjs", import.meta.url));

interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], timeoutMs = 120_000): Promise<CliResult> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.RUNHOUND_ALLOWED_HOSTS;
  env.NODE_OPTIONS = [process.env.NODE_OPTIONS, `--import ${HOOK}`].filter(Boolean).join(" ");
  return new Promise((resolve) => {
    execFile("pnpm", ["exec", "tsx", "src/cli.ts", ...args], { cwd: appDir, env, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === "number" ? error.code : null) : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

const FORM_PAGE = `<!doctype html><html lang="en"><head><title>Groups</title></head><body>
<main><form id="booking">
  <h1>Book a sitter</h1>
  <label for="petName">Pet name</label><input id="petName" name="petName" required>
  <button type="submit">Book</button>
</form></main></body></html>`;

/** Groups of the fake check library, in run order. */
const GROUPS = [
  { label: "Accessibility", ids: ["axe:fake", "fv:fake"] },
  { label: "Features", ids: ["dc:fake", "cov:fake"] },
  { label: "Security", ids: ["bs:fake"] },
];
/** Scenario durations the fake checks report, in run order, as formatDuration prints them. */
const DURATIONS = ["1.2 s", "2.5 s", "1.5 s", "42 s", "1 min 12 s"];
/** Any formatDuration output. */
const DURATION = String.raw`(?:\d+\.\d s|\d+ s|\d+ min(?: \d+ s)?|\d+ h(?: \d+ min)?)`;

let site: FixtureServer;
let runsDir: string;

beforeAll(async () => {
  site = await startFixtureServer({ pages: { "/book": FORM_PAGE } });
});

afterAll(async () => {
  await site?.close();
});

beforeEach(async () => {
  runsDir = await mkdtemp(join(tmpdir(), "rh-cli-groups-"));
});

afterEach(async () => {
  await rm(runsDir, { recursive: true, force: true });
});

/** Index of the first line that starts with the group label (after any decoration such as "==" or "#"). */
function headingLine(lines: string[], label: string): number {
  return lines.findIndex((l) => new RegExp(`^[^\\w]*${label}\\b`).test(l));
}

describe("run-hound run: groups and timing", () => {
  it("--plan-only prints the group headings in order, each with its scenario count, and the scenarios under them", async () => {
    const res = await runCli(["run", `${site.url}/book`, "--plan-only", "--runs-dir", runsDir]);
    expect(res.code, res.stderr).toBe(0);
    const lines = res.stdout.split("\n");
    const at = GROUPS.map((g) => headingLine(lines, g.label));
    for (const [i, g] of GROUPS.entries()) {
      expect(at[i], `heading for ${g.label}\n${res.stdout}`).toBeGreaterThan(-1);
      expect(lines[at[i]!], `${g.label} heading shows its count`).toMatch(new RegExp(`\\b${g.ids.length}\\b`));
      const next = at[i + 1] ?? lines.length;
      for (const id of g.ids) {
        const line = lines.findIndex((l) => l.includes(id));
        expect(line, `${id} is listed under ${g.label}\n${res.stdout}`).toBeGreaterThan(at[i]!);
        expect(line, `${id} is listed under ${g.label}\n${res.stdout}`).toBeLessThan(next);
      }
    }
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  }, 180_000);

  it("--plan-only --json prints the plan with its groups", async () => {
    const res = await runCli(["run", `${site.url}/book`, "--plan-only", "--json", "--runs-dir", runsDir]);
    expect(res.code, res.stderr).toBe(0);
    const plan = JSON.parse(res.stdout) as Report["plan"];
    expect(plan.groups.map((g) => [g.label, g.scenarioIds])).toEqual(GROUPS.map((g) => [g.label, g.ids]));
  }, 180_000);

  it("a run prints a heading per group, each scenario result line ends with its duration, and the summary starts with \"Finished in\"", async () => {
    const res = await runCli(["run", `${site.url}/book`, "--approve", "all", "--runs-dir", runsDir]);
    expect(res.code, res.stderr).toBe(0);
    const lines = res.stderr.split("\n");

    // A heading per group, in order, before that group's first scenario.
    const at = GROUPS.map((g) => headingLine(lines, g.label));
    for (const [i, g] of GROUPS.entries()) {
      expect(at[i], `heading for ${g.label}\n${res.stderr}`).toBeGreaterThan(-1);
      const first = lines.findIndex((l) => l.includes(g.ids[0]!));
      expect(first, `${g.ids[0]} is announced\n${res.stderr}`).toBeGreaterThan(at[i]!);
      const last = lines.findIndex((l) => l.includes(g.ids.at(-1)!));
      expect(last, `${g.ids.at(-1)} comes before the next heading`).toBeLessThan(at[i + 1] ?? lines.length);
    }
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    for (const g of GROUPS) expect(lines.filter((l) => new RegExp(`^[^\\w]*${g.label}\\b`).test(l)), `one heading for ${g.label}`).toHaveLength(1);

    // Each scenario's result line ends with its duration.
    const resultLines = lines.filter((l) => /^\s+(pass|fail|error|skipped)\b/.test(l));
    expect(resultLines, res.stderr).toHaveLength(DURATIONS.length);
    for (const [i, line] of resultLines.entries()) {
      expect(line).toMatch(new RegExp(`${DURATION}\\)?$`));
      expect(line.endsWith(DURATIONS[i]!) || line.endsWith(`${DURATIONS[i]!})`), `${line} ends with ${DURATIONS[i]}`).toBe(true);
    }

    // The summary starts with the run's duration.
    expect(res.stdout).toMatch(new RegExp(`^Finished in ${DURATION}\\b`));
  }, 180_000);

  it("--json prints one report with durationMs and groups", async () => {
    const res = await runCli(["run", `${site.url}/book`, "--approve", "all", "--json", "--runs-dir", runsDir]);
    expect(res.code, res.stderr).toBe(0);
    const report = JSON.parse(res.stdout) as Report;
    expect(report.durationMs).toBeGreaterThan(0);
    expect(report.groups.map((g) => [g.label, g.scenarioIds, g.durationMs])).toEqual([
      ["Accessibility", ["axe:fake", "fv:fake"], 3_700],
      ["Features", ["dc:fake", "cov:fake"], 43_500],
      ["Security", ["bs:fake"], 72_000],
    ]);
  }, 180_000);
});
