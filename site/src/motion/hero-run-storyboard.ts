/**
 * The hero run (DESIGN.md §4.3): the homepage's one story, about 2.7 s, played once, then it rests on the finished
 * frame with Replay. Explore, plan, approve, run, report. Everything here moves inside the aria-hidden run window; no
 * text a reader needs ever moves (§4.1 rule 2). The frame's facts (form name, field count, requests) come from the
 * real Kennel 0.6.0 run (content/hero-run.ts, P1's); this file holds only the timing.
 *
 * Accent movers, one at a time (rule 6): the scan line (0-0.60), the rail with its nodes (0.60-0.78, 1.12-1.48,
 * 1.88-2.06), the ticks (0.88-1.12), the progress bar (1.48-1.88). The finding lands at 1.88 s and is fully visible by
 * about 2.0 s; the run rests at 2.73 s, when Replay appears.
 */
import type { Storyboard } from "./storyboard";

const hidden = { opacity: 0 } as const;
const shown = { opacity: 1 } as const;
const risen = { opacity: 1, y: 0 } as const;
/** A rail node lights: its accent ring's opacity, and scale 0.6 → 1. */
const node = (part: string, at: number) =>
  ({ part, at, duration: "short", ease: "move", from: { opacity: 0, scale: 0.6 }, to: { opacity: 1, scale: 1 }, accent: "rail" }) as const;

export const heroRunStoryboard: Storyboard = {
  name: "hero-run",
  labels: { explore: 0, plan: 0.6, approve: 1.12, run: 1.3, report: 1.88 },
  // The DOM contract's counts (dom-contract.ts; storyboards.test.ts keeps the two equal). Written out, so the island's
  // chunk doesn't carry the whole contract.
  parts: {
    scan: 1,
    chip: 3,
    found: 1,
    "rail-line": 1,
    "node-2": 1,
    "node-3": 1,
    "node-4": 1,
    "node-5": 1,
    "plan-row": 4,
    "plan-more": 1,
    tick: 4,
    "press-ring": 1,
    progress: 1,
    "saved-1": 1,
    "saved-2": 1,
    finding: 1,
    "request-1": 1,
    "request-2": 1,
    "spec-chip": 1,
    "replay-slot": 1,
  },
  steps: [
    // Explore: the scan line sweeps the form top to bottom and fades out over its last 0.18 s; node 1 is lit from the
    // start (it never moves). The type chips pop, then "Found “Book a sitter”: 9 fields".
    { part: "scan", at: 0, duration: "scan", ease: "move", from: { opacity: 1, y: 0 }, to: { y: "sweep" }, lazyFrom: true, accent: "scan" },
    { part: "scan", at: 0.42, duration: "short", ease: "exit", to: { opacity: 0 }, accent: "scan", clear: true },
    { part: "chip", at: 0.1, stagger: 0.07, duration: "short", ease: "enter", from: { opacity: 0, scale: 0.9 }, to: { opacity: 1, scale: 1 } },
    { part: "found", at: 0.3, duration: "short", ease: "enter", from: hidden, to: shown },

    // Plan: the rail to 25% and node 2; four plan rows rise 8 px, 40 ms apart; "+16 more"; then the 4 ticks draw.
    { part: "rail-line", at: 0.6, duration: "short", ease: "move", from: { scaleX: 0 }, to: { scaleX: 0.25 }, accent: "rail" },
    node("node-2", 0.6),
    { part: "plan-row", at: 0.6, stagger: "stagger", duration: "medium", ease: "enter", from: { opacity: 0, y: "rise-sm" }, to: risen },
    { part: "plan-more", at: 0.76, duration: "medium", ease: "enter", from: { opacity: 0, y: "rise-sm" }, to: risen },
    { part: "tick", at: 0.88, stagger: "stagger", duration: "micro", ease: "move", from: { draw: 0 }, to: { draw: 1 }, accent: "ticks" },

    // Approve: the rail to 50% and node 3.
    { part: "rail-line", at: 1.12, duration: "short", ease: "move", to: { scaleX: 0.5 }, accent: "rail" },
    node("node-3", 1.12),

    // Run: the rail to 75% and node 4; two press rings on "Book" (neutral colour); the progress bar fills linearly from
    // 1.48 to 1.88; "Saved copy 1" and "Saved copy 2" rise (fail text, static colour).
    { part: "rail-line", at: 1.3, duration: "short", ease: "move", to: { scaleX: 0.75 }, accent: "rail" },
    node("node-4", 1.3),
    { part: "press-ring", at: 1.3, duration: "micro", repeat: 1, ease: "move", from: { opacity: 1, scale: 0.96 }, to: { opacity: 0, scale: 1.04 }, lazyFrom: true, clear: true },
    { part: "progress", at: 1.48, duration: 0.4, ease: "none", from: { scaleX: 0 }, to: { scaleX: 1 }, accent: "progress" },
    { part: "saved-1", at: 1.55, duration: "medium", ease: "enter", from: { opacity: 0, y: "rise-sm" }, to: risen },
    { part: "saved-2", at: 1.7, duration: "medium", ease: "enter", from: { opacity: 0, y: "rise-sm" }, to: risen },

    // Report: the rail to 100% and node 5; the finding card rises 16 px; the two requests rise 8 px; the
    // "Playwright test" chip fades in. Rest at 2.73 s.
    { part: "rail-line", at: 1.88, duration: "short", ease: "move", to: { scaleX: 1 }, accent: "rail" },
    node("node-5", 1.88),
    { part: "finding", at: 1.88, duration: "medium", ease: "enter", from: { opacity: 0, y: "rise-md" }, to: risen },
    { part: "request-1", at: 2.0, duration: "medium", ease: "move", from: { opacity: 0, y: "rise-sm" }, to: risen },
    { part: "request-2", at: 2.12, duration: "medium", ease: "move", from: { opacity: 0, y: "rise-sm" }, to: risen },
    { part: "spec-chip", at: 2.55, duration: "short", ease: "enter", from: hidden, to: shown },
  ],
};
