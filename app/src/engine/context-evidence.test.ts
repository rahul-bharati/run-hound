import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeBrowser, getBrowser } from "../../test-support/harness.js";
import { startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import type { DiscoveredForm, Evidence } from "../core/types.js";
import { createCheckContext, type ContextOptions } from "./context.js";

// Pass-through spies: the real implementations run, the tests see what text they were given.
vi.mock(import("./evidence.js"), async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    composeFrame: vi.fn(original.composeFrame),
    renderCard: vi.fn(original.renderCard),
  };
});

const { composeFrame, renderCard, FRAME } = await import("./evidence.js");

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// Built by concatenation so secret scanners don't flag this file.
const SECRET = ["sk", "live", "4eC39HqLyjWDarjtT1zdp7dc"].join("_");
const REDACTED = "[REDACTED:stripe-secret]";

let server: FixtureServer;
let artifactsDir: string;

const form: DiscoveredForm = {
  url: "",
  selector: "#f",
  name: "Test form",
  fields: [
    { key: "name", accessibleName: "Name", label: "Name", placeholder: null, type: "text", role: "textbox", required: true, selector: "#name" },
  ],
  controls: [{ accessibleName: "Book", text: "Book", role: "button", tag: "button", selector: "#book", isSubmit: true }],
};

beforeAll(async () => {
  server = await startFixtureServer({
    pages: {
      "/form": `<!doctype html><html><head><title>Evidence fixture</title></head><body style="margin:0">
        <form id="f" style="padding:20px"><label for="name">Name</label><input id="name" name="name" required>
        <button id="book" type="button">Book</button></form>
        <div style="height:2000px"></div>
        <p id="footer">Footer</p>
      </body></html>`,
      "/other": `<!doctype html><html><body><h1>Other</h1><iframe src="/framed"></iframe></body></html>`,
      "/framed": `<!doctype html><html><body>framed</body></html>`,
      "/anim": `<!doctype html><html><head><style>
        @keyframes spin { from { transform: rotate(0deg); background: #f00 } to { transform: rotate(360deg); background: #00f } }
        #spinner { width: 200px; height: 200px; margin: 100px; animation: spin 0.5s linear infinite; }
      </style></head><body><form id="f"><input id="name"><button id="book">Book</button></form><div id="spinner"></div></body></html>`,
    },
  });
  form.url = `${server.url}/form`;
});

afterAll(async () => {
  await closeBrowser();
  await server?.close();
});

beforeEach(async () => {
  artifactsDir = await mkdtemp(join(tmpdir(), "rh-context-evidence-"));
  vi.mocked(composeFrame).mockClear();
  vi.mocked(renderCard).mockClear();
});

afterEach(async () => {
  await rm(artifactsDir, { recursive: true, force: true });
});

async function makeContext(extra: Partial<ContextOptions> = {}) {
  return createCheckContext({
    browser: await getBrowser(),
    form,
    targetUrl: `${server.url}/form`,
    artifactsDir,
    runToken: "t3st",
    checkId: "double-submit",
    scenarioTitle: "Double-click Book",
    ...extra,
  });
}

function expectRecentIso(value: string | undefined) {
  expect(typeof value).toBe("string");
  expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
  const age = Date.now() - Date.parse(value!);
  expect(age).toBeGreaterThanOrEqual(-1000);
  expect(age).toBeLessThan(60_000);
}

async function readArtifact(evidence: Evidence): Promise<Buffer> {
  expect(evidence.path).toBeTruthy();
  expect(isAbsolute(evidence.path!)).toBe(false);
  return readFile(join(artifactsDir, evidence.path!));
}

/** Reads width and height from a baseline or progressive JPEG's SOF segment. */
function jpegSize(jpeg: Buffer): { width: number; height: number } | null {
  let pos = 2;
  while (pos + 9 < jpeg.length) {
    if (jpeg[pos] !== 0xff) return null;
    const marker = jpeg[pos + 1]!;
    if (marker >= 0xc0 && marker <= 0xc3) return { height: jpeg.readUInt16BE(pos + 5), width: jpeg.readUInt16BE(pos + 7) };
    pos += 2 + jpeg.readUInt16BE(pos + 2);
  }
  return null;
}

async function waitFor(condition: () => boolean, timeoutMs = 10_000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe("CheckContext.capture", () => {
  it("writes an annotated PNG frame and returns its evidence", async () => {
    const ctx = await makeContext();
    try {
      const { page } = await ctx.openPage();
      const before = await page.locator("#book").boundingBox();
      const evidence = await ctx.capture(page, "Book clicked twice", {
        step: "Double-click Book",
        caption: "Two save requests reached the server from one double-click.",
        highlights: [{ selector: "#book", label: "Clicked twice" }],
        facts: [{ label: "Requests sent", value: "2" }],
      });

      expect(evidence.kind).toBe("frame");
      expect(evidence.label).toBe("Book clicked twice");
      expect(evidence.url).toBe(page.url());
      expectRecentIso(evidence.capturedAt);
      expect(evidence.step).toBe("Double-click Book");
      expect(evidence.viewport).toEqual({ width: 1280, height: 800 });
      expect(evidence.facts).toEqual(expect.arrayContaining([{ label: "Requests sent", value: "2" }]));

      expect(evidence.highlights).toHaveLength(1);
      const mark = evidence.highlights![0]!;
      expect(mark.label).toBe("Clicked twice");
      // Boxes are in the saved image's pixels: below the header strip.
      expect(Math.abs(mark.box.x - before!.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(mark.box.y - (before!.y + FRAME.headerHeight))).toBeLessThanOrEqual(1);
      expect(Math.abs(mark.box.width - before!.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(mark.box.height - before!.height)).toBeLessThanOrEqual(1);

      expect(evidence.path!.endsWith(".png")).toBe(true);
      const file = await readArtifact(evidence);
      expect(file.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);

      expect(composeFrame).toHaveBeenCalledTimes(1);
      const header = vi.mocked(composeFrame).mock.calls[0]![2];
      expect(header.url).toBe(page.url());
      expect(header.title).toBe("double-submit · Double-click Book");
      expect(header.step).toBe("Double-click Book");
      expect(header.capturedAt).toBe(evidence.capturedAt);
    } finally {
      await ctx.dispose();
    }
  });

  it("redacts secrets in the returned evidence and in the text drawn on the frame", async () => {
    const ctx = await makeContext();
    try {
      const { page } = await ctx.openPage();
      const evidence = await ctx.capture(page, `Leaked ${SECRET}`, {
        step: `Send ${SECRET}`,
        caption: `The page sent ${SECRET} to a third party.`,
        facts: [{ label: "Key", value: SECRET }],
      });
      expect(JSON.stringify(evidence)).not.toContain(SECRET);
      expect(evidence.facts).toEqual(expect.arrayContaining([{ label: "Key", value: REDACTED }]));

      expect(composeFrame).toHaveBeenCalledTimes(1);
      const header = vi.mocked(composeFrame).mock.calls[0]![2];
      const drawn = JSON.stringify(header);
      expect(drawn).not.toContain(SECRET);
      expect(header.caption).toBe(`The page sent ${REDACTED} to a third party.`);
      expect(header.step).toBe(`Send ${REDACTED}`);
      expect(header.facts).toEqual(expect.arrayContaining([{ label: "Key", value: REDACTED }]));
    } finally {
      await ctx.dispose();
    }
  });

  it("lists a highlight whose element is missing as a fact", async () => {
    const ctx = await makeContext();
    try {
      const { page } = await ctx.openPage();
      const evidence = await ctx.capture(page, "Missing element", {
        highlights: [
          { selector: "#nope", label: "Ghost button" },
          { selector: "#book", label: "Book" },
        ],
      });
      expect(evidence.highlights?.map((h) => h.label)).toEqual(["Book"]);
      const missing = (evidence.facts ?? []).filter((f) => /not found/i.test(`${f.label} ${f.value}`));
      expect(missing).toHaveLength(1);
      expect(`${missing[0]!.label} ${missing[0]!.value}`).toMatch(/Ghost button|#nope/);
      // The frame shows it too.
      const header = vi.mocked(composeFrame).mock.calls[0]![2];
      expect(header.facts).toEqual(expect.arrayContaining([missing[0]]));
    } finally {
      await ctx.dispose();
    }
  });
});

describe("CheckContext.captureCard", () => {
  it("writes a PNG card with redacted text", async () => {
    const ctx = await makeContext();
    try {
      const evidence = await ctx.captureCard("Requests", {
        title: "POST /api/bookings (sent twice)",
        subtitle: `${server.url}/api/bookings`,
        lines: [{ text: "POST /api/bookings 201" }, { text: `Authorization: Bearer ${SECRET}`, mark: true }],
        facts: [{ label: "Requests", value: "2" }],
      });
      expect(evidence.kind).toBe("card");
      expect(evidence.label).toBe("Requests");
      expect(evidence.path!.endsWith(".png")).toBe(true);
      const file = await readArtifact(evidence);
      expect(file.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
      expect(JSON.stringify(evidence)).not.toContain(SECRET);

      expect(renderCard).toHaveBeenCalledTimes(1);
      const [, header, card] = vi.mocked(renderCard).mock.calls[0]!;
      expect(header.title).toBe("double-submit · Double-click Book");
      expect(JSON.stringify(card)).not.toContain(SECRET);
      expect(card.lines[1]).toEqual({ text: `Authorization: Bearer ${REDACTED}`, mark: true });
    } finally {
      await ctx.dispose();
    }
  });
});

describe("CheckContext.record", () => {
  it("turns steps into a GIF", async () => {
    const ctx = await makeContext();
    try {
      const { page } = await ctx.openPage();
      const recording = ctx.record(page, "Double-click flow");
      await recording.step("Filled", { highlights: [{ selector: "#name", label: "Filled" }] });
      await page.fill("#name", "Rex");
      await recording.step("Double-click Book", { highlights: [{ selector: "#book", label: "Clicked twice" }] });
      await recording.step("Result", { caption: "Two bookings created.", facts: [{ label: "Requests", value: "2" }] });
      const evidence = await recording.finish();

      expect(evidence.kind).toBe("gif");
      expect(evidence.label).toBe("Double-click flow");
      expect(evidence.frames).toBe(3);
      expect(evidence.durationMs).toBe(2 * FRAME.gifFrameDelayMs + FRAME.gifLastFrameDelayMs);
      expect(evidence.url).toBe(page.url());
      expectRecentIso(evidence.capturedAt);
      expect(evidence.path!.endsWith(".gif")).toBe(true);
      const file = await readArtifact(evidence);
      expect(file.subarray(0, 6).toString("latin1")).toBe("GIF89a");
      expect(file.readUInt16LE(6)).toBeLessThanOrEqual(FRAME.gifMaxWidth);
    } finally {
      await ctx.dispose();
    }
  });

  it("uses the label passed to finish()", async () => {
    const ctx = await makeContext();
    try {
      const { page } = await ctx.openPage();
      const recording = ctx.record(page, "Flow");
      await recording.step("Only step");
      const evidence = await recording.finish({ label: "Renamed flow" });
      expect(evidence.label).toBe("Renamed flow");
      expect(evidence.frames).toBe(1);
    } finally {
      await ctx.dispose();
    }
  });

  it("rejects finish() when no frames were captured", async () => {
    const ctx = await makeContext();
    try {
      const { page } = await ctx.openPage();
      await expect(ctx.record(page, "Empty").finish()).rejects.toThrow();
    } finally {
      await ctx.dispose();
    }
  });
});

describe("live view hooks", () => {
  it("step() reports the label, the page URL and the time", async () => {
    const steps: { label: string; url: string; at: string }[] = [];
    const ctx = await makeContext({ onStep: (s) => steps.push(s) });
    try {
      const { page } = await ctx.openPage();
      ctx.step("Double-clicking Book", page);
      expect(steps).toHaveLength(1);
      expect(steps[0]!.label).toBe("Double-clicking Book");
      expect(steps[0]!.url).toBe(page.url());
      expectRecentIso(steps[0]!.at);
    } finally {
      await ctx.dispose();
    }
  });

  it("onPageLoad fires for main-frame navigations only", async () => {
    const loads: { url: string; at: string }[] = [];
    const ctx = await makeContext({ onPageLoad: (p) => loads.push(p) });
    try {
      const { page } = await ctx.openPage();
      await waitFor(() => loads.some((l) => l.url === `${server.url}/form`));
      await page.goto(`${server.url}/other`, { waitUntil: "networkidle" });
      await waitFor(() => loads.some((l) => l.url === `${server.url}/other`));
      expect(loads.map((l) => l.url)).not.toContain(`${server.url}/framed`);
      for (const load of loads) expectRecentIso(load.at);
    } finally {
      await ctx.dispose();
    }
  });

  it("onFrame streams JPEG frames of an animating page and stops after dispose()", async () => {
    const frames: { jpeg: Buffer; url: string; at: string }[] = [];
    const ctx = await makeContext({ targetUrl: `${server.url}/anim`, onFrame: (f) => frames.push(f) });
    let disposed = false;
    try {
      await ctx.openPage();
      await waitFor(() => frames.length >= 3);
      for (const frame of frames.slice(0, 3)) {
        expect(frame.jpeg[0]).toBe(0xff);
        expect(frame.jpeg[1]).toBe(0xd8);
        expect(frame.url).toBe(`${server.url}/anim`);
        expectRecentIso(frame.at);
        const size = jpegSize(frame.jpeg);
        if (size) expect(size.width).toBeLessThanOrEqual(960);
      }
      await ctx.dispose();
      disposed = true;
      const countAtDispose = frames.length;
      await new Promise((r) => setTimeout(r, 1000));
      // At most one frame already in flight may land after dispose.
      expect(frames.length).toBeLessThanOrEqual(countAtDispose + 1);
    } finally {
      if (!disposed) await ctx.dispose();
    }
  });
});
