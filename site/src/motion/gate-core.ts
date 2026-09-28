/**
 * What the motion gate does at hydration (DESIGN.md §4.4), as plain functions the gate calls and the tests fake.
 *
 * - Motion not allowed (reduced motion, Save-Data): release the CSS hold now, by setting data-ready on every
 *   [data-motion] root that holds late parts, so a Save-Data reader gets the finished frame at hydration instead of
 *   after the 3 s fallback (under reduced motion the hold never applied; the attribute is harmless). Nothing is
 *   requested.
 * - Allowed: wait for the load event plus idle, then mount the islands (they set data-ready themselves).
 */
import { type AfterLoadEnv, afterLoadIdle } from "./after-load-idle";
import { motionAllowed, type MotionEnv } from "./use-motion-allowed";

export type HoldRoot = { querySelector(selector: string): unknown; setAttribute(name: string, value: string): void };
export type HoldDocument = { querySelectorAll(selector: string): Iterable<HoldRoot> };

/** Sets data-ready on every unready [data-motion] root holding late parts; returns how many. */
export function releaseHolds(doc: HoldDocument): number {
  let released = 0;
  for (const root of doc.querySelectorAll("[data-motion]:not([data-ready])")) {
    if (!root.querySelector('[data-beat="late"]')) continue;
    root.setAttribute("data-ready", "");
    released += 1;
  }
  return released;
}

export type GateEnv = MotionEnv & AfterLoadEnv & { document: AfterLoadEnv["document"] & HoldDocument };

/**
 * Runs the gate once motion's permission is known (on hydration, and again if it changes): releases the hold when
 * motion isn't allowed, or calls `onReady` after load plus idle when it is. Returns a cancel function.
 */
export function startGate(env: GateEnv, onReady: () => void): () => void {
  if (!motionAllowed(env)) {
    releaseHolds(env.document);
    return () => {};
  }
  // The gate runs this at hydration and again if the permission changes; every run waits on the page's one moment.
  let alive = true;
  afterLoadIdle(env).then(() => {
    if (alive) onReady();
  });
  return () => {
    alive = false;
  };
}
