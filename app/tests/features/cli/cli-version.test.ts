// Tester release (0.1.0): one version everywhere (docs/v0-spec.md, "Tester release").
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "../../support/server.js";
import type { Check, Report } from "../../../src/core/types.js";
import { discoverAndPlan, runPlan } from "../../../src/engine/runner.js";
import { createApp } from "../../../src/server/app.js";

const appDir = fileURLToPath(new URL("../../..", import.meta.url));
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

const REPO = join(appDir, "..");
const repoFile = (name: string) => readFileSync(join(REPO, name), "utf8");

describe("version (tester release)", () => {
  it("app/package.json has a version", () => {
    expect(PKG_VERSION).toMatch(/^\d+\.\d+\.\d+/);
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

// Mirror of .github/workflows/release-images.yml check-version job.
describe("release-images.yml's check-version, mirrored locally", () => {
  /** The check-version job's text in release-images.yml (from its key to the next job's), or "" when not found. */
  const CHECK_VERSION = (() => {
    const wf = repoFile(".github/workflows/release-images.yml");
    const start = wf.indexOf("\n  check-version:\n");
    const end = start < 0 ? -1 : wf.indexOf("\n  ci:\n", start);
    return end < 0 ? "" : wf.slice(start, end);
  })();

  const COMPOSE_FILES = ["run-hound.compose.yml", "docker-compose.yml"];
  const IMAGE_NAMES = ["run-hound", "run-hound-kennel", "run-hound-samples", "run-hound-fernway"];

  it("its loop walks the same compose files as release-images.yml's check-version", () => {
    expect(CHECK_VERSION, "release-images.yml has a check-version job followed by the ci job").not.toBe("");
    const loops = [...CHECK_VERSION.matchAll(/^[ \t]*for (\w+) in ([^;]*); do$/gm)].map((m) => [
      m[1],
      m[2]!.replace(/\\[ \t]*\n/g, " ").split(/\s+/).filter(Boolean),
    ]);
    expect(loops).toEqual([["file", COMPOSE_FILES]]);
  });

  it("its patterns are the ones this block mirrors", () => {
    const snippets = [
      'if [ "$tag" != "$pkg" ]; then',
      'for e in "${expected[@]}"; do [ "$image" = "$e" ] && ok=1 && break; done',
      String.raw`sed -E 's/^[[:space:]]*image:[[:space:]]*//'`,
      String.raw`grep -noE 'image:[[:space:]]*[^[:space:]#]+' "$file"`,
      String.raw`$1 == "##" { h = $2; sub(/,$/, "", h); if (h == v) { found = 1; exit } }`,
    ];
    for (const snippet of snippets) expect(CHECK_VERSION, snippet).toContain(snippet);
  });

  it("run-hound.compose.yml's and docker-compose.yml's four images are each exactly one of the four expected values", () => {
    const expectedByFile: Record<string, string[]> = {
      "run-hound.compose.yml": IMAGE_NAMES.map((name) => `ghcr.io/rahul-bharati/${name}:\${RUNHOUND_TAG:-latest}`),
      "docker-compose.yml": IMAGE_NAMES.map((name) => `ghcr.io/rahul-bharati/${name}:local`),
    };
    for (const file of COMPOSE_FILES) {
      const images = [...repoFile(file).matchAll(/^\s*image:\s*(\S+)/gm)].map((m) => m[1]!);
      expect([...images].sort(), file).toEqual([...expectedByFile[file]!].sort());
    }
  });

  // Between releases, Unreleased holds the next version's changes.
  it('CHANGELOG.md documents app/package.json\'s version: a dated "## <version>" section, or "## Unreleased" when it has none yet', () => {
    const changelog = repoFile("CHANGELOG.md");
    const heading = changelog.split("\n").find((l) => l.startsWith(`## ${PKG_VERSION} `));
    if (!heading) {
      expect(changelog, `no "## ${PKG_VERSION}" section yet, and no "## Unreleased" either`).toMatch(/^## Unreleased$/m);
    }
  });

  it("site.ts's released and releasedIso are the same day, and match the CHANGELOG heading of site.ts's version", () => {
    const site = repoFile("site/src/lib/site.ts");
    const siteVersion = /^const version = "([^"]+)";/m.exec(site)?.[1];
    const released = /^\s*released: "([^"]+)",/m.exec(site)?.[1];
    const releasedIso = /^\s*releasedIso: "([^"]+)",/m.exec(site)?.[1];
    expect(siteVersion, 'site.ts has `const version = "…";`').toBeDefined();
    expect(released, 'site.ts has `released: "…",`').toBeDefined();
    expect(releasedIso, 'site.ts has `releasedIso: "…",`').toBeDefined();
    // Pre-releases (X.Y.Z-rc.1) are skipped: site/src/lib/version-line.test.ts only allows a plain X.Y.Z there.
    if (!PKG_VERSION.includes("-")) {
      expect(siteVersion, "site.ts's version is app/package.json's").toBe(PKG_VERSION);
    }
    const [y, m, d] = releasedIso!.split("-").map(Number);
    const shown = new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
    expect(shown, "released and releasedIso are the same day").toBe(released);
    const heading = repoFile("CHANGELOG.md").split("\n").find((l) => l.startsWith(`## ${siteVersion} `));
    expect(heading, `CHANGELOG.md has a "## ${siteVersion}" heading`).toBeDefined();
    expect(heading).toContain(released);
  });
});
