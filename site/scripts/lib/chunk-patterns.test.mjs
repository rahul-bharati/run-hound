// Tests for scripts/lib/chunk-patterns.mjs (`pnpm test`): the patterns that recognise GSAP's core, ScrollTrigger,
// DrawSVG and Pagefind's UI bundles must hold on the real files as a production build ships them, not on a comment in a
// fixture. GSAP 3.15 is minified here with Next.js's own SWC minifier (the one `next build` uses), both as an ES module
// and as a bundler leaves a module (imports and exports gone, top-level names renamed); Pagefind's UI bundles come from
// Pagefind 1.5.2's Node API, as scripts/pagefind.mjs writes them.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import * as pagefind from "pagefind";
import { chunkPatterns, isMotion, librariesIn } from "./chunk-patterns.mjs";

const siteDir = join(import.meta.dirname, "..", "..");
const require = createRequire(join(siteDir, "package.json"));
const { loadBindings, minify } = require("next/dist/build/swc/index.js");

const gsapFile = (name) => readFileSync(join(siteDir, "node_modules", "gsap", `${name}.js`), "utf8");

/** A module as a bundler leaves it: no import or export syntax, so the minifier may rename its top-level names. */
const asBundled = (source) =>
  `(function(){${source
    .replace(/^import[\s\S]*?from\s*["'][^"']+["'];?/gm, "")
    .replace(/^export \{[^}]*\};?.*$/gm, "")
    .replace(/^export (default )?/gm, "")}\n})();`;

const minified = {};
before(async () => {
  await loadBindings();
  for (const name of ["gsap-core", "CSSPlugin", "ScrollTrigger", "DrawSVGPlugin"]) {
    const source = gsapFile(name);
    const options = { compress: true, format: { comments: false } };
    minified[name] = {
      module: (await minify(source, { ...options, mangle: true, module: true })).code,
      bundled: (await minify(asBundled(source), { ...options, mangle: { toplevel: true }, module: false })).code,
    };
  }
});

describe("GSAP, minified as next build minifies it", () => {
  for (const shape of ["module", "bundled"]) {
    test(`as ${shape === "module" ? "an ES module" : "a bundler leaves it"}: the core, ScrollTrigger and DrawSVG are told apart`, () => {
      assert.deepEqual(librariesIn(minified["gsap-core"][shape]), { gsap: true, scrollTrigger: false, drawSVG: false, pagefindUI: false });
      assert.deepEqual(librariesIn(minified.CSSPlugin[shape]), { gsap: false, scrollTrigger: false, drawSVG: false, pagefindUI: false });
      assert.deepEqual(librariesIn(minified.ScrollTrigger[shape]), { gsap: false, scrollTrigger: true, drawSVG: false, pagefindUI: false });
      assert.deepEqual(librariesIn(minified.DrawSVGPlugin[shape]), { gsap: false, scrollTrigger: false, drawSVG: true, pagefindUI: false });
      for (const name of ["gsap-core", "ScrollTrigger", "DrawSVGPlugin"]) assert.ok(isMotion(minified[name][shape]), name);
    });
  }

  test("the names a minifier removes are not what the patterns rely on", () => {
    // _rafBugFix is a function name in ScrollTrigger.js: gone once minified.
    assert.ok(gsapFile("ScrollTrigger").includes("_rafBugFix"));
    assert.ok(!minified.ScrollTrigger.module.includes("_rafBugFix"));
    // GSAP's core calls ScrollTrigger.create itself, so that name can't tell ScrollTrigger from the core.
    assert.match(minified["gsap-core"].module, /ScrollTrigger\.create/);
    assert.doesNotMatch(minified["gsap-core"].module, chunkPatterns.scrollTrigger);
  });
});

describe("Pagefind's UI bundles, as Pagefind 1.5.2 writes them", () => {
  let files;
  before(async () => {
    const { index, errors } = await pagefind.createIndex({ forceLanguage: "en" });
    assert.ok(index, errors.join("; "));
    await index.addHTMLFile({ url: "/a/", content: "<html><body><main><h1>Search</h1><p>A few words to index.</p></main></body></html>" });
    files = Object.fromEntries((await index.getFiles()).files.map((f) => [f.path, Buffer.from(f.content).toString("latin1")]));
  });
  after(() => pagefind.close());

  test("the Component UI, the Modular UI and the Default UI are recognised", () => {
    for (const name of ["pagefind-component-ui.js", "pagefind-modular-ui.js", "pagefind-ui.js"]) {
      assert.ok(files[name], `${name} is written`);
      assert.match(files[name], chunkPatterns.pagefindUI, name);
    }
  });

  test("the search API the site's own dialog loads is not a UI", () => {
    for (const name of ["pagefind.js", "pagefind-worker.js"]) {
      assert.ok(files[name], `${name} is written`);
      assert.doesNotMatch(files[name], chunkPatterns.pagefindUI, name);
      assert.ok(!isMotion(files[name]), name);
    }
  });
});
