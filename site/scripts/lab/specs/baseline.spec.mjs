/**
 * The lab baseline: today's numbers for every registry page and the 404, measured the way the redesign's gates will
 * measure them (§5.2), so each node can show what it changed. It records:
 * - at 1440×900 and 390×844, reduced motion: visible words in <main>, screens, footer height, headings, tablists,
 *   distinct font sizes and the mono share, CSP violations, and a full-page screenshot (G2 compares its pages with
 *   these at 0.1% of pixels);
 * - reflow at 320×720 and the header at 400% zoom (320×256);
 * - axe-core at 1280×720 and 390×844, reduced motion;
 * - LCP and CLS, throttled (4× CPU, 1.6 Mbps, 150 ms), three runs per page at both sizes: the median, with the
 *   fastest and slowest run (one run moved by up to 192 ms between two recordings, next to a 1,200 ms gate); the first
 *   viewport's route prefetches;
 * - on the home page: requestAnimationFrame callbacks at rest at 21 stop points, the accent and type audits, the
 *   contrast sampler over axe's incomplete nodes, and the keyboard's Tab stops.
 *
 * The summary goes to <lab out>/baseline.json, and, with LAB_RECORD_BASELINE=1, to scripts/lab/baseline.json (the
 * recorded baseline, committed); screenshots to <lab out>/baseline/screens/. It checks only that every page answers:
 * the numbers are what they are. Runs only when named: pnpm lab baseline.
 */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { accentAudit, contrastSample, runAxe } from "../lib/audits.mjs";
import { cspViolations, launch, median, newPage, origin, sleep, slowScroll } from "../lib/browser.mjs";
import { reflow, tabStops } from "../lib/keyboard.mjs";
import { installRafCounter, rafAtStopPoints, restState } from "../lib/motion.mjs";
import { labOut, writeJson } from "../lib/out.mjs";
import { measurePage, typeAudit } from "../lib/page-measures.mjs";
import { prefetches, recordRequests } from "../lib/requests.mjs";
import { labRoutes } from "../lib/routes.mjs";
import { fullPage, settle, shotName } from "../lib/screenshots.mjs";
import { installVitals, readVitals } from "../lib/vitals.mjs";

const base = origin();
const { indexable, notFound } = await labRoutes();
/** Every page: the registry's indexable routes, then the 404. */
const pages = [...indexable.map((r) => ({ id: r.id, path: r.path })), { id: "404", path: notFound }];
// The server's address is left out: it is the lab's port that day, not a property of the site.
const result = { measuredAt: new Date().toISOString(), build: process.env.NEXT_DIST_DIR ?? ".next", pages: {} };
const entry = (id) => (result.pages[id] ??= {});
let browser;

before(async () => {
  browser = await launch();
});
after(async () => {
  await browser?.close();
  const summary = writeJson("baseline.json", result);
  if (process.env.LAB_RECORD_BASELINE === "1") {
    writeFileSync(join(import.meta.dirname, "..", "baseline.json"), `${JSON.stringify(result, null, 1)}\n`);
  }
  console.log(`baseline: ${Object.keys(result.pages).length} pages written to ${summary}`);
});

describe("pages at rest (reduced motion)", () => {
  for (const [name, profile] of [
    ["1440", "desktop"],
    ["390", "phone"],
  ]) {
    test(`at ${name} px: words, screens, type, CSP and a screenshot of every page`, async () => {
      const { context, page } = await newPage(browser, { profile, reducedMotion: "reduce" });
      for (const { id, path } of pages) {
        const response = await page.goto(base + path, { waitUntil: "load" });
        assert.equal(response.status(), id === "404" ? 404 : 200, `${path} answered ${response.status()}`);
        await settle(page);
        const measures = await measurePage(page);
        const type = await typeAudit(page);
        const shot = await fullPage(page, labOut("baseline", "screens", shotName(id === "404" ? "/404/" : path, name)));
        entry(id)[name] = {
          words: measures.mainWords,
          screens: measures.screens,
          pageHeight: measures.pageHeight,
          footerHeight: measures.footerHeight,
          headings: { h1: measures.h1, h2: measures.h2, h3: measures.h3 },
          tablists: measures.tablists,
          overflowX: measures.overflowX,
          distinctFontSizes: type.distinctFontSizes,
          monoShare: type.monoShare,
          cspViolations: (await cspViolations(page)).length,
          screenshot: shot.slice(labOut().length + 1),
        };
      }
      await context.close();
    });
  }
});

describe("reflow and zoom", () => {
  test("320×720: horizontal overflow; 320×256 (400% zoom): the header's position", async () => {
    for (const [name, viewport] of [
      ["320x720", { width: 320, height: 720 }],
      ["320x256", { width: 320, height: 256 }],
    ]) {
      const { context, page } = await newPage(browser, { viewport, reducedMotion: "reduce" });
      for (const { id, path } of pages) {
        await page.goto(base + path, { waitUntil: "load" });
        const measured = await reflow(page);
        entry(id)[`reflow${name}`] = { overflowX: measured.overflowX, headerPosition: measured.headerPosition };
      }
      await context.close();
    }
  });
});

describe("accessibility", () => {
  test("axe-core 4.13 at 1280×720 and 390×844, reduced motion", async () => {
    for (const [name, options] of [
      ["1280", { viewport: { width: 1280, height: 720 } }],
      ["390", { profile: "phone" }],
    ]) {
      const { context, page } = await newPage(browser, { ...options, reducedMotion: "reduce" });
      for (const { id, path } of pages) {
        await page.goto(base + path, { waitUntil: "load" });
        const axe = await runAxe(page);
        entry(id)[`axe${name}`] = { version: axe.version, violations: axe.violations.map((v) => `${v.id}(${v.nodes})`) };
      }
      await context.close();
    }
  });
});

describe("loading", () => {
  test("LCP and CLS, throttled: the median of 3 runs on every page, with the fastest and slowest", async () => {
    for (const profile of ["desktop", "phone"]) {
      for (const { id, path } of pages) {
        const runs = [];
        for (let i = 0; i < 3; i += 1) {
          const { context, page } = await newPage(browser, { profile, throttle: true, reducedMotion: "no-preference" });
          await installVitals(page);
          await page.goto(base + path, { waitUntil: "load", timeout: 120_000 });
          await sleep(1500);
          await slowScroll(page, { step: 400, pause: 60, back: true });
          await sleep(800);
          runs.push(await readVitals(page));
          await context.close();
        }
        const times = runs.map((r) => r.lcp?.t ?? -1);
        // The element of the median run (the runs can disagree while images load).
        const middle = runs[times.indexOf(median(times))] ?? runs[0];
        entry(id)[`vitals-${profile}`] = {
          lcpMs: median(times),
          lcpMinMs: Math.min(...times),
          lcpMaxMs: Math.max(...times),
          lcpElement: middle.lcp?.el ?? null,
          clsMax: Math.max(...runs.map((r) => r.cls)),
          runs: runs.length,
        };
      }
    }
  });

  test("the first viewport's route prefetches, desktop", async () => {
    for (const { id, path } of pages) {
      const { context, page } = await newPage(browser, { profile: "desktop" });
      const log = recordRequests(page);
      await page.goto(base + path, { waitUntil: "load" });
      await sleep(3000);
      entry(id).prefetchFirstViewport = (({ count, bytes }) => ({ count, bytes }))(prefetches(log.requests));
      await context.close();
    }
  });
});

describe("the home page", () => {
  test("requestAnimationFrame callbacks at rest at 21 stop points (motion allowed)", async () => {
    const { context, page } = await newPage(browser, { profile: "desktop", reducedMotion: "no-preference" });
    await installRafCounter(page);
    await page.goto(`${base}/`, { waitUntil: "load" });
    await sleep(3000);
    const stops = await rafAtStopPoints(page);
    const rest = await restState(page);
    entry("home").rafAtRest = { stopPoints: stops.length, maxPer3s: Math.max(...stops.map((s) => s.raf)), counts: stops.map((s) => s.raf) };
    entry("home").restState = { atOpacityZero: rest.atOpacityZero.length, infiniteAnimations: rest.infiniteAnimations, gsapLoaded: rest.gsapLoaded };
    await context.close();
  });

  test("the accent and type audits, the contrast sampler and the Tab stops", async () => {
    for (const [name, profile] of [
      ["1440", "desktop"],
      ["390", "phone"],
    ]) {
      const { context, page } = await newPage(browser, { profile, reducedMotion: "reduce" });
      await page.goto(`${base}/`, { waitUntil: "load" });
      await settle(page, { gifMs: 0 });
      const accent = await accentAudit(page);
      entry("home")[`accent${name}`] = { strongObjects: accent.objects.length, maxPerWindow: accent.maxPerWindow };
      const contrast = await contrastSample(page);
      entry("home")[`contrast${name}`] = {
        incompleteNodes: contrast.length,
        failing: contrast.filter((n) => !n.passes).map((n) => `${n.text} ${n.ratio}`),
      };
      if (profile === "desktop") {
        // A fresh load, so Tab starts at the top of the page.
        await page.goto(`${base}/`, { waitUntil: "load" });
        const stops = await tabStops(page);
        entry("home").keyboard = {
          tabStops: stops.length,
          withoutRing: stops.filter((s) => !s.ring).length,
          fullyObscured: stops.filter((s) => s.fullyObscured).length,
          first: stops[0]?.name ?? null,
        };
      }
      await context.close();
    }
  });
});
