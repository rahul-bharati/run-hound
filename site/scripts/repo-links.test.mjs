// The site's links into the repository (`pnpm test`, which CI runs on a full checkout): every
// github.com/<repo>/blob/main/<path> and tree/main/<path> link in src/, and every raw Markdown link llms.txt and
// llms-full.txt list, names a file or folder that exists, and a #hash names a heading in that file. The Docker build
// can't check this (its context is site/ alone), so this test does.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, test } from "node:test";
import { linkSections } from "../src/app/llms.txt/llms.ts";
import { site } from "../src/lib/site.ts";
import { sourceFiles } from "./lib/build-output.mjs";

const siteDir = join(import.meta.dirname, "..");
const repo = join(siteDir, "..");
const srcDir = join(siteDir, "src");

/** GitHub's heading anchor for a Markdown heading: lower case, punctuation dropped, spaces to hyphens. */
const slug = (heading) =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");

/** The heading anchors of a Markdown file, with GitHub's -1, -2 for repeated headings. */
function anchorsOf(text) {
  const seen = new Map();
  const anchors = new Set();
  for (const [, heading] of text.replace(/```[\s\S]*?```/g, "").matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const base = slug(heading.replace(/`/g, ""));
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    anchors.add(n === 0 ? base : `${base}-${n}`);
  }
  return anchors;
}

/**
 * The repository path (and #hash) a link names, or undefined for any other link: the repository's blob/main and
 * tree/main pages, and raw.githubusercontent.com/<repo>/main/.
 */
export function repoPathOf(url) {
  const raw = site.github.replace("https://github.com/", "https://raw.githubusercontent.com/");
  const [, rest] =
    url.match(new RegExp(`^${escape(site.github)}/(?:blob|tree)/main/(.+)$`)) ?? url.match(new RegExp(`^${escape(raw)}/main/(.+)$`)) ?? [];
  if (!rest) return undefined;
  const [path, hash] = rest.split("#");
  return { path: decodeURIComponent(path.replace(/\/$/, "")), hash };
}
function escape(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A repository path that doesn't exist, or a #hash with no such heading: the problem, or undefined. */
export function problemWith({ path, hash }, root = repo) {
  const file = join(root, path);
  if (!existsSync(file)) return `${path} does not exist in the repository`;
  if (hash && !anchorsOf(readFileSync(file, "utf8")).has(hash)) return `${path} has no heading #${hash}`;
  return undefined;
}

/**
 * The repository links written in the source: `${site.github}/blob/main/<path>`, `${github}/tree/main/<path>` (as
 * lib/site.ts builds them) and the full URL, and llms.ts's repoDoc("<path>").
 */
export function repoLinksIn(text) {
  const links = [];
  for (const [, kind, rest] of text.matchAll(/(?:\$\{(?:site\.)?github\}|https:\/\/github\.com\/[\w.-]+\/[\w.-]+)\/(blob|tree)\/main\/([^"'`\s)<>]+)/g)) {
    links.push(`${site.github}/${kind}/main/${rest}`);
  }
  for (const [, path] of text.matchAll(/\brepoDoc\(\s*["'`]([^"'`$]+)["'`]\s*\)/g)) {
    links.push(`${site.github.replace("https://github.com/", "https://raw.githubusercontent.com/")}/main/${path}`);
  }
  return links;
}

describe("links into the repository", () => {
  test("every blob/main and tree/main link in src/ names a file that exists (and a heading, with a #hash)", () => {
    const problems = [];
    let seen = 0;
    for (const file of sourceFiles(srcDir, ["ts", "tsx", "mdx"])) {
      for (const url of repoLinksIn(readFileSync(file, "utf8"))) {
        const target = repoPathOf(url);
        assert.ok(target, `${url} is a repository link`);
        seen += 1;
        const problem = problemWith(target);
        if (problem) problems.push(`${relative(srcDir, file)}: ${url}: ${problem}`);
      }
    }
    assert.ok(seen >= 20, `found ${seen} repository links in src/; has the pattern stopped matching?`);
    assert.deepEqual(problems, []);
  });

  test("every repository link in llms.txt and llms-full.txt's link sections exists", () => {
    const urls = linkSections.flatMap((section) => section.links.map((link) => link.url)).filter((url) => repoPathOf(url));
    assert.ok(urls.length >= 10, `found ${urls.length}`);
    const problems = urls.map((url) => [url, problemWith(repoPathOf(url))]).filter(([, problem]) => problem);
    assert.deepEqual(problems, []);
  });

  test("the site's own repository links, as lib/site.ts builds them", () => {
    for (const url of [site.testingGuide, site.changelog, site.licenseUrl, site.envExample, site.kennelBugs, site.fernwayBugs]) {
      const target = repoPathOf(url);
      assert.ok(target, url);
      assert.equal(problemWith(target), undefined, url);
    }
  });

  test("a missing file, a missing heading and a renamed folder are caught", () => {
    const found = repoLinksIn(
      [
        "`${site.github}/blob/main/docs/no-such-guide.md`",
        "`${github}/blob/main/docs/research.md#no-such-heading`",
        "`${site.github}/tree/main/no-such-folder/`",
        'repoDoc("NOPE.md")',
        "`${site.github}/issues/new?template=bug.yml`",
      ].join("\n"),
    );
    assert.equal(found.length, 4);
    const problems = found.map((url) => problemWith(repoPathOf(url)));
    assert.match(problems[0], /docs\/no-such-guide\.md does not exist/);
    assert.match(problems[1], /docs\/research\.md has no heading #no-such-heading/);
    assert.match(problems[2], /no-such-folder does not exist/);
    assert.match(problems[3], /NOPE\.md does not exist/);
    assert.equal(problemWith(repoPathOf(`${site.github}/blob/main/docs/research.md#22-competitors`)), undefined);
  });
});
