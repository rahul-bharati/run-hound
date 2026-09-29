/**
 * The motion contract (DESIGN.md §4.6), against the built standalone site: what motion may and may not do, measured
 * in Chromium at 1440×900 and 390×844 (DPR 3, touch), with the throttled profile where it says so. Item 12 of §4.6
 * (storyboards, the runtime's state machine, the gate) is `pnpm test` (src/motion/*.test.ts).
 *
 * Split from one file into two so CI's critical path stops being a single ~23.6-minute spec
 * (docs/decisions/09-2026.md#2026-09-29-ci-parallel-jobs): this half runs items 1-3 and the desktop half of item
 * 4-6 (~11.0 min measured); motion-contract-2.spec.mjs runs the phone half of 4-6 through item 11, the lazy motion
 * bytes gate and the figure-presence check (~12.5 min). Shared setup (the pages, budgets, DOM contract and the
 * page-side probes) lives in ../lib/motion-contract-shared.mjs.
 *
 *   NEXT_DIST_DIR=.next-lab pnpm build && NEXT_DIST_DIR=.next-lab pnpm lab motion-contract-1
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
import { cspViolations, launch, newPage, sleep, slowScroll } from "../lib/browser.mjs";
import { installRafCounter, installTextAudit, rafDuring, readTextAudit, restState } from "../lib/motion.mjs";
import { readTiming } from "../lib/vitals.mjs";
import {
  base,
  expects,
  heroDone,
  installH1AtDomContentLoaded,
  installInlineOpacityWatch,
  installStateLog,
  motionChunks,
  motionPages,
  nothingPlaying,
  partsAtRest,
  readStateLog,
  replayVisible,
  restHiddenParts,
  roots,
  settled,
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
  writeJson("motion-contract-1.json", result);
});

// ---- 1. Reduced motion and Save-Data: no motion chunk, finished frames ----------------------------------------------

describe("1. reduced motion and Save-Data get the finished frames and no motion code", () => {
  for (const mode of ["reduce", "save-data"]) {
    for (const path of motionPages) {
      test(`${mode} on ${path}`, async () => {
        const { context, page } = await newPage(browser, { reducedMotion: mode === "reduce" ? "reduce" : "no-preference", saveData: mode === "save-data" });
        await installStateLog(page);
        const log = recordRequests(page);
        await page.goto(base + path, { waitUntil: "load" });
        const timing = await readTiming(page);
        await settled(page);
        const shots = [];
        for (let second = 0; second <= 3; second += 1) {
          if (second) await sleep(1000);
          // GIFs are the page's own media (they play once, T1; Save-Data doesn't stop them), not motion code: masked,
          // as the lab's screenshots do.
          shots.push(await page.screenshot({ scale: "css", mask: [page.locator('img[src*=".gif"], img[srcset*=".gif"]')] }));
        }
        await slowScroll(page, { step: 300, pause: 40, back: true });
        await sleep(500);
        const scripts = log.requests.filter((r) => r.type === "script");
        const motion = scripts.filter((r) => r.gsap || r.scrollTrigger || r.drawSVG);
        const gsapLoaded = await page.evaluate(() => typeof window.gsapVersions !== "undefined");
        const rest = await partsAtRest(page, restHiddenParts);
        const states = await readStateLog(page);
        const found = await roots(page);
        record(path, mode, { roots: found, motionScripts: motion.map((r) => r.path), rest, states, load: timing.load });
        assert.deepEqual(motion.map((r) => r.path), [], "no motion chunk is requested");
        assert.equal(gsapLoaded, false, "window.gsapVersions is undefined");
        assert.deepEqual(rest.faded, [], "every moving part at opacity 1");
        assert.deepEqual(rest.moved, [], "no moving part transformed");
        assert.equal(await replayVisible(page), false, "no Replay");
        assert.ok(found.every((root) => root.state === null), "no root taken over by motion code");
        if (mode === "save-data") {
          // The hold is released at hydration: data-ready on every held root soon after load (well before the 3 s
          // fallback; the lab can't see hydration itself, so load + 200 ms stands for it).
          for (const root of found.filter((r) => r.held)) assert.ok(root.ready, `${root.name}: hold not released`);
          const released = states.filter((s) => s.attribute === "data-ready").map((s) => s.t);
          for (const t of released) assert.ok(t <= timing.load + 200, `hold released at ${t} ms, load at ${timing.load} ms`);
        }
        for (let i = 1; i < shots.length; i += 1) assert.ok(shots[i].equals(shots[0]), `frame at ${i} s differs from the frame at 0 s`);
        await context.close();
      });
    }
  }
});

// ---- 2, 3. Text never moves or waits --------------------------------------------------------------------------------

describe("2-3. text never moves or waits", () => {
  for (const path of motionPages) {
    for (const reducedMotion of ["no-preference", "reduce"]) {
      test(`${path}, ${reducedMotion}: h1 at opacity 1 at DOMContentLoaded; no words faded inline in the first viewport`, async () => {
        const { context, page } = await newPage(browser, { reducedMotion });
        await installH1AtDomContentLoaded(page);
        await installInlineOpacityWatch(page);
        await page.goto(base + path, { waitUntil: "load" });
        if (reducedMotion === "reduce") await sleep(1500);
        else await heroDone(page);
        const h1 = await page.evaluate(() => window.__h1AtDcl);
        const faded = await page.evaluate(() => window.__inlineFaded);
        record(path, `h1-${reducedMotion}`, { h1, faded });
        assert.equal(h1, 1, "the h1 is at opacity 1 at DOMContentLoaded");
        assert.deepEqual(faded, []);
        await context.close();
      });
    }

    test(`${path}: the text audit through the hero, a slow scroll, End, three anchor jumps and a fast walk back`, async () => {
      const { context, page } = await newPage(browser);
      await installTextAudit(page);
      await page.goto(base + path, { waitUntil: "load" });
      await heroDone(page);
      await page.mouse.move(720, 450);
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      for (let y = 0; y < height; y += 120) {
        await page.mouse.wheel(0, 120);
        await sleep(50);
      }
      await nothingPlaying(page);
      await page.keyboard.press("Home");
      await sleep(300);
      await page.keyboard.press("End");
      await sleep(800);
      const anchors = await page.evaluate(() => [...document.querySelectorAll("main [id]")].map((el) => el.id).filter((id) => /^[a-z][\w-]*$/.test(id)).slice(0, 3));
      await page.evaluate(() => window.scrollTo(0, 0));
      await sleep(300);
      for (const id of anchors) {
        await page.evaluate((hash) => (location.hash = hash), id);
        await sleep(700);
      }
      for (let y = await page.evaluate(() => scrollY); y > 0; y -= 900) {
        await page.evaluate((to) => window.scrollTo(0, to), y);
        await sleep(30);
      }
      await nothingPlaying(page);
      await sleep(500);
      const caught = await readTextAudit(page);
      record(path, "textAudit", { anchors, caught });
      assert.deepEqual(caught, [], "no element with words below opacity 1 or moved by motion");
      assert.deepEqual(await cspViolations(page), [], "no CSP violation through the motion");
      await context.close();
    });
  }
});

// ---- 4, 5, 6. Rest --------------------------------------------------------------------------------------------------

describe("4-6. nothing runs at rest", () => {
  // Desktop half of item 4-6 (§5.2): motion-contract-2.spec.mjs runs the same test at phone, where the 404's
  // trail may wait "armed" for half visibility. Split from one "4-6. nothing runs at rest" describe so each half of
  // the ~19-minute stop-point walk lands in its own file (docs/decisions/09-2026.md#2026-09-29-ci-parallel-jobs).
  const cases = motionPages.map((path) => ({ path, profile: "desktop" }));
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
