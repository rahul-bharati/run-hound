/**
 * The scroll effects' engine: GSAP core and the one-shot builder, in the lazy chunk the scroll runtime loads when the
 * first effect comes within half a viewport (DESIGN.md §4.4; scroll-effects.ts imports this, and /_design/ does to
 * replay the one-shots). Only the figure reveal's storyboard is in it: the homepage's one-shots (evidence trio, check
 * cards) are imported by `load` for a page that has them (home-one-shots.ts), and the pipeline's builder with
 * ScrollTrigger (pipeline-engine.ts) only when the pipeline comes near (loadScrollTrigger), so a page with reveals alone
 * loads neither (§5.2). Strokes draw with their measured length as a dash, as the hero's ticks do, so no page loads
 * DrawSVG. Each effect is built inside its own gsap.context, so kill() reverts it to the server's frame.
 */
import { gsap } from "gsap";
import { buildStoryboard, partsOf, restWhenIdle } from "../build-storyboard";
import type { BuiltEffect, EffectName, ScrollTriggerLike } from "../runtime-core";
import type { Storyboard } from "../storyboard";
import { readMotionTokens } from "../tokens";
import { revealStoryboard } from "./reveal";

type OneShot = Exclude<EffectName, "pipeline">;

/** The one-shots' storyboards: the reveal's, and the homepage's once `load` has imported them. */
const oneShots: Partial<Record<OneShot, Storyboard>> = { reveal: revealStoryboard };

/** Loads what building these effects needs, beyond this chunk: the homepage's one-shots, if any is among them. */
export async function load(names: Iterable<string>): Promise<void> {
  if ([...names].some((name) => name === "evidence-trio" || name === "card-trace")) {
    Object.assign(oneShots, (await import("./home-one-shots")).homeOneShots);
  }
}

/** The pipeline's builder, once ScrollTrigger is loaded. */
let pipeline: typeof import("./pipeline-engine") | undefined;

/**
 * Imports the pipeline's builder with ScrollTrigger, and registers ScrollTrigger (registering enables it:
 * ScrollTrigger.register calls enable()). The runtime parks and resumes it through keepProgressOnEnable, so a resume
 * never rewinds the pipeline.
 */
export async function loadScrollTrigger(): Promise<ScrollTriggerLike> {
  pipeline = await import("./pipeline-engine");
  return pipeline.registerScrollTrigger();
}

function buildOneShot(name: OneShot, root: HTMLElement, done: () => void): BuiltEffect {
  let timeline!: gsap.core.Timeline;
  const context = gsap.context(() => {
    timeline = buildStoryboard(gsap, oneShots[name]!, partsOf(root), readMotionTokens(), { draw: "dash", timeline: { onComplete: done } });
  });
  return {
    play: () => timeline.play(),
    finish: () => timeline.progress(1),
    progress: () => timeline.progress(),
    setProgress: (value) => timeline.progress(value),
    kill: () => context.revert(),
  };
}

/**
 * Builds an effect, setting its from-state; `done` is called when it completes. The runtime builds only once `load`
 * has resolved (its loadCore), and the pipeline only once loadScrollTrigger has too (runtime-core.ts ensureBuilt).
 */
export function build(name: EffectName, root: HTMLElement, done: () => void): BuiltEffect {
  return name === "pipeline" ? pipeline!.buildPipeline(root, done) : buildOneShot(name, root, done);
}

/** Puts GSAP's ticker to sleep if nothing moves. */
export const rest = () => restWhenIdle(gsap);
