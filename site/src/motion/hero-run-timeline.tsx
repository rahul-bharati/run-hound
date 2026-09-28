"use client";

/**
 * The hero run's island (DESIGN.md §4.3-4.4): a lazy chunk with GSAP core and useGSAP, mounted by the motion gate after
 * load plus idle. It builds the paused timeline from hero-run-storyboard.ts inside gsap.matchMedia (turning on reduced
 * motion reverts it to the server's frame), then starts it as held-island.ts decides. The ticks draw with a measured
 * stroke dash, not DrawSVG, so a visit that never scrolls downloads no DrawSVG (§4.6 #11).
 */
import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";
import { useState } from "react";
import { buildStoryboard, partsOf, restWhenIdle } from "./build-storyboard";
import { fallbackShown, startHeldIsland } from "./held-island";
import { heroRunStoryboard } from "./hero-run-storyboard";
import { readMotionTokens } from "./tokens";
import { motionQuery } from "./use-motion-allowed";

gsap.registerPlugin(useGSAP);

/** The scan line's run: from where it sits to the bottom of its offset parent (the scanned form). */
function sweep(element: Element): number {
  const line = element as HTMLElement;
  const form = line.offsetParent as HTMLElement | null;
  return form ? Math.max(0, form.clientHeight - line.offsetTop - line.offsetHeight) : 0;
}

export default function HeroRunTimeline() {
  // Client-only (the gate mounts it with ssr: false), so the document is there.
  const [root] = useState(() => document.querySelector<HTMLElement>('[data-motion="hero-run"]'));

  useGSAP(
    (_context, contextSafe) => {
      if (!root) return;
      const mm = gsap.matchMedia();
      mm.add(motionQuery, () => {
        const shown = fallbackShown(root);
        const timeline = buildStoryboard(gsap, heroRunStoryboard, partsOf(root), readMotionTokens(), { draw: "dash", measures: { sweep } });
        const slot = root.querySelector<HTMLElement>('[data-part="replay-slot"]');
        const replay = slot?.matches("button") ? slot : slot?.querySelector<HTMLElement>("button");
        return startHeldIsland({ root, timeline, fallbackShown: shown, lateStart: true, replay, onRest: () => restWhenIdle(gsap), safe: contextSafe });
      });
      return () => mm.revert();
    },
    { scope: root ?? undefined },
  );

  return null;
}
