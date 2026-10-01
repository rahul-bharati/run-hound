import { count } from "../../utils/count.js";
import { formatDuration } from "../../core/format.js";
import { findingCounts, finishedIn, signedInSentence, testDataSentence } from "../../engine/report.js";
import { redactSecrets } from "../../engine/redact.js";
import { hideInJson } from "../../server/accounts.js";
import { formOfScenario } from "../../engine/plan.js";
import { flowStepWords } from "../../ai/describe.js";
import type { AccountRef, Plan, Report } from "../../core/types.js";

export const modelOf = (s: { provider: string; model: string }): string => `${s.provider}/${s.model}`;

export function nothingTested(errored: number, skipped: number): string {
  const total = errored + skipped;
  const all = total === 1 ? "the only scenario" : total === 2 ? "both scenarios" : `all ${total} scenarios`;
  if (skipped === 0) return `Nothing was tested: ${all} errored (see "Checks that errored" in the report).`;
  if (errored === 0) return `Nothing was tested: ${all} ${total === 1 ? "was" : "were"} skipped (the report says why).`;
  return `Nothing was tested: ${count(errored, "scenario")} errored and ${skipped} ${skipped === 1 ? "was" : "were"} skipped (the report says why).`;
}

// The caller applies account masking to every returned line.
export function planOnlyLines(args: {
  plan: Plan;
  account: AccountRef | undefined;
}): string[] {
  const { plan, account } = args;
  const lines: string[] = [];
  const as = account ? `, signed in as ${redactSecrets(account.label)}` : "";
  lines.push(`Scenarios for ${redactSecrets(plan.target)}${as} (* = run by default; pass ids to --approve):\n`);
  for (const group of plan.groups) {
    lines.push(`\n${group.label} (${count(group.scenarioIds.length, "scenario")})\n`);
    for (const id of group.scenarioIds) {
      const s = plan.scenarios.find((x) => x.id === id);
      if (!s) continue;
      const tags = [s.kind, s.destructive ? "destructive" : ""].filter(Boolean).join(", ");
      const scope = s.scopeLabel ? ` [${redactSecrets(s.scopeLabel)}]` : "";
      const suggested = s.ai?.suggested || s.checkId === "ai-flow";
      const aiTag = suggested ? ", suggested by AI" : "";
      lines.push(`  ${s.defaultSelected ? "*" : " "} ${s.id}  ${redactSecrets(s.title)} (${tags}${aiTag})${scope}\n`);
      lines.push(`      ${redactSecrets(s.description)}\n`);
      if (suggested) {
        const form = formOfScenario(plan, s);
        for (const [i, step] of (s.flow ?? []).entries())
          lines.push(`        ${i + 1}. ${redactSecrets(flowStepWords(step, form))}\n`);
      } else if (s.ai) {
        lines.push(`      AI: ${s.ai.recommended ? "recommended" : "not recommended"} — ${redactSecrets(s.ai.rationale)}\n`);
      }
    }
  }
  return lines;
}

export function planAsJson(plan: Plan, hide: (text: string) => string): string {
  return `${JSON.stringify(hideInJson(JSON.parse(redactSecrets(JSON.stringify(plan))) as unknown, hide))}\n`;
}

// The caller applies account masking to every returned line.
export function reportLines(report: Report, dir: string): string[] {
  const s = report.summary;
  const out: string[] = [];
  out.push(`${finishedIn(report) ?? "Finished"}.\n`);
  const signedIn = signedInSentence(report);
  if (signedIn) out.push(`${redactSecrets(signedIn)}\n`);
  for (const g of report.groups) {
    out.push(
      `  ${g.label}: ${g.passed} passed, ${g.failed} failed, ${g.errored} errored, ${g.skipped} skipped; ${count(g.findings, "finding")}; ${formatDuration(g.durationMs)}\n`,
    );
  }
  out.push(
    `${findingCounts(report.findings)}; critical ${s.critical}, high ${s.high}, medium ${s.medium}, low ${s.low}. ` +
      `Scenarios: ${s.passed} passed, ${s.failed} failed, ${s.errored} errored, ${s.skipped} skipped.\n`,
  );
  for (const f of report.findings) {
    const places = f.locations && f.locations.length > 1 ? ` [${f.locations.length} places]` : "";
    out.push(`  [${f.severity}${f.confidence === "advisory" ? ", advisory" : ""}] ${f.title} (${f.checkId})${places}\n`);
  }
  if (report.ai) {
    out.push(
      `AI explanations (advisory) from ${modelOf(report.ai)} for ${count(report.ai.explained, "finding")}; see the report.\n`,
    );
  }
  const testData = testDataSentence(report);
  if (testData) out.push(`${testData}\n`);
  out.push(`Report: ${dir}/report.html\n`);
  return out;
}
