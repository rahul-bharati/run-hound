/**
 * The DOM contract between the pages that render a moving figure and the motion code that moves it (DESIGN.md §4.3).
 * P1 renders the homepage's (hero run, pipeline, evidence trio, check cards), F2 and the check pages the reveals, F3
 * the 404's trail; src/motion/ animates them; both sides test against this file, so a renamed part fails a test.
 *
 * - The root carries data-motion="<name>" (the keys below). Everything that moves is inside it, aria-hidden, and never
 *   text a reader needs (§4.1 rule 2): the moving parts are figure internals, lines, rings, ticks, outlines, the stamp,
 *   figure media (never their captions) and the line hound.
 * - Each moving element carries data-part="<part>", as many as `parts` says, in document order.
 * - The server renders every part in its finished state (rule 8).
 * - `held`: parts hidden from the first paint until the motion island is ready (or the 3 s fallback shows them), by
 *   carrying data-beat="late" themselves or sitting inside a part that does (globals.css holds them only when
 *   scripting is on and motion is allowed). Hold every part whose start state is hidden or undrawn, so the reader never
 *   sees it finished and then taken away when the island mounts.
 * - `restHidden`: parts that rest invisible, by the class rest-hidden (globals.css), never an inline style.
 *
 * The motion code marks a root it has taken over: data-ready (the hold is released; globals.css), and
 * data-motion-state="armed" (its start state is set, waiting), "playing", then "done" (at rest), which the lab's
 * motion contract (scripts/lab/specs/motion-contract.spec.mjs) reads.
 *
 * Hero run specifics:
 * - `scan` is an HTML line at the top of the scanned form, positioned inside it; it sweeps down to the bottom of its
 *   offset parent (measured, never a typed distance).
 * - `tick` is the path of a Tick with `draw` (primitives/tick.tsx): the hero draws it with a measured stroke dash,
 *   since a visit that never scrolls loads no DrawSVG (§4.6 #11).
 * - `replay-slot` is a <button type="button"> "Replay" (a 44 px text button, outside the aria-hidden window, inside the
 *   root), rendered with visibility: hidden (the class `invisible`) so its room is reserved (CLS 0). The island makes it
 *   visible when the run rests and replays the run from 0 on click. Without JavaScript, under reduced motion and with
 *   Save-Data it stays hidden: there is nothing to replay.
 *
 * 404 specifics: `trail` is an SVG stroke drawn with a measured dash (for a dotted look, put a <mask> of dots over it:
 * the drawing replaces the stroke's own stroke-dasharray); `hound` is LineHound's <svg> with `parts`, resting
 * where the trail ends (it walks there from the trail's start); `head` its head group, which rests turned -6° (the
 * storyboard's last beat), so render it at -6° for the finished state to be the server's.
 *
 * Pipeline specifics: `connector` ×4 are <span>s on the dashed line-strong track, each one column long from 1024 px
 * (scaled on x from the left node) and one row long below (scaled on y from the upper node); `node-ring` ×5 are the
 * accent rings, ring 1 lit from the start. Evidence trio: `media` ×3 are the three pictures (never their captions);
 * `outline-accent` and `outline-rest` are the two SVG outlines round the trio; `stamp` the EVIDENCE stamp. Check cards:
 * `trace` ×3 are dim SVG outlines round each card, `tick` ×12 the drawn ticks (4 per card, document order).
 */
export type MotionName = "hero-run" | "pipeline" | "evidence-trio" | "card-trace" | "reveal" | "trail-404";

export type Contract = {
  parts: Readonly<Record<string, number>>;
  held: readonly string[];
  restHidden: readonly string[];
};

export const domContract: Record<MotionName, Contract> = {
  "hero-run": {
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
      stamp: 1,
      "spec-chip": 1,
      "replay-slot": 1,
    },
    held: [
      "chip",
      "found",
      "rail-line",
      "node-2",
      "node-3",
      "node-4",
      "node-5",
      "plan-row",
      "plan-more",
      "tick",
      "progress",
      "saved-1",
      "saved-2",
      "finding",
      "request-1",
      "request-2",
      "stamp",
      "spec-chip",
    ],
    restHidden: ["scan", "press-ring"],
  },
  pipeline: { parts: { connector: 4, "node-ring": 5 }, held: [], restHidden: [] },
  "evidence-trio": { parts: { media: 3, "outline-accent": 1, "outline-rest": 1, stamp: 1 }, held: [], restHidden: ["outline-accent"] },
  "card-trace": { parts: { trace: 3, tick: 12 }, held: [], restHidden: ["trace"] },
  reveal: { parts: {}, held: [], restHidden: [] },
  "trail-404": { parts: { trail: 1, hound: 1, head: 1 }, held: ["trail", "hound", "head"], restHidden: [] },
};

/** The parts every page may leave at opacity 0 at rest (§4.6 #6): the documented rest classes. */
export const restHiddenParts = [...new Set(Object.values(domContract).flatMap((contract) => contract.restHidden))];
