/**
 * The pipeline (DESIGN.md §4.3; How it works band): the one scrubbed effect, and the only ScrollTrigger user. Four
 * connectors (CSS <span>s on the dashed track) scale from 0 at their node, at a constant speed (durations
 * proportional to their measured lengths, ease none), and ring i + 1 lights as connector i completes; ring 1 is lit
 * from the start. Numbers and step text never move; the dashed track is always there, so the diagram reads before,
 * during and after.
 *
 * Desktop (from 1024 px, 5 equal columns): connectors scale on x from the left node, while the steps row's top moves
 * from 78% to 38% of the viewport. Phones: on y from the upper node, from "top 78%" to "bottom 62%". Scrub 0.6.
 */
import type { Step, Storyboard } from "../storyboard";

export type Axis = "x" | "y";

/** The connectors' timeline: one second in all, shared in proportion to their lengths, so the line keeps one speed. */
export function pipelineStoryboard(lengths: readonly number[], axis: Axis = "x"): Storyboard {
  const total = lengths.reduce((sum, length) => sum + length, 0) || 1;
  const scale = axis === "x" ? "scaleX" : "scaleY";
  const steps: Step[] = [];
  let at = 0;
  lengths.forEach((length, i) => {
    const duration = length / total;
    steps.push({ part: "connector", index: i, at, duration, ease: "none", from: { [scale]: 0 }, to: { [scale]: 1 }, accent: "line" });
    at += duration;
    steps.push({ part: "node-ring", index: i + 1, at, duration: "micro", ease: "move", from: { opacity: 0, scale: 0.6 }, to: { opacity: 1, scale: 1 }, accent: "line" });
  });
  // Connectors first, then rings, as the tests read them.
  steps.sort((a, b) => (a.part === b.part ? 0 : a.part === "connector" ? -1 : 1));
  // The DOM contract's counts (storyboards.test.ts keeps them equal).
  return { name: "pipeline", labels: {}, parts: { connector: 4, "node-ring": 5 }, steps };
}

/** Where each connector grows from: the left node across, the upper node down. */
export const connectorOrigin: Record<Axis, string> = { x: "0% 50%", y: "50% 0%" };

/** The scroll range the pipeline is scrubbed over (ScrollTrigger start and end), and its smoothing. */
export const pipelineScroll: Record<Axis, { start: string; end: string }> = {
  x: { start: "top 78%", end: "top 38%" },
  y: { start: "top 78%", end: "bottom 62%" },
};
export const pipelineScrub = 0.6;
