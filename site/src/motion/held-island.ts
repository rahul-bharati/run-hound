/**
 * What the two held islands share (DESIGN.md §4.4, "The hero island"; the 404's trail uses the same gate, hold and
 * guard): the fallback check, the start decision, releasing the hold, waiting for half visibility, skipping to the end
 * on input or when scrolled away mid-run, Replay, and resting. The island builds the paused timeline (its from-states
 * already applied) and hands it over; no GSAP import here.
 */
import { heroPlayThreshold, heroStart, visibleFraction } from "./hero-run-start";
import type { MotionState } from "./runtime-core";

export type IslandTimeline = {
  play(from?: number | string): unknown;
  progress(value: number): unknown;
  isActive(): boolean;
  eventCallback(type: "onComplete", callback: () => void): unknown;
};

/**
 * Whether the CSS fallback already showed the held parts (a held part's own computed opacity is 1 once the 0 s
 * animation has run at --motion-hold). Read before building: the timeline's from-states change it. A root with no
 * held parts counts as shown: the reader has the finished frame, and it rests there.
 */
export function fallbackShown(root: Element): boolean {
  const held = root.querySelector('[data-beat="late"]');
  return held ? Number(getComputedStyle(held).opacity) > 0.5 : true;
}

type Safe = <T extends (...args: never[]) => unknown>(fn: T) => T;

export function startHeldIsland({
  root,
  timeline,
  fallbackShown: shown,
  lateStart,
  replay,
  onRest,
  safe = (fn) => fn,
}: {
  root: HTMLElement;
  timeline: IslandTimeline;
  fallbackShown: boolean;
  /** The hero's late-start rule (play from "run" when mounted late); the 404 always plays from 0. */
  lateStart: boolean;
  /** The Replay button in its reserved, hidden slot (the hero's replay-slot). */
  replay?: HTMLElement | null;
  onRest: () => void;
  safe?: Safe;
}): () => void {
  let state: MotionState = "armed";
  const mark = (next: MotionState) => {
    state = next;
    root.setAttribute("data-motion-state", next);
  };
  const rest = () => {
    mark("done");
    if (replay) replay.style.visibility = "visible";
    onRest();
  };
  const play = (from: number | string) => {
    mark("playing");
    timeline.play(from);
  };
  timeline.eventCallback("onComplete", rest);

  const start = heroStart({ fallbackShown: shown, visible: visibleFraction(root.getBoundingClientRect(), innerHeight), sinceNavigationMs: performance.now() });
  // The from-states are inline now, so releasing the hold shows nothing that shouldn't be seen.
  root.setAttribute("data-ready", "");
  const current = () => state;
  if (start.kind === "rest") {
    timeline.progress(1); // renders the end, which may call onComplete (rest) already
    if (current() !== "done") rest();
  } else if (start.kind === "play") play(lateStart ? start.from : 0);
  else mark("armed");

  // Half visible: a waiting run starts (from 0). Below half mid-run: it skips to its end.
  const observer = new IntersectionObserver(
    safe((entries: IntersectionObserverEntry[]) => {
      const entry = entries[entries.length - 1];
      const half = visibleFraction(entry.boundingClientRect, innerHeight) >= heroPlayThreshold;
      if (half && state === "armed") play(0);
      else if (!half && state === "playing" && timeline.isActive()) timeline.progress(1);
    }),
    { threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1] },
  );
  observer.observe(root);

  // Any pointer or key inside it skips to the end (§4.1 rule 7).
  const skip = safe(() => {
    if (state === "playing" && timeline.isActive()) timeline.progress(1);
  });
  const onReplay = safe(() => play(0));
  root.addEventListener("pointerdown", skip);
  root.addEventListener("keydown", skip);
  replay?.addEventListener("click", onReplay);

  return () => {
    observer.disconnect();
    root.removeEventListener("pointerdown", skip);
    root.removeEventListener("keydown", skip);
    replay?.removeEventListener("click", onReplay);
    // Reverted (reduced motion turned on): the server's frame, with nothing to replay. data-ready stays, so the hold
    // never hides the frame again.
    if (replay) replay.style.visibility = "";
  };
}
