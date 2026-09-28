// Tests for scripts/check-budgets.mjs (`pnpm test`): byte budgets per route, read from a build, on fixture builds
// that must pass or fail. JS is gzip -9 of the first-party <script src> files a modern browser runs (no noModule).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, test } from "node:test";
import { gzipSync } from "node:zlib";

const script = join(import.meta.dirname, "check-budgets.mjs");
const root = mkdtempSync(join(tmpdir(), "check-budgets-"));
after(() => rmSync(root, { recursive: true, force: true }));

/** Incompressible text of about `n` bytes gzipped (hex of random bytes gzips to about half its length). */
const blob = (n) => `/*${randomBytes(n).toString("hex")}*/`;
const gz = (text) => gzipSync(Buffer.from(text), { level: 9 }).length;

const chunks = {
  "shared.js": blob(1000),
  "home.js": blob(300),
  "docs.js": blob(200),
  "legacy.js": blob(5000),
  // What survives minification (scripts/lib/chunk-patterns.mjs): GSAP's global, not a comment naming it.
  "lazy-motion.js": `var t=window.gsapVersions||(window.gsapVersions=[]);${blob(400)}`,
};

/** A prerendered page with its scripts, as Next.js writes it. */
function page(scripts, { body = "", fonts = [], hrefFirst = false } = {}) {
  const tags = scripts.map((s) => (s === "legacy.js" ? `<script src="/_next/static/chunks/${s}" noModule=""></script>` : `<script src="/_next/static/chunks/${s}" async=""></script>`));
  const preloads = fonts.map((f) =>
    hrefFirst
      ? `<link href="/_next/static/media/${f}" rel="preload" as="font" crossorigin="" type="font/woff2"/>`
      : `<link rel="preload" href="/_next/static/media/${f}" as="font" crossorigin="" type="font/woff2"/>`,
  );
  return `<!DOCTYPE html><html><head>${preloads.join("")}${tags.join("")}</head><body><main>${body}</main></body></html>`;
}

const pages = {
  "index.html": page(["shared.js", "home.js", "legacy.js"], { fonts: ["a.woff2"] }),
  "docs.html": page(["shared.js", "docs.js", "legacy.js"], { fonts: ["a.woff2"] }),
  "docs/quick-start.html": page(["shared.js", "docs.js"], { fonts: ["a.woff2"] }),
  "privacy.html": page(["shared.js"], { fonts: ["a.woff2"] }),
  "_not-found.html": page(["shared.js"]),
  "_global-error.html": page(["shared.js"]),
};

const shared = gz(chunks["shared.js"]);
const generous = {
  shared: { jsGzip: shared + 50 },
  fonts: { preloadBytes: 2000 },
  arbitraryValues: 3,
  lazy: { maxChunkGzip: 5000, gsapGzip: 5000 },
  routes: {
    "/": { jsGzip: 100000, pageJsGzip: 1000, htmlRaw: 100000, htmlGzip: 100000 },
    "/docs/*/": { jsGzip: 100000, htmlRaw: 100000, htmlGzip: 100000 },
    "*": { jsGzip: 100000, htmlRaw: 100000, htmlGzip: 100000 },
  },
};

let fixture = 0;
function check({ budgets = generous, overrides = {}, extraChunks = {}, source = 'className="px-[72px] text-[15px] mt-4"', files = {}, pagefindJs } = {}) {
  const dir = join(root, String((fixture += 1)));
  const write = (path, text) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  };
  for (const [name, html] of Object.entries({ ...pages, ...overrides })) write(join(dir, "dist", "server", "app", name), html);
  for (const [name, js] of Object.entries({ ...chunks, ...extraChunks })) write(join(dir, "dist", "static", "chunks", name), js);
  write(join(dir, "dist", "static", "media", "a.woff2"), "x".repeat(1500));
  write(join(dir, "src", "page.tsx"), source);
  write(join(dir, "src", "page.test.ts"), 'const re = /:-[a-z0-9]/; // "px-[1px]" in a test does not count');
  write(join(dir, "budgets.json"), JSON.stringify(budgets));
  for (const [name, text] of Object.entries(files)) write(join(dir, name), text);
  // Pagefind's search API, where scripts/pagefind.mjs writes it for a build in another folder (NEXT_DIST_DIR).
  if (pagefindJs !== undefined) write(join(dir, "dist", "pagefind", "pagefind.js"), pagefindJs);
  const result = spawnSync(
    process.execPath,
    [script, "--dist", join(dir, "dist"), "--budgets", join(dir, "budgets.json"), "--src", join(dir, "src"), "--public", join(dir, "public")],
    { encoding: "utf8", env: { ...process.env, GITHUB_STEP_SUMMARY: "" } },
  );
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe("check-budgets passes", () => {
  test("a build within every budget, and prints each route's numbers", () => {
    const { status, output } = check();
    assert.equal(status, 0, output);
    assert.match(output, new RegExp(`shared JS ${shared} B`));
    assert.match(output, /\/docs\/quick-start\/\s+\d+/);
    assert.match(output, /arbitrary Tailwind values: 2 \(budget 3\)/);
    assert.match(output, /0 errors/);
  });

  test("noModule scripts don't count: a modern browser skips them", () => {
    const { output } = check();
    const home = gz(chunks["shared.js"]) + gz(chunks["home.js"]);
    assert.match(output, new RegExp(`^/\\s+${home}\\s`, "m"));
  });

  test("GSAP in a lazy chunk (loaded after the page) is allowed, within the lazy budget", () => {
    const { status, output } = check();
    assert.equal(status, 0, output);
    assert.match(output, new RegExp(`lazy GSAP chunks: ${gz(chunks["lazy-motion.js"])} B`));
  });

  test("a lazy chunk with only ScrollTrigger or only DrawSVG counts toward the lazy GSAP budget too", () => {
    const extraChunks = {
      "lazy-scroll.js": `l.scrollerProxy=function(e,r){};l.clearScrollMemory=function(e){};${blob(300)}`,
      "lazy-draw.js": `var D={version:"3.15.0",name:"drawSVG",register:function(e){}};${blob(100)}`,
    };
    const { status, output } = check({ extraChunks });
    assert.equal(status, 0, output);
    const total = gz(chunks["lazy-motion.js"]) + gz(extraChunks["lazy-scroll.js"]) + gz(extraChunks["lazy-draw.js"]);
    assert.match(output, new RegExp(`lazy GSAP chunks: ${total} B in 3 chunks \\(core in 1, ScrollTrigger in 1, DrawSVG in 1; budget 5000\\)`));
  });

  test("a redesign target the route doesn't meet yet is a note until its switch file exists", () => {
    const budgets = { ...generous, routes: { ...generous.routes, "/": { ...generous.routes["/"], target: { htmlRaw: 10, htmlGzip: 10, enforceWhen: "src/content/home.ts" } } } };
    const { status, output } = check({ budgets });
    assert.equal(status, 0, output);
    assert.match(output, /note: \/: HTML raw \d+ B is over the redesign's target of 10 B \(enforced once src\/content\/home\.ts exists\)/);
  });

  const withSearch = { ...generous, lazy: { ...generous.lazy, search: { gzip: 16000, enforceWhen: "src/components/search" } } };
  /** The search dialog's lazy chunk (§3.16): it imports Pagefind's search API when it opens. */
  const dialog = `async function o(){return import("/pagefind/pagefind.js")}${blob(200)}`;

  test("before the search dialog exists, the search budget is a note with pagefind.js's size", () => {
    const pagefindJs = blob(800);
    const { status, output } = check({ budgets: withSearch, pagefindJs });
    assert.equal(status, 0, output);
    assert.match(
      output,
      new RegExp(`note: no lazy chunk loads /pagefind/pagefind\\.js yet \\(the search dialog, §3\\.16\\); pagefind\\.js is ${gz(pagefindJs)} B of the 16000 B search budget`),
    );
  });

  test("the search dialog's lazy chunk plus pagefind.js, within the search budget", () => {
    const pagefindJs = blob(800);
    const { status, output } = check({ budgets: withSearch, pagefindJs, extraChunks: { "search-dialog.js": dialog } });
    assert.equal(status, 0, output);
    const total = gz(dialog) + gz(pagefindJs);
    assert.match(output, new RegExp(`search on open: ${total} B \\(dialog ${gz(dialog)} B in 1 chunk \\+ pagefind\\.js ${gz(pagefindJs)} B; budget 16000\\)`));
  });

  test("preloaded fonts count whatever the order of the link's attributes", () => {
    const { output } = check({ overrides: { "privacy.html": page(["shared.js"], { fonts: ["a.woff2"], hrefFirst: true }) } });
    assert.match(output, /^\/privacy\/\s+\d+\s+\d+\s+\d+\s+\d+\s+1500$/m);
  });
});

describe("check-budgets fails the build when", () => {
  test("an initial chunk contains GSAP", () => {
    const { status, output } = check({ extraChunks: { "home.js": `(window.gsapVersions||(window.gsapVersions=[])).push("3.15.0");${blob(300)}` } });
    assert.equal(status, 1, output);
    assert.match(output, /initial chunk \/_next\/static\/chunks\/home\.js contains GSAP \(on \/\)/);
  });

  test("an initial chunk contains ScrollTrigger", () => {
    const { status, output } = check({ extraChunks: { "docs.js": `l.scrollerProxy=function(e,r){var n=t(e)};${blob(100)}` } });
    assert.equal(status, 1, output);
    assert.match(output, /contains ScrollTrigger/);
  });

  test("an initial chunk contains Pagefind's Component UI", () => {
    // A string of the real bundle (Pagefind 1.5.2's pagefind-component-ui.js), not a comment a minifier would strip.
    const { status, output } = check({ extraChunks: { "shared.js": `customElements.define("pagefind-modal",class extends HTMLElement{});${blob(1000)}` } });
    assert.equal(status, 1, output);
    assert.match(output, /contains Pagefind's Component UI/);
  });

  test("a route's initial JS is over its budget", () => {
    const budgets = { ...generous, routes: { ...generous.routes, "/docs/*/": { jsGzip: shared + 10, htmlRaw: 100000, htmlGzip: 100000 } } };
    const { status, output } = check({ budgets });
    assert.equal(status, 1, output);
    assert.match(output, /\/docs\/quick-start\/: initial JS \d+ B is over its budget of \d+ B \(\/docs\/\*\/\)/);
  });

  test("the home page's own JS is over its page-specific budget", () => {
    const budgets = { ...generous, routes: { ...generous.routes, "/": { ...generous.routes["/"], pageJsGzip: 10 } } };
    const { status, output } = check({ budgets });
    assert.equal(status, 1, output);
    assert.match(output, /\/: page-specific JS \d+ B is over its budget of 10 B/);
  });

  test("the JS every page shares is over its budget", () => {
    const { status, output } = check({ budgets: { ...generous, shared: { jsGzip: 10 } } });
    assert.equal(status, 1, output);
    assert.match(output, /shared JS \d+ B is over its budget of 10 B/);
  });

  test("a page's HTML is over its raw or gzip budget", () => {
    const budgets = { ...generous, routes: { ...generous.routes, "*": { jsGzip: 100000, htmlRaw: 200, htmlGzip: 100 } } };
    const { status, output } = check({ budgets });
    assert.equal(status, 1, output);
    assert.match(output, /\/privacy\/: HTML \d+ B raw is over its budget of 200 B \(\*\)/);
    assert.match(output, /\/privacy\/: HTML \d+ B gzip is over its budget of 100 B \(\*\)/);
  });

  test("the 404 page is held to the default budget too", () => {
    const budgets = { ...generous, routes: { ...generous.routes, "*": { jsGzip: 10, htmlRaw: 100000, htmlGzip: 100000 } } };
    const { output } = check({ budgets });
    assert.match(output, /404: initial JS \d+ B is over its budget of 10 B/);
  });

  test("the preloaded fonts are over budget", () => {
    const { status, output } = check({ budgets: { ...generous, fonts: { preloadBytes: 1000 } } });
    assert.equal(status, 1, output);
    assert.match(output, /\/: preloaded fonts 1500 B are over the budget of 1000 B/);
  });

  test("a lazy GSAP chunk is over the lazy budget", () => {
    const { status, output } = check({ budgets: { ...generous, lazy: { maxChunkGzip: 5000, gsapGzip: 50 } } });
    assert.equal(status, 1, output);
    assert.match(output, /lazy GSAP chunks: \d+ B is over the budget of 50 B/);
  });

  test("the search dialog's chunk plus pagefind.js are over the search budget (§5.2: 16,000 B on open)", () => {
    const budgets = { ...generous, lazy: { ...generous.lazy, search: { gzip: 300, enforceWhen: "src/components/search" } } };
    const dialog = `async function o(){return import("/pagefind/pagefind.js")}${blob(200)}`;
    const { status, output } = check({ budgets, pagefindJs: blob(300), extraChunks: { "search-dialog.js": dialog } });
    assert.equal(status, 1, output);
    assert.match(output, /search on open: \d+ B \(the dialog's lazy chunk and pagefind\.js\) is over the budget of 300 B/);
  });

  test("the search dialog is there (src/components/search) but no lazy chunk loads pagefind.js: it is missing or in initial JS", () => {
    const budgets = { ...generous, lazy: { ...generous.lazy, search: { gzip: 16000, enforceWhen: "src/components/search" } } };
    const inInitial = `async function o(){return import("/pagefind/pagefind.js")}${blob(100)}`;
    const { status, output } = check({
      budgets,
      pagefindJs: blob(300),
      files: { "src/components/search/search-dialog.tsx": "export {};" },
      extraChunks: { "home.js": inInitial },
    });
    assert.equal(status, 1, output);
    assert.match(
      output,
      /no lazy chunk loads \/pagefind\/pagefind\.js, but src\/components\/search exists: the search dialog loads with next\/dynamic and imports it when it opens \(§3\.16\); an initial chunk loads it: \/_next\/static\/chunks\/home\.js/,
    );
  });

  test("a lazy chunk loads pagefind.js but the build has none (scripts/pagefind.mjs runs before check-budgets)", () => {
    const budgets = { ...generous, lazy: { ...generous.lazy, search: { gzip: 16000, enforceWhen: "src/components/search" } } };
    const dialog = `async function o(){return import("/pagefind/pagefind.js")}${blob(200)}`;
    const { status, output } = check({ budgets, extraChunks: { "search-dialog.js": dialog } });
    assert.equal(status, 1, output);
    assert.match(output, /pagefind\.js is missing from the build/);
  });

  test("one lazy chunk is over the per-chunk budget", () => {
    const { status, output } = check({ extraChunks: { "big-lazy.js": blob(9000) } });
    assert.equal(status, 1, output);
    assert.match(output, /lazy chunk \/_next\/static\/chunks\/big-lazy\.js is \d+ B, over the budget of 5000 B for one lazy chunk/);
  });

  test("the source has more arbitrary Tailwind values than the budget (tests don't count)", () => {
    const { status, output } = check({ source: 'className="w-[1px] h-[2px] p-[3px] m-[4px]"' });
    assert.equal(status, 1, output);
    assert.match(output, /arbitrary Tailwind values: 4 is over the budget of 3/);
  });

  test("a redesign target is a budget once its switch file exists (src/content/home.ts for the homepage)", () => {
    const budgets = { ...generous, routes: { ...generous.routes, "/": { ...generous.routes["/"], target: { htmlRaw: 10, htmlGzip: 10, enforceWhen: "src/content/home.ts" } } } };
    const { status, output } = check({ budgets, files: { "src/content/home.ts": "export {};" } });
    assert.equal(status, 1, output);
    assert.match(output, /\/: HTML \d+ B raw is over the redesign's target of 10 B \(enforced: src\/content\/home\.ts exists\)/);
    assert.match(output, /\/: HTML \d+ B gzip is over the redesign's target of 10 B \(enforced: src\/content\/home\.ts exists\)/);
  });

  test("a page's route matches no budget", () => {
    const budgets = { ...generous, routes: { "/": generous.routes["/"] } };
    const { status, output } = check({ budgets });
    assert.equal(status, 1, output);
    assert.match(output, /\/privacy\/: no budget in budgets\.json matches this route/);
  });
});

describe("budgets.json", () => {
  const budgets = JSON.parse(readFileSync(join(import.meta.dirname, "..", "budgets.json"), "utf8"));

  test("the docs hub gets the docs pages' HTML gate (§5.2) from D1's rewrite on; the other hubs keep the ratchet", () => {
    // §3.4: the hub D1 writes is about 150 words and the cards; D1 adds src/content/docs/quick-start.mdx with it.
    assert.deepEqual(budgets.routes["/docs/"].target, { htmlRaw: 90000, htmlGzip: 15000, enforceWhen: "src/content/docs/quick-start.mdx" });
    assert.equal(budgets.routes["/docs/"].jsGzip, 156000);
  });

  test("the checks hub holds what C1's hub measured (E1, 2026-09-28: 147,722 B raw, 25,926 B gzip) plus 5%, not the old page's ratchet", () => {
    assert.equal(budgets.routes["/checks/"].htmlRaw, 155000);
    assert.equal(budgets.routes["/checks/"].htmlGzip, 27200);
    assert.equal(budgets.routes["/checks/"].jsGzip, 156000);
  });

  test("search on open: the dialog's lazy chunk and pagefind.js within 16,000 B (§5.2), enforced once H1's search folder exists", () => {
    assert.deepEqual(budgets.lazy.search, { gzip: 16000, enforceWhen: "src/components/search" });
  });
});
