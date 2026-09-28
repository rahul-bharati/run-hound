/**
 * The evidence trio (DESIGN.md §4.3; How it works band, one-shot when its top reaches 78% of the viewport): the three
 * pictures rise, an accent outline draws round them, the EVIDENCE stamp lands on its top-right edge, then the accent
 * outline hands over to the line-strong one, so the stamp stands alone at rest (§2.3). Captions never move.
 */
import type { Storyboard } from "../storyboard";

export const evidenceTrioStoryboard: Storyboard = {
  name: "evidence-trio",
  labels: {},
  parts: { media: 3, "outline-accent": 1, "outline-rest": 1, stamp: 1 }, // the DOM contract's (storyboards.test.ts)
  steps: [
    { part: "media", at: 0, stagger: 0.12, duration: "medium", ease: "enter", from: { opacity: 0, y: "rise-md" }, to: { opacity: 1, y: 0 } },
    // The accent outline rests hidden by class: it shows only while it draws.
    { part: "outline-accent", at: 0.1, duration: "draw", ease: "move", from: { opacity: 1, draw: 0 }, to: { draw: 1 }, lazyFrom: true, accent: "outline" },
    { part: "stamp", at: 1.0, duration: "short", ease: "stamp", from: { opacity: 0, scale: 1.15, rotation: -12 }, to: { opacity: 1, scale: 1, rotation: -4 }, accent: "stamp" },
    { part: "outline-accent", at: 1.2, duration: "long", ease: "exit", to: { opacity: 0 }, accent: "outline", clear: true },
    { part: "outline-rest", at: 1.2, duration: "long", ease: "enter", from: { opacity: 0 }, to: { opacity: 1 } },
  ],
};

/** Where it plays: when its top reaches 78% of the viewport. */
export const evidenceTrioAt = 0.78;
