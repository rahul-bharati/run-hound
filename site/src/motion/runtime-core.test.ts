// The scroll runtime's state machine (src/motion/runtime-core.ts, DESIGN.md §4.4), with every browser and GSAP piece
// injected as a fake: IntersectionObserver, ScrollTrigger, the clock, the imports, the listeners. It checks what the
// motion contract can't isolate: only effects wholly below the viewport arm; DrawSVG (with GSAP core) is imported on
// the first near effect and ScrollTrigger only when the pipeline is near; ScrollTrigger is parked after 1.5 s without
// scrolling and enable() is called only off-to-on; a jump, focus or printing finishes an effect; once nothing is
// pending, ScrollTrigger is disabled for good and every observer and listener is gone; a breakpoint change never
// replays anything, and finishes an unfinished pipeline (the line drawn, nothing lit goes out, no trigger created).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { keepProgressOnEnable } from "./effects/resume";
import { createRuntime, type EffectName, type Entry, parkAfterMs, type RuntimeDeps } from "./runtime-core";

type El = { id: string; name: EffectName; top: number; height: number };

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
const flush = () => new Promise((r) => setImmediate(r));

function setup(elements: El[], { viewport = 800 } = {}) {
  const log: string[] = [];
  let time = 0;
  let timers: { at: number; fn: () => void; id: number }[] = [];
  let nextTimer = 1;
  const observers: { margin: string; callback: (entries: Entry<El>[]) => void; watched: Set<El>; disconnected: boolean }[] = [];
  const listeners = { scroll: new Set<() => void>(), print: new Set<() => void>(), breakpoint: new Set<() => void>(), focus: new Map<El, () => void>() };
  const core = deferred();
  const scrollTrigger = deferred<{ enable(): void; disable(reset?: boolean): void }>();
  // Whether ScrollTrigger is enabled (registering it enables it): ScrollTrigger.create() while it is disabled makes a
  // dead trigger (gsap 3.15.0 ScrollTrigger.js init: `if (!_enabled) { this.update = this.refresh = this.kill =
  // _passThrough; return; }`), so a pipeline built then never scrubs.
  let stEnabled = false;
  const buildsWhileDisabled: string[] = [];
  const st = {
    enable: () => ((stEnabled = true), log.push("st.enable")),
    disable: (reset?: boolean) => ((stEnabled = false), log.push(`st.disable(${reset})`)),
  };
  const built = new Map<El, { progress: number; completed: () => void; killed: boolean; axis: string }>();
  let axis = "x";
  const played = new WeakSet<object>();
  const states = new Map<El, string>();

  const deps: RuntimeDeps<El> = {
    roots: elements,
    nameOf: (el) => el.name,
    viewportHeight: () => viewport,
    rectOf: (el) => ({ top: el.top, bottom: el.top + el.height }),
    observe(callback, { rootMargin }) {
      const observer = { margin: rootMargin, callback, watched: new Set<El>(), disconnected: false };
      observers.push(observer);
      log.push(`observe ${rootMargin}`);
      return {
        observe: (el) => observer.watched.add(el),
        unobserve: (el) => observer.watched.delete(el),
        disconnect: () => {
          observer.disconnected = true;
          observer.watched.clear();
        },
      };
    },
    loadCore: () => (log.push("load core"), core.promise),
    loadScrollTrigger: () => (log.push("load scrolltrigger"), scrollTrigger.promise),
    build(name, el, done) {
      log.push(`build ${el.id}`);
      if (name === "pipeline" && !stEnabled) buildsWhileDisabled.push(el.id);
      const effect = { progress: 0, completed: done, killed: false, axis };
      built.set(el, effect);
      return {
        play: () => log.push(`play ${el.id}`),
        finish: () => {
          effect.progress = 1;
          log.push(`finish ${el.id}`);
        },
        progress: () => effect.progress,
        setProgress: (value) => {
          effect.progress = value;
          log.push(`progress ${el.id} ${value}`);
        },
        kill: () => {
          effect.killed = true;
          log.push(`kill ${el.id}`);
        },
      };
    },
    onScroll: (fn) => (listeners.scroll.add(fn), () => listeners.scroll.delete(fn)),
    onFocusIn: (el, fn) => (listeners.focus.set(el, fn), () => listeners.focus.delete(el)),
    onBeforePrint: (fn) => (listeners.print.add(fn), () => listeners.print.delete(fn)),
    onBreakpoint: (fn) => (listeners.breakpoint.add(fn), () => listeners.breakpoint.delete(fn)),
    now: () => time,
    setTimer(fn, ms) {
      const id = nextTimer++;
      timers.push({ at: time + ms, fn, id });
      return id;
    },
    clearTimer(id) {
      timers = timers.filter((t) => t.id !== id);
    },
    played,
    mark: (el, state) => states.set(el, state),
    rest: () => log.push("rest"),
  };

  const runtime = createRuntime(deps);
  const near = () => observers.find((o) => o.margin === "0px 0px 50% 0px");
  const playObserver = (margin: string) => observers.find((o) => o.margin === margin);
  const entry = (el: El, isIntersecting: boolean): Entry<El> => ({ target: el, isIntersecting, boundingClientRect: { top: el.top, bottom: el.top + el.height } });
  return {
    runtime,
    log,
    built,
    states,
    played,
    observers,
    listeners,
    near,
    playObserver,
    st,
    buildsWhileDisabled,
    setAxis: (value: string) => (axis = value),
    async loadCore() {
      core.resolve();
      await flush();
    },
    async loadScrollTrigger() {
      core.resolve();
      stEnabled = true; // ScrollTrigger.register() calls enable()
      scrollTrigger.resolve(st);
      await flush();
    },
    /** The near observer reports these elements coming within half a viewport (or leaving it). */
    async reportNear(els: El[], isIntersecting = true) {
      near()!.callback(els.map((el) => entry(el, isIntersecting)));
      await flush();
    },
    async reportPlay(margin: string, els: El[], isIntersecting = true) {
      playObserver(margin)!.callback(els.map((el) => entry(el, isIntersecting)));
      await flush();
    },
    scroll() {
      for (const fn of [...listeners.scroll]) fn();
    },
    advance(ms: number) {
      const until = time + ms;
      for (;;) {
        const due = timers.filter((t) => t.at <= until).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        time = due.at;
        timers = timers.filter((t) => t !== due);
        due.fn();
      }
      time = until;
    },
    count: (entryText: string) => log.filter((line) => line === entryText).length,
  };
}

const below = (id: string, name: EffectName, top = 1600): El => ({ id, name, top, height: 400 });

describe("arming", () => {
  test("only effects wholly below the viewport arm; those in view or above are never touched", () => {
    const inView = { id: "in-view", name: "card-trace", top: 300, height: 400 } as El;
    const above = { id: "above", name: "reveal", top: -900, height: 400 } as El;
    const straddling = { id: "straddling", name: "reveal", top: 700, height: 400 } as El;
    const pending = below("below", "evidence-trio");
    const t = setup([inView, above, straddling, pending]);
    t.runtime.arm();
    assert.deepEqual([...t.near()!.watched].map((el) => el.id), ["below"]);
    assert.equal(t.count("load core"), 0, "nothing loads before an effect comes near");
    assert.equal(t.count("load scrolltrigger"), 0);
  });

  test("nothing below the viewport: no observer, no listener, no import", () => {
    const t = setup([{ id: "in-view", name: "reveal", top: 100, height: 300 }]);
    t.runtime.arm();
    assert.equal(t.observers.length, 0);
    assert.equal(t.listeners.scroll.size + t.listeners.print.size + t.listeners.breakpoint.size, 0);
    assert.deepEqual(t.log, []);
  });

  test("an element the reader already played (a remount, a breakpoint change) never arms again", () => {
    const effect = below("trio", "evidence-trio");
    const t = setup([effect]);
    t.played.add(effect);
    t.runtime.arm();
    assert.equal(t.observers.length, 0);
  });
});

describe("imports", () => {
  test("the first near effect imports GSAP core and DrawSVG (once), then sets its from-state; no ScrollTrigger", async () => {
    const cards = below("cards", "card-trace", 1200);
    const trio = below("trio", "evidence-trio", 2400);
    const t = setup([cards, trio]);
    t.runtime.arm();
    await t.reportNear([cards]);
    assert.equal(t.count("load core"), 1);
    assert.equal(t.count("build cards"), 0, "built only once GSAP is there");
    await t.loadCore();
    assert.equal(t.count("build cards"), 1);
    assert.equal(t.states.get(cards), "armed");
    await t.reportNear([trio]);
    assert.equal(t.count("load core"), 1, "imported once");
    assert.equal(t.count("build trio"), 1);
    assert.equal(t.count("load scrolltrigger"), 0, "no pipeline near: no ScrollTrigger");
  });

  test("ScrollTrigger is imported only when the pipeline comes near", async () => {
    const trio = below("trio", "evidence-trio", 1200);
    const pipeline = below("pipeline", "pipeline", 2400);
    const t = setup([trio, pipeline]);
    t.runtime.arm();
    await t.reportNear([trio]);
    await t.loadCore();
    assert.equal(t.count("load scrolltrigger"), 0);
    await t.reportNear([pipeline]);
    assert.equal(t.count("load scrolltrigger"), 1);
    await t.loadScrollTrigger();
    assert.equal(t.count("build pipeline"), 1);
  });

  test("an effect that reached the viewport while GSAP loaded stays finished: no from-state", async () => {
    const reveal = below("reveal", "reveal", 1000);
    const t = setup([reveal]);
    t.runtime.arm();
    await t.reportNear([reveal]);
    reveal.top = 500; // the reader scrolled on while the chunk downloaded
    await t.loadCore();
    assert.equal(t.count("build reveal"), 0);
    assert.equal(t.states.get(reveal), "done");
    assert.ok(t.played.has(reveal));
  });
});

describe("one-shot effects play at their threshold, once", () => {
  test("evidence trio at 78%, check cards at 80%, reveals at 88% of the viewport", async () => {
    const trio = below("trio", "evidence-trio", 1200);
    const cards = below("cards", "card-trace", 1800);
    const reveal = below("reveal", "reveal", 2400);
    const t = setup([trio, cards, reveal]);
    t.runtime.arm();
    await t.reportNear([trio, cards, reveal]);
    await t.loadCore();
    assert.ok(t.playObserver("0px 0px -22% 0px")?.watched.has(trio));
    assert.ok(t.playObserver("0px 0px -20% 0px")?.watched.has(cards));
    assert.ok(t.playObserver("0px 0px -12% 0px")?.watched.has(reveal));
    await t.reportPlay("0px 0px -22% 0px", [trio]);
    assert.equal(t.count("play trio"), 1);
    assert.equal(t.states.get(trio), "playing");
    t.built.get(trio)!.completed();
    assert.equal(t.states.get(trio), "done");
    assert.ok(t.played.has(trio));
    await t.reportPlay("0px 0px -22% 0px", [trio]);
    assert.equal(t.count("play trio"), 1, "plays once");
  });
});

describe("ScrollTrigger: parked after 1.5 s without scrolling, enabled again only off-to-on", () => {
  async function scrubbing() {
    const pipeline = below("pipeline", "pipeline", 1200);
    const t = setup([pipeline]);
    t.runtime.arm();
    t.scroll();
    await t.reportNear([pipeline]);
    await t.loadScrollTrigger(); // registering ScrollTrigger enables it
    return { t, pipeline };
  }

  test("still enabled while the reader scrolls; parked 1.5 s after the last scroll", async () => {
    const { t } = await scrubbing();
    assert.equal(t.runtime.scrollTriggerEnabled(), true);
    t.advance(1000);
    t.scroll();
    t.advance(parkAfterMs - 1);
    assert.equal(t.count("st.disable(false)"), 0);
    assert.equal(t.count("st.enable"), 0, "never enabled while it already was");
    t.advance(1);
    assert.equal(t.count("st.disable(false)"), 1, "parked with disable(false): the animation keeps its progress");
    assert.equal(t.runtime.scrollTriggerEnabled(), false);
  });

  test("parking lets GSAP's ticker sleep (nothing runs while the reader rests mid-pipeline)", async () => {
    const { t } = await scrubbing();
    const before = t.count("rest");
    t.advance(parkAfterMs);
    assert.equal(t.count("rest"), before + 1);
  });

  test("a scroll after parking enables it once; more scrolling doesn't call enable() again", async () => {
    const { t } = await scrubbing();
    t.advance(parkAfterMs);
    assert.equal(t.count("st.disable(false)"), 1);
    t.scroll();
    t.scroll();
    t.advance(200);
    t.scroll();
    assert.equal(t.count("st.enable"), 1);
    t.advance(parkAfterMs);
    assert.equal(t.count("st.disable(false)"), 2);
    t.scroll();
    assert.equal(t.count("st.enable"), 2);
  });

  test("registered without a recent scroll (the pipeline came near without one): parked at once", async () => {
    const pipeline = below("pipeline", "pipeline", 1000);
    const t = setup([pipeline]);
    t.runtime.arm();
    t.advance(5000);
    await t.reportNear([pipeline]);
    await t.loadScrollTrigger();
    assert.equal(t.count("build pipeline"), 1, "the trigger exists (and is measured on the next enable)");
    assert.equal(t.count("st.disable(false)"), 1);
  });

  test("the pipeline leaving the near zone (scrolled back up) parks it", async () => {
    const { t, pipeline } = await scrubbing();
    await t.reportNear([pipeline], false);
    assert.equal(t.count("st.disable(false)"), 1);
    t.scroll();
    assert.equal(t.count("st.enable"), 0, "not near: stays parked");
  });
});

describe("finishing without playing", () => {
  test("a jump past an effect (the observer reports it above the viewport, unplayed) finishes it", async () => {
    const trio = below("trio", "evidence-trio", 1200);
    const t = setup([trio, below("cards", "card-trace", 3000)]);
    t.runtime.arm();
    await t.reportNear([trio]);
    await t.loadCore();
    trio.top = -2000;
    await t.reportNear([trio], false);
    assert.equal(t.count("finish trio"), 1);
    assert.equal(t.states.get(trio), "done");
  });

  test("a jump the observer never saw (End: from below to above in one frame) is caught on scroll", async () => {
    const trio = below("trio", "evidence-trio", 1200);
    const t = setup([trio, below("cards", "card-trace", 3000)]);
    t.runtime.arm();
    await t.reportNear([trio]);
    await t.loadCore();
    trio.top = -2000;
    t.scroll();
    assert.equal(t.count("finish trio"), 1);
  });

  test("a jump past an effect that was never built leaves it as the server rendered it, and nothing builds it later", async () => {
    const trio = below("trio", "evidence-trio", 1200);
    const t = setup([trio, below("cards", "card-trace", 3000)]);
    t.runtime.arm();
    await t.reportNear([trio]);
    trio.top = -2000;
    t.scroll();
    await t.loadCore();
    assert.equal(t.count("build trio"), 0);
    assert.equal(t.states.get(trio), "done");
  });

  test("focus moving into an effect finishes it", async () => {
    const cards = below("cards", "card-trace", 1200);
    const t = setup([cards, below("trio", "evidence-trio", 3000)]);
    t.runtime.arm();
    await t.reportNear([cards]);
    await t.loadCore();
    t.listeners.focus.get(cards)!();
    assert.equal(t.count("finish cards"), 1);
    assert.equal(t.listeners.focus.has(cards), false);
  });

  test("printing finishes every pending effect", async () => {
    const cards = below("cards", "card-trace", 1200);
    const trio = below("trio", "evidence-trio", 2000);
    const reveal = below("reveal", "reveal", 3000);
    const t = setup([cards, trio, reveal]);
    t.runtime.arm();
    await t.reportNear([cards, trio]);
    await t.loadCore();
    for (const fn of [...t.listeners.print]) fn();
    assert.equal(t.count("finish cards"), 1);
    assert.equal(t.count("finish trio"), 1);
    assert.equal(t.states.get(reveal), "done");
  });

  test("a jump past the pipeline finishes it and disables ScrollTrigger for good", async () => {
    const pipeline = below("pipeline", "pipeline", 1200);
    const t = setup([pipeline]);
    t.runtime.arm();
    t.scroll();
    await t.reportNear([pipeline]);
    await t.loadScrollTrigger();
    pipeline.top = -3000;
    t.scroll();
    assert.equal(t.count("finish pipeline"), 1);
    assert.equal(t.count("st.disable(false)"), 1);
    t.scroll();
    assert.equal(t.count("st.enable"), 0);
  });
});

describe("done: once nothing is pending, nothing is left running", () => {
  test("the pipeline completes: its trigger is killed with its animation kept, ScrollTrigger disabled for good, observers and listeners gone", async () => {
    const pipeline = below("pipeline", "pipeline", 1200);
    const t = setup([pipeline]);
    t.runtime.arm();
    t.scroll();
    await t.reportNear([pipeline]);
    await t.loadScrollTrigger();
    t.built.get(pipeline)!.completed();
    assert.equal(t.count("finish pipeline"), 1, "finish() kills the trigger, keeping the animation at its end");
    assert.equal(t.count("st.disable(false)"), 1);
    assert.ok(t.observers.every((o) => o.disconnected));
    assert.equal(t.listeners.scroll.size + t.listeners.print.size + t.listeners.breakpoint.size + t.listeners.focus.size, 0);
    t.scroll();
    t.advance(10_000);
    assert.equal(t.count("st.enable"), 0);
    assert.ok(t.count("rest") >= 1, "the GSAP ticker is put to sleep once idle");
  });

  test("the last one-shot completing tears everything down too", async () => {
    const cards = below("cards", "card-trace", 1200);
    const reveal = below("reveal", "reveal", 2000);
    const t = setup([cards, reveal]);
    t.runtime.arm();
    await t.reportNear([cards, reveal]);
    await t.loadCore();
    await t.reportPlay("0px 0px -20% 0px", [cards]);
    t.built.get(cards)!.completed();
    assert.ok(!t.observers.every((o) => o.disconnected), "a reveal is still pending");
    await t.reportPlay("0px 0px -12% 0px", [reveal]);
    t.built.get(reveal)!.completed();
    assert.ok(t.observers.every((o) => o.disconnected));
    assert.equal(t.listeners.scroll.size, 0);
  });
});

describe("a breakpoint change", () => {
  // DESIGN.md §4.4 #5 asked for a rebuild at the current progress. Measured in the lab (review round 1), a rebuilt
  // scrubbed trigger jumps to the progress of the scroll position on the new axis (lit rings went from 3 to 2), and one
  // rebuilt while ScrollTrigger is parked is dead (the pipeline froze half-drawn). The runtime finishes it instead:
  // the drawn line is the server's frame, and nothing lit ever goes out (§4.6 #10).
  test("finishes an unfinished pipeline: the line is drawn, nothing lit goes out, nothing is rebuilt", async () => {
    const pipeline = below("pipeline", "pipeline", 1200);
    const t = setup([pipeline]);
    t.runtime.arm();
    t.scroll();
    await t.reportNear([pipeline]);
    await t.loadScrollTrigger();
    t.built.get(pipeline)!.progress = 0.4;
    t.setAxis("y");
    for (const fn of [...t.listeners.breakpoint]) fn();
    assert.equal(t.count("finish pipeline"), 1);
    assert.equal(t.built.get(pipeline)!.progress, 1, "the line is drawn to the end");
    assert.equal(t.count("build pipeline"), 1, "no second trigger");
    assert.equal(t.count("kill pipeline"), 0, "never reverted to the unlit frame");
    assert.equal(t.states.get(pipeline), "done");
    assert.ok(t.played.has(pipeline));
    assert.equal(t.runtime.scrollTriggerEnabled(), false, "ScrollTrigger disabled for good");
    assert.equal(t.listeners.breakpoint.size, 0, "nothing pending: the listeners are gone");
  });

  test("a breakpoint change while ScrollTrigger is parked builds no trigger while it is disabled, and finishes the pipeline", async () => {
    const pipeline = below("pipeline", "pipeline", 1200);
    const trio = below("trio", "evidence-trio", 3000);
    const t = setup([pipeline, trio]);
    t.runtime.arm();
    t.scroll();
    await t.reportNear([pipeline]);
    await t.loadScrollTrigger();
    t.advance(parkAfterMs);
    assert.equal(t.count("st.disable(false)"), 1, "parked");
    t.built.get(pipeline)!.progress = 0.5;
    for (const fn of [...t.listeners.breakpoint]) fn();
    assert.deepEqual(t.buildsWhileDisabled, [], "no pipeline built while ScrollTrigger is disabled");
    assert.equal(t.count("finish pipeline"), 1);
    assert.equal(t.states.get(pipeline), "done");
    assert.equal(t.count("st.enable"), 0, "not woken for nothing");
    t.scroll();
    assert.equal(t.count("st.enable"), 0, "retired: a later scroll never enables it again");
    assert.equal(t.listeners.breakpoint.size, 1, "the trio still pending: the runtime stays armed");
  });

  test("never replays a played effect or re-arms one waiting to play", async () => {
    const cards = below("cards", "card-trace", 1200);
    const trio = below("trio", "evidence-trio", 2000);
    const t = setup([cards, trio, below("reveal", "reveal", 4000)]);
    t.runtime.arm();
    await t.reportNear([cards, trio]);
    await t.loadCore();
    await t.reportPlay("0px 0px -20% 0px", [cards]);
    t.built.get(cards)!.completed();
    for (const fn of [...t.listeners.breakpoint]) fn();
    assert.equal(t.count("build cards"), 1);
    assert.equal(t.count("play cards"), 1);
    assert.equal(t.count("build trio"), 1);
    assert.equal(t.count("kill trio"), 0);
  });
});

describe("destroy (reduced motion turned on mid-visit)", () => {
  test("reverts every unfinished effect to the server's state, disables ScrollTrigger and removes everything", async () => {
    const trio = below("trio", "evidence-trio", 1200);
    const pipeline = below("pipeline", "pipeline", 2000);
    const t = setup([trio, pipeline]);
    t.runtime.arm();
    t.scroll();
    await t.reportNear([trio, pipeline]);
    await t.loadScrollTrigger();
    t.runtime.destroy();
    assert.equal(t.count("kill trio"), 1);
    assert.equal(t.count("kill pipeline"), 1);
    assert.equal(t.count("st.disable(false)"), 1);
    assert.ok(t.observers.every((o) => o.disconnected));
    assert.equal(t.listeners.scroll.size, 0);
  });
});

describe("re-entry", () => {
  test("a timeline whose finish() fires its own onComplete finishes once", async () => {
    const trio = below("trio", "evidence-trio", 1200);
    const t = setup([trio, below("cards", "card-trace", 3000)]);
    t.runtime.arm();
    await t.reportNear([trio]);
    await t.loadCore();
    const effect = t.built.get(trio)!;
    // finish() on a GSAP timeline renders its end, which calls onComplete (the runtime's `done`) from inside finish().
    const finishCalls: string[] = [];
    const original = t.log.push.bind(t.log);
    t.log.push = (...lines: string[]) => {
      for (const line of lines) if (line === "finish trio") effect.completed();
      finishCalls.push(...lines);
      return original(...lines);
    };
    for (const fn of [...t.listeners.print]) fn();
    assert.equal(finishCalls.filter((l) => l === "finish trio").length, 1);
    assert.equal(t.states.get(trio), "done");
  });
});

describe("keepProgressOnEnable: a resume never rewinds the pipeline (§4.6 #10, R3)", () => {
  test("ScrollTrigger.enable() renders the timeline at 0; the wrapper puts it back and has ScrollTrigger re-read the scroll", () => {
    const calls: string[] = [];
    let progress = 0.506;
    const timeline = {
      progress(value?: number) {
        if (value === undefined) return progress;
        calls.push(`progress(${value})`);
        progress = value;
        return timeline;
      },
    } as { progress(): number; progress(value: number): unknown };
    const scrollTrigger = {
      enable() {
        calls.push("enable");
        progress = 0; // what ScrollTrigger.enable() does to a scrubbed animation (measured on the M1 harness)
      },
      disable: (reset?: boolean) => calls.push(`disable(${reset})`),
      update: () => calls.push(`update at ${progress}`),
    };
    const wrapped = keepProgressOnEnable(scrollTrigger, () => timeline);
    wrapped.enable();
    assert.deepEqual(calls, ["enable", "progress(0.506)", "update at 0.506"]);
    wrapped.disable(false);
    assert.deepEqual(calls.at(-1), "disable(false)");
  });

  test("no pipeline built (or finished): enable() alone", () => {
    const calls: string[] = [];
    const wrapped = keepProgressOnEnable({ enable: () => calls.push("enable"), disable: () => {}, update: () => calls.push("update") }, () => undefined);
    wrapped.enable();
    assert.deepEqual(calls, ["enable"]);
  });
});
