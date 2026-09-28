// Tests for scripts/extract-run.mjs (`pnpm test`): it runs on a small synthetic run folder (a report.json in Run
// Hound 0.6.0's shape, a looping GIF and a PNG), and must keep exactly what the site shows, copy the featured
// evidence, make GIFs play once, cut crops pixel for pixel, refuse to write anything that looks like a secret, and
// write and clean only its own folders.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { after, describe, test } from "node:test";
import { crc32, deflateSync, inflateSync } from "node:zlib";
import { buildExtract, cropImage, gifFrame } from "./extract-run.mjs";

const script = join(import.meta.dirname, "extract-run.mjs");
const root = mkdtempSync(join(tmpdir(), "extract-run-"));
after(() => rmSync(root, { recursive: true, force: true }));

// --- Fixture images -------------------------------------------------------------------------------------------------

/** The fixture palette: white, red, green, blue. */
const PALETTE = [
  [255, 255, 255],
  [255, 0, 0],
  [0, 128, 0],
  [0, 0, 255],
];

/**
 * A GIF89a with a 4-colour global table, one frame per entry of `frames` (arrays of palette indexes, row by row), and,
 * when `loop` is set, the NETSCAPE2.0 extension that makes browsers loop it forever. The LZW data uses literal codes
 * only, with a clear code every 2 pixels so the code size stays at 3 bits, which any decoder must read.
 */
function gif(width, height, frames, { loop = true, delays = [] } = {}) {
  const out = [];
  const u16 = (n) => [n & 0xff, n >> 8];
  out.push(...Buffer.from("GIF89a"), ...u16(width), ...u16(height), 0xf1, 0, 0);
  for (const rgb of PALETTE) out.push(...rgb);
  if (loop) out.push(0x21, 0xff, 0x0b, ...Buffer.from("NETSCAPE2.0"), 0x03, 0x01, 0x00, 0x00, 0x00);
  frames.forEach((pixels, i) => {
    out.push(0x21, 0xf9, 0x04, 0x00, ...u16(delays[i] ?? 50), 0x00, 0x00);
    out.push(0x2c, ...u16(0), ...u16(0), ...u16(width), ...u16(height), 0x00);
    const codes = [4];
    pixels.forEach((p, k) => {
      codes.push(p);
      if (k % 2 === 1) codes.push(4);
    });
    codes.push(5);
    const bytes = [];
    let acc = 0;
    let bits = 0;
    for (const code of codes) {
      acc |= code << bits;
      bits += 3;
      while (bits >= 8) {
        bytes.push(acc & 0xff);
        acc >>= 8;
        bits -= 8;
      }
    }
    if (bits > 0) bytes.push(acc & 0xff);
    out.push(0x02);
    for (let at = 0; at < bytes.length; at += 255) {
      const chunk = bytes.slice(at, at + 255);
      out.push(chunk.length, ...chunk);
    }
    out.push(0x00);
  });
  out.push(0x3b);
  return Buffer.from(out);
}

/**
 * GIF LZW as encoders write it (the classic compress/GIFEncoder scheme, as in gifenc, which Run Hound uses): dictionary
 * codes, the code size growing once the table passes each power of two, and a clear code when the table is full at
 * 4,096 entries; or, with `deferClear`, no clear at all once it is full (the spec allows it): every later code is 12
 * bits and the table, entry 4,095 included, stays as it is. Returns the data bytes, how many times the table filled
 * and how many codes were sent while it was full, so a test knows it covered those paths.
 */
function lzwEncode(minCodeSize, indexes, { deferClear = false } = {}) {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  const bytes = [];
  let acc = 0;
  let bits = 0;
  let size = minCodeSize + 1;
  let next = eoi + 1;
  let table = new Map();
  let fills = 0;
  let whileFull = 0;
  const output = (code) => {
    if (next >= 4096 && code !== clear) whileFull += 1;
    acc |= code << bits;
    bits += size;
    while (bits >= 8) {
      bytes.push(acc & 0xff);
      acc >>>= 8;
      bits -= 8;
    }
    if (code === clear) {
      size = minCodeSize + 1;
      next = eoi + 1;
      table = new Map();
    } else if (next > (1 << size) - 1 && size < 12) size += 1;
  };
  output(clear);
  let prefix = indexes[0];
  for (let i = 1; i < indexes.length; i++) {
    const k = indexes[i];
    const known = table.get(prefix * 256 + k);
    if (known !== undefined) {
      prefix = known;
      continue;
    }
    output(prefix);
    if (next < 4096) {
      table.set(prefix * 256 + k, next++);
      if (next === 4096) fills += 1;
    } else if (!deferClear) output(clear);
    prefix = k;
  }
  output(prefix);
  output(eoi);
  if (bits > 0) bytes.push(acc & 0xff);
  return { bytes, fills, whileFull };
}

/** A one-frame GIF89a with the 4-colour fixture palette and the given LZW data (minimum code size 2). */
function gifWithData(width, height, data) {
  const u16 = (n) => [n & 0xff, n >> 8];
  const out = [...Buffer.from("GIF89a"), ...u16(width), ...u16(height), 0xf1, 0, 0];
  for (const rgb of PALETTE) out.push(...rgb);
  out.push(0x2c, ...u16(0), ...u16(0), ...u16(width), ...u16(height), 0x00, 0x02);
  for (let at = 0; at < data.length; at += 255) {
    const chunk = data.slice(at, at + 255);
    out.push(chunk.length, ...chunk);
  }
  out.push(0x00, 0x3b);
  return Buffer.from(out);
}

/** An 8-bit RGB PNG (filter 0 on every row) from palette indexes. */
function png(width, height, pixels) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = PALETTE[pixels[y * width + x]];
      raw.set([r, g, b], y * (width * 3 + 1) + 1 + x * 3);
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** A PNG's size and its pixels as [r, g, b, a] rows, for PNGs whose rows all use filter 0 (as the script writes them). */
function readPng(bytes) {
  assert.equal(bytes.subarray(1, 4).toString("latin1"), "PNG");
  let at = 8;
  let width = 0;
  let height = 0;
  let type = 0;
  const idat = [];
  while (at < bytes.length) {
    const len = bytes.readUInt32BE(at);
    const kind = bytes.subarray(at + 4, at + 8).toString("latin1");
    const data = bytes.subarray(at + 8, at + 8 + len);
    if (kind === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      type = data[9];
    }
    if (kind === "IDAT") idat.push(data);
    at += 12 + len;
  }
  const channels = type === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const rows = [];
  for (let y = 0; y < height; y++) {
    const start = y * (width * channels + 1);
    assert.equal(raw[start], 0, "filter 0");
    const row = [];
    for (let x = 0; x < width; x++) {
      const p = start + 1 + x * channels;
      row.push([raw[p], raw[p + 1], raw[p + 2], channels === 4 ? raw[p + 3] : 255]);
    }
    rows.push(row);
  }
  return { width, height, rows };
}

/** The application extensions and frame count of a GIF (a block walk). */
function gifBlocks(bytes) {
  let at = 13;
  if (bytes[10] & 0x80) at += 3 * 2 ** ((bytes[10] & 7) + 1);
  const skip = () => {
    while (bytes[at] !== 0) at += bytes[at] + 1;
    at += 1;
  };
  const applications = [];
  let frames = 0;
  for (;;) {
    const b = bytes[at];
    if (b === 0x3b) return { applications, frames };
    if (b === 0x21) {
      if (bytes[at + 1] === 0xff) applications.push(bytes.subarray(at + 3, at + 3 + bytes[at + 2]).toString("latin1"));
      at += 2;
      skip();
    } else if (b === 0x2c) {
      frames += 1;
      at += 10;
      at += 1;
      skip();
    } else throw new Error(`bad block ${b}`);
  }
}

// --- Fixture run folders --------------------------------------------------------------------------------------------

/** Frame 1: all white. Frame 2 (the proof): a 6 x 4 picture with a red row 1 and a blue row 2 from x = 2. */
const W = 6;
const H = 4;
const frame1 = new Array(W * H).fill(0);
const frame2 = [
  [0, 0, 0, 0, 0, 0],
  [0, 0, 1, 1, 1, 0],
  [0, 0, 3, 3, 3, 0],
  [2, 2, 2, 2, 2, 2],
].flat();

const SPEC = `import { test, expect } from "@playwright/test";\n\n// Exported by Run Hound. Runs on its own: npx playwright test <this file>\ntest("x", async ({ page }) => {\n  await page.goto("http://localhost:3160/book");\n});\n`;

/** A report.json in Run Hound 0.6.0's shape, with the fields the extractor reads and some it must drop. */
function report(overrides = {}) {
  const findings = [
    {
      checkId: "double-submit",
      id: "double-submit#double-click-submit-1",
      category: "broken-feature",
      confidence: "confirmed",
      title: 'Double-clicking "Book" saves 2 times',
      severity: "high",
      meaning: "The button keeps working while the first save is in progress.",
      impact: "People get duplicate bookings.",
      fix: 'Ask your AI or developer: "Disable the Book button while the save is pending."',
      location: '"Book" button',
      scope: "Book a sitter form",
      evidence: [
        {
          kind: "gif",
          label: "double-click Book",
          path: "001-double-click-book.gif",
          url: "http://localhost:3160/book",
          capturedAt: "2026-09-27T15:36:06.776Z",
          step: "Form filled → Double-clicked → 2 save requests",
          viewport: { width: 1280, height: 800 },
          highlights: [
            { selector: "#root > form button", label: "Saved copy 1", box: { x: 2, y: 1, width: 3, height: 1 } },
            { selector: "#root > form button", label: "Saved copy 2", tone: "info", box: { x: 2, y: 2, width: 3, height: 1 } },
          ],
          facts: [
            { label: "Save requests so far", value: "2" },
            { label: "Save request 1", value: "POST /api/bookings → 201 at +29.8 ms, record cf6e508e" },
            { label: "Save request 2", value: "POST /api/bookings → 201 at +30.0 ms, record e217c8b4" },
          ],
          frames: 2,
          durationMs: 1000,
        },
        {
          kind: "card",
          label: "save requests from one double click",
          path: "002-save-requests.png",
          url: "http://localhost:3160/book",
          capturedAt: "2026-09-27T15:36:08.357Z",
          facts: [{ label: "Save request 1", value: "POST /api/bookings → 201 at +29.8 ms, record cf6e508e" }],
          data: { title: "POST /api/bookings sent 2 times", subtitle: "http://localhost:3160/api/bookings", lines: ["> #1  +29.8 ms", ">     ← 201"] },
        },
        {
          kind: "network",
          label: "Save request 1: POST http://localhost:3160/api/bookings → 201",
          data: { method: "POST", url: "http://localhost:3160/api/bookings", status: 201, failure: null, headers: { cookie: "x" } },
        },
        {
          kind: "dom",
          label: "Clicked and watched",
          data: { controls: [{ selector: "#a" }], observed: { dom: true }, selectors: ["#root > div > main > form > input"], selector: "#b", stops: 3 },
        },
      ],
      spec: { filename: "double-submit-double-click-saves-once-1.spec.ts", source: SPEC },
    },
    {
      checkId: "double-submit",
      id: "double-submit#double-click-submit-2",
      category: "broken-feature",
      confidence: "confirmed",
      title: 'Double-clicking "Save draft" saves 2 times',
      severity: "high",
      meaning: "m",
      impact: "i",
      fix: "f",
      location: '"Save draft" button',
      evidence: [{ kind: "frame", label: "second", path: "003-second.png", facts: [] }],
      spec: { filename: "double-submit-2.spec.ts", source: SPEC },
    },
    {
      checkId: "security-headers",
      id: "security-headers#1",
      category: "security",
      confidence: "confirmed",
      title: "3 security header problems",
      severity: "medium",
      meaning: "m",
      impact: "i",
      fix: "f",
      location: "Content-Security-Policy",
      locations: ["Content-Security-Policy", "X-Content-Type-Options"],
      evidence: [{ kind: "card", label: "security headers of the page", path: "003-second.png", data: { title: "t", subtitle: "s", lines: ["a", "b"] } }],
      spec: { filename: "security-headers-1.spec.ts", source: SPEC },
    },
  ];
  const scenarios = [
    { id: "double-click-submit", checkId: "double-submit", title: 'Double-click "Book" with valid data', description: "d", kind: "danger", priority: "high", destructive: false, defaultSelected: true, scope: "form", formIndex: 0 },
    { id: "security-headers:response-headers", checkId: "security-headers", title: "Check the page's security headers", description: "d", kind: "golden", priority: "high", destructive: false, defaultSelected: true, scope: "page" },
    { id: "csrf:cross-site", checkId: "csrf", title: "A page on another site can't change Account A's data", description: "d", kind: "danger", priority: "high", destructive: false, defaultSelected: false, scope: "form" },
  ];
  const step = (label) => ({ label, url: "http://localhost:3160/book", at: "2026-09-27T15:36:06.683Z" });
  return {
    runId: "20260927-000000-aaaaaa",
    target: "http://localhost:3160/book",
    startedAt: "2026-09-27T15:35:24.471Z",
    finishedAt: "2026-09-27T15:36:21.299Z",
    durationMs: 56828,
    groups: [
      { id: "features", label: "Features", scenarioIds: ["double-click-submit"], passed: 0, failed: 1, errored: 0, skipped: 0, findings: 2, durationMs: 100 },
      { id: "security", label: "Security", scenarioIds: ["security-headers:response-headers"], passed: 0, failed: 1, errored: 0, skipped: 0, findings: 1, durationMs: 50 },
    ],
    runHoundVersion: "0.6.0",
    plan: {
      target: "http://localhost:3160/book",
      form: {
        url: "http://localhost:3160/book",
        index: 0,
        selector: "#root form",
        name: "Book a sitter",
        fields: [
          { label: "Pet name", type: "text", selector: "#petName" },
          { label: null, type: "tel", selector: "#phone" },
        ],
        controls: [],
      },
      // The title is where a run names its app; the extractor matches it against --app.
      page: { url: "http://localhost:3160/book", title: "Book a sitter · Kennel", forms: [], controls: [], links: 0, linkTargets: [] },
      scenarios,
      groups: [],
      signInHint: true,
    },
    approved: ["double-click-submit", "security-headers:response-headers"],
    results: [
      {
        checkId: "double-submit",
        scenarioId: "double-click-submit",
        status: "fail",
        findings: findings.slice(0, 2),
        durationMs: 2700,
        steps: [step("Filling the form with valid test values"), step('Double-clicked "Book"'), step("After the double click: 2 save requests")],
      },
      {
        checkId: "security-headers",
        scenarioId: "security-headers:response-headers",
        status: "fail",
        findings: findings.slice(2),
        durationMs: 700,
        notes: "Read the headers of 1 response",
        steps: [step("Loading the page and reading its response headers")],
      },
    ],
    findings,
    summary: { critical: 0, high: 2, medium: 1, low: 0, passed: 0, failed: 2, errored: 0, skipped: 0 },
    notVisible: ["Database backups and recovery"],
    pagesVisited: [{ url: "http://localhost:3160/book", scenarioIds: [] }],
    testRecordsCreated: 2,
    options: { allowDestructive: false, headed: false },
    browser: "Chromium 153.0.8010.12",
    accounts: { signedInAs: null, other: null },
    ...overrides,
  };
}

/** A report.json of a Fernway run: the fixture's report with Fernway's page title. */
function fernwayReport(overrides = {}) {
  const data = report(overrides);
  data.plan.page.title = "Fernway: Dashboard";
  return data;
}

let serial = 0;
/** Writes a run folder (report.json, artifacts/, specs/) and returns its path. */
function runFolder(data = report(), { gifLoop = true } = {}) {
  const dir = join(root, `run-${++serial}`, data.runId);
  mkdirSync(join(dir, "artifacts"), { recursive: true });
  writeFileSync(join(dir, "report.json"), JSON.stringify(data));
  writeFileSync(join(dir, "artifacts", "001-double-click-book.gif"), gif(W, H, [frame1, frame2], { loop: gifLoop }));
  writeFileSync(join(dir, "artifacts", "002-save-requests.png"), png(W, H, frame2));
  writeFileSync(join(dir, "artifacts", "003-second.png"), png(W, H, frame1));
  return dir;
}

/**
 * Runs the extractor with `args` in a fresh site-like folder, writing where it must for the --app in `args` and the
 * fixture's Run Hound 0.6.0 runs (src/content/runs/<app>-0.6.0.json and src/assets/runs/0.6.0/<app>); returns its
 * output, the extract and the folder.
 */
function extract(args, { site = join(root, `site-${++serial}`) } = {}) {
  mkdirSync(join(site, "src"), { recursive: true });
  const app = args.includes("--app") ? args[args.indexOf("--app") + 1] : "kennel";
  const out = join(site, `src/content/runs/${app}-0.6.0.json`);
  const r = spawnSync(process.execPath, [script, "--src", join(site, "src"), "--out", out, "--assets", join(site, `src/assets/runs/0.6.0/${app}`), ...args], {
    encoding: "utf8",
    cwd: site,
  });
  return {
    status: r.status,
    output: `${r.stdout}${r.stderr}`,
    site,
    data: existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : null,
  };
}

// --- Tests ----------------------------------------------------------------------------------------------------------

describe("extract-run.mjs", () => {
  test("keeps the run's facts, its scenarios' steps and its findings' texts verbatim", () => {
    const { status, output, data } = extract(["--app", "kennel", "--run", runFolder(), "--feature", "all"]);
    assert.equal(status, 0, output);
    assert.equal(data.runHoundVersion, "0.6.0");
    assert.equal(data.app, "kennel");
    const [run] = data.runs;
    assert.equal(run.runId, "20260927-000000-aaaaaa");
    assert.equal(run.target, "http://localhost:3160/book");
    assert.equal(run.startedAt, "2026-09-27T15:35:24.471Z");
    assert.equal(run.durationMs, 56828);
    assert.equal(run.signedIn, null);
    assert.deepEqual(run.form, { name: "Book a sitter", fieldCount: 2, fields: [{ label: "Pet name", type: "text" }, { label: null, type: "tel" }] });
    assert.equal(run.planned, 3);
    assert.equal(run.approved, 2);
    assert.deepEqual(run.summary, { critical: 0, high: 2, medium: 1, low: 0, passed: 0, failed: 2, errored: 0, skipped: 0 });
    // Only the scenarios that ran, with their step labels.
    assert.deepEqual(
      run.scenarios.map((s) => [s.id, s.checkId, s.title, s.status, s.steps.length]),
      [
        ["double-click-submit", "double-submit", 'Double-click "Book" with valid data', "fail", 3],
        ["security-headers:response-headers", "security-headers", "Check the page's security headers", "fail", 1],
      ],
    );
    assert.deepEqual(run.scenarios[0].steps, ["Filling the form with valid test values", 'Double-clicked "Book"', "After the double click: 2 save requests"]);
    assert.equal(run.scenarios[1].note, "Read the headers of 1 response");
    const source = report().findings[0];
    const finding = run.findings[0];
    for (const key of ["id", "checkId", "title", "severity", "confidence", "meaning", "impact", "fix", "location", "scope"]) {
      assert.equal(finding[key], source[key], key);
    }
    assert.equal(finding.scenarioId, "double-click-submit");
    assert.deepEqual(finding.spec, source.spec);
    assert.deepEqual(run.findings[2].locations, ["Content-Security-Policy", "X-Content-Type-Options"]);
  });

  test("keeps only what the site shows: no report fields it doesn't, and only a headline for findings it doesn't feature", () => {
    const { status, output, data } = extract(["--app", "kennel", "--run", runFolder(), "--feature", "all"]);
    assert.equal(status, 0, output);
    const [run] = data.runs;
    assert.deepEqual(Object.keys(run).sort(), [
      "approved",
      "durationMs",
      "findings",
      "form",
      "planned",
      "runHoundVersion",
      "runId",
      "scenarios",
      "signedIn",
      "startedAt",
      "summary",
      "target",
    ]);
    assert.deepEqual(Object.keys(run.scenarios[1]).sort(), ["checkId", "id", "note", "status", "steps", "title"]);
    const [featured, notFeatured] = run.findings;
    assert.equal(featured.featured, true);
    assert.equal(featured.category, undefined);
    // The second double-submit finding isn't featured: the site can list it, never show its evidence or spec.
    assert.deepEqual(notFeatured, {
      id: "double-submit#double-click-submit-2",
      checkId: "double-submit",
      scenarioId: "double-click-submit",
      featured: false,
      title: 'Double-clicking "Save draft" saves 2 times',
      severity: "high",
      confidence: "confirmed",
      location: '"Save draft" button',
    });
  });

  test("keeps evidence labels, facts, card lines and markers, and drops selectors, viewports and nested data", () => {
    const { status, output, data } = extract(["--app", "kennel", "--run", runFolder(), "--feature", "all"]);
    assert.equal(status, 0, output);
    const [gifEvidence, card, network, dom] = data.runs[0].findings[0].evidence;
    assert.deepEqual(Object.keys(gifEvidence).sort(), ["artifact", "asset", "durationMs", "facts", "frames", "height", "kind", "label", "markers", "step", "width"]);
    assert.deepEqual(gifEvidence.markers, [
      { label: "Saved copy 1", box: { x: 2, y: 1, width: 3, height: 1 } },
      { label: "Saved copy 2", box: { x: 2, y: 2, width: 3, height: 1 } },
    ]);
    assert.equal(card.title, "POST /api/bookings sent 2 times");
    assert.equal(card.subtitle, "http://localhost:3160/api/bookings");
    assert.deepEqual(card.lines, ["> #1  +29.8 ms", ">     ← 201"]);
    assert.deepEqual(network, {
      kind: "network",
      label: "Save request 1: POST http://localhost:3160/api/bookings → 201",
      data: { method: "POST", url: "http://localhost:3160/api/bookings", status: 201, failure: null },
    });
    // A list of selectors is plain strings, but it is the page's DOM paths, which the site never shows.
    assert.deepEqual(dom, { kind: "dom", label: "Clicked and watched", data: { stops: 3 } });
  });

  test("parses the request timings the report printed", () => {
    const { data } = extract(["--app", "kennel", "--run", runFolder(), "--feature", "all"]);
    assert.deepEqual(data.runs[0].findings[0].requests, [
      { label: "Save request 1", method: "POST", path: "/api/bookings", status: 201, atMs: 29.8 },
      { label: "Save request 2", method: "POST", path: "/api/bookings", status: 201, atMs: 30 },
    ]);
    assert.equal(data.runs[0].findings[2].requests, undefined);
  });

  test("features the first confirmed finding of each check and copies only its evidence", () => {
    const { status, output, data, site } = extract(["--app", "kennel", "--run", runFolder(), "--feature", "all"]);
    assert.equal(status, 0, output);
    const [first, second, headers] = data.runs[0].findings;
    assert.equal(first.featured, true);
    assert.equal(second.featured, false);
    assert.equal(headers.featured, true);
    // Copies are named <check id>-<kind>-<n>: short, predictable for a static import, and free of the run's record ids
    // and of the words Run Hound cut from long artifact names.
    assert.equal(first.evidence[0].asset, "assets/runs/0.6.0/kennel/double-submit-gif-1.gif");
    assert.equal(first.evidence[1].asset, "assets/runs/0.6.0/kennel/double-submit-card-1.png");
    assert.equal(first.evidence[0].artifact, "001-double-click-book.gif");
    assert.deepEqual([first.evidence[0].width, first.evidence[0].height], [W, H]);
    assert.equal(second.evidence, undefined);
    assert.equal(headers.evidence[0].asset, "assets/runs/0.6.0/kennel/security-headers-card-1.png");
    assert.deepEqual(readdirSync(join(site, "src/assets/runs/0.6.0/kennel")).sort(), [
      "double-submit-card-1.png",
      "double-submit-gif-1.gif",
      "security-headers-card-1.png",
    ]);
  });

  test("numbers the copies of one kind in the order the finding lists them", () => {
    const data = report();
    data.findings[0].evidence.push({ kind: "card", label: "a second card", path: "003-second.png", data: { title: "t", lines: ["x"] } });
    const { status, output, data: written } = extract(["--app", "kennel", "--run", runFolder(data), "--feature", "all"]);
    assert.equal(status, 0, output);
    const cards = written.runs[0].findings[0].evidence.filter((e) => e.kind === "card");
    assert.deepEqual(
      cards.map((e) => [e.label, e.asset]),
      [
        ["save requests from one double click", "assets/runs/0.6.0/kennel/double-submit-card-1.png"],
        ["a second card", "assets/runs/0.6.0/kennel/double-submit-card-2.png"],
      ],
    );
  });

  test("a named check or finding id picks what is featured", () => {
    const byCheck = extract(["--app", "kennel", "--run", runFolder(), "--feature", "security-headers"]);
    assert.equal(byCheck.status, 0, byCheck.output);
    assert.deepEqual(byCheck.data.runs[0].findings.map((f) => f.featured), [false, false, true]);
    const byId = extract(["--app", "kennel", "--run", runFolder(), "--feature", "double-submit#double-click-submit-2"]);
    assert.equal(byId.status, 0, byId.output);
    assert.deepEqual(byId.data.runs[0].findings.map((f) => f.featured), [false, true, false]);
    const unknown = extract(["--app", "kennel", "--run", runFolder(), "--feature", "csrf"]);
    assert.equal(unknown.status, 1);
    assert.match(unknown.output, /csrf/);
  });

  test("copied GIFs play once: the NETSCAPE2.0 loop extension is removed and every frame is kept, byte for byte", () => {
    const dir = runFolder();
    const { status, output, site } = extract(["--app", "kennel", "--run", dir, "--feature", "all"]);
    assert.equal(status, 0, output);
    const before = readFileSync(join(dir, "artifacts/001-double-click-book.gif"));
    const after = readFileSync(join(site, "src/assets/runs/0.6.0/kennel/double-submit-gif-1.gif"));
    assert.deepEqual(gifBlocks(before), { applications: ["NETSCAPE2.0"], frames: 2 });
    assert.deepEqual(gifBlocks(after), { applications: [], frames: 2 });
    assert.equal(before.length - after.length, 19);
    const at = before.indexOf(Buffer.from("NETSCAPE2.0")) - 3;
    assert.deepEqual(after, Buffer.concat([before.subarray(0, at), before.subarray(at + 19)]));
  });

  test("cuts a crop from a GIF's last frame, pixel for pixel, and records its box", () => {
    const { status, output, data, site } = extract([
      "--app",
      "kennel",
      "--run",
      runFolder(),
      "--feature",
      "all",
      "--crop",
      "double-submit-bookings=001-double-click-book.gif@last:1,1,4,2",
    ]);
    assert.equal(status, 0, output);
    assert.deepEqual(data.crops, [
      {
        id: "double-submit-bookings",
        runId: "20260927-000000-aaaaaa",
        findingId: "double-submit#double-click-submit-1",
        artifact: "001-double-click-book.gif",
        frame: 1,
        source: { width: W, height: H },
        box: { x: 1, y: 1, width: 4, height: 2 },
        // The recording has facts, so Run Hound drew its 360 px facts panel beside the 1280 px page, and scaled the
        // whole frame to the GIF's width: one GIF pixel is 1640 / 6 CSS px of the page here.
        pageWidth: 1280,
        pageScale: Math.round((W / (1280 + 360)) * 10000) / 10000,
        asset: "assets/runs/0.6.0/kennel/double-submit-bookings.png",
        width: 4,
        height: 2,
      },
    ]);
    const image = readPng(readFileSync(join(site, "src/assets/runs/0.6.0/kennel/double-submit-bookings.png")));
    const [white, red, , blue] = PALETTE.map((rgb) => [...rgb, 255]);
    assert.deepEqual(image.rows, [
      [white, red, red, red],
      [white, blue, blue, blue],
    ]);
  });

  test("cuts a crop from a PNG and refuses a box outside the frame or an artifact no featured finding shows", () => {
    const ok = extract(["--app", "kennel", "--run", runFolder(), "--feature", "all", "--crop", "requests=002-save-requests.png@0:0,3,6,1"]);
    assert.equal(ok.status, 0, ok.output);
    const green = [0, 128, 0, 255];
    assert.deepEqual(readPng(readFileSync(join(ok.site, "src/assets/runs/0.6.0/kennel/requests.png"))).rows, [Array(6).fill(green)]);
    // A card is no picture of the page, so it has no page scale.
    assert.deepEqual([ok.data.crops[0].pageWidth, ok.data.crops[0].pageScale], [null, null]);
    const outside = extract(["--app", "kennel", "--run", runFolder(), "--feature", "all", "--crop", "x=001-double-click-book.gif@last:4,2,4,4"]);
    assert.equal(outside.status, 1);
    assert.match(outside.output, /outside/);
    assert.equal(outside.data, null);
    const notShown = extract(["--app", "kennel", "--run", runFolder(), "--feature", "security-headers", "--crop", "x=001-double-click-book.gif@last:0,0,1,1"]);
    assert.equal(notShown.status, 1);
    assert.match(notShown.output, /featured/);
  });

  test("combines several runs of one app, which must share a Run Hound version and all be --app's", () => {
    const a = runFolder(fernwayReport());
    const b = runFolder(fernwayReport({ runId: "20260927-000001-bbbbbb", accounts: { signedInAs: { id: "a", label: "Account A" }, other: { id: "b", label: "Account B" } } }));
    const { status, output, data } = extract(["--app", "fernway", "--run", a, "--run", b, "--feature", "20260927-000001-bbbbbb/security-headers#1"]);
    assert.equal(status, 0, output);
    assert.deepEqual(data.runs.map((r) => r.runId), ["20260927-000000-aaaaaa", "20260927-000001-bbbbbb"]);
    assert.deepEqual(data.runs[1].signedIn, { as: "Account A", other: "Account B" });
    assert.deepEqual(data.runs.map((r) => r.findings.map((f) => f.featured)), [
      [false, false, false],
      [false, false, true],
    ]);
    const mixed = extract(["--app", "fernway", "--run", a, "--run", runFolder(fernwayReport({ runId: "20260927-000002-cccccc", runHoundVersion: "0.5.0" }))]);
    assert.equal(mixed.status, 1);
    assert.match(mixed.output, /0\.5\.0/);
    // A Kennel run among Fernway's: its page's title doesn't name Fernway, so it is refused, by folder, and nothing is
    // written.
    const kennel = runFolder(report({ runId: "20260927-000003-dddddd" }));
    const otherApp = extract(["--app", "fernway", "--run", a, "--run", kennel]);
    assert.equal(otherApp.status, 1, otherApp.output);
    assert.match(otherApp.output, /--app fernway: .*20260927-000003-dddddd.*"Book a sitter · Kennel"/);
    assert.equal(otherApp.data, null);
    // And a run whose page has no title can't show it is --app's.
    const untitled = report();
    untitled.plan.page.title = null;
    const noTitle = extract(["--app", "kennel", "--run", runFolder(untitled)]);
    assert.equal(noTitle.status, 1, noTitle.output);
    assert.match(noTitle.output, /--app kennel: .*null/);
  });

  test("refuses to write a password, token, cookie value or API key, and names where it is", () => {
    // Built at run time, so no secret scanner mistakes this file for one that holds a key.
    const stripe = ["sk", "live", "51Hfakefakefakefakefake00"].join("_");
    const jwt = ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiJmYWtlLXVzZXIifQ", "ZmFrZS1zaWduYXR1cmUtZm9yLXRlc3Rz"].join(".");
    for (const [secret, where] of [
      [`Ask your AI: rotate ${stripe} now`, "fix"],
      [`token ${jwt}`, "meaning"],
      ["Cookie: fernway_session=9f0c2b7e-51b1-4d5e-a0a8-0c1f2e3d4c5b", "impact"],
    ]) {
      const data = report();
      data.findings[0][where] = secret;
      const { status, output, data: written } = extract(["--app", "kennel", "--run", runFolder(data), "--feature", "all"]);
      assert.equal(status, 1, secret);
      assert.match(output, new RegExp(`findings\\[0\\]\\.${where}`), output);
      assert.equal(written, null);
    }
    // Redacted forms are fine.
    const data = report();
    data.findings[0].meaning = 'kennel_session=… (36 chars), apiKey: "[REDACTED:openai-key]", key sk-p…(44 chars)';
    const ok = extract(["--app", "kennel", "--run", runFolder(data), "--feature", "all"]);
    assert.equal(ok.status, 0, ok.output);
  });

  test("fails when an evidence file it must copy is missing", () => {
    const dir = runFolder();
    rmSync(join(dir, "artifacts/002-save-requests.png"));
    const { status, output } = extract(["--app", "kennel", "--run", dir, "--feature", "all"]);
    assert.equal(status, 1);
    assert.match(output, /002-save-requests\.png/);
  });

  test("removes files it wrote before that the new extract no longer references", () => {
    const site = join(root, `site-${++serial}`);
    const first = extract(["--app", "kennel", "--run", runFolder(), "--feature", "all"], { site });
    assert.equal(first.status, 0, first.output);
    const second = extract(["--app", "kennel", "--run", runFolder(), "--feature", "security-headers"], { site });
    assert.equal(second.status, 0, second.output);
    assert.deepEqual(readdirSync(join(site, "src/assets/runs/0.6.0/kennel")), ["security-headers-card-1.png"]);
  });

  test("writes only src/content/runs/<app>-<version>.json and cleans only src/assets/runs/<version>/<app>, for its --app, its runs' app and their version, so a wrong argument deletes nothing", () => {
    // Files other nodes own, another app's extract and evidence, and an older release's evidence: each must be left
    // exactly as it was, and nothing else may appear.
    const seeded = {
      "src/assets/gif-loop.test.ts": "// T1's",
      "src/assets/evidence/still.png": "png",
      "src/content/home.ts": "// G3's",
      "src/content/runs/fernway-0.6.0.json": '{ "app": "fernway" }\n',
      "src/assets/runs/0.6.0/fernway/access-control-card-1.png": "Fernway's",
      "src/assets/runs/0.5.0/kennel/double-submit-gif-1.gif": "0.5.0's",
    };
    const filesIn = (dir) =>
      readdirSync(dir, { recursive: true, encoding: "utf8" })
        .filter((name) => statSync(join(dir, name)).isFile())
        .map((name) => name.split("\\").join("/"))
        .sort();
    // The run is Kennel's, from Run Hound 0.6.0; --out and --assets default to the right paths for --app.
    const attempt = ({ app = "kennel", out = `src/content/runs/${app}-0.6.0.json`, assets = `src/assets/runs/0.6.0/${app}` } = {}) => {
      const site = join(root, `site-${++serial}`);
      const what = `--app ${app} --out ${out} --assets ${assets}`;
      for (const [file, text] of Object.entries(seeded)) {
        mkdirSync(join(site, file, ".."), { recursive: true });
        writeFileSync(join(site, file), text);
      }
      const r = spawnSync(
        process.execPath,
        [script, "--app", app, "--run", runFolder(), "--feature", "all", "--src", join(site, "src"), "--out", join(site, out), "--assets", join(site, assets)],
        { encoding: "utf8", cwd: site },
      );
      for (const [file, text] of Object.entries(seeded)) assert.equal(readFileSync(join(site, file), "utf8"), text, `${what} left ${file}`);
      return { r, what, written: filesIn(site).filter((f) => !(f in seeded)) };
    };
    for (const [option, args] of [
      ["--assets", { assets: "src/assets" }],
      ["--assets", { assets: "src/assets/evidence" }],
      ["--assets", { assets: "src/assets/runs/0.6.0" }],
      ["--assets", { assets: "src/assets/runs/0.6.0/kennel/extra" }],
      ["--assets", { assets: "src/assets/runs/0.6.0/fernway" }],
      ["--assets", { assets: "src/assets/runs/0.5.0/kennel" }],
      ["--out", { out: "src/content/home.ts" }],
      ["--out", { out: "src/content/runs/nested/kennel-0.6.0.json" }],
      ["--out", { out: "src/content/runs/x.json" }],
      ["--out", { out: "src/content/runs/fernway-0.6.0.json" }],
      ["--out", { out: "src/content/runs/kennel-0.5.0.json" }],
      // Kennel's run under --app fernway, with the right paths for Fernway: it would replace Fernway's extract and
      // files with Kennel's.
      ["--app", { app: "fernway" }],
    ]) {
      const { r, what, written } = attempt(args);
      assert.equal(r.status, 1, `${what}: ${r.stdout}${r.stderr}`);
      assert.match(r.stderr, new RegExp(`${option} `), what);
      assert.deepEqual(written, [], `${what} wrote nothing`);
    }
    // The right folders: it writes there, and still leaves every seeded file alone.
    const { r, written } = attempt();
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    assert.deepEqual(written, [
      "src/assets/runs/0.6.0/kennel/double-submit-card-1.png",
      "src/assets/runs/0.6.0/kennel/double-submit-gif-1.gif",
      "src/assets/runs/0.6.0/kennel/security-headers-card-1.png",
      "src/content/runs/kennel-0.6.0.json",
    ]);
  });

  test("names the paths it wants from --src, as seen from where it runs, and takes a relative --src", () => {
    // A site whose sources are in web/src: a refusal names web/src/…, not src/….
    const site = join(root, `site-${++serial}`);
    mkdirSync(join(site, "web/src"), { recursive: true });
    const run = (out, assets) =>
      spawnSync(process.execPath, [script, "--app", "kennel", "--run", runFolder(), "--feature", "all", "--src", "web/src", "--out", out, "--assets", assets], {
        encoding: "utf8",
        cwd: site,
      });
    const wrongAssets = run("web/src/content/runs/kennel-0.6.0.json", "web/src/assets/runs/0.6.0/fernway");
    assert.equal(wrongAssets.status, 1, wrongAssets.stderr);
    assert.match(wrongAssets.stderr, /--assets web\/src\/assets\/runs\/0\.6\.0\/fernway: must be web\/src\/assets\/runs\/0\.6\.0\/kennel /);
    const wrongOut = run("web/src/content/runs/x.json", "web/src/assets/runs/0.6.0/kennel");
    assert.equal(wrongOut.status, 1, wrongOut.stderr);
    assert.match(wrongOut.stderr, /--out web\/src\/content\/runs\/x\.json: must be web\/src\/content\/runs\/kennel-0\.6\.0\.json /);
    assert.deepEqual(readdirSync(join(site, "web/src")), []);
    const ok = run("web/src/content/runs/kennel-0.6.0.json", "web/src/assets/runs/0.6.0/kennel");
    assert.equal(ok.status, 0, ok.stderr);
    assert.ok(existsSync(join(site, "web/src/content/runs/kennel-0.6.0.json")));
    // buildExtract, called with paths relative to the working folder, reads the same targets (and writes nothing).
    const here = (p) => relative(process.cwd(), join(site, p));
    const { extract: built, files } = buildExtract({
      app: "kennel",
      runDirs: [runFolder()],
      srcDir: here("web/src"),
      outFile: here("web/src/content/runs/kennel-0.6.0.json"),
      assetsDir: here("web/src/assets/runs/0.6.0/kennel"),
      features: ["all"],
      crops: [],
      extractedWith: [],
    });
    assert.equal(built.runs[0].findings[0].evidence[0].asset, "assets/runs/0.6.0/kennel/double-submit-gif-1.gif");
    assert.equal(files.size, 3);
    // A hyphen in --app matches a hyphen or a space in the title: "pet-sitter" is "Pet Sitter".
    const petSitter = report({ runId: "20260927-000004-eeeeee" });
    petSitter.plan.page.title = "Book · Pet Sitter";
    const hyphenated = buildExtract({
      app: "pet-sitter",
      runDirs: [runFolder(petSitter)],
      srcDir: here("web/src"),
      outFile: here("web/src/content/runs/pet-sitter-0.6.0.json"),
      assetsDir: here("web/src/assets/runs/0.6.0/pet-sitter"),
      features: [],
      crops: [],
      extractedWith: [],
    });
    assert.equal(hyphenated.extract.app, "pet-sitter");
  });

  test("decodes GIF LZW with dictionary codes, a growing code size and a full table, as encoders write it", () => {
    // 200 x 160: a solid band (runs of one colour, so codes that name the entry being made) over deterministic noise
    // (so the table fills past 4,096 entries and the encoder sends a clear code mid-image).
    const width = 200;
    const height = 160;
    let seed = 7;
    const pixels = Array.from({ length: width * height }, (_, i) => {
      if (i < width * 30) return 2;
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return (seed >> 16) & 3;
    });
    const expected = new Uint8Array(width * height * 4);
    pixels.forEach((p, i) => expected.set([...PALETTE[p], 255], i * 4));
    for (const deferClear of [false, true]) {
      const { bytes, fills, whileFull } = lzwEncode(2, pixels, { deferClear });
      assert.ok(fills >= 1, `the table filled ${fills} times`);
      if (deferClear) assert.ok(whileFull > 1000, `${whileFull} codes were sent with the table full`);
      const decoded = gifFrame(gifWithData(width, height, bytes), 0);
      assert.deepEqual([decoded.width, decoded.height], [width, height]);
      assert.ok(Buffer.from(decoded.rgba).equals(Buffer.from(expected)), `every pixel decoded (deferClear ${deferClear})`);
    }
    const image = gifFrame(gifWithData(width, height, lzwEncode(2, pixels).bytes), 0);
    // And a crop of it is those pixels.
    const cut = cropImage(image, { x: 150, y: 20, width: 40, height: 30 });
    for (let y = 0; y < 30; y++) {
      const row = Buffer.from(cut.rgba.subarray(y * 40 * 4, (y + 1) * 40 * 4));
      const from = ((20 + y) * width + 150) * 4;
      assert.ok(row.equals(Buffer.from(expected.subarray(from, from + 40 * 4))), `crop row ${y}`);
    }
  });

  test("refuses GIF data that ends before the frame is complete, instead of padding the frame", () => {
    const width = 40;
    const height = 30;
    const pixels = Array.from({ length: width * height }, (_, i) => (i * 7 + (i >> 3)) & 3);
    const { bytes } = lzwEncode(2, pixels);
    assert.equal(gifFrame(gifWithData(width, height, bytes), 0).rgba.length, width * height * 4);
    // The data runs out, with no end code: a file cut short.
    assert.throws(() => gifFrame(gifWithData(width, height, bytes.slice(0, Math.floor(bytes.length / 2))), 0), /truncated GIF data: \d+ of 1200 pixels/);
    // The end code comes after half the pixels: an encoder that stopped early.
    assert.throws(() => gifFrame(gifWithData(width, height, lzwEncode(2, pixels.slice(0, 600)).bytes), 0), /the end code came after 600 of 1200 pixels/);
    // And the extractor exits 1 on a crop of such a GIF, writing nothing.
    const dir = runFolder();
    const cut = lzwEncode(2, frame2).bytes;
    writeFileSync(join(dir, "artifacts/001-double-click-book.gif"), gifWithData(W, H, cut.slice(0, cut.length - 4)));
    const { status, output, data } = extract(["--app", "kennel", "--run", dir, "--feature", "all", "--crop", "c=001-double-click-book.gif@last:1,1,4,2"]);
    assert.equal(status, 1, output);
    assert.match(output, /truncated GIF data: \d+ of 24 pixels/);
    assert.equal(data, null);
  });

  test("records how it was run, with paths relative to the site", () => {
    const site = join(root, `site-${++serial}`);
    const dir = runFolder();
    const { data } = extract(["--app", "kennel", "--run", dir, "--feature", "all"], { site });
    assert.equal(data.extractedWith[0], "scripts/extract-run.mjs");
    for (const arg of data.extractedWith) assert.ok(!arg.startsWith("/"), arg);
    assert.ok(data.extractedWith.includes("src/assets/runs/0.6.0/kennel"));
  });

  test("explains its usage when an option is missing", () => {
    const r = spawnSync(process.execPath, [script, "--app", "kennel"], { encoding: "utf8" });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /Usage/);
  });
});
