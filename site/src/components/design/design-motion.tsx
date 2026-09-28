"use client";

/**
 * /_design/'s motion (DESIGN.md §3.14): each moment of motion-moments.tsx played by the site's own motion code, with
 * its own Replay.
 *
 * - The hero run and the 404's trail: their islands, mounted by the motion gate after load plus idle when motion is
 *   allowed, exactly as on their pages (src/motion/motion-gate.tsx); each plays when half visible. The hero's island
 *   shows its own Replay. The trail's island has none, so its Replay here puts the trail back under the CSS hold (it
 *   removes data-ready) and mounts a fresh gate and island, which find the held frame and play it from the start, as a
 *   first visit would.
 * - The evidence trio and the check cards: the scroll effects' engine (src/motion/effects/engine.ts) builds the
 *   effect's timeline, as the scroll runtime would when it comes near, and plays it; a Replay reverts the last one first.
 * - The pipeline: its range sets the progress (pipeline-scrub.ts plays the pipeline's own storyboard as paused Web
 *   Animations and seeks them; the range is the reader's own hand, so it works whatever the motion preference); its
 *   Replay runs that timeline once, at its own pace, moving the range with it. No ScrollTrigger is loaded.
 *
 * Each Replay is in the server's HTML, hidden (visibility), and shown here only while motion is allowed; turning on
 * reduced motion puts every moment back on the server's finished frame. data-motion-state on each root reads
 * "playing", then "done", as the islands mark theirs, for the lab. Nothing is requested until a moment needs it, and
 * nothing runs at rest: GSAP's ticker is put to sleep when an effect ends, and the pipeline's frame loop stops at 1.
 *
 * Chunks: this file imports what the motion gate imports, plus pipeline-query (the scroll runtime's), so the modules
 * around each lazy import match the homepage's and the 404's, and the bundler hands this page the very GSAP chunks those
 * pages load (core, the hero, the 404, the effects engine). Any other motion module imported here, or a lazy chunk
 * sharing the islands' modules, gives the bundler new copies of them, and check-budgets totals every lazy GSAP chunk
 * against the homepage's motion budget. Measured on this page's first version (the engine imported without
 * pipeline-query, and the pipeline sampled with build-storyboard.ts in a lazy chunk of its own): 59,857 B in 5 lazy
 * GSAP chunks against 54,000; with this set, 53,254 B in the same 4 chunks every other page loads.
 */
import { useEffect, useState } from "react";
import { pipelineDesktopQuery } from "@/motion/effects/pipeline-query";
import MotionGate from "@/motion/motion-gate-loader";
import { motionQuery, useMotionAllowed } from "@/motion/use-motion-allowed";

type Engine = typeof import("@/motion/effects/engine");
type Built = ReturnType<Engine["build"]>;
type Scrub = import("./pipeline-scrub").PipelineScrub;

const rootOf = (name: string) => document.querySelector<HTMLElement>(`[data-motion="${name}"]`);
const rangeOf = () => document.querySelector<HTMLInputElement>('input[data-dz-range="pipeline"]');

/** The pipeline's scrub, created on first use (one per page). */
let scrub: Promise<Scrub> | undefined;
/** The pipeline Replay's running frame (0 when none): the range's input stops it, so a drag is never overwritten. */
let frame = 0;
function pipelineScrub(): Promise<Scrub> | undefined {
  const root = rootOf("pipeline");
  if (!root) return undefined;
  scrub ??= import("./pipeline-scrub").then((module) => module.createPipelineScrub(root));
  return scrub;
}

export function DesignMotion() {
  const allowed = useMotionAllowed();
  // Bumped by the trail's Replay: a fresh gate, so a fresh island.
  const [trailRun, setTrailRun] = useState(0);

  // The range: the reader drags the pipeline to any progress.
  useEffect(() => {
    const range = rangeOf();
    if (!range) return;
    // data-dz-progress says which value the pipeline now shows (the lab waits on it: the scrub loads on first use).
    const onInput = () => {
      // The reader's hand wins over a running Replay: stop it, and mark the pipeline at rest where they put it.
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
        rootOf("pipeline")?.setAttribute("data-motion-state", "done");
      }
      void pipelineScrub()?.then((s) => {
        s.set(Number(range.value) / 100);
        rootOf("pipeline")?.setAttribute("data-dz-progress", range.value);
      });
    };
    range.addEventListener("input", onInput);
    return () => {
      range.removeEventListener("input", onInput);
      void scrub?.then((s) => s.destroy());
      scrub = undefined;
    };
  }, []);

  // The Replays, while motion is allowed.
  useEffect(() => {
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-dz-replay]"));
    if (!allowed || !matchMedia(motionQuery).matches) return;
    let engine: Engine | undefined;
    const built = new Map<string, Built>();
    let alive = true;

    const oneShot = async (name: "evidence-trio" | "card-trace") => {
      const root = rootOf(name);
      if (!root) return;
      engine ??= await import("@/motion/effects/engine");
      // The homepage's one-shots are a chunk of their own (effects/home-one-shots.ts), loaded before the first build.
      await engine.load([name]);
      if (!alive) return;
      const loaded = engine;
      built.get(name)?.kill();
      root.setAttribute("data-motion-state", "playing");
      const effect = loaded.build(name, root, () => {
        root.setAttribute("data-motion-state", "done");
        loaded.rest();
      });
      built.set(name, effect);
      effect.play();
    };

    const pipeline = async () => {
      const root = rootOf("pipeline");
      const range = rangeOf();
      const pending = pipelineScrub();
      if (!root || !range || !pending) return;
      const s = await pending;
      if (!alive) return;
      cancelAnimationFrame(frame);
      frame = 0;
      root.setAttribute("data-motion-state", "playing");
      const start = performance.now();
      const step = (now: number) => {
        const progress = Math.min(1, (now - start) / (s.duration * 1000));
        s.set(progress);
        range.value = String(Math.round(progress * 100));
        if (progress < 1) frame = requestAnimationFrame(step);
        else {
          frame = 0;
          root.setAttribute("data-motion-state", "done");
        }
      };
      frame = requestAnimationFrame(step);
    };

    const trail = () => {
      const root = rootOf("trail-404");
      if (!root) return;
      // Back under the hold (globals.css), so the new island finds the frame unshown and plays it from the start.
      root.removeAttribute("data-ready");
      root.removeAttribute("data-motion-state");
      setTrailRun((n) => n + 1);
    };

    const onClick = (event: Event) => {
      const name = (event.currentTarget as HTMLElement).dataset.dzReplay;
      if (name === "evidence-trio" || name === "card-trace") void oneShot(name);
      else if (name === "pipeline") void pipeline();
      else if (name === "trail-404") trail();
    };
    for (const button of buttons) {
      button.style.visibility = "visible";
      button.addEventListener("click", onClick);
    }
    // The layout flips between across and down: a pipeline mid-Replay finishes there, as the scroll runtime finishes
    // an unplayed pipeline on a breakpoint change (the scrub rebuilds itself for the other axis).
    const layout = matchMedia(pipelineDesktopQuery);
    const onLayout = () => {
      if (!frame) return;
      cancelAnimationFrame(frame);
      frame = 0;
      void scrub?.then((s) => s.set(1));
      const range = rangeOf();
      if (range) range.value = "100";
      rootOf("pipeline")?.setAttribute("data-motion-state", "done");
    };
    layout.addEventListener("change", onLayout);
    return () => {
      alive = false;
      layout.removeEventListener("change", onLayout);
      cancelAnimationFrame(frame);
      frame = 0;
      for (const button of buttons) {
        button.style.visibility = "";
        button.removeEventListener("click", onClick);
      }
      // Reduced motion turned on (or the page left): every moment back on the server's frame.
      for (const [name, effect] of built) {
        effect.kill();
        rootOf(name)?.removeAttribute("data-motion-state");
      }
      void scrub?.then((s) => s.set(1));
      const range = rangeOf();
      if (range) range.value = "100";
    };
  }, [allowed]);

  return (
    <>
      <MotionGate islands={["hero-run"]} />
      <MotionGate key={trailRun} islands={["trail-404"]} />
    </>
  );
}
