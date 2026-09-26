/**
 * Tester release (0.1.0): one version everywhere (docs/v0-spec.md, "Tester release").
 * `run-hound --version` and `run-hound run --version` print the version from app/package.json, the report's
 * runHoundVersion matches it, and the web UI shows it.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "../test-support/server.js";
import type { Check, Report } from "../src/core/types.js";
import { discoverAndPlan, runPlan } from "../src/engine/runner.js";
import { createApp } from "../src/server/app.js";

const appDir = fileURLToPath(new URL("..", import.meta.url));
const PKG_VERSION = (JSON.parse(await readFile(join(appDir, "package.json"), "utf8")) as { version: string }).version;

function runCli(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile("pnpm", ["exec", "tsx", "src/cli.ts", ...args], { cwd: appDir, timeout: 60_000 }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === "number" ? error.code : null) : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

const FORM_PAGE = `<!doctype html><html lang="en"><head><title>Version</title></head><body>
<form id="booking"><label for="petName">Pet name</label><input id="petName" name="petName"><button type="submit">Book</button></form>
</body></html>`;

const passing: Check = {
  id: "dead-control",
  title: "Fake passing check",
  category: "broken-feature",
  plan: () => [
    { id: "dc:fake", checkId: "dead-control", title: "Fake", description: "fake", kind: "golden", priority: "low", destructive: false, defaultSelected: true },
  ],
  run: async (_ctx, s) => ({ checkId: "dead-control", scenarioId: s.id, status: "pass", findings: [], durationMs: 1 }),
};

describe("version (tester release)", () => {
  it("package.json says 0.4.0 (V2 preview: signed-in runs and access checks)", () => {
    expect(PKG_VERSION).toBe("0.4.0");
  });

  it.each([[["--version"]], [["run", "--version"]]])("`run-hound %s` prints exactly the package version and exits 0", async (args) => {
    const res = await runCli(args);
    expect(res.code, res.stderr).toBe(0);
    expect(res.stdout.trim()).toBe(`run-hound ${PKG_VERSION}`);
  }, 60_000);

  describe("report and UI", () => {
    let site: FixtureServer;
    let runsDir: string;
    beforeAll(async () => {
      site = await startFixtureServer({ pages: { "/book": FORM_PAGE } });
      runsDir = await mkdtemp(join(tmpdir(), "rh-version-"));
    });
    afterAll(async () => {
      await site?.close();
      await rm(runsDir, { recursive: true, force: true });
    });

    it("report.runHoundVersion equals the package version, in report.json and the rendered reports", async () => {
      const plan = await discoverAndPlan(`${site.url}/book`, { checks: [passing] });
      const { report, dir } = await runPlan(plan, { checks: [passing], runsDir, log: () => undefined });
      expect(report.runHoundVersion).toBe(PKG_VERSION);
      const onDisk = JSON.parse(await readFile(join(dir, "report.json"), "utf8")) as Report;
      expect(onDisk.runHoundVersion).toBe(PKG_VERSION);
      expect(await readFile(join(dir, "report.md"), "utf8")).toContain(PKG_VERSION);
      expect(await readFile(join(dir, "report.html"), "utf8")).toContain(PKG_VERSION);
    }, 120_000);

    it("the web UI page shows the version in its footer", async () => {
      const app = createApp({ runsDir, checks: [passing] });
      const res = await app.request("/");
      expect(res.status).toBe(200);
      const html = await res.text();
      const footer = /<footer[\s\S]*?<\/footer>/i.exec(html)?.[0] ?? "";
      expect(footer, "the UI has a <footer>").not.toBe("");
      expect(footer).toContain(PKG_VERSION);
    });
  });
});
