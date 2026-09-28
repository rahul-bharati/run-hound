/**
 * The motion tokens, read in the browser (DESIGN.md §4.2). src/styles/tokens.css holds the only copy of the numbers;
 * this reads them from <html>'s computed style by the names in src/styles/motion-token-names.ts, with the CSS's own
 * values as fallbacks (tokens.test.ts keeps the two equal).
 *
 * The browser hands over the minified CSS: "900ms" arrives as ".9s", reduced motion's "0ms" as "0s", and
 * "cubic-bezier(0.34, 1.56, 0.64, 1)" as "cubic-bezier(.34, 1.56, .64, 1)", so times parse in ms and s and a zero is a
 * value, never a missing token. GSAP core silently ignores cubic-bezier() strings without CustomEase (gsap-core.js
 * _parseEase falls back to its default ease), so each curve becomes an ease function here, solved for x with Newton
 * steps, then bisection (the hound prototype's cubicBezier).
 *
 * No GSAP, no React: the motion gate never loads it; the islands and the scroll runtime do.
 */
import { motionTokenNames } from "@/styles/motion-token-names";

export type Ease = (progress: number) => number;

/** Everything src/motion/ times and moves with: durations in seconds, distances in px, eases as functions. */
export type MotionTokens = {
  micro: number;
  short: number;
  medium: number;
  long: number;
  enter: Ease;
  exit: Ease;
  move: Ease;
  stamp: Ease;
  riseSm: number;
  riseMd: number;
  nudge: number;
  stagger: number;
  scan: number;
  draw: number;
  trace: number;
  hold: number;
};

type TokenName =
  | (typeof motionTokenNames.durations)[number]
  | (typeof motionTokenNames.eases)[number]
  | (typeof motionTokenNames.distances)[number];

/** tokens.css's values, used when the computed style has none (or one this can't read). */
export const tokenFallbacks: Record<TokenName, string> = {
  "--transition-duration-micro": "120ms",
  "--transition-duration-short": "180ms",
  "--transition-duration-medium": "280ms",
  "--transition-duration-long": "450ms",
  "--ease-enter": "cubic-bezier(0.22, 1, 0.36, 1)",
  "--ease-exit": "cubic-bezier(0.3, 0, 0.8, 0.15)",
  "--ease-move": "cubic-bezier(0.2, 0, 0, 1)",
  "--ease-stamp": "cubic-bezier(0.34, 1.56, 0.64, 1)",
  "--motion-rise-sm": "8px",
  "--motion-rise-md": "16px",
  "--motion-nudge": "2px",
  "--motion-stagger": "40ms",
  "--motion-scan": "600ms",
  "--motion-draw": "900ms",
  "--motion-trace": "800ms",
  "--motion-hold": "3s",
};

const number = String.raw`(?:\d+\.?\d*|\.\d+)`;

/** Seconds from a CSS time ("120ms", ".12s", "0s"); undefined for anything else. */
export function parseTime(value: string): number | undefined {
  const match = new RegExp(`^(${number})(ms|s)$`).exec(value.trim());
  if (!match) return undefined;
  const amount = Number(match[1]);
  return match[2] === "ms" ? Math.round(amount) / 1000 : amount;
}

/** Pixels from a CSS length in px ("8px", "0px", or a bare "0"); undefined for anything else. */
export function parseLength(value: string): number | undefined {
  const text = value.trim();
  if (text === "0") return 0;
  const match = new RegExp(`^(${number})px$`).exec(text);
  return match ? Number(match[1]) : undefined;
}

/** A CSS cubic-bezier(x1, y1, x2, y2) as an ease: progress in 0-1 (x) to the eased value (y). */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): Ease {
  // Polynomial coefficients of x(t) and y(t) (the curve runs from (0, 0) to (1, 1)).
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const xAt = (t: number) => ((ax * t + bx) * t + cx) * t;
  const yAt = (t: number) => ((ay * t + by) * t + cy) * t;
  const slope = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    // Newton's method from t = x converges in a few steps on these curves…
    let t = x;
    for (let i = 0; i < 8; i += 1) {
      const error = xAt(t) - x;
      if (Math.abs(error) < 1e-7) return yAt(t);
      const d = slope(t);
      if (Math.abs(d) < 1e-6) break;
      t -= error / d;
    }
    // …and bisection finishes where it can't (a flat stretch of x(t)). x(t) is monotonic for x1, x2 in 0-1.
    let low = 0;
    let high = 1;
    t = x;
    for (let i = 0; i < 40; i += 1) {
      const value = xAt(t);
      if (Math.abs(value - x) < 1e-7) break;
      if (value < x) low = t;
      else high = t;
      t = (low + high) / 2;
    }
    return yAt(t);
  };
}

/** An ease from "cubic-bezier(a, b, c, d)"; undefined for anything else. */
export function parseEase(value: string): Ease | undefined {
  const match = /^cubic-bezier\(([^)]*)\)$/.exec(value.trim());
  if (!match) return undefined;
  const parts = match[1].split(",").map((part) => part.trim());
  if (parts.length !== 4 || parts.some((part) => !new RegExp(`^-?${number}$`).test(part))) return undefined;
  const [a, b, c, d] = parts.map(Number);
  return cubicBezier(a, b, c, d);
}

type Environment = { document: Document; getComputedStyle: (element: Element) => CSSStyleDeclaration };

/**
 * The tokens, read through `read` (a custom property's value by name), or from <html>'s computed style in the browser.
 * A value this can't read falls back to tokens.css's.
 */
export function readMotionTokens(read?: (name: TokenName) => string, environment?: Environment): MotionTokens {
  let reader = read;
  if (!reader) {
    const env = environment ?? (globalThis as unknown as Environment);
    const style = env.getComputedStyle(env.document.documentElement);
    reader = (name) => style.getPropertyValue(name);
  }
  const get = reader;
  const time = (name: TokenName) => parseTime(get(name) ?? "") ?? parseTime(tokenFallbacks[name])!;
  const length = (name: TokenName) => parseLength(get(name) ?? "") ?? parseLength(tokenFallbacks[name])!;
  const ease = (name: TokenName) => parseEase(get(name) ?? "") ?? parseEase(tokenFallbacks[name])!;
  return {
    micro: time("--transition-duration-micro"),
    short: time("--transition-duration-short"),
    medium: time("--transition-duration-medium"),
    long: time("--transition-duration-long"),
    enter: ease("--ease-enter"),
    exit: ease("--ease-exit"),
    move: ease("--ease-move"),
    stamp: ease("--ease-stamp"),
    riseSm: length("--motion-rise-sm"),
    riseMd: length("--motion-rise-md"),
    nudge: length("--motion-nudge"),
    stagger: time("--motion-stagger"),
    scan: time("--motion-scan"),
    draw: time("--motion-draw"),
    trace: time("--motion-trace"),
    hold: time("--motion-hold"),
  };
}

/** The tokens at tokens.css's values, without a browser: what the storyboard tests time the storyboards with. */
export const cssTokens = (): MotionTokens => readMotionTokens(() => "");
