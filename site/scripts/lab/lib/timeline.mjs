/**
 * What a reader sees over time: a frame sampler (the opacity of chosen elements on every frame from navigation) and a
 * filmstrip (a screenshot every step). The §5.2 "Time to bug" gate (the finding card visible ≤ 5.0 s from navigation,
 * throttled desktop, median of 3), the "no flicker" checks (the hero, the 404's trail) and the storyboards read them.
 * Ported from site-design/evidence/scripts/measure.mjs (its flicker sampler, lines 87-109) and filmstrip.mjs
 * (capture()).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Samples, on every animation frame for the first `ms` milliseconds after navigation, how visible each selector's
 * element is: its opacity times its ancestors' (0 while it has no box: display none, or not in the DOM yet; null
 * before it first exists). Install before goto(); read with readFrameSampler().
 *
 * The loop stops at `ms`, so the motion contract's count of requestAnimationFrame callbacks at rest stays 0. It keeps
 * the page's own requestAnimationFrame from before installRafCounter() wrapped it (either may be installed first), so
 * its frames are never counted as the page's.
 */
export async function installFrameSampler(page, selectors, { ms = 7000 } = {}) {
  await page.addInitScript(
    ({ selectors: list, ms: span }) => {
      const raf = (window.__rafOriginal ?? window.requestAnimationFrame).bind(window);
      const samples = Object.fromEntries(list.map((selector) => [selector, []]));
      window.__frameSamples = samples;
      const visibility = (element) => {
        if (!element) return null;
        if (!element.getClientRects().length) return 0;
        let opacity = 1;
        for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (style.visibility === "hidden" && node === element) return 0;
          opacity *= Number(style.opacity);
        }
        return Math.round(opacity * 1000) / 1000;
      };
      const tick = () => {
        const t = Math.round(performance.now());
        for (const selector of list) samples[selector].push([t, visibility(document.querySelector(selector))]);
        if (performance.now() < span) raf(tick);
      };
      raf(tick);
    },
    { selectors, ms },
  );
}

/**
 * The sampled elements, by selector: `frames` (samples in which the element existed), `firstSeenMs` (the first such
 * frame, ms from navigation), `firstVisibleMs` (the first frame above opacity 0.5), `restMs` (the first frame from
 * which it stays at opacity 1, ≥ 0.999, to the end of sampling; null if it never settles) and `flash` (seen above 0.5,
 * then below 0.5 again: a reader saw it appear and vanish). With `raw`, also the samples: [[t, opacity], ...].
 */
export async function readFrameSampler(page, { raw = false } = {}) {
  const all = await page.evaluate(() => window.__frameSamples ?? {});
  return Object.fromEntries(
    Object.entries(all).map(([selector, samples]) => {
      const seen = samples.filter(([, opacity]) => opacity !== null);
      let firstVisibleMs = null;
      let flash = false;
      let restMs = null;
      for (const [t, opacity] of seen) {
        if (opacity > 0.5) firstVisibleMs ??= t;
        else if (firstVisibleMs !== null) flash = true;
        if (opacity >= 0.999) restMs ??= t;
        else restMs = null;
      }
      // Gone from the DOM after it was seen: the reader saw it vanish too.
      const lastSeenAt = samples.findLastIndex(([, opacity]) => opacity !== null);
      if (firstVisibleMs !== null && lastSeenAt < samples.length - 1) {
        flash = true;
        restMs = null;
      }
      return [
        selector,
        {
          frames: seen.length,
          firstSeenMs: seen[0]?.[0] ?? null,
          firstVisibleMs,
          restMs,
          flash,
          ...(raw ? { samples } : {}),
        },
      ];
    }),
  );
}

/**
 * A filmstrip: `frames` screenshots of the viewport, one every `stepMs` by the wall clock, written to <dir>/NN.jpg
 * (JPEG, quality 72, CSS scale) with <dir>/frames.json. Each frame has `t` (ms since the strip started), `pageMs` (the
 * page's performance.now(), ms from navigation; null before a document exists) and `file` (null when nothing was
 * painted yet). `between(i)` runs after frame i (a scroll step, a state read). Start it right after goto() with
 * waitUntil "commit" to film a page loading.
 */
export async function filmstrip(page, dir, { frames = 28, stepMs = 250, between } = {}) {
  await mkdir(dir, { recursive: true });
  const digits = Math.max(2, String(frames - 1).length);
  const start = Date.now();
  const strip = [];
  for (let i = 0; i < frames; i += 1) {
    const wait = start + i * stepMs - Date.now();
    if (wait > 0) await page.waitForTimeout(wait);
    const t = Date.now() - start;
    const pageMs = await page.evaluate(() => Math.round(performance.now())).catch(() => null);
    const file = join(dir, `${String(i).padStart(digits, "0")}.jpg`);
    try {
      await page.screenshot({ path: file, type: "jpeg", quality: 72, scale: "css", timeout: 2000 });
      strip.push({ file, t, pageMs });
    } catch {
      strip.push({ file: null, t, pageMs, note: "nothing painted yet" });
    }
    if (between) await between(i);
  }
  await writeFile(join(dir, "frames.json"), `${JSON.stringify(strip, null, 1)}\n`);
  return strip;
}
