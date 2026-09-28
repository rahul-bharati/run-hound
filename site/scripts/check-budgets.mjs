/**
 * Runs last in `pnpm build`: byte budgets per route, read from the build, with no browser (§5.2 of the design).
 *
 * - Initial JS per route: gzip -9 of the first-party <script src> files a modern browser runs (noModule left out),
 *   against the route's budget; the JS every page shares, and the home page's own (page-specific) JS, against theirs.
 * - HTML per route, raw and gzip -9 (the inline RSC payload included).
 * - Preloaded fonts per route (<link rel="preload"> of .woff2, raw bytes).
 * - Bans: no initial chunk may contain GSAP (its core, ScrollTrigger or DrawSVG) or Pagefind's Component UI (motion
 *   and search load later), recognised as scripts/lib/chunk-patterns.mjs says.
 * - Lazy JS: no chunk that no page loads up front may be over the one-chunk budget, and the lazy chunks with GSAP's
 *   core, ScrollTrigger or DrawSVG in them may not together be over the motion budget.
 * - Search on open (lazy.search): the lazy chunk of the search dialog (the one that imports /pagefind/pagefind.js,
 *   §3.16) plus pagefind.js (<build folder>/pagefind/, or public/pagefind/ for a build in .next, as scripts/pagefind.mjs
 *   writes it) against the search budget. Before the dialog exists this is a note; once the folder its `enforceWhen`
 *   names exists (H1's src/components/search), a build with no lazy chunk that loads pagefind.js fails.
 * - Arbitrary Tailwind values in site/src (class strings like px-[72px], tests left out) against the ratchet.
 *
 * Budgets live in budgets.json. A route's budget is its exact entry ("/", "/docs/", "404" for the 404 page), then
 * "/<first>/*\/" for pages one level down ("/docs/*\/", "/checks/*\/"), then the "*" fallback, which holds any other
 * page to the default; a page that matches none of them fails, so budgets.json without "*" makes every new kind of
 * page name its budget. A route's `target` is the redesign's limit it doesn't meet yet: over it, the build prints a
 * note, until the file its `enforceWhen` names (relative to budgets.json, e.g. "src/content/home.ts") exists; from
 * then on the target fails the build like a budget. Prints a table, also into $GITHUB_STEP_SUMMARY when it is set.
 *
 * Usage: node scripts/check-budgets.mjs [--dist <build folder>] [--budgets <file>] [--src <dir>] [--public <dir>]
 */
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { distDir as defaultDist, htmlFilesSync, routeOf, siteDir, sourceFiles, tags } from "./lib/build-output.mjs";
import { chunkPatterns, librariesIn, searchDialogPattern } from "./lib/chunk-patterns.mjs";
import { option } from "./lib/registry.mjs";

const args = process.argv.slice(2);
const dist = resolve(option(args, "dist") ?? defaultDist);
const budgetsFile = resolve(option(args, "budgets") ?? join(siteDir, "budgets.json"));
const budgets = JSON.parse(readFileSync(budgetsFile, "utf8"));
const srcDir = resolve(option(args, "src") ?? join(siteDir, "src"));
const publicDir = resolve(option(args, "public") ?? join(siteDir, "public"));
const appDir = join(dist, "server", "app");

if (!existsSync(appDir)) {
  console.error(`check-budgets: ${relative(siteDir, appDir) || appDir} is missing. Run this after next build (pnpm build does).`);
  process.exit(1);
}

const gz = (buffer) => gzipSync(buffer, { level: 9 }).length;
const errors = [];
const notes = [];

/** What a chunk must not contain up front, and how to recognise it (scripts/lib/chunk-patterns.mjs). */
const bans = [
  { name: "GSAP", pattern: chunkPatterns.gsap },
  { name: "ScrollTrigger", pattern: chunkPatterns.scrollTrigger },
  { name: "DrawSVG", pattern: chunkPatterns.drawSVG },
  { name: "Pagefind's Component UI", pattern: chunkPatterns.pagefindUI },
];

const chunkCache = new Map();
/** A /_next/static/… file of the build: its bytes, gzip size and text. */
function chunk(src) {
  if (!chunkCache.has(src)) {
    const file = join(dist, "static", decodeURIComponent(src.replace(/^\/_next\/static\//, "").split("?")[0]));
    const bytes = existsSync(file) ? readFileSync(file) : undefined;
    chunkCache.set(src, bytes ? { bytes, gzip: gz(bytes), text: bytes.toString("latin1") } : undefined);
  }
  return chunkCache.get(src);
}

/** Every page of the build: its route ("404" for the not-found page), scripts, HTML size and preloaded fonts. */
const pages = [];
const referenced = new Set();
for (const file of htmlFilesSync(appDir)) {
  const name = relative(appDir, file);
  if (name === "_global-error.html") continue;
  const html = readFileSync(file);
  const text = html.toString("utf8");
  const modern = [];
  for (const [, before, src, after] of text.matchAll(/<script\b([^>]*)\ssrc="([^"]+)"([^>]*)>/g)) {
    if (!src.startsWith("/_next/static/")) continue;
    referenced.add(src);
    if (/\bnomodule\b/i.test(before + after)) continue;
    if (!modern.includes(src)) modern.push(src);
  }
  const fonts = [
    ...new Set(
      tags(text, "link")
        .filter((link) => link.rel?.toLowerCase() === "preload" && /\.woff2(?:[?#]|$)/.test(link.href ?? ""))
        .map((link) => link.href),
    ),
  ];
  pages.push({
    route: name === "_not-found.html" ? "404" : routeOf(name),
    scripts: modern,
    htmlRaw: html.length,
    htmlGzip: gz(html),
    fontBytes: fonts.reduce((sum, src) => sum + (chunk(src)?.bytes.length ?? 0), 0),
  });
}
pages.sort((a, b) => a.route.localeCompare(b.route));

/** The budget for a route: an exact route, then "/<first>/*\/" for pages one level down, then "*". */
function budgetFor(route) {
  const routes = budgets.routes ?? {};
  if (routes[route]) return { key: route, ...routes[route] };
  const parts = route.split("/").filter(Boolean);
  if (parts.length === 2 && routes[`/${parts[0]}/*/`]) return { key: `/${parts[0]}/*/`, ...routes[`/${parts[0]}/*/`] };
  if (routes["*"]) return { key: "*", ...routes["*"] };
  return undefined;
}

// Shared JS: the scripts every page loads.
const shared = pages.length ? pages.map((p) => p.scripts).reduce((a, b) => a.filter((src) => b.includes(src))) : [];
const sharedGzip = shared.reduce((sum, src) => sum + (chunk(src)?.gzip ?? 0), 0);
if (budgets.shared?.jsGzip !== undefined && sharedGzip > budgets.shared.jsGzip) {
  errors.push(`shared JS ${sharedGzip} B is over its budget of ${budgets.shared.jsGzip} B`);
}

const rows = [];
for (const page of pages) {
  const missing = page.scripts.filter((src) => !chunk(src));
  for (const src of missing) errors.push(`${page.route}: script ${src} is not in the build`);
  const jsGzip = page.scripts.reduce((sum, src) => sum + (chunk(src)?.gzip ?? 0), 0);
  const pageJsGzip = jsGzip - sharedGzip;
  for (const src of page.scripts) {
    const found = chunk(src);
    if (!found) continue;
    for (const ban of bans) if (ban.pattern.test(found.text)) errors.push(`initial chunk ${src} contains ${ban.name} (on ${page.route})`);
  }
  rows.push({ ...page, jsGzip, pageJsGzip });
  const budget = budgetFor(page.route);
  if (!budget) {
    errors.push(`${page.route}: no budget in budgets.json matches this route`);
    continue;
  }
  const over = (what, value, limit, unit = "B") => {
    if (limit !== undefined && value > limit) errors.push(`${page.route}: ${what} ${value} ${unit} is over its budget of ${limit} ${unit} (${budget.key})`);
  };
  over("initial JS", jsGzip, budget.jsGzip);
  if (budget.pageJsGzip !== undefined && pageJsGzip > budget.pageJsGzip) {
    errors.push(`${page.route}: page-specific JS ${pageJsGzip} B is over its budget of ${budget.pageJsGzip} B`);
  }
  if (budget.htmlRaw !== undefined && page.htmlRaw > budget.htmlRaw) {
    errors.push(`${page.route}: HTML ${page.htmlRaw} B raw is over its budget of ${budget.htmlRaw} B (${budget.key})`);
  }
  if (budget.htmlGzip !== undefined && page.htmlGzip > budget.htmlGzip) {
    errors.push(`${page.route}: HTML ${page.htmlGzip} B gzip is over its budget of ${budget.htmlGzip} B (${budget.key})`);
  }
  if (budgets.fonts?.preloadBytes !== undefined && page.fontBytes > budgets.fonts.preloadBytes) {
    errors.push(`${page.route}: preloaded fonts ${page.fontBytes} B are over the budget of ${budgets.fonts.preloadBytes} B`);
  }
  // The redesign's target: a note until its switch file exists, then a budget.
  const switchFile = budget.target?.enforceWhen;
  const enforced = switchFile !== undefined && existsSync(resolve(dirname(budgetsFile), switchFile));
  for (const [what, value, limit] of [
    ["HTML raw", page.htmlRaw, budget.target?.htmlRaw],
    ["HTML gzip", page.htmlGzip, budget.target?.htmlGzip],
    ["initial JS", jsGzip, budget.target?.jsGzip],
  ]) {
    if (limit === undefined || value <= limit) continue;
    const label = what === "HTML raw" ? `HTML ${value} B raw` : what === "HTML gzip" ? `HTML ${value} B gzip` : `${what} ${value} B`;
    if (enforced) errors.push(`${page.route}: ${label} is over the redesign's target of ${limit} B (enforced: ${switchFile} exists)`);
    else notes.push(`${page.route}: ${what} ${value} B is over the redesign's target of ${limit} B${switchFile ? ` (enforced once ${switchFile} exists)` : ""}`);
  }
}

// Lazy JS: the chunks no page loads up front (dynamic imports: motion, the search dialog).
const chunksDir = join(dist, "static", "chunks");
const lazy = [];
for (const file of existsSync(chunksDir) ? readdirSync(chunksDir, { recursive: true }) : []) {
  const src = `/_next/static/chunks/${String(file).split("\\").join("/")}`;
  if (!src.endsWith(".js") || referenced.has(src) || !statSync(join(chunksDir, String(file))).isFile()) continue;
  const found = chunk(src);
  const libraries = librariesIn(found.text);
  lazy.push({ src, gzip: found.gzip, ...libraries, motion: libraries.gsap || libraries.scrollTrigger || libraries.drawSVG });
}
const motionChunks = lazy.filter((c) => c.motion);
const lazyGsap = motionChunks.reduce((sum, c) => sum + c.gzip, 0);
for (const c of lazy) {
  if (budgets.lazy?.maxChunkGzip !== undefined && c.gzip > budgets.lazy.maxChunkGzip) {
    errors.push(`lazy chunk ${c.src} is ${c.gzip} B, over the budget of ${budgets.lazy.maxChunkGzip} B for one lazy chunk`);
  }
}
if (budgets.lazy?.gsapGzip !== undefined && lazyGsap > budgets.lazy.gsapGzip) {
  errors.push(`lazy GSAP chunks: ${lazyGsap} B is over the budget of ${budgets.lazy.gsapGzip} B`);
}

// Search on open: the dialog's lazy chunk (it imports Pagefind's search API) and pagefind.js.
let searchLine;
const search = budgets.lazy?.search;
if (search) {
  const dialogChunks = lazy.filter((c) => searchDialogPattern.test(chunk(c.src).text));
  const dialogGzip = dialogChunks.reduce((sum, c) => sum + c.gzip, 0);
  const apiFile = [join(dist, "pagefind", "pagefind.js"), join(publicDir, "pagefind", "pagefind.js")].find((file) => existsSync(file));
  const apiGzip = apiFile ? gz(readFileSync(apiFile)) : undefined;
  const switchFile = search.enforceWhen;
  const enforced = switchFile !== undefined && existsSync(resolve(dirname(budgetsFile), switchFile));
  if (dialogChunks.length === 0) {
    const initial = [...referenced].filter((src) => chunk(src) && searchDialogPattern.test(chunk(src).text));
    if (enforced) {
      errors.push(
        `no lazy chunk loads /pagefind/pagefind.js, but ${switchFile} exists: the search dialog loads with next/dynamic and imports it when it opens (§3.16)` +
          (initial.length ? `; an initial chunk loads it: ${initial.join(", ")}` : ""),
      );
    } else {
      notes.push(
        `no lazy chunk loads /pagefind/pagefind.js yet (the search dialog, §3.16); ` +
          (apiGzip === undefined ? "the build has no pagefind.js" : `pagefind.js is ${apiGzip} B of the ${search.gzip} B search budget`),
      );
    }
  } else if (apiGzip === undefined) {
    errors.push(`the search dialog (${dialogChunks.map((c) => c.src).join(", ")}) loads /pagefind/pagefind.js, but pagefind.js is missing from the build (scripts/pagefind.mjs writes it)`);
  } else {
    const total = dialogGzip + apiGzip;
    searchLine = `search on open: ${total} B (dialog ${dialogGzip} B in ${dialogChunks.length} chunk${dialogChunks.length === 1 ? "" : "s"} + pagefind.js ${apiGzip} B; budget ${search.gzip})`;
    if (total > search.gzip) {
      errors.push(`search on open: ${total} B (the dialog's lazy chunk and pagefind.js) is over the budget of ${search.gzip} B`);
    }
  }
}

// Arbitrary Tailwind values: the ratchet (no growth), counted the way the design counted 139 (.ts and .tsx, no tests).
const arbitrary = sourceFiles(srcDir).reduce((sum, file) => sum + (readFileSync(file, "utf8").match(/[a-z:-]+-\[[^\] "]+\]/g) ?? []).length, 0);
if (budgets.arbitraryValues !== undefined && arbitrary > budgets.arbitraryValues) {
  errors.push(`arbitrary Tailwind values: ${arbitrary} is over the budget of ${budgets.arbitraryValues} (move them into tokens or component classes)`);
}

const table = [
  `${"route".padEnd(26)} ${"JS gzip".padStart(8)} ${"own JS".padStart(7)} ${"HTML raw".padStart(9)} ${"HTML gz".padStart(8)} ${"fonts".padStart(7)}`,
  ...rows.map(
    (r) =>
      `${r.route.padEnd(26)} ${String(r.jsGzip).padStart(8)} ${String(r.pageJsGzip).padStart(7)} ${String(r.htmlRaw).padStart(9)} ${String(r.htmlGzip).padStart(8)} ${String(r.fontBytes).padStart(7)}`,
  ),
];
const summary = [
  `shared JS ${sharedGzip} B (budget ${budgets.shared?.jsGzip ?? "none"}), ${shared.length} files`,
  `lazy chunks: ${lazy.length}, largest ${Math.max(0, ...lazy.map((c) => c.gzip))} B; lazy GSAP chunks: ${lazyGsap} B in ${motionChunks.length} chunks ` +
    `(core in ${motionChunks.filter((c) => c.gsap).length}, ScrollTrigger in ${motionChunks.filter((c) => c.scrollTrigger).length}, ` +
    `DrawSVG in ${motionChunks.filter((c) => c.drawSVG).length}; budget ${budgets.lazy?.gsapGzip ?? "none"})`,
  ...(searchLine ? [searchLine] : []),
  `arbitrary Tailwind values: ${arbitrary} (budget ${budgets.arbitraryValues ?? "none"})`,
];
console.log(table.join("\n"));
for (const line of summary) console.log(`check-budgets: ${line}`);
for (const note of notes) console.log(`check-budgets: note: ${note}`);
for (const error of errors) console.error(`check-budgets: ${error}`);
console.log(`check-budgets: ${rows.length} pages, ${errors.length} errors`);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `### Site budgets\n\n\`\`\`\n${[...table, "", ...summary, ...notes, ...errors].join("\n")}\n\`\`\`\n`,
  );
}
if (errors.length > 0) process.exit(1);
