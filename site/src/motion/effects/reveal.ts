/**
 * A below-the-fold figure reveal (DESIGN.md §4.3; /how-it-works/, /demo/, check pages): the figure's media wrapper
 * (data-motion="reveal", primitives/figure.tsx) rises 16 px with opacity, once, when its top reaches 88% of the
 * viewport. Its caption never moves.
 */
import type { Storyboard } from "../storyboard";

export const revealStoryboard: Storyboard = {
  name: "reveal",
  labels: {},
  parts: {},
  steps: [{ part: "", at: 0, duration: "medium", ease: "enter", from: { opacity: 0, y: "rise-md" }, to: { opacity: 1, y: 0 } }],
};

/** Where it plays: when its top reaches 88% of the viewport. */
export const revealAt = 0.88;
