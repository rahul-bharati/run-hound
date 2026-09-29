/**
 * Shared setup for the motion contract (DESIGN.md §4.6): the pages and budgets both halves measure against, the
 * build's motion chunks, the DOM contract, and the page-side probes neither half's tests can run without. Split
 * out when motion-contract.spec.mjs (~23.6 min, CI's critical path) became motion-contract-1.spec.mjs (items 1-6,
 * desktop half of 4-6) and motion-contract-2.spec.mjs (the phone half of 4-6 through 11, lazy motion bytes and the
 * figure check), so each half stays self-contained instead of repeating this; see
 * docs/decisions/09-2026.md#2026-09-29-ci-parallel-jobs.
 *
 * Each half imports this once, in its own node:test process: the constants below (motionPages, expects,
 * motionChunks, ...) run the same lookups the original single file did, just now once per half instead of once
 * overall.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { distDir, siteDir } from "../../lib/build-output.mjs";
import { origin } from "./browser.mjs";
import { labRoutes } from "./routes.mjs";

// The DOM contract, from its one source (the site's .ts modules load through the test hooks, as in `pnpm test`).
await import("../../test-hooks.mjs");
export const { domContract, restHiddenParts } = await import("../../../src/motion/dom-contract.ts");

export const base = origin();
const { indexable, notFound } = await labRoutes();
export { notFound };
const exists = (path) => existsSync(join(siteDir, path));
export const expects = {
  heroRun: exists("src/content/hero-run.ts"),
  trail404: exists("src/components/not-found"),
  reveals: exists("src/content/how-it-works.ts"),
  demoReveals: exists("src/content/demo.ts"),
};

/** §4.4's budgets for the motion code a page requests (gzip -9), and the gate's own chunk. */
export const motionBudget = { homeAfterLoad: 32_000, homeApproach: 22_000, innerPage: 32_000, gateChunk: 1_024 };

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
export const motionChunks = buildMotionChunks();
export const isMotionChunk = (path) => motionChunks.lazy.some((chunk) => path.split("?")[0].endsWith(`/static/chunks/${chunk.file}`));

/** The pages with (or due to have) motion: the homepage, the 404, How it works, Demo and one check page. */
const firstCheckPage = indexable.find((route) => /^\/checks\/[^/]+\/$/.test(route.path))?.path;
export const motionPages = ["/", notFound, "/how-it-works/", "/demo/", firstCheckPage].filter(
  (path, i, all) => path && all.indexOf(path) === i && (path === notFound || indexable.some((route) => route.path === path)),
);

// ---- Page-side probes (run in the page) -----------------------------------------------------------------------------

/** The page's motion roots: name, state and whether it holds late parts. */
export const roots = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("[data-motion]")].map((root) => ({
      name: root.getAttribute("data-motion"),
      state: root.getAttribute("data-motion-state"),
      ready: root.hasAttribute("data-ready"),
      held: Boolean(root.querySelector('[data-beat="late"]')),
    })),
  );

/** Waits until no motion root is playing (at most `ms`), then returns whether all settled. */
export const nothingPlaying = (page, ms = 8000) =>
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
export const heroDone = (page, ms = 12_000) =>
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
export async function installStateLog(page) {
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
export const readStateLog = (page) => page.evaluate(() => window.__motionLog ?? []);

/**
 * Watches the first viewport's elements with words for an inline opacity below 1 (§4.6 #2), from the first byte, with
 * a MutationObserver on style attributes.
 */
export async function installInlineOpacityWatch(page) {
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
export async function installH1AtDomContentLoaded(page) {
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
export const partsAtRest = (page, restHidden) =>
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
export async function settled(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    const inView = [...document.images].filter((image) => image.getBoundingClientRect().top < innerHeight);
    const decoded = Promise.all(inView.map((image) => image.decode().catch(() => {})));
    await Promise.race([decoded, new Promise((resolve) => setTimeout(resolve, 3000))]);
  });
}

export const replayVisible = (page) =>
  page.evaluate(() => {
    const slot = document.querySelector('[data-part="replay-slot"]');
    return slot ? getComputedStyle(slot).visibility === "visible" : false;
  });

