// Tests for the run extracts, content/runs/{kennel,fernway}-0.6.0.json (`pnpm test`, node:test). The site shows real
// evidence only (brand.md, DESIGN.md §5.1 rule 8): the hero run, the evidence trio and every check page take their
// values, texts, frames and Playwright tests from these extracts, which scripts/extract-run.mjs made from real Run Hound
// 0.6.0 runs: Kennel for the 20 signed-out checks, Fernway (from source, on localhost, signed in as test accounts A and
// B) for the 6 signed-in ones. The run folders stay out of the repository; the extracts and the copied frames are all
// that ships. This file compares them with ../app (the check ids, the evidence frame layout, the fake passwords Run
// Hound types), ../fixtures (the planted secrets and the test accounts' passwords) and ../TESTING.md, and checks that
// git's ignore rules don't catch the files, so it runs in `pnpm test` on a full checkout, never in the build.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { cropImage, gifFrame, pngImage, secretsIn } from "../../../scripts/extract-run.mjs";

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Evidence {
  kind: string;
  label: string;
  step?: string;
  facts?: { label: string; value: string }[];
  title?: string;
  subtitle?: string;
  firstLineNumber?: number;
  lines?: string[];
  frames?: number;
  durationMs?: number;
  markers?: { label: string; box: Box }[];
  data?: Record<string, unknown>;
  artifact?: string;
  asset?: string | null;
  width?: number;
  height?: number;
}

interface Request {
  label: string;
  method: string;
  path: string;
  status: number;
  atMs: number;
}

/** A finding. One the site features has everything below; any other has only its headline (id to location). */
interface Finding {
  id: string;
  checkId: string;
  scenarioId: string;
  featured: boolean;
  title: string;
  severity: string;
  confidence: string;
  location?: string;
  meaning?: string;
  impact?: string;
  fix?: string;
  locations?: string[];
  scope?: string;
  spec?: { filename: string; source: string };
  requests?: Request[];
  evidence?: Evidence[];
}

interface Scenario {
  id: string;
  checkId: string;
  title: string;
  status: string;
  note?: string;
  steps: string[];
}

interface Run {
  runId: string;
  runHoundVersion: string;
  target: string;
  startedAt: string;
  durationMs: number;
  signedIn: { as: string; other: string | null } | null;
  form: { name: string; fieldCount: number; fields: { label: string | null; type: string }[] } | null;
  planned: number;
  approved: number;
  summary: Record<string, number>;
  scenarios: Scenario[];
  findings: Finding[];
}

interface Crop {
  id: string;
  runId: string;
  findingId: string;
  artifact: string;
  frame: number;
  source: { width: number; height: number };
  box: Box;
  /** The page's width in CSS px, and GIF pixels per CSS px of it; null when the picture isn't of the page (a card). */
  pageWidth: number | null;
  pageScale: number | null;
  asset: string;
  width: number;
  height: number;
}

interface Extract {
  runHoundVersion: string;
  app: string;
  extractedWith: string[];
  runs: Run[];
  crops: Crop[];
}

const here = new URL("./", import.meta.url);
const src = new URL("../../", import.meta.url);
const site = new URL("../../../", import.meta.url);
const repo = new URL("../../../../", import.meta.url);

/** The Kennel run DESIGN.md §3.1 names: Run Hound 0.6.0, 20 scenarios, 56,828 ms. The extract's first Kennel run. */
const KENNEL_RUN = "20260927-153524-2d830d";

/**
 * Kennel runs after KENNEL_RUN that captured one check again on the same page, each with the maintainer's decision and
 * reason. Such a run features its check's finding; KENNEL_RUN keeps its own finding of that check as a headline only.
 * A new entry needs the maintainer's approval.
 */
const recaptures: Record<string, string> = {
  "20260928-114630-d50ea1":
    "Approved by the maintainer on 2026-09-28: verbose-errors captured again, on its own, from Kennel's container " +
    "image (ghcr.io/rahul-bharati/run-hound-kennel:0.5.0, whose server is unchanged in 0.6.0) with KENNEL_BUGS=all " +
    "on the same 127.0.0.1:3160, so its 500 stack trace names /kennel/server/index.mjs instead of the home folder " +
    "KENNEL_RUN served Kennel from; the evidence stays real and shows no personal folder",
};

/**
 * Built-in checks with no finding in either extract, each with the reason (DESIGN.md §5.4 R1). Empty: the Kennel run
 * found all 20 signed-out checks and the Fernway runs all 6 signed-in ones. A new entry needs the maintainer's approval.
 */
const noEvidence: Record<string, string> = {};

/**
 * Fernway runs that approved only some of their page's scenarios, each with the reason. Every other run approved every
 * planned scenario, signed in as Account A with Account B. A new entry needs the maintainer's approval.
 */
const partialRuns: Record<string, string> = {
  "20260927-185749-edbe4d":
    "Approved by the maintainer on 2026-09-28: paywall-trust on its own on /app/settings, as TESTING.md step 8 " +
    "prescribes, because a full run's other checks change Account A's email (axe-states and pii-leak) and " +
    "deep-links opens /app/upgraded; it needs no Account B, so B didn't sign in",
};

/**
 * Findings whose extract holds a local absolute path (a home folder), keyed "<run id>/<finding id>", each with the
 * maintainer's decision and reason. The copied images can't be scanned for text, so the entry must also say which
 * image shows the path: this list is the only record of it. Empty: the one entry, KENNEL_RUN's verbose-errors stack
 * trace (a home folder in its card and network excerpt), was captured again from Kennel's container (recaptures).
 */
const localPaths: Record<string, string> = {};
const LOCAL_PATH = /(?:file:\/\/)?\/(?:home|Users)\/[^/\s]+\/|[A-Za-z]:[\\/]Users[\\/]/;

function load(name: string): Extract {
  const file = new URL(name, here);
  assert.ok(existsSync(file), `${name} exists (made by scripts/extract-run.mjs)`);
  return JSON.parse(readFileSync(file, "utf8")) as Extract;
}

/** The ids of an `export const NAME = [ … ]` list in app/src/core/types.ts. */
function idList(name: string): string[] {
  const types = readFileSync(new URL("app/src/core/types.ts", repo), "utf8");
  const body = new RegExp(`export const ${name}(?::[^=]+)? = \\[([\\s\\S]*?)\\]`).exec(types)?.[1];
  assert.ok(body, `${name} in app/src/core/types.ts`);
  return [...body.replace(/\/\/.*$/gm, "").matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1]);
}

/** The 26 built-in checks: CHECK_IDS without the optional AI flow (it plans nothing itself). */
const builtIn = idList("CHECK_IDS").filter((id) => id !== "ai-flow");
/** The 6 checks that need test accounts. */
const signedIn = idList("V2_CHECK_IDS");

const kennel = () => load("kennel-0.6.0.json");
const fernway = () => load("fernway-0.6.0.json");
const both = () => [kennel(), fernway()];
const findingsOf = (e: Extract) => e.runs.flatMap((r) => r.findings);
const evidenceOf = (e: Extract) => findingsOf(e).flatMap((f) => f.evidence ?? []);

/** Every string anywhere in a value, with its JSON path. */
function strings(value: unknown, path = "$"): [string, string][] {
  if (typeof value === "string") return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((v, i) => strings(v, `${path}[${i}]`));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => strings(v, `${path}.${k}`));
  return [];
}

/** Width and height from a PNG's IHDR or a GIF's logical screen descriptor. */
function imageSize(bytes: Buffer): { width: number; height: number } {
  if (bytes.subarray(1, 4).toString("latin1") === "PNG") return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  if (bytes.subarray(0, 3).toString("latin1") === "GIF") return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
  throw new Error("not a PNG or GIF");
}

/** A GIF's application extensions (NETSCAPE2.0 makes it loop) and its frame count, from a walk of its blocks. */
function gifBlocks(bytes: Buffer): { applications: string[]; frames: number } {
  let at = 13;
  const flags = bytes[10];
  if (flags & 0x80) at += 3 * 2 ** ((flags & 7) + 1);
  const skipSubBlocks = () => {
    while (bytes[at] !== 0) at += bytes[at] + 1;
    at += 1;
  };
  const applications: string[] = [];
  let frames = 0;
  while (at < bytes.length) {
    const introducer = bytes[at];
    if (introducer === 0x3b) return { applications, frames };
    if (introducer === 0x21) {
      const label = bytes[at + 1];
      at += 2;
      if (label === 0xff) applications.push(bytes.subarray(at + 1, at + 1 + bytes[at]).toString("latin1"));
      skipSubBlocks();
    } else if (introducer === 0x2c) {
      frames += 1;
      const local = bytes[at + 9];
      at += 10;
      if (local & 0x80) at += 3 * 2 ** ((local & 7) + 1);
      at += 1; // LZW minimum code size
      skipSubBlocks();
    } else throw new Error(`unexpected GIF block 0x${introducer.toString(16)} at ${at}`);
  }
  throw new Error("GIF has no trailer");
}

const contains = (outer: Box, inner: Box) =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height;

describe("the run extracts", () => {
  test("both come from Run Hound 0.6.0", () => {
    for (const extract of both()) {
      assert.equal(extract.runHoundVersion, "0.6.0", extract.app);
      assert.ok(extract.runs.length > 0, `${extract.app} has a run`);
      for (const run of extract.runs) assert.equal(run.runHoundVersion, "0.6.0", `${extract.app} ${run.runId}`);
    }
    assert.deepEqual(both().map((e) => e.app), ["kennel", "fernway"]);
  });

  test("the Kennel extract is the run DESIGN.md names, every scenario approved, then only the documented recaptures", () => {
    const { runs } = kennel();
    const [run, ...others] = runs;
    assert.deepEqual(others.map((r) => r.runId), Object.keys(recaptures));
    for (const other of others) {
      // The same page, planned the same way, with only the recaptured check approved; its finding is the featured one.
      assert.equal(other.target, "http://localhost:3160/book", other.runId);
      assert.equal(other.planned, 20, other.runId);
      assert.ok(other.approved < other.planned, `${other.runId} approved only the check it captured again`);
      const checks = [...new Set(other.scenarios.map((s) => s.checkId))];
      assert.equal(other.approved, other.scenarios.length, other.runId);
      for (const checkId of checks) {
        assert.ok(other.findings.some((f) => f.checkId === checkId && f.featured), `${other.runId} features ${checkId}`);
        assert.ok(!run.findings.some((f) => f.checkId === checkId && f.featured), `${KENNEL_RUN} no longer features ${checkId}`);
      }
    }
    assert.equal(run.runId, KENNEL_RUN);
    assert.equal(run.target, "http://localhost:3160/book");
    assert.equal(run.durationMs, 56828);
    assert.equal(run.planned, 20);
    assert.equal(run.approved, 20);
    assert.equal(run.scenarios.length, 20);
    assert.equal(run.form?.name, "Book a sitter");
    assert.equal(run.form?.fieldCount, 9);
    assert.equal(run.form?.fields.length, 9);
    assert.equal(run.signedIn, null);
  });

  test("the Fernway runs are signed in as A with B, on localhost, and approve every scenario but the documented ones", () => {
    const { runs } = fernway();
    const pages = new Set<string>();
    for (const run of runs) {
      const target = new URL(run.target);
      // csrf's page on another site is served from 127.0.0.1, so only a target on localhost makes it conclusive.
      assert.equal(target.hostname, "localhost", run.runId);
      assert.equal(run.signedIn?.as, "Account A", run.runId);
      if (partialRuns[run.runId]) {
        assert.ok(run.approved < run.planned, `${run.runId} is listed as partial, so it must be`);
        continue;
      }
      assert.equal(run.approved, run.planned, `${run.runId} approved every planned scenario`);
      assert.equal(run.signedIn?.other, "Account B", run.runId);
      pages.add(target.pathname);
    }
    assert.deepEqual([...pages].sort(), ["/app", "/app/settings"]);
    for (const id of Object.keys(partialRuns)) assert.ok(runs.some((r) => r.runId === id), `${id} is a run of the extract`);
  });

  test("the partial paywall-trust run is the one TESTING.md prescribes: paywall-trust alone on /app/settings", () => {
    const testing = readFileSync(new URL("TESTING.md", repo), "utf8");
    const step = testing.split("\n").find((line) => line.startsWith("8. **Paywall trust**"));
    assert.ok(step, "TESTING.md still has its Paywall trust step (8)");
    assert.match(step, /\/app\/settings` as Account A and run `paywall-trust` \*\*on its own\*\*/);
    const run = fernway().runs.find((r) => r.runId === "20260927-185749-edbe4d");
    assert.ok(run);
    assert.equal(new URL(run.target).pathname, "/app/settings");
    assert.equal(run.approved, 1);
    assert.deepEqual(run.scenarios.map((s) => s.checkId), ["paywall-trust"]);
  });

  test("every built-in check has a finding, or sits in noEvidence with a reason", () => {
    assert.equal(builtIn.length, 26);
    const found = new Set(both().flatMap(findingsOf).map((f) => f.checkId));
    const missing = builtIn.filter((id) => !found.has(id) && !noEvidence[id]?.trim());
    assert.deepEqual(missing, []);
    for (const id of Object.keys(noEvidence)) {
      assert.ok(builtIn.includes(id), `${id} in noEvidence is a built-in check`);
      assert.ok(!found.has(id), `${id} has a finding now, so it leaves noEvidence`);
    }
  });

  // Every entry is decided (the maintainer, 2026-09-28). A new pending one fails here; while it waits, the test may take
  // a todo option again, which shows as "todo 1" in `pnpm test` without failing it, and the release gate needs todo 0.
  test("every noEvidence, partialRuns, recaptures and localPaths entry carries the maintainer's decision", () => {
    for (const [key, reason] of Object.entries({ ...noEvidence, ...partialRuns, ...recaptures, ...localPaths })) {
      assert.ok(reason.trim(), `${key} has a reason`);
      assert.doesNotMatch(reason, /^Awaiting/, key);
    }
  });

  test("each check has one featured finding: signed-out checks from Kennel, signed-in ones from Fernway", () => {
    assert.equal(signedIn.length, 6);
    for (const id of builtIn) {
      if (noEvidence[id]) continue;
      const where = both().flatMap((e) => findingsOf(e).filter((f) => f.featured && f.checkId === id).map(() => e.app));
      assert.deepEqual(where, [signedIn.includes(id) ? "fernway" : "kennel"], id);
    }
    for (const finding of both().flatMap(findingsOf)) {
      assert.ok(builtIn.includes(finding.checkId), `${finding.id} is a built-in check's`);
      if (finding.featured) {
        assert.ok(finding.evidence?.some((e) => e.asset), `${finding.id} has its evidence copied`);
        assert.equal(finding.confidence, "confirmed", finding.id);
      } else assert.equal(finding.evidence, undefined, `${finding.id} isn't featured, so none of its evidence is kept`);
    }
  });

  test("the double-submit requests are +29.8 ms and +30.0 ms, 0.2 ms apart", () => {
    const finding = findingsOf(kennel()).find((f) => f.featured && f.checkId === "double-submit");
    assert.ok(finding);
    assert.equal(finding.title, 'Double-clicking "Book" saves 2 times');
    const requests = finding.requests ?? [];
    assert.deepEqual(
      requests.map((r) => [r.method, r.path, r.status, r.atMs]),
      [
        ["POST", "/api/bookings", 201, 29.8],
        ["POST", "/api/bookings", 201, 30.0],
      ],
    );
    assert.equal(Math.round((requests[1].atMs - requests[0].atMs) * 10) / 10, 0.2);
    // The parsed numbers are the ones the report printed.
    const printed = (finding.evidence ?? []).flatMap((e) => (e.facts ?? []).map((f) => f.value));
    assert.ok(printed.some((v) => v.includes("→ 201 at +29.8 ms")));
    assert.ok(printed.some((v) => v.includes("→ 201 at +30.0 ms")));
  });

  test("each finding belongs to its own failed scenario, and a featured one carries its texts and spec", () => {
    for (const extract of both()) {
      for (const run of extract.runs) {
        for (const finding of run.findings) {
          const scenario = run.scenarios.find((s) => s.id === finding.scenarioId);
          assert.ok(scenario, `${finding.id}: scenario ${finding.scenarioId} is in run ${run.runId}`);
          assert.equal(scenario.checkId, finding.checkId, finding.id);
          assert.equal(scenario.status, "fail", finding.id);
          assert.ok(scenario.steps.length > 0, `${scenario.id} has its steps`);
          assert.ok(finding.title.trim(), finding.id);
          if (!finding.featured) continue;
          assert.ok(finding.spec, `${finding.id} has its spec`);
          assert.match(finding.spec.filename, /^[a-z0-9-]+\.spec\.ts$/, finding.id);
          assert.match(finding.spec.source, /^import \{ test, expect[^}]*\} from "@playwright\/test";\n/, finding.id);
          for (const text of [finding.meaning, finding.impact, finding.fix]) assert.ok(text?.trim(), finding.id);
        }
      }
    }
  });
});

describe("the copied evidence", () => {
  const assets = () =>
    both().flatMap((e) => [
      ...evidenceOf(e).filter((v) => v.asset).map((v) => ({ asset: v.asset!, width: v.width, height: v.height })),
      ...e.crops.map((c) => ({ asset: c.asset, width: c.width, height: c.height })),
    ]);

  test("every asset path exists under assets/runs/0.6.0/ with the size the extract records", () => {
    assert.ok(assets().length > 0);
    for (const { asset, width, height } of assets()) {
      assert.match(asset, /^assets\/runs\/0\.6\.0\/(kennel|fernway)\/[a-z0-9-]+\.(png|gif)$/, asset);
      const file = new URL(asset, src);
      assert.ok(existsSync(file), `${asset} exists`);
      assert.deepEqual(imageSize(readFileSync(file)), { width, height }, asset);
    }
  });

  test("each copy is named <check id>-<kind>-<n>, each crop <crop id>, with no record id in a name", () => {
    for (const extract of both()) {
      for (const finding of findingsOf(extract).filter((f) => f.featured)) {
        const count = new Map<string, number>();
        for (const evidence of (finding.evidence ?? []).filter((e) => e.asset)) {
          const n = (count.get(evidence.kind) ?? 0) + 1;
          count.set(evidence.kind, n);
          const ext = evidence.artifact?.toLowerCase().endsWith(".gif") ? "gif" : "png";
          assert.equal(evidence.asset, `assets/runs/0.6.0/${extract.app}/${finding.checkId}-${evidence.kind}-${n}.${ext}`, evidence.label);
        }
      }
      for (const crop of extract.crops) assert.equal(crop.asset, `assets/runs/0.6.0/${extract.app}/${crop.id}.png`);
    }
    for (const { asset } of assets()) assert.doesNotMatch(asset, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/, asset);
  });

  test("nothing in assets/runs/0.6.0/ is left unreferenced", () => {
    const referenced = new Set(assets().map((a) => a.asset));
    const folder = new URL("assets/runs/0.6.0/", src);
    const onDisk = readdirSync(folder, { recursive: true, encoding: "utf8" })
      .filter((name) => statSync(new URL(name, folder)).isFile())
      .map((name) => `assets/runs/0.6.0/${name.split("\\").join("/")}`);
    assert.deepEqual(onDisk.filter((name) => !referenced.has(name)), []);
  });

  test("git doesn't ignore the extracts, this test or any copied file (the root .gitignore ignores every runs/ folder)", () => {
    const files = [
      "src/content/runs/kennel-0.6.0.json",
      "src/content/runs/fernway-0.6.0.json",
      "src/content/runs/runs.test.ts",
      ...assets().map((a) => `src/${a.asset}`),
    ];
    // --no-index: judge by the ignore rules alone, so the test still holds once the files are committed.
    const r = spawnSync("git", ["check-ignore", "--no-index", "--", ...files], { cwd: fileURLToPath(site), encoding: "utf8" });
    const rules = r.status === 0 ? spawnSync("git", ["check-ignore", "--no-index", "-v", "--", ...files], { cwd: fileURLToPath(site), encoding: "utf8" }).stdout : "";
    assert.equal(r.status, 1, `git ignores ${r.stdout.split("\n").filter(Boolean).length} of them:\n${rules}${r.stderr}`);
  });

  test("the GIFs play once and rest on their last frame", () => {
    const gifs = assets().filter((a) => a.asset.endsWith(".gif"));
    assert.ok(gifs.length > 0);
    for (const { asset } of gifs) {
      const { applications, frames } = gifBlocks(readFileSync(new URL(asset, src)));
      assert.ok(!applications.some((a) => a.startsWith("NETSCAPE2.0") || a.startsWith("ANIMEXTS1.0")), `${asset} has no loop extension`);
      assert.ok(frames > 1, `${asset} is still animated`);
    }
  });

  test("the bookings crop is a real crop of the double-submit frame, both saved copies and their markers in it", () => {
    const { crops, runs } = kennel();
    const crop = crops.find((c) => c.id === "double-submit-bookings");
    assert.ok(crop);
    const finding = runs[0].findings.find((f) => f.id === crop.findingId);
    assert.ok(finding?.featured && finding.checkId === "double-submit");
    const frame = finding.evidence?.find((e) => e.artifact === crop.artifact);
    assert.ok(frame && frame.kind === "gif", "the crop is cut from the finding's own recording");
    assert.equal(crop.frame, (frame.frames ?? 0) - 1, "from its last frame, the proof");
    assert.deepEqual(crop.source, { width: frame.width, height: frame.height });
    assert.ok(contains({ x: 0, y: 0, ...crop.source }, crop.box), "the box is inside the frame");
    assert.deepEqual({ width: crop.width, height: crop.height }, { width: crop.box.width, height: crop.box.height }, "not scaled");
    const saved = (frame.markers ?? []).filter((m) => /^Saved copy [12]$/.test(m.label));
    assert.equal(saved.length, 2);
    for (const marker of saved) assert.ok(contains(crop.box, marker.box), `${marker.label} is in the crop`);
  });

  test("the bookings crop's pixels are the box of the copied GIF's last frame", () => {
    const { crops, runs } = kennel();
    const crop = crops.find((c) => c.id === "double-submit-bookings");
    assert.ok(crop);
    const gif = runs[0].findings.find((f) => f.id === crop.findingId)?.evidence?.find((e) => e.artifact === crop.artifact);
    assert.ok(gif?.asset);
    const cut = cropImage(gifFrame(readFileSync(new URL(gif.asset, src)), crop.frame), crop.box);
    const png = pngImage(readFileSync(new URL(crop.asset, src)));
    assert.deepEqual([png.width, png.height], [crop.box.width, crop.box.height]);
    assert.ok(Buffer.from(png.rgba).equals(Buffer.from(cut.rgba)), "pixel for pixel");
  });

  test("the bookings crop records the page's scale, as Run Hound's evidence frame layout gives it", () => {
    // Run Hound draws a recording's frames as the page plus its facts panel, and scales them down to fit the GIF's
    // maximum width (app/src/engine/evidence.ts FRAME and gifScale), so the crop is smaller than the page it shows.
    const evidence = readFileSync(new URL("app/src/engine/evidence.ts", repo), "utf8");
    const factsWidth = Number(/\bfactsWidth:\s*(\d+)/.exec(evidence)?.[1]);
    const gifMaxWidth = Number(/\bgifMaxWidth:\s*(\d+)/.exec(evidence)?.[1]);
    assert.ok(factsWidth > 0 && gifMaxWidth > 0, "FRAME.factsWidth and FRAME.gifMaxWidth in evidence.ts");
    const crop = kennel().crops.find((c) => c.id === "double-submit-bookings");
    assert.ok(crop?.pageWidth && crop.pageScale);
    assert.equal(crop.pageWidth, 1280);
    const composed = crop.pageWidth + factsWidth;
    const scale = Math.min(1, gifMaxWidth / composed);
    assert.equal(crop.source.width, Math.round(composed * scale));
    assert.equal(crop.pageScale, Math.round(scale * 10000) / 10000);
    assert.ok(crop.pageScale < 1, "one crop pixel is more than one CSS px of the page");
    // And the frame itself agrees: below the header strip, the facts panel's left border is one straight column where
    // the scaled page ends (x 937 of 1200), a colour the page's last column hardly has.
    const headerHeight = Number(/\bheaderHeight:\s*(\d+)/.exec(evidence)?.[1]);
    const gif = kennel().runs[0].findings.find((f) => f.id === crop.findingId)?.evidence?.find((e) => e.artifact === crop.artifact);
    assert.ok(headerHeight > 0 && gif?.asset);
    const frame = gifFrame(readFileSync(new URL(gif.asset, src)), crop.frame);
    const column = (x: number) => {
      const colours = new Map<string, number>();
      for (let y = Math.ceil(headerHeight * scale) + 1; y < frame.height; y++) {
        const colour = Array.from(frame.rgba.subarray((y * frame.width + x) * 4, (y * frame.width + x) * 4 + 3)).join(",");
        colours.set(colour, (colours.get(colour) ?? 0) + 1);
      }
      const rows = frame.height - Math.ceil(headerHeight * scale) - 1;
      return { rows, colours, top: [...colours.entries()].sort((a, b) => b[1] - a[1])[0] };
    };
    const edge = Math.round(crop.pageWidth * crop.pageScale);
    assert.ok(edge > 0 && edge < frame.width, `the page ends inside the frame, at x ${edge}`);
    const border = column(edge);
    assert.ok(border.top[1] / border.rows >= 0.95, `column ${edge} is the panel's border: ${border.top[1]} of ${border.rows} rows are ${border.top[0]}`);
    const page = column(edge - 1);
    assert.ok((page.colours.get(border.top[0]) ?? 0) / page.rows < 0.05, `column ${edge - 1} is still the page`);
  });
});

describe("no secrets and no local paths", () => {
  /** The test accounts' passwords, from Fernway's seed (the only place they live besides the docs). */
  const passwords = [
    ...readFileSync(new URL("fixtures/fernway/server/seed.mjs", repo), "utf8").matchAll(/password: "([^"]+)"/g),
  ].map((m) => m[1]);
  /** Kennel's planted fake keys (S01, S02), exactly as its server serves them. */
  const planted = ["ai-client.js", "supabase-client.js"].flatMap((file) => [
    ...readFileSync(new URL(`fixtures/kennel/server/secrets/${file}`, repo), "utf8").matchAll(/(?:apiKey|key): "([^"]+)"/g),
  ].map((m) => m[1]));

  /**
   * Values shaped like live credentials. Redacted forms ("sk-p…(44 chars)", "[REDACTED:…]", "=… (36 chars)") pass.
   * Kept separate from the extractor's SECRET_PATTERNS on purpose: this test must not trust the script it checks. The
   * test runs the script's own secretsIn too, so a pattern added there is enforced on the committed extracts as well.
   */
  const patterns: [string, RegExp][] = [
    ["an OpenAI-style key", /\bsk-(?:proj-|live-)?[A-Za-z0-9_-]{16,}/],
    ["a Stripe key", /\b[sr]k_(?:live|test)_[A-Za-z0-9]{8,}/],
    ["a JWT", /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
    ["an AWS access key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
    ["a GitHub token", /\bgh[pousr]_[A-Za-z0-9]{30,}/],
    ["a Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
    ["a Google API key", /\bAIza[0-9A-Za-z_-]{35}/],
    ["a private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
    // A cookie or query parameter named for a session (fernway_session=, connect.sid=, auth_token=) with a value.
    [
      "a session cookie value",
      /(?:^|[^A-Za-z0-9])(?:[A-Za-z0-9]*[_.-])?(?:session|sessionid|sid|token|auth|jwt)(?:[_.-][A-Za-z0-9]*)*=(?!…|\[)[^\s;,"'…]{8,}/i,
    ],
    ["a bearer token", /\bBearer\s+(?!…|\[)[A-Za-z0-9._~+/-]{16,}/],
    ["a credential in JSON", /"(?:password|passwd|secret|token|access_token|refresh_token|api_?key|client_secret)"\s*:\s*"(?!\[REDACTED|…|\s*")[^"]{6,}"/i],
  ];

  /**
   * The passwords Run Hound itself types, and so the only ones a featured spec may hold: functional-form's
   * `Fake-Passw0rd-${tag}!` (the tag is the run token, 8 hex digits, then the check's salt word, then "f<n>" on a page's
   * nth form) and a11y-form's canary `Rh-${token}-Passw0rd!`. A test account's password comes from process.env.
   */
  const FAKE_PASSWORD = /^(?:Fake-Passw0rd-[0-9a-f]{8}[a-z]*(?:f\d+)?|Rh-[0-9a-f]{8}-Passw0rd)!$/;
  const FROM_ENV = /^process\.env(?:\.[A-Za-z_][A-Za-z0-9_]*|\[[^\]]+\])!?$/;

  /** A string literal's text, or null when the argument isn't a plain literal. */
  function literal(arg: string): string | null {
    if (/^"(?:[^"\\]|\\.)*"$/.test(arg)) {
      try {
        return JSON.parse(arg) as string;
      } catch {
        return null;
      }
    }
    if (/^'(?:[^'\\]|\\.)*'$/.test(arg)) return arg.slice(1, -1).replace(/\\(.)/g, "$1");
    if (/^`[^`$]*`$/.test(arg)) return arg.slice(1, -1);
    return null;
  }

  /** One argument of a call: a string literal, or anything up to the next comma or closing parenthesis. */
  const ARG = String.raw`"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\`[^\`]*\`|[^,)]*`;
  const TYPING = new RegExp(String.raw`\.(?:fill|type|pressSequentially)\(\s*(${ARG})\s*(?:,\s*(${ARG}))?`, "g");

  /**
   * What a spec types into a password field, and whether it is allowed (Run Hound's fake or process.env). A password
   * field is a statement whose locator or variable before .fill, .type or .pressSequentially names a password
   * (getByLabel("Password"), "Confirm password", input[type="password"], #password, a `password` locator), or, in the
   * page.fill(selector, value) form, whose selector does. A value may also be a const the spec set from process.env.
   */
  function passwordFills(source: string): { field: string; value: string; ok: boolean }[] {
    const fills: { field: string; value: string; ok: boolean }[] = [];
    for (const statement of source.split(/;[ \t]*\n/)) {
      for (const m of statement.matchAll(TYPING)) {
        let field = statement.slice(0, m.index).trim();
        let value = m[1].trim();
        const second = m[2]?.trim();
        // locator.fill(value, { options }) has an options object second; page.fill(selector, value) has the value.
        if (second && !second.startsWith("{")) [field, value] = [`${field} ${value}`, second];
        if (!value || !/password/i.test(field)) continue;
        const text = literal(value);
        const constant = /^[A-Za-z_]\w*$/.test(value) ? new RegExp(String.raw`\bconst ${value}\s*=\s*([^;\n]+)`).exec(source)?.[1].trim() : undefined;
        const ok = FROM_ENV.test(value) || FROM_ENV.test(constant ?? "") || (text !== null && FAKE_PASSWORD.test(text));
        fills.push({ field: field.slice(-80), value, ok });
      }
    }
    return fills;
  }

  test("the fixtures still define what this test looks for", () => {
    assert.deepEqual(passwords.length, 2);
    assert.equal(planted.length, 2);
  });

  test("no string in either extract is a password, token, cookie value or API key", () => {
    for (const extract of both()) {
      for (const [path, value] of strings(extract)) {
        for (const secret of [...passwords, ...planted]) assert.ok(!value.includes(secret), `${extract.app} ${path} holds a known secret`);
        for (const [name, pattern] of patterns) assert.ok(!pattern.test(value), `${extract.app} ${path} holds ${name}: ${value.slice(0, 120)}`);
      }
      assert.deepEqual(secretsIn(extract), [], `${extract.app}: the extractor's own patterns`);
    }
  });

  test("the password check tells Run Hound's fakes and process.env from any other password", () => {
    // Each password field typed into, allowed (true) or not (false); a field that isn't a password isn't listed.
    const verdicts = (line: string) => passwordFills(`${line};\n`).map((f) => f.ok);
    for (const [line, expected] of [
      ['await page.getByLabel("Password", { exact: true }).fill("Fake-Passw0rd-6d779656twice!")', [true]],
      ['await page.getByLabel("Confirm password", { exact: true }).fill("Fake-Passw0rd-6d779656twicef2!", { timeout: 5_000 })', [true]],
      ["await page.locator('#password').fill('Rh-6d779656-Passw0rd!')", [true]],
      ["await password.fill(process.env.RUNHOUND_ACCOUNT_A_PASSWORD!)", [true]],
      ['const secret = process.env["RUNHOUND_ACCOUNT_" + slot + "_PASSWORD"]!;\nawait page.getByLabel("Password").fill(secret)', [true]],
      ['const secret = "correct-horse-battery";\nawait page.getByLabel("Password").fill(secret)', [false]],
      ['await page.getByLabel("Password").fill("correct-horse-battery")', [false]],
      ["await page.locator('input[type=\"password\"]').first().fill('Summer2026!')", [false]],
      ['await page.locator("#password").pressSequentially(secret)', [false]],
      ['await page.fill("#password", "correct-horse-battery")', [false]],
      ['await page.getByLabel("Password").fill(`Fake-Passw0rd-${tag}!`)', [false]],
      ['await page.getByLabel("Password").fill("Fake-Passw0rd-6d779656twice! and more")', [false]],
      ['await page.getByLabel("Pet name", { exact: true }).fill("correct-horse-battery")', []],
    ] as [string, boolean[]][]) {
      assert.deepEqual(verdicts(line), expected, line);
    }
  });

  test("every password a featured spec types is Run Hound's own fake or read from process.env", () => {
    // Run Hound still generates the fakes FAKE_PASSWORD allows, with an 8-hex-digit run token.
    const app = (file: string) => readFileSync(new URL(`app/src/${file}`, repo), "utf8");
    assert.ok(app("checks/lib/functional-form.ts").includes("`Fake-Passw0rd-${tag}!`"), "functional-form's fake password");
    assert.ok(app("checks/lib/a11y-form.ts").includes("`Rh-${token}-Passw0rd!`"), "a11y-form's canary password");
    assert.match(app("engine/runner/run-flow.ts"), /const runToken = randomBytes\(4\)\.toString\("hex"\)/);
    const fills = both().flatMap((extract) =>
      findingsOf(extract)
        .filter((f) => f.spec)
        .flatMap((f) => passwordFills(f.spec!.source).map((fill) => ({ ...fill, where: `${extract.app} ${f.id} (${f.spec!.filename})` }))),
    );
    for (const { where, field, value, ok } of fills) assert.ok(ok, `${where} types ${value} into ${field}`);
    // Not vacuous: Kennel's specs type the fake into Password and Confirm password, paywall-trust's reads process.env.
    assert.ok(fills.some((f) => f.where.startsWith("kennel") && /^"Fake-Passw0rd-/.test(f.value)), "a Kennel spec types the fake");
    assert.ok(fills.some((f) => f.where.startsWith("fernway") && f.value.startsWith("process.env.")), "a Fernway spec reads process.env");
  });

  test("no copied file's bytes or metadata hold a test account's password or a planted key", () => {
    // The pixels are compressed (deflate, LZW), so this finds text in a file's metadata or raw bytes only, never text
    // drawn in the picture. Drawn text relies on Run Hound's own redaction, checked by eye for every featured card:
    // bundle-secrets shows "[REDACTED:openai-key]" and "sk-p…(44 chars)", cookie-flags "kennel_session=… (36 chars)".
    for (const extract of both()) {
      const files = [...evidenceOf(extract).map((e) => e.asset), ...extract.crops.map((c) => c.asset)].filter(Boolean) as string[];
      for (const asset of files) {
        const text = readFileSync(new URL(asset, src)).toString("latin1");
        for (const secret of [...passwords, ...planted]) assert.ok(!text.includes(secret), asset);
      }
    }
  });

  test("no string holds a local absolute path, except in the findings localPaths lists with a reason", () => {
    for (const extract of both()) {
      // Outside the findings (the run's facts, the scenarios, the crops, how the extract was made), never.
      const withoutFindings = (value: object) => Object.fromEntries(Object.entries(value).filter(([key]) => key !== "findings" && key !== "runs"));
      const outside = [withoutFindings(extract), ...extract.runs.map(withoutFindings)];
      for (const [path, value] of strings(outside)) assert.doesNotMatch(value, LOCAL_PATH, `${extract.app} ${path}`);
      for (const run of extract.runs) {
        for (const finding of run.findings) {
          const key = `${run.runId}/${finding.id}`;
          const hits = strings(finding).filter(([, value]) => LOCAL_PATH.test(value));
          if (localPaths[key]) assert.ok(hits.length > 0, `${key} holds no local path now, so it leaves localPaths`);
          else assert.deepEqual(hits.map(([path]) => path), [], `${extract.app} ${key} holds a local path`);
        }
      }
    }
    for (const [key, reason] of Object.entries(localPaths)) {
      assert.ok(reason.trim(), `${key} has a reason`);
      assert.match(reason, /card image|frame|GIF/, `${key} says which copied image shows the path`);
    }
  });
});

describe("the extracts keep only what the site shows", () => {
  const allowed: Record<string, string[]> = {
    extract: ["runHoundVersion", "app", "extractedWith", "runs", "crops"],
    // startedAt: "Checked against release 0.6.0 · 27 September 2026" (check pages); target, form, planned, approved and
    // durationMs: the hero run window; signedIn: the signed-in check pages; summary: the demo's counts.
    run: ["runId", "runHoundVersion", "target", "startedAt", "durationMs", "signedIn", "form", "planned", "approved", "summary", "scenarios", "findings"],
    // title: the hero's plan rows; steps: the check pages' step trail; note: what a write-side check put back.
    scenario: ["id", "checkId", "title", "status", "note", "steps"],
    // A featured finding: its headline and meaning and impact, check page 02 (the finding as the report prints it);
    // location, locations and scope, 02's location line; fix, 04 "What to ask your AI"; spec, 03 (#reproduce) and the
    // evidence trio's test excerpt; requests, the evidence trio's request card and the hero's +29.8 / +30.0 ms;
    // evidence, 02's frame, GIF, card or listing.
    featured: [
      "id",
      "checkId",
      "scenarioId",
      "featured",
      "title",
      "severity",
      "confidence",
      "meaning",
      "impact",
      "fix",
      "location",
      "locations",
      "scope",
      "spec",
      "requests",
      "evidence",
    ],
    // A finding the site doesn't feature: its headline only, for a list or a count.
    finding: ["id", "checkId", "scenarioId", "featured", "title", "severity", "confidence", "location"],
    // An evidence item, on check page 02 and in the evidence trio: kind and label pick and caption the picture; step,
    // facts, title, subtitle, firstLineNumber and lines are the facts panel, the request card and the header, cookie or
    // console listing; frames and durationMs, a GIF's frame count and one play's length; markers, the numbered marks,
    // whose boxes are in the saved image's pixels (app/src/core/types.ts: highlights), so they scale with the image;
    // data, a network or console item's plain values; artifact, Run Hound's file name (the crop's source); asset,
    // width and height, the copied file and its intrinsic size for the static import.
    evidence: [
      "kind",
      "label",
      "step",
      "facts",
      "title",
      "subtitle",
      "firstLineNumber",
      "lines",
      "frames",
      "durationMs",
      "markers",
      "data",
      "artifact",
      "asset",
      "width",
      "height",
    ],
    // The B3 crop (the evidence trio's page picture): id to box, where it was cut from; pageWidth and pageScale, the
    // display scale that puts its text at 11 CSS px or more; asset, width and height, the file for the static import.
    crop: ["id", "runId", "findingId", "artifact", "frame", "source", "box", "pageWidth", "pageScale", "asset", "width", "height"],
  };
  const extra = (value: object, kind: string) => Object.keys(value).filter((k) => !allowed[kind].includes(k));

  test("no field beyond the ones the templates use", () => {
    for (const extract of both()) {
      assert.deepEqual(extra(extract, "extract"), [], extract.app);
      for (const crop of extract.crops) assert.deepEqual(extra(crop, "crop"), [], crop.id);
      for (const run of extract.runs) {
        assert.deepEqual(extra(run, "run"), [], run.runId);
        for (const s of run.scenarios) assert.deepEqual(extra(s, "scenario"), [], s.id);
        for (const f of run.findings) {
          assert.deepEqual(extra(f, f.featured ? "featured" : "finding"), [], f.id);
          for (const e of f.evidence ?? []) {
            assert.deepEqual(extra(e, "evidence"), [], `${f.id} ${e.label}`);
            // Raw evidence data keeps plain values only: no selectors, DOM dumps or nested request records.
            for (const [key, value] of Object.entries(e.data ?? {})) {
              const plain = (v: unknown) => v === null || ["string", "number", "boolean"].includes(typeof v);
              assert.ok(plain(value) || (Array.isArray(value) && value.every(plain)), `${f.id} ${e.label} data.${key}`);
              assert.doesNotMatch(key, /selector/i, `${f.id} ${e.label} data.${key}`);
            }
          }
        }
      }
    }
  });

  test("the extractor recorded how it was run, with no absolute path", () => {
    for (const extract of both()) {
      assert.equal(extract.extractedWith[0], "scripts/extract-run.mjs");
      for (const arg of extract.extractedWith) assert.ok(!arg.startsWith("/") && !/^[A-Za-z]:\\/.test(arg), arg);
    }
  });
});
