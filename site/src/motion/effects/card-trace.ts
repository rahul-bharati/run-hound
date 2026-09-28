/**
 * The check cards (DESIGN.md §4.3; homepage checks band, one-shot when its top reaches 80% of the viewport): a dim
 * trace draws round each card and fades, and each card's four accent ticks draw. The cards, their borders and all
 * their words are there throughout; nothing mint remains but the ticks. Ends at about 1.5 s.
 */
import type { Step, Storyboard } from "../storyboard";

const cards = 3;
const ticksPerCard = 4;
/** Seconds between one card and the next, and one tick and the next. */
const cardGap = 0.14;
const tickGap = 0.05;
/** The trace's --motion-trace (0.8 s): each card's trace fades once it has drawn. */
const traceDraw = 0.8;

/** Card i, tick k draws at 0.30 + 0.14 i + 0.05 k (document order: card 0's four ticks, then card 1's, then card 2's). */
export function cardTraceTickTimes(): number[] {
  return Array.from({ length: cards * ticksPerCard }, (_, n) => 0.3 + cardGap * Math.floor(n / ticksPerCard) + tickGap * (n % ticksPerCard));
}

const traces: Step[] = Array.from({ length: cards }, (_, i): Step[] => [
  // The trace rests hidden by class: it shows only while it draws and fades.
  { part: "trace", index: i, at: cardGap * i, duration: "trace", ease: "move", from: { opacity: 1, draw: 0 }, to: { draw: 1 }, lazyFrom: true },
  { part: "trace", index: i, at: cardGap * i + traceDraw, duration: "long", ease: "exit", to: { opacity: 0 }, clear: true },
]).flat();

export const cardTraceStoryboard: Storyboard = {
  name: "card-trace",
  labels: {},
  parts: { trace: cards, tick: cards * ticksPerCard }, // the DOM contract's (storyboards.test.ts)
  steps: [
    ...traces,
    { part: "tick", at: 0.3, times: cardTraceTickTimes(), duration: "micro", ease: "move", from: { draw: 0 }, to: { draw: 1 }, accent: "ticks" },
  ],
};

/** Where it plays: when its top reaches 80% of the viewport. */
export const cardTraceAt = 0.8;
