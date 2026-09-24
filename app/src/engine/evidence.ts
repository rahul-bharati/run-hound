/// <reference path="../types/gifenc.d.ts" />
// The reference keeps the gifenc typings with this module, so other workspace packages that import it (tests/acceptance) typecheck too.
import gifencDefault from "gifenc";
import * as gifencNamespace from "gifenc";
import { PNG } from "pngjs";
import type { Browser, BrowserContext, Locator, Page } from "playwright";
import type { Box, Fact, Highlight } from "../core/types.js";

/** Frame layout, in CSS px of the composed image. */
export const FRAME = {
  /** Header strip: URL, capture time, check and step. */
  headerHeight: 64,
  /** Facts panel on the right, when there are facts. */
  factsWidth: 360,
  /** GIFs are scaled down to at most this width (a 1280 px page plus the facts panel stays readable at this size). */
  gifMaxWidth: 1200,
  /** At most this many frames in a GIF; extra steps keep the first and last ones. */
  gifMaxFrames: 12,
  /** Delay per GIF frame and for the last frame (so the result can be read). */
  gifFrameDelayMs: 900,
  gifLastFrameDelayMs: 2500,
} as const;

/** What a composed frame shows besides the screenshot. All text must already be redacted. */
export interface FrameHeader {
  url: string;
  capturedAt: string;
  /** "<check id> · <scenario title>". */
  title: string;
  step?: string;
  caption?: string;
  facts?: Fact[];
}

type ResolvedHighlight = Highlight & { box: Box };

/** Width of a text card, in CSS px (fits a GIF without scaling). */
const CARD_WIDTH = 960;
/** A card shows at most this many lines, and cuts each one at this many characters. */
const CARD_MAX_LINES = 40;
const CARD_MAX_LINE_CHARS = 600;
/** Outline thickness of a highlight, drawn just outside the element's box. */
const RING = 3;
/**
 * With more marks than this, the page shows only the numbered outlines and the facts panel lists what each number
 * means: a dozen callouts on neighbouring elements cover each other and the page they are meant to explain.
 */
const MAX_CALLOUTS = 5;
/** Callouts are cut (with an ellipsis) at this width; the full label is always in the facts panel's legend. */
const CALLOUT_MAX_WIDTH = 440;
/** Diameter of a numbered badge. */
const BADGE = 20;

const TONE_COLOURS: Record<NonNullable<Highlight["tone"]>, string> = {
  fail: "#FF5A4F",
  pass: "#3BB273",
  info: "#F5B642",
};

const THEME = {
  header: "#0E1116",
  panel: "#161B22",
  panelBorder: "#2D333B",
  text: "#E6EDF3",
  muted: "#8B949E",
  url: "#79C0FF",
  step: "#F5B642",
  code: "#0B0E13",
};
/** Colour used to pad GIF frames of different sizes (matches the facts panel). */
const PAD_RGB = [0x16, 0x1b, 0x22] as const;

/**
 * gifenc ships CommonJS ("main") and an ESM build ("module") whose default export is only GIFEncoder. Node loads the
 * CommonJS build (functions on the default export); Vite-based runners load the ESM build (named exports).
 */
const gifenc: typeof gifencDefault =
  typeof (gifencNamespace as unknown as typeof gifencDefault).quantize === "function" ? (gifencNamespace as unknown as typeof gifencDefault) : gifencDefault;

const SANS = `"Inter", "Adwaita Sans", "Segoe UI", "Helvetica Neue", Arial, "Liberation Sans", "DejaVu Sans", sans-serif`;
const MONO = `"JetBrains Mono", "IBM Plex Mono", "SFMono-Regular", Menlo, Consolas, "DejaVu Sans Mono", "Liberation Mono", monospace`;

/**
 * Finds each highlight on the page. Selector highlights use the element's bounding box; box highlights are taken as is.
 * Scrolls the first found element to the middle of the viewport when it is not fully in view (unless fullPage) and returns boxes in the coordinates of the screenshot
 * that will be taken next: viewport coordinates, or page coordinates when fullPage. Highlights whose selector matches
 * nothing visible come back in `missing` (the frame lists them as facts, never silently drops them).
 */
export async function resolveHighlights(
  page: Page,
  highlights: Highlight[],
  options: { fullPage?: boolean } = {},
): Promise<{ resolved: ResolvedHighlight[]; missing: Highlight[] }> {
  const missing: Highlight[] = [];
  const found: { highlight: Highlight; locator?: Locator }[] = [];
  for (const highlight of highlights) {
    if (!highlight.selector) {
      if (highlight.box) found.push({ highlight });
      else missing.push(highlight);
      continue;
    }
    const locator = page.locator(highlight.selector).first();
    // An invalid selector is treated like one that matches nothing.
    const visible = await locator.isVisible().catch(() => false);
    if (visible) found.push({ highlight, locator });
    else missing.push(highlight);
  }

  const firstElement = found.find((f) => f.locator)?.locator;
  if (firstElement && !options.fullPage) {
    // Centred rather than just inside an edge, so the frame shows what is around the element (the rows next to a
    // saved record, the label above a field) and the callout has room.
    const centred = await firstElement
      .evaluate((el) => {
        const r = el.getBoundingClientRect();
        if (r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth) return true;
        // A tall element (a whole form) keeps the old behaviour: the check has usually scrolled to the part that matters.
        if (r.height > window.innerHeight * 0.6) return false;
        el.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
        return true;
      }, undefined, { timeout: 2000 })
      .catch(() => false);
    if (!centred) await firstElement.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => undefined);
  }
  const scroll = options.fullPage ? await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY })) : { x: 0, y: 0 };

  const resolved: ResolvedHighlight[] = [];
  for (const { highlight, locator } of found) {
    if (!locator) {
      resolved.push(highlight as ResolvedHighlight);
      continue;
    }
    const box = await locator.boundingBox({ timeout: 2000 }).catch(() => null);
    if (!box || box.width <= 0 || box.height <= 0) {
      missing.push(highlight);
      continue;
    }
    resolved.push({ ...highlight, box: { x: box.x + scroll.x, y: box.y + scroll.y, width: box.width, height: box.height } });
  }
  return { resolved, missing };
}

// ---------------------------------------------------------------------------------------------------------------------
// Rendering in a blank, offline browser context

interface Renderer {
  context: BrowserContext;
  page: Page;
}

const renderers = new WeakMap<Browser, Promise<Renderer>>();
const renderQueues = new WeakMap<Browser, Promise<unknown>>();

async function openRenderer(browser: Browser): Promise<Renderer> {
  const context = await browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1, offline: true });
  // Evidence is built from our own HTML and data: URLs only; anything else is refused before it is sent.
  await context.route(/^(?!data:|about:)/i, (route) => route.abort());
  const page = await context.newPage();
  return { context, page };
}

/** One offline render page per browser, reused; renders are serialised so they never share the page. */
function withRenderer<T>(browser: Browser, render: (page: Page) => Promise<T>): Promise<T> {
  const previous = renderQueues.get(browser) ?? Promise.resolve();
  const run = previous
    .catch(() => undefined)
    .then(async () => {
      let renderer = await renderers.get(browser)?.catch(() => undefined);
      if (!renderer || renderer.page.isClosed()) {
        const opening = openRenderer(browser);
        renderers.set(browser, opening);
        renderer = await opening;
      }
      return render(renderer.page);
    });
  renderQueues.set(browser, run);
  return run;
}

/** Loads `html` into the render page at `width`, runs `layout` in it, and returns a PNG of the whole document. */
async function renderHtml(
  browser: Browser,
  html: string,
  width: number,
  layout?: (page: Page) => Promise<void>,
): Promise<{ png: Buffer; width: number; height: number }> {
  return withRenderer(browser, async (page) => {
    await page.setViewportSize({ width, height: 600 });
    await page.setContent(html, { waitUntil: "load" });
    if (layout) await layout(page);
    const height = await page.evaluate(() => Math.ceil(document.getElementById("frame")!.getBoundingClientRect().height));
    await page.setViewportSize({ width, height });
    const png = await page.screenshot({ type: "png", animations: "disabled", caret: "initial" });
    return { png, width, height };
  });
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

const BASE_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: ${THEME.header}; overflow: hidden; }
  body { font-family: ${SANS}; color: ${THEME.text}; -webkit-font-smoothing: antialiased; }
  #frame { display: flex; flex-direction: column; }
  .mono { font-family: ${MONO}; }
  .header { height: ${FRAME.headerHeight}px; flex: none; background: ${THEME.header}; border-bottom: 1px solid ${THEME.panelBorder};
    padding: 9px 14px 0; display: flex; flex-direction: column; gap: 5px; overflow: hidden; }
  .row { display: flex; align-items: baseline; gap: 10px; min-width: 0; white-space: nowrap; }
  .grow { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .brand { flex: none; font-size: 10px; font-weight: 700; letter-spacing: .08em; color: ${THEME.header}; background: ${THEME.text};
    padding: 2px 5px; border-radius: 3px; position: relative; top: -1px; }
  .title { font-size: 14px; font-weight: 650; }
  .step { color: ${THEME.step}; font-weight: 600; }
  .sep { color: ${THEME.muted}; padding: 0 6px; font-weight: 400; }
  .time { flex: none; font-size: 12px; color: ${THEME.muted}; }
  .url { font-size: 13px; color: ${THEME.url}; }
  .facts-title { font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: ${THEME.muted}; }
  .fact { padding: 8px 0; border-top: 1px solid ${THEME.panelBorder}; }
  .fact:first-of-type { border-top: 0; }
  .fact-label { font-size: 12px; color: ${THEME.muted}; margin-bottom: 3px; }
  .fact-value { font-family: ${MONO}; font-size: 13px; line-height: 1.4; color: ${THEME.text}; white-space: pre-wrap; overflow-wrap: anywhere; }
  .fact.alert .fact-label { color: ${TONE_COLOURS.fail}; font-weight: 600; }
`;

function headerHtml(header: { url: string; capturedAt: string; title: string; step?: string }): string {
  const step = header.step ? `<span class="sep">›</span><span class="step">${escapeHtml(header.step)}</span>` : "";
  return `<div class="header">
    <div class="row"><span class="brand">RUN HOUND</span><span class="title grow">${escapeHtml(header.title)}${step}</span>
      <span class="time mono">${escapeHtml(header.capturedAt)}</span></div>
    <div class="row"><span class="url mono grow">${escapeHtml(header.url)}</span></div>
  </div>`;
}

/** Facts whose label says something was not found are drawn in the fail colour. */
function factsHtml(facts: Fact[]): string {
  return facts
    .map((f) => {
      const alert = /not found|outside the captured area/i.test(f.label) ? " alert" : "";
      return `<div class="fact${alert}"><div class="fact-label">${escapeHtml(f.label)}</div><div class="fact-value">${escapeHtml(f.value)}</div></div>`;
    })
    .join("");
}

function toneColour(tone: Highlight["tone"]): string {
  return TONE_COLOURS[tone ?? "fail"];
}

/** Intersects a box with the screenshot; null when nothing of it is inside. */
function clipBox(box: Box, width: number, height: number): Box | null {
  const x = Math.max(0, box.x);
  const y = Math.max(0, box.y);
  const right = Math.min(width, box.x + box.width);
  const bottom = Math.min(height, box.y + box.height);
  if (right - x < 1 || bottom - y < 1) return null;
  return { x, y, width: right - x, height: bottom - y };
}

type Rect = { left: number; top: number; right: number; bottom: number };

/**
 * Three or more outlines packed together (a column of small icons, rows of a list): their callouts can't all sit
 * next to their own mark, so they would cover each other and the page. The numbered outlines and the legend say it.
 */
function denseCluster(rings: Rect[]): boolean {
  if (rings.length < 3) return false;
  let close = 0;
  for (let i = 0; i < rings.length; i++) {
    for (let j = i + 1; j < rings.length; j++) {
      const a = rings[i]!;
      const b = rings[j]!;
      const gapX = Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right));
      const gapY = Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom));
      if (gapX < 12 && gapY < 12) close++;
    }
  }
  return close >= 2;
}

/**
 * Where a mark's numbered badge goes. On a tall outline it sits on the top-left corner, mostly outside it. On a short
 * one (a table row, a list item) the corner would sit level with the element above, so the badge goes to the left of
 * the outline, vertically centred on it; inside the left edge when there is no room outside.
 */
function badgePosition(ring: Rect, width: number, height: number): { x: number; y: number } {
  const clampX = (x: number) => Math.min(Math.max(x, 1), width - BADGE - 1);
  const clampY = (y: number) => Math.min(Math.max(y, 1), height - BADGE - 1);
  if (ring.bottom - ring.top < 2 * BADGE) {
    const outside = ring.left - BADGE - 3;
    return { x: clampX(outside >= 1 ? outside : ring.left + 3), y: clampY(Math.round((ring.top + ring.bottom - BADGE) / 2)) };
  }
  return { x: clampX(ring.left - 15), y: clampY(ring.top - 15) };
}

/**
 * Composes an evidence frame PNG: header strip (URL, time, title, step), the screenshot with each highlight drawn as a
 * 3 px outline plus a numbered label (fail = #FF5A4F, pass = #3BB273, info = #F5B642), the caption under it, and a
 * facts panel on the right when there are facts. Rendered by Chromium in a blank page (no network), returned as PNG.
 * Highlight boxes returned are in the composed image's pixel coordinates. Highlights entirely outside the screenshot
 * are dropped; partly visible ones are clipped to it.
 *
 * `obstacles` are boxes of the page's own controls and text (screenshot coordinates): callouts avoid covering them,
 * and every outline, so a callout never sits inside a field it does not describe. With more than MAX_CALLOUTS marks, or
 * three or more packed together, only the numbered outlines are drawn and the legend in the facts panel says what each
 * number means.
 */
export async function composeFrame(
  browser: Browser,
  screenshot: Buffer,
  header: FrameHeader,
  highlights: ResolvedHighlight[],
  options: { obstacles?: Box[] } = {},
): Promise<{ png: Buffer; highlights: ResolvedHighlight[]; width: number; height: number }> {
  const shot = PNG.sync.read(screenshot);
  const facts = header.facts ?? [];

  const marks = highlights.flatMap((h) => {
    const box = clipBox(h.box, shot.width, shot.height);
    return box ? [{ ...h, box: { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) } }] : [];
  });
  const rings = marks.map((m) => ({
    // The outline sits just outside the element, pulled back inside the image at its edges.
    left: Math.max(0, m.box.x - RING),
    top: Math.max(0, m.box.y - RING),
    right: Math.min(shot.width, m.box.x + m.box.width + RING),
    bottom: Math.min(shot.height, m.box.y + m.box.height + RING),
  }));
  const callouts = marks.length <= MAX_CALLOUTS && !denseCluster(rings);
  // The legend lives in the facts panel; without callouts it is the only place that names each mark.
  const panel = facts.length > 0 || (marks.length > 0 && !callouts);
  const width = shot.width + (panel ? FRAME.factsWidth : 0);
  const markHtml = marks
    .map((m, i) => {
      const colour = toneColour(m.tone);
      const { left, top, right, bottom } = rings[i]!;
      const badge = badgePosition(rings[i]!, shot.width, shot.height);
      return `<div class="ring" style="left:${left}px;top:${top}px;width:${right - left}px;height:${bottom - top}px;border-color:${colour}"></div>
        <div class="badge" style="left:${badge.x}px;top:${badge.y}px;background:${colour}">${i + 1}</div>
        ${
          callouts
            ? `<div class="callout" data-index="${i}" style="background:${colour}"><b>${i + 1}</b><span>${escapeHtml(m.label)}</span></div>`
            : ""
        }`;
    })
    .join("");
  const obstacles = (options.obstacles ?? []).flatMap((b) => {
    const c = clipBox(b, shot.width, shot.height);
    return c ? [{ left: c.x, top: c.y, right: c.x + c.width, bottom: c.y + c.height }] : [];
  });
  const badges = rings.map((r) => {
    const b = badgePosition(r, shot.width, shot.height);
    return { left: b.x, top: b.y, right: b.x + BADGE, bottom: b.y + BADGE };
  });

  const legend =
    marks.length > 0
      ? `<div class="facts-title" style="margin-top:${facts.length > 0 ? 16 : 0}px">Marked on the page</div>` +
        marks
          .map((m, i) => `<div class="legend"><span class="dot" style="background:${toneColour(m.tone)}">${i + 1}</span><span>${escapeHtml(m.label)}</span></div>`)
          .join("")
      : "";

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
    .body { display: flex; align-items: stretch; }
    .main { width: ${shot.width}px; flex: none; }
    .shot { position: relative; width: ${shot.width}px; height: ${shot.height}px; overflow: hidden; background: #fff; }
    .shot img { display: block; width: ${shot.width}px; height: ${shot.height}px; }
    .leaders { position: absolute; left: 0; top: 0; overflow: visible; }
    .leaders line { stroke-width: 2; stroke-linecap: round; filter: drop-shadow(0 0 1px rgba(255,255,255,.9)); }
    .ring { position: absolute; border: ${RING}px solid; border-radius: 2px;
      box-shadow: 0 0 0 1px rgba(0,0,0,.55), inset 0 0 0 1px rgba(255,255,255,.7); }
    .badge { position: absolute; width: ${BADGE}px; height: ${BADGE}px; border-radius: ${BADGE / 2}px; color: #150706; font: 700 11px/${BADGE}px ${SANS};
      text-align: center; box-shadow: 0 0 0 2px #fff, 0 1px 4px rgba(0,0,0,.45); }
    .callout { position: absolute; left: 0; top: 0; visibility: hidden; display: flex; align-items: center; gap: 6px;
      max-width: ${Math.max(80, Math.min(CALLOUT_MAX_WIDTH, shot.width - 8))}px; padding: 3px 9px 3px 4px; border-radius: 12px; color: #150706;
      font: 600 13px/18px ${SANS}; white-space: nowrap; box-shadow: 0 0 0 1.5px rgba(255,255,255,.9), 0 2px 6px rgba(0,0,0,.4); }
    .callout b { flex: none; width: 18px; height: 18px; border-radius: 9px; background: rgba(0,0,0,.78); color: #fff;
      font: 700 11px/18px ${SANS}; text-align: center; }
    .callout span { overflow: hidden; text-overflow: ellipsis; }
    .caption { padding: 10px 14px 12px; font-size: 14px; line-height: 1.45; color: ${THEME.text}; background: ${THEME.header};
      border-top: 1px solid ${THEME.panelBorder}; }
    .facts { width: ${FRAME.factsWidth}px; flex: none; background: ${THEME.panel}; border-left: 1px solid ${THEME.panelBorder}; padding: 14px 16px; }
    .facts-title { margin-bottom: 6px; }
    .legend { display: flex; gap: 8px; align-items: flex-start; font-size: 13px; line-height: 20px; padding: 3px 0; }
    .dot { flex: none; width: 20px; height: 20px; border-radius: 10px; color: #150706; font: 700 11px/20px ${SANS}; text-align: center; }
  </style></head><body><div id="frame" style="width:${width}px">
    ${headerHtml(header)}
    <div class="body">
      <div class="main">
        <div class="shot"><img src="data:image/png;base64,${screenshot.toString("base64")}" alt="">
          <svg class="leaders" width="${shot.width}" height="${shot.height}"></svg>${markHtml}</div>
        ${header.caption ? `<div class="caption">${escapeHtml(header.caption)}</div>` : ""}
      </div>
      ${panel ? `<div class="facts">${facts.length > 0 ? `<div class="facts-title">Facts</div>${factsHtml(facts)}` : ""}${legend}</div>` : ""}
    </div>
  </div></body></html>`;

  const rendered = await renderHtml(browser, html, width, (page) =>
    page.evaluate(placeCalloutsScript({ width: shot.width, height: shot.height, rings, badges, obstacles })),
  );
  return {
    ...rendered,
    highlights: marks.map((m) => ({ ...m, box: { ...m.box, y: m.box.y + FRAME.headerHeight } })),
  };
}

/**
 * Runs in the render page: puts each callout next to its outline, inside the screenshot and clear of the callouts
 * already placed. Among the spots around the outline it prefers the plainest one (fewest distinct pixels in the
 * screenshot), so a callout covers page background rather than the labels and text it is meant to explain. A spot
 * that covers another mark's outline, any badge, or one of the page's controls (an empty input is "plain" too, but a
 * callout on it reads as if it described that field) is only used when nothing better is left.
 * Kept as plain JavaScript source, because TypeScript loaders may wrap named functions in helpers the page lacks.
 */
function placeCalloutsScript(area: { width: number; height: number; rings: Rect[]; badges: Rect[]; obstacles: Rect[] }): string {
  return `(() => {
    const area = ${JSON.stringify(area)};
    const img = document.querySelector(".shot img");
    let pixels = null;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = area.width;
      canvas.height = area.height;
      const g = canvas.getContext("2d", { willReadFrequently: true });
      g.drawImage(img, 0, 0);
      pixels = g.getImageData(0, 0, area.width, area.height).data;
    } catch {}
    /** Edges (text, borders, icons) per sampled pixel in and just around the rectangle: 0 = plain background. */
    const busyness = (r) => {
      if (!pixels) return 0;
      const lum = (x, y) => { const i = (y * area.width + x) * 4; return pixels[i] * 0.3 + pixels[i + 1] * 0.59 + pixels[i + 2] * 0.11; };
      let edges = 0, total = 0;
      for (let y = Math.max(1, (r.top - 4) | 0); y < Math.min(area.height - 1, r.bottom + 4); y += 2) {
        for (let x = Math.max(1, (r.left - 4) | 0); x < Math.min(area.width - 1, r.right + 4); x += 2) {
          const v = lum(x, y);
          if (Math.abs(v - lum(x + 1, y)) > 30 || Math.abs(v - lum(x, y + 1)) > 30) edges++;
          total++;
        }
      }
      return total ? edges / total : 1;
    };
    const hits = (r, p, gap) => r.left < p.right + gap && r.right + gap > p.left && r.top < p.bottom + gap && r.bottom + gap > p.top;
    const placed = [];
    const overlaps = (r) => placed.some((p) => hits(r, p, 2));
    for (const el of document.querySelectorAll(".callout")) {
      const index = +el.dataset.index;
      const ring = area.rings[index];
      const otherRings = area.rings.filter((_, i) => i !== index);
      const w = el.offsetWidth, h = el.offsetHeight;
      const clampX = (x) => Math.min(Math.max(x, 4), Math.max(4, area.width - w - 4));
      const clampY = (y) => Math.min(Math.max(y, 4), Math.max(4, area.height - h - 4));
      const midY = (ring.top + ring.bottom - h) / 2;
      // In order of preference; a later spot wins only if it covers clearly less of the page.
      const candidates = [
        { x: ring.right + 10, y: midY },
        { x: clampX(ring.left + 14), y: ring.top - h - 12 },
        { x: clampX(ring.left + 14), y: ring.bottom + 8 },
        { x: clampX(ring.right - w), y: ring.top - h - 12 },
        { x: clampX(ring.right - w), y: ring.bottom + 8 },
        { x: ring.left - w - 10, y: midY },
        { x: ring.right + 50, y: midY },
        { x: ring.right + 100, y: midY },
        { x: ring.left - w - 50, y: midY },
        { x: clampX(ring.left + 14), y: ring.top - h - 40 },
        { x: clampX(ring.left + 14), y: ring.bottom + 36 },
        { x: ring.right + 10, y: ring.top - h - 12 },
        { x: ring.right + 10, y: ring.bottom + 8 },
        { x: clampX(ring.left + 16), y: ring.top + 16 },
      ];
      const fits = (c) => c.y >= 4 && c.y + h <= area.height - 4 && c.x >= 4 && c.x + w <= area.width - 4;
      const rect = (c) => ({ left: c.x, top: c.y, right: c.x + w, bottom: c.y + h });
      const penalty = (r) =>
        (otherRings.some((o) => hits(r, o, 1)) ? 3 : 0) +
        (area.badges.some((b) => hits(r, b, 1)) ? 2 : 0) +
        (hits(r, ring, -1) ? 1.5 : 0) +
        (area.obstacles.some((o) => hits(r, o, 0)) ? 1 : 0);
      let choice = null;
      let best = Infinity;
      candidates.forEach((c, i) => {
        if (!fits(c) || overlaps(rect(c))) return;
        const score = busyness(rect(c)) + penalty(rect(c)) + i * 0.01;
        if (score < best) { best = score; choice = c; }
      });
      if (!choice) {
        // Stack below the nearest valid spot until it is clear of the others.
        const start = candidates.find(fits);
        let c = { x: start ? start.x : clampX(ring.left + 14), y: clampY(start ? start.y : ring.top) };
        for (let i = 0; i < 40 && overlaps(rect(c)); i++) c = { x: c.x, y: clampY(c.y + h + 4) };
        choice = c;
      }
      placed.push(rect(choice));
      // A leader line from the callout to its outline when they don't touch.
      const r = rect(choice);
      const px = Math.min(Math.max((r.left + r.right) / 2, ring.left), ring.right);
      const py = Math.min(Math.max((r.top + r.bottom) / 2, ring.top), ring.bottom);
      const cx = Math.min(Math.max(px, r.left), r.right);
      const cy = Math.min(Math.max(py, r.top), r.bottom);
      if (Math.hypot(px - cx, py - cy) > 8) {
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", cx); line.setAttribute("y1", cy); line.setAttribute("x2", px); line.setAttribute("y2", py);
        line.setAttribute("stroke", el.style.background || el.style.backgroundColor);
        document.querySelector(".leaders").appendChild(line);
      }
      el.style.left = choice.x + "px";
      el.style.top = choice.y + "px";
      el.style.visibility = "visible";
    }
  })()`;
}

/**
 * Renders a text card PNG with the same header strip: title, subtitle, monospace lines (marked lines highlighted,
 * long lines wrapped, at most 40 lines with a "… N more lines" note) and facts. All text must already be redacted.
 * When the first marked line is beyond the first 40, the 40 lines shown are taken around it. `firstLineNumber` is the
 * number printed next to the first line (default 1), for excerpts of a file.
 */
export async function renderCard(
  browser: Browser,
  header: Omit<FrameHeader, "caption" | "step" | "facts">,
  card: { title: string; subtitle?: string; lines: { text: string; mark?: boolean }[]; firstLineNumber?: number; facts?: Fact[] },
): Promise<Buffer> {
  const total = card.lines.length;
  // Excerpts of a file number their lines as the file does ("line 6"), so the gutter matches the Line fact.
  const offset = Math.max(1, Math.floor(card.firstLineNumber ?? 1)) - 1;
  const firstMark = card.lines.findIndex((l) => l.mark);
  const start = total <= CARD_MAX_LINES || firstMark < CARD_MAX_LINES ? 0 : Math.min(firstMark - 5, total - CARD_MAX_LINES);
  const end = Math.min(total, start + CARD_MAX_LINES);
  const numberWidth = String(end + offset).length;

  const lineHtml = card.lines
    .slice(start, end)
    .map((line, i) => {
      const text = line.text.length > CARD_MAX_LINE_CHARS ? `${line.text.slice(0, CARD_MAX_LINE_CHARS)} … (+${line.text.length - CARD_MAX_LINE_CHARS} chars)` : line.text;
      return `<div class="line${line.mark ? " mark" : ""}"><span class="n">${String(offset + start + i + 1).padStart(numberWidth, " ")}</span><span class="t">${escapeHtml(text) || " "}</span></div>`;
    })
    .join("");
  const note = (n: number, where: string) => (n > 0 ? `<div class="note">… ${n} more line${n === 1 ? "" : "s"} ${where}</div>` : "");

  const facts = card.facts ?? [];
  const factHtml = facts.length
    ? `<div class="chips">${facts
        .map((f) => `<div class="chip"><div class="fact-label">${escapeHtml(f.label)}</div><div class="fact-value">${escapeHtml(f.value)}</div></div>`)
        .join("")}</div>`
    : "";

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
    .card { padding: 16px 20px 20px; background: ${THEME.panel}; }
    .card-title { font-size: 18px; font-weight: 650; line-height: 1.3; overflow-wrap: anywhere; }
    .subtitle { margin-top: 4px; font-size: 13px; color: ${THEME.url}; overflow-wrap: anywhere; }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    .chip { background: ${THEME.header}; border: 1px solid ${THEME.panelBorder}; border-radius: 6px; padding: 6px 10px; max-width: 100%; }
    .chip .fact-label { margin-bottom: 1px; }
    .code { margin-top: 14px; background: ${THEME.code}; border: 1px solid ${THEME.panelBorder}; border-radius: 6px; padding: 8px 0;
      font-family: ${MONO}; font-size: 13px; line-height: 20px; }
    .line { display: flex; padding: 0 12px 0 0; border-left: 3px solid transparent; }
    .line .n { flex: none; color: #545d68; padding: 0 12px 0 9px; white-space: pre; user-select: none; }
    .line .t { white-space: pre-wrap; overflow-wrap: anywhere; min-width: 0; color: #C9D1D9; }
    .line.mark { background: rgba(255, 90, 79, .16); border-left-color: ${TONE_COLOURS.fail}; }
    .line.mark .n { color: ${TONE_COLOURS.fail}; font-weight: 700; }
    .line.mark .t { color: #fff; }
    .note { padding: 4px 12px 2px 24px; color: ${THEME.muted}; font-family: ${SANS}; font-size: 12px; font-style: italic; }
  </style></head><body><div id="frame" style="width:${CARD_WIDTH}px">
    ${headerHtml(header)}
    <div class="card">
      <div class="card-title">${escapeHtml(card.title)}</div>
      ${card.subtitle ? `<div class="subtitle mono">${escapeHtml(card.subtitle)}</div>` : ""}
      ${factHtml}
      ${total > 0 ? `<div class="code">${note(start, "above")}${lineHtml}${note(total - end, "not shown")}</div>` : ""}
    </div>
  </div></body></html>`;

  return (await renderHtml(browser, html, CARD_WIDTH)).png;
}

// ---------------------------------------------------------------------------------------------------------------------
// GIF encoding

interface Rgba {
  width: number;
  height: number;
  data: Uint8Array;
}

/** Downscales by averaging every source pixel that falls in each target pixel (keeps text readable). */
function downscale(src: Rgba, width: number, height: number): Rgba {
  if (width === src.width && height === src.height) return src;
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor((y * src.height) / height);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * src.height) / height));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor((x * src.width) / width);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * src.width) / width));
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = y0; sy < y1; sy++) {
        let i = (sy * src.width + x0) * 4;
        for (let sx = x0; sx < x1; sx++, i += 4) {
          r += src.data[i]!;
          g += src.data[i + 1]!;
          b += src.data[i + 2]!;
        }
      }
      const n = (y1 - y0) * (x1 - x0);
      const o = (y * width + x) * 4;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = 255;
    }
  }
  return { width, height, data: out };
}

/** Places `src` at the top-left of a width x height canvas filled with the pad colour. */
function pad(src: Rgba, width: number, height: number): Uint8Array {
  if (src.width === width && src.height === height) return src.data;
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    out[i * 4] = PAD_RGB[0];
    out[i * 4 + 1] = PAD_RGB[1];
    out[i * 4 + 2] = PAD_RGB[2];
    out[i * 4 + 3] = 255;
  }
  for (let y = 0; y < src.height; y++) out.set(src.data.subarray(y * src.width * 4, (y + 1) * src.width * 4), y * width * 4);
  return out;
}

/** Indices of the frames to keep: all of them, or `max` spread evenly with the first and last always kept. */
function pickFrames(count: number, max: number): number[] {
  if (count <= max) return Array.from({ length: count }, (_, i) => i);
  return Array.from({ length: max }, (_, i) => Math.round((i * (count - 1)) / (max - 1)));
}

/** The scale factor encodeGif applies to frames of these widths. */
export function gifScale(widths: number[]): number {
  return Math.min(1, FRAME.gifMaxWidth / Math.max(1, ...widths));
}

/**
 * Encodes PNG frames as a looping GIF89a. Frames are scaled to at most FRAME.gifMaxWidth (keeping aspect ratio) and
 * padded to the largest frame's size; frames beyond FRAME.gifMaxFrames are dropped from the middle. Each frame uses
 * its own delay (default FRAME.gifFrameDelayMs; the last defaults to FRAME.gifLastFrameDelayMs).
 * All frames share one scale factor (see gifScale), so marks keep their relative size across frames.
 */
export function encodeGif(frames: { png: Buffer; delayMs?: number }[]): { gif: Buffer; frames: number; durationMs: number; width: number; height: number } {
  if (frames.length === 0) throw new Error("encodeGif needs at least one frame");
  const kept = pickFrames(frames.length, FRAME.gifMaxFrames).map((i) => frames[i]!);
  const decoded: Rgba[] = kept.map((f) => {
    const png = PNG.sync.read(f.png);
    return { width: png.width, height: png.height, data: png.data };
  });

  const scale = gifScale(decoded.map((d) => d.width));
  const scaled = decoded.map((d) => downscale(d, Math.max(1, Math.round(d.width * scale)), Math.max(1, Math.round(d.height * scale))));
  const width = Math.max(...scaled.map((s) => s.width));
  const height = Math.max(...scaled.map((s) => s.height));

  const encoder = gifenc.GIFEncoder();
  let durationMs = 0;
  scaled.forEach((frame, i) => {
    const rgba = pad(frame, width, height);
    const palette = gifenc.quantize(rgba, 256, { format: "rgb565" });
    const index = gifenc.applyPalette(rgba, palette, "rgb565");
    const isLast = i === scaled.length - 1;
    const requested = kept[i]!.delayMs ?? (isLast ? FRAME.gifLastFrameDelayMs : FRAME.gifFrameDelayMs);
    // GIF delays are stored in hundredths of a second.
    const delay = Math.max(10, Math.round(requested / 10) * 10);
    durationMs += delay;
    encoder.writeFrame(index, width, height, { palette, delay, repeat: 0 });
  });
  encoder.finish();
  return { gif: Buffer.from(encoder.bytes()), frames: scaled.length, durationMs, width, height };
}
