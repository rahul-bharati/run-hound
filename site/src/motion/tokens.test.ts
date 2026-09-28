// The motion tokens as src/motion/ reads them (DESIGN.md §4.2): the CSS in src/styles/tokens.css is the only copy of
// the numbers, and the browser hands them over minified ("900ms" becomes ".9s", "0ms" "0s"), so the reader parses
// times in ms and s, lengths in px, and turns each cubic-bezier() into an ease function, because GSAP core ignores
// cubic-bezier() strings without CustomEase (gsap-core.js _parseEase). Every name in src/styles/motion-token-names.ts
// is read, and the fallbacks are the CSS's own values. `pnpm test`.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { motionTokenNames } from "@/styles/motion-token-names";
import { declarationsAt, parseCss } from "@/styles/read-tokens";
import { cubicBezier, parseEase, parseLength, parseTime, readMotionTokens, tokenFallbacks } from "./tokens";

const tokensCss = readFileSync(new URL("../styles/tokens.css", import.meta.url), "utf8");
const tree = parseCss(tokensCss);
const css = new Map([...declarationsAt(tree, ["@theme static"]), ...declarationsAt(tree, [":root"])]);
const reduced = declarationsAt(tree, ["@media (prefers-reduced-motion: reduce)", ":root"]);

/** The point of a CSS cubic-bezier(x1, y1, x2, y2) at curve parameter t: the curve's own definition. */
const bezierPoint = ([x1, y1, x2, y2]: number[], t: number) => {
  const at = (p1: number, p2: number) => 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3;
  return { x: at(x1, x2), y: at(y1, y2) };
};

const curves: Record<string, number[]> = {
  "--ease-enter": [0.22, 1, 0.36, 1],
  "--ease-exit": [0.3, 0, 0.8, 0.15],
  "--ease-move": [0.2, 0, 0, 1],
  "--ease-stamp": [0.34, 1.56, 0.64, 1],
};

describe("parseTime: seconds from a CSS time, as written or as the minifier leaves it", () => {
  test("ms and s, with and without a leading zero", () => {
    assert.equal(parseTime("120ms"), 0.12);
    assert.equal(parseTime(".12s"), 0.12);
    assert.equal(parseTime("0.45s"), 0.45);
    assert.equal(parseTime(".9s"), 0.9);
    assert.equal(parseTime("900ms"), 0.9);
    assert.equal(parseTime("3s"), 3);
    assert.equal(parseTime("40ms"), 0.04);
    assert.equal(parseTime(" 600ms "), 0.6);
  });

  test("zero is a value, not a missing token (reduced motion sets 0ms, minified to 0s)", () => {
    assert.equal(parseTime("0s"), 0);
    assert.equal(parseTime("0ms"), 0);
  });

  test("anything else is undefined, so the reader falls back", () => {
    for (const value of ["", "fast", "120", "px", "1.2.3s", "calc(1s)", "-"]) assert.equal(parseTime(value), undefined, value);
  });
});

describe("parseLength: px from a CSS length", () => {
  test("px and a bare 0", () => {
    assert.equal(parseLength("8px"), 8);
    assert.equal(parseLength("16px"), 16);
    assert.equal(parseLength("0px"), 0);
    assert.equal(parseLength("0"), 0);
    assert.equal(parseLength("2.5px"), 2.5);
  });

  test("anything else is undefined", () => {
    for (const value of ["", "8", "1rem", "8 px", "calc(8px)"]) assert.equal(parseLength(value), undefined, value);
  });
});

describe("cubicBezier: the four curves, solved Newton-then-bisection", () => {
  for (const [name, points] of Object.entries(curves)) {
    test(`${name} passes through its own points and its ends`, () => {
      const ease = cubicBezier(points[0], points[1], points[2], points[3]);
      assert.equal(ease(0), 0);
      assert.equal(ease(1), 1);
      for (const t of [0.05, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 0.95]) {
        const { x, y } = bezierPoint(points, t);
        assert.ok(Math.abs(ease(x) - y) < 1e-4, `${name} at x=${x.toFixed(4)}: ${ease(x)} ≠ ${y}`);
      }
    });
  }

  test("known values: enter is fast out of the gate, exit slow, stamp overshoots", () => {
    const enter = cubicBezier(0.22, 1, 0.36, 1);
    const exit = cubicBezier(0.3, 0, 0.8, 0.15);
    const stamp = cubicBezier(0.34, 1.56, 0.64, 1);
    // x(0.5) = 0.375 (x1 + x2) + 0.125 and y(0.5) likewise: enter (0.3425, 0.875); exit (0.5375, 0.18125).
    assert.ok(Math.abs(enter(0.3425) - 0.875) < 1e-4);
    assert.ok(Math.abs(exit(0.5375) - 0.18125) < 1e-4);
    const peak = Math.max(...Array.from({ length: 101 }, (_, i) => stamp(i / 100)));
    assert.ok(peak > 1.05, `stamp peaks at ${peak}`);
  });

  test("x outside 0-1 clamps to the ends", () => {
    const ease = cubicBezier(0.2, 0, 0, 1);
    assert.equal(ease(-0.5), 0);
    assert.equal(ease(1.5), 1);
  });
});

describe("parseEase", () => {
  test("reads the minified form and the written form alike", () => {
    const minified = parseEase("cubic-bezier(.34, 1.56, .64, 1)")!;
    const written = parseEase("cubic-bezier(0.34,1.56,0.64,1)")!;
    for (const x of [0.1, 0.3, 0.5, 0.8]) assert.equal(minified(x), written(x));
  });

  test("anything but four numbers in cubic-bezier() is undefined", () => {
    for (const value of ["", "ease", "linear", "cubic-bezier(1, 2, 3)", "cubic-bezier(a, b, c, d)", "steps(4)"]) {
      assert.equal(parseEase(value), undefined, value);
    }
  });
});

describe("readMotionTokens", () => {
  test("reads every name in motion-token-names.ts, and nothing else", () => {
    const asked = new Set<string>();
    readMotionTokens((name) => {
      asked.add(name);
      return "";
    });
    const all = [...motionTokenNames.durations, ...motionTokenNames.eases, ...motionTokenNames.distances];
    assert.deepEqual([...asked].sort(), [...all].sort());
  });

  test("the fallbacks are tokens.css's own values (so a missing value can't drift from the CSS)", () => {
    const all = [...motionTokenNames.durations, ...motionTokenNames.eases, ...motionTokenNames.distances];
    assert.deepEqual(Object.keys(tokenFallbacks).sort(), [...all].sort());
    for (const name of all) assert.equal(tokenFallbacks[name], css.get(name), `${name}: fallback ${tokenFallbacks[name]}, tokens.css ${css.get(name)}`);
  });

  test("the values of the minified build (motion-token-names.ts records them)", () => {
    const built: Record<string, string> = {
      "--transition-duration-micro": ".12s",
      "--transition-duration-short": ".18s",
      "--transition-duration-medium": ".28s",
      "--transition-duration-long": ".45s",
      "--ease-enter": "cubic-bezier(.22, 1, .36, 1)",
      "--ease-exit": "cubic-bezier(.3, 0, .8, .15)",
      "--ease-move": "cubic-bezier(.2, 0, 0, 1)",
      "--ease-stamp": "cubic-bezier(.34, 1.56, .64, 1)",
      "--motion-rise-sm": "8px",
      "--motion-rise-md": "16px",
      "--motion-nudge": "2px",
      "--motion-stagger": "40ms",
      "--motion-scan": ".6s",
      "--motion-draw": ".9s",
      "--motion-trace": ".8s",
      "--motion-hold": "3s",
    };
    const t = readMotionTokens((name) => built[name] ?? "");
    assert.deepEqual(
      { micro: t.micro, short: t.short, medium: t.medium, long: t.long, scan: t.scan, draw: t.draw, trace: t.trace, hold: t.hold, stagger: t.stagger },
      { micro: 0.12, short: 0.18, medium: 0.28, long: 0.45, scan: 0.6, draw: 0.9, trace: 0.8, hold: 3, stagger: 0.04 },
    );
    assert.deepEqual({ riseSm: t.riseSm, riseMd: t.riseMd, nudge: t.nudge }, { riseSm: 8, riseMd: 16, nudge: 2 });
    const { x, y } = bezierPoint(curves["--ease-stamp"], 0.5);
    assert.ok(Math.abs(t.stamp(x) - y) < 1e-4);
  });

  test("reduced motion's zeros are read as zeros, not replaced by the fallbacks", () => {
    const collapsed: Record<string, string> = { "--motion-rise-sm": "0px", "--motion-stagger": "0s", "--motion-draw": "0s" };
    const t = readMotionTokens((name) => collapsed[name] ?? "");
    assert.equal(t.riseSm, 0);
    assert.equal(t.stagger, 0);
    assert.equal(t.draw, 0);
    // tokens.css collapses exactly these under reduce (the reader must understand each collapsed form).
    for (const [name, value] of reduced) {
      if (!name.startsWith("--motion-") || name === "--motion-ring") continue;
      assert.ok(parseTime(value) === 0 || parseLength(value) === 0, `${name}: ${value}`);
    }
  });

  test("a missing or unreadable value falls back to the CSS's value", () => {
    const t = readMotionTokens(() => "garbage");
    assert.equal(t.micro, 0.12);
    assert.equal(t.draw, 0.9);
    assert.equal(t.hold, 3);
    assert.equal(t.riseMd, 16);
    const { x, y } = bezierPoint(curves["--ease-enter"], 0.25);
    assert.ok(Math.abs(t.enter(x) - y) < 1e-4);
  });

  test("with no reader it reads <html>'s computed style (in the browser)", () => {
    const calls: string[] = [];
    const fake = { documentElement: {} } as unknown as Document;
    const computed = { getPropertyValue: (name: string) => (calls.push(name), name === "--motion-draw" ? " .5s " : "") };
    const t = readMotionTokens(undefined, { document: fake, getComputedStyle: () => computed as unknown as CSSStyleDeclaration });
    assert.equal(t.draw, 0.5);
    assert.ok(calls.includes("--ease-stamp"));
  });
});
