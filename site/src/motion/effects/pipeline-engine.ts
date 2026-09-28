/**
 * The pipeline's builder and ScrollTrigger, the one lazy chunk the scroll effects' engine (engine.ts) imports when the
 * pipeline comes within half a viewport (DESIGN.md §4.4): the only ScrollTrigger user, so no other page loads it, and
 * a visit that never scrolls near the pipeline never does (§4.6 #11).
 */
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { buildStoryboard, partsOf } from "../build-storyboard";
import type { BuiltEffect, ScrollTriggerLike } from "../runtime-core";
import { readMotionTokens } from "../tokens";
import { connectorOrigin, pipelineScroll, pipelineScrub, pipelineStoryboard } from "./pipeline";
import { pipelineDesktopQuery } from "./pipeline-query";
import { keepProgressOnEnable } from "./resume";

/** The pipeline's timeline while it scrubs (one pipeline per page). */
let scrubbing: gsap.core.Timeline | undefined;

/** Registers ScrollTrigger (which enables it) and hands it to the runtime, resumed without rewinding the pipeline. */
export function registerScrollTrigger(): ScrollTriggerLike {
  gsap.registerPlugin(ScrollTrigger);
  return keepProgressOnEnable(ScrollTrigger, () => scrubbing);
}

export function buildPipeline(root: HTMLElement, done: () => void): BuiltEffect {
  const axis = matchMedia(pipelineDesktopQuery).matches ? "x" : "y";
  const parts = partsOf(root);
  const connectors = parts("connector") as HTMLElement[];
  // Layout lengths (offsetWidth/Height ignore transforms, so the connectors measure the same whatever their scale).
  const board = pipelineStoryboard(
    connectors.map((connector) => (axis === "x" ? connector.offsetWidth : connector.offsetHeight)),
    axis,
  );
  let completed = false;
  const complete = () => {
    if (completed) return;
    completed = true;
    done();
  };
  let timeline!: gsap.core.Timeline;
  let trigger: ScrollTrigger | undefined;
  const context = gsap.context(() => {
    gsap.set(connectors, { transformOrigin: connectorOrigin[axis] });
    timeline = buildStoryboard(gsap, board, parts, readMotionTokens(), { draw: "dash", timeline: { onComplete: complete } });
    scrubbing = timeline;
    trigger = ScrollTrigger.create({
      trigger: root,
      ...pipelineScroll[axis],
      scrub: pipelineScrub,
      animation: timeline,
      onScrubComplete: () => {
        if (timeline.progress() === 1) complete();
      },
    });
  });
  return {
    play: () => {},
    finish: () => {
      // Kill the trigger but keep its animation, at its end: the line stays drawn.
      trigger?.kill(false, true);
      timeline.progress(1);
      if (scrubbing === timeline) scrubbing = undefined;
    },
    progress: () => timeline.progress(),
    setProgress: (value) => timeline.progress(value),
    kill: () => {
      context.revert();
      if (scrubbing === timeline) scrubbing = undefined;
    },
  };
}
