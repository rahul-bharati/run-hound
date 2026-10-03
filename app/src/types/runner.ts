/** Runner engine type aliases: the events the engine emits to onProgress. */

import type { CheckGroup, CheckResult } from "../core/types.js";

export type ProgressEvent =
  | { type: "scenario-start"; scenarioId: string; index: number; total: number; group: CheckGroup }
  | { type: "group-start"; group: CheckGroup; label: string; index: number; total: number; scenarios: number }
  | { type: "scenario-end"; scenarioId: string; result: CheckResult }
  | { type: "step"; scenarioId: string; label: string; url: string; at: string }
  | { type: "page"; scenarioId: string; url: string; at: string }
  | { type: "browser"; name: string }
  | { type: "frame"; scenarioId: string; url: string; jpeg: Buffer; at: string };
