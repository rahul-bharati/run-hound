"use client";

/**
 * The motion gate (DESIGN.md §4.4): the only motion code a page loads up front. A page renders
 * <MotionGate islands={[…]} /> naming its islands: "hero-run" (the homepage's run), "scroll" (the scroll runtime: the
 * pipeline, the evidence trio, the check cards, figure reveals) and "trail-404". That MotionGate is
 * motion-gate-loader.tsx, which fetches this module at hydration. This module is imported only through import() (there
 * and in the 404's body), so the bundler emits it once, as one small chunk (§4.6 #11), not a copy in each page's chunk.
 *
 * On the server and before hydration it renders nothing: every figure is the server's finished frame. If motion isn't
 * allowed (reduced motion, Save-Data) it releases the CSS hold at hydration and stops; nothing is requested. Otherwise,
 * after the load event plus idle, it mounts each island with next/dynamic and ssr: false, whose chunks (GSAP and the
 * timelines) are requested only then; next/dynamic adds no preload for an ssr: false import (next
 * dist/shared/lib/lazy-dynamic/loadable.js renders PreloadChunks only when ssr is on).
 */
import dynamic from "next/dynamic";
import { type ComponentType, createElement, useEffect, useState } from "react";
import { type GateEnv, startGate } from "./gate-core";
import { useMotionAllowed } from "./use-motion-allowed";

export type Island = "hero-run" | "scroll" | "trail-404";

const islandOf: Record<Island, ComponentType> = {
  "hero-run": dynamic(() => import("./hero-run-timeline"), { ssr: false }),
  scroll: dynamic(() => import("./scroll-runtime"), { ssr: false }),
  "trail-404": dynamic(() => import("./trail-404-timeline"), { ssr: false }),
};

export function MotionGate({ islands }: { islands: readonly Island[] }) {
  const allowed = useMotionAllowed();
  const [ready, setReady] = useState(false);

  // Runs at hydration (with the server snapshot) and again when the permission changes; startGate reads the live
  // permission itself, so the hydration pass never releases the hold of a reader who allows motion.
  useEffect(() => startGate(window as unknown as GateEnv, () => setReady(true)), [allowed]);

  if (!allowed || !ready) return null;
  return islands.map((name) => createElement(islandOf[name], { key: name }));
}
