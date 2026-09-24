/**
 * Shared setup and assertions for src/checks/evidence.test.ts: the "Evidence" contract in docs/v0-spec.md
 * (frames, cards and GIFs that carry the URL, time, highlighted element and the facts behind a finding).
 *
 * runCheckKeepingArtifacts is test-support/harness.ts runCheck with two differences: it creates one
 * CheckContext per scenario (so each gets its checkId and scenario title for the frame header) and it keeps
 * the artifacts directory until the caller's assertions have run.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "vitest";
import type { Box, Check, CheckResult, Evidence, Fact, Finding, Highlight, Scenario } from "../../../../src/core/types.js";
import { createCheckContext } from "../../../../src/engine/context.js";
import { discoverForm } from "../../../../src/engine/discover.js";
import { FRAME } from "../../../../src/engine/evidence.js";
import { redactSecrets } from "../../../../src/engine/redact.js";
import { getBrowser } from "../../../../test-support/harness.js";

export interface KeptRun {
  scenarios: Scenario[];
  results: CheckResult[];
  findings: Finding[];
  artifactsDir: string;
  steps: { label: string; url: string; at: string }[];
}

/**
 * Runs every scenario the check plans for the form at `url`, then calls `assert` while the artifacts are still on
 * disk, then deletes them.
 */
export async function runCheckKeepingArtifacts(
  check: Check,
  url: string,
  assert: (run: KeptRun) => void | Promise<void>,
  options: { allowDestructive?: boolean } = {},
): Promise<void> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "networkidle" });
  const form = await discoverForm(page);
  await page.close();

  const scenarios = check.plan(form);
  const artifactsDir = await mkdtemp(join(tmpdir(), `rh-evidence-${check.id}-`));
  const steps: KeptRun["steps"] = [];
  try {
    const results: CheckResult[] = [];
    for (const scenario of scenarios) {
      const ctx = createCheckContext({
        browser,
        form,
        targetUrl: url,
        artifactsDir,
        allowDestructive: options.allowDestructive ?? false,
        runToken: "t3st",
        checkId: check.id,
        scenarioTitle: scenario.title,
        onStep: (step) => steps.push(step),
      });
      try {
        results.push(await check.run(ctx, scenario));
      } finally {
        await ctx.dispose();
      }
    }
    await assert({ scenarios, results, findings: results.flatMap((r) => r.findings), artifactsDir, steps });
  } finally {
    await rm(artifactsDir, { recursive: true, force: true });
  }
}

const VISUAL = ["frame", "gif", "card"] as const;
type VisualKind = (typeof VISUAL)[number];

export function visualEvidence(finding: Finding): Evidence[] {
  return finding.evidence.filter((e) => (VISUAL as readonly string[]).includes(e.kind));
}

export function evidenceOfKind(finding: Finding, kind: VisualKind): Evidence[] {
  return finding.evidence.filter((e) => e.kind === kind);
}

/** Width and height read from the file header (PNG IHDR or GIF logical screen descriptor). */
function imageSize(file: Buffer, kind: VisualKind): { width: number; height: number } {
  if (kind === "gif") {
    expect(file.subarray(0, 6).toString("latin1"), "GIF89a signature").toBe("GIF89a");
    return { width: file.readUInt16LE(6), height: file.readUInt16LE(8) };
  }
  expect(file.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "PNG signature").toBe(true);
  return { width: file.readUInt32BE(16), height: file.readUInt32BE(20) };
}

function expectNonEmptyBox(box: Box | undefined, where: string) {
  expect(box, `${where}: highlight has a box`).toBeDefined();
  expect(box!.width, `${where}: highlight box width`).toBeGreaterThan(0);
  expect(box!.height, `${where}: highlight box height`).toBeGreaterThan(0);
}

/**
 * Every finding has at least one visual evidence item; every visual evidence item points at a real, well-formed
 * image in the artifacts dir; frames and GIFs carry the page URL and capture time; highlight boxes are non-empty
 * and inside the image; facts are labelled.
 */
export function expectCredibleEvidence(finding: Finding, artifactsDir: string, pageOrigin: string) {
  const visual = visualEvidence(finding);
  expect(visual.length, `${finding.id}: at least one frame, gif or card (got ${finding.evidence.map((e) => e.kind).join(", ")})`).toBeGreaterThan(0);

  for (const ev of visual) {
    const where = `${finding.id} ${ev.kind} "${ev.label}"`;
    expect(ev.label.trim().length, `${where}: label`).toBeGreaterThan(0);
    expect(ev.path, `${where}: path`).toEqual(expect.any(String));
    const file = join(artifactsDir, ev.path!);
    expect(existsSync(file), `${where}: ${ev.path} exists in the artifacts dir`).toBe(true);
    expect(statSync(file).size, `${where}: file is not empty`).toBeGreaterThan(0);
    expect(ev.path!, `${where}: extension`).toMatch(ev.kind === "gif" ? /\.gif$/ : /\.png$/);
    const size = imageSize(readFileSync(file), ev.kind as VisualKind);

    if (ev.kind === "frame" || ev.kind === "gif") {
      expect(ev.url, `${where}: url`).toEqual(expect.any(String));
      expect(ev.url!.startsWith(pageOrigin), `${where}: url ${ev.url} is on the page under test ${pageOrigin}`).toBe(true);
      expect(ev.capturedAt, `${where}: capturedAt`).toEqual(expect.any(String));
      expect(Number.isNaN(Date.parse(ev.capturedAt!)), `${where}: capturedAt is ISO 8601`).toBe(false);
      // The composed frame has the header strip on top of the screenshot.
      expect(size.height, `${where}: taller than the header strip`).toBeGreaterThan(FRAME.headerHeight);
    }
    if (ev.kind === "gif") {
      expect(ev.frames, `${where}: frames`).toBeGreaterThanOrEqual(2);
      expect(ev.frames!, `${where}: frames`).toBeLessThanOrEqual(FRAME.gifMaxFrames);
      expect(ev.durationMs, `${where}: durationMs`).toBeGreaterThan(0);
      expect(size.width, `${where}: GIF width`).toBeLessThanOrEqual(FRAME.gifMaxWidth);
    }

    for (const h of ev.highlights ?? []) {
      expect(h.label.trim().length, `${where}: highlight label`).toBeGreaterThan(0);
      expectNonEmptyBox(h.box, where);
      if (ev.kind !== "gif") {
        // Boxes are in the saved image's pixel coordinates, so they lie inside it.
        expect(h.box.x, `${where}: highlight x`).toBeGreaterThanOrEqual(0);
        expect(h.box.y, `${where}: highlight y`).toBeGreaterThanOrEqual(0);
        expect(h.box.x + h.box.width, `${where}: highlight right edge`).toBeLessThanOrEqual(size.width + 1);
        expect(h.box.y + h.box.height, `${where}: highlight bottom edge`).toBeLessThanOrEqual(size.height + 1);
      }
    }
    for (const fact of ev.facts ?? []) {
      expect(fact.label.trim().length, `${where}: fact label`).toBeGreaterThan(0);
      expect(typeof fact.value, `${where}: fact value`).toBe("string");
    }
  }
}

/** Every visual kind in `kinds` is present on the finding. */
export function expectKinds(finding: Finding, kinds: VisualKind[]) {
  const present = finding.evidence.map((e) => e.kind);
  for (const kind of kinds) expect(present, `${finding.id}: needs a ${kind} (has ${present.join(", ")})`).toContain(kind);
}

export function allHighlights(finding: Finding): (Highlight & { box: Box })[] {
  return finding.evidence.flatMap((e) => e.highlights ?? []);
}

export function allFacts(finding: Finding): Fact[] {
  return finding.evidence.flatMap((e) => e.facts ?? []);
}

/** A highlight whose label matches, in the given tone ("fail" is the default when tone is omitted). */
export function expectHighlight(finding: Finding, label: RegExp, tone: Highlight["tone"] = "fail"): Highlight & { box: Box } {
  const highlights = allHighlights(finding);
  const match = highlights.find((h) => label.test(h.label) && (h.tone ?? "fail") === tone);
  expect(
    match,
    `${finding.id}: a ${tone} highlight labelled ${label} (has ${JSON.stringify(highlights.map((h) => [h.label, h.tone ?? "fail"]))})`,
  ).toBeDefined();
  expectNonEmptyBox(match!.box, finding.id);
  return match!;
}

/** A fact whose label matches the keyword (case-insensitive); returns it. */
export function expectFact(finding: Finding, keyword: RegExp): Fact {
  const facts = allFacts(finding);
  const match = facts.find((f) => keyword.test(f.label));
  expect(match, `${finding.id}: a fact labelled like ${keyword} (has ${JSON.stringify(facts.map((f) => f.label))})`).toBeDefined();
  return match!;
}

/** Every string anywhere in the evidence (labels, steps, captions, facts, highlight labels, card lines, data). */
function evidenceStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) evidenceStrings(v, out);
  else if (value && typeof value === "object") for (const v of Object.values(value)) evidenceStrings(v, out);
  return out;
}

/**
 * No evidence text holds a secret: nothing redactSecrets would change, and none of the planted values (whole, or a
 * 16-char slice past the first 4 chars).
 */
export function expectNoSecretsInEvidence(findings: Finding[], planted: string[] = []) {
  for (const f of findings) {
    for (const text of evidenceStrings(f.evidence)) {
      expect(redactSecrets(text), `${f.id}: evidence text holds a secret-looking value`).toBe(text);
    }
    const everything = JSON.stringify(f.evidence);
    for (const secret of planted) {
      expect(everything, `${f.id}: evidence holds the planted secret`).not.toContain(secret);
      for (let i = 4; i + 16 <= secret.length; i += 4) {
        expect(everything, `${f.id}: evidence leaks a slice of the planted secret at ${i}`).not.toContain(secret.slice(i, i + 16));
      }
    }
  }
}

/** dead-control fixture from src/checks/dead-control.test.ts, with "Save draft" left without a handler (F01). */
export const DEAD_CONTROL_BUTTONS = `
  <button type="button" id="saveDraft">Save draft</button>
  <button type="button" id="clearPetName" aria-label="Clear pet name">&#x2715;</button>
  <button type="button" id="skipToEmail">Skip to email</button>
  <button type="button" id="checkAvailability">Check availability</button>
  <button type="button" id="showTips" aria-expanded="false" aria-controls="tips">Show tips</button>
  <p id="tips" class="tips" hidden>Tip: add your vet's phone number.</p>
  <button type="button" id="rememberDevice">Remember this device</button>
  <button type="button" id="help">Help</button>
`;

export const DEAD_CONTROL_HANDLERS = [
  'var $ = function (id) { return document.getElementById(id); };',
  "/* Save draft has no handler */",
  '$("clearPetName").addEventListener("click", function () { $("petName").value = ""; $("petName").focus(); });',
  '$("skipToEmail").addEventListener("click", function () { $("email").focus(); });',
  '$("checkAvailability").addEventListener("click", function () { fetch("/api/availability?source=button"); });',
  '$("showTips").addEventListener("click", function () { setTimeout(function () { var open = $("tips").hidden; $("tips").hidden = !open; $("showTips").setAttribute("aria-expanded", String(open)); }, 300); });',
  '$("rememberDevice").addEventListener("click", function () { sessionStorage.setItem("kennel-remember", "1"); });',
  '$("help").addEventListener("click", function () { location.href = "/help"; });',
].join("\n");

export const HELP_PAGE =
  '<!doctype html><html lang="en"><head><link rel="icon" href="data:,"><title>Help</title></head><body><h1>Help</h1></body></html>';
