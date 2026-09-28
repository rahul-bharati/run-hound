// Nothing runs while the reader rests (DESIGN.md §4.1 rule 9, §4.6 #4: 0 requestAnimationFrame callbacks in 3 s at
// rest). GSAP's ticker only puts itself to sleep every 120 frames when idle (gsap-core.js Timeline.updateRoot,
// autoSleep), up to 2 s after the last tween, so the motion code puts it to sleep as soon as nothing moves.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { restWhenIdle } from "./build-storyboard";

const animation = (paused: boolean, progress: number) => ({ paused: () => paused, progress: () => progress });
function fake(children: ReturnType<typeof animation>[]) {
  const state = { slept: 0, asked: [] as unknown[] };
  return {
    state,
    gsap: {
      globalTimeline: { getChildren: (...args: unknown[]) => (state.asked.push(args), children) },
      ticker: { sleep: () => (state.slept += 1) },
    },
  };
}

describe("restWhenIdle", () => {
  test("sleeps the ticker when every animation is paused or finished", () => {
    const f = fake([animation(true, 0.3), animation(false, 1)]);
    assert.equal(restWhenIdle(f.gsap), true);
    assert.equal(f.state.slept, 1);
    assert.deepEqual(f.state.asked, [[false, true, true]]);
  });

  test("leaves it awake while something plays (a hero replay, another effect, ScrollTrigger's start-up call)", () => {
    const f = fake([animation(true, 0), animation(false, 0.5)]);
    assert.equal(restWhenIdle(f.gsap), false);
    assert.equal(f.state.slept, 0);
  });

  test("nothing at all: sleeps", () => {
    const f = fake([]);
    assert.equal(restWhenIdle(f.gsap), true);
  });
});
