/**
 * Keyboard and jump probes: what has focus, whether its ring shows and whether a sticky bar hides it (WCAG 2.4.7,
 * 2.4.11), tabbing until a control, reflow at 320 px and 400% zoom (320×256), and text left hidden after a jump (End,
 * an anchor). Ported from site-design/judge-eng/judge-measure.mjs (sections F, G, H), probe-menu.mjs and
 * probe-anchor.mjs.
 */
import { sleep } from "./browser.mjs";

/**
 * The focused element: its tag, role and accessible-ish name, whether a focus ring shows, whether the sticky or fixed
 * bars stacked down from the top of the viewport over its columns (the header, then the docs bar under it) cover it
 * wholly or partly, and whether it sits in aria-hidden.
 *
 * A ring is what focus adds: an outline (the site's ring is 2 px of accent) that the element doesn't have unfocused,
 * at least 2 px wide or the browser's own "auto" ring, and not transparent; or a box-shadow it doesn't have unfocused
 * (a Tailwind ring). The unfocused look is read from a shallow copy of the element placed beside it for a moment,
 * hidden and inert, so focus never moves (moving it would close a menu that closes when focus leaves). A card's
 * resting shadow is not a ring.
 */
export function focusInfo(page) {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (!element || element === document.body) return null;
    const style = getComputedStyle(element);
    const twin = element.cloneNode(false);
    twin.removeAttribute("id");
    twin.removeAttribute("autofocus");
    twin.setAttribute("inert", "");
    twin.setAttribute("aria-hidden", "true");
    twin.style.setProperty("visibility", "hidden", "important");
    twin.style.setProperty("position", "absolute", "important");
    twin.style.setProperty("pointer-events", "none", "important");
    element.after(twin);
    const rest = getComputedStyle(twin);
    const unfocused = { outline: `${rest.outlineStyle} ${rest.outlineWidth} ${rest.outlineColor}`, boxShadow: rest.boxShadow };
    twin.remove();
    // Fully transparent in any colour syntax (a Tailwind opacity modifier computes to oklab(… / 0)): drawn on a pixel.
    const transparent = (color) => {
      const context = new OffscreenCanvas(1, 1).getContext("2d", { willReadFrequently: true });
      context.fillStyle = "rgba(0, 0, 0, 0)";
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return context.getImageData(0, 0, 1, 1).data[3] === 0;
    };
    const outline = `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}`;
    const outlineRing =
      style.outlineStyle !== "none" &&
      (style.outlineStyle === "auto" || parseFloat(style.outlineWidth) >= 2) &&
      !transparent(style.outlineColor) &&
      outline !== unfocused.outline;
    const shadowRing = Boolean(style.boxShadow) && style.boxShadow !== "none" && style.boxShadow !== unfocused.boxShadow;
    const box = element.getBoundingClientRect();
    const bars = [...document.querySelectorAll("body *")].filter((node) => {
      const position = getComputedStyle(node).position;
      return (position === "sticky" || position === "fixed") && !node.contains(element) && node.getBoundingClientRect().height > 0;
    });
    // The bars over the element's columns, chained down from the top of the viewport: the header, then a bar stacked
    // under it (the docs bar, §3.5), and so on. A bar beside the element, or one lower down, covers nothing above it.
    const stacked = bars
      .map((bar) => bar.getBoundingClientRect())
      .filter((bar) => bar.left < box.right && bar.right > box.left)
      .sort((a, b) => a.top - b.top);
    let barBottom = 0;
    for (const bar of stacked) if (bar.top <= barBottom + 1 && bar.bottom > barBottom) barBottom = bar.bottom;
    return {
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute("role"),
      name: (element.getAttribute("aria-label") || element.innerText || element.getAttribute("title") || "").trim().replace(/\s+/g, " ").slice(0, 40),
      ring: outlineRing || shadowRing,
      fullyObscured: box.bottom <= barBottom + 1,
      partlyObscured: box.top < barBottom - 1 && box.bottom > barBottom,
      offscreen: box.bottom < 0 || box.top > innerHeight,
      inAriaHidden: Boolean(element.closest('[aria-hidden="true"]')),
      inHeader: Boolean(element.closest("header")),
    };
  });
}

/** Presses Tab (or Shift+Tab) until the focused element's name matches, at most `max` times; returns its info. */
export async function tabUntil(page, pattern, { max = 30, back = false, pause = 40 } = {}) {
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press(back ? "Shift+Tab" : "Tab");
    await sleep(pause);
    const info = await focusInfo(page);
    if (info && pattern.test(info.name)) return info;
  }
  return null;
}

/**
 * Every Tab stop of the page, forward from its start, with focusInfo for each: it stops when focus comes back to the
 * first element (the same element, not one with the same name), leaves the page, or after `max` stops. Load the page
 * right before, so Tab starts at the top.
 */
export async function tabStops(page, { max = 200, pause = 30 } = {}) {
  const stops = [];
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press("Tab");
    await sleep(pause);
    const back = await page.evaluate((first) => {
      const element = document.activeElement;
      if (!element || element === document.body) return true;
      if (first) {
        if (element.hasAttribute("data-lab-first-stop")) return true;
        element.setAttribute("data-lab-first-stop", "");
      }
      return false;
    }, i === 0);
    if (back) break;
    stops.push(await focusInfo(page));
  }
  await page.evaluate(() => document.querySelector("[data-lab-first-stop]")?.removeAttribute("data-lab-first-stop"));
  return stops;
}

/**
 * Reflow: horizontal overflow in px, the header's position (static at 400% zoom), and the sticky or fixed elements
 * with their heights (gate: 0 px overflow at 320 px on every route; bars static at max-height: 30rem).
 */
export function reflow(page) {
  return page.evaluate(() => {
    const header = document.querySelector("header");
    return {
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      headerPosition: header ? getComputedStyle(header).position : null,
      sticky: [...document.querySelectorAll("body *")]
        .filter((element) => ["sticky", "fixed"].includes(getComputedStyle(element).position) && element.getBoundingClientRect().height > 0)
        .map((element) => `${element.tagName.toLowerCase()}.${(element.getAttribute("class") ?? "").split(" ")[0]}:${Math.round(element.getBoundingClientRect().height)}`),
    };
  });
}

/** Text in <main> (outside aria-hidden) that is in the viewport yet at an effective opacity under 0.05. */
export function hiddenTextInView(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("main h1, main h2, main h3, main p, main li, main a, main figcaption")]
      .filter((element) => {
        let opacity = 1;
        for (let node = element; node && node !== document.body; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
        const box = element.getBoundingClientRect();
        return opacity < 0.05 && box.bottom > 0 && box.top < innerHeight && !element.closest('[aria-hidden="true"]') && element.textContent.trim();
      })
      .map((element) => `${element.tagName.toLowerCase()}: ${element.textContent.trim().slice(0, 30)}`),
  );
}

/** After a jump (End, or an anchor), walks the page top to bottom and collects text left hidden (gate: none). */
export async function hiddenTextAfterJump(page, { step = 400, pause = 300 } = {}) {
  const seen = new Set();
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < height; y += step) {
    await page.evaluate((to) => window.scrollTo(0, to), y);
    await sleep(pause);
    for (const item of await hiddenTextInView(page)) seen.add(item);
  }
  return [...seen];
}
