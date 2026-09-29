// Tests for the repository's trust files (`pnpm test`, which CI runs on a full checkout): the root SECURITY.md that
// GitHub shows as the security policy, and the issue forms people fill in. They live outside site/, so no build step
// reads them (the Docker build context is site/ alone); only this test does.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { SITE_URL as SITE } from "../../app/src/core/links.ts";
import { routes } from "../src/content/routes.ts";
import { site } from "../src/lib/site.ts";

// The repository root, two folders up from site/scripts/.
const repo = join(import.meta.dirname, "..", "..");
const read = (path) => readFileSync(join(repo, path), "utf8");

/**
 * The public site as the app names it (app/src/core/links.ts: a report's links go there), and the repository as the
 * site names it (lib/site.ts). SITE is imported above.
 */
const GITHUB = site.github;
/** The disclosure policy (the registry's "security" page), and GitHub's private vulnerability reporting form. */
const POLICY = SITE + (routes.find((r) => r.id === "security")?.path ?? "<no security page in the registry>");
const REPORT_PRIVATELY = `${GITHUB}/security/advisories/new`;
const FEEDBACK_FORM = `${GITHUB}/issues/new?template=feedback.yml`;

const formsDir = join(repo, ".github", "ISSUE_TEMPLATE");
const forms = readdirSync(formsDir)
  .filter((name) => /\.ya?ml$/.test(name))
  .map((name) => ({ name, text: readFileSync(join(formsDir, name), "utf8") }));

/** Every Run Hound release named in CHANGELOG.md ("## 0.6.0 (…)"). */
const releases = [...read("CHANGELOG.md").matchAll(/^## v?(\d+\.\d+\.\d+)\b/gm)].map((m) => m[1]);

/**
 * A release literal: any CHANGELOG release, any 0.x.y (Run Hound's releases before 1.0.0), or a two-part release (the
 * release workflow tags images 0.6.0, 0.6 and latest) where it reads as one: an image tag, after "Run Hound", "since",
 * "in", "release" or "version", or with a "v". A bare 0.5 elsewhere is a number ("a delay of 0.5 s").
 */
function releaseLiterals(text) {
  const found = [...text.matchAll(/(?<![\w.])v?(0\.\d+\.\d+)(?![\w]|\.\d)/g)].map((m) => m[0]);
  const twoPart =
    /(?:(?<=run-hound(?:-[a-z]+)?:|\bRun Hound |\bsince |\bin |\brelease |\bversion )v?|(?<![\w.])v)0\.\d+(?:\.\d+)?(?![\w]|\.\d)/gi;
  found.push(...[...text.matchAll(twoPart)].map((m) => m[0]));
  for (const release of releases) {
    const escaped = release.replace(/\./g, "\\.");
    if (new RegExp(`(?<![\\w.])v?${escaped}(?![\\w]|\\.\\d)`).test(text)) found.push(release);
  }
  return [...new Set(found)];
}

/**
 * The contact links in ISSUE_TEMPLATE/config.yml: a flat list of `- name:` items with `url:` and `about:` keys (the
 * only shape GitHub accepts there), read without a YAML dependency.
 */
function contactLinks(text) {
  const section = text.split(/^contact_links:\s*$/m)[1] ?? "";
  return section
    .split(/^\s*-\s+(?=name:)/m)
    .slice(1)
    .map((item) => {
      const value = (key) => {
        const m = item.match(new RegExp(`^\\s*${key}:\\s*(.+?)\\s*$`, "m"));
        return m ? m[1].replace(/^(["'])(.*)\1$/, "$2") : undefined;
      };
      return { name: value("name"), url: value("url"), about: value("about") };
    });
}

/** A string as a regular expression that matches it literally (RegExp.escape needs Node 24; engines allow 22.12). */
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** GitHub's heading anchor for a Markdown heading: lower case, punctuation dropped, spaces to hyphens. */
const slug = (heading) =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");

describe("SECURITY.md", () => {
  const path = join(repo, "SECURITY.md");

  test("exists at the root, so GitHub shows it as the security policy instead of docs/security.md", () => {
    assert.ok(existsSync(path), "SECURITY.md at the repository root");
  });

  test("points to the disclosure policy on the site", () => {
    assert.ok(read("SECURITY.md").includes(POLICY), `links ${POLICY}`);
  });

  test("sends reports to GitHub's private vulnerability reporting, not a public issue", () => {
    // Markdown wraps lines; read it as it renders, with every run of whitespace one space.
    const text = read("SECURITY.md").replace(/\s+/g, " ");
    assert.match(text, /private vulnerability reporting/i);
    assert.ok(text.includes(REPORT_PRIVATELY), `links ${REPORT_PRIVATELY}`);
    assert.match(text, /not in a public issue/i);
  });

  test("security.txt's Contact is the same private form", () => {
    const securityTxt = join(repo, "site", "public", ".well-known", "security.txt");
    assert.ok(existsSync(securityTxt), "site/public/.well-known/security.txt exists");
    assert.match(readFileSync(securityTxt, "utf8"), new RegExp(`^Contact: ${REPORT_PRIVATELY}$`, "m"));
  });

  test("every relative link resolves to a file in the repository", () => {
    const text = read("SECURITY.md");
    const relative = [...text.matchAll(/\]\(([^)\s#]+)(?:#[^)]*)?\)/g)]
      .map((m) => m[1])
      .filter((href) => !/^[a-z]+:/i.test(href));
    assert.ok(relative.includes("docs/security.md"), "links docs/security.md for how Run Hound keeps its runs safe");
    for (const href of relative) assert.ok(existsSync(join(repo, href)), `${href} exists`);
  });
});

describe("issue forms", () => {
  test("the bug, feedback and config forms exist", () => {
    assert.deepEqual(forms.map((f) => f.name).sort(), ["bug.yml", "config.yml", "feedback.yml"]);
  });

  test("CHANGELOG.md names the releases this test looks for", () => {
    assert.ok(releases.includes("0.6.0") && releases.length >= 6, `releases: ${releases.join(", ")}`);
  });

  test("a release is caught in every shape a form could name it", () => {
    // The release workflow tags each image X.Y.Z, X.Y and latest (docs/install.md), so a two-part tag is a pin too.
    for (const text of [
      "docker run --rm ghcr.io/rahul-bharati/run-hound:0.6.0 --version",
      "docker run --rm ghcr.io/rahul-bharati/run-hound:0.6 --version",
      "image: ghcr.io/rahul-bharati/run-hound-kennel:0.6",
      "Pull ghcr.io/rahul-bharati/run-hound:v0.6.",
      "placeholder: run-hound 0.5.1",
      "Fixed in v0.4.0, so upgrade.",
      "Signing in works since 0.6.",
      "Run Hound 0.6 and later",
      "Fixed in v0.5, so upgrade.",
      "Upgrade to v0.6 first.",
    ]) {
      assert.notDeepEqual(releaseLiterals(text), [], `a release in: ${text}`);
    }
    for (const text of [
      "docker run --rm ghcr.io/rahul-bharati/run-hound:<tag> --version (`latest` if you gave none)",
      "ghcr.io/rahul-bharati/run-hound:latest",
      "placeholder: run-hound 0.x.y",
      "Fedora 44, Node 24.21, pnpm 12.3.4 / macOS 16.1, Docker Desktop 4.50",
      "Ollama, qwen3:8b; the test lab's tag is in run-hound.compose.yml",
      "http://run-hound:3000/ from another container",
      "a delay of 0.5 s, or within 0.5 s of the click",
      "an app built with Lovable, Bolt or v0.dev",
    ]) {
      assert.deepEqual(releaseLiterals(text), [], `no release in: ${text}`);
    }
  });

  for (const { name, text } of forms) {
    test(`${name} names no release, so it never goes stale`, () => {
      assert.deepEqual(releaseLiterals(text), [], `${name} names a release`);
    });
  }

  for (const name of ["bug.yml", "feedback.yml"]) {
    test(`${name} asks for the version from --version or Settings in the web UI`, () => {
      const text = read(`.github/ISSUE_TEMPLATE/${name}`);
      const field = text.split(/^\s*-\s+type:/m).find((block) => /^\s*id:\s*version\s*$/m.test(block));
      assert.ok(field, `${name} has a field with id "version"`);
      assert.match(field, /--version/);
      assert.match(field, /Settings/);
      assert.match(field, /web UI/);
    });

    test(`${name} tells test-lab users the tag defaults to latest unless they set RUNHOUND_TAG`, () => {
      // The test lab's images default to :latest (run-hound.compose.yml, RUNHOUND_TAG), but a tester may have
      // pinned RUNHOUND_TAG to an older release, so `--version` (not a guess from the file) is still what's asked for.
      const text = read(`.github/ISSUE_TEMPLATE/${name}`);
      const field = text.split(/^\s*-\s+type:/m).find((block) => /^\s*id:\s*version\s*$/m.test(block));
      assert.ok(field, `${name} has a field with id "version"`);
      assert.match(field, /RUNHOUND_TAG/);
      assert.match(field, /run-hound\.compose\.yml/);
      assert.match(read("run-hound.compose.yml"), /^\s*image: ghcr\.io\/rahul-bharati\/run-hound:\S+\s*$/m);
    });
  }

  test("config.yml turns off blank issues", () => {
    assert.match(read(".github/ISSUE_TEMPLATE/config.yml"), /^blank_issues_enabled:\s*false\s*$/m);
  });

  test("config.yml sends security problems to the disclosure policy", () => {
    const links = contactLinks(read(".github/ISSUE_TEMPLATE/config.yml"));
    const security = links.find((l) => l.url === POLICY);
    assert.ok(security, `a contact link to ${POLICY}`);
    assert.match(security.name, /security/i);
    assert.equal(links[0], security, "the security link comes first");
  });

  test("config.yml sends questions to the feedback form", () => {
    const links = contactLinks(read(".github/ISSUE_TEMPLATE/config.yml"));
    const question = links.find((l) => /question/i.test(l.name ?? ""));
    assert.ok(question, "a Question contact link");
    assert.equal(question.url, FEEDBACK_FORM);
    assert.ok(existsSync(join(formsDir, "feedback.yml")), "the form it opens exists");
  });

  test("feedback.yml can be sent by someone asking a question before they have run Run Hound", () => {
    const [intro, ...fields] = read(".github/ISSUE_TEMPLATE/feedback.yml").split(/^\s*-\s+type:\s*/m).slice(1);
    assert.match(intro, /^markdown\b/, "the form opens with a markdown block");
    // Text fields take "n/a"; a required list needs an option that fits a question.
    assert.match(intro.replace(/\s+/g, " "), /Asking a question\? Choose "Question" and write "n\/a" in any field/);
    const lists = fields.filter((f) => /^dropdown\b/.test(f) && /^\s*required:\s*true\s*$/m.test(f));
    assert.ok(lists.length >= 3, `${lists.length} required lists`);
    for (const list of lists) {
      const id = /^\s*id:\s*(\S+)\s*$/m.exec(list)?.[1];
      const options = [...(list.split(/^\s*options:\s*$/m)[1] ?? "").matchAll(/^\s*-\s+(.+?)\s*$/gm)].map((m) =>
        m[1].replace(/^(["'])(.*)\1$/, "$2"),
      );
      assert.ok(
        options.some((o) => /^(Question\b|Something else$|Haven't run it yet\b)/.test(o)),
        `${id} has an option for a question: ${options.join(" | ")}`,
      );
    }
  });

  test("every contact link has a name, an https url and an about line", () => {
    const links = contactLinks(read(".github/ISSUE_TEMPLATE/config.yml"));
    assert.ok(links.length >= 2);
    for (const link of links) {
      assert.ok(link.name && link.about, JSON.stringify(link));
      assert.match(link.url ?? "", /^https:\/\//);
    }
  });

  test("every site link in SECURITY.md and the forms is a page in the registry", () => {
    // check-registry checks the links inside the site; these files live outside it, so a renamed page would leave them
    // pointing at a 404 (GitHub's security policy among them) with every other test green.
    const paths = new Set(routes.map((r) => r.path));
    const siteLink = new RegExp(`${escapeRegExp(SITE)}(/[^\\s)"'\`#?]*)`, "g");
    let links = 0;
    for (const [name, text] of [["SECURITY.md", read("SECURITY.md")], ...forms.map((f) => [f.name, f.text])]) {
      for (const [, href] of text.matchAll(siteLink)) {
        // A bare URL at the end of a sentence carries the sentence's full stop.
        const path = href.replace(/[.,;:!]+$/, "");
        assert.ok(paths.has(path), `${name}: ${path} is a page in the registry`);
        links++;
      }
    }
    assert.ok(links >= 2, `${links} site links found (SECURITY.md and config.yml each link the disclosure policy)`);
  });

  test("links into the repository name files and headings that exist", () => {
    // The repository as the site names it, so a moved repository moves this test with it instead of matching nothing.
    const repoLink = new RegExp(`${escapeRegExp(GITHUB)}/blob/main/([^\\s)#"'\`]+)(?:#([\\w-]+))?`, "g");
    let links = 0;
    for (const { name, text } of forms) {
      for (const [, path, hash] of text.matchAll(repoLink)) {
        links++;
        assert.ok(existsSync(join(repo, path)), `${name}: ${path} exists`);
        if (!hash) continue;
        const headings = [...read(path).matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => slug(m[1]));
        assert.ok(headings.includes(hash), `${name}: ${path}#${hash} is a heading`);
      }
    }
    assert.ok(links >= 2, `${links} repository links found (feedback.yml and config.yml each link TESTING.md)`);
  });
});
