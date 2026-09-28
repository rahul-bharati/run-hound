/**
 * Builds a paused GSAP timeline from a storyboard (storyboard.ts). GSAP is passed in (the islands pass the real one,
 * the tests a fake that records the calls), so this file imports no GSAP and runs in Node's tests.
 *
 * - Steps with a from-state are fromTo tweens whose from-state applies at once (immediateRender), so a held part stays
 *   hidden when the hold is released; `lazyFrom` steps apply theirs only when they start (parts resting hidden by class).
 * - Rises are the rise tokens in px; strokes draw with the path's measured length as a dash ("dash": every island and
 *   effect, so no page loads DrawSVG, whose 1.9 KB kept the lazy motion over its §5.2 budgets) or with DrawSVG
 *   ("drawsvg", for a caller that loads it). Either way no path length is typed in (G-H2).
 * - A `clear` step ends by clearing the part's inline opacity and transform: rest-hidden parts rest by class alone.
 * - Named eases are the token curves as functions (GSAP core ignores cubic-bezier() strings); "none" is linear.
 */
import type { Ease, MotionTokens } from "./tokens";
import { type EaseName, seconds, type Step, type Storyboard, staggerOf, type Value, type Vars } from "./storyboard";

export type TimelineLike = {
  addLabel(label: string, position?: number): unknown;
  fromTo(targets: unknown, fromVars: object, toVars: object, position?: number): unknown;
  to(targets: unknown, vars: object, position?: number): unknown;
};
export type GsapLike<T extends TimelineLike> = { timeline(vars?: object): T };

export type BuildOptions = {
  draw: "drawsvg" | "dash";
  /** Values measured on the page when the timeline is built: the hero scan's sweep, the 404 hound's walk. */
  measures?: Partial<Record<"sweep" | "walk", (element: Element) => number>>;
  /** More timeline vars (defaults, callbacks). */
  timeline?: Record<string, unknown>;
};

type FunctionValue = (index: number, target: Element) => number | string;

const easeOf = (name: EaseName, tokens: MotionTokens): Ease | "none" => (name === "none" ? "none" : tokens[name]);

/** A stroke's length, as DrawSVG measures it (0 when the browser can't: the dash then draws nothing, harmlessly). */
function strokeLength(element: Element): number {
  try {
    return (element as SVGGeometryElement).getTotalLength?.() ?? 0;
  } catch {
    return 0;
  }
}

/** "x y" in the owner <svg>'s viewBox, at fractions of its size. */
function svgOriginOf(element: Element | undefined, [fx, fy]: readonly [number, number]): string | undefined {
  const svg = (element as SVGGraphicsElement | undefined)?.ownerSVGElement ?? (element as SVGSVGElement | undefined);
  const box = svg?.viewBox?.baseVal;
  if (!box || !box.width) return undefined;
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return `${round(box.x + box.width * fx)} ${round(box.y + box.height * fy)}`;
}

function resolveVars(vars: Vars, tokens: MotionTokens, options: BuildOptions): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const value = (v: Value): number | FunctionValue => {
    if (typeof v === "number") return v;
    if (v === "rise-sm") return tokens.riseSm;
    if (v === "rise-md") return tokens.riseMd;
    const measure = options.measures?.[v];
    return (_index: number, target: Element) => (measure ? measure(target) : 0);
  };
  for (const [key, v] of Object.entries(vars) as [keyof Vars, Value][]) {
    if (key === "draw") {
      const drawn = v as number;
      if (options.draw === "drawsvg") out.drawSVG = `${drawn * 100}%`;
      else out.strokeDashoffset = (_index: number, target: Element) => strokeLength(target) * (1 - drawn);
    } else out[key] = value(v);
  }
  return out;
}

/** The elements of a part inside a root ("" is the root itself), in document order. */
export const partsOf = (root: Element) => (part: string) =>
  part === "" ? [root] : Array.from(root.querySelectorAll(`[data-part="${part}"]`));

/** The elements a step moves. */
function targetsOf(step: Step, select: (part: string) => Element[]): Element[] {
  const all = select(step.part);
  if (step.index === undefined) return all;
  return all[step.index] ? [all[step.index]] : [];
}

export function buildStoryboard<T extends TimelineLike>(
  gsap: GsapLike<T>,
  board: Storyboard,
  select: (part: string) => Element[],
  tokens: MotionTokens,
  options: BuildOptions,
): T {
  const timeline = gsap.timeline({ paused: true, ...options.timeline });
  for (const [label, at] of Object.entries(board.labels)) timeline.addLabel(label, at);
  for (const step of board.steps) {
    const targets = targetsOf(step, select);
    if (targets.length === 0) continue;
    const origin = step.svgOrigin ? svgOriginOf(targets[0], step.svgOrigin) : undefined;
    const to: Record<string, unknown> = {
      ...resolveVars(step.to, tokens, options),
      duration: seconds(step.duration, tokens),
      ease: easeOf(step.ease, tokens),
      ...(step.repeat ? { repeat: step.repeat } : {}),
      ...(step.yoyo ? { yoyo: true } : {}),
      ...(origin ? { svgOrigin: origin } : {}),
      ...(step.clear ? { clearProps: "opacity,transform" } : {}),
    };
    let from: Record<string, unknown> | undefined;
    if (step.from) {
      from = { ...resolveVars(step.from, tokens, options), ...(origin ? { svgOrigin: origin } : {}) };
      // A dash needs its pattern (the stroke's length) before an offset means anything.
      const draws = step.from.draw !== undefined || step.to.draw !== undefined;
      if (draws && options.draw === "dash") from.strokeDasharray = (_index: number, target: Element) => `${strokeLength(target)} ${strokeLength(target)}`;
      to.immediateRender = !step.lazyFrom;
    }
    const add = (what: Element | Element[], position: number) => {
      if (from) timeline.fromTo(what, from, to, position);
      else timeline.to(what, to, position);
    };
    if (step.times?.length) {
      targets.forEach((target, i) => add(target, step.times![Math.min(i, step.times!.length - 1)]));
    } else {
      const stagger = staggerOf(step, tokens);
      if (stagger && targets.length > 1) to.stagger = stagger;
      add(step.index === undefined ? targets : targets[0], step.at);
    }
  }
  return timeline;
}

// ---- Rest -----------------------------------------------------------------------------------------------------------
// Here, with the builder, because every island and effect that builds a timeline also rests GSAP, so the bundler keeps
// it in GSAP core's lazy chunk rather than a copy in each island's chunk (§5.2 lazy-JS budgets).

/**
 * restWhenIdle puts GSAP's ticker to sleep once nothing moves (DESIGN.md §4.1 rule 9: no requestAnimationFrame loop
 * at rest). GSAP sleeps by itself only every 120 frames (gsap-core.js Timeline.updateRoot, autoSleep), which can leave
 * its loop running for up to 2 s after the last tween, into the lab's rest window. Any new or resumed animation wakes
 * it again (gsap-core.js: the Animation constructor and paused(false) call _wake). GSAP is passed in, so this runs in
 * tests (rest.test.ts).
 */
type Animation = { paused(): boolean; progress(): number };
export type RestGsap = {
  globalTimeline: { getChildren(nested?: boolean, tweens?: boolean, timelines?: boolean): Animation[] };
  ticker: { sleep(): void };
};

/** Sleeps the ticker if every top-level animation is paused or finished; returns whether it did. */
export function restWhenIdle(gsap: RestGsap): boolean {
  const moving = gsap.globalTimeline.getChildren(false, true, true).some((animation) => !animation.paused() && animation.progress() < 1);
  if (moving) return false;
  gsap.ticker.sleep();
  return true;
}
