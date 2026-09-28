// The docs after D1 (DESIGN.md §3.5, §5.4 D2): the glossary of Run Hound's own words, every page within its 1,000
// words, the repository guides turned into short pointers to their site pages, README's site link, the run-folder
// listing on /docs/report/ from the real Kennel run, and the CI command on /docs/cli/ exactly as the guides give it.
// It reads ../README.md, ../TESTING.md, ../docs/*.md and ../app, so it runs in `pnpm test` on a full checkout (CI),
// never in the build (§5.1 rule 5). src/content/docs.test.ts holds the rules every docs page follows.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { commandsText } from "@/components/primitives/copy";
import { parseTerminal } from "@/components/docs-shell/terminal";
import { commands } from "@/content/commands";
import { routes, type RouteEntry } from "@/content/routes";
import { docsRoutes } from "@/content/routes/docs";
import { docHeadings, docLinks, docPlainText, shellBlocks, wordCount } from "@/lib/docs-text";
import { site } from "@/lib/site";

const siteDir = new URL("../../", import.meta.url).pathname;
/** The public site as the app names it (app/src/core/links.ts), imported by URL as src/lib/app-links.test.ts does, so
 * the build's type check (whose context is site/ alone in Docker) never follows it out of site/. */
const { SITE_URL } = (await import(new URL("../../../app/src/core/links.ts", import.meta.url).href)) as { SITE_URL: string };
const repo = join(siteDir, "..");
const read = (file: string) => readFileSync(join(siteDir, file), "utf8");
const readRepo = (file: string) => readFileSync(join(repo, file), "utf8");

/** The part of the Kennel run extract (content/runs/kennel-0.6.0.json, from the real 0.6.0 run) this file reads. */
type KennelRun = {
  runs: {
    runId: string;
    findings: { checkId: string; spec?: { filename: string }; evidence?: { artifact?: string | null }[] }[];
  }[];
};
const kennelRun = JSON.parse(read("src/content/runs/kennel-0.6.0.json")) as KennelRun;

type DocsPage = RouteEntry & { docs: { group: string; order: number } };
const pages = (docsRoutes as readonly RouteEntry[]).filter((r): r is DocsPage => r.docs !== undefined);
const page = (id: string) => pages.find((r) => r.id === id);
const mdxOf = (r: RouteEntry) => read(r.source);

/** Where a site path lands: a registered route, and a #hash one that route promises or pins in its MDX. */
function lands(link: string): string | undefined {
  const [path, hash] = link.split("#");
  const target = routes.find((r) => r.path === path);
  if (!target) return `${link}: no registered page at ${path}`;
  if (!hash) return undefined;
  const pinned = target.source.endsWith(".mdx") ? docHeadings(read(target.source)).flatMap((h) => (h.id ? [h.id] : [])) : [];
  return target.anchors.includes(hash) || pinned.includes(hash) ? undefined : `${link}: ${path} has no #${hash}`;
}

describe("the glossary (§3.5: Run Hound's own terms only)", () => {
  /** §5.4 D2's list: the glossary defines at least 12 of these. */
  const ownTerms = [
    "golden path",
    "danger path",
    "advisory",
    "confirmed",
    "test record",
    "allowed hosts",
    "plan",
    "scenario",
    "evidence frame",
    "request card",
    "kennel",
    "fernway",
    "clean mode",
    "account a and b",
    "write-side check",
  ];
  /** Words any web-testing glossary defines: not Run Hound's own, so the glossary leaves them to others. */
  const generic = [
    "xss",
    "cross-site scripting",
    "wcag",
    "csrf",
    "cross-site request forgery",
    "cors",
    "csp",
    "content security policy",
    "aria",
    "axe",
    "axe-core",
    "accessibility",
    "api",
    "http",
    "cookie",
    "session",
    "localhost",
    "docker",
    "podman",
    "playwright",
    "sql injection",
    "idor",
    "jwt",
    "oauth",
    "screen reader",
    "source map",
  ];

  const glossary = page("docs-glossary");
  const mdx = glossary ? mdxOf(glossary) : "";
  /** The terms: the h3 headings under the glossary's h2 groups, each with its pinned id. */
  const terms = docHeadings(mdx).filter((h) => h.depth === 3);
  const normal = (text: string) => text.toLowerCase().replace(/[’']s\b/g, "").replace(/\s+/g, " ").trim();

  test("it is a registered docs page, /docs/glossary/, in Reference after Known limitations (§3.5)", () => {
    assert.ok(glossary, "content/routes/docs.ts registers docs-glossary");
    assert.equal(glossary.path, "/docs/glossary/");
    assert.equal(glossary.source, "src/content/docs/glossary.mdx");
    assert.equal(glossary.docs.group, "reference");
    const reference = pages.filter((r) => r.docs.group === "reference").sort((a, b) => a.docs.order - b.docs.order);
    assert.deepEqual(
      reference.map((r) => r.id),
      ["docs-report", "docs-cli", "docs-safety", "docs-limitations", "docs-glossary"],
    );
    assert.equal(glossary.schema.article?.headline, "Glossary");
  });

  test("at least 12 of Run Hound's own terms, each a heading with a pinned id that the page promises", () => {
    const defined = ownTerms.filter((term) => terms.some((t) => normal(t.text) === term));
    assert.ok(defined.length >= 12, `${defined.length} of the listed terms: ${defined.join(", ")}`);
    for (const t of terms) {
      assert.match(t.id ?? "", /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `"${t.text}" has a pinned id`);
      assert.ok(glossary?.anchors.includes(t.id!), `docs-glossary promises #${t.id}, so check-registry finds it on the built page`);
    }
    assert.deepEqual([...(glossary?.anchors ?? [])].sort(), terms.map((t) => t.id!).sort(), "the anchors are exactly the terms");
  });

  test("no generic term: the glossary defines none of the deny list (XSS, WCAG, CSRF as a concept, …)", () => {
    const denied = terms.filter((t) => generic.some((word) => new RegExp(`(^|[^a-z-])${word}($|[^a-z-])`).test(normal(t.text))));
    assert.deepEqual(
      denied.map((t) => t.text),
      [],
    );
  });

  test("each term is defined in one short paragraph (10 to 70 words) before the next heading", () => {
    const lines = mdx.split("\n");
    for (const t of terms) {
      const at = lines.findIndex((line) => /^###\s/.test(line) && line.includes(`{#${t.id}\\}`));
      assert.ok(at >= 0, `the heading of ${t.id}`);
      const next = lines.findIndex((line, i) => i > at && /^#{2,3}\s/.test(line));
      const body = lines.slice(at + 1, next < 0 ? undefined : next).join("\n");
      const words = wordCount(docPlainText(body));
      assert.ok(words >= 10 && words <= 70, `${t.id}: ${words} words`);
    }
  });

  test("its links land on registered pages and ids", () => {
    const bad = docLinks(mdx)
      .filter((l) => l.startsWith("/"))
      .flatMap((l) => lands(l) ?? []);
    assert.deepEqual(bad, []);
  });
});

describe("every docs page, the glossary included (§5.2)", () => {
  test("at most 1,000 words each", () => {
    assert.ok(page("docs-glossary"), "the glossary is one of them");
    for (const r of pages) {
      const words = wordCount(docPlainText(mdxOf(r)));
      assert.ok(words <= 1000, `${r.id}: ${words} words`);
    }
  });

  test("25 indexable pages besides the check pages (51 at release with the 26 check pages, §5.2)", () => {
    const indexable = routes.filter((r) => r.indexable && !r.id.startsWith("check-"));
    assert.equal(indexable.length, 25, indexable.map((r) => r.id).join(" "));
    assert.ok(indexable.some((r) => r.id === "docs-glossary"));
  });

  test("Fernway and Kennel are defined at first use on each page that names them (docs/brand.md copy rules)", () => {
    const definitions: Record<string, RegExp> = {
      Kennel: /Kennel(,| \()[^.]*\bpet-sitting booking page/,
      Fernway: /Fernway(,| \()[^.]*\bsmall SaaS app/,
    };
    for (const id of ["docs-signed-in-runs", "docs-ai", "docs-report", "docs-limitations", "docs-safety", "docs-troubleshooting", "docs-cli"]) {
      const text = docPlainText(mdxOf(page(id)!));
      for (const [name, defined] of Object.entries(definitions)) {
        const first = text.search(new RegExp(`\\b${name}\\b`));
        if (first < 0) continue;
        const def = text.search(defined);
        assert.ok(def >= 0 && def <= first, `${id}: ${name} is defined where the page first names it`);
      }
    }
  });
});

describe("/docs/report/ shows the run folder of the real Kennel run (§1.3, §3.5)", () => {
  const run = kennelRun.runs[0];
  const report = mdxOf(page("docs-report")!);
  /** The #run-folder section of the page. */
  const section = report.slice(report.indexOf("{#run-folder\\}"), report.indexOf("\n## ", report.indexOf("{#run-folder\\}")));

  test("a listing of runs/ and the run's folder, as `ls -F runs runs/*/` printed it for run " + run.runId, () => {
    const fence = /^```sh label="([^"]+)"\n([\s\S]*?)^```$/m.exec(section);
    assert.ok(fence, "the #run-folder section has a fenced terminal block");
    const { commands: lines, output } = parseTerminal(fence[2]);
    assert.deepEqual(lines, ["ls -F runs runs/*/"]);
    assert.deepEqual(output, [
      "runs:",
      `${run.runId}/`,
      `runs/${run.runId}/:`,
      "artifacts/",
      "report.html",
      "report.json",
      "report.md",
      "specs/",
    ]);
  });

  test("the counts and names come from the same run: an artifact and a Playwright test per finding", () => {
    const artifacts = run.findings.flatMap((f) => (f.evidence ?? []).flatMap((e) => (e.artifact ? [e.artifact] : [])));
    // Not a count of the references: the run numbers its artifacts 001…N with no gaps (039 is the last one here),
    // and some numbers (002, 003, 005, 032) are referenced by no finding, so the highest number is the file count.
    const lastArtifact = Math.max(...artifacts.map((a) => Number.parseInt(a, 10)));
    const specs = run.findings.length;
    const text = docPlainText(section);
    assert.match(text, new RegExp(`\\b${lastArtifact} (images and GIFs|files)\\b`), `artifacts/ held ${lastArtifact} files`);
    assert.match(text, new RegExp(`\\b${specs} (tests|Playwright tests|files)\\b`), `specs/ held ${specs} files`);
    const doubleSubmit = run.findings.find((f) => f.checkId === "double-submit");
    assert.ok(doubleSubmit?.spec?.filename && section.includes(doubleSubmit.spec.filename), "a real spec file name");
  });
});

describe("/docs/cli/: the CI command is the guides' own (§5.4 D2)", () => {
  const cli = mdxOf(page("docs-cli")!);

  test("the #ci section shows the ciRun block, and Copy copies exactly TESTING.md's command", () => {
    const ci = cli.slice(cli.indexOf("{#ci\\}"));
    assert.deepEqual(shellBlocks(ci), ["ciRun"]);
    const copied = commandsText(commands.blocks.ciRun);
    // TESTING.md's step "3. Enter http://host.docker.internal:5173/signup … or run it once from the command line".
    const testing = readRepo("TESTING.md");
    const at = testing.indexOf(copied.split("\n")[0]);
    assert.ok(at >= 0, "TESTING.md gives the same first line");
    const theirs = testing
      .slice(at)
      .split("\n")
      .slice(0, copied.split("\n").length)
      .map((line) => line.trim())
      .join("\n");
    assert.equal(theirs, copied.split("\n").map((line) => line.trim()).join("\n"));
  });

  test("the copied text runs as written: a shell hands docker the arguments the guides mean", () => {
    // A scratch folder in site/.lab-out/ (gitignored), with a stand-in docker that prints its arguments.
    mkdirSync(join(siteDir, ".lab-out"), { recursive: true });
    const dir = mkdtempSync(join(siteDir, ".lab-out", "docs-polish-"));
    try {
      const bin = join(dir, "bin");
      mkdirSync(bin);
      writeFileSync(join(bin, "docker"), '#!/bin/sh\nfor a in "$@"; do printf "%s\\n" "$a"; done\n');
      chmodSync(join(bin, "docker"), 0o755);
      const result = spawnSync("sh", ["-c", commandsText(commands.blocks.ciRun)], {
        cwd: dir,
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, PWD: dir },
        encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(result.stdout.trim().split("\n"), [
        "run",
        "--rm",
        "--init",
        "--add-host",
        "host.docker.internal:host-gateway",
        "-v",
        `${dir}/runs:/repo/app/runs`,
        site.imageName,
        "run",
        "http://host.docker.internal:5173/signup",
        "--approve",
        "all",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the repository guides point to the site (§3.5 \"Repo guides\")", () => {
  /** Each guide and the site page it now points to. */
  const pointers: Record<string, string> = {
    "docs/install.md": "/docs/install/",
    "docs/usage.md": "/docs/cli/",
    "docs/signed-in-runs.md": "/docs/signed-in-runs/",
    "docs/ai.md": "/docs/ai/",
  };
  const siteLinks = (text: string) =>
    [...text.matchAll(/\]\((https:\/\/[^)\s]+)\)/g)].map((m) => m[1]).filter((url) => url.startsWith(`${SITE_URL}/`));

  for (const [file, path] of Object.entries(pointers)) {
    test(`${file}: at most 120 words, and a link to ${path}`, () => {
      const text = readRepo(file);
      const words = wordCount(text);
      assert.ok(words <= 120, `${file}: ${words} words`);
      assert.ok(siteLinks(text).includes(`${SITE_URL}${path}`), `${file} links ${SITE_URL}${path}`);
      const bad = siteLinks(text).flatMap((url) => lands(url.slice(SITE_URL.length)) ?? []);
      assert.deepEqual(bad, [], `${file}: every site link lands`);
    });
  }

  test("README.md links the site near the top, with the site's one-sentence definition (site.description)", () => {
    const readme = readRepo("README.md");
    const top = readme.slice(0, readme.indexOf("\n## "));
    assert.ok(top.includes(site.description), "the top of README.md carries site.description word for word");
    assert.ok(siteLinks(top).some((url) => url === `${SITE_URL}/`), `the top of README.md links ${SITE_URL}/`);
  });

  test("README.md sends no one to a section of a guide that is now a pointer", () => {
    const readme = readRepo("README.md");
    const stale = [...readme.matchAll(/\]\((docs\/(?:install|usage|signed-in-runs|ai)\.md#[^)]*)\)/g)].map((m) => m[1]);
    assert.deepEqual(stale, []);
    const bad = siteLinks(readme).flatMap((url) => lands(url.slice(SITE_URL.length)) ?? []);
    assert.deepEqual(bad, [], "every site link in README.md lands");
  });
});
