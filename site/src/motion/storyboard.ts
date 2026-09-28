/**
 * A storyboard (DESIGN.md §4.3) as data: which part moves when, from what to what, for how long, with which ease, and
 * which accent-coloured object it moves. The timelines are built from it (build-storyboard.ts), and the unit tests
 * time it with tokens.css's values (storyboards.test.ts): one accent-coloured thing moves at a time (§4.1 rule 6), the
 * hero's finding lands by 1.9 s, and so on.
 *
 * Only transform, opacity and stroke drawing (rule 5): `draw` is the drawn fraction of a stroke (0-1); rises are the
 * rise tokens ("rise-sm", "rise-md"); other named values ("sweep", "walk") are measured on the page when the timeline
 * is built, never typed in.
 *
 * Plain data and functions: no GSAP, no DOM.
 */
import type { MotionTokens } from "./tokens";

/** The duration tokens a step may name (tokens.css): micro … long, and the motion's own scan, draw and trace. */
export type TimeToken = "micro" | "short" | "medium" | "long" | "scan" | "draw" | "trace";
export type EaseName = "enter" | "exit" | "move" | "stamp" | "none";

/** A value: a number, a rise token, or a length the builder measures ("sweep": the scan's run; "walk": the 404 hound's). */
export type Value = number | "rise-sm" | "rise-md" | "sweep" | "walk";

export type Vars = {
  opacity?: number;
  x?: Value;
  y?: Value;
  scale?: number;
  scaleX?: number;
  scaleY?: number;
  rotation?: number;
  /** The drawn fraction of an SVG stroke, 0-1 (DrawSVG, or a measured dash where DrawSVG isn't loaded). */
  draw?: number;
};

export type Step = {
  /** The data-part that moves ("" for the effect's root itself). */
  part: string;
  /** Seconds from the storyboard's start. */
  at: number;
  /** One start per element of the part, in document order, instead of `at` and `stagger`. */
  times?: readonly number[];
  /** Only this element of the part (0-based, document order). */
  index?: number;
  /** A token, or seconds where the design names a time of its own (the 0.40 s progress bar, the 404's 1.3 s walk). */
  duration: TimeToken | number;
  ease: EaseName;
  /** With `from`, a fromTo; without, a tween from wherever the part is. */
  from?: Vars;
  to: Vars;
  /** Seconds between one element of the part and the next ("stagger": the --motion-stagger token). */
  stagger?: number | "stagger";
  repeat?: number;
  yoyo?: boolean;
  /**
   * The from-state applies when the step starts, not when the timeline is built: for parts that rest invisible by
   * class (the hero's scan line and press ring), which stay hidden until they move.
   */
  lazyFrom?: boolean;
  /**
   * The step's end clears the part's inline opacity and transform (clearProps), so a part that rests hidden does so by
   * its class alone (§4.1 rule 8). On the last step of each rest-hidden part.
   */
  clear?: boolean;
  /** Rotation origin as fractions of the owner <svg>'s viewBox (the 404 hound's neck, as globals.css .line-hound-head). */
  svgOrigin?: readonly [number, number];
  /** The accent-coloured object this step moves (rule 6); undefined for neutral, dim and fail-coloured parts. */
  accent?: string;
};

export type Storyboard = {
  /** Its data-motion name, which is its DOM contract's key (dom-contract.ts). */
  name: "hero-run" | "pipeline" | "evidence-trio" | "card-trace" | "reveal" | "trail-404";
  labels: Record<string, number>;
  /** How many elements carry each part (the DOM contract's counts). */
  parts: Readonly<Record<string, number>>;
  steps: readonly Step[];
};

/** A duration in seconds. */
export function seconds(duration: TimeToken | number, tokens: MotionTokens): number {
  return typeof duration === "number" ? duration : tokens[duration];
}

/** The stagger in seconds between elements. */
export function staggerOf(step: Step, tokens: MotionTokens): number {
  return step.stagger === "stagger" ? tokens.stagger : (step.stagger ?? 0);
}

/** How many elements a step moves. */
export function countOf(step: Step, board: Storyboard): number {
  if (step.index !== undefined || step.part === "") return 1;
  return board.parts[step.part] ?? 1;
}

/** When a step starts and ends, in seconds, over all its elements (repeats included). */
export function stepSpan(step: Step, board: Storyboard, tokens: MotionTokens): [number, number] {
  const length = seconds(step.duration, tokens) * (1 + (step.repeat ?? 0));
  if (step.times?.length) return [Math.min(...step.times), Math.max(...step.times) + length];
  return [step.at, step.at + staggerOf(step, tokens) * (countOf(step, board) - 1) + length];
}

/** When the storyboard comes to rest. */
export function storyboardEnd(board: Storyboard, tokens: MotionTokens): number {
  return Math.max(0, ...board.steps.map((step) => stepSpan(step, board, tokens)[1]));
}

/** Each accent object's moving spans, merged where they touch or overlap. */
export function accentSpans(board: Storyboard, tokens: MotionTokens): Map<string, [number, number][]> {
  const spans = new Map<string, [number, number][]>();
  for (const step of board.steps) {
    if (!step.accent) continue;
    const list = spans.get(step.accent) ?? [];
    list.push(stepSpan(step, board, tokens));
    spans.set(step.accent, list);
  }
  for (const [name, list] of spans) {
    list.sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const span of list) {
      const last = merged.at(-1);
      if (last && span[0] <= last[1] + 1e-9) last[1] = Math.max(last[1], span[1]);
      else merged.push([...span]);
    }
    spans.set(name, merged);
  }
  return spans;
}

/** Every pair of different accent objects that move at the same time (rule 6: none). Touching ends are not overlaps. */
export function accentOverlaps(board: Storyboard, tokens: MotionTokens): string[] {
  const all = [...accentSpans(board, tokens)].flatMap(([name, list]) => list.map((span) => ({ name, span })));
  const found: string[] = [];
  for (let i = 0; i < all.length; i += 1) {
    for (let j = i + 1; j < all.length; j += 1) {
      const a = all[i];
      const b = all[j];
      if (a.name === b.name) continue;
      const overlap = Math.min(a.span[1], b.span[1]) - Math.max(a.span[0], b.span[0]);
      if (overlap > 1e-9) {
        const round = (n: number) => Math.round(n * 1000) / 1000;
        found.push(`${board.name}: ${a.name} ${a.span.map(round).join("-")} s and ${b.name} ${b.span.map(round).join("-")} s move at once`);
      }
    }
  }
  return found;
}
