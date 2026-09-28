"use client";

/**
 * The 404's island (DESIGN.md §4.3): a lazy chunk with GSAP core and useGSAP, mounted by the motion gate after load
 * plus idle. The same hold, guard and start as the hero (held-island.ts), without the late start or Replay: the trail
 * draws and the hound walks it once, in about 1.8 s. The trail draws with its measured length as a dash, as the hero's
 * ticks do, not with DrawSVG (about 1.9 KB), which kept the 404's motion over its 32,000 B budget (§5.2); at rest the
 * dash is cleared, so the trail stays whole if the window is resized.
 */
import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";
import { useState } from "react";
import { buildStoryboard, partsOf, restWhenIdle } from "./build-storyboard";
import { fallbackShown, startHeldIsland } from "./held-island";
import { readMotionTokens } from "./tokens";
import { trail404Storyboard } from "./trail-404-storyboard";
import { motionQuery } from "./use-motion-allowed";

gsap.registerPlugin(useGSAP);

export default function Trail404Timeline() {
  const [root] = useState(() => document.querySelector<HTMLElement>('[data-motion="trail-404"]'));

  useGSAP(
    (_context, contextSafe) => {
      if (!root) return;
      const mm = gsap.matchMedia();
      mm.add(motionQuery, () => {
        const shown = fallbackShown(root);
        const parts = partsOf(root);
        const [trail] = parts("trail");
        // The hound rests where the trail ends; it walks there from the trail's start. Measured from where the server
        // put it (its box less the x GSAP has already given it), so a from-state read again after it was applied is
        // still the whole walk, not 0 (which made the hound jump to its rest in one frame).
        const walk = (hound: Element) => {
          if (!trail) return 0;
          const moved = Number(gsap.getProperty(hound, "x")) || 0;
          return trail.getBoundingClientRect().left - (hound.getBoundingClientRect().left - moved);
        };
        const timeline = buildStoryboard(gsap, trail404Storyboard, parts, readMotionTokens(), { draw: "dash", measures: { walk } });
        // At rest the trail is whole without its dash (measured once, it would leave a lengthened trail's end undrawn).
        const onRest = () => {
          if (trail) gsap.set(trail, { clearProps: "strokeDasharray,strokeDashoffset" });
          restWhenIdle(gsap);
        };
        return startHeldIsland({ root, timeline, fallbackShown: shown, lateStart: false, onRest, safe: contextSafe });
      });
      return () => mm.revert();
    },
    { scope: root ?? undefined },
  );

  return null;
}
