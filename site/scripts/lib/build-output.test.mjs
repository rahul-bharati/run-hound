// Tests for scripts/lib/build-output.mjs (`pnpm test`): the helpers the build guards, pagefind, the lab and the source
// tests share, so each exists once.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { after, describe, test } from "node:test";
import { htmlFiles, htmlFilesSync, isFrameworkPage, sourceFiles, visibleBreadcrumb } from "./build-output.mjs";

const root = mkdtempSync(join(tmpdir(), "build-output-"));
after(() => rmSync(root, { recursive: true, force: true }));

function tree(name, files) {
  const dir = join(root, name);
  for (const file of files) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), "");
  }
  return dir;
}

describe("visibleBreadcrumb", () => {
  test("each <li> of nav aria-label=Breadcrumb: its name and its link", () => {
    const html =
      '<main><nav aria-label="Breadcrumb"><ol><li><a href="/">Home</a></li><li><a href="/docs/">Docs &amp; guides</a></li>' +
      '<li><span aria-current="page">Quick start</span></li></ol></nav><h1>Quick start</h1></main>';
    assert.deepEqual(visibleBreadcrumb(html), [
      { name: "Home", href: "/" },
      { name: "Docs & guides", href: "/docs/" },
      { name: "Quick start", href: undefined },
    ]);
  });

  test("aria-hidden separators are no part of a name (the approved prototype's markup), in any element", () => {
    const html =
      '<nav aria-label="Breadcrumb" class="min-w-0"><ol class="flex">' +
      '<li class="flex"><a href="/" class="hover:text-accent">Home</a></li>' +
      '<li class="flex"><span aria-hidden="true" class="text-dim">/</span><a href="/checks/">Checks</a></li>' +
      '<li class="flex"><svg aria-hidden="true" viewBox="0 0 8 8"><path d="M2 1l4 3-4 3"></path></svg>' +
      "<span aria-hidden=true>›</span><span aria-current=\"page\" class=\"truncate\">double-submit</span></li>" +
      "</ol></nav>";
    assert.deepEqual(visibleBreadcrumb(html), [
      { name: "Home", href: "/" },
      { name: "Checks", href: "/checks/" },
      { name: "double-submit", href: undefined },
    ]);
  });

  test("a page without a breadcrumb", () => {
    assert.equal(visibleBreadcrumb("<main><nav aria-label=\"Docs\"><ol><li>x</li></ol></nav></main>"), undefined);
  });
});

describe("isFrameworkPage", () => {
  test("only Next.js's own pages: /_design/ and any other internal route are the site's", () => {
    assert.equal(isFrameworkPage("_not-found.html"), true);
    assert.equal(isFrameworkPage("_global-error.html"), true);
    assert.equal(isFrameworkPage("_design.html"), false);
    assert.equal(isFrameworkPage("index.html"), false);
    assert.equal(isFrameworkPage(join("docs", "_draft.html")), false);
  });
});

describe("htmlFiles and htmlFilesSync", () => {
  test("every .html file, depth first, skipping .segments folders; both give the same list", async () => {
    const dir = tree("pages", ["index.html", "docs.html", "docs/quick-start.html", "docs.segments/x.html", "index.rsc", "a/b/c.html"]);
    const sync = [...htmlFilesSync(dir)].map((file) => relative(dir, file)).sort();
    const found = [];
    for await (const file of htmlFiles(dir)) found.push(relative(dir, file));
    assert.deepEqual(sync, ["a/b/c.html", "docs.html", "docs/quick-start.html", "index.html"].map((p) => join(...p.split("/"))));
    assert.deepEqual(found.sort(), sync);
  });
});

describe("sourceFiles", () => {
  test("the files with these extensions under a folder, tests left out", () => {
    const dir = tree("src", ["a.ts", "b.tsx", "c.test.ts", "d.test.tsx", "e.mdx", "f.css", "g/h.ts", "g/i.mdx", "g/j.test.ts"]);
    const names = (list) => list.map((file) => relative(dir, file)).sort();
    assert.deepEqual(names(sourceFiles(dir)), ["a.ts", "b.tsx", join("g", "h.ts")]);
    assert.deepEqual(names(sourceFiles(dir, ["ts", "tsx", "mdx"])), ["a.ts", "b.tsx", "e.mdx", join("g", "h.ts"), join("g", "i.mdx")]);
  });
});
