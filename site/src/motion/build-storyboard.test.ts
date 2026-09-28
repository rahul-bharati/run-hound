// The timeline builder (src/motion/build-storyboard.ts) turns a storyboard into GSAP calls. GSAP is injected, so a
// fake records the calls: a paused timeline, the labels, fromTo with the from-state applied at build (or when the step
// starts, for parts that rest hidden by class), rises as the tokens' px, strokes drawn with DrawSVG or with a measured
// dash, named eases as the tokens' functions, and measured values for the scan's sweep and the 404 hound's walk.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildStoryboard } from "./build-storyboard";
import type { Storyboard } from "./storyboard";
import { cssTokens } from "./tokens";

type Call = { method: string; targets?: unknown; from?: Record<string, unknown>; to?: Record<string, unknown>; position?: unknown };

function fakeGsap() {
  const calls: Call[] = [];
  let timelineVars: Record<string, unknown> | undefined;
  const timeline = {
    addLabel(label: string, position?: number) {
      calls.push({ method: "addLabel", targets: label, position });
      return timeline;
    },
    fromTo(targets: unknown, from: Record<string, unknown>, to: Record<string, unknown>, position?: number) {
      calls.push({ method: "fromTo", targets, from, to, position });
      return timeline;
    },
    to(targets: unknown, to: Record<string, unknown>, position?: number) {
      calls.push({ method: "to", targets, to, position });
      return timeline;
    },
  };
  return {
    calls,
    get timelineVars() {
      return timelineVars;
    },
    gsap: {
      timeline(vars?: Record<string, unknown>) {
        timelineVars = vars;
        return timeline;
      },
    },
  };
}

const tokens = cssTokens();
const el = (name: string, extra: Record<string, unknown> = {}) => ({ name, ...extra }) as unknown as Element;

describe("buildStoryboard", () => {
  const board: Storyboard = {
    name: "hero-run",
    labels: { explore: 0, run: 1.3 },
    parts: { a: 2, b: 1, c: 3 },
    steps: [
      { part: "a", at: 0.1, stagger: "stagger", duration: "short", ease: "enter", from: { opacity: 0, y: "rise-sm" }, to: { opacity: 1, y: 0 } },
      { part: "b", at: 0.5, duration: 0.4, ease: "none", to: { scaleX: 1 }, repeat: 1, yoyo: true },
      { part: "c", at: 0, times: [0.3, 0.35, 0.4], duration: "micro", ease: "move", from: { draw: 0 }, to: { draw: 1 } },
      { part: "a", index: 1, at: 2, duration: "long", ease: "exit", from: { opacity: 1 }, to: { opacity: 0 }, lazyFrom: true },
      { part: "missing", at: 0, duration: "short", ease: "enter", to: { opacity: 1 } },
    ],
  };
  const parts: Record<string, Element[]> = { a: [el("a0"), el("a1")], b: [el("b0")], c: [el("c0"), el("c1"), el("c2")] };
  const select = (part: string) => parts[part] ?? [];

  test("a paused timeline with the storyboard's labels", () => {
    const fake = fakeGsap();
    buildStoryboard(fake.gsap, board, select, tokens, { draw: "drawsvg" });
    assert.equal(fake.timelineVars?.paused, true);
    assert.deepEqual(
      fake.calls.filter((c) => c.method === "addLabel").map((c) => [c.targets, c.position]),
      [
        ["explore", 0],
        ["run", 1.3],
      ],
    );
  });

  test("a fromTo with its from-state applied at build; rises in px from the tokens; the stagger token; the ease function", () => {
    const fake = fakeGsap();
    buildStoryboard(fake.gsap, board, select, tokens, { draw: "drawsvg" });
    const [first] = fake.calls.filter((c) => c.method === "fromTo");
    assert.deepEqual(first.targets, parts.a);
    assert.deepEqual(first.from, { opacity: 0, y: 8 });
    assert.equal(first.to?.opacity, 1);
    assert.equal(first.to?.y, 0);
    assert.equal(first.to?.duration, 0.18);
    assert.equal(first.to?.stagger, 0.04);
    assert.equal(first.to?.immediateRender, true);
    assert.equal(first.to?.ease, tokens.enter);
    assert.equal(first.position, 0.1);
  });

  test("a tween from wherever the part is; a literal duration; ease none; repeat and yoyo", () => {
    const fake = fakeGsap();
    buildStoryboard(fake.gsap, board, select, tokens, { draw: "drawsvg" });
    const [call] = fake.calls.filter((c) => c.method === "to");
    assert.deepEqual(call.targets, parts.b);
    assert.deepEqual(call.to, { scaleX: 1, duration: 0.4, ease: "none", repeat: 1, yoyo: true });
    assert.equal(call.position, 0.5);
  });

  test("per-element times: one tween per element at its own time; drawSVG from 0% to 100%", () => {
    const fake = fakeGsap();
    buildStoryboard(fake.gsap, board, select, tokens, { draw: "drawsvg" });
    const draws = fake.calls.filter((c) => c.method === "fromTo" && c.from && "drawSVG" in c.from);
    assert.deepEqual(draws.map((c) => [c.targets, c.position]), [
      [parts.c[0], 0.3],
      [parts.c[1], 0.35],
      [parts.c[2], 0.4],
    ]);
    assert.deepEqual(draws[0].from, { drawSVG: "0%" });
    assert.equal(draws[0].to?.drawSVG, "100%");
  });

  test("index picks one element; lazyFrom applies the from-state only when the step starts", () => {
    const fake = fakeGsap();
    buildStoryboard(fake.gsap, board, select, tokens, { draw: "drawsvg" });
    const call = fake.calls.find((c) => c.method === "fromTo" && c.position === 2)!;
    assert.equal(call.targets, parts.a[1]);
    assert.equal(call.to?.immediateRender, false);
  });

  test("clear: the step's end clears the part's inline opacity and transform (clearProps), so its rest class alone hides it", () => {
    const fake = fakeGsap();
    const clearing: Storyboard = {
      ...board,
      steps: [
        { part: "a", index: 0, at: 0, duration: "short", ease: "move", from: { opacity: 1 }, to: { y: 10 }, lazyFrom: true },
        { part: "a", index: 0, at: 0.4, duration: "short", ease: "exit", to: { opacity: 0 }, clear: true },
      ],
    };
    buildStoryboard(fake.gsap, clearing, select, tokens, { draw: "drawsvg" });
    const [first, last] = fake.calls.filter((c) => c.method !== "addLabel");
    assert.equal(first.to?.clearProps, undefined);
    assert.equal(last.to?.clearProps, "opacity,transform");
  });

  test("a part with no elements adds nothing", () => {
    const fake = fakeGsap();
    buildStoryboard(fake.gsap, board, select, tokens, { draw: "drawsvg" });
    assert.equal(fake.calls.filter((c) => c.method !== "addLabel").length, 6);
  });

  test("dash drawing (no DrawSVG): the stroke's measured length, as a dash offset", () => {
    const fake = fakeGsap();
    const path = el("tick", { getTotalLength: () => 13.5 });
    buildStoryboard(fake.gsap, { ...board, steps: [board.steps[2]] }, (p) => (p === "c" ? [path] : []), tokens, { draw: "dash" });
    const [call] = fake.calls.filter((c) => c.method === "fromTo");
    const value = (v: unknown) => (typeof v === "function" ? (v as (i: number, t: Element) => unknown)(0, path) : v);
    assert.equal(value(call.from?.strokeDasharray), "13.5 13.5");
    assert.equal(value(call.from?.strokeDashoffset), 13.5);
    assert.equal(value(call.to?.strokeDashoffset), 0);
    assert.equal("drawSVG" in (call.from ?? {}), false);
  });

  test("measured values: the scan's sweep and the hound's walk come from the page, per element", () => {
    const fake = fakeGsap();
    const scan = el("scan");
    const measured: Element[] = [];
    buildStoryboard(
      fake.gsap,
      {
        ...board,
        steps: [
          { part: "s", at: 0, duration: "scan", ease: "move", from: { y: 0 }, to: { y: "sweep" } },
          { part: "s", at: 0, duration: 1.3, ease: "move", from: { x: "walk" }, to: { x: 0 } },
        ],
      },
      () => [scan],
      tokens,
      { draw: "drawsvg", measures: { sweep: (e) => (measured.push(e), 212), walk: () => -340 } },
    );
    const [sweep, walk] = fake.calls.filter((c) => c.method === "fromTo");
    const value = (v: unknown) => (typeof v === "function" ? (v as (i: number, t: Element) => unknown)(0, scan) : v);
    assert.equal(value(sweep.to?.y), 212);
    assert.equal(value(walk.from?.x), -340);
    assert.deepEqual(measured, [scan]);
  });

  test("a rotation origin in the owner svg's viewBox", () => {
    const fake = fakeGsap();
    const head = el("head", { ownerSVGElement: { viewBox: { baseVal: { x: 0, y: 0, width: 640, height: 368 } } } });
    buildStoryboard(
      fake.gsap,
      { ...board, steps: [{ part: "h", at: 0.4, duration: "micro", ease: "move", from: { rotation: 0 }, to: { rotation: 6 }, svgOrigin: [0.35, 0.85] }] },
      () => [head],
      tokens,
      { draw: "drawsvg" },
    );
    const [call] = fake.calls.filter((c) => c.method === "fromTo");
    assert.equal(call.to?.svgOrigin, "224 312.8");
    assert.equal(call.from?.svgOrigin, "224 312.8");
  });

  test("the part '' is the root itself (the reveal)", () => {
    const fake = fakeGsap();
    const root = el("root");
    buildStoryboard(fake.gsap, { ...board, steps: [{ part: "", at: 0, duration: "medium", ease: "enter", from: { opacity: 0 }, to: { opacity: 1 } }] }, (p) => (p === "" ? [root] : []), tokens, {
      draw: "drawsvg",
    });
    assert.deepEqual(fake.calls.find((c) => c.method === "fromTo")?.targets, [root]);
  });
});
