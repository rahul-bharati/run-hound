// /_design/ (DESIGN.md §3.14; node X1): the header specimens, the motion moments with their Replays and the pipeline's
// range, the D18 optical-size comparison and the forced-colours notes, rendered to HTML as the prerendered page has
// them; and the plan that plays the pipeline at any progress. The lab checks the built page
// (scripts/lab/specs/design.spec.mjs). `pnpm test`.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { createElement } from "react";
import { element, elements, html, textOf } from "@/components/primitives/test-render";
import "@/components/not-found/test-css";
import { headerLinks } from "@/lib/nav";
import { domContract } from "@/motion/dom-contract";
import { cssTokens, tokenFallbacks } from "@/motion/tokens";
import { pipelineStoryboard } from "@/motion/effects/pipeline";
import { type PlanTokens, keyframeOf, pipelinePlan, planStep } from "./pipeline-plan";
import { parseSeconds, readPlanTokens } from "./pipeline-scrub";

// .tsx modules load after test-render's hook (a static import would be loaded before it is registered).
const { headerProps } = await import("@/components/header/header-data");
const { menuItems } = await import("@/components/header/menu");
const { HeaderSpecimens, headerStates } = await import("./header-specimens");
const { MotionMoments, moments } = await import("./motion-moments");
const { OpszComparison, opszSizes, opszDefault } = await import("./opsz-comparison");
const { ForcedColourNotes, forcedColourNotes } = await import("./forced-colours");

const h = createElement;
const site = join(import.meta.dirname, "..", "..", "..");

/** Focusable things: a specimen is a picture, so it may hold none (axe: aria-hidden-focus). */
const focusable = /<(a|button|input|select|textarea)[\s>]|tabindex=|contenteditable/i;

describe("the header specimens (§3.14: transparent, opaque, the menu open)", () => {
  const markup = html(h(HeaderSpecimens));
  const specimens = elements(markup, "div", 'data-header-specimen="');

  test("three specimens, in order, each a picture with a caption: aria-hidden, nothing focusable, no landmark", () => {
    assert.deepEqual(headerStates, ["transparent", "opaque", "menu"]);
    assert.deepEqual(
      specimens.map((s) => /data-header-specimen="([^"]+)"/.exec(s.attrs)?.[1]),
      headerStates,
    );
    for (const specimen of specimens) {
      assert.match(specimen.attrs, /aria-hidden="true"/);
      assert.match(specimen.attrs, /class="site-header dz-header/, "the specimen wears the real header's class");
      assert.doesNotMatch(specimen.inner, focusable);
      assert.doesNotMatch(specimen.inner, /<(nav|header|footer|main)[\s>]/, "a landmark inside a picture would repeat the page's");
    }
    assert.equal(elements(markup, "figcaption").length, 3);
  });

  test("the bar names the five hubs in the header's order; the open menu lists the menu's rows in its order", () => {
    const props = headerProps();
    const bar = specimens[1];
    for (const link of headerLinks()) assert.ok(textOf(bar.inner).includes(link.label), `bar: ${link.label}`);
    const rows = elements(specimens[2].inner, "span", 'class="site-menu-link').map((row) => textOf(row.inner).trim());
    const expected = menuItems(props).filter((item) => item.kind !== "cta").map((item) => item.label);
    assert.deepEqual(rows, expected);
    // The call to action is the menu's last row, a primary button (exempt from the accent budget, as ButtonLink is).
    const cta = element(specimens[2].inner, "span", "btn-primary");
    assert.ok(cta, "the menu ends with the call to action");
    assert.match(cta.attrs, /data-accent-exempt=""/);
    assert.equal(textOf(cta.inner).trim(), props.cta.label);
  });

  test("the transparent and opaque states differ only by the state the page's scroll would give them", () => {
    const [transparent, opaque] = specimens;
    assert.equal(transparent.inner, opaque.inner);
    assert.match(transparent.attrs, /data-header-specimen="transparent"/);
    assert.match(opaque.attrs, /data-header-specimen="opaque"/);
  });
});

describe("the motion moments (§3.14: each with its own Replay; the pipeline at any progress)", () => {
  const markup = html(h(MotionMoments, { crop: h("span", { className: "crop-stand-in" }) }));

  test("the five moments, in the storyboard order of §4.3, each rendered once with the page's own component", () => {
    assert.deepEqual(
      moments.map((m) => m.name),
      ["hero-run", "pipeline", "evidence-trio", "card-trace", "trail-404"],
    );
    for (const { name } of moments) {
      assert.equal(elements(markup, "[a-z]+", `data-motion="${name}"`).length, 1, name);
    }
  });

  test("each root carries its DOM contract's parts (the real figures, not copies)", () => {
    for (const { name } of moments) {
      const root = element(markup, "[a-z]+", `data-motion="${name}"`)!;
      for (const [part, count] of Object.entries(domContract[name].parts)) {
        const found = elements(root.outer, "[a-z]+", `data-part="${part}"`).length;
        assert.equal(found, count, `${name} ${part}`);
      }
    }
  });

  test("a Replay for every moment: the hero's own slot, and a reserved button for each of the others", () => {
    for (const { name } of moments) {
      const buttons = elements(markup, "button", `data-dz-replay="${name}"`);
      if (name === "hero-run") {
        assert.equal(buttons.length, 0, "the hero run keeps its own Replay (data-part=replay-slot)");
        assert.equal(elements(markup, "button", 'data-part="replay-slot"').length, 1);
        continue;
      }
      assert.equal(buttons.length, 1, name);
      const [button] = buttons;
      assert.match(button.attrs, /type="button"/);
      // Reserved in the server's HTML and shown only when motion is allowed: showing it moves nothing.
      assert.match(button.attrs, /class="[^"]*\binvisible\b/);
      assert.match(textOf(button.inner), /^Replay\b/);
    }
  });

  test("the pipeline's range: 0-100, at 100 (the server's finished frame), labelled", () => {
    // <input> is a void element (no closing tag for element() to find): its opening tag is all there is.
    const inputs = markup.match(/<input\b[^>]*data-dz-range="pipeline"[^>]*>/g) ?? [];
    assert.equal(inputs.length, 1, "one range input");
    const [input] = inputs;
    assert.match(input, /type="range"/);
    assert.match(input, /min="0"/);
    assert.match(input, /max="100"/);
    assert.match(input, /value="100"/);
    const id = /id="([^"]+)"/.exec(input)?.[1];
    assert.ok(id && element(markup, "label", `for="${id}"`), "a <label for> names it");
  });

  test("each moment's timing is read from its storyboard and tokens.css, never typed", () => {
    for (const moment of moments) {
      const heading = element(markup, "h3", `id="${moment.id}"`);
      assert.ok(heading, `${moment.name}: a heading with id ${moment.id}`);
    }
    const hero = moments.find((m) => m.name === "hero-run")!;
    assert.ok(hero.seconds !== undefined && hero.seconds > 2.5 && hero.seconds < 2.8, `hero run ends at ${hero.seconds} s`);
    assert.ok(textOf(markup).includes(`${hero.seconds} s`));
    const trail = moments.find((m) => m.name === "trail-404")!;
    assert.ok(trail.seconds !== undefined && trail.seconds <= 2.0, `404 trail ends at ${trail.seconds} s`);
    assert.equal(moments.find((m) => m.name === "pipeline")!.seconds, undefined, "the pipeline is scrubbed, it has no length of its own");
  });

  test("the note shown under reduced motion names why no Replay shows", () => {
    assert.match(markup, /class="dz-reduced-note[^"]*"/);
  });
});

describe("the pipeline at any progress (pipeline-plan.ts: its own storyboard as Web Animations)", () => {
  const tokens = cssTokens();
  // The token values as tokens.css writes them: seconds, and each ease's own cubic-bezier().
  const planTokens: PlanTokens = {
    durations: { micro: tokens.micro, short: tokens.short, medium: tokens.medium, long: tokens.long, scan: tokens.scan, draw: tokens.draw, trace: tokens.trace },
    eases: { enter: tokenFallbacks["--ease-enter"], exit: tokenFallbacks["--ease-exit"], move: tokenFallbacks["--ease-move"], stamp: tokenFallbacks["--ease-stamp"] },
  };
  // Unequal lengths, as a phone's rows are: the line keeps one speed, so each connector's share is its length's.
  const lengths = [100, 300, 200, 400];
  const plan = pipelinePlan(lengths, "x", planTokens);
  const connectors = plan.animations.filter((a) => a.part === "connector").sort((a, b) => a.index - b.index);
  const rings = plan.animations.filter((a) => a.part === "node-ring").sort((a, b) => a.index - b.index);

  test("one animation per connector and per ring 2-5; ring 1 is never touched (lit from the start)", () => {
    assert.equal(plan.animations.length, 8);
    // Every step of the storyboard is played: none is dropped on the way to Web Animations.
    assert.equal(plan.animations.length, pipelineStoryboard(lengths, "x").steps.length);
    assert.deepEqual(connectors.map((a) => a.index), [0, 1, 2, 3]);
    assert.deepEqual(rings.map((a) => a.index), [1, 2, 3, 4]);
  });

  test("from nothing drawn to the server's frame: connectors scale 0 to 1 on the axis, rings 2-5 light (opacity 0 to 1, scale 0.6 to 1)", () => {
    for (const c of connectors) assert.deepEqual(c.keyframes, [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }]);
    for (const r of rings) assert.deepEqual(r.keyframes, [{ opacity: 0, transform: "scale(0.6)" }, { opacity: 1, transform: "scale(1)" }]);
    const phone = pipelinePlan(lengths, "y", planTokens).animations.filter((a) => a.part === "connector");
    for (const c of phone) assert.deepEqual(c.keyframes, [{ transform: "scaleY(0)" }, { transform: "scaleY(1)" }]);
  });

  test("constant speed: the connectors share one second in proportion to their lengths, one after another, linear", () => {
    const total = lengths.reduce((a, b) => a + b, 0);
    let at = 0;
    connectors.forEach((c, i) => {
      assert.ok(Math.abs(c.delay - at) < 1e-9, `connector ${i} starts at ${c.delay}`);
      assert.ok(Math.abs(c.duration - lengths[i] / total) < 1e-9, `connector ${i} lasts ${c.duration}`);
      assert.equal(c.easing, "linear");
      at += c.duration;
    });
  });

  test("ring i + 1 lights as connector i completes, for micro, on the move ease; the timeline ends as ring 5 does", () => {
    rings.forEach((r, i) => {
      const c = connectors[i];
      assert.ok(Math.abs(r.delay - (c.delay + c.duration)) < 1e-9, `ring ${r.index + 1} at ${r.delay}`);
      assert.equal(r.duration, tokens.micro);
      assert.equal(r.easing, tokenFallbacks["--ease-move"]);
    });
    assert.ok(Math.abs(plan.duration - (1 + tokens.micro)) < 1e-9, `the plan lasts ${plan.duration} s`);
  });

  test("a step it can't play as Web Animations is an error, never dropped (the scrub would stop matching the site)", () => {
    assert.throws(() => keyframeOf({ x: 8 }), /can't play x as Web Animations/);
    assert.throws(() => keyframeOf({ opacity: 1, rotation: 6 }), /rotation/);
    assert.deepEqual(keyframeOf({ opacity: 0, scale: 0.6 }), { opacity: 0, transform: "scale(0.6)" });
    const base = { part: "connector", index: 0, at: 0, duration: 1, ease: "none", to: { scaleX: 1 } } as const;
    assert.doesNotThrow(() => planStep(base, planTokens));
    for (const extra of [{ times: [0, 1] }, { stagger: 0.1 }, { repeat: 1 }, { yoyo: true }, { lazyFrom: true }, { clear: true }, { svgOrigin: [0, 0] as const }]) {
      const key = Object.keys(extra)[0];
      assert.throws(() => planStep({ ...base, ...extra }, planTokens), new RegExp(key), key);
    }
  });

  test("reads the tokens as the browser hands them over (minified times, eases as written)", () => {
    const values: Record<string, string> = {
      "--transition-duration-micro": ".12s",
      "--transition-duration-short": "180ms",
      "--transition-duration-medium": ".28s",
      "--transition-duration-long": ".45s",
      "--motion-scan": ".6s",
      "--motion-draw": ".9s",
      "--motion-trace": ".8s",
      "--ease-enter": "cubic-bezier(.22, 1, .36, 1)",
      "--ease-exit": "cubic-bezier(.3, 0, .8, .15)",
      "--ease-move": "cubic-bezier(.2, 0, 0, 1)",
      "--ease-stamp": "cubic-bezier(.34, 1.56, .64, 1)",
    };
    const read = readPlanTokens({ getPropertyValue: (name: string) => values[name] ?? "" });
    assert.equal(read.durations.micro, 0.12);
    assert.equal(read.durations.short, 0.18);
    assert.equal(read.durations.draw, 0.9);
    assert.equal(read.eases.move, "cubic-bezier(.2, 0, 0, 1)");
    assert.throws(() => readPlanTokens({ getPropertyValue: () => "" }), /is not set/);
    assert.equal(parseSeconds("0s"), 0);
    assert.equal(parseSeconds("3s"), 3);
    assert.equal(parseSeconds("fast"), undefined);
  });
});

describe("the D18 comparison (§2.2: Bricolage's display steps with and without the opsz axis at 40, 60 and 80 px)", () => {
  const markup = html(h(OpszComparison));

  test("three sizes, each with the axis (auto: opsz follows the size) and without it (the file's default opsz)", () => {
    assert.deepEqual(opszSizes, [40, 60, 80]);
    for (const size of opszSizes) {
      const withAxis = elements(markup, "span", `data-opsz="auto"(?=[^>]*data-size="${size}")`);
      const without = elements(markup, "span", `data-opsz="default"(?=[^>]*data-size="${size}")`);
      assert.equal(withAxis.length, 1, `${size} px with`);
      assert.equal(without.length, 1, `${size} px without`);
      assert.equal(textOf(withAxis[0].inner), textOf(without[0].inner), "the same words");
    }
  });

  test("'without' is the default Next.js's own font data gives Bricolage's opsz axis (what a file without the axis renders)", () => {
    const data = JSON.parse(readFileSync(join(site, "node_modules/next/dist/compiled/@next/font/dist/google/font-data.json"), "utf8"));
    const axis = data["Bricolage Grotesque"].axes.find((a: { tag: string }) => a.tag === "opsz");
    assert.equal(opszDefault(), axis.defaultValue);
    assert.ok(textOf(markup).includes(`opsz ${axis.defaultValue}`));
  });

  test("no inline style (§2.9 rule 6): design.css sets each size, and pins the default opsz Next.js's font data gives", () => {
    assert.doesNotMatch(markup, /\sstyle="/);
    const css = readFileSync(join(import.meta.dirname, "design.css"), "utf8");
    const pinned = /\.dz-opsz-sample\[data-opsz="default"\]\s*\{[^}]*font-variation-settings:\s*"opsz"\s+(\d+(?:\.\d+)?)/.exec(css);
    assert.ok(pinned, "design.css pins the opsz of the 'without' samples");
    assert.equal(Number(pinned[1]), opszDefault());
    for (const size of opszSizes) {
      const rule = new RegExp(`\\.dz-opsz-sample\\[data-size="${size}"\\]\\s*\\{[^}]*font-size:\\s*${size / 16}rem`);
      assert.match(css, rule, `${size} px`);
    }
  });

  test("the layout loads Bricolage with the opsz axis, so the comparison is real", () => {
    assert.match(readFileSync(join(site, "src/app/layout.tsx"), "utf8"), /Bricolage_Grotesque\(\{[^}]*axes:\s*\["opsz"\]/);
  });
});

/** The bodies of every `@media (forced-colors: active)` block in a stylesheet: from its `{` to the matching `}`. */
function forcedColourBlocks(css: string): string[] {
  const at = "@media (forced-colors: active)";
  const blocks: string[] = [];
  for (let start = css.indexOf(at); start !== -1; start = css.indexOf(at, start + at.length)) {
    const open = css.indexOf("{", start);
    let depth = 0;
    let end = open;
    for (; end < css.length; end++) {
      if (css[end] === "{") depth++;
      else if (css[end] === "}" && --depth === 0) break;
    }
    assert.equal(depth, 0, `the block at ${start} closes`);
    blocks.push(css.slice(open + 1, end));
  }
  return blocks;
}

describe("the forced-colours notes (§2.8)", () => {
  test("the block reader takes a block's body only, not the rules after it", () => {
    const css = "a{b:c}@media (forced-colors: active){@layer x{.in{color:red}}.also{}}.out{color:blue}";
    assert.deepEqual(forcedColourBlocks(css), ["@layer x{.in{color:red}}.also{}"]);
  });

  test("each note quotes a rule the site's CSS has inside @media (forced-colors: active)", () => {
    assert.ok(forcedColourNotes.length >= 5);
    for (const note of forcedColourNotes) {
      const blocks = forcedColourBlocks(readFileSync(join(site, note.file), "utf8"));
      assert.ok(blocks.length > 0, `${note.file} has a forced-colours block`);
      assert.ok(
        blocks.some((block) => block.includes(note.selector)),
        `${note.file}: ${note.selector} inside @media (forced-colors: active)`,
      );
    }
  });

  test("each note is a sentence of at most 20 words (docs/brand.md)", () => {
    for (const { note } of forcedColourNotes) {
      const words = note.split(/\s+/).filter(Boolean).length;
      assert.ok(words <= 20, `${words} words: ${note}`);
    }
  });

  test("rendered with the file each rule lives in", () => {
    const markup = html(h(ForcedColourNotes));
    for (const note of forcedColourNotes) {
      assert.ok(markup.includes(note.file), note.file);
    }
  });
});
