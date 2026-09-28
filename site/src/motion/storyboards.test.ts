// The storyboards of DESIGN.md §4.3 as data, timed with tokens.css's values: one accent-coloured thing moves at a time
// (§4.1 rule 6: each storyboard's accent intervals don't overlap), the hero's finding lands by 1.9 s and the run ends
// by 2.8 s, the 404 ends by 2.0 s, the hero's labels are all there, rises are the 8 and 16 px tokens (rule 5), and
// every part a storyboard moves is in the DOM contract P1, F2 and F3 render (src/motion/dom-contract.ts). `pnpm test`.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { domContract } from "./dom-contract";
import { cardTraceStoryboard, cardTraceTickTimes } from "./effects/card-trace";
import { evidenceTrioStoryboard } from "./effects/evidence-trio";
import { pipelineStoryboard } from "./effects/pipeline";
import { revealStoryboard } from "./effects/reveal";
import { heroRunStoryboard } from "./hero-run-storyboard";
import { accentOverlaps, accentSpans, type Step, type Storyboard, stepSpan, storyboardEnd } from "./storyboard";
import { cssTokens } from "./tokens";
import { trail404Storyboard } from "./trail-404-storyboard";

const tokens = cssTokens();
const close = (actual: number, expected: number, message?: string) => assert.ok(Math.abs(actual - expected) < 1e-9, message ?? `${actual} ≠ ${expected}`);
const stepsOf = (board: Storyboard, part: string) => board.steps.filter((step) => step.part === part);
const firstAt = (board: Storyboard, part: string) => Math.min(...stepsOf(board, part).map((step) => stepSpan(step, board, tokens)[0]));

// The pipeline's storyboard depends on the connectors' measured lengths: 5 equal columns on desktop, rows of different
// heights on phones.
const desktopPipeline = pipelineStoryboard([240, 240, 240, 240]);
const phonePipeline = pipelineStoryboard([96, 150, 120, 180]);

const all: [string, Storyboard][] = [
  ["hero-run", heroRunStoryboard],
  ["pipeline (desktop)", desktopPipeline],
  ["pipeline (phone)", phonePipeline],
  ["evidence-trio", evidenceTrioStoryboard],
  ["card-trace", cardTraceStoryboard],
  ["reveal", revealStoryboard],
  ["trail-404", trail404Storyboard],
];

describe("every storyboard", () => {
  for (const [name, board] of all) {
    test(`${name}: one accent-coloured thing moves at a time (rule 6)`, () => {
      assert.deepEqual(accentOverlaps(board, tokens), []);
    });

    test(`${name}: moves only parts of its DOM contract, as many as the contract has`, () => {
      const contract = domContract[board.name];
      assert.ok(contract, `no DOM contract for ${board.name}`);
      for (const step of board.steps) {
        if (step.part === "") continue; // the root itself (the reveal)
        assert.ok(step.part in contract.parts, `${board.name} moves "${step.part}", which isn't in its DOM contract`);
      }
      assert.deepEqual(board.parts, contract.parts);
    });

    test(`${name}: transform, opacity and stroke drawing only; rises are the 8 and 16 px tokens (rule 5)`, () => {
      const allowed = new Set(["opacity", "x", "y", "scale", "scaleX", "scaleY", "rotation", "draw"]);
      for (const step of board.steps) {
        for (const vars of [step.from ?? {}, step.to]) {
          for (const [key, value] of Object.entries(vars)) {
            assert.ok(allowed.has(key), `${board.name} ${step.part}: ${key}`);
            if (key === "y" && value !== 0 && value !== "sweep") assert.ok(value === "rise-sm" || value === "rise-md", `${board.name} ${step.part}: y ${value}`);
            if (key === "opacity" || key === "draw") assert.ok(typeof value === "number" && value >= 0 && value <= 1);
          }
        }
      }
    });

    test(`${name}: a part that rests hidden (by class) ends with its inline opacity and transform cleared (rule 8)`, () => {
      const contract = domContract[board.name as keyof typeof domContract];
      for (const part of contract.restHidden) {
        // Each element's own steps (index), or the part's, the last one to end clears.
        const groups = new Map<number | undefined, Step[]>();
        for (const step of stepsOf(board, part)) groups.set(step.index, [...(groups.get(step.index) ?? []), step]);
        assert.ok(groups.size > 0, `${part} never moves`);
        for (const [index, steps] of groups) {
          const last = steps.reduce((a, b) => (stepSpan(b, board, tokens)[1] >= stepSpan(a, board, tokens)[1] ? b : a));
          assert.equal(last.clear, true, `${part}${index === undefined ? "" : ` ${index}`}: its last step (at ${last.at}) clears its inline style`);
          for (const step of steps) if (step !== last) assert.ok(!step.clear, `${part} at ${step.at} clears before its last step`);
        }
      }
      for (const step of board.steps) if (step.clear) assert.ok(contract.restHidden.includes(step.part), `${step.part} clears but doesn't rest hidden`);
    });

    test(`${name}: ends within 5 s (WCAG 2.2.2) and nothing repeats forever`, () => {
      assert.ok(storyboardEnd(board, tokens) <= 5);
      for (const step of board.steps) assert.ok((step.repeat ?? 0) >= 0 && (step.repeat ?? 0) < 4);
    });
  }
});

describe("hero run (§4.3)", () => {
  const board = heroRunStoryboard;

  test("its five beats are labels at 0, 0.60, 1.12, 1.30 and 1.88 s", () => {
    assert.deepEqual(board.labels, { explore: 0, plan: 0.6, approve: 1.12, run: 1.3, report: 1.88 });
  });

  test("the finding card lands by 1.9 s (and is fully visible by about 2.0), and the run ends by 2.8 s", () => {
    const finding = firstAt(board, "finding");
    assert.ok(finding <= 1.9, `finding at ${finding}`);
    close(finding, 1.88);
    assert.ok(storyboardEnd(board, tokens) <= 2.8, `ends at ${storyboardEnd(board, tokens)}`);
    close(storyboardEnd(board, tokens), 2.73);
  });

  test("the beats of the table: chips at 0.10 / 0.17 / 0.24, found 0.30, +16 more 0.76, ticks 0.88, saved copies 1.55 and 1.70, requests 2.00 and 2.12, stamp 2.30, spec chip 2.55", () => {
    const chips = stepsOf(board, "chip")[0];
    assert.deepEqual([chips.at, chips.stagger], [0.1, 0.07]);
    close(firstAt(board, "found"), 0.3);
    close(firstAt(board, "plan-more"), 0.76);
    close(firstAt(board, "tick"), 0.88);
    close(firstAt(board, "saved-1"), 1.55);
    close(firstAt(board, "saved-2"), 1.7);
    close(firstAt(board, "request-1"), 2.0);
    close(firstAt(board, "request-2"), 2.12);
    close(firstAt(board, "stamp"), 2.3);
    close(firstAt(board, "spec-chip"), 2.55);
  });

  test("the rail reaches 25, 50, 75 and 100% on the plan, approve, run and report beats, and lights nodes 2-5 with it", () => {
    const rail = stepsOf(board, "rail-line");
    assert.deepEqual(rail.map((s) => [s.at, s.to.scaleX]), [
      [0.6, 0.25],
      [1.12, 0.5],
      [1.3, 0.75],
      [1.88, 1],
    ]);
    assert.equal(rail[0].from?.scaleX, 0);
    for (const [i, beat] of [0.6, 1.12, 1.3, 1.88].entries()) close(firstAt(board, `node-${i + 2}`), beat);
  });

  test("the progress bar fills linearly from 1.48 to 1.88; the stamp lands from 1.15 and -12° to -4°", () => {
    const [bar] = stepsOf(board, "progress");
    assert.deepEqual([bar.at, bar.duration, bar.ease, bar.from?.scaleX, bar.to.scaleX], [1.48, 0.4, "none", 0, 1]);
    const [stamp] = stepsOf(board, "stamp");
    assert.deepEqual([stamp.from, stamp.to, stamp.ease], [{ opacity: 0, scale: 1.15, rotation: -12 }, { opacity: 1, scale: 1, rotation: -4 }, "stamp"]);
  });

  test("the accent movers are the scan, the rail, the ticks, the progress bar and the stamp, one after another", () => {
    const spans = accentSpans(board, tokens);
    assert.deepEqual([...spans.keys()].sort(), ["progress", "rail", "scan", "stamp", "ticks"]);
  });

  test("the scan line and the press ring rest invisible (by class), so their from-states apply only when they start", () => {
    for (const part of ["scan", "press-ring"]) {
      for (const step of stepsOf(board, part)) if (step.from) assert.equal(step.lazyFrom, true, `${part} at ${step.at}`);
      assert.ok(domContract["hero-run"].restHidden.includes(part));
    }
  });

  test("the press ring pulses twice on Book in neutral colour (2 × micro), not an accent", () => {
    const [ring] = stepsOf(board, "press-ring");
    assert.deepEqual([ring.at, ring.duration, ring.repeat, ring.accent], [1.3, "micro", 1, undefined]);
  });

  test("every part of the DOM contract but the Replay slot is moved", () => {
    const moved = new Set(board.steps.map((s) => s.part));
    for (const part of Object.keys(domContract["hero-run"].parts)) {
      if (part === "replay-slot") assert.ok(!moved.has(part));
      else assert.ok(moved.has(part), `${part} never moves`);
    }
  });
});

describe("pipeline (§4.3): connectors at constant speed, node i + 1 lit when connector i completes", () => {
  for (const [name, lengths, board] of [
    ["desktop", [240, 240, 240, 240], desktopPipeline],
    ["phone", [96, 150, 120, 180], phonePipeline],
  ] as const) {
    test(`${name}: durations proportional to the lengths, ease none, one after another`, () => {
      const connectors = stepsOf(board, "connector");
      assert.equal(connectors.length, 4);
      const speeds = connectors.map((s, i) => lengths[i] / (s.duration as number));
      for (const speed of speeds) close(speed, speeds[0]);
      for (const [i, step] of connectors.entries()) {
        assert.equal(step.ease, "none");
        assert.equal(step.index, i);
        if (i > 0) close(step.at, connectors[i - 1].at + (connectors[i - 1].duration as number));
      }
    });

    test(`${name}: ring 1 is lit from the start; ring i + 1 lights as connector i completes`, () => {
      const connectors = stepsOf(board, "connector");
      const rings = stepsOf(board, "node-ring");
      assert.deepEqual(rings.map((s) => s.index), [1, 2, 3, 4]);
      for (const [i, ring] of rings.entries()) {
        close(ring.at, connectors[i].at + (connectors[i].duration as number));
        assert.deepEqual([ring.from, ring.to], [{ opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1 }]);
      }
    });
  }

  test("the drawn line is the one accent object", () => {
    assert.deepEqual([...accentSpans(desktopPipeline, tokens).keys()], ["line"]);
  });
});

describe("evidence trio (§4.3)", () => {
  const board = evidenceTrioStoryboard;
  test("pictures rise at 0 / 0.12 / 0.24; the outline draws at 0.10; the stamp at 1.00; the outline hands over at 1.20; rest by 1.65", () => {
    const [media] = stepsOf(board, "media");
    assert.deepEqual([media.at, media.stagger, media.from, media.to], [0, 0.12, { opacity: 0, y: "rise-md" }, { opacity: 1, y: 0 }]);
    close(firstAt(board, "outline-accent"), 0.1);
    close(firstAt(board, "stamp"), 1.0);
    close(firstAt(board, "outline-rest"), 1.2);
    close(storyboardEnd(board, tokens), 1.65);
  });
  test("the accent outline fades out as the line-strong one fades in; the accent outline rests hidden by class", () => {
    const fade = stepsOf(board, "outline-accent").find((s) => s.to.opacity === 0)!;
    const rest = stepsOf(board, "outline-rest")[0];
    assert.deepEqual([fade.at, fade.duration, fade.ease], [1.2, "long", "exit"]);
    assert.deepEqual([rest.at, rest.duration, rest.ease, rest.to.opacity], [1.2, "long", "enter", 1]);
    assert.ok(domContract["evidence-trio"].restHidden.includes("outline-accent"));
  });
});

describe("check cards (§4.3)", () => {
  const board = cardTraceStoryboard;
  test("card i's dim trace draws at 0.14 i and fades from 0.14 i + 0.8; the band ends at about 1.5 s", () => {
    const draws = stepsOf(board, "trace").filter((s) => s.to.draw === 1);
    assert.deepEqual(draws.map((s) => s.index), [0, 1, 2]);
    for (const step of draws) close(step.at, 0.14 * step.index!);
    const fades = stepsOf(board, "trace").filter((s) => s.to.opacity === 0);
    for (const step of fades) close(step.at, 0.14 * step.index! + 0.8);
    assert.ok(storyboardEnd(board, tokens) <= 1.6);
    assert.ok(board.steps.filter((s) => s.part === "trace").every((s) => s.accent === undefined), "the trace is dim, not accent");
  });
  test("card i's tick k draws at 0.30 + 0.14 i + 0.05 k, micro each", () => {
    const times = cardTraceTickTimes();
    assert.equal(times.length, 12);
    for (let i = 0; i < 3; i += 1) for (let k = 0; k < 4; k += 1) close(times[i * 4 + k], 0.3 + 0.14 * i + 0.05 * k);
    const [ticks] = stepsOf(board, "tick");
    assert.deepEqual([ticks.times, ticks.duration, ticks.accent], [times, "micro", "ticks"]);
  });
});

describe("reveal (§4.3)", () => {
  test("the media wrapper itself: opacity and a 16 px rise, medium, enter, once", () => {
    assert.deepEqual(revealStoryboard.steps, [
      { part: "", at: 0, duration: "medium", ease: "enter", from: { opacity: 0, y: "rise-md" }, to: { opacity: 1, y: 0 } },
    ]);
  });
});

describe("404 (§4.3)", () => {
  const board = trail404Storyboard;
  test("the trail draws and the hound walks for 1.3 s; the nose dips at 0.40 and 0.85; it lifts at 1.30, settles at -6°; all by 2.0 s", () => {
    const [trail] = stepsOf(board, "trail");
    const [walk] = stepsOf(board, "hound");
    assert.deepEqual([trail.at, trail.duration, trail.from?.draw, trail.to.draw], [0, 1.3, 0, 1]);
    assert.deepEqual([walk.at, walk.duration, walk.from?.x, walk.to.x], [0, 1.3, "walk", 0]);
    const head = stepsOf(board, "head");
    assert.deepEqual(head.map((s) => s.to.rotation), [6, 6, -10, -6]);
    for (const [i, at] of [0.4, 0.85, 1.3, 1.3 + tokens.medium].entries()) close(head[i].at, at);
    assert.deepEqual(head.slice(0, 2).map((s) => [s.duration, s.repeat, s.yoyo]), [
      ["micro", 1, true],
      ["micro", 1, true],
    ]);
    assert.deepEqual(head.slice(2).map((s) => [s.duration, s.ease]), [
      ["medium", "stamp"],
      ["short", "move"],
    ]);
    const end = storyboardEnd(board, tokens);
    assert.ok(end <= 2.0, `ends at ${end}`);
    close(end, 1.76);
  });
  test("the trail is dim; the hound (with its accent brow) is the one accent object", () => {
    assert.deepEqual([...accentSpans(board, tokens).keys()], ["hound"]);
    assert.equal(stepsOf(board, "trail")[0].accent, undefined);
  });
  test("every part is held until the island is ready", () => {
    assert.deepEqual([...domContract["trail-404"].held].sort(), ["head", "hound", "trail"]);
  });
});

describe("accentOverlaps finds a violation", () => {
  test("two accent objects moving at once", () => {
    const board: Storyboard = {
      name: "reveal",
      labels: {},
      parts: {},
      steps: [
        { part: "a", at: 0, duration: 0.5, ease: "none", to: { opacity: 1 }, accent: "one" },
        { part: "b", at: 0.4, duration: 0.5, ease: "none", to: { opacity: 1 }, accent: "two" },
        { part: "c", at: 0.9, duration: 0.5, ease: "none", to: { opacity: 1 }, accent: "three" },
      ],
    };
    const overlaps = accentOverlaps(board, tokens);
    assert.equal(overlaps.length, 1);
    assert.match(overlaps[0], /one .* two/);
  });
});
