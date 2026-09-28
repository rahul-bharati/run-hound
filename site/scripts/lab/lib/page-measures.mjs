/**
 * What a reader sees on a page at rest, measured in the browser: words, screens, headings, type, reflow, the first
 * viewport. Run them with reduced motion so the page is its server-rendered final state. Ported from
 * site-design/evidence/scripts/skeleton-measure.mjs, h1-fit.mjs and judge-bm/brand-audit.mjs.
 */

/** The brief's word regex (readability.md): a letter or digit, then letters, digits and ' ’ . : / _ -. */
export const WORD_SOURCE = "[\\p{L}\\p{N}][\\p{L}\\p{N}'’.:/_\\-]*";

/**
 * Visible words in <main> (the browser method: rendered text nodes outside script, style, aria-hidden and .sr-only),
 * with the page height in screens, the main and footer heights, headings, tablists and each top-level block of <main>.
 */
export function measurePage(page) {
  return page.evaluate((wordSource) => {
    const word = new RegExp(wordSource, "gu");
    const count = (text) => (text.match(word) ?? []).length;
    const visibleWords = (root) => {
      let n = 0;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const element = node.parentElement;
        if (!element || element.closest("script,style,noscript,template,[aria-hidden=true],.sr-only")) continue;
        if (!element.checkVisibility({ visibilityProperty: true, opacityProperty: false })) continue;
        n += count(node.textContent);
      }
      return n;
    };
    const main = document.querySelector("main");
    // The site's footer: the contentinfo landmark, a footer outside article, aside, main, nav and section (a card's,
    // a quote's or an article's footer is no landmark), or role="contentinfo".
    const footer =
      document.querySelector('[role="contentinfo"]') ??
      [...document.querySelectorAll("footer")].find((element) => !element.parentElement.closest("article, aside, main, nav, section")) ??
      null;
    const height = document.documentElement.scrollHeight;
    return {
      viewport: { width: innerWidth, height: innerHeight },
      pageHeight: height,
      screens: Math.round((height / innerHeight) * 100) / 100,
      mainHeight: main ? Math.round(main.getBoundingClientRect().height) : 0,
      footerHeight: footer ? Math.round(footer.getBoundingClientRect().height) : 0,
      mainWords: main ? visibleWords(main) : 0,
      h1: document.querySelectorAll("h1").length,
      h2: main?.querySelectorAll("h2").length ?? 0,
      h3: main?.querySelectorAll("h3").length ?? 0,
      tablists: main?.querySelectorAll("[role=tablist]").length ?? 0,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      blocks: main
        ? [...main.children].map((block) => ({
            id: block.id || null,
            heading: (block.querySelector("h1,h2")?.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 60),
            px: Math.round(block.getBoundingClientRect().height),
            words: visibleWords(block),
          }))
        : [],
    };
  }, WORD_SOURCE);
}

/**
 * The type system over the visible text of <main>: the distinct computed font sizes (gate: at most 9), and the share
 * of words set in the mono face (gate on /: at most 12%).
 */
export function typeAudit(page) {
  return page.evaluate((wordSource) => {
    const word = new RegExp(wordSource, "gu");
    const main = document.querySelector("main");
    const sizes = new Map();
    let words = 0;
    let mono = 0;
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const element = node.parentElement;
      const n = (node.textContent.match(word) ?? []).length;
      if (!n || !element || element.closest("[aria-hidden=true],.sr-only") || !element.checkVisibility()) continue;
      const style = getComputedStyle(element);
      const size = `${Math.round(parseFloat(style.fontSize) * 10) / 10}px`;
      sizes.set(size, (sizes.get(size) ?? 0) + n);
      words += n;
      if (/mono/i.test(style.fontFamily)) mono += n;
    }
    return {
      fontSizes: Object.fromEntries([...sizes].sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))),
      distinctFontSizes: sizes.size,
      words,
      monoWords: mono,
      monoShare: words ? Math.round((mono / words) * 1000) / 1000 : 0,
    };
  }, WORD_SOURCE);
}

/**
 * Whether each element is inside the first viewport, wholly or at all: `selectors` maps a name to a CSS selector, or
 * to { text } to find the smallest element whose own text contains it.
 */
export function firstViewport(page, selectors) {
  return page.evaluate((wanted) => {
    const find = (target) => {
      if (typeof target === "string") return document.querySelector(target);
      const matches = [...document.querySelectorAll("body *")].filter(
        (element) => element.checkVisibility() && element.textContent.toLowerCase().includes(target.text.toLowerCase()),
      );
      return matches.find((element) => !matches.some((other) => other !== element && element.contains(other))) ?? null;
    };
    const out = {};
    for (const [name, target] of Object.entries(wanted)) {
      const element = find(target);
      if (!element) {
        out[name] = { found: false };
        continue;
      }
      const box = element.getBoundingClientRect();
      out[name] = {
        found: true,
        top: Math.round(box.top + scrollY),
        bottom: Math.round(box.bottom + scrollY),
        whollyInside: box.top >= 0 && box.bottom <= innerHeight,
        partlyInside: box.top < innerHeight && box.bottom > 0,
      };
    }
    return out;
  }, selectors);
}

/** How many lines an element's text takes, and the words on each (the h1's three phrases, the pill on one line). */
export function textLines(page, selector) {
  return page.evaluate((css) => {
    const element = document.querySelector(css);
    if (!element) return null;
    const range = document.createRange();
    const lines = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      for (const match of node.textContent.matchAll(/\S+/g)) {
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        const top = Math.round(range.getBoundingClientRect().top);
        let line = lines.find((l) => Math.abs(l.top - top) < 6);
        if (!line) lines.push((line = { top, words: [] }));
        line.words.push(match[0]);
      }
    }
    return lines.sort((a, b) => a.top - b.top).map((line) => line.words.join(" "));
  }, selector);
}
