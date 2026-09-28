"use client";

/**
 * The scroll runtime's island (DESIGN.md §4.4): the runtime shell the gate mounts after load plus idle. It arms: the
 * scroll effects wholly below the viewport are pending (anything in view or above stays the server's finished frame,
 * never touched), and one IntersectionObserver, half a viewport below the screen, waits for the first of them to come
 * near. Only then does it import the runtime itself (scroll-effects.ts: runtime-core.ts wired to the page, with the
 * effects' engine and GSAP core; ScrollTrigger follows when the pipeline comes near), which takes the pending effects
 * over. So the shell is all the scroll code a page loads after idle (the homepage's after-load motion is its hero's
 * and this, §5.2), and a visit that never comes near an effect downloads nothing more.
 *
 * The gate mounts it only while motion is allowed; turning on reduced motion mid-visit unmounts it, and the runtime
 * reverts every unfinished effect to the server's frame and disables ScrollTrigger.
 */
import { useEffect } from "react";
import { nearMargin, scrollEffectNames } from "./scroll-near";

const scrollEffects = new Set<string>(scrollEffectNames);

/** The page's played effects, kept across remounts (the runtime adds to it), so nothing ever plays twice. */
const played = new WeakSet<HTMLElement>();

export default function ScrollRuntime() {
  useEffect(() => {
    const pending = Array.from(document.querySelectorAll<HTMLElement>("[data-motion]")).filter(
      (root) => scrollEffects.has(root.dataset.motion ?? "") && !played.has(root) && root.getBoundingClientRect().top >= innerHeight,
    );
    if (pending.length === 0) return;

    let alive = true;
    let stopRuntime: (() => void) | undefined;
    const near = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        near.disconnect();
        import("./scroll-effects").then(
          (runtime) => {
            if (alive) stopRuntime = runtime.startScrollEffects(pending, played);
          },
          () => {
            // The chunk didn't arrive: every effect keeps the server's finished frame.
          },
        );
      },
      { rootMargin: nearMargin },
    );
    for (const root of pending) near.observe(root);
    return () => {
      alive = false;
      near.disconnect();
      stopRuntime?.();
    };
  }, []);

  return null;
}
