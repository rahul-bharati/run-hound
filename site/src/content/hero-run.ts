/**
 * The facts the homepage's two product figures show, from one real run (DESIGN.md §3.1, §4.3): Run Hound 0.6.0 on
 * Kennel's booking form, run 20260927-153524-2d830d, as node R1 extracted it (content/runs/kennel-0.6.0.json). The hero
 * run window (components/home/hero-run-figure.tsx) and the evidence trio (components/home/how-it-works.tsx) read this,
 * and hero-run.test.ts fails when a value here and the extract disagree. The words around the figures are in
 * content/home.ts; what is here is what the pictures show: the web UI's and Kennel's own labels, and the run's values.
 *
 * Three values are typed into Kennel's form in the picture, as a person would type them; none is invented:
 * - the pet's name is Kennel's own example, its placeholder ("e.g. Biscuit", fixtures/kennel/src/App.tsx);
 * - the start date is the one the run typed (2026-10-11 in its exported test), as a date input shows it;
 * - the owner email is the one the run typed, without the run's nonce (owner.<nonce>twice@example.test).
 *
 * Server-only, like every content module (the extract is large; nothing here reaches a client component).
 */
import { site } from "@/lib/site";
import kennel from "./runs/kennel-0.6.0.json" with { type: "json" };

/** What the figures read of a finding in the extract (scripts/extract-run.mjs writes it; findings differ in what they carry). */
export type RunFinding = {
  id: string;
  checkId: string;
  featured?: boolean;
  title: string;
  severity: string;
  requests: { method: string; path: string; status: number; atMs: number }[];
  spec: { filename: string; source: string };
  evidence: { kind: string; title?: string; markers?: { label: string }[] }[];
};

const run = kennel.runs[0];
const finding = (run.findings as unknown as RunFinding[]).find((f) => f.checkId === "double-submit" && f.featured);
if (!finding) throw new Error("hero-run: the Kennel extract has no featured double-submit finding");
const crop = kennel.crops.find((c) => c.findingId === finding.id);
if (!crop) throw new Error(`hero-run: no crop for ${finding.id} in the Kennel extract`);
const card = finding.evidence.find((e) => e.kind === "card");

/** The web UI and reports print a title's straight quotes; the pictures set them as typographic quotes. */
const curled = (text: string) => text.replace(/"([^"]*)"/g, "“$1”");

/** The scenarios the plan's four rows show, by id: one per group of the page's checks, the finding's first. */
const planRowIds = ["double-click-submit", "server-error-500", "reflow-320:narrow-viewport", "security-headers:response-headers"];
const scenarioTitle = (id: string) => {
  const scenario = run.scenarios.find((s) => s.id === id);
  if (!scenario) throw new Error(`hero-run: no scenario "${id}" in the Kennel run`);
  return curled(scenario.title);
};

const field = (label: string) => {
  const found = run.form.fields.find((f) => f.label === label);
  if (!found) throw new Error(`hero-run: ${run.form.name} has no field "${label}"`);
  return found;
};

/** What the run's exported test typed into a field (its fill() call), by the field's label. */
function typed(label: string): string {
  const value = new RegExp(`getByLabel\\("${label}", \\{ exact: true \\}\\)\\.fill\\("([^"]+)"\\)`).exec(finding!.spec.source)?.[1];
  if (!value) throw new Error(`hero-run: the exported test types nothing into "${label}"`);
  return value;
}

/** An ISO date as an en-US date input shows it: 2026-10-11 → 10/11/2026. */
const shownDate = (iso: string) => {
  const [year, month, day] = iso.split("-");
  return `${month}/${day}/${year}`;
};

const target = new URL(run.target);
const ms = (atMs: number) => `+${atMs.toFixed(1)} ms`;
const markers = finding.evidence.flatMap((e) => e.markers ?? []).map((m) => m.label);
const saved = markers.filter((label) => /^Saved copy \d+$/.test(label));

/** The hero run window's frame: every value from the run. */
export const heroRun = {
  runId: run.runId,
  /** The address bar: the page under test. */
  address: `${target.host}${target.pathname}`,
  /** The window's title, the web UI's name. */
  app: site.name,
  form: run.form.name,
  fieldCount: run.form.fieldCount,
  /** Three of the form's fields, with the type chip Run Hound's explore step gives each. */
  fields: [
    { label: field("Pet name").label!, type: field("Pet name").type, value: "Biscuit" },
    { label: field("Start date").label!, type: field("Start date").type, value: shownDate(typed("Start date")) },
    { label: field("Owner email").label!, type: field("Owner email").type, value: typed("Owner email").replace(/\.[0-9a-f]+twice@/, "@") },
  ],
  /** Kennel's two buttons: "Book" (the one the finding is about) and "Save draft"; hero-run.test.ts finds them in Kennel's code. */
  buttons: ["Book", "Save draft"],
  bookings: "Your bookings",
  /** The two records one double click saved, as the finding's evidence marks them. */
  saved,
  /** The web UI's five steps. */
  rail: ["Explore", "Plan", "Approve", "Run", "Report"],
  plan: {
    rows: planRowIds.map(scenarioTitle),
    /** The scenarios after the four rows ("+16 more"), and after three on phones, where the fourth row hides. */
    more: run.planned - planRowIds.length,
    morePhone: run.planned - (planRowIds.length - 1),
  },
  progress: { done: run.approved, total: run.planned, seconds: Math.floor(run.durationMs / 1000) },
  finding: {
    severity: finding.severity.toUpperCase(),
    title: curled(finding.title),
    requests: finding.requests.map((r) => ({ line: `${r.method} ${r.path} → ${r.status}`, at: ms(r.atMs) })),
    /** Between the two saves, in ms (one decimal, as the web UI prints request times). */
    gapMs: Math.round((finding.requests[1].atMs - finding.requests[0].atMs) * 10) / 10,
    /** The chip for the finding's exported test. */
    spec: "Playwright test",
  },
  /** Words the web UI shows around the values: "Found “Book a sitter”: 9 fields", "+16 more", "20 / 20 · 56 s". */
  labels: { found: "Found", fields: "fields", more: "more" },
};

// ---- The evidence trio ------------------------------------------------------------------------------------------------

/** The longest line of the test excerpt (B4: a column of about 58 characters shows it whole at 1024 px). */
export const excerptWidth = 58;

/** Where a code line may break: at a space outside a string, with the bracket depth there and whether a comma ends the part before. */
function breaks(line: string): { at: number; depth: number; comma: boolean }[] {
  const out: { at: number; depth: number; comma: boolean }[] = [];
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quote) {
      if (c === "\\") i += 1;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if ("([{".includes(c)) depth += 1;
    else if (")]}".includes(c)) depth -= 1;
    else if (c === " " && i > 0 && line.slice(0, i).trim()) out.push({ at: i, depth, comma: line[i - 1] === "," });
  }
  return out;
}

/**
 * A code line wrapped to `width` characters: each break after a comma where one fits (else at a space), at the
 * shallowest bracket depth that fits, the last such; continuation lines indented 4 more than the line's own indent (a
 * hanging indent). A line with no break that fits stays whole.
 */
export function wrapCode(line: string, width = excerptWidth): string[] {
  const indent = /^\s*/.exec(line)![0];
  const out: string[] = [];
  let rest = line;
  let prefix = "";
  while ((prefix + rest).length > width) {
    const all = breaks(rest).filter((b) => prefix.length + b.at <= width);
    const fits = all.some((b) => b.comma) ? all.filter((b) => b.comma) : all;
    if (fits.length === 0) break;
    const shallowest = Math.min(...fits.map((b) => b.depth));
    const at = fits.filter((b) => b.depth === shallowest).at(-1)!.at;
    out.push(prefix + rest.slice(0, at).trimEnd());
    rest = rest.slice(at).trimStart();
    prefix = `${indent}    `;
  }
  out.push(prefix + rest);
  return out;
}

const specLines = finding.spec.source.split("\n").map((l) => l.trimEnd());
const specLine = (pick: (line: string) => boolean) => {
  const line = specLines.find(pick);
  if (!line) throw new Error(`hero-run: a line of ${finding!.spec.filename} is missing`);
  return line;
};
/** The exported test's key lines: the test, the double click, the wait and the assertion; "// …" for the rest. */
const excerpt = [
  specLine((l) => l.startsWith("test(")),
  "  // …",
  specLine((l) => l.includes(".dblclick()")),
  specLine((l) => l.includes("waitForTimeout(")),
  specLine((l) => l.includes("expect(")),
  specLine((l) => l === "});"),
];

/** The evidence trio (§3.1 block 2): the page, the requests and the test of the same finding. */
export const kennelEvidence = {
  /** The bookings crop R1 cut from the finding's GIF: both saved copies and their markers (B3). */
  crop: { width: crop.width, height: crop.height, alt: saved.join(" and ") },
  requests: {
    title: card?.title ?? `${finding.requests[0].method} ${finding.requests[0].path}`,
    rows: finding.requests.map((r, i) => ({ n: `#${i + 1}`, at: ms(r.atMs), status: r.status })),
  },
  test: {
    filename: finding.spec.filename,
    /** The lines as the spec has them, and wrapped for the excerpt. */
    source: excerpt,
    lines: excerpt.flatMap((line) => wrapCode(line)),
    language: "TypeScript",
  },
};
