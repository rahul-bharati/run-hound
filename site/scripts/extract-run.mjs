#!/usr/bin/env node
/**
 * Extracts what the site shows from real Run Hound runs (DESIGN.md §5.4 R1), so every value, text, frame and
 * Playwright test on the site comes from a captured run (brand.md: evidence is real, nothing is invented).
 *
 * It reads one or more run folders of one app (report.json and artifacts/), and writes:
 * - one JSON extract (src/content/runs/<app>-<version>.json) with, per run: the version, target, start time, form name
 *   and fields, scenario counts, duration and summary counts; per scenario that ran: its title, status, note and step
 *   labels; per featured finding (below): its check id, title, severity, confidence, meaning, impact, fix, location,
 *   exported spec (filename and source) and evidence (kind, label, facts, card lines, markers, plain data, and the
 *   copied file if any); per other finding, its headline only (id, check id, scenario, title, severity, confidence,
 *   location), since the site shows none of its evidence;
 * - the evidence files of each "featured" finding (the one a check page shows: every GIF and card, and the first frame
 *   when there is no GIF), into the assets folder as <check id>-<kind>-<n>.<ext>, with GIFs changed to play once: the
 *   NETSCAPE2.0 loop extension is removed and every frame is kept byte for byte, so each rests on its last frame;
 * - crops: a box of one frame of a featured finding's evidence, cut pixel for pixel into a PNG, with the box recorded,
 *   and, for a picture of the page, the page's width and the frame's scale (GIF pixels per CSS px of the page).
 *
 * It refuses to write anything that looks like a password, token, cookie value or API key (and says where), keeps
 * only plain values from raw evidence data (no nested objects, and no selectors, which are the page's DOM paths), and
 * removes files in the assets folder that the new extract no longer references. It writes the extract only as
 * src/content/runs/<app>-<version>.json and the files only in src/assets/runs/<version>/<app> (src/ being --src), the
 * one folder it may clean, with <app> from --app and <version> the runs' own Run Hound version. Before it writes
 * anything, it refuses any other --out or --assets, and any run whose page title doesn't name <app> (Kennel's is
 * "Book a sitter · Kennel", Fernway's "Fernway: Dashboard"), so a wrong --app, --out or --assets can't overwrite or
 * delete another app's or release's files, or any other file. Node built-ins only; run by hand, never by the build.
 *
 * Usage, from site/:
 *   node scripts/extract-run.mjs --app <app> --run <run folder> [--run <run folder> …]
 *     --out src/content/runs/<app>-<version>.json --assets src/assets/runs/<version>/<app> [--src <folder>]
 *     [--feature <spec> …] [--crop <spec> …]
 *
 *   --feature all | <check id> | <finding id> | <run id>/<finding id>   (repeatable, or comma-separated)
 *       "all" features the first confirmed finding of every check; a check id, that check's first confirmed finding.
 *   --crop <name>=[<run id>/]<artifact>@<last|frame index>:<x>,<y>,<width>,<height>
 *       Cuts <name>.png from that frame of a featured finding's evidence file (a GIF or PNG), box in its pixels.
 *
 * The 0.6.0 extracts were made with (run folders under .lab-out/R1/runs/, outside the repository):
 *   (The folders come from run-hound-0.6.0-site-runs.tar.gz, which holds the four run folders, the CLI output of each
 *   capture and the Fernway server log; the maintainer keeps it privately, outside the repository, since the runs name
 *   a local home folder. Untar it in .lab-out/R1/. Its sha256:
 *   82e9717e1df5cd81dd3b91a5e5840e713f2cd66d12eca8f2fc2e5c06db6c60f6.)
 *   node scripts/extract-run.mjs --app kennel \
 *     --run .lab-out/R1/runs/kennel-0.6.0/runs/20260927-153524-2d830d \
 *     --run .lab-out/R1/runs/kennel-0.6.0/container/runs/20260928-114630-d50ea1 \
 *     --out src/content/runs/kennel-0.6.0.json --assets src/assets/runs/0.6.0/kennel \
 *     --feature '20260928-114630-d50ea1/verbose-errors#oversized-and-malformed-1' --feature all \
 *     --crop double-submit-bookings=027-double-click-book.gif@last:580,242,304,148
 *   (The second run, 2026-09-28, is verbose-errors alone (--approve oversized-and-malformed) against Kennel's container
 *   image, ghcr.io/rahul-bharati/run-hound-kennel:0.5.0, whose server is the same as 0.6.0's, run with
 *   KENNEL_BUGS=all, PORT=3160 and ANALYTICS_PORT=3161 and published on 127.0.0.1:3160-3161 like the first. Its 500
 *   stack trace names /kennel/server/index.mjs, where the first run's named the home folder Kennel ran from, so the
 *   first run keeps its verbose-errors finding as a headline only. That run folder isn't in the tarball: it is in
 *   .lab-out/R1/runs/kennel-0.6.0/container/, with the CLI's output.)
 *   (The box holds "Your bookings", its six rows, both saved copies with their number markers and both "Saved copy"
 *   labels, and stops above the next card's border at y 390. It is 1:1 with the GIF frame, which Run Hound scaled by
 *   1200 / 1640 ≈ 0.73 from the page: the 1280 px page plus its 360 px facts panel, fitted to FRAME.gifMaxWidth
 *   (app/src/engine/evidence.ts gifScale); the crop records it as pageScale. So one crop pixel is about 1.37 CSS px of
 *   the page, in a 256-colour image, and the rows are about 10 px text, 11 px apart. The GIF is the run's only picture
 *   of the page, so no sharper source exists: shown at 1.25-1.5x (380-456 px wide), its text needs checking by eye.)
 *   node scripts/extract-run.mjs --app fernway \
 *     --run .lab-out/R1/runs/fernway-0.6.0/app/runs/20260927-185146-dd6aaf \
 *     --run .lab-out/R1/runs/fernway-0.6.0/app-settings/runs/20260927-185518-9dd647 \
 *     --run .lab-out/R1/runs/fernway-0.6.0/app-settings-paywall/runs/20260927-185749-edbe4d \
 *     --out src/content/runs/fernway-0.6.0.json --assets src/assets/runs/0.6.0/fernway \
 *     --feature access-control,mass-assignment,deep-links,csrf,write-access,paywall-trust
 *
 * Exit codes: 0 written; 1 refused (a secret, a missing file, a bad feature or crop, runs of another app than --app, a
 * wrong --out or --assets, bad GIF data); 2 usage.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { crc32, deflateSync, inflateSync } from "node:zlib";

const USAGE = `Usage: node scripts/extract-run.mjs --app <app> --run <run folder> [--run …] --out src/content/runs/<app>-<version>.json
  --assets src/assets/runs/<version>/<app> [--src <folder>] [--feature all|<check id>|<finding id>|<run id>/<finding id> …]
  [--crop <name>=[<run id>/]<artifact>@<last|frame>:<x>,<y>,<width>,<height> …]`;

class UsageError extends Error {}
class Refused extends Error {}

// --- Images: GIF blocks, GIF and PNG decoding, PNG encoding ---------------------------------------------------------

/** A GIF's sub-blocks from `at`: their data joined, and where the terminator ends. */
function subBlocks(bytes, at) {
  const parts = [];
  while (at < bytes.length && bytes[at] !== 0) {
    parts.push(bytes.subarray(at + 1, at + 1 + bytes[at]));
    at += bytes[at] + 1;
  }
  if (at >= bytes.length) throw new Refused("truncated GIF");
  return { data: Buffer.concat(parts), end: at + 1 };
}

/** Walks a GIF: its size, global colour table, and each block with its byte range. */
export function gifStructure(bytes) {
  const signature = bytes.subarray(0, 6).toString("latin1");
  if (signature !== "GIF89a" && signature !== "GIF87a") throw new Refused("not a GIF");
  const width = bytes.readUInt16LE(6);
  const height = bytes.readUInt16LE(8);
  let at = 13;
  let table = null;
  if (bytes[10] & 0x80) {
    const size = 3 * 2 ** ((bytes[10] & 7) + 1);
    table = bytes.subarray(at, at + size);
    at += size;
  }
  const blocks = [];
  for (;;) {
    if (at >= bytes.length) throw new Refused("GIF has no trailer");
    const start = at;
    const introducer = bytes[at];
    if (introducer === 0x3b) return { width, height, table, blocks, end: at + 1 };
    if (introducer === 0x21) {
      const label = bytes[at + 1];
      const { data, end } = subBlocks(bytes, at + 2);
      const id = label === 0xff ? bytes.subarray(at + 3, at + 3 + bytes[at + 2]).toString("latin1") : undefined;
      blocks.push({ kind: "extension", label, id, data, start, end });
      at = end;
    } else if (introducer === 0x2c) {
      const left = bytes.readUInt16LE(at + 1);
      const top = bytes.readUInt16LE(at + 3);
      const w = bytes.readUInt16LE(at + 5);
      const h = bytes.readUInt16LE(at + 7);
      const packed = bytes[at + 9];
      at += 10;
      let local = null;
      if (packed & 0x80) {
        const size = 3 * 2 ** ((packed & 7) + 1);
        local = bytes.subarray(at, at + size);
        at += size;
      }
      const minCodeSize = bytes[at];
      const { data, end } = subBlocks(bytes, at + 1);
      blocks.push({ kind: "image", left, top, w, h, interlaced: Boolean(packed & 0x40), table: local, minCodeSize, data, start, end });
      at = end;
    } else throw new Refused(`unexpected GIF block 0x${introducer.toString(16)} at byte ${at}`);
  }
}

/** The GIF without its loop extensions (NETSCAPE2.0, ANIMEXTS1.0): browsers then play it once. Nothing else changes. */
export function playOnce(bytes) {
  const { blocks } = gifStructure(bytes);
  const loops = blocks.filter((b) => b.kind === "extension" && b.label === 0xff && /^(NETSCAPE2\.0|ANIMEXTS1\.0)/.test(b.id ?? ""));
  const kept = [];
  let from = 0;
  for (const block of loops) {
    kept.push(bytes.subarray(from, block.start));
    from = block.end;
  }
  kept.push(bytes.subarray(from));
  return Buffer.concat(kept);
}

/** Decodes GIF LZW data into `count` colour indexes. */
function lzw(minCodeSize, data, count) {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
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
  const out = new Uint8Array(count);
  let size = minCodeSize + 1;
  let next = eoi + 1;
  let prev = -1;
  let op = 0;
  let acc = 0;
  let bits = 0;
  let pos = 0;
  let ended = false;
  const emit = (code) => {
    let p = op + length[code] - 1;
    for (let c = code; c !== -1; c = prefix[c], p--) if (p < count) out[p] = suffix[c];
    op += length[code];
  };
  while (op < count) {
    while (bits < size) {
      if (pos >= data.length) throw new Refused(`truncated GIF data: ${op} of ${count} pixels`);
      acc |= data[pos++] << bits;
      bits += 8;
    }
    const code = acc & ((1 << size) - 1);
    acc >>>= size;
    bits -= size;
    if (code === clear) {
      size = minCodeSize + 1;
      next = eoi + 1;
      prev = -1;
      continue;
    }
    if (code === eoi) {
      ended = true;
      break;
    }
    if (prev === -1) {
      if (code >= clear) throw new Refused("bad GIF data: no literal after a clear code");
      emit(code);
      prev = code;
      continue;
    }
    if (code > next) throw new Refused("bad GIF data: a code beyond the table");
    if (next < 4096) {
      prefix[next] = prev;
      suffix[next] = code < next ? first[code] : first[prev];
      first[next] = first[prev];
      length[next] = length[prev] + 1;
      next += 1;
    }
    emit(code);
    if (next === 1 << size && size < 12) size += 1;
    prev = code;
  }
  // A frame's data holds every pixel; one that stops short would be padded with colour 0, a crop that isn't the page.
  if (ended && op < count) throw new Refused(`bad GIF data: the end code came after ${op} of ${count} pixels`);
  return out;
}

/** The row each decoded row of an interlaced image goes to. */
function interlacedRows(h) {
  const rows = [];
  for (const [start, step] of [
    [0, 8],
    [4, 8],
    [2, 4],
    [1, 2],
  ]) {
    for (let y = start; y < h; y += step) rows.push(y);
  }
  return rows;
}

/** The number of frames in a GIF. */
export function gifFrames(bytes) {
  return gifStructure(bytes).blocks.filter((b) => b.kind === "image").length;
}

/** Frame `index` of a GIF as the browser shows it (earlier frames composited, disposal honoured), as RGBA. */
export function gifFrame(bytes, index) {
  const { width, height, table: global, blocks } = gifStructure(bytes);
  const rgba = new Uint8Array(width * height * 4);
  let control = null;
  let previous = null;
  let frame = -1;
  for (const block of blocks) {
    if (block.kind === "extension") {
      if (block.label === 0xf9 && block.data.length >= 4) {
        const packed = block.data[0];
        control = { disposal: (packed >> 2) & 7, transparent: packed & 1 ? block.data[3] : -1 };
      }
      continue;
    }
    frame += 1;
    if (previous?.disposal === 2) {
      for (let y = previous.top; y < Math.min(height, previous.top + previous.h); y++) {
        rgba.fill(0, (y * width + previous.left) * 4, (y * width + Math.min(width, previous.left + previous.w)) * 4);
      }
    } else if (previous?.disposal === 3 && previous.saved) rgba.set(previous.saved);
    const disposal = control?.disposal ?? 0;
    const saved = disposal === 3 ? rgba.slice() : null;
    const table = block.table ?? global;
    if (!table) throw new Refused("GIF frame without a colour table");
    const indexes = lzw(block.minCodeSize, block.data, block.w * block.h);
    const rows = block.interlaced ? interlacedRows(block.h) : null;
    const transparent = control?.transparent ?? -1;
    for (let r = 0; r < block.h; r++) {
      const y = block.top + (rows ? rows[r] : r);
      if (y >= height) continue;
      for (let c = 0; c < block.w; c++) {
        const x = block.left + c;
        const i = indexes[r * block.w + c];
        if (x >= width || i === transparent) continue;
        const o = (y * width + x) * 4;
        rgba[o] = table[i * 3];
        rgba[o + 1] = table[i * 3 + 1];
        rgba[o + 2] = table[i * 3 + 2];
        rgba[o + 3] = 255;
      }
    }
    if (frame === index) return { width, height, rgba };
    previous = { disposal, saved, left: block.left, top: block.top, w: block.w, h: block.h };
    control = null;
  }
  throw new Refused(`the GIF has ${frame + 1} frames, so it has no frame ${index}`);
}

/** Decodes a non-interlaced 8-bit PNG (grey, RGB, palette, grey + alpha or RGBA) to RGBA. */
export function pngImage(bytes) {
  if (bytes.subarray(1, 4).toString("latin1") !== "PNG") throw new Refused("not a PNG");
  let at = 8;
  let header = null;
  let palette = null;
  let alpha = null;
  const idat = [];
  while (at < bytes.length) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.subarray(at + 4, at + 8).toString("latin1");
    const data = bytes.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      header = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], color: data[9], interlace: data[12] };
    } else if (type === "PLTE") palette = data;
    else if (type === "tRNS") alpha = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    at += 12 + length;
  }
  if (!header) throw new Refused("PNG without IHDR");
  const { width, height, depth, color, interlace } = header;
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color];
  if (depth !== 8 || interlace !== 0 || !channels) throw new Refused(`unsupported PNG (bit depth ${depth}, colour type ${color}, interlace ${interlace})`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? pixels[y * stride + x - channels] : 0;
      const b = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? pixels[(y - 1) * stride + x - channels] : 0;
      let value = line[x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Refused(`bad PNG filter ${filter}`);
      pixels[y * stride + x] = value & 0xff;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const p = i * channels;
    let rgb;
    let a = 255;
    if (color === 0) rgb = [pixels[p], pixels[p], pixels[p]];
    else if (color === 4) {
      rgb = [pixels[p], pixels[p], pixels[p]];
      a = pixels[p + 1];
    } else if (color === 2) rgb = [pixels[p], pixels[p + 1], pixels[p + 2]];
    else if (color === 6) {
      rgb = [pixels[p], pixels[p + 1], pixels[p + 2]];
      a = pixels[p + 3];
    } else {
      const k = pixels[p];
      if (!palette) throw new Refused("palette PNG without PLTE");
      rgb = [palette[k * 3], palette[k * 3 + 1], palette[k * 3 + 2]];
      a = alpha && k < alpha.length ? alpha[k] : 255;
    }
    rgba.set([...rgb, a], i * 4);
  }
  return { width, height, rgba };
}

/** An 8-bit PNG (RGB when every pixel is opaque, RGBA otherwise), filter 0 on every row. */
export function encodePng({ width, height, rgba }) {
  let opaque = true;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 255) opaque = false;
  const channels = opaque ? 3 : 4;
  const raw = Buffer.alloc((width * channels + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = (y * width + x) * 4;
      const to = y * (width * channels + 1) + 1 + x * channels;
      for (let k = 0; k < channels; k++) raw[to + k] = rgba[from + k];
    }
  }
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, opaque ? 2 : 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** The pixels of `box` in an RGBA image. */
export function cropImage(image, box) {
  const rgba = new Uint8Array(box.width * box.height * 4);
  for (let y = 0; y < box.height; y++) {
    const from = ((box.y + y) * image.width + box.x) * 4;
    rgba.set(image.rgba.subarray(from, from + box.width * 4), y * box.width * 4);
  }
  return { width: box.width, height: box.height, rgba };
}

/** Width and height of a PNG or GIF. */
export function imageSize(bytes) {
  if (bytes.subarray(1, 4).toString("latin1") === "PNG") return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  if (bytes.subarray(0, 3).toString("latin1") === "GIF") return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
  throw new Refused("not a PNG or GIF");
}

// --- Secrets --------------------------------------------------------------------------------------------------------

/**
 * Values shaped like live credentials. Redacted forms ("sk-p…(44 chars)", "[REDACTED:…]", "=… (36 chars)") pass.
 * src/content/runs/runs.test.ts keeps its own copy on purpose, so the test doesn't trust the script it checks; it
 * runs secretsIn as well, so a pattern added here is enforced on the committed extracts too.
 */
const SECRET_PATTERNS = [
  ["an OpenAI-style key", /\bsk-(?:proj-|live-)?[A-Za-z0-9_-]{16,}/],
  ["a Stripe key", /\b[sr]k_(?:live|test)_[A-Za-z0-9]{8,}/],
  ["a JWT", /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
  ["an AWS access key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["a GitHub token", /\bgh[pousr]_[A-Za-z0-9]{30,}/],
  ["a Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ["a Google API key", /\bAIza[0-9A-Za-z_-]{35}/],
  ["a private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["a session cookie value", /(?:^|[^A-Za-z0-9])(?:[A-Za-z0-9]*[_.-])?(?:session|sessionid|sid|token|auth|jwt)(?:[_.-][A-Za-z0-9]*)*=(?!…|\[)[^\s;,"'…]{8,}/i],
  ["a bearer token", /\bBearer\s+(?!…|\[)[A-Za-z0-9._~+/-]{16,}/],
  ["a credential in JSON", /"(?:password|passwd|secret|token|access_token|refresh_token|api_?key|client_secret)"\s*:\s*"(?!\[REDACTED|…|\s*")[^"]{6,}"/i],
];

/** Where in `value` a string looks like a secret: "runs[0].findings[3].fix: a Stripe key". */
export function secretsIn(value, path = "") {
  if (typeof value === "string") {
    return SECRET_PATTERNS.filter(([, pattern]) => pattern.test(value)).map(([name]) => `${path || "(root)"}: ${name}`);
  }
  if (Array.isArray(value)) return value.flatMap((v, i) => secretsIn(v, `${path}[${i}]`));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => secretsIn(v, path ? `${path}.${k}` : k));
  return [];
}

// --- The extract ----------------------------------------------------------------------------------------------------

const REQUEST = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) (\S+) → (\d{3}) at \+(\d+(?:\.\d+)?) ms\b/;
const isPlain = (v) => v === null || typeof v === "number" || typeof v === "boolean" || (typeof v === "string" && v.length <= 1000);
const nonEmpty = (list) => (Array.isArray(list) && list.length > 0 ? list : undefined);

/** The requests a finding's evidence facts printed, e.g. "POST /api/bookings → 201 at +29.8 ms, record …". */
function requestsOf(finding) {
  const seen = new Map();
  for (const evidence of finding.evidence ?? []) {
    for (const fact of evidence.facts ?? []) {
      const m = REQUEST.exec(fact.value ?? "");
      if (m && !seen.has(fact.label)) seen.set(fact.label, { label: fact.label, method: m[1], path: m[2], status: Number(m[3]), atMs: Number(m[4]) });
    }
  }
  return seen.size ? [...seen.values()] : undefined;
}

/**
 * Raw evidence data with plain values only (strings up to 1,000 characters, numbers, booleans, null, lists of them),
 * and no selectors: a list of them is plain strings, but they are the page's DOM paths, which the site never shows.
 */
function plainData(data) {
  if (!data || typeof data !== "object") return undefined;
  const kept = Object.fromEntries(
    Object.entries(data).filter(([k, v]) => !/selector/i.test(k) && (isPlain(v) || (Array.isArray(v) && v.every(isPlain)))),
  );
  return Object.keys(kept).length ? kept : undefined;
}

/**
 * Run Hound's facts panel width (FRAME.factsWidth in app/src/engine/evidence.ts): a frame with facts is the page and
 * this panel side by side, scaled as a whole. runs.test.ts checks the crop's scale against evidence.ts.
 */
const FACTS_PANEL_WIDTH = 360;

/** The report's own evidence item behind each kept one: its viewport and facts give a crop's page scale. */
const rawOf = new WeakMap();

/** One evidence item as the site keeps it (the copied file is filled in later). */
function evidenceOf(item) {
  const out = { kind: item.kind, label: item.label };
  if (item.step) out.step = item.step;
  const facts = nonEmpty((item.facts ?? []).map((f) => ({ label: String(f.label), value: String(f.value) })));
  if (facts) out.facts = facts;
  if (item.kind === "card") {
    const data = item.data ?? {};
    if (typeof data.title === "string") out.title = data.title;
    if (typeof data.subtitle === "string") out.subtitle = data.subtitle;
    if (typeof data.firstLineNumber === "number") out.firstLineNumber = data.firstLineNumber;
    if (Array.isArray(data.lines)) out.lines = data.lines.map(String);
  } else if (item.kind === "gif" || item.kind === "frame") {
    if (typeof item.frames === "number") out.frames = item.frames;
    if (typeof item.durationMs === "number") out.durationMs = item.durationMs;
    const markers = nonEmpty(
      (item.highlights ?? [])
        .filter((h) => h.label && h.box)
        .map((h) => ({ label: h.label, box: { x: h.box.x, y: h.box.y, width: h.box.width, height: h.box.height } })),
    );
    if (markers) out.markers = markers;
  } else {
    const data = plainData(item.data);
    if (data) out.data = data;
  }
  if (item.path) out.artifact = basename(item.path);
  rawOf.set(out, item);
  return out;
}

/** Which evidence items of a featured finding are copied: every GIF and card, and the first frame when there is no GIF. */
function copied(evidence) {
  const hasGif = evidence.some((e) => e.kind === "gif");
  const firstFrame = evidence.find((e) => e.kind === "frame");
  return evidence.filter((e) => e.artifact && (e.kind === "gif" || e.kind === "card" || (!hasGif && e === firstFrame)));
}

/** A run's report as the site keeps it. */
function runOf(report) {
  const plan = report.plan ?? {};
  const byScenario = new Map((plan.scenarios ?? []).map((s) => [s.id, s]));
  const scenarioOfFinding = new Map();
  for (const result of report.results ?? []) for (const f of result.findings ?? []) scenarioOfFinding.set(f.id, result.scenarioId);
  const scenarios = (report.results ?? []).map((result) => {
    const planned = byScenario.get(result.scenarioId);
    if (!planned) throw new Refused(`run ${report.runId}: scenario ${result.scenarioId} ran but isn't in the plan`);
    const scenario = { id: result.scenarioId, checkId: result.checkId, title: planned.title, status: result.status };
    if (typeof result.notes === "string" && result.notes.trim()) scenario.note = result.notes;
    scenario.steps = (result.steps ?? []).map((s) => s.label);
    return scenario;
  });
  const findings = (report.findings ?? []).map((f) => {
    const scenarioId = scenarioOfFinding.get(f.id);
    if (!scenarioId) throw new Refused(`run ${report.runId}: finding ${f.id} belongs to no scenario`);
    const finding = {
      id: f.id,
      checkId: f.checkId,
      scenarioId,
      featured: false,
      title: f.title,
      severity: f.severity,
      confidence: f.confidence,
      meaning: f.meaning,
      impact: f.impact,
      fix: f.fix,
    };
    if (f.location) finding.location = f.location;
    const locations = nonEmpty((f.locations ?? []).filter((l) => typeof l === "string"));
    if (locations) finding.locations = locations;
    if (f.scope) finding.scope = f.scope;
    if (f.spec) finding.spec = { filename: f.spec.filename, source: f.spec.source };
    const requests = requestsOf(f);
    if (requests) finding.requests = requests;
    finding.evidence = (f.evidence ?? []).map(evidenceOf);
    return finding;
  });
  const accounts = report.accounts ?? {};
  return {
    runId: report.runId,
    runHoundVersion: report.runHoundVersion,
    target: report.target,
    startedAt: report.startedAt,
    durationMs: report.durationMs,
    signedIn: accounts.signedInAs ? { as: accounts.signedInAs.label, other: accounts.other?.label ?? null } : null,
    form: plan.form
      ? { name: plan.form.name, fieldCount: plan.form.fields.length, fields: plan.form.fields.map((f) => ({ label: f.label ?? null, type: f.type })) }
      : null,
    planned: (plan.scenarios ?? []).length,
    approved: (report.approved ?? []).length,
    summary: Object.fromEntries(Object.entries(report.summary ?? {}).filter(([, v]) => typeof v === "number")),
    scenarios,
    findings,
  };
}

/** What the site keeps of a finding it doesn't feature: the headline, for a list or a count; never its evidence. */
const HEADLINE = ["id", "checkId", "scenarioId", "featured", "title", "severity", "confidence", "location"];
const headline = (finding) => Object.fromEntries(HEADLINE.filter((k) => finding[k] !== undefined).map((k) => [k, finding[k]]));

/** Marks the featured findings: at most one per check, always a confirmed one. */
function feature(runs, specs) {
  const all = runs.flatMap((run) => run.findings.map((finding) => ({ run, finding })));
  const chosen = new Map();
  const choose = (entry, spec) => {
    if (entry.finding.confidence !== "confirmed") throw new Refused(`--feature ${spec}: ${entry.finding.id} is ${entry.finding.confidence}, not confirmed`);
    const other = chosen.get(entry.finding.checkId);
    if (other && other !== entry) throw new Refused(`--feature ${spec}: ${entry.finding.checkId} already features ${other.finding.id}`);
    chosen.set(entry.finding.checkId, entry);
  };
  const firstOf = (checkId) => all.find((e) => e.finding.checkId === checkId && e.finding.confidence === "confirmed");
  for (const spec of specs) {
    if (spec === "all") {
      for (const checkId of new Set(all.map((e) => e.finding.checkId))) {
        const entry = chosen.get(checkId) ?? firstOf(checkId);
        if (entry) choose(entry, spec);
      }
    } else if (spec.includes("#")) {
      const slash = spec.indexOf("/");
      const runId = slash > 0 && slash < spec.indexOf("#") ? spec.slice(0, slash) : null;
      const id = runId ? spec.slice(slash + 1) : spec;
      const matches = all.filter((e) => e.finding.id === id && (!runId || e.run.runId === runId));
      if (matches.length === 0) throw new Refused(`--feature ${spec}: no such finding`);
      if (matches.length > 1) throw new Refused(`--feature ${spec}: ${id} is in ${matches.length} runs; name one as <run id>/${id}`);
      choose(matches[0], spec);
    } else {
      const entry = firstOf(spec);
      if (!entry) throw new Refused(`--feature ${spec}: no confirmed finding of ${spec} in these runs`);
      choose(entry, spec);
    }
  }
  for (const { finding } of chosen.values()) finding.featured = true;
}

/** "<name>=[<run id>/]<artifact>@<last|n>:<x>,<y>,<w>,<h>" */
function parseCrop(spec) {
  const m = /^([a-z0-9]+(?:-[a-z0-9]+)*)=(?:([^/@]+)\/)?([^/@]+)@(last|\d+):(\d+),(\d+),(\d+),(\d+)$/.exec(spec);
  if (!m) throw new UsageError(`--crop ${spec}: expected <name>=[<run id>/]<artifact>@<last|frame>:<x>,<y>,<width>,<height>`);
  const [, id, runId, artifact, frame, x, y, width, height] = m;
  return { id, runId: runId ?? null, artifact, frame, box: { x: Number(x), y: Number(y), width: Number(width), height: Number(height) } };
}

const slug = (text) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** A path as seen from the working folder, with forward slashes: for messages and the recorded command. */
const shown = (path) => relative(process.cwd(), resolve(path)).split(sep).join("/") || ".";

/** Builds the extract and the files to write. Reads the run folders; writes nothing. */
export function buildExtract({ app, runDirs, srcDir, outFile, assetsDir, features, crops, extractedWith }) {
  const reports = runDirs.map((dir) => {
    const file = join(dir, "report.json");
    if (!existsSync(file)) throw new Refused(`${shown(dir)}: no report.json (is it a run folder?)`);
    return { dir, report: JSON.parse(readFileSync(file, "utf8")) };
  });
  const versions = [...new Set(reports.map((r) => r.report.runHoundVersion))];
  if (versions.length !== 1 || !versions[0]) throw new Refused(`the runs must share one Run Hound version; they have ${versions.join(", ") || "none"}`);
  const [version] = versions;
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Refused(`the runs' Run Hound version ${JSON.stringify(version)} isn't a release number`);
  const ids = reports.map((r) => r.report.runId);
  if (new Set(ids).size !== ids.length) throw new Refused(`a run is given twice (${ids.join(", ")})`);

  // Exactly this app's and these runs' release's: write() removes every file in the assets folder the extract doesn't
  // reference and overwrites the extract, so another app's or release's must be out of reach. The paths come from
  // --app, so the runs must be that app's too: a run names its app in its page's title ("Book a sitter · Kennel",
  // "Fernway: Dashboard"), where a hyphen in --app may be a hyphen or a space.
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(app)) throw new Refused(`--app ${app}: lower-case letters, digits and hyphens`);
  const namesApp = new RegExp(`\\b${app.split("-").join("[-\\s]")}\\b`, "i");
  for (const { dir, report } of reports) {
    const title = report.plan?.page?.title ?? null;
    if (!namesApp.test(title ?? "")) {
      throw new Refused(`--app ${app}: the run in ${shown(dir)} has the page title ${JSON.stringify(title)}, which doesn't name ${app}; is it another app's run?`);
    }
  }
  const wantAssets = resolve(srcDir, "assets", "runs", version, app);
  const wantOut = resolve(srcDir, "content", "runs", `${app}-${version}.json`);
  if (resolve(assetsDir) !== wantAssets) {
    throw new Refused(
      `--assets ${shown(assetsDir)}: must be ${shown(wantAssets)} for --app ${app} and these Run Hound ${version} runs, the only folder the extractor may clean`,
    );
  }
  if (resolve(outFile) !== wantOut) {
    throw new Refused(`--out ${shown(outFile)}: must be ${shown(wantOut)} for --app ${app} and these Run Hound ${version} runs`);
  }
  const assetsRel = `assets/runs/${version}/${app}`;

  const runs = reports.map((r) => runOf(r.report));
  feature(runs, features);
  for (const run of runs) run.findings = run.findings.map((f) => (f.featured ? f : headline(f)));

  const files = new Map();
  const dirOf = new Map(reports.map((r) => [r.report.runId, r.dir]));
  const artifactPath = (runId, artifact) => join(dirOf.get(runId), "artifacts", artifact);
  const place = (name, bytes, source) => {
    const existing = files.get(name);
    if (existing && existing.source !== source) throw new Refused(`two evidence files would both be copied as ${name}`);
    files.set(name, { bytes, source });
    return `${assetsRel}/${name}`;
  };

  for (const run of runs) {
    for (const finding of run.findings.filter((f) => f.featured)) {
      const copy = new Set(copied(finding.evidence));
      // Named <check id>-<kind>-<n>: short and predictable for a static import, and free of the record ids and cut
      // words of Run Hound's own artifact names ("write-access-patch-api-tasks-ffb60789-…-as-acco").
      const count = new Map();
      for (const evidence of finding.evidence) {
        if (!evidence.artifact) continue;
        if (!copy.has(evidence)) {
          evidence.asset = null;
          continue;
        }
        const from = artifactPath(run.runId, evidence.artifact);
        if (!existsSync(from)) throw new Refused(`${finding.id}: evidence file ${evidence.artifact} is missing from run ${run.runId}`);
        let bytes = readFileSync(from);
        const ext = evidence.artifact.toLowerCase().endsWith(".gif") ? "gif" : "png";
        if (ext === "gif") bytes = playOnce(bytes);
        const n = (count.get(evidence.kind) ?? 0) + 1;
        count.set(evidence.kind, n);
        evidence.asset = place(`${slug(`${finding.checkId}-${evidence.kind}`)}-${n}.${ext}`, bytes, `${run.runId}/${evidence.artifact}`);
        Object.assign(evidence, imageSize(bytes));
      }
    }
  }

  const cropped = crops.map((spec) => {
    const crop = parseCrop(spec);
    const shownBy = runs.flatMap((run) =>
      run.findings
        .filter((f) => f.featured && (!crop.runId || run.runId === crop.runId))
        .flatMap((f) => f.evidence.filter((e) => e.artifact === crop.artifact).map((e) => ({ run, finding: f, evidence: e }))),
    );
    if (shownBy.length === 0) throw new Refused(`--crop ${spec}: no featured finding shows ${crop.artifact}`);
    if (new Set(shownBy.map((s) => s.run.runId)).size > 1) throw new Refused(`--crop ${spec}: ${crop.artifact} is in several runs; name one`);
    const { run, finding, evidence } = shownBy[0];
    const bytes = readFileSync(artifactPath(run.runId, crop.artifact));
    const isGif = crop.artifact.toLowerCase().endsWith(".gif");
    const frames = isGif ? gifFrames(bytes) : 1;
    const frame = crop.frame === "last" ? frames - 1 : Number(crop.frame);
    if (frame >= frames) throw new Refused(`--crop ${spec}: ${crop.artifact} has ${frames} frame(s)`);
    const image = isGif ? gifFrame(bytes, frame) : pngImage(bytes);
    const { box } = crop;
    if (box.width < 1 || box.height < 1 || box.x + box.width > image.width || box.y + box.height > image.height) {
      throw new Refused(`--crop ${spec}: the box is outside the ${image.width} x ${image.height} frame`);
    }
    const png = encodePng(cropImage(image, box));
    // A picture of the page (a GIF or frame) with facts is the page and the facts panel side by side, scaled as a
    // whole to the image's width. Without facts the panel may or may not be there, and a card isn't the page: null.
    const raw = rawOf.get(evidence);
    const ofPage = (evidence.kind === "gif" || evidence.kind === "frame") && typeof raw?.viewport?.width === "number" && raw.facts?.length > 0;
    const pageWidth = ofPage ? raw.viewport.width : null;
    const pageScale = ofPage ? Math.round((image.width / (pageWidth + FACTS_PANEL_WIDTH)) * 10000) / 10000 : null;
    return {
      id: crop.id,
      runId: run.runId,
      findingId: finding.id,
      artifact: crop.artifact,
      frame,
      source: { width: image.width, height: image.height },
      box,
      pageWidth,
      pageScale,
      asset: place(`${crop.id}.png`, png, `crop ${crop.id}`),
      width: box.width,
      height: box.height,
    };
  });

  const extract = { runHoundVersion: versions[0], app, extractedWith, runs, crops: cropped };
  const secrets = secretsIn(extract);
  if (secrets.length) throw new Refused(`refusing to write: these look like secrets\n  ${secrets.join("\n  ")}`);
  return { extract, files };
}

/** Writes the extract and its files, and removes files in the assets folder the extract no longer references. */
function write({ outFile, assetsDir }, { extract, files }) {
  mkdirSync(assetsDir, { recursive: true });
  for (const [name, { bytes }] of files) writeFileSync(join(assetsDir, name), bytes);
  for (const name of readdirSync(assetsDir)) {
    const file = join(assetsDir, name);
    if (!files.has(name) && statSync(file).isFile()) rmSync(file);
  }
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, `${JSON.stringify(extract, null, 2)}\n`);
}

function main(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      app: { type: "string" },
      run: { type: "string", multiple: true },
      out: { type: "string" },
      assets: { type: "string" },
      src: { type: "string" },
      feature: { type: "string", multiple: true },
      crop: { type: "string", multiple: true },
    },
    strict: true,
  });
  if (!values.app || !values.run?.length || !values.out || !values.assets) throw new UsageError("--app, --run, --out and --assets are required");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(values.app)) throw new UsageError(`--app ${values.app}: lower-case letters, digits and hyphens`);
  const srcDir = resolve(values.src ?? join(dirname(fileURLToPath(import.meta.url)), "..", "src"));
  const features = (values.feature ?? []).flatMap((f) => f.split(",")).map((f) => f.trim()).filter(Boolean);
  const crops = values.crop ?? [];
  const extractedWith = [
    "scripts/extract-run.mjs",
    "--app",
    values.app,
    ...values.run.flatMap((r) => ["--run", shown(r)]),
    "--out",
    shown(values.out),
    "--assets",
    shown(values.assets),
    ...(values.src ? ["--src", shown(values.src)] : []),
    ...features.flatMap((f) => ["--feature", f]),
    ...crops.flatMap((c) => ["--crop", c]),
  ];
  const assetsDir = resolve(values.assets);
  const outFile = resolve(values.out);
  const result = buildExtract({ app: values.app, runDirs: values.run.map((r) => resolve(r)), srcDir, outFile, assetsDir, features, crops, extractedWith });
  write({ outFile, assetsDir }, result);
  const featured = result.extract.runs.flatMap((r) => r.findings).filter((f) => f.featured).length;
  process.stdout.write(
    `extract-run: wrote ${shown(values.out)} (${result.extract.runs.length} run(s), ${featured} featured findings) and ${result.files.size} files to ${shown(values.assets)}\n`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    const usage = err instanceof UsageError || (err && typeof err.code === "string" && err.code.startsWith("ERR_PARSE_ARGS"));
    process.stderr.write(`extract-run: ${err.message}\n${usage ? `${USAGE}\n` : ""}`);
    process.exitCode = usage ? 2 : 1;
  }
}
