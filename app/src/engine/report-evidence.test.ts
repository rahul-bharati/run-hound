/**
 * Report rendering of visual evidence (docs/v0-spec.md, "Evidence" and "Live view and pages tested"):
 * frames, GIFs and cards shown inline as <figure> with alt text, a caption (step, URL, capture time) and the facts;
 * non-visual evidence still in a <details>; a "Pages tested" section; everything escaped; no path leaves the run folder.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Evidence, Finding, Report } from "../core/types.js";
import { NOT_VISIBLE, renderHtml, renderMarkdown, writeReport } from "./report.js";

const FRAME: Evidence = {
  kind: "frame",
  label: "Book button after double-click",
  path: "double-submit/frame-1.png",
  url: "http://127.0.0.1:5173/book",
  capturedAt: "2026-09-22T10:00:12.345Z",
  step: "Double-click Book",
  viewport: { width: 1280, height: 800 },
  highlights: [{ selector: "button[type=submit]", label: "Clicked twice", tone: "fail", box: { x: 10, y: 20, width: 120, height: 40 } }],
  facts: [
    { label: "Requests sent", value: "2" },
    { label: "Status codes", value: "201, 201" },
  ],
};

const GIF: Evidence = {
  kind: "gif",
  label: "Double-submit flow",
  path: "double-submit/flow.gif",
  url: "http://127.0.0.1:5173/book",
  capturedAt: "2026-09-22T10:00:10.000Z",
  step: "Fill form, double-click Book, wait",
  frames: 4,
  durationMs: 5200,
  facts: [{ label: "Frames", value: "4" }],
};

const CARD: Evidence = {
  kind: "card",
  label: "Create requests",
  path: "double-submit/card-requests.png",
  url: "http://127.0.0.1:5173/book",
  capturedAt: "2026-09-22T10:00:13.000Z",
  step: "Read the network log",
  facts: [{ label: "Create requests", value: "POST /api/bookings x2" }],
};

const NETWORK: Evidence = {
  kind: "network",
  label: "Raw create requests",
  data: { requests: [{ method: "POST", path: "/api/bookings", status: 201, marker: "net-marker-7731" }] },
};

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    checkId: "double-submit",
    id: "double-submit#1",
    title: "Double click books twice",
    severity: "high",
    category: "broken-feature",
    confidence: "confirmed",
    meaning: "Clicking Book twice quickly sends two bookings.",
    impact: "Customers get charged twice.",
    fix: "Disable the Book button while the request is pending.",
    location: "Book button",
    evidence: [FRAME, GIF, CARD, NETWORK],
    ...overrides,
  };
}

function makeReport(findings: Finding[], pagesVisited: Report["pagesVisited"] = undefined): Report {
  return {
    runId: "run-2026-09-22-evd",
    target: "http://127.0.0.1:5173/book",
    startedAt: "2026-09-22T10:00:00.000Z",
    finishedAt: "2026-09-22T10:01:00.000Z",
    runHoundVersion: "0.0.1",
    plan: {
      target: "http://127.0.0.1:5173/book",
      form: { url: "http://127.0.0.1:5173/book", selector: "form", name: "Book a sitter", fields: [], controls: [] },
      scenarios: [
        { id: "ds:1", checkId: "double-submit", title: "Double-click submit", description: "d", kind: "danger", priority: "high", destructive: false, defaultSelected: true },
        { id: "rf:1", checkId: "reflow-320", title: "Reflow at 320px", description: "r", kind: "golden", priority: "medium", destructive: false, defaultSelected: true },
      ],
    },
    approved: ["ds:1", "rf:1"],
    results: [
      { checkId: "double-submit", scenarioId: "ds:1", status: findings.length ? "fail" : "pass", findings, durationMs: 1200 },
      { checkId: "reflow-320", scenarioId: "rf:1", status: "pass", findings: [], durationMs: 300 },
    ],
    findings,
    summary: { critical: 0, high: findings.length, medium: 0, low: 0, passed: 1, failed: findings.length ? 1 : 0, errored: 0, skipped: 0 },
    notVisible: NOT_VISIBLE,
    pagesVisited: pagesVisited ?? [
      { url: "http://127.0.0.1:5173/book", scenarioIds: ["ds:1", "rf:1"] },
      { url: "http://127.0.0.1:5173/bookings", scenarioIds: ["ds:1"] },
    ],
  };
}

/** Removes every <details>...</details> block (non-nested is enough for these reports). */
function withoutDetails(html: string): string {
  return html.replace(/<details[\s\S]*?<\/details>/gi, "");
}

/** Each <figure>...</figure> block. */
function figures(html: string): string[] {
  return html.match(/<figure[\s\S]*?<\/figure>/gi) ?? [];
}

/** Decodes the few entities the renderer uses, for attribute values. */
function unescape(text: string): string {
  return text.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function imgTags(html: string): { src: string; alt: string | null }[] {
  return [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => {
    const tag = m[0];
    const src = /\ssrc=("([^"]*)"|'([^']*)')/i.exec(tag);
    const alt = /\salt=("([^"]*)"|'([^']*)')/i.exec(tag);
    return { src: unescape(src?.[2] ?? src?.[3] ?? ""), alt: alt ? unescape(alt[2] ?? alt[3] ?? "") : null };
  });
}

/** Every local src/href value in the document. */
function localRefs(html: string): string[] {
  return [...html.matchAll(/\s(?:src|href)=("([^"]*)"|'([^']*)')/gi)]
    .map((m) => unescape(m[2] ?? m[3] ?? ""))
    .filter((v) => !v.startsWith("#"));
}

/** True when the fact appears as <dt>label</dt><dd>value</dd> or as a table row with label and value cells. */
function hasFactMarkup(html: string, label: string, value: string): boolean {
  const l = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const v = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const dl = new RegExp(`<dt[^>]*>\\s*${l}\\s*</dt>\\s*<dd[^>]*>\\s*${v}\\s*</dd>`, "i");
  const table = new RegExp(`<tr[^>]*>\\s*<t[hd][^>]*>\\s*${l}\\s*</t[hd]>\\s*<td[^>]*>\\s*${v}\\s*</td>`, "i");
  return dl.test(html) || table.test(html);
}

describe("renderHtml: visual evidence", () => {
  it("shows every frame, GIF and card inline as a <figure> with an <img> under artifacts/, not only inside <details>", () => {
    const html = renderHtml(makeReport([makeFinding()]));
    const open = withoutDetails(html);
    const openFigures = figures(open);
    for (const e of [FRAME, GIF, CARD]) {
      const fig = openFigures.find((f) => imgTags(f).some((i) => i.src === `artifacts/${e.path}`));
      expect(fig, `${e.kind} ${e.path} shown inline in a <figure>`).toBeDefined();
    }
  });

  it("renders GIF evidence as an <img>, not a link or <video>", () => {
    const html = renderHtml(makeReport([makeFinding({ evidence: [GIF] })]));
    expect(imgTags(html).map((i) => i.src)).toContain(`artifacts/${GIF.path}`);
  });

  it("gives each image meaningful alt text with the label and the step", () => {
    const html = renderHtml(makeReport([makeFinding()]));
    for (const e of [FRAME, GIF, CARD]) {
      const img = imgTags(html).find((i) => i.src === `artifacts/${e.path}`);
      expect(img, `img for ${e.path}`).toBeDefined();
      expect(img!.alt, `alt for ${e.path}`).not.toBeNull();
      expect(img!.alt!).toContain(e.label);
      expect(img!.alt!).toContain(e.step!);
    }
  });

  it("captions each figure with the step, the page URL and the capture time", () => {
    const html = renderHtml(makeReport([makeFinding()]));
    for (const e of [FRAME, GIF, CARD]) {
      const fig = figures(html).find((f) => f.includes(`artifacts/${e.path}`));
      expect(fig, `figure for ${e.path}`).toBeDefined();
      const caption = /<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i.exec(fig!)?.[1];
      expect(caption, `figcaption for ${e.path}`).toBeDefined();
      expect(caption!).toContain(e.step!);
      expect(caption!).toContain(e.url!);
      expect(caption!).toContain(e.capturedAt!);
    }
  });

  it("renders the facts as a definition list or table next to the image, outside any <details>", () => {
    const html = renderHtml(makeReport([makeFinding()]));
    const open = withoutDetails(html);
    for (const e of [FRAME, GIF, CARD]) {
      for (const fact of e.facts!) {
        expect(hasFactMarkup(open, fact.label, fact.value), `fact "${fact.label}: ${fact.value}" for ${e.path}`).toBe(true);
      }
    }
    // Next to the image: inside the same figure.
    const frameFig = figures(open).find((f) => f.includes(`artifacts/${FRAME.path}`))!;
    expect(hasFactMarkup(frameFig, "Requests sent", "2")).toBe(true);
  });

  it("keeps non-visual evidence (network, console, axe data) available in a <details>", () => {
    const axe: Evidence = { kind: "axe", label: "label rule", data: { rule: "label", marker: "axe-marker-4410" } };
    const consoleEv: Evidence = { kind: "console", label: "Console errors", data: ["console-marker-9921"] };
    const html = renderHtml(makeReport([makeFinding({ evidence: [FRAME, NETWORK, axe, consoleEv] })]));
    const details = (html.match(/<details[\s\S]*?<\/details>/gi) ?? []).join("\n");
    for (const marker of ["net-marker-7731", "axe-marker-4410", "console-marker-9921"]) {
      expect(details, `${marker} inside a <details>`).toContain(marker);
    }
  });

  it("does not render an <img> for evidence without a path", () => {
    const noPath: Evidence = { kind: "frame", label: "Frame that failed to save", step: "s", url: "http://x/", capturedAt: "t" };
    const html = renderHtml(makeReport([makeFinding({ evidence: [noPath] })]));
    expect(imgTags(html).filter((i) => i.src === "" || i.src === "artifacts/" || i.src.endsWith("undefined"))).toEqual([]);
  });
});

describe("renderHtml: pages tested", () => {
  it("has a Pages tested section listing each visited URL with its scenario count", () => {
    const html = renderHtml(makeReport([makeFinding()]));
    const section = /<section[^>]*>(?:(?!<\/section>)[\s\S])*Pages tested(?:(?!<\/section>)[\s\S])*<\/section>/i.exec(html)?.[0];
    expect(section, "a <section> headed Pages tested").toBeDefined();
    const items = section!.match(/<li[\s\S]*?<\/li>|<tr[\s\S]*?<\/tr>/gi) ?? [];
    const book = items.find((i) => i.includes("http://127.0.0.1:5173/book") && !i.includes("/bookings"));
    const bookings = items.find((i) => i.includes("http://127.0.0.1:5173/bookings"));
    expect(book, "row for /book").toBeDefined();
    expect(bookings, "row for /bookings").toBeDefined();
    expect(book!).toMatch(/\b2\b/);
    expect(bookings!).toMatch(/\b1\b/);
  });

  it("still renders when pagesVisited is missing (older reports)", () => {
    const report = makeReport([makeFinding()]);
    delete report.pagesVisited;
    expect(() => renderHtml(report)).not.toThrow();
  });
});

describe("renderHtml: escaping and paths", () => {
  it("escapes a URL containing <script> in captions, alt text and the pages list", () => {
    const evil = 'http://127.0.0.1:5173/book?q=<script>alert("x")</script>';
    const frame: Evidence = { ...FRAME, url: evil, step: '<script>alert("step")</script>', label: "<img src=x onerror=alert(1)>" };
    const html = renderHtml(
      makeReport([makeFinding({ evidence: [frame] })], [{ url: evil, scenarioIds: ["ds:1"] }]),
    );
    expect(html).not.toMatch(/<script(\s|>)/i);
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes facts", () => {
    const frame: Evidence = { ...FRAME, facts: [{ label: "<b>bold</b>", value: '<script>alert("fact")</script>' }] };
    const html = renderHtml(makeReport([makeFinding({ evidence: [frame] })]));
    expect(html).not.toMatch(/<script(\s|>)/i);
    expect(html).not.toContain("<b>bold</b>");
  });

  it("never references a file outside the run folder", () => {
    const evidence: Evidence[] = [
      { ...FRAME, path: "../../outside.png" },
      { ...GIF, path: "/etc/passwd.gif" },
      { ...CARD, path: "double-submit/../../../escape.png" },
      { ...FRAME, path: "file:///etc/hosts" },
    ];
    const html = renderHtml(makeReport([makeFinding({ evidence })]));
    const runDir = resolve("/runs/run-x");
    for (const ref of localRefs(html)) {
      expect(ref, `${ref} is a relative path`).not.toMatch(/^([a-z]+:|\/|\\)/i);
      const decoded = decodeURI(ref);
      const target = resolve(runDir, decoded);
      expect(target === runDir || target.startsWith(runDir + sep), `${ref} stays inside the run folder`).toBe(true);
    }
  });
});

describe("renderMarkdown: visual evidence", () => {
  it("links every visual evidence file under artifacts/", () => {
    const md = renderMarkdown(makeReport([makeFinding()]));
    for (const e of [FRAME, GIF, CARD]) {
      expect(md, `markdown link or image for ${e.path}`).toMatch(
        new RegExp(`\\]\\(artifacts/${e.path!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)`),
      );
    }
  });

  it("lists the facts with the step, URL and capture time", () => {
    const md = renderMarkdown(makeReport([makeFinding()]));
    for (const e of [FRAME, GIF, CARD]) {
      for (const fact of e.facts!) {
        const v = fact.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        expect(md, `fact ${fact.label}`).toMatch(new RegExp(`${fact.label}\\**(:\\**\\s*|\\s*\\|\\s*)\\**${v}`));
      }
      expect(md).toContain(e.step!);
      expect(md).toContain(e.capturedAt!);
    }
    expect(md).toContain(FRAME.url!);
  });

  it("has a Pages tested section with each URL and scenario count", () => {
    const md = renderMarkdown(makeReport([makeFinding()]));
    const idx = md.search(/^#+ Pages tested/m);
    expect(idx, "Pages tested heading").toBeGreaterThanOrEqual(0);
    const section = md.slice(idx).split(/\n#+ /)[0]!;
    const bookLine = section.split("\n").find((l) => l.includes("http://127.0.0.1:5173/book") && !l.includes("/bookings"));
    const bookingsLine = section.split("\n").find((l) => l.includes("http://127.0.0.1:5173/bookings"));
    expect(bookLine).toMatch(/\b2\b/);
    expect(bookingsLine).toMatch(/\b1\b/);
  });

  it("never links a file outside the run folder", () => {
    const md = renderMarkdown(makeReport([makeFinding({ evidence: [{ ...FRAME, path: "../../outside.png" }, { ...GIF, path: "/etc/passwd.gif" }] })]));
    const targets = [...md.matchAll(/\]\(([^)]*)\)/g)].map((m) => m[1]!);
    const runDir = resolve("/runs/run-x");
    for (const t of targets) {
      if (/^https?:/i.test(t)) continue;
      expect(t).not.toMatch(/^(file:|\/|\\)/i);
      const target = resolve(runDir, decodeURI(t));
      expect(target.startsWith(runDir + sep), `${t} stays inside the run folder`).toBe(true);
    }
  });
});

describe("writeReport: visual evidence", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "rh-report-evidence-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("report.html shows every visual evidence file inline and report.json keeps pagesVisited and evidence metadata", async () => {
    await writeReport(makeReport([makeFinding()]), dir);
    const html = await readFile(join(dir, "report.html"), "utf8");
    const srcs = imgTags(withoutDetails(html)).map((i) => i.src);
    for (const e of [FRAME, GIF, CARD]) expect(srcs).toContain(`artifacts/${e.path}`);

    const json = JSON.parse(await readFile(join(dir, "report.json"), "utf8")) as Report;
    expect(json.pagesVisited?.map((p) => p.url)).toEqual(["http://127.0.0.1:5173/book", "http://127.0.0.1:5173/bookings"]);
    const frame = json.findings[0]!.evidence.find((e) => e.kind === "frame")!;
    expect(frame.facts).toEqual(FRAME.facts);
    expect(frame.step).toBe(FRAME.step);
    expect(frame.capturedAt).toBe(FRAME.capturedAt);
  });

  it("redacts secrets in facts, captions and alt text", async () => {
    const secret = "sk-proj-FAKEFAKEfake1234567890abcdefghijklmnopqrstuvwxyzABCDEFGH";
    const frame: Evidence = { ...FRAME, step: `Typed ${secret}`, facts: [{ label: "Key", value: secret }] };
    await writeReport(makeReport([makeFinding({ evidence: [frame] })]), dir);
    for (const name of ["report.html", "report.md", "report.json"]) {
      const text = await readFile(join(dir, name), "utf8");
      expect(text, name).not.toContain(secret.slice(8));
    }
  });
});
