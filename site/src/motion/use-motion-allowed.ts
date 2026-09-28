"use client";

/**
 * Whether motion is allowed (DESIGN.md §4.4): no reduced-motion preference, and Save-Data off. A React external store
 * over the media query and navigator.connection; the server snapshot is false, so the server HTML, crawlers and
 * every reader before hydration get the finished frame.
 */
import { useSyncExternalStore } from "react";

export const motionQuery = "(prefers-reduced-motion: no-preference)";

type ChangeTarget = {
  addEventListener(type: "change", listener: () => void): void;
  removeEventListener(type: "change", listener: () => void): void;
};
type Connection = { saveData?: boolean } & Partial<ChangeTarget>;
export type MotionEnv = {
  matchMedia(query: string): { matches: boolean } & ChangeTarget;
  navigator: { connection?: Connection };
};

const browser = () => globalThis as unknown as MotionEnv;

/** Allowed now: the media query matches and Save-Data isn't on. */
export function motionAllowed(env: MotionEnv = browser()): boolean {
  return env.matchMedia(motionQuery).matches && !env.navigator.connection?.saveData;
}

/** useSyncExternalStore's subscribe: the preference or Save-Data changing re-renders. */
export function subscribeMotionAllowed(onChange: () => void, env: MotionEnv = browser()) {
  const query = env.matchMedia(motionQuery);
  const connection = env.navigator.connection;
  query.addEventListener("change", onChange);
  connection?.addEventListener?.("change", onChange);
  return () => {
    query.removeEventListener("change", onChange);
    connection?.removeEventListener?.("change", onChange);
  };
}

export const getServerSnapshot = () => false;

export function useMotionAllowed(): boolean {
  // Called with no arguments, both read the browser's window.
  return useSyncExternalStore(subscribeMotionAllowed, motionAllowed, getServerSnapshot);
}
