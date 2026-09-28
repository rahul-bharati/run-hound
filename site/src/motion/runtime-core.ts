/**
 * The scroll runtime's state machine (DESIGN.md §4.4, terminal's runtime with the pipeline as the only ScrollTrigger
 * user). Pure: the DOM, IntersectionObserver, ScrollTrigger, the clock and the imports are injected (scroll-effects.ts
 * wires the real ones; runtime-core.test.ts fakes), so every rule below is unit-tested without a browser.
 *
 * 1. At arm time, the effects wholly below the viewport are pending. Anything in view or above stays as the server
 *    rendered it (finished) and is never touched. (On the page, the island, scroll-runtime.tsx, arms first, after load
 *    plus idle, and loads this runtime when the first of its pending effects comes near; the runtime then arms on
 *    those, so one that reached the viewport meanwhile stays finished.)
 * 2. One observer, half a viewport below the screen, marks effects near. The first near effect loads GSAP core and the
 *    effect builders (loadCore) and sets its from-state; one-shot effects (evidence trio, check cards, reveals) then
 *    play from a second observer at their threshold (78%, 80%, 88%), with no ScrollTrigger.
 * 3. The pipeline coming near imports and registers ScrollTrigger, and creates its one trigger. ScrollTrigger runs a
 *    requestAnimationFrame loop whenever it is enabled (ScrollTrigger.js _rafBugFix), so it is enabled only while the
 *    pipeline is near, unplayed, and the reader scrolled within the last 1.5 s; enable() is called only on an
 *    off-to-on change (it re-adds listeners and refreshes every trigger); it is parked with disable(false), which keeps
 *    the animation's progress; it is disabled for good when the pipeline completes.
 * 4. Jumping past an effect (End, an anchor, a fling: it is above the viewport unplayed) finishes it; so does focus
 *    moving into it, and printing finishes all.
 * 5. Played elements go into a WeakSet the caller keeps for the page's life, so a remount or a breakpoint change never
 *    replays anything; a breakpoint change finishes an unfinished pipeline (see onBreakpoint).
 * 6. Once nothing is pending, the observers disconnect, the listeners go, ScrollTrigger is disabled for good and the
 *    GSAP ticker is put to sleep (rest), so nothing runs while the reader rests.
 */
import { nearMargin, type scrollEffectNames } from "./scroll-near";

export type EffectName = (typeof scrollEffectNames)[number];
export type Rect = { top: number; bottom: number };
export type Entry<E> = { target: E; isIntersecting: boolean; boundingClientRect: Rect };
export type ObserverLike<E> = { observe(element: E): void; unobserve(element: E): void; disconnect(): void };
export type ScrollTriggerLike = { enable(): void; disable(reset?: boolean): void };

/** An effect once built (its from-state set): the controls of its timeline. */
export type BuiltEffect = {
  /** One-shots: play from the from-state. */
  play(): void;
  /** Its finished state now (the pipeline also kills its trigger, keeping the animation), and stop. */
  finish(): void;
  progress(): number;
  setProgress(value: number): void;
  /** Revert to the server's state and remove it (reduced motion turned on, or the page left). */
  kill(): void;
};

export type MotionState = "armed" | "playing" | "done";

export type RuntimeDeps<E extends object> = {
  /** Every scroll-effect root ([data-motion] but the islands'), in document order. */
  roots: readonly E[];
  nameOf(element: E): EffectName | undefined;
  viewportHeight(): number;
  rectOf(element: E): Rect;
  observe(callback: (entries: Entry<E>[]) => void, options: { rootMargin: string }): ObserverLike<E>;
  /** GSAP core and the effect builders. */
  loadCore(): Promise<unknown>;
  /** ScrollTrigger, imported and registered (registering enables it). */
  loadScrollTrigger(): Promise<ScrollTriggerLike>;
  /** Builds an effect, setting its from-state; `done` is called when it completes by itself. */
  build(name: EffectName, element: E, done: () => void): BuiltEffect;
  onScroll(listener: () => void): () => void;
  onFocusIn(element: E, listener: () => void): () => void;
  onBeforePrint(listener: () => void): () => void;
  onBreakpoint(listener: () => void): () => void;
  now(): number;
  setTimer(callback: () => void, ms: number): unknown;
  clearTimer(id: unknown): void;
  /** The page's played elements (module-level in the adapter). */
  played: WeakSet<E>;
  /** Marks a root's state (data-motion-state), for the lab. */
  mark?(element: E, state: MotionState): void;
  /** Puts GSAP's ticker to sleep if nothing is animating. */
  rest?(): void;
};

/** ScrollTrigger is parked this long after the last scroll. */
export const parkAfterMs = 1500;
/** Effects are near when they come within half a viewport below the screen (scroll-near.ts, which the island reads). */
export { nearMargin };
/** Where each one-shot plays: when its top reaches this fraction of the viewport's height. */
export const playAt = { "evidence-trio": 0.78, "card-trace": 0.8, reveal: 0.88 } as const;
/** The observer margin that reports an element whose top has reached `at` of the viewport. */
export const playMargin = (at: number) => `0px 0px -${Math.round((1 - at) * 100)}% 0px`;

type Effect<E> = {
  element: E;
  name: EffectName;
  state: "waiting" | MotionState;
  built?: BuiltEffect;
  loading?: boolean;
  /** Set while finish() runs: a timeline's onComplete, fired by finish() itself, doesn't finish it twice. */
  finishing?: boolean;
  offFocus?: () => void;
};

export function createRuntime<E extends object>(deps: RuntimeDeps<E>) {
  const effects = new Map<E, Effect<E>>();
  const near = new Set<Effect<E>>();
  const playObservers = new Map<EffectName, ObserverLike<E>>();
  let nearObserver: ObserverLike<E> | undefined;
  let offs: (() => void)[] = [];
  let coreLoading: Promise<unknown> | undefined;
  let scrollTriggerLoading: Promise<unknown> | undefined;
  let scrollTrigger: ScrollTriggerLike | undefined;
  let enabled = false;
  let retired = false;
  let lastScroll = Number.NEGATIVE_INFINITY;
  let parkTimer: unknown;
  let alive = true;
  let tornDown = false;

  const pending = () => [...effects.values()].filter((effect) => effect.state !== "done");
  const mark = (effect: Effect<E>, state: MotionState) => {
    effect.state = state;
    deps.mark?.(effect.element, state);
  };

  // ---- ScrollTrigger: enabled only while needed --------------------------------------------------------------------
  const wanted = () =>
    !retired && [...near].some((effect) => effect.name === "pipeline" && effect.state !== "done") && deps.now() - lastScroll < parkAfterMs;

  function schedulePark() {
    if (parkTimer !== undefined) deps.clearTimer(parkTimer);
    parkTimer = undefined;
    if (enabled) parkTimer = deps.setTimer(sync, Math.max(0, lastScroll + parkAfterMs - deps.now()));
  }

  function sync() {
    if (!scrollTrigger || retired) return;
    const want = wanted();
    if (want && !enabled) {
      enabled = true;
      scrollTrigger.enable();
    } else if (!want && enabled) {
      enabled = false;
      scrollTrigger.disable(false);
      // Parked: its scrub is paused too, so GSAP's ticker can sleep until the next scroll.
      deps.rest?.();
    }
    schedulePark();
  }

  /** The pipeline is done (or the runtime is): ScrollTrigger is disabled for good. */
  function retire() {
    retired = true;
    if (parkTimer !== undefined) deps.clearTimer(parkTimer);
    parkTimer = undefined;
    if (scrollTrigger && enabled) {
      enabled = false;
      scrollTrigger.disable(false);
    }
  }

  // ---- Effects -------------------------------------------------------------------------------------------------------
  function teardown() {
    if (tornDown) return;
    tornDown = true;
    nearObserver?.disconnect();
    for (const observer of playObservers.values()) observer.disconnect();
    for (const off of offs) off();
    offs = [];
    for (const effect of effects.values()) effect.offFocus?.();
    retire();
    deps.rest?.();
  }

  function done(effect: Effect<E>) {
    mark(effect, "done");
    deps.played.add(effect.element);
    near.delete(effect);
    nearObserver?.unobserve(effect.element);
    playObservers.get(effect.name)?.unobserve(effect.element);
    effect.offFocus?.();
    effect.offFocus = undefined;
    if (effect.name === "pipeline") retire();
    if (pending().length === 0) teardown();
    else deps.rest?.();
  }

  /** Rest on the finished state: played to the end, jumped past, focused, printed. */
  function finish(effect: Effect<E>) {
    if (effect.state === "done" || effect.finishing) return;
    effect.finishing = true;
    effect.built?.finish();
    done(effect);
  }

  function play(effect: Effect<E>) {
    if (effect.state !== "armed" || !effect.built) return;
    playObservers.get(effect.name)?.unobserve(effect.element);
    mark(effect, "playing");
    effect.built.play();
  }

  function playObserverFor(name: Exclude<EffectName, "pipeline">) {
    let observer = playObservers.get(name);
    if (!observer) {
      observer = deps.observe(
        (entries) => {
          for (const entry of entries) {
            const effect = effects.get(entry.target);
            if (!effect || effect.state === "done") continue;
            if (entry.isIntersecting) play(effect);
            else if (entry.boundingClientRect.bottom <= 0) finish(effect);
          }
        },
        { rootMargin: playMargin(playAt[name]) },
      );
      playObservers.set(name, observer);
    }
    return observer;
  }

  function build(effect: Effect<E>) {
    // Reached the viewport while GSAP downloaded: the reader has seen it finished, so it stays finished.
    if (deps.rectOf(effect.element).top < deps.viewportHeight()) {
      done(effect);
      return;
    }
    effect.built = deps.build(effect.name, effect.element, () => finish(effect));
    mark(effect, "armed");
    if (effect.name === "pipeline") sync();
    else playObserverFor(effect.name).observe(effect.element);
  }

  function loadScrollTrigger() {
    scrollTriggerLoading ??= deps.loadScrollTrigger().then((loaded) => {
      scrollTrigger = loaded;
      enabled = true; // registering it enabled it
      if (retired || !alive) {
        enabled = false;
        loaded.disable(false);
      }
    });
    return scrollTriggerLoading;
  }

  function ensureBuilt(effect: Effect<E>) {
    if (effect.built || effect.loading || effect.state === "done") return;
    effect.loading = true;
    coreLoading ??= deps.loadCore();
    const ready = effect.name === "pipeline" ? Promise.all([coreLoading, loadScrollTrigger()]) : coreLoading;
    ready.then(
      () => {
        effect.loading = false;
        if (alive && effect.state === "waiting") build(effect);
      },
      () => {
        // The chunk didn't arrive: the effect keeps the server's finished state.
        effect.loading = false;
        if (alive) finish(effect);
      },
    );
  }

  function onNear(entries: Entry<E>[]) {
    for (const entry of entries) {
      const effect = effects.get(entry.target);
      if (!effect || effect.state === "done") continue;
      if (entry.isIntersecting) {
        near.add(effect);
        ensureBuilt(effect);
      } else {
        near.delete(effect);
        if (entry.boundingClientRect.bottom <= 0) finish(effect);
      }
    }
    sync();
  }

  /** A jump the observers never saw (from below to above between two frames): whatever is above now is finished. */
  function checkJumps() {
    for (const effect of pending()) if (deps.rectOf(effect.element).bottom <= 0) finish(effect);
  }

  function onScroll() {
    lastScroll = deps.now();
    checkJumps();
    sync();
  }

  /**
   * The pipeline's orientation changed (DESIGN.md §4.4 #5 asked for a rebuild at the current progress): it finishes
   * instead. A rebuilt scrubbed trigger jumps to the scroll position's progress on the new axis (lit nodes went out),
   * and one created while ScrollTrigger is parked is dead (ScrollTrigger.js init returns early when !_enabled), so the
   * line froze half-drawn. Finished, the line is the server's frame and nothing lit ever goes out (§4.6 #10).
   */
  function onBreakpoint() {
    for (const effect of pending()) if (effect.name === "pipeline" && effect.built) finish(effect);
  }

  return {
    arm() {
      if (!alive || effects.size) return;
      const height = deps.viewportHeight();
      for (const element of deps.roots) {
        const name = deps.nameOf(element);
        if (!name || deps.played.has(element)) continue;
        if (deps.rectOf(element).top < height) continue;
        effects.set(element, { element, name, state: "waiting" });
      }
      if (effects.size === 0) return;
      nearObserver = deps.observe(onNear, { rootMargin: nearMargin });
      for (const effect of effects.values()) {
        nearObserver.observe(effect.element);
        effect.offFocus = deps.onFocusIn(effect.element, () => finish(effect));
      }
      offs.push(
        deps.onScroll(onScroll),
        deps.onBeforePrint(() => {
          for (const effect of pending()) finish(effect);
        }),
        deps.onBreakpoint(onBreakpoint),
      );
    },
    /** Reduced motion turned on, or the page left: every unfinished effect back to the server's state, nothing left. */
    destroy() {
      alive = false;
      for (const effect of pending()) effect.built?.kill();
      teardown();
    },
    scrollTriggerEnabled: () => enabled,
  };
}
