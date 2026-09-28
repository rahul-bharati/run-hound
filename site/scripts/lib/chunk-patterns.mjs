/**
 * How the build guards and the lab recognise a library inside a minified JavaScript chunk: GSAP's core, ScrollTrigger,
 * DrawSVG and Pagefind's ready-made search UIs. check-budgets bans them from initial chunks and totals the lazy motion
 * chunks; the lab's request log (scripts/lab/lib/requests.mjs) flags each script it downloads.
 *
 * A pattern has to survive a production build: comments are stripped, and a bundler renames every top-level name (a
 * function called _rafBugFix, the ScrollTrigger class and the DrawSVGPlugin variable all disappear), while property
 * names and string literals stay. So each library is known by those, checked against the real files by
 * chunk-patterns.test.mjs (GSAP 3.15 minified with Next.js's own SWC, as a module and as a bundle leaves it, and the UI
 * bundles Pagefind 1.5.2 writes):
 * - GSAP core: the gsapVersions global it sets, and "GreenSock" in its licence check;
 * - ScrollTrigger: its scrollerProxy and clearScrollMemory methods (GSAP's core only calls ScrollTrigger.create, so
 *   that name would also match the core);
 * - DrawSVG: the plugin's registered name, name:"drawSVG" (and DrawSVGPlugin where the export keeps its name);
 * - Pagefind's Component UI registers its custom elements (pagefind-modal, pagefind-searchbox, pagefind-input,
 *   pagefind-results, pagefind-summary, pagefind-config); the older Modular and Default UIs use pagefind-modular-*
 *   and pagefind-ui__ class names and PagefindUI. pagefind.js, the search API the site's own dialog loads, matches none.
 *
 * Node built-ins only.
 */
export const chunkPatterns = {
  gsap: /gsapVersions|GreenSock/,
  scrollTrigger: /scrollerProxy|clearScrollMemory/,
  drawSVG: /DrawSVGPlugin|name:\s*["']drawSVG["']/,
  pagefindUI:
    /customElements\.define\(\s*["']pagefind-(?:modal|searchbox|input|results|summary|config)\b|pagefind-modular-|PagefindUI|pagefind-ui__/,
};

/**
 * The site's search dialog (§3.16), in whichever chunk holds it: it imports Pagefind's search API from the path the
 * index is served at (import("/pagefind/pagefind.js"), which the bundler leaves alone), a string no minifier touches.
 * check-budgets totals that chunk and pagefind.js against the search-on-open budget.
 */
export const searchDialogPattern = /\/pagefind\/pagefind\.js/;

/** Which of the libraries above a chunk's text holds: { gsap, scrollTrigger, drawSVG, pagefindUI } as booleans. */
export function librariesIn(text) {
  return Object.fromEntries(Object.entries(chunkPatterns).map(([name, pattern]) => [name, pattern.test(text)]));
}

/** Whether a chunk holds any of GSAP's motion code (core, ScrollTrigger or DrawSVG): the lazy motion budget's chunks. */
export const isMotion = (text) => chunkPatterns.gsap.test(text) || chunkPatterns.scrollTrigger.test(text) || chunkPatterns.drawSVG.test(text);
