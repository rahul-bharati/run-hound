/**
 * The scroll runtime wired to the page (DESIGN.md §4.4): runtime-core.ts with the browser's IntersectionObserver,
 * listeners and clock, and the effects' engine (effects/engine.ts: GSAP core and the builder) it builds the effects
 * with. The scroll runtime's island (scroll-runtime.tsx) imports this when the first effect it armed comes within half a
 * viewport, so the runtime and the engine are one lazy chunk (with GSAP core's, which the homepage's hero has already
 * loaded). The homepage's one-shots come with the first build on a page that has them (effects/home-one-shots.ts), and
 * ScrollTrigger when the pipeline comes near (effects/pipeline-engine.ts).
 */
import * as engine from "./effects/engine";
import { pipelineDesktopQuery } from "./effects/pipeline-query";
import { createRuntime, type EffectName, type Entry, type MotionState } from "./runtime-core";

const listen = (target: EventTarget, type: string, listener: () => void, options?: AddEventListenerOptions) => {
  target.addEventListener(type, listener, options);
  return () => target.removeEventListener(type, listener, options);
};

const mark = (element: HTMLElement, state: MotionState) => element.setAttribute("data-motion-state", state);

/**
 * Takes over the effects the island armed (`pending`, wholly below the viewport after load plus idle); `played` is the
 * island's, kept for the page's life. Returns the runtime's destroy: every unfinished effect back to the server's frame.
 */
export function startScrollEffects(pending: readonly HTMLElement[], played: WeakSet<HTMLElement>): () => void {
  // One that reached the viewport (or went past it) while this chunk downloaded: the reader has seen it finished, so
  // it stays finished, as the runtime leaves one that arrives while GSAP downloads.
  const roots = pending.filter((root) => {
    if (played.has(root)) return false;
    if (root.getBoundingClientRect().top >= innerHeight) return true;
    played.add(root);
    mark(root, "done");
    return false;
  });

  const runtime = createRuntime<HTMLElement>({
    roots,
    nameOf: (element) => element.dataset.motion as EffectName,
    viewportHeight: () => innerHeight,
    rectOf: (element) => element.getBoundingClientRect(),
    // The entries are the runtime's: each target is one of the roots it observes.
    observe: (callback, { rootMargin }) => new IntersectionObserver((entries) => callback(entries as unknown as Entry<HTMLElement>[]), { rootMargin }),
    // GSAP core and the builder came with this chunk; the homepage's one-shots come if the page has them.
    loadCore: () => engine.load(roots.map((root) => root.dataset.motion ?? "")),
    loadScrollTrigger: engine.loadScrollTrigger,
    build: engine.build,
    onScroll: (listener) => listen(window, "scroll", listener, { passive: true }),
    onFocusIn: (element, listener) => listen(element, "focusin", listener),
    onBeforePrint: (listener) => listen(window, "beforeprint", listener),
    onBreakpoint: (listener) => listen(matchMedia(pipelineDesktopQuery), "change", listener),
    now: () => performance.now(),
    setTimer: (callback, ms) => window.setTimeout(callback, ms),
    clearTimer: (id) => window.clearTimeout(id as number),
    played,
    mark,
    rest: engine.rest,
  });
  runtime.arm();
  return () => runtime.destroy();
}
