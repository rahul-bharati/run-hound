/**
 * The motion contract (DESIGN.md §4.6), against the built standalone site: what motion may and may not do, measured
 * in Chromium at 1440×900 and 390×844 (DPR 3, touch), with the throttled profile where it says so. Item 12 of §4.6
 * (storyboards, the runtime's state machine, the gate) is `pnpm test` (src/motion/*.test.ts).
 *
 *   NEXT_DIST_DIR=.next-lab pnpm build && NEXT_DIST_DIR=.next-lab pnpm lab motion-contract
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
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { gzipSync } from "node:zlib";
import { distDir, siteDir } from "../../lib/build-output.mjs";
import { cspViolations, launch, median, newPage, origin, sleep, slowScroll } from "../lib/browser.mjs";
import { installRafCounter, installTextAudit, rafDuring, readTextAudit, restState } from "../lib/motion.mjs";
import { writeJson } from "../lib/out.mjs";
import { recordRequests } from "../lib/requests.mjs";
import { labRoutes } from "../lib/routes.mjs";
import { installFrameSampler, readFrameSampler } from "../lib/timeline.mjs";
import { installVitals, readTiming, readVitals } from "../lib/vitals.mjs";

// The DOM contract, from its one source (the site's .ts modules load through the test hooks, as in `pnpm test`).
await import("../../test-hooks.mjs");
const { domContract, restHiddenParts } = await import("../../../src/motion/dom-contract.ts");

const base = origin();
const { indexable, notFound } = await labRoutes();
const exists = (path) => existsSync(join(siteDir, path));
const expects = {
  heroRun: exists("src/content/hero-run.ts"),
  trail404: exists("src/components/not-found"),
  reveals: exists("src/content/how-it-works.ts"),
  demoReveals: exists("src/content/demo.ts"),
};

/** §4.4's budgets for the motion code a page requests (gzip -9), and the gate's own chunk. */
const motionBudget = { homeAfterLoad: 32_000, homeApproach: 22_000, innerPage: 32_000, gateChunk: 1_024 };

/**
 * The build's motion chunks, read from the build (Turbopack's chunk loaders): the gate's chunk (the one exporting
 * MotionGate, with the motion query in it), every chunk its dynamic imports name (each loader's
 * Promise.all(["static/chunks/….js", …]) list), and the chunks those name in turn (the engine, ScrollTrigger). Only
 * these count toward the motion budgets: Next's route prefetches and the page's own lazy chunks are not motion code.
 */
function buildMotionChunks() {
  const dir = join(distDir, "static", "chunks");
  const files = existsSync(dir) ? readdirSync(dir).filter((file) => file.endsWith(".js")) : [];
  const text = new Map(files.map((file) => [file, readFileSync(join(dir, file), "latin1")]));
  const gate = files.filter((file) => text.get(file).includes('"MotionGate"') && text.get(file).includes("(prefers-reduced-motion: no-preference)"));
  const loaded = (file) => [...(text.get(file) ?? "").matchAll(/Promise\.all\(\[((?:"static\/chunks\/[^"]+\.js",?)+)\]/g)].flatMap((m) => [...m[1].matchAll(/static\/chunks\/([^"]+\.js)/g)].map((n) => n[1]));
  const motion = new Set();
  const queue = gate.flatMap(loaded);
  while (queue.length) {
    const file = queue.shift();
    if (motion.has(file) || gate.includes(file)) continue;
    motion.add(file);
    queue.push(...loaded(file));
  }
  const gzip = (file) => gzipSync(Buffer.from(text.get(file), "latin1"), { level: 9 }).length;
  return { gate: gate.map((file) => ({ file, gzip: gzip(file) })), lazy: [...motion].map((file) => ({ file, gzip: gzip(file) })) };
}
const motionChunks = buildMotionChunks();
const isMotionChunk = (path) => motionChunks.lazy.some((chunk) => path.split("?")[0].endsWith(`/static/chunks/${chunk.file}`));

/** The pages with (or due to have) motion: the homepage, the 404, How it works, Demo and one check page. */
const firstCheckPage = indexable.find((route) => /^\/checks\/[^/]+\/$/.test(route.path))?.path;
const motionPages = ["/", notFound, "/how-it-works/", "/demo/", firstCheckPage].filter(
  (path, i, all) => path && all.indexOf(path) === i && (path === notFound || indexable.some((route) => route.path === path)),
);
const result = { build: process.env.NEXT_DIST_DIR ?? ".next", expects, motionChunks, pages: {} };
const record = (path, key, value) => ((result.pages[path] ??= {})[key] = value);
let browser;

before(async () => {
  browser = await launch();
});
after(async () => {
  await browser?.close();
  writeJson("motion-contract.json", result);
});

// ---- Page-side probes (run in the page) -----------------------------------------------------------------------------

/** The page's motion roots: name, state and whether it holds late parts. */
const roots = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("[data-motion]")].map((root) => ({
      name: root.getAttribute("data-motion"),
      state: root.getAttribute("data-motion-state"),
      ready: root.hasAttribute("data-ready"),
      held: Boolean(root.querySelector('[data-beat="late"]')),
    })),
  );

/** Waits until no motion root is playing (at most `ms`), then returns whether all settled. */
const nothingPlaying = (page, ms = 8000) =>
  page
    .waitForFunction(() => !document.querySelector('[data-motion-state="playing"]'), null, { timeout: ms, polling: 100 })
    .then(() => true)
    .catch(() => false);

/**
 * The held figures (the hero run, the 404's trail) have settled: none is still to mount or playing. A figure settles
 * "done", or "armed" when it waits for the reader to scroll it half into view (a phone). Their islands mount after load
 * plus idle, so a root with no state yet is waited for; under reduced motion or Save-Data none ever gets one, so the
 * wait ends when the hold is released (data-ready with no state).
 */
const heroDone = (page, ms = 12_000) =>
  page
    .waitForFunction(
      () => {
        const held = [...document.querySelectorAll("[data-motion]")].filter((root) => root.querySelector('[data-beat="late"]'));
        const motion = matchMedia("(prefers-reduced-motion: no-preference)").matches && !navigator.connection?.saveData;
        return held.every((root) => (motion ? ["done", "armed"].includes(root.getAttribute("data-motion-state") ?? "") : root.hasAttribute("data-ready") || !motion));
      },
      null,
      { timeout: ms, polling: 100 },
    )
    .then(() => true)
    .catch(() => false);

/** Records, from navigation, when each motion root's data-motion-state and data-ready change (page clock). */
async function installStateLog(page) {
  await page.addInitScript(() => {
    window.__motionLog = [];
    new MutationObserver((mutations) => {
      for (const m of mutations) {
        const root = m.target;
        window.__motionLog.push({
          t: Math.round(performance.now()),
          name: root.getAttribute("data-motion"),
          attribute: m.attributeName,
          value: root.getAttribute(m.attributeName),
        });
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-motion-state", "data-ready"] });
  });
}
const readStateLog = (page) => page.evaluate(() => window.__motionLog ?? []);

/**
 * Watches the first viewport's elements with words for an inline opacity below 1 (§4.6 #2), from the first byte, with
 * a MutationObserver on style attributes.
 */
async function installInlineOpacityWatch(page) {
  await page.addInitScript(() => {
    window.__inlineFaded = [];
    const words = /[\p{L}\p{N}]/u;
    new MutationObserver((mutations) => {
      for (const m of mutations) {
        const el = m.target;
        if (!(el instanceof HTMLElement) || !el.closest("main")) continue;
        if (el.closest('[aria-hidden="true"]')) continue;
        const opacity = el.style.opacity;
        if (opacity === "" || Number(opacity) >= 1) continue;
        if (!words.test(el.textContent ?? "")) continue;
        const rect = el.getBoundingClientRect();
        if (rect.top >= innerHeight) continue;
        window.__inlineFaded.push(`${el.tagName.toLowerCase()} «${el.textContent.trim().slice(0, 40)}» opacity ${opacity}`);
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ["style"] });
  });
}

/** The h1's opacity (with its ancestors') at DOMContentLoaded. */
async function installH1AtDomContentLoaded(page) {
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const h1 = document.querySelector("h1");
      let opacity = h1 ? 1 : null;
      for (let node = h1; node && node.nodeType === 1; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
      window.__h1AtDcl = opacity;
    });
  });
}

/**
 * Every moving part as the reader has it: parts below opacity 1 (the rest-hidden ones left out), and parts that motion
 * code has written a transform or an opacity onto (an inline style: the server writes none, §2.9).
 */
const partsAtRest = (page, restHidden) =>
  page.evaluate((hidden) => {
    const out = { faded: [], moved: [] };
    for (const el of document.querySelectorAll("[data-motion] [data-part], [data-motion] [data-beat], [data-motion='reveal']")) {
      const part = el.getAttribute("data-part") ?? el.getAttribute("data-motion");
      if (part === "replay-slot" || hidden.includes(part) || el.classList.contains("rest-hidden")) continue;
      if (Number(getComputedStyle(el).opacity) < 0.999) out.faded.push(`${part} ${getComputedStyle(el).opacity}`);
      const inline = el.style ? ["transform", "translate", "rotate", "scale", "opacity"].filter((property) => el.style[property]) : [];
      if (inline.length) out.moved.push(`${part}: ${inline.map((property) => `${property} ${el.style[property]}`).join("; ")}`);
    }
    return out;
  }, restHidden);

/**
 * The page has settled before a frame is compared: the fonts ready and the first viewport's images decoded (a late
 * font or image is not motion). Lazy images below the fold are left out: decode() can wait on them, and the
 * screenshot this guards (page.screenshot with no fullPage) never shows them anyway.
 *
 * Not `page.waitForLoadState("networkidle")`: a page with several findings' worth of images (/demo/, the heaviest
 * of motionPages) keeps a trickle of lazy, below-the-fold requests going out for a while after load, at browser-paced
 * low priority, so a 500 ms window with zero network in flight can take much longer to arrive than the 30 s this
 * waits by default — Playwright's own docs warn networkidle is unreliable on exactly this kind of page. None of that
 * traffic is above the fold, so it can't be mistaken for motion in the frames this compares; fonts.ready plus
 * decoding only the in-view images already waits for everything a visible frame actually depends on.
 */
async function settled(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    const inView = [...document.images].filter((image) => image.getBoundingClientRect().top < innerHeight);
    const decoded = Promise.all(inView.map((image) => image.decode().catch(() => {})));
    await Promise.race([decoded, new Promise((resolve) => setTimeout(resolve, 3000))]);
  });
}

const replayVisible = (page) =>
  page.evaluate(() => {
    const slot = document.querySelector('[data-part="replay-slot"]');
    return slot ? getComputedStyle(slot).visibility === "visible" : false;
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
  // Both viewports (§5.2): on a phone, the 404's trail may wait "armed" for half visibility.
  const cases = ["desktop", "phone"].flatMap((profile) => motionPages.map((path) => ({ path, profile })));
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
