/**
 * The pipeline at any progress on /_design/ (DESIGN.md §3.14): pipeline-plan.ts's animations, created paused on the
 * page's pipeline and seeked to the progress asked for. At 1 they are cancelled, which leaves the server's finished
 * frame. A breakpoint change rebuilds them for the other axis, at the same progress.
 *
 * The tokens are read from <html>'s computed style, where tokens.css puts them (the only copy of the numbers): the
 * browser hands over the minified values ("120ms" as ".12s", "cubic-bezier(.2, 0, 0, 1)"), which Web Animations takes
 * as they are, once the times are in milliseconds.
 *
 * Loaded by design-motion.tsx on the first use of the range or its Replay, so nothing is requested on first load.
 */
import { type Axis, connectorOrigin } from "@/motion/effects/pipeline";
import { pipelineDesktopQuery } from "@/motion/effects/pipeline-query";
import { type Plan, type PlanTokens, pipelinePlan } from "./pipeline-plan";

export type PipelineScrub = {
  /** The timeline's own length in seconds: the line's one second and the last ring's light-up. */
  readonly duration: number;
  /** Draws the pipeline at `progress` (0-1). */
  set(progress: number): void;
  /** Back to the server's frame, and stop following the breakpoint. */
  destroy(): void;
};

/** Seconds from a CSS time as the browser returns it ("120ms", ".12s", "0s"). */
export function parseSeconds(value: string): number | undefined {
  const match = /^(\d*\.?\d+)(ms|s)$/.exec(value.trim());
  if (!match) return undefined;
  return match[2] === "ms" ? Number(match[1]) / 1000 : Number(match[1]);
}

const durationNames = {
  micro: "--transition-duration-micro",
  short: "--transition-duration-short",
  medium: "--transition-duration-medium",
  long: "--transition-duration-long",
  scan: "--motion-scan",
  draw: "--motion-draw",
  trace: "--motion-trace",
} as const;
const easeNames = { enter: "--ease-enter", exit: "--ease-exit", move: "--ease-move", stamp: "--ease-stamp" } as const;

/** The tokens from <html>'s computed style; a token the page lacks is an error, not a guess. */
export function readPlanTokens(style: Pick<CSSStyleDeclaration, "getPropertyValue">): PlanTokens {
  const read = (name: string) => {
    const value = style.getPropertyValue(name).trim();
    if (!value) throw new Error(`${name} is not set on <html> (src/styles/tokens.css)`);
    return value;
  };
  const durations = Object.fromEntries(
    Object.entries(durationNames).map(([token, name]) => {
      const seconds = parseSeconds(read(name));
      if (seconds === undefined) throw new Error(`${name} is not a time`);
      return [token, seconds];
    }),
  ) as PlanTokens["durations"];
  const eases = Object.fromEntries(Object.entries(easeNames).map(([token, name]) => [token, read(name)])) as PlanTokens["eases"];
  return { durations, eases };
}

export function createPipelineScrub(root: HTMLElement): PipelineScrub {
  const query = matchMedia(pipelineDesktopQuery);
  const partsOf = (part: string) => Array.from(root.querySelectorAll<HTMLElement>(`[data-part="${part}"]`));
  let plan: Plan = { animations: [], duration: 0 };
  let running: Animation[] = [];
  let progress = 1;

  const cancel = () => {
    for (const animation of running) animation.cancel();
    running = [];
  };

  const build = () => {
    const axis: Axis = query.matches ? "x" : "y";
    const connectors = partsOf("connector");
    // Each connector grows from where the engine grows it (engine.ts sets the same origin), not only from home.css's.
    for (const connector of connectors) connector.style.transformOrigin = connectorOrigin[axis];
    // Layout lengths (offsetWidth and offsetHeight ignore transforms), as the engine measures them.
    const lengths = connectors.map((connector) => (axis === "x" ? connector.offsetWidth : connector.offsetHeight));
    plan = pipelinePlan(lengths, axis, readPlanTokens(getComputedStyle(document.documentElement)));
  };

  const apply = () => {
    if (progress >= 1) {
      cancel();
      return;
    }
    if (running.length === 0) {
      running = plan.animations.flatMap((planned) => {
        const target = partsOf(planned.part)[planned.index];
        if (!target) return [];
        const animation = target.animate(planned.keyframes, {
          delay: planned.delay * 1000,
          duration: planned.duration * 1000,
          easing: planned.easing,
          fill: "both",
        });
        animation.pause();
        return [animation];
      });
    }
    for (const animation of running) animation.currentTime = progress * plan.duration * 1000;
  };

  const onBreakpoint = () => {
    cancel();
    build();
    apply();
  };
  build();
  query.addEventListener("change", onBreakpoint);

  return {
    get duration() {
      return plan.duration;
    },
    set(value: number) {
      progress = Math.min(1, Math.max(0, value));
      apply();
    },
    destroy() {
      query.removeEventListener("change", onBreakpoint);
      progress = 1;
      cancel();
    },
  };
}
