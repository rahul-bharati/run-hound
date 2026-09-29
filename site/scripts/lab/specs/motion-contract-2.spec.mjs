/**
 * The motion contract (DESIGN.md §4.6), against the built standalone site: what motion may and may not do, measured
 * in Chromium at 1440×900 and 390×844 (DPR 3, touch), with the throttled profile where it says so. Item 12 of §4.6
 * (storyboards, the runtime's state machine, the gate) is `pnpm test` (src/motion/*.test.ts).
 *
 * Split from one file into two so CI's critical path stops being a single ~23.6-minute spec
 * (docs/decisions/09-2026.md#2026-09-29-ci-parallel-jobs): this half runs the phone half of item 4-6 through item
 * 11, the lazy motion bytes gate and the figure-presence check (~12.5 min measured); motion-contract-1.spec.mjs
 * runs items 1-3 and the desktop half of 4-6 (~11.0 min). Shared setup (the pages, budgets, DOM contract and the
 * page-side probes) lives in ../lib/motion-contract-shared.mjs.
 *
 *   NEXT_DIST_DIR=.next-lab pnpm build && NEXT_DIST_DIR=.next-lab pnpm lab motion-contract-2
 *
 * Which moving figures a page must have is switched on by the file of the node that renders it, the way check-copy and
 * check-budgets switch on theirs: the homepage's hero run, evidence trio and check cards once src/content/hero-run.ts
 * exists (P1), the 404's trail once src/components/not-found/ does (F3), the figure reveals on /how-it-works/ once
 * src/content/how-it-works.ts does and on /demo/ once src/content/demo.ts does (F2). The motion budgets count only the
 * build's motion chunks (the gate's dynamic imports and theirs), read from the build.
 * Before that, a page is checked for what it has (a page with no motion passes the checks that apply to it, and the
 * checks that need a hero say why they skip). The motion code marks each root it takes over: data-ready, and
 * data-motion-state "armed", "playing", "done" (src/motion/dom-contract.ts).
 *
 * Mid-animation reads use the page's own clock (performance.now(), sampled per frame): Playwright's
 * `animations: "disabled"` and clock.fastForward() would leave GSAP's tweens unfinished.
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { launch, median, newPage, sleep, slowScroll } from "../lib/browser.mjs";
import { installRafCounter, rafDuring, restState } from "../lib/motion.mjs";
import { installFrameSampler, readFrameSampler } from "../lib/timeline.mjs";
import { installVitals, readVitals } from "../lib/vitals.mjs";
import {
  base,
  domContract,
  expects,
  heroDone,
  installStateLog,
  isMotionChunk,
  motionBudget,
  motionChunks,
  motionPages,
  nothingPlaying,
  notFound,
  readStateLog,
  replayVisible,
  restHiddenParts,
  roots,
} from "../lib/motion-contract-shared.mjs";
import { writeJson } from "../lib/out.mjs";
import { recordRequests } from "../lib/requests.mjs";

const result = { build: process.env.NEXT_DIST_DIR ?? ".next", expects, motionChunks, pages: {} };
const record = (path, key, value) => ((result.pages[path] ??= {})[key] = value);
let browser;

before(async () => {
  browser = await launch();
});
after(async () => {
  await browser?.close();
  writeJson("motion-contract-2.json", result);
});

// ---- 4, 5, 6. Rest --------------------------------------------------------------------------------------------------

describe("4-6. nothing runs at rest", () => {
  // Phone half of item 4-6 (§5.2): motion-contract-1.spec.mjs runs the same test at desktop; on a phone, the 404's
  // trail may wait "armed" for half visibility. Split from one "4-6. nothing runs at rest" describe so each half of
  // the ~19-minute stop-point walk lands in its own file (docs/decisions/09-2026.md#2026-09-29-ci-parallel-jobs).
  const cases = motionPages.map((path) => ({ path, profile: "phone" }));
  for (const { path, profile } of cases) {
    test(`${path} at ${profile}: 0 requestAnimationFrame callbacks in 3 s at each of 21 stop points after 2 s at rest; no infinite animations; nothing faded after End`, async () => {
      const { context, page } = await newPage(browser, { profile });
      await installRafCounter(page);
      await page.goto(base + path, { waitUntil: "load" });
      await heroDone(page);
      const counts = [];
      let y = 0;
      const height = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
      // Every 5% of the page; a page that doesn't scroll (the 404 on a desktop) has one stop point.
      const points = height > 0 ? 21 : 1;
      for (let i = 0; i < points; i += 1) {
        const target = points > 1 ? Math.round((height * i) / (points - 1)) : 0;
        while (y < target) {
          y = Math.min(target, y + 120);
          await page.evaluate((to) => window.scrollTo(0, to), y);
          await sleep(50);
        }
        // A moving figure the scroll just reached plays out first (§4.6 #4: "once the hero has finished").
        await nothingPlaying(page);
        await sleep(2000);
        counts.push({ at: points > 1 ? Math.round((i / (points - 1)) * 100) : 0, y, raf: await rafDuring(page, 3000) });
      }
      await page.keyboard.press("End");
      await sleep(2500);
      // GSAP is a module, not a global (window.gsap is undefined in the build), so an active tween can't be listed from
      // the page; it would show as requestAnimationFrame callbacks, which the stop points count (0 at each).
      const state = await restState(page);
      const stray = await page.evaluate(
        (hidden) =>
          [...document.querySelectorAll("main *")]
            .filter((el) => Number(getComputedStyle(el).opacity) < 0.05 && el.getClientRects().length)
            .filter((el) => !el.classList.contains("rest-hidden") && !hidden.includes(el.getAttribute("data-part")))
            .map((el) => `${el.tagName.toLowerCase()}.${(el.getAttribute("class") ?? "").split(" ")[0]}[${el.getAttribute("data-part") ?? ""}]`),
        restHiddenParts,
      );
      record(path, `rest-${profile}`, { counts, infiniteAnimations: state.infiniteAnimations, stray });
      assert.deepEqual(counts.filter((c) => c.raf > 0), [], "rAF callbacks at rest");
      assert.equal(state.infiniteAnimations, 0, "no infinite CSS animation");
      assert.deepEqual(stray, [], `only the rest classes (${restHiddenParts.join(", ")}) at opacity 0`);
      await context.close();
    });
  }
});

// ---- 7, 8. CLS and duration -----------------------------------------------------------------------------------------

describe("7-8. no layout shift, and every moment done within 5 s", () => {
  for (const path of motionPages) {
    test(`${path}: CLS through load, the hero, Replay and a full scroll down and back; each moment done within 5 s of starting`, async () => {
      const { context, page } = await newPage(browser);
      await installVitals(page);
      await installStateLog(page);
      await page.goto(base + path, { waitUntil: "load" });
      await heroDone(page);
      if (await replayVisible(page)) {
        await page.click('[data-part="replay-slot"]');
        await sleep(200);
        await heroDone(page);
      }
      await slowScroll(page, { step: 150, pause: 80 });
      await nothingPlaying(page);
      await slowScroll(page, { step: 400, pause: 40, back: true });
      await sleep(500);
      const vitals = await readVitals(page);
      const log = await readStateLog(page);
      const runs = [];
      const open = new Map();
      for (const entry of log.filter((e) => e.attribute === "data-motion-state")) {
        if (entry.value === "playing") open.set(entry.name, entry.t);
        if (entry.value === "done" && open.has(entry.name)) {
          runs.push({ name: entry.name, ms: entry.t - open.get(entry.name) });
          open.delete(entry.name);
        }
      }
      record(path, "clsAndRuns", { cls: vitals.cls, shifts: vitals.shifts, runs });
      assert.ok(vitals.cls <= (path === "/" ? 0.0001 : 0.01), `CLS ${vitals.cls}`);
      for (const run of runs) assert.ok(run.ms <= 5000, `${run.name} took ${run.ms} ms`);
      assert.deepEqual([...open.keys()], [], "every moment that started finished");
      await context.close();
    });
  }
});

// ---- 9. Time to bug, throttled --------------------------------------------------------------------------------------

describe("9. the bug on screen in time, throttled (desktop, median of 3)", () => {
  test("/: the finding card at opacity ≥ 0.9 by 5.0 s from navigation; no held part flickers", async (t) => {
    if (!expects.heroRun) return t.skip("the homepage's hero run arrives with P1 (src/content/hero-run.ts)");
    const heldParts = domContract["hero-run"].held;
    const selectors = heldParts.map((part) => `[data-motion="hero-run"] [data-part="${part}"]`);
    const runs = [];
    for (let run = 0; run < 3; run += 1) {
      const { context, page } = await newPage(browser, { throttle: true });
      await installFrameSampler(page, selectors, { ms: 9000 });
      await page.goto(base + "/", { waitUntil: "load", timeout: 60_000 });
      await sleep(Math.max(0, 9500 - (await page.evaluate(() => performance.now()))));
      const frames = await readFrameSampler(page, { raw: true });
      const firstAt = (selector, level) => frames[selector]?.samples?.find(([, opacity]) => opacity !== null && opacity >= level)?.[0] ?? null;
      const finding = firstAt(selectors[heldParts.indexOf("finding")], 0.9);
      const flicker = Object.entries(frames)
        .filter(([, f]) => f.flash)
        .map(([selector]) => selector);
      runs.push({ finding, flicker });
      await context.close();
    }
    record("/", "timeToBug", runs);
    assert.ok(runs.every((r) => r.finding !== null), "the finding appeared in every run");
    assert.ok(median(runs.map((r) => r.finding)) <= 5000, `finding at ${median(runs.map((r) => r.finding))} ms`);
    assert.deepEqual(runs.flatMap((r) => r.flicker), [], "no held part goes from visible to hidden");
  });
});

// ---- 10. The pipeline never un-draws while scrolling down ------------------------------------------------------------

describe("10. the pipeline's lit nodes never go out while scrolling down, across a park and a resume", () => {
  for (const profile of ["desktop", "phone"]) {
    test(`${profile}`, async (t) => {
      const { context, page } = await newPage(browser, { profile });
      await installRafCounter(page);
      await page.goto(base + "/", { waitUntil: "load" });
      await heroDone(page);
      const top = await page.evaluate(() => {
        const pipeline = document.querySelector('[data-motion="pipeline"]');
        return pipeline ? pipeline.getBoundingClientRect().top + scrollY : null;
      });
      if (top === null) {
        await context.close();
        if (expects.heroRun) assert.fail("the homepage has no [data-motion=pipeline]");
        return t.skip("no pipeline on the homepage yet (P1)");
      }
      const vh = await page.evaluate(() => innerHeight);
      // The rings a reader can see lit: only while the pipeline is in the viewport (its start state is set while it
      // is still below it, unseen).
      const lit = () =>
        page.evaluate(() => {
          const pipeline = document.querySelector('[data-motion="pipeline"]');
          if (pipeline.getBoundingClientRect().top >= innerHeight) return null;
          return [...pipeline.querySelectorAll('[data-part="node-ring"]')].filter((ring) => Number(getComputedStyle(ring).opacity) >= 0.5).length;
        });
      const samples = [];
      let parkedRaf = null;
      const start = Math.max(0, top - 2 * vh);
      const end = top + vh;
      let paused = false;
      for (let y = start; y <= end; y += 40) {
        await page.evaluate((to) => window.scrollTo(0, to), y);
        await sleep(60);
        samples.push({ y, lit: await lit() });
        // Halfway through the scrub range, rest: ScrollTrigger parks after 1.5 s, then resumes on the next scroll.
        if (!paused && y >= top - 0.55 * vh) {
          paused = true;
          await sleep(1800);
          parkedRaf = await rafDuring(page, 800);
          samples.push({ y, lit: await lit(), afterPark: true });
        }
      }
      await sleep(1500);
      samples.push({ y: end, lit: await lit(), final: true });
      record("/", `pipeline-${profile}`, { samples, parkedRaf });
      const seen = samples.filter((sample) => sample.lit !== null);
      assert.ok(seen.length > 0, "the pipeline was never in view");
      for (let i = 1; i < seen.length; i += 1) assert.ok(seen[i].lit >= seen[i - 1].lit, `lit nodes fell from ${seen[i - 1].lit} to ${seen[i].lit} at ${seen[i].y}px`);
      assert.equal(seen.at(-1).lit, domContract.pipeline.parts["node-ring"], "every node lit at the end");
      assert.equal(parkedRaf, 0, "no requestAnimationFrame while parked");
      await context.close();
    });
  }
});

describe("10. a breakpoint change mid-pipeline finishes it: every node lit, nothing goes out (after a park, or without one)", () => {
  for (const park of [true, false]) {
    test(`1440 → 900 px ${park ? "while ScrollTrigger is parked" : "while it scrubs"}`, async (t) => {
      const { context, page } = await newPage(browser, { viewport: { width: 1440, height: 900 } });
      await page.goto(base + "/", { waitUntil: "load" });
      await heroDone(page);
      const top = await page.evaluate(() => {
        const pipeline = document.querySelector('[data-motion="pipeline"]');
        return pipeline ? pipeline.getBoundingClientRect().top + scrollY : null;
      });
      if (top === null) {
        await context.close();
        if (expects.heroRun) assert.fail("the homepage has no [data-motion=pipeline]");
        return t.skip("no pipeline on the homepage yet (P1)");
      }
      const read = () =>
        page.evaluate(() => {
          const pipeline = document.querySelector('[data-motion="pipeline"]');
          const lit = [...pipeline.querySelectorAll('[data-part="node-ring"]')].filter((ring) => Number(getComputedStyle(ring).opacity) >= 0.5).length;
          return { state: pipeline.getAttribute("data-motion-state"), lit, top: Math.round(pipeline.getBoundingClientRect().top) };
        });
      // Into the middle of the scrub range at 1440 (the steps row's top from 78% to 38% of 900 px).
      for (let y = Math.max(0, top - 1800); y <= top - 0.55 * 900; y += 40) {
        await page.evaluate((to) => window.scrollTo(0, to), y);
        await sleep(60);
      }
      await sleep(1200);
      const before = await read();
      if (park) await sleep(1800); // parked 1.5 s after the last scroll
      await page.setViewportSize({ width: 900, height: 900 });
      await sleep(800);
      const resized = await read();
      // On through the rest of the range on the new axis (to the pipeline's bottom at 62%).
      const bottom = await page.evaluate(() => document.querySelector('[data-motion="pipeline"]').getBoundingClientRect().bottom + scrollY);
      for (let y = await page.evaluate(() => scrollY); y <= bottom - 0.62 * 900 + 200; y += 40) {
        await page.evaluate((to) => window.scrollTo(0, to), y);
        await sleep(60);
      }
      await sleep(1500);
      const end = await read();
      record("/", `pipeline-breakpoint-${park ? "parked" : "scrubbing"}`, { before, resized, end });
      assert.ok(resized.lit >= before.lit, `lit nodes fell from ${before.lit} to ${resized.lit} on the resize`);
      assert.equal(end.state, "done");
      assert.equal(end.lit, domContract.pipeline.parts["node-ring"], "every node lit");
      await context.close();
    });
  }
});

// ---- 11. Requests ---------------------------------------------------------------------------------------------------

describe("11. a visit that never scrolls downloads no ScrollTrigger and no DrawSVG", () => {
  for (const profile of ["desktop", "phone"]) {
    test(`/ at ${profile}`, async () => {
      const { context, page } = await newPage(browser, { profile });
      const log = recordRequests(page);
      await page.goto(base + "/", { waitUntil: "load" });
      await sleep(9000); // load + idle (2 s at most) + the hero run, with room to spare
      const scripts = log.requests.filter((r) => r.type === "script");
      record("/", `requests-${profile}`, scripts.map(({ path, phase, gzip, gsap, scrollTrigger, drawSVG }) => ({ path, phase, gzip, gsap, scrollTrigger, drawSVG })));
      assert.deepEqual(scripts.filter((r) => r.scrollTrigger).map((r) => r.path), [], "ScrollTrigger downloaded");
      assert.deepEqual(scripts.filter((r) => r.drawSVG).map((r) => r.path), [], "DrawSVG downloaded");
      assert.deepEqual(scripts.filter((r) => r.phase === "load" && (r.gsap || r.scrollTrigger || r.drawSVG)).map((r) => r.path), [], "GSAP before the load event");
      // The gate is one chunk of 1 KB or less (§4.4), requested once when the page hydrates and before any GSAP chunk,
      // so it decides before any motion code loads. Turbopack emits it as its own chunk that the loader imports at
      // hydration, just after the load event, not as initial JS (decision 2026-09-28-motion-gate-at-hydration).
      assert.equal(motionChunks.gate.length, 1, `the gate's chunk in the build: ${JSON.stringify(motionChunks.gate)}`);
      const gate = scripts.filter((r) => r.path.split("?")[0].endsWith(`/static/chunks/${motionChunks.gate[0].file}`));
      assert.equal(gate.length, 1, "the gate's chunk is requested once");
      const firstMotion = scripts.findIndex((r) => r.gsap || r.scrollTrigger || r.drawSVG);
      assert.ok(firstMotion === -1 || scripts.indexOf(gate[0]) < firstMotion, "the gate's chunk comes before any GSAP chunk");
      assert.ok(gate[0].gzip <= motionBudget.gateChunk, `the gate's chunk is ${gate[0].gzip} B (≤ ${motionBudget.gateChunk})`);
      await context.close();
    });
  }
});

// ---- Lazy motion bytes -------------------------------------------------------------------------------------------

describe("lazy motion bytes (§4.4, §5.2's lazy-JS gate), the build's motion chunks only", () => {
  const pages = [
    { path: "/", limits: { "after-load": motionBudget.homeAfterLoad, approach: motionBudget.homeApproach } },
    ...motionPages.filter((path) => path !== "/").map((path) => ({ path, limits: { visit: motionBudget.innerPage } })),
  ];
  for (const { path, limits } of pages) {
    test(`${path}: ${Object.entries(limits).map(([phase, limit]) => `≤ ${limit} B ${phase}`).join(", ")}`, async () => {
      const { context, page } = await newPage(browser);
      const log = recordRequests(page);
      await page.goto(base + path, { waitUntil: "load" });
      await heroDone(page);
      await sleep(3000); // load + idle (2 s at most) has passed, and the held figure has played
      log.phase("approach");
      await slowScroll(page, { step: 150, pause: 80 });
      await nothingPlaying(page);
      await sleep(500);
      const scripts = log.requests.filter((r) => r.type === "script" && r.phase !== "load");
      const motion = (phase) => scripts.filter((r) => (phase === "visit" || r.phase === phase) && isMotionChunk(r.path));
      const sum = (list) => list.reduce((total, r) => total + r.gzip, 0);
      const bytes = Object.fromEntries(Object.keys(limits).map((phase) => [phase, sum(motion(phase))]));
      // Every script after load is logged (route prefetches and the page's own lazy chunks too); only motion counts.
      const listed = scripts.map(({ path: p, phase, gzip, gsap, scrollTrigger, drawSVG }) => ({ path: p, phase, gzip, motion: isMotionChunk(p), gsap, scrollTrigger, drawSVG }));
      record(path, "lazyMotionBytes", { bytes, limits, scripts: listed });
      console.log(`lazy motion bytes on ${path}: ${JSON.stringify(bytes)} (limits ${JSON.stringify(limits)}); all scripts after load: ${sum(scripts)} B`);
      for (const [phase, limit] of Object.entries(limits)) assert.ok(bytes[phase] <= limit, `${phase}: ${bytes[phase]} B of motion code (≤ ${limit})`);
      await context.close();
    });
  }
});

// ---- The figures the owners render --------------------------------------------------------------------------------

describe("the moving figures are there once their owners have rendered them", () => {
  // `scroll`: the figure is below the fold, so the page is scrolled through and the figure must end "done".
  const cases = [
    { path: "/", name: "hero-run", on: expects.heroRun, owner: "P1 (src/content/hero-run.ts)" },
    { path: "/", name: "evidence-trio", on: expects.heroRun, owner: "P1 (src/content/hero-run.ts)", scroll: true },
    { path: "/", name: "card-trace", on: expects.heroRun, owner: "P1 (src/content/hero-run.ts)", scroll: true },
    { path: notFound, name: "trail-404", on: expects.trail404, owner: "F3 (src/components/not-found/)" },
    { path: "/how-it-works/", name: "reveal", on: expects.reveals, owner: "F2 (src/content/how-it-works.ts)" },
    { path: "/demo/", name: "reveal", on: expects.demoReveals, owner: "F2 (src/content/demo.ts)" },
  ];
  for (const { path, name, on, owner, scroll } of cases) {
    test(`${path} has [data-motion="${name}"], ${scroll ? 'played to "done" through a scroll' : 'played to "done" or armed for the scroll'}`, async (t) => {
      if (!on) return t.skip(`arrives with ${owner}`);
      const { context, page } = await newPage(browser);
      await page.goto(base + path, { waitUntil: "load" });
      await heroDone(page);
      await sleep(3000);
      if (scroll) {
        await slowScroll(page, { step: 150, pause: 80 });
        await nothingPlaying(page);
        await sleep(500);
      }
      const found = (await roots(page)).filter((root) => root.name === name);
      record(path, `figure-${name}`, found);
      assert.ok(found.length > 0, `no [data-motion="${name}"] on ${path}`);
      if (name !== "reveal") for (const root of found) assert.equal(root.state, "done", `${name} is ${root.state}`);
      await context.close();
    });
  }
});
