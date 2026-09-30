/**
 * The real runs a check page shows (DESIGN.md §3.6, "Evidence is real"): the Kennel and Fernway 0.6.0 extracts
 * (content/runs/*.json, written by scripts/extract-run.mjs; content/runs/runs.test.ts holds them to the runs). Each
 * built-in check has one featured finding across the two, with its texts, evidence, scenario steps and Playwright test;
 * a check page shows that finding exactly as the report printed it.
 *
 * Server-only, read at build time: the extracts never reach the browser, only what a page renders from them. Plain .ts
 * (JSON imported with its import attribute), so node --test loads it as Next.js does.
 */
import fernway from "../../content/runs/fernway-0.6.0.json" with { type: "json" };
import kennel from "../../content/runs/kennel-0.6.0.json" with { type: "json" };
import type { CheckPage } from "@/content/checks/pages/types";

/** The test app a run was on (brand.md: each is defined at first use on a page). */
export type RunApp = "kennel" | "fernway";

export type Box = { x: number; y: number; width: number; height: number };

/** An evidence item as the report records it; which fields it has depends on its kind. */
export type Evidence = {
  kind: "gif" | "frame" | "card" | "network" | "console" | "dom" | "axe" | "note" | (string & {});
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
  /** The copied file, relative to src/ ("assets/runs/0.6.0/kennel/double-submit-gif-1.gif"). */
  asset?: string | null;
  width?: number;
  height?: number;
};

export type Finding = {
  id: string;
  checkId: string;
  scenarioId: string;
  featured: boolean;
  title: string;
  severity: string;
  confidence: string;
  location?: string;
  locations?: string[];
  scope?: string;
  meaning?: string;
  impact?: string;
  fix?: string;
  spec?: { filename: string; source: string };
  requests?: { label: string; method: string; path: string; status: number; atMs: number }[];
  evidence?: Evidence[];
};

export type Scenario = { id: string; checkId: string; title: string; status: string; note?: string; steps: string[] };

export type Run = {
  runId: string;
  runHoundVersion: string;
  target: string;
  /** Scenarios the run planned and approved; a run that approved fewer is a partial run (content/runs/runs.test.ts). */
  planned: number;
  approved: number;
  startedAt: string;
  durationMs: number;
  signedIn: { as: string; other: string | null } | null;
  scenarios: Scenario[];
  findings: Finding[];
};

export type Extract = { runHoundVersion: string; app: RunApp; runs: Run[] };

/** Both extracts: Kennel for the signed-out checks, Fernway for the signed-in ones. */
export const extracts: readonly Extract[] = [kennel, fernway] as unknown as Extract[];

/** "27 September 2026" from an ISO instant, in site.released's own style (UTC, so the build machine's zone can't move the day). */
function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(iso));
}

/**
 * What a check page's and the checks hub's "Checked against release {version} · {date}" label shows (0.6.1,
 * docs/launch-spec.md §7): the extracts' own runHoundVersion and the earliest run's startedAt date, never
 * site.version/site.released. The findings, severities and evidence those pages show come from these runs, so the
 * label must keep saying the run's version even once the site itself has moved past it ("a figure from the 0.6.0
 * runs keeps saying 0.6.0"). Both extracts must share one runHoundVersion (checked at build time, not just by a test):
 * a page mixing evidence from two Run Hound versions would need a version per finding, which nothing here supports yet.
 */
export const checkedAgainst: { version: string; date: string } = (() => {
  const versions = new Set(extracts.map((e) => e.runHoundVersion));
  if (versions.size !== 1) throw new Error(`run-evidence: extracts disagree on runHoundVersion: ${[...versions].join(", ")}`);
  const earliest = extracts.flatMap((e) => e.runs).map((r) => r.startedAt).sort()[0];
  return { version: [...versions][0]!, date: formatDate(earliest!) };
})();

/** Every string the extracts hold, joined: what a page's own numbers are checked against (pages.test.ts). */
export function extractsText(): string {
  return JSON.stringify(extracts);
}

export type Featured = { app: RunApp; run: Run; finding: Finding; scenario: Scenario | undefined };

/** The check's featured finding, with its run and scenario, or undefined when neither run found it. */
export function featuredFinding(checkId: string): Featured | undefined {
  for (const extract of extracts) {
    for (const run of extract.runs) {
      const finding = run.findings.find((f) => f.checkId === checkId && f.featured);
      if (finding) return { app: extract.app, run, finding, scenario: run.scenarios.find((s) => s.id === finding.scenarioId) };
    }
  }
  return undefined;
}

/** What a check page shows under "What a finding looks like" and "How to fix it". */
export type PageFinding = {
  title: string;
  meaning: string;
  impact: string;
  fix: string;
  severity: string;
  confidence: string;
  location?: string;
  scope?: string;
  /** Absent when the page shows the check's own texts instead of a run's (CheckPage.noEvidence). */
  featured?: Featured;
};

/** The finding a check page shows: the run's featured finding, verbatim, or the module's noEvidence texts. */
export function pageFinding(page: CheckPage): PageFinding {
  const featured = featuredFinding(page.id);
  if (featured) {
    const f = featured.finding;
    return {
      title: f.title,
      meaning: f.meaning ?? "",
      impact: f.impact ?? "",
      fix: f.fix ?? "",
      severity: f.severity,
      confidence: f.confidence,
      location: f.location,
      scope: f.scope,
      featured,
    };
  }
  if (!page.noEvidence) throw new Error(`check pages: ${page.id} has no featured finding and no noEvidence texts`);
  return { ...page.noEvidence, severity: page.severity, confidence: "confirmed" };
}

/** The evidence items a page shows, in its order, each with its caption and alt text. */
export function pageEvidence(page: CheckPage): (Evidence & { caption: string; alt?: string })[] {
  const items = featuredFinding(page.id)?.finding.evidence ?? [];
  return page.evidence.map((chosen) => {
    const item = items.find((e) => e.label === chosen.label);
    if (!item) throw new Error(`check pages: ${page.id} shows evidence "${chosen.label}", which its featured finding doesn't have`);
    return { ...item, caption: chosen.caption, alt: chosen.alt };
  });
}

/**
 * A fix split around the request to paste: Run Hound writes fixes as `Ask your AI or developer: "…"`, and Copy copies
 * only the quoted request. A fix in any other form is copied whole.
 */
export function askPrompt(fix: string): { before: string; prompt: string; after: string } {
  const m = /^(Ask your AI[^:"“]*:\s*["“])([\s\S]+)(["”])$/.exec(fix);
  return m ? { before: m[1], prompt: m[2], after: m[3] } : { before: "", prompt: fix, after: "" };
}

/** Whether an evidence item is a picture (a frame or a GIF), which a page shows as an image with alt text. */
export const isPicture = (e: Pick<Evidence, "kind">) => e.kind === "gif" || e.kind === "frame";

const plain = (value: unknown) => (Array.isArray(value) ? value.join(", ") : String(value));

/**
 * An evidence item that isn't a picture, as the text listing a page shows (the report draws a card of the same lines):
 * a request card's title, address and lines; a request; a console message; otherwise its facts, or its values.
 */
export function listingOf(e: Evidence): { title?: string; subtitle?: string; lines: string[] } {
  const data = e.data ?? {};
  if (e.lines?.length) return { title: e.title, subtitle: e.subtitle, lines: e.lines };
  if (e.kind === "network") return { lines: [`${plain(data.method)} ${plain(data.url)} → ${plain(data.status ?? data.failure)}`] };
  if (e.kind === "console") return { lines: [`console.${plain(data.type)}: ${plain(data.text)}`, ...(data.url ? [plain(data.url)] : [])] };
  if (e.facts?.length) return { lines: e.facts.map((f) => `${f.label}: ${f.value}`) };
  return { lines: Object.entries(data).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => `${k}: ${plain(v)}`) };
}
