/**
 * Evidence acceptance (docs/v0-spec.md, "Evidence" and "Live view and pages tested"):
 * one run against Kennel with KENNEL_BUGS=all and every scenario approved. Every finding must carry visual evidence
 * that exists on disk as a real PNG or GIF, the flow checks must include a GIF, the report must list the pages it
 * visited and reference every visual evidence file. Clean Kennel must still produce zero findings.
 */
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { afterAll, beforeAll, describe, it } from "vitest";
import { checks } from "../../../app/src/checks/index.js";
import type { CheckId, Evidence, Report } from "../../../app/src/core/types.js";
import { discoverAndPlan, runPlan } from "../../../app/src/engine/runner.js";
import { buildKennel, startKennel } from "./kennel.js";

const VISUAL_KINDS = new Set<Evidence["kind"]>(["frame", "gif", "card"]);
/** Checks whose evidence is a recorded flow (spec: "GIF" in the visual evidence column). */
const FLOW_CHECKS: CheckId[] = ["dead-control", "silent-failure", "persistence", "double-submit", "keyboard-completion", "focus-visible"];
const keepRuns = process.env.KEEP_RUNS === "1";

let runsRoot: string;

beforeAll(async () => {
  await buildKennel();
  runsRoot = await mkdtemp(join(tmpdir(), "rh-evidence-"));
});

afterAll(async () => {
  if (!runsRoot) return;
  if (keepRuns) console.log(`[acceptance] evidence runs kept in ${runsRoot}`);
  else await rm(runsRoot, { recursive: true, force: true });
});

async function runAgainstKennel(bugs: string, name: string): Promise<{ report: Report; dir: string; bookUrl: string }> {
  const kennel = await startKennel(bugs);
  try {
    await kennel.reset();
    const plan = await discoverAndPlan(kennel.bookUrl, { checks });
    const approved = plan.scenarios.map((s) => s.id);
    const { report, dir } = await runPlan(plan, { checks, approved, allowDestructive: false, runsDir: join(runsRoot, name) });
    return { report, dir, bookUrl: kennel.bookUrl };
  } finally {
    await kennel.stop();
  }
}

function magic(bytes: Buffer): "png" | "gif" | "other" {
  if (bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return "png";
  if (bytes.subarray(0, 6).toString("latin1") === "GIF89a") return "gif";
  return "other";
}

describe.concurrent("Evidence against Kennel", () => {
  it("KENNEL_BUGS=all: every finding has credible visual evidence and the report shows it", async ({ expect }) => {
    const { report, dir, bookUrl } = await runAgainstKennel("all", "all");
    expect(report.findings.length, "findings with every bug on").toBeGreaterThan(0);

    const artifactsDir = resolve(dir, "artifacts");
    const html = await readFile(join(dir, "report.html"), "utf8");
    const md = await readFile(join(dir, "report.md"), "utf8");

    for (const f of report.findings) {
      const visual = f.evidence.filter((e) => VISUAL_KINDS.has(e.kind) && e.path);
      expect(visual.length, `${f.id} has at least one frame/gif/card with a path`).toBeGreaterThan(0);

      for (const e of visual) {
        const file = resolve(artifactsDir, e.path!);
        expect(file.startsWith(artifactsDir + sep), `${f.id} ${e.path} stays inside artifacts/`).toBe(true);
        const info = await stat(file).catch(() => null);
        expect(info?.isFile(), `${f.id} ${e.path} exists on disk`).toBe(true);
        const kind = magic(await readFile(file));
        expect(kind, `${f.id} ${e.path} is a PNG or GIF`).not.toBe("other");
        if (e.kind === "gif") expect(kind, `${f.id} ${e.path} (gif evidence) is a GIF89a`).toBe("gif");
        else expect(kind, `${f.id} ${e.path} (${e.kind} evidence) is a PNG`).toBe("png");

        expect(e.capturedAt, `${f.id} ${e.path} has a capture time`).toBeTruthy();
        if (e.kind !== "card") expect(e.url, `${f.id} ${e.path} has the page URL`).toBeTruthy();

        const ref = `artifacts/${e.path}`;
        expect(html.includes(ref) || html.includes(`artifacts/${encodeURI(e.path!)}`), `report.html references ${ref}`).toBe(true);
        expect(md.includes(ref) || md.includes(`artifacts/${encodeURI(e.path!)}`), `report.md references ${ref}`).toBe(true);
      }
    }

    const flowFindings = report.findings.filter((f) => FLOW_CHECKS.includes(f.checkId));
    expect(flowFindings.length, "findings from the flow checks").toBeGreaterThan(0);
    for (const f of flowFindings) {
      expect(
        f.evidence.some((e) => e.kind === "gif" && e.path?.endsWith(".gif")),
        `${f.id} (${f.checkId}) includes a GIF of the flow`,
      ).toBe(true);
    }

    expect(report.pagesVisited, "report.pagesVisited").toBeDefined();
    const bookPath = new URL(bookUrl).pathname;
    expect(
      report.pagesVisited!.some((p) => new URL(p.url).pathname === bookPath && p.scenarioIds.length > 0),
      `pagesVisited contains ${bookUrl} with its scenarios`,
    ).toBe(true);
    expect(html, "report.html has a Pages tested section").toMatch(/Pages tested/i);

    const json = JSON.parse(await readFile(join(dir, "report.json"), "utf8")) as Report;
    expect(json.pagesVisited?.length, "report.json keeps pagesVisited").toBe(report.pagesVisited!.length);
  });

  it("KENNEL_BUGS=none: still zero findings, and pages tested are listed", async ({ expect }) => {
    const { report, bookUrl } = await runAgainstKennel("none", "clean");
    expect(report.findings.map((f) => `${f.id}: ${f.title}`), "clean Kennel findings").toEqual([]);
    expect(report.summary.errored, "clean Kennel errored checks").toBe(0);
    const bookPath = new URL(bookUrl).pathname;
    expect(report.pagesVisited?.some((p) => new URL(p.url).pathname === bookPath)).toBe(true);
  });
});
