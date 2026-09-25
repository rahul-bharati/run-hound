import type { Finding, FindingExplanation, Report } from "../core/types.js";
import type { JsonSchema, LlmClient } from "./types.js";
import { notImplemented } from "./not-implemented.js";

export interface ExplainAnswer {
  summary: string;
  askYourAi: string;
}

export const EXPLAIN_SCHEMA: JsonSchema = {} /* filled in by the implementation */;

export function validateExplain(value: unknown): ExplainAnswer {
  return notImplemented("validateExplain");
}

/**
 * What the model sees for one finding: title, severity, category, confidence, scope, location(s), meaning, impact,
 * fix, and the facts of its evidence (label: value), each redacted and cut to 300 chars. Never paths, images,
 * request bodies or evidence `data`.
 */
export function explainPrompt(finding: Finding): { system: string; user: string } {
  return notImplemented("explainPrompt");
}

/**
 * Explains every finding, one call each, sequentially (local models serve one request at a time), at most 20 findings
 * (the rest get none). Summary ≤ 600 chars, askYourAi ≤ 1000. A finding whose call fails gets no explanation and one
 * warning per distinct error. Returns a copy of the report with Finding.ai set and Report.ai =
 * {provider, model, remote, warnings, explained}. `model` in each explanation is "<provider>/<model>".
 * Never rejects for per-finding errors; rejects only when the signal aborts.
 */
export async function explainFindings(report: Report, client: LlmClient, options: { remote: boolean; signal?: AbortSignal }): Promise<Report> {
  return notImplemented("explainFindings");
}

export type { FindingExplanation };
