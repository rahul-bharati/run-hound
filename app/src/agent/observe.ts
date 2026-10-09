/**
 * Observations (A3a, docs/agent-spec.md "Observations"): Playwright's AI-mode aria snapshot made safe to show a model.
 * Pure: the snapshot JSON in, a PageObservation and the refs it issued out, so it is tested without a browser.
 */

import type { PageObservation } from "../interfaces/agent.js";

/** What the page was when it was snapshotted; the snapshot itself is the tree. */
export interface ObservationMeta {
  /** This observation's number: the prefix of every ref it issues ("4.e17"). */
  number: number;
  /** The target's origin: links on it show their path, others their origin. */
  origin: string;
  /** The page's path (no query or hash). */
  path: string;
  title: string | null;
  status: number | null;
  problems: PageObservation["problems"];
  dialog: PageObservation["dialog"];
}

/**
 * The observation for `snapshot` (the value page.ariaSnapshotJSON({ mode: "ai" }) returned), and the refs it issued:
 * each model-visible ref ("4.e17") mapped to Playwright's ("e17"). `hide` redacts every name and text before it is
 * cut. Field values become `filled`, a select's options its `options`, iframes lose their content, empty generic
 * wrappers are flattened, controls isDestructiveControl refuses are marked, and the tree is cut to
 * AGENT_OBSERVATION_LIMITS (then `truncated`). Anything that isn't a node is ignored.
 */
export function toObservation(
  snapshot: unknown,
  meta: ObservationMeta,
  hide: (text: string) => string,
): { observation: PageObservation; refs: Map<string, string> } {
  void snapshot, meta, hide;
  throw new Error("not implemented (A3a)");
}
