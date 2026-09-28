// Every GIF on the site plays once and rests on its proof frame: `pnpm test` (node:test, no dependencies). The rule is
// docs/brand.md, "Motion" → "Where it moves": evidence recordings (GIFs) play once and rest on the frame that proves the
// finding; the copies in reports and the local UI keep looping.
//
// A GIF repeats only when it carries a looping application extension (NETSCAPE2.0, or the older ANIMEXTS1.0): loop
// count 0 means forever, any other count repeats that many times. Without one, browsers play it once and keep its last
// frame on screen, so the test rejects the extension whatever count it names. The evidence recordings come from Run
// Hound's reports, which loop (loop count 0), so they are remuxed without the extension, into a new file (ffmpeg won't
// write over its input):
//   ffmpeg -i <recording>.gif -c copy -loop -1 <recording>.once.gif && mv <recording>.once.gif <recording>.gif
// (stream copy: the frames, palettes and delays stay byte for byte; only the 19-byte extension goes).
//
// The reader below decodes the GIF (LZW and frame disposal) and the PNG still with node:zlib, so the test can check
// that the frame a recording rests on is the still that people who prefer reduced motion get instead
// (components/evidence-image.tsx).
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

const siteRoot = fileURLToPath(new URL("../../", import.meta.url));
const evidenceDir = fileURLToPath(new URL("./evidence/", import.meta.url));

/** Application extensions that make a browser loop an animation (Chromium and Firefox read both). */
const LOOP_EXTENSIONS = ["NETSCAPE2.0", "ANIMEXTS1.0"];

/** The two evidence recordings and their size before they were remuxed to play once (2026-09-28, loop count 0). */
const RECORDINGS = [
  { name: "double-submit-recording", bytesBefore: 173_960 },
  { name: "silent-failure-recording", bytesBefore: 155_444 },
];

/**
 * How much larger a play-once recording may be than the looping one: playing once must not cost the page weight. The
 * remux drops 19 bytes; a re-encode that grows the file past 5% (a new palette, dithering) should be done again.
 */
const MAX_GROWTH = 0.05;

/**
 * The share of pixels in which a recording's resting frame may differ from its still: headroom for a still exported
 * apart from its recording. Today both match exactly (0%), and each first frame differs in 20% or more.
 */
const MAX_DIFFERENT_PIXELS = 0.01;

/**
 * When the proof frame arrives, as Run Hound recorded it: after two frame changes, the last at about 2 s (1.8 s today,
 * three frames of 0.9 s, 0.9 s and 2.5 s). The remux must keep the recording's frames and delays as they are.
 */
const FRAME_CHANGES = 2;
const LAST_CHANGE_MS = { min: 1500, max: 2500 };

type Frame = {
  left: number;
  top: number;
  width: number;
  height: number;
  interlaced: boolean;
  palette: Uint8Array | null;
  transparent: number | null;
  /** Hundredths of a second. */
  delay: number;
  disposal: number;
  minCodeSize: number;
  data: Uint8Array;
};

type Gif = {
  width: number;
  height: number;
  palette: Uint8Array | null;
  /** Application extensions, by identifier and authentication code (e.g. "NETSCAPE2.0"). */
  applications: { id: string; blocks: Uint8Array[] }[];
  frames: Frame[];
  /** The byte after the trailer; a well-formed file ends there. */
  end: number;
};

/** Reads a GIF's block structure (GIF89a specification, sections 17-27). Throws on anything malformed. */
function readGif(bytes: Uint8Array): Gif {
  let p = 0;
  const need = (n: number) => {
    if (p + n > bytes.length) throw new Error(`GIF truncated at byte ${p}`);
  };
  const u8 = () => {
    need(1);
    return bytes[p++];
  };
  const u16 = () => {
    need(2);
    const v = bytes[p] | (bytes[p + 1] << 8);
    p += 2;
    return v;
  };
  const take = (n: number) => {
    need(n);
    const out = bytes.subarray(p, p + n);
    p += n;
    return out;
  };
  const subBlocks = () => {
    const blocks: Uint8Array[] = [];
    for (let size = u8(); size !== 0; size = u8()) blocks.push(take(size));
    return blocks;
  };
  const concat = (blocks: Uint8Array[]) => {
    const out = new Uint8Array(blocks.reduce((sum, b) => sum + b.length, 0));
    let at = 0;
    for (const b of blocks) {
      out.set(b, at);
      at += b.length;
    }
    return out;
  };

  const signature = String.fromCharCode(...take(6));
  if (signature !== "GIF89a" && signature !== "GIF87a") throw new Error(`not a GIF: ${JSON.stringify(signature)}`);
  const width = u16();
  const height = u16();
  const packed = u8();
  u8(); // background colour index: browsers clear to transparent instead
  u8(); // pixel aspect ratio
  const palette = packed & 0x80 ? take(3 * (1 << ((packed & 7) + 1))) : null;

  const gif: Gif = { width, height, palette, applications: [], frames: [], end: -1 };
  let control = { delay: 0, disposal: 0, transparent: null as number | null };
  for (;;) {
    const introducer = u8();
    if (introducer === 0x3b) {
      gif.end = p;
      return gif;
    }
    if (introducer === 0x21) {
      const label = u8();
      const blocks = subBlocks();
      if (label === 0xf9) {
        const gce = blocks[0];
        if (!gce || gce.length < 4) throw new Error("short graphic control extension");
        control = {
          delay: gce[1] | (gce[2] << 8),
          disposal: (gce[0] >> 2) & 7,
          transparent: gce[0] & 1 ? gce[3] : null,
        };
      } else if (label === 0xff) {
        const [head, ...rest] = blocks;
        if (!head || head.length !== 11) throw new Error("application extension without an 11-byte identifier");
        gif.applications.push({ id: String.fromCharCode(...head), blocks: rest });
      }
      continue;
    }
    if (introducer === 0x2c) {
      const left = u16();
      const top = u16();
      const w = u16();
      const h = u16();
      const flags = u8();
      const local = flags & 0x80 ? take(3 * (1 << ((flags & 7) + 1))) : null;
      const minCodeSize = u8();
      gif.frames.push({
        left,
        top,
        width: w,
        height: h,
        interlaced: (flags & 0x40) !== 0,
        palette: local,
        minCodeSize,
        data: concat(subBlocks()),
        ...control,
      });
      control = { delay: 0, disposal: 0, transparent: null };
      continue;
    }
    throw new Error(`unknown GIF block 0x${introducer.toString(16)} at byte ${p - 1}`);
  }
}

/** The looping extensions in a GIF, with the loop count each one names (0 = forever). */
function loopExtensions(gif: Gif) {
  return gif.applications
    .filter((app) => LOOP_EXTENSIONS.includes(app.id))
    .map((app) => {
      const sub = app.blocks[0];
      return { id: app.id, loopCount: sub && sub[0] === 1 && sub.length >= 3 ? sub[1] | (sub[2] << 8) : null };
    });
}

/** Decodes one frame's LZW data (GIF89a Appendix F) to palette indices. */
function decodeLzw(minCodeSize: number, data: Uint8Array, count: number): Uint8Array {
  if (minCodeSize < 2 || minCodeSize > 8) throw new Error(`bad LZW minimum code size ${minCodeSize}`);
  const out = new Uint8Array(count);
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  const prefix = new Int16Array(4096);
  const suffix = new Uint8Array(4096);
  const first = new Uint8Array(4096);
  const length = new Uint16Array(4096);
  for (let i = 0; i < clear; i++) {
    prefix[i] = -1;
    suffix[i] = i;
    first[i] = i;
    length[i] = 1;
  }
  let size = minCodeSize + 1;
  let next = end + 1;
  let prev = -1;
  let acc = 0;
  let bits = 0;
  let n = 0;
  for (let i = 0; i < data.length && n < count; i++) {
    acc |= data[i] << bits;
    bits += 8;
    while (bits >= size && n < count) {
      const code = acc & ((1 << size) - 1);
      acc >>>= size;
      bits -= size;
      if (code === clear) {
        size = minCodeSize + 1;
        next = end + 1;
        prev = -1;
        continue;
      }
      if (code === end) return out;
      if (prev === -1) {
        if (code >= clear) throw new Error(`LZW code ${code} before any string`);
      } else if (next < 4096) {
        if (code > next) throw new Error(`LZW code ${code} ahead of the table (${next})`);
        prefix[next] = prev;
        suffix[next] = code < next ? first[code] : first[prev];
        first[next] = first[prev];
        length[next] = length[prev] + 1;
        next++;
        if (next === 1 << size && size < 12) size++;
      } else if (code >= next) {
        throw new Error(`LZW code ${code} past a full table`);
      }
      let c = code;
      for (let k = length[code] - 1; k >= 0; k--) {
        if (n + k < count) out[n + k] = suffix[c];
        c = prefix[c];
      }
      n += length[code];
      prev = code;
    }
  }
  return out;
}

/** Row order of an interlaced frame: every 8th row from 0, every 8th from 4, every 4th from 2, every 2nd from 1. */
function rowOrder(height: number, interlaced: boolean): number[] {
  if (!interlaced) return Array.from({ length: height }, (_, y) => y);
  const rows: number[] = [];
  for (const [start, step] of [
    [0, 8],
    [4, 8],
    [2, 4],
    [1, 2],
  ]) {
    for (let y = start; y < height; y += step) rows.push(y);
  }
  return rows;
}

/**
 * The RGBA picture on screen while frame `last` shows (frames composited with their disposal methods); by default the
 * last frame, which a browser keeps on screen once a play-once animation has ended.
 */
function restingFrame(gif: Gif, last = gif.frames.length - 1): Uint8Array {
  const canvas = new Uint8Array(gif.width * gif.height * 4);
  let restore: Uint8Array | null = null;
  let previous: Frame | null = null;
  for (const frame of gif.frames.slice(0, last + 1)) {
    if (previous?.disposal === 2) {
      for (let y = previous.top; y < Math.min(previous.top + previous.height, gif.height); y++) {
        const from = (y * gif.width + previous.left) * 4;
        canvas.fill(0, from, from + Math.min(previous.width, gif.width - previous.left) * 4);
      }
    } else if (previous?.disposal === 3 && restore) {
      canvas.set(restore);
    }
    restore = frame.disposal === 3 ? canvas.slice() : null;
    const palette = frame.palette ?? gif.palette;
    if (!palette) throw new Error("frame without a colour table");
    const indices = decodeLzw(frame.minCodeSize, frame.data, frame.width * frame.height);
    rowOrder(frame.height, frame.interlaced).forEach((y, row) => {
      const cy = frame.top + y;
      if (cy >= gif.height) return;
      for (let x = 0; x < frame.width; x++) {
        const cx = frame.left + x;
        if (cx >= gif.width) break;
        const index = indices[row * frame.width + x];
        if (index === frame.transparent) continue;
        const at = (cy * gif.width + cx) * 4;
        canvas[at] = palette[index * 3];
        canvas[at + 1] = palette[index * 3 + 1];
        canvas[at + 2] = palette[index * 3 + 2];
        canvas[at + 3] = 255;
      }
    });
    previous = frame;
  }
  return canvas;
}

/** Decodes an 8-bit RGB or RGBA, non-interlaced PNG (what the evidence stills are) to RGBA. */
function readPng(bytes: Uint8Array): { width: number; height: number; rgba: Uint8Array } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  assert.deepEqual([...bytes.subarray(0, 8)], signature, "not a PNG");
  let p = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat: Uint8Array[] = [];
  while (p < bytes.length) {
    const size = view.getUint32(p);
    const type = String.fromCharCode(...bytes.subarray(p + 4, p + 8));
    const body = bytes.subarray(p + 8, p + 8 + size);
    if (type === "IHDR") {
      width = view.getUint32(p + 8);
      height = view.getUint32(p + 12);
      const [depth, colourType, , , interlace] = body.subarray(8, 13);
      if (depth !== 8 || (colourType !== 2 && colourType !== 6) || interlace !== 0) {
        throw new Error(`unsupported PNG (depth ${depth}, colour type ${colourType}, interlace ${interlace})`);
      }
      channels = colourType === 6 ? 4 : 3;
    } else if (type === "IDAT") {
      idat.push(body);
    } else if (type === "IEND") {
      break;
    }
    p += 12 + size;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? pixels[row + x - channels] : 0;
      const b = y > 0 ? pixels[row - stride + x] : 0;
      const c = x >= channels && y > 0 ? pixels[row - stride + x - channels] : 0;
      let predictor: number;
      if (filter === 0) predictor = 0;
      else if (filter === 1) predictor = a;
      else if (filter === 2) predictor = b;
      else if (filter === 3) predictor = (a + b) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else throw new Error(`bad PNG filter ${filter} on row ${y}`);
      pixels[row + x] = (line[x] + predictor) & 0xff;
    }
  }
  if (channels === 4) return { width, height, rgba: pixels };
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba.set(pixels.subarray(i * 3, i * 3 + 3), i * 4);
    rgba[i * 4 + 3] = 255;
  }
  return { width, height, rgba };
}

/** The share of pixels that differ in any channel (two fully transparent pixels are the same pixel). */
function differentPixels(a: Uint8Array, b: Uint8Array): number {
  assert.equal(a.length, b.length);
  let different = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i + 3] === 0 && b[i + 3] === 0) continue;
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) different++;
  }
  return different / (a.length / 4);
}

/** Every .gif under a folder, recursively. */
function gifsUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((path) => path.toLowerCase().endsWith(".gif"))
    .map((path) => join(dir, path));
}

/** Asserts a GIF rests on its still: same size, at most 1% of the pixels different. */
function assertRestsOnStill(gifPath: string, stillPath: string) {
  const gif = readGif(readFileSync(gifPath));
  const still = readPng(readFileSync(stillPath));
  assert.deepEqual([gif.width, gif.height], [still.width, still.height], `${gifPath}: same size as its still`);
  const share = differentPixels(restingFrame(gif), still.rgba);
  assert.ok(
    share <= MAX_DIFFERENT_PIXELS,
    `${gifPath} rests on a frame that differs from its still in ${(share * 100).toFixed(2)}% of the pixels`,
  );
}

describe("the GIF reader", () => {
  // A 1×1 GIF89a (one white pixel), with and without a NETSCAPE2.0 block: the reader must see the loop, or the tests
  // below could pass on a looping file.
  const pixel = [
    ...[0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00],
    ...[0xff, 0xff, 0xff, 0x00, 0x00, 0x00],
  ];
  const image = [0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b];
  const netscape = [0x21, 0xff, 0x0b, ..."NETSCAPE2.0"].map((b) => (typeof b === "string" ? b.charCodeAt(0) : b));

  test("sees a looping extension and its loop count", () => {
    const looping = readGif(Uint8Array.from([...pixel, ...netscape, 0x03, 0x01, 0x00, 0x00, 0x00, ...image]));
    assert.deepEqual(loopExtensions(looping), [{ id: "NETSCAPE2.0", loopCount: 0 }]);
  });

  test("decodes a play-once GIF to its pixel", () => {
    const once = readGif(Uint8Array.from([...pixel, ...image]));
    assert.deepEqual(loopExtensions(once), []);
    assert.equal(once.frames.length, 1);
    assert.deepEqual([...restingFrame(once)], [255, 255, 255, 255]);
  });

  // The evidence recordings draw every frame over the whole canvas (disposal 0, no transparent index), so they never
  // reach the other paths of restingFrame(); this 2×1 GIF does. Colours: 0 white, 1 black, 2 red, 3 green.
  /** LZW data for one or two pixels with minimum code size 2: clear, the indices, end, as 3-bit codes (the table
   * never reaches 8 entries, so the code width stays 3), in one sub-block. */
  const lzw = (indices: number[]) => {
    assert.ok(indices.length === 1 || indices.length === 2, "one or two pixels");
    const bytes: number[] = [];
    let acc = 0;
    let bits = 0;
    for (const code of [4, ...indices, 5]) {
      acc |= code << bits;
      for (bits += 3; bits >= 8; bits -= 8, acc >>= 8) bytes.push(acc & 0xff);
    }
    if (bits > 0) bytes.push(acc & 0xff);
    return [2, bytes.length, ...bytes, 0];
  };
  /** A one-row frame: its graphic control extension (disposal, transparent index), descriptor and pixels. */
  const row = (left: number, disposal: number, indices: number[], transparent?: number) => [
    ...[0x21, 0xf9, 0x04, (disposal << 2) | (transparent === undefined ? 0 : 1), 10, 0, transparent ?? 0, 0],
    ...[0x2c, left, 0, 0, 0, indices.length, 0, 1, 0, 0],
    ...lzw(indices),
  ];
  const layered = readGif(
    Uint8Array.from([
      ...[0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x02, 0x00, 0x01, 0x00, 0x81, 0x00, 0x00],
      ...[255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0],
      ...row(0, 1, [0, 0]), // white, white; left in place
      ...row(1, 2, [1]), // black over the right pixel; then cleared to transparent (disposal 2)
      ...row(0, 3, [2, 3], 3), // red over the left pixel, the right one transparent; then undone (disposal 3)
      ...row(1, 0, [3]), // green over the right pixel (3 is a colour again: this frame has no transparent index)
      0x3b,
    ]),
  );
  const WHITE = [255, 255, 255, 255];

  test("keeps a frame on screen until the next one, then disposes of it", () => {
    assert.equal(layered.frames.length, 4);
    assert.deepEqual([...restingFrame(layered, 0)], [...WHITE, ...WHITE]);
    assert.deepEqual([...restingFrame(layered, 1)], [...WHITE, 0, 0, 0, 255]);
  });

  test("clears only the disposed frame's rectangle (disposal 2), and a transparent pixel shows what is below", () => {
    // The left pixel is red (drawn), the right one cleared by the black frame's disposal and not drawn over.
    assert.deepEqual([...restingFrame(layered, 2)], [255, 0, 0, 255, 0, 0, 0, 0]);
  });

  test("restores the canvas from before a frame with disposal 3", () => {
    // The red left pixel is undone to white; green lands on the cleared right pixel.
    assert.deepEqual([...restingFrame(layered)], [...WHITE, 0, 255, 0, 255]);
  });
});

describe("GIFs on the site play once", () => {
  const gifs = [...gifsUnder(join(siteRoot, "src")), ...gifsUnder(join(siteRoot, "public"))];

  test("the evidence recordings are among them", () => {
    for (const { name } of RECORDINGS) assert.ok(gifs.includes(join(evidenceDir, `${name}.gif`)), `${name}.gif`);
  });

  for (const path of gifs) {
    const label = path.slice(siteRoot.length);
    test(`${label} has no looping extension and ends at its trailer`, () => {
      const bytes = readFileSync(path);
      const gif = readGif(bytes);
      assert.deepEqual(loopExtensions(gif), [], `${label} loops: browsers would play it forever`);
      assert.ok(gif.frames.length >= 1, `${label} has frames`);
      assert.equal(gif.end, bytes.length, `${label} ends at its trailer`);
    });

    const still = path.replace(/\.gif$/i, "-still.png");
    if (existsSync(still)) {
      test(`${label} rests on its still`, () => assertRestsOnStill(path, still));
    }
  }
});

describe("the evidence recordings", () => {
  for (const { name, bytesBefore } of RECORDINGS) {
    const path = join(evidenceDir, `${name}.gif`);

    test(`${name} rests on the proof frame in its still`, () => {
      assertRestsOnStill(path, join(evidenceDir, `${name}-still.png`));
    });

    test(`${name} starts on a different frame (the comparison can tell frames apart)`, () => {
      const gif = readGif(readFileSync(path));
      const still = readPng(readFileSync(join(evidenceDir, `${name}-still.png`)));
      const share = differentPixels(restingFrame(gif, 0), still.rgba);
      assert.ok(share > MAX_DIFFERENT_PIXELS, `the first frame differs from the still in ${(share * 100).toFixed(2)}%`);
    });

    test(`${name} changes frame twice, the last time at about 2 s`, () => {
      const { frames } = readGif(readFileSync(path));
      assert.equal(frames.length, FRAME_CHANGES + 1);
      const lastChangeMs = frames.slice(0, -1).reduce((sum, f) => sum + f.delay * 10, 0);
      assert.ok(
        lastChangeMs >= LAST_CHANGE_MS.min && lastChangeMs <= LAST_CHANGE_MS.max,
        `last frame change at ${lastChangeMs} ms`,
      );
    });

    test(`${name} is at most ${MAX_GROWTH * 100}% larger than before it played once`, () => {
      const bytes = statSync(path).size;
      assert.ok(bytes <= Math.floor(bytesBefore * (1 + MAX_GROWTH)), `${bytes} B, was ${bytesBefore} B`);
    });
  }
});
