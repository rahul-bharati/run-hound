/**
 * How the hero run starts when its island mounts (DESIGN.md §4.4, "The hero island", steps 3-4), as a pure decision.
 *
 * - The 3 s fallback already showed the finished frame and the window is (even partly) in view: the reader saw it, so
 *   the run rests there and Replay appears. Never hide what a reader has seen (§4.6 #9: no flicker).
 * - The fallback fired with the window wholly off screen (phones): nobody saw it, so rewind to the from-state and play
 *   from 0 when the window is half visible (the hound prototype's rewind).
 * - Otherwise, when the window is at least half visible: play at once, from 0, or from the "run" label when the island
 *   mounts later than 1.7 s after navigation (the late-start rule: the finding then lands 0.58 s later).
 * - Not yet half visible: wait, and play from 0 when it is (a run that waited always plays from 0).
 */
/**
 * The late-start rule (§4.4): when the island mounts later than this after navigation and the window is already in
 * view, the run plays from the "run" label (hero-run-storyboard.ts), so the finding lands 0.58 s later, not 1.88 s.
 * (Here, not in the storyboard, so the 404's island, which shares this file, doesn't carry the hero's storyboard.)
 */
export const lateStartAfterMs = 1700;

export type HeroStart = { kind: "rest" } | { kind: "wait" } | { kind: "play"; from: 0 | "run" };

/**
 * How visible a box is (0-1): the share of its height inside a viewport of this height, where a box taller than the
 * viewport counts as wholly visible when it fills it.
 */
export function visibleFraction(rect: { top: number; bottom: number }, viewportHeight: number): number {
  const height = rect.bottom - rect.top;
  if (height <= 0 || viewportHeight <= 0) return 0;
  const inside = Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0);
  return Math.max(0, Math.min(1, inside / Math.min(height, viewportHeight)));
}

/** Half visible: when a waiting run starts, and below which a running one skips to its end. */
export const heroPlayThreshold = 0.5;

export function heroStart({ fallbackShown, visible, sinceNavigationMs }: { fallbackShown: boolean; visible: number; sinceNavigationMs: number }): HeroStart {
  if (fallbackShown) return visible > 0 ? { kind: "rest" } : { kind: "wait" };
  if (visible < heroPlayThreshold) return { kind: "wait" };
  return { kind: "play", from: sinceNavigationMs > lateStartAfterMs ? "run" : 0 };
}
