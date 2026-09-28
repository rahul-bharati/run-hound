/**
 * Motion measures for the motion contract (§4.6 of the design): requestAnimationFrame callbacks at rest, the text
 * audit (no element with words is ever faded or moved), and what rests invisible after a full scroll. Ported from
 * site-design/judge-eng/probe-loop.mjs, judge-measure.mjs (sections C, E, F) and evidence/scripts/raf-pending.mjs.
 */
import { sleep } from "./browser.mjs";

/**
 * Counts requestAnimationFrame callbacks from navigation (window.__raf). Install before goto(). The unwrapped function
 * stays in window.__rafOriginal, so the lab's own frame loops (timeline.mjs) are never counted as the page's.
 */
export async function installRafCounter(page) {
  await page.addInitScript(() => {
    window.__raf = 0;
    window.__rafOriginal ??= window.requestAnimationFrame;
    const original = window.__rafOriginal.bind(window);
    window.requestAnimationFrame = (callback) => {
      window.__raf += 1;
      return original(callback);
    };
  });
}

/** rAF callbacks during the next `ms` milliseconds. */
export async function rafDuring(page, ms = 3000) {
  const before = await page.evaluate(() => window.__raf);
  await sleep(ms);
  return (await page.evaluate(() => window.__raf)) - before;
}

/**
 * rAF callbacks at rest at `points` stop points (every 5% of the page for 21), scrolling down to each in 120 px steps,
 * resting `rest` ms there, then counting for `window` ms (gate: 0 at every stop point).
 */
export async function rafAtStopPoints(page, { points = 21, rest = 2000, window: span = 3000, step = 120, pause = 50 } = {}) {
  const height = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  const counts = [];
  let y = await page.evaluate(() => scrollY);
  for (let i = 0; i < points; i += 1) {
    const target = Math.round((height * i) / (points - 1));
    while (y < target) {
      y = Math.min(target, y + step);
      await page.evaluate((to) => window.scrollTo(0, to), y);
      await sleep(pause);
    }
    await sleep(rest);
    counts.push({ at: Math.round((i / (points - 1)) * 100), y, raf: await rafDuring(page, span) });
  }
  return counts;
}

/**
 * The text audit (§4.6 #3): samples every 50 ms, from DOMContentLoaded, every element in <main> that holds a text node
 * with words, whatever its tag (outside aria-hidden, .sr-only, script, style, svg, noscript and template, as the word
 * count leaves them out), and records each one that is below opacity 1 (its own or an ancestor's) or moved by motion.
 * Moved means:
 * - an inline transform on it or an ancestor that isn't the identity, read from the CSSOM (element.style.transform,
 *   .translate, .rotate, .scale), not the style attribute: GSAP writes "translate: none; rotate: none; scale: none;
 *   transform: translate(0px, 20px)", and a "none" in the attribute says nothing about the transform;
 * - or a computed transform (transform, translate, rotate, scale, on it or an ancestor) that changed between samples,
 *   or that differs from the element's resting value when readTextAudit() runs: motion driven by CSS classes,
 *   transitions and animations. A transform that stays put from the first sample to rest (a centred badge) is layout,
 *   not motion.
 * Install before goto(); read with readTextAudit() once the page rests.
 */
export async function installTextAudit(page) {
  await page.addInitScript(() => {
    const words = /[\p{L}\p{N}][\p{L}\p{N}'’.:/_\-]*/u;
    const isIdentityMatrix = (value) => {
      if (!value || value === "none") return true;
      try {
        return new DOMMatrixReadOnly(value).isIdentity;
      } catch {
        return false; // a percentage or a relative length: not the identity
      }
    };
    const isIdentityPart = (property, value) => {
      if (!value || value === "none") return true;
      const parts = value.trim().split(/\s+/);
      if (property === "translate") return parts.every((part) => parseFloat(part) === 0);
      if (property === "scale") return parts.every((part) => (part.endsWith("%") ? parseFloat(part) === 100 : parseFloat(part) === 1));
      if (property === "rotate") return parseFloat(parts.at(-1)) === 0;
      return false;
    };
    /** Whether a style declaration (inline or computed) holds a transform that isn't the identity; its text if so. */
    const transformOf = (style) =>
      [
        isIdentityMatrix(style.transform) ? "" : `transform:${style.transform}`,
        ...["translate", "rotate", "scale"].map((property) => (isIdentityPart(property, style[property]) ? "" : `${property}:${style[property]}`)),
      ]
        .filter(Boolean)
        .join(";");
    /** An element's opacity, inline motion and computed transforms through its ancestors, as one sample. */
    const read = (element, memo) => {
      let opacity = 1;
      let inline = false;
      const chain = [];
      for (let node = element, depth = 0; node && node !== document.body; node = node.parentElement, depth += 1) {
        let own = memo?.get(node);
        if (!own) {
          const computed = getComputedStyle(node);
          own = { opacity: Number(computed.opacity), inline: transformOf(node.style) !== "", transform: transformOf(computed) };
          memo?.set(node, own);
        }
        opacity *= own.opacity;
        inline ||= own.inline;
        if (own.transform) chain.push(`${depth}:${own.transform}`);
      }
      return { opacity, inline, chain: chain.join("|") };
    };
    const keyOf = (element) => `${element.tagName.toLowerCase()} «${element.textContent.trim().replace(/\s+/g, " ").slice(0, 40)}»`;
    /** element → { key, minOpacity, inline, samples, chains (at most 2 distinct), seenBelowOne } */
    const tracked = new Map();
    window.__textAuditRead = read;
    window.__textAuditTracked = tracked;
    const sample = () => {
      const main = document.querySelector("main");
      if (main) {
        const memo = new Map();
        // Every element that holds a text node with words, whatever its tag: finding cards, stamps and commands are
        // divs, spans and code elements, and a faded span inside a still paragraph is its own holder.
        const holders = new Set();
        const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (node.parentElement && words.test(node.textContent)) holders.add(node.parentElement);
        }
        for (const element of holders) {
          if (element.closest('[aria-hidden="true"], .sr-only, script, style, svg, noscript, template')) continue;
          if (!element.getClientRects().length) continue;
          const now = read(element, memo);
          const seen = tracked.get(element) ?? { key: keyOf(element), minOpacity: 1, inline: false, samples: 0, chains: new Set() };
          seen.minOpacity = Math.min(seen.minOpacity, now.opacity);
          seen.inline ||= now.inline;
          seen.samples += 1;
          if (seen.chains.size < 2) seen.chains.add(now.chain);
          tracked.set(element, seen);
        }
      }
      setTimeout(sample, 50);
    };
    document.addEventListener("DOMContentLoaded", sample);
  });
}

/**
 * Every element with words the text audit caught (gate: none): { element, minOpacity, moved, samples }, where samples
 * is how many samples saw the element. Call it once the page rests: an element's resting transform is read now.
 */
export function readTextAudit(page) {
  return page.evaluate(() => {
    const found = new Map();
    for (const [element, seen] of window.__textAuditTracked ?? []) {
      const rest = element.isConnected ? window.__textAuditRead(element).chain : "";
      const moved = seen.inline || seen.chains.size > 1 || [...seen.chains][0] !== rest;
      if (seen.minOpacity >= 0.999 && !moved) continue;
      const before = found.get(seen.key) ?? { element: seen.key, minOpacity: 1, moved: false, samples: 0 };
      found.set(seen.key, {
        element: seen.key,
        minOpacity: Math.min(before.minOpacity, seen.minOpacity),
        moved: before.moved || moved,
        samples: before.samples + seen.samples,
      });
    }
    return [...found.values()];
  });
}

/**
 * After a full scroll: elements in <main> resting at opacity 0 that take up room, and the running infinite CSS
 * animations (gates: only the documented rest classes; none).
 */
export function restState(page) {
  return page.evaluate(() => ({
    atOpacityZero: [...document.querySelectorAll("main *")]
      .filter((element) => Number(getComputedStyle(element).opacity) < 0.05 && element.getClientRects().length)
      .map((element) => `${element.tagName.toLowerCase()}.${(element.getAttribute("class") ?? "").split(" ")[0]}[${element.getAttribute("data-part") ?? ""}]`),
    infiniteAnimations: document
      .getAnimations()
      .filter((animation) => animation.playState === "running" && animation.effect?.getComputedTiming().iterations === Infinity).length,
    gsapLoaded: typeof window.gsapVersions !== "undefined",
  }));
}
