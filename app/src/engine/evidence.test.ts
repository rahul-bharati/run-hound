import { PNG } from "pngjs";
import type { Browser, BrowserContext, Page } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeBrowser, getBrowser } from "../../test-support/harness.js";
import type { Box, Highlight } from "../core/types.js";
import { FRAME, composeFrame, encodeGif, renderCard, resolveHighlights } from "./evidence.js";

const FAIL_RGB = [0xff, 0x5a, 0x4f] as const;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let browser: Browser;

beforeAll(async () => {
  browser = await getBrowser();
});

afterAll(async () => {
  await closeBrowser();
});

/** A solid-colour PNG of the given size. */
function solidPng(width: number, height: number, rgb: readonly [number, number, number] = [255, 255, 255]): Buffer {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    png.data[i * 4] = rgb[0];
    png.data[i * 4 + 1] = rgb[1];
    png.data[i * 4 + 2] = rgb[2];
    png.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(png);
}

function pixel(png: PNG, x: number, y: number): [number, number, number] {
  const i = (Math.round(y) * png.width + Math.round(x)) * 4;
  return [png.data[i]!, png.data[i + 1]!, png.data[i + 2]!];
}

function near(a: readonly number[], b: readonly number[], tolerance = 24): boolean {
  return a.every((v, i) => Math.abs(v - b[i]!) <= tolerance);
}

function luminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function expectBoxClose(actual: Box, expected: Box, tolerance = 1) {
  expect(Math.abs(actual.x - expected.x)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual.y - expected.y)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual.width - expected.width)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual.height - expected.height)).toBeLessThanOrEqual(tolerance);
}

/** Parses a GIF's structure: logical screen size, frame count, per-frame delays (ms) and whether it loops. */
function parseGif(buf: Buffer): { header: string; width: number; height: number; frames: number; delaysMs: number[]; loops: boolean } {
  const header = buf.subarray(0, 6).toString("latin1");
  const width = buf.readUInt16LE(6);
  const height = buf.readUInt16LE(8);
  const packed = buf[10]!;
  let pos = 13;
  if (packed & 0x80) pos += 3 * (1 << ((packed & 0x07) + 1));
  const delaysMs: number[] = [];
  let frames = 0;
  let loops = false;
  const skipSubBlocks = () => {
    while (buf[pos]! !== 0) pos += buf[pos]! + 1;
    pos += 1;
  };
  while (pos < buf.length) {
    const byte = buf[pos]!;
    if (byte === 0x3b) break;
    if (byte === 0x21) {
      const label = buf[pos + 1]!;
      pos += 2;
      if (label === 0xf9) {
        // Graphic control extension: size(4) packed delay(2) transparent-index terminator.
        delaysMs.push(buf.readUInt16LE(pos + 2) * 10);
        pos += 1 + buf[pos]!;
        skipSubBlocks();
      } else if (label === 0xff) {
        const id = buf.subarray(pos + 1, pos + 12).toString("latin1");
        if (id === "NETSCAPE2.0") loops = true;
        pos += 1 + buf[pos]!;
        skipSubBlocks();
      } else {
        skipSubBlocks();
      }
    } else if (byte === 0x2c) {
      frames += 1;
      const imagePacked = buf[pos + 9]!;
      pos += 10;
      if (imagePacked & 0x80) pos += 3 * (1 << ((imagePacked & 0x07) + 1));
      pos += 1; // LZW minimum code size
      skipSubBlocks();
    } else {
      throw new Error(`Unexpected GIF block 0x${byte.toString(16)} at ${pos}`);
    }
  }
  return { header, width, height, frames, delaysMs, loops };
}

/** Wraps a browser so every request made by pages it creates is recorded. */
function spyBrowser(real: Browser): { browser: Browser; requests: string[] } {
  const requests: string[] = [];
  const watchPage = (page: Page) => page.on("request", (r) => requests.push(r.url()));
  const watchContext = (context: BrowserContext) => {
    context.on("request", (r) => requests.push(r.url()));
    context.on("page", watchPage);
  };
  const proxy = new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === "newContext") {
        return async (...args: Parameters<Browser["newContext"]>) => {
          const context = await target.newContext(...args);
          watchContext(context);
          return context;
        };
      }
      if (prop === "newPage") {
        return async (...args: Parameters<Browser["newPage"]>) => {
          const page = await target.newPage(...args);
          watchPage(page);
          return page;
        };
      }
      const value = Reflect.get(target, prop, receiver) as unknown;
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
  return { browser: proxy, requests };
}

const header = { url: "http://127.0.0.1:1234/book", capturedAt: "2026-09-24T10:00:00.000Z", title: "double-submit · Double-click Book" };

describe("resolveHighlights", () => {
  let page: Page;

  beforeEach(async () => {
    page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.setContent(`<!doctype html><html><body style="margin:0;height:3000px;position:relative">
      <button id="top" style="position:absolute;left:40px;top:50px;width:120px;height:30px">Top</button>
      <div id="below" style="position:absolute;left:100px;top:2000px;width:200px;height:40px;background:#ccc">Below</div>
      <div id="hidden" style="display:none">Hidden</div>
    </body></html>`);
  });

  afterEach(async () => {
    await page.close();
  });

  it("uses the element's bounding box for a selector highlight", async () => {
    const { resolved, missing } = await resolveHighlights(page, [{ selector: "#top", label: "Top button" }]);
    expect(missing).toEqual([]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.label).toBe("Top button");
    expect(resolved[0]!.selector).toBe("#top");
    const expected = await page.locator("#top").boundingBox();
    expectBoxClose(resolved[0]!.box, expected!);
  });

  it("scrolls an element below the fold into view and returns its viewport box", async () => {
    const { resolved } = await resolveHighlights(page, [{ selector: "#below", label: "Below" }]);
    const box = resolved[0]!.box;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(600);
    expect(box.x + box.width).toBeLessThanOrEqual(800);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    const expected = await page.locator("#below").boundingBox();
    expectBoxClose(box, expected!);
  });

  it("returns page coordinates when fullPage", async () => {
    await page.evaluate(() => window.scrollTo(0, 500));
    const { resolved } = await resolveHighlights(page, [{ selector: "#below", label: "Below" }], { fullPage: true });
    expectBoxClose(resolved[0]!.box, { x: 100, y: 2000, width: 200, height: 40 });
  });

  it("passes box highlights through unchanged", async () => {
    const box = { x: 10, y: 20, width: 30, height: 40 };
    const { resolved, missing } = await resolveHighlights(page, [{ box, label: "Area", tone: "info" }]);
    expect(missing).toEqual([]);
    expect(resolved).toEqual([{ box, label: "Area", tone: "info" }]);
  });

  it("reports missing and hidden selectors in missing", async () => {
    const nope: Highlight = { selector: "#nope", label: "Not there" };
    const hidden: Highlight = { selector: "#hidden", label: "Hidden" };
    const { resolved, missing } = await resolveHighlights(page, [nope, { selector: "#top", label: "Top" }, hidden]);
    expect(resolved.map((h) => h.label)).toEqual(["Top"]);
    expect(missing).toEqual([nope, hidden]);
  });
});

describe("composeFrame", () => {
  const shotWidth = 400;
  const shotHeight = 300;
  const failBox = { x: 100, y: 100, width: 120, height: 60 };

  it("adds the header strip above the screenshot", async () => {
    const shot = solidPng(shotWidth, shotHeight);
    const result = await composeFrame(browser, shot, header, []);
    expect(result.png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
    const png = PNG.sync.read(result.png);
    expect(png.width).toBe(result.width);
    expect(png.height).toBe(result.height);
    expect(result.width).toBe(shotWidth);
    expect(result.height).toBe(shotHeight + FRAME.headerHeight);
  });

  it("is wider by the facts panel when there are facts", async () => {
    const shot = solidPng(shotWidth, shotHeight);
    const result = await composeFrame(browser, shot, { ...header, facts: [{ label: "Requests sent", value: "2" }] }, []);
    expect(result.width).toBe(shotWidth + FRAME.factsWidth);
    expect(PNG.sync.read(result.png).width).toBe(shotWidth + FRAME.factsWidth);
    expect(result.height).toBeGreaterThanOrEqual(shotHeight + FRAME.headerHeight);
  });

  it("grows taller for a caption", async () => {
    const shot = solidPng(shotWidth, shotHeight);
    const result = await composeFrame(browser, shot, { ...header, caption: "Two save requests reached the server." }, []);
    expect(result.height).toBeGreaterThan(shotHeight + FRAME.headerHeight);
  });

  it("offsets highlight boxes by the header and draws the fail outline", async () => {
    const shot = solidPng(shotWidth, shotHeight);
    const result = await composeFrame(browser, shot, { ...header, step: "Double-click Book" }, [
      { selector: "#book", label: "Clicked twice", tone: "fail", box: failBox },
    ]);
    expect(result.highlights).toHaveLength(1);
    expect(result.highlights[0]!.label).toBe("Clicked twice");
    expectBoxClose(result.highlights[0]!.box, { ...failBox, y: failBox.y + FRAME.headerHeight });

    const png = PNG.sync.read(result.png);
    const box = result.highlights[0]!.box;
    // The 3 px outline sits on the box edge (inside or outside); scan across the left and bottom edges.
    const midY = box.y + box.height / 2;
    const onLeft = [-4, -3, -2, -1, 0, 1, 2, 3, 4].some((dx) => near(pixel(png, box.x + dx, midY), FAIL_RGB));
    const midX = box.x + box.width / 2;
    const onBottom = [-4, -3, -2, -1, 0, 1, 2, 3, 4].some((dy) => near(pixel(png, midX, box.y + box.height + dy), FAIL_RGB));
    expect(onLeft).toBe(true);
    expect(onBottom).toBe(true);

    // The screenshot itself is kept: a white pixel away from the highlight stays white.
    expect(near(pixel(png, 20, FRAME.headerHeight + shotHeight - 20), [255, 255, 255], 8)).toBe(true);

    // The header strip is dark (average luminance over the whole strip).
    let sum = 0;
    let count = 0;
    for (let y = 0; y < FRAME.headerHeight; y += 2) {
      for (let x = 0; x < png.width; x += 2) {
        sum += luminance(pixel(png, x, y));
        count += 1;
      }
    }
    expect(sum / count).toBeLessThan(90);
  });

  it("puts the badge of a short mark (a list row) level with it, left of the outline, not on the row above", async () => {
    const shot = solidPng(shotWidth, shotHeight);
    const row = { x: 100, y: 150, width: 200, height: 16 };
    const result = await composeFrame(browser, shot, header, [{ label: "Saved copy", box: row }]);
    const png = PNG.sync.read(result.png);
    const midY = FRAME.headerHeight + row.y + row.height / 2;
    // The badge spans 3 px ring + 3 px gap + a 20 px badge left of the element; sample beside its digit.
    expect(near(pixel(png, row.x - 3 - 3 - 16, midY), FAIL_RGB)).toBe(true);
    // Nothing drawn at the old top-left corner spot, level with the row above.
    expect(near(pixel(png, row.x - 8, FRAME.headerHeight + row.y - 12), [255, 255, 255], 8)).toBe(true);
  });

  it("keeps callouts off the page's controls (obstacles) and other marks' outlines", async () => {
    const shot = solidPng(shotWidth, shotHeight);
    const mark = { x: 150, y: 130, width: 100, height: 30 };
    const right = { x: 262, y: 90, width: 138, height: 110 };
    const above = { x: 60, y: 20, width: 340, height: 80 };
    const result = await composeFrame(browser, shot, header, [{ label: "Not announced", box: mark }], { obstacles: [right, above] });
    const png = PNG.sync.read(result.png);
    const untouched = (b: { x: number; y: number; width: number; height: number }) => {
      for (let y = b.y + 2; y < b.y + b.height - 2; y += 3) {
        for (let x = b.x + 2; x < Math.min(shotWidth, b.x + b.width) - 2; x += 3) {
          if (!near(pixel(png, x, FRAME.headerHeight + y), [255, 255, 255], 8)) return false;
        }
      }
      return true;
    };
    expect(untouched(right)).toBe(true);
    expect(untouched(above)).toBe(true);
  });

  it("with more than 5 marks, draws numbered outlines only and lists the labels in the facts panel", async () => {
    const shot = solidPng(shotWidth, shotHeight);
    const rows = Array.from({ length: 8 }, (_, i) => ({ label: `target-size ${i + 1}`, box: { x: 200, y: 40 + i * 24, width: 16, height: 16 } }));
    const few = await composeFrame(browser, shot, header, rows.slice(0, 2));
    const many = await composeFrame(browser, shot, header, rows);
    // The legend needs the panel even without facts.
    expect(few.width).toBe(shotWidth);
    expect(many.width).toBe(shotWidth + FRAME.factsWidth);
    expect(many.highlights).toHaveLength(8);
    // No callout pills: the page right of the marks stays white.
    const png = PNG.sync.read(many.png);
    for (let y = FRAME.headerHeight + 30; y < FRAME.headerHeight + 240; y += 4) {
      for (let x = 240; x < shotWidth - 4; x += 4) expect(near(pixel(png, x, y), [255, 255, 255], 8)).toBe(true);
    }
  });

  it("draws no callouts for 3 or more marks packed together (a column of small buttons)", async () => {
    const shot = solidPng(shotWidth, shotHeight);
    const column = Array.from({ length: 3 }, (_, i) => ({ label: `target-size ${i + 1}`, box: { x: 200, y: 100 + i * 18, width: 16, height: 16 } }));
    const spread = column.map((m, i) => ({ ...m, box: { ...m.box, y: 20 + i * 100 } }));
    expect((await composeFrame(browser, shot, header, column)).width).toBe(shotWidth + FRAME.factsWidth);
    expect((await composeFrame(browser, shot, header, spread)).width).toBe(shotWidth);
  });

  it("makes no network requests while composing", async () => {
    const spy = spyBrowser(browser);
    await composeFrame(
      spy.browser,
      solidPng(shotWidth, shotHeight),
      { ...header, step: "Submit", caption: "Caption", facts: [{ label: "Status", value: "500" }] },
      [{ label: "Box", box: failBox }],
    );
    expect(spy.requests.filter((u) => /^(https?|wss?):/i.test(u))).toEqual([]);
  });
});

describe("renderCard", () => {
  const lines = (n: number, mark?: number) => Array.from({ length: n }, (_, i) => ({ text: `line ${i + 1}: POST /api/bookings 201`, mark: i === mark }));

  it("renders a PNG with the header", async () => {
    const png = await renderCard(browser, header, { title: "POST /api/bookings (sent twice)", subtitle: "http://127.0.0.1:1234/api/bookings", lines: lines(5) });
    expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
    const decoded = PNG.sync.read(png);
    expect(decoded.width).toBeGreaterThan(0);
    expect(decoded.height).toBeGreaterThan(FRAME.headerHeight);
  });

  it("renders a marked line differently from an unmarked one", async () => {
    const plain = PNG.sync.read(await renderCard(browser, header, { title: "Card", lines: lines(5) }));
    const marked = PNG.sync.read(await renderCard(browser, header, { title: "Card", lines: lines(5, 2) }));
    expect(marked.width).toBe(plain.width);
    expect(marked.height).toBe(plain.height);
    expect(Buffer.compare(marked.data, plain.data)).not.toBe(0);
  });

  it("numbers lines from firstLineNumber, as the excerpted file does", async () => {
    const one = PNG.sync.read(await renderCard(browser, header, { title: "Card", lines: lines(5) }));
    const hundred = PNG.sync.read(await renderCard(browser, header, { title: "Card", lines: lines(5), firstLineNumber: 100 }));
    expect(hundred.height).toBe(one.height);
    expect(Buffer.compare(hundred.data, one.data)).not.toBe(0);
  });

  it("shows at most 40 lines (height is bounded)", async () => {
    const ten = PNG.sync.read(await renderCard(browser, header, { title: "Card", lines: lines(10) }));
    const forty = PNG.sync.read(await renderCard(browser, header, { title: "Card", lines: lines(40) }));
    const many = PNG.sync.read(await renderCard(browser, header, { title: "Card", lines: lines(400) }));
    expect(forty.height).toBeGreaterThan(ten.height);
    // 400 lines render as 40 plus a "… N more lines" note: no taller than 40 lines plus a few note lines.
    expect(many.height).toBeGreaterThanOrEqual(forty.height);
    expect(many.height).toBeLessThanOrEqual(forty.height + 100);
  });
});

describe("encodeGif", () => {
  const colours: [number, number, number][] = [
    [255, 0, 0],
    [0, 160, 0],
    [0, 0, 255],
    [240, 200, 0],
  ];

  it("encodes a looping GIF89a with one frame per PNG and the default delays", () => {
    const frames = [0, 1, 2].map((i) => ({ png: solidPng(320, 200, colours[i]) }));
    const result = encodeGif(frames);
    const parsed = parseGif(result.gif);
    expect(parsed.header).toBe("GIF89a");
    expect(parsed.loops).toBe(true);
    expect(result.frames).toBe(3);
    expect(parsed.frames).toBe(3);
    expect(result.width).toBe(320);
    expect(result.height).toBe(200);
    expect(parsed.width).toBe(320);
    expect(parsed.height).toBe(200);
    expect(parsed.delaysMs).toEqual([FRAME.gifFrameDelayMs, FRAME.gifFrameDelayMs, FRAME.gifLastFrameDelayMs]);
    expect(result.durationMs).toBe(2 * FRAME.gifFrameDelayMs + FRAME.gifLastFrameDelayMs);
  });

  it("uses each frame's own delay", () => {
    const result = encodeGif([
      { png: solidPng(100, 100, colours[0]), delayMs: 500 },
      { png: solidPng(100, 100, colours[1]) },
      { png: solidPng(100, 100, colours[2]), delayMs: 1200 },
    ]);
    const parsed = parseGif(result.gif);
    expect(parsed.delaysMs).toEqual([500, FRAME.gifFrameDelayMs, 1200]);
    expect(result.durationMs).toBe(500 + FRAME.gifFrameDelayMs + 1200);
  });

  it("scales wide frames down to gifMaxWidth keeping the aspect ratio", () => {
    const result = encodeGif([{ png: solidPng(2000, 1000, colours[0]) }, { png: solidPng(2000, 1000, colours[1]) }]);
    const parsed = parseGif(result.gif);
    expect(parsed.width).toBeLessThanOrEqual(FRAME.gifMaxWidth);
    expect(result.width).toBe(parsed.width);
    expect(result.height).toBe(parsed.height);
    expect(Math.abs(parsed.height - parsed.width / 2)).toBeLessThanOrEqual(1);
  });

  it("pads frames to the largest frame's size", () => {
    const result = encodeGif([{ png: solidPng(400, 300, colours[0]) }, { png: solidPng(300, 200, colours[1]) }]);
    const parsed = parseGif(result.gif);
    expect(parsed.width).toBe(400);
    expect(parsed.height).toBe(300);
    expect(parsed.frames).toBe(2);
  });

  it("caps frames at gifMaxFrames, keeping the first and last", () => {
    const frames = Array.from({ length: 20 }, (_, i) => ({
      png: solidPng(80, 60, colours[i % colours.length]),
      delayMs: i === 0 ? 300 : i === 19 ? 3000 : 700,
    }));
    const result = encodeGif(frames);
    const parsed = parseGif(result.gif);
    expect(result.frames).toBe(FRAME.gifMaxFrames);
    expect(parsed.frames).toBe(FRAME.gifMaxFrames);
    expect(parsed.delaysMs).toHaveLength(FRAME.gifMaxFrames);
    expect(parsed.delaysMs[0]).toBe(300);
    expect(parsed.delaysMs.at(-1)).toBe(3000);
    expect(parsed.delaysMs.slice(1, -1).every((d) => d === 700)).toBe(true);
    expect(result.durationMs).toBe(parsed.delaysMs.reduce((a, b) => a + b, 0));
  });
});
