/**
 * The page audits: axe-core (through @axe-core/playwright), the accent budget (§2.3: at most one strong accent object
 * per viewport-sized window at rest, outside the exempt uses), and the contrast sampler that resolves axe's
 * "incomplete" colour-contrast nodes over gradients and pictures. Ported from site-design/judge-bm/brand-audit.mjs and
 * judge-eng/contrast.mjs (which sampled with Python; here the browser's canvas does it).
 */
import { AxeBuilder } from "@axe-core/playwright";

/** The WCAG 2.2 AA rules and best practices the lab runs. */
export const axeTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

/** axe-core on the page: violations (gate: none) and the ids of the incomplete rules. */
export async function runAxe(page, { tags = axeTags } = {}) {
  const results = await new AxeBuilder({ page }).withTags(tags).analyze();
  return {
    version: results.testEngine.version,
    violations: results.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.length,
      targets: v.nodes.slice(0, 5).map((n) => n.target.join(" ")),
    })),
    incomplete: results.incomplete.map((v) => ({ id: v.id, nodes: v.nodes.length })),
  };
}

/**
 * The accent audit at rest (§2.3). A "strong" accent object is a filled shape, an accent stroke or border of 2 px or
 * more, or accent display text (≥ 24 px). Exempt, as §2.3 lists them:
 * - link text: the text colour of anything inside a link or a button (ArrowLink, inline links). A link's or a button's
 *   accent fill, border or stroke still counts: an accent-filled card link is the loud pattern this audit catches;
 * - focus rings (outlines are never counted);
 * - anything inside an element marked data-accent-exempt: the primary button (G2's ButtonLink primary variant carries
 *   the attribute), the key words of the h1 and the closing h2, and the status marks of a product figure (the run
 *   window's progress and ticks, the EVIDENCE stamp).
 * Visually hidden text (.sr-only, or any box of 1 px or less) is never seen, so it is never counted. An SVG counts
 * once, as its outermost <svg>: an accent icon is one object however many shapes it draws; a shape counts when its fill
 * covers more than 1 px each way, or its stroke of 2 px or more runs more than 1 px.
 * A colour is the accent when, in sRGB, each channel is within 8 of it and its alpha is at least 0.35. Every computed
 * colour is converted to sRGB in the page's canvas first: Chromium reports Tailwind's opacity modifiers
 * (border-accent/60, bg-accent/10), which compile to color-mix(in oklab, …), as oklab(…), and a token may be written in
 * oklch() or color(); a regex for rgb() would miss them all.
 * For each viewport-sized window of the page (every half viewport), the strong objects outside the exempt uses
 * (gate: at most 1 per window).
 */
export function accentAudit(page, { accent = [[94, 230, 163]] } = {}) {
  return page.evaluate((colours) => {
    const context = new OffscreenCanvas(1, 1).getContext("2d", { willReadFrequently: true });
    const converted = new Map();
    /** A CSS colour as sRGB [r, g, b] (0-255) and alpha (0-1), drawn on one canvas pixel. */
    const rgba = (value) => {
      if (!converted.has(value)) {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = "rgba(0, 0, 0, 0)";
        context.fillStyle = value;
        context.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
        converted.set(value, [r, g, b, a / 255]);
      }
      return converted.get(value);
    };
    const isAccent = (value) => {
      if (!value || value === "none") return false;
      const [r, g, b, a] = rgba(value);
      return a >= 0.35 && colours.some(([R, G, B]) => Math.abs(R - r) < 8 && Math.abs(G - g) < 8 && Math.abs(B - b) < 8);
    };
    const objects = [];
    for (const element of document.querySelectorAll("main *")) {
      // Exempt, or not seen at all: visually hidden text (.sr-only, a 1 px clipped box) is read out, never shown.
      if (element.closest("[data-accent-exempt], .sr-only")) continue;
      // An SVG shape is part of its outermost <svg>: one icon is one object, however many shapes draw it, placed by
      // that box. The shape itself is judged by its own box, which leaves the stroke out: a fill needs an area (a
      // 0.67 px dot is not a strong object), and a stroke a length (a straight line's box is 0 px across).
      let node = element;
      while (node instanceof SVGElement && node.ownerSVGElement) node = node.ownerSVGElement;
      const shape = node !== element;
      const inLink = Boolean(element.closest("a,button"));
      const own = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (style.visibility === "hidden" || Number(style.opacity) < 0.05) continue;
      if (!shape && (own.width <= 1 || own.height <= 1)) continue;
      const ownText = [...element.childNodes].some((child) => child.nodeType === 3 && child.textContent.trim());
      const reasons = [];
      if (isAccent(style.backgroundColor) && own.width > 1 && own.height > 1) reasons.push("fill");
      if (element instanceof SVGElement) {
        if (isAccent(style.fill) && style.fill !== "none" && own.width > 1 && own.height > 1) reasons.push("svg fill");
        if (isAccent(style.stroke) && parseFloat(style.strokeWidth) >= 2 && Math.max(own.width, own.height) > 1) reasons.push("stroke ≥ 2px");
      }
      for (const side of ["Top", "Right", "Bottom", "Left"]) {
        if (parseFloat(style[`border${side}Width`]) >= 2 && isAccent(style[`border${side}Color`])) reasons.push(`border-${side.toLowerCase()} ≥ 2px`);
      }
      if (!inLink && ownText && isAccent(style.color) && parseFloat(style.fontSize) >= 24) reasons.push("display text");
      if (reasons.length === 0) continue;
      const same = objects.find((o) => o.node === node);
      if (same) {
        same.reasons = [...new Set([...same.reasons, ...reasons])];
        continue;
      }
      const box = node.getBoundingClientRect();
      objects.push({
        node,
        element: `${node.tagName.toLowerCase()}.${(node.getAttribute("class") ?? "").split(" ")[0]}`,
        top: Math.round(box.top + scrollY),
        bottom: Math.round(box.bottom + scrollY),
        reasons: [...new Set(reasons)],
      });
    }
    // Windows of one viewport, every half viewport down the page.
    const windows = [];
    const height = document.documentElement.scrollHeight;
    for (let top = 0; top < height; top += innerHeight / 2) {
      const inside = objects.filter((o) => o.top < top + innerHeight && o.bottom > top);
      windows.push({ top: Math.round(top), strong: inside.length });
    }
    return {
      objects: objects.map(({ element, top, bottom, reasons }) => ({ element, top, bottom, reasons })),
      windows,
      maxPerWindow: Math.max(0, ...windows.map((w) => w.strong)),
    };
  }, accent);
}

/**
 * The contrast sampler: axe's "incomplete" colour-contrast nodes (text over gradients and pictures, which axe can't
 * judge), each measured against the real pixels behind it, as judge-eng/contrast.py did. With all text made
 * transparent, it scrolls each node to the middle of the viewport and screenshots its box (a full-page screenshot
 * would resize the viewport, and anything sized in viewport units would move), samples a 24×8 grid of background
 * pixels inside the box (8% in from each edge) in the page's own canvas, composites the text colour (with its alpha) over each, and takes the
 * 10th-percentile WCAG ratio, so a rounded corner or an anti-aliased edge doesn't decide (gate: every node ≥ 4.5:1, or
 * 3:1 for large text).
 */
export async function contrastSample(page) {
  const results = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
  const incomplete = results.incomplete.find((rule) => rule.id === "color-contrast");
  if (!incomplete) return [];
  // The text colours first, while the text still has them, as sRGB and alpha (a computed colour may be oklab(): see
  // accentAudit).
  const colours = await page.evaluate(
    (css) => {
      const context = new OffscreenCanvas(1, 1).getContext("2d", { willReadFrequently: true });
      const rgba = (value) => {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = "rgba(0, 0, 0, 0)";
        context.fillStyle = value;
        context.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
        return [r, g, b, a / 255];
      };
      return css.map((target) => {
        const element = document.querySelector(target);
        if (!element) return null;
        const computed = getComputedStyle(element);
        const size = parseFloat(computed.fontSize);
        const weight = Number(computed.fontWeight);
        return { target, text: element.textContent.trim().slice(0, 30), color: rgba(computed.color), size, large: size >= 24 || (size >= 18.66 && weight >= 700) };
      });
    },
    incomplete.nodes.map((node) => node.target[0]),
  );
  const style = await page.addStyleTag({
    content:
      "*, *::before, *::after { color: transparent !important; text-shadow: none !important; -webkit-text-fill-color: transparent !important; caret-color: transparent !important; transition: none !important; }",
  });
  const measured = [];
  try {
    for (const node of colours.filter(Boolean)) {
      const box = await page.evaluate((css) => {
        const element = document.querySelector(css);
        element.scrollIntoView({ block: "center", inline: "center" });
        const rect = element.getBoundingClientRect();
        const x = Math.max(0, rect.x);
        const y = Math.max(0, rect.y);
        return { x, y, width: Math.min(innerWidth, rect.right) - x, height: Math.min(innerHeight, rect.bottom) - y };
      }, node.target);
      if (box.width < 1 || box.height < 1) continue;
      const png = await page.screenshot({ clip: box, animations: "disabled" });
      measured.push({ ...node, ...box, png: png.toString("base64") });
    }
  } finally {
    await style.evaluate((element) => element.remove());
  }
  return page.evaluate(async (list) => {
    const channel = (value) => {
      const c = value / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const out = [];
    for (const { png, ...node } of list) {
      const image = new Image();
      image.src = `data:image/png;base64,${png}`;
      await image.decode();
      const canvas = new OffscreenCanvas(image.width, image.height);
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, image.width, image.height).data;
      const [r, g, b, a] = node.color;
      // A grid inside the box, 8% in from each edge: a box that starts on half a pixel, a rounded corner or an
      // anti-aliased border would otherwise put the page behind the element into the samples.
      const ratios = [];
      const insetX = Math.max(2, Math.round(image.width * 0.08));
      const insetY = Math.max(2, Math.round(image.height * 0.08));
      const stepX = Math.max(1, Math.floor((image.width - 2 * insetX) / 24));
      const stepY = Math.max(1, Math.floor((image.height - 2 * insetY) / 8));
      for (let row = Math.min(insetY, image.height - 1); row < Math.max(image.height - insetY, 1); row += stepY) {
        for (let col = Math.min(insetX, image.width - 1); col < Math.max(image.width - insetX, 1); col += stepX) {
          const i = (row * image.width + col) * 4;
          const bg = [pixels[i], pixels[i + 1], pixels[i + 2]];
          const fg = [r, g, b].map((c, k) => a * c + (1 - a) * bg[k]);
          ratios.push(ratio(luminance(fg), luminance(bg)));
        }
      }
      ratios.sort((p, q) => p - q);
      const p10 = ratios[Math.floor(ratios.length / 10)];
      out.push({ ...node, ratio: Math.round(p10 * 100) / 100, passes: p10 >= (node.large ? 3 : 4.5) });
    }
    return out;
  }, measured);
}
