/**
 * The pipeline as Web Animations, for /_design/'s range input and its Replay (DESIGN.md §3.14). On the site the
 * pipeline is scrubbed by ScrollTrigger (src/motion/effects/engine.ts); a range input needs no scroll trigger, and
 * seeking a paused Web Animation to any time is what a range does, so this page plays the pipeline's own storyboard
 * (src/motion/effects/pipeline.ts, built from the connectors' measured lengths, as the engine builds it) with the
 * browser's animation engine instead of loading GSAP and ScrollTrigger for it.
 *
 * Each step becomes one keyframe pair on its part: the step's from-state and to-state, starting at its time, for its
 * duration, with its ease (the token's own cubic-bezier(), which Web Animations takes as it is; "none" is linear), and
 * fill "both", so a from-state holds before its step starts, as GSAP's immediateRender holds it, and the end holds
 * after. Scale values become one transform; opacity stays opacity. The pipeline's steps move nothing else, and anything
 * else is an error, not dropped: a storyboard that starts to move x, rotate, draw a stroke, stagger or repeat would
 * otherwise stop matching the site here without a word (design.test.ts plays every step of the real storyboard).
 *
 * Plain data: pipeline-scrub.ts applies it to the page. The storyboard module has only type imports, so importing it
 * here adds none of the motion islands' shared code to this page's chunks (their lazy chunks stay the ones every page
 * loads).
 */
import { type Axis, pipelineStoryboard } from "@/motion/effects/pipeline";
import type { EaseName, Step, TimeToken, Vars } from "@/motion/storyboard";

/** The motion tokens the plan times and eases with, as tokens.css has them: seconds, and CSS easing functions. */
export type PlanTokens = {
  durations: Record<TimeToken, number>;
  eases: Record<Exclude<EaseName, "none">, string>;
};

export type Keyframe = { opacity?: number; transform?: string };

export type PlannedAnimation = {
  part: string;
  index: number;
  /** Seconds from the timeline's start. */
  delay: number;
  duration: number;
  easing: string;
  keyframes: [Keyframe, Keyframe];
};

export type Plan = { animations: PlannedAnimation[]; duration: number };

const supportedVars = new Set<string>(["opacity", "scale", "scaleX", "scaleY"]);

/** A step's state as a keyframe: opacity, and the scales as one transform. Any other property is an error. */
export function keyframeOf(vars: Vars): Keyframe {
  const unsupported = Object.keys(vars).filter((key) => !supportedVars.has(key));
  if (unsupported.length) throw new Error(`pipeline-plan: can't play ${unsupported.join(", ")} as Web Animations`);
  const frame: Keyframe = {};
  if (vars.opacity !== undefined) frame.opacity = vars.opacity;
  const scales = [
    vars.scale !== undefined ? `scale(${vars.scale})` : "",
    vars.scaleX !== undefined ? `scaleX(${vars.scaleX})` : "",
    vars.scaleY !== undefined ? `scaleY(${vars.scaleY})` : "",
  ].filter(Boolean);
  if (scales.length) frame.transform = scales.join(" ");
  return frame;
}

/** Step fields a single keyframe pair can't express: each one set is an error. */
const unsupportedFields = ["times", "stagger", "repeat", "yoyo", "lazyFrom", "clear", "svgOrigin"] as const;

/** One step as one animation on one element. */
export function planStep(step: Step, tokens: PlanTokens): PlannedAnimation {
  if (step.index === undefined) throw new Error(`pipeline step ${step.part} at ${step.at} s names no element`);
  const set = unsupportedFields.filter((field) => step[field] !== undefined && step[field] !== false && step[field] !== 0);
  if (set.length) throw new Error(`pipeline-plan: can't play ${set.join(", ")} (${step.part} at ${step.at} s) as Web Animations`);
  const duration = typeof step.duration === "number" ? step.duration : tokens.durations[step.duration];
  return {
    part: step.part,
    index: step.index,
    delay: step.at,
    duration,
    easing: step.ease === "none" ? "linear" : tokens.eases[step.ease],
    keyframes: [keyframeOf(step.from ?? {}), keyframeOf(step.to)],
  };
}

/** The pipeline's animations for connectors of these lengths (px) on this axis, and the timeline's length (s). */
export function pipelinePlan(lengths: readonly number[], axis: Axis, tokens: PlanTokens): Plan {
  const animations = pipelineStoryboard(lengths, axis).steps.map((step) => planStep(step, tokens));
  const duration = Math.max(0, ...animations.map((a) => a.delay + a.duration));
  return { animations, duration };
}
