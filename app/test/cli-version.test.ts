/**
 * Tester release (0.1.0): one version everywhere (docs/v0-spec.md, "Tester release").
 * `run-hound --version` and `run-hound run --version` print the version from app/package.json, the report's
 * runHoundVersion matches it, and the web UI shows it.
 * Release 0.6.0: that version is also the one wherever release-images.yml's check-version job looks, so a v0.6.0 tag
 * passes it, and the site's release date and the CHANGELOG heading name the same day.
 */
import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
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

/** The release this branch ships, and the day it is released (site/src/lib/site.ts `released` and `releasedIso`). */
const RELEASE = "0.6.0";
const RELEASED = { text: "27 September 2026", iso: "2026-09-27" };

const REPO = join(appDir, "..");
const repoFile = (name: string) => readFileSync(join(REPO, name), "utf8");
/** Every match of `re` (a global regex) in `text`, with its 1-based line number, like `grep -no`. */
function grepNo(text: string, re: RegExp): { line: number; ref: string }[] {
  return text.split("\n").flatMap((l, i) => [...l.matchAll(re)].map((m) => ({ line: i + 1, ref: m[0] })));
}

describe("version (tester release)", () => {
  it("package.json says 0.6.0 (V2 preview: write-side checks and sign-in)", () => {
    expect(PKG_VERSION).toBe(RELEASE);
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

/**
 * The same checks as the check-version job of .github/workflows/release-images.yml, run for RELEASE: the tag must
 * match app/package.json, the site, every image in both compose files, the version numbers in the comments of the
 * Dockerfiles, the compose files and .env.example, and every tag-pinned download link in the compose file headers,
 * README.md, TESTING.md and the guides in docs/. The file lists, image names and patterns below are the workflow's;
 * the first two tests read them back from release-images.yml, so a change to the job fails here until this mirror
 * follows it.
 */
describe(`release ${RELEASE}: one version wherever release-images.yml's check-version looks`, () => {
  /** The check-version job's text in release-images.yml (from its key to the next job's), or "" when not found. */
  const CHECK_VERSION = (() => {
    const wf = repoFile(".github/workflows/release-images.yml");
    const start = wf.indexOf("\n  check-version:\n");
    const end = start < 0 ? -1 : wf.indexOf("\n  ci:\n", start);
    return end < 0 ? "" : wf.slice(start, end);
  })();

  /** The job's loops, in order: `for file in … ; do` (compose images), `for image in $images`, `for name in …`
   * (run-hound.compose.yml has each image), the comment loop and the download-link loop. */
  const COMPOSE_FILES = ["run-hound.compose.yml", "docker-compose.yml"];
  const IMAGE_NAMES = ["run-hound", "run-hound-kennel", "run-hound-samples", "run-hound-fernway"];
  const COMMENT_FILES = ["app/Dockerfile", "fixtures/*/Dockerfile", "docker-compose.yml", "run-hound.compose.yml", ".env.example"];
  const LINK_FILES = [
    "run-hound.compose.yml",
    "docker-compose.yml",
    "README.md",
    "TESTING.md",
    "docs/install.md",
    "docs/usage.md",
    "docs/ai.md",
    "docs/signed-in-runs.md",
    "docs/ai-built-apps.md",
    "docs/security.md",
    "docs/development.md",
  ];

  /** The job's grep -E patterns, verbatim (these ERE patterns mean the same in JavaScript). */
  const VERSION_SRC = String.raw`[0-9]+\.[0-9]+\.[0-9]+[0-9A-Za-z.-]*`;
  const COMMENT_REF_SRC = String.raw`(run-hound(-[a-z]+)?:|Run Hound \(?)v?` + VERSION_SRC;
  const LINK_HOST_SRC = String.raw`(raw\.githubusercontent\.com/rahul-bharati/run-hound|github\.com/rahul-bharati/run-hound/(blob|tree|raw))`;
  const LINK_TAIL_SRC = `/v?${VERSION_SRC}/`;

  /** A path from a shell loop, with a `dir/*\/rest` glob expanded the way bash does (sorted, no dot directories). */
  function expand(pattern: string): string[] {
    const star = pattern.indexOf("/*/");
    if (star < 0) return [pattern];
    const dir = pattern.slice(0, star);
    const rest = pattern.slice(star + 3);
    return readdirSync(join(REPO, dir))
      .filter((name) => !name.startsWith("."))
      .sort()
      .map((name) => `${dir}/${name}/${rest}`)
      .filter((file) => existsSync(join(REPO, file)));
  }

  it("its loops walk the same files and image names as release-images.yml's check-version", () => {
    expect(CHECK_VERSION, "release-images.yml has a check-version job followed by the ci job").not.toBe("");
    const loops = [...CHECK_VERSION.matchAll(/^[ \t]*for (\w+) in ([^;]*); do$/gm)].map((m) => [
      m[1],
      m[2]!.replace(/\\[ \t]*\n/g, " ").split(/\s+/).filter(Boolean),
    ]);
    expect(loops).toEqual([
      ["file", COMPOSE_FILES],
      ["image", ["$images"]],
      ["name", IMAGE_NAMES],
      ["file", COMMENT_FILES],
      ["file", LINK_FILES],
    ]);
  });

  it("its patterns are the ones this block mirrors", () => {
    const snippets = [
      String.raw`site=$(sed -nE 's/^const version = "([^"]+)";.*/\1/p' site/src/lib/site.ts)`,
      String.raw`images=$(sed -nE 's/^[[:space:]]*image:[[:space:]]*([^[:space:]#]+).*/\1/p' "$file")`,
      `grep -noE '${COMMENT_REF_SRC}' "$file"`,
      `version=$(printf '%s' "$ref" | grep -oE '${VERSION_SRC}$')`,
      "version=${version%.}",
      `link='${LINK_HOST_SRC}'`,
      `grep -noE "$link${LINK_TAIL_SRC}" "$file"`,
      'if [ "${ref##*/}" != "v$tag" ]; then',
    ];
    for (const snippet of snippets) expect(CHECK_VERSION, snippet).toContain(snippet);
  });

  it("the site's version is the release", () => {
    const site = /^const version = "([^"]+)";/m.exec(repoFile("site/src/lib/site.ts"))?.[1];
    expect(site, "site/src/lib/site.ts has `const version = \"…\";`").toBe(RELEASE);
  });

  it.each(COMPOSE_FILES)("every image in %s is pinned to the release", (file) => {
    const images = [...repoFile(file).matchAll(/^[ \t]*image:[ \t]*([^\s#]+)/gm)].map((m) => m[1]);
    expect(images.length, `${file} has image: lines`).toBeGreaterThan(0);
    const allowed = IMAGE_NAMES.map((name) => `ghcr.io/rahul-bharati/${name}:${RELEASE}`);
    for (const image of images) expect(allowed, `${file}: ${image}`).toContain(image);
  });

  it("run-hound.compose.yml names all four images", () => {
    const text = repoFile("run-hound.compose.yml");
    for (const name of IMAGE_NAMES) {
      expect(text, name).toMatch(new RegExp(`^[ \\t]*image: ghcr\\.io/rahul-bharati/${name}:`, "m"));
    }
  });

  it("the version numbers in the Dockerfile, compose and .env.example comments are the release", () => {
    const fixtures = expand("fixtures/*/Dockerfile");
    const files = COMMENT_FILES.flatMap(expand);
    const ref = new RegExp(COMMENT_REF_SRC, "g");
    const tail = new RegExp(`${VERSION_SRC}$`);
    const wrong: string[] = [];
    for (const file of files) {
      for (const { line, ref: found } of grepNo(repoFile(file), ref)) {
        const version = (tail.exec(found)?.[0] ?? "").replace(/\.$/, "");
        if (version !== RELEASE) wrong.push(`${file}:${line}: "${found}"`);
      }
    }
    expect(fixtures.length, "fixtures/*/Dockerfile found").toBeGreaterThan(0);
    expect(wrong).toEqual([]);
  });

  it("every tag-pinned download link in the compose headers, README.md, TESTING.md and docs/ names the release tag", () => {
    const link = new RegExp(LINK_HOST_SRC + LINK_TAIL_SRC, "g");
    const wrong: string[] = [];
    let pinned = 0;
    for (const file of LINK_FILES) {
      for (const { line, ref } of grepNo(repoFile(file), link)) {
        pinned++;
        if (ref.replace(/\/$/, "").split("/").pop() !== `v${RELEASE}`) wrong.push(`${file}:${line}: "${ref}"`);
      }
    }
    expect(pinned, "the docs hand out tag-pinned download links").toBeGreaterThan(0);
    expect(wrong).toEqual([]);
  });

  /**
   * Beyond the workflow's lists (so the tests above that mirror it stay as they are): the issue forms and the fixture
   * READMEs hand testers a `docker run … run-hound:X.Y.Z --version` command, a `run-hound X.Y.Z` placeholder, a
   * `Run Hound X.Y.Z` heading and fixture image tags, and each must name the release. Wording that dates a feature
   * ("since 0.5.0", "Run Hound 0.6.0 and later") is history, not a pin, and is left out.
   */
  it("the version pins in .github/ISSUE_TEMPLATE/*.yml and fixtures/*/README.md are the release", () => {
    const templates = readdirSync(join(REPO, ".github/ISSUE_TEMPLATE"))
      .filter((name) => /\.ya?ml$/.test(name))
      .sort()
      .map((name) => `.github/ISSUE_TEMPLATE/${name}`);
    const readmes = expand("fixtures/*/README.md");
    expect(templates.length, ".github/ISSUE_TEMPLATE has issue forms").toBeGreaterThan(0);
    expect(readmes.length, "fixtures/*/README.md found").toBeGreaterThan(0);
    const pin = new RegExp(String.raw`(since )?(run-hound(-[a-z]+)?:|run-hound |Run Hound \(?)v?(${VERSION_SRC})( (and|or) later)?`, "g");
    const wrong: string[] = [];
    let pinned = 0;
    for (const file of [...templates, ...readmes]) {
      repoFile(file)
        .split("\n")
        .forEach((text, i) => {
          for (const m of text.matchAll(pin)) {
            if (m[1] || m[6]) continue;
            pinned++;
            if (m[4]!.replace(/\.$/, "") !== RELEASE) wrong.push(`${file}:${i + 1}: "${m[0]}"`);
          }
        });
    }
    expect(pinned, "the issue forms and fixture READMEs pin a version").toBeGreaterThan(0);
    expect(wrong).toEqual([]);
  });

  it("the site's release date and the CHANGELOG heading name the release day", () => {
    const site = repoFile("site/src/lib/site.ts");
    expect(/^\s*released: "([^"]+)",/m.exec(site)?.[1]).toBe(RELEASED.text);
    expect(/^\s*releasedIso: "([^"]+)",/m.exec(site)?.[1]).toBe(RELEASED.iso);
    const [y, m, d] = RELEASED.iso.split("-").map(Number);
    const shown = new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
    expect(shown, "released and releasedIso are the same day").toBe(RELEASED.text);
    const heading = repoFile("CHANGELOG.md").split("\n").find((l) => l.startsWith(`## ${RELEASE} `));
    expect(heading, `CHANGELOG.md has a "## ${RELEASE}" heading`).toBeDefined();
    expect(heading).toContain(RELEASED.text);
  });
});
