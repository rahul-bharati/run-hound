// How the hero run starts when its island mounts (DESIGN.md §4.4 "The hero island", steps 3-4): rest on the finished
// frame when the 3 s fallback already showed it in view; rewind and wait when the fallback fired off screen; play at
// once when the window is at least half visible, from the "run" label when the island is later than 1.7 s after
// navigation (the late-start rule); otherwise wait until it is half visible and play from 0. `pnpm test`.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { heroStart, visibleFraction } from "./hero-run-start";

describe("visibleFraction", () => {
  test("how much of a box is inside the viewport", () => {
    assert.equal(visibleFraction({ top: 100, bottom: 500 }, 900), 1);
    assert.equal(visibleFraction({ top: 700, bottom: 1100 }, 900), 0.5);
    assert.equal(visibleFraction({ top: 1000, bottom: 1400 }, 900), 0);
    assert.equal(visibleFraction({ top: -300, bottom: 100 }, 900), 0.25);
    assert.equal(visibleFraction({ top: 10, bottom: 10 }, 900), 0);
    // Taller than the viewport: wholly visible once it fills it, half once it fills half.
    assert.equal(visibleFraction({ top: -200, bottom: 1800 }, 900), 1);
    assert.equal(visibleFraction({ top: 450, bottom: 2450 }, 900), 0.5);
  });
});

describe("heroStart", () => {
  test("the fallback showed the finished frame while the window was (even partly) in view: rest there, with Replay", () => {
    assert.deepEqual(heroStart({ fallbackShown: true, visible: 1, sinceNavigationMs: 3200 }), { kind: "rest" });
    assert.deepEqual(heroStart({ fallbackShown: true, visible: 0.2, sinceNavigationMs: 3200 }), { kind: "rest" });
  });

  test("the fallback fired with the window off screen (phones): nobody saw it, so rewind and play from 0 when half visible", () => {
    assert.deepEqual(heroStart({ fallbackShown: true, visible: 0, sinceNavigationMs: 3200 }), { kind: "wait" });
  });

  test("in view (desktop): play at once, from 0", () => {
    assert.deepEqual(heroStart({ fallbackShown: false, visible: 1, sinceNavigationMs: 900 }), { kind: "play", from: 0 });
    assert.deepEqual(heroStart({ fallbackShown: false, visible: 0.5, sinceNavigationMs: 1700 }), { kind: "play", from: 0 });
  });

  test("the late-start rule: in view and later than 1.7 s after navigation, play from the run label", () => {
    assert.deepEqual(heroStart({ fallbackShown: false, visible: 1, sinceNavigationMs: 1701 }), { kind: "play", from: "run" });
  });

  test("not yet half visible (phones): wait, and a run that waited always plays from 0", () => {
    assert.deepEqual(heroStart({ fallbackShown: false, visible: 0.3, sinceNavigationMs: 2500 }), { kind: "wait" });
  });
});
