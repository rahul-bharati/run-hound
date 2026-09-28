/**
 * The motion tokens src/motion/tokens.ts reads in the browser (getComputedStyle on <html>), by name. The values live
 * only in src/styles/tokens.css (DESIGN.md §4.2); src/styles/tokens.test.ts fails if a name here is missing there, so
 * the motion code and the CSS can't drift apart. Durations and eases are Tailwind theme tokens (@theme static, always
 * emitted); the distances and times are plain custom properties on :root, which reduced motion sets to 0.
 * (--motion-ring, the :target card's ring, is CSS only and not read here.)
 *
 * The browser reads the values of the build's minified CSS, not tokens.css as written: times in s or ms, with
 * leading-dot decimals, and 0ms as 0s. From `next build` (16.3.5, 28 September 2026): --transition-duration-micro
 * ".12s", --transition-duration-long ".45s", --motion-stagger "40ms" ("0s" under reduce), --motion-scan ".6s",
 * --motion-draw ".9s", --motion-hold "3s", --motion-rise-sm "8px" ("0px" under reduce) and --ease-stamp
 * "cubic-bezier(.34, 1.56, .64, 1)". src/motion/tokens.ts parses these exact forms.
 */
export const motionTokenNames = {
  durations: [
    "--transition-duration-micro",
    "--transition-duration-short",
    "--transition-duration-medium",
    "--transition-duration-long",
  ],
  eases: ["--ease-enter", "--ease-exit", "--ease-move", "--ease-stamp"],
  distances: [
    "--motion-rise-sm",
    "--motion-rise-md",
    "--motion-nudge",
    "--motion-stagger",
    "--motion-scan",
    "--motion-draw",
    "--motion-trace",
    "--motion-hold",
  ],
} as const;

export type DurationToken = (typeof motionTokenNames.durations)[number];
export type EaseToken = (typeof motionTokenNames.eases)[number];
export type DistanceToken = (typeof motionTokenNames.distances)[number];
