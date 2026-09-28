/**
 * The 404 (DESIGN.md §4.3): the dim trail draws left to right while the line hound walks along it, dipping its nose
 * twice; where the trail ends it lifts its nose and settles. About 1.8 s, once; GSAP core (the trail draws as a dash). The hound's
 * accent brow moves with it, so the hound is the one accent object; the trail is dim.
 */
import type { Storyboard } from "./storyboard";

/** The head turns round the neck: 35% / 85% of the hound's viewBox, as globals.css .line-hound-head has it. */
const neck = [0.35, 0.85] as const;
const walk = 1.3;

export const trail404Storyboard: Storyboard = {
  name: "trail-404",
  labels: {},
  parts: { trail: 1, hound: 1, head: 1 }, // the DOM contract's (storyboards.test.ts keeps them equal)
  steps: [
    { part: "trail", at: 0, duration: walk, ease: "move", from: { draw: 0 }, to: { draw: 1 } },
    // From the trail's start (measured) to where the server put it, at the trail's end.
    { part: "hound", at: 0, duration: walk, ease: "move", from: { x: "walk" }, to: { x: 0 }, accent: "hound" },
    { part: "head", at: 0.4, duration: "micro", repeat: 1, yoyo: true, ease: "move", from: { rotation: 0 }, to: { rotation: 6 }, svgOrigin: neck, accent: "hound" },
    { part: "head", at: 0.85, duration: "micro", repeat: 1, yoyo: true, ease: "move", from: { rotation: 0 }, to: { rotation: 6 }, svgOrigin: neck, accent: "hound" },
    { part: "head", at: walk, duration: "medium", ease: "stamp", to: { rotation: -10 }, svgOrigin: neck, accent: "hound" },
    { part: "head", at: 1.58, duration: "short", ease: "move", to: { rotation: -6 }, svgOrigin: neck, accent: "hound" },
  ],
};
